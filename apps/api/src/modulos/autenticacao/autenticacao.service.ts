// =====================================================================
// Resolve o usuário da requisição (uma vez por requisição):
//   1) cabeçalho Authorization: Bearer <JWT>  (clientes de API / apps futuros)
//   2) cookie MESSESSION (JWT de acesso)       (navegador — frontend atual, sem alterações)
//   3) cookie MESREFRESH: renovação transparente quando o acesso venceu (novo MESSESSION na resposta)
//   4) Microsoft Entra ID (Easy Auth do App Service), quando habilitado: cria a sessão do usuário do Entra.
// =====================================================================
import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CONFIGURACAO, type ConfiguracaoMes } from '../../configuracao/opcoes';
import { easyAuthConfiavel } from '../../plataforma';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { lerPrincipalEasyAuth } from './easy-auth';
import {
  COOKIE_ACESSO,
  COOKIE_REFRESH,
  type ContextoAutenticado,
  SessoesService,
  cookie,
  tokenBearer,
} from './sessoes.service';

const CONTEXTO = Symbol('mesContexto');
type RequisicaoMes = Request & { [CONTEXTO]?: Promise<ContextoAutenticado | null> };

@Injectable()
export class AutenticacaoService {
  constructor(
    @Inject(CONFIGURACAO) private readonly cfg: ConfiguracaoMes,
    private readonly sessoes: SessoesService,
    private readonly usuarios: UsuariosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Usuário autenticado e ativo da requisição (ou null). */
  contexto(req: Request, res: Response): Promise<ContextoAutenticado | null> {
    const r = req as RequisicaoMes;
    return (r[CONTEXTO] ??= this.resolver(req, res));
  }

  /** Substitui o contexto da requisição (após login/logout na própria requisição). */
  definirContexto(req: Request, ctx: ContextoAutenticado | null): void {
    (req as RequisicaoMes)[CONTEXTO] = Promise.resolve(ctx);
  }

  private async resolver(req: Request, res: Response): Promise<ContextoAutenticado | null> {
    let ctx: ContextoAutenticado | null = null;
    const bearer = tokenBearer(req);
    if (bearer) {
      const p = await this.sessoes.validarAcesso(bearer);
      ctx = p ? await this.sessoes.contextoPorAcesso(p) : null;
    } else {
      const acesso = cookie(req, COOKIE_ACESSO);
      if (acesso) {
        const p = await this.sessoes.validarAcesso(acesso);
        if (p) ctx = await this.sessoes.contextoPorAcesso(p);
      }
      const refresh = cookie(req, COOKIE_REFRESH);
      if (!ctx && refresh) {
        const r = await this.sessoes.renovar(refresh, 'COOKIE');
        if (r) {
          this.sessoes.definirCookies(res, req, r.acesso, r.novoRefresh);
          ctx = r.contexto;
        } else if (!res.headersSent) this.sessoes.limparCookies(res, req);
      }
    }

    const o = this.cfg.opcoes;
    if (o.autenticacao.entraId.habilitado && easyAuthConfiavel(o)) {
      const principal = lerPrincipalEasyAuth(req.headers);
      if (principal && (!ctx || (ctx.usuario.externalId ?? '').toLowerCase() !== principal.id.toLowerCase())) {
        const u = await this.usuarios.resolverEntra(principal);
        if (u?.active) {
          const nova = await this.sessoes.criarSessao(u, 'ENTRA', 'COOKIE', req);
          if (!res.headersSent) this.sessoes.definirCookies(res, req, nova.acesso, nova.refresh);
          const anterior = ctx;
          ctx = { usuario: u, sessaoId: nova.sessao.id, provedor: 'ENTRA', canal: 'COOKIE' };
          if (!anterior) await this.auditoria.registrar(u, 'auth', 'LOGIN_ENTRA', u.username);
        }
      }
    }
    return ctx;
  }
}

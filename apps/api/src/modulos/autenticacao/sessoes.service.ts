// =====================================================================
// Sessões com JWT: token de ACESSO curto (cookie MESSESSION ou cabeçalho Bearer) + REFRESH TOKEN opaco
// e rotativo (cookie MESREFRESH, HttpOnly, só para /api; ou corpo de /api/auth/refresh para clientes Bearer).
//  - O refresh token nunca é gravado: só o SHA-256 (dbo.auth_sessions / sessoes_autenticacao.json).
//  - Expiração deslizante (MesLion:Autenticacao:SessaoHoras, padrão 12 h sem uso), como o cookie do .NET.
//  - Rotação: o token é trocado quando tem mais de RotacaoMinutos (navegador) ou a cada uso (Bearer); o
//    anterior vale por ToleranciaSegundos (requisições simultâneas) e, depois disso, o reuso revoga a sessão.
//  - Logout e desativação do usuário revogam a sessão (vale em até 20 s em todas as instâncias).
// =====================================================================
import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { CookieOptions, Request, Response } from 'express';
import { hex, sha256 } from '../../comum/json-estado';
import { CONFIGURACAO, type ConfiguracaoMes } from '../../configuracao/opcoes';
import type { SessaoAutenticacao, Usuario } from '../../dominio/entidades';
import { PROVEDOR_PERSISTENCIA, type ProvedorPersistencia } from '../../dominio/repositorios';
import { UsuariosService } from '../usuarios/usuarios.service';

export const COOKIE_ACESSO = 'MESSESSION';
export const COOKIE_REFRESH = 'MESREFRESH';
const CACHE_SESSAO_MS = 20_000;
const NOME_SEGREDO = 'jwt';

export type Canal = 'COOKIE' | 'TOKEN';

/** Usuário autenticado na requisição. */
export interface ContextoAutenticado {
  usuario: Usuario;
  sessaoId: string;
  /** LOCAL ou ENTRA. */
  provedor: string;
  canal: Canal;
}

interface PayloadAcesso {
  sub: string;
  sid: string;
  name: string;
  role: string;
  prov: string;
  typ: 'access';
}

export interface SessaoEmitida {
  sessao: SessaoAutenticacao;
  acesso: string;
  refresh: string;
}

export interface ResultadoRenovacao {
  contexto: ContextoAutenticado;
  acesso: string;
  /** Novo refresh token quando houve rotação (o cliente deve passar a usar este). */
  novoRefresh: string | null;
  expiraEm: Date;
}

const tokenOpaco = () => randomBytes(32).toString('base64url');

@Injectable()
export class SessoesService {
  private readonly log = new Logger('MesLion.Sessoes');
  private segredo: Buffer | null = null;
  private readonly cacheSessoes = new Map<string, { sessao: SessaoAutenticacao; expira: number }>();
  private readonly renovacoes = new Map<string, Promise<ResultadoRenovacao | null>>();

  constructor(
    @Inject(PROVEDOR_PERSISTENCIA) private readonly provedor: ProvedorPersistencia,
    @Inject(CONFIGURACAO) private readonly cfg: ConfiguracaoMes,
    private readonly jwt: JwtService,
    private readonly usuarios: UsuariosService,
  ) {
    this.usuarios.eventos.on(
      'desativado',
      (id: string) => void this.revogarDoUsuario(id, 'usuário desativado').catch(() => undefined),
    );
  }

  private get o() {
    return this.cfg.opcoes.autenticacao;
  }

  get acessoSegundos(): number {
    return Math.max(1, this.o.jwt.acessoMinutos) * 60;
  }

  get sessaoSegundos(): number {
    return Math.max(1, this.o.sessaoHoras) * 3600;
  }

  /** Chave HMAC dos JWT: da configuração (ex.: Azure Key Vault) ou gerada uma vez e guardada no banco. */
  async carregarSegredo(): Promise<void> {
    const configurado = this.o.jwt.segredo.trim();
    if (configurado) {
      if (configurado.length < 32)
        throw new Error('MesLion:Autenticacao:Jwt:Segredo deve ter pelo menos 32 caracteres.');
      this.segredo = Buffer.from(configurado, 'utf8');
      return;
    }
    const valor = await this.provedor.segredos.definirSeAusente(NOME_SEGREDO, randomBytes(64).toString('base64'));
    this.segredo = Buffer.from(valor, 'base64');
  }

  private chave(): Buffer {
    if (!this.segredo) throw new Error('Chave dos tokens ainda não carregada.');
    return this.segredo;
  }

  async emitirAcesso(u: Usuario, sessao: Pick<SessaoAutenticacao, 'id' | 'provider'>): Promise<string> {
    const payload: PayloadAcesso = {
      sub: u.id,
      sid: sessao.id,
      name: u.username,
      role: u.role,
      prov: sessao.provider,
      typ: 'access',
    };
    return this.jwt.signAsync(payload, {
      secret: this.chave(),
      algorithm: 'HS256',
      expiresIn: this.acessoSegundos,
      issuer: this.o.jwt.emissor,
      audience: this.o.jwt.audiencia,
    });
  }

  async validarAcesso(token: string): Promise<PayloadAcesso | null> {
    try {
      const p = await this.jwt.verifyAsync<PayloadAcesso>(token, {
        secret: this.chave(),
        algorithms: ['HS256'],
        issuer: this.o.jwt.emissor,
        audience: this.o.jwt.audiencia,
      });
      return p.typ === 'access' && typeof p.sid === 'string' && typeof p.sub === 'string' ? p : null;
    } catch {
      return null;
    }
  }

  async criarSessao(u: Usuario, provedorLogin: string, canal: Canal, req: Request): Promise<SessaoEmitida> {
    const agora = new Date();
    const refresh = tokenOpaco();
    const sessao: SessaoAutenticacao = {
      id: randomUUID(),
      userId: u.id,
      refreshHash: sha256(Buffer.from(refresh, 'utf8')),
      previousRefreshHash: null,
      provider: provedorLogin,
      channel: canal,
      createdAt: agora,
      rotatedAt: agora,
      lastSeenAt: agora,
      expiresAt: new Date(agora.getTime() + this.sessaoSegundos * 1000),
      revokedAt: null,
      revokedReason: null,
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 400) || null,
      ipAddress: (req.ip ?? '').slice(0, 64) || null,
    };
    await this.provedor.sessoes.criar(sessao);
    this.cacheSessoes.set(sessao.id, { sessao, expira: Date.now() + CACHE_SESSAO_MS });
    return { sessao, acesso: await this.emitirAcesso(u, sessao), refresh };
  }

  private async sessaoComCache(id: string): Promise<SessaoAutenticacao | null> {
    const c = this.cacheSessoes.get(id);
    if (c && c.expira > Date.now()) return c.sessao;
    const s = await this.provedor.sessoes.obter(id);
    if (s) this.cacheSessoes.set(id, { sessao: s, expira: Date.now() + CACHE_SESSAO_MS });
    else this.cacheSessoes.delete(id);
    return s;
  }

  /** Contexto a partir de um token de acesso válido: sessão ativa e usuário ativo. */
  async contextoPorAcesso(p: PayloadAcesso): Promise<ContextoAutenticado | null> {
    const s = await this.sessaoComCache(p.sid);
    if (!s || s.revokedAt || s.expiresAt.getTime() <= Date.now() || s.userId !== p.sub.toLowerCase()) return null;
    const u = await this.usuarios.porIdComCache(s.userId);
    if (!u || !u.active) return null;
    return { usuario: u, sessaoId: s.id, provedor: s.provider, canal: s.channel };
  }

  /**
   * Renova o acesso com o refresh token. Requisições SIMULTÂNEAS com o mesmo token (ex.: várias chamadas do
   * navegador quando o acesso venceu) compartilham a mesma renovação; depois que ela termina, um novo uso do
   * token antigo passa pela regra de tolerância/reuso.
   */
  renovar(refresh: string, canal: Canal): Promise<ResultadoRenovacao | null> {
    const hash = sha256(Buffer.from(refresh, 'utf8'));
    const chave = `${canal}:${hex(hash)}`;
    const andamento = this.renovacoes.get(chave);
    if (andamento) return andamento;
    const p = this.renovarInterno(hash, canal)
      .catch((e) => {
        this.log.error(`Falha ao renovar a sessão: ${(e as Error).message}`);
        return null;
      })
      .finally(() => this.renovacoes.delete(chave));
    this.renovacoes.set(chave, p);
    return p;
  }

  private async renovarInterno(hash: Buffer, canal: Canal): Promise<ResultadoRenovacao | null> {
    const achado = await this.provedor.sessoes.porHashRefresh(hash);
    if (!achado) return null;
    const s = achado.sessao;
    const agora = new Date();
    if (s.revokedAt || s.expiresAt.getTime() <= agora.getTime() || s.channel !== canal) return null;
    if (!achado.atual) {
      // Clientes Bearer guardam sempre o último token: o anterior só é tolerado no navegador (requisições simultâneas).
      if (canal === 'TOKEN' && agora.getTime() - s.rotatedAt.getTime() <= this.o.jwt.toleranciaSegundos * 1000)
        return null;
      if (agora.getTime() - s.rotatedAt.getTime() > this.o.jwt.toleranciaSegundos * 1000) {
        await this.provedor.sessoes.revogar(s.id, 'reuso de refresh token', agora);
        this.cacheSessoes.delete(s.id);
        this.log.warn(`Refresh token antigo reutilizado: sessão ${s.id} revogada.`);
        return null;
      }
    }
    const u = await this.usuarios.porIdComCache(s.userId);
    if (!u || !u.active) return null;

    const expiraEm = new Date(agora.getTime() + this.sessaoSegundos * 1000);
    let novoRefresh: string | null = null;
    const idadeMs = agora.getTime() - s.rotatedAt.getTime();
    if (achado.atual && (canal === 'TOKEN' || idadeMs >= this.o.jwt.rotacaoMinutos * 60_000)) {
      const candidato = tokenOpaco();
      if (await this.provedor.sessoes.rotacionar(s.id, hash, sha256(Buffer.from(candidato, 'utf8')), expiraEm, agora))
        novoRefresh = candidato;
    } else if (achado.atual) {
      await this.provedor.sessoes.renovar(s.id, expiraEm, agora);
    }
    const atualizada: SessaoAutenticacao = { ...s, expiresAt: expiraEm, lastSeenAt: agora };
    this.cacheSessoes.set(s.id, { sessao: atualizada, expira: Date.now() + CACHE_SESSAO_MS });
    return {
      contexto: { usuario: u, sessaoId: s.id, provedor: s.provider, canal: s.channel },
      acesso: await this.emitirAcesso(u, s),
      novoRefresh,
      expiraEm,
    };
  }

  async revogar(sessaoId: string, motivo: string): Promise<void> {
    await this.provedor.sessoes.revogar(sessaoId, motivo, new Date());
    this.cacheSessoes.delete(sessaoId);
  }

  async revogarDoUsuario(userId: string, motivo: string): Promise<void> {
    const n = await this.provedor.sessoes.revogarDoUsuario(userId, motivo, new Date());
    for (const [id, c] of this.cacheSessoes) if (c.sessao.userId === userId.toLowerCase()) this.cacheSessoes.delete(id);
    if (n > 0) this.log.log(`${n} sessão(ões) do usuário ${userId} revogada(s): ${motivo}.`);
  }

  /** Revoga a sessão da requisição (token de acesso no cookie/cabeçalho e/ou refresh token no cookie). */
  async encerrarDaRequisicao(req: Request): Promise<void> {
    const ids = new Set<string>();
    const bearer = tokenBearer(req);
    const acesso = bearer ?? cookie(req, COOKIE_ACESSO);
    if (acesso) {
      const p = await this.validarAcesso(acesso);
      if (p) ids.add(p.sid.toLowerCase());
    }
    const refresh = cookie(req, COOKIE_REFRESH);
    if (refresh) {
      const achado = await this.provedor.sessoes.porHashRefresh(sha256(Buffer.from(refresh, 'utf8')));
      if (achado) ids.add(achado.sessao.id);
    }
    for (const id of ids) await this.revogar(id, 'logout');
  }

  /** Remove sessões vencidas há mais de 7 dias (executado na inicialização e periodicamente). */
  async limparVencidas(): Promise<void> {
    try {
      const n = await this.provedor.sessoes.limpar(new Date(Date.now() - 7 * 24 * 3600 * 1000));
      if (n > 0) this.log.log(`${n} sessão(ões) vencida(s) removida(s).`);
    } catch (e) {
      this.log.warn(`Limpeza de sessões vencidas falhou: ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ cookies do navegador
  private opcoesCookie(req: Request, caminho: string, sameSite: 'lax' | 'strict'): CookieOptions {
    return { httpOnly: true, sameSite, path: caminho, secure: req.secure };
  }

  definirCookies(res: Response, req: Request, acesso: string, refresh: string | null): void {
    res.cookie(COOKIE_ACESSO, acesso, this.opcoesCookie(req, '/', 'lax'));
    if (refresh) res.cookie(COOKIE_REFRESH, refresh, this.opcoesCookie(req, '/api', 'strict'));
  }

  limparCookies(res: Response, req: Request): void {
    res.clearCookie(COOKIE_ACESSO, this.opcoesCookie(req, '/', 'lax'));
    res.clearCookie(COOKIE_REFRESH, this.opcoesCookie(req, '/api', 'strict'));
  }
}

export function tokenBearer(req: Request): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? '');
  return m ? m[1] : null;
}

export function cookie(req: Request, nome: string): string | null {
  const v = (req.cookies as Record<string, unknown> | undefined)?.[nome];
  return typeof v === 'string' && v ? v : null;
}

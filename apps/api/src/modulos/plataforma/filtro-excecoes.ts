// =====================================================================
// Filtro global de exceções: respostas no formato do contrato herdado.
//  - RespostaHttp (401/403/404/400 do contrato) → corpo exato.
//  - Rota inexistente: /api/* → 401 sem sessão, senão 404 "API não encontrada"; demais → 404 "Não encontrado"
//    (com aviso na janela do servidor quando falta um arquivo do frontend).
//  - Outras HttpException (ex.: upload acima do limite) → {"error": mensagem} com o mesmo status.
//  - Erros inesperados → 500 {"error": mensagem}, registrados no log e enviados ao Sentry (se configurado).
// =====================================================================
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import type { Request, Response } from 'express';
import { RespostaHttp, apiNaoEncontrada, enviarJson, naoAutenticado, naoEncontrado } from '../../comum/respostas';
import { pastaFrontend } from '../../configuracao/carregar-configuracao';
import { CONFIGURACAO, type ConfiguracaoMes } from '../../configuracao/opcoes';
import { EstadoInvalidoError } from '../../dominio/erros';
import { AutenticacaoService } from '../autenticacao/autenticacao.service';

/** Mensagem de uma HttpException do Nest/Express (texto ou {message}). */
function mensagemHttp(e: HttpException): string {
  const r = e.getResponse();
  if (typeof r === 'string') return r;
  const m = (r as { message?: unknown }).message;
  if (Array.isArray(m)) return m.map(String).join('; ');
  return typeof m === 'string' ? m : e.message;
}

/** Rota não encontrada pelo roteador (e não um 404 do próprio contrato). */
export function ehRotaInexistente(e: unknown, req: Request): boolean {
  return (
    e instanceof NotFoundException && !(e instanceof RespostaHttp) && !req.route && /^Cannot [A-Z]+ /.test(e.message)
  );
}

@Catch()
export class FiltroExcecoes implements ExceptionFilter {
  private readonly log = new Logger('MesLion');
  private readonly logFrontend = new Logger('MesLion.Frontend');

  constructor(
    @Inject(CONFIGURACAO) private readonly cfg: ConfiguracaoMes,
    private readonly autenticacao: AutenticacaoService,
  ) {}

  @SentryExceptionCaptured()
  catch(e: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    if (res.headersSent) {
      if (!(e instanceof HttpException))
        this.log.error(`Erro após o início da resposta ${req.method} ${req.originalUrl}: ${(e as Error)?.message}`);
      if (!res.writableEnded) res.end();
      return;
    }
    if (e instanceof RespostaHttp) return e.escrever(res);
    if (ehRotaInexistente(e, req)) return void this.rotaInexistente(req, res);
    if (e instanceof EstadoInvalidoError) return enviarJson(res, { error: e.message }, 400);
    if (e instanceof HttpException) return enviarJson(res, { error: mensagemHttp(e) }, e.getStatus());

    const erro = e instanceof Error ? e : new Error(String(e));
    this.log.error(`Erro na requisição ${req.method} ${req.originalUrl}: ${erro.message}`, erro.stack);
    enviarJson(res, { error: erro.message || 'Erro interno' }, 500);
  }

  private async rotaInexistente(req: Request, res: Response): Promise<void> {
    const caminho = req.path;
    try {
      if (caminho === '/api' || caminho.startsWith('/api/')) {
        const ctx = await this.autenticacao.contexto(req, res);
        return (ctx ? apiNaoEncontrada() : naoAutenticado()).escrever(res);
      }
      // Arquivo do frontend ausente (ex.: removido pelo antivírus ou por uma extração incompleta do pacote): avisa no log.
      if (/^\/(js|assets)\//i.test(caminho) || /\.css$/i.test(caminho)) {
        this.logFrontend.warn(
          `Arquivo do frontend não encontrado: ${caminho} (pasta ${pastaFrontend(this.cfg.raizConteudo)}). ` +
            'Se ele faz parte do pacote, extraia o pacote de novo e verifique se o antivírus o removeu.',
        );
      }
      naoEncontrado().escrever(res);
    } catch (e) {
      this.log.error(`Erro ao responder rota inexistente ${req.originalUrl}: ${(e as Error).message}`);
      if (!res.headersSent) enviarJson(res, { error: (e as Error).message }, 500);
    }
  }
}

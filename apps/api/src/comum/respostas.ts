// Respostas HTTP no mesmo formato do servidor PowerShell original (e do servidor .NET).
import { HttpException } from '@nestjs/common';
import type { Response } from 'express';

export const TIPO_JSON = 'application/json; charset=utf-8';
export const TIPO_TEXTO = 'text/plain; charset=utf-8';

/** Resposta pronta (status + corpo exato). Lançada pelos guardas e rotas; escrita pelo filtro global. */
export class RespostaHttp extends HttpException {
  constructor(
    readonly codigo: number,
    readonly corpo: string,
    readonly tipo: string,
  ) {
    super(corpo, codigo);
  }

  /** {"error": mensagem} */
  static erro(status: number, mensagem: string): RespostaHttp {
    return new RespostaHttp(status, JSON.stringify({ error: mensagem }), TIPO_JSON);
  }

  static texto(status: number, texto: string): RespostaHttp {
    return new RespostaHttp(status, texto, TIPO_TEXTO);
  }

  escrever(res: Response): void {
    res.status(this.codigo).setHeader('Content-Type', this.tipo);
    res.end(this.corpo);
  }
}

export const naoAutenticado = () => RespostaHttp.erro(401, 'Não autenticado');
export const somenteAdmin = () => RespostaHttp.erro(403, 'Acesso administrativo necessário');
export const apiNaoEncontrada = () => RespostaHttp.texto(404, 'API não encontrada');
export const naoEncontrado = () => RespostaHttp.texto(404, 'Não encontrado');

export function enviarTexto(res: Response, texto: string, status = 200): void {
  res.status(status).setHeader('Content-Type', TIPO_TEXTO);
  res.end(texto);
}

export function enviarJson(res: Response, valor: unknown, status = 200): void {
  res.status(status).setHeader('Content-Type', TIPO_JSON);
  res.end(JSON.stringify(valor));
}

/** "OK" em texto (resposta do PUT/DELETE de /api/storage). */
export const enviarOk = (res: Response) => enviarTexto(res, 'OK');

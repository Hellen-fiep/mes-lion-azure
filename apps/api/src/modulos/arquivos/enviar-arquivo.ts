import { pipeline } from 'node:stream/promises';
import { Logger } from '@nestjs/common';
import type { Response } from 'express';
import { contentDisposition } from '../../comum/formatos';
import type { ArquivoLido } from '../../infra/arquivos/armazenamento';

const log = new Logger('MesLion.Arquivos');

export interface OpcoesEnvio {
  tipo: string;
  /** Nome para o Content-Disposition (omitido: sem o cabeçalho). */
  nome?: string;
  disposicao?: 'inline' | 'attachment';
  cache?: string;
}

/** Envia o arquivo (stream) com nome UTF-8 correto (RFC 6266), como o servidor .NET. */
export async function enviarArquivo(res: Response, arquivo: ArquivoLido, o: OpcoesEnvio): Promise<void> {
  res.status(200);
  res.setHeader('Content-Type', o.tipo);
  if (o.nome !== undefined) res.setHeader('Content-Disposition', contentDisposition(o.disposicao ?? 'inline', o.nome));
  if (o.cache) res.setHeader('Cache-Control', o.cache);
  if (arquivo.tamanho !== null) res.setHeader('Content-Length', String(arquivo.tamanho));
  try {
    await pipeline(arquivo.conteudo, res);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE')
      log.warn(`Falha ao enviar arquivo: ${(e as Error).message}`);
    if (!res.headersSent) res.status(500).end();
    else res.destroy();
  }
}

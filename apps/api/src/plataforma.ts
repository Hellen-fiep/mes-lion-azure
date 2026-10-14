// Informações da plataforma exibidas na tela de login (/api/auth/config) e em /api/info.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { OpcoesMes } from './configuracao/opcoes';
import { noAzureAppService } from './configuracao/carregar-configuracao';

function lerVersao(): string {
  for (const arquivo of [
    path.resolve(__dirname, '..', 'package.json'),
    path.resolve(__dirname, '..', '..', 'package.json'),
  ]) {
    try {
      const pacote = JSON.parse(readFileSync(arquivo, 'utf8')) as { name?: string; version?: string };
      if (pacote.name === '@mes-lion/api' && pacote.version) return pacote.version;
    } catch {
      // tenta o próximo
    }
  }
  return '1.0.0';
}

function versaoNest(): string {
  try {
    const p = JSON.parse(readFileSync(require.resolve('@nestjs/core/package.json'), 'utf8')) as { version: string };
    return p.version.split('.')[0];
  } catch {
    return '11';
  }
}

export const Plataforma = {
  versao: lerVersao(),
  descricao: `Node.js ${process.versions.node.split('.').slice(0, 2).join('.')} · NestJS ${versaoNest()}`,
  iniciadoEm: new Date(),
  get noAzureAppService(): boolean {
    return noAzureAppService();
  },
};

/** Cabeçalhos do Easy Auth (X-MS-CLIENT-PRINCIPAL*) só são confiáveis no App Service com autenticação ligada. */
export function easyAuthConfiavel(o: OpcoesMes): boolean {
  return (
    o.autenticacao.entraId.confiarCabecalhosForaDoAzure ||
    (noAzureAppService() && (process.env.WEBSITE_AUTH_ENABLED ?? '').toLowerCase() === 'true')
  );
}

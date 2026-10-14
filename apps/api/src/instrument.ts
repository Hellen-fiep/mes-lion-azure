// =====================================================================
// Sentry (monitoramento de erros e desempenho) — importado ANTES de qualquer outro módulo em main.ts,
// como exige o SDK (instrumentação do http/express). Desligado sem DSN: MesLion__Monitoramento__SentryDsn,
// appsettings (MesLion:Monitoramento:SentryDsn) ou a variável padrão SENTRY_DSN.
// Corpos de requisição, cookies e dados de consultas nunca são enviados (senhas no login, tokens, dados de produção).
// =====================================================================
import * as Sentry from '@sentry/nestjs';
import { carregarConfiguracao } from './configuracao/carregar-configuracao';
import { lerLinhaDeComando } from './configuracao/linha-de-comando';
import { Plataforma } from './plataforma';

function iniciarSentry(): boolean {
  let dsn = process.env.SENTRY_DSN ?? '';
  let ambiente = process.env.SENTRY_ENVIRONMENT ?? '';
  let amostragem = 0;
  try {
    const cfg = carregarConfiguracao({ args: lerLinhaDeComando(process.argv.slice(2)).argsConfiguracao });
    const m = cfg.opcoes.monitoramento;
    dsn = m.sentryDsn.trim() || dsn;
    ambiente = m.ambiente.trim() || ambiente;
    amostragem = m.amostragemTraces;
  } catch {
    // configuração inválida: o erro é mostrado pela inicialização em main.ts
  }
  if (!dsn.trim()) return false;
  Sentry.init({
    dsn: dsn.trim(),
    environment: ambiente || (Plataforma.noAzureAppService ? 'azure' : 'local'),
    release: `mes-lion-api@${Plataforma.versao}`,
    tracesSampleRate: Math.min(1, Math.max(0, Number(amostragem) || 0)),
    // Nada de dados pessoais ou de produção: sem corpos, cookies (tokens de sessão), cabeçalhos de identidade,
    // variáveis locais nem dados das consultas ao banco.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      httpHeaders: {
        request: {
          deny: [
            'authorization',
            'cookie',
            'x-ms-client-principal',
            'x-ms-client-principal-id',
            'x-ms-client-principal-name',
            'x-ms-token-aad-access-token',
            'x-ms-token-aad-id-token',
          ],
        },
        response: { deny: ['set-cookie'] },
      },
      databaseQueryData: false,
      stackFrameVariables: false,
    },
  });
  return true;
}

/** true quando o Sentry foi iniciado (o SentryModule só é registrado nesse caso). */
export const sentryAtivo = iniciarSentry();

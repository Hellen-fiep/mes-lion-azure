import { ConsoleLogger } from '@nestjs/common';

/** Contextos internos do Nest que só poluem a janela do servidor (mapeamento de rotas, carga de módulos). */
const SILENCIOSOS = new Set(['InstanceLoader', 'RoutesResolver', 'RouterExplorer', 'NestFactory', 'NestApplication']);

/** Logger do console sem as mensagens de inicialização do Nest (os avisos e erros continuam). */
export class LoggerMes extends ConsoleLogger {
  override log(message: unknown, ...parametros: unknown[]): void {
    const contexto = parametros[parametros.length - 1];
    if (typeof contexto === 'string' && SILENCIOSOS.has(contexto)) return;
    super.log(message, ...parametros);
  }
}

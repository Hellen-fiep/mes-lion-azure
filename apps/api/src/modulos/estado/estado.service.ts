// =====================================================================
// Regras de persistência do estado do MES (porte do Estado/ServicoEstado.cs): o estado montado fica em
// cache por versão; a gravação divide o JSON por coleção e grava só o que mudou.
// =====================================================================
import { EventEmitter } from 'node:events';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { dataIsoSegundos } from '../../comum/formatos';
import { dividir, lerArquivoBanco, montar } from '../../comum/json-estado';
import { Trava } from '../../comum/trava';
import type { ResultadoGravacaoEstado, Usuario } from '../../dominio/entidades';
import { PROVEDOR_PERSISTENCIA, type ProvedorPersistencia } from '../../dominio/repositorios';

/** Estado montado (objeto "data" completo). */
export interface EstadoMontado {
  versao: number;
  json: Buffer;
  colecoes: number;
}

export const vazio = (e: EstadoMontado) => e.colecoes === 0;

@Injectable()
export class EstadoService {
  private readonly log = new Logger('MesLion.Estado');
  private readonly travaCache = new Trava();
  private readonly travaGravacao = new Trava();
  private cache: EstadoMontado | null = null;
  /** Emite 'gravado' (ResultadoGravacaoEstado) após cada gravação — usado pela camada relacional. */
  readonly eventos = new EventEmitter();

  constructor(@Inject(PROVEDOR_PERSISTENCIA) private readonly provedor: ProvedorPersistencia) {}

  async obter(): Promise<EstadoMontado> {
    const versao = await this.provedor.estado.obterVersao();
    if (this.cache && this.cache.versao === versao) return this.cache;
    return this.travaCache.executar(async () => {
      if (this.cache && this.cache.versao === versao) return this.cache;
      const { versao: v, colecoes } = await this.provedor.estado.carregar();
      const ordenadas = [...colecoes].sort(
        (a, b) => a.ordem - b.ordem || (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0),
      );
      const montado = { versao: v, json: montar(ordenadas), colecoes: colecoes.length };
      this.cache = montado;
      return montado;
    });
  }

  /** Grava o estado completo enviado pelo navegador (corpo do PUT). Lança EstadoInvalidoError se o JSON for inválido. */
  gravar(json: Buffer, usuario: Usuario | null): Promise<ResultadoGravacaoEstado> {
    const colecoes = dividir(json);
    return this.travaGravacao.executar(async () => {
      const r = await this.provedor.estado.gravar(colecoes, usuario);
      // O cache é reconstruído a partir do próprio envio (mesmo conteúdo que foi persistido).
      this.cache = { versao: r.versao, json: montar(colecoes), colecoes: colecoes.length };
      try {
        this.eventos.emit('gravado', r);
      } catch (e) {
        this.log.warn(`Falha ao notificar gravação do estado: ${(e as Error).message}`);
      }
      return r;
    });
  }

  invalidarCache(): void {
    this.cache = null;
  }

  /** Exporta no formato de banco do MES (compatível com Dados/MES_LION_DATA.json). */
  async exportar(): Promise<Buffer> {
    const estado = await this.obter();
    const kv = await this.provedor.kv.listar();
    const cabecalho =
      `{"schemaVersion":39,"format":"MES_LION_JSON_DATABASE","updatedAt":${JSON.stringify(dataIsoSegundos(new Date()))},` +
      `"exportedBy":"MES LION Azure (NestJS)","appStorage":${JSON.stringify(kv)},"data":`;
    return Buffer.concat([Buffer.from(cabecalho, 'utf8'), estado.json, Buffer.from('}')]);
  }

  /** Importa um arquivo de banco (formato MES_LION_JSON_DATABASE ou objeto de estado). */
  async importar(
    conteudo: Buffer,
    usuario: Usuario | null,
  ): Promise<{ resultado: ResultadoGravacaoEstado; chavesKv: number; formato: string }> {
    const arquivo = lerArquivoBanco(conteudo);
    const resultado = await this.gravar(arquivo.estado, usuario);
    if (arquivo.appStorage) await this.provedor.kv.substituirTudo(arquivo.appStorage);
    return {
      resultado,
      chavesKv: arquivo.appStorage ? Object.keys(arquivo.appStorage).length : 0,
      formato: arquivo.formato,
    };
  }

  static descreverAlteracoes(r: ResultadoGravacaoEstado): string {
    return JSON.stringify({
      colecoes_alteradas: r.alteradas,
      colecoes_removidas: r.removidas,
      bytes_gravados: r.bytesGravados,
      versao: r.versao,
    });
  }
}

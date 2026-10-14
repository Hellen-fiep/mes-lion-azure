// =====================================================================
// Mantém a camada relacional do SQL Server atualizada em segundo plano após as gravações (porte do
// Relacional/ServicoRelacional.cs): (1) views rel.<coleção> geradas a partir dos campos reais; (2) tabelas
// normalizadas (rel.usp_sincronizar_modelo_relacional). Falhas aqui nunca afetam a gravação do MES.
// =====================================================================
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import sql from 'mssql';
import { comoTexto, dataIsoSegundos } from '../../comum/formatos';
import { dividir } from '../../comum/json-estado';
import { esperarEmSegundoPlano } from '../../comum/trava';
import { CONFIGURACAO, type ConfiguracaoMes } from '../../configuracao/opcoes';
import { PROVEDOR_PERSISTENCIA, type ProvedorPersistencia } from '../../dominio/repositorios';
import { gerarView } from '../../infra/relacional/gerador-views';
import type { ProvedorSqlServer } from '../../infra/persistencia/sqlserver/provedor-sqlserver';
import { EstadoService, type EstadoMontado, vazio } from '../estado/estado.service';

export type StatusRelacional =
  | { ativo: false; mensagem: string }
  | { ativo: true; ultimaExecucao: string | null; versaoEstado: number; sucesso: boolean | null; mensagem: string };

@Injectable()
export class RelacionalService implements OnApplicationShutdown {
  private readonly log = new Logger('MesLion.Relacional');
  private readonly sqlServer: ProvedorSqlServer | null;
  private readonly assinaturas = new Map<string, string>();
  private pendente = true;
  private acordar: (() => void) | null = null;
  private encerrando = false;
  private laco: Promise<void> | null = null;
  private ultimaVersao = 0;
  private ultimaExecucao: Date | null = null;
  private ultimaMensagem = 'Aguardando primeira sincronização.';
  private ultimoSucesso: boolean | null = null;

  constructor(
    @Inject(PROVEDOR_PERSISTENCIA) provedor: ProvedorPersistencia,
    @Inject(CONFIGURACAO) private readonly cfg: ConfiguracaoMes,
    private readonly estado: EstadoService,
  ) {
    this.sqlServer = provedor.nome === 'SqlServer' ? (provedor as ProvedorSqlServer) : null;
    if (this.ativo) this.estado.eventos.on('gravado', () => this.sinalizar());
  }

  private get o() {
    return this.cfg.opcoes.relacional;
  }

  get ativo(): boolean {
    return this.sqlServer !== null && this.o.habilitado;
  }

  /** Inicia o laço em segundo plano (somente no modo servidor; os comandos de linha usam executarAgora). */
  iniciar(): void {
    if (!this.ativo || this.laco) return;
    this.laco = this.executarLaco();
  }

  sinalizar(): void {
    this.pendente = true;
    this.acordar?.();
  }

  status(): StatusRelacional {
    if (!this.ativo) {
      return {
        ativo: false,
        mensagem:
          this.sqlServer === null
            ? 'Não aplicável no modo portátil (somente SQL Server).'
            : 'Desabilitada em MesLion:Relacional:Habilitado.',
      };
    }
    return {
      ativo: true,
      ultimaExecucao: this.ultimaExecucao ? dataIsoSegundos(this.ultimaExecucao) : null,
      versaoEstado: this.ultimaVersao,
      sucesso: this.ultimoSucesso,
      mensagem: this.ultimaMensagem,
    };
  }

  private async executarLaco(): Promise<void> {
    await esperarEmSegundoPlano(3000);
    while (!this.encerrando) {
      if (this.pendente) {
        this.pendente = false;
        try {
          await this.executarAgora();
        } catch (e) {
          this.ultimoSucesso = false;
          this.ultimaMensagem = (e as Error).message;
          this.log.warn(
            `Camada relacional: falha na atualização (o MES continua operando normalmente): ${(e as Error).message}`,
          );
        }
      }
      if (this.encerrando) break;
      // Espera um sinal de gravação e agrupa gravações seguidas.
      await new Promise<void>((r) => {
        this.acordar = r;
        if (this.pendente || this.encerrando) r();
      });
      this.acordar = null;
      if (!this.encerrando) await esperarEmSegundoPlano(Math.max(1, this.o.atrasoSegundos) * 1000);
    }
  }

  /** Executa a atualização imediatamente (também usado pela linha de comando --atualizar-relacional). */
  async executarAgora(): Promise<string> {
    if (!this.sqlServer) return 'Camada relacional disponível somente com SQL Server.';
    const montado = await this.estado.obter();
    const mensagens: string[] = [];
    if (this.o.gerarViewsDinamicas) mensagens.push(await this.gerarViews(montado));
    if (this.o.sincronizarTabelasNormalizadas) {
      const pool = await this.sqlServer.pool();
      const r = await pool
        .request()
        .input('v', sql.BigInt, montado.versao)
        .query<Record<string, unknown>>('EXEC rel.usp_sincronizar_modelo_relacional @versao_estado = @v;');
      const linha = r.recordset?.[0];
      mensagens.push('Tabelas: ' + (linha ? comoTexto(Object.values(linha)[0]) : ''));
    }
    this.ultimaVersao = montado.versao;
    this.ultimaExecucao = new Date();
    this.ultimoSucesso = true;
    this.ultimaMensagem = mensagens.join(' | ');
    this.log.log(`Camada relacional atualizada (versão ${montado.versao}): ${this.ultimaMensagem}`);
    return this.ultimaMensagem;
  }

  private async gerarViews(montado: EstadoMontado): Promise<string> {
    const pool = await this.sqlServer!.pool();
    if (this.assinaturas.size === 0) {
      const r = await pool
        .request()
        .query<{ colecao: string; assinatura: string }>('SELECT colecao, assinatura FROM rel.views_geradas;');
      for (const l of r.recordset ?? []) this.assinaturas.set(l.colecao, l.assinatura.trim());
    }
    const colecoes = vazio(montado) ? [] : dividir(montado.json);
    let criadas = 0;
    let falhas = 0;
    const presentes = new Set<string>();
    for (const col of colecoes) {
      presentes.add(col.nome);
      const def = gerarView(col.nome, col.conteudo);
      if (!def || this.assinaturas.get(col.nome) === def.assinatura) continue;
      try {
        await pool.request().batch(def.sql);
        await pool
          .request()
          .input('c', sql.NVarChar(200), def.colecao)
          .input('v', sql.NVarChar(300), 'rel.' + def.nomeView)
          .input('a', sql.Char(64), def.assinatura)
          .input('n', sql.Int, def.colunas)
          .input('d', sql.NVarChar(sql.MAX), def.sql)
          .query(
            `MERGE rel.views_geradas AS t USING (SELECT @c AS colecao) AS s ON t.colecao = s.colecao
WHEN MATCHED THEN UPDATE SET nome_view = @v, assinatura = @a, colunas = @n, gerada_em = SYSDATETIMEOFFSET(), definicao = @d
WHEN NOT MATCHED THEN INSERT (colecao, nome_view, assinatura, colunas, definicao) VALUES (@c, @v, @a, @n, @d);`,
          );
        this.assinaturas.set(col.nome, def.assinatura);
        criadas++;
      } catch (e) {
        falhas++;
        this.log.warn(`Não foi possível gerar a view rel.${def.nomeView}: ${(e as Error).message}`);
      }
    }
    // Remove as views de coleções que não existem mais.
    for (const antiga of [...this.assinaturas.keys()].filter((k) => !presentes.has(k))) {
      try {
        await pool
          .request()
          .input('c', sql.NVarChar(200), antiga)
          .query(
            `DECLARE @v NVARCHAR(300) = (SELECT nome_view FROM rel.views_geradas WHERE colecao = @c);
IF @v IS NOT NULL AND OBJECT_ID(N'rel.' + QUOTENAME(PARSENAME(@v, 1)), N'V') IS NOT NULL BEGIN DECLARE @s NVARCHAR(400) = N'DROP VIEW rel.' + QUOTENAME(PARSENAME(@v, 1)); EXEC(@s); END;
DELETE FROM rel.views_geradas WHERE colecao = @c;`,
          );
        this.assinaturas.delete(antiga);
      } catch (e) {
        this.log.warn(`Não foi possível remover a view da coleção ${antiga}: ${(e as Error).message}`);
      }
    }
    return `Views: ${criadas} atualizada(s), ${falhas} falha(s), ${this.assinaturas.size} no total`;
  }

  async onApplicationShutdown(): Promise<void> {
    this.encerrando = true;
    this.acordar?.();
    // Não espera uma sincronização longa terminar: a próxima inicialização refaz o que faltar.
    await Promise.race([this.laco ?? Promise.resolve(), esperarEmSegundoPlano(2000)]);
  }
}

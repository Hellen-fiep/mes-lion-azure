// =====================================================================
// Núcleo: configuração, provedor de persistência (SQL Server/Azure SQL via Prisma, ou Portátil) e
// armazenamento de arquivos (pasta local ou Azure Blob) — escolhidos como no servidor .NET
// (Infra/Inicializacao.cs: EscolherProvedor / CriarProvedor / CriarArmazenamento).
// =====================================================================
import { type DynamicModule, Global, Logger, Module } from '@nestjs/common';
import { CONFIGURACAO, type ConfiguracaoMes } from '../configuracao/opcoes';
import { noAzureAppService, obterConnectionString, resolverPastaDados } from '../configuracao/carregar-configuracao';
import { ConfiguracaoError } from '../dominio/erros';
import { PROVEDOR_PERSISTENCIA, type ProvedorPersistencia } from '../dominio/repositorios';
import {
  ARMAZENAMENTO_ARQUIVOS,
  type ArmazenamentoArquivos,
  ArmazenamentoAzureBlob,
  ArmazenamentoLocal,
} from './arquivos/armazenamento';
import { criarProvedorPortatil } from './persistencia/portatil/provedor-portatil';
import { converterConnectionString } from './persistencia/sqlserver/conexao-sql';
import { criarProvedorSqlServer } from './persistencia/sqlserver/provedor-sqlserver';

export interface EscolhaProvedor {
  tipo: 'SqlServer' | 'Portatil';
  connectionString: string | null;
  motivo: string;
}

export function escolherProvedor(cfg: ConfiguracaoMes): EscolhaProvedor {
  const o = cfg.opcoes.banco;
  const cs = obterConnectionString(cfg, o.nomeConexao);
  const modo = (o.provedor || 'Auto').trim().toLowerCase();
  if (['portatil', 'portátil', 'arquivos'].includes(modo))
    return { tipo: 'Portatil', connectionString: null, motivo: 'configurado como Portátil' };
  if (cs.trim())
    return { tipo: 'SqlServer', connectionString: cs, motivo: `connection string ConnectionStrings:${o.nomeConexao}` };
  if (modo === 'sqlserver') {
    throw new ConfiguracaoError(
      `MesLion:Banco:Provedor = SqlServer, mas nenhuma connection string foi informada (ConnectionStrings:${o.nomeConexao}).`,
    );
  }
  return { tipo: 'Portatil', connectionString: null, motivo: 'nenhum SQL Server configurado' };
}

export function criarProvedor(cfg: ConfiguracaoMes, escolha: EscolhaProvedor): ProvedorPersistencia {
  const o = cfg.opcoes.banco;
  if (escolha.tipo === 'SqlServer') {
    const conexao = converterConnectionString(escolha.connectionString!, o.timeoutComandoSegundos);
    return criarProvedorSqlServer(conexao, {
      criarBanco: o.criarBancoSeNaoExistir && !noAzureAppService(),
      aplicarScripts: o.aplicarScriptsAutomaticamente,
      raizConteudo: cfg.raizConteudo,
      timeoutComandoSegundos: o.timeoutComandoSegundos,
    });
  }
  return criarProvedorPortatil(resolverPastaDados(cfg.raizConteudo, o.pastaPortatil, 'BancoPortatil'));
}

export function criarArmazenamento(cfg: ConfiguracaoMes): ArmazenamentoArquivos {
  const a = cfg.opcoes.arquivos;
  if ((a.provedor || '').trim().toLowerCase() === 'azureblob') return new ArmazenamentoAzureBlob(a.azureBlob);
  return new ArmazenamentoLocal(resolverPastaDados(cfg.raizConteudo, a.pastaLocal, 'Arquivos'));
}

@Global()
@Module({})
export class NucleoModule {
  static registrar(cfg: ConfiguracaoMes): DynamicModule {
    const escolha = escolherProvedor(cfg);
    return {
      module: NucleoModule,
      providers: [
        { provide: CONFIGURACAO, useValue: cfg },
        { provide: ESCOLHA_PROVEDOR, useValue: escolha },
        {
          provide: PROVEDOR_PERSISTENCIA,
          useFactory: () => {
            const p = criarProvedor(cfg, escolha);
            new Logger('MesLion').log(`Provedor de dados: ${p.descricao} — ${escolha.motivo}.`);
            return p;
          },
        },
        { provide: ARMAZENAMENTO_ARQUIVOS, useFactory: () => criarArmazenamento(cfg) },
      ],
      exports: [CONFIGURACAO, ESCOLHA_PROVEDOR, PROVEDOR_PERSISTENCIA, ARMAZENAMENTO_ARQUIVOS],
    };
  }
}

export const ESCOLHA_PROVEDOR = Symbol('ESCOLHA_PROVEDOR');

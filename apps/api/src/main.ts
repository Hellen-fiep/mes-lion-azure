// =====================================================================
// MES LION — API NestJS + Prisma (SQL Server / Azure SQL).
// Mesmo contrato HTTP e mesma linha de comando do servidor .NET (MesLion.Server): o frontend atual
// (wwwroot) e os scripts/testes existentes funcionam sem alterações.
// =====================================================================
import { sentryAtivo } from './instrument'; // primeiro: instrumentação do Sentry
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { LoggerMes } from './comum/logger';
import { carregarConfiguracao } from './configuracao/carregar-configuracao';
import { TEXTO_AJUDA, lerLinhaDeComando } from './configuracao/linha-de-comando';
import type { ConfiguracaoMes } from './configuracao/opcoes';
import { PROVEDOR_PERSISTENCIA, type ProvedorPersistencia } from './dominio/repositorios';
import { CAMINHO_SWAGGER, configurarHttp } from './http';
import { ARMAZENAMENTO_ARQUIVOS, type ArmazenamentoArquivos } from './infra/arquivos/armazenamento';
import { ipRedeLocal } from './modulos/arquivos/passaportes.controller';
import { EstadoService } from './modulos/estado/estado.service';
import { ImportadorPostgresqlService } from './modulos/migracao/importador-postgresql.service';
import { InicializacaoService } from './modulos/plataforma/inicializacao.service';
import { RelacionalService } from './modulos/relacional/relacional.service';
import { Plataforma } from './plataforma';

interface Endereco {
  url: string;
  host: string;
  porta: number;
}

/** --urls / ASPNETCORE_URLS / PORT → endereços (http). Padrão local: http://127.0.0.1:8765 (como o INICIAR_MES.bat). */
export function enderecosEscuta(cfg: ConfiguracaoMes): Endereco[] {
  const urls = cfg.urls.length
    ? cfg.urls
    : [Plataforma.noAzureAppService ? 'http://0.0.0.0:8080' : 'http://127.0.0.1:8765'];
  return urls.map((original) => {
    const normalizada = original.replace(/^(\w+:\/\/)(\*|\+)(?=[:/]|$)/, '$10.0.0.0');
    const u = new URL(normalizada);
    if (u.protocol !== 'http:') {
      throw new Error(
        `Endereço ${original}: somente http é suportado (no Azure o HTTPS termina no App Service; localmente use http).`,
      );
    }
    let host = u.hostname.replace(/^\[|\]$/g, '');
    if (host.toLowerCase() === 'localhost') host = '127.0.0.1';
    return { url: original, host, porta: Number(u.port || 80) };
  });
}

async function escutar(app: NestExpressApplication, enderecos: Endereco[]): Promise<http.Server[]> {
  const [primeiro, ...extras] = enderecos;
  await app.listen(primeiro.porta, primeiro.host);
  const servidores: http.Server[] = [app.getHttpServer()];
  for (const e of extras) {
    const s = http.createServer(app.getHttpAdapter().getInstance());
    await new Promise<void>((ok, falha) => {
      s.once('error', falha);
      s.listen(e.porta, e.host, () => ok());
    });
    servidores.push(s);
  }
  return servidores;
}

function banner(cfg: ConfiguracaoMes, app: NestExpressApplication, enderecos: Endereco[]): void {
  const provedor = app.get<ProvedorPersistencia>(PROVEDOR_PERSISTENCIA);
  const armazenamento = app.get<ArmazenamentoArquivos>(ARMAZENAMENTO_ARQUIVOS);
  const linhas = [
    '',
    '================================================================',
    ` MES LION ${Plataforma.versao} — ${Plataforma.descricao}`,
    ` Banco: ${provedor.descricao}`,
    ` Arquivos: ${armazenamento.descricao}`,
  ];
  for (const e of enderecos) {
    linhas.push(` Escutando em: ${e.url}`);
    if (['0.0.0.0', '::'].includes(e.host))
      linhas.push(` MODO REDE: outros computadores acessam http://${ipRedeLocal() ?? 'IP-DESTE-PC'}:${e.porta}`);
  }
  if (cfg.opcoes.api.swagger)
    linhas.push(
      ` Documentação da API (Swagger): http://${enderecos[0].host === '0.0.0.0' ? 'localhost' : enderecos[0].host}:${enderecos[0].porta}/${CAMINHO_SWAGGER}`,
    );
  linhas.push(
    ' Usuário inicial: admin  |  Senha inicial: meslion2026',
    ' Mantenha esta janela aberta. Ctrl+C encerra.',
    '================================================================',
  );
  console.log(linhas.join('\n'));
  if (cfg.opcoes.servidor.abrirNavegador && process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', `http://localhost:${enderecos[0].porta}`], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  }
}

async function principal(): Promise<number> {
  const cli = lerLinhaDeComando(process.argv.slice(2));
  if (cli.ajuda) {
    console.log(TEXTO_AJUDA);
    return 0;
  }
  if (cli.configurar) {
    console.error(
      'O assistente de banco (--configurar) está no servidor .NET (CONFIGURAR_BANCO.bat). Na API NestJS, informe',
    );
    console.error(
      'ConnectionStrings__MesLion e MesLion__Banco__Provedor (variáveis de ambiente) ou edite appsettings.Local.json.',
    );
    return 1;
  }
  const log = new Logger('MesLion');
  const cfg = carregarConfiguracao({ args: cli.argsConfiguracao });
  if (cli.abrirNavegador) cfg.opcoes.servidor.abrirNavegador = true;
  for (const a of cfg.arquivosLidos) log.log(`Configuração: ${a}`);

  const app = await NestFactory.create<NestExpressApplication>(AppModule.registrar(cfg, { sentry: sentryAtivo }), {
    bodyParser: false,
    logger: new LoggerMes(),
    abortOnError: false,
  });
  app.enableShutdownHooks();

  try {
    await app.get(InicializacaoService).executar();
  } catch (e) {
    const provedor = app.get<ProvedorPersistencia>(PROVEDOR_PERSISTENCIA);
    log.fatal(
      `Falha ao preparar o banco de dados (${provedor.descricao}): ${(e as Error).message}`,
      (e as Error).stack,
    );
    console.error('\nERRO: não foi possível preparar o banco de dados: ' + (e as Error).message);
    console.error('Verifique a connection string (ConnectionStrings__MesLion) ou use o modo Portátil.');
    await app.close().catch(() => undefined);
    return 3;
  }

  // ------------------------------------------------------------ comandos de manutenção (linha de comando)
  const comando = async (acao: () => Promise<number>): Promise<number> => {
    try {
      return await acao();
    } finally {
      await app.close().catch(() => undefined);
    }
  };
  if (cli.importarMigracao !== null) {
    const pasta = cli.importarMigracao;
    return comando(async () => {
      try {
        const relatorio = await app.get(ImportadorPostgresqlService).importar(pasta, cli.sobrescrever);
        console.log('\n' + relatorio);
        const rel = app.get(RelacionalService);
        if (rel.ativo) console.log(await rel.executarAgora());
        return 0;
      } catch (e) {
        console.error('ERRO na importação: ' + (e as Error).message);
        return 4;
      }
    });
  }
  if (cli.testarConexao) {
    return comando(async () => {
      const provedor = app.get<ProvedorPersistencia>(PROVEDOR_PERSISTENCIA);
      const r = await provedor.estado.resumo();
      console.log(
        `OK — ${provedor.descricao}. Estado: versão ${r.versao}, ${r.colecoes} coleções, ${r.bytes.toLocaleString('pt-BR')} bytes.`,
      );
      return 0;
    });
  }
  if (cli.atualizarRelacional) {
    return comando(async () => {
      const rel = app.get(RelacionalService);
      console.log(rel.ativo ? await rel.executarAgora() : 'Camada relacional disponível somente com SQL Server.');
      return 0;
    });
  }
  if (cli.exportar !== null) {
    const destino = cli.exportar;
    return comando(async () => {
      const bytes = await app.get(EstadoService).exportar();
      await fs.writeFile(destino, bytes);
      console.log(`Banco exportado para ${path.resolve(destino)} (${bytes.length.toLocaleString('pt-BR')} bytes).`);
      return 0;
    });
  }

  // ------------------------------------------------------------ servidor HTTP
  configurarHttp(app, cfg);
  const enderecos = enderecosEscuta(cfg);
  try {
    await escutar(app, enderecos);
  } catch (e) {
    const codigo = (e as NodeJS.ErrnoException).code;
    console.error(
      '\nERRO: não foi possível abrir a porta do MES' +
        (codigo === 'EADDRINUSE' ? ' (provavelmente já está em uso).' : '.'),
    );
    console.error('Feche qualquer versão anterior do MES (inclusive a versão PowerShell ou .NET) e tente novamente.');
    console.error((e as Error).message);
    await app.close().catch(() => undefined);
    return 2;
  }
  app.get(RelacionalService).iniciar();
  banner(cfg, app, enderecos);
  return -1; // servidor em execução
}

process.on('unhandledRejection', (motivo) =>
  new Logger('MesLion').error(`Promessa rejeitada sem tratamento: ${String((motivo as Error)?.stack ?? motivo)}`),
);

principal().then(
  (codigo) => {
    if (codigo >= 0) process.exit(codigo);
  },
  (e) => {
    console.error('ERRO: ' + ((e as Error)?.stack ?? String(e)));
    process.exit(1);
  },
);

// Configuração com as mesmas fontes e prioridades do ASP.NET Core (appsettings < Local < ambiente < linha de comando).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfiguracaoError } from '../dominio/erros';
import { carregarConfiguracao, obterConnectionString, resolverCaminho } from './carregar-configuracao';
import { lerLinhaDeComando } from './linha-de-comando';

describe('carregarConfiguracao', () => {
  let raiz: string;
  beforeEach(() => {
    raiz = mkdtempSync(path.join(tmpdir(), 'mes-cfg-'));
  });
  afterEach(() => rmSync(raiz, { recursive: true, force: true }));

  it('sem arquivos: os padrões do servidor .NET', () => {
    const c = carregarConfiguracao({ raizConteudo: raiz, ambiente: {} });
    expect(c.opcoes.banco.provedor).toBe('Auto');
    expect(c.opcoes.banco.pastaPortatil).toBe('../Dados/BancoPortatil');
    expect(c.opcoes.autenticacao.sessaoHoras).toBe(12);
    expect(c.opcoes.autenticacao.jwt.acessoMinutos).toBe(15);
    expect(c.opcoes.servidor.limiteRequisicaoMB).toBe(512);
    expect(c.opcoes.api.swagger).toBe(true);
    expect(c.urls).toEqual([]);
    expect(c.arquivosLidos).toEqual([]);
  });

  it('appsettings.json < appsettings.Local.json < ambiente < linha de comando (sem diferenciar maiúsculas)', () => {
    writeFileSync(
      path.join(raiz, 'appsettings.json'),
      `{
        // comentários e vírgulas sobrando são aceitos, como no ASP.NET
        "ConnectionStrings": { "MesLion": "Server=a;Database=b" },
        "MesLion": { "Banco": { "Provedor": "SqlServer", "TimeoutComandoSegundos": 60, }, "Api": { "Swagger": true } },
      }`,
    );
    writeFileSync(
      path.join(raiz, 'appsettings.Local.json'),
      '﻿{"meslion":{"banco":{"timeoutcomandosegundos":"90"},"Servidor":{"LimiteRequisicaoMB":64}}}',
    );
    const c = carregarConfiguracao({
      raizConteudo: raiz,
      ambiente: { MesLion__Servidor__LimiteRequisicaoMB: '128', MESLION__API__SWAGGER: 'false' },
      args: ['--MesLion:Servidor:LimiteRequisicaoMB=256', '--urls', 'http://127.0.0.1:8799'],
    });
    expect(c.arquivosLidos).toHaveLength(2);
    expect(c.opcoes.banco.provedor).toBe('SqlServer');
    expect(c.opcoes.banco.timeoutComandoSegundos).toBe(90);
    expect(c.opcoes.servidor.limiteRequisicaoMB).toBe(256);
    expect(c.opcoes.api.swagger).toBe(false);
    expect(obterConnectionString(c, 'MesLion')).toBe('Server=a;Database=b');
    expect(c.urls).toEqual(['http://127.0.0.1:8799']);
  });

  it('connection strings do Azure App Service (SQLAZURECONNSTR_*) e porta do App Service (PORT)', () => {
    const c = carregarConfiguracao({
      raizConteudo: raiz,
      ambiente: { SQLAZURECONNSTR_MesLion: 'Server=tcp:x.database.windows.net;Database=d', PORT: '8080' },
    });
    expect(obterConnectionString(c, 'meslion')).toBe('Server=tcp:x.database.windows.net;Database=d');
    expect(c.urls).toEqual(['http://0.0.0.0:8080']);
  });

  it('ASPNETCORE_URLS tem prioridade sobre PORT; várias URLs separadas por ";"', () => {
    const c = carregarConfiguracao({
      raizConteudo: raiz,
      ambiente: { ASPNETCORE_URLS: 'http://127.0.0.1:1;http://0.0.0.0:2', PORT: '3' },
    });
    expect(c.urls).toEqual(['http://127.0.0.1:1', 'http://0.0.0.0:2']);
  });

  it('valores inválidos geram erro de configuração com o nome da chave', () => {
    expect(() => carregarConfiguracao({ raizConteudo: raiz, ambiente: { MesLion__Api__Swagger: 'talvez' } })).toThrow(
      /MesLion:Api:Swagger/,
    );
    expect(() =>
      carregarConfiguracao({ raizConteudo: raiz, ambiente: { MesLion__Servidor__LimiteRequisicaoMB: 'muito' } }),
    ).toThrow(ConfiguracaoError);
    writeFileSync(path.join(raiz, 'appsettings.json'), '{ "MesLion": ');
    expect(() => carregarConfiguracao({ raizConteudo: raiz, ambiente: {} })).toThrow(/appsettings\.json/);
  });

  it('caminhos relativos partem da pasta de conteúdo; %VARIAVEL% é expandida', () => {
    expect(resolverCaminho(raiz, '../Dados/x.json')).toBe(path.resolve(raiz, '..', 'Dados', 'x.json'));
    process.env.MES_TESTE_PASTA = raiz;
    expect(resolverCaminho('/outra', '%MES_TESTE_PASTA%/y')).toBe(path.join(raiz, 'y'));
    delete process.env.MES_TESTE_PASTA;
  });
});

describe('linha de comando (mesmos argumentos do executável .NET)', () => {
  it('comandos de manutenção e argumentos de configuração', () => {
    const c = lerLinhaDeComando(['--importar-migracao', '/pacote', '--SOBRESCREVER', '--urls', 'http://x:1']);
    expect(c.importarMigracao).toBe('/pacote');
    expect(c.sobrescrever).toBe(true);
    expect(c.argsConfiguracao).toEqual(['--urls', 'http://x:1']);
    expect(lerLinhaDeComando(['--exportar', 'a.json']).exportar).toBe('a.json');
    expect(lerLinhaDeComando(['/?']).ajuda).toBe(true);
    expect(lerLinhaDeComando(['--testar-conexao', '--atualizar-relacional'])).toMatchObject({
      testarConexao: true,
      atualizarRelacional: true,
    });
  });
});

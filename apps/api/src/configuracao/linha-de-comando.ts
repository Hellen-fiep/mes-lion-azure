// Argumentos próprios do MES (os demais são configuração, ex.: --urls http://127.0.0.1:8765),
// iguais aos do executável .NET (MesLion.Server), para os mesmos scripts e testes funcionarem.

export interface LinhaDeComando {
  argsConfiguracao: string[];
  abrirNavegador: boolean;
  configurar: boolean;
  testarConexao: boolean;
  atualizarRelacional: boolean;
  importarMigracao: string | null;
  sobrescrever: boolean;
  exportar: string | null;
  ajuda: boolean;
}

export function lerLinhaDeComando(args: string[]): LinhaDeComando {
  const r: LinhaDeComando = {
    argsConfiguracao: [],
    abrirNavegador: false,
    configurar: false,
    testarConexao: false,
    atualizarRelacional: false,
    importarMigracao: null,
    sobrescrever: false,
    exportar: null,
    ajuda: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i].toLowerCase();
    switch (a) {
      case '--abrir-navegador':
        r.abrirNavegador = true;
        break;
      case '--configurar':
        r.configurar = true;
        break;
      case '--testar-conexao':
        r.testarConexao = true;
        break;
      case '--atualizar-relacional':
        r.atualizarRelacional = true;
        break;
      case '--sobrescrever':
        r.sobrescrever = true;
        break;
      case '--ajuda':
      case '-h':
      case '--help':
      case '/?':
        r.ajuda = true;
        break;
      case '--importar-migracao':
      case '--exportar':
        if (i + 1 < args.length) {
          if (a === '--importar-migracao') r.importarMigracao = args[++i];
          else r.exportar = args[++i];
          break;
        }
        r.argsConfiguracao.push(args[i]);
        break;
      default:
        r.argsConfiguracao.push(args[i]);
    }
  }
  return r;
}

export const TEXTO_AJUDA = `MES LION — API NestJS (mesmo contrato HTTP do servidor .NET)

  MesLion.Server [--urls http://127.0.0.1:8765] [--abrir-navegador]
  MesLion.Server --testar-conexao                Testa o banco configurado
  MesLion.Server --importar-migracao <pasta> [--sobrescrever]
                                                 Importa o pacote exportado do PostgreSQL
  MesLion.Server --atualizar-relacional          Atualiza views/tabelas relacionais (SQL Server)
  MesLion.Server --exportar <arquivo.json>       Exporta o banco no formato MES_LION_JSON_DATABASE

  Configuração: appsettings.json, appsettings.Local.json, variáveis de ambiente
  (MesLion__Banco__Provedor, ConnectionStrings__MesLion…) ou --MesLion:Secao:Chave=valor.
`;

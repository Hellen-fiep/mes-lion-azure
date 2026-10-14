// Connection strings ADO.NET (as mesmas do servidor .NET / CONFIGURAR_BANCO.bat) → configuração do driver mssql.
import { ConfiguracaoError } from '../../../dominio/erros';
import {
  converterConnectionString,
  dividirConnectionString,
  ehErroTransitorio,
  ehViolacaoUnicidade,
  numeroErroSql,
} from './conexao-sql';

describe('converterConnectionString', () => {
  it('SQL Server com usuário/senha (CI e SQL Server da empresa)', () => {
    const c = converterConnectionString(
      'Server=localhost,1433;Database=MesLionCI;User ID=sa;Password=MesLion#Teste2026;Encrypt=true;TrustServerCertificate=true',
      300,
    );
    expect(c.config.server).toBe('localhost');
    expect(c.config.port).toBe(1433);
    expect(c.config.database).toBe('MesLionCI');
    expect(c.config.authentication).toEqual({
      type: 'default',
      options: { userName: 'sa', password: 'MesLion#Teste2026' },
    });
    expect(c.config.options?.encrypt).toBe(true);
    expect(c.config.options?.trustServerCertificate).toBe(true);
    expect(c.config.requestTimeout).toBe(300_000);
    expect(c.azureSql).toBe(false);
    expect(c.servidor).toBe('localhost,1433');
  });

  it('sinônimos, instância nomeada e valores entre aspas', () => {
    const c = converterConnectionString(
      "Data Source=SERVIDOR\\SQLEXPRESS;Initial Catalog=MesLion;UID=meslion;PWD='se;nh''a';Connect Timeout=15;Application Name=Teste",
      30,
    );
    expect(c.config.server).toBe('SERVIDOR');
    expect(c.config.options?.instanceName).toBe('SQLEXPRESS');
    expect(c.config.port).toBeUndefined();
    expect(c.config.authentication?.options).toEqual({ userName: 'meslion', password: "se;nh'a" });
    expect(c.config.connectionTimeout).toBe(15_000);
    expect(c.config.options?.appName).toBe('Teste');
    expect(converterConnectionString('Server=.;Database=x;User ID=a;Password=b', 30).config.server).toBe('localhost');
  });

  it('Azure SQL com Microsoft Entra ID (padrão / identidade gerenciada)', () => {
    const base =
      'Server=tcp:meuservidor.database.windows.net,1433;Database=meslion;Encrypt=true;TrustServerCertificate=false';
    const padrao = converterConnectionString(base + ';Authentication=Active Directory Default', 300);
    expect(padrao.azureSql).toBe(true);
    expect(padrao.config.server).toBe('meuservidor.database.windows.net');
    expect(padrao.config.authentication?.type).toBe('azure-active-directory-default');

    const mi = converterConnectionString(base + ';Authentication=Active Directory Managed Identity;User ID=cid', 300, {
      IDENTITY_ENDPOINT: 'http://localhost:42356/msi/token',
    });
    expect(mi.config.authentication).toEqual({
      type: 'azure-active-directory-msi-app-service',
      options: { clientId: 'cid' },
    });
    expect(
      converterConnectionString(base + ';Authentication=Active Directory MSI', 300, {}).config.authentication?.type,
    ).toBe('azure-active-directory-msi-vm');
  });

  it('modos interativos do .NET viram "Active Directory Default" com aviso', () => {
    const c = converterConnectionString(
      'Server=tcp:x.database.windows.net,1433;Database=d;Authentication=Active Directory Interactive',
      300,
    );
    expect(c.config.authentication?.type).toBe('azure-active-directory-default');
    expect(c.avisos[0]).toMatch(/não é suportado pelo driver do Node\.js/);
  });

  it('service principal exige client id, segredo e tenant', () => {
    const cs =
      'Server=x.database.windows.net;Database=d;Authentication=Active Directory Service Principal;User ID=app;Password=s';
    expect(() => converterConnectionString(cs, 30, {})).toThrow(ConfiguracaoError);
    expect(converterConnectionString(cs, 30, { AZURE_TENANT_ID: 't' }).config.authentication).toEqual({
      type: 'azure-active-directory-service-principal-secret',
      options: { clientId: 'app', clientSecret: 's', tenantId: 't' },
    });
  });

  it('LocalDB e autenticação integrada do Windows: erro claro (driver do Node não suporta)', () => {
    expect(() =>
      converterConnectionString('Server=(localdb)\\MSSQLLocalDB;Database=MesLion;Integrated Security=true', 30),
    ).toThrow(/LocalDB/);
    expect(() => converterConnectionString('Server=SRV;Database=MesLion;Integrated Security=SSPI', 30)).toThrow(
      /Integrated Security/,
    );
    expect(() => converterConnectionString('Database=MesLion', 30)).toThrow(/sem o servidor/);
    expect(() => converterConnectionString('Server=SRV,abc;Database=x', 30)).toThrow(/Porta inválida/);
  });

  it('aceita a URL no formato do Prisma (sqlserver://)', () => {
    const c = converterConnectionString(
      'sqlserver://localhost:1433;database=MesLion;user=sa;password=abc;trustServerCertificate=true',
      30,
    );
    expect(c.config.server).toBe('localhost');
    expect(c.config.port).toBe(1433);
    expect(c.config.database).toBe('MesLion');
    expect(c.config.options?.trustServerCertificate).toBe(true);
  });

  it('dividirConnectionString: chaves sem diferença de maiúsculas, espaços e chaves {...}', () => {
    const m = dividirConnectionString(' Server = a ; PASSWORD={x;y}}z} ;;');
    expect(m.get('server')).toBe('a');
    expect(m.get('password')).toBe('x;y}z');
  });
});

describe('erros do SQL Server', () => {
  it('número do erro direto do driver, embrulhado pelo Prisma ou na mensagem', () => {
    expect(numeroErroSql({ number: 2627 })).toBe(2627);
    expect(numeroErroSql({ message: 'x', cause: { originalError: { number: 40613 } } })).toBe(40613);
    expect(numeroErroSql({ meta: { driverAdapterError: { cause: { code: '1205' } } } })).toBe(1205);
    expect(numeroErroSql(new Error('nada'))).toBeNull();
  });

  it('transitórios (Azure SQL) e violação de unicidade', () => {
    expect(ehErroTransitorio({ number: 40613 })).toBe(true);
    expect(ehErroTransitorio({ code: 'ESOCKET' })).toBe(true);
    expect(ehErroTransitorio({ number: 2627 })).toBe(false);
    expect(ehViolacaoUnicidade({ code: 'P2002' })).toBe(true);
    expect(ehViolacaoUnicidade({ number: 2601 })).toBe(true);
    expect(ehViolacaoUnicidade({ number: 547 })).toBe(false);
  });
});

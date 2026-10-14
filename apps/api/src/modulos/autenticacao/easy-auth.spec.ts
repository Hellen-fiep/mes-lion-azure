// Microsoft Entra ID pelo Easy Auth do Azure App Service (cabeçalhos X-MS-CLIENT-PRINCIPAL*).
import { lerPrincipalEasyAuth } from './easy-auth';

const principal = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');

describe('lerPrincipalEasyAuth', () => {
  it('cabeçalhos simples + claims do X-MS-CLIENT-PRINCIPAL (nome completo e papéis)', () => {
    const p = lerPrincipalEasyAuth({
      'x-ms-client-principal-id': ' 7f3c... ',
      'x-ms-client-principal-name': 'ana@empresa.com.br',
      'x-ms-client-principal': principal({
        auth_typ: 'aad',
        role_typ: 'roles',
        claims: [
          { typ: 'name', val: 'Ana Souza' },
          { typ: 'roles', val: 'MES.Admin' },
          { typ: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role', val: 'Outro' },
        ],
      }),
    });
    expect(p).toEqual({
      id: '7f3c...',
      nome: 'ana@empresa.com.br',
      nomeCompleto: 'Ana Souza',
      papeis: ['MES.Admin', 'Outro'],
      provedorIdentidade: 'aad',
    });
  });

  it('id (oid) e login (preferred_username) só pelas claims', () => {
    const p = lerPrincipalEasyAuth({
      'x-ms-client-principal': principal({
        claims: [
          { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: 'oid-1' },
          { typ: 'preferred_username', val: 'joao@empresa.com.br' },
        ],
      }),
    });
    expect(p).toMatchObject({ id: 'oid-1', nome: 'joao@empresa.com.br', nomeCompleto: null, papeis: [] });
  });

  it('sem id ou sem login, ou cabeçalho malformado: null', () => {
    expect(lerPrincipalEasyAuth({})).toBeNull();
    expect(lerPrincipalEasyAuth({ 'x-ms-client-principal-id': 'x' })).toBeNull();
    expect(lerPrincipalEasyAuth({ 'x-ms-client-principal': '%%%não-é-base64' })).toBeNull();
  });
});

// Usuário autenticado pelo Azure App Service Authentication (Easy Auth / Microsoft Entra ID):
// cabeçalhos X-MS-CLIENT-PRINCIPAL* injetados pela plataforma (porte do PrincipalEasyAuth do .NET).
import type { IncomingHttpHeaders } from 'node:http';

export interface PrincipalEasyAuth {
  id: string;
  nome: string;
  nomeCompleto: string | null;
  papeis: string[];
  provedorIdentidade: string;
}

const CLAIM_ROLE = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role';
const CLAIM_OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const CLAIM_EMAIL = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress';
const CLAIM_UPN = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn';

const cabecalho = (h: IncomingHttpHeaders, nome: string): string => {
  const v = h[nome.toLowerCase()];
  return (Array.isArray(v) ? v.join(',') : (v ?? '')).trim();
};

export function lerPrincipalEasyAuth(h: IncomingHttpHeaders): PrincipalEasyAuth | null {
  let id = cabecalho(h, 'X-MS-CLIENT-PRINCIPAL-ID');
  let nome = cabecalho(h, 'X-MS-CLIENT-PRINCIPAL-NAME');
  let idp = cabecalho(h, 'X-MS-CLIENT-PRINCIPAL-IDP');
  const principal = cabecalho(h, 'X-MS-CLIENT-PRINCIPAL');
  let nomeCompleto: string | null = null;
  const papeis: string[] = [];

  if (principal) {
    try {
      const raiz = JSON.parse(Buffer.from(principal, 'base64').toString('utf8')) as {
        role_typ?: string;
        auth_typ?: string;
        claims?: { typ?: string; val?: string }[];
      };
      const tipoPapel = raiz.role_typ || 'roles';
      if (raiz.auth_typ && !idp) idp = raiz.auth_typ;
      for (const c of Array.isArray(raiz.claims) ? raiz.claims : []) {
        const typ = c.typ ?? '';
        const val = c.val ?? '';
        if (typ === tipoPapel || typ === 'roles' || typ === CLAIM_ROLE) papeis.push(val);
        else if (typ === 'name') nomeCompleto = val;
        else if (!id && (typ === CLAIM_OID || typ === 'oid')) id = val;
        else if (!nome && (typ === 'preferred_username' || typ === CLAIM_EMAIL || typ === CLAIM_UPN)) nome = val;
      }
    } catch {
      // cabeçalho malformado: usa só os cabeçalhos simples
    }
  }
  if (!id.trim() || !nome.trim()) return null;
  return { id: id.trim(), nome: nome.trim(), nomeCompleto, papeis, provedorIdentidade: idp || 'aad' };
}

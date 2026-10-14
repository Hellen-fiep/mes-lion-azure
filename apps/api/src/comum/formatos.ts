// =====================================================================
// Formatos do contrato HTTP herdado (servidor PowerShell → .NET → NestJS): datas, nomes de arquivo,
// codificação de URL e leitura tolerante de corpos JSON.
// =====================================================================

const dois = (n: number) => String(n).padStart(2, '0');

/** Data ISO 8601 no fuso local com milissegundos e deslocamento ("2026-10-13T09:15:02.123-03:00"),
 * como o row_to_json do PostgreSQL e o Data() do servidor .NET. */
export function dataIso(d: Date): string {
  const desloc = -d.getTimezoneOffset();
  const sinal = desloc >= 0 ? '+' : '-';
  const a = Math.abs(desloc);
  return (
    `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}:` +
    `${dois(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}${sinal}${dois(Math.floor(a / 60))}:${dois(a % 60)}`
  );
}

/** Data ISO sem milissegundos ("2026-10-13T09:15:02-03:00"), usada no updatedAt da exportação. */
export function dataIsoSegundos(d: Date): string {
  return dataIso(d).replace(/\.\d{3}(?=[+-])/, '');
}

/** Carimbo "yyyyMMdd_HHmmss" (hora local) para nomes de arquivo. */
export function carimbo(d: Date, comMilissegundos = false): string {
  const base = `${d.getFullYear()}${dois(d.getMonth() + 1)}${dois(d.getDate())}_${dois(d.getHours())}${dois(d.getMinutes())}${dois(d.getSeconds())}`;
  return comMilissegundos ? `${base}_${String(d.getMilliseconds()).padStart(3, '0')}` : base;
}

/** Equivalente ao Uri.EscapeDataString do .NET (RFC 3986: só A-Z a-z 0-9 - _ . ~ ficam sem codificação). */
export function escaparDados(texto: string): string {
  return encodeURIComponent(texto).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Equivalente ao Uri.UnescapeDataString: decodifica %XX (UTF-8) uma única vez; sequências inválidas ficam como estão. */
export function decodificarUmaVez(texto: string): string {
  try {
    return decodeURIComponent(texto);
  } catch {
    return texto.replace(/(?:%[0-9A-Fa-f]{2})+/g, (trecho) => {
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(trecho.replace(/%/g, ''), 'hex'));
      } catch {
        return trecho;
      }
    });
  }
}

/**
 * Trecho do caminho ORIGINAL da requisição (ainda codificado) após o prefixo, decodificado uma única vez —
 * mesmo comportamento do [uri]::UnescapeDataString do servidor PowerShell (inclusive para %2F).
 */
export function trechoCaminho(urlOriginal: string, prefixo: string, sufixo?: string): string | null {
  let bruto = urlOriginal;
  const q = bruto.indexOf('?');
  if (q >= 0) bruto = bruto.slice(0, q);
  if (!bruto.startsWith(prefixo)) return null;
  let resto = bruto.slice(prefixo.length);
  if (sufixo !== undefined) {
    if (!resto.endsWith(sufixo)) return null;
    resto = resto.slice(0, resto.length - sufixo.length);
  }
  if (resto.length === 0) return null;
  return decodificarUmaVez(resto);
}

// ------------------------------------------------------------------ Content-Disposition (RFC 6266 / 5987)
const CARACTERES_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const CARACTERES_ATTR = /[A-Za-z0-9!#$&+\-.^_`|~]/;

function codificar5987(texto: string): string {
  let r = '';
  for (const ch of texto) {
    if (ch.length === 1 && CARACTERES_ATTR.test(ch)) r += ch;
    else for (const b of Buffer.from(ch, 'utf8')) r += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return r;
}

/**
 * Content-Disposition no formato do ASP.NET Core (ContentDispositionHeaderValue.SetHttpFileName):
 * nome ASCII de reserva (não ASCII → "_") e filename* em UTF-8.
 * Ex.: inline; filename="Instru__o.pdf"; filename*=UTF-8''Instru%C3%A7%C3%A3o.pdf
 */
export function contentDisposition(tipo: 'inline' | 'attachment', nome: string): string {
  const ascii = Array.from(nome, (ch) => (ch.codePointAt(0)! > 0x7f ? '_'.repeat(ch.length) : ch)).join('');
  const reserva = CARACTERES_TOKEN.test(ascii) ? ascii : `"${ascii.replace(/["\\]/g, (c) => '\\' + c)}"`;
  return `${tipo}; filename=${reserva}; filename*=UTF-8''${codificar5987(nome)}`;
}

// ------------------------------------------------------------------ corpo JSON tolerante (LerJson/Str/Verdadeiro)
/** Lê um corpo como texto UTF-8, detectando BOM (UTF-8/UTF-16), como o StreamReader do .NET. */
export function corpoComoTexto(corpo: Buffer | undefined | null): string {
  if (!corpo || corpo.length === 0) return '';
  if (corpo.length >= 3 && corpo[0] === 0xef && corpo[1] === 0xbb && corpo[2] === 0xbf)
    return corpo.toString('utf8', 3);
  if (corpo.length >= 2 && corpo[0] === 0xff && corpo[1] === 0xfe) return corpo.toString('utf16le', 2);
  if (corpo.length >= 2 && corpo[0] === 0xfe && corpo[1] === 0xff) {
    const invertido = Buffer.from(corpo.subarray(2));
    invertido.swap16();
    return invertido.toString('utf16le');
  }
  return corpo.toString('utf8');
}

/** JSON do corpo, ou null se vazio/inválido (as rotas herdadas nunca respondem erro de sintaxe). */
export function lerJson(texto: string): unknown {
  if (!texto || !texto.trim()) return null;
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return null;
  }
}

/** Valor qualquer → texto: string como está; null/undefined → ""; número/lógico → texto; objeto/lista → JSON. */
export function comoTexto(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return JSON.stringify(v) ?? '';
}

export function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Propriedade como texto: string → ela mesma; null/ausente → null; outros tipos → o JSON do valor. */
export function textoDe(obj: unknown, nome: string): string | null {
  if (!ehObjeto(obj) || !(nome in obj)) return null;
  const v = obj[nome];
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** Equivalente ao teste "if($b.active)" do PowerShell (valor verdadeiro). */
export function verdadeiroDe(obj: unknown, nome: string): boolean {
  if (!ehObjeto(obj) || !(nome in obj)) return false;
  const v = obj[nome];
  if (v === true) return true;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'object' && v !== null) return true;
  return false;
}

/** Corta o texto em n caracteres (UTF-16), como s[..n] do C#. */
export function cortar(s: string, n: number): string;
export function cortar(s: string | null | undefined, n: number): string | null;
export function cortar(s: string | null | undefined, n: number): string | null {
  if (s === null || s === undefined) return null;
  return s.length <= n ? s : s.slice(0, n);
}

// ------------------------------------------------------------------ GUID
const GUID =
  /^(?:\{)?([0-9a-fA-F]{8})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{12})(?:\})?$/;

/** Guid.TryParse: aceita os formatos D, N e B; devolve no formato D minúsculo, ou null. */
export function lerGuid(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const t = texto.trim();
  const m = GUID.exec(t);
  if (!m) return null;
  const temChaves = t.startsWith('{');
  if (temChaves !== t.endsWith('}')) return null;
  const semHifens = !t.includes('-');
  const comHifens = (t.match(/-/g) ?? []).length === 4;
  if (!semHifens && !comHifens) return null;
  return `${m[1]}-${m[2]}-${m[3]}-${m[4]}-${m[5]}`.toLowerCase();
}

/** GUID sem hífens (formato N do .NET). */
export function guidN(id: string): string {
  return id.replace(/-/g, '').toLowerCase();
}

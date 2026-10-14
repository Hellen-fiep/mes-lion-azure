// Formatos do contrato HTTP herdado (PowerShell → .NET → NestJS).
import {
  carimbo,
  comoTexto,
  contentDisposition,
  corpoComoTexto,
  cortar,
  dataIso,
  dataIsoSegundos,
  decodificarUmaVez,
  escaparDados,
  guidN,
  lerGuid,
  lerJson,
  textoDe,
  trechoCaminho,
  verdadeiroDe,
} from './formatos';

describe('datas (row_to_json do PostgreSQL / Data() do .NET)', () => {
  const d = new Date(2026, 9, 13, 9, 5, 2, 7); // hora local

  it('ISO 8601 com milissegundos e deslocamento do fuso local', () => {
    const s = dataIso(d);
    expect(s).toMatch(/^2026-10-13T09:05:02\.007[+-]\d{2}:\d{2}$/);
    expect(new Date(s).getTime()).toBe(d.getTime());
  });

  it('sem milissegundos (updatedAt da exportação) e carimbo para nomes de arquivo', () => {
    expect(dataIsoSegundos(d)).toMatch(/^2026-10-13T09:05:02[+-]\d{2}:\d{2}$/);
    expect(carimbo(d)).toBe('20261013_090502');
    expect(carimbo(d, true)).toBe('20261013_090502_007');
  });
});

describe('URL', () => {
  it('escaparDados = Uri.EscapeDataString (RFC 3986)', () => {
    expect(escaparDados("Contrato Social ç (v2)!'*~.pdf")).toBe('Contrato%20Social%20%C3%A7%20%28v2%29%21%27%2A~.pdf');
    expect(escaparDados('BP-TESTE_01')).toBe('BP-TESTE_01');
  });

  it('decodificarUmaVez = Uri.UnescapeDataString (sequências inválidas ficam como estão)', () => {
    expect(decodificarUmaVez('EQ%2001%2FA-%C3%A7')).toBe('EQ 01/A-ç');
    expect(decodificarUmaVez('100%25')).toBe('100%');
    expect(decodificarUmaVez('a%ZZb%C3%A7')).toBe('a%ZZbç');
    expect(decodificarUmaVez('%2525')).toBe('%25'); // uma vez só
  });

  it('trechoCaminho: caminho original decodificado uma única vez (inclusive %2F)', () => {
    expect(trechoCaminho('/api/equipment/EQ%2001%2FA-%C3%A7/documents', '/api/equipment/', '/documents')).toBe(
      'EQ 01/A-ç',
    );
    expect(trechoCaminho('/api/storage/MES_TESTE%20chave%2F%C3%A7?x=1', '/api/storage/')).toBe('MES_TESTE chave/ç');
    expect(trechoCaminho('/api/storage/', '/api/storage/')).toBeNull();
    expect(trechoCaminho('/api/outra/x', '/api/storage/')).toBeNull();
    expect(trechoCaminho('/api/equipment/10/outra', '/api/equipment/', '/documents')).toBeNull();
  });
});

describe('Content-Disposition (ContentDispositionHeaderValue.SetHttpFileName do ASP.NET Core)', () => {
  it('nome ASCII de reserva + filename* em UTF-8', () => {
    expect(contentDisposition('inline', 'Instrução de Trabalho Nº1.pdf')).toBe(
      `inline; filename="Instru__o de Trabalho N_1.pdf"; filename*=UTF-8''Instru%C3%A7%C3%A3o%20de%20Trabalho%20N%C2%BA1.pdf`,
    );
  });

  it('nome simples fica sem aspas; caracteres fora do BMP viram dois "_" (UTF-16)', () => {
    expect(contentDisposition('attachment', 'MES_LION_BANCO_20261013_101500.json')).toBe(
      "attachment; filename=MES_LION_BANCO_20261013_101500.json; filename*=UTF-8''MES_LION_BANCO_20261013_101500.json",
    );
    expect(contentDisposition('inline', 'a🙂.pdf')).toBe(
      `inline; filename=a__.pdf; filename*=UTF-8''a%F0%9F%99%82.pdf`,
    );
    expect(contentDisposition('inline', 'x"y.pdf')).toBe(`inline; filename="x\\"y.pdf"; filename*=UTF-8''x%22y.pdf`);
  });
});

describe('corpo das requisições (LerJson / Str / Verdadeiro do .NET)', () => {
  it('detecta BOM UTF-8/UTF-16 como o StreamReader', () => {
    expect(corpoComoTexto(Buffer.from([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
    expect(corpoComoTexto(Buffer.from([0xff, 0xfe, 0x61, 0x00, 0xe7, 0x00]))).toBe('aç');
    expect(corpoComoTexto(Buffer.from([0xfe, 0xff, 0x00, 0x61, 0x00, 0xe7]))).toBe('aç');
    expect(corpoComoTexto(undefined)).toBe('');
  });

  it('JSON inválido ou vazio vira null (as rotas herdadas não respondem erro de sintaxe)', () => {
    expect(lerJson('{"a":1}')).toEqual({ a: 1 });
    expect(lerJson('{a:1}')).toBeNull();
    expect(lerJson('   ')).toBeNull();
  });

  it('textoDe: string como está; número/lógico/objeto → texto JSON; null/ausente → null', () => {
    const o = { s: 'x', n: 1.5, b: false, o: { a: [1] }, z: null };
    expect(textoDe(o, 's')).toBe('x');
    expect(textoDe(o, 'n')).toBe('1.5');
    expect(textoDe(o, 'b')).toBe('false');
    expect(textoDe(o, 'o')).toBe('{"a":[1]}');
    expect(textoDe(o, 'z')).toBeNull();
    expect(textoDe(o, 'ausente')).toBeNull();
    expect(textoDe('não é objeto', 's')).toBeNull();
    expect(comoTexto(undefined)).toBe('');
  });

  it('verdadeiroDe = "if($b.active)" do PowerShell', () => {
    const casos: [unknown, boolean][] = [
      [true, true],
      [false, false],
      ['x', true],
      ['', false],
      [1, true],
      [0, false],
      [{}, true],
      [[], true],
      [null, false],
    ];
    for (const [valor, esperado] of casos) expect(verdadeiroDe({ active: valor }, 'active')).toBe(esperado);
    expect(verdadeiroDe({}, 'active')).toBe(false);
  });

  it('cortar = s[..n] do C#', () => {
    expect(cortar('abcdef', 3)).toBe('abc');
    expect(cortar('ab', 3)).toBe('ab');
    expect(cortar(null, 3)).toBeNull();
  });
});

describe('GUID (Guid.TryParse do .NET)', () => {
  it('aceita os formatos D, N e B e devolve o formato D minúsculo', () => {
    const d = '0F8FAD5B-D9CB-469F-A165-70867728950E';
    expect(lerGuid(d)).toBe(d.toLowerCase());
    expect(lerGuid(guidN(d))).toBe(d.toLowerCase());
    expect(lerGuid(`{${d}}`)).toBe(d.toLowerCase());
    expect(guidN(d)).toBe('0f8fad5bd9cb469fa16570867728950e');
  });

  it('rejeita textos que não são GUID', () => {
    for (const invalido of [
      '',
      'abc',
      '0f8fad5b-d9cb-469f-a165',
      '{0f8fad5b-d9cb-469f-a165-70867728950e',
      '0f8fad5b-d9cb469f-a165-70867728950e',
    ])
      expect(lerGuid(invalido)).toBeNull();
  });
});

// Divisão/montagem do estado do MES sem reserializar — mesmos vetores dos testes de unidade do servidor .NET
// (tests/MesLion.Testes/Program.cs, seção "JsonEstado"), mais os casos de validação do Utf8JsonReader.
import { EstadoInvalidoError } from '../dominio/erros';
import { analisarColecao, dividir, lerArquivoBanco, lerPropriedades, montar, sha256 } from './json-estado';

const b = (s: string) => Buffer.from(s, 'utf8');
const textoDe = (u: Uint8Array) => Buffer.from(u).toString('utf8');

describe('dividir (estado → coleções)', () => {
  const json = '{"a":[1,2,{"x":"ç"}],"meta":{"v":1},"s":"texto \\"aspas\\"","n":1.50,"nulo":null,"vazio":[],"a":[9]}';
  const partes = dividir(b(json));

  it('mantém a ordem da primeira ocorrência; nome repetido: o último valor vale (como JSON.parse)', () => {
    expect(partes.map((p) => p.nome)).toEqual(['a', 'meta', 's', 'n', 'nulo', 'vazio']);
    expect(textoDe(partes[0].conteudo)).toBe('[9]');
  });

  it('preserva cada valor byte a byte (ex.: 1.50 continua 1.50)', () => {
    expect(textoDe(partes[3].conteudo)).toBe('1.50');
    expect(textoDe(partes[2].conteudo)).toBe('"texto \\"aspas\\""');
    expect(textoDe(partes[1].conteudo)).toBe('{"v":1}');
  });

  it('conta os itens das listas e calcula o SHA-256 de cada coleção', () => {
    expect(partes[5].itens).toBe(0);
    expect(partes[0].itens).toBe(1);
    expect(partes[1].itens).toBeNull();
    for (const p of partes) expect(p.hash.equals(sha256(p.conteudo))).toBe(true);
  });

  it('a montagem gera um JSON válido com o mesmo conteúdo', () => {
    const montado = montar(partes);
    expect(JSON.parse(montado.toString('utf8'))).toEqual(JSON.parse(json));
    expect(montado.toString('utf8')).toBe(
      '{"a":[9],"meta":{"v":1},"s":"texto \\"aspas\\"","n":1.50,"nulo":null,"vazio":[]}',
    );
  });

  it.each(['', '[]', '{"a":', '{"a":1}x', '{a:1}', '{"a":1,}', '{"a":01}', '{"a":"\u0001"}', '{"a":tru}', '{"a":-}'])(
    'rejeita JSON inválido: %j',
    (invalido) => {
      expect(() => dividir(b(invalido))).toThrow(EstadoInvalidoError);
    },
  );

  it('a mensagem de erro diz "inválido" (contrato: PUT /api/storage/MES_LION_DATA → 400)', () => {
    expect(() => dividir(b('{"materiais": [1,2'))).toThrow(/inválido/);
    expect(() => dividir(b('[1,2,3]'))).toThrow('Estado inválido: era esperado um objeto JSON.');
  });

  it('aceita BOM UTF-8 e espaços em volta', () => {
    const comBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), b(' \r\n{"x":1}\n ')]);
    const r = dividir(comBom);
    expect(r).toHaveLength(1);
    expect(textoDe(r[0].conteudo)).toBe('1');
  });

  it('rejeita UTF-8 inválido', () => {
    expect(() => dividir(Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]))).toThrow(
      EstadoInvalidoError,
    );
  });

  it('decodifica escapes nos nomes das coleções', () => {
    expect(dividir(b('{"a\\u0062":1,"\\u00e7":2}')).map((p) => p.nome)).toEqual(['ab', 'ç']);
  });

  it('aceita até 2048 níveis de profundidade (como o servidor .NET) e rejeita mais', () => {
    const profundo = (n: number) => '{"x":' + '['.repeat(n - 1) + ']'.repeat(n - 1) + '}';
    expect(() => dividir(b(profundo(2048)))).not.toThrow();
    expect(() => dividir(b(profundo(2049)))).toThrow(/Profundidade/);
  });

  it('estado vazio ({}) não tem coleções', () => {
    expect(dividir(b('{}'))).toEqual([]);
    expect(montar([]).toString()).toBe('{}');
  });
});

describe('lerArquivoBanco (importação)', () => {
  it('lê o formato MES_LION_JSON_DATABASE (estado + appStorage)', () => {
    const r = lerArquivoBanco(
      b(
        '{"schemaVersion":39,"format":"MES_LION_JSON_DATABASE","appStorage":{"K":"V","N":1,"O":{"a":[1]}},"data":{"op":[]}}',
      ),
    );
    expect(r.formato).toBe('MES_LION_JSON_DATABASE');
    expect(r.estado.toString()).toBe('{"op":[]}');
    expect(r.appStorage).toEqual({ K: 'V', N: '1', O: '{"a":[1]}' });
  });

  it('um objeto de estado puro é importado como está', () => {
    const r = lerArquivoBanco(b('{"op":[{"CodOP":"OP1"}],"meta":{}}'));
    expect(r.formato).toBe('ESTADO');
    expect(r.appStorage).toBeNull();
    expect(r.estado.toString()).toBe('{"op":[{"CodOP":"OP1"}],"meta":{}}');
  });

  it("rejeita o envelope sem 'data' e arquivos truncados", () => {
    expect(() => lerArquivoBanco(b('{"format":"MES_LION_JSON_DATABASE"}'))).toThrow(/sem a propriedade 'data'/);
    expect(() => lerArquivoBanco(b('{"format":"MES_LION_JSON_DATABASE","data":'))).toThrow(EstadoInvalidoError);
  });
});

describe('lerPropriedades / analisarColecao (camada relacional)', () => {
  it('posições em bytes corretas com caracteres multibyte', () => {
    const dados = b('{"ç":"ã","b":[1]}');
    const [p1, p2] = lerPropriedades(dados);
    expect(dados.toString('utf8', p1.inicio, p1.fim)).toBe('"ã"');
    expect(dados.toString('utf8', p2.inicio, p2.fim)).toBe('[1]');
  });

  it('lista de registros: campos na ordem em que aparecem, com contagem de simples e complexos', () => {
    const a = analisarColecao(b('[{"b":1,"10":2,"c":{"x":1}},{"b":null,"c":[1],"d":"x"},5]'));
    expect(a).toEqual({
      tipo: 'lista',
      objetos: 2,
      outros: 1,
      campos: [
        { chave: 'b', escalares: 1, complexos: 0 },
        { chave: '10', escalares: 1, complexos: 0 },
        { chave: 'c', escalares: 0, complexos: 2 },
        { chave: 'd', escalares: 1, complexos: 0 },
      ],
    });
  });

  it('objeto e valores simples', () => {
    expect(analisarColecao(b('{"versao":"1"}'))).toEqual({ tipo: 'objeto' });
    expect(analisarColecao(b('"texto"'))).toEqual({ tipo: 'outro' });
    expect(analisarColecao(b('[]'))).toEqual({ tipo: 'lista', objetos: 0, outros: 0, campos: [] });
  });
});

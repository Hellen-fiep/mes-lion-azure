// Views rel.<coleção> — mesmos vetores e verificações dos testes de unidade do servidor .NET
// (tests/MesLion.Testes/Program.cs, seção "Gerador de views relacionais").
import { caminhoJson, gerarView, nomeView } from './gerador-views';

const b = (s: string) => Buffer.from(s, 'utf8');

describe('gerarView', () => {
  const col = b(
    '[{"CodOP":"OP1","Status":"A","status":"b","Itens":[1],"Custo R$":"1,5","Aspas\\"x":1,"":2},{"CodOP":"OP2","Novo":null}]',
  );
  const v = gerarView('op', col)!;

  it('view rel.op com 7 campos + _linha', () => {
    expect(v.nomeView).toBe('op');
    expect(v.colunas).toBe(8);
    expect(v.sql.startsWith('CREATE OR ALTER VIEW rel.[op]\nAS\n')).toBe(true);
    expect(v.sql).toContain('(2 registros, 7 campos)');
    expect(v.sql.endsWith("WHERE c.name = N'op' AND r.[type] = 5;")).toBe(true);
  });

  it('coluna repetida (maiúsculas/minúsculas) é renomeada', () => {
    expect(v.sql).toContain(`[status_2] NVARCHAR(MAX) N'$."status"'`);
  });

  it('campo complexo vem AS JSON', () => {
    expect(v.sql).toContain(`[Itens] NVARCHAR(MAX) N'$."Itens"' AS JSON`);
  });

  it('caminho JSON com aspas escapadas; campo de nome vazio é ignorado', () => {
    expect(v.sql).toContain(`N'$."Aspas\\"x"'`);
    expect(v.sql).not.toContain(`N'$.""'`);
  });

  it('a assinatura só muda quando a estrutura muda (a view não é recriada à toa)', () => {
    const mesmosCampos = gerarView(
      'op',
      b('[{"CodOP":"X","Status":"Z","status":"y","Itens":[],"Custo R$":"9","Aspas\\"x":0,"":0},{"Novo":"1"}]'),
    )!;
    expect(mesmosCampos.assinatura).toBe(v.assinatura);
    expect(gerarView('op', b('[{"CodOP":"X"}]'))!.assinatura).not.toBe(v.assinatura);
    expect(v.assinatura).toMatch(/^[0-9a-f]{64}$/);
  });

  it('coleção-objeto vira chave/valor; lista de valores vira _linha/valor', () => {
    expect(gerarView('meta', b('{"versao":"1"}'))!.sql).toContain('r.[key] AS [chave]');
    const valores = gerarView('tags', b('["a","b"]'))!;
    expect(valores.sql).toContain('TRY_CAST(r.[key] AS INT) AS [_linha], r.[value] AS [valor]');
    expect(valores.colunas).toBe(3);
    expect(gerarView('texto', b('"x"'))).toBeNull();
  });
});

describe('nomes e caminhos', () => {
  it('nomes reservados e prefixos são protegidos', () => {
    expect(nomeView('relacionamentos')).toBe('col_relacionamentos');
    expect(nomeView('vw_x')).toBe('col_vw_x');
    expect(nomeView('1abc')).toBe('col_1abc');
    expect(nomeView('op-etapas ç')).toBe('op_etapas_ç');
    expect(nomeView('')).toBe('colecao');
    expect(nomeView('x'.repeat(130))).toMatch(/^x{100}_[0-9A-F]{8}$/);
  });

  it('caminhoJson escapa aspas, barra invertida e controles', () => {
    expect(caminhoJson('a"b\\c\u0001')).toBe('$."a\\"b\\\\c\\u0001"');
  });
});

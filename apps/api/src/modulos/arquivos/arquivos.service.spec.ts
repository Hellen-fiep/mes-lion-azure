// Nomes e chaves de arquivos (mesmas regras do servidor .NET e do frontend).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type ArmazenamentoArquivos,
  ArmazenamentoLocal,
  nomeSeguro,
  normalizarChave,
} from '../../infra/arquivos/armazenamento';
import { extensao, tipoPorNome } from '../../comum/mime';
import { idPassaporteSeguro } from './arquivos.service';

describe('nomes e chaves', () => {
  it('idPassaporteSeguro: letras, dígitos, "-", "_" e "."; sem pontos nas pontas; até 120', () => {
    expect(idPassaporteSeguro(' BP-TESTE_01 ')).toBe('BP-TESTE_01');
    expect(idPassaporteSeguro('../a/b c')).toBe('_a_b_c');
    expect(idPassaporteSeguro('Passaporte Ç.1')).toBe('Passaporte_Ç.1');
    expect(idPassaporteSeguro('a🙂')).toBe('a__'); // por unidade UTF-16, como o char do C#
    expect(idPassaporteSeguro('x'.repeat(130))).toHaveLength(120);
    expect(idPassaporteSeguro(null)).toBe('');
  });

  it('nomeSeguro (v4047FileNameSafe): troca caracteres proibidos, corta em 120, padrão "arquivo"', () => {
    expect(nomeSeguro('Contrato Social ç.pdf')).toBe('Contrato Social ç.pdf');
    expect(nomeSeguro('a<b>c:d"e/f\\g|h?i*j\u0001.pdf')).toBe('a_b_c_d_e_f_g_h_i_j_.pdf');
    expect(nomeSeguro('   ')).toBe('arquivo');
    expect(nomeSeguro('..')).toBe('arquivo');
    expect(nomeSeguro('n'.repeat(200))).toHaveLength(120);
  });

  it('normalizarChave recusa "..", "." e ":"', () => {
    expect(normalizarChave('anexos\\x//y.pdf')).toBe('anexos/x/y.pdf');
    for (const c of ['../x', 'a/./b', 'c:/x', '']) expect(() => normalizarChave(c)).toThrow();
  });

  it('tipos de conteúdo e extensão como o servidor .NET', () => {
    expect(tipoPorNome('A.PDF')).toBe('application/pdf');
    expect(tipoPorNome('p.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(tipoPorNome('sem-extensao')).toBe('application/octet-stream');
    expect(extensao('C:\\pasta\\Planilha.XLS')).toBe('.xls');
    expect(extensao('arquivo.')).toBe('');
  });
});

describe('ArmazenamentoLocal', () => {
  let raiz: string;
  beforeEach(() => {
    raiz = mkdtempSync(path.join(tmpdir(), 'mes-arq-'));
  });
  afterEach(() => rmSync(raiz, { recursive: true, force: true }));

  it('grava (atômico) e lê de volta; chaves fora da pasta são recusadas', async () => {
    const a: ArmazenamentoArquivos = new ArmazenamentoLocal(raiz);
    await a.inicializar();
    const conteudo = Buffer.from([0, 1, 2, 255, 13, 10]);
    await a.salvar('documentos/x.pdf', conteudo, 'application/pdf');
    expect(await a.existe('documentos/x.pdf')).toBe(true);
    const lido = await a.abrir('documentos/x.pdf');
    expect(lido?.tamanho).toBe(6);
    const partes: Buffer[] = [];
    for await (const p of lido!.conteudo) partes.push(p as Buffer);
    expect(Buffer.concat(partes).equals(conteudo)).toBe(true);
    expect(await a.abrir('documentos/nao-existe.pdf')).toBeNull();
    await expect(a.salvar('../fora.txt', conteudo, null)).rejects.toThrow();
  });
});

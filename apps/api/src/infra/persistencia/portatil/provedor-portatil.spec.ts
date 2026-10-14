// Modo Portátil: mesmas regras do SQL Server e arquivos no MESMO formato do servidor .NET (a mesma pasta
// Dados/BancoPortatil pode ser aberta pelos dois servidores).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dividir } from '../../../comum/json-estado';
import type { ProvedorPersistencia } from '../../../dominio/repositorios';
import type { SessaoAutenticacao, Usuario } from '../../../dominio/entidades';
import { criarProvedorPortatil } from './provedor-portatil';

const b = (s: string) => Buffer.from(s, 'utf8');

function usuario(username: string, extra: Partial<Usuario> = {}): Usuario {
  const agora = new Date();
  return {
    id: '6f9619ff-8b86-d011-b42d-00c04fc964ff',
    username,
    fullName: 'Fulano',
    passwordHash: 'x',
    role: 'USER',
    active: true,
    authProvider: 'LOCAL',
    externalId: null,
    createdAt: agora,
    updatedAt: agora,
    ...extra,
  };
}

describe('provedor Portátil', () => {
  let raiz: string;
  let p: ProvedorPersistencia;
  beforeEach(async () => {
    raiz = mkdtempSync(path.join(tmpdir(), 'mes-port-'));
    p = criarProvedorPortatil(raiz);
    await p.inicializar();
  });
  afterEach(() => rmSync(raiz, { recursive: true, force: true }));

  describe('estado', () => {
    it('grava só as coleções alteradas, remove as ausentes e incrementa a versão', async () => {
      const r1 = await p.estado.gravar(dividir(b('{"op":[{"CodOP":"1"}],"meta":{"v":1},"x":[]}')), usuario('admin'));
      expect(r1).toEqual({ versao: 1, alteradas: ['op', 'meta', 'x'], removidas: [], bytesGravados: 24 });

      const r2 = await p.estado.gravar(dividir(b('{"meta":{"v":1},"op":[{"CodOP":"2"}]}')), usuario('admin'));
      expect(r2.versao).toBe(2);
      expect(r2.alteradas).toEqual(['op']);
      expect(r2.removidas).toEqual(['x']);

      const { versao, colecoes } = await p.estado.carregar();
      expect(versao).toBe(2);
      expect(colecoes.map((c) => [c.nome, c.ordem, c.conteudo.toString()])).toEqual([
        ['meta', 0, '{"v":1}'],
        ['op', 1, '[{"CodOP":"2"}]'],
      ]);
      // arquivos de coleções antigas são apagados
      expect(readdirSync(path.join(raiz, 'estado')).filter((n) => n.startsWith('c_'))).toHaveLength(2);
      const resumo = await p.estado.resumo();
      expect(resumo).toMatchObject({ versao: 2, colecoes: 2, bytes: 22, atualizadoPor: 'admin' });
    });

    it('índice no formato do servidor .NET (PascalCase) e leitura de um índice gravado pelo .NET', async () => {
      await p.estado.gravar(dividir(b('{"op":[1,2]}')), null);
      const idx = JSON.parse(readFileSync(path.join(raiz, 'estado', 'indice.json'), 'utf8'));
      expect(Object.keys(idx)).toEqual(['Versao', 'AtualizadoEm', 'AtualizadoPor', 'Colecoes']);
      expect(Object.keys(idx.Colecoes[0])).toEqual([
        'Nome',
        'Ordem',
        'Hash',
        'Arquivo',
        'Bytes',
        'Itens',
        'AtualizadoEm',
      ]);
      expect(idx.Colecoes[0]).toMatchObject({ Nome: 'op', Ordem: 0, Bytes: 5, Itens: 2 });

      // Índice escrito pelo System.Text.Json (.NET): datas com 7 casas decimais e hash em maiúsculas.
      const outra = mkdtempSync(path.join(tmpdir(), 'mes-dotnet-'));
      try {
        mkdirSync(path.join(outra, 'estado'));
        writeFileSync(path.join(outra, 'estado', 'c_x.json'), '[{"a":1}]');
        writeFileSync(
          path.join(outra, 'estado', 'indice.json'),
          JSON.stringify({
            Versao: 7,
            AtualizadoEm: '2026-10-13T09:15:02.1234567-03:00',
            AtualizadoPor: 'admin',
            Colecoes: [
              {
                Nome: 'op',
                Ordem: 0,
                Hash: 'AB'.repeat(32),
                Arquivo: 'c_x.json',
                Bytes: 9,
                Itens: 1,
                AtualizadoEm: '2026-10-13T09:15:02.1234567-03:00',
              },
            ],
          }),
        );
        const q = criarProvedorPortatil(outra);
        const r = await q.estado.resumo();
        expect(r.versao).toBe(7);
        expect(r.atualizadoEm?.toISOString()).toBe('2026-10-13T12:15:02.123Z');
        const c = await q.estado.carregar();
        expect(c.colecoes[0].conteudo.toString()).toBe('[{"a":1}]');
      } finally {
        rmSync(outra, { recursive: true, force: true });
      }
    });

    it('gravações simultâneas não se perdem nem corrompem o índice', async () => {
      await Promise.all(
        Array.from({ length: 8 }, (_, i) => p.estado.gravar(dividir(b(`{"c":[${i}]}`)), usuario('admin'))),
      );
      expect(await p.estado.obterVersao()).toBe(8);
      expect((await p.estado.carregar()).colecoes).toHaveLength(1);
    });
  });

  describe('usuários, localStorage e auditoria', () => {
    it('login sensível a maiúsculas, duplicidade recusada e arquivo no formato do .NET', async () => {
      expect(await p.usuarios.inserir(usuario('admin', { role: 'ADMIN' }))).toBe(true);
      expect(await p.usuarios.inserir(usuario('admin', { id: '00000000-0000-0000-0000-000000000001' }))).toBe(false);
      expect(await p.usuarios.porUsername('ADMIN')).toBeNull();
      expect((await p.usuarios.porId('6F9619FF-8B86-D011-B42D-00C04FC964FF'))?.username).toBe('admin');
      const json = JSON.parse(readFileSync(path.join(raiz, 'usuarios.json'), 'utf8'));
      expect(Object.keys(json[0])).toEqual([
        'Id',
        'Username',
        'FullName',
        'PasswordHash',
        'Role',
        'Active',
        'AuthProvider',
        'ExternalId',
        'CreatedAt',
        'UpdatedAt',
      ]);
    });

    it('localStorage: definir, remover, limpar e substituir tudo', async () => {
      await p.kv.definir('a', '1');
      await p.kv.definir('chave/ç', 'valor 🙂');
      expect(await p.kv.listar()).toEqual({ a: '1', 'chave/ç': 'valor 🙂' });
      await p.kv.remover('a');
      expect(await p.kv.listar()).toEqual({ 'chave/ç': 'valor 🙂' });
      await p.kv.substituirTudo({ x: 'y' });
      expect(await p.kv.listar()).toEqual({ x: 'y' });
      await p.kv.limpar();
      expect(await p.kv.listar()).toEqual({});
    });

    it('auditoria: os mais recentes primeiro, com limite, ignorando linhas corrompidas', async () => {
      for (let i = 0; i < 5; i++) {
        await p.auditoria.registrar({
          userId: null,
          username: 'admin',
          module: 'app',
          action: `A${i}`,
          recordKey: 'k',
          changedAt: new Date(),
          detailsJson: '{}',
        });
      }
      writeFileSync(
        path.join(raiz, 'auditoria.jsonl'),
        readFileSync(path.join(raiz, 'auditoria.jsonl'), 'utf8') + '{lixo\n',
      );
      expect((await p.auditoria.listar(3)).map((a) => a.action)).toEqual(['A4', 'A3', 'A2']);
      expect(await p.auditoria.contar()).toBe(6);
    });
  });

  describe('sessões JWT e segredos', () => {
    const sessao = (id: string, hash: string): SessaoAutenticacao => {
      const agora = new Date();
      return {
        id,
        userId: '6f9619ff-8b86-d011-b42d-00c04fc964ff',
        refreshHash: Buffer.from(hash.repeat(64), 'hex'),
        previousRefreshHash: null,
        provider: 'LOCAL',
        channel: 'COOKIE',
        createdAt: agora,
        rotatedAt: agora,
        lastSeenAt: agora,
        expiresAt: new Date(agora.getTime() + 3600_000),
        revokedAt: null,
        revokedReason: null,
        userAgent: null,
        ipAddress: null,
      };
    };

    it('rotação só troca o token se o atual ainda for o esperado; o anterior continua localizável', async () => {
      const id = '11111111-1111-1111-1111-111111111111';
      await p.sessoes.criar(sessao(id, 'a'));
      const a = Buffer.from('a'.repeat(64), 'hex');
      const novo = Buffer.from('b'.repeat(64), 'hex');
      const agora = new Date();
      expect(await p.sessoes.rotacionar(id, a, novo, new Date(agora.getTime() + 1000), agora)).toBe(true);
      expect(await p.sessoes.rotacionar(id, a, Buffer.from('c'.repeat(64), 'hex'), agora, agora)).toBe(false);
      expect(await p.sessoes.porHashRefresh(novo)).toMatchObject({ atual: true });
      expect(await p.sessoes.porHashRefresh(a)).toMatchObject({ atual: false });
      await p.sessoes.revogar(id, 'logout', new Date());
      expect((await p.sessoes.obter(id))?.revokedReason).toBe('logout');
      expect(existsSync(path.join(raiz, 'sessoes_autenticacao.json'))).toBe(true);
      // o token nunca é gravado: só o hash
      expect(readFileSync(path.join(raiz, 'sessoes_autenticacao.json'), 'utf8')).toContain('b'.repeat(64));
    });

    it('limpa sessões vencidas e revogadas antigas', async () => {
      const velha = sessao('22222222-2222-2222-2222-222222222222', 'd');
      velha.expiresAt = new Date(Date.now() - 10 * 24 * 3600_000);
      await p.sessoes.criar(velha);
      await p.sessoes.criar(sessao('33333333-3333-3333-3333-333333333333', 'e'));
      expect(await p.sessoes.limpar(new Date(Date.now() - 7 * 24 * 3600_000))).toBe(1);
      expect(await p.sessoes.revogarDoUsuario('6F9619FF-8B86-D011-B42D-00C04FC964FF', 'teste', new Date())).toBe(1);
    });

    it('segredo gerado uma vez e reaproveitado', async () => {
      expect(await p.segredos.definirSeAusente('jwt', 'v1')).toBe('v1');
      expect(await p.segredos.definirSeAusente('jwt', 'v2')).toBe('v1');
      expect(await p.segredos.obter('jwt')).toBe('v1');
    });
  });

  it('backups: ids sequenciais, mais recentes primeiro', async () => {
    const base = { storedKey: 'backups/x', reason: 'r', sizeBytes: 1, stateVersion: 1, createdAt: new Date() };
    expect(await p.backups.inserir({ ...base, createdBy: null, createdByName: null })).toBe(1);
    expect(await p.backups.inserir({ ...base, createdBy: null, createdByName: 'admin' })).toBe(2);
    expect((await p.backups.listar(10)).map((x) => x.id)).toEqual([2, 1]);
    expect((await p.backups.obter(2))?.createdByName).toBe('admin');
  });
});

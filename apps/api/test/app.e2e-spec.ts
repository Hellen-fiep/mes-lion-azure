// Teste ponta a ponta da API (supertest) no modo Portátil, com a base de teste anonimizada:
// pipeline HTTP completo (frontend estático, cookies, corpo bruto, filtro de erros, Swagger) e o fluxo JWT
// (login por cookie, renovação transparente, tokens Bearer com rotação, logout que revoga a sessão).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { carregarConfiguracao } from '../src/configuracao/carregar-configuracao';
import { configurarHttp } from '../src/http';
import { InicializacaoService } from '../src/modulos/plataforma/inicializacao.service';

const SEED = path.resolve(__dirname, '..', '..', '..', 'tests', 'dados_teste', 'MES_LION_DATA_TESTE.json');

/** Cookies "nome=valor" de uma resposta (Set-Cookie). */
function cookies(res: request.Response): Record<string, { valor: string; atributos: string }> {
  const lista = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const r: Record<string, { valor: string; atributos: string }> = {};
  for (const c of lista) {
    const [par, ...atributos] = c.split(';');
    const i = par.indexOf('=');
    r[par.slice(0, i).trim()] = { valor: par.slice(i + 1), atributos: atributos.join(';').toLowerCase() };
  }
  return r;
}

describe('API MES LION (e2e, modo Portátil)', () => {
  let raiz: string;
  let app: NestExpressApplication;
  let servidor: App;
  let seed: { data: Record<string, unknown> } | Record<string, unknown>;

  beforeAll(async () => {
    raiz = mkdtempSync(path.join(tmpdir(), 'mes-e2e-'));
    const cfg = carregarConfiguracao({
      raizConteudo: raiz,
      ambiente: {
        MesLion__Banco__Provedor: 'Portatil',
        MesLion__Banco__PastaPortatil: path.join(raiz, 'BancoPortatil'),
        MesLion__Arquivos__PastaLocal: path.join(raiz, 'Arquivos'),
        MesLion__Seed__ArquivoInicial: SEED,
      },
    });
    app = await NestFactory.create<NestExpressApplication>(AppModule.registrar(cfg), {
      bodyParser: false,
      logger: false,
    });
    await app.get(InicializacaoService).executar();
    configurarHttp(app, cfg);
    await app.init();
    servidor = app.getHttpServer();
    const json = JSON.parse(readFileSync(SEED, 'utf8')) as Record<string, unknown>;
    seed = json.format === 'MES_LION_JSON_DATABASE' ? (json.data as Record<string, unknown>) : json;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(raiz, { recursive: true, force: true });
  });

  const login = async (usuario = 'admin', senha = 'meslion2026') => {
    const res = await request(servidor).post('/api/auth/login').send({ username: usuario, password: senha });
    expect(res.status).toBe(200);
    const c = cookies(res);
    return { res, acesso: c.MESSESSION.valor, refresh: c.MESREFRESH.valor, cookies: c };
  };
  const comCookies = (acesso: string | null, refresh: string | null) =>
    [acesso !== null ? `MESSESSION=${acesso}` : '', refresh !== null ? `MESREFRESH=${refresh}` : '']
      .filter(Boolean)
      .join('; ');

  it('serve o frontend (no-cache, cabeçalhos de segurança) e responde 404 "Não encontrado" fora da API', async () => {
    const pagina = await request(servidor).get('/');
    expect(pagina.status).toBe(200);
    expect(pagina.text).toContain('mes_plataforma_azure.js');
    expect(pagina.headers['cache-control']).toBe('no-cache');
    expect(pagina.headers['x-content-type-options']).toBe('nosniff');
    expect(pagina.headers['x-frame-options']).toBe('SAMEORIGIN');
    const js = await request(servidor).get('/js/app.js?v=1');
    expect(js.headers['content-type']).toBe('application/javascript; charset=utf-8');
    const nada = await request(servidor).get('/arquivo-inexistente.txt');
    expect([nada.status, nada.text]).toEqual([404, 'Não encontrado']);
  });

  it('sem sessão: 401 {"error":"Não autenticado"} em rotas existentes e inexistentes da API', async () => {
    for (const rota of ['/api/bootstrap', '/api/users', '/api/rota-inexistente']) {
      const r = await request(servidor).get(rota);
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: 'Não autenticado' });
    }
    expect((await request(servidor).get('/healthz')).body).toMatchObject({ status: 'ok', banco: 'Portatil' });
    expect((await request(servidor).get('/api/auth/config')).body).toMatchObject({ banco: 'Portatil' });
  });

  it('Swagger/OpenAPI em /api/docs com as rotas da API', async () => {
    const doc = await request(servidor).get('/api/docs-json');
    expect(doc.status).toBe(200);
    const caminhos = Object.keys((doc.body as { paths: Record<string, unknown> }).paths);
    expect(caminhos).toEqual(
      expect.arrayContaining(['/api/auth/login', '/api/auth/token', '/api/auth/refresh', '/api/users', '/healthz']),
    );
    expect((await request(servidor).get('/api/docs')).text).toContain('swagger');
  });

  it('login: credenciais erradas → 401; certas → cookies HttpOnly MESSESSION (/) e MESREFRESH (/api)', async () => {
    const errado = await request(servidor).post('/api/auth/login').send({ username: 'admin', password: 'x' });
    expect([errado.status, errado.body]).toEqual([401, { error: 'Usuário ou senha inválidos' }]);
    const maiusculas = await request(servidor)
      .post('/api/auth/login')
      .send({ username: 'ADMIN', password: 'meslion2026' });
    expect(maiusculas.status).toBe(401);

    const { res, cookies: c } = await login();
    expect(res.body.user).toMatchObject({ username: 'admin', role: 'ADMIN', provedor: 'LOCAL' });
    expect(c.MESSESSION.atributos).toMatch(/httponly/);
    expect(c.MESSESSION.atributos).toMatch(/path=\//);
    expect(c.MESSESSION.atributos).toMatch(/samesite=lax/);
    expect(c.MESREFRESH.atributos).toMatch(/path=\/api/);
    expect(c.MESREFRESH.atributos).toMatch(/httponly/);
    expect(c.MESSESSION.valor.split('.')).toHaveLength(3); // JWT
  });

  it('bootstrap devolve o estado do seed; PUT grava só o que mudou (SAVE_STATE no histórico)', async () => {
    const { acesso, refresh } = await login();
    const cookie = comCookies(acesso, refresh);
    const b = await request(servidor).get('/api/bootstrap').set('Cookie', cookie);
    expect(b.status).toBe(200);
    expect(Object.keys(b.body as object)).toEqual(['data', 'appStorage', 'user']);
    expect(b.body.data).toEqual(seed);
    expect(b.headers['cache-control']).toBe('no-store');

    const novo = { ...(b.body.data as object), __e2e: [{ ok: 'ç' }] };
    const put = await request(servidor)
      .put('/api/storage/MES_LION_DATA')
      .set('Cookie', cookie)
      .set('Content-Type', 'text/plain; charset=utf-8')
      .send(JSON.stringify(novo));
    expect([put.status, put.text]).toEqual([200, 'OK']);
    const aud = await request(servidor).get('/api/audit').set('Cookie', cookie);
    const salvo = (aud.body as { action: string; details: { colecoes_alteradas: string[] } }[]).find(
      (a) => a.action === 'SAVE_STATE',
    );
    expect(salvo?.details.colecoes_alteradas).toEqual(['__e2e']);

    const invalido = await request(servidor)
      .put('/api/storage/MES_LION_DATA')
      .set('Cookie', cookie)
      .set('Content-Type', 'text/plain')
      .send('{"materiais": [1,2');
    expect(invalido.status).toBe(400);
    expect(invalido.body.error).toMatch(/inválido/);
  });

  it('renovação transparente: token de acesso inválido/vencido + MESREFRESH → 200 e novo MESSESSION', async () => {
    const { refresh } = await login();
    const r = await request(servidor).get('/api/auth/me').set('Cookie', comCookies('vencido.ou.adulterado', refresh));
    expect(r.status).toBe(200);
    expect(r.body.user.username).toBe('admin');
    const novo = cookies(r).MESSESSION;
    expect(novo.valor.split('.')).toHaveLength(3);
    expect((await request(servidor).get('/api/auth/me').set('Cookie', comCookies(novo.valor, null))).status).toBe(200);
    // refresh desconhecido: 401 e cookies apagados
    const falso = await request(servidor)
      .get('/api/auth/me')
      .set('Cookie', comCookies(null, 'x'.repeat(43)));
    expect(falso.status).toBe(401);
    expect(cookies(falso).MESSESSION?.valor).toBe('');
  });

  it('clientes de API: /api/auth/token → Bearer; /api/auth/refresh troca o par e recusa o refresh anterior', async () => {
    const t = await request(servidor).post('/api/auth/token').send({ username: 'admin', password: 'meslion2026' });
    expect(t.status).toBe(200);
    expect(t.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900, refreshExpiresIn: 43200 });
    expect(cookies(t).MESSESSION).toBeUndefined();
    const me = await request(servidor).get('/api/auth/me').set('Authorization', `Bearer ${t.body.accessToken}`);
    expect(me.body.user.username).toBe('admin');

    const r = await request(servidor).post('/api/auth/refresh').send({ refreshToken: t.body.refreshToken });
    expect(r.status).toBe(200);
    expect(r.body.refreshToken).not.toBe(t.body.refreshToken);
    expect(
      (await request(servidor).get('/api/users').set('Authorization', `Bearer ${r.body.accessToken}`)).status,
    ).toBe(200);
    const reuso = await request(servidor).post('/api/auth/refresh').send({ refreshToken: t.body.refreshToken });
    expect([reuso.status, reuso.body]).toEqual([401, { error: 'Sessão expirada ou inválida' }]);
    const vazio = await request(servidor).post('/api/auth/token').send({ username: '', password: '' });
    expect(vazio.status).toBe(400);
  });

  it('logout revoga a sessão: o mesmo token de acesso deixa de valer', async () => {
    const { acesso, refresh } = await login();
    const cookie = comCookies(acesso, refresh);
    expect((await request(servidor).get('/api/rota-inexistente').set('Cookie', cookie)).text).toBe(
      'API não encontrada',
    );
    const sair = await request(servidor).post('/api/auth/logout').set('Cookie', cookie);
    expect(sair.body).toEqual({ ok: true });
    expect(cookies(sair).MESSESSION.valor).toBe('');
    expect((await request(servidor).get('/api/bootstrap').set('Cookie', cookie)).status).toBe(401);
    expect((await request(servidor).get('/api/bootstrap').set('Cookie', comCookies(acesso, null))).status).toBe(401);
  });

  it('perfil USER: sem administração (403) e sem importação de banco', async () => {
    const { acesso } = await login();
    const admin = comCookies(acesso, null);
    const criado = await request(servidor)
      .post('/api/users')
      .set('Cookie', admin)
      .send({ username: 'operador_e2e', fullName: 'Operador', password: 'Senha ç 1', role: 'USER', active: true });
    expect(criado.status).toBe(200);
    const usuario = await login('operador_e2e', 'Senha ç 1');
    const cookie = comCookies(usuario.acesso, null);
    expect((await request(servidor).get('/api/users').set('Cookie', cookie)).body).toEqual({
      error: 'Acesso administrativo necessário',
    });
    expect((await request(servidor).post('/api/import').set('Cookie', cookie).send('{}')).status).toBe(403);
    const dup = await request(servidor)
      .post('/api/users')
      .set('Cookie', admin)
      .send({ username: 'operador_e2e', fullName: 'x', password: 'y' });
    expect([dup.status, dup.body]).toEqual([409, { error: 'Já existe um usuário com este login.' }]);
  });
});

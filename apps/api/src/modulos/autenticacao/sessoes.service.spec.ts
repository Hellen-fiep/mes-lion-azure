// JWT de acesso + refresh token rotativo (com detecção de reuso), sobre o provedor Portátil real.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { carregarConfiguracao } from '../../configuracao/carregar-configuracao';
import type { ConfiguracaoMes } from '../../configuracao/opcoes';
import type { Usuario } from '../../dominio/entidades';
import type { ProvedorPersistencia } from '../../dominio/repositorios';
import { criarProvedorPortatil } from '../../infra/persistencia/portatil/provedor-portatil';
import { UsuariosService } from '../usuarios/usuarios.service';
import { COOKIE_ACESSO, COOKIE_REFRESH, SessoesService } from './sessoes.service';

const req = (extra: Partial<Request> = {}) =>
  ({ headers: { 'user-agent': 'jest' }, ip: '127.0.0.1', cookies: {}, ...extra }) as unknown as Request;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('SessoesService', () => {
  let raiz: string;
  let cfg: ConfiguracaoMes;
  let provedor: ProvedorPersistencia;
  let usuarios: UsuariosService;
  let admin: Usuario;
  const novoServico = async () => {
    const s = new SessoesService(provedor, cfg, new JwtService({}), usuarios);
    await s.carregarSegredo();
    return s;
  };

  beforeEach(async () => {
    raiz = mkdtempSync(path.join(tmpdir(), 'mes-sessoes-'));
    cfg = carregarConfiguracao({ raizConteudo: raiz, ambiente: {} });
    provedor = criarProvedorPortatil(path.join(raiz, 'banco'));
    await provedor.inicializar();
    usuarios = new UsuariosService(provedor, cfg);
    await usuarios.garantirAdministrador();
    admin = (await provedor.usuarios.porUsername('admin'))!;
  });
  afterEach(() => rmSync(raiz, { recursive: true, force: true }));

  it('token de acesso: assinatura HS256 com emissor/audiência, sessão e usuário ativos', async () => {
    const s = await novoServico();
    const { acesso, refresh, sessao } = await s.criarSessao(admin, 'LOCAL', 'COOKIE', req());
    expect(refresh).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const p = await s.validarAcesso(acesso);
    expect(p).toMatchObject({
      sub: admin.id,
      sid: sessao.id,
      name: 'admin',
      role: 'ADMIN',
      prov: 'LOCAL',
      typ: 'access',
    });
    const ctx = await s.contextoPorAcesso(p!);
    expect(ctx).toMatchObject({ sessaoId: sessao.id, provedor: 'LOCAL', canal: 'COOKIE' });
    expect(ctx?.usuario.username).toBe('admin');

    // o refresh token não é gravado (só o hash)
    expect((await provedor.sessoes.obter(sessao.id))?.refreshHash.toString('base64url')).not.toBe(refresh);

    // token adulterado, de outra chave ou de outro emissor: recusado
    const [h, c] = acesso.split('.');
    expect(await s.validarAcesso(`${h}.${c}.assinaturaFalsa`)).toBeNull();
    const outraChave = new JwtService({ secret: 'x'.repeat(64) }).sign({
      sub: admin.id,
      sid: sessao.id,
      typ: 'access',
    });
    expect(await s.validarAcesso(outraChave)).toBeNull();
  });

  it('segredo configurado (ex.: Azure Key Vault) precisa ter 32+ caracteres', async () => {
    cfg.opcoes.autenticacao.jwt.segredo = 'curto';
    await expect(novoServico()).rejects.toThrow(/32 caracteres/);
    cfg.opcoes.autenticacao.jwt.segredo = 'k'.repeat(48);
    const s = await novoServico();
    const { acesso } = await s.criarSessao(admin, 'LOCAL', 'TOKEN', req());
    expect(new JwtService({}).verify(acesso, { secret: 'k'.repeat(48) })).toMatchObject({ sub: admin.id });
  });

  it('navegador: renovação sem troca enquanto o refresh é novo; com troca depois de RotacaoMinutos', async () => {
    const s = await novoServico();
    const { refresh, sessao } = await s.criarSessao(admin, 'LOCAL', 'COOKIE', req());
    const r1 = await s.renovar(refresh, 'COOKIE');
    expect(r1?.novoRefresh).toBeNull();
    expect(r1?.expiraEm.getTime()).toBeGreaterThan(sessao.expiresAt.getTime() - 1);
    expect(await s.validarAcesso(r1!.acesso)).toMatchObject({ sid: sessao.id });

    cfg.opcoes.autenticacao.jwt.rotacaoMinutos = 0;
    const r2 = await (await novoServico()).renovar(refresh, 'COOKIE');
    expect(r2?.novoRefresh).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r2?.novoRefresh).not.toBe(refresh);
    expect(await (await novoServico()).renovar(r2!.novoRefresh!, 'COOKIE')).not.toBeNull();
  });

  it('navegador: o refresh anterior vale na janela de tolerância; depois disso o reuso revoga a sessão', async () => {
    cfg.opcoes.autenticacao.jwt.rotacaoMinutos = 0;
    const { refresh, sessao } = await (await novoServico()).criarSessao(admin, 'LOCAL', 'COOKIE', req());
    const novo = (await (await novoServico()).renovar(refresh, 'COOKIE'))!.novoRefresh!;

    // requisição simultânea com o token anterior (dentro da tolerância): aceita, sem nova troca
    const simultanea = await (await novoServico()).renovar(refresh, 'COOKIE');
    expect(simultanea?.novoRefresh).toBeNull();
    expect(simultanea?.contexto.sessaoId).toBe(sessao.id);

    // fora da tolerância: reuso → sessão revogada (o token novo também deixa de valer)
    cfg.opcoes.autenticacao.jwt.toleranciaSegundos = 0;
    await esperar(5);
    expect(await (await novoServico()).renovar(refresh, 'COOKIE')).toBeNull();
    expect((await provedor.sessoes.obter(sessao.id))?.revokedReason).toBe('reuso de refresh token');
    expect(await (await novoServico()).renovar(novo, 'COOKIE')).toBeNull();
  });

  it('clientes Bearer: troca a cada uso, recusa o token anterior e o token de outro canal', async () => {
    const s = await novoServico();
    const { refresh } = await s.criarSessao(admin, 'LOCAL', 'TOKEN', req());
    const r1 = await s.renovar(refresh, 'TOKEN');
    expect(r1?.novoRefresh).toBeTruthy();
    expect(await (await novoServico()).renovar(refresh, 'TOKEN')).toBeNull();
    expect(await (await novoServico()).renovar(r1!.novoRefresh!, 'COOKIE')).toBeNull();
    expect(await (await novoServico()).renovar('token-inexistente', 'TOKEN')).toBeNull();
  });

  it('logout revoga a sessão (acesso e refresh deixam de valer); desativar o usuário revoga todas', async () => {
    const s = await novoServico();
    const a = await s.criarSessao(admin, 'LOCAL', 'COOKIE', req());
    const b = await s.criarSessao(admin, 'LOCAL', 'COOKIE', req());
    await s.encerrarDaRequisicao(req({ cookies: { [COOKIE_ACESSO]: a.acesso, [COOKIE_REFRESH]: a.refresh } }));
    expect(await s.contextoPorAcesso((await s.validarAcesso(a.acesso))!)).toBeNull();
    expect(await s.renovar(a.refresh, 'COOKIE')).toBeNull();
    expect(await s.contextoPorAcesso((await s.validarAcesso(b.acesso))!)).not.toBeNull();

    usuarios.notificarDesativacao(admin.id);
    await esperar(50);
    expect(await s.contextoPorAcesso((await s.validarAcesso(b.acesso))!)).toBeNull();
  });

  it('usuário desativado não renova nem usa a sessão (cache de 20 s, como o servidor .NET)', async () => {
    const s = await novoServico();
    const { acesso, refresh } = await s.criarSessao(admin, 'LOCAL', 'COOKIE', req());
    await provedor.usuarios.atualizar({ ...admin, active: false });
    usuarios.invalidar(admin.id);
    expect(await s.contextoPorAcesso((await s.validarAcesso(acesso))!)).toBeNull();
    expect(await (await novoServico()).renovar(refresh, 'COOKIE')).toBeNull();
  });
});

// =====================================================================
// Usuários: login com senha (PBKDF2 / bcrypt herdado), cache curto do usuário da sessão (desativação
// vale em até 20 s, como no servidor .NET) e provisionamento pelo Microsoft Entra ID.
// =====================================================================
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { dataIso } from '../../comum/formatos';
import { CONFIGURACAO, type ConfiguracaoMes } from '../../configuracao/opcoes';
import { Perfis, type Usuario } from '../../dominio/entidades';
import { PROVEDOR_PERSISTENCIA, type ProvedorPersistencia } from '../../dominio/repositorios';
import type { PrincipalEasyAuth } from '../autenticacao/easy-auth';
import { gerarHashSenha, SEM_SENHA_LOCAL, verificarSenha } from '../autenticacao/senha-hasher';

const CACHE_MS = 20_000;

/** Usuário da sessão no formato do frontend ({id, username, fullName, role, provedor}). */
export interface UsuarioSessaoJson {
  id: string;
  username: string;
  fullName: string;
  role: string;
  provedor: string;
}

/** Linha de /api/users (formato original do PostgreSQL). */
export interface UsuarioListaJson {
  id: string;
  username: string;
  full_name: string;
  role: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class UsuariosService {
  private readonly log = new Logger('MesLion.Usuarios');
  private readonly cache = new Map<string, { usuario: Usuario; expira: number }>();
  /** Emite 'desativado' (id do usuário): as sessões do usuário são revogadas (SessoesService). */
  readonly eventos = new EventEmitter();

  constructor(
    @Inject(PROVEDOR_PERSISTENCIA) private readonly provedor: ProvedorPersistencia,
    @Inject(CONFIGURACAO) private readonly cfg: ConfiguracaoMes,
  ) {}

  static json(u: Usuario, provedorLogin?: string): UsuarioSessaoJson {
    return {
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      role: u.role,
      provedor: provedorLogin ?? u.authProvider,
    };
  }

  static linha(u: Usuario): UsuarioListaJson {
    return {
      id: u.id,
      username: u.username,
      full_name: u.fullName,
      role: u.role,
      active: u.active,
      created_at: dataIso(u.createdAt),
      updated_at: dataIso(u.updatedAt),
    };
  }

  static normalizarPerfil(perfil: string | null): string {
    const r = (perfil ?? '').trim();
    if (r.toUpperCase() === Perfis.Admin) return Perfis.Admin;
    if (r.length === 0 || r.toUpperCase() === Perfis.Usuario) return Perfis.Usuario;
    return r.length > 30 ? r.slice(0, 30) : r;
  }

  async garantirAdministrador(): Promise<void> {
    if ((await this.provedor.usuarios.contar()) > 0) return;
    const s = this.cfg.opcoes.seed;
    const agora = new Date();
    await this.provedor.usuarios.inserir({
      id: randomUUID(),
      username: s.usuarioAdmin,
      fullName: s.nomeAdmin,
      passwordHash: await gerarHashSenha(s.senhaAdmin),
      role: Perfis.Admin,
      active: true,
      authProvider: 'LOCAL',
      externalId: null,
      createdAt: agora,
      updatedAt: agora,
    });
    this.log.log(`Usuário inicial criado: ${s.usuarioAdmin}.`);
  }

  async autenticar(username: string | null, senha: string | null): Promise<Usuario | null> {
    if (!username || senha === null) return null;
    const u = await this.provedor.usuarios.porUsername(username);
    if (!u || !u.active) return null;
    const r = await verificarSenha(senha, u.passwordHash);
    if (r === 'falhou') return null;
    if (r === 'sucesso-requer-atualizacao' && this.cfg.opcoes.autenticacao.atualizarHashLegado) {
      try {
        u.passwordHash = await gerarHashSenha(senha);
        u.updatedAt = new Date();
        await this.provedor.usuarios.atualizar(u);
        this.log.log(`Hash de senha legado (bcrypt) do usuário ${u.username} atualizado para PBKDF2.`);
      } catch (e) {
        this.log.warn(`Não foi possível atualizar o hash legado do usuário ${u.username}: ${(e as Error).message}`);
      }
    }
    this.cache.delete(u.id);
    return u;
  }

  /** Usuário pelo id com cache de 20 s (a sessão de um usuário desativado deixa de valer nesse prazo). */
  async porIdComCache(id: string): Promise<Usuario | null> {
    const chave = id.toLowerCase();
    const c = this.cache.get(chave);
    if (c && c.expira > Date.now()) return c.usuario;
    const u = await this.provedor.usuarios.porId(chave);
    if (u) this.cache.set(chave, { usuario: u, expira: Date.now() + CACHE_MS });
    else this.cache.delete(chave);
    return u;
  }

  invalidar(id: string): void {
    this.cache.delete(id.toLowerCase());
  }

  /** Avisa que o usuário foi desativado (as sessões dele deixam de valer imediatamente). */
  notificarDesativacao(id: string): void {
    this.eventos.emit('desativado', id.toLowerCase());
  }

  /** Microsoft Entra ID: localiza (id externo, depois login) ou provisiona o usuário; sincroniza o perfil ADMIN. */
  async resolverEntra(p: PrincipalEasyAuth): Promise<Usuario | null> {
    const e = this.cfg.opcoes.autenticacao.entraId;
    const admin = !!e.papelAdmin.trim() && p.papeis.some((x) => x.toLowerCase() === e.papelAdmin.toLowerCase());
    let u = await this.provedor.usuarios.porIdExterno(p.id);
    if (!u && p.nome.trim()) {
      u = await this.provedor.usuarios.porUsername(p.nome);
      if (!u)
        u =
          (await this.provedor.usuarios.listar()).find((x) => x.username.toLowerCase() === p.nome.toLowerCase()) ??
          null;
    }
    const agora = new Date();
    if (!u) {
      if (!e.provisionarAutomaticamente) return null;
      const novo: Usuario = {
        id: randomUUID(),
        username: p.nome.slice(0, 80),
        fullName: (p.nomeCompleto ?? p.nome).slice(0, 180),
        passwordHash: SEM_SENHA_LOCAL,
        role: admin || e.perfilPadrao === Perfis.Admin ? Perfis.Admin : Perfis.Usuario,
        active: true,
        authProvider: 'ENTRA',
        externalId: p.id,
        createdAt: agora,
        updatedAt: agora,
      };
      if (!(await this.provedor.usuarios.inserir(novo))) return this.provedor.usuarios.porUsername(novo.username);
      this.log.log(`Usuário Microsoft Entra ID provisionado: ${novo.username} (${novo.role}).`);
      return novo;
    }
    let alterado = false;
    if ((u.externalId ?? '').toLowerCase() !== p.id.toLowerCase()) {
      u.externalId = p.id;
      alterado = true;
    }
    if (e.sincronizarPerfil && admin && u.role !== Perfis.Admin) {
      u.role = Perfis.Admin;
      alterado = true;
    }
    if (alterado) {
      u.updatedAt = agora;
      await this.provedor.usuarios.atualizar(u);
      this.cache.delete(u.id);
    }
    return u;
  }
}

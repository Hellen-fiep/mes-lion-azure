import { type CanActivate, type ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Perfis } from '../../dominio/entidades';
import { naoAutenticado, somenteAdmin } from '../../comum/respostas';
import { AutenticacaoService } from './autenticacao.service';
import type { ContextoAutenticado } from './sessoes.service';

const PUBLICO = 'mes:publico';
const ADMIN = 'mes:admin';
const CHAVE_CONTEXTO = 'mesContextoAutenticado';

/** Rota sem login (tela de login, página pública do passaporte, healthz…). */
export const Publico = () => SetMetadata(PUBLICO, true);

/** Rota só para o perfil ADMIN (403 "Acesso administrativo necessário"). */
export const SomenteAdmin = () => SetMetadata(ADMIN, true);

/** Contexto do usuário autenticado (preenchido pelo AutenticacaoGuard). */
export const Contexto = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ContextoAutenticado =>
    ctx.switchToHttp().getRequest<Request & Record<string, unknown>>()[CHAVE_CONTEXTO] as ContextoAutenticado,
);

/**
 * Guarda global: toda rota exige sessão (401 {"error":"Não autenticado"}), exceto as marcadas com @Publico().
 * A verificação acontece antes de ler o corpo (uploads de usuários sem sessão não são processados).
 */
@Injectable()
export class AutenticacaoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly autenticacao: AutenticacaoService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLICO, [ctx.getHandler(), ctx.getClass()])) return true;
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request & Record<string, unknown>>();
    const contexto = await this.autenticacao.contexto(req, http.getResponse<Response>());
    if (!contexto) throw naoAutenticado();
    if (
      this.reflector.getAllAndOverride<boolean>(ADMIN, [ctx.getHandler(), ctx.getClass()]) &&
      contexto.usuario.role !== Perfis.Admin
    ) {
      throw somenteAdmin();
    }
    req[CHAVE_CONTEXTO] = contexto;
    return true;
  }
}

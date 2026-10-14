import { randomUUID } from 'node:crypto';
import { All, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { dataIso, lerGuid, lerJson } from '../../comum/formatos';
import { RespostaHttp, apiNaoEncontrada } from '../../comum/respostas';
import { CorpoJson, mensagemValidacao, validarDto } from '../../comum/validacao';
import { PROVEDOR_PERSISTENCIA, type ProvedorPersistencia } from '../../dominio/repositorios';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ErroDto } from '../autenticacao/autenticacao.dto';
import { Contexto, SomenteAdmin } from '../autenticacao/autenticacao.guard';
import type { ContextoAutenticado } from '../autenticacao/sessoes.service';
import { gerarHashSenha } from '../autenticacao/senha-hasher';
import { AtualizarUsuarioDto, AuditoriaDto, CriarUsuarioDto, MSG_OBRIGATORIOS, UsuarioListaDto } from './usuarios.dto';
import { UsuariosService } from './usuarios.service';

/** /api/users (somente ADMIN) e /api/audit — mesmo contrato do servidor original. */
@ApiTags('Usuários e histórico')
@ApiCookieAuth('MESSESSION')
@Controller('api')
export class UsuariosController {
  constructor(
    @Inject(PROVEDOR_PERSISTENCIA) private readonly provedor: ProvedorPersistencia,
    private readonly usuarios: UsuariosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get('users')
  @SomenteAdmin()
  @ApiOperation({ summary: 'Lista os usuários (ADMIN)' })
  @ApiOkResponse({ type: [UsuarioListaDto] })
  @ApiForbiddenResponse({ type: ErroDto, description: 'Acesso administrativo necessário' })
  async listar(): Promise<UsuarioListaDto[]> {
    return (await this.provedor.usuarios.listar()).map((u) => UsuariosService.linha(u));
  }

  @Post('users')
  @HttpCode(200)
  @SomenteAdmin()
  @ApiOperation({ summary: 'Cria um usuário (ADMIN)' })
  @ApiBody({ type: CriarUsuarioDto })
  @ApiOkResponse({ schema: { example: { id: '0f8fad5b-d9cb-469f-a165-70867728950e' } } })
  async criar(@CorpoJson() corpo: unknown, @Contexto() ctx: ContextoAutenticado): Promise<{ id: string }> {
    const { dto, erros } = await validarDto(CriarUsuarioDto, corpo);
    if (erros.length) throw RespostaHttp.erro(400, mensagemValidacao(erros, ['naoVazio']) ?? MSG_OBRIGATORIOS);
    const agora = new Date();
    const novo = {
      id: randomUUID(),
      username: dto.username,
      fullName: dto.fullName,
      passwordHash: await gerarHashSenha(dto.password),
      role: UsuariosService.normalizarPerfil(dto.role ?? null),
      active: dto.active === true,
      authProvider: 'LOCAL',
      externalId: null,
      createdAt: agora,
      updatedAt: agora,
    };
    if (!(await this.provedor.usuarios.inserir(novo)))
      throw RespostaHttp.erro(409, 'Já existe um usuário com este login.');
    await this.auditoria.registrar(ctx.usuario, 'usuarios', 'CREATE', dto.username);
    return { id: novo.id };
  }

  @Put('users/:id')
  @SomenteAdmin()
  @ApiOperation({ summary: 'Altera nome, perfil, situação e (opcionalmente) a senha de um usuário (ADMIN)' })
  @ApiBody({ type: AtualizarUsuarioDto })
  @ApiOkResponse({ schema: { example: { ok: true } } })
  async atualizar(
    @Param('id') id: string,
    @CorpoJson() corpo: unknown,
    @Contexto() ctx: ContextoAutenticado,
  ): Promise<{ ok: boolean }> {
    const gid = lerGuid(id);
    if (!gid) throw apiNaoEncontrada();
    const { dto, erros } = await validarDto(AtualizarUsuarioDto, corpo);
    const alvo = await this.provedor.usuarios.porId(gid);
    if (alvo) {
      if (erros.length) throw RespostaHttp.erro(400, mensagemValidacao(erros) ?? 'Requisição inválida');
      const estavaAtivo = alvo.active;
      alvo.fullName = dto.fullName ?? '';
      alvo.role = UsuariosService.normalizarPerfil(dto.role ?? null);
      alvo.active = dto.active === true;
      if (dto.password && dto.password.trim()) alvo.passwordHash = await gerarHashSenha(dto.password);
      alvo.updatedAt = new Date();
      await this.provedor.usuarios.atualizar(alvo);
      this.usuarios.invalidar(alvo.id);
      if (estavaAtivo && !alvo.active) this.usuarios.notificarDesativacao(alvo.id);
    }
    await this.auditoria.registrar(ctx.usuario, 'usuarios', 'UPDATE', id);
    return { ok: true };
  }

  @All('audit')
  @ApiOperation({ summary: 'Histórico de modificações (500 mais recentes)' })
  @ApiOkResponse({ type: [AuditoriaDto] })
  async historico(): Promise<AuditoriaDto[]> {
    return (await this.provedor.auditoria.listar(500)).map((a) => ({
      username: a.username,
      module: a.module,
      action: a.action,
      record_key: a.recordKey,
      changed_at: dataIso(a.changedAt),
      details: lerJson(a.detailsJson),
    }));
  }
}

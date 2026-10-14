import { All, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { RespostaHttp } from '../../comum/respostas';
import { CorpoJson, mensagemValidacao, validarDto } from '../../comum/validacao';
import { textoDe } from '../../comum/formatos';
import { CONFIGURACAO, type ConfiguracaoMes } from '../../configuracao/opcoes';
import { PROVEDOR_PERSISTENCIA, type ProvedorPersistencia } from '../../dominio/repositorios';
import { Plataforma, easyAuthConfiavel } from '../../plataforma';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import {
  ConfigLoginDto,
  ErroDto,
  LoginDto,
  RefreshDto,
  RespostaLoginDto,
  RespostaRenovacaoCookieDto,
  RespostaTokenDto,
} from './autenticacao.dto';
import { Contexto, Publico } from './autenticacao.guard';
import { AutenticacaoService } from './autenticacao.service';
import { COOKIE_REFRESH, type ContextoAutenticado, SessoesService, cookie } from './sessoes.service';

const credenciaisInvalidas = () => RespostaHttp.erro(401, 'Usuário ou senha inválidos');
const sessaoInvalida = () => RespostaHttp.erro(401, 'Sessão expirada ou inválida');

/** /api/auth/* — login, logout, sessão atual, configuração da tela de login e tokens para clientes de API. */
@ApiTags('Autenticação')
@Controller('api/auth')
export class AutenticacaoController {
  constructor(
    @Inject(CONFIGURACAO) private readonly cfg: ConfiguracaoMes,
    @Inject(PROVEDOR_PERSISTENCIA) private readonly provedor: ProvedorPersistencia,
    private readonly usuarios: UsuariosService,
    private readonly sessoes: SessoesService,
    private readonly autenticacao: AutenticacaoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Publico()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Login do navegador',
    description:
      'Cria a sessão e grava os cookies HttpOnly MESSESSION (JWT de acesso) e MESREFRESH (refresh token, só para /api).',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: RespostaLoginDto })
  @ApiUnauthorizedResponse({ type: ErroDto, description: 'Usuário ou senha inválidos' })
  async login(
    @CorpoJson() corpo: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RespostaLoginDto> {
    const u = await this.usuarios.autenticar(textoDe(corpo, 'username'), textoDe(corpo, 'password'));
    if (!u) throw credenciaisInvalidas();
    await this.sessoes.encerrarDaRequisicao(req); // sessão anterior deste navegador, se houver
    const s = await this.sessoes.criarSessao(u, 'LOCAL', 'COOKIE', req);
    this.sessoes.definirCookies(res, req, s.acesso, s.refresh);
    this.autenticacao.definirContexto(req, { usuario: u, sessaoId: s.sessao.id, provedor: 'LOCAL', canal: 'COOKIE' });
    await this.auditoria.registrar(u, 'auth', 'LOGIN', u.username);
    return { user: UsuariosService.json(u, 'LOCAL') };
  }

  @Publico()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Logout', description: 'Revoga a sessão (cookie ou Bearer) e apaga os cookies.' })
  @ApiOkResponse({ schema: { example: { ok: true } } })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: boolean }> {
    await this.sessoes.encerrarDaRequisicao(req);
    this.sessoes.limparCookies(res, req);
    this.autenticacao.definirContexto(req, null);
    return { ok: true };
  }

  @All('me')
  @ApiCookieAuth('MESSESSION')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Usuário da sessão atual' })
  @ApiOkResponse({ type: RespostaLoginDto })
  @ApiUnauthorizedResponse({ type: ErroDto })
  me(@Contexto() ctx: ContextoAutenticado): RespostaLoginDto {
    return { user: UsuariosService.json(ctx.usuario, ctx.provedor) };
  }

  /** Usado pelo adaptador de plataforma (js/mes_plataforma_azure.js) na tela de login. */
  @Publico()
  @Get('config')
  @ApiOperation({
    summary: 'Configuração da tela de login',
    description: 'Plataforma, banco ativo e login Microsoft Entra ID.',
  })
  @ApiOkResponse({ type: ConfigLoginDto })
  config(): ConfigLoginDto {
    const o = this.cfg.opcoes;
    const e = o.autenticacao.entraId;
    return {
      entraId: {
        habilitado: e.habilitado && easyAuthConfiavel(o),
        loginUrl: `/.auth/login/${e.provedor}?post_login_redirect_uri=%2F`,
        logoutUrl: '/.auth/logout?post_logout_redirect_uri=%2F',
      },
      plataforma: Plataforma.descricao,
      versao: Plataforma.versao,
      banco: this.provedor.nome,
      bancoDescricao:
        this.provedor.nome === 'SqlServer' ? this.provedor.descricao : 'Portátil (arquivos locais — validação)',
      compressaoUpload: o.servidor.aceitarUploadCompactado,
    };
  }

  @Publico()
  @Post('token')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Tokens para clientes de API (Bearer)',
    description: 'Para aplicativos e integrações (ex.: futuro frontend Next.js / app Expo). Não grava cookies.',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: RespostaTokenDto })
  @ApiUnauthorizedResponse({ type: ErroDto })
  async token(@CorpoJson() corpo: unknown, @Req() req: Request): Promise<RespostaTokenDto> {
    const { dto, erros } = await validarDto(LoginDto, corpo);
    if (erros.length) throw RespostaHttp.erro(400, mensagemValidacao(erros, ['naoVazio']) ?? 'Requisição inválida');
    const u = await this.usuarios.autenticar(dto.username, dto.password);
    if (!u) throw credenciaisInvalidas();
    const s = await this.sessoes.criarSessao(u, 'LOCAL', 'TOKEN', req);
    await this.auditoria.registrar(u, 'auth', 'LOGIN', u.username, JSON.stringify({ canal: 'token' }));
    return {
      tokenType: 'Bearer',
      accessToken: s.acesso,
      expiresIn: this.sessoes.acessoSegundos,
      refreshToken: s.refresh,
      refreshExpiresIn: this.sessoes.sessaoSegundos,
      user: UsuariosService.json(u, 'LOCAL'),
    };
  }

  @Publico()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Renova o token de acesso',
    description:
      'Clientes Bearer enviam {"refreshToken"} e recebem um novo par (o refresh token é trocado a cada uso). ' +
      'No navegador, o cookie MESREFRESH é usado e os cookies são atualizados (a renovação também acontece sozinha em qualquer rota /api).',
  })
  @ApiBody({ type: RefreshDto, required: false })
  @ApiOkResponse({ type: RespostaTokenDto })
  @ApiUnauthorizedResponse({ type: ErroDto, description: 'Sessão expirada ou inválida' })
  async refresh(@CorpoJson() corpo: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { dto } = await validarDto(RefreshDto, corpo);
    if (dto.refreshToken) {
      const r = await this.sessoes.renovar(dto.refreshToken, 'TOKEN');
      if (!r) throw sessaoInvalida();
      return {
        tokenType: 'Bearer',
        accessToken: r.acesso,
        expiresIn: this.sessoes.acessoSegundos,
        refreshToken: r.novoRefresh ?? dto.refreshToken,
        refreshExpiresIn: this.sessoes.sessaoSegundos,
        user: UsuariosService.json(r.contexto.usuario, r.contexto.provedor),
      } satisfies RespostaTokenDto;
    }
    const refresh = cookie(req, COOKIE_REFRESH);
    const r = refresh ? await this.sessoes.renovar(refresh, 'COOKIE') : null;
    if (!r) {
      this.sessoes.limparCookies(res, req);
      throw sessaoInvalida();
    }
    this.sessoes.definirCookies(res, req, r.acesso, r.novoRefresh);
    return {
      ok: true,
      expiresIn: this.sessoes.acessoSegundos,
      user: UsuariosService.json(r.contexto.usuario, r.contexto.provedor),
    } satisfies RespostaRenovacaoCookieDto;
  }
}

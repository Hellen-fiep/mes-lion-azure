// =====================================================================
// Menu "Banco" do cabeçalho (backup, exportar, importar, pasta de dados), /api/info, lista/download de
// backups e /healthz — porte do Api/ApiBanco.cs (rotas chamadas pelo frontend; o servidor PowerShell
// original respondia 404 para elas).
// =====================================================================
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { carimbo, contentDisposition, dataIso } from '../../comum/formatos';
import { lerArquivoBanco } from '../../comum/json-estado';
import {
  RespostaHttp,
  TIPO_JSON,
  apiNaoEncontrada,
  enviarJson,
  naoEncontrado,
  somenteAdmin,
} from '../../comum/respostas';
import { CorpoBruto } from '../../comum/validacao';
import { CONFIGURACAO, type ConfiguracaoMes } from '../../configuracao/opcoes';
import { Perfis } from '../../dominio/entidades';
import { EstadoInvalidoError } from '../../dominio/erros';
import { PROVEDOR_PERSISTENCIA, type ProvedorPersistencia } from '../../dominio/repositorios';
import { Plataforma } from '../../plataforma';
import { ArquivosService } from '../arquivos/arquivos.service';
import { enviarArquivo } from '../arquivos/enviar-arquivo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ErroDto } from '../autenticacao/autenticacao.dto';
import { Contexto, Publico, SomenteAdmin } from '../autenticacao/autenticacao.guard';
import type { ContextoAutenticado } from '../autenticacao/sessoes.service';
import { EstadoService } from '../estado/estado.service';
import { InicializacaoService } from '../plataforma/inicializacao.service';
import { RelacionalService } from '../relacional/relacional.service';
import { BackupCriadoDto, BackupListaDto, ImportacaoDto, SaudeDto } from './banco.dto';

const ehLoopback = (ip: string | undefined) =>
  !!ip && (ip === '::1' || ip.startsWith('127.') || ip.startsWith('::ffff:127.'));

@ApiTags('Banco de dados')
@ApiCookieAuth('MESSESSION')
@Controller()
export class BancoController {
  constructor(
    @Inject(CONFIGURACAO) private readonly cfg: ConfiguracaoMes,
    @Inject(PROVEDOR_PERSISTENCIA) private readonly provedor: ProvedorPersistencia,
    private readonly estado: EstadoService,
    private readonly arquivos: ArquivosService,
    private readonly auditoria: AuditoriaService,
    private readonly relacional: RelacionalService,
    private readonly inicializacao: InicializacaoService,
  ) {}

  @Post('api/backup')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cria um backup do estado (menu Banco → Criar backup)' })
  @ApiOkResponse({ type: BackupCriadoDto })
  async backup(@Contexto() ctx: ContextoAutenticado): Promise<BackupCriadoDto> {
    const { backup, caminho } = await this.arquivos.criarBackup('Backup manual (menu Banco)', ctx.usuario);
    await this.auditoria.registrar(ctx.usuario, 'banco', 'BACKUP', String(backup.id));
    return {
      ok: true,
      id: backup.id,
      path: caminho,
      createdAt: dataIso(backup.createdAt),
      sizeBytes: backup.sizeBytes,
      stateVersion: backup.stateVersion,
    };
  }

  @Get('api/export')
  @ApiOperation({
    summary: 'Exporta o banco (formato MES_LION_JSON_DATABASE, compatível com Dados/MES_LION_DATA.json)',
  })
  @ApiProduces('application/json')
  @ApiOkResponse({ description: 'Arquivo MES_LION_BANCO_aaaaMMdd_HHmmss.json (download)' })
  async exportar(@Contexto() ctx: ContextoAutenticado, @Res() res: Response): Promise<void> {
    const bytes = await this.estado.exportar();
    await this.auditoria.registrar(ctx.usuario, 'banco', 'EXPORT', `${bytes.length} bytes`);
    res.status(200).setHeader('Content-Type', TIPO_JSON);
    res.setHeader(
      'Content-Disposition',
      contentDisposition('attachment', `MES_LION_BANCO_${carimbo(new Date())}.json`),
    );
    res.end(bytes);
  }

  @Post('api/import')
  @HttpCode(200)
  @SomenteAdmin()
  @ApiOperation({
    summary: 'Importa um banco (ADMIN)',
    description:
      'Aceita o formato MES_LION_JSON_DATABASE ou um objeto de estado puro. Valida tudo e cria um backup antes de alterar.',
  })
  @ApiConsumes('application/json')
  @ApiBody({
    schema: { type: 'object', example: { format: 'MES_LION_JSON_DATABASE', appStorage: {}, data: { op: [] } } },
  })
  @ApiOkResponse({ type: ImportacaoDto })
  @ApiForbiddenResponse({ type: ErroDto })
  async importar(@CorpoBruto() corpo: Buffer, @Contexto() ctx: ContextoAutenticado): Promise<ImportacaoDto> {
    try {
      lerArquivoBanco(corpo); // valida antes de qualquer alteração
    } catch (e) {
      if (e instanceof EstadoInvalidoError) throw RespostaHttp.erro(400, e.message);
      throw e;
    }
    const { backup } = await this.arquivos.criarBackup('Automático antes de importar banco', ctx.usuario);
    const { resultado: r, chavesKv, formato } = await this.estado.importar(corpo, ctx.usuario);
    await this.auditoria.registrar(
      ctx.usuario,
      'banco',
      'IMPORT',
      formato,
      JSON.stringify({
        backupAnterior: backup.id,
        versao: r.versao,
        colecoes: r.alteradas.length,
        removidas: r.removidas,
        chavesAppStorage: chavesKv,
      }),
    );
    return {
      ok: true,
      formato,
      versao: r.versao,
      colecoesAlteradas: r.alteradas.length,
      colecoesRemovidas: r.removidas.length,
      backupAnterior: backup.id,
    };
  }

  @Post('api/open-data-folder')
  @HttpCode(200)
  @ApiOperation({ summary: 'Abre a pasta de dados no Explorador (somente no próprio PC servidor Windows)' })
  async abrirPasta(@Req() req: Request): Promise<{ ok: boolean; path: string }> {
    const pasta = this.inicializacao.pastaDados;
    if (process.platform !== 'win32' || Plataforma.noAzureAppService || !ehLoopback(req.socket.remoteAddress)) {
      throw RespostaHttp.erro(
        400,
        'Disponível somente no próprio computador servidor (Windows). Pasta de dados: ' + pasta,
      );
    }
    await fs.mkdir(pasta, { recursive: true });
    spawn('explorer.exe', [pasta], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, path: pasta };
  }

  @Get('api/info')
  @ApiOperation({ summary: 'Informações do servidor, do banco e do estado' })
  async info(@Contexto() ctx: ContextoAutenticado) {
    const resumo = await this.provedor.estado.resumo();
    return {
      app: 'MES LION',
      versao: Plataforma.versao,
      plataforma: Plataforma.descricao,
      ambiente: Plataforma.noAzureAppService ? 'Azure App Service' : 'Servidor local',
      servidor: hostname(),
      banco: { provedor: this.provedor.nome, descricao: this.inicializacao.descricaoBancoCurta },
      arquivos: this.arquivos.armazenamento.descricao,
      estado: {
        versao: resumo.versao,
        colecoes: resumo.colecoes,
        bytes: resumo.bytes,
        atualizadoEm: resumo.atualizadoEm ? dataIso(resumo.atualizadoEm) : null,
        atualizadoPor: resumo.atualizadoPor,
      },
      camadaRelacional: this.relacional.status(),
      entraId: this.cfg.opcoes.autenticacao.entraId.habilitado,
      usuario: ctx.usuario.username,
      iniciadoEm: dataIso(Plataforma.iniciadoEm),
    };
  }

  @Get('api/backups')
  @SomenteAdmin()
  @ApiOperation({ summary: 'Lista os backups (ADMIN)' })
  @ApiOkResponse({ type: [BackupListaDto] })
  async backups(): Promise<BackupListaDto[]> {
    return (await this.provedor.backups.listar(200)).map((b) => ({
      id: b.id,
      motivo: b.reason,
      criadoEm: dataIso(b.createdAt),
      criadoPor: b.createdByName,
      bytes: b.sizeBytes,
      versaoEstado: b.stateVersion,
      arquivo: b.storedKey,
    }));
  }

  @Get('api/backups/:id')
  @ApiOperation({ summary: 'Baixa um backup (.json.gz) (ADMIN)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiProduces('application/gzip')
  async baixarBackup(@Req() req: Request, @Res() res: Response, @Contexto() ctx: ContextoAutenticado): Promise<void> {
    const texto = String(req.params.id).trim();
    if (!/^[-+]?\d{1,18}$/.test(texto)) throw apiNaoEncontrada(); // rota {id:long} do original
    if (ctx.usuario.role !== Perfis.Admin) throw somenteAdmin();
    const b = await this.provedor.backups.obter(Number(texto));
    const f = b ? await this.arquivos.armazenamento.abrir(b.storedKey) : null;
    if (!b || !f) throw naoEncontrado();
    await enviarArquivo(res, f, {
      tipo: 'application/gzip',
      nome: path.posix.basename(b.storedKey),
      disposicao: 'attachment',
    });
  }

  @Publico()
  @Get('healthz')
  @ApiTags('Plataforma')
  @ApiOperation({ summary: 'Saúde do servidor e do banco (sem login; usado pelo Azure App Service)' })
  @ApiOkResponse({ type: SaudeDto })
  @ApiServiceUnavailableResponse({ type: SaudeDto })
  async saude(@Res() res: Response): Promise<void> {
    try {
      const v = await this.provedor.estado.obterVersao();
      enviarJson(res, { status: 'ok', banco: this.provedor.nome, versaoEstado: v });
    } catch (e) {
      enviarJson(res, { status: 'erro', banco: this.provedor.nome, erro: (e as Error).message }, 503);
    }
  }
}

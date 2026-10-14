import { All, Controller, Delete, Get, Inject, Put, Req, Res } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { corpoComoTexto, trechoCaminho } from '../../comum/formatos';
import { RespostaHttp, TIPO_JSON, enviarJson, enviarOk } from '../../comum/respostas';
import { CorpoBruto } from '../../comum/validacao';
import { EstadoInvalidoError } from '../../dominio/erros';
import { PROVEDOR_PERSISTENCIA, type ProvedorPersistencia } from '../../dominio/repositorios';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { Contexto } from '../autenticacao/autenticacao.guard';
import type { ContextoAutenticado } from '../autenticacao/sessoes.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { EstadoService, vazio } from './estado.service';

export const CHAVE_ESTADO = 'MES_LION_DATA';

/** Chave do localStorage a partir do caminho ORIGINAL (decodificado uma vez, inclusive %2F). */
function chaveDaRota(req: Request): string {
  const bruta = trechoCaminho(req.originalUrl, '/api/storage/');
  if (bruta !== null) return bruta;
  const p = (req.params as Record<string, string | string[]>).chave;
  return Array.isArray(p) ? p.join('/') : (p ?? '');
}

/**
 * /api/bootstrap e /api/storage — persistência do estado do MES e do localStorage do frontend.
 * Contrato idêntico ao MES_LION_SERVER.ps1: {data, appStorage, user}; PUT /api/storage/MES_LION_DATA.
 */
@ApiTags('Estado do MES')
@ApiCookieAuth('MESSESSION')
@Controller('api')
export class EstadoController {
  constructor(
    @Inject(PROVEDOR_PERSISTENCIA) private readonly provedor: ProvedorPersistencia,
    private readonly estado: EstadoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @All('bootstrap')
  @ApiOperation({
    summary: 'Carga inicial do frontend',
    description:
      'Estado completo do MES (exatamente como gravado; null se vazio), chaves do localStorage e usuário da sessão.',
  })
  @ApiOkResponse({
    schema: {
      example: { data: { op: [], materiais: [] }, appStorage: { MES_LION_LEGACY_MIGRATIONS: 'done-v39.5' }, user: {} },
    },
  })
  async bootstrap(@Contexto() ctx: ContextoAutenticado, @Res() res: Response): Promise<void> {
    const montado = await this.estado.obter();
    const kv = await this.provedor.kv.listar();
    const corpo = Buffer.concat([
      Buffer.from('{"data":'),
      vazio(montado) ? Buffer.from('null') : montado.json, // estado vazio: o frontend inicializa com js/data.js e grava
      Buffer.from(
        `,"appStorage":${JSON.stringify(kv)},"user":${JSON.stringify(UsuariosService.json(ctx.usuario, ctx.provedor))}}`,
        'utf8',
      ),
    ]);
    res.status(200).setHeader('Content-Type', TIPO_JSON);
    res.setHeader('Cache-Control', 'no-store');
    res.end(corpo);
  }

  @Get('storage')
  @ApiOperation({
    summary: 'localStorage do servidor',
    description: 'Chaves do localStorage + MES_LION_DATA (estado como texto JSON).',
  })
  async listar(@Res() res: Response): Promise<void> {
    const kv = await this.provedor.kv.listar();
    const montado = await this.estado.obter();
    enviarJson(res, { ...kv, [CHAVE_ESTADO]: vazio(montado) ? '{}' : montado.json.toString('utf8') });
  }

  @Put('storage/*chave')
  @ApiOperation({
    summary: 'Grava o estado do MES ou uma chave do localStorage',
    description:
      'Chave MES_LION_DATA: o corpo é o estado completo (JSON, pode vir com Content-Encoding: gzip). O servidor grava só as ' +
      'coleções alteradas, remove as ausentes e registra SAVE_STATE no histórico. Outras chaves: o corpo é o valor (texto).',
  })
  @ApiParam({ name: 'chave', example: CHAVE_ESTADO })
  @ApiConsumes('application/json', 'text/plain')
  @ApiBody({ schema: { type: 'object', example: { op: [], materiais: [], meta: {} } } })
  @ApiOkResponse({ schema: { type: 'string', example: 'OK' } })
  async gravar(
    @Req() req: Request,
    @Res() res: Response,
    @Contexto() ctx: ContextoAutenticado,
    @CorpoBruto() corpo: Buffer,
  ): Promise<void> {
    const chave = chaveDaRota(req);
    if (chave === CHAVE_ESTADO) {
      let r;
      try {
        r = await this.estado.gravar(corpo, ctx.usuario);
      } catch (e) {
        if (e instanceof EstadoInvalidoError) throw RespostaHttp.erro(400, e.message);
        throw e;
      }
      await this.auditoria.registrar(
        ctx.usuario,
        'app',
        'SAVE_STATE',
        CHAVE_ESTADO,
        EstadoService.descreverAlteracoes(r),
      );
      return enviarOk(res);
    }
    await this.provedor.kv.definir(chave, corpoComoTexto(corpo));
    enviarOk(res);
  }

  /** O servidor PowerShell não implementava DELETE (404). Aqui: remove só chaves do localStorage; o estado nunca é apagado. */
  @Delete('storage/*chave')
  @ApiOperation({ summary: 'Remove uma chave do localStorage (MES_LION_DATA nunca é apagado)' })
  @ApiParam({ name: 'chave' })
  async remover(@Req() req: Request, @Res() res: Response): Promise<void> {
    const chave = chaveDaRota(req);
    if (chave !== CHAVE_ESTADO) await this.provedor.kv.remover(chave);
    enviarOk(res);
  }

  @Delete('storage')
  @ApiOperation({ summary: 'Limpa o localStorage do servidor (registra CLEAR_STORAGE)' })
  async limpar(@Res() res: Response, @Contexto() ctx: ContextoAutenticado): Promise<void> {
    await this.provedor.kv.limpar();
    await this.auditoria.registrar(ctx.usuario, 'app', 'CLEAR_STORAGE', 'app_storage');
    enviarOk(res);
  }
}

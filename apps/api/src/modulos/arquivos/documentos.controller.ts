import { All, Controller, Get, HttpCode, Post, Req, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { comoTexto, dataIso, escaparDados, guidN, lerGuid, textoDe, trechoCaminho } from '../../comum/formatos';
import { extensao, tipoPorNome } from '../../comum/mime';
import { RespostaHttp, apiNaoEncontrada, naoEncontrado } from '../../comum/respostas';
import { CorpoJson, validarDto } from '../../comum/validacao';
import type { DocumentoEquipamento } from '../../dominio/entidades';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { Contexto } from '../autenticacao/autenticacao.guard';
import type { ContextoAutenticado } from '../autenticacao/sessoes.service';
import { AnexoCriadoDto, AnexoDto, DocumentoDto, UploadDocumentoDto } from './arquivos.dto';
import { ArquivosService, EXTENSOES_DOCUMENTO } from './arquivos.service';
import { enviarArquivo } from './enviar-arquivo';

const LIMITE_ANEXO = 50 * 1024 * 1024;

const linha = (d: DocumentoEquipamento): DocumentoDto => ({
  id: d.id,
  equipment_code: d.equipmentCode,
  original_name: d.originalName,
  mime_type: d.mimeType,
  file_size: d.fileSize,
  document_type: d.documentType,
  revision: d.revision,
  active: d.active,
  uploaded_at: dataIso(d.uploadedAt),
});

/** Base64 estrito (Convert.FromBase64String do .NET: ignora espaços, exige múltiplo de 4 e preenchimento correto). */
function decodificarBase64(texto: string): Buffer | null {
  const limpo = texto.replace(/[ \t\r\n]/g, '');
  if (limpo.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(limpo)) return null;
  return Buffer.from(limpo, 'base64');
}

/** Documentos controlados dos equipamentos (PDF/XLS/XLSX) e anexos de cadastros. */
@ApiTags('Documentos e anexos')
@ApiCookieAuth('MESSESSION')
@Controller('api')
export class DocumentosController {
  constructor(
    private readonly arquivos: ArquivosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Código do equipamento a partir do caminho ORIGINAL (decodificado uma vez, inclusive %2F), como no original. */
  private codigo(req: Request): string {
    const c = trechoCaminho(req.originalUrl, '/api/equipment/', '/documents');
    if (!c) throw apiNaoEncontrada();
    return c;
  }

  @Get('equipment/*resto')
  @ApiOperation({
    summary: 'Documentos ativos de um equipamento (mais recente primeiro)',
    description: 'Rota: /api/equipment/{código}/documents',
  })
  @ApiParam({ name: 'resto', description: '{código codificado}/documents', example: '10/documents' })
  @ApiOkResponse({ type: [DocumentoDto] })
  async listar(@Req() req: Request): Promise<DocumentoDto[]> {
    return (await this.arquivos.listarDocumentos(this.codigo(req))).map(linha);
  }

  @Post('equipment/*resto')
  @HttpCode(200)
  @UseInterceptors(AnyFilesInterceptor()) // limites e charset UTF-8 dos nomes: MulterModule em arquivos.module.ts
  @ApiOperation({
    summary: 'Envia um documento (PDF/XLS/XLSX) para um equipamento',
    description: 'Rota: /api/equipment/{código}/documents',
  })
  @ApiParam({ name: 'resto', example: '10/documents' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadDocumentoDto })
  @ApiOkResponse({ schema: { example: { id: '0f8fad5b-d9cb-469f-a165-70867728950e' } } })
  async enviar(
    @Req() req: Request,
    @UploadedFiles() arquivos: Express.Multer.File[] | undefined,
    @Contexto() ctx: ContextoAutenticado,
  ): Promise<{ id: string }> {
    const codigo = this.codigo(req);
    if (codigo.length > 100) throw RespostaHttp.erro(400, 'Código de equipamento muito longo (máx. 100).');
    const arquivo = (arquivos ?? []).find((a) => a.fieldname === 'file');
    if (!arquivo) throw RespostaHttp.erro(400, 'Arquivo obrigatório');
    const nome = arquivo.originalname.replace(/\\/g, '/').split('/').pop() ?? '';
    if (!EXTENSOES_DOCUMENTO.includes(extensao(nome))) throw RespostaHttp.erro(400, 'Somente PDF/XLS/XLSX');
    const campos = (req.body ?? {}) as Record<string, unknown>;
    // Como o form["campo"].ToString() do .NET: ausente → "", repetido → valores separados por vírgula.
    const campo = (n: string): string => {
      const v = campos[n];
      return Array.isArray(v) ? v.map(comoTexto).join(',') : comoTexto(v);
    };
    const d = await this.arquivos.salvarDocumento(
      codigo,
      nome,
      arquivo.buffer,
      campo('documentType'),
      campo('revision'),
      ctx.usuario,
    );
    await this.auditoria.registrar(ctx.usuario, 'equipamentos', 'UPLOAD_DOCUMENT', codigo);
    return { id: d.id };
  }

  @All('documents/:id')
  @ApiOperation({ summary: 'Baixa/abre um documento de equipamento (inline)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async documento(@Req() req: Request, @Res() res: Response): Promise<void> {
    const id = lerGuid(String(req.params.id));
    if (!id) throw apiNaoEncontrada();
    const r = await this.arquivos.abrirDocumento(id);
    if (!r) throw naoEncontrado();
    await enviarArquivo(res, r.arquivo, {
      tipo: r.doc.mimeType ?? tipoPorNome(r.doc.originalName),
      nome: r.doc.originalName,
      disposicao: 'inline',
      cache: 'no-store',
    });
  }

  /** Anexos de cadastros (contrato do MES V40: {scope, recordId, name, mime, dataBase64} → {url, path}). */
  @Post('attachments')
  @HttpCode(200)
  @ApiOperation({ summary: 'Envia um anexo de cadastro (base64)' })
  @ApiBody({ type: AnexoDto })
  @ApiOkResponse({ type: AnexoCriadoDto })
  async anexar(@CorpoJson() corpo: unknown, @Contexto() ctx: ContextoAutenticado): Promise<AnexoCriadoDto> {
    const { dto } = await validarDto(AnexoDto, corpo);
    const base64 = textoDe(corpo, 'dataBase64');
    if (!base64) throw RespostaHttp.erro(400, 'Arquivo obrigatório (dataBase64).');
    const dados = decodificarBase64(base64);
    if (!dados) throw RespostaHttp.erro(400, 'Conteúdo do arquivo inválido (base64).');
    if (dados.length > LIMITE_ANEXO) throw RespostaHttp.erro(400, 'Arquivo excede 50 MB.');
    const a = await this.arquivos.salvarAnexo(
      dto.scope ?? 'geral',
      dto.recordId ?? '',
      dto.name ?? 'arquivo',
      dto.mime ?? null,
      dados,
      ctx.usuario,
    );
    await this.auditoria.registrar(
      ctx.usuario,
      'anexos',
      'UPLOAD_ATTACHMENT',
      `${a.scope}/${a.recordId}/${a.originalName}`,
    );
    return {
      id: a.id,
      url: `/api/attachments/${guidN(a.id)}/${escaparDados(a.originalName)}`,
      path: `${a.scope}/${a.recordId}/${a.originalName}`,
      name: a.originalName,
      size: a.fileSize,
    };
  }

  @Get('attachments/:id{/*nome}')
  @ApiOperation({ summary: 'Baixa/abre um anexo (inline)' })
  @ApiParam({ name: 'id', description: 'Id do anexo (com ou sem hífens)' })
  async anexo(@Req() req: Request, @Res() res: Response): Promise<void> {
    const id = lerGuid(String(req.params.id));
    if (!id) throw naoEncontrado();
    const r = await this.arquivos.abrirAnexo(id);
    if (!r) throw naoEncontrado();
    await enviarArquivo(res, r.arquivo, {
      tipo: r.anexo.mimeType ?? tipoPorNome(r.anexo.originalName),
      nome: r.anexo.originalName,
      disposicao: 'inline',
      cache: 'no-store',
    });
  }
}

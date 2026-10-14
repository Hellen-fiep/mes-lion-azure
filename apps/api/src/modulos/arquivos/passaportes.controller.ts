import { networkInterfaces } from 'node:os';
import { Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { escaparDados } from '../../comum/formatos';
import { RespostaHttp } from '../../comum/respostas';
import { CorpoJson, validarDto } from '../../comum/validacao';
import { CONFIGURACAO, type ConfiguracaoMes } from '../../configuracao/opcoes';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { Contexto, Publico } from '../autenticacao/autenticacao.guard';
import type { ContextoAutenticado } from '../autenticacao/sessoes.service';
import { PublicarPassaporteDto } from './arquivos.dto';
import { ArquivosService, idPassaporteSeguro } from './arquivos.service';
import { enviarArquivo } from './enviar-arquivo';

/** Primeiro IPv4 da rede local (para o QR do passaporte quando o MES é aberto por localhost). */
export function ipRedeLocal(): string | null {
  try {
    for (const lista of Object.values(networkInterfaces())) {
      for (const a of lista ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  } catch {
    // sem interfaces
  }
  return null;
}

/** URL pública para o QR: configurada, ou a do pedido (trocando localhost pelo IP da rede local). */
export function urlBasePublica(req: Request, configurada: string): string {
  if (configurada.trim()) return configurada.trim().replace(/\/+$/, '');
  const host = req.headers.host ?? 'localhost';
  let nome = host;
  let porta = '';
  const m = /^(\[[^\]]*\]|[^:]+)(?::(\d+))?$/.exec(host);
  if (m) {
    nome = m[1];
    porta = m[2] ? ':' + m[2] : '';
  }
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(nome.toLowerCase())) nome = ipRedeLocal() ?? nome;
  return `${req.protocol}://${nome}${porta}`;
}

/** Publicação do dashboard HTML do passaporte (contrato MES V40.4.4: {id, html} → {url}) e página pública do QR. */
@ApiTags('Passaporte de bateria')
@Controller()
export class PassaportesController {
  constructor(
    @Inject(CONFIGURACAO) private readonly cfg: ConfiguracaoMes,
    private readonly arquivos: ArquivosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Post('api/passport-publish')
  @HttpCode(200)
  @ApiCookieAuth('MESSESSION')
  @ApiOperation({ summary: 'Publica o dashboard HTML do passaporte (página pública para o QR)' })
  @ApiBody({ type: PublicarPassaporteDto })
  @ApiOkResponse({
    schema: { example: { ok: true, id: 'BP-0001', url: 'https://meslion.azurewebsites.net/passaporte/BP-0001.html' } },
  })
  async publicar(@CorpoJson() corpo: unknown, @Req() req: Request, @Contexto() ctx: ContextoAutenticado) {
    const { dto } = await validarDto(PublicarPassaporteDto, corpo);
    const id = idPassaporteSeguro(dto.id);
    if (!id) throw RespostaHttp.erro(400, 'Passaporte sem ID.');
    if (!dto.html) throw RespostaHttp.erro(400, 'HTML do dashboard ausente.');
    await this.arquivos.publicarPassaporte(id, dto.html, ctx.usuario);
    const url = `${urlBasePublica(req, this.cfg.opcoes.publicacao.urlBasePublica)}/passaporte/${escaparDados(id)}.html`;
    await this.auditoria.registrar(ctx.usuario, 'passaporte', 'PUBLISH_HTML', id);
    return { ok: true, id, url };
  }

  /** Página pública do passaporte (lida pelo QR code — sem login). */
  @Publico()
  @Get('passaporte/:arquivo')
  @ApiOperation({ summary: 'Página pública do passaporte publicado (sem login)' })
  @ApiParam({ name: 'arquivo', example: 'BP-0001.html' })
  async pagina(@Param('arquivo') arquivo: string, @Res() res: Response): Promise<void> {
    const id = idPassaporteSeguro(arquivo.toLowerCase().endsWith('.html') ? arquivo.slice(0, -5) : arquivo);
    const f = id ? await this.arquivos.abrirPassaporte(id) : null;
    if (!f) throw RespostaHttp.texto(404, 'Passaporte não publicado.');
    await enviarArquivo(res, f, { tipo: 'text/html; charset=utf-8', cache: 'no-cache' });
  }
}

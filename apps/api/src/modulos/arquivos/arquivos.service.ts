// =====================================================================
// Documentos de equipamentos, anexos de cadastros, passaportes publicados e backups do estado
// (porte do Infra/ServicoArquivos.cs).
// =====================================================================
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { carimbo, cortar, guidN } from '../../comum/formatos';
import { extensao, tipoPorNome } from '../../comum/mime';
import type { Anexo, BackupEstado, DocumentoEquipamento, PassaportePublicado, Usuario } from '../../dominio/entidades';
import { PROVEDOR_PERSISTENCIA, type ProvedorPersistencia } from '../../dominio/repositorios';
import {
  ARMAZENAMENTO_ARQUIVOS,
  type ArmazenamentoArquivos,
  type ArquivoLido,
  nomeSeguro,
} from '../../infra/arquivos/armazenamento';
import { EstadoService } from '../estado/estado.service';

const gzipAsync = promisify(gzip);

export const EXTENSOES_DOCUMENTO = ['.pdf', '.xlsx', '.xls'];

/** Id de passaporte seguro para nome de arquivo e URL (letras, dígitos, "-", "_", "."). */
export function idPassaporteSeguro(id: string | null | undefined): string {
  let s = '';
  const t = (id ?? '').trim();
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    s += /[\p{L}\p{Nd}]/u.test(ch) || ch === '-' || ch === '_' || ch === '.' ? ch : '_';
  }
  s = s.replace(/^\.+|\.+$/g, '');
  return s.length > 120 ? s.slice(0, 120) : s;
}

@Injectable()
export class ArquivosService {
  private readonly log = new Logger('MesLion.Arquivos');

  constructor(
    @Inject(PROVEDOR_PERSISTENCIA) private readonly provedor: ProvedorPersistencia,
    @Inject(ARMAZENAMENTO_ARQUIVOS) readonly armazenamento: ArmazenamentoArquivos,
    private readonly estado: EstadoService,
  ) {}

  // ------------------------------------------------------------------ documentos de equipamentos
  async salvarDocumento(
    codigo: string,
    nomeOriginal: string,
    conteudo: Buffer,
    tipoDocumento: string | null,
    revisao: string | null,
    u: Usuario,
  ): Promise<DocumentoEquipamento> {
    const armazenado = randomUUID() + extensao(nomeOriginal);
    const tipo = tipoPorNome(nomeOriginal);
    await this.armazenamento.salvar('documentos/' + armazenado, conteudo, tipo);
    const d: DocumentoEquipamento = {
      id: randomUUID(),
      equipmentCode: codigo,
      originalName: nomeOriginal,
      storedName: armazenado,
      mimeType: tipo,
      fileSize: conteudo.length,
      documentType: cortar(tipoDocumento, 80),
      revision: cortar(revisao, 40),
      active: true,
      uploadedAt: new Date(),
      uploadedBy: u.id,
    };
    await this.provedor.documentos.inserir(d);
    return d;
  }

  listarDocumentos(codigo: string): Promise<DocumentoEquipamento[]> {
    return this.provedor.documentos.listarPorEquipamento(codigo);
  }

  async abrirDocumento(id: string): Promise<{ doc: DocumentoEquipamento; arquivo: ArquivoLido } | null> {
    const doc = await this.provedor.documentos.obter(id);
    if (!doc || !doc.active) return null;
    const arquivo = await this.armazenamento.abrir('documentos/' + doc.storedName);
    return arquivo ? { doc, arquivo } : null;
  }

  // ------------------------------------------------------------------ anexos (/api/attachments)
  async salvarAnexo(
    escopo: string,
    registro: string,
    nome: string,
    mime: string | null,
    dados: Buffer,
    u: Usuario,
  ): Promise<Anexo> {
    const id = randomUUID();
    const seguro = nomeSeguro(nome);
    const chave = `anexos/${guidN(id)}/${seguro}`;
    const tipo = mime && mime.trim() ? mime : tipoPorNome(seguro);
    await this.armazenamento.salvar(chave, dados, tipo);
    const a: Anexo = {
      id,
      scope: cortar(escopo, 100),
      recordId: cortar(registro, 200),
      originalName: seguro,
      storedKey: chave,
      mimeType: mime && mime.trim() ? cortar(mime, 200) : tipoPorNome(seguro),
      fileSize: dados.length,
      uploadedAt: new Date(),
      uploadedBy: u.id,
    };
    await this.provedor.anexos.inserir(a);
    return a;
  }

  async abrirAnexo(id: string): Promise<{ anexo: Anexo; arquivo: ArquivoLido } | null> {
    const anexo = await this.provedor.anexos.obter(id);
    if (!anexo) return null;
    const arquivo = await this.armazenamento.abrir(anexo.storedKey);
    return arquivo ? { anexo, arquivo } : null;
  }

  // ------------------------------------------------------------------ passaporte publicado (/api/passport-publish)
  async publicarPassaporte(id: string, html: string, u: Usuario): Promise<PassaportePublicado> {
    const bytes = Buffer.from(html, 'utf8');
    const chave = `passaportes/${id}.html`;
    await this.armazenamento.salvar(chave, bytes, 'text/html; charset=utf-8');
    const p: PassaportePublicado = {
      id,
      storedKey: chave,
      sizeBytes: bytes.length,
      publishedAt: new Date(),
      publishedBy: u.id,
    };
    await this.provedor.passaportes.salvar(p);
    return p;
  }

  async abrirPassaporte(id: string): Promise<ArquivoLido | null> {
    const p = await this.provedor.passaportes.obter(id);
    return p ? this.armazenamento.abrir(p.storedKey) : null;
  }

  // ------------------------------------------------------------------ backups (/api/backup)
  async criarBackup(motivo: string, u: Usuario | null): Promise<{ backup: BackupEstado; caminho: string }> {
    const conteudo = await this.estado.exportar();
    const versao = (await this.estado.obter()).versao;
    // Nome único mesmo com dois backups no mesmo segundo (ex.: backup manual seguido de importação).
    const nome = `MES_LION_BACKUP_${carimbo(new Date(), true)}_v${versao}_${randomUUID().replace(/-/g, '').slice(0, 6)}.json.gz`;
    const compactado = await gzipAsync(conteudo);
    const chave = 'backups/' + nome;
    await this.armazenamento.salvar(chave, compactado, 'application/gzip');
    const dados = {
      storedKey: chave,
      reason: cortar(motivo, 200),
      sizeBytes: compactado.length,
      stateVersion: versao,
      createdAt: new Date(),
      createdBy: u?.id ?? null,
      createdByName: u?.username ?? null,
    };
    const id = await this.provedor.backups.inserir(dados);
    const raiz = this.armazenamento.raizLocal;
    const caminho = raiz ? path.join(raiz, 'backups', nome) : `${this.armazenamento.descricao}/backups/${nome}`;
    this.log.log(`Backup ${id} criado (${motivo}): ${caminho}`);
    return { backup: { ...dados, id }, caminho };
  }
}

// =====================================================================
// Importa o pacote gerado por ferramentas/EXPORTAR_DADOS_POSTGRESQL.ps1 (MES LION PowerShell/PostgreSQL):
// estado (app_state), app_storage, usuários (com hash bcrypt), auditoria e documentos de equipamentos.
// Preserva os IDs de usuários e documentos (as OPs referenciam documentos pelo ID). Porte do
// Migracao/ImportadorPostgreSql.cs — mesmo relatório e mesmas regras de proteção (--sobrescrever).
// =====================================================================
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { carimbo, lerGuid } from '../../comum/formatos';
import type { Usuario } from '../../dominio/entidades';
import { PROVEDOR_PERSISTENCIA, type ProvedorPersistencia } from '../../dominio/repositorios';
import { ARMAZENAMENTO_ARQUIVOS, type ArmazenamentoArquivos } from '../../infra/arquivos/armazenamento';
import { ArquivosService } from '../arquivos/arquivos.service';
import { EstadoService } from '../estado/estado.service';

type Json = Record<string, unknown>;

/** Texto da propriedade (string → ela mesma; outros tipos → o JSON; null/ausente → null). */
function s(e: unknown, nome: string): string | null {
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return null;
  const v = (e as Json)[nome];
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function b(e: unknown, nome: string, padrao: boolean): boolean {
  if (typeof e !== 'object' || e === null || !(nome in e)) return padrao;
  const v = (e as Json)[nome];
  if (v === true || v === false) return v;
  if (typeof v === 'string') return ['t', 'true', '1', 'True'].includes(v);
  if (typeof v === 'number') return v !== 0;
  return padrao;
}

function n(e: unknown, nome: string): number | null {
  if (typeof e !== 'object' || e === null) return null;
  const v = (e as Json)[nome];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Data com fuso (ou hora local quando o texto não tem fuso), como o DateTimeOffset.TryParse(AssumeLocal). */
function d(e: unknown, nome: string): Date | null {
  const t = s(e, nome);
  if (!t) return null;
  const data = new Date(t.trim());
  return Number.isNaN(data.getTime()) ? null : data;
}

async function lerTexto(arquivo: string): Promise<string> {
  let t = await fs.readFile(arquivo, 'utf8');
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return t.trim();
}

async function lerLista(arquivo: string): Promise<unknown[]> {
  if (!existsSync(arquivo)) return [];
  const t = await lerTexto(arquivo);
  if (!t) return [];
  const v = JSON.parse(t) as unknown;
  return Array.isArray(v) ? (v as unknown[]) : [];
}

async function lerKv(arquivo: string): Promise<Record<string, string>> {
  const kv: Record<string, string> = {};
  const t = await lerTexto(arquivo);
  if (!t) return kv;
  const v = JSON.parse(t) as unknown;
  if (Array.isArray(v)) {
    for (const e of v) {
      const k = s(e, 'key');
      if (k !== null) kv[k] = s(e, 'value') ?? '';
    }
  } else if (typeof v === 'object' && v !== null) {
    for (const [k, x] of Object.entries(v as Json)) kv[k] = typeof x === 'string' ? x : JSON.stringify(x);
  }
  return kv;
}

const milhar = (x: number) => x.toLocaleString('pt-BR');

@Injectable()
export class ImportadorPostgresqlService {
  private readonly log = new Logger('MesLion.Migracao');

  constructor(
    @Inject(PROVEDOR_PERSISTENCIA) private readonly p: ProvedorPersistencia,
    @Inject(ARMAZENAMENTO_ARQUIVOS) private readonly armazenamento: ArmazenamentoArquivos,
    private readonly estado: EstadoService,
    private readonly arquivos: ArquivosService,
  ) {}

  async importar(pastaInformada: string, sobrescrever: boolean): Promise<string> {
    const pasta = path.resolve(pastaInformada);
    const linhas: string[] = [];
    const linha = (t: string) => {
      linhas.push(t);
      this.log.log(t);
    };
    const agora = new Date();
    linha(`MES LION — importação do pacote PostgreSQL (${agora.toLocaleString('pt-BR')})`);
    linha(`Pasta: ${pasta}`);
    linha(`Destino: ${this.p.descricao} | Arquivos: ${this.armazenamento.descricao}`);

    const arqEstado = path.join(pasta, 'estado.json');
    if (!existsSync(arqEstado))
      throw new Error(`Arquivo estado.json não encontrado no pacote de migração (${arqEstado}).`);

    const resumo = await this.p.estado.resumo();
    if (resumo.colecoes > 0 && !sobrescrever) {
      // O banco já tem estado (por exemplo, o seed inicial carregado na primeira execução). Só é seguro
      // substituir se o conteúdo atual ainda é o seed (versão 1, sem gravações de usuários).
      if (resumo.versao > 1 || resumo.atualizadoPor !== null) {
        throw new Error(
          'O banco de destino já possui dados gravados pelo MES. Para substituir, execute novamente com --sobrescrever ' +
            '(um backup do estado atual será criado antes).',
        );
      }
    }
    if (resumo.colecoes > 0) {
      const { backup, caminho } = await this.arquivos.criarBackup('Automático antes da migração do PostgreSQL', null);
      linha(`Backup do estado anterior: #${backup.id} (${caminho})`);
    }

    // ------------------------------------------------------------- usuários
    const mapaUsuarios = new Map<string, string>();
    let uNovos = 0;
    let uAtualizados = 0;
    for (const e of await lerLista(path.join(pasta, 'usuarios.json'))) {
      const idPg = s(e, 'id');
      const username = s(e, 'username') ?? '';
      if (!username.trim()) continue;
      const existente = await this.p.usuarios.porUsername(username);
      const u: Usuario = existente ?? {
        id: lerGuid(idPg) ?? randomUUID(),
        username,
        fullName: '',
        passwordHash: '',
        role: 'USER',
        active: true,
        authProvider: 'LOCAL',
        externalId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      u.username = username;
      u.fullName = s(e, 'full_name') ?? username;
      u.passwordHash = s(e, 'password_hash') ?? '';
      u.role = s(e, 'role') ?? 'USER';
      u.active = b(e, 'active', true);
      u.authProvider = 'LOCAL';
      u.createdAt = d(e, 'created_at') ?? new Date();
      u.updatedAt = d(e, 'updated_at') ?? new Date();
      if (!existente) {
        if (await this.p.usuarios.porId(u.id)) u.id = randomUUID();
        await this.p.usuarios.inserir(u);
        uNovos++;
      } else {
        await this.p.usuarios.atualizar(u);
        uAtualizados++;
      }
      if (idPg !== null) mapaUsuarios.set(idPg.toLowerCase(), u.id);
    }
    linha(
      `Usuários: ${uNovos} importados, ${uAtualizados} atualizados (senhas preservadas — hash bcrypt do PostgreSQL).`,
    );

    // ------------------------------------------------------------- estado + app_storage
    const bytes = await fs.readFile(arqEstado);
    const { resultado: r, chavesKv, formato } = await this.estado.importar(bytes, null);
    linha(
      `Estado do MES: formato ${formato}, ${r.alteradas.length} coleções gravadas, ${r.removidas.length} removidas, ${milhar(bytes.length)} bytes. Versão ${r.versao}.`,
    );
    const arqKv = path.join(pasta, 'app_storage.json');
    if (existsSync(arqKv)) {
      const kv = await lerKv(arqKv);
      await this.p.kv.substituirTudo(kv);
      linha(`app_storage: ${Object.keys(kv).length} chaves.`);
    } else if (chavesKv > 0) linha(`app_storage: ${chavesKv} chaves (do arquivo de estado).`);

    // ------------------------------------------------------------- auditoria
    let aud = 0;
    for (const e of await lerLista(path.join(pasta, 'auditoria.json'))) {
      const idUsuario = s(e, 'user_id');
      const detalhesBrutos = typeof e === 'object' && e !== null ? (e as Json).details : undefined;
      const detalhes =
        detalhesBrutos === undefined || detalhesBrutos === null
          ? '{}'
          : typeof detalhesBrutos === 'string'
            ? detalhesBrutos
            : JSON.stringify(detalhesBrutos);
      await this.p.auditoria.registrar({
        userId: idUsuario ? (mapaUsuarios.get(idUsuario.toLowerCase()) ?? null) : null,
        username: s(e, 'username'),
        module: s(e, 'module') ?? '',
        action: s(e, 'action') ?? '',
        recordKey: s(e, 'record_key'),
        changedAt: d(e, 'changed_at') ?? new Date(),
        detailsJson: detalhes.trim() ? detalhes : '{}',
      });
      aud++;
    }
    linha(`Histórico de modificações (audit_log): ${aud} registros.`);

    // ------------------------------------------------------------- documentos de equipamentos
    let docs = 0;
    let semArquivo = 0;
    let jaExistentes = 0;
    const pastaUploads = path.join(pasta, 'uploads');
    for (const e of await lerLista(path.join(pasta, 'documentos.json'))) {
      const id = lerGuid(s(e, 'id'));
      if (!id) continue;
      if (await this.p.documentos.obter(id)) {
        jaExistentes++;
        continue;
      }
      const armazenadoOriginal = s(e, 'stored_name') ?? '';
      const armazenado = path.basename(armazenadoOriginal.replace(/\\/g, '/'));
      const origem = path.join(pastaUploads, armazenado);
      if (!armazenado || !existsSync(origem)) {
        semArquivo++;
        linha(`  ! Documento ${id} sem arquivo em uploads/ (${armazenadoOriginal}).`);
        continue;
      }
      await this.armazenamento.salvar('documentos/' + armazenado, createReadStream(origem), s(e, 'mime_type'));
      const idPor = s(e, 'uploaded_by');
      await this.p.documentos.inserir({
        id,
        equipmentCode: s(e, 'equipment_code') ?? '',
        originalName: s(e, 'original_name') ?? armazenadoOriginal,
        storedName: armazenado,
        mimeType: s(e, 'mime_type'),
        fileSize: n(e, 'file_size') ?? (await fs.stat(origem)).size,
        documentType: s(e, 'document_type'),
        revision: s(e, 'revision'),
        active: b(e, 'active', true),
        uploadedAt: d(e, 'uploaded_at') ?? new Date(),
        uploadedBy: idPor ? (mapaUsuarios.get(idPor.toLowerCase()) ?? null) : null,
      });
      docs++;
    }
    linha(`Documentos de equipamentos: ${docs} importados, ${jaExistentes} já existentes, ${semArquivo} sem arquivo.`);
    linha('Importação concluída.');

    const relatorio = linhas.join('\n') + '\n';
    try {
      await fs.writeFile(path.join(pasta, `relatorio_importacao_${carimbo(new Date())}.txt`), relatorio, 'utf8');
    } catch (e) {
      this.log.warn(`Não foi possível gravar o relatório na pasta do pacote: ${(e as Error).message}`);
    }
    this.estado.invalidarCache();
    return relatorio;
  }
}

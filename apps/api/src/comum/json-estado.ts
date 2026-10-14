// =====================================================================
// Documento de estado do MES (o objeto "data" do frontend) — porte do Estado/JsonEstado.cs.
// O JSON é dividido por coleção de nível superior SEM reserializar os valores: cada coleção é
// guardada exatamente com os bytes enviados pelo navegador (o bootstrap devolve o mesmo conteúdo).
// A leitura valida o JSON inteiro (RFC 8259, sem vírgulas sobrando nem comentários, profundidade
// máxima 2048, UTF-8 válido), como o Utf8JsonReader do .NET.
// =====================================================================
import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { ColecaoRecebida } from '../dominio/entidades';
import { EstadoInvalidoError } from '../dominio/erros';

export const PROFUNDIDADE_MAXIMA = 2048;

/** Erro de sintaxe JSON (posição em bytes). */
export class ErroSintaxeJson extends Error {
  constructor(mensagem: string, posicao: number) {
    super(`${mensagem} (byte ${posicao})`);
    this.name = 'ErroSintaxeJson';
  }
}

const ASPAS = 0x22;
const BARRA_INVERTIDA = 0x5c;
const ABRE_CHAVE = 0x7b;
const FECHA_CHAVE = 0x7d;
const ABRE_COLCHETE = 0x5b;
const FECHA_COLCHETE = 0x5d;
const VIRGULA = 0x2c;
const DOIS_PONTOS = 0x3a;
const MENOS = 0x2d;

const LITERAIS: Record<number, number[]> = {
  0x74: [0x74, 0x72, 0x75, 0x65], // true
  0x66: [0x66, 0x61, 0x6c, 0x73, 0x65], // false
  0x6e: [0x6e, 0x75, 0x6c, 0x6c], // null
};

const ehDigito = (c: number) => c >= 0x30 && c <= 0x39;
const ehHex = (c: number) => (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);

/** Tipo do valor JSON pelo primeiro byte. */
export type TipoValorJson = 'objeto' | 'lista' | 'texto' | 'numero' | 'logico' | 'nulo';

export function tipoPeloByte(c: number): TipoValorJson {
  switch (c) {
    case ABRE_CHAVE:
      return 'objeto';
    case ABRE_COLCHETE:
      return 'lista';
    case ASPAS:
      return 'texto';
    case 0x74:
    case 0x66:
      return 'logico';
    case 0x6e:
      return 'nulo';
    default:
      return 'numero';
  }
}

/**
 * Leitor de JSON sobre bytes UTF-8 com validação completa e posições em bytes (para recortar os
 * valores brutos). Não monta objetos: só percorre e valida.
 */
export class LeitorJson {
  pos: number;

  constructor(
    readonly b: Uint8Array,
    inicio = 0,
    readonly fim = b.length,
  ) {
    this.pos = inicio;
  }

  erro(mensagem: string): never {
    throw new ErroSintaxeJson(mensagem, this.pos);
  }

  pularEspacos(): void {
    const b = this.b;
    const f = this.fim;
    let p = this.pos;
    while (p < f) {
      const c = b[p];
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) p++;
      else break;
    }
    this.pos = p;
  }

  /** Próximo byte significativo (após espaços) ou -1 no fim dos dados. */
  espiar(): number {
    this.pularEspacos();
    return this.pos < this.fim ? this.b[this.pos] : -1;
  }

  /** Lê e valida um valor completo a partir da posição atual. `profundidade` = nível do valor (raiz = 0). */
  lerValor(profundidade: number): void {
    const c = this.espiar();
    switch (c) {
      case -1:
        this.erro('Valor esperado, mas o JSON terminou');
        break;
      case ABRE_CHAVE:
        this.lerObjeto(profundidade + 1);
        break;
      case ABRE_COLCHETE:
        this.lerLista(profundidade + 1);
        break;
      case ASPAS:
        this.lerTexto();
        break;
      case 0x74:
      case 0x66:
      case 0x6e:
        this.lerLiteral(LITERAIS[c]);
        break;
      default:
        if (c === MENOS || ehDigito(c)) this.lerNumero();
        else this.erro(`Caractere inesperado '${String.fromCharCode(c)}'`);
    }
  }

  /** Lê um texto (posição atual em '"'); deixa a posição após as aspas finais. */
  lerTexto(): void {
    const b = this.b;
    const f = this.fim;
    let p = this.pos + 1;
    for (;;) {
      if (p >= f) {
        this.pos = p;
        this.erro('Texto sem aspas de fechamento');
      }
      const c = b[p];
      if (c === ASPAS) {
        this.pos = p + 1;
        return;
      }
      if (c === BARRA_INVERTIDA) {
        const e = p + 1 < f ? b[p + 1] : -1;
        if (e === 0x75) {
          for (let k = 2; k <= 5; k++) {
            if (p + k >= f || !ehHex(b[p + k])) {
              this.pos = p;
              this.erro('Sequência \\u inválida');
            }
          }
          p += 6;
          continue;
        }
        if (
          e === ASPAS ||
          e === BARRA_INVERTIDA ||
          e === 0x2f ||
          e === 0x62 ||
          e === 0x66 ||
          e === 0x6e ||
          e === 0x72 ||
          e === 0x74
        ) {
          p += 2;
          continue;
        }
        this.pos = p;
        this.erro('Escape inválido em texto');
      }
      if (c < 0x20) {
        this.pos = p;
        this.erro('Caractere de controle sem escape em texto');
      }
      p++;
    }
  }

  lerNumero(): void {
    const b = this.b;
    const f = this.fim;
    let p = this.pos;
    if (b[p] === MENOS) p++;
    if (p >= f) {
      this.pos = p;
      this.erro('Número incompleto');
    }
    if (b[p] === 0x30) p++;
    else if (b[p] >= 0x31 && b[p] <= 0x39) {
      p++;
      while (p < f && ehDigito(b[p])) p++;
    } else {
      this.pos = p;
      this.erro('Número inválido');
    }
    if (p < f && b[p] === 0x2e) {
      p++;
      if (!(p < f && ehDigito(b[p]))) {
        this.pos = p;
        this.erro('Número inválido (casas decimais)');
      }
      while (p < f && ehDigito(b[p])) p++;
    }
    if (p < f && (b[p] === 0x65 || b[p] === 0x45)) {
      p++;
      if (p < f && (b[p] === 0x2b || b[p] === MENOS)) p++;
      if (!(p < f && ehDigito(b[p]))) {
        this.pos = p;
        this.erro('Número inválido (expoente)');
      }
      while (p < f && ehDigito(b[p])) p++;
    }
    this.pos = p;
  }

  private lerLiteral(literal: number[]): void {
    const b = this.b;
    for (let k = 0; k < literal.length; k++) {
      if (this.pos + k >= this.fim || b[this.pos + k] !== literal[k]) this.erro('Literal inválido');
    }
    this.pos += literal.length;
  }

  /** Lê um objeto (posição atual em '{'). */
  lerObjeto(profundidade: number): void {
    if (profundidade > PROFUNDIDADE_MAXIMA) this.erro('Profundidade máxima do JSON excedida');
    this.pos++;
    if (this.espiar() === FECHA_CHAVE) {
      this.pos++;
      return;
    }
    for (;;) {
      if (this.espiar() !== ASPAS) this.erro('Nome de propriedade esperado');
      this.lerTexto();
      if (this.espiar() !== DOIS_PONTOS) this.erro("':' esperado após o nome da propriedade");
      this.pos++;
      this.lerValor(profundidade);
      const c = this.espiar();
      if (c === VIRGULA) {
        this.pos++;
        continue;
      }
      if (c === FECHA_CHAVE) {
        this.pos++;
        return;
      }
      this.erro(c === -1 ? 'Objeto sem fechamento' : "',' ou '}' esperado");
    }
  }

  /** Lê uma lista (posição atual em '['); retorna a quantidade de itens. */
  lerLista(profundidade: number): number {
    if (profundidade > PROFUNDIDADE_MAXIMA) this.erro('Profundidade máxima do JSON excedida');
    this.pos++;
    if (this.espiar() === FECHA_COLCHETE) {
      this.pos++;
      return 0;
    }
    let itens = 0;
    for (;;) {
      this.lerValor(profundidade);
      itens++;
      const c = this.espiar();
      if (c === VIRGULA) {
        this.pos++;
        continue;
      }
      if (c === FECHA_COLCHETE) {
        this.pos++;
        return itens;
      }
      this.erro(c === -1 ? 'Lista sem fechamento' : "',' ou ']' esperado");
    }
  }

  /** Decodifica o texto JSON em [inicio, fim) (incluindo as aspas). */
  decodificarTexto(inicio: number, fim: number): string {
    const b = this.b;
    for (let p = inicio + 1; p < fim - 1; p++) {
      if (b[p] === BARRA_INVERTIDA)
        return JSON.parse(Buffer.from(b.buffer, b.byteOffset + inicio, fim - inicio).toString('utf8')) as string;
    }
    return Buffer.from(b.buffer, b.byteOffset + inicio + 1, fim - inicio - 2).toString('utf8');
  }
}

export function temBom(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
}

/** Propriedade de nível superior de um objeto JSON, com as posições do valor bruto. */
export interface PropriedadeBruta {
  nome: string;
  inicio: number;
  fim: number;
  /** Quantidade de itens quando o valor é uma lista. */
  itens: number | null;
}

/**
 * Lê as propriedades de nível superior de um objeto JSON (validando o documento inteiro).
 * Ordem da primeira ocorrência; com nomes repetidos, o último valor prevalece (semântica do JSON.parse).
 */
export function lerPropriedades(dados: Buffer, mensagens = MENSAGENS_ESTADO): PropriedadeBruta[] {
  const inicio = temBom(dados) ? 3 : 0;
  const leitor = new LeitorJson(dados, inicio);
  try {
    if (!isUtf8(dados)) throw new ErroSintaxeJson('o conteúdo não está em UTF-8 válido', 0);
    if (leitor.espiar() !== ABRE_CHAVE) throw new EstadoInvalidoError(mensagens.naoObjeto);
    leitor.pos++;
    const ordem: string[] = [];
    const porNome = new Map<string, PropriedadeBruta>();
    if (leitor.espiar() === FECHA_CHAVE) leitor.pos++;
    else {
      for (;;) {
        const c = leitor.espiar();
        if (c === -1) throw new EstadoInvalidoError(mensagens.incompleto);
        if (c !== ASPAS) throw new EstadoInvalidoError(mensagens.propriedadeEsperada);
        const iniNome = leitor.pos;
        leitor.lerTexto();
        const nome = leitor.decodificarTexto(iniNome, leitor.pos);
        if (leitor.espiar() !== DOIS_PONTOS) leitor.erro("':' esperado após o nome da propriedade");
        leitor.pos++;
        const v = leitor.espiar();
        if (v === -1) throw new EstadoInvalidoError(mensagens.valorAusente);
        const ini = leitor.pos;
        let itens: number | null = null;
        // O objeto raiz é o nível 1 (como no Utf8JsonReader do .NET): os valores das coleções começam no nível 2.
        if (v === ABRE_COLCHETE) itens = leitor.lerLista(2);
        else leitor.lerValor(1);
        if (!porNome.has(nome)) ordem.push(nome);
        porNome.set(nome, { nome, inicio: ini, fim: leitor.pos, itens });
        const s = leitor.espiar();
        if (s === VIRGULA) {
          leitor.pos++;
          continue;
        }
        if (s === FECHA_CHAVE) {
          leitor.pos++;
          break;
        }
        if (s === -1) throw new EstadoInvalidoError(mensagens.incompleto);
        leitor.erro("',' ou '}' esperado");
      }
    }
    if (leitor.espiar() !== -1) throw new EstadoInvalidoError(mensagens.conteudoApos);
    return ordem.map((n) => porNome.get(n)!);
  } catch (e) {
    if (e instanceof ErroSintaxeJson) throw new EstadoInvalidoError(mensagens.prefixoSintaxe + e.message);
    throw e;
  }
}

export const MENSAGENS_ESTADO = {
  naoObjeto: 'Estado inválido: era esperado um objeto JSON.',
  incompleto: 'Estado inválido: JSON incompleto.',
  propriedadeEsperada: 'Estado inválido: propriedade esperada.',
  valorAusente: 'Estado inválido: valor ausente.',
  conteudoApos: 'Estado inválido: conteúdo após o fim do objeto JSON.',
  prefixoSintaxe: 'Estado inválido (JSON): ',
};

export function sha256(dados: Uint8Array): Buffer {
  return createHash('sha256').update(dados).digest();
}

export function hex(hash: Uint8Array): string {
  return Buffer.from(hash).toString('hex');
}

/** Divide o objeto de estado em coleções (propriedades de nível superior), sem reserializar. */
export function dividir(json: Buffer): ColecaoRecebida[] {
  return lerPropriedades(json).map((p, ordem) => {
    const conteudo = json.subarray(p.inicio, p.fim);
    return { nome: p.nome, ordem, conteudo, hash: sha256(conteudo), itens: p.itens };
  });
}

/** Monta o objeto de estado a partir das coleções, na ordem informada. */
export function montar(colecoes: Iterable<{ nome: string; conteudo: Uint8Array }>): Buffer {
  const partes: Buffer[] = [Buffer.from('{')];
  let primeira = true;
  for (const c of colecoes) {
    partes.push(Buffer.from((primeira ? '' : ',') + JSON.stringify(c.nome) + ':', 'utf8'));
    partes.push(Buffer.isBuffer(c.conteudo) ? c.conteudo : Buffer.from(c.conteudo));
    primeira = false;
  }
  partes.push(Buffer.from('}'));
  return Buffer.concat(partes);
}

/** Valor bruto de nível superior → texto, como o GetRawText/GetString do .NET (texto JSON é decodificado). */
function valorComoTexto(dados: Buffer, inicio: number, fim: number): string {
  if (dados[inicio] === ASPAS) return new LeitorJson(dados).decodificarTexto(inicio, fim);
  return dados.toString('utf8', inicio, fim);
}

export interface ArquivoBanco {
  estado: Buffer;
  appStorage: Record<string, string> | null;
  formato: 'ESTADO' | 'MES_LION_JSON_DATABASE';
}

/**
 * Lê um arquivo de banco no formato do MES (V39: {format:'MES_LION_JSON_DATABASE', data, appStorage}) ou um
 * objeto de estado puro. Valida tudo antes de retornar.
 */
export function lerArquivoBanco(conteudo: Buffer): ArquivoBanco {
  const dados = temBom(conteudo) ? conteudo.subarray(3) : conteudo;
  const partes = lerPropriedades(dados);
  const formato = partes.find((p) => p.nome === 'format');
  const envelope =
    formato !== undefined && dados.toString('utf8', formato.inicio, formato.fim).trim() === '"MES_LION_JSON_DATABASE"';
  if (!envelope) return { estado: Buffer.from(dados), appStorage: null, formato: 'ESTADO' };

  const parteData = partes.find((p) => p.nome === 'data');
  if (!parteData) throw new EstadoInvalidoError("Arquivo MES_LION_JSON_DATABASE sem a propriedade 'data'.");
  let kv: Record<string, string> | null = null;
  const parteKv = partes.find((p) => p.nome === 'appStorage');
  if (parteKv && dados[parteKv.inicio] === ABRE_CHAVE) {
    const trecho = dados.subarray(parteKv.inicio, parteKv.fim);
    kv = {};
    for (const p of lerPropriedades(trecho)) kv[p.nome] = valorComoTexto(trecho, p.inicio, p.fim);
  }
  return {
    estado: Buffer.from(dados.subarray(parteData.inicio, parteData.fim)),
    appStorage: kv,
    formato: 'MES_LION_JSON_DATABASE',
  };
}

// --------------------------------------------------------------------------------------------------
// Análise de uma coleção para a camada relacional (views rel.<coleção>): campos na ordem em que
// aparecem nos registros, com a contagem de valores simples e complexos de cada campo.
// --------------------------------------------------------------------------------------------------
export interface CampoColecao {
  chave: string;
  escalares: number;
  complexos: number;
}

export type AnaliseColecao =
  { tipo: 'objeto' } | { tipo: 'lista'; objetos: number; outros: number; campos: CampoColecao[] } | { tipo: 'outro' };

export function analisarColecao(conteudo: Buffer): AnaliseColecao {
  const leitor = new LeitorJson(conteudo);
  const c = leitor.espiar();
  if (c === ABRE_CHAVE) return { tipo: 'objeto' };
  if (c !== ABRE_COLCHETE) return { tipo: 'outro' };
  const campos: CampoColecao[] = [];
  const porChave = new Map<string, CampoColecao>();
  let objetos = 0;
  let outros = 0;
  leitor.pos++;
  if (leitor.espiar() === FECHA_COLCHETE) return { tipo: 'lista', objetos, outros, campos };
  for (;;) {
    if (leitor.espiar() === ABRE_CHAVE) {
      objetos++;
      leitor.pos++;
      if (leitor.espiar() === FECHA_CHAVE) leitor.pos++;
      else {
        for (;;) {
          if (leitor.espiar() !== ASPAS) leitor.erro('Nome de propriedade esperado');
          const ini = leitor.pos;
          leitor.lerTexto();
          const chave = leitor.decodificarTexto(ini, leitor.pos);
          if (leitor.espiar() !== DOIS_PONTOS) leitor.erro("':' esperado");
          leitor.pos++;
          const tipo = tipoPeloByte(leitor.espiar());
          leitor.lerValor(2);
          let campo = porChave.get(chave);
          if (!campo) {
            campo = { chave, escalares: 0, complexos: 0 };
            porChave.set(chave, campo);
            campos.push(campo);
          }
          if (tipo === 'objeto' || tipo === 'lista') campo.complexos++;
          else if (tipo !== 'nulo') campo.escalares++;
          const s = leitor.espiar();
          if (s === VIRGULA) {
            leitor.pos++;
            continue;
          }
          if (s === FECHA_CHAVE) {
            leitor.pos++;
            break;
          }
          leitor.erro("',' ou '}' esperado");
        }
      }
    } else {
      outros++;
      leitor.lerValor(1);
    }
    const s = leitor.espiar();
    if (s === VIRGULA) {
      leitor.pos++;
      continue;
    }
    if (s === FECHA_COLCHETE) break;
    leitor.erro("',' ou ']' esperado");
  }
  return { tipo: 'lista', objetos, outros, campos };
}

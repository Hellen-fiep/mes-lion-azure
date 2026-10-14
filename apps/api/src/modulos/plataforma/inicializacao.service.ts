// =====================================================================
// Preparação na inicialização (porte do Infra/Inicializacao.cs): esquema do banco (scripts T-SQL),
// pastas/contêiner de arquivos, usuário administrador inicial, chave dos JWT e carga inicial (seed)
// quando o banco está vazio.
// =====================================================================
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { resolverCaminho } from '../../configuracao/carregar-configuracao';
import { CONFIGURACAO, type ConfiguracaoMes } from '../../configuracao/opcoes';
import { PROVEDOR_PERSISTENCIA, type ProvedorPersistencia } from '../../dominio/repositorios';
import { ARMAZENAMENTO_ARQUIVOS, type ArmazenamentoArquivos } from '../../infra/arquivos/armazenamento';
import { SessoesService } from '../autenticacao/sessoes.service';
import { EstadoService } from '../estado/estado.service';
import { UsuariosService } from '../usuarios/usuarios.service';

@Injectable()
export class InicializacaoService {
  private readonly log = new Logger('MesLion');

  constructor(
    @Inject(CONFIGURACAO) private readonly cfg: ConfiguracaoMes,
    @Inject(PROVEDOR_PERSISTENCIA) private readonly provedor: ProvedorPersistencia,
    @Inject(ARMAZENAMENTO_ARQUIVOS) private readonly armazenamento: ArmazenamentoArquivos,
    private readonly usuarios: UsuariosService,
    private readonly sessoes: SessoesService,
    private readonly estado: EstadoService,
  ) {}

  /** Pasta de dados mostrada ao usuário (menu Banco → Abrir pasta de dados). */
  get pastaDados(): string {
    const raiz = this.armazenamento.raizLocal;
    return raiz ? path.dirname(raiz) : this.cfg.raizConteudo;
  }

  get descricaoBancoCurta(): string {
    return this.provedor.nome === 'SqlServer' ? this.provedor.descricao : 'Portátil (arquivos locais — validação)';
  }

  async executar(): Promise<void> {
    this.log.log(`Banco de dados: ${this.provedor.descricao}`);
    await this.provedor.inicializar();
    this.log.log(`Arquivos: ${this.armazenamento.descricao}`);
    await this.armazenamento.inicializar();
    await this.usuarios.garantirAdministrador();
    await this.sessoes.carregarSegredo();
    await this.carregarSeedSeVazio();
    void this.sessoes.limparVencidas();
  }

  private async carregarSeedSeVazio(): Promise<void> {
    const resumo = await this.provedor.estado.resumo();
    if (resumo.colecoes > 0 || resumo.versao > 0) return;
    let arquivo = resolverCaminho(this.cfg.raizConteudo, this.cfg.opcoes.seed.arquivoInicial);
    if (!existsSync(arquivo)) {
      const alternativo = path.join(this.cfg.raizConteudo, 'Dados', 'MES_LION_DATA.json');
      if (existsSync(alternativo)) arquivo = alternativo;
      else {
        this.log.warn(
          `Banco vazio e arquivo inicial não encontrado (${arquivo}). O frontend gravará os dados iniciais (js/data.js) no primeiro login.`,
        );
        return;
      }
    }
    const bytes = await fs.readFile(arquivo);
    const { resultado, chavesKv, formato } = await this.estado.importar(bytes, null);
    this.log.log(
      `Banco vazio: dados iniciais carregados de ${arquivo} (${formato}; ${resultado.alteradas.length} coleções; ${chavesKv} chaves de appStorage).`,
    );
  }
}

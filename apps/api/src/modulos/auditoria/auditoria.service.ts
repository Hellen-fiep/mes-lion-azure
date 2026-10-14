import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Usuario } from '../../dominio/entidades';
import { PROVEDOR_PERSISTENCIA, type ProvedorPersistencia } from '../../dominio/repositorios';

/** Histórico de modificações (audit_log), com os mesmos módulos/ações do servidor original. */
@Injectable()
export class AuditoriaService {
  private readonly log = new Logger('MesLion.Auditoria');

  constructor(@Inject(PROVEDOR_PERSISTENCIA) private readonly provedor: ProvedorPersistencia) {}

  /** Sem usuário, sem registro (mesmo comportamento do Audit() do PowerShell). Falhas não interrompem a operação. */
  async registrar(
    u: Usuario | null,
    modulo: string,
    acao: string,
    chave: string | null = '',
    detalhesJson = '{}',
  ): Promise<void> {
    if (!u) return;
    try {
      await this.provedor.auditoria.registrar({
        userId: u.id,
        username: u.username,
        module: modulo,
        action: acao,
        recordKey: chave ?? '',
        changedAt: new Date(),
        detailsJson: detalhesJson && detalhesJson.trim() ? detalhesJson : '{}',
      });
    } catch (e) {
      this.log.error(`Falha ao registrar auditoria ${modulo}/${acao}: ${(e as Error).message}`);
    }
  }
}

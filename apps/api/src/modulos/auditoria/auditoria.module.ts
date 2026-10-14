import { Module } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service';

/** Histórico de modificações (audit_log). */
@Module({
  providers: [AuditoriaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}

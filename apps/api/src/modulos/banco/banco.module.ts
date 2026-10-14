import { Module } from '@nestjs/common';
import { ArquivosModule } from '../arquivos/arquivos.module';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { EstadoModule } from '../estado/estado.module';
import { PlataformaModule } from '../plataforma/plataforma.module';
import { RelacionalModule } from '../relacional/relacional.module';
import { BancoController } from './banco.controller';

/** Menu "Banco" (backup, exportar, importar), /api/info, backups e /healthz. */
@Module({
  imports: [EstadoModule, ArquivosModule, AuditoriaModule, RelacionalModule, PlataformaModule],
  controllers: [BancoController],
})
export class BancoModule {}

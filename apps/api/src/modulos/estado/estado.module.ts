import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { EstadoController } from './estado.controller';
import { EstadoService } from './estado.service';

/** Estado do MES (/api/bootstrap, /api/storage): gravação por coleção, sem reserializar o JSON do navegador. */
@Module({
  imports: [AuditoriaModule],
  controllers: [EstadoController],
  providers: [EstadoService],
  exports: [EstadoService],
})
export class EstadoModule {}

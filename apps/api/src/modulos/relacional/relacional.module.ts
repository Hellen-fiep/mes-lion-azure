import { Module } from '@nestjs/common';
import { EstadoModule } from '../estado/estado.module';
import { RelacionalService } from './relacional.service';

/** Camada relacional do SQL Server (views rel.<coleção> e tabelas normalizadas), atualizada em segundo plano. */
@Module({
  imports: [EstadoModule],
  providers: [RelacionalService],
  exports: [RelacionalService],
})
export class RelacionalModule {}

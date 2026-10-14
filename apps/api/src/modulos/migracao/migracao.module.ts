import { Module } from '@nestjs/common';
import { ArquivosModule } from '../arquivos/arquivos.module';
import { EstadoModule } from '../estado/estado.module';
import { ImportadorPostgresqlService } from './importador-postgresql.service';

/** Migração do MES LION PowerShell/PostgreSQL (linha de comando --importar-migracao). */
@Module({
  imports: [EstadoModule, ArquivosModule],
  providers: [ImportadorPostgresqlService],
  exports: [ImportadorPostgresqlService],
})
export class MigracaoModule {}

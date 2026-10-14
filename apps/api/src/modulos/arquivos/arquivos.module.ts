import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { CONFIGURACAO, type ConfiguracaoMes } from '../../configuracao/opcoes';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { EstadoModule } from '../estado/estado.module';
import { ArquivosService } from './arquivos.service';
import { DocumentosController } from './documentos.controller';
import { PassaportesController } from './passaportes.controller';

/** Documentos de equipamentos, anexos de cadastros, passaportes publicados (QR) e backups. */
@Module({
  imports: [
    EstadoModule,
    AuditoriaModule,
    MulterModule.registerAsync({
      inject: [CONFIGURACAO],
      // Memória (documentos são pequenos), limite do servidor e nomes de arquivo em UTF-8 (ex.: "Instrução.pdf").
      useFactory: (cfg: ConfiguracaoMes) => ({
        limits: {
          fileSize: Math.max(32, cfg.opcoes.servidor.limiteRequisicaoMB) * 1024 * 1024,
          fieldSize: 16 * 1024 * 1024,
        },
        defParamCharset: 'utf8',
      }),
    }),
  ],
  controllers: [DocumentosController, PassaportesController],
  providers: [ArquivosService],
  exports: [ArquivosService],
})
export class ArquivosModule {}

import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import type { ConfiguracaoMes } from './configuracao/opcoes';
import { NucleoModule } from './infra/nucleo.module';
import { ArquivosModule } from './modulos/arquivos/arquivos.module';
import { AuditoriaModule } from './modulos/auditoria/auditoria.module';
import { AutenticacaoModule } from './modulos/autenticacao/autenticacao.module';
import { BancoModule } from './modulos/banco/banco.module';
import { EstadoModule } from './modulos/estado/estado.module';
import { MigracaoModule } from './modulos/migracao/migracao.module';
import { FiltroExcecoes } from './modulos/plataforma/filtro-excecoes';
import { PlataformaModule } from './modulos/plataforma/plataforma.module';
import { RelacionalModule } from './modulos/relacional/relacional.module';
import { UsuariosModule } from './modulos/usuarios/usuarios.module';

/** Módulo raiz: núcleo (configuração, banco, arquivos) + módulos de domínio. */
@Module({})
export class AppModule {
  static registrar(cfg: ConfiguracaoMes, opcoes: { sentry?: boolean } = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ...(opcoes.sentry ? [SentryModule.forRoot()] : []),
        NucleoModule.registrar(cfg),
        AuditoriaModule,
        UsuariosModule,
        AutenticacaoModule,
        EstadoModule,
        ArquivosModule,
        RelacionalModule,
        PlataformaModule,
        BancoModule,
        MigracaoModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: FiltroExcecoes }],
    };
  }
}

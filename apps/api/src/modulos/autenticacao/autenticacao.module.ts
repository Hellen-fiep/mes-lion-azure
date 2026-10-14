import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { AutenticacaoController } from './autenticacao.controller';
import { AutenticacaoGuard } from './autenticacao.guard';
import { AutenticacaoService } from './autenticacao.service';
import { SessoesService } from './sessoes.service';

/**
 * Autenticação: JWT de acesso + refresh token rotativo (cookies HttpOnly para o navegador, Bearer para clientes de API),
 * Microsoft Entra ID (Easy Auth do App Service) e a guarda global que protege todas as rotas.
 */
@Module({
  imports: [UsuariosModule, AuditoriaModule, JwtModule.register({})],
  controllers: [AutenticacaoController],
  providers: [SessoesService, AutenticacaoService, { provide: APP_GUARD, useClass: AutenticacaoGuard }],
  exports: [SessoesService, AutenticacaoService],
})
export class AutenticacaoModule {}

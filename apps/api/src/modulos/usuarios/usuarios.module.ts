import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';

/** Usuários (cadastro pelo ADMIN, login com senha, Microsoft Entra ID) e histórico de modificações (/api/audit). */
@Module({
  imports: [AuditoriaModule],
  controllers: [UsuariosController],
  providers: [UsuariosService],
  exports: [UsuariosService],
})
export class UsuariosModule {}

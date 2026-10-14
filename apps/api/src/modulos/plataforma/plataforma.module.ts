import { Module } from '@nestjs/common';
import { AutenticacaoModule } from '../autenticacao/autenticacao.module';
import { EstadoModule } from '../estado/estado.module';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { InicializacaoService } from './inicializacao.service';

/** Preparação do ambiente na inicialização (banco, arquivos, administrador, chave dos tokens, carga inicial). */
@Module({
  imports: [UsuariosModule, AutenticacaoModule, EstadoModule],
  providers: [InicializacaoService],
  exports: [InicializacaoService],
})
export class PlataformaModule {}

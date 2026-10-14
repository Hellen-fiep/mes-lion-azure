import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ComoTexto, NaoVazio } from '../../comum/validacao';

export class LoginDto {
  @ApiProperty({
    example: 'admin',
    description: 'Login (diferencia maiúsculas e minúsculas, como no PostgreSQL original).',
  })
  @ComoTexto()
  @NaoVazio({ message: 'Usuário e senha são obrigatórios' })
  @MaxLength(80, { message: 'Usuário muito longo (máx. 80)' })
  username: string;

  @ApiProperty({ example: 'meslion2026', format: 'password' })
  @ComoTexto()
  @IsString({ message: 'Usuário e senha são obrigatórios' })
  password: string;
}

export class RefreshDto {
  @ApiPropertyOptional({
    description:
      'Refresh token recebido em /api/auth/token. Navegadores não enviam: o cookie HttpOnly MESREFRESH é usado.',
  })
  @IsOptional()
  @ComoTexto()
  @IsString()
  refreshToken?: string;
}

export class UsuarioSessaoDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() username: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ enum: ['ADMIN', 'USER'] }) role: string;
  @ApiProperty({ enum: ['LOCAL', 'ENTRA'], description: 'Como o usuário entrou nesta sessão.' }) provedor: string;
}

export class RespostaLoginDto {
  @ApiProperty({ type: UsuarioSessaoDto }) user: UsuarioSessaoDto;
}

export class RespostaTokenDto {
  @ApiProperty({ example: 'Bearer' }) tokenType: string;
  @ApiProperty({ description: 'JWT de acesso (HS256). Enviar no cabeçalho Authorization: Bearer <token>.' })
  accessToken: string;
  @ApiProperty({ example: 900, description: 'Validade do token de acesso, em segundos.' }) expiresIn: number;
  @ApiProperty({ description: 'Refresh token opaco (rotativo): troque por um novo par em /api/auth/refresh.' })
  refreshToken: string;
  @ApiProperty({ example: 43200, description: 'Validade da sessão sem uso (expiração deslizante), em segundos.' })
  refreshExpiresIn: number;
  @ApiProperty({ type: UsuarioSessaoDto }) user: UsuarioSessaoDto;
}

export class RespostaRenovacaoCookieDto {
  @ApiProperty({ example: true }) ok: boolean;
  @ApiProperty({ example: 900 }) expiresIn: number;
  @ApiProperty({ type: UsuarioSessaoDto }) user: UsuarioSessaoDto;
}

export class EntraIdConfigDto {
  @ApiProperty() habilitado: boolean;
  @ApiProperty({ example: '/.auth/login/aad?post_login_redirect_uri=%2F' }) loginUrl: string;
  @ApiProperty({ example: '/.auth/logout?post_logout_redirect_uri=%2F' }) logoutUrl: string;
}

export class ConfigLoginDto {
  @ApiProperty({ type: EntraIdConfigDto }) entraId: EntraIdConfigDto;
  @ApiProperty({ example: 'Node.js 22.22 · NestJS 11' }) plataforma: string;
  @ApiProperty({ example: '1.0.0' }) versao: string;
  @ApiProperty({ enum: ['SqlServer', 'Portatil'] }) banco: string;
  @ApiProperty() bancoDescricao: string;
  @ApiProperty() compressaoUpload: boolean;
}

export class ErroDto {
  @ApiProperty({ example: 'Não autenticado' }) error: string;
}

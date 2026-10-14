import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, MaxLength } from 'class-validator';
import { ComoTexto, ComoVerdadeiro, NaoVazio } from '../../comum/validacao';

export const MSG_OBRIGATORIOS = 'Usuário, nome e senha são obrigatórios';
export const MSG_TAMANHO = 'Usuário (máx. 80) ou nome (máx. 180) muito longo';
export const MSG_NOME_LONGO = 'Nome muito longo (máx. 180)';

export class CriarUsuarioDto {
  @ApiProperty({ example: 'operador', maxLength: 80 })
  @ComoTexto()
  @NaoVazio({ message: MSG_OBRIGATORIOS })
  @MaxLength(80, { message: MSG_TAMANHO })
  username: string;

  @ApiProperty({ example: 'Operador de Produção', maxLength: 180 })
  @ComoTexto()
  @NaoVazio({ message: MSG_OBRIGATORIOS })
  @MaxLength(180, { message: MSG_TAMANHO })
  fullName: string;

  @ApiProperty({ format: 'password' })
  @ComoTexto()
  @NaoVazio({ message: MSG_OBRIGATORIOS })
  password: string;

  @ApiPropertyOptional({ enum: ['ADMIN', 'USER'], default: 'USER' })
  @IsOptional()
  @ComoTexto()
  role?: string | null;

  @ApiPropertyOptional({ default: false, description: 'Valor "verdadeiro" (true, texto não vazio, número ≠ 0).' })
  @IsOptional()
  @ComoVerdadeiro()
  active?: boolean;
}

export class AtualizarUsuarioDto {
  @ApiPropertyOptional({ maxLength: 180 })
  @IsOptional()
  @ComoTexto()
  @MaxLength(180, { message: MSG_NOME_LONGO })
  fullName?: string | null;

  @ApiPropertyOptional({ enum: ['ADMIN', 'USER'] })
  @IsOptional()
  @ComoTexto()
  role?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ComoVerdadeiro()
  active?: boolean;

  @ApiPropertyOptional({ format: 'password', description: 'Vazio mantém a senha atual.' })
  @IsOptional()
  @ComoTexto()
  password?: string | null;
}

export class UsuarioListaDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() username: string;
  @ApiProperty() full_name: string;
  @ApiProperty({ enum: ['ADMIN', 'USER'] }) role: string;
  @ApiProperty() active: boolean;
  @ApiProperty({ example: '2026-10-13T09:15:02.123-03:00' }) created_at: string;
  @ApiProperty({ example: '2026-10-13T09:15:02.123-03:00' }) updated_at: string;
}

export class AuditoriaDto {
  @ApiProperty({ nullable: true }) username: string | null;
  @ApiProperty({ example: 'app' }) module: string;
  @ApiProperty({ example: 'SAVE_STATE' }) action: string;
  @ApiProperty({ nullable: true, example: 'MES_LION_DATA' }) record_key: string | null;
  @ApiProperty({ example: '2026-10-13T09:15:02.123-03:00' }) changed_at: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { colecoes_alteradas: ['op'], versao: 12 },
  })
  details: unknown;
}

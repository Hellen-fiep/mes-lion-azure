import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BackupCriadoDto {
  @ApiProperty({ example: true }) ok: boolean;
  @ApiProperty({ example: 12 }) id: number;
  @ApiProperty({
    example: '/home/site/data/MesLion/Arquivos/backups/MES_LION_BACKUP_20261013_091502_123_v42_a1b2c3.json.gz',
  })
  path: string;
  @ApiProperty({ example: '2026-10-13T09:15:02.123-03:00' }) createdAt: string;
  @ApiProperty({ example: 1834221 }) sizeBytes: number;
  @ApiProperty({ example: 42 }) stateVersion: number;
}

export class ImportacaoDto {
  @ApiProperty({ example: true }) ok: boolean;
  @ApiProperty({ enum: ['MES_LION_JSON_DATABASE', 'ESTADO'] }) formato: string;
  @ApiProperty({ example: 43 }) versao: number;
  @ApiProperty({ example: 5 }) colecoesAlteradas: number;
  @ApiProperty({ example: 0 }) colecoesRemovidas: number;
  @ApiProperty({ example: 12, description: 'Backup automático criado antes da importação.' }) backupAnterior: number;
}

export class BackupListaDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Backup manual (menu Banco)' }) motivo: string;
  @ApiProperty({ example: '2026-10-13T09:15:02.123-03:00' }) criadoEm: string;
  @ApiPropertyOptional({ nullable: true, example: 'admin' }) criadoPor: string | null;
  @ApiProperty() bytes: number;
  @ApiProperty() versaoEstado: number;
  @ApiProperty({ example: 'backups/MES_LION_BACKUP_20261013_091502_123_v42_a1b2c3.json.gz' }) arquivo: string;
}

export class SaudeDto {
  @ApiProperty({ enum: ['ok', 'erro'] }) status: string;
  @ApiProperty({ enum: ['SqlServer', 'Portatil'] }) banco: string;
  @ApiPropertyOptional({ example: 42 }) versaoEstado?: number;
  @ApiPropertyOptional() erro?: string;
}

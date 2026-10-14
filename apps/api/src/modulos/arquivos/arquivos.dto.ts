import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { ComoTexto } from '../../comum/validacao';

export class DocumentoDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: '10' }) equipment_code: string;
  @ApiProperty({ example: 'Instrução de Trabalho.pdf' }) original_name: string;
  @ApiProperty({ nullable: true, example: 'application/pdf' }) mime_type: string | null;
  @ApiProperty() file_size: number;
  @ApiProperty({ nullable: true, example: 'checklist' }) document_type: string | null;
  @ApiProperty({ nullable: true, example: 'B' }) revision: string | null;
  @ApiProperty() active: boolean;
  @ApiProperty({ example: '2026-10-13T09:15:02.123-03:00' }) uploaded_at: string;
}

export class UploadDocumentoDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'PDF, XLSX ou XLS' }) file: unknown;
  @ApiPropertyOptional({ example: 'checklist' }) documentType?: string;
  @ApiPropertyOptional({ example: 'B' }) revision?: string;
}

export class AnexoDto {
  @ApiPropertyOptional({ example: 'empresas', default: 'geral' })
  @IsOptional()
  @ComoTexto()
  scope?: string | null;

  @ApiPropertyOptional({ example: 'EM0001' })
  @IsOptional()
  @ComoTexto()
  recordId?: string | null;

  @ApiPropertyOptional({ example: 'Contrato Social.pdf', default: 'arquivo' })
  @IsOptional()
  @ComoTexto()
  name?: string | null;

  @ApiPropertyOptional({ example: 'application/pdf' })
  @IsOptional()
  @ComoTexto()
  mime?: string | null;

  @ApiProperty({ description: 'Conteúdo do arquivo em base64 (até 50 MB).' })
  @ComoTexto()
  dataBase64: string | null;
}

export class AnexoCriadoDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: '/api/attachments/0f8fad5bd9cb469fa16570867728950e/Contrato%20Social.pdf' }) url: string;
  @ApiProperty({ example: 'empresas/EM0001/Contrato Social.pdf' }) path: string;
  @ApiProperty() name: string;
  @ApiProperty() size: number;
}

export class PublicarPassaporteDto {
  @ApiProperty({ example: 'BP-0001' })
  @ComoTexto()
  id: string | null;

  @ApiProperty({ description: 'HTML completo do dashboard do passaporte.' })
  @ComoTexto()
  html: string | null;
}

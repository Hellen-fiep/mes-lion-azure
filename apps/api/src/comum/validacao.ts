// =====================================================================
// Corpo das requisições: os navegadores enviam JSON (às vezes como text/plain), e as rotas herdadas
// nunca respondem erro de sintaxe — um corpo inválido vale como objeto vazio (LerJson do .NET).
// Os DTOs usam class-transformer + class-validator (padrão FIEP), com as MESMAS mensagens de erro
// do contrato original (ex.: "Usuário, nome e senha são obrigatórios").
// =====================================================================
import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Transform, plainToInstance } from 'class-transformer';
import { type ValidationError, type ValidationOptions, ValidateBy, validate } from 'class-validator';
import type { Request } from 'express';
import { corpoComoTexto, ehObjeto, lerJson, textoDe, verdadeiroDe } from './formatos';

/** Texto não vazio (após remover espaços). */
export function NaoVazio(opcoes?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    { name: 'naoVazio', validator: { validate: (v: unknown) => typeof v === 'string' && v.trim().length > 0 } },
    opcoes,
  );
}

/** Valor JSON → texto como no contrato herdado (números/lógicos viram o texto JSON; null fica null). */
export const ComoTexto = () => Transform(({ obj, key }) => textoDe(obj, key));

/** Valor "verdadeiro" do PowerShell: true, texto não vazio, número ≠ 0, objeto/lista. */
export const ComoVerdadeiro = () => Transform(({ obj, key }) => verdadeiroDe(obj, key));

/** Corpo bruto da requisição (Buffer; vazio se não houver). */
export const CorpoBruto = createParamDecorator((_: unknown, ctx: ExecutionContext): Buffer => {
  const corpo = ctx.switchToHttp().getRequest<Request>().body as unknown;
  return Buffer.isBuffer(corpo) ? corpo : Buffer.alloc(0);
});

/** Corpo como JSON (null se vazio ou inválido). */
export const CorpoJson = createParamDecorator((_: unknown, ctx: ExecutionContext): unknown => {
  const corpo = ctx.switchToHttp().getRequest<Request>().body as unknown;
  return Buffer.isBuffer(corpo) ? lerJson(corpoComoTexto(corpo)) : null;
});

export interface ResultadoDto<T> {
  dto: T;
  erros: ValidationError[];
}

/** Converte o JSON do corpo no DTO e valida (class-validator). */
export async function validarDto<T extends object>(classe: new () => T, json: unknown): Promise<ResultadoDto<T>> {
  const dto = plainToInstance(classe, ehObjeto(json) ? json : {});
  const erros = await validate(dto, { forbidUnknownValues: false });
  return { dto, erros };
}

/** Mensagem do primeiro erro, priorizando restrições na ordem informada (ex.: obrigatórios antes de tamanho). */
export function mensagemValidacao(erros: ValidationError[], prioridade: string[] = []): string | null {
  const todas = erros.flatMap((e) => Object.entries(e.constraints ?? {}));
  for (const restricao of prioridade) {
    const achada = todas.find(([nome]) => nome === restricao);
    if (achada) return achada[1];
  }
  return todas[0]?.[1] ?? null;
}

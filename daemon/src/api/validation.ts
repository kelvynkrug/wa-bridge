/**
 * Validação manual de corpo/query (sem zod, que não está nas deps do daemon).
 * Toda função aqui faz narrowing de `unknown` e lança `AppError('VALIDATION', 400, ...)`
 * com mensagem útil quando o tipo não bate.
 */
import { AppError } from '../send/errors.js';

/** Garante que `body` é um objeto plano (não array, não null) e devolve como `Record<string, unknown>`. */
export function asRecord(body: unknown, where: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('VALIDATION', 400, `${where} precisa ser um objeto JSON`);
  }
  return body as Record<string, unknown>;
}

/** Lê uma string obrigatória de um record; erro 400 se ausente ou de outro tipo. */
export function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError('VALIDATION', 400, `"${key}" é obrigatório e precisa ser uma string não vazia`);
  }
  return value;
}

/** Lê uma string opcional; erro 400 se presente mas de outro tipo. */
export function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION', 400, `"${key}" precisa ser uma string`);
  }
  return value;
}

/** Lê um boolean opcional; erro 400 se presente mas de outro tipo. */
export function optionalBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new AppError('VALIDATION', 400, `"${key}" precisa ser booleano`);
  }
  return value;
}

/** Lê um array de strings opcional; erro 400 se presente mas de outro tipo. */
export function optionalStringArray(obj: Record<string, unknown>, key: string): string[] | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new AppError('VALIDATION', 400, `"${key}" precisa ser uma lista de strings`);
  }
  return value;
}

/** Converte um valor de query string (possivelmente array) em string única, ou undefined. */
export function queryString(query: unknown, key: string): string | undefined {
  if (typeof query !== 'object' || query === null) return undefined;
  const value = (query as Record<string, unknown>)[key];
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

/** Lê um inteiro de query string com default; erro 400 se presente mas não-numérico. */
export function queryInt(query: unknown, key: string, fallback: number): number {
  const raw = queryString(query, key);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || Number.isNaN(n)) {
    throw new AppError('VALIDATION', 400, `"${key}" precisa ser numérico`);
  }
  return Math.trunc(n);
}

/** Lê um boolean de query string ("true"/"false"), default caso ausente. */
export function queryBool(query: unknown, key: string, fallback: boolean): boolean {
  const raw = queryString(query, key);
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1';
}

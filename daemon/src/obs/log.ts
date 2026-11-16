/**
 * Logger central do wa-daemon (Pino).
 *
 * REGRA DO PROJETO — leia antes de adicionar qualquer `log.info(...)`:
 * conteúdo de mensagem do WhatsApp (texto, legenda, transcrição) NUNCA é
 * logado em nível `info` ou acima. Se for indispensável registrar que um
 * texto existe (ex.: para depurar o split de bubbles), use `redactText()`
 * abaixo, que devolve só o tamanho (`"<42 chars>"`), nunca o conteúdo. Texto
 * integral só é tolerável em `debug` e mesmo assim evite — é dado de
 * terceiros trafegando pelo WhatsApp de quem roda o daemon.
 */
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import pino, { type Level, type LoggerOptions, type StreamEntry } from 'pino';
import type { Logger } from '../types.js';

/** Níveis válidos do Pino, na ordem de severidade — usado para validar `opts.level`. */
const PINO_LEVELS: readonly Level[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

/** Normaliza um nível de log arbitrário (env var) para um `Level` válido do Pino, com fallback em `info`. */
function toPinoLevel(level: string): Level {
  return (PINO_LEVELS as readonly string[]).includes(level) ? (level as Level) : 'info';
}

/** Tamanho acima do qual o arquivo de log é rotacionado (uma vez, no boot). */
const MAX_LOG_BYTES = 20 * 1024 * 1024;

/**
 * Caminhos considerados sensíveis pelo `redact` do Pino. Cobre tanto a chave
 * no nível raiz do objeto logado quanto um nível abaixo (`*.token` etc.),
 * que é o padrão de uso mais comum (`log.info({ draft: { token } })`).
 */
const REDACT_PATHS = [
  'token',
  '*.token',
  'authorization',
  '*.authorization',
  'creds',
  '*.creds',
  'apikey',
  '*.apikey',
  'password',
  '*.password',
];

/** Devolve um placeholder com o tamanho do texto, nunca o conteúdo — use em vez de logar texto de mensagem. */
export function redactText(text: string | null): string {
  if (text === null) return '<null>';
  return `<${text.length} chars>`;
}

/** Se o arquivo de log já existir e passar do teto, renomeia para `.1` antes de reabrir (rotação simples de boot). */
function rotateIfTooBig(file: string): void {
  if (!existsSync(file)) return;
  try {
    const { size } = statSync(file);
    if (size <= MAX_LOG_BYTES) return;
    const rotated = `${file}.1`;
    // Daemon pessoal: não acumulamos histórico, só preservamos o arquivo anterior.
    renameSync(file, rotated);
  } catch {
    // Rotação é best-effort; nunca deve impedir o boot do daemon.
  }
}

/**
 * Cria o logger do daemon: grava JSONL em `opts.file` sempre, e também em
 * stdout de forma legível quando o processo roda num TTY (sem depender de
 * `pino-pretty`, que não está nas deps). Aplica redaction de segredos.
 */
export function createLogger(opts: { level: string; file: string }): Logger {
  mkdirSync(dirname(opts.file), { recursive: true });
  rotateIfTooBig(opts.file);

  const level = toPinoLevel(opts.level);
  const fileDestination = pino.destination({ dest: opts.file, mkdir: true, sync: false });

  const streams: StreamEntry[] = [{ stream: fileDestination, level }];
  if (process.stdout.isTTY) {
    // Sem pino-pretty disponível: stdout recebe o mesmo JSONL, só que no
    // terminal — ainda assim muito mais legível que nada durante dev local.
    streams.push({ stream: process.stdout, level });
  }

  const options: LoggerOptions = {
    level,
    redact: { paths: REDACT_PATHS, censor: '<redacted>' },
  };

  return pino(options, pino.multistream(streams));
}

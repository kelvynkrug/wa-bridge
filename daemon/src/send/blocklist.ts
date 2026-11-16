/**
 * Blocklist de envio: defaults embutidos e inegociáveis + `blocklist.json` do
 * usuário, recarregado a cada chamada com cache de 5s (permite editar sem reiniciar).
 */
import { existsSync, readFileSync } from 'node:fs';
import type { Config } from '../config.js';

const CACHE_TTL_MS = 5000;

let cache: { ts: number; jids: Set<string>; path: string } | null = null;

/** Formato esperado de `blocklist.json`: ausente = lista vazia. */
interface BlocklistFile {
  jids: string[];
  note?: string;
}

/** Faz o parsing defensivo do arquivo; qualquer problema vira lista vazia (fail-open por design). */
function readUserBlocklist(path: string): Set<string> {
  try {
    if (!existsSync(path)) return new Set();
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (
      typeof raw === 'object' &&
      raw !== null &&
      'jids' in raw &&
      Array.isArray((raw as BlocklistFile).jids)
    ) {
      const jids = (raw as BlocklistFile).jids.filter((j): j is string => typeof j === 'string');
      return new Set(jids.map((j) => j.toLowerCase()));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

/** Devolve o conjunto de JIDs bloqueados pelo usuário, com cache de 5s. */
function loadUserBlocklist(path: string): Set<string> {
  const now = Date.now();
  if (cache && cache.path === path && now - cache.ts < CACHE_TTL_MS) return cache.jids;
  const jids = readUserBlocklist(path);
  cache = { ts: now, jids, path };
  return jids;
}

/** Verifica se um JID está bloqueado: defaults inegociáveis + lista do usuário. */
export function isBlocked(config: Config, jid: string): { blocked: boolean; reason?: string } {
  const lower = jid.toLowerCase();
  if (lower === 'status@broadcast') return { blocked: true, reason: 'status@broadcast' };
  if (lower.endsWith('@newsletter')) return { blocked: true, reason: '@newsletter' };
  if (lower.endsWith('@broadcast')) return { blocked: true, reason: '@broadcast' };
  const userList = loadUserBlocklist(config.blocklistPath);
  if (userList.has(lower)) return { blocked: true, reason: 'blocklist.json' };
  return { blocked: false };
}

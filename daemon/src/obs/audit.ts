/**
 * Trilha de auditoria append-only do wa-bridge.
 *
 * Esta é a prova de que nenhum agente mandou nada no WhatsApp do dono sem
 * passar pelo gate de confirmação humana, e de que toda materialização de
 * mídia e todo bloqueio deixou rastro. Por isso: SÓ INSERT. Nunca há UPDATE
 * nem DELETE em `audit` — nem aqui, nem em nenhum outro módulo. Se um evento
 * foi gravado errado, a correção é um novo evento, não uma edição do antigo.
 *
 * Diferente de `Metrics`, aqui não há buffer: cada `record()` grava
 * imediatamente no SQLite. Se o processo morrer no meio de um envio, o
 * registro de auditoria já tem que estar em disco — perder performance é
 * aceitável, perder rastro não é.
 */
import type { Store } from '../store/store.js';
import type { AuditEvent } from '../types.js';
import { redactText } from './log.js';

/** Teto de tamanho (em bytes, UTF-8) do `detail_json` persistido por evento. */
const MAX_DETAIL_BYTES = 4096;

/** Chaves de `detail` que nunca podem ir para o disco, mesmo truncadas. */
const SENSITIVE_KEYS = new Set(['token', 'authorization', 'creds', 'apikey', 'password']);

/**
 * Aplica a mesma disciplina de redaction do logger ao `detail` de um evento:
 * remove segredos e substitui a chave `text` (conteúdo de mensagem) pelo
 * resultado de `redactText` — o audit registra QUE houve envio, não o
 * conteúdo íntegro da mensagem.
 */
function sanitizeDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lower)) {
      out[key] = '<redacted>';
      continue;
    }
    if (lower === 'text') {
      out[key] = redactText(typeof value === 'string' ? value : null);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Trunca o `detail` (já sanitizado) para não virar depósito de payload arbitrário. */
function limitDetailSize(detail: Record<string, unknown>, maxBytes: number): Record<string, unknown> {
  const serialized = JSON.stringify(detail);
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return detail;
  const preview = Buffer.from(serialized, 'utf8')
    .subarray(0, Math.max(0, maxBytes - 64))
    .toString('utf8');
  return { truncated: true, originalBytes: Buffer.byteLength(serialized, 'utf8'), preview };
}

/** Dono da trilha de auditoria: grava e lista, nunca edita nem apaga. */
export class Audit {
  constructor(private readonly store: Store) {}

  /**
   * Grava um evento de auditoria. Síncrono e sem buffer — a chamada só
   * retorna depois que a linha está no SQLite. Sanitiza e trunca `detail`
   * antes de persistir. Em caso de falha de escrita, NUNCA engole o erro:
   * registra em stderr com o `traceId` (o Audit não recebe `Logger` no
   * construtor) e repropaga para quem chamou decidir
   * o que fazer — ex.: o `SendGate`, que tem acesso ao logger com contexto
   * completo do envio.
   */
  record(e: AuditEvent): void {
    const detail = limitDetailSize(sanitizeDetail(e.detail), MAX_DETAIL_BYTES);
    try {
      this.store.insertAudit({ ...e, detail });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          time: Date.now(),
          traceId: e.traceId,
          action: e.action,
          msg: 'falha ao gravar evento de auditoria',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw error;
    }
  }

  /** Lista os eventos de auditoria mais recentes, do mais novo para o mais antigo. */
  recent(limit: number): AuditEvent[] {
    return this.store.recentAudit(limit);
  }
}

/**
 * Remoção de campos de telefone cru das respostas que vão para agentes via MCP.
 * O daemon devolve o telefone real por trás de um LID (`phoneJid` em `/chats`,
 * `senderPhoneJid` em `/messages`) só para consumidores HTTP autenticados; para o
 * agente, número completo derivado de LID segue a regra "mascarado, nunca cru".
 */

/** Copia o objeto sem as chaves indicadas; valores que não são objeto passam intactos. */
function omitKeys(value: unknown, keys: readonly string[]): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const k of keys) delete copy[k];
  return copy;
}

/** Remove `items[].<keys>` de `payload[listKey]`, preservando o resto do payload. */
function redactList(payload: unknown, listKey: string, keys: readonly string[]): unknown {
  if (typeof payload !== 'object' || payload === null) return payload;
  const record = payload as Record<string, unknown>;
  const list = record[listKey];
  if (!Array.isArray(list)) return payload;
  return { ...record, [listKey]: list.map((item) => omitKeys(item, keys)) };
}

/** Tira `phoneJid` de cada conversa de uma resposta de `GET /chats`. */
export function redactChats(payload: unknown): unknown {
  return redactList(payload, 'chats', ['phoneJid']);
}

/** Tira `senderPhoneJid` de cada mensagem de uma resposta de `GET /messages`. */
export function redactMessages(payload: unknown): unknown {
  return redactList(payload, 'messages', ['senderPhoneJid']);
}

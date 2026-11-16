/** As tools MCP não podem repassar ao agente o telefone cru derivado de LID. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { redactChats, redactMessages } from '../src/redact.js';

const TELEFONE = '5551999998888@s.whatsapp.net';

test('redactChats remove phoneJid e preserva o resto', () => {
  const out = redactChats({
    chats: [{ jid: '1@lid', name: 'Fulano', isGroup: false, lastMessageAt: 1, unreadCount: 0, phoneJid: TELEFONE }],
  });
  assert.deepEqual(out, {
    chats: [{ jid: '1@lid', name: 'Fulano', isGroup: false, lastMessageAt: 1, unreadCount: 0 }],
  });
  assert.equal(JSON.stringify(out).includes('5551999998888'), false);
});

test('redactMessages remove senderPhoneJid e preserva o resto', () => {
  const out = redactMessages({ messages: [{ id: 'm1', senderJid: '1@lid', senderPhoneJid: TELEFONE, text: 'oi' }] });
  assert.deepEqual(out, { messages: [{ id: 'm1', senderJid: '1@lid', text: 'oi' }] });
});

test('payload sem a lista esperada passa intacto', () => {
  assert.deepEqual(redactChats({ outra: 1 }), { outra: 1 });
  assert.equal(redactMessages(null), null);
});

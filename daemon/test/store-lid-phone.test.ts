/**
 * Telefone real por trás de LID em `listMessages` (`senderPhoneJid`) e `listChats`
 * (`phoneJid`). Usa um SQLite temporário — nunca o banco de um daemon em execução.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Store } from '../src/store/store.js';
import type { StoredMessage } from '../src/types.js';

const LID = '123456789012345@lid';
const LID_SEM_TELEFONE = '999999999999999@lid';
const TELEFONE = '5551999998888@s.whatsapp.net';
const OUTRO_TELEFONE = '5551988887777@s.whatsapp.net';

let dir: string;
let store: Store;

/** Monta uma mensagem recebida mínima. */
function msg(id: string, chatJid: string, senderJid: string | null, ts: number): StoredMessage {
  return {
    id, chatJid, senderJid, senderName: 'Fulano', fromMe: senderJid === null, ts,
    type: 'text', text: 'oi', caption: null, viewOnce: false, quotedText: null,
    hasMedia: false, mediaState: 'none',
  };
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'wa-bridge-test-'));
  store = new Store(join(dir, 'test.sqlite'));
  store.migrate();

  for (const jid of [LID, LID_SEM_TELEFONE, OUTRO_TELEFONE]) {
    store.upsertChat({ jid, name: null, isGroup: false, lastMessageAt: 1000, unreadCount: 1 });
  }
  store.upsertContact({
    jid: LID, pushName: 'Fulano', alias: null, phoneJid: TELEFONE, lastInboundAt: 1000, lastOutboundAt: null,
  });
  store.upsertContact({
    jid: LID_SEM_TELEFONE, pushName: 'Ciclano', alias: null, phoneJid: null, lastInboundAt: 1000, lastOutboundAt: null,
  });
  // Contato por telefone com phone_jid preenchido: não é LID, então não deve aparecer.
  store.upsertContact({
    jid: OUTRO_TELEFONE, pushName: 'Beltrano', alias: null, phoneJid: OUTRO_TELEFONE, lastInboundAt: 1000, lastOutboundAt: null,
  });

  store.upsertMessage(msg('m1', LID, LID, 1000), '{}');
  store.upsertMessage(msg('m2', LID, null, 2000), '{}');
  store.upsertMessage(msg('m3', LID_SEM_TELEFONE, LID_SEM_TELEFONE, 1000), '{}');
  store.upsertMessage(msg('m4', OUTRO_TELEFONE, OUTRO_TELEFONE, 1000), '{}');
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('listMessages: remetente LID com telefone conhecido traz senderPhoneJid', () => {
  const [recebida] = store.listMessages({ chatJid: LID, limit: 10 }).filter((m) => m.id === 'm1');
  assert.equal(recebida?.senderPhoneJid, TELEFONE);
  assert.equal(recebida?.senderJid, LID, 'senderJid não muda');
});

test('listMessages: mensagem própria, LID sem telefone e remetente por telefone trazem null', () => {
  const propria = store.listMessages({ chatJid: LID, limit: 10 }).find((m) => m.id === 'm2');
  assert.equal(propria?.senderPhoneJid, null);
  const [semTelefone] = store.listMessages({ chatJid: LID_SEM_TELEFONE, limit: 10 });
  assert.equal(semTelefone?.senderPhoneJid, null);
  const [porTelefone] = store.listMessages({ chatJid: OUTRO_TELEFONE, limit: 10 });
  assert.equal(porTelefone?.senderPhoneJid, null);
});

test('listMessages: corte por since continua funcionando com o JOIN', () => {
  const recentes = store.listMessages({ chatJid: LID, limit: 10, since: 1500 });
  assert.deepEqual(recentes.map((m) => m.id), ['m2']);
});

test('listChats: conversa LID com telefone conhecido traz phoneJid; demais null', () => {
  const chats = store.listChats({ limit: 10, onlyUnread: false });
  const porJid = new Map(chats.map((c) => [c.jid, c]));
  assert.equal(porJid.get(LID)?.phoneJid, TELEFONE);
  assert.equal(porJid.get(LID)?.name, 'Fulano', 'nome continua vindo de contacts');
  assert.equal(porJid.get(LID_SEM_TELEFONE)?.phoneJid, null);
  assert.equal(porJid.get(OUTRO_TELEFONE)?.phoneJid, null);
  assert.equal(store.listChats({ limit: 10, onlyUnread: true }).find((c) => c.jid === LID)?.phoneJid, TELEFONE);
});

test('getMessage: objeto interno não ganha o campo novo', () => {
  assert.equal('senderPhoneJid' in (store.getMessage('m1') ?? {}), false);
});

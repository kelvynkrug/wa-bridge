/**
 * Tipos de `protocolMessage` que os aparelhos da própria conta trocam só para se manter em
 * sincronia: histórico, chaves de app state, configurações de segurança e respostas do
 * celular. Não são conversa. Chegam como mensagem do usuário na conversa com ele mesmo e,
 * gravadas, viravam linhas `unknown` lá.
 *
 * Os números são os do enum `proto.Message.ProtocolMessage.Type` do Baileys (um teste
 * confere); os nomes são como o `toJSON` do protobuf grava no `raw_json`. Edição, apagar
 * para todos e similares ficam de fora: vêm de outras pessoas e dizem respeito à conversa.
 */
export const DEVICE_SYNC_PROTOCOL_TYPES = {
  EPHEMERAL_SYNC_RESPONSE: 4,
  HISTORY_SYNC_NOTIFICATION: 5,
  APP_STATE_SYNC_KEY_SHARE: 6,
  APP_STATE_SYNC_KEY_REQUEST: 7,
  MSG_FANOUT_BACKFILL_REQUEST: 8,
  INITIAL_SECURITY_NOTIFICATION_SETTING_SYNC: 9,
  APP_STATE_FATAL_EXCEPTION_NOTIFICATION: 10,
  PEER_DATA_OPERATION_REQUEST_MESSAGE: 16,
  PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE: 17,
  LID_MIGRATION_MAPPING_SYNC: 22,
} as const;

const NAMES = new Set<string>(Object.keys(DEVICE_SYNC_PROTOCOL_TYPES));
const IDS = new Set<number>(Object.values(DEVICE_SYNC_PROTOCOL_TYPES));

/** Verdadeiro se o tipo (número do enum ou nome) for de sincronização entre aparelhos. */
export function isDeviceSyncProtocolType(type: unknown): boolean {
  if (typeof type === 'number') return IDS.has(type);
  return typeof type === 'string' && NAMES.has(type);
}

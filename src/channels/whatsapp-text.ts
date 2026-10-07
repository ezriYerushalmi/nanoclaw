import type { WASocket } from '@whiskeysockets/baileys';
import { log } from '../log.js';
/** Presence is advisory; a presence failure must not prevent normal message delivery. */
export async function sendWhatsAppText(
  sock: Pick<WASocket, 'sendMessage' | 'sendPresenceUpdate'>,
  jid: string,
  text: string,
  mentions?: string[],
  composing = false,
) {
  if (composing) {
    try {
      await sock.sendPresenceUpdate('composing', jid);
    } catch (err) {
      log.debug('Failed to update committed-text typing status', { jid, err });
    }
  }
  return sock.sendMessage(jid, { text, ...(mentions?.length ? { mentions } : {}) });
}

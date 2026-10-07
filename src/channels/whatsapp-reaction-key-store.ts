import type { WAMessageKey } from '@whiskeysockets/baileys';
import { getDb } from '../db/connection.js';
import { withExistingMailboxSession } from '../session-manager.js';
import type { Session } from '../types.js';
import { whatsappMessageId } from './whatsapp-reaction.js';
/** Reuses persisted inbound metadata. No new database, table, or writer. */
export async function findPersistedReactionKey(
  platformId: string,
  messageId: string,
): Promise<WAMessageKey | undefined> {
  const id = whatsappMessageId(messageId);
  const sessions = await getDb().all<Session>(
    `SELECT s.* FROM sessions s JOIN messaging_groups m ON m.id = s.messaging_group_id
     WHERE m.channel_type = ? AND m.platform_id = ? ORDER BY s.last_active DESC LIMIT 8`,
    'whatsapp',
    platformId,
  );
  for (const session of sessions) {
    const key = await withExistingMailboxSession(session.agent_group_id, session.id, (mailbox) => {
      for (const row of mailbox.getInboundHistory(100)) {
        if (row.kind !== 'chat') continue;
        const content = JSON.parse(row.content) as { whatsappKey?: WAMessageKey };
        const key = content.whatsappKey;
        if (key?.id === id && key.remoteJid && (key.remoteJid === platformId || key.remoteJidAlt === platformId))
          return key;
      }
      return undefined;
    });
    if (key) return key;
  }
  return undefined;
}

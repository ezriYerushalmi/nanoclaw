import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HealthError, record, type Operation } from '../domain.js';
import type { TrustedInteraction } from '../services/health.js';
/** Reads real mailbox records, not sender fields supplied by the model or transport. */
export function resolveInteraction(
  sessionId: string,
  expectedMessageId: string,
  operation: Operation,
  sessionsRoot = process.env.ROBI_SESSIONS_PATH ?? '/sessions',
  policyPath = process.env.ROBI_POLICY_PATH ??
    join(process.env.ROBI_GROUP_PATH ?? '/config', 'whatsapp-interaction.json'),
  sourceMessageIndex?: unknown,
): TrustedInteraction {
  if (!/^sess-[a-zA-Z0-9-]+$/.test(sessionId)) throw new HealthError('invalid_session');
  const policy = record(JSON.parse(readFileSync(policyPath, 'utf8')) as unknown);
  if (!Array.isArray(policy.platformIds) || typeof policy.acknowledgeSender !== 'string')
    throw new HealthError('invalid_policy');
  const platformIds = policy.platformIds;
  const owner = policy.acknowledgeSender;
  const outbound = new Database(join(sessionsRoot, sessionId, 'outbound.db'), { readonly: true });
  const inbound = new Database(join(sessionsRoot, sessionId, 'inbound.db'), { readonly: true });
  try {
    inbound.exec('PRAGMA mmap_size=0; PRAGMA busy_timeout=5000');
    outbound.exec('PRAGMA mmap_size=0; PRAGMA busy_timeout=5000');
    const state = outbound
      .query<{ value: string }, [string]>('SELECT value FROM session_state WHERE key=?')
      .get('robi:active');
    if (!state) throw new HealthError('no_active_interaction');
    const active = record(JSON.parse(state.value) as unknown);
    if (!Array.isArray(active.rows) || !active.rows.length) throw new HealthError('no_active_interaction');
    const rows = active.rows.map((value: unknown) => {
      const id = record(value).id;
      if (typeof id !== 'string') throw new HealthError('invalid_interaction');
      const row = inbound
        .query<
          { id: string; kind: string; channel_type: string; platform_id: string; content: string; seq: number },
          [string]
        >('SELECT id,kind,channel_type,platform_id,content,seq FROM messages_in WHERE id=?')
        .get(id);
      if (!row || row.kind !== 'chat' || row.channel_type !== 'whatsapp' || !platformIds.includes(row.platform_id))
        throw new HealthError('interaction_out_of_scope');
      return row;
    });
    if (
      rows.some((row, i) => i > 0 && row.seq <= rows[i - 1].seq) ||
      rows.some((row) => row.platform_id !== rows[0].platform_id)
    )
      throw new HealthError('invalid_interaction');
    const last = rows.at(-1)!;
    if (last.id !== expectedMessageId) throw new HealthError('interaction_changed');
    if (
      sourceMessageIndex !== undefined &&
      (typeof sourceMessageIndex !== 'number' ||
        !Number.isInteger(sourceMessageIndex) ||
        sourceMessageIndex < 1 ||
        sourceMessageIndex > rows.length)
    )
      throw new HealthError('invalid_source_message_index');
    const sourceRow = rows[sourceMessageIndex === undefined ? rows.length - 1 : (sourceMessageIndex as number) - 1];
    const identities = rows.map((row) => {
      const sender = record(JSON.parse(row.content) as unknown).sender;
      if (typeof sender !== 'string') throw new HealthError('missing_sender');
      return sender.startsWith('whatsapp:') ? sender : `whatsapp:${sender}`;
    });
    const sourceContent = record(JSON.parse(sourceRow.content) as unknown);
    const originalKey = sourceContent.whatsappKey;
    const originalMessageId =
      originalKey && typeof originalKey === 'object' && 'id' in originalKey && typeof originalKey.id === 'string'
        ? originalKey.id
        : sourceRow.id;
    return {
      canWrite: identities.every((sender) => sender === owner),
      source: {
        channel: 'whatsapp',
        messageId: originalMessageId,
        idempotencyKey: createHash('sha256')
          .update(JSON.stringify([sourceRow.platform_id, sourceRow.id, operation]))
          .digest('hex'),
      },
    };
  } finally {
    inbound.close();
    outbound.close();
  }
}

import { afterEach, beforeEach, expect, it } from 'bun:test';
import { SqliteAgentMailbox } from '../../mailbox/sqlite/index.js';
import { initTestSessionDb, closeSessionDb, getInboundDb } from '../../mailbox/sqlite/connection.js';
import type { InboundMessage } from '../../mailbox/types.js';
import { robiMailbox, silenceHumanConversation } from './mailbox.js';
import { optedIn, selectBurst } from './policy.js';
import { policyForTurn } from '../../turn-policy.js';
const policy = { platformIds: ['group@g.us'], acknowledgeSender: 'whatsapp:owner', debounceMs: 3000 };
function row(sequence: number, time: number, sender = 'owner', platformId = 'group@g.us'): InboundMessage {
  return {
    id: `wa-${sequence}:ag-coach`,
    sequence,
    kind: 'chat',
    timestamp: new Date(time).toISOString(),
    status: 'pending',
    processAfter: null,
    recurrence: null,
    seriesId: null,
    tries: 0,
    trigger: true,
    platformId,
    channelType: 'whatsapp',
    threadId: null,
    sourceSessionId: null,
    onWake: false,
    content: JSON.stringify({ sender, text: `part ${sequence}`, attachments: [{ path: `/inbox/${sequence}.jpg` }] }),
  };
}
beforeEach(initTestSessionDb);
afterEach(closeSessionDb);
it('waits three seconds from final arrival, preserving boundaries, sender and media', () => {
  const rows = [row(2, 0), row(4, 1000), row(6, 2000), row(8, 2900)];
  expect(selectBurst(rows, policy, 5899)).toEqual([]);
  expect(selectBurst(rows, policy, 5900)).toEqual(rows);
});
it('isolates senders and groups; Participant is visible but is not the acknowledgment owner', () => {
  const a = row(2, 0),
    b = row(4, 2500, 'participant'),
    c = row(6, 2700, 'owner', 'other@g.us');
  expect(selectBurst([a, b, c], policy, 3000)).toEqual([a]);
  expect(selectBurst([b, c], policy, 5500)).toEqual([b]);
  expect(optedIn(b, policy)).toBe(true);
  expect(optedIn(c, policy)).toBe(false);
});
it('native mailbox decorator commits only one last-message reaction, text or explicit silence', async () => {
  const native = new SqliteAgentMailbox();
  const mailbox = robiMailbox(native, policy);
  const insert = (sequence: number, sender = 'owner') => {
    const m = row(sequence, Date.now() - 10000, sender);
    getInboundDb()
      .prepare(
        `INSERT INTO messages_in (id,seq,kind,timestamp,platform_id,channel_type,content)
      VALUES (?,?,?,?,?,?,?)`,
      )
      .run(m.id, sequence, m.kind, m.timestamp, m.platformId, m.channelType, m.content);
  };
  insert(2);
  insert(4);
  let batch = mailbox.operations.getPendingMessages(1, true);
  expect(batch.map((r) => r.id)).toEqual(['wa-2:ag-coach', 'wa-4:ag-coach']);
  let turn = policyForTurn(batch.map((r) => r.id))!;
  expect(turn.holdFollowUps).toBe(true);
  await mailbox.operations.writeMessageOut({
    id: 'reaction',
    kind: 'chat',
    channelType: 'whatsapp',
    platformId: 'group@g.us',
    content: JSON.stringify({ operation: 'reaction', messageId: 'wa-2:ag-coach', emoji: '💧' }),
  });
  expect(native.getUndeliveredMessages()).toEqual([]);
  await turn.finish(true);
  expect(native.getUndeliveredMessages()).toEqual([]);
  await turn.finish(false);
  expect(JSON.parse(native.getUndeliveredMessages()[0].content)).toEqual({
    operation: 'reaction',
    messageId: 'wa-4:ag-coach',
    emoji: '💧',
  });
  native.markMessages(
    batch.map((r) => r.id),
    'completed',
  );
  insert(6);
  batch = mailbox.operations.getPendingMessages(10, false);
  turn = policyForTurn(batch.map((r) => r.id))!;
  await mailbox.operations.writeMessageOut({
    id: 'text1',
    kind: 'chat',
    channelType: 'whatsapp',
    platformId: 'group@g.us',
    content: '{"text":"One coherent answer"}',
  });
  await mailbox.operations.writeMessageOut({
    id: 'text2',
    kind: 'chat',
    channelType: 'whatsapp',
    platformId: 'group@g.us',
    content: '{"text":"One coherent answer"}',
  });
  await turn.finish(false);
  expect(JSON.parse(native.getUndeliveredMessages().at(-1)!.content)).toEqual({ text: 'One coherent answer' });
  native.markMessages(
    batch.map((r) => r.id),
    'completed',
  );
  insert(8);
  batch = mailbox.operations.getPendingMessages(10, false);
  turn = policyForTurn(batch.map((r) => r.id))!;
  expect(silenceHumanConversation(mailbox.operations)).toBe(true);
  await turn.finish(false);
  expect(native.getUndeliveredMessages()).toHaveLength(2);
  native.markMessages(
    batch.map((r) => r.id),
    'completed',
  );
  insert(10);
  batch = mailbox.operations.getPendingMessages(10, false);
  turn = policyForTurn(batch.map((r) => r.id))!;
  await turn.finish(false);
  expect(JSON.parse(native.getUndeliveredMessages().at(-1)!.content)).toEqual({
    operation: 'reaction',
    messageId: 'wa-10:ag-coach',
    emoji: '👀',
  });
});
it('passes native behavior through when not configured', async () => {
  const native = new SqliteAgentMailbox();
  const mailbox = robiMailbox(native, null, false);
  await mailbox.operations.writeMessageOut({ id: 'plain', kind: 'chat', content: '{"text":"Native"}' });
  expect(native.getUndeliveredMessages()).toHaveLength(1);
});

it('holds a new arrival without invoking a turn and recovers held rows after runner restart', () => {
  const native = new SqliteAgentMailbox();
  const m = row(2, Date.now());
  getInboundDb()
    .prepare(
      `INSERT INTO messages_in (id,seq,kind,timestamp,platform_id,channel_type,content)
    VALUES (?,?,?,?,?,?,?)`,
    )
    .run(m.id, 2, m.kind, m.timestamp, m.platformId, m.channelType, m.content);
  const before = robiMailbox(native, policy, false);
  expect(before.operations.getPendingMessages(10, true)).toEqual([]);
  expect(native.getUndeliveredMessages()).toEqual([]);
  const held = JSON.parse(native.getState('robi:held')!.value);
  held[0].timestamp = new Date(Date.now() - 4000).toISOString();
  native.setState('robi:held', JSON.stringify(held));
  native.setState('robi:active', JSON.stringify({ rows: held, acknowledge: true }));
  native.setState('robi:drafts', '[]');
  const restarted = robiMailbox(new SqliteAgentMailbox(), policy, false);
  expect(restarted.operations.getPendingMessages(10, true).map((row) => row.id)).toEqual([m.id]);
  expect(native.getState('robi:active')).toBeUndefined();
});

it('system replies do not starve a ready WhatsApp burst and failed held rows are discarded', () => {
  const native = new SqliteAgentMailbox();
  const mailbox = robiMailbox(native, policy, false);
  const m = row(2, Date.now() - 10000);
  getInboundDb()
    .prepare(`INSERT INTO messages_in (id,seq,kind,timestamp,platform_id,channel_type,content) VALUES (?,?,?,?,?,?,?)`)
    .run(m.id, 2, m.kind, m.timestamp, m.platformId, m.channelType, m.content);
  getInboundDb()
    .prepare(`INSERT INTO messages_in (id,seq,kind,timestamp,content) VALUES (?,?,?,?,?)`)
    .run('system-reply', 4, 'system', m.timestamp, '{}');
  expect(mailbox.operations.getPendingMessages(10, true).map((r) => r.id)).toEqual([m.id]);
  getInboundDb().prepare("UPDATE messages_in SET status='failed' WHERE id=?").run(m.id);
  expect(mailbox.operations.getPendingMessages(10, false).map((r) => r.id)).toEqual(['system-reply']);
  expect(JSON.parse(native.getState('robi:held')!.value)).toEqual([]);
});

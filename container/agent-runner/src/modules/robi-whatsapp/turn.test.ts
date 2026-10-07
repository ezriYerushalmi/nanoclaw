import { afterEach, beforeEach, expect, it } from 'bun:test';
import { initTestSessionDb, closeSessionDb, getInboundDb } from '../../mailbox/sqlite/connection.js';
import { SqliteAgentMailbox } from '../../mailbox/sqlite/index.js';
import { getAgentMailbox, registerAgentMailbox, resetAgentMailboxForTesting } from '../../mailbox/index.js';
import { robiMailbox } from './mailbox.js';
import { getPendingMessages } from '../../db/messages-in.js';
import { processQuery } from '../../poll-loop.js';
import { extractRouting, formatMessages } from '../../formatter.js';
import type { AgentQuery } from '../../providers/types.js';
const policy = { platformIds: ['group@g.us'], acknowledgeSender: 'whatsapp:owner', debounceMs: 3000 };
const native = new SqliteAgentMailbox();
const decorated = robiMailbox(native, policy);
let original: ReturnType<typeof resetAgentMailboxForTesting>;
beforeEach(() => {
  initTestSessionDb();
  original = resetAgentMailboxForTesting();
  registerAgentMailbox(() => decorated);
  getInboundDb()
    .prepare(
      `INSERT INTO destinations (name,display_name,type,channel_type,platform_id) VALUES ('coach','coach','channel','whatsapp','group@g.us')`,
    )
    .run();
  for (let i = 1; i <= 3; i++)
    getInboundDb()
      .prepare(
        `INSERT INTO messages_in (id,seq,kind,timestamp,platform_id,channel_type,content) VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        `wa-${i}:ag-coach`,
        i * 2,
        'chat',
        new Date(Date.now() - 10000 + i).toISOString(),
        'group@g.us',
        'whatsapp',
        JSON.stringify({ sender: 'owner', text: ['אכלתי קוטג\u0027', 'עם סלט', 'ופרוסת לחם'][i - 1] }),
      );
});
afterEach(() => {
  resetAgentMailboxForTesting();
  if (original) registerAgentMailbox(original);
  closeSessionDb();
});
it('native parser stages streamed wrapped text and commits one normal text after result', async () => {
  const messages = getPendingMessages();
  expect(messages).toHaveLength(3);
  const text = '<message to="coach">One coherent answer</message>';
  const query: AgentQuery = {
    push() {},
    end() {},
    abort() {},
    events: (async function* () {
      yield { type: 'text' as const, text };
      expect(native.getUndeliveredMessages()).toHaveLength(0);
      yield { type: 'result' as const, text };
    })(),
  };
  await processQuery(
    query,
    extractRouting(messages),
    messages.map((m) => m.id),
    'mock',
    undefined,
    formatMessages(messages),
    undefined,
    true,
  );
  expect(native.getUndeliveredMessages()).toHaveLength(1);
  expect(JSON.parse(native.getUndeliveredMessages()[0].content)).toEqual({ text: 'One coherent answer' });
  expect(getAgentMailbox().operations.getState('robi:active')).toBeUndefined();
});
it('native wrap retry stays staged and does not produce premature fallback', async () => {
  const messages = getPendingMessages();
  let pushes = 0;
  const query: AgentQuery = {
    push() {
      pushes++;
    },
    end() {},
    abort() {},
    events: (async function* () {
      yield { type: 'result' as const, text: 'Unwrapped answer' };
      expect(native.getUndeliveredMessages()).toHaveLength(0);
      yield { type: 'result' as const, text: '<message to="coach">Wrapped answer</message>' };
    })(),
  };
  await processQuery(
    query,
    extractRouting(messages),
    messages.map((m) => m.id),
    'mock',
    undefined,
    formatMessages(messages),
    undefined,
    false,
  );
  expect(pushes).toBe(1);
  expect(native.getUndeliveredMessages()).toHaveLength(1);
  expect(JSON.parse(native.getUndeliveredMessages()[0].content)).toEqual({ text: 'Wrapped answer' });
});

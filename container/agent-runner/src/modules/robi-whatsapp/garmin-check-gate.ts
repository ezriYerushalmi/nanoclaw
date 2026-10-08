import '../../mailbox/compose.js';
import { getAgentMailbox } from '../../mailbox/index.js';
import { readPolicy } from './policy.js';
import fs from 'node:fs';
import { getOutboundDb } from '../../mailbox/sqlite/connection.js';
const ops = getAgentMailbox().operations;
const task = getOutboundDb()
  .query<{ message_id: string }, []>(
    "SELECT message_id FROM processing_ack WHERE status='processing' ORDER BY status_changed DESC LIMIT 20",
  )
  .all()
  .map((r) => ops.getMessageIn(r.message_id))
  .find((m) => m?.kind === 'task' && m.seriesId?.startsWith('robi-garmin-hourly-'));
if (!readPolicy() || !fs.existsSync('/workspace/agent/garmin-enabled') || !task)
  throw new Error('checker_out_of_scope');
try {
  await ops.writeMessageOut({
    id: `garmin-check-${task.id}`,
    inReplyTo: task.id,
    kind: 'system',
    content: JSON.stringify({ action: 'robi_garmin_check', occurrenceId: task.id }),
  });
} catch (error: unknown) {
  // A retry of this exact occurrence must not emit a second durable request.
  if (!(error instanceof Error) || !/unique|primary key/i.test(error.message)) throw error;
}
console.log(JSON.stringify({ wakeAgent: false }));

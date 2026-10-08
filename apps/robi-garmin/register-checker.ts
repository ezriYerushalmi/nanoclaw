import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { SocketTransport } from '../../src/cli/socket-client.js';
import {
  CHECKER_NAME,
  CHECKER_CRON,
  CHECKER_SCRIPT,
  CHECKER_TIMEZONE,
} from '../../src/modules/robi-whatsapp/garmin-schedule.js';
import { object } from '../robi-health/src/garmin/normalize.js';
export interface SchedulerClient {
  call(command: string[], args: Record<string, unknown>): Promise<unknown>;
}
export async function ensureCheckerSchedule(client: SchedulerClient, groupId: string) {
  const config = object(await client.call(['groups', 'config', 'get'], { id: groupId }));
  if (config.timezone !== CHECKER_TIMEZONE)
    await client.call(['groups', 'config', 'update'], { id: groupId, timezone: CHECKER_TIMEZONE });
  const tasks = await client.call(['tasks', 'list'], { group: groupId });
  if (!Array.isArray(tasks)) throw new Error('invalid_task_list');
  const matching = tasks
    .map(object)
    .filter((t) => typeof t.series_id === 'string' && t.series_id.startsWith(CHECKER_NAME + '-'));
  if (matching.length > 1) throw new Error('duplicate_checker_schedule_requires_review');
  if (matching.length === 1) {
    await client.call(['tasks', 'update'], {
      id: matching[0].series_id,
      group: groupId,
      recurrence: CHECKER_CRON,
      script: CHECKER_SCRIPT,
    });
    return { created: false, seriesId: matching[0].series_id };
  }
  const result = object(
    await client.call(['tasks', 'create'], {
      agent_group_id: groupId,
      name: CHECKER_NAME,
      recurrence: CHECKER_CRON,
      script: CHECKER_SCRIPT,
      prompt: 'Deterministic Garmin checker gate. No conversational response is needed for this polling task.',
    }),
  );
  return { created: true, seriesId: result.series_id };
}
if (process.argv[1]?.endsWith('register-checker.ts')) {
  const groupId = process.argv[2];
  if (!groupId?.startsWith('ag-')) throw new Error('provide_local_robi_group_id');
  fs.writeFileSync('data/garmin-connector/checker.json', JSON.stringify({ agentGroupId: groupId }), { mode: 0o600 });
  const transport = new SocketTransport();
  const result = await ensureCheckerSchedule(
    {
      async call(command, args) {
        const response = await transport.sendFrame({ id: randomUUID(), command: command.join('-'), args });
        if (!response.ok) throw new Error('native_scheduler_request_failed');
        return response.data;
      },
    },
    groupId,
  );
  console.log(
    JSON.stringify({ event: 'garmin_checker_registered', ...result, cron: CHECKER_CRON, timezone: CHECKER_TIMEZONE }),
  );
}

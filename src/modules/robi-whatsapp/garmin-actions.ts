import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GROUPS_DIR, DATA_DIR } from '../../config.js';
import { getAgentGroup } from '../../db/agent-groups.js';
import { findTaskSessions } from '../../db/sessions.js';
import { registerDeliveryAction, registerPostDeliveryHook } from '../../delivery.js';
import { unguarded } from '../../guard/index.js';
import { resolveTaskSession, withMailboxSession, withExistingMailboxSession } from '../../session-manager.js';
import { log } from '../../log.js';
import { CHECKER_NAME, CHECKER_SCRIPT, withinCheckerHours } from './garmin-schedule.js';
import { enqueueWorkoutAnalysis, type WorkoutEvent } from './garmin-job-dispatch.js';
const run = promisify(execFile);
const inFlight = new Set<string>();
// Only bounded job identifiers/status, never health payloads or credentials, are passed as argv.
async function jobStorage(command: string, input: unknown = {}) {
  const child = await run(
    '/Applications/Docker.app/Contents/Resources/bin/docker',
    ['exec', 'robi-health-service', 'bun', '/robi/src/garmin/jobs.ts', command, JSON.stringify(input)],
    { maxBuffer: 2 * 1024 * 1024, timeout: 30000 },
  );
  return JSON.parse(child.stdout) as unknown;
}
type PendingEvent = WorkoutEvent;
function eventRows(value: unknown): PendingEvent[] {
  if (!Array.isArray(value)) throw new Error('invalid_events');
  return value.map((v: unknown) => {
    if (
      !v ||
      typeof v !== 'object' ||
      !('id' in v) ||
      typeof v.id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(v.id) ||
      !('workoutId' in v) ||
      typeof v.workoutId !== 'string'
    )
      throw new Error('invalid_event');
    return v as PendingEvent;
  });
}
export async function dispatchWorkoutEvents(groupId: string): Promise<void> {
  if (!configuredGroup(groupId)) throw new Error('garmin_events_out_of_scope');
  const events = eventRows(await jobStorage('events'));
  const sessions = await findTaskSessions(groupId, true);
  await enqueueWorkoutAnalysis(events, {
    async status(series) {
      const existing = sessions.find((s) => s.thread_id === `system:tasks:${series}`);
      if (!existing) return undefined;
      const task = await withExistingMailboxSession(groupId, existing.id, (mailbox) => mailbox.getTask(series));
      if (!task) throw new Error('analysis_history_missing');
      return task.status;
    },
    async createOnce(series, prompt) {
      const { session } = await resolveTaskSession(groupId, series);
      await withMailboxSession(groupId, session.id, async (mailbox) => {
        if (mailbox.getTask(series)) return;
        await mailbox.insertTask({
          id: series,
          seriesId: series,
          processAfter: new Date().toISOString(),
          recurrence: null,
          content: JSON.stringify({ prompt, script: null, originSessionId: null }),
        });
      });
      log.info('Garmin workout analysis queued');
    },
    async complete(id) {
      await jobStorage('complete', { id });
    },
  });
}
function configuredGroup(id: string): boolean {
  try {
    const config: unknown = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, 'garmin-connector', 'checker.json'), 'utf8'),
    );
    return !!config && typeof config === 'object' && 'agentGroupId' in config && config.agentGroupId === id;
  } catch {
    return false;
  }
}
registerDeliveryAction(
  'robi_garmin_check',
  async (content, session) => {
    const group = await getAgentGroup(session.agent_group_id);
    if (
      !group ||
      !configuredGroup(group.id) ||
      !fs.existsSync(path.join(GROUPS_DIR, group.folder, 'garmin-enabled')) ||
      !fs.existsSync(path.join(GROUPS_DIR, group.folder, 'whatsapp-interaction.json')) ||
      typeof content.occurrenceId !== 'string'
    )
      throw new Error('garmin_checker_out_of_scope');
    const task = await withExistingMailboxSession(group.id, session.id, (mailbox) =>
      mailbox.getTask(content.occurrenceId as string),
    );
    if (
      !task?.seriesId?.startsWith(CHECKER_NAME + '-') ||
      session.thread_id !== `system:tasks:${task.seriesId}` ||
      JSON.parse(task.content).script !== CHECKER_SCRIPT
    )
      throw new Error('invalid_garmin_check_task');
    if (inFlight.has(group.id)) return;
    inFlight.add(group.id);
    try {
      if (withinCheckerHours()) {
        try {
          const result = await run(
            process.execPath,
            ['--env-file=data/garmin-connector/.env', '--import', 'tsx', 'apps/robi-garmin/keychain-poc.ts', 'check'],
            { timeout: 180000, maxBuffer: 65536, cwd: process.cwd() },
          );
          const info: unknown = JSON.parse(result.stdout.trim());
          if (info && typeof info === 'object' && 'requests' in info && 'imported' in info)
            log.info('Garmin lightweight activity check finished', {
              requests: info.requests,
              imported: info.imported,
            });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : '';
          const code = /keychain|credentials|authentication_required/.test(message)
            ? 'authentication_required'
            : 'connector_unavailable';
          await jobStorage('check-status', { code });
          log.warn('Garmin activity checker unavailable', { code });
        }
      }
      await dispatchWorkoutEvents(group.id);
    } finally {
      inFlight.delete(group.id);
    }
  },
  unguarded(
    'Scoped deterministic Garmin import requested only by an opted-in native checker task; no arbitrary commands or credentials accepted.',
  ),
);
registerPostDeliveryHook(async (message, session) => {
  const prefix = 'system:tasks:garmin-analysis-';
  if (configuredGroup(session.agent_group_id) && message.kind === 'chat' && session.thread_id?.startsWith(prefix)) {
    try {
      await jobStorage('complete', { id: session.thread_id.slice(prefix.length) });
    } catch {
      log.warn('Garmin event completion deferred');
    }
  }
});

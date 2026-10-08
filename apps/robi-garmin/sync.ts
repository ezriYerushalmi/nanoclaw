import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { connector } from './connector.js';
import { GarminSyncService, type SyncConfig } from './service.js';
import type { SyncBatch, SyncState } from '../robi-health/src/garmin/types.js';
import { object } from '../robi-health/src/garmin/normalize.js';
const configFile = path.resolve('data/garmin-connector/sync-config.json');
const config = fs.existsSync(configFile) ? object(JSON.parse(fs.readFileSync(configFile, 'utf8')) as unknown) : {};
const docker =
  typeof config.dockerBinary === 'string'
    ? config.dockerBinary
    : '/Applications/Docker.app/Contents/Resources/bin/docker';
const persist = async (command: 'state' | 'import', batch?: SyncBatch): Promise<unknown> => {
  const r = spawnSync(
    docker,
    [
      'exec',
      '-i',
      'robi-health-service',
      'bun',
      '/robi/src/garmin/import.ts',
      ...(command === 'state' ? ['state'] : []),
    ],
    { input: batch ? JSON.stringify(batch) : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error('robi_database_import_failed');
  return JSON.parse(r.stdout) as unknown;
};
const state = object(await persist('state'));
if (typeof state.timezone !== 'string' || !Array.isArray(state.states)) throw new Error('invalid_sync_state');
const limits: SyncConfig = {
  timezone: state.timezone,
  dailyDays: typeof config.dailyDays === 'number' ? config.dailyDays : 14,
  activityDays: typeof config.activityDays === 'number' ? config.activityDays : 30,
};
if (
  !Number.isInteger(limits.dailyDays) ||
  limits.dailyDays < 1 ||
  limits.dailyDays > 90 ||
  !Number.isInteger(limits.activityDays) ||
  limits.activityDays < 1 ||
  limits.activityDays > 90
)
  throw new Error('invalid_sync_window');
let provider: Awaited<ReturnType<typeof connector>> | undefined;
try {
  provider = await connector();
  const result = await new GarminSyncService(
    provider,
    {
      write: async (batch) => {
        await persist('import', batch);
      },
    },
    limits,
  ).sync(state.states as SyncState[]);
  console.log(JSON.stringify({ event: 'garmin_sync_complete', ...result }));
  console.log(JSON.stringify({ event: 'garmin_database_counts', counts: object(await persist('state')).counts }));
  if (result.failed.length) process.exitCode = 1;
} catch {
  for (const resource of ['daily', 'activities'] as const) {
    try {
      await persist('import', {
        resource,
        daily: [],
        workouts: [],
        syncedAt: new Date().toISOString(),
        errorCode: 'connector_unavailable',
      });
    } catch {}
  }
  console.error(JSON.stringify({ event: 'garmin_sync_failed', code: 'connector_or_database_unavailable' }));
  process.exitCode = 1;
} finally {
  await provider?.close();
}

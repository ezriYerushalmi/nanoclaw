import { spawnSync } from 'node:child_process';
import { connector } from './connector.js';
import { ActivityChecker } from './checker.js';
const docker = '/Applications/Docker.app/Contents/Resources/bin/docker';
function db(command: string, input: unknown): unknown {
  const r = spawnSync(docker, ['exec', '-i', 'robi-health-service', 'bun', '/robi/src/garmin/jobs.ts', command], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error('garmin_database_unavailable');
  return JSON.parse(r.stdout) as unknown;
}
let provider: Awaited<ReturnType<typeof connector>> | undefined;
try {
  provider = await connector();
  const result = await new ActivityChecker(provider, {
    async known(ids) {
      const value = db('known', ids);
      if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) throw new Error('invalid_known_ids');
      return value as string[];
    },
    async write(batch) {
      db('import', batch);
    },
  }).check();
  db('check-status', { code: null });
  console.log(JSON.stringify({ event: 'garmin_activity_check_complete', ...result }));
} catch (error: unknown) {
  const code =
    error instanceof Error && /auth|required|credentials|keychain/i.test(error.message)
      ? 'authentication_required'
      : 'connector_unavailable';
  try {
    db('check-status', { code });
  } catch {}
  console.log(JSON.stringify({ event: 'garmin_activity_check_failed', code }));
  process.exitCode = 1;
} finally {
  await provider?.close();
}

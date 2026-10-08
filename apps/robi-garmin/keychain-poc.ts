import { execFileSync, spawnSync } from 'node:child_process';
const account = process.env.GARMIN_EMAIL;
const service = process.env.GARMIN_KEYCHAIN_SERVICE ?? 'robi-garmin-connect';
if (!account) throw new Error('garmin_keychain_account_missing');
let password: string;
try {
  password = execFileSync('security', ['find-generic-password', '-a', account, '-s', service, '-w'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).replace(/[\r\n]+$/, '');
} catch {
  console.error(JSON.stringify({ status: 'blocked', code: 'garmin_keychain_lookup_failed' }));
  process.exit(2);
}
if (!password) throw new Error('garmin_keychain_password_empty');
const target = process.argv[2] ?? 'read';
if (!['read', 'sync', 'check'].includes(target)) throw new Error('expected_read_sync_or_check');
const args =
  target === 'read'
    ? ['apps/robi-garmin/poc.ts', 'read']
    : [target === 'sync' ? 'apps/robi-garmin/sync.ts' : 'apps/robi-garmin/check.ts'];
const result = spawnSync(process.execPath, ['--import', 'tsx', ...args], {
  env: { ...process.env, GARMIN_PASSWORD: password },
  stdio: 'inherit',
  timeout: target === 'sync' ? 1800000 : 180000,
});
if (result.error) console.error(JSON.stringify({ status: 'blocked', code: 'garmin_poc_process_failed' }));
process.exit(result.status ?? 2);

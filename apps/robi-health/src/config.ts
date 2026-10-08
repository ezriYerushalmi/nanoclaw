import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HealthError, positive, record, type HealthSettings } from './domain.js';
export function settings(path = join(process.env.ROBI_GROUP_PATH ?? '/config', 'health-data.json')): HealthSettings {
  const value = record(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  const user = record(value.user);
  if (
    typeof user.externalKey !== 'string' ||
    !user.externalKey ||
    typeof user.displayName !== 'string' ||
    typeof user.timezone !== 'string'
  )
    throw new HealthError('invalid_configuration');
  new Intl.DateTimeFormat('en', { timeZone: user.timezone }).format();
  return {
    externalKey: user.externalKey,
    displayName: user.displayName,
    timezone: user.timezone,
    waterGlassMl: value.waterGlassMl == null ? null : positive(value.waterGlassMl, 2000),
    waterTargetMl: value.waterTargetMl == null ? null : positive(value.waterTargetMl, 100_000),
  };
}

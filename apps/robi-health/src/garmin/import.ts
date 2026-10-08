import { connect, ready } from '../db/connection.js';
import { settings } from '../config.js';
import { UserRepository } from '../repositories/users.js';
import { GarminRepository } from './repository.js';
import { record } from '../domain.js';
import type { SyncBatch } from './types.js';
const db = connect();
try {
  await ready(db);
  const config = settings();
  const user = await new UserRepository(db).getByExternalKey(config.externalKey);
  if (!user) throw new Error('user_not_bootstrapped');
  const repo = new GarminRepository(db);
  if (process.argv[2] === 'state') {
    console.log(
      JSON.stringify({
        timezone: user.timezone,
        states: await repo.state(user.id),
        counts: await repo.counts(user.id),
      }),
    );
  } else {
    const data = record(JSON.parse(await Bun.stdin.text()) as unknown);
    if (
      !['daily', 'activities'].includes(String(data.resource)) ||
      !Array.isArray(data.daily) ||
      !Array.isArray(data.workouts) ||
      typeof data.syncedAt !== 'string' ||
      !Number.isFinite(Date.parse(data.syncedAt)) ||
      data.daily.length > 366 ||
      data.workouts.length > 1000
    )
      throw new Error('invalid_sync_batch');
    // Operator-only stdin boundary, inaccessible to agent containers; user resolved locally.
    const receipt = await repo.import(user.id, data as unknown as SyncBatch);
    console.log(JSON.stringify({ event: 'garmin_batch_persisted', ...receipt }));
  }
} catch {
  console.error(JSON.stringify({ event: 'garmin_persistence_error' }));
  process.exitCode = 1;
} finally {
  await db.close();
}

import { connect, ready } from '../db/connection.js';
import { settings } from '../config.js';
import { record } from '../domain.js';
import { UserRepository } from '../repositories/users.js';
import { GarminRepository } from './repository.js';
import { GarminReadService } from './read-service.js';
import type { SyncBatch } from './types.js';
const db = connect();
try {
  await ready(db);
  const config = settings(),
    user = await new UserRepository(db).getByExternalKey(config.externalKey);
  if (!user) throw new Error('user_not_bootstrapped');
  const operation = process.argv[2],
    input: unknown = JSON.parse(process.argv[3] ?? ((await Bun.stdin.text()) || '{}'));
  const repo = new GarminRepository(db);
  let result: unknown;
  if (operation === 'known') {
    if (!Array.isArray(input) || input.length > 10 || !input.every((id) => typeof id === 'string' && /^\d+$/.test(id)))
      throw new Error('invalid_ids');
    result = await repo.knownIds(user.id, input as string[]);
  } else if (operation === 'import') {
    const batch = record(input);
    if (
      batch.resource !== 'activities' ||
      batch.enqueueAnalysis !== true ||
      !Array.isArray(batch.workouts) ||
      batch.workouts.length !== 1 ||
      !Array.isArray(batch.daily) ||
      batch.daily.length ||
      typeof batch.syncedAt !== 'string'
    )
      throw new Error('invalid_import');
    result = await repo.import(user.id, batch as unknown as SyncBatch);
  } else if (operation === 'events') {
    const rows = await db<
      { id: string; workout_id: string }[]
    >`SELECT id,workout_id FROM workout_analysis_events WHERE user_id=${user.id} AND status='pending' ORDER BY created_at LIMIT 50`;
    const service = new GarminReadService(db, config);
    const context = {
      canWrite: true,
      source: { channel: 'operator', messageId: 'scheduled-coaching', idempotencyKey: 'scheduled-coaching' },
    };
    const recent = rows.length ? await service.execute('get_recent_workouts', { days: 30, limit: 20 }, context) : null;
    const recovery = rows.length ? await service.execute('get_recovery_status', {}, context) : null;
    result = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        workoutId: row.workout_id,
        workout: await service.execute('get_workout_details', { workoutId: row.workout_id }, context),
        recent,
        recovery,
      })),
    );
  } else if (operation === 'complete') {
    const id = record(input).id;
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('invalid_event');
    await db`UPDATE workout_analysis_events SET status='completed',completed_at=${new Date().toISOString()}::timestamptz WHERE user_id=${user.id} AND id=${id}::uuid AND status='pending'`;
    result = { completed: true };
  } else if (operation === 'check-status') {
    const code = record(input).code;
    if (code !== null && !['authentication_required', 'connector_unavailable'].includes(String(code)))
      throw new Error('invalid_status');
    const now = new Date().toISOString();
    if (code === null)
      await db`INSERT INTO garmin_sync_state(user_id,resource_type,last_successful_sync_at) VALUES(${user.id},'activity_checker',${now}::timestamptz) ON CONFLICT(user_id,resource_type) DO UPDATE SET last_successful_sync_at=EXCLUDED.last_successful_sync_at,last_error_at=NULL,last_error_code=NULL`;
    else
      await db`INSERT INTO garmin_sync_state(user_id,resource_type,last_error_at,last_error_code) VALUES(${user.id},'activity_checker',${now}::timestamptz,${String(code)}) ON CONFLICT(user_id,resource_type) DO UPDATE SET last_error_at=EXCLUDED.last_error_at,last_error_code=EXCLUDED.last_error_code`;
    result = { recorded: true };
  } else throw new Error('invalid_operation');
  console.log(JSON.stringify(result));
} catch {
  console.error(JSON.stringify({ event: 'garmin_job_storage_error' }));
  process.exitCode = 1;
} finally {
  await db.close();
}

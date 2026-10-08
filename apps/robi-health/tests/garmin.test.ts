import { SQL } from 'bun';
import { beforeAll, beforeEach, afterAll, test, expect } from 'bun:test';
import { connect, ready } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { UserRepository } from '../src/repositories/users.js';
import { GarminRepository } from '../src/garmin/repository.js';
import { GarminReadService } from '../src/garmin/read-service.js';
import { normalizeDaily, normalizeWorkout, localDate, datesEnding } from '../src/garmin/normalize.js';
import type { SyncBatch } from '../src/garmin/types.js';
import type { HealthSettings } from '../src/domain.js';
import { randomUUID } from 'node:crypto';
const config: HealthSettings = {
  externalKey: 'synthetic-garmin-owner',
  displayName: 'Synthetic',
  timezone: 'Asia/Jerusalem',
  waterGlassMl: null,
  waterTargetMl: 3000,
};
const now = new Date('2026-07-02T10:00:00Z');
const owner = { canWrite: true, source: { channel: 'test', messageId: 'test', idempotencyKey: 'test' } };
const admin = connect(true);
let db: SQL, repo: GarminRepository, userId: string;
beforeAll(async () => {
  await ready(admin);
  const exists = await admin<
    { present: boolean }[]
  >`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='robi_garmin_test') present`;
  if (!exists[0].present) await admin.unsafe('CREATE DATABASE robi_garmin_test');
  db = new SQL({
    adapter: 'postgres',
    hostname: process.env.ROBI_DB_HOST ?? 'postgres',
    database: 'robi_garmin_test',
    username: 'robi_db_admin',
    password: process.env.ROBI_DB_ADMIN_PASSWORD,
  });
  await ready(db);
  await migrate(db);
  await migrate(db);
  repo = new GarminRepository(db);
});
afterAll(async () => {
  await db.close();
  await admin.close();
});
beforeEach(async () => {
  await db`TRUNCATE users CASCADE`;
  userId = (await new UserRepository(db).ensureUser(config)).id;
});
const daily = () =>
  normalizeDaily('2026-07-02', 'Asia/Jerusalem', {
    summary: {
      calendarDate: '2026-07-02',
      totalSteps: 6000,
      restingHeartRate: 55,
      averageStressLevel: 25,
      bodyBatteryMostRecentValue: 60,
      bodyBatteryHighestValue: 90,
      bodyBatteryLowestValue: 20,
      lastSyncTimestampGMT: '2026-07-02T09:00:00Z',
    },
    sleep: {
      dailySleepDTO: { calendarDate: '2026-07-02', sleepTimeSeconds: 25200, sleepScores: { overall: { value: 85 } } },
    },
    hrv: { hrvSummary: { calendarDate: '2026-07-02', lastNightAvg: 45 } },
    readiness: [],
    training: {},
  });
const workout = () =>
  normalizeWorkout(
    {
      activityId: 123,
      activityTypeDTO: { typeKey: 'running' },
      summaryDTO: {
        startTimeGMT: '2026-07-02T07:00:00',
        duration: 1200,
        distance: 3000,
        averageSpeed: 2.5,
        averageHR: 150,
        maxHR: 170,
      },
    },
    { lapDTOs: [{ lapIndex: 1, distance: 1000, duration: 400, averageHR: 145 }] },
    [{ zoneNumber: 3, secsInZone: 500, zoneLowBoundary: 140 }],
    { exerciseSets: null },
  );
function batch(resource: 'daily' | 'activities'): SyncBatch {
  return {
    resource,
    syncedAt: now.toISOString(),
    daily: resource === 'daily' ? [daily()] : [],
    workouts: resource === 'activities' ? [workout()] : [],
  };
}
test('daily upsert preserves null readiness and repeated sync creates one logical row', async () => {
  await repo.import(userId, batch('daily'));
  await repo.import(userId, batch('daily'));
  const rows = await db<
    { training_readiness: null; hrv: string }[]
  >`SELECT training_readiness,hrv FROM garmin_daily_health`;
  expect(rows).toHaveLength(1);
  expect(rows[0].training_readiness).toBeNull();
  expect(Number(rows[0].hrv)).toBe(45);
});
test('checker workout/event commit atomically; retries and client restart preserve one pending event', async () => {
  const b = { ...batch('activities'), enqueueAnalysis: true };
  await repo.import(userId, b);
  await repo.import(userId, b);
  expect(await repo.knownIds(userId, ['123', '999'])).toEqual(['123']);
  const recreated = new GarminRepository(db);
  await recreated.import(userId, b);
  const events = await db<
    { id: string; status: string }[]
  >`SELECT id,status FROM workout_analysis_events WHERE user_id=${userId}`;
  expect(events).toHaveLength(1);
  expect(events[0].status).toBe('pending');
  await db`UPDATE workout_analysis_events SET status='completed' WHERE id=${events[0].id}`;
  await recreated.import(userId, b);
  expect(
    (await db<{ status: string }[]>`SELECT status FROM workout_analysis_events WHERE user_id=${userId}`)[0].status,
  ).toBe('completed');
  expect((await repo.counts(userId)).workouts).toBe(1);
});
test('a failed event insert rolls back the new workout; full manual sync never queues coaching', async () => {
  await repo.import(userId, batch('activities'));
  expect(await db`SELECT id FROM workout_analysis_events`).toHaveLength(0);
  const b = { ...batch('activities'), enqueueAnalysis: true };
  b.workouts[0].externalActivityId = '987';
  await db.unsafe(
    "CREATE FUNCTION reject_test_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$",
  );
  await db.unsafe(
    'CREATE TRIGGER test_event_failure BEFORE INSERT ON workout_analysis_events FOR EACH ROW EXECUTE FUNCTION reject_test_event()',
  );
  try {
    await expect(repo.import(userId, b)).rejects.toThrow();
    expect((await repo.counts(userId)).workouts).toBe(1);
  } finally {
    await db.unsafe('DROP TRIGGER test_event_failure ON workout_analysis_events');
    await db.unsafe('DROP FUNCTION reject_test_event()');
  }
});
test('activities, splits and zones persist idempotently; missing strength sets are optional', async () => {
  await repo.import(userId, batch('activities'));
  await repo.import(userId, batch('activities'));
  expect(await repo.counts(userId)).toEqual({ daily: 0, workouts: 1, splits: 1, zones: 1, sets: 0 });
  const rows = await db<{ avg_speed: string; avg_pace: string }[]>`SELECT avg_speed,avg_pace FROM workouts`;
  expect(Number(rows[0].avg_speed)).toBe(2.5);
  expect(Number(rows[0].avg_pace)).toBe(400);
});
test('strength sets with explicit units persist; unknown weight units remain null', async () => {
  const w = normalizeWorkout(
    {
      activityId: 9,
      activityTypeDTO: { typeKey: 'strength_training' },
      summaryDTO: { startTimeGMT: '2026-07-02T08:00:00Z', duration: 1000 },
    },
    { lapDTOs: [] },
    [],
    {
      exerciseSets: [
        {
          repetitionCount: 10,
          weight: 15000,
          weightUnit: 'GRAM',
          setType: 'ACTIVE',
          exercises: [{ exerciseName: 'DUMBBELL_PRESS' }],
        },
        { repetitionCount: 8, weight: 20 },
      ],
    },
  );
  await repo.import(userId, { ...batch('activities'), workouts: [w] });
  const rows = await db<
    { weight_kg: string | null; reps: number }[]
  >`SELECT weight_kg,reps FROM workout_sets ORDER BY set_index`;
  expect(rows).toHaveLength(2);
  expect(Number(rows[0].weight_kg)).toBe(15);
  expect(rows[1].weight_kg).toBeNull();
  expect(rows[0].reps).toBe(10);
});
test('failure preserves cached data and last success; stale status remains visible', async () => {
  await repo.import(userId, batch('daily'));
  await repo.import(userId, {
    resource: 'daily',
    daily: [],
    workouts: [],
    syncedAt: '2026-07-02T11:00:00Z',
    errorCode: 'connector_unavailable',
  });
  expect((await repo.counts(userId)).daily).toBe(1);
  const state = (await repo.state(userId))[0];
  expect(state.last_successful_sync_at).not.toBeNull();
  expect(state.last_error_code).toBe('connector_unavailable');
  const read = (await new GarminReadService(db, config, () => now).execute('get_recovery_status', {}, owner)) as {
    freshness: { stale: boolean };
  };
  expect(read.freshness.stale).toBe(true);
});
test('DB-only tools work without a Garmin provider, enforce owner authority and never replace missing today', async () => {
  await repo.import(userId, batch('daily'));
  await repo.import(userId, batch('activities'));
  const read = new GarminReadService(db, config, () => now);
  const recovery = (await read.execute('get_recovery_status', {}, owner)) as {
    data: { hrv: number; trainingReadiness: null };
    missing: boolean;
  };
  expect(recovery.data.hrv).toBe(45);
  expect(recovery.data.trainingReadiness).toBeNull();
  const next = (await new GarminReadService(db, config, () => new Date('2026-07-03T10:00:00Z')).execute(
    'get_recovery_status',
    {},
    owner,
  )) as { data: null; missing: boolean };
  expect(next.data).toBeNull();
  expect(next.missing).toBe(true);
  await expect(read.execute('get_recovery_status', {}, { ...owner, canWrite: false })).rejects.toThrow(
    'unauthorized_sender',
  );
  const rows = await db<{ id: string }[]>`SELECT id FROM workouts`;
  const details = (await read.execute('get_workout_details', { workoutId: rows[0].id }, owner)) as {
    splits: unknown[];
    hrZones: unknown[];
    sets: unknown[];
  };
  expect(details.splits).toHaveLength(1);
  expect(details.hrZones).toHaveLength(1);
  expect(details.sets).toEqual([]);
});
test('conservative manual reconciliation preserves ID and user override, keeps original manual facts', async () => {
  const id = randomUUID();
  await db`INSERT INTO workouts(id,user_id,source,sport,started_at,duration_seconds,distance_meters,user_overrides,created_at,updated_at) VALUES(${id},${userId},'manual','running','2026-07-02T07:00:30Z',1200,3000,'{"distanceMeters":3200}'::jsonb,${now.toISOString()},${now.toISOString()})`;
  await repo.import(userId, batch('activities'));
  await repo.import(userId, batch('activities'));
  const rows = await db<
    { id: string; user_overrides: { distanceMeters: number }; raw_metadata: { manualReported: unknown } }[]
  >`SELECT id,user_overrides,raw_metadata FROM workouts`;
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(id);
  expect(rows[0].user_overrides.distanceMeters).toBe(3200);
  expect(rows[0].raw_metadata.manualReported).toBeDefined();
  const read = (await new GarminReadService(db, config, () => now).execute(
    'get_workout_details',
    { workoutId: id },
    owner,
  )) as { workout: { effective: { distanceMeters: number }; device: { distanceMeters: number } } };
  expect(read.workout.effective.distanceMeters).toBe(3200);
  expect(read.workout.device.distanceMeters).toBe(3000);
});
test('ambiguous manual matches remain separate rather than merging arbitrarily', async () => {
  for (let i = 0; i < 2; i++)
    await db`INSERT INTO workouts(id,user_id,source,sport,started_at,duration_seconds,distance_meters,created_at,updated_at) VALUES(${randomUUID()},${userId},'manual','running','2026-07-02T07:00:30Z',1200,3000,${now.toISOString()},${now.toISOString()})`;
  await repo.import(userId, batch('activities'));
  expect((await repo.counts(userId)).workouts).toBe(3);
});
test('timezone boundaries and mismatched metric dates are explicit', () => {
  expect(localDate(new Date('2026-07-01T21:01:00Z'))).toBe('2026-07-02');
  expect(localDate(new Date('2026-01-01T21:01:00Z'))).toBe('2026-01-01');
  expect(datesEnding('2026-03-28', 3)).toEqual(['2026-03-26', '2026-03-27', '2026-03-28']);
  expect(
    normalizeDaily('2026-07-02', 'Asia/Jerusalem', {
      hrv: { hrvSummary: { calendarDate: '2026-07-01', lastNightAvg: 100 } },
    }).hrv,
  ).toBeNull();
});

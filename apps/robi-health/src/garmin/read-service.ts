import type { SQL } from 'bun';
import { HealthError, record, type HealthSettings } from '../domain.js';
import { UserRepository } from '../repositories/users.js';
import { GarminRepository } from './repository.js';
import { localDate } from './normalize.js';
import type { GarminOperation } from './types.js';
import type { TrustedInteraction } from '../services/health.js';
function camel(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value]),
  );
}
export class GarminReadService {
  constructor(
    private readonly db: SQL,
    private readonly config: HealthSettings,
    private readonly clock = () => new Date(),
  ) {}
  async execute(operation: GarminOperation, input: unknown, context: TrustedInteraction): Promise<unknown> {
    if (!context.canWrite) throw new HealthError('unauthorized_sender'); // Owner-only reads, not general group visibility.
    const args = record(input);
    const allowed =
      operation === 'get_workout_details'
        ? ['workoutId']
        : operation === 'get_recent_workouts'
          ? ['days', 'limit']
          : ['date'];
    if (Object.keys(args).some((k) => !allowed.includes(k))) throw new HealthError('unexpected_argument');
    const user = await new UserRepository(this.db).getByExternalKey(this.config.externalKey);
    if (!user) throw new HealthError('user_not_bootstrapped');
    const states = await new GarminRepository(this.db).state(user.id);
    const relevant = states.find(
      (s) =>
        s.resource_type ===
        (operation === 'get_recent_workouts' || operation === 'get_workout_details' ? 'activities' : 'daily'),
    );
    const syncedAt = relevant?.last_successful_sync_at ?? null;
    const freshness = {
      syncedAt,
      sourceUpdatedAt: relevant?.last_source_timestamp ?? null,
      lastErrorAt: relevant?.last_error_at ?? null,
      lastErrorCode: relevant?.last_error_code ?? null,
      stale: !syncedAt || this.clock().getTime() - Date.parse(syncedAt) > 2 * 3600000 || !!relevant?.last_error_code,
    };
    if (operation === 'get_workout_details') {
      if (typeof args.workoutId !== 'string' || !/^[0-9a-f-]{36}$/i.test(args.workoutId))
        throw new HealthError('invalid_workout_id');
      const rows = await this.db<
        { body: Record<string, unknown> }[]
      >`SELECT to_jsonb(w)-ARRAY['user_id','raw_metadata'] AS body FROM workouts w WHERE user_id=${user.id} AND id=${args.workoutId}::uuid`;
      if (!rows.length) return { workout: null, freshness };
      const splits = await this
        .db`SELECT split_index,distance_meters::double precision,duration_seconds::double precision,avg_hr::double precision,avg_speed::double precision FROM workout_splits WHERE workout_id=${args.workoutId}::uuid ORDER BY split_index`;
      const hrZones = await this
        .db`SELECT zone_number,duration_seconds::double precision,low_boundary::double precision FROM workout_hr_zones WHERE workout_id=${args.workoutId}::uuid ORDER BY zone_number`;
      const sets = await this
        .db`SELECT set_index,exercise,set_type,reps,weight_kg::double precision,duration_seconds::double precision FROM workout_sets WHERE workout_id=${args.workoutId}::uuid ORDER BY set_index`;
      return {
        workout: this.summary(rows[0].body),
        splits: splits.map(camel),
        hrZones: hrZones.map(camel),
        sets: sets.map(camel),
        freshness,
        units: {
          distance: 'meters',
          duration: 'seconds',
          speed: 'meters_per_second',
          pace: 'seconds_per_km',
          weight: 'kg',
        },
      };
    }
    if (operation === 'get_recent_workouts') {
      const days = args.days ?? 30;
      const limit = args.limit ?? 10;
      if (
        typeof days !== 'number' ||
        !Number.isInteger(days) ||
        days < 1 ||
        days > 90 ||
        typeof limit !== 'number' ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 50
      )
        throw new HealthError('invalid_workout_range');
      const start = new Date(this.clock().getTime() - days * 86400000).toISOString();
      const rows = await this.db<
        { body: Record<string, unknown> }[]
      >`SELECT to_jsonb(w)-ARRAY['user_id','raw_metadata'] AS body FROM workouts w WHERE user_id=${user.id} AND started_at>=${start}::timestamptz AND started_at<=${this.clock().toISOString()}::timestamptz ORDER BY started_at DESC LIMIT ${limit}`;
      return {
        workouts: rows.map((r) => this.summary(r.body)),
        freshness,
        units: { distance: 'meters', duration: 'seconds', speed: 'meters_per_second', pace: 'seconds_per_km' },
      };
    }
    const date = args.date ?? localDate(this.clock(), user.timezone);
    if (
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date + 'T00:00:00Z')) ||
      new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date
    )
      throw new HealthError('invalid_date');
    const rows = await this.db<
      { body: Record<string, unknown> }[]
    >`SELECT to_jsonb(d)-ARRAY['id','user_id','raw_metadata'] AS body FROM garmin_daily_health d WHERE user_id=${user.id} AND local_date=${date}::date`;
    const data = rows.length ? camel(rows[0].body) : null;
    if (operation === 'get_training_status') {
      const recent = await this.execute('get_recent_workouts', { days: 7, limit: 20 }, context);
      return {
        date,
        timezone: user.timezone,
        missing: data === null,
        data: data
          ? {
              trainingStatus: data.trainingStatus,
              trainingLoad: data.trainingLoad,
              trainingReadiness: data.trainingReadiness,
            }
          : null,
        recentActivityContext: recent,
        freshness: {
          ...freshness,
          stale: freshness.stale || data === null,
          sourceUpdatedAt: data?.sourceUpdatedAt ?? null,
        },
      };
    }
    return {
      date,
      timezone: user.timezone,
      missing: data === null,
      data,
      freshness: {
        ...freshness,
        stale: freshness.stale || data === null,
        sourceUpdatedAt: data?.sourceUpdatedAt ?? null,
      },
    };
  }
  private summary(row: Record<string, unknown>) {
    const device = camel(row);
    const overrides = record(device.userOverrides ?? {});
    delete device.userOverrides;
    return { device, userOverrides: overrides, effective: { ...device, ...overrides } };
  }
}

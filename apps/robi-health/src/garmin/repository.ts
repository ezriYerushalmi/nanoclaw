import type { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import type { SyncBatch, Workout, DailyHealth, SyncState } from './types.js';
export class GarminRepository {
  constructor(private readonly db: SQL) {}
  async state(userId: string): Promise<SyncState[]> {
    return this.db<
      SyncState[]
    >`SELECT resource_type,last_successful_sync_at::text,last_source_timestamp::text,last_error_at::text,last_error_code FROM garmin_sync_state WHERE user_id=${userId}`;
  }
  async import(userId: string, batch: SyncBatch): Promise<{ daily: number; workouts: number }> {
    return this.db.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${userId},0))`;
      if (batch.errorCode) {
        await tx`INSERT INTO garmin_sync_state(user_id,resource_type,last_error_at,last_error_code) VALUES(${userId},${batch.resource},${batch.syncedAt}::timestamptz,${batch.errorCode}) ON CONFLICT(user_id,resource_type) DO UPDATE SET last_error_at=EXCLUDED.last_error_at,last_error_code=EXCLUDED.last_error_code`;
        return { daily: 0, workouts: 0 };
      }
      for (const row of batch.daily) await this.daily(tx, userId, row, batch.syncedAt);
      for (const row of batch.workouts) {
        const result = await this.workout(tx, userId, row, batch.syncedAt);
        if (batch.enqueueAnalysis && result.newExternalId)
          await tx`INSERT INTO workout_analysis_events(id,user_id,workout_id,created_at) VALUES(${randomUUID()},${userId},${result.id},${batch.syncedAt}::timestamptz) ON CONFLICT(user_id,workout_id) DO NOTHING`;
      }
      const timestamps = [...batch.daily.map((r) => r.sourceUpdatedAt), ...batch.workouts.map((r) => r.startedAt)]
        .filter((v): v is string => v !== null)
        .sort();
      await tx`INSERT INTO garmin_sync_state(user_id,resource_type,last_successful_sync_at,last_source_timestamp) VALUES(${userId},${batch.resource},${batch.syncedAt}::timestamptz,${timestamps.at(-1) ?? null}::timestamptz) ON CONFLICT(user_id,resource_type) DO UPDATE SET last_successful_sync_at=EXCLUDED.last_successful_sync_at,last_source_timestamp=GREATEST(garmin_sync_state.last_source_timestamp,EXCLUDED.last_source_timestamp),last_error_at=NULL,last_error_code=NULL`;
      return { daily: batch.daily.length, workouts: batch.workouts.length };
    });
  }
  private async daily(tx: SQL, userId: string, d: DailyHealth, now: string) {
    await tx`INSERT INTO garmin_daily_health(id,user_id,local_date,timezone,sleep_duration_minutes,sleep_score,hrv,resting_hr,average_stress,body_battery_start,body_battery_end,body_battery_high,body_battery_low,training_readiness,training_status,training_load,steps,source_updated_at,raw_metadata,created_at,updated_at)
  VALUES(${randomUUID()},${userId},${d.date}::date,${d.timezone},${d.sleepDurationMinutes},${d.sleepScore},${d.hrv},${d.restingHr},${d.averageStress},${d.bodyBatteryStart},${d.bodyBatteryEnd},${d.bodyBatteryHigh},${d.bodyBatteryLow},${d.trainingReadiness},${d.trainingStatus},${d.trainingLoad},${d.steps},${d.sourceUpdatedAt}::timestamptz,${JSON.stringify(d.rawMetadata)}::text::jsonb,${now}::timestamptz,${now}::timestamptz)
  ON CONFLICT(user_id,local_date) DO UPDATE SET timezone=EXCLUDED.timezone,sleep_duration_minutes=EXCLUDED.sleep_duration_minutes,sleep_score=EXCLUDED.sleep_score,hrv=EXCLUDED.hrv,resting_hr=EXCLUDED.resting_hr,average_stress=EXCLUDED.average_stress,body_battery_start=EXCLUDED.body_battery_start,body_battery_end=EXCLUDED.body_battery_end,body_battery_high=EXCLUDED.body_battery_high,body_battery_low=EXCLUDED.body_battery_low,training_readiness=EXCLUDED.training_readiness,training_status=EXCLUDED.training_status,training_load=EXCLUDED.training_load,steps=EXCLUDED.steps,source_updated_at=EXCLUDED.source_updated_at,raw_metadata=EXCLUDED.raw_metadata,updated_at=EXCLUDED.updated_at`;
  }
  private async workout(tx: SQL, userId: string, w: Workout, now: string) {
    const found = await tx<
      { id: string }[]
    >`SELECT id FROM workouts WHERE user_id=${userId} AND source='garmin' AND external_activity_id=${w.externalActivityId}`;
    let id = found[0]?.id;
    if (!id && w.durationSeconds !== null && w.distanceMeters !== null) {
      const matches = await tx<
        { id: string }[]
      >`SELECT id FROM workouts WHERE user_id=${userId} AND source='manual' AND external_activity_id IS NULL AND sport=${w.sport} AND ABS(EXTRACT(EPOCH FROM(started_at-${w.startedAt}::timestamptz)))<=120 AND duration_seconds>0 AND distance_meters>0 AND ABS(duration_seconds-${w.durationSeconds})<=duration_seconds*0.05 AND ABS(distance_meters-${w.distanceMeters})<=distance_meters*0.05 LIMIT 2`;
      if (matches.length === 1) id = matches[0].id;
    }
    if (id) {
      await tx`UPDATE workouts SET source='garmin',external_activity_id=${w.externalActivityId},sport=${w.sport},started_at=${w.startedAt}::timestamptz,duration_seconds=${w.durationSeconds},distance_meters=${w.distanceMeters},calories=${w.calories},avg_hr=${w.avgHr},max_hr=${w.maxHr},avg_speed=${w.avgSpeed},avg_pace=${w.avgPace},elevation_gain=${w.elevationGain},cadence=${w.cadence},training_load=${w.trainingLoad},aerobic_training_effect=${w.aerobicTrainingEffect},anaerobic_training_effect=${w.anaerobicTrainingEffect},raw_metadata=(CASE WHEN source='manual' THEN jsonb_build_object('manualReported',jsonb_build_object('startedAt',started_at,'durationSeconds',duration_seconds,'distanceMeters',distance_meters))||raw_metadata ELSE raw_metadata END)||${JSON.stringify(w.rawMetadata)}::text::jsonb,updated_at=${now}::timestamptz WHERE id=${id}`;
    } else {
      id = randomUUID();
      await tx`INSERT INTO workouts(id,user_id,source,external_activity_id,sport,started_at,duration_seconds,distance_meters,calories,avg_hr,max_hr,avg_speed,avg_pace,elevation_gain,cadence,training_load,aerobic_training_effect,anaerobic_training_effect,raw_metadata,created_at,updated_at)
   VALUES(${id},${userId},'garmin',${w.externalActivityId},${w.sport},${w.startedAt}::timestamptz,${w.durationSeconds},${w.distanceMeters},${w.calories},${w.avgHr},${w.maxHr},${w.avgSpeed},${w.avgPace},${w.elevationGain},${w.cadence},${w.trainingLoad},${w.aerobicTrainingEffect},${w.anaerobicTrainingEffect},${JSON.stringify(w.rawMetadata)}::text::jsonb,${now}::timestamptz,${now}::timestamptz)`;
    }
    if (w.splits !== null) {
      await tx`DELETE FROM workout_splits WHERE workout_id=${id}`;
      for (const s of w.splits)
        await tx`INSERT INTO workout_splits VALUES(${id},${s.index},${s.distanceMeters},${s.durationSeconds},${s.avgHr},${s.avgSpeed},${JSON.stringify(s.rawMetadata)}::text::jsonb)`;
    }
    if (w.hrZones !== null) {
      await tx`DELETE FROM workout_hr_zones WHERE workout_id=${id}`;
      for (const z of w.hrZones)
        await tx`INSERT INTO workout_hr_zones VALUES(${id},${z.number},${z.durationSeconds},${z.lowBoundary},${JSON.stringify(z.rawMetadata)}::text::jsonb)`;
    }
    if (w.sets !== null) {
      await tx`DELETE FROM workout_sets WHERE workout_id=${id}`;
      for (const s of w.sets)
        await tx`INSERT INTO workout_sets VALUES(${id},${s.index},${s.exercise},${s.type},${s.reps},${s.weightKg},${s.durationSeconds},${JSON.stringify(s.rawMetadata)}::text::jsonb)`;
    }
    return { id, newExternalId: found.length === 0 };
  }
  async counts(userId: string) {
    const rows = await this.db<
      { daily: number; workouts: number; splits: number; zones: number; sets: number }[]
    >`SELECT (SELECT COUNT(*)::int FROM garmin_daily_health WHERE user_id=${userId}) daily,(SELECT COUNT(*)::int FROM workouts WHERE user_id=${userId}) workouts,(SELECT COUNT(*)::int FROM workout_splits s JOIN workouts w ON s.workout_id=w.id WHERE w.user_id=${userId}) splits,(SELECT COUNT(*)::int FROM workout_hr_zones s JOIN workouts w ON s.workout_id=w.id WHERE w.user_id=${userId}) zones,(SELECT COUNT(*)::int FROM workout_sets s JOIN workouts w ON s.workout_id=w.id WHERE w.user_id=${userId}) sets`;
    return rows[0];
  }
  async knownIds(userId: string, ids: string[]): Promise<string[]> {
    const rows = await this.db<
      { external_activity_id: string }[]
    >`SELECT external_activity_id FROM workouts WHERE user_id=${userId} AND source='garmin' AND external_activity_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::text::jsonb))`;
    return rows.map((r) => r.external_activity_id);
  }
}

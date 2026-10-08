import type { GarminProvider } from './connector.js';
import {
  datesEnding,
  localDate,
  normalizeDaily,
  normalizeWorkout,
  object,
} from '../robi-health/src/garmin/normalize.js';
import type { SyncBatch, SyncState } from '../robi-health/src/garmin/types.js';
export interface SyncConfig {
  dailyDays: number;
  activityDays: number;
  timezone: string;
}
export interface SyncStore {
  write(batch: SyncBatch): Promise<void>;
}
export class GarminSyncService {
  constructor(
    private readonly provider: GarminProvider,
    private readonly store: SyncStore,
    private readonly config: SyncConfig,
    private readonly clock = () => new Date(),
  ) {}
  async sync(states: SyncState[]): Promise<{ daily: number; activities: number; failed: string[] }> {
    const today = localDate(this.clock(), this.config.timezone);
    const result = { daily: 0, activities: 0, failed: [] as string[] };
    for (const resource of ['daily', 'activities'] as const) {
      try {
        const previous = states.find((s) => s.resource_type === resource)?.last_successful_sync_at;
        const batch: SyncBatch = { resource, daily: [], workouts: [], syncedAt: this.clock().toISOString() };
        if (resource === 'daily') {
          const oldest = datesEnding(today, this.config.dailyDays)[0];
          const overlap = previous ? datesEnding(localDate(new Date(previous), this.config.timezone), 3)[0] : oldest;
          const start = overlap < oldest ? oldest : overlap;
          const range = datesEnding(today, this.config.dailyDays).filter((date) => date >= start);
          for (const date of range)
            batch.daily.push(normalizeDaily(date, this.config.timezone, await this.provider.getDailyHealth(date)));
        } else {
          const oldest = datesEnding(today, this.config.activityDays)[0];
          const overlap = previous ? datesEnding(localDate(new Date(previous), this.config.timezone), 3)[0] : oldest;
          const start = overlap < oldest ? oldest : overlap;
          for (const raw of await this.provider.getRecentActivities(start, today)) {
            const id = object(raw).activityId;
            if (typeof id !== 'number') throw new Error('invalid_activity_id');
            const details = await this.provider.getActivity(id);
            batch.workouts.push(normalizeWorkout(details.summary, details.splits, details.zones, details.sets));
          }
        }
        await this.store.write(batch);
        if (resource === 'daily') result.daily = batch.daily.length;
        else result.activities = batch.workouts.length;
      } catch {
        result.failed.push(resource);
        // Error bookkeeping is separate; never replace successful cached facts with an error.
        try {
          await this.store.write({
            resource,
            daily: [],
            workouts: [],
            syncedAt: this.clock().toISOString(),
            errorCode: 'connector_unavailable',
          });
        } catch {
          /* local DB outage is reported by caller */
        }
      }
    }
    return result;
  }
}

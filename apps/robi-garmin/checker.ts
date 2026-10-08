import type { GarminProvider } from './connector.js';
import { normalizeWorkout, object } from '../robi-health/src/garmin/normalize.js';
import type { SyncBatch } from '../robi-health/src/garmin/types.js';
export interface ActivityStore {
  known(ids: string[]): Promise<string[]>;
  write(batch: SyncBatch): Promise<void>;
}
export class ActivityChecker {
  constructor(
    private readonly provider: GarminProvider,
    private readonly store: ActivityStore,
    private readonly clock = () => new Date(),
  ) {}
  async check() {
    const page = await this.provider.getRecentPage(10);
    const ids = page.map((entry) => object(entry).activityId);
    if (ids.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0))
      throw new Error('invalid_activity_id');
    const known = new Set(await this.store.known(ids.map(String)));
    let imported = 0,
      requests = 1;
    const visited = new Set<string>();
    for (const entry of page) {
      const row = object(entry),
        id = String(row.activityId);
      if (known.has(id) || visited.has(id)) continue;
      visited.add(id);
      const type = object(row.activityType ?? row.activityTypeDTO).typeKey;
      const includeSets = typeof type !== 'string' || type.includes('strength');
      const detail = await this.provider.getActivity(Number(id), includeSets);
      requests += includeSets ? 4 : 3;
      const workout = normalizeWorkout(detail.summary, detail.splits, detail.zones, detail.sets);
      if (workout.externalActivityId !== id) throw new Error('activity_identity_mismatch');
      await this.store.write({
        resource: 'activities',
        daily: [],
        workouts: [workout],
        enqueueAnalysis: true,
        syncedAt: this.clock().toISOString(),
      });
      imported++;
    }
    return { listed: page.length, imported, requests };
  }
}

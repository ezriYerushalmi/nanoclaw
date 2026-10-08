import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GarminSyncService } from './service.js';
import type { GarminProvider } from './connector.js';
import type { SyncBatch, SyncState } from '../robi-health/src/garmin/types.js';
const clock = () => new Date('2026-10-08T22:30:00Z'); // Jerusalem is already October 9.
function fixture(failDaily = false) {
  const dates: string[] = [];
  const ranges: string[][] = [];
  const batches: SyncBatch[] = [];
  const provider: GarminProvider = {
    async getRecentPage() {
      return [];
    },
    async getDailyHealth(date) {
      dates.push(date);
      if (failDaily) throw new Error('offline');
      return { summary: { calendarDate: date, totalSteps: 100 }, readiness: [] };
    },
    async getRecentActivities(start, end) {
      ranges.push([start, end]);
      return [{ activityId: 123 }];
    },
    async getActivity(id) {
      return {
        summary: {
          activityId: id,
          summaryDTO: { startTimeGMT: '2026-10-08 10:00:00', duration: 600, distance: 1000, averageSpeed: 2 },
          activityTypeDTO: { typeKey: 'running' },
        },
        splits: { lapDTOs: [] },
        zones: [],
        sets: { exerciseSets: null },
      };
    },
    async close() {},
  };
  const service = new GarminSyncService(
    provider,
    {
      async write(batch) {
        batches.push(batch);
      },
    },
    { dailyDays: 14, activityDays: 30, timezone: 'Asia/Jerusalem' },
    clock,
  );
  return { service, dates, ranges, batches };
}
function state(resource: string, at: string): SyncState {
  return {
    resource_type: resource,
    last_successful_sync_at: at,
    last_source_timestamp: null,
    last_error_at: null,
    last_error_code: null,
  };
}
test('first sync is bounded, uses the local calendar and tolerates missing readiness/sets', async () => {
  const f = fixture();
  const result = await f.service.sync([]);
  assert.deepEqual(result, { daily: 14, activities: 1, failed: [] });
  assert.equal(f.dates[0], '2026-09-26');
  assert.equal(f.dates.at(-1), '2026-10-09');
  assert.deepEqual(f.ranges, [['2026-09-10', '2026-10-09']]);
  assert.equal(f.batches[0].daily[0].trainingReadiness, null);
  assert.equal(f.batches[1].workouts[0].sets, null);
});
test('incremental refresh overlaps three days and catches up after an outage within the configured bound', async () => {
  const f = fixture();
  await f.service.sync([state('daily', '2026-10-04T12:00:00Z'), state('activities', '2026-10-04T12:00:00Z')]);
  assert.equal(f.dates[0], '2026-10-02');
  assert.equal(f.dates.length, 8);
  assert.deepEqual(f.ranges, [['2026-10-02', '2026-10-09']]);
});
test('one failing resource records an error without erasing facts or preventing the other resource', async () => {
  const f = fixture(true);
  const result = await f.service.sync([]);
  assert.deepEqual(result.failed, ['daily']);
  assert.equal(result.activities, 1);
  assert.equal(f.batches[0].errorCode, 'connector_unavailable');
  assert.deepEqual(f.batches[0].daily, []);
  assert.equal(f.batches[1].workouts.length, 1);
});

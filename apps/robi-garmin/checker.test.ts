import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CronExpressionParser } from 'cron-parser';
import { ActivityChecker } from './checker.js';
import type { GarminProvider } from './connector.js';
import { ensureCheckerSchedule } from './register-checker.js';
import { CHECKER_CRON, CHECKER_TIMEZONE, withinCheckerHours } from '../../src/modules/robi-whatsapp/garmin-schedule.js';
function fixture(ids: number[], knownIds: number[] = [], strength = false) {
  const known = new Set(knownIds.map(String)),
    calls: string[] = [],
    writes: unknown[] = [];
  const provider: GarminProvider = {
    async getRecentPage(limit) {
      calls.push('page:' + limit);
      return ids.map((activityId) => ({
        activityId,
        activityType: { typeKey: strength ? 'strength_training' : 'running' },
      }));
    },
    async getActivity(id, sets) {
      calls.push('detail:' + id + ':' + sets);
      return {
        summary: {
          activityId: id,
          activityTypeDTO: { typeKey: strength ? 'strength_training' : 'running' },
          summaryDTO: { startTimeGMT: '2025-01-01 10:00:00', duration: 600, distance: 1000, averageSpeed: 2 },
        },
        splits: { lapDTOs: [{ lapIndex: 1, distance: 1000, duration: 600 }] },
        zones: [{ zoneNumber: 1, secsInZone: 600 }],
        sets: { exerciseSets: null },
      };
    },
    async getDailyHealth() {
      throw new Error('wellness_must_not_be_called');
    },
    async getRecentActivities() {
      throw new Error('full_sync_must_not_be_called');
    },
    async close() {},
  };
  const checker = new ActivityChecker(provider, {
    async known() {
      return [...known];
    },
    async write(batch) {
      writes.push(batch);
      known.add(batch.workouts[0].externalActivityId);
    },
  });
  return { checker, provider, calls, writes };
}
test('known activities cause exactly one recent-page request, no details/wellness/import/LLM', async () => {
  const f = fixture([1, 2], [1, 2]);
  assert.equal((await f.checker.check()).requests, 1);
  assert.deepEqual(f.calls, ['page:10']);
  assert.equal(f.writes.length, 0);
});
test('unseen running activity includes splits/zones and creates a durable analysis request', async () => {
  const f = fixture([1]);
  const r = await f.checker.check();
  assert.equal(r.imported, 1);
  assert.equal(r.requests, 4);
  assert.deepEqual(f.calls, ['page:10', 'detail:1:false']);
  const batch = f.writes[0] as { enqueueAnalysis: boolean; workouts: { splits: unknown[]; hrZones: unknown[] }[] };
  assert.equal(batch.enqueueAnalysis, true);
  assert.equal(batch.workouts[0].splits.length, 1);
  assert.equal(batch.workouts[0].hrZones.length, 1);
});
test('multiple IDs, duplicate list rows, repeated runs and late older uploads are handled by membership', async () => {
  const f = fixture([3, 1, 1, 2], [3]);
  assert.equal((await f.checker.check()).imported, 2);
  assert.equal((await f.checker.check()).imported, 0);
  assert.equal(f.writes.length, 2);
});
test('strength sets are attempted; unavailable sets are valid', async () => {
  const f = fixture([1], [], true);
  assert.equal((await f.checker.check()).requests, 5);
  assert.deepEqual(f.calls, ['page:10', 'detail:1:true']);
});
test('Garmin outage cannot modify persisted workouts', async () => {
  const f = fixture([1]);
  f.provider.getRecentPage = async () => {
    throw new Error('offline');
  };
  await assert.rejects(f.checker.check());
  assert.equal(f.writes.length, 0);
});
test('hourly cron has exactly 08 through 23 local fires on winter, summer and DST days', () => {
  for (const date of ['2026-01-02', '2026-07-02', '2026-03-27', '2026-10-25']) {
    const cron = CronExpressionParser.parse(CHECKER_CRON, {
      tz: CHECKER_TIMEZONE,
      currentDate: new Date(date + 'T00:00:00Z'),
    });
    const hours = Array.from({ length: 16 }, () =>
      new Intl.DateTimeFormat('en-GB', { timeZone: CHECKER_TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).format(
        cron.next().toDate(),
      ),
    );
    assert.deepEqual(
      hours,
      Array.from({ length: 16 }, (_, i) => String(i + 8).padStart(2, '0')),
    );
    assert.equal(withinCheckerHours(new Date(date + 'T01:00:00Z')), false);
  }
});
test('repeated scheduler registration reuses the same native task', async () => {
  let created = 0;
  const tasks: unknown[] = [];
  const client = {
    async call(command: string[], args: Record<string, unknown>) {
      const op = command.join(' ');
      if (op === 'groups config get') return { timezone: CHECKER_TIMEZONE };
      if (op === 'tasks list') return tasks;
      if (op === 'tasks create') {
        created++;
        const task = { series_id: 'robi-garmin-hourly-synthetic' };
        tasks.push(task);
        return task;
      }
      if (op === 'tasks update') {
        assert.equal(args.recurrence, CHECKER_CRON);
        return {};
      }
      throw new Error('unexpected_operation');
    },
  };
  assert.equal((await ensureCheckerSchedule(client, 'ag-synthetic')).created, true);
  assert.equal((await ensureCheckerSchedule(client, 'ag-synthetic')).created, false);
  assert.equal(created, 1);
});

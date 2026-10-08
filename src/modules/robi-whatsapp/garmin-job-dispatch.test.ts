import { test, expect } from 'vitest';
import { enqueueWorkoutAnalysis, type WorkoutEvent } from './garmin-job-dispatch.js';
const event: WorkoutEvent = {
  id: 'synthetic-event',
  workoutId: 'synthetic-workout',
  workout: {},
  recent: [],
  recovery: null,
};
test('event resumes after restart and a native task already created before crash is not recreated', async () => {
  const tasks = new Map<string, string>();
  let created = 0,
    completed = 0;
  const queue = {
    async status(id: string) {
      return tasks.get(id);
    },
    async createOnce(id: string) {
      if (!tasks.has(id)) {
        created++;
        tasks.set(id, 'pending');
      }
    },
    async complete() {
      completed++;
    },
  };
  await enqueueWorkoutAnalysis([event], queue);
  await enqueueWorkoutAnalysis([event], { ...queue }); // process/client recreation, durable stores unchanged
  expect(created).toBe(1);
  expect(completed).toBe(0);
  tasks.set('garmin-analysis-' + event.id, 'completed');
  await enqueueWorkoutAnalysis([event], queue);
  expect(created).toBe(1);
  expect(completed).toBe(1);
});
test('failed analysis retains native retry/history and is never automatically announced as a new task', async () => {
  await enqueueWorkoutAnalysis([event], {
    async status() {
      return 'failed';
    },
    async createOnce() {
      throw new Error('must_not_duplicate');
    },
    async complete() {
      throw new Error('must_not_complete');
    },
  });
});

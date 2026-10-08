import type { DailyHealth, Workout } from './types.js';
export function object(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
export function number(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}
function string(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}
export function utc(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
  if (typeof v !== 'string') return null;
  const normalized = v.replace(' ', 'T');
  const iso = /Z$|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : normalized + 'Z';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
export function localDate(time: Date, timezone = 'Asia/Jerusalem'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(time);
}
export function datesEnding(end: string, days: number): string[] {
  const d = new Date(end + 'T12:00:00Z');
  return Array.from({ length: days }, (_, i) =>
    new Date(d.getTime() - (days - i - 1) * 86400000).toISOString().slice(0, 10),
  );
}
function onDate(v: unknown, date: string): Record<string, unknown> {
  const d = object(v);
  return d.calendarDate === date ? d : {};
}
export function normalizeDaily(date: string, timezone: string, payload: Record<string, unknown>): DailyHealth {
  const summary = onDate(payload.summary, date);
  const sleep = onDate(object(payload.sleep).dailySleepDTO, date);
  const hrv = onDate(object(payload.hrv).hrvSummary, date);
  const readiness =
    (Array.isArray(payload.readiness) ? payload.readiness : [payload.readiness])
      .map((v) => onDate(v, date))
      .find((v) => Object.keys(v).length) ?? {};
  const statuses = object(object(payload.training).mostRecentTrainingStatus).latestTrainingStatusData;
  const entries = Object.values(object(statuses))
    .map((v) => onDate(v, date))
    .filter((v) => Object.keys(v).length);
  const training = entries.find((v) => v.primaryTrainingDevice === true) ?? (entries.length === 1 ? entries[0] : {});
  const raw = { summary, sleep, hrv, readiness, training, missingOrMismatchedDate: !Object.keys(summary).length };
  return {
    date,
    timezone,
    sleepDurationMinutes: number(sleep.sleepTimeSeconds) === null ? null : number(sleep.sleepTimeSeconds)! / 60,
    sleepScore: number(object(object(sleep.sleepScores).overall).value),
    hrv: number(hrv.lastNightAvg),
    restingHr: number(summary.restingHeartRate),
    averageStress: number(summary.averageStressLevel),
    bodyBatteryStart: null,
    bodyBatteryEnd: number(summary.bodyBatteryMostRecentValue),
    bodyBatteryHigh: number(summary.bodyBatteryHighestValue),
    bodyBatteryLow: number(summary.bodyBatteryLowestValue),
    trainingReadiness: number(readiness.score),
    trainingStatus:
      typeof training.trainingStatus === 'number' ? String(training.trainingStatus) : string(training.trainingStatus),
    trainingLoad:
      number(object(training.acuteTrainingLoadDTO).dailyTrainingLoadAcute) ?? number(training.weeklyTrainingLoad),
    steps: number(summary.totalSteps),
    sourceUpdatedAt: utc(summary.lastSyncTimestampGMT),
    rawMetadata: raw,
  };
}
export function normalizeWorkout(
  raw: unknown,
  splitsRaw: unknown = null,
  zonesRaw: unknown = null,
  setsRaw: unknown = null,
): Workout {
  const r = object(raw);
  const s = Object.keys(object(r.summaryDTO)).length ? object(r.summaryDTO) : r;
  const id = r.activityId;
  const startedAt = utc(r.beginTimestamp ?? s.startTimeGMT);
  if ((typeof id !== 'number' && typeof id !== 'string') || !startedAt)
    throw new Error('invalid_activity_identity_or_timestamp');
  const providerSport = string(object(r.activityTypeDTO ?? r.activityType).typeKey) ?? 'other';
  const sport = providerSport.includes('running')
    ? 'running'
    : providerSport.includes('cycling')
      ? 'cycling'
      : providerSport.includes('swimming')
        ? 'swimming'
        : providerSport.includes('strength')
          ? 'strength'
          : providerSport.includes('walking')
            ? 'walking'
            : providerSport.includes('surfing')
              ? 'surfing'
              : providerSport;
  const speed = number(s.averageSpeed); // Garmin summary averageSpeed is meters/second.
  const splitList = object(splitsRaw).lapDTOs;
  const setList = object(setsRaw).exerciseSets;
  return {
    externalActivityId: String(id),
    sport,
    startedAt,
    durationSeconds: number(s.duration),
    distanceMeters: number(s.distance),
    calories: number(s.calories),
    avgHr: number(s.averageHR),
    maxHr: number(s.maxHR),
    avgSpeed: speed,
    avgPace: sport.includes('running') && speed && speed > 0 ? 1000 / speed : null,
    elevationGain: number(s.elevationGain),
    cadence: number(s.averageRunningCadenceInStepsPerMinute ?? s.averageBikeCadence),
    trainingLoad: number(s.activityTrainingLoad),
    aerobicTrainingEffect: number(s.trainingEffect ?? s.aerobicTrainingEffect),
    anaerobicTrainingEffect: number(s.anaerobicTrainingEffect),
    rawMetadata: { summary: s, activityType: object(r.activityTypeDTO ?? r.activityType) },
    splits: Array.isArray(splitList)
      ? splitList.map((v, i) => {
          const x = object(v);
          return {
            index: number(x.lapIndex) ?? i + 1,
            distanceMeters: number(x.distance),
            durationSeconds: number(x.duration),
            avgHr: number(x.averageHR),
            avgSpeed: number(x.averageSpeed),
            rawMetadata: x,
          };
        })
      : null,
    hrZones: Array.isArray(zonesRaw)
      ? zonesRaw.map((v, i) => {
          const x = object(v);
          return {
            number: number(x.zoneNumber) ?? i + 1,
            durationSeconds: number(x.secsInZone),
            lowBoundary: number(x.zoneLowBoundary),
            rawMetadata: x,
          };
        })
      : null,
    sets: Array.isArray(setList)
      ? setList.map((v, i) => {
          const x = object(v);
          const category = Array.isArray(x.exercises) ? object(x.exercises[0]) : {};
          return {
            index: i + 1,
            exercise: string(category.exerciseName ?? category.category),
            type: string(x.setType),
            reps: number(x.repetitionCount),
            weightKg:
              number(x.weightKg) ??
              (x.weightUnit === 'GRAM' && number(x.weight) !== null
                ? number(x.weight)! / 1000
                : x.weightUnit === 'KILOGRAM'
                  ? number(x.weight)
                  : null),
            durationSeconds: number(x.durationSeconds),
            rawMetadata: x,
          };
        })
      : null,
  };
}

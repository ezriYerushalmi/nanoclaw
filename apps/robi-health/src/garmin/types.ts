export interface DailyHealth {
  date: string;
  timezone: string;
  sleepDurationMinutes: number | null;
  sleepScore: number | null;
  hrv: number | null;
  restingHr: number | null;
  averageStress: number | null;
  bodyBatteryStart: number | null;
  bodyBatteryEnd: number | null;
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
  trainingReadiness: number | null;
  trainingStatus: string | null;
  trainingLoad: number | null;
  steps: number | null;
  sourceUpdatedAt: string | null;
  rawMetadata: Record<string, unknown>;
}
export interface Split {
  index: number;
  distanceMeters: number | null;
  durationSeconds: number | null;
  avgHr: number | null;
  avgSpeed: number | null;
  rawMetadata: Record<string, unknown>;
}
export interface HrZone {
  number: number;
  durationSeconds: number | null;
  lowBoundary: number | null;
  rawMetadata: Record<string, unknown>;
}
export interface StrengthSet {
  index: number;
  exercise: string | null;
  type: string | null;
  reps: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
  rawMetadata: Record<string, unknown>;
}
export interface Workout {
  externalActivityId: string;
  sport: string;
  startedAt: string;
  durationSeconds: number | null;
  distanceMeters: number | null;
  calories: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgSpeed: number | null;
  avgPace: number | null;
  elevationGain: number | null;
  cadence: number | null;
  trainingLoad: number | null;
  aerobicTrainingEffect: number | null;
  anaerobicTrainingEffect: number | null;
  rawMetadata: Record<string, unknown>;
  splits: Split[] | null;
  hrZones: HrZone[] | null;
  sets: StrengthSet[] | null;
}
export interface SyncBatch {
  resource: 'daily' | 'activities';
  daily: DailyHealth[];
  workouts: Workout[];
  syncedAt: string;
  errorCode?: 'connector_unavailable';
  enqueueAnalysis?: boolean;
}
export interface SyncState {
  resource_type: string;
  last_successful_sync_at: string | null;
  last_source_timestamp: string | null;
  last_error_at: string | null;
  last_error_code: string | null;
}
export const garminOperations = [
  'get_recovery_status',
  'get_recent_workouts',
  'get_workout_details',
  'get_training_status',
] as const;
export type GarminOperation = (typeof garminOperations)[number];

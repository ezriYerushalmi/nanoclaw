export type Operation = 'log_weight' | 'log_water' | 'get_today_status';
export interface SourceMetadata {
  channel: string;
  messageId: string;
  idempotencyKey: string;
}
export interface User {
  id: string;
  externalKey: string;
  displayName: string;
  timezone: string;
}
export interface WeightEntry {
  id: string;
  weightKg: number;
  measuredAt: string;
  previousWeightKg: number | null;
}
export interface WaterEntry {
  id: string;
  amountMl: number;
  consumedAt: string;
}
export interface HealthSettings {
  externalKey: string;
  displayName: string;
  timezone: string;
  waterGlassMl: number | null;
  waterTargetMl: number | null;
}
export interface TodayStatus {
  date: string;
  timezone: string;
  water: { totalMl: number; targetMl: number | null; remainingMl: number | null };
  weight: { latestKg: number | null; latestMeasuredAt: string | null; measuredToday: boolean };
}
export interface WeightLogResult extends WeightEntry {
  success: true;
}
export interface WaterLogResult extends WaterEntry {
  success: true;
  totalTodayMl: number;
  targetMl: number | null;
}
export interface GlassClarification {
  success: false;
  clarificationRequired: true;
  reason: 'water_glass_size_not_configured';
}
export type HealthToolResult = WeightLogResult | WaterLogResult | GlassClarification | TodayStatus;
export class HealthError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HealthError('invalid_input');
  return value as Record<string, unknown>;
}
export function positive(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max)
    throw new HealthError('invalid_amount');
  return value;
}
export function instant(value: unknown, now: Date): string {
  if (value === undefined) return now.toISOString();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new HealthError('timestamp_requires_timezone');
  const time = new Date(value);
  const calendarDay = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (
    !Number.isFinite(time.getTime()) ||
    !Number.isFinite(calendarDay.getTime()) ||
    calendarDay.toISOString().slice(0, 10) !== value.slice(0, 10) ||
    time.getTime() > now.getTime() + 300_000
  )
    throw new HealthError('invalid_timestamp');
  return time.toISOString();
}
export function waterMl(amount: unknown, unit: unknown, glassMl: number | null): number | null {
  const number = positive(amount, 100_000);
  if (unit === 'glass' && glassMl === null) return null;
  const multiplier = unit === 'ml' ? 1 : unit === 'liter' ? 1000 : unit === 'glass' ? glassMl : undefined;
  if (multiplier === undefined || multiplier === null) throw new HealthError('invalid_water_unit');
  const ml = positive(number * multiplier, 100_000);
  const normalized = Math.round(ml);
  // Allow only floating-point representation noise, never a real fractional ml.
  if (normalized < 1 || Math.abs(ml - normalized) > 1e-7) throw new HealthError('water_requires_whole_milliliters');
  return normalized;
}

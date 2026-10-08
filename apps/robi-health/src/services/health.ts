import type { SQL } from 'bun';
import {
  HealthError,
  instant,
  positive,
  record,
  waterMl,
  type HealthSettings,
  type Operation,
  type SourceMetadata,
  type TodayStatus,
  type HealthToolResult,
} from '../domain.js';
import { UserRepository } from '../repositories/users.js';
import { WeightRepository } from '../repositories/weight.js';
import { WaterRepository } from '../repositories/water.js';
import { localDay } from './day.js';
export interface TrustedInteraction {
  canWrite: boolean;
  source: SourceMetadata;
}
export class HealthService {
  readonly users: UserRepository;
  readonly weights: WeightRepository;
  readonly water: WaterRepository;
  constructor(
    private readonly db: SQL,
    private readonly config: HealthSettings,
    private readonly clock = () => new Date(),
  ) {
    this.users = new UserRepository(db);
    this.weights = new WeightRepository(db);
    this.water = new WaterRepository(db);
  }
  private async user() {
    const user = await this.users.getByExternalKey(this.config.externalKey);
    if (!user) throw new HealthError('user_not_bootstrapped');
    return user;
  }
  async getTodayStatus(): Promise<TodayStatus> {
    const user = await this.user();
    const day = await localDay(this.db, user.timezone, this.clock());
    const [totalMl, latest] = await Promise.all([
      this.water.getTotalForRange(user.id, day.start, day.end),
      this.weights.getLatest(user.id),
    ]);
    return {
      date: day.date,
      timezone: user.timezone,
      water: {
        totalMl,
        targetMl: this.config.waterTargetMl,
        remainingMl: this.config.waterTargetMl === null ? null : Math.max(0, this.config.waterTargetMl - totalMl),
      },
      weight: {
        latestKg: latest?.weightKg ?? null,
        latestMeasuredAt: latest?.measuredAt ?? null,
        measuredToday: latest !== null && latest.measuredAt >= day.start && latest.measuredAt < day.end,
      },
    };
  }
  async execute(operation: Operation, input: unknown, context: TrustedInteraction): Promise<HealthToolResult> {
    const args = record(input);
    const allowed =
      operation === 'log_weight'
        ? ['weightKg', 'measuredAt', 'sourceMessageIndex']
        : operation === 'log_water'
          ? ['amount', 'unit', 'consumedAt', 'sourceMessageIndex']
          : [];
    if (Object.keys(args).some((key) => !allowed.includes(key))) throw new HealthError('unexpected_argument');
    if (operation === 'get_today_status') return this.getTodayStatus();
    if (!context.canWrite) throw new HealthError('unauthorized_sender');
    if (
      args.sourceMessageIndex !== undefined &&
      (typeof args.sourceMessageIndex !== 'number' ||
        !Number.isInteger(args.sourceMessageIndex) ||
        args.sourceMessageIndex < 1)
    )
      throw new HealthError('invalid_source_message_index');
    const user = await this.user();
    if (operation === 'log_weight') {
      const kg = positive(args.weightKg, 500);
      if (kg < 10 || Math.abs(kg * 100 - Math.round(kg * 100)) > 1e-7)
        throw new HealthError('invalid_weight_precision_or_range');
      const entry = await this.weights.addEntry(
        user.id,
        kg,
        instant(args.measuredAt, this.clock()),
        context.source,
        args.measuredAt !== undefined,
      );
      console.info(JSON.stringify({ event: 'weight_entry_persisted' }));
      return { success: true, ...entry };
    }
    const amountMl = waterMl(args.amount, args.unit, this.config.waterGlassMl);
    if (amountMl === null)
      return { success: false, clarificationRequired: true, reason: 'water_glass_size_not_configured' };
    const entry = await this.water.addEntry(
      user.id,
      amountMl,
      instant(args.consumedAt, this.clock()),
      context.source,
      args.consumedAt !== undefined,
    );
    console.info(JSON.stringify({ event: 'water_entry_persisted' }));
    const today = await this.getTodayStatus();
    return { success: true, ...entry, totalTodayMl: today.water.totalMl, targetMl: today.water.targetMl };
  }
}

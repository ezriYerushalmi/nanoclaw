import type { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { HealthError, type SourceMetadata, type WeightEntry } from '../domain.js';
interface Row {
  id: string;
  weight_kg: string;
  measured_at: Date;
  previous_weight_kg: string | null;
}
const entry = (row: Row): WeightEntry => ({
  id: row.id,
  weightKg: Number(row.weight_kg),
  measuredAt: row.measured_at.toISOString(),
  previousWeightKg: row.previous_weight_kg === null ? null : Number(row.previous_weight_kg),
});
export class WeightRepository {
  constructor(private readonly db: SQL) {}
  async addEntry(
    userId: string,
    kg: number,
    at: string,
    source: SourceMetadata,
    explicitTime = false,
  ): Promise<WeightEntry> {
    return this.db.begin(async (tx) => {
      // Serialize same-user writes to preserve the previous-weight receipt and retry semantics.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
      const old = await tx<
        Row[]
      >`SELECT * FROM weight_entries WHERE user_id=${userId}::uuid AND idempotency_key=${source.idempotencyKey}`;
      if (old[0]) {
        const prior = entry(old[0]);
        if (prior.weightKg !== kg || (explicitTime && prior.measuredAt !== at))
          throw new HealthError('idempotency_conflict');
        return prior;
      }
      const previous = await tx<
        Row[]
      >`SELECT * FROM weight_entries WHERE user_id=${userId}::uuid ORDER BY measured_at DESC,created_at DESC,id DESC LIMIT 1`;
      const rows = await tx<
        Row[]
      >`INSERT INTO weight_entries(id,user_id,weight_kg,measured_at,created_at,source,source_message_id,idempotency_key,previous_weight_kg)
        VALUES (${randomUUID()}::uuid,${userId}::uuid,${kg},${at}::timestamptz,${new Date().toISOString()}::timestamptz,
        ${source.channel},${source.messageId},${source.idempotencyKey},${previous[0]?.weight_kg ?? null}) RETURNING *`;
      return entry(rows[0]);
    });
  }
  async getLatest(userId: string): Promise<WeightEntry | null> {
    const rows = await this.db<
      Row[]
    >`SELECT * FROM weight_entries WHERE user_id=${userId}::uuid ORDER BY measured_at DESC,created_at DESC,id DESC LIMIT 1`;
    return rows[0] ? entry(rows[0]) : null;
  }
  async listRecent(userId: string, limit = 30): Promise<WeightEntry[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new HealthError('invalid_limit');
    return (
      await this.db<
        Row[]
      >`SELECT * FROM weight_entries WHERE user_id=${userId}::uuid ORDER BY measured_at DESC,created_at DESC,id DESC LIMIT ${limit}`
    ).map(entry);
  }
}

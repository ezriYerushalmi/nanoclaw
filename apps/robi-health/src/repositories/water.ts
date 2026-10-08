import type { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { HealthError, type SourceMetadata, type WaterEntry } from '../domain.js';
interface Row {
  id: string;
  amount_ml: number;
  consumed_at: Date;
}
const entry = (row: Row): WaterEntry => ({
  id: row.id,
  amountMl: row.amount_ml,
  consumedAt: row.consumed_at.toISOString(),
});
export class WaterRepository {
  constructor(private readonly db: SQL) {}
  async addEntry(
    userId: string,
    ml: number,
    at: string,
    source: SourceMetadata,
    explicitTime = false,
  ): Promise<WaterEntry> {
    return this.db.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
      const old = await tx<
        Row[]
      >`SELECT * FROM water_entries WHERE user_id=${userId}::uuid AND idempotency_key=${source.idempotencyKey}`;
      if (old[0]) {
        const prior = entry(old[0]);
        if (prior.amountMl !== ml || (explicitTime && prior.consumedAt !== at))
          throw new HealthError('idempotency_conflict');
        return prior;
      }
      const rows = await tx<
        Row[]
      >`INSERT INTO water_entries(id,user_id,amount_ml,consumed_at,created_at,source,source_message_id,idempotency_key)
        VALUES (${randomUUID()}::uuid,${userId}::uuid,${ml},${at}::timestamptz,${new Date().toISOString()}::timestamptz,
        ${source.channel},${source.messageId},${source.idempotencyKey}) RETURNING *`;
      return entry(rows[0]);
    });
  }
  async getTotalForRange(userId: string, start: string, end: string): Promise<number> {
    const rows = await this.db<{ total: string }[]>`SELECT COALESCE(SUM(amount_ml),0)::text AS total FROM water_entries
      WHERE user_id=${userId}::uuid AND consumed_at>=${start}::timestamptz AND consumed_at<${end}::timestamptz`;
    return Number(rows[0].total);
  }
  async listForRange(userId: string, start: string, end: string): Promise<WaterEntry[]> {
    return (
      await this.db<Row[]>`SELECT * FROM water_entries WHERE user_id=${userId}::uuid
      AND consumed_at>=${start}::timestamptz AND consumed_at<${end}::timestamptz ORDER BY consumed_at,created_at,id`
    ).map(entry);
  }
}

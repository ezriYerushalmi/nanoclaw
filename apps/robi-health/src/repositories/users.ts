import type { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import type { HealthSettings, User } from '../domain.js';
export class UserRepository {
  constructor(private readonly db: SQL) {}
  async getByExternalKey(key: string): Promise<User | null> {
    const rows = await this.db<
      User[]
    >`SELECT id, external_key AS "externalKey", display_name AS "displayName", timezone FROM users WHERE external_key=${key}`;
    return rows[0] ?? null;
  }
  async create(config: HealthSettings): Promise<User> {
    const now = new Date().toISOString();
    const rows = await this.db<User[]>`INSERT INTO users(id,external_key,display_name,timezone,created_at,updated_at)
      VALUES (${randomUUID()}::uuid,${config.externalKey},${config.displayName},${config.timezone},${now}::timestamptz,${now}::timestamptz)
      RETURNING id,external_key AS "externalKey",display_name AS "displayName",timezone`;
    return rows[0];
  }
  async ensureUser(config: HealthSettings): Promise<User> {
    const now = new Date().toISOString();
    await this.db`INSERT INTO users(id,external_key,display_name,timezone,created_at,updated_at)
      VALUES (${randomUUID()}::uuid,${config.externalKey},${config.displayName},${config.timezone},${now}::timestamptz,${now}::timestamptz)
      ON CONFLICT(external_key) DO NOTHING`;
    return (await this.getByExternalKey(config.externalKey))!;
  }
}

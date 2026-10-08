import type { SQL } from 'bun';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
export async function migrate(db: SQL, directory = join(import.meta.dir, '../../migrations')): Promise<void> {
  await db.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(82410971)`;
    const role = await tx<
      { present: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='robi_db_user') AS present`;
    if (!role[0].present) {
      const password = process.env.ROBI_DB_PASSWORD;
      if (!password || !/^[a-f0-9]{64}$/.test(password)) throw new Error('invalid_generated_db_password');
      // Fixed role name; only locally generated hex is accepted in this DDL literal.
      await tx.unsafe(`CREATE ROLE robi_db_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'`);
    }
    await tx`CREATE TABLE IF NOT EXISTS robi_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL)`;
    for (const name of readdirSync(directory)
      .filter((name) => /^\d+_.+\.sql$/.test(name))
      .sort()) {
      const sql = readFileSync(join(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const applied = await tx<{ checksum: string }[]>`SELECT checksum FROM robi_migrations WHERE name=${name}`;
      if (applied.length) {
        if (applied[0].checksum !== checksum) throw new Error('migration_checksum_mismatch');
        continue;
      }
      await tx.unsafe(sql);
      await tx`INSERT INTO robi_migrations VALUES (${name}, ${checksum}, ${new Date().toISOString()}::timestamptz)`;
    }
  });
}

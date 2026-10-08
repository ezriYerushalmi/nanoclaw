import { SQL } from 'bun';
export function connect(admin = false): SQL {
  return new SQL({
    adapter: 'postgres',
    hostname: process.env.ROBI_DB_HOST ?? 'postgres',
    port: 5432,
    database: process.env.ROBI_DB_NAME ?? 'robi_db',
    username: admin ? 'robi_db_admin' : 'robi_db_user',
    password: admin ? process.env.ROBI_DB_ADMIN_PASSWORD : process.env.ROBI_DB_PASSWORD,
    max: 5,
    connectionTimeout: 5,
  });
}
export async function ready(db: SQL): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await db`SELECT 1`;
      return;
    } catch {
      console.error(JSON.stringify({ event: 'robi_db_connection_retry', attempt: attempt + 1 }));
    }
    await Bun.sleep(Math.min(250 * 2 ** attempt, 3000));
  }
  throw new Error('robi_database_unavailable');
}

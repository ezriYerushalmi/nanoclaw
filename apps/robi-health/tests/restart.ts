// Operator verification helper. Uses ONLY the separate test database.
import { SQL } from 'bun';
import { UserRepository } from '../src/repositories/users.js';
import { WaterRepository } from '../src/repositories/water.js';
const db = new SQL({
  adapter: 'postgres',
  hostname: process.env.ROBI_DB_HOST ?? 'postgres',
  database: 'robi_health_test',
  username: 'robi_db_admin',
  password: process.env.ROBI_DB_ADMIN_PASSWORD,
});
try {
  const user = await new UserRepository(db).ensureUser({
    externalKey: 'restart-verification',
    displayName: 'Restart fixture',
    timezone: 'Asia/Jerusalem',
    waterGlassMl: null,
    waterTargetMl: null,
  });
  if (process.argv[2] === 'before')
    await new WaterRepository(db).addEntry(user.id, 500, '2026-01-01T12:00:00.000Z', {
      channel: 'test',
      messageId: 'restart-fixture',
      idempotencyKey: 'restart-fixture',
    });
  else if (process.argv[2] === 'after') {
    const total = await new WaterRepository(db).getTotalForRange(
      user.id,
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
    );
    if (total !== 500) throw new Error('restart_persistence_failed');
  } else throw new Error('expected_before_or_after');
  console.info(JSON.stringify({ event: 'robi_postgres_restart_verification', phase: process.argv[2], success: true }));
} finally {
  await db.close({ timeout: 1 });
}

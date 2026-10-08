import { connect, ready } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { settings } from './config.js';
import { UserRepository } from './repositories/users.js';
import { HealthService } from './services/health.js';
import { handler } from './tools/http.js';
const command = process.argv[2];
if (command === 'healthcheck') {
  const response = await fetch('http://127.0.0.1:18765/health', { signal: AbortSignal.timeout(2000) });
  process.exit(response.ok ? 0 : 1);
}
const admin = command === 'migrate' || command === 'seed';
const db = connect(admin);
try {
  await ready(db);
  if (command === 'migrate') {
    await migrate(db);
    console.info(JSON.stringify({ event: 'robi_migrations_complete' }));
  } else if (command === 'seed') {
    await new UserRepository(db).ensureUser(settings());
    console.info(JSON.stringify({ event: 'robi_user_bootstrapped' }));
  } else if (command === 'status') {
    console.log(JSON.stringify(await new HealthService(db, settings()).getTodayStatus()));
  } else if (command === 'serve') {
    const server = Bun.serve({
      hostname: '0.0.0.0',
      port: 18765,
      maxRequestBodySize: 16384,
      fetch: handler(db, new HealthService(db, settings())),
    });
    console.info(JSON.stringify({ event: 'robi_health_service_ready' }));
    const stop = async () => {
      await server.stop(true);
      await db.close();
      process.exit(0);
    };
    process.on('SIGTERM', () => {
      void stop();
    });
    process.on('SIGINT', () => {
      void stop();
    });
    await new Promise<never>(() => {});
  } else throw new Error('expected_migrate_seed_serve_or_healthcheck');
} catch {
  console.error(JSON.stringify({ event: admin ? 'robi_migration_or_seed_error' : 'robi_service_error' }));
  process.exitCode = 1;
} finally {
  await db.close();
}

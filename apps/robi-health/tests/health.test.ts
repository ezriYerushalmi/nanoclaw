import { SQL } from 'bun';
import { beforeAll, afterAll, beforeEach, expect, test } from 'bun:test';
import { connect, ready } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { UserRepository } from '../src/repositories/users.js';
import { HealthService, type TrustedInteraction } from '../src/services/health.js';
import { localDay } from '../src/services/day.js';
import { instant, waterMl, type HealthSettings } from '../src/domain.js';
import { handler } from '../src/tools/http.js';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveInteraction } from '../src/runtime/authority.js';
const config: HealthSettings = {
  externalKey: 'test-owner',
  displayName: 'Test Owner',
  timezone: 'Asia/Jerusalem',
  waterGlassMl: null,
  waterTargetMl: 3000,
};
const now = new Date('2026-07-02T10:00:00Z');
const admin = connect(true);
let db: SQL, service: HealthService;
const owner = (key: string): TrustedInteraction => ({
  canWrite: true,
  source: { channel: 'test', messageId: key, idempotencyKey: key },
});
beforeAll(async () => {
  await ready(admin);
  const exists = await admin<
    { present: boolean }[]
  >`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='robi_health_test') AS present`;
  if (!exists[0].present) await admin.unsafe('CREATE DATABASE robi_health_test');
  db = new SQL({
    adapter: 'postgres',
    hostname: process.env.ROBI_DB_HOST ?? 'postgres',
    database: 'robi_health_test',
    username: 'robi_db_admin',
    password: process.env.ROBI_DB_ADMIN_PASSWORD,
  });
  await ready(db);
  await migrate(db);
  await migrate(db);
});
afterAll(async () => {
  await db.close({ timeout: 1 });
  await admin.close({ timeout: 1 });
});
beforeEach(async () => {
  await db`TRUNCATE users CASCADE`;
  await new UserRepository(db).ensureUser(config);
  service = new HealthService(db, config, () => now);
});
test('empty status preserves unknown values and timezone', async () => {
  const status = await service.getTodayStatus();
  expect(status.date).toBe('2026-07-02');
  expect(status.timezone).toBe('Asia/Jerusalem');
  expect(status.water).toEqual({ totalMl: 0, targetMl: 3000, remainingMl: 3000 });
  expect(status.weight).toEqual({ latestKg: null, latestMeasuredAt: null, measuredToday: false });
  expect(
    (await new HealthService(db, { ...config, waterTargetMl: null }, () => now).getTodayStatus()).water.remainingMl,
  ).toBeNull();
});
test('confirmed owner weights are append-only; newest measurement, not insertion, wins', async () => {
  await service.execute('log_weight', { weightKg: 73.5, measuredAt: '2026-07-01T06:00:00Z' }, owner('first'));
  const result = await service.execute('log_weight', { weightKg: 72.8 }, owner('second'));
  expect(result).toMatchObject({ success: true, weightKg: 72.8, previousWeightKg: 73.5 });
  await service.execute('log_weight', { weightKg: 75.5, measuredAt: '2026-06-01T06:00:00Z' }, owner('older'));
  const user = (await service.users.getByExternalKey(config.externalKey))!;
  expect(await service.weights.listRecent(user.id)).toHaveLength(3);
  expect((await service.weights.getLatest(user.id))?.weightKg).toBe(72.8);
  expect((await service.getTodayStatus()).weight).toMatchObject({ latestKg: 72.8, measuredToday: true });
});
test('water events remain distinct and ml/liter normalize and sum', async () => {
  await service.execute('log_water', { amount: 0.5, unit: 'liter' }, owner('water1'));
  await service.execute('log_water', { amount: 250, unit: 'ml' }, owner('water2'));
  expect(await service.execute('log_water', { amount: 500, unit: 'ml' }, owner('water3'))).toMatchObject({
    success: true,
    amountMl: 500,
    totalTodayMl: 1250,
    targetMl: 3000,
  });
  const user = (await service.users.getByExternalKey(config.externalKey))!;
  const day = await localDay(db, config.timezone, now);
  expect(await service.water.listForRange(user.id, day.start, day.end)).toHaveLength(3);
});
test('Israel local calendar range includes DST transitions and excludes next midnight', async () => {
  const spring = await localDay(db, 'Asia/Jerusalem', new Date('2026-03-27T12:00:00Z'));
  const fall = await localDay(db, 'Asia/Jerusalem', new Date('2026-10-25T12:00:00Z'));
  expect((Date.parse(spring.end) - Date.parse(spring.start)) / 3600000).toBe(23);
  expect((Date.parse(fall.end) - Date.parse(fall.start)) / 3600000).toBe(25);
  const day = await localDay(db, config.timezone, now);
  expect(day.start).toBe('2026-07-01T21:00:00.000Z');
  await service.execute('log_water', { amount: 500, unit: 'ml', consumedAt: day.start }, owner('start'));
  await service.execute('log_water', { amount: 250, unit: 'ml', consumedAt: '2026-07-01T20:59:59Z' }, owner('before'));
  const evening = new HealthService(db, config, () => new Date(day.end));
  await evening.execute('log_water', { amount: 100, unit: 'ml', consumedAt: day.end }, owner('end'));
  expect((await service.getTodayStatus()).water.totalMl).toBe(500);
});
test('participant cannot write even if spoofing owner arguments; may read status', async () => {
  const participant = { ...owner('participant'), canWrite: false };
  await expect(service.execute('log_weight', { weightKg: 72 }, participant)).rejects.toThrow('unauthorized_sender');
  await expect(service.execute('log_water', { amount: 500, unit: 'ml' }, participant)).rejects.toThrow(
    'unauthorized_sender',
  );
  await expect(service.execute('log_weight', { weightKg: 72, userId: 'owner' }, owner('forged'))).rejects.toThrow(
    'unexpected_argument',
  );
  expect(await service.execute('get_today_status', {}, participant)).toHaveProperty('date');
  expect((await service.getTodayStatus()).weight.latestKg).toBeNull();
});
test('concurrent retries produce one entry; conflicting retry fails', async () => {
  const weights = await Promise.all(
    Array.from({ length: 4 }, () => service.execute('log_weight', { weightKg: 72.8 }, owner('retry'))),
  );
  expect(new Set(weights.map((x) => JSON.stringify(x))).size).toBe(1);
  await Promise.all(
    Array.from({ length: 4 }, () => service.execute('log_water', { amount: 500, unit: 'ml' }, owner('retry-water'))),
  );
  expect((await service.getTodayStatus()).water.totalMl).toBe(500);
  const user = (await service.users.getByExternalKey(config.externalKey))!;
  expect(await service.weights.listRecent(user.id)).toHaveLength(1);
  await expect(service.execute('log_weight', { weightKg: 73 }, owner('retry'))).rejects.toThrow('idempotency_conflict');
});
test('glass size needs clarification; configured glasses convert without assumption', async () => {
  expect(await service.execute('log_water', { amount: 2, unit: 'glass' }, owner('glasses'))).toEqual({
    success: false,
    clarificationRequired: true,
    reason: 'water_glass_size_not_configured',
  });
  expect((await service.getTodayStatus()).water.totalMl).toBe(0);
  const configured = new HealthService(db, { ...config, waterGlassMl: 300 }, () => now);
  expect(await configured.execute('log_water', { amount: 2, unit: 'glass' }, owner('glasses'))).toMatchObject({
    success: true,
    amountMl: 600,
  });
});
test('timestamps and invalid amounts fail rather than infer offsets or units', async () => {
  expect(waterMl(1.001, 'liter', null)).toBe(1001);
  expect(() => waterMl(0.0005, 'liter', null)).toThrow('water_requires_whole_milliliters');
  expect(() => instant('2026-07-02T12:00:00', now)).toThrow('timestamp_requires_timezone');
  expect(() => instant('2026-02-30T12:00:00Z', now)).toThrow('invalid_timestamp');
  await expect(service.execute('log_water', { amount: -1, unit: 'ml' }, owner('invalid'))).rejects.toThrow();
  await expect(service.execute('log_weight', { weightKg: 72.888 }, owner('invalid'))).rejects.toThrow();
});
test('state survives service and database-client recreation', async () => {
  await service.execute('log_weight', { weightKg: 72.8 }, owner('restart'));
  const reopened = new SQL({
    adapter: 'postgres',
    hostname: process.env.ROBI_DB_HOST ?? 'postgres',
    database: 'robi_health_test',
    username: 'robi_db_admin',
    password: process.env.ROBI_DB_ADMIN_PASSWORD,
  });
  try {
    expect((await new HealthService(reopened, config, () => now).getTodayStatus()).weight.latestKg).toBe(72.8);
  } finally {
    await reopened.close({ timeout: 1 });
  }
});
test('runtime DB role can append events but cannot modify user, erase history or create tables', async () => {
  const runtime = new SQL({
    adapter: 'postgres',
    hostname: process.env.ROBI_DB_HOST ?? 'postgres',
    database: 'robi_health_test',
    username: 'robi_db_user',
    password: process.env.ROBI_DB_PASSWORD,
  });
  try {
    const runtimeService = new HealthService(runtime, config, () => now);
    await runtimeService.execute('log_water', { amount: 500, unit: 'ml' }, owner('restricted'));
    expect((await runtimeService.getTodayStatus()).water.totalMl).toBe(500);
    await expect(Promise.resolve(runtime`DELETE FROM water_entries`)).rejects.toThrow();
    await expect(Promise.resolve(runtime`UPDATE users SET display_name='Changed'`)).rejects.toThrow();
    await expect(Promise.resolve(runtime`CREATE TABLE unauthorized(id integer)`)).rejects.toThrow();
  } finally {
    await runtime.close({ timeout: 1 });
  }
});
test('HTTP tool endpoint carries structured results and fails closed on authority failure', async () => {
  const api = handler(db, service, () => ({ ...owner('http'), canWrite: false }));
  const response = await api(
    new Request('http://local/tools', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'log_weight',
        input: { weightKg: 72 },
        sessionId: 'sess-test',
        messageId: 'm1',
      }),
    }),
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ success: false, reason: 'unauthorized_sender' });
});
test('three original water reports in one burst persist three events and retry only the selected source', async () => {
  const root = mkdtempSync(join(tmpdir(), 'robi-burst-health-'));
  const folder = join(root, 'sess-test');
  mkdirSync(folder);
  const policy = join(root, 'policy.json');
  writeFileSync(policy, JSON.stringify({ platformIds: ['group@g.us'], acknowledgeSender: 'whatsapp:owner' }));
  const incoming = new Database(join(folder, 'inbound.db'));
  const outgoing = new Database(join(folder, 'outbound.db'));
  incoming.exec(
    'CREATE TABLE messages_in(id text,kind text,channel_type text,platform_id text,content text,seq integer)',
  );
  outgoing.exec('CREATE TABLE session_state(key text,value text)');
  for (let index = 1; index <= 3; index++)
    incoming
      .query('INSERT INTO messages_in VALUES (?,?,?,?,?,?)')
      .run(
        `m${index}`,
        'chat',
        'whatsapp',
        'group@g.us',
        JSON.stringify({ sender: 'owner', whatsappKey: { id: `original-${index}` } }),
        index * 2,
      );
  outgoing
    .query('INSERT INTO session_state VALUES (?,?)')
    .run('robi:active', JSON.stringify({ rows: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] }));
  const api = handler(db, service, (s, m, o, _root, _policy, index) =>
    resolveInteraction(s, m, o, root, policy, index),
  );
  const call = async (index: number, amount: number) => {
    const response = await api(
      new Request('http://local/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'log_water',
          input: { amount, unit: 'ml', sourceMessageIndex: index },
          sessionId: 'sess-test',
          messageId: 'm3',
        }),
      }),
    );
    expect(response.status).toBe(200);
  };
  try {
    await call(1, 500);
    await call(2, 250);
    await call(3, 500);
    await call(3, 500);
    const user = (await service.users.getByExternalKey(config.externalKey))!;
    const day = await localDay(db, config.timezone, now);
    expect(await service.water.listForRange(user.id, day.start, day.end)).toHaveLength(3);
    expect((await service.getTodayStatus()).water.totalMl).toBe(1250);
  } finally {
    incoming.close();
    outgoing.close();
    rmSync(root, { recursive: true });
  }
});

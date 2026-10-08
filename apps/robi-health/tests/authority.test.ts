import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from 'bun:test';
import { resolveInteraction } from '../src/runtime/authority.js';
test('authority derives original sender from inbound, not active-state acknowledge or copied sender', () => {
  const root = mkdtempSync(join(tmpdir(), 'robi-authority-'));
  const session = join(root, 'sess-test');
  mkdirSync(session);
  const policy = join(root, 'policy.json');
  writeFileSync(policy, JSON.stringify({ platformIds: ['group@g.us'], acknowledgeSender: 'whatsapp:owner' }));
  const inbound = new Database(join(session, 'inbound.db'));
  const outbound = new Database(join(session, 'outbound.db'));
  inbound.exec(
    'CREATE TABLE messages_in(id text,kind text,channel_type text,platform_id text,content text,seq integer)',
  );
  outbound.exec('CREATE TABLE session_state(key text,value text)');
  inbound
    .query('INSERT INTO messages_in VALUES (?,?,?,?,?,?)')
    .run('m1', 'chat', 'whatsapp', 'group@g.us', JSON.stringify({ sender: 'participant' }), 2);
  outbound
    .query('INSERT INTO session_state VALUES (?,?)')
    .run('robi:active', JSON.stringify({ acknowledge: true, rows: [{ id: 'm1', content: '{"sender":"owner"}' }] }));
  try {
    expect(resolveInteraction('sess-test', 'm1', 'log_weight', root, policy).canWrite).toBe(false);
    inbound.query('UPDATE messages_in SET content=?').run(JSON.stringify({ sender: 'owner' }));
    expect(resolveInteraction('sess-test', 'm1', 'log_weight', root, policy).canWrite).toBe(true);
    expect(resolveInteraction('sess-test', 'm1', 'log_weight', root, policy).source.idempotencyKey).toBe(
      resolveInteraction('sess-test', 'm1', 'log_weight', root, policy).source.idempotencyKey,
    );
    expect(() => resolveInteraction('sess-test', 'old-message', 'log_weight', root, policy)).toThrow(
      'interaction_changed',
    );
    expect(() => resolveInteraction('../sess-test', 'm1', 'log_weight', root, policy)).toThrow('invalid_session');
    for (const [id, sequence] of [
      ['m2', 4],
      ['m3', 6],
    ] as const)
      inbound
        .query('INSERT INTO messages_in VALUES (?,?,?,?,?,?)')
        .run(
          id,
          'chat',
          'whatsapp',
          'group@g.us',
          JSON.stringify({ sender: 'owner', whatsappKey: { id: `original-${id}` } }),
          sequence,
        );
    outbound
      .query('UPDATE session_state SET value=?')
      .run(JSON.stringify({ rows: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] }));
    const sources = [1, 2, 3].map(
      (index) => resolveInteraction('sess-test', 'm3', 'log_water', root, policy, index).source,
    );
    expect(new Set(sources.map((source) => source.idempotencyKey)).size).toBe(3);
    expect(sources[1].messageId).toBe('original-m2');
    expect(resolveInteraction('sess-test', 'm3', 'log_water', root, policy).source.idempotencyKey).toBe(
      sources[2].idempotencyKey,
    );
    expect(() => resolveInteraction('sess-test', 'm3', 'log_water', root, policy, 4)).toThrow(
      'invalid_source_message_index',
    );
    expect(() => resolveInteraction('sess-test', 'm3', 'log_water', root, policy, 'owner')).toThrow(
      'invalid_source_message_index',
    );
    inbound.query('UPDATE messages_in SET content=? WHERE id=?').run(JSON.stringify({ sender: 'participant' }), 'm2');
    expect(resolveInteraction('sess-test', 'm3', 'log_water', root, policy, 3).canWrite).toBe(false);
    inbound.query('UPDATE messages_in SET platform_id=?').run('other@g.us');
    expect(() => resolveInteraction('sess-test', 'm3', 'log_weight', root, policy)).toThrow('interaction_out_of_scope');
  } finally {
    inbound.close();
    outbound.close();
    rmSync(root, { recursive: true });
  }
});

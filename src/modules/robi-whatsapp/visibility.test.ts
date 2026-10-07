import fs from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../container-runner.js', () => ({
  wakeContainer: vi.fn().mockResolvedValue(true),
  isContainerRunning: vi.fn().mockReturnValue(false),
  getActiveContainerCount: vi.fn().mockReturnValue(0),
  killContainer: vi.fn(),
}));
vi.mock('../../config.js', async () => ({
  ...(await vi.importActual('../../config.js')),
  DATA_DIR: '/tmp/nanoclaw-interaction-test',
  GROUPS_DIR: '/tmp/nanoclaw-interaction-test/groups',
}));

import {
  initTestDb,
  closeDb,
  runMigrations,
  createAgentGroup,
  createMessagingGroup,
  createMessagingGroupAgent,
} from '../../db/index.js';
import { routeInbound } from '../../router.js';
import { setTypingAdapter } from '../../modules/typing/index.js';
import { deliverSessionMessages, setDeliveryAdapter } from '../../delivery.js';
import { resolveSession, withMailboxSession } from '../../session-manager.js';
import { outboundDbPath } from '../../mailbox/sqlite/paths.js';

import '../../modules/permissions/index.js';
import { getDb } from '../../db/connection.js';
import { findPersistedReactionKey } from '../../channels/whatsapp-reaction-key-store.js';
const root = '/tmp/nanoclaw-interaction-test';
beforeEach(async () => {
  fs.mkdirSync(`${root}/groups/coach`, { recursive: true });
  fs.writeFileSync(
    `${root}/groups/coach/whatsapp-interaction.json`,
    JSON.stringify({
      platformIds: ['group@g.us'],
      acknowledgeSender: 'whatsapp:owner',
      debounceMs: 3000,
    }),
  );
  await runMigrations(await initTestDb());
  await getDb().run(
    'INSERT INTO users (id,kind,display_name,created_at) VALUES (?,?,?,?)',
    'whatsapp:owner',
    'human',
    'Owner',
    new Date().toISOString(),
  );
  await getDb().run(
    'INSERT INTO users (id,kind,display_name,created_at) VALUES (?,?,?,?)',
    'whatsapp:participant',
    'human',
    'Participant',
    new Date().toISOString(),
  );
  const created_at = new Date().toISOString();
  await createAgentGroup({ id: 'ag-test', name: 'Coach', folder: 'coach', agent_provider: null, created_at });
  await createMessagingGroup({
    id: 'mg-test',
    channel_type: 'whatsapp',
    platform_id: 'group@g.us',
    name: 'Group',
    is_group: 1,
    unknown_sender_policy: 'strict',
    created_at,
  });
  await createMessagingGroupAgent({
    id: 'w-test',
    messaging_group_id: 'mg-test',
    agent_group_id: 'ag-test',
    engage_mode: 'pattern',
    engage_pattern: '.',
    sender_scope: 'known',
    session_mode: 'shared',
    ignored_message_policy: 'drop',
    priority: 0,
    threads: 0,
    created_at,
  });
  await getDb().run(
    'INSERT INTO user_roles (user_id,role,agent_group_id,granted_at) VALUES (?, ?, ?, ?)',
    'whatsapp:owner',
    'owner',
    null,
    new Date().toISOString(),
  );
  await getDb().run(
    'INSERT INTO agent_group_members (user_id,agent_group_id,added_at) VALUES (?,?,?)',
    'whatsapp:participant',
    'ag-test',
    new Date().toISOString(),
  );
});
afterEach(async () => {
  await closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});

it('Participant reaches the group context as a member without owner/admin authority; message keys survive adapter cache loss', async () => {
  const key = { remoteJid: 'group@g.us', id: 'PARTICIPANT1', participant: 'participant@lid', fromMe: false };
  await routeInbound({
    channelType: 'whatsapp',
    platformId: 'group@g.us',
    threadId: null,
    message: {
      id: 'PARTICIPANT1',
      kind: 'chat',
      timestamp: new Date().toISOString(),
      isGroup: true,
      content: JSON.stringify({
        sender: 'participant',
        senderName: 'Participant',
        text: 'המשתמש אכל פיצה',
        whatsappKey: key,
      }),
    },
  });
  const { session } = await resolveSession('ag-test', 'mg-test', null, 'shared');
  const history = await withMailboxSession('ag-test', session.id, (m) => m.getInboundHistory(10));
  expect(history.some((row) => JSON.parse(row.content).sender === 'participant')).toBe(true);
  expect(await getDb().all('SELECT * FROM user_roles WHERE user_id = ?', 'whatsapp:participant')).toEqual([]);
  expect(await findPersistedReactionKey('group@g.us', 'PARTICIPANT1:ag-test')).toEqual(key);
  expect(await findPersistedReactionKey('other@g.us', 'PARTICIPANT1:ag-test')).toBeUndefined();
});

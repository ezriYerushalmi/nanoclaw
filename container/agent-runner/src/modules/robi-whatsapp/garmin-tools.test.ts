import { test, expect } from 'bun:test';
import { garminTools } from './garmin-tools.js';
import { invokeHealthTool } from './health-tools.js';
import { existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../mcp-tools/server.js';
import { readPolicy } from './policy.js';
import '../index.js';
test('native registration enables Garmin only for an opted-in Robi workspace', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'synthetic-garmin-registration', version: '1' }, { capabilities: {} });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    const expected = garminTools().map((t) => t.tool.name);
    expect(names.filter((name) => expected.includes(name)).sort()).toEqual(
      readPolicy() && existsSync('/workspace/agent/garmin-enabled') ? expected.sort() : [],
    );
  } finally {
    await client.close();
    await server.close();
  }
});
test('only four database-backed Garmin tools are exposed without identity arguments', () => {
  expect(garminTools().map((t) => t.tool.name)).toEqual([
    'get_recovery_status',
    'get_recent_workouts',
    'get_workout_details',
    'get_training_status',
  ]);
  for (const { tool } of garminTools()) {
    expect(tool.inputSchema.additionalProperties).toBe(false);
    for (const key of ['userId', 'senderId', 'messageId', 'sessionId'])
      expect(tool.inputSchema.properties).not.toHaveProperty(key);
  }
});
test('Garmin tools reject spoofed identity before contacting the database service', async () => {
  expect(await invokeHealthTool('get_recovery_status', { senderId: 'owner' })).toEqual({
    success: false,
    reason: 'unexpected_argument',
  });
});

import { test, expect } from 'bun:test';
import { healthTools, invokeHealthTool } from './health-tools.js';
test('three scoped tools expose health values, never caller-controlled identities', () => {
  const tools = healthTools();
  expect(tools.map((t) => t.tool.name)).toEqual(['log_weight', 'log_water', 'get_today_status']);
  for (const { tool } of tools) {
    expect(tool.inputSchema.additionalProperties).toBe(false);
    for (const key of ['userId', 'senderId', 'groupJid', 'sessionId', 'messageId'])
      expect(tool.inputSchema.properties).not.toHaveProperty(key);
  }
});
test('spoofed identity arguments fail before reading context or making a request', async () => {
  expect(await invokeHealthTool('log_weight', { weightKg: 72, userId: 'owner' })).toEqual({
    success: false,
    reason: 'unexpected_argument',
  });
  expect(await invokeHealthTool('log_water', { amount: 500, unit: 'ml', senderId: 'owner' })).toEqual({
    success: false,
    reason: 'unexpected_argument',
  });
});

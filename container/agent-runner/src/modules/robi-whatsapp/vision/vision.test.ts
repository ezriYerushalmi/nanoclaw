import { afterEach, beforeEach, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { SqliteAgentMailbox } from '../../../mailbox/sqlite/index.js';
import { initTestSessionDb, closeSessionDb, getInboundDb } from '../../../mailbox/sqlite/connection.js';
import { robiMailbox } from '../mailbox.js';
import { currentImageSources } from './media.js';
import { imageAnalysisSchema, classificationReaction } from './schema.js';
import { visionTools } from './tools.js';
const policy = { platformIds: ['synthetic-group'], acknowledgeSender: 'whatsapp:owner', debounceMs: 3000 };
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=',
  'base64',
);
let root: string;
beforeEach(() => {
  initTestSessionDb();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'robi-vision-'));
  fs.mkdirSync(path.join(root, 'inbox'));
});
afterEach(() => {
  closeSessionDb();
  fs.rmSync(root, { recursive: true, force: true });
});
function insert(seq: number, sender = 'owner', image = true, text = 'synthetic caption') {
  const name = `${seq}.png`;
  if (image) fs.writeFileSync(path.join(root, 'inbox', name), png);
  getInboundDb()
    .prepare(`INSERT INTO messages_in(id,seq,kind,timestamp,platform_id,channel_type,content) VALUES(?,?,?,?,?,?,?)`)
    .run(
      `message-${seq}`,
      seq,
      'chat',
      new Date(Date.now() - 10000 + seq).toISOString(),
      'synthetic-group',
      'whatsapp',
      JSON.stringify({
        sender,
        text,
        attachments: image
          ? [{ type: 'image', localPath: `inbox/${name}`, mimeType: 'image/png', mediaId: `media-${seq}` }]
          : [],
      }),
    );
}
function active(native: SqliteAgentMailbox) {
  const rows = robiMailbox(native, policy, false).operations.getPendingMessages(10, true);
  native.operations.setState('robi:active', JSON.stringify({ rows, acknowledge: true }));
  return rows;
}
it('image, caption, follow-up and multiple images retain order in one burst and original sender', () => {
  insert(2);
  insert(4, 'owner', false, 'this is lunch');
  insert(6);
  const native = new SqliteAgentMailbox();
  const rows = active(native);
  expect(rows.map((r) => r.id)).toEqual(['message-2', 'message-4', 'message-6']);
  const sources = currentImageSources(native.operations, policy, root);
  expect(sources.map((s) => s.mediaId)).toEqual(['media-2', 'media-6']);
  expect(sources[0].caption).toBe('synthetic caption');
  expect(sources[0].sender).toBe('owner');
});
it('Yael image identity cannot be replaced by copied active-state sender or acknowledgment', () => {
  insert(2, 'participant');
  const native = new SqliteAgentMailbox();
  const rows = active(native);
  rows[0].content = JSON.stringify({ sender: 'owner' });
  native.operations.setState('robi:active', JSON.stringify({ rows, acknowledge: true }));
  expect(currentImageSources(native.operations, policy, root)[0].sender).toBe('participant');
});
it('path escapes, spoofed image IDs and unconfigured groups fail closed', async () => {
  insert(2);
  const native = new SqliteAgentMailbox();
  active(native);
  const tools = visionTools(() => currentImageSources(native.operations, policy, root));
  expect(
    (
      await tools[1].handler({
        imageIds: ['invented'],
        analysis: { type: 'unknown', description: 'not readable', confidence: 0, uncertaintyNotes: ['blur'] },
      })
    ).isError,
  ).toBe(true);
  expect(() => currentImageSources(native.operations, { ...policy, platformIds: ['elsewhere'] }, root)).toThrow();
  fs.unlinkSync(path.join(root, 'inbox', '2.png'));
  fs.symlinkSync('/etc/passwd', path.join(root, 'inbox', '2.png'));
  expect(() => currentImageSources(native.operations, policy, root)).toThrow('unsafe_image_path');
});
it('MCP returns actual image content to the native provider client, together in one result', async () => {
  insert(2);
  insert(4);
  const native = new SqliteAgentMailbox();
  active(native);
  const tools = visionTools(() => currentImageSources(native.operations, policy, root));
  const server = new Server({ name: 'synthetic-vision', version: '1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    tools.find((t) => t.tool.name === req.params.name)!.handler(req.params.arguments ?? {}),
  );
  const client = new Client({ name: 'provider-contract-probe', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const result = await client.callTool({ name: 'get_image_burst', arguments: {} });
    const content = result.content as Array<{ type: string; data?: string; mimeType?: string }>;
    expect(content.filter((c) => c.type === 'image')).toHaveLength(2);
    expect(content[1].data).toBe(png.toString('base64'));
    expect(content[1].mimeType).toBe('image/png');
  } finally {
    await client.close();
    await server.close();
  }
});
it('food estimates validate, unsupported fields and reversed ranges do not', () => {
  const meal = {
    type: 'food',
    foods: [{ name: 'cottage cheese', confidence: 0.8, estimatedGrams: 120 }],
    estimatedNutrition: { calories: { min: 300, max: 500 } },
    confidence: 0.7,
    uncertaintyNotes: ['portion is estimated'],
  };
  expect(imageAnalysisSchema.safeParse(meal).success).toBe(true);
  expect(
    imageAnalysisSchema.safeParse({ ...meal, estimatedNutrition: { calories: { min: 500, max: 300 } } }).success,
  ).toBe(false);
  expect(imageAnalysisSchema.safeParse({ ...meal, confirmedGrams: 120 }).success).toBe(false);
  expect(Object.values(classificationReaction)).toEqual(['⭕', '🔺', '⬜', '🍎']);
});
it('running extraction preserves only visible metrics; swimming has its own pace unit', () => {
  const w = {
    type: 'workout_summary',
    sport: 'running',
    durationSeconds: 1248,
    distanceMeters: 3200,
    pace: { averageSecondsPerKm: 390 },
    heartRate: { average: 158 },
    confidence: 1,
    uncertaintyNotes: [],
  };
  const parsed = imageAnalysisSchema.parse(w);
  expect(parsed).toEqual(w);
  expect(parsed).not.toHaveProperty('calories');
  expect(parsed).not.toHaveProperty('startedAt');
  expect(imageAnalysisSchema.safeParse({ ...w, heartRate: { average: 999 } }).success).toBe(false);
  expect(imageAnalysisSchema.safeParse({ ...w, sport: 'swimming', pace: { averageSecondsPer100m: 120 } }).success).toBe(
    true,
  );
});
it('unrelated image cannot carry food or workout fields; unreadable fields stay absent', () => {
  const unknown = {
    type: 'unknown',
    description: 'blurry screenshot',
    confidence: 0.1,
    uncertaintyNotes: ['numbers unreadable'],
  };
  expect(imageAnalysisSchema.parse(unknown)).not.toHaveProperty('distanceMeters');
  expect(imageAnalysisSchema.safeParse({ ...unknown, type: 'other', foods: [] }).success).toBe(false);
});

it('validates a corrected estimate without retaining an obsolete visual value or persisting data', async () => {
  insert(2);
  const native = new SqliteAgentMailbox();
  active(native);
  const tools = visionTools(() => currentImageSources(native.operations, policy, root));
  const input = (grams: number) => ({
    imageIds: ['media-2'],
    analysis: {
      type: 'food',
      foods: [{ name: 'chicken', estimatedGrams: grams, confidence: 0.8 }],
      estimatedNutrition: {},
      confidence: 0.8,
      uncertaintyNotes: ['visual estimate; explicit user correction supersedes this'],
    },
  });
  expect((await tools[1].handler(input(200))).isError).toBeUndefined();
  const corrected = await tools[1].handler(input(120));
  const content = corrected.content[0];
  expect(content.type).toBe('text');
  if (content.type !== 'text') throw new Error('expected structured result');
  const result = JSON.parse(content.text);
  expect(result.analysis.foods[0].estimatedGrams).toBe(120);
  expect(result.persisted).toBe(false);
  expect(native.operations.getUndeliveredMessages()).toEqual([]);
});
it('quoted images resolve only from retained original messages in the same group', () => {
  insert(2);
  insert(4, 'owner', false, 'what about this image?');
  const native = new SqliteAgentMailbox();
  const original = native.operations.getMessageIn('message-4')!;
  const c = JSON.parse(original.content);
  c.replyTo = { id: 'message-2' };
  getInboundDb().prepare('UPDATE messages_in SET content=? WHERE id=?').run(JSON.stringify(c), original.id);
  native.operations.setState('robi:active', JSON.stringify({ rows: [original], acknowledge: true }));
  const sources = currentImageSources(native.operations, policy, root);
  expect(sources).toHaveLength(1);
  expect(sources[0].quoted).toBe(true);
  expect(sources[0].messageId).toBe('message-2');
});

it('review acknowledgment is emitted once on the final burst message without typing', async () => {
  const { acknowledgeImageReview } = await import('../mailbox.js');
  const { policyForTurn } = await import('../../../turn-policy.js');
  insert(2);
  insert(4);
  const native = new SqliteAgentMailbox();
  const decorated = robiMailbox(native, policy);
  const rows = decorated.operations.getPendingMessages(10, true);
  const turn = policyForTurn(rows.map((r) => r.id))!;
  await acknowledgeImageReview();
  await acknowledgeImageReview();
  const out = native.operations.getUndeliveredMessages();
  expect(out).toHaveLength(1);
  expect(JSON.parse(out[0].content)).toEqual({ operation: 'reaction', messageId: 'message-4', emoji: '👀' });
  await turn.finish(false);
  expect(JSON.parse(native.operations.getUndeliveredMessages().at(-1)!.content).messageId).toBe('message-4');
});

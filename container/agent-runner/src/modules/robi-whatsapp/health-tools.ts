import fs from 'node:fs';
import { getAgentMailbox } from '../../mailbox/index.js';
import { registerTools } from '../../mcp-tools/server.js';
import { readPolicy } from './policy.js';
import type { McpToolDefinition } from '../../mcp-tools/types.js';
const definitions = [
  {
    name: 'log_weight',
    description:
      'Persist a confirmed weight in kg for the configured health user. Only the trusted owner interaction may write. Retries are idempotent per source message. Do not log reported facts from other participants.',
    properties: {
      weightKg: { type: 'number', minimum: 10, maximum: 500 },
      sourceMessageIndex: {
        type: 'integer',
        minimum: 1,
        description:
          'Optional 1-based original message position in the CURRENT burst for a distinct report. Omit for a single report spanning the burst. Never select historical context.',
      },
      measuredAt: {
        type: 'string',
        description: 'ISO timestamp including Z or offset, only if known; omit to use now.',
      },
    },
    required: ['weightKg'],
  },
  {
    name: 'log_water',
    description:
      'Persist confirmed water consumption for the configured health user. Only the trusted owner interaction may write. Keep distinct reports as separate events using their source message positions; retries are idempotent. Glass requires configured glass size.',
    properties: {
      amount: { type: 'number', exclusiveMinimum: 0 },
      sourceMessageIndex: {
        type: 'integer',
        minimum: 1,
        description:
          'Optional 1-based original message position in the CURRENT burst for a distinct report. Omit for a single report spanning the burst. Never select historical context.',
      },
      unit: { type: 'string', enum: ['ml', 'liter', 'glass'] },
      consumedAt: {
        type: 'string',
        description: 'ISO timestamp including Z or offset, only if known; omit to use now.',
      },
    },
    required: ['amount', 'unit'],
  },
  {
    name: 'get_today_status',
    description: 'Retrieve factual water total and latest weight for the health user and their local calendar day.',
    properties: {},
    required: [],
  },
] as const;
export async function invokeHealthTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const allowed =
    name === 'log_weight'
      ? ['weightKg', 'measuredAt', 'sourceMessageIndex']
      : name === 'log_water'
        ? ['amount', 'unit', 'consumedAt', 'sourceMessageIndex']
        : name === 'get_today_status'
          ? []
          : name === 'get_workout_details'
            ? ['workoutId']
            : name === 'get_recent_workouts'
              ? ['days', 'limit']
              : ['get_recovery_status', 'get_training_status'].includes(name)
                ? ['date']
                : null;
  if (!allowed || Object.keys(args).some((key) => !allowed.includes(key)))
    return { success: false, reason: 'unexpected_argument' };
  const config: unknown = JSON.parse(fs.readFileSync('/workspace/agent/health-data.json', 'utf8'));
  if (!config || typeof config !== 'object' || !('apiUrl' in config) || typeof config.apiUrl !== 'string')
    throw new Error('invalid_health_configuration');
  const url = new URL(config.apiUrl);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== 'host.docker.internal' ||
    url.pathname !== '/' ||
    url.username ||
    url.password
  )
    throw new Error('invalid_health_endpoint');
  const active: unknown = JSON.parse(getAgentMailbox().operations.getState('robi:active')?.value ?? 'null');
  if (!active || typeof active !== 'object' || !('rows' in active) || !Array.isArray(active.rows))
    return { success: false, reason: 'no_active_interaction' };
  const last: unknown = active.rows.at(-1);
  if (!last || typeof last !== 'object' || !('id' in last) || typeof last.id !== 'string')
    return { success: false, reason: 'no_active_interaction' };
  const session: unknown = JSON.parse(fs.readFileSync('/app/.nanoclaw-session.json', 'utf8'));
  if (!session || typeof session !== 'object' || !('sessionId' in session) || typeof session.sessionId !== 'string')
    throw new Error('invalid_session_context');
  const response = await fetch(new URL('/tools', url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operation: name, input: args, sessionId: session.sessionId, messageId: last.id }),
    signal: AbortSignal.timeout(15_000),
  });
  return (await response.json()) as unknown;
}
export function healthTools(): McpToolDefinition[] {
  return definitions.map((definition) => ({
    tool: {
      name: definition.name,
      description: definition.description,
      inputSchema: {
        type: 'object',
        properties: definition.properties,
        required: [...definition.required],
        additionalProperties: false,
      },
    },
    async handler(args) {
      try {
        const result = await invokeHealthTool(definition.name, args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch {
        console.error(JSON.stringify({ event: 'robi_health_tool_unavailable', tool: definition.name }));
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ success: false, reason: 'health_service_unavailable' }) }],
        };
      }
    },
  }));
}
if (readPolicy() && fs.existsSync('/workspace/agent/health-data.json')) registerTools(healthTools());

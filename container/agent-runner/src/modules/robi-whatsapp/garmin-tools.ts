import fs from 'node:fs';
import { registerTools } from '../../mcp-tools/server.js';
import type { McpToolDefinition } from '../../mcp-tools/types.js';
import { invokeHealthTool } from './health-tools.js';
import { readPolicy } from './policy.js';
export function garminTools(): McpToolDefinition[] {
  const names = ['get_recovery_status', 'get_recent_workouts', 'get_workout_details', 'get_training_status'] as const;
  return names.map(
    (name): McpToolDefinition => ({
      tool: {
        name,
        description: `${name}: owner-only Garmin context from local PostgreSQL; no live Garmin calls. Respect missing values, source dates, freshness and user overrides. Do not disclose the owner's private metrics to other participants.`,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties:
            name === 'get_workout_details'
              ? { workoutId: { type: 'string' } }
              : name === 'get_recent_workouts'
                ? {
                    days: { type: 'integer', minimum: 1, maximum: 90 },
                    limit: { type: 'integer', minimum: 1, maximum: 50 },
                  }
                : {
                    date: {
                      type: 'string',
                      description:
                        'Optional YYYY-MM-DD local date; omit for today. Never substitute yesterday as today.',
                    },
                  },
          ...(name === 'get_workout_details' ? { required: ['workoutId'] } : {}),
        },
      },
      async handler(args) {
        try {
          return { content: [{ type: 'text' as const, text: JSON.stringify(await invokeHealthTool(name, args)) }] };
        } catch {
          return { isError: true, content: [{ type: 'text' as const, text: 'garmin_database_unavailable' }] };
        }
      },
    }),
  );
}
if (readPolicy() && fs.existsSync('/workspace/agent/garmin-enabled')) registerTools(garminTools());

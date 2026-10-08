import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
interface Result {
  isError?: boolean;
  content?: unknown;
}
interface Client {
  connect(t: unknown): Promise<void>;
  callTool(
    p: { name: string; arguments: Record<string, unknown> },
    extra: undefined,
    opts: { timeout: number },
  ): Promise<Result>;
  close(): Promise<void>;
}
export interface GarminProvider {
  getRecentPage(limit: number): Promise<unknown[]>;
  getDailyHealth(date: string): Promise<Record<string, unknown>>;
  getRecentActivities(startDate: string, endDate: string): Promise<unknown[]>;
  getActivity(
    id: number,
    includeSets?: boolean,
  ): Promise<{ summary: unknown; splits: unknown; zones: unknown; sets: unknown }>;
  close(): Promise<void>;
}
export async function connector(): Promise<GarminProvider> {
  if (!process.env.GARMIN_EMAIL || !process.env.GARMIN_PASSWORD) throw new Error('garmin_credentials_missing');
  const runtime = path.resolve('data/garmin-connector');
  const entry = fs.realpathSync(path.join(runtime, 'node_modules/@nicolasvegam/garmin-connect-mcp/build/index.js'));
  const req = createRequire(entry);
  const { Client } = (await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/index.js')).href)) as {
    Client: new (i: { name: string; version: string }) => Client;
  };
  const { StdioClientTransport } = (await import(
    pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href
  )) as {
    StdioClientTransport: new (o: { command: string; args: string[]; env: Record<string, string>; stderr: 'pipe' }) => {
      stderr?: NodeJS.ReadableStream | null;
    };
  };
  process.umask(0o077);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: {
      HOME: path.join(runtime, 'home'),
      PATH: process.env.PATH ?? '',
      GARMIN_EMAIL: process.env.GARMIN_EMAIL,
      GARMIN_PASSWORD: process.env.GARMIN_PASSWORD,
    },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', () => {});
  const client = new Client({ name: 'robi-garmin-sync', version: '1' });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
    if (r.isError) {
      const response = JSON.stringify(r.content);
      throw new Error(
        /401|invalid credentials|MFA required|token expired|unauthorized/i.test(response)
          ? 'authentication_required'
          : 'connector_tool_error',
      );
    }
    if (!Array.isArray(r.content)) throw new Error('connector_tool_error');
    const text: unknown = r.content.find(
      (c: unknown) => !!c && typeof c === 'object' && 'type' in c && c.type === 'text',
    );
    if (!text || typeof text !== 'object' || !('text' in text) || typeof text.text !== 'string')
      throw new Error('invalid_connector_response');
    return JSON.parse(text.text) as unknown;
  };
  return {
    async getRecentPage(limit) {
      const result = await call('get_activities', { start: 0, limit });
      if (!Array.isArray(result) || result.length > limit) throw new Error('invalid_activity_page');
      return result;
    },
    async getDailyHealth(date) {
      return {
        summary: await call('get_steps', { date }),
        sleep: await call('get_sleep_data', { date }),
        hrv: await call('get_hrv', { date }),
        readiness: await call('get_training_readiness', { date }),
        training: await call('get_training_status', { date }),
      };
    },
    async getRecentActivities(startDate, endDate) {
      const r = await call('get_activities_by_date', { startDate, endDate });
      if (!Array.isArray(r)) throw new Error('invalid_activity_list');
      if (r.length > 500) throw new Error('activity_window_too_large');
      return r;
    },
    async getActivity(activityId, includeSets = true) {
      const summary = await call('get_activity', { activityId });
      const splits = await call('get_activity_splits', { activityId });
      const zones = await call('get_activity_hr_zones', { activityId });
      let sets: unknown = null;
      if (includeSets) {
        try {
          sets = await call('get_activity_exercise_sets', { activityId });
        } catch (error: unknown) {
          if (error instanceof Error && error.message === 'authentication_required') throw error;
          console.error(JSON.stringify({ event: 'garmin_optional_strength_sets_unavailable' }));
        }
      }
      return { summary, splits, zones, sets };
    },
    close: () => client.close(),
  };
}

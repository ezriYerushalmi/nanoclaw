import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
interface Tool {
  name: string;
  inputSchema: unknown;
}
interface Result {
  isError?: boolean;
  content?: unknown;
}
interface McpClient {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{ tools: Tool[] }>;
  callTool(
    params: { name: string; arguments: Record<string, unknown> },
    extra: undefined,
    options: { timeout: number },
  ): Promise<Result>;
  close(): Promise<void>;
}
interface Transport {
  stderr?: NodeJS.ReadableStream | null;
}
const mode = process.argv[2] ?? 'inventory';
if (!['inventory', 'read'].includes(mode)) throw new Error('Mode must be inventory or read');
const runtime = path.resolve('data/garmin-connector');
const entry = fs.realpathSync(path.join(runtime, 'node_modules/@nicolasvegam/garmin-connect-mcp/build/index.js'));
const require = createRequire(entry);
const clientModule = (await import(
  pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href
)) as { Client: new (info: { name: string; version: string }) => McpClient };
const stdioModule = (await import(
  pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href
)) as {
  StdioClientTransport: new (options: {
    command: string;
    args: string[];
    env: Record<string, string>;
    stderr: 'pipe';
  }) => Transport;
};
const home = path.join(runtime, mode === 'inventory' ? 'inventory-home' : 'home');
fs.mkdirSync(home, { recursive: true, mode: 0o700 });
process.umask(0o077);
if (mode === 'read' && (!process.env.GARMIN_EMAIL || !process.env.GARMIN_PASSWORD)) {
  console.error(JSON.stringify({ status: 'blocked', code: 'garmin_credentials_missing', accountReadPerformed: false }));
  process.exit(2);
}
const env: Record<string, string> = {
  HOME: home,
  PATH: process.env.PATH ?? '',
  GARMIN_EMAIL: mode === 'inventory' ? 'inventory-only@example.invalid' : process.env.GARMIN_EMAIL!,
  GARMIN_PASSWORD: mode === 'inventory' ? 'inventory-only-not-a-login' : process.env.GARMIN_PASSWORD!,
};
const transport = new stdioModule.StdioClientTransport({
  command: process.execPath,
  args: [entry],
  env,
  stderr: 'pipe',
});
// Drain connector stderr without emitting credentials or raw Garmin payloads.
transport.stderr?.on('data', () => {});
const client = new clientModule.Client({ name: 'robi-garmin-read-only-poc', version: '0.1' });
try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  if (mode === 'inventory') {
    console.log(JSON.stringify({ authenticated: false, accountReadPerformed: false, tools }, null, 2));
  } else {
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const available = new Set(tools.map((t) => t.name));
    const probes = [
      ['get_last_activity', {}],
      ['get_sleep_data', { date }],
      ['get_hrv', { date }],
      ['get_resting_heart_rate', { date }],
      ['get_stress', { date }],
      ['get_body_battery', { startDate: date, endDate: date }],
      ['get_training_readiness', { date }],
      ['get_training_status', { date }],
      ['get_steps', { date }],
    ] as Array<[string, Record<string, unknown>]>;
    for (const [name, args] of probes) {
      if (!available.has(name)) {
        console.log(JSON.stringify({ tool: name, status: 'unavailable' }));
        continue;
      }
      try {
        const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
        if (result.isError) {
          console.error(JSON.stringify({ tool: name, status: 'blocked', code: 'connector_tool_error' }));
          process.exitCode = 2;
          break;
        }
        if (name === 'get_last_activity' && Array.isArray(result.content)) {
          const block: unknown = result.content.find(
            (value: unknown) => !!value && typeof value === 'object' && 'type' in value && value.type === 'text',
          );
          if (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string') {
            const payload: unknown = JSON.parse(block.text);
            const first: unknown = Array.isArray(payload) ? payload[0] : payload;
            if (first && typeof first === 'object' && 'activityId' in first && typeof first.activityId === 'number') {
              probes.push(
                ...[
                  'get_activity',
                  'get_activity_details',
                  'get_activity_splits',
                  'get_activity_hr_zones',
                  'get_activity_exercise_sets',
                ].map((tool) => [tool, { activityId: first.activityId }] as [string, Record<string, unknown>]),
              );
            }
          }
        }
        // No raw health payloads enter logs, fixtures, or an LLM.
        fs.writeFileSync(path.join(runtime, `${name}.private.json`), JSON.stringify(result), { mode: 0o600 });
        console.log(JSON.stringify({ tool: name, status: 'response_saved_locally', valuesNotYetValidated: true }));
      } catch {
        console.error(JSON.stringify({ tool: name, status: 'blocked', code: 'connector_request_failed' }));
        process.exitCode = 2;
        break;
      }
    }
  }
} finally {
  await client.close();
}

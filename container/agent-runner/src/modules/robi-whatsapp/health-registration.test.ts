import { test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../mcp-tools/server.js';
import { readPolicy } from './policy.js';
// Exercise the real capability barrel, including its scoped registration import.
import '../index.js';
test('native MCP registration exposes health tools only in a configured Robi workspace', async () => {
  const configured = !!readPolicy() && existsSync('/workspace/agent/health-data.json');
  const server = createMcpServer();
  const client = new Client({ name: 'robi-health-verification', version: '1' }, { capabilities: {} });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    const health = names.filter((name) => ['log_weight', 'log_water', 'get_today_status'].includes(name));
    expect(health.sort()).toEqual(configured ? ['get_today_status', 'log_water', 'log_weight'] : []);
    if (configured) {
      const config = JSON.parse(readFileSync('/workspace/agent/health-data.json', 'utf8')) as { apiUrl: string };
      const response = await fetch(new URL('/health', config.apiUrl), { signal: AbortSignal.timeout(3000) });
      expect(response.ok).toBe(true);
    }
  } finally {
    await client.close();
    await server.close();
  }
});

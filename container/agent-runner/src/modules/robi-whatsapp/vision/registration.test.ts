import { test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../../mcp-tools/server.js';
import { readPolicy } from '../policy.js';
import '../../index.js';
test('native MCP exposes vision only when Robi group opts in', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'vision-registration', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const names = (await client.listTools()).tools
      .map((t) => t.name)
      .filter((n) => n === 'get_image_burst' || n === 'validate_image_analysis');
    expect(names.sort()).toEqual(
      readPolicy() && existsSync('/workspace/agent/vision-enabled')
        ? ['get_image_burst', 'validate_image_analysis']
        : [],
    );
  } finally {
    await client.close();
    await server.close();
  }
});

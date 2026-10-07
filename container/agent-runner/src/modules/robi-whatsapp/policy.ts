import fs from 'node:fs';
import type { InboundMessage } from '../../mailbox/types.js';
export interface Policy {
  platformIds: string[];
  acknowledgeSender: string;
  debounceMs: number;
}
export function readPolicy(file = '/workspace/agent/whatsapp-interaction.json'): Policy | null {
  if (!fs.existsSync(file)) return null;
  const p = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Policy>;
  if (
    !Array.isArray(p.platformIds) ||
    !p.platformIds.every((id) => typeof id === 'string') ||
    typeof p.acknowledgeSender !== 'string' ||
    typeof p.debounceMs !== 'number' ||
    !Number.isFinite(p.debounceMs) ||
    p.debounceMs < 0 ||
    p.debounceMs > 10000
  )
    throw new Error('Invalid interaction policy');
  return p as Policy;
}
export function optedIn(row: InboundMessage, policy: Policy | null): boolean {
  return (
    !!policy &&
    row.kind === 'chat' &&
    row.channelType === 'whatsapp' &&
    policy.platformIds.includes(row.platformId ?? '')
  );
}
export function sender(row: InboundMessage): string {
  const raw = String(JSON.parse(row.content).sender ?? '');
  return raw.startsWith('whatsapp:') ? raw : `whatsapp:${raw}`;
}
export function receivedAt(row: InboundMessage): number {
  return Date.parse(JSON.parse(row.content).receivedAt ?? row.timestamp);
}
export function selectBurst(rows: InboundMessage[], policy: Policy, now = Date.now()): InboundMessage[] {
  const bursts = new Map<string, InboundMessage[][]>();
  for (const row of [...rows].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))) {
    const key = JSON.stringify([row.channelType, row.platformId, row.threadId, sender(row)]);
    const list = bursts.get(key) ?? [];
    const last = list.at(-1);
    if (last && receivedAt(row) - receivedAt(last.at(-1)!) < policy.debounceMs) last.push(row);
    else list.push([row]);
    bursts.set(key, list);
  }
  return (
    [...bursts.values()]
      .flat()
      .filter((b) => now >= receivedAt(b.at(-1)!) + policy.debounceMs)
      .sort((a, b) => (a[0].sequence ?? 0) - (b[0].sequence ?? 0))[0] ?? []
  );
}

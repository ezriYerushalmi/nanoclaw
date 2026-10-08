import fs from 'node:fs';
import path from 'node:path';
import { GROUPS_DIR } from '../../config.js';
import './garmin-actions.js';

export interface WhatsAppInteractionPolicy {
  platformIds: string[];
  acknowledgeSender: string;
  debounceMs: number;
}

export function readWhatsAppInteractionPolicy(folder: string): WhatsAppInteractionPolicy | null {
  const file = path.join(GROUPS_DIR, folder, 'whatsapp-interaction.json');
  if (!fs.existsSync(file)) return null;
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof value !== 'object' || value === null) throw new Error('Invalid WhatsApp interaction policy');
  const policy = value as Partial<WhatsAppInteractionPolicy>;
  if (
    !Array.isArray(policy.platformIds) ||
    !policy.platformIds.every((id) => typeof id === 'string') ||
    typeof policy.acknowledgeSender !== 'string' ||
    typeof policy.debounceMs !== 'number' ||
    !Number.isFinite(policy.debounceMs) ||
    policy.debounceMs < 0 ||
    policy.debounceMs > 10_000
  )
    throw new Error('Invalid WhatsApp interaction policy');
  return policy as WhatsAppInteractionPolicy;
}

/** Adapter opt-in is selected by stable JID, from workspace-owned configuration. */
export function policyForPlatform(platformId: string): WhatsAppInteractionPolicy | null {
  if (!fs.existsSync(GROUPS_DIR)) return null;
  for (const folder of fs.readdirSync(GROUPS_DIR, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    const policy = readWhatsAppInteractionPolicy(folder.name);
    if (policy?.platformIds.includes(platformId)) return policy;
  }
  return null;
}

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { InboundMessage, MailboxOperations } from '../../../mailbox/types.js';
import { optedIn, readPolicy, type Policy } from '../policy.js';
export interface ImageSource {
  mediaId: string;
  messageId: string;
  timestamp: string;
  sender: string;
  mimeType: string;
  localPath: string;
  caption: string;
  quoted: boolean;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_image_context');
  return value as Record<string, unknown>;
}
export function currentImageSources(
  ops: MailboxOperations,
  policy: Policy | null = readPolicy(),
  root = '/workspace',
): ImageSource[] {
  if (!policy) throw new Error('vision_not_enabled');
  const active = object(JSON.parse(ops.getState('robi:active')?.value ?? 'null'));
  if (!Array.isArray(active.rows)) throw new Error('no_active_image_turn');
  const sources: ImageSource[] = [];
  const seen = new Set<string>();
  for (const item of active.rows) {
    const held = object(item);
    if (typeof held.id !== 'string') throw new Error('invalid_image_context');
    const original = ops.getMessageIn(held.id);
    if (!original || !optedIn(original, policy)) throw new Error('invalid_image_context');
    add(original, false);
    const content = object(JSON.parse(original.content));
    const reply = content.replyTo;
    if (reply && typeof reply === 'object' && 'id' in reply && typeof reply.id === 'string') {
      const suffix = original.id.includes(':ag-') ? original.id.slice(original.id.indexOf(':ag-')) : '';
      const quoted = ops.getMessageIn(reply.id + suffix);
      if (quoted && optedIn(quoted, policy) && quoted.platformId === original.platformId) add(quoted, true);
    }
  }
  return sources;
  function add(row: InboundMessage, quoted: boolean): void {
    const c = object(JSON.parse(row.content));
    if (!Array.isArray(c.attachments)) return;
    for (const raw of c.attachments) {
      const a = object(raw);
      if (a.type !== 'image') continue;
      if (typeof a.localPath !== 'string' || !a.localPath.startsWith('inbox/')) throw new Error('image_not_staged');
      const filename = fs.realpathSync(path.resolve(root, a.localPath));
      const inbox = fs.realpathSync(path.join(root, 'inbox')) + path.sep;
      if (!filename.startsWith(inbox)) throw new Error('unsafe_image_path');
      const bytes = fs.readFileSync(filename);
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('image_size_limit');
      const mimeType = sniffImage(bytes);
      const mediaId = typeof a.mediaId === 'string' ? a.mediaId : createHash('sha256').update(bytes).digest('hex');
      if (seen.has(mediaId)) continue;
      seen.add(mediaId);
      if (sources.length >= 20) throw new Error('image_burst_limit');
      sources.push({
        mediaId,
        messageId: row.id,
        timestamp: row.timestamp,
        sender: typeof c.sender === 'string' ? c.sender : '',
        mimeType,
        localPath: filename,
        caption: typeof c.text === 'string' ? c.text : '',
        quoted,
      });
    }
  }
}
export function sniffImage(bytes: Buffer): string {
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new Error('unsupported_image_format');
}

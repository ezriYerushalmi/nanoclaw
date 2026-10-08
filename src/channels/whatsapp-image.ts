import { randomUUID } from 'node:crypto';
export interface WhatsAppImageAttachment {
  type: 'image';
  name: string;
  mimeType: string;
  mediaId: string;
  sourceMessageId: string | null;
  data: string;
}
/** Uses the native inline-attachment transport into each session inbox. */
export function imageAttachment(bytes: Buffer, sourceMessageId: string | null): WhatsAppImageAttachment {
  let mimeType: string;
  let ext: string;
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    mimeType = 'image/jpeg';
    ext = 'jpg';
  } else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    mimeType = 'image/png';
    ext = 'png';
  } else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    mimeType = 'image/webp';
    ext = 'webp';
  } else throw new Error('unsupported_whatsapp_image_format');
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('whatsapp_image_size_limit');
  const mediaId = randomUUID();
  return {
    type: 'image',
    name: `${mediaId}.${ext}`,
    mediaId,
    mimeType,
    sourceMessageId,
    data: bytes.toString('base64'),
  };
}

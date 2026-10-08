import { expect, it } from 'vitest';
import { imageAttachment } from './whatsapp-image.js';
it('transports image bytes and MIME through native inbox staging without user filenames', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const a = imageAttachment(png, 'synthetic-message');
  const b = imageAttachment(png, 'synthetic-message');
  expect(a.mimeType).toBe('image/png');
  expect(a.sourceMessageId).toBe('synthetic-message');
  expect(a.name).not.toBe(b.name);
  expect(Buffer.from(a.data, 'base64')).toEqual(png);
  expect(a.name).toMatch(/^[\da-f-]+\.png$/);
});
it('rejects unsupported media rather than labelling arbitrary bytes as JPEG', () => {
  expect(() => imageAttachment(Buffer.from('not an image'), null)).toThrow('unsupported');
});

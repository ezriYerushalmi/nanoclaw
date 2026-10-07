import { expect, it, vi } from 'vitest';
import { sendWhatsAppText } from './whatsapp-text.js';
const socket = () => ({
  sendMessage: vi.fn().mockResolvedValue({ key: { id: 'new' } }),
  sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
});
it('composes immediately before native text send, with no notification flags', async () => {
  const sock = socket();
  await sendWhatsAppText(sock, 'group@g.us', 'Answer', undefined, true);
  expect(sock.sendPresenceUpdate).toHaveBeenCalledWith('composing', 'group@g.us');
  expect(sock.sendMessage).toHaveBeenCalledWith('group@g.us', { text: 'Answer' });
  expect(sock.sendPresenceUpdate.mock.invocationCallOrder[0]).toBeLessThan(
    sock.sendMessage.mock.invocationCallOrder[0],
  );
});
it('native unconfigured text retains its presence behavior', async () => {
  const sock = socket();
  await sendWhatsAppText(sock, 'other@g.us', 'Native');
  expect(sock.sendPresenceUpdate).not.toHaveBeenCalled();
});
it('presence failure does not prevent normal text delivery', async () => {
  const sock = socket();
  sock.sendPresenceUpdate.mockRejectedValue(new Error('presence unavailable'));
  await sendWhatsAppText(sock, 'group@g.us', 'Answer', undefined, true);
  expect(sock.sendMessage).toHaveBeenCalledTimes(1);
});

import { describe, expect, it, vi } from 'vitest';
import { whatsappReactionEmoji, whatsappReactionKey, sendWhatsAppReaction } from './whatsapp-reaction.js';

describe('WhatsApp reactions', () => {
  it('converts tool shortcodes and preserves Unicode reactions', () => {
    expect(whatsappReactionEmoji('small_red_triangle')).toBe('🔺');
    expect(whatsappReactionEmoji(':heart:')).toBe('❤️');
    for (const emoji of ['🔺', '⭕', '⬜', '🍎']) expect(whatsappReactionEmoji(emoji)).toBe(emoji);
    expect(() => whatsappReactionEmoji('unknown_reaction')).toThrow('Unsupported');
  });

  it('removes the agent suffix and preserves the original group participant and addressing', () => {
    const key = { remoteJid: '123@g.us', id: 'ABC', participant: '456@lid', fromMe: false };
    expect(whatsappReactionKey('123@g.us', 'ABC:ag-health', key)).toEqual(key);
    expect(whatsappReactionKey('456@s.whatsapp.net', 'ABC:ag-health')).toEqual({
      remoteJid: '456@s.whatsapp.net',
      id: 'ABC',
      fromMe: false,
    });
    expect(() => whatsappReactionKey('123@g.us', 'ABC:ag-health')).toThrow('unavailable');
  });
});

it('sends only a native reaction, with no typing and no extra text', async () => {
  const sock = { sendMessage: vi.fn().mockResolvedValue(undefined), sendPresenceUpdate: vi.fn() };
  await sendWhatsAppReaction(sock, 'group@g.us', 'LAST:ag-coach', '💧', {
    remoteJid: 'group@g.us',
    id: 'LAST',
    participant: 'owner@lid',
    fromMe: false,
  });
  expect(sock.sendPresenceUpdate).not.toHaveBeenCalled();
  expect(sock.sendMessage).toHaveBeenCalledTimes(1);
  expect(sock.sendMessage).toHaveBeenCalledWith('group@g.us', {
    react: { text: '💧', key: { remoteJid: 'group@g.us', id: 'LAST', participant: 'owner@lid', fromMe: false } },
  });
});

import type { WAMessageKey, WASocket } from '@whiskeysockets/baileys';
import { defaultEmojiResolver } from 'chat';

const REACTION_ALIASES: Readonly<Record<string, string>> = {
  small_red_triangle: '🔺',
  red_circle: '🔴',
  hollow_red_circle: '⭕',
  white_large_square: '⬜',
  apple: '🍎',
};

export function whatsappReactionEmoji(value: string): string {
  const name = value.replace(/^:|:$/g, '');
  const emoji = REACTION_ALIASES[name] ?? defaultEmojiResolver.toGChat(name);
  if (!/\p{Extended_Pictographic}/u.test(emoji)) {
    throw new Error(`Unsupported WhatsApp reaction emoji: ${name}`);
  }
  return emoji;
}

export function whatsappReactionKey(platformId: string, messageId: string, original?: WAMessageKey): WAMessageKey {
  const id = messageId.replace(/:ag-[^:]+$/, '');
  if (original) return { ...original, id };
  if (platformId.endsWith('@g.us')) {
    throw new Error('Original WhatsApp group message key is unavailable; react to a new message');
  }
  return { remoteJid: platformId, id, fromMe: false };
}

export function whatsappMessageId(messageId: string): string {
  return messageId.replace(/:ag-[^:]+$/, '');
}

/** A reaction never enters the composing/text path. */
export function sendWhatsAppReaction(
  sock: Pick<WASocket, 'sendMessage'>,
  platformId: string,
  messageId: string,
  emoji: string,
  original?: WAMessageKey,
) {
  return sock.sendMessage(platformId, {
    react: { text: whatsappReactionEmoji(emoji), key: whatsappReactionKey(platformId, messageId, original) },
  });
}

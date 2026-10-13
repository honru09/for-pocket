const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
export const REACTION_EMOJIS = [
  '❤️', '😀', '🥰', '😘', '💕', '🤗', '😊', '😎', '🤭', '😂', '🥹', '😍',
  '😚', '😋', '😛', '🤪', '😇', '🫠', '🤩', '🥳', '😏', '🙃', '😉', '😌',
  '😴', '🥱', '😮', '😳', '🥺', '😭', '😤', '😶‍🌫️', '🫣', '🤔', '🙄', '🤫',
  '🫶', '💛', '💗', '💌', '💋', '👍', '👌', '✌️', '🤞', '👏', '🙌', '💪',
  '🐱', '🐶', '🐻', '🐼', '🐰', '🐹', '🐥', '🦊', '🐸', '🐣', '🦋', '🐾',
  '🧀', '🍜', '☕', '🍰', '🍓', '🍒', '🍑', '🍙', '🍣', '🍔', '🍟', '🧋',
  '🌷', '🌻', '🌸', '🍀', '🌈', '☀️', '🌙', '☁️', '🎈', '🎁', '🎉', '🧸',
];

const EMOJI_DIGITS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
export function formatReactionCount(value) {
  const count = Math.floor(Number(value));
  if (!Number.isSafeInteger(count) || count < 2) return '';
  return `✖️${count === 10 ? '🔟' : String(count).split('').map(digit => EMOJI_DIGITS[Number(digit)]).join('')}`;
}

export function normalizeReactionEmoji(value) {
  if (typeof value !== 'string') return null;
  const emoji = value.trim();
  if (!emoji || emoji.length > 64 || [...segmenter.segment(emoji)].length !== 1) return null;
  if (!/[\p{Extended_Pictographic}\p{Regional_Indicator}]|[0-9#*]\uFE0F?\u20E3/u.test(emoji)) return null;
  if (emoji.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\p{Emoji_Modifier}\u200D\uFE0F\uFE0E\u20E3#*0-9]/gu, '')) return null;
  return emoji;
}

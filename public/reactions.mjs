const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
export const REACTION_EMOJIS = ['❤️', '😀', '🥰', '😘', '💕', '🤗', '😊', '😎', '😴', '🤭', '🍜', '☕', '🍰', '🌷', '🐱', '🧀'];

export function normalizeReactionEmoji(value) {
  if (typeof value !== 'string') return null;
  const emoji = value.trim();
  if (!emoji || emoji.length > 64 || [...segmenter.segment(emoji)].length !== 1) return null;
  if (!/[\p{Extended_Pictographic}\p{Regional_Indicator}]|[0-9#*]\uFE0F?\u20E3/u.test(emoji)) return null;
  if (emoji.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\p{Emoji_Modifier}\u200D\uFE0F\uFE0E\u20E3#*0-9]/gu, '')) return null;
  return emoji;
}

import { normalizeReactionEmoji } from './public/reactions.mjs';
import { REACTION_BURST_GAP_MS, REACTION_NOTIFICATION_DELAY_MS } from './reaction-notifications.mjs';

const MAX_REACTIONS = 1000, TTL = 7 * 86400000;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(value);

function burstFields(circle, item) {
  const burst = (circle.reactionBursts || []).find(value => value.id === item.burstId);
  return {
    burstId: burst?.id || item.id,
    burstIndex: Number(item.burstIndex) || 1,
    burstCount: Number(burst?.count) || 1,
    burstLastAt: burst?.lastAt ?? item.createdAt,
  };
}

export function handleCircleReactions(db, circle, uid, route, method, body, now, limit, fail) {
  if (!circle || !circle.members.includes(uid)) fail('errorMembership', 403);
  if (body.circleId && body.circleId !== circle.id) fail('errorLedgerChanged', 409);
  circle.reactions = (circle.reactions || []).filter(item => item.createdAt > now - TTL);
  circle.reactionBursts = (circle.reactionBursts || []).filter(item => item.lastAt > now - TTL);
  if (method === 'GET' && route === '/circles/reactions') {
    const pending = circle.reactions.filter(item => item.to === uid && !item.seenAt && circle.members.includes(item.from));
    return { circleId: circle.id, items: pending.slice(0, 40).map(item => ({
      id: item.id, emoji: item.emoji, createdAt: item.createdAt, ...burstFields(circle, item),
      sender: { id: `u_${item.from}`, name: db.users[item.from]?.name || '', color: db.users[item.from]?.color || 'yellow', avatar: db.users[item.from]?.avatar || 'cloud' },
    })), hasMore: pending.length > 40 };
  }
  if (method === 'POST' && route === '/circles/reactions/ack') {
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 40 || body.ids.some(id => !validId(id))) fail('errorReaction');
    const ids = new Set(body.ids);
    for (const item of circle.reactions) if (item.to === uid && ids.has(item.id)) item.seenAt = now;
    return { ok: true, circleId: circle.id };
  }
  if (method === 'POST' && route === '/circles/reactions') {
    const emoji = normalizeReactionEmoji(body.emoji);
    if (!validId(body.id) || !emoji) fail('errorReaction');
    const recipient = circle.members.find(id => `u_${id}` === body.recipientId);
    if (!recipient || recipient === uid) fail('errorMembership', 403);
    const existing = circle.reactions.find(item => item.id === body.id);
    if (existing) {
      if (existing.from !== uid || existing.to !== recipient || existing.emoji !== emoji) fail('errorReaction', 409);
      return { ok: true, id: existing.id, circleId: circle.id, ...burstFields(circle, existing) };
    }
    limit?.(`reaction:${uid}`, 180);
    if (circle.reactions.length >= MAX_REACTIONS) {
      const delivered = circle.reactions.findIndex(item => item.seenAt);
      if (delivered < 0) fail('errorCapacity', 409);
      circle.reactions.splice(delivered, 1);
    }
    // Only the most recent emoji sent by this pair can continue a burst. A
    // different emoji breaks the chain even when the earlier emoji returns.
    const previous = circle.reactionBursts.findLast(item => item.from === uid && item.to === recipient);
    let burst = previous && previous.emoji === emoji && now >= previous.lastAt && now - previous.lastAt <= REACTION_BURST_GAP_MS
      && !['sent', 'skipped'].includes(previous.notification?.status) ? previous : null;
    if (!burst) {
      burst = { id: body.id, from: uid, to: recipient, emoji, count: 0, firstAt: now, lastAt: now, dueAt: now + REACTION_NOTIFICATION_DELAY_MS, notification: { status: 'pending' } };
      circle.reactionBursts.push(burst);
    }
    burst.count++;
    burst.lastAt = now;
    burst.dueAt = now + REACTION_NOTIFICATION_DELAY_MS;
    const item = { id: body.id, from: uid, to: recipient, emoji, createdAt: now, burstId: burst.id, burstIndex: burst.count };
    circle.reactions.push(item);
    return { ok: true, id: body.id, circleId: circle.id, ...burstFields(circle, item) };
  }
  fail('errorNotFound', 404);
}

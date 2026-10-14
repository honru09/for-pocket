import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPushCleanupService } from '../push-cleanup.mjs';

const sameDay = Date.parse('2026-10-14T00:30:00.000Z');
const afterMidnightTokyo = Date.parse('2026-10-14T15:05:00.000Z');

function fixture() {
  const db = {
    users: { u1: { id: 'u1', settings: { timezone: 'Asia/Tokyo' } } },
    identities: { 'telegram:101': 'u1' },
    ledgers: { l1: { settings: { timezone: 'Asia/Tokyo' } } },
    cron: {
      digestDeliveries: {
        digest: { status: 'sent', uid: 'u1', ledgerId: 'l1', timezone: 'Asia/Tokyo', chatId: '101', messageId: 11, sentAt: sameDay },
      },
      missingEntryReminders: {
        reminder: { status: 'sent', uid: 'u1', timezone: 'Asia/Tokyo', chatId: '101', messageId: 12, sentAt: sameDay },
      },
    },
    telegram: { expenseMessages: { unrelated: { chatId: '101', messageId: 13, sentAt: sameDay } } },
  };
  const calls = [];
  const store = { async run(fn) { return fn(db); }, async flush() {} };
  const service = createPushCleanupService({ store, now: () => afterMidnightTokyo, callTelegram: async (method, params) => { calls.push({ method, params }); return true; } });
  return { db, calls, service };
}

test('midnight cleanup deletes only known scheduled digest and reminder messages', async () => {
  const f = fixture();
  const result = await f.service.tick({ at: afterMidnightTokyo });
  assert.equal(result.deleted, 2);
  assert.deepEqual(f.calls.map(item => item.method), ['deleteMessage', 'deleteMessage']);
  assert.deepEqual(f.calls.map(item => item.params.message_id), [11, 12]);
  assert.equal(f.db.telegram.expenseMessages.unrelated.messageId, 13);
  assert.equal(f.db.cron.digestDeliveries.digest.status, 'sent');
  assert.equal(f.db.cron.digestDeliveries.digest.cleanup.status, 'deleted');
});

test('same local date is left alone and cleanup is idempotent', async () => {
  const f = fixture();
  const result = await f.service.tick({ at: sameDay + 30 * 60 * 1000 });
  assert.equal(result.deleted, 0);
  assert.equal(f.calls.length, 0);
  const later = await f.service.tick({ at: afterMidnightTokyo });
  assert.equal(later.deleted, 2);
  assert.equal((await f.service.tick({ at: afterMidnightTokyo + 1000 })).deleted, 0);
  assert.equal(f.calls.length, 2);
});

test('messages older than Telegram deletion window become terminal instead of retrying forever', async () => {
  const f = fixture();
  const old = sameDay - 49 * 60 * 60 * 1000;
  f.db.cron.digestDeliveries.digest.sentAt = old;
  const result = await f.service.tick({ at: afterMidnightTokyo });
  assert.equal(result.expired, 1);
  assert.equal(f.calls.some(item => item.params.message_id === 11), false);
  assert.equal(f.db.cron.digestDeliveries.digest.cleanup.status, 'expired');
});

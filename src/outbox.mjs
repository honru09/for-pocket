// Durable outbox for recorded entries. A saved entry is written here
// synchronously before any network request runs, so closing the Mini App,
// losing connectivity or killing the WebView can never lose it. Entries
// leave the outbox only when the server confirms them (or a fresh profile
// shows the same ID), and retryable failures are re-sent automatically on
// boot, on reconnect and when the app returns to the foreground.
export const OUTBOX_KEY = 'for-pocket.unconfirmed.v1';

const storageFor = storage => {
  try { return storage ?? globalThis.localStorage; } catch { return null; }
};

export function writeOutbox(writes, storage) {
  try {
    const store = storageFor(storage);
    if (!store) return;
    const list = [...writes].map(({ scope, payload, optimistic }) => ({ scope, payload, optimistic }));
    if (!list.length) store.removeItem(OUTBOX_KEY);
    else store.setItem(OUTBOX_KEY, JSON.stringify(list));
  } catch {}
}

export function readOutbox(storage) {
  try {
    const restored = JSON.parse(storageFor(storage)?.getItem(OUTBOX_KEY) || '[]');
    if (!Array.isArray(restored)) return [];
    return restored.filter(write => write?.payload?.id && write.optimistic?.id === write.payload.id && typeof write.scope === 'string');
  } catch { return []; }
}

// Only transient failures are retried automatically. A permanent rejection
// (deleted record, full ledger, wrong ledger, other 4xx) stays visible for
// a manual decision instead of looping forever in the background.
export function isRetryableWriteError(error) {
  const message = error?.message || '';
  if (['errorDeleted', 'errorCapacity', 'errorLedgerChanged'].includes(message)) return false;
  const status = error?.status;
  if (Number.isFinite(status) && status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
  return true;
}

export function nextRetryDelay(attempt) {
  const step = Math.max(0, Math.min(4, Math.floor(attempt) || 0));
  return 5000 * 2 ** step;
}

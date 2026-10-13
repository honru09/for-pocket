// Small client-side outbox for circle reactions.
//
// A tap should feel instant, while the request itself is allowed to catch up
// in the background.  Sending every tap at once used to make a temporary
// network hiccup look like dozens of failed reactions.  This outbox keeps a
// small number of requests in flight, retries only transient failures, and
// preserves the original id so the server's idempotency check can safely
// absorb a duplicated request.

export const REACTION_SEND_CONCURRENCY = 4;
export const REACTION_SEND_MAX_RETRIES = 3;

const transientStatuses = new Set([408, 425, 429]);

export function isReactionSendRetryable(error) {
  const status = Number(error?.status);
  // The service uses an error without a status for fetch failures/timeouts.
  if (!Number.isFinite(status)) return true;
  return transientStatuses.has(status) || status >= 500;
}

const defaultRetryDelay = attempt => Math.min(8000, 350 * (2 ** Math.max(0, attempt - 1)));

/**
 * Create a tiny durable-in-memory sender.
 *
 * `onSuccess` and `onFailure` are called once for a terminal attempt.  A
 * failed entry remains addressable by id so a visible Retry action can put it
 * back in the queue without creating a second reaction id.
 */
export function createReactionSendQueue({
  send,
  onSuccess = () => {},
  onFailure = () => {},
  concurrency = REACTION_SEND_CONCURRENCY,
  maxRetries = REACTION_SEND_MAX_RETRIES,
  retryDelay = defaultRetryDelay,
} = {}) {
  if (typeof send !== 'function') throw new TypeError('Reaction sender requires send');
  const limit = Math.max(1, Math.floor(Number(concurrency) || REACTION_SEND_CONCURRENCY));
  const retries = Math.max(0, Math.floor(Number(maxRetries) || 0));
  const waiting = [];
  const entries = new Map();
  let active = 0;
  let closed = false;

  const settle = (entry, result) => {
    const resolve = entry.resolve;
    entry.resolve = null;
    resolve?.(result);
  };

  const pump = () => {
    if (closed) return;
    while (active < limit && waiting.length) {
      const entry = waiting.shift();
      if (!entry || entry.status !== 'queued') continue;
      active += 1;
      entry.status = 'sending';
      entry.attempt += 1;
      Promise.resolve()
        .then(() => send(entry.payload))
        .then(result => {
          if (closed || entry.status === 'cancelled') return;
          entry.status = 'sent';
          entries.delete(entry.id);
          try { onSuccess(entry.payload, result); } catch {}
          settle(entry, { ok: true, result });
        })
        .catch(error => {
          if (closed || entry.status === 'cancelled') return;
          if (isReactionSendRetryable(error) && entry.attempt <= retries) {
            entry.status = 'retry-wait';
            let delay;
            try { delay = Number(retryDelay(entry.attempt, error)); } catch { delay = NaN; }
            if (!Number.isFinite(delay) || delay < 0) delay = defaultRetryDelay(entry.attempt);
            entry.timer = setTimeout(() => {
              entry.timer = null;
              if (closed || entry.status !== 'retry-wait') return;
              entry.status = 'queued';
              waiting.push(entry);
              pump();
            }, delay);
            return;
          }
          entry.status = 'failed';
          try { onFailure(entry.payload, error); } catch {}
          settle(entry, { ok: false, error });
        })
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  const makePromise = entry => new Promise(resolve => { entry.resolve = resolve; });

  function enqueue(payload) {
    const id = String(payload?.id || '');
    if (!id || closed) return Promise.resolve({ ok: false, closed: true });
    const existing = entries.get(id);
    if (existing) return existing.promise;
    const entry = { id, payload, attempt: 0, status: 'queued', timer: null, resolve: null };
    entry.promise = makePromise(entry);
    entries.set(id, entry);
    waiting.push(entry);
    pump();
    return entry.promise;
  }

  function retry(idOrPayload) {
    const id = typeof idOrPayload === 'string' ? idOrPayload : String(idOrPayload?.id || '');
    const entry = entries.get(id);
    if (!entry || entry.status !== 'failed' || closed) return false;
    entry.attempt = 0;
    entry.status = 'queued';
    entry.promise = makePromise(entry);
    waiting.push(entry);
    pump();
    return true;
  }

  function close() {
    if (closed) return;
    closed = true;
    for (const entry of entries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      entry.status = 'cancelled';
      settle(entry, { ok: false, closed: true });
    }
    waiting.length = 0;
  }

  return {
    enqueue,
    retry,
    close,
    get size() { return entries.size; },
    get failed() { return [...entries.values()].filter(entry => entry.status === 'failed').map(entry => entry.payload); },
    get pending() { return [...entries.values()].filter(entry => ['queued', 'sending', 'retry-wait'].includes(entry.status)).map(entry => entry.payload); },
  };
}

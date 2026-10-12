// Per-entry queues keep delete → undo → delete in order without blocking UI.
// The latest optimistic snapshot also protects against stale profile responses.
export function createEntryMutations({ publish, failed, changed = () => {} }) {
  const queues = new Map(), pending = new Map();
  return {
    pending,
    enqueue(operation) {
      const { key, optimistic, fallback, request } = operation;
      const queue = queues.get(key) || { tail: Promise.resolve(), confirmed: fallback, count: 0 };
      queues.set(key, queue);
      queue.count++;
      pending.set(key, operation);
      publish(operation, optimistic);
      changed();
      const job = queue.tail.then(async () => {
        try {
          const result = await request();
          queue.confirmed = result?.deletedAt ? null : result;
          if (pending.get(key) === operation) publish(operation, queue.confirmed);
        } catch (error) {
          if (pending.get(key) === operation) {
            publish(operation, queue.confirmed);
            failed(operation, error);
          }
        } finally {
          if (pending.get(key) === operation) pending.delete(key);
          queue.count--;
          if (!queue.count) queues.delete(key);
          changed();
        }
      });
      queue.tail = job.catch(() => {});
      return job;
    },
  };
}

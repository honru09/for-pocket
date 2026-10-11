// Only foreground transitions, never a polling timer or a location watch.
export function bindForegroundRefresh({ document:doc = globalThis.document, window:win = globalThis.window, telegram, refresh, now = Date.now } = {}) {
  let last = -Infinity;
  const run = () => {
    if (doc?.hidden || now() - last < 750) return;
    last = now();
    void refresh();
  };
  const visible = () => { if (!doc?.hidden) { last = -Infinity; run(); } };
  doc?.addEventListener('visibilitychange', visible);
  win?.addEventListener('focus', run);
  win?.addEventListener('pageshow', run);
  telegram?.onEvent?.('activated', run);
  return () => {
    doc?.removeEventListener('visibilitychange', visible);
    win?.removeEventListener('focus', run);
    win?.removeEventListener('pageshow', run);
    telegram?.offEvent?.('activated', run);
  };
}

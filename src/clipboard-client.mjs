// Safari presents a native Paste menu for readText() without a persistent
// grant. Navigation must never trigger that UI or consume the user's tap.
export async function readClipboardQuietly(nav = globalThis.navigator) {
  if (!nav?.clipboard?.readText || !nav?.permissions?.query) return '';
  try {
    const permission = await nav.permissions.query({ name:'clipboard-read' });
    if (permission?.state !== 'granted') return '';
    return await nav.clipboard.readText();
  } catch { return ''; }
}

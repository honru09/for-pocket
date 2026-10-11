let sequence = 0;
const RECORD_ID = /^[a-zA-Z0-9_-]{8,64}$/;

// UI and expense record identifiers only. The last fallback is not suitable
// for authentication tokens, secrets, or other security-sensitive values.
export function createId() {
  let source;
  try { source = globalThis.crypto; } catch {}

  try {
    if (typeof source?.randomUUID === 'function') {
      const id = source.randomUUID();
      if (typeof id === 'string' && RECORD_ID.test(id)) return id;
    }
  } catch {}

  try {
    if (typeof source?.getRandomValues === 'function') {
      const bytes = source.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch {}

  sequence = sequence < Number.MAX_SAFE_INTEGER ? sequence + 1 : 1;
  const random = () => Math.random().toString(36).slice(2, 12) || '0';
  return `fp_${Date.now().toString(36)}_${sequence.toString(36)}_${random()}${random()}`;
}

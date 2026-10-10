import React, { useState } from 'react';
import { Button, Input } from '@telegram-apps/telegram-ui';
import { Sheet } from './AccountViews.jsx';

export function localDateTime(value) {
  const d = new Date(value || Date.now());
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TimeEditor({ value, t, busy, onSave, onClose, isDraft }) {
  const [input, setInput] = useState(() => localDateTime(value));
  return <Sheet title={t('entryTime')} onClose={onClose}><form className="time-form" onSubmit={e => { e.preventDefault(); const time = new Date(input); if (Number.isFinite(time.getTime())) onSave(time.toISOString()); }}><Input type="datetime-local" id="entry-time-input" className="settings-input time-input" aria-label={t('entryTime')} min="1970-01-01T00:00" max="2100-12-31T23:59" step="60" value={input} onChange={e => setInput(e.target.value)} required disabled={busy}/><div className="sheet-actions"><Button type="button" mode="plain" disabled={busy} onClick={() => onSave(isDraft ? null : new Date().toISOString())}>{t('useNow')}</Button><Button type="submit" disabled={busy || !input}>{t('confirm')}</Button></div></form></Sheet>;
}

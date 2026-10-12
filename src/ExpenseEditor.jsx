import React, { useState } from 'react';
import { Button } from '@telegram-apps/telegram-ui';
import { Sheet } from './AccountViews.jsx';
import { CURRENCIES } from '../public/shared.mjs';
import { categoryDisplayLabel } from '../public/i18n.mjs';

export default function ExpenseEditor({ entry, settings, t, onClose, onSave }) {
  const [draft, setDraft] = useState({ amount: String(entry.amountMinor / 10 ** CURRENCIES[entry.currency].digits), currency:entry.currency, categoryId:entry.categoryId, consumer:entry.consumer, note:entry.note || '' });
  const [error, setError] = useState('');
  const pool = entry.type === 'income' ? settings.incomeCategories : settings.categories;
  const categories = pool.some(c => c.id === entry.categoryId) ? pool : [...pool, entry.category];
  const consumers = settings.consumers.some(c => c.id === entry.consumer) ? settings.consumers : [...settings.consumers, entry.member || { id:entry.consumer, name:t('unknownConsumer') }];
  const change = patch => { setError(''); setDraft(current => ({ ...current, ...patch })); };
  const submit = event => {
    event.preventDefault();
    const digits = CURRENCIES[draft.currency].digits;
    const raw = draft.amount.trim().replace(',', '.');
    const minor = Number(raw) * 10 ** digits;
    if (!/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(minor) || Math.abs(minor - Math.round(minor)) > 1e-6 || minor < 1 || minor > 10 ** (8 + digits) - 1) { setError(t('errorAmount')); return; }
    onSave({ amountMinor:Math.round(minor), currency:draft.currency, categoryId:draft.categoryId, consumer:draft.consumer, note:draft.note.trim() });
  };
  return <Sheet title={t('editEntry')} onClose={onClose}><form className="entry-editor" onSubmit={submit}>
    <label className="pocket-field"><span>{t('amountLabel')}</span><input id="edit-entry-amount" inputMode="decimal" autoComplete="off" value={draft.amount} onChange={e => change({ amount:e.target.value })} required/></label>
    <label className="pocket-field"><span>{t('currency')}</span><select value={draft.currency} onChange={e => change({ currency:e.target.value })}>{Object.keys(CURRENCIES).map(c => <option key={c}>{c}</option>)}</select></label>
    <label className="pocket-field"><span>{t('categories')}</span><select value={draft.categoryId} onChange={e => change({ categoryId:e.target.value })}>{categories.filter(Boolean).map(c => <option key={c.id} value={c.id}>{categoryDisplayLabel(c,settings.language)}</option>)}</select></label>
    <label className="pocket-field"><span>{t('aiImportConsumer')}</span><select value={draft.consumer} onChange={e => change({ consumer:e.target.value })}>{consumers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label className="pocket-field entry-editor-note"><span>{t('note')}</span><input id="edit-entry-note" value={draft.note} maxLength={160} onChange={e => change({ note:e.target.value })}/></label>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="sheet-actions"><Button type="submit" className="compact-save">{t('saveCategories')}</Button></div>
  </form></Sheet>;
}

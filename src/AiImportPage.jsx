import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Select, Tappable, Textarea } from '@telegram-apps/telegram-ui';
import { CURRENCIES, validateExpense } from '../public/shared.mjs';
import { categoryLabel, translateError } from '../public/i18n.mjs';
import { Icon } from './icons.jsx';
import { aiUiEnabled } from './ai-availability.mjs';
import './ai-import.css';

// Keep these keys together so the settings entry can add the same copy to
// public/i18n.mjs in Chinese, English, and Ukrainian without hunting through
// the component. The component deliberately keeps the import flow out of the
// quick-entry screen to preserve its one-glance layout.
export const AI_IMPORT_I18N_KEYS = [
  'aiImportTitle', 'aiImportIntro', 'aiImportTextLabel', 'aiImportTextPlaceholder',
  'aiImportImageLabel', 'aiImportChooseImage', 'aiImportReplaceImage',
  'aiImportImageReady', 'aiImportParse', 'aiImportParsing', 'aiImportNoSource',
  'aiImportNoResult', 'aiImportResults', 'aiImportConfidence', 'aiImportMerchant',
  'aiImportAmount', 'aiImportCurrency', 'aiImportType', 'aiImportExpense',
  'aiImportIncome', 'aiImportTime', 'aiImportCategory', 'aiImportConsumer',
  'aiImportNote', 'aiImportRemove', 'aiImportClear', 'aiImportSaveAll',
  'aiImportSaving', 'aiImportSaved', 'aiImportHint', 'aiImportUnavailable',
  'aiImportNeedLogin', 'aiImportInvalidItem', 'aiImportSelectedCount',
  'aiImportSplit', 'aiImportNoSplit', 'aiImportSplitEqual', 'aiImportSplitParticipants',
  'aiImportEnhanced', 'aiImportEnhancedHint', 'aiImportEnhancing', 'aiImportReview',
];

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const idFor = () => globalThis.crypto?.randomUUID?.() || `import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const normalizeText = value => String(value ?? '').trim().toLocaleLowerCase();
const numericText = value => String(value ?? '').replace(/[^\d.,-]/g, '').replace(',', '.');

function majorFromMinor(minor, currency) {
  const digits = CURRENCIES[currency]?.digits ?? 0;
  const value = Number(minor);
  if (!Number.isFinite(value)) return '';
  return (value / 10 ** digits).toFixed(digits).replace(/\.0+$|(?<=\.\d)0+$/g, '');
}

function amountMinor(value, currency) {
  const digits = CURRENCIES[currency]?.digits ?? 0;
  const raw = numericText(value);
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw)) return 0;
  const [whole, fraction = ''] = raw.split('.');
  if (fraction.length > digits) return 0;
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || 0);
  return Number.isSafeInteger(minor) ? minor : 0;
}

function toLocalInput(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return `${value}T12:00`;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function matchingCategory(raw, categories) {
  const categoryId = raw?.categoryId || raw?.category?.id;
  if (categoryId && categories.some(category => category.id === categoryId)) return categoryId;
  const hint = normalizeText(raw?.categoryHint || raw?.category || raw?.categoryLabel || raw?.purpose);
  if (!hint) return '';
  return categories.find(category => normalizeText(category.label) === hint || normalizeText(category.id) === hint)?.id || '';
}

function matchingConsumer(raw, consumers, fallback) {
  const id = raw?.consumer || raw?.consumerId;
  if (id && consumers.some(consumer => consumer.id === id)) return id;
  const hint = normalizeText(raw?.consumerName || raw?.memberName);
  if (hint) return consumers.find(consumer => normalizeText(consumer.name) === hint)?.id || '';
  return fallback || consumers[0]?.id || '';
}

function matchingParticipants(raw, consumers, fallback) {
  if (raw?.splitMode !== 'equal') return [];
  const values = Array.isArray(raw?.splitParticipants) ? raw.splitParticipants : [];
  const matched = values.map(value => {
    const id = typeof value === 'string' ? value : value?.id;
    if (id && consumers.some(consumer => consumer.id === id)) return id;
    const name = normalizeText(typeof value === 'string' ? value : value?.name);
    return consumers.find(consumer => normalizeText(consumer.name) === name)?.id || '';
  }).filter(Boolean);
  return [...new Set(matched.length ? matched : [fallback].filter(Boolean))];
}

function normalizeItem(raw, settings, profile) {
  const type = raw?.type === 'income' ? 'income' : 'expense';
  const currency = CURRENCIES[raw?.currency] ? raw.currency : settings.currency;
  const categories = type === 'income' ? settings.incomeCategories : settings.categories;
  const consumers = settings.consumers || [];
  const rawAmount = raw?.amountMinor !== undefined ? majorFromMinor(raw.amountMinor, currency) : numericText(raw?.amount ?? raw?.value);
  const occurredAt = raw?.occurredAt || raw?.datetime || raw?.dateTime || raw?.date || '';
  return {
    id: idFor(),
    type,
    amount: rawAmount,
    currency,
    occurredAt: toLocalInput(occurredAt),
    timezone: raw?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    categoryId: matchingCategory(raw, categories),
    consumer: matchingConsumer(raw, consumers, profile?.user?.id),
    splitMode: raw?.splitMode === 'equal' ? 'equal' : 'none',
    splitParticipants: matchingParticipants(raw, consumers, matchingConsumer(raw, consumers, profile?.user?.id)),
    merchant: String(raw?.merchant || raw?.store || '').trim(),
    note: String(raw?.note || '').trim(),
    confidence: raw?.confidence !== null && raw?.confidence !== undefined && Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : null,
    rawText: String(raw?.rawText || '').trim(),
  };
}

function resultItems(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.items)) return result.items;
  if (Array.isArray(result?.entries)) return result.entries;
  if (Array.isArray(result?.records)) return result.records;
  return [];
}

function sourceLabel(file, t) {
  if (!file) return '';
  const size = file.size < 1024 * 1024
    ? `${Math.max(1, Math.round(file.size / 1024))} KB`
    : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  return `${file.name || t('aiImportImageLabel')} · ${size}`;
}

export default function AiImportPage({ t, profile, settings, busy = false, run, service, onImported, isRemote = false, config = {}, onAccount }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [working, setWorking] = useState(false);
  const [operation, setOperation] = useState('');
  const [imageAttempted, setImageAttempted] = useState(false);
  const [expanded, setExpanded] = useState(new Set());
  const scope = `${profile?.user?.id || ''}:${profile?.ledgerId || ''}`;
  const [itemsScope, setItemsScope] = useState(scope);
  const inputRef = useRef(null), scopeRef = useRef(scope), operationRef = useRef(0), workingRef = useRef(false), mountedRef = useRef(true);
  scopeRef.current = scope;
  const consumers = settings?.consumers || [];
  const hasSource = Boolean(text.trim() || file);
  const aiEnabled = aiUiEnabled({ isRemote, config, service });
  const canParse = hasSource && aiEnabled && !working && !busy;

  const updateFile = next => {
    setError('');
    setStatus('');
    setWarnings([]);
    setItems([]);
    setItemsScope(scope);
    setImageAttempted(false);
    setExpanded(new Set());
    if (next && !IMAGE_TYPES.has(next.type)) {
      setError(t('errorAiInput'));
      setFile(null);
      return;
    }
    if (next && next.size > MAX_IMAGE_BYTES) {
      setError(t('errorTooLarge'));
      setFile(null);
      return;
    }
    setFile(next || null);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; operationRef.current++; };
  }, []);

  useEffect(() => {
    operationRef.current++;
    workingRef.current = false;
    setText(''); setFile(null); setItems([]); setItemsScope(scope);
    setExpanded(new Set()); setWarnings([]); setError(''); setStatus('');
    setWorking(false); setOperation(''); setImageAttempted(false);
    if (inputRef.current) inputRef.current.value = '';
  }, [scope]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const execute = async (callback, kind = '') => {
    if (workingRef.current || busy) return null;
    const requestScope = scope, requestId = ++operationRef.current;
    const current = () => mountedRef.current && scopeRef.current === requestScope && operationRef.current === requestId;
    workingRef.current = true;
    setWorking(true);
    setOperation(kind);
    setError('');
    setStatus('');
    try {
      // Catch inside run so the form can show actionable errors even when
      // the app-level operation wrapper converts rejected work to null.
      const operation = async () => {
        try { return await callback(); }
        catch (caught) {
          if (current()) setError(translateError(caught?.message || (kind === 'save' ? 'errorSave' : 'errorAiUnavailable'), settings.language));
          return null;
        }
      };
      const result = await (run ? run(operation) : operation());
      return current() ? result : null;
    } catch (caught) {
      if (current()) setError(translateError(caught?.message || 'errorAiUnavailable', settings.language));
      return null;
    } finally {
      if (current()) {
        workingRef.current = false;
        setWorking(false);
        setOperation('');
      }
    }
  };

  const parse = async (event, enhanced = false) => {
    event?.preventDefault?.();
    if (workingRef.current || busy || enhanced && !file) return;
    if (!hasSource) {
      setError(t('aiImportNoSource'));
      return;
    }
    if (!isRemote) {
      setError(t('aiImportNeedLogin'));
      return;
    }
    if (!aiEnabled) {
      setError(t('aiImportUnavailable'));
      return;
    }
    if (typeof service?.aiParseExpense !== 'function') {
      setError(t('aiImportUnavailable'));
      return;
    }
    const requestScope = scope;
    const result = await execute(() => service.aiParseExpense({
      text: text.trim(),
      file,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ledgerId: profile?.ledgerId,
      enhanced,
    }), enhanced ? 'enhanced' : 'parse');
    if (!mountedRef.current || scopeRef.current !== requestScope) return;
    if (file) setImageAttempted(true);
    if (!result) return;
    const parsed = resultItems(result).map(item => normalizeItem(item, settings, profile));
    setItems(parsed);
    setItemsScope(requestScope);
    setWarnings(Array.isArray(result?.warnings) ? result.warnings.filter(Boolean).slice(0, 8) : []);
    setExpanded(new Set(parsed.length ? [parsed[0].id] : []));
    if (!parsed.length) setError(t('aiImportNoResult'));
  };

  const categoriesFor = item => item.type === 'income' ? (settings?.incomeCategories || []) : (settings?.categories || []);
  const updateItem = (id, patch) => setItems(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  const toggleExpanded = id => setExpanded(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleParticipant = (item, participantId) => {
    const current = item.splitParticipants || [];
    const next = current.includes(participantId) ? current.filter(id => id !== participantId) : [...current, participantId];
    if (!next.length) return;
    updateItem(item.id, { splitParticipants: next });
  };
  const removeItem = id => {
    setItems(current => current.filter(item => item.id !== id));
    setExpanded(current => { const next = new Set(current); next.delete(id); return next; });
  };

  const payloadFor = item => {
    if (itemsScope !== scopeRef.current) return null;
    const currency = CURRENCIES[item.currency] ? item.currency : settings.currency;
    const category = categoriesFor(item).find(candidate => candidate.id === item.categoryId);
    const consumer = consumers.find(candidate => candidate.id === item.consumer);
    const minor = amountMinor(item.amount, currency);
    if (!minor || !category || !consumer || !item.occurredAt || !toIso(item.occurredAt)) return null;
    const merchant = item.merchant.trim(), note = item.note.trim();
    const mergedNote = merchant && !normalizeText(note).includes(normalizeText(merchant)) ? [merchant, note].filter(Boolean).join(' · ') : note || merchant;
    const payload = {
      id: item.id,
      type: item.type,
      amountMinor: minor,
      currency,
      categoryId: category.id,
      consumer: consumer.id,
      note: mergedNote.slice(0, 160),
      occurredAt: toIso(item.occurredAt),
      timezone: item.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      splitMode: item.type === 'expense' && item.splitMode === 'equal' ? 'equal' : 'none',
      splitParticipants: item.type === 'expense' && item.splitMode === 'equal' ? [...new Set(item.splitParticipants || [])] : [],
      ledgerId: profile?.ledgerId,
    };
    try { validateExpense(payload, settings); return payload; } catch { return null; }
  };

  const saveAll = async event => {
    event?.preventDefault?.();
    if (workingRef.current || busy || itemsScope !== scope) return;
    if (!items.length || !service?.addExpense && !service?.importExpenses) return;
    const payloads = items.map(payloadFor);
    if (payloads.some(payload => !payload)) {
      setError(t('aiImportInvalidItem'));
      return;
    }
    const result = await execute(async () => {
      if (typeof service.importExpenses === 'function') return service.importExpenses(payloads);
      const saved = [];
      for (const payload of payloads) {
        const entry = await service.addExpense(payload);
        if (entry) saved.push(entry);
      }
      return saved;
    }, 'save');
    if (!result) return;
    const saved = Array.isArray(result) ? result : result.entries || result.expenses || [];
    onImported?.(saved.length ? saved : result);
    setItems([]);
    setExpanded(new Set());
    setWarnings([]);
    setText('');
    updateFile(null);
    if (inputRef.current) inputRef.current.value = '';
    setStatus(t('aiImportSaved', { n: payloads.length }));
  };

  const clear = () => {
    if (working || busy) return;
    setText('');
    updateFile(null);
    setItems([]);
    setExpanded(new Set());
    setWarnings([]);
    setError('');
    setStatus('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const currentItems = itemsScope === scope ? items : [];

  return <section className="ai-import" aria-label={t('aiImportTitle')}>
    <div className="ai-import-intro">
      <p className="quiet-copy">{t('aiImportIntro')}</p>
      <p className="ai-import-hint"><Icon name="spark"/><span>{t('aiImportHint')}</span></p>
    </div>

    {!isRemote && <div className="ai-import-gate"><p>{t('aiImportNeedLogin')}</p><Button type="button" mode="outline" onClick={onAccount}>{t('signIn')}</Button></div>}
    {isRemote && !aiEnabled && <div className="ai-import-gate is-disabled"><p>{t('aiImportUnavailable')}</p></div>}

    <form className="ai-import-source" onSubmit={event => parse(event)}>
      <label className="ai-import-text-label" htmlFor="ai-import-text">{t('aiImportTextLabel')}</label>
      <Textarea id="ai-import-text" className="ai-import-text" rows={3} maxLength={4000} value={text} onChange={event => { setText(event.target.value); setError(''); }} placeholder={t('aiImportTextPlaceholder')} disabled={working || busy}/>
      <div className="ai-import-divider"><span>{t('aiImportImageLabel')}</span></div>
      <input ref={inputRef} className="ai-import-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => updateFile(event.target.files?.[0] || null)} disabled={working || busy}/>
      <div className="ai-import-file-row">
        {previewUrl ? <Tappable Component="button" type="button" className="ai-import-preview" aria-label={t('aiImportReplaceImage')} onClick={() => inputRef.current?.click()} disabled={working || busy}><img src={previewUrl} alt=""/><span>{sourceLabel(file, t)}</span></Tappable> : <Button type="button" mode="outline" className="ai-import-file-button" disabled={working || busy} onClick={() => inputRef.current?.click()}><Icon name="receipt"/><span>{t('aiImportChooseImage')}</span></Button>}
        {file && <span className="ai-import-file-ready">{t('aiImportImageReady')}</span>}
      </div>
      <div className="ai-import-actions">
        <Button type="submit" className="panel-primary" disabled={!canParse}>{operation === 'parse' ? t('aiImportParsing') : t('aiImportParse')}</Button>
        {(text || file || items.length) && <Button type="button" mode="plain" className="text-button" disabled={working || busy} onClick={clear}>{t('aiImportClear')}</Button>}
      </div>
      {file && imageAttempted && <div className="ai-import-enhanced"><span>{t('aiImportEnhancedHint')}</span><Button type="button" mode="plain" className="ai-import-enhanced-button" disabled={!canParse} onClick={event => parse(event, true)}><Icon name="spark"/>{operation === 'enhanced' ? t('aiImportEnhancing') : t('aiImportEnhanced')}</Button></div>}
    </form>

    {(status || error) && <div className={`ai-import-status ${error ? 'is-error' : ''}`} role="status"><span>{error || status}</span></div>}
    {warnings.length > 0 && <ul className="ai-import-warnings" aria-label={t('aiImportHint')}>{warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>}

    {currentItems.length > 0 && <form className="ai-import-results" onSubmit={saveAll}>
      <header className="ai-import-results-header"><h2>{t('aiImportResults', { n: currentItems.length })}</h2></header>
      <div className="ai-import-list">{currentItems.map((item, index) => {
        const category = categoriesFor(item).find(candidate => candidate.id === item.categoryId);
        const categoryName = category ? categoryLabel(category, settings.language) : t('aiImportCategory');
        const expandedItem = expanded.has(item.id);
        const needsReview = !item.occurredAt || !item.amount || !item.categoryId || !item.consumer || item.confidence !== null && item.confidence < 0.75;
        const splitEnabled = item.type === 'expense' && consumers.length > 1;
        const summary = [item.merchant || categoryName, item.amount ? `${item.amount} ${item.currency}` : '', item.occurredAt ? item.occurredAt.replace('T', ' ') : t('aiImportTime')].filter(Boolean).join(' · ');
        return <article className={`ai-import-item ${expandedItem ? 'is-expanded' : ''}`} key={item.id}>
          <header className="ai-import-item-header">
            <Tappable Component="button" type="button" className="ai-import-summary" aria-expanded={expandedItem} onClick={() => toggleExpanded(item.id)} disabled={working || busy}>
              <span className="ai-import-index">{index + 1}</span><span className="ai-import-summary-copy"><strong>{summary}</strong><small>{needsReview ? t('aiImportReview') : categoryName}</small></span><Icon name="chevronDown"/>
            </Tappable>
            <Button type="button" mode="plain" className="ai-import-remove" aria-label={t('aiImportRemove')} onClick={() => removeItem(item.id)} disabled={working || busy}>×</Button>
          </header>
          {expandedItem && <div className="ai-import-grid">
            <Input className="settings-input ai-import-field" header={t('aiImportMerchant')} aria-label={t('aiImportMerchant')} value={item.merchant} onChange={event => updateItem(item.id, { merchant: event.target.value })} disabled={working || busy}/>
            <Input className="settings-input ai-import-field" header={t('aiImportAmount')} aria-label={t('aiImportAmount')} inputMode="decimal" value={item.amount} onChange={event => updateItem(item.id, { amount: numericText(event.target.value) })} required disabled={working || busy}/>
            <Select className="editor-select ai-import-field" aria-label={t('aiImportCurrency')} value={item.currency} onChange={event => updateItem(item.id, { currency: event.target.value })} disabled={working || busy}>{Object.keys(CURRENCIES).map(currency => <option key={currency} value={currency}>{currency}</option>)}</Select>
            <Select className="editor-select ai-import-field" aria-label={t('aiImportType')} value={item.type} onChange={event => updateItem(item.id, { type: event.target.value, categoryId: '', splitMode: 'none', splitParticipants: [] })} disabled={working || busy}><option value="expense">{t('aiImportExpense')}</option><option value="income">{t('aiImportIncome')}</option></Select>
            <Input type="datetime-local" className={`settings-input ai-import-field ai-import-time ${!item.occurredAt ? 'is-missing' : ''}`} header={t('aiImportTime')} aria-label={t('aiImportTime')} value={item.occurredAt} onChange={event => updateItem(item.id, { occurredAt: event.target.value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })} required disabled={working || busy}/>
            <Select className={`editor-select ai-import-field ${!item.categoryId ? 'is-missing' : ''}`} aria-label={t('aiImportCategory')} value={item.categoryId} onChange={event => updateItem(item.id, { categoryId: event.target.value })} required disabled={working || busy}><option value="">{t('aiImportCategory')}</option>{categoriesFor(item).map(category => <option key={category.id} value={category.id}>{categoryLabel(category, settings.language)}</option>)}</Select>
            <Select className={`editor-select ai-import-field ${!item.consumer ? 'is-missing' : ''}`} aria-label={t('aiImportConsumer')} value={item.consumer} onChange={event => updateItem(item.id, { consumer: event.target.value })} required disabled={working || busy}><option value="">{t('aiImportConsumer')}</option>{consumers.map(consumer => <option key={consumer.id} value={consumer.id}>{consumer.name}</option>)}</Select>
            {splitEnabled && <div className="ai-import-split"><Select className="editor-select ai-import-field" aria-label={t('aiImportSplit')} value={item.splitMode} onChange={event => updateItem(item.id, { splitMode: event.target.value, splitParticipants: event.target.value === 'equal' ? (item.splitParticipants?.length ? item.splitParticipants : consumers.map(consumer => consumer.id)) : [] })} disabled={working || busy}><option value="none">{t('aiImportNoSplit')}</option><option value="equal">{t('aiImportSplitEqual')}</option></Select>{item.splitMode === 'equal' && <div className="ai-import-participants" role="group" aria-label={t('aiImportSplitParticipants')}>{consumers.map(consumer => <Tappable Component="button" type="button" key={consumer.id} className={`ai-import-participant ${item.splitParticipants?.includes(consumer.id) ? 'is-selected' : ''}`} aria-pressed={item.splitParticipants?.includes(consumer.id)} onClick={() => toggleParticipant(item, consumer.id)} disabled={working || busy}>{consumer.name}</Tappable>)}</div>}</div>}
            <Input className="settings-input ai-import-field ai-import-note" header={t('aiImportNote')} aria-label={t('aiImportNote')} maxLength={160} value={item.note} onChange={event => updateItem(item.id, { note: event.target.value })} disabled={working || busy}/>
          </div>}
          {expandedItem && item.rawText && <p className="ai-import-raw">{item.rawText}</p>}
        </article>;
      })}</div>
      <Button type="submit" className="panel-primary ai-import-save" disabled={working || busy || !items.length}>{operation === 'save' ? t('aiImportSaving') : t('aiImportSaveAll')}</Button>
    </form>}
  </section>;
}

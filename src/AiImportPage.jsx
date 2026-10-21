import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import PocketIllustration from './PocketIllustration.jsx';
import { Button, Input, Select, Tappable, Textarea } from '@telegram-apps/telegram-ui';
import { CURRENCIES, validateExpense } from '../public/shared.mjs';
import { categoryLabel, translateError } from '../public/i18n.mjs';
import { Icon } from './icons.jsx';
import { aiUiEnabled } from './ai-availability.mjs';
import { importDraftScope, readImportDraft, writeImportDraft, clearImportDraft, settleImportDraft, subscribeImportDraft } from './import-draft.mjs';
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
  'aiImportRecordKind', 'recordKindPurchase', 'recordKindTransfer', 'recordKindReimbursement',
  'recordKindRefund', 'recordKindGift', 'recordKindOther', 'aiImportReviewReason', 'aiImportBatchHint',
];

const IMPORT_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/csv', 'text/plain',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 8;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_IMPORT_TEXT = 12000;
const EXTENSION_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf',
  csv: 'text/csv', txt: 'text/plain', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
function fileMime(file) { const type = String(file?.type || '').toLowerCase(); if (IMPORT_TYPES.has(type)) return type; const extension = String(file?.name || '').split('.').pop()?.toLowerCase(); return EXTENSION_TYPES[extension] || type; }

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
    recordKind: ['purchase', 'transfer', 'reimbursement', 'refund', 'gift', 'other'].includes(raw?.recordKind) ? raw.recordKind : 'purchase',
    needsReview: Boolean(raw?.needsReview),
    reviewReason: String(raw?.reviewReason || '').trim(),
    sourceName: String(raw?.sourceName || '').trim(),
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

function fileTypeLabel(file) {
  const extension = String(file?.name || '').split('.').pop()?.toUpperCase();
  return extension || String(file?.type || '').split('/').pop()?.toUpperCase() || 'FILE';
}

export default function AiImportPage({ t, profile, settings, busy = false, run, service, onImported, isRemote = false, config = {}, onAccount }) {
  const scope = importDraftScope(profile);
  const [initialDraft] = useState(() => readImportDraft(scope, profile?.expenses));
  const [text, setText] = useState(initialDraft?.text || '');
  const [files, setFiles] = useState([]);
  const [missingFiles, setMissingFiles] = useState(initialDraft?.fileNames || []);
  const [previewUrls, setPreviewUrls] = useState({});
  const [items, setItems] = useState(initialDraft?.items || []);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState(initialDraft?.warnings || []);
  const [working, setWorking] = useState(false);
  const [operation, setOperation] = useState('');
  const [imageAttempted, setImageAttempted] = useState(false);
  const [expanded, setExpanded] = useState(new Set(initialDraft?.items?.[0] ? [initialDraft.items[0].id] : []));
  const [itemsScope, setItemsScope] = useState(scope);
  const inputRef = useRef(null), scopeRef = useRef(scope), operationRef = useRef(0), workingRef = useRef(false), mountedRef = useRef(true);
  scopeRef.current = scope;
  const consumers = settings?.consumers || [];
  const hasSource = Boolean(text.trim() || files.length);
  const aiEnabled = aiUiEnabled({ isRemote, config, service });
  const canParse = hasSource && aiEnabled && !working && !busy;

  const updateFiles = nextList => {
    const next = Array.from(nextList || []);
    setError('');
    setStatus('');
    setWarnings([]);
    setItems([]);
    setItemsScope(scope);
    setMissingFiles([]);
    setImageAttempted(false);
    setExpanded(new Set());
    const rejected = next.filter(file => !IMPORT_TYPES.has(fileMime(file)) || file.size > MAX_FILE_BYTES);
    const valid = next.filter(file => !rejected.includes(file));
    setWarnings(rejected.map(file => ({ name: file.name, code: file.size > MAX_FILE_BYTES ? 'errorTooLarge' : 'errorFileType' })));
    if (valid.length > MAX_FILES) { setError(t('errorImportFileCount')); return; }
    if (valid.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) { setError(t('errorImportTotalSize')); return; }
    setFiles(valid);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; operationRef.current++; };
  }, []);

  useLayoutEffect(() => {
    operationRef.current++;
    workingRef.current = false;
    setWorking(false); setOperation(''); setImageAttempted(false);
    const restore = () => {
      const draft = readImportDraft(scope, profile?.expenses);
      setText(draft?.text || ''); setFiles([]); setMissingFiles(draft?.fileNames || []);
      setItems(draft?.items || []); setItemsScope(scope);
      setExpanded(new Set(draft?.items?.[0] ? [draft.items[0].id] : []));
      setWarnings(draft?.warnings || []); setError(''); setStatus('');
      if (inputRef.current) inputRef.current.value = '';
    };
    restore();
    return subscribeImportDraft(scope, restore);
  }, [scope]);

  useLayoutEffect(() => {
    if (itemsScope !== scope) return;
    writeImportDraft(scope, { text, items, warnings, fileNames: files.length ? files.map(file => file.name) : missingFiles });
  }, [scope, itemsScope, text, items, warnings, files, missingFiles]);

  useEffect(() => {
    const next = {};
    const created = [];
    files.forEach(file => { if (IMAGE_TYPES.has(fileMime(file))) { const url = URL.createObjectURL(file); next[`${file.name}:${file.size}:${file.lastModified}`] = url; created.push(url); } });
    setPreviewUrls(next);
    return () => created.forEach(url => URL.revokeObjectURL(url));
  }, [files]);

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
    if (workingRef.current || busy || enhanced && !files.length) return;
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
      files,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ledgerId: profile?.ledgerId,
      enhanced,
    }), enhanced ? 'enhanced' : 'parse');
    if (!mountedRef.current || scopeRef.current !== requestScope) return;
    if (files.some(file => IMAGE_TYPES.has(fileMime(file)))) setImageAttempted(true);
    if (!result) return;
    const parsed = resultItems(result).map(item => normalizeItem(item, settings, profile));
    // Flag matching records for review; repeated purchases can be legitimate,
    // so leave the decision to the user instead of silently deleting them.
    const fingerprint = item => {
      const merchant = normalizeText(item.merchant), note = normalizeText(item.note);
      const description = merchant && !note.includes(merchant) ? [merchant, note].filter(Boolean).join(' · ') : note || merchant;
      return item.occurredAt && [item.type, item.currency, item.amount, item.occurredAt, description].join('|');
    };
    const seen = new Set((profile.expenses || []).map(entry => fingerprint({ ...entry, amount: majorFromMinor(entry.amountMinor, entry.currency), occurredAt: toLocalInput(entry.occurredAt || entry.createdAt), merchant: entry.merchant || '', note: entry.note })).filter(Boolean));
    for (const item of parsed) {
      const key = fingerprint(item);
      if (!key) continue;
      if (seen.has(key)) { item.needsReview = true; item.reviewReason = [item.reviewReason, t('possibleDuplicate')].filter(Boolean).join(' · '); }
      seen.add(key);
    }
    setItems(parsed);
    setItemsScope(requestScope);
    setWarnings(current => [...current, ...(Array.isArray(result?.warnings) ? result.warnings.filter(Boolean) : [])]);
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
      ...(item.categorySuggestion ? { categorySuggestion: item.categorySuggestion } : {}),
      consumer: consumer.id,
      note: mergedNote.slice(0, 160),
      occurredAt: toIso(item.occurredAt),
      timezone: item.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      splitMode: item.type === 'expense' && item.splitMode === 'equal' ? 'equal' : 'none',
      splitParticipants: item.type === 'expense' && item.splitMode === 'equal' ? [...new Set(item.splitParticipants || [])] : [],
      recordKind: item.recordKind || 'purchase',
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
    const requestScope = scope;
    const submitted = { text, items, warnings, fileNames: files.length ? files.map(file => file.name) : missingFiles };
    writeImportDraft(requestScope, submitted);
    const result = await execute(async () => {
      let response;
      if (typeof service.importExpenses === 'function') response = await service.importExpenses(payloads);
      else {
        const saved = [];
        for (const payload of payloads) {
          try {
            const entry = await service.addExpense(payload);
            if (!entry?.id) throw new Error('errorSave');
            saved.push(entry);
          } catch (error) {
            if (!saved.length) throw error;
            response = { entries: saved, partial: true, warnings: [error?.message || 'errorSave'] };
            break;
          }
        }
        response ||= { entries: saved };
      }
      const acknowledged = Array.isArray(response) ? response : response?.entries || response?.expenses || [];
      settleImportDraft(requestScope, submitted, acknowledged.map(entry => entry.id));
      return response;
    }, 'save');
    if (!result) return;
    const saved = Array.isArray(result) ? result : result.entries || result.expenses || [];
    onImported?.(saved);
    const ids = new Set(saved.map(entry => entry.id));
    if (result.partial || payloads.some(payload => !ids.has(payload.id))) {
      setItems(current => current.filter(item => !ids.has(item.id)));
      setWarnings(result.warnings?.length ? result.warnings : ['errorSave']);
      return;
    }
    setItems([]);
    setExpanded(new Set());
    setWarnings([]);
    setText('');
    updateFiles([]);
    if (inputRef.current) inputRef.current.value = '';
    setStatus(t('aiImportSaved', { n: payloads.length }));
  };

  const clear = () => {
    if (working || busy) return;
    clearImportDraft(scope);
    setText('');
    updateFiles([]);
    setItems([]);
    setExpanded(new Set());
    setWarnings([]);
    setError('');
    setStatus('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const currentItems = itemsScope === scope ? items : [];
  const needsItemReview = item => item.needsReview || !item.occurredAt || !item.amount || !item.categoryId || !item.consumer || item.confidence !== null && item.confidence < 0.75;
  const hasReviewDetails = warnings.length > 0 || currentItems.some(needsItemReview);

  return <section className="ai-import" aria-label={t('aiImportTitle')}>
    <div className="ai-import-intro">
      <p className="quiet-copy">{t('aiImportIntro')}</p>
      <p className="ai-import-hint"><Icon name="edit"/><span>{t('aiImportHint')}</span></p>
    </div>

    {!isRemote && <div className="ai-import-gate"><p>{t('aiImportNeedLogin')}</p><Button type="button" mode="outline" onClick={onAccount}>{t('signIn')}</Button></div>}
    {isRemote && !aiEnabled && <div className="ai-import-gate is-disabled"><p>{t('aiImportUnavailable')}</p></div>}

    <form className="ai-import-source" onSubmit={event => parse(event)}>
      <label className="ai-import-text-label" htmlFor="ai-import-text">{t('aiImportTextLabel')}</label>
      <Textarea id="ai-import-text" className="ai-import-text" rows={3} maxLength={MAX_IMPORT_TEXT} value={text} onPaste={event => { if (event.clipboardData.getData('text').length + text.length > MAX_IMPORT_TEXT) setWarnings(current => [...current.filter(warning => warning !== 'errorTextTooLong'), 'errorTextTooLong']); }} onChange={event => { setText(event.target.value); setError(''); }} placeholder={t('aiImportTextPlaceholder')} disabled={working || busy}/>
      <div className="ai-import-divider"><span>{t('aiImportImageLabel')}</span></div>
      <input ref={inputRef} className="ai-import-file-input" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => { updateFiles(event.target.files); event.target.value = ''; }} disabled={working || busy}/>
      <div className="ai-import-file-row">
        {!files.length && <Button type="button" mode="outline" className="ai-import-file-button" disabled={working || busy} onClick={() => inputRef.current?.click()}><Icon name="receipt"/><span>{t('aiImportChooseImage')}</span></Button>}
        {files.length > 0 && <div className="ai-import-file-list" role="list">
          {files.map(file => {
            const key = `${file.name}:${file.size}:${file.lastModified}`;
            const preview = previewUrls[key];
            return <div role="listitem" key={key} className="ai-import-preview">
              <span className="ai-import-file-media">
                {preview ? <img src={preview} alt=""/> : <span className="ai-import-file-type">{fileTypeLabel(file)}</span>}
                <span className="ai-import-paperclip"><Icon name="clip"/></span>
              </span>
              <span className="ai-import-filename">{sourceLabel(file, t)}</span><button type="button" className="ai-import-file-remove" aria-label={t('aiImportRemoveFile', { name: file.name })} disabled={working || busy} onClick={() => updateFiles(files.filter(item => item !== file))}>×</button>
            </div>;
          })}
        </div>}
        {files.length > 0 && <Button type="button" mode="plain" className="ai-import-add-file" disabled={working || busy} onClick={() => inputRef.current?.click()}>{t('aiImportReplaceImage')}</Button>}
      </div>
      {isRemote && aiEnabled && files.length > 0 && !currentItems.length && !working && !busy && !status && !error && <PocketIllustration name="receipt-review-tactile-v1" compact className="ai-import-receipt-art"/>}
      <small className="quiet-copy">{t('aiImportFileLimits')}</small>
      {missingFiles.length > 0 && <p className="quiet-copy ai-import-restored-files" role="status">{({
        zh: '文件需重新选择；已整理的记录还在。',
        en: 'Choose the files again to analyse them. Your reviewed records are still here.',
        uk: 'Для повторного аналізу виберіть файли знову. Упорядковані записи збережено.',
      })[settings.language] || 'Choose the files again to analyse them. Your reviewed records are still here.'} {missingFiles.join(' · ')}</p>}
      <div className="ai-import-actions">
        <Button type="submit" className="panel-primary" disabled={!canParse}>{operation === 'parse' ? t('aiImportParsing') : t('aiImportParse')}</Button>
        {Boolean(text || files.length || missingFiles.length || items.length) && <Button type="button" mode="plain" className="text-button" disabled={working || busy} onClick={clear}>{t('aiImportClear')}</Button>}
      </div>
      {files.some(file => IMAGE_TYPES.has(fileMime(file))) && imageAttempted && <div className="ai-import-enhanced"><span>{t('aiImportEnhancedHint')}</span><Button type="button" mode="plain" className="ai-import-enhanced-button" disabled={!canParse} onClick={event => parse(event, true)}><span className="ai-import-enhanced-label"><Icon name="receipt"/>{operation === 'enhanced' ? t('aiImportEnhancing') : t('aiImportEnhanced')}</span></Button></div>}
    </form>

    {(status || error) && <div className={`ai-import-status ${error ? 'is-error' : ''}`} role="status"><span>{error || status}</span></div>}
    {warnings.length > 0 && <ul className="ai-import-warnings" aria-label={t('aiImportHint')}>{warnings.map((warning, index) => <li key={index}>{typeof warning === 'object' ? `${warning.name || ''} · ${t(warning.code)}` : t(warning)}</li>)}</ul>}

    {currentItems.length > 0 && <form className="ai-import-results" onSubmit={saveAll}>
      <header className="ai-import-results-header">
        <PocketIllustration name={hasReviewDetails ? 'partial-import' : 'import-review'} compact/>
        <div className="ai-import-results-heading"><h2>{t('aiImportResults', { n: currentItems.length })}</h2><p>{t(hasReviewDetails ? 'importReviewPartial' : 'importReviewReady')}</p></div>
      </header>
      {currentItems.some(item => ['transfer', 'reimbursement'].includes(item.recordKind)) && <p className="quiet-copy">{t('recordKindBudgetHint')}</p>}
      <div className="ai-import-list">{currentItems.map((item, index) => {
        const category = categoriesFor(item).find(candidate => candidate.id === item.categoryId);
        const categoryName = category ? categoryLabel(category, settings.language) : t('aiImportCategory');
        const expandedItem = expanded.has(item.id);
        const needsReview = needsItemReview(item);
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
            <Select className="editor-select ai-import-field" aria-label={t('aiImportRecordKind')} value={item.recordKind} onChange={event => updateItem(item.id, { recordKind: event.target.value, needsReview: event.target.value !== 'purchase' })} disabled={working || busy}>
              <option value="purchase">{t('recordKindPurchase')}</option><option value="transfer">{t('recordKindTransfer')}</option><option value="reimbursement">{t('recordKindReimbursement')}</option><option value="refund">{t('recordKindRefund')}</option><option value="gift">{t('recordKindGift')}</option><option value="other">{t('recordKindOther')}</option>
            </Select>
            <Input type="datetime-local" className={`settings-input ai-import-field ai-import-time ${!item.occurredAt ? 'is-missing' : ''}`} header={t('aiImportTime')} aria-label={t('aiImportTime')} value={item.occurredAt} onChange={event => updateItem(item.id, { occurredAt: event.target.value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })} required disabled={working || busy}/>
            <Select className={`editor-select ai-import-field ${!item.categoryId ? 'is-missing' : ''}`} aria-label={t('aiImportCategory')} value={item.categoryId} onChange={event => updateItem(item.id, { categoryId: event.target.value })} required disabled={working || busy}><option value="">{t('aiImportCategory')}</option>{categoriesFor(item).map(category => <option key={category.id} value={category.id}>{categoryLabel(category, settings.language)}</option>)}</Select>
            <Select className={`editor-select ai-import-field ${!item.consumer ? 'is-missing' : ''}`} aria-label={t('aiImportConsumer')} value={item.consumer} onChange={event => updateItem(item.id, { consumer: event.target.value })} required disabled={working || busy}><option value="">{t('aiImportConsumer')}</option>{consumers.map(consumer => <option key={consumer.id} value={consumer.id}>{consumer.name}</option>)}</Select>
            {splitEnabled && <div className="ai-import-split"><Select className="editor-select ai-import-field" aria-label={t('aiImportSplit')} value={item.splitMode} onChange={event => updateItem(item.id, { splitMode: event.target.value, splitParticipants: event.target.value === 'equal' ? (item.splitParticipants?.length ? item.splitParticipants : consumers.map(consumer => consumer.id)) : [] })} disabled={working || busy}><option value="none">{t('aiImportNoSplit')}</option><option value="equal">{t('aiImportSplitEqual')}</option></Select>{item.splitMode === 'equal' && <div className="ai-import-participants" role="group" aria-label={t('aiImportSplitParticipants')}>{consumers.map(consumer => <Tappable Component="button" type="button" key={consumer.id} className={`ai-import-participant ${item.splitParticipants?.includes(consumer.id) ? 'is-selected' : ''}`} aria-pressed={item.splitParticipants?.includes(consumer.id)} onClick={() => toggleParticipant(item, consumer.id)} disabled={working || busy}>{consumer.name}</Tappable>)}</div>}</div>}
            <Input className="settings-input ai-import-field ai-import-note" header={t('aiImportNote')} aria-label={t('aiImportNote')} maxLength={160} value={item.note} onChange={event => updateItem(item.id, { note: event.target.value })} disabled={working || busy}/>
          </div>}
          {expandedItem && item.needsReview && <p className="ai-import-review-reason">{t('aiImportReviewReason', { reason: item.reviewReason || t('aiImportReview') })}</p>}
          {expandedItem && item.rawText && <p className="ai-import-raw">{item.rawText}</p>}
        </article>;
      })}</div>
      <Button type="submit" className="panel-primary ai-import-save" disabled={working || busy || !items.length}>{operation === 'save' ? t('aiImportSaving') : t('aiImportSaveAll')}</Button>
    </form>}
  </section>;
}

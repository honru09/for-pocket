import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppRoot, Button, Cell, Input, Placeholder, SegmentedControl, Select, Snackbar, Tappable } from '@telegram-apps/telegram-ui';
import { CURRENCIES, COLORS, ICONS, DEFAULT_CATEGORIES, DEFAULT_INCOME_CATEGORIES, MAX_CATEGORIES, sortCategoriesByUsage, initialSettings, validateSettings, parseAmountExpression, dateKey, resolveLanguage, isBudgetEntry } from '../public/shared.mjs';
import { LOCALES, translate, translateError, categoryLabel, categoryDisplayLabel } from '../public/i18n.mjs';
import { PREVIEW_KEY, SESSION_KEY, localService, remoteService } from './services.mjs';
import { Avatar, CirclePicker, ProfileEditor, AccountPage, CirclesPage, Sheet } from './AccountViews.jsx';
import AiImportPage from './AiImportPage.jsx';
import LedgerEmptyState from './LedgerEmptyState.jsx';
import AiSummary from './AiSummary.jsx';
import { Icon } from './icons.jsx';
import PocketMascot from './PocketMascot.jsx';
import PocketIllustration from './PocketIllustration.jsx';
import CandidateIcon from './CandidateIcon.jsx';
import KeypadButton from './KeypadButton.jsx';
import CircleReactions from './CircleReactions.jsx';
import TimeEditor from './TimeEditor.jsx';
import usePocketViewport from './usePocketViewport.js';
import { createId } from './id.mjs';
import { normalizeLocation, currencyForCountry, locationLabel } from '../public/location.mjs';
import { createLocationClient, locationPreference } from './location-client.mjs';
import { resolveExpenseLocation } from './expense-location.mjs';
import { LocationSheet } from './LocationViews.jsx';
import CategorySuggestions from './CategorySuggestions.jsx';
import { deviceTimezone } from '../public/timezone.mjs';
import { bindForegroundRefresh } from './foreground-refresh.mjs';
import { parseClipboardExpense } from '../public/clipboard.mjs';
import { readClipboardQuietly } from './clipboard-client.mjs';
import { createEntryMutations } from './entry-mutations.mjs';
import ExpenseEditor from './ExpenseEditor.jsx';
import SettingsPage from './SettingsPage.jsx';
import { createWeatherClient, weatherCell, mascotEnvironment as resolveMascotEnvironment } from './weather.mjs';

const telegram = window.Telegram?.WebApp;
const language = resolveLanguage(telegram?.initDataUnsafe?.user?.language_code || navigator.language);
const blankDraft = () => ({ raw: '0', selected: null, consumer: null, note: '', type: 'expense', occurredAt: null });
const OUTBOX_KEY = 'for-pocket.unconfirmed.v1';
const THEME_OPTIONS = ['matcha', 'cheese', 'peach', 'sea'];
const SOUND_OPTIONS = ['off', 'water', 'wood'];
function haptic(kind = 'selection') { try { if (!telegram?.isVersionAtLeast?.('6.1')) return; kind === 'success' ? telegram.HapticFeedback.notificationOccurred(kind) : telegram.HapticFeedback.selectionChanged(); } catch {} }
function playKeySound(pack) {
  if (!pack || pack === 'off') return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = playKeySound.context || (playKeySound.context = new AudioContext());
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = pack === 'wood' ? 'triangle' : 'sine';
    oscillator.frequency.value = pack === 'wood' ? 185 : 760;
    gain.gain.setValueAtTime(pack === 'wood' ? 0.035 : 0.022, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (pack === 'wood' ? 0.075 : 0.11));
    oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.12);
  } catch {}
}
function minorToRaw(minor, currency) {
  const digits = CURRENCIES[currency]?.digits ?? 0;
  const value = minor / 10 ** digits;
  return digits ? value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '') : String(Math.round(value));
}
function countText(n, lang, currency) {
  const plural = new Intl.PluralRules(LOCALES[lang]).select(n);
  const unit = lang === 'zh' ? '笔' : lang === 'en' ? plural === 'one' ? 'entry' : 'entries' : ({ one: 'запис', few: 'записи', many: 'записів', other: 'записів' }[plural]);
  return `${n} ${unit} · ${currency}`;
}
const Categories = memo(function Categories({ categories, lang, selected, disabled, onSelect }) {
  const drawerRef = useRef(null), gesture = useRef(null), blockClick = useRef(false), pointerSelection = useRef(null);
  const [scrollHints, setScrollHints] = useState({ left: false, right: false });
  const clearClickBlock = useCallback(() => {
    // A native horizontal touch scroll may dispatch a click after pointerup.
    // Suppress only that synthetic click, then release the guard immediately
    // so the next deliberate tap remains responsive while momentum scrolling.
    blockClick.current = true;
    window.setTimeout(() => { blockClick.current = false; }, 0);
  }, []);
  useEffect(() => {
    const drawer = drawerRef.current;
    const active = [...(drawer?.children || [])].find(node => node.dataset.category === selected);
    if (!active) return;
    const left = active.offsetLeft - drawer.offsetLeft, right = left + active.offsetWidth;
    if (left < drawer.scrollLeft + 4) drawer.scrollTo({ left:Math.max(0,left - 4), behavior:'smooth' });
    else if (right > drawer.scrollLeft + drawer.clientWidth - 4) drawer.scrollTo({ left:right - drawer.clientWidth + 4, behavior:'smooth' });
  }, [selected, categories]);
  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return undefined;
    const updateHints = () => {
      const max = Math.max(0, drawer.scrollWidth - drawer.clientWidth);
      setScrollHints({
        left: drawer.scrollLeft > 4,
        right: max - drawer.scrollLeft > 4,
      });
    };
    updateHints();
    drawer.addEventListener('scroll', updateHints, { passive: true });
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(updateHints) : null;
    resize?.observe(drawer);
    return () => { drawer.removeEventListener('scroll', updateHints); resize?.disconnect(); };
  }, [categories]);
  const moved = event => {
    const start = gesture.current;
    if (start && (Math.abs(event.clientX - start.x) > 8 || Math.abs(event.clientY - start.y) > 8)) { start.dragged = true; blockClick.current = true; }
  };
  const released = event => {
    const current = gesture.current;
    if (!current) return;
    if (current.dragged) {
      clearClickBlock();
    } else {
      // Some mobile WebViews intentionally omit the follow-up click after a
      // horizontal scroller has had momentum. Select on a clean pointerup so
      // a pill stays usable immediately after a swipe.
      const target = event.target?.closest?.('[data-category]');
      if (target && !disabled) {
        const id = target.dataset.category;
        onSelect(id);
        pointerSelection.current = { id, at: performance.now() };
      }
    }
    gesture.current = null;
  };
  return <div ref={drawerRef} className={`categories category-drawer ${scrollHints.left ? 'has-scroll-left' : ''} ${scrollHints.right ? 'has-scroll-right' : ''}`} id="categories" role="group" aria-label={translate(lang, 'categories')}
    onPointerDownCapture={event => { blockClick.current = false; gesture.current = { x:event.clientX, y:event.clientY, dragged:false }; }}
    onPointerMoveCapture={moved}
    onPointerUpCapture={released}
    onPointerCancelCapture={() => { if (gesture.current?.dragged) clearClickBlock(); gesture.current = null; }}
    onClickCapture={event => {
      if (blockClick.current) { event.preventDefault(); event.stopPropagation(); blockClick.current = false; return; }
      const target = event.target?.closest?.('[data-category]');
      const pointer = pointerSelection.current;
      if (target && pointer && pointer.id === target.dataset.category && performance.now() - pointer.at < 500) {
        event.preventDefault(); event.stopPropagation(); pointerSelection.current = null;
      }
    }}>
    {categories.map(c => <button type="button" className={`category category-pill ${selected === c.id ? 'selected' : ''}`} key={c.id} data-category={c.id} aria-label={categoryDisplayLabel(c, lang)} aria-pressed={selected === c.id} disabled={disabled} onClick={() => onSelect(c.id)}><span className="category-icon" style={{ background: `var(--${c.color})` }}><Icon name={c.icon}/></span><span className="category-label">{categoryDisplayLabel(c, lang)}</span></button>)}
  </div>;
});

const SwipeExpenseRow = memo(function SwipeExpenseRow({ children, entry, t, onDelete, onCopy, onEdit }) {
  const ACTION_WIDTH = 72, OPEN_WIDTH = ACTION_WIDTH * 3;
  const [offset, setOffset] = useState(0), [dragging, setDragging] = useState(false);
  const gesture = useRef(null), suppressClick = useRef(false);
  const close = useCallback(() => { setDragging(false); setOffset(0); }, []);
  useEffect(() => {
    const reveal = event => { setDragging(false); setOffset(event.detail === entry.id ? OPEN_WIDTH : 0); };
    document.addEventListener('pocket:entry-actions', reveal);
    return () => document.removeEventListener('pocket:entry-actions', reveal);
  }, [entry.id]);
  const finish = useCallback(() => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    setDragging(false);
    if (current.dragged) {
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
    if (current.dragged && current.offset > ACTION_WIDTH) document.dispatchEvent(new CustomEvent('pocket:entry-actions', { detail:entry.id }));
    else setOffset(0);
  }, [entry.id]);
  const action = useCallback((callback) => { close(); callback(entry); }, [close, entry]);
  return <div className="swipe-expense" data-offset={offset} data-dragging={dragging}>
    <div className="swipe-actions swipe-actions-right" aria-hidden={offset === 0}>
      <button type="button" className="swipe-action swipe-delete" disabled={entry.canDelete === false} tabIndex={offset > 0 ? 0 : -1} onClick={() => action(onDelete)}><Icon name="trash"/><span>{t('deleteExpenseShort')}</span></button>
      <button type="button" className="swipe-action" tabIndex={offset > 0 ? 0 : -1} onClick={() => action(onCopy)}><Icon name="copy"/><span>{t('copyEntry')}</span></button>
      <button type="button" className="swipe-action" disabled={entry.canDelete === false} tabIndex={offset > 0 ? 0 : -1} onClick={() => action(onEdit)}><Icon name="edit"/><span>{t('editEntry')}</span></button>
    </div>
    <div className="swipe-expense-surface" style={{ transform:`translate3d(${offset}px,0,0)` }}
      onPointerDown={event => { if (event.pointerType === 'mouse' && event.button !== 0) return; suppressClick.current = false; gesture.current = { x:event.clientX, y:event.clientY, startOffset:offset, offset, dragged:false, axis:null, pointerId:event.pointerId }; }}
      onPointerMove={event => { const current = gesture.current; if (!current) return; const dx = event.clientX - current.x, dy = event.clientY - current.y; if (!current.axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) current.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; if (current.axis !== 'x') return; current.dragged = true; setDragging(true); event.preventDefault(); event.currentTarget.setPointerCapture?.(current.pointerId); current.offset = Math.max(0, Math.min(OPEN_WIDTH, current.startOffset + dx)); setOffset(current.offset); }}
      onPointerUp={finish}
      onPointerCancel={() => { gesture.current = null; close(); }}
      onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
      {children}
    </div>
  </div>;
});

function RecurringEditor({ settings, categories, t, updateSettings, disabled }) {
  const [draft, setDraft] = useState({ day: 1, amount: '', currency: settings.currency, categoryId: categories[0]?.id || 'other', consumer: settings.consumers[0]?.id || '', note: '' });
  const recurring = settings.recurringExpenses || [];
  const add = event => {
    event.preventDefault();
    const digits = CURRENCIES[draft.currency]?.digits ?? 0, amount = Number(String(draft.amount).replace(',', '.'));
    const amountMinor = Math.round(amount * 10 ** digits);
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) return;
    updateSettings({ recurringExpenses: [...recurring, { id:createId(), day:Math.max(1, Math.min(31, Number(draft.day) || 1)), amountMinor, currency:draft.currency, categoryId:draft.categoryId, consumer:draft.consumer, note:draft.note.trim() }] });
    setDraft(current => ({ ...current, amount:'', note:'' }));
  };
  const format = item => new Intl.NumberFormat(LOCALES[settings.language], { style:'currency', currency:item.currency, currencyDisplay:'narrowSymbol', minimumFractionDigits:CURRENCIES[item.currency].digits }).format(item.amountMinor / 10 ** CURRENCIES[item.currency].digits);
  return <section className="recurring-panel"><p className="quiet-copy">{t('recurringHint')}</p><div className="recurring-list">{recurring.map(item => <div className="recurring-item" key={item.id}><span className="recurring-date">{item.day}</span><div><strong>{format(item)}</strong><small>{categoryDisplayLabel(categories.find(c => c.id === item.categoryId) || {}, settings.language)}{item.note ? ` · ${item.note}` : ''}</small></div><button type="button" aria-label={t('removeRecurring')} disabled={disabled} onClick={() => updateSettings({ recurringExpenses: recurring.filter(other => other.id !== item.id) })}>×</button></div>)}{!recurring.length && <div className="recurring-empty-state"><PocketIllustration name="recurring-reminder-tactile-v1" compact/><span className="quiet-copy">{t('recurringEmpty')}</span></div>}</div><form className="recurring-form" onSubmit={add}><label><span>{t('recurringDay')}</span><input inputMode="numeric" type="number" min="1" max="31" value={draft.day} onChange={event => setDraft(current => ({ ...current, day:event.target.value }))}/></label><label><span>{t('amountLabel')}</span><input inputMode="decimal" type="number" min="0" step="any" required value={draft.amount} onChange={event => setDraft(current => ({ ...current, amount:event.target.value }))}/></label><label><span>{t('currency')}</span><select value={draft.currency} onChange={event => setDraft(current => ({ ...current, currency:event.target.value }))}>{Object.keys(CURRENCIES).map(currency => <option key={currency}>{currency}</option>)}</select></label><label className="recurring-wide"><span>{t('categoryFilter')}</span><select value={draft.categoryId} onChange={event => setDraft(current => ({ ...current, categoryId:event.target.value }))}>{categories.map(category => <option key={category.id} value={category.id}>{categoryDisplayLabel(category, settings.language)}</option>)}</select></label><label className="recurring-wide"><span>{t('note')}</span><input maxLength="160" value={draft.note} onChange={event => setDraft(current => ({ ...current, note:event.target.value }))}/></label><Button className="compact-save" type="submit" disabled={disabled}>{t('addRecurring')}</Button></form></section>;
}

export default function App() {
  usePocketViewport(telegram);
  const [timezone, setTimezone] = useState(() => deviceTimezone());
  const timezoneSync = useRef(null);
  const [profile, setProfile] = useState(null), [settings, setSettings] = useState(() => initialSettings(language));
  const [draft, setDraft] = useState(blankDraft), [view, setView] = useState('record'), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [isRemote, setRemote] = useState(false), [config, setConfig] = useState({}), [notice, setNotice] = useState(null), [failed, setFailed] = useState(false), [syncFailed, setSyncFailed] = useState(false);
  const [postcard, setPostcard] = useState(null);
  const [reactionHost, setReactionHost] = useState(null);
  const [picker, setPicker] = useState(false), [period, setPeriod] = useState('month'), [historyCurrency, setHistoryCurrency] = useState('JPY');
  const [editing, setEditing] = useState([]), [editingType, setEditingType] = useState('expense'), [today, setToday] = useState(() => dateKey(new Date(), timezone));
  const [retryCount, setRetryCount] = useState(0), [celebration, setCelebration] = useState(null);
  const [writeCount, setWriteCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [timeEditor, setTimeEditor] = useState(null);
  const [noteEditor, setNoteEditor] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState(null), [editingEntry, setEditingEntry] = useState(null);
  const [historyCategory, setHistoryCategory] = useState('all');
  const [locationGeneration, setLocationGeneration] = useState(0);
  const lastLocation = useRef(null);
  const [locationSheet, setLocationSheet] = useState(false), [locationEnabled, setLocationEnabled] = useState(false), [locationBusy, setLocationBusy] = useState(false);
  const [clipboardSuggestion, setClipboardSuggestion] = useState(null), [ratePreview, setRatePreview] = useState(null), [weather, setWeather] = useState(null), [clock, setClock] = useState(() => new Date());
  const locationClient = useRef(null), locationRound = useRef(0), locationSuppressed = useRef(false), activeCapture = useRef(null), suggestedPlace = useRef(null);
  if (!locationClient.current) locationClient.current = createLocationClient({ telegram });
  const weatherClient = useRef(null);
  if (!weatherClient.current) weatherClient.current = createWeatherClient();
  const currentWeatherCell = weatherCell(draft.location);

  const service = useRef(null), busyRef = useRef(false), state = useRef({}), settingsRef = useRef(settings), currentProfile = useRef(null), pending = useRef(null), drafts = useRef(new Map());
  const pendingWrites = useRef(new Map()), failedWrites = useRef(new Map()), entryOperations = useRef(null), settingWrites = useRef(new Map()), settingQueue = useRef(Promise.resolve());
  const confirmedSettings = useRef(new Map());
  const pageRef = useRef(null), mascotRef = useRef(null), stageRef = useRef(null), keyboard = useRef(false), epoch = useRef(0);
  const keypadPointer = useRef(null);
  const t = useCallback((key, values) => translate(settings.language, key, values), [settings.language]);
  const locale = LOCALES[settings.language], disabled = busy || !ready;
  const draftCurrency = draft.currency || settings.currency;
  const parsedAmount = parseAmountExpression(draft.raw, draftCurrency), digits = CURRENCIES[draftCurrency].digits;
  const amountMinor = parsedAmount.valid ? parsedAmount.minor : 0;
  const displayValue = amountMinor / 10 ** digits;
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1).find(p => p.type === 'decimal')?.value || '.';
  const fraction = draft.raw.split('.')[1];
  const amount = Number(draft.raw.split('.')[0] || 0).toLocaleString(locale) + (digits && fraction !== undefined ? decimal + fraction : '');
  const money = (minor, currency = settings.currency) => new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: CURRENCIES[currency].digits, maximumFractionDigits: CURRENCIES[currency].digits }).format(minor / 10 ** CURRENCIES[currency].digits);
  const categories = draft.type === 'income' ? settings.incomeCategories : settings.categories;
  const expenses = profile?.expenses || [], circle = profile?.social.activeCircle;
  const orderedCategories = useMemo(() => sortCategoriesByUsage(categories, expenses, { type:draft.type }), [categories, expenses, draft.type]);
  state.current = { draft, ready, view, amountMinor, isRemote };
  const changeBusy = value => { busyRef.current = value; setBusy(value); };
  const notify = useCallback((key, values, extra = {}) => setNotice({ id: createId(), key, values, ...extra }), []);
  const showError = useCallback(error => notify(null, null, { error: error.message || 'errorSave' }), [notify]);
  if (!entryOperations.current) entryOperations.current = createEntryMutations({
    publish(operation, entry) {
      const p = currentProfile.current;
      if (operation.backend !== service.current || operation.scope !== p?.user.id + ':' + p?.ledgerId) return;
      const next = { ...p, expenses:[...p.expenses.filter(item => item.id !== operation.id), ...(entry ? [{ ...entry, canDelete:operation.fallback?.canDelete ?? true }] : [])] };
      currentProfile.current = next; setProfile(next);
    },
    failed(operation, error) {
      const p = currentProfile.current;
      if (operation.backend === service.current && operation.scope === p?.user.id + ':' + p?.ledgerId) showError(error);
    },
    changed() { epoch.current++; },
  });
  const persistOutbox = useCallback((scope = `${currentProfile.current?.user.id}:${currentProfile.current?.ledgerId}`) => {
    setFailedCount([...failedWrites.current.values()].filter(write => write.scope === scope).length);
    const writes = new Map([...failedWrites.current, ...pendingWrites.current]);
    try {
      if (!writes.size) localStorage.removeItem(OUTBOX_KEY);
      else localStorage.setItem(OUTBOX_KEY, JSON.stringify([...writes.values()].map(({ scope, payload, optimistic }) => ({ scope, payload, optimistic }))));
    } catch {}
  }, []);
  const apply = useCallback(p => {
    const scope = `${p.user.id}:${p.ledgerId}`;
    const confirmedIds = new Set(p.expenses.map(entry => entry.id));
    let reconciled = false;
    for (const [id, write] of failedWrites.current) if (write.scope === scope && confirmedIds.has(id)) { failedWrites.current.delete(id); reconciled = true; }
    for (const write of failedWrites.current.values()) if (write.scope === scope) write.backend = service.current;
    setFailedCount([...failedWrites.current.values()].filter(write => write.scope === scope).length);
    if (reconciled) persistOutbox(scope);
    const edits = [...pendingWrites.current.values()].filter(write => write.scope === scope && write.backend === service.current);
    const existing = new Set(p.expenses.map(entry => entry.id));
    p = { ...p, expenses: [...p.expenses, ...edits.filter(write => !existing.has(write.payload.id)).map(write => write.optimistic)] };
    for (const operation of entryOperations.current.pending.values()) {
      if (operation.scope !== scope || operation.backend !== service.current) continue;
      p.expenses = [...p.expenses.filter(entry => entry.id !== operation.id), ...(operation.optimistic ? [operation.optimistic] : [])];
    }
    const settingWrite = settingWrites.current.get(scope);
    if (!settingWrite) confirmedSettings.current.set(scope, validateSettings(p.settings));
    if (settingWrite?.backend === service.current) p.settings = { ...p.settings, ...settingWrite.settings, consumers: p.settings.consumers };
    const previous = currentProfile.current, next = validateSettings(p.settings);
    const currencyChanged = settingsRef.current.currency !== next.currency;
    const scopeChanged = previous?.ledgerId !== p.ledgerId || previous?.user.id !== p.user.id;
    if (scopeChanged) {
      setTimeEditor(null); setEditingEntry(null); setLocationSheet(false); setHistoryCategory('all');
      lastLocation.current = null;
      locationRound.current++; locationSuppressed.current = false; activeCapture.current = null; setLocationBusy(false);
      if (previous) drafts.current.set(`${previous.user.id}:${previous.ledgerId}`, { ...state.current.draft, baseCurrency: settingsRef.current.currency });
      const stored = drafts.current.get(`${p.user.id}:${p.ledgerId}`);
      setDraft(stored && stored.baseCurrency === next.currency ? { ...stored, location:undefined, suggestedCurrency:undefined, consumer: next.consumers.some(c => c.id === stored.consumer) ? stored.consumer : p.user.id } : { ...blankDraft(), consumer: p.user.id });
      pending.current = null; setNotice(null); setHistoryCurrency(next.currency);
    } else {
      setDraft(current => {
        const pool = current.type === 'income' ? next.incomeCategories : next.categories;
        return { ...current, raw: currencyChanged && !current.currency ? '0' : current.raw, selected: pool.some(c => c.id === current.selected) ? current.selected : null, consumer: next.consumers.some(c => c.id === current.consumer) ? current.consumer : p.user.id };
      });
    }
    settingsRef.current = next; currentProfile.current = p; setSettings(next); setProfile(p);
  }, [persistOutbox]);
  const run = useCallback(async (operation, success) => {
    if (busyRef.current) return null;
    changeBusy(true); epoch.current++;
    try { const result = await operation(); if (result?.settings && result?.user) apply(result); if (success) notify(success); return result; }
    catch (error) { showError(error); return null; }
    finally { epoch.current++; changeBusy(false); }
  }, [apply, notify, showError]);
  const navigate = useCallback(next => {
    if (busyRef.current) return;
    setPicker(false); setView(next); window.scrollTo({ top: 0, behavior: 'instant' }); haptic();
  }, []);
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      setFailed(false);
      try {
        telegram?.ready?.(); telegram?.expand?.();
        if (telegram?.isVersionAtLeast?.('6.1')) { telegram.setHeaderColor('#f8f7f1'); telegram.setBackgroundColor('#f8f7f1'); }
        const response = await fetch('/api/config', { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('errorConnect');
        const c = await response.json(); if (cancelled) return;
        setConfig({ ...c, inTelegram: Boolean(telegram?.initData) });
        const remote = c.mode !== 'local' && Boolean(telegram?.initData || localStorage.getItem(SESSION_KEY));
        let backend = remote ? remoteService(telegram) : localService(language), p;
        try { p = await backend.getProfile(); } catch (error) {
          if (error.status !== 401 || telegram?.initData) throw error;
          localStorage.removeItem(SESSION_KEY); backend = localService(language); p = await backend.getProfile(); notify('errorSignIn');
        }
        if (cancelled) return;
        try {
          const restored = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
          for (const write of Array.isArray(restored) ? restored : []) {
            if (write?.payload?.id && write.optimistic?.id === write.payload.id && typeof write.scope === 'string') failedWrites.current.set(write.payload.id, { ...write, backend: null });
          }
        } catch {}
        service.current = backend; setRemote(backend.getInvite !== undefined); apply(p); setReady(true); setSyncFailed(false);
      } catch (error) { if (!cancelled) { setFailed(true); showError(error); } }
    }
    boot();
    return () => { cancelled = true; };
  }, [apply, notify, showError, retryCount]);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false, refreshing = false;
    const refresh = async () => {
      if (document.hidden || busyRef.current || refreshing || pendingWrites.current.size || entryOperations.current.pending.size || settingWrites.current.size) return;
      const backend = service.current, version = epoch.current; refreshing = true;
      try {
        const p = await backend.getProfile();
        if (!cancelled && !busyRef.current && version === epoch.current && backend === service.current) {
          if (JSON.stringify(p) !== JSON.stringify(currentProfile.current)) apply(p);
          setSyncFailed(false); setToday(dateKey(new Date(), timezone));
        }
      } catch { if (!cancelled) setSyncFailed(true); }
      finally { refreshing = false; }
    };
    const storage = e => { if (e.key === PREVIEW_KEY && !state.current.isRemote) refresh(); };
    const timer = isRemote ? setInterval(refresh, 3000) : null;
    document.addEventListener('visibilitychange', refresh); window.addEventListener('focus', refresh); window.addEventListener('storage', storage);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); window.removeEventListener('storage', storage); };
  }, [ready, isRemote, apply]);
  useEffect(() => { document.documentElement.lang = locale; document.title = `for. · ${t('title')}`; }, [locale, t]);
  useEffect(() => { document.documentElement.dataset.theme = settings.theme || 'matcha'; }, [settings.theme]);
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!ready || view !== 'record' || !navigator.clipboard?.readText) return undefined;
    let cancelled = false, last = '';
    const read = async () => {
      if (document.hidden || cancelled || state.current.draft.raw !== '0') return;
      try {
        const text = await readClipboardQuietly();
        if (!text || text === last) return;
        last = text;
        const parsed = parseClipboardExpense(text, settingsRef.current.currency);
        if (!cancelled && parsed) setClipboardSuggestion(parsed);
      } catch {}
    };
    const onVisibility = () => { if (!document.hidden) void read(); };
    window.addEventListener('focus', read); document.addEventListener('visibilitychange', onVisibility); void read();
    return () => { cancelled = true; window.removeEventListener('focus', read); document.removeEventListener('visibilitychange', onVisibility); };
  }, [ready, view, settings.currency]);
  useEffect(() => {
    if (!ready || !amountMinor || draftCurrency === settings.currency) { setRatePreview(null); return undefined; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/rates?base=${encodeURIComponent(draftCurrency)}&symbols=${encodeURIComponent(settings.currency)}`, { signal:controller.signal });
        if (!response.ok) return;
        const data = await response.json(), rate = Number(data.rates?.[settings.currency]);
        if (Number.isFinite(rate) && rate > 0) setRatePreview({ currency:settings.currency, minor:Math.round((amountMinor / 10 ** digits) * rate * 10 ** CURRENCIES[settings.currency].digits) });
      } catch {}
    }, 280);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [ready, amountMinor, draftCurrency, settings.currency, digits]);
  useEffect(() => {
    if (!currentWeatherCell || !locationEnabled) { setWeather(null); return; }
    if (view !== 'record') return;
    const [lat, lng] = currentWeatherCell.split(',').map(Number);
    const controller = new AbortController();
    const refresh = async () => {
      const value = await weatherClient.current.load({ lat, lng }, { signal:controller.signal });
      if (!controller.signal.aborted) setWeather(value);
    };
    setWeather(null);
    void refresh();
    const unbind = bindForegroundRefresh({ telegram, refresh });
    return () => { unbind(); controller.abort(); };
  }, [currentWeatherCell, locationEnabled, view]);
  useEffect(() => {
    const back = () => navigate('record'); telegram?.BackButton?.onClick?.(back);
    try { view === 'record' ? telegram?.BackButton?.hide?.() : telegram?.BackButton?.show?.(); } catch {}
    return () => telegram?.BackButton?.offClick?.(back);
  }, [view, navigate]);
  useEffect(() => { if (telegram?.isVersionAtLeast?.('6.2')) { try { amountMinor || draft.note || writeCount || failedCount ? telegram.enableClosingConfirmation() : telegram.disableClosingConfirmation(); } catch {} } }, [amountMinor, draft.note, writeCount, failedCount]);
  useLayoutEffect(() => {
    if (keyboard.current) return;
    const animation = pageRef.current?.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: 'cubic-bezier(.23,1,.32,1)' });
    return () => animation?.cancel();
  }, [view]);
  const editDraft = patch => { pending.current = null; state.current.draft = { ...state.current.draft, ...patch }; setDraft(state.current.draft); };
  const locationScope = profile ? `${profile.user.id}:${profile.ledgerId}` : '';
  useEffect(() => {
    locationClient.current.clear();
    setLocationEnabled(locationScope ? locationPreference(locationScope) : false);
  }, [locationScope]);
  const captureLocation = useCallback(async ({ explicit = false, refresh = false } = {}) => {
    const before = currentProfile.current, d = state.current.draft;
    if (!before || (!explicit && (locationSuppressed.current || d.occurredAt))) return;
    // A foreground refresh can be in flight when the user explicitly asks
    // for the current place. In that case invalidate the older round first
    // so the explicit request is never swallowed by the background lookup.
    if (activeCapture.current) {
      if (!explicit) return;
      locationRound.current++;
      activeCapture.current = null;
      locationClient.current.clear();
    }
    const scope = `${before.user.id}:${before.ledgerId}`;
    if (!explicit && !locationPreference(scope)) return;
    const remembered = lastLocation.current;
    if (remembered?.scope === scope && Date.now() - remembered.at >= 60000
      && d.location?.lat === remembered.location?.lat && d.location?.lng === remembered.location?.lng) {
      lastLocation.current = null;
      editDraft({ location:undefined, suggestedCurrency:undefined });
    }
    const round = locationRound.current, backend = service.current, occurredAt = d.occurredAt;
    let finishResolution;
    const request = { scope, occurredAt, resolution:new Promise(resolve => { finishResolution = resolve; }) };
    const current = () => locationRound.current === round && service.current === backend
      && `${currentProfile.current?.user.id}:${currentProfile.current?.ledgerId}` === scope
      && state.current.draft.occurredAt === occurredAt && !locationSuppressed.current;
    activeCapture.current = request; setLocationBusy(true);
    try {
      const coords = await locationClient.current.capture({ allowPrompt: explicit, previouslyGranted:locationPreference(scope), refresh: explicit || refresh });
      if (!coords) {
        if (current()) { lastLocation.current = null; editDraft({ location:undefined, suggestedCurrency:undefined }); }
        return;
      }
      if (!current() && !request.saved) return;
      if (current()) {
        locationPreference(scope, true); setLocationEnabled(true);
        lastLocation.current = { scope, location:normalizeLocation(coords), at:Date.now() };
        editDraft({ location: normalizeLocation(coords) });
      }
      let resolved;
      try { resolved = await backend.resolveLocation(coords, before.ledgerId); } catch {}
      const location = normalizeLocation(resolved?.location) || normalizeLocation(coords);
      finishResolution(location);
      if (!current()) return;
      lastLocation.current = { scope, location, at:lastLocation.current?.at || Date.now() };
      const currency = currencyForCountry(location?.countryCode);
      const live = state.current.draft;
      const canSuggest = currency && !live.currencyManual;
      const keepsAmount = !live.raw.includes('.') || CURRENCIES[currency || 'JPY'].digits > 0 || Number(live.raw.split('.')[1] || 0) === 0;
      editDraft({ location, suggestedCurrency:currency, ...(canSuggest && keepsAmount ? { currency, raw:CURRENCIES[currency].digits ? live.raw : live.raw.split('.')[0] } : {}) });
    } finally {
      finishResolution(undefined);
      if (activeCapture.current === request) { activeCapture.current = null; setLocationBusy(false); }
    }
  }, []);
  useEffect(() => {
    // A route change inside the SPA does not fire a visibility/focus event.
    // Refresh when the record surface is opened so a previously granted
    // location is current before the next entry, while keeping history and
    // settings free from background GPS work.
    if (!ready || !locationEnabled || view !== 'record') return;
    const refresh = () => { void captureLocation({ refresh:true }); };
    refresh();
    return bindForegroundRefresh({ telegram, refresh });
  }, [ready, locationEnabled, locationScope, locationGeneration, view, captureLocation]);
  useEffect(() => {
    if (!ready || !locationScope) return;
    const sync = async () => {
      const p = currentProfile.current, backend = service.current;
      const zone = deviceTimezone({ countryCode:state.current.draft.location?.countryCode, fallback:p?.settings.timezone });
      setTimezone(zone); setToday(dateKey(new Date(), zone));
      if (!p || !backend?.syncTimezone) return;
      const key = `${p.user.id}:${p.ledgerId}:${zone}`;
      if (timezoneSync.current?.key === key && timezoneSync.current.backend === backend) return;
      const operation = { key, backend }; timezoneSync.current = operation;
      try { await backend.syncTimezone(zone, p.ledgerId); }
      catch { if (timezoneSync.current === operation) timezoneSync.current = null; }
    };
    void sync();
    return bindForegroundRefresh({ telegram, refresh:sync });
  }, [ready, locationScope]);
  useEffect(() => {
    if (view === 'record' && locationEnabled && Number(draft.raw) > 0 && !draft.location) void captureLocation();
  }, [draft.raw, view, locationEnabled, captureLocation]);
  const useLocation = () => {
    locationSuppressed.current = false; void captureLocation({ explicit:true });
  };
  const removeLocation = (disable = false) => {
    lastLocation.current = null;
    locationRound.current++; locationSuppressed.current = true; activeCapture.current = null; setLocationBusy(false); locationClient.current.clear();
    editDraft({ location:undefined, suggestedCurrency:undefined });
    if (disable) { locationPreference(locationScope, false); setLocationEnabled(false); locationClient.current.clear(); void service.current.clearLocationPresence?.(profile?.ledgerId).catch(() => {}); }
  };
  useEffect(() => {
    if (!isRemote || !config.aiEnabled || view !== 'record' || !draft.location?.name || draft.selected || Number(draft.raw) <= 0 || draft.occurredAt) return;
    const placeKey = JSON.stringify([locationRound.current, locationScope, draft.location, draft.type]);
    if (suggestedPlace.current === placeKey) return;
    const round = locationRound.current, backend = service.current, raw = draft.raw, type = draft.type;
    const timer = setTimeout(() => {
      suggestedPlace.current = placeKey;
      void backend.aiParseExpense({ text:raw, locationContext:draft.location, type, timezone, ledgerId:currentProfile.current.ledgerId,
        ...(draft.currencyManual ? {currency:draft.currency || settings.currency} : {}) }).then(result => {
        const live = state.current.draft, item = result?.items?.[0];
        if (locationRound.current !== round || backend !== service.current || Number(live.raw) <= 0 || live.selected || live.type !== type || live.occurredAt) return;
        const pool = type === 'income' ? settingsRef.current.incomeCategories : settingsRef.current.categories;
        if (item?.categoryId && pool.some(category => category.id === item.categoryId)) editDraft({ selected:item.categoryId });
      }).catch(() => {});
    }, 700);
    return () => clearTimeout(timer);
  }, [draft.raw, draft.location, draft.selected, draft.type, draft.occurredAt, draft.currency, draft.currencyManual, isRemote, config.aiEnabled, view, locationScope, settings.currency]);
  const pushKey = useCallback(key => {
    if (busyRef.current || !state.current.ready) return;
    const current = state.current.draft.raw, currency = state.current.draft.currency || settingsRef.current.currency, digits = CURRENCIES[currency].digits;
    let next = current;
    if (key === 'backspace') next = current.slice(0, -1) || '0';
    else if (key === 'clear') next = '0';
    else if (key === '.') { const term = current; if (digits && !term.includes('.')) next += '.'; else return; }
    else if (/^\d$/.test(key)) { const term = current, [whole, part] = term.split('.'); if (part !== undefined && part.length >= digits) return; if (part === undefined && whole.length >= 8) return; next = current === '0' ? key : current + key; }
    else return;
    if (next.length > 96) return;
    pending.current = null; state.current.draft = { ...state.current.draft, raw: next }; setDraft(current => ({ ...current, raw: next }));
    playKeySound(settingsRef.current.soundPack); haptic();
  }, []);
  // Keep the visual press state in sync for both pointer and physical
  // keyboard input.  The keypad buttons remain real HTML buttons so their
  // labels and focus behaviour stay accessible; this only toggles a transient
  // data attribute used by the tactile CSS.
  const setKeyVisual = useCallback((key, pressed, source = 'keyboard') => {
    const nodes = [...document.querySelectorAll('#keypad .key')];
    const node = nodes.find(item => item.dataset.key === key);
    if (pressed && (!node || node.disabled)) return;
    if (pressed && node) { node.dataset.input = source; node.setAttribute('data-pressed', 'true'); }
    else if (node?.dataset.input === source) node.removeAttribute('data-pressed');
    if (pressed) stageRef.current?.setAttribute('data-press', 'true');
    else if (!nodes.some(item => item.dataset.pressed === 'true')) stageRef.current?.removeAttribute('data-press');
  }, []);
  const submitWrite = useCallback(write => {
    const { payload, backend, scope } = write;
    if (pendingWrites.current.has(payload.id)) return;
    pendingWrites.current.set(payload.id, write); failedWrites.current.delete(payload.id); epoch.current++; setWriteCount(pendingWrites.current.size);
    persistOutbox();
    // The request runs independently, so the keypad stays ready for the next entry.
    void resolveExpenseLocation(payload, write.locationResolution).then(resolved => {
      write.payload = resolved;
      write.optimistic = { ...write.optimistic, location:resolved.location };
      persistOutbox();
      return backend.addExpense(resolved);
    }).then(entry => {
      const current = currentProfile.current;
      if (service.current === backend && `${current?.user.id}:${current?.ledgerId}` === scope) {
        const next = { ...current, expenses: [...current.expenses.filter(item => item.id !== payload.id), { ...entry, canDelete: true }] };
        currentProfile.current = next; setProfile(next);
      }
    }).catch(error => {
      failedWrites.current.set(payload.id, write);
      const current = currentProfile.current;
      if (service.current === backend && `${current?.user.id}:${current?.ledgerId}` === scope) {
        const next = { ...current, expenses: current.expenses.filter(item => item.id !== payload.id) };
        currentProfile.current = next; setProfile(next);
        notify(null, null, { error: error.message || 'errorSave', retryWrites: true });
      }
    }).finally(() => { pendingWrites.current.delete(payload.id); epoch.current++; setWriteCount(pendingWrites.current.size); persistOutbox(); });
  }, [notify, persistOutbox]);
  const retryWrites = useCallback(() => {
    const current = currentProfile.current, scope = `${current?.user.id}:${current?.ledgerId}`;
    const writes = [...failedWrites.current.values()].filter(write => write.scope === scope);
    if (!writes.length) return;
    const ids = new Set(current.expenses.map(entry => entry.id));
    const next = { ...current, expenses: [...current.expenses, ...writes.filter(write => !ids.has(write.payload.id)).map(write => write.optimistic)] };
    currentProfile.current = next; setProfile(next); setNotice(null);
    writes.forEach(write => { write.backend = service.current; submitWrite(write); });
  }, [submitWrite]);
  const save = useCallback(() => {
    const { draft: d, amountMinor, ready } = state.current;
    if (!ready || busyRef.current || !amountMinor || !d.selected || !currentProfile.current?.user.id) return;
    const before = currentProfile.current, backend = service.current, scope = `${before.user.id}:${before.ledgerId}`;
    const capture = activeCapture.current;
    const locationResolution = capture?.scope === scope && capture.occurredAt === d.occurredAt ? capture.resolution : undefined;
    if (locationResolution) capture.saved = true;
    const payload = { id: createId(), ledgerId: currentProfile.current.ledgerId, type: d.type, amountMinor, currency: d.currency || settingsRef.current.currency, location: normalizeLocation(d.location), categoryId: d.selected, consumer: before.user.id, note: d.note, occurredAt: d.occurredAt || new Date().toISOString(), timezone, ...(d.recurringId ? { recurringId:d.recurringId } : {}) };
    const pool = d.type === 'income' ? settingsRef.current.incomeCategories : settingsRef.current.categories;
    const category = pool.find(item => item.id === d.selected);
    const member = before.user;
    const occurredAt = payload.occurredAt || new Date().toISOString();
    const optimistic = { ...payload, occurredAt, createdAt: new Date().toISOString(), dayKey: dateKey(new Date(occurredAt), timezone), category: category ? structuredClone(category) : category, member: structuredClone(member), canDelete: false };
    const optimisticProfile = { ...before, expenses: [...before.expenses, optimistic] };
    currentProfile.current = optimisticProfile; setProfile(optimisticProfile);
    locationRound.current++; locationSuppressed.current = false; activeCapture.current = null; setLocationBusy(false);
    const remembered = lastLocation.current;
    const nextLocation = locationPreference(scope) && remembered?.scope === scope && Date.now() - remembered.at < 60000 ? remembered.location : undefined;
    const nextDraft = { ...blankDraft(), consumer: before.user.id, type: d.type, currency: d.currency, currencyManual: d.currencyManual, location:nextLocation };
    setLocationGeneration(value => value + 1);
    state.current.draft = nextDraft; state.current.amountMinor = 0; setDraft(nextDraft);
    setCelebration({ id: payload.id, type: d.type }); notify('savedShort'); haptic('success');
    submitWrite({ payload, optimistic, draft: d, backend, scope, locationResolution });
  }, [submitWrite, notify, timezone]);
  useEffect(() => {
    const keydown = e => {
      keyboard.current = true; document.documentElement.classList.add('keyboard-action');
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || document.querySelector('dialog[open]') || e.target.closest?.('input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"],[role="combobox"]')) return;
      if (e.key === 'Escape' && state.current.view !== 'record') { navigate('record'); return; }
      if (state.current.view !== 'record') return;
      const key = /^[0-9.,]$/.test(e.key) ? (e.key === ',' ? '.' : e.key) : e.key === 'Backspace' ? 'backspace' : e.key === 'Delete' ? 'clear' : null;
      if (key) { e.preventDefault(); keypadPointer.current?.cancel(); setKeyVisual(key, true); pushKey(key); }
      else if (e.key === 'Enter' && e.target === document.body) { e.preventDefault(); keypadPointer.current?.cancel(); save(); }
    };
    const keyup = e => {
      const key = /^[0-9.,]$/.test(e.key) ? (e.key === ',' ? '.' : e.key) : e.key === 'Backspace' ? 'backspace' : e.key === 'Delete' ? 'clear' : null;
      if (key) setKeyVisual(key, false);
      keyboard.current = false; document.documentElement.classList.remove('keyboard-action');
    };
    const pointer = () => { keyboard.current = false; document.documentElement.classList.remove('keyboard-action'); };
    const release = () => {
      keyboard.current = false; document.documentElement.classList.remove('keyboard-action');
      stageRef.current?.removeAttribute('data-press');
      document.querySelectorAll('.key[data-pressed="true"]').forEach(node => node.removeAttribute('data-pressed'));
    };
    const hidden = () => { if (document.hidden) release(); };
    document.addEventListener('keydown', keydown); document.addEventListener('keyup', keyup); document.addEventListener('pointerdown', pointer); document.addEventListener('visibilitychange', hidden); window.addEventListener('blur', release);
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('keyup', keyup); document.removeEventListener('pointerdown', pointer); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('blur', release); };
  }, [pushKey, save, navigate, setKeyVisual]);
  function updateSettings(patch) {
    const before = currentProfile.current, backend = service.current;
    const scope = `${before.user.id}:${before.ledgerId}`, id = createId();
    const next = validateSettings({ ...settingsRef.current, ...patch, ...(patch.language ? { languageManual: true } : {}) });
    settingWrites.current.set(scope, { id, settings: next, backend }); epoch.current++;
    apply({ ...before, settings: next });
    // Serialize settings so rapid language/currency changes cannot arrive out of order.
    settingQueue.current = settingQueue.current.catch(() => {}).then(async () => {
      try {
        const result = await backend.saveSettings(next, before.ledgerId);
        confirmedSettings.current.set(scope, validateSettings(result.settings));
        if (settingWrites.current.get(scope)?.id !== id) return;
        settingWrites.current.delete(scope);
        const current = currentProfile.current;
        if (backend === service.current && `${current?.user.id}:${current?.ledgerId}` === scope) apply({ ...result, expenses: current.expenses });
      } catch (error) {
        if (settingWrites.current.get(scope)?.id !== id) return;
        settingWrites.current.delete(scope);
        const current = currentProfile.current;
        if (backend === service.current && `${current?.user.id}:${current?.ledgerId}` === scope) {
          apply({ ...current, settings: confirmedSettings.current.get(scope) || before.settings }); showError(error);
        }
      } finally { epoch.current++; }
    });
  }
  const startEditing = () => { setEditingType(draft.type); setEditing(structuredClone(categories)); navigate('manage'); };
  async function saveCategories(e) {
    e.preventDefault();
    const backend = service.current, scope = currentProfile.current.ledgerId;
    const categoryPatch = { [editingType === 'income' ? 'incomeCategories' : 'categories']: structuredClone(editing) };
    const p = await run(async () => {
      await settingQueue.current;
      if (backend !== service.current || currentProfile.current.ledgerId !== scope) throw new Error('errorLedgerChanged');
      return backend.saveSettings({ ...settingsRef.current, ...categoryPatch }, scope);
    }, 'categoriesSaved');
    if (p) navigate('record');
  }
  const switchCircle = async id => { const p = await run(() => service.current.switchCircle(id)); if (p) { setPicker(false); navigate('record'); } };
  const copy = async value => { try { await navigator.clipboard.writeText(value); notify('codeCopied'); } catch { showError(new Error('errorCopy')); } };
  async function login(credential) {
    const backend = isRemote ? service.current : remoteService(telegram);
    const res = await run(() => backend.loginWithGoogle(credential, isRemote, settingsRef.current.language));
    if (res?.profile) { service.current = backend; setRemote(true); apply(res.profile); notify('savedShort'); }
    return res;
  }
  async function logout() { const result = await run(() => service.current.logout()); if (result !== null) { service.current = localService(language); setRemote(false); apply(await service.current.getProfile()); } }
  function mutateEntry(entry, optimistic, request) {
    const p = currentProfile.current, backend = service.current, scope = p.user.id + ':' + p.ledgerId;
    return entryOperations.current.enqueue({ key:scope + ':' + entry.id, id:entry.id, backend, scope, optimistic, fallback:p.expenses.find(item => item.id === entry.id) || null, request:() => request(backend, p.ledgerId) });
  }
  function removeEntry(entry) {
    if (!entry || entry.canDelete === false) return;
    const p = currentProfile.current, backend = service.current;
    void mutateEntry(entry, null, (service, ledgerId) => service.deleteExpense(entry.id, ledgerId));
    notify('removed', null, { undoId:entry.id, undoEntry:entry, undoBackend:backend, undoScope:p.user.id + ':' + p.ledgerId });
  }
  function undo() {
    const p = currentProfile.current, entry = notice?.undoEntry;
    if (!entry || service.current !== notice.undoBackend || notice.undoScope !== p.user.id + ':' + p.ledgerId) return;
    void mutateEntry(entry, entry, (service, ledgerId) => service.restoreExpense(entry.id, ledgerId));
    notify('restored'); haptic();
  }
  function commitEntryEdit(patch) {
    const entry = editingEntry;
    if (!entry || entry.canDelete === false) return;
    const pool = entry.type === 'income' ? settingsRef.current.incomeCategories : settingsRef.current.categories;
    const optimistic = { ...entry, ...patch, category:pool.find(c => c.id === patch.categoryId) || entry.category, member:settingsRef.current.consumers.find(c => c.id === patch.consumer) || entry.member };
    void mutateEntry(entry, optimistic, (service, ledgerId) => service.updateExpense(entry.id, patch, ledgerId));
    setEditingEntry(null); notify('savedShort'); haptic('success');
  }
  const fillFromEntry = useCallback((entry) => {
    if (!entry) return;
    setEditingEntry(null);
    // Copy the purchase, not a historical GPS fix. The new entry gets its own
    // foreground acquisition when automatic location is enabled.
    locationSuppressed.current = false;
    editDraft({ raw:minorToRaw(entry.amountMinor, entry.currency), currency:entry.currency, currencyManual:true, selected:entry.categoryId, consumer:entry.consumer, type:entry.type || 'expense', note:entry.note || '', occurredAt:null, location:undefined, recurringId:undefined });
    setLocationGeneration(value => value + 1);
    navigate('record');
    haptic();
  }, [navigate]);
  async function saveTime(occurredAt) {
    if (!timeEditor.entry) { locationRound.current++; locationSuppressed.current = Boolean(occurredAt); activeCapture.current = null; setLocationBusy(false); locationClient.current.clear(); editDraft({ occurredAt, location:undefined, suggestedCurrency:undefined }); setTimeEditor(null); return; }
    const entry = await run(() => service.current.updateEntryTime(timeEditor.entry.id, { occurredAt, timezone }, timeEditor.ledgerId));
    if (entry) {
      const p = { ...currentProfile.current, expenses: currentProfile.current.expenses.map(e => e.id === entry.id ? { ...entry, canDelete: e.canDelete } : e) };
      currentProfile.current = p; setProfile(p); setTimeEditor(null); notify('timeSaved');
    }
  }
  const handleAiImported = useCallback(saved => {
    const entries = Array.isArray(saved) ? saved.filter(Boolean) : [];
    if (!entries.length || !currentProfile.current) return;
    const existing = new Set(currentProfile.current.expenses.map(entry => entry.id));
    const next = { ...currentProfile.current, expenses: [...currentProfile.current.expenses, ...entries.filter(entry => !existing.has(entry.id))] };
    currentProfile.current = next;
    setProfile(next);
  }, []);
  const applyClipboard = () => {
    if (!clipboardSuggestion) return;
    editDraft({ raw:clipboardSuggestion.raw, currency:clipboardSuggestion.currency, currencyManual:true, note:clipboardSuggestion.note || draft.note });
    setClipboardSuggestion(null); haptic();
  };
  const monthPrefix = today.slice(0, 7), dueRecurring = useMemo(() => (settings.recurringExpenses || []).filter(item => {
    if (Number(new Intl.DateTimeFormat('en', { timeZone:timezone, day:'numeric' }).format(clock)) < Number(item.day)) return false;
    return !expenses.some(entry => entry.recurringId === item.id && String(entry.dayKey || '').startsWith(monthPrefix));
  }), [settings.recurringExpenses, expenses, timezone, clock, monthPrefix]);
  const applyRecurring = item => {
    editDraft({ raw:minorToRaw(item.amountMinor, item.currency), currency:item.currency, currencyManual:true, selected:item.categoryId, consumer:item.consumer, note:item.note || '', type:'expense', recurringId:item.id, occurredAt:null });
    haptic();
  };
  const exportPostcard = () => {
    try {
      const canvas = document.createElement('canvas'), scale = 2, width = 720, height = 980;
      canvas.width = width * scale; canvas.height = height * scale;
      const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#fffdf6'; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#343a30'; ctx.font = '800 30px system-ui'; ctx.fillText(`${t('postcardTitle')} · ${monthPrefix}`, 48, 72);
      ctx.fillStyle = '#f4e1c8'; ctx.beginPath(); ctx.roundRect(48, 106, width - 96, 160, 26); ctx.fill();
      ctx.fillStyle = '#4a503f'; ctx.font = '900 54px system-ui'; ctx.fillText(money(historyExpense, historyCurrency), 72, 178);
      ctx.font = '600 16px system-ui'; ctx.fillText(`${history.length} · ${t('postcardRecords')}`, 74, 214);
      ctx.font = '34px system-ui'; ctx.fillText('☁', width - 130, 178);
      let y = 326; const grouped = new Map();
      for (const entry of history.slice(0, 12)) { const label = categoryLabel(entry.category, settings.language); grouped.set(label, (grouped.get(label) || 0) + 1); }
      ctx.fillStyle = '#818d72'; ctx.font = '800 16px system-ui'; ctx.fillText(t('postcardStamps'), 48, y); y += 38;
      ctx.fillStyle = '#4a503f'; ctx.font = '700 20px system-ui';
      for (const [label, count] of grouped) { ctx.fillText(`•  ${label}  ×${count}`, 72, y); y += 34; if (y > 650) break; }
      ctx.fillStyle = '#9b6b55'; ctx.font = 'italic 18px system-ui'; ctx.fillText(t('postcardLine'), 48, 850);
      ctx.fillStyle = '#9da890'; ctx.font = '600 14px system-ui'; ctx.fillText('for. pocket', 48, 910);
      setPostcard(canvas.toDataURL('image/png')); haptic();
    } catch { notify(null, null, { error:'errorSave' }); }
  };
  const todayEntries = expenses.filter(e => e.dayKey === today && e.currency === settings.currency);
  const total = (list, type) => list.filter(e => isBudgetEntry(e) && (e.type || 'expense') === type).reduce((sum, e) => sum + e.amountMinor, 0);
  const todayExpense = total(todayEntries, 'expense'), todayIncome = total(todayEntries, 'income');
  const categoryKey = e => `${e.type || 'expense'}:${e.category?.id || e.categoryId}`;
  const historyCategories = useMemo(() => {
    const options = new Map();
    for (const [type, pool] of [['expense',settings.categories],['income',settings.incomeCategories]]) {
      for (const category of pool) options.set(`${type}:${category.id}`, { key:`${type}:${category.id}`, type, category });
    }
    for (const e of expenses) if (e.category?.id && !options.has(categoryKey(e))) options.set(categoryKey(e), { key:categoryKey(e), type:e.type || 'expense', category:e.category });
    return [...options.values()];
  }, [settings.categories, settings.incomeCategories, expenses]);
  const history = useMemo(() => expenses.filter(e => e.currency === historyCurrency
    && (historyCategory === 'all' || categoryKey(e) === historyCategory)
    && (period === 'all' || e.dayKey.startsWith(today.slice(0,7))))
    .sort((a,b) => (b.occurredAt || b.createdAt).localeCompare(a.occurredAt || a.createdAt)), [expenses, historyCurrency, historyCategory, period, today]);
  const historyExpense = total(history, 'expense'), historyIncome = total(history, 'income');
  const historyMonthLabel = useMemo(() => new Intl.DateTimeFormat(locale, { month:'short', timeZone:'UTC' }).format(new Date(`${today}T12:00:00Z`)), [today, locale]);
  const days = [...new Set(history.map(e => e.dayKey))];
  const mascotEnvironment = resolveMascotEnvironment(weather, clock, timezone);
  const keypadKeys = ['1','2','3','4','5','6','7','8','9',digits ? '.' : 'clear','0','backspace'];
  const saveLabel = t(busy ? 'saving' : !amountMinor ? 'enterAmount' : !draft.selected ? 'selectCategory' : draft.type === 'income' ? 'saveIncome' : 'save');
  const storageStatus = <div className="storage-state"><span id="storage-status" role="status">{t(failed ? 'unavailable' : !ready ? 'loading' : syncFailed ? 'syncFailed' : isRemote ? 'remoteStorage' : 'localStorage')}</span>{failed && <Button mode="plain" size="s" onClick={() => setRetryCount(n => n + 1)}>{t('retry')}</Button>}</div>;
  const secondary = !['record','history'].includes(view);
  const titleKey = { record: draft.type === 'income' ? 'incomeTitle' : 'recordTitle', history: 'historyTitle', settings: 'settingsTitle', profile: 'myProfile', account: 'accountTitle', circles: 'circlesTitle', manage: 'manageTitle', recurring: 'recurringTitle', 'ai-import': 'aiImportTitle' }[view];
  return <AppRoot appearance="light" platform={['ios','macos'].includes(telegram?.platform) ? 'ios' : 'base'} className="for-root" data-ui-kit="telegram-ui" data-view={view}><div className="app-shell">
    <header className="app-header"><a className="brand" href="#record" aria-label={t('record')} onClick={e => { e.preventDefault(); navigate('record'); }}><Icon name="home"/></a>
      <Button id="circle-switcher" mode="plain" className="ledger-switcher" disabled={disabled} onClick={() => isRemote ? setPicker(true) : navigate('circles')}><span>{circle?.name || t('personal')}</span><Icon name="chevronDown"/></Button>
      {view !== 'record' && view !== 'history' && !['settings','profile','account'].includes(view) && isRemote && circle && <div ref={setReactionHost} className="circle-presence-host app-header-reactions" aria-label={t('circlePeople')}/>}
      <Button className="profile-trigger" mode="plain" id="open-settings" aria-label={t('settingsTitle')} onClick={() => navigate('settings')} disabled={busy}><Avatar person={profile?.user}/></Button>
    </header>

    {failedCount > 0 && <button type="button" className="sync-retry-banner" onClick={retryWrites}>{t('retryUnconfirmed', { n: failedCount })}</button>}<main key={view} ref={pageRef} id={`${view}-view`} className="page">{view !== 'record' && view !== 'history' && <div className="page-heading"><h1 id={`${view}-title`} tabIndex={-1}>{t(titleKey)}</h1>{secondary && <Button mode="plain" size="s" className="text-button" onClick={() => navigate(view === 'settings' ? 'record' : 'settings')}>{t('back')}</Button>}</div>}
    {view === 'record' && <><div className="today-strip"><span className="today-icon" aria-hidden="true"><Icon name="arrowDown"/></span><div><span>{t('todayTotal')}</span><strong id="today-total">{money(todayExpense)}</strong></div><Button id="edit-draft-time" mode="plain" className={`date-label date-button ${draft.occurredAt ? 'has-custom-time' : ''}`} aria-label={t('editEntryTime')} disabled={disabled} onClick={() => setTimeEditor({})}><Icon name="clock"/>{new Intl.DateTimeFormat(locale, { month:'short',day:'numeric', ...(draft.occurredAt ? { hour:'2-digit',minute:'2-digit',hourCycle:'h23' } : {}) }).format(new Date(draft.occurredAt || Date.now()))}</Button><Button id="open-ai-import" mode="plain" className="ai-quick-trigger" aria-label={t('aiImportTitle')} title={t('aiImportTitle')} disabled={busy} onClick={() => navigate('ai-import')}><Icon name="receipt"/></Button></div>{clipboardSuggestion && <button type="button" className="clipboard-capsule" onClick={applyClipboard}><Icon name="clip"/><span>{t('clipboardFound',{ amount:money(clipboardSuggestion.amountMinor, clipboardSuggestion.currency) })}</span><b>{t('clipboardFill')}</b></button>}{dueRecurring.length > 0 && <div className="recurring-due" role="status"><span>{t('recurringDue',{ n:dueRecurring.length })}</span><div>{dueRecurring.slice(0,2).map(item => <button type="button" key={item.id} onClick={() => applyRecurring(item)}>{categoryDisplayLabel(categories.find(c => c.id === item.categoryId) || {}, settings.language)} · {money(item.amountMinor,item.currency)}</button>)}</div></div>}<div className="record-layout"><section ref={stageRef} className={`amount-stage ${draft.raw.length >= 6 ? 'long-amount' : ''} ${draft.type === 'income' ? 'is-income' : ''}`} aria-label={t('amountInput')}><div className="amount-meta"><div className="type-toggle-pill" role="group" aria-label={t('transactionType')}>{['expense','income'].map(type => <Tappable Component="button" type="button" key={type} className={`type-pill-btn ${draft.type === type ? `active type-${type}` : ''}`} aria-pressed={draft.type === type} disabled={disabled} onClick={() => { editDraft({ type, selected:null }); haptic(); }}>{t(type)}</Tappable>)}</div><Select id="currency" className="currency-control" aria-label={t('currency')} value={draftCurrency} data-suggested={Boolean(draft.suggestedCurrency === draftCurrency && !draft.currencyManual)} title={draft.suggestedCurrency ? `${t('locationCurrency')} · ${draft.suggestedCurrency}` : t('currency')} disabled={disabled} onChange={e => { const currency=e.target.value; editDraft({ currency, currencyManual:true, raw:currency === 'JPY' ? draft.raw.replace(/\.[^+]+/g,'').replace(/\.$/,'') : draft.raw }); }}>{Object.keys(CURRENCIES).map(c => <option key={c} value={c}>{c}{draft.suggestedCurrency === c && draftCurrency !== c ? ` · ${t('locationCurrency')}` : ''}</option>)}</Select></div><div className="amount-line"><span className="currency-symbol">{draft.type === 'income' ? '+' : ''}{CURRENCIES[draftCurrency].symbol}</span><output id="amount-display" data-length={draft.raw.length < 6 ? 'short' : draft.raw.length > 9 ? 'long' : draft.raw.length} aria-label={t('currentAmount')} style={{ '--amount-chars':amount.length }}>{amount}</output><span className="input-caret" aria-hidden="true"/></div><div className="amount-bottom"><span>{(draft.selected ? categoryDisplayLabel(categories.find(c => c.id === draft.selected) || {}, settings.language) : '')}</span>{ratePreview && <small className="rate-preview">≈ {money(ratePreview.minor, ratePreview.currency)}</small>}</div><PocketMascot mascotRef={mascotRef} t={t} environment={mascotEnvironment} onTap={haptic} canConfirm={Boolean(!disabled && amountMinor && draft.selected && draft.consumer)} busy={busy} celebrate={celebration} confirmLabel={saveLabel} onConfirm={save}/></section>
      <section className="purposes"><div className="section-heading"><h2>{t('categories')}</h2>{(!circle || circle.isAdmin) && <Button className="text-button" id="edit-categories" mode="plain" size="s" disabled={disabled} onClick={startEditing}>{t('editCategories')}</Button>}</div><Categories categories={orderedCategories} lang={settings.language} selected={draft.selected} disabled={disabled} onSelect={id => { editDraft({ selected:id }); haptic(); }}/></section>
       <section id="keypad" className="keypad" aria-label={t('keypad')}>{keypadKeys.map((key,index) => <KeypadButton key={key+'-'+index} keyValue={key} label={key === 'clear' ? t('clear') : key === 'backspace' ? t('backspace') : key === '.' ? t('decimal') : key} disabled={disabled} secondary={['clear','backspace','.'].includes(key)} contextKey={[draftCurrency,draft.type,settings.theme].join(':')} pointerSession={keypadPointer} onInput={pushKey} onVisualChange={setKeyVisual}>{key === 'clear' ? 'C' : key === 'backspace' ? <Icon name="backspace"/> : key === '.' ? decimal : key}</KeypadButton>)}</section>
      <section className="finish" aria-label={t('save')}><div className="entry-actions">{isRemote && circle && <div ref={setReactionHost} className="circle-presence-host"/>}<Button id="entry-location" mode="plain" className={`location-trigger ${draft.location ? 'has-location' : ''}`} aria-label={t('locationTitle')} aria-pressed={Boolean(draft.location)} title={locationLabel(draft.location) || t('locationTitle')} disabled={disabled} onClick={() => setLocationSheet(true)}><Icon name="pin"/></Button><Button id="edit-note" mode="plain" className={`note-trigger ${draft.note ? "has-note" : ""}`} aria-label={t('note')} title={draft.note || t('note')} disabled={disabled} onClick={() => setNoteEditor(true)}><Icon name="edit"/></Button></div></section></div>
      </>}
    {view === 'history' && <><div className="history-title-bar"><h1 id="history-title" tabIndex={-1}>{t('ledger')}</h1><div className="history-controls history-toolbar">
      <select id="history-period" aria-label={t('period')} value={period} onChange={e => setPeriod(e.target.value)}>{['month','all'].map(p => <option key={p} value={p}>{p === 'month' ? historyMonthLabel : t('allCategoriesShort')}</option>)}</select>
      <select id="history-category" aria-label={t('categoryFilter')} value={historyCategory} onChange={e => setHistoryCategory(e.target.value)}><option value="all">{t('allCategoriesShort')}</option>{['expense','income'].map(type => <optgroup key={type} label={t(type)}>{historyCategories.filter(option => option.type === type).map(option => <option key={option.key} value={option.key}>{categoryDisplayLabel(option.category,settings.language)}</option>)}</optgroup>)}</select>
      <select id="history-currency" aria-label={t('ledgerCurrency')} value={historyCurrency} onChange={e => setHistoryCurrency(e.target.value)}>{Object.keys(CURRENCIES).map(c => <option key={c}>{c}</option>)}</select>
      <button type="button" id="history-quick-entry" className="postcard-button" onClick={() => navigate('ai-import')} aria-label={t('aiImportTitle')} title={t('aiImportTitle')}><Icon name="receipt"/></button>
    </div></div><section className="history-summary"><div className="history-summary-amount"><span>{t('netBalance')}</span><strong id="history-total">{money(historyIncome - historyExpense, historyCurrency)}</strong><div className="history-summary-tools"><small id="history-total-count">{countText(history.length, settings.language, historyCurrency)}</small><button type="button" className="postcard-export" onClick={exportPostcard} aria-label={t('postcardExport')} title={t('postcardExport')}><CandidateIcon name="export-envelope-tactile-v1"/></button></div></div><div className="balance-details"><div><span>{t('expense')}</span><strong>{money(historyExpense,historyCurrency)}</strong></div><div><span>{t('income')}</span><strong className="income-value">+{money(historyIncome,historyCurrency)}</strong></div></div></section><AiSummary t={t} profile={profile} settings={settings} currency={historyCurrency} busy={busy} run={run} service={service.current} isRemote={isRemote} config={config} onAccount={() => navigate('account')}/><div className="history-list">{!history.length && <LedgerEmptyState ready={ready} failed={failed || syncFailed} filtered={expenses.length > 0 || historyCategory !== 'all' || historyCurrency !== settings.currency} t={t} onRetry={() => setRetryCount(n => n + 1)} onRecord={() => navigate('record')}/>} {days.map(day => <section key={day}><div className="history-day">{day === today ? t('today') : new Intl.DateTimeFormat(locale,{ timeZone:'UTC',month:'short',day:'numeric' }).format(new Date(`${day}T12:00:00Z`))}</div>{history.filter(e => e.dayKey === day).map(e => <SwipeExpenseRow key={e.id} entry={e} t={t} onDelete={removeEntry} onCopy={fillFromEntry} onEdit={entry => { if (entry.canDelete !== false) setEditingEntry(entry); }}><Cell Component="article" readOnly multiline key={e.id} className={`expense-row ${e.type === 'income' ? 'is-income' : ''}`} before={<span className="category-icon" style={{ background:`var(--${e.category.color})` }}><Icon name={e.category.icon}/></span>} subtitle={<span className="expense-meta"><span className={`consumer-badge consumer-color-${e.member?.color || 'blue'}`}><i/>{e.member?.name || settings.consumers.find(c => c.id === e.consumer)?.name || t('unknownConsumer')}</span><button type="button" className="entry-time" aria-label={t('editEntryTime')} disabled={busy || e.canDelete === false} onClick={() => setTimeEditor({ entry:e, ledgerId:profile.ledgerId })}><time dateTime={e.occurredAt || e.createdAt}>{new Intl.DateTimeFormat(locale,{timeZone:e.timezone || timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(e.occurredAt || e.createdAt))}</time></button></span>} description={e.note ? <span className="expense-description"><span className="expense-note">{e.note}</span></span> : undefined} after={<div className="expense-actions"><span className="expense-money">{e.type === 'income' ? '+' : '−'}{money(e.amountMinor,e.currency)}</span><Button className="entry-more" mode="plain" size="s" aria-label={t('entryActions')} onClick={() => document.dispatchEvent(new CustomEvent('pocket:entry-actions', { detail:e.id }))}><Icon name="more"/></Button></div>}><strong>{categoryDisplayLabel(e.category,settings.language)}</strong>{!isBudgetEntry(e) && <small className="entry-kind">{t(e.recordKind === 'transfer' ? 'recordKindTransfer' : 'recordKindReimbursement')}</small>}</Cell></SwipeExpenseRow>)}</section>)}</div><div className="today-balance"><span>{t('todayBalance')}</span><strong>{money(todayIncome - todayExpense)}</strong></div></>}
    {view === 'settings' && <SettingsPage profile={profile} settings={settings} t={t} ready={ready} disabled={disabled} navigate={navigate} updateSettings={updateSettings} onLocation={() => setLocationSheet(true)} locationEnabled={locationEnabled}/>}
    {view === 'recurring' && <RecurringEditor settings={settings} categories={settings.categories} t={t} updateSettings={updateSettings} disabled={disabled}/>}
    {view === 'profile' && profile && <ProfileEditor key={profile.user.id} user={profile.user} t={t} busy={busy} run={run} service={service.current}/>}
    {view === 'account' && profile && <AccountPage t={t} profile={profile} isRemote={isRemote} config={config} language={settings.language} busy={busy} run={run} service={service.current} onGoogle={login} onLogout={logout} copy={copy} failedCount={failedCount} onRetryWrites={retryWrites}/>}
    {view === 'circles' && profile && <CirclesPage t={t} profile={profile} busy={busy} isRemote={isRemote} run={run} service={service.current} onAccount={() => navigate('account')} onSwitch={switchCircle} copy={copy}/>}
    {view === 'ai-import' && profile && <AiImportPage t={t} profile={profile} settings={settings} busy={busy} run={run} service={service.current} isRemote={isRemote} config={config} onAccount={() => navigate('account')} onImported={handleAiImported}/>}
    {view === 'manage' && <><CategorySuggestions categories={settings.categories} expenses={expenses} ledgerId={profile?.ledgerId} type="expense" language={settings.language} disabled={busy || editing.length >= MAX_CATEGORIES} onAdd={({ label, icon, color }) => { if (editing.some(item => item.label.trim() === label) || editing.length >= MAX_CATEGORIES) return; setEditing(items => [...items, { id:createId(), label, icon, color }]); haptic(); }} /><form id="category-form" onSubmit={saveCategories}><div className="category-editor">{editing.map(c => <div className="editor-row" key={c.id} data-expanded={editingCategoryId === c.id}><Tappable Component="button" type="button" className="category-icon editor-icon-trigger" style={{background:`var(--${c.color})`}} aria-label={t('categoryIcon',{name:categoryLabel(c,settings.language)})} aria-expanded={editingCategoryId === c.id} onClick={() => setEditingCategoryId(current => current === c.id ? null : c.id)}><Icon name={c.icon}/><Icon name="chevronDown"/></Tappable><Input className="editor-label" aria-label={t('categoryName',{name:categoryLabel(c,settings.language)})} value={c.label} maxLength={24} required onChange={e => setEditing(items => items.map(x => x.id === c.id ? {...x,label:e.target.value} : x))}/><Select className="editor-select" data-field="icon" aria-label={t('categoryIcon',{name:c.label})} value={c.icon} onChange={e => setEditing(items => items.map(x => x.id === c.id ? {...x,icon:e.target.value} : x))}>{ICONS.filter(icon => !['google','users'].includes(icon)).map(icon => <option key={icon} value={icon}>{t(icon)}</option>)}</Select><Select className="editor-select" data-field="color" aria-label={t('categoryColor',{name:c.label})} value={c.color} onChange={e => setEditing(items => items.map(x => x.id === c.id ? {...x,color:e.target.value} : x))}>{COLORS.map(color => <option key={color} value={color}>{t(color)}</option>)}</Select><Button type="button" className="editor-remove" mode="plain" aria-label={t('removeCategory',{name:c.label})} onClick={() => editing.length > 1 ? setEditing(items => items.filter(x => x.id !== c.id)) : notify('keepCategory')}>×</Button></div>)}</div><Button type="button" id="add-category" className="add-category" stretched mode="outline" disabled={editing.length >= MAX_CATEGORIES || busy} onClick={() => setEditing(items => [...items,{id:createId(),label:'',icon:'heart',color:'peach'}])}>{t('addCategory')}</Button><div className="editor-actions"><Button type="button" className="text-button" mode="plain" onClick={() => setEditing(structuredClone(editingType === 'income' ? DEFAULT_INCOME_CATEGORIES : DEFAULT_CATEGORIES))}>{t('resetCategories')}</Button><Button className="save-button" type="submit" disabled={busy}>{t('saveCategories')}</Button></div></form></>}
    </main>{view !== 'record' && <footer className="app-footer">{storageStatus}</footer>}<nav className="bottom-nav" aria-label={t('navigation')}><SegmentedControl className="view-tabs" aria-label={t('navigation')}>{['record','history'].map(v => <SegmentedControl.Item key={v} className="tab" data-view={v} selected={view === v} aria-selected={view === v} onClick={() => navigate(v)}>{t(v === 'record' ? 'record' : 'ledger')}</SegmentedControl.Item>)}</SegmentedControl></nav>
    </div>{isRemote && circle && <CircleReactions key={`${circle.id}:${profile.user.id}`} circle={circle} ledgerId={profile.ledgerId} userId={profile.user.id} entryTarget={reactionHost} service={service.current} t={t} onSelf={() => navigate('profile')} onHaptic={haptic} disabled={disabled}/>}{picker && profile && <CirclePicker profile={profile} t={t} busy={busy} onSwitch={switchCircle} onManage={() => navigate('circles')} onClose={() => setPicker(false)}/>}
    {postcard && <Sheet title={t('postcardTitle')} onClose={() => setPostcard(null)}><img className="postcard-preview" src={postcard} alt={t('postcardTitle')}/><div className="postcard-download-row"><PocketIllustration name="export-envelope-tactile-v1" compact/><a className="postcard-download" href={postcard} download={`for-pocket-${monthPrefix}.png`}>{t('postcardExport')}</a></div></Sheet>}
    {locationSheet && <LocationSheet t={t} location={draft.location} enabled={locationEnabled} loading={locationBusy} onCapture={useLocation} onRemove={() => removeLocation()} onDisable={() => removeLocation(true)} onClose={() => setLocationSheet(false)}/>}
    {noteEditor && <Sheet title={t('note')} onClose={() => setNoteEditor(false)}><form className="note-form" onSubmit={e => { e.preventDefault(); setNoteEditor(false); }}><Input id="note" className="note-field" autoFocus aria-label={t('note')} placeholder={t('notePlaceholder')} value={draft.note} maxLength={160} disabled={disabled} onChange={e => editDraft({ note:e.target.value })}/><Button type="submit" className="compact-save" aria-label={t('confirm')}><Icon name="check"/></Button></form></Sheet>}
    {editingEntry && <ExpenseEditor entry={editingEntry} settings={settings} t={t} onClose={() => setEditingEntry(null)} onSave={commitEntryEdit}/> }
    {timeEditor && <TimeEditor value={timeEditor.entry ? timeEditor.entry.occurredAt || timeEditor.entry.createdAt : draft.occurredAt} isDraft={!timeEditor.entry} t={t} busy={busy} onSave={saveTime} onClose={() => setTimeEditor(null)}/>}
    {notice && <Snackbar className={`notice ${notice.error ? 'error' : ''}`} key={notice.id} role="status" duration={notice.error || notice.undoId ? 2147480000 : 2200} onClose={() => setNotice(current => current?.id === notice.id ? null : current)} after={<span className="notice-actions">{notice.retryWrites && <Snackbar.Button onClick={retryWrites}>{t('retry')}</Snackbar.Button>}{notice.undoId && <Snackbar.Button id="undo-button" onClick={undo}>{t('undo')}</Snackbar.Button>}<Snackbar.Button id="dismiss-notice" aria-label={t('closeNotice')} onClick={() => setNotice(null)}>×</Snackbar.Button></span>}><span id="notice-text">{notice.error ? translateError(notice.error,settings.language) : t(notice.key,notice.values)}</span></Snackbar>}
  </AppRoot>;
}

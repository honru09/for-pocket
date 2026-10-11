import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppRoot, Button, Cell, Input, Placeholder, SegmentedControl, Select, Snackbar, Tappable } from '@telegram-apps/telegram-ui';
import { CURRENCIES, COLORS, ICONS, DEFAULT_CATEGORIES, DEFAULT_INCOME_CATEGORIES, MAX_CATEGORIES, sortCategoriesByUsage, initialSettings, validateSettings, dateKey, resolveLanguage, isBudgetEntry } from '../public/shared.mjs';
import { LOCALES, translate, translateError, categoryLabel, categoryDisplayLabel } from '../public/i18n.mjs';
import { PREVIEW_KEY, SESSION_KEY, localService, remoteService } from './services.mjs';
import { Avatar, CirclePicker, ProfileEditor, AccountPage, CirclesPage, Sheet } from './AccountViews.jsx';
import AiImportPage from './AiImportPage.jsx';
import AiSummary from './AiSummary.jsx';
import { Icon } from './icons.jsx';
import PocketMascot from './PocketMascot.jsx';
import TimeEditor from './TimeEditor.jsx';
import usePocketViewport from './usePocketViewport.js';
import { createId } from './id.mjs';
import { normalizeLocation, currencyForCountry, locationLabel, summarizeFootprints } from '../public/location.mjs';
import { createLocationClient, locationPreference } from './location-client.mjs';
import { LocationSheet, Footprints } from './LocationViews.jsx';
import CategorySuggestions from './CategorySuggestions.jsx';
import { deviceTimezone } from '../public/timezone.mjs';
import { bindForegroundRefresh } from './foreground-refresh.mjs';

const telegram = window.Telegram?.WebApp;
const language = resolveLanguage(telegram?.initDataUnsafe?.user?.language_code || navigator.language);
const blankDraft = () => ({ raw: '0', selected: null, consumer: null, note: '', type: 'expense', occurredAt: null });
const OUTBOX_KEY = 'for-pocket.unconfirmed.v1';
function haptic(kind = 'selection') { try { if (!telegram?.isVersionAtLeast?.('6.1')) return; kind === 'success' ? telegram.HapticFeedback.notificationOccurred(kind) : telegram.HapticFeedback.selectionChanged(); } catch {} }
function countText(n, lang, currency) {
  const plural = new Intl.PluralRules(LOCALES[lang]).select(n);
  const unit = lang === 'zh' ? '笔' : lang === 'en' ? plural === 'one' ? 'entry' : 'entries' : ({ one: 'запис', few: 'записи', many: 'записів', other: 'записів' }[plural]);
  return `${n} ${unit} · ${currency}`;
}
const Categories = memo(function Categories({ categories, lang, selected, disabled, onSelect }) {
  const drawerRef = useRef(null), gesture = useRef(null);
  useEffect(() => {
    const drawer = drawerRef.current;
    const active = [...(drawer?.children || [])].find(node => node.dataset.category === selected);
    if (!active) return;
    const left = active.offsetLeft - drawer.offsetLeft, right = left + active.offsetWidth;
    if (left < drawer.scrollLeft + 4) drawer.scrollTo({ left:Math.max(0,left - 4), behavior:'smooth' });
    else if (right > drawer.scrollLeft + drawer.clientWidth - 4) drawer.scrollTo({ left:right - drawer.clientWidth + 4, behavior:'smooth' });
  }, [selected, categories]);
  const moved = event => {
    const start = gesture.current;
    if (start && (Math.abs(event.clientX - start.x) > 8 || Math.abs(event.clientY - start.y) > 8)) start.dragged = true;
  };
  return <div ref={drawerRef} className="categories category-drawer" id="categories" role="group" aria-label={translate(lang, 'categories')} onPointerDownCapture={event => { gesture.current = { x:event.clientX, y:event.clientY, dragged:false }; }} onPointerMoveCapture={moved} onPointerUpCapture={moved} onPointerCancelCapture={() => { if (gesture.current) gesture.current.dragged = true; }} onClickCapture={event => { if (gesture.current?.dragged && event.detail > 0) { event.preventDefault(); event.stopPropagation(); } gesture.current = null; }}>{categories.map(c => <Tappable Component="button" type="button" className={`category category-pill ${selected === c.id ? 'selected' : ''}`} key={c.id} data-category={c.id} aria-label={categoryDisplayLabel(c, lang)} aria-pressed={selected === c.id} disabled={disabled} onClick={() => onSelect(c.id)}><span className="category-icon" style={{ background: `var(--${c.color})` }}><Icon name={c.icon}/></span><span className="category-label">{categoryDisplayLabel(c, lang)}</span></Tappable>)}</div>;
});

export default function App() {
  usePocketViewport(telegram);
  const [timezone, setTimezone] = useState(() => deviceTimezone());
  const timezoneSync = useRef(null);
  const [profile, setProfile] = useState(null), [settings, setSettings] = useState(() => initialSettings(language));
  const [draft, setDraft] = useState(blankDraft), [view, setView] = useState('record'), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [isRemote, setRemote] = useState(false), [config, setConfig] = useState({}), [notice, setNotice] = useState(null), [failed, setFailed] = useState(false), [syncFailed, setSyncFailed] = useState(false);
  const [picker, setPicker] = useState(false), [period, setPeriod] = useState('month'), [historyCurrency, setHistoryCurrency] = useState('JPY');
  const [editing, setEditing] = useState([]), [editingType, setEditingType] = useState('expense'), [today, setToday] = useState(() => dateKey(new Date(), timezone));
  const [retryCount, setRetryCount] = useState(0), [celebration, setCelebration] = useState(null);
  const [writeCount, setWriteCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [timeEditor, setTimeEditor] = useState(null);
  const [noteEditor, setNoteEditor] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [historyCategory, setHistoryCategory] = useState('all');
  const [locationSheet, setLocationSheet] = useState(false), [locationEnabled, setLocationEnabled] = useState(false), [locationBusy, setLocationBusy] = useState(false);
  const locationClient = useRef(null), locationRound = useRef(0), locationSuppressed = useRef(false), activeCapture = useRef(null), suggestedPlace = useRef(null);
  if (!locationClient.current) locationClient.current = createLocationClient({ telegram });

  const service = useRef(null), busyRef = useRef(false), state = useRef({}), settingsRef = useRef(settings), currentProfile = useRef(null), pending = useRef(null), drafts = useRef(new Map());
  const pendingWrites = useRef(new Map()), failedWrites = useRef(new Map()), settingWrites = useRef(new Map()), settingQueue = useRef(Promise.resolve());
  const confirmedSettings = useRef(new Map());
  const pageRef = useRef(null), mascotRef = useRef(null), stageRef = useRef(null), keyboard = useRef(false), epoch = useRef(0);
  const t = useCallback((key, values) => translate(settings.language, key, values), [settings.language]);
  const locale = LOCALES[settings.language], disabled = busy || !ready;
  const draftCurrency = draft.currency || settings.currency;
  const digits = CURRENCIES[draftCurrency].digits, [integer, fraction] = draft.raw.split('.');
  const amountMinor = Number(integer) * 10 ** digits + Number((fraction || '').padEnd(digits, '0') || 0);
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1).find(p => p.type === 'decimal')?.value || '.';
  const amount = Number(integer).toLocaleString(locale) + (fraction !== undefined ? decimal + fraction : '');
  const money = (minor, currency = settings.currency) => new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: CURRENCIES[currency].digits, maximumFractionDigits: CURRENCIES[currency].digits }).format(minor / 10 ** CURRENCIES[currency].digits);
  const categories = draft.type === 'income' ? settings.incomeCategories : settings.categories;
  const expenses = profile?.expenses || [], circle = profile?.social.activeCircle;
  const orderedCategories = useMemo(() => sortCategoriesByUsage(categories, expenses, { type:draft.type }), [categories, expenses, draft.type]);
  state.current = { draft, ready, view, amountMinor, isRemote };
  const changeBusy = value => { busyRef.current = value; setBusy(value); };
  const notify = useCallback((key, values, extra = {}) => setNotice({ id: createId(), key, values, ...extra }), []);
  const showError = useCallback(error => notify(null, null, { error: error.message || 'errorSave' }), [notify]);
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
    const settingWrite = settingWrites.current.get(scope);
    if (!settingWrite) confirmedSettings.current.set(scope, validateSettings(p.settings));
    if (settingWrite?.backend === service.current) p.settings = { ...p.settings, ...settingWrite.settings, consumers: p.settings.consumers };
    const previous = currentProfile.current, next = validateSettings(p.settings);
    const currencyChanged = settingsRef.current.currency !== next.currency;
    const scopeChanged = previous?.ledgerId !== p.ledgerId || previous?.user.id !== p.user.id;
    if (scopeChanged) {
      setTimeEditor(null); setLocationSheet(false); setHistoryCategory('all');
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
        service.current = backend; setRemote(backend.getInvite !== undefined); apply(p); setReady(true);
      } catch (error) { if (!cancelled) { setFailed(true); showError(error); } }
    }
    boot();
    return () => { cancelled = true; };
  }, [apply, notify, showError, retryCount]);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false, refreshing = false;
    const refresh = async () => {
      if (document.hidden || busyRef.current || refreshing || pendingWrites.current.size || settingWrites.current.size) return;
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
    if (!before || activeCapture.current || (!explicit && (locationSuppressed.current || d.occurredAt))) return;
    const scope = `${before.user.id}:${before.ledgerId}`;
    if (!explicit && !locationPreference(scope)) return;
    const round = locationRound.current, request = {}, backend = service.current, occurredAt = d.occurredAt;
    const current = () => locationRound.current === round && service.current === backend
      && `${currentProfile.current?.user.id}:${currentProfile.current?.ledgerId}` === scope
      && state.current.draft.occurredAt === occurredAt && !locationSuppressed.current;
    activeCapture.current = request; setLocationBusy(true);
    try {
      const coords = await locationClient.current.capture({ allowPrompt: explicit, refresh: explicit || refresh });
      if (!coords || !current()) return;
      editDraft({ location: normalizeLocation(coords) });
      let resolved;
      try { resolved = await backend.resolveLocation(coords); } catch {}
      if (!current()) return;
      const location = normalizeLocation(resolved?.location) || normalizeLocation(coords);
      const currency = currencyForCountry(location?.countryCode);
      const live = state.current.draft;
      const canSuggest = currency && !live.currencyManual;
      const keepsAmount = !live.raw.includes('.') || CURRENCIES[currency || 'JPY'].digits > 0 || Number(live.raw.split('.')[1] || 0) === 0;
      editDraft({ location, suggestedCurrency:currency, ...(canSuggest && keepsAmount ? { currency, raw:CURRENCIES[currency].digits ? live.raw : live.raw.split('.')[0] } : {}) });
    } finally {
      if (activeCapture.current === request) { activeCapture.current = null; setLocationBusy(false); }
    }
  }, []);
  useEffect(() => {
    if (!ready || view !== 'record' || !locationEnabled) return;
    const refresh = () => { void captureLocation({ refresh:true }); };
    refresh();
    return bindForegroundRefresh({ telegram, refresh });
  }, [ready, view, locationEnabled, locationScope, captureLocation]);
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
    locationPreference(locationScope, true); setLocationEnabled(true);
    locationSuppressed.current = false; void captureLocation({ explicit:true });
  };
  const removeLocation = (disable = false) => {
    locationRound.current++; locationSuppressed.current = true; activeCapture.current = null; setLocationBusy(false); locationClient.current.clear();
    editDraft({ location:undefined, suggestedCurrency:undefined });
    if (disable) { locationPreference(locationScope, false); setLocationEnabled(false); locationClient.current.clear(); }
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
    const current = state.current.draft.raw, digits = CURRENCIES[state.current.draft.currency || settingsRef.current.currency].digits;
    let next = current;
    if (key === 'backspace') next = current.slice(0, -1) || '0';
    else if (key === 'clear') next = '0';
    else if (key === '.') { if (digits && !current.includes('.')) next += '.'; }
    else if (/^\d$/.test(key)) { const [whole, part] = current.split('.'); if (part !== undefined && part.length >= digits) return; if (part === undefined && whole.length >= 8) return; next = current === '0' ? key : current + key; }
    pending.current = null; state.current.draft = { ...state.current.draft, raw: next }; setDraft(current => ({ ...current, raw: next }));
  }, []);
  const submitWrite = useCallback(write => {
    const { payload, backend, scope } = write;
    if (pendingWrites.current.has(payload.id)) return;
    pendingWrites.current.set(payload.id, write); failedWrites.current.delete(payload.id); epoch.current++; setWriteCount(pendingWrites.current.size);
    persistOutbox();
    // The request runs independently, so the keypad stays ready for the next entry.
    void backend.addExpense(payload).then(entry => {
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
    if (!ready || busyRef.current || !amountMinor || !d.selected || !d.consumer) return;
    const payload = { id: createId(), ledgerId: currentProfile.current.ledgerId, type: d.type, amountMinor, currency: d.currency || settingsRef.current.currency, location: normalizeLocation(d.location), categoryId: d.selected, consumer: d.consumer, note: d.note, occurredAt: d.occurredAt || new Date().toISOString(), timezone };
    const before = currentProfile.current;
    const pool = d.type === 'income' ? settingsRef.current.incomeCategories : settingsRef.current.categories;
    const category = pool.find(item => item.id === d.selected);
    const member = settingsRef.current.consumers.find(item => item.id === d.consumer) || before.user;
    const occurredAt = payload.occurredAt || new Date().toISOString();
    const optimistic = { ...payload, occurredAt, createdAt: new Date().toISOString(), dayKey: dateKey(new Date(occurredAt), timezone), category: category ? structuredClone(category) : category, member: structuredClone(member), canDelete: false };
    const optimisticProfile = { ...before, expenses: [...before.expenses, optimistic] };
    currentProfile.current = optimisticProfile; setProfile(optimisticProfile);
    locationRound.current++; locationSuppressed.current = false; activeCapture.current = null; setLocationBusy(false);
    const nextDraft = { ...blankDraft(), consumer: before.user.id, type: d.type, currency: d.currency, currencyManual: d.currencyManual };
    state.current.draft = nextDraft; state.current.amountMinor = 0; setDraft(nextDraft);
    setCelebration({ id: payload.id, type: d.type }); notify('savedShort'); haptic('success');
    submitWrite({ payload, optimistic, draft: d, backend: service.current, scope: `${before.user.id}:${before.ledgerId}` });
  }, [submitWrite, notify]);
  useEffect(() => {
    const keydown = e => {
      keyboard.current = true; document.documentElement.classList.add('keyboard-action');
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || document.querySelector('dialog[open]') || ['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'Escape' && state.current.view !== 'record') { navigate('record'); return; }
      if (state.current.view !== 'record') return;
      if (/^[0-9.,]$/.test(e.key)) { e.preventDefault(); pushKey(e.key === ',' ? '.' : e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); pushKey('backspace'); }
      else if (e.key === 'Delete') pushKey('clear');
      else if (e.key === 'Enter' && e.target === document.body) save();
    };
    const pointer = () => { keyboard.current = false; document.documentElement.classList.remove('keyboard-action'); };
    const release = () => {
      stageRef.current?.removeAttribute('data-press');
      document.querySelectorAll('.key[data-pressed="true"]').forEach(node => node.removeAttribute('data-pressed'));
    };
    document.addEventListener('keydown', keydown); document.addEventListener('pointerdown', pointer); document.addEventListener('pointerup', release); document.addEventListener('pointercancel', release);
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('pointerdown', pointer); document.removeEventListener('pointerup', release); document.removeEventListener('pointercancel', release); };
  }, [pushKey, save, navigate]);
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
  async function removeEntry(entry) {
    const result = await run(() => service.current.deleteExpense(entry.id));
    if (result) { const p = { ...currentProfile.current, expenses: currentProfile.current.expenses.filter(e => e.id !== entry.id) }; currentProfile.current = p; setProfile(p); notify('removed', null, { undoId: entry.id, ledgerId: p.ledgerId }); }
  }
  async function saveTime(occurredAt) {
    if (!timeEditor.entry) { locationRound.current++; locationSuppressed.current = Boolean(occurredAt); activeCapture.current = null; setLocationBusy(false); locationClient.current.clear(); editDraft({ occurredAt, location:undefined, suggestedCurrency:undefined }); setTimeEditor(null); return; }
    const entry = await run(() => service.current.updateEntryTime(timeEditor.entry.id, { occurredAt, timezone }, timeEditor.ledgerId));
    if (entry) {
      const p = { ...currentProfile.current, expenses: currentProfile.current.expenses.map(e => e.id === entry.id ? { ...entry, canDelete: e.canDelete } : e) };
      currentProfile.current = p; setProfile(p); setTimeEditor(null); notify('timeSaved');
    }
  }
  async function undo() { const entry = await run(() => service.current.restoreExpense(notice.undoId, notice.ledgerId)); if (entry) { const p = { ...currentProfile.current, expenses: [...currentProfile.current.expenses.filter(e => e.id !== entry.id), entry] }; currentProfile.current = p; setProfile(p); notify('restored'); } }
  const handleAiImported = useCallback(saved => {
    const entries = Array.isArray(saved) ? saved.filter(Boolean) : [];
    if (!entries.length || !currentProfile.current) return;
    const existing = new Set(currentProfile.current.expenses.map(entry => entry.id));
    const next = { ...currentProfile.current, expenses: [...currentProfile.current.expenses, ...entries.filter(entry => !existing.has(entry.id))] };
    currentProfile.current = next;
    setProfile(next);
  }, []);
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
  const footprints = useMemo(() => summarizeFootprints(expenses.filter(e => e.currency === historyCurrency
    && e.dayKey.startsWith(today.slice(0,7)) && (historyCategory === 'all' || categoryKey(e) === historyCategory))), [expenses, historyCurrency, historyCategory, today]);
  const historyExpense = total(history, 'expense'), historyIncome = total(history, 'income');
  const days = [...new Set(history.map(e => e.dayKey))];
  const saveLabel = t(busy ? 'saving' : !amountMinor ? 'enterAmount' : !draft.selected ? 'selectCategory' : draft.type === 'income' ? 'saveIncome' : 'save');
  const storageStatus = <div className="storage-state"><span id="storage-status" role="status">{t(failed ? 'unavailable' : !ready ? 'loading' : syncFailed ? 'syncFailed' : isRemote ? 'remoteStorage' : 'localStorage')}</span>{failed && <Button mode="plain" size="s" onClick={() => setRetryCount(n => n + 1)}>{t('retry')}</Button>}</div>;
  const secondary = !['record','history'].includes(view);
  const titleKey = { record: draft.type === 'income' ? 'incomeTitle' : 'recordTitle', history: 'historyTitle', settings: 'settingsTitle', profile: 'myProfile', account: 'accountTitle', circles: 'circlesTitle', manage: 'manageTitle', 'ai-import': 'aiImportTitle' }[view];
  return <AppRoot appearance="light" platform={['ios','macos'].includes(telegram?.platform) ? 'ios' : 'base'} className="for-root" data-ui-kit="telegram-ui" data-view={view}><div className="app-shell">
    <header className="app-header"><a className="brand" href="#record" aria-label={t('record')} onClick={e => { e.preventDefault(); navigate('record'); }}><Icon name="home"/></a>
      <Button id="circle-switcher" mode="plain" className="ledger-switcher" disabled={disabled} onClick={() => isRemote ? setPicker(true) : navigate('circles')}><span>{circle?.name || t('personal')}</span><Icon name="chevronDown"/></Button>
      <Button className="profile-trigger" mode="plain" id="open-settings" aria-label={t('settingsTitle')} onClick={() => navigate('settings')} disabled={busy}><Avatar person={profile?.user}/></Button>
    </header>

    {failedCount > 0 && <button type="button" className="sync-retry-banner" onClick={retryWrites}>{t('retryUnconfirmed', { n: failedCount })}</button>}<main key={view} ref={pageRef} id={`${view}-view`} className="page">{view !== 'record' && <div className="page-heading"><h1 id={`${view}-title`} tabIndex={-1}>{t(titleKey)}</h1>{secondary && <Button mode="plain" size="s" className="text-button" onClick={() => navigate(view === 'settings' ? 'record' : 'settings')}>{t('back')}</Button>}</div>}
    {view === 'record' && <><div className="today-strip"><span className="today-icon" aria-hidden="true"><Icon name="arrowDown"/></span><div><span>{t('todayTotal')}</span><strong id="today-total">{money(todayExpense)}</strong></div><Button id="edit-draft-time" mode="plain" className={`date-label date-button ${draft.occurredAt ? 'has-custom-time' : ''}`} aria-label={t('editEntryTime')} disabled={disabled} onClick={() => setTimeEditor({})}><Icon name="clock"/>{new Intl.DateTimeFormat(locale, { month:'short',day:'numeric', ...(draft.occurredAt ? { hour:'2-digit',minute:'2-digit',hourCycle:'h23' } : {}) }).format(new Date(draft.occurredAt || Date.now()))}</Button><Button id="open-ai-import" mode="plain" className="ai-quick-trigger" aria-label={t('aiImportTitle')} title={t('aiImportTitle')} disabled={busy} onClick={() => navigate('ai-import')}><Icon name="receipt"/></Button></div><div className="record-layout"><section ref={stageRef} className={`amount-stage ${draft.raw.length >= 6 ? 'long-amount' : ''} ${draft.type === 'income' ? 'is-income' : ''}`} aria-label={t('amountInput')}><div className="amount-meta"><div className="type-toggle-pill" role="group" aria-label={t('transactionType')}>{['expense','income'].map(type => <Tappable Component="button" type="button" key={type} className={`type-pill-btn ${draft.type === type ? `active type-${type}` : ''}`} aria-pressed={draft.type === type} disabled={disabled} onClick={() => { editDraft({ type, selected:null }); haptic(); }}>{t(type)}</Tappable>)}</div><Select id="currency" className="currency-control" aria-label={t('currency')} value={draftCurrency} data-suggested={Boolean(draft.suggestedCurrency === draftCurrency && !draft.currencyManual)} title={draft.suggestedCurrency ? `${t('locationCurrency')} · ${draft.suggestedCurrency}` : t('currency')} disabled={disabled} onChange={e => { const currency=e.target.value; editDraft({ currency, currencyManual:true, raw:CURRENCIES[currency].digits ? draft.raw : draft.raw.split('.')[0] }); }}>{Object.keys(CURRENCIES).map(c => <option key={c} value={c}>{c}{draft.suggestedCurrency === c && draftCurrency !== c ? ` · ${t('locationCurrency')}` : ''}</option>)}</Select></div><div className="amount-line"><span className="currency-symbol">{draft.type === 'income' ? '+' : ''}{CURRENCIES[draftCurrency].symbol}</span><output id="amount-display" data-length={draft.raw.length < 6 ? 'short' : draft.raw.length > 9 ? 'long' : draft.raw.length} aria-label={t('currentAmount')} style={{ '--amount-chars':amount.length }}>{amount}</output><span className="input-caret" aria-hidden="true"/></div><div className="amount-bottom"><span>{draft.selected ? categoryDisplayLabel(categories.find(c => c.id === draft.selected) || {}, settings.language) : ''}</span></div><PocketMascot mascotRef={mascotRef} t={t} onTap={haptic} canConfirm={Boolean(!disabled && amountMinor && draft.selected && draft.consumer)} busy={busy} celebrate={celebration} confirmLabel={saveLabel} onConfirm={save}/></section>
      <section className="purposes"><div className="section-heading"><h2>{t('categories')}</h2>{(!circle || circle.isAdmin) && <Button className="text-button" id="edit-categories" mode="plain" size="s" disabled={disabled} onClick={startEditing}>{t('editCategories')}</Button>}</div><Categories categories={orderedCategories} lang={settings.language} selected={draft.selected} disabled={disabled} onSelect={id => { editDraft({ selected:id }); haptic(); }}/></section>
      <section id="keypad" className="keypad" aria-label={t('keypad')}>{['1','2','3','4','5','6','7','8','9',digits ? '.' : 'clear','0','backspace'].map(key => <Tappable Component="button" type="button" className={`key ${key.length > 1 || key === '.' ? 'key-secondary' : ''}`} key={key} data-key={key} disabled={disabled} aria-label={key === 'clear' ? t('clear') : key === 'backspace' ? t('backspace') : key === '.' ? t('decimal') : key} onPointerDown={event => { if (!disabled) { event.currentTarget.setAttribute('data-pressed', 'true'); stageRef.current?.setAttribute('data-press', 'true'); haptic(); } }} onPointerUp={event => event.currentTarget.removeAttribute('data-pressed')} onPointerCancel={event => event.currentTarget.removeAttribute('data-pressed')} onPointerLeave={event => event.currentTarget.removeAttribute('data-pressed')} onClick={() => pushKey(key)}>{key === 'clear' ? 'C' : key === 'backspace' ? <Icon name="backspace"/> : key === '.' ? decimal : key}</Tappable>)}</section>
      <section className="finish" aria-label={t('save')}><div className="entry-actions">{circle && settings.consumers.length > 1 && <div className="consumer-buttons" role="group" aria-label={t(draft.type === 'income' ? 'incomeOwner' : 'consumer')}>{settings.consumers.map(c => <Tappable Component="button" type="button" className={`consumer-chip consumer-color-${c.color}`} key={c.id} aria-pressed={draft.consumer === c.id} disabled={disabled} onClick={() => { editDraft({ consumer:c.id }); haptic(); }}><Avatar person={c}/><span>{c.name}</span></Tappable>)}</div>}<Button id="entry-location" mode="plain" className={`location-trigger ${draft.location ? 'has-location' : ''}`} aria-label={t('locationTitle')} aria-pressed={Boolean(draft.location)} title={locationLabel(draft.location) || t('locationTitle')} disabled={disabled} onClick={() => setLocationSheet(true)}><Icon name="pin"/></Button><Button id="edit-note" mode="plain" className={`note-trigger ${draft.note ? "has-note" : ""}`} aria-label={t('note')} title={draft.note || t('note')} disabled={disabled} onClick={() => setNoteEditor(true)}><Icon name="edit"/></Button></div></section></div>
      </>}
    {view === 'history' && <><div className="history-controls"><SegmentedControl className="period-tabs" aria-label={t('period')}>{['month','all'].map(p => <SegmentedControl.Item key={p} selected={period === p} onClick={() => setPeriod(p)}>{t(p)}</SegmentedControl.Item>)}</SegmentedControl><Select id="history-currency" className="history-currency" aria-label={t('ledgerCurrency')} value={historyCurrency} onChange={e => setHistoryCurrency(e.target.value)}>{Object.keys(CURRENCIES).map(c => <option key={c}>{c}</option>)}</Select></div><label className="history-category-filter"><span>{t('categoryFilter')}</span><Select id="history-category" aria-label={t('categoryFilter')} value={historyCategory} onChange={e => setHistoryCategory(e.target.value)}><option value="all">{t('allCategories')}</option>{['expense','income'].map(type => <optgroup key={type} label={t(type)}>{historyCategories.filter(option => option.type === type).map(option => <option key={option.key} value={option.key}>{categoryLabel(option.category,settings.language)}</option>)}</optgroup>)}</Select></label><section className="history-summary"><div className="history-summary-amount"><span>{t('netBalance')}</span><strong id="history-total">{money(historyIncome - historyExpense, historyCurrency)}</strong><small id="history-total-count">{countText(history.length, settings.language, historyCurrency)}</small></div><div className="balance-details"><div><span>{t('expense')}</span><strong>{money(historyExpense,historyCurrency)}</strong></div><div><span>{t('income')}</span><strong className="income-value">+{money(historyIncome,historyCurrency)}</strong></div></div></section><Footprints items={footprints} t={t}/><AiSummary t={t} profile={profile} settings={settings} currency={historyCurrency} busy={busy} run={run} service={service.current} isRemote={isRemote} config={config} onAccount={() => navigate('account')}/><div className="history-list">{!history.length && <Placeholder className="empty-state" header={t('emptyTitle')} description={t(historyCategory === 'all' ? 'emptyText' : 'filterEmpty')}><span className="empty-face">◡</span><Button mode="filled" onClick={() => navigate('record')}>{t('newEntry')}</Button></Placeholder>}{days.map(day => <section key={day}><div className="history-day">{day === today ? t('today') : new Intl.DateTimeFormat(locale,{ timeZone:'UTC',month:'short',day:'numeric' }).format(new Date(`${day}T12:00:00Z`))}</div>{history.filter(e => e.dayKey === day).map(e => <Cell Component="article" readOnly multiline key={e.id} className={`expense-row ${e.type === 'income' ? 'is-income' : ''}`} before={<span className="category-icon" style={{ background:`var(--${e.category.color})` }}><Icon name={e.category.icon}/></span>} subtitle={<span className="expense-meta"><span className={`consumer-badge consumer-color-${e.member?.color || 'blue'}`}><i/>{e.member?.name || settings.consumers.find(c => c.id === e.consumer)?.name || t('unknownConsumer')}</span><button type="button" className="entry-time" aria-label={t('editEntryTime')} disabled={busy || e.canDelete === false} onClick={() => setTimeEditor({ entry:e, ledgerId:profile.ledgerId })}><time dateTime={e.occurredAt || e.createdAt}>{new Intl.DateTimeFormat(locale,{timeZone:e.timezone || timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(e.occurredAt || e.createdAt))}</time></button></span>} description={e.note || e.location ? <span className="expense-description">{e.note && <span className="expense-note">{e.note}</span>}{e.location && <span className="expense-location"><Icon name="pin"/><span>{locationLabel(e.location) || t('locationAttached')}</span></span>}</span> : undefined} after={<div className="expense-actions"><span className="expense-money">{e.type === 'income' ? '+' : '−'}{money(e.amountMinor,e.currency)}</span>{e.canDelete !== false && <Button className="delete-expense" mode="plain" size="s" disabled={busy} data-delete={e.id} aria-label={t('deleteExpense',{category:categoryLabel(e.category,settings.language),amount:money(e.amountMinor,e.currency)})} onClick={() => removeEntry(e)}><Icon name="trash"/></Button>}</div>}><strong>{categoryLabel(e.category,settings.language)}</strong>{!isBudgetEntry(e) && <small className="entry-kind">{t(e.recordKind === 'transfer' ? 'recordKindTransfer' : 'recordKindReimbursement')}</small>}</Cell>)}</section>)}</div><div className="today-balance"><span>{t('todayBalance')}</span><strong>{money(todayIncome - todayExpense)}</strong></div></>}
    {view === 'settings' && <div className="settings-home">{[['profile','myProfile'],['circles','circlesTitle'],['account','accountTitle'],['ai-import','aiImportTitle']].map(([v,key]) => <Button key={v} mode="plain" className="settings-row" onClick={() => navigate(v)} disabled={!ready}>{v === 'profile' ? <Avatar person={profile?.user}/> : <Icon name={v === 'circles' ? 'users' : v === 'ai-import' ? 'receipt' : 'card'}/>}<span>{t(key)}</span><span aria-hidden="true">›</span></Button>)}<Button mode="plain" className="settings-row" onClick={() => setLocationSheet(true)} disabled={!ready}><Icon name="pin"/><span>{t('locationTitle')}</span><span aria-hidden="true">›</span></Button><label className="settings-language"><span>{t('language')}</span><Select id="language" className="language-control" aria-label={t('language')} value={settings.language} disabled={disabled} onChange={e => updateSettings({ language:e.target.value })}><option value="zh">中文</option><option value="en">English</option><option value="uk">Українська</option></Select></label></div>}
    {view === 'profile' && profile && <ProfileEditor key={profile.user.id} user={profile.user} t={t} busy={busy} run={run} service={service.current}/>}
    {view === 'account' && profile && <AccountPage t={t} profile={profile} isRemote={isRemote} config={config} language={settings.language} busy={busy} run={run} service={service.current} onGoogle={login} onLogout={logout} copy={copy}/>}
    {view === 'circles' && profile && <CirclesPage t={t} profile={profile} busy={busy} isRemote={isRemote} run={run} service={service.current} onAccount={() => navigate('account')} onSwitch={switchCircle} copy={copy}/>}
    {view === 'ai-import' && profile && <AiImportPage t={t} profile={profile} settings={settings} busy={busy} run={run} service={service.current} isRemote={isRemote} config={config} onAccount={() => navigate('account')} onImported={handleAiImported}/>}
    {view === 'manage' && <><CategorySuggestions categories={settings.categories} expenses={expenses} ledgerId={profile?.ledgerId} type="expense" language={settings.language} disabled={busy || editing.length >= MAX_CATEGORIES} onAdd={({ label, icon, color }) => { if (editing.some(item => item.label.trim() === label) || editing.length >= MAX_CATEGORIES) return; setEditing(items => [...items, { id:createId(), label, icon, color }]); haptic(); }} /><form id="category-form" onSubmit={saveCategories}><div className="category-editor">{editing.map(c => <div className="editor-row" key={c.id} data-expanded={editingCategoryId === c.id}><Tappable Component="button" type="button" className="category-icon editor-icon-trigger" style={{background:`var(--${c.color})`}} aria-label={t('categoryIcon',{name:categoryLabel(c,settings.language)})} aria-expanded={editingCategoryId === c.id} onClick={() => setEditingCategoryId(current => current === c.id ? null : c.id)}><Icon name={c.icon}/><Icon name="chevronDown"/></Tappable><Input className="editor-label" aria-label={t('categoryName',{name:categoryLabel(c,settings.language)})} value={c.label} maxLength={24} required onChange={e => setEditing(items => items.map(x => x.id === c.id ? {...x,label:e.target.value} : x))}/><Select className="editor-select" data-field="icon" aria-label={t('categoryIcon',{name:c.label})} value={c.icon} onChange={e => setEditing(items => items.map(x => x.id === c.id ? {...x,icon:e.target.value} : x))}>{ICONS.filter(icon => !['google','users'].includes(icon)).map(icon => <option key={icon} value={icon}>{t(icon)}</option>)}</Select><Select className="editor-select" data-field="color" aria-label={t('categoryColor',{name:c.label})} value={c.color} onChange={e => setEditing(items => items.map(x => x.id === c.id ? {...x,color:e.target.value} : x))}>{COLORS.map(color => <option key={color} value={color}>{t(color)}</option>)}</Select><Button type="button" className="editor-remove" mode="plain" aria-label={t('removeCategory',{name:c.label})} onClick={() => editing.length > 1 ? setEditing(items => items.filter(x => x.id !== c.id)) : notify('keepCategory')}>×</Button></div>)}</div><Button type="button" id="add-category" className="add-category" stretched mode="outline" disabled={editing.length >= MAX_CATEGORIES || busy} onClick={() => setEditing(items => [...items,{id:createId(),label:'',icon:'heart',color:'peach'}])}>{t('addCategory')}</Button><div className="editor-actions"><Button type="button" className="text-button" mode="plain" onClick={() => setEditing(structuredClone(editingType === 'income' ? DEFAULT_INCOME_CATEGORIES : DEFAULT_CATEGORIES))}>{t('resetCategories')}</Button><Button className="save-button" type="submit" disabled={busy}>{t('saveCategories')}</Button></div></form></>}
    </main>{view !== 'record' && <footer className="app-footer">{storageStatus}</footer>}<nav className="bottom-nav" aria-label={t('navigation')}><SegmentedControl className="view-tabs" aria-label={t('navigation')}>{['record','history'].map(v => <SegmentedControl.Item key={v} className="tab" data-view={v} selected={view === v} aria-selected={view === v} onClick={() => navigate(v)}>{t(v === 'record' ? 'record' : 'ledger')}</SegmentedControl.Item>)}</SegmentedControl></nav>
    </div>{picker && profile && <CirclePicker profile={profile} t={t} busy={busy} onSwitch={switchCircle} onManage={() => navigate('circles')} onClose={() => setPicker(false)}/>}
    {locationSheet && <LocationSheet t={t} location={draft.location} enabled={locationEnabled} loading={locationBusy} onCapture={useLocation} onRemove={() => removeLocation()} onDisable={() => removeLocation(true)} onClose={() => setLocationSheet(false)}/>}
    {noteEditor && <Sheet title={t('note')} onClose={() => setNoteEditor(false)}><form className="note-form" onSubmit={e => { e.preventDefault(); setNoteEditor(false); }}><Input id="note" className="note-field" autoFocus aria-label={t('note')} placeholder={t('notePlaceholder')} value={draft.note} maxLength={160} disabled={disabled} onChange={e => editDraft({ note:e.target.value })}/><Button type="submit" className="compact-save" aria-label={t('confirm')}><Icon name="check"/></Button></form></Sheet>}
    {timeEditor && <TimeEditor value={timeEditor.entry ? timeEditor.entry.occurredAt || timeEditor.entry.createdAt : draft.occurredAt} isDraft={!timeEditor.entry} t={t} busy={busy} onSave={saveTime} onClose={() => setTimeEditor(null)}/>}
    {notice && <Snackbar className={`notice ${notice.error ? 'error' : ''}`} key={notice.id} role="status" duration={notice.error || notice.undoId ? 2147480000 : 2200} onClose={() => setNotice(current => current?.id === notice.id ? null : current)} after={<span className="notice-actions">{notice.retryWrites && <Snackbar.Button onClick={retryWrites}>{t('retry')}</Snackbar.Button>}{notice.undoId && <Snackbar.Button id="undo-button" disabled={busy} onClick={undo}>{t('undo')}</Snackbar.Button>}<Snackbar.Button id="dismiss-notice" aria-label={t('closeNotice')} onClick={() => setNotice(null)}>×</Snackbar.Button></span>}><span id="notice-text">{notice.error ? translateError(notice.error,settings.language) : t(notice.key,notice.values)}</span></Snackbar>}
  </AppRoot>;
}

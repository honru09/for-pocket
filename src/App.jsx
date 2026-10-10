import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppRoot, Button, Cell, Input, Placeholder, SegmentedControl, Select, Snackbar, Tappable } from '@telegram-apps/telegram-ui';
import { CURRENCIES, COLORS, ICONS, DEFAULT_CATEGORIES, DEFAULT_INCOME_CATEGORIES, initialSettings, validateSettings, dateKey, resolveLanguage } from '../public/shared.mjs';
import { LOCALES, translate, translateError, categoryLabel } from '../public/i18n.mjs';
import { PREVIEW_KEY, SESSION_KEY, localService, remoteService } from './services.mjs';
import { Avatar, CirclePicker, ProfileEditor, AccountPage, CirclesPage, Sheet } from './AccountViews.jsx';
import { Icon, Mascot } from './icons.jsx';
import TimeEditor from './TimeEditor.jsx';
import usePocketViewport from './usePocketViewport.js';

const telegram = window.Telegram?.WebApp;
const language = resolveLanguage(telegram?.initDataUnsafe?.user?.language_code || navigator.language);
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const blankDraft = () => ({ raw: '0', selected: null, consumer: null, note: '', type: 'expense', occurredAt: null });
function haptic(kind = 'selection') { try { if (!telegram?.isVersionAtLeast?.('6.1')) return; kind === 'success' ? telegram.HapticFeedback.notificationOccurred(kind) : telegram.HapticFeedback.selectionChanged(); } catch {} }
function countText(n, lang, currency) {
  const plural = new Intl.PluralRules(LOCALES[lang]).select(n);
  const unit = lang === 'zh' ? '笔' : lang === 'en' ? plural === 'one' ? 'entry' : 'entries' : ({ one: 'запис', few: 'записи', many: 'записів', other: 'записів' }[plural]);
  return `${n} ${unit} · ${currency}`;
}
const Categories = memo(function Categories({ categories, lang, selected, disabled, onSelect }) {
  return <div className="categories" id="categories" role="group" aria-label={translate(lang, 'categories')}>{categories.map(c => <Tappable Component="button" type="button" className={`category ${selected === c.id ? 'selected' : ''}`} key={c.id} data-category={c.id} aria-label={categoryLabel(c, lang)} aria-pressed={selected === c.id} disabled={disabled} onClick={() => onSelect(c.id)}><span className="check" aria-hidden="true">✓</span><span className="category-icon" style={{ background: `var(--${c.color})` }}><Icon name={c.icon}/></span><span className="category-label">{categoryLabel(c, lang)}</span></Tappable>)}</div>;
});

export default function App() {
  usePocketViewport(telegram);
  const [profile, setProfile] = useState(null), [settings, setSettings] = useState(() => initialSettings(language));
  const [draft, setDraft] = useState(blankDraft), [view, setView] = useState('record'), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [isRemote, setRemote] = useState(false), [config, setConfig] = useState({}), [notice, setNotice] = useState(null), [failed, setFailed] = useState(false), [syncFailed, setSyncFailed] = useState(false);
  const [picker, setPicker] = useState(false), [period, setPeriod] = useState('month'), [historyCurrency, setHistoryCurrency] = useState('JPY');
  const [editing, setEditing] = useState([]), [editingType, setEditingType] = useState('expense'), [today, setToday] = useState(() => dateKey(new Date(), timezone));
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [retryCount, setRetryCount] = useState(0);
  const [timeEditor, setTimeEditor] = useState(null);
  const [noteEditor, setNoteEditor] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const service = useRef(null), busyRef = useRef(false), state = useRef({}), settingsRef = useRef(settings), currentProfile = useRef(null), pending = useRef(null), drafts = useRef(new Map());
  const pageRef = useRef(null), mascotRef = useRef(null), stageRef = useRef(null), keyboard = useRef(false), epoch = useRef(0);
  const t = useCallback((key, values) => translate(settings.language, key, values), [settings.language]);
  const locale = LOCALES[settings.language], disabled = busy || !ready;
  const digits = CURRENCIES[settings.currency].digits, [integer, fraction] = draft.raw.split('.');
  const amountMinor = Number(integer) * 10 ** digits + Number((fraction || '').padEnd(digits, '0') || 0);
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1).find(p => p.type === 'decimal')?.value || '.';
  const amount = Number(integer).toLocaleString(locale) + (fraction !== undefined ? decimal + fraction : '');
  const money = (minor, currency = settings.currency) => new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: CURRENCIES[currency].digits, maximumFractionDigits: CURRENCIES[currency].digits }).format(minor / 10 ** CURRENCIES[currency].digits);
  const categories = draft.type === 'income' ? settings.incomeCategories : settings.categories;
  const expenses = profile?.expenses || [], circle = profile?.social.activeCircle;
  state.current = { draft, ready, view, amountMinor, isRemote };
  const changeBusy = value => { busyRef.current = value; setBusy(value); };
  const notify = useCallback((key, values, extra = {}) => setNotice({ id: crypto.randomUUID(), key, values, ...extra }), []);
  const showError = useCallback(error => notify(null, null, { error: error.message || 'errorSave' }), [notify]);
  const apply = useCallback(p => {
    const previous = currentProfile.current, next = validateSettings(p.settings);
    const currencyChanged = settingsRef.current.currency !== next.currency;
    const scopeChanged = previous?.ledgerId !== p.ledgerId || previous?.user.id !== p.user.id;
    if (scopeChanged) {
      setTimeEditor(null);
      if (previous) drafts.current.set(`${previous.user.id}:${previous.ledgerId}`, { ...state.current.draft, currency: settingsRef.current.currency });
      const stored = drafts.current.get(`${p.user.id}:${p.ledgerId}`);
      setDraft(stored && stored.currency === next.currency ? { ...stored, consumer: next.consumers.some(c => c.id === stored.consumer) ? stored.consumer : p.user.id } : { ...blankDraft(), consumer: p.user.id });
      pending.current = null; setNotice(null); setHistoryCurrency(next.currency);
    } else {
      setDraft(current => {
        const pool = current.type === 'income' ? next.incomeCategories : next.categories;
        return { ...current, raw: currencyChanged ? '0' : current.raw, selected: pool.some(c => c.id === current.selected) ? current.selected : null, consumer: next.consumers.some(c => c.id === current.consumer) ? current.consumer : p.user.id };
      });
    }
    settingsRef.current = next; currentProfile.current = p; setSettings(next); setProfile(p);
  }, []);
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
        service.current = backend; setRemote(backend.getInvite !== undefined); apply(p); setReady(true);
      } catch (error) { if (!cancelled) { setFailed(true); showError(error); } }
    }
    boot();
    const motion = event => setReduced(event.matches), media = matchMedia('(prefers-reduced-motion: reduce)'); media.addEventListener('change', motion);
    return () => { cancelled = true; media.removeEventListener('change', motion); };
  }, [apply, notify, showError, retryCount]);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false, refreshing = false;
    const refresh = async () => {
      if (document.hidden || busyRef.current || refreshing) return;
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
  useEffect(() => { if (telegram?.isVersionAtLeast?.('6.2')) { try { amountMinor || draft.note ? telegram.enableClosingConfirmation() : telegram.disableClosingConfirmation(); } catch {} } }, [amountMinor, draft.note]);
  useLayoutEffect(() => {
    if (reduced || keyboard.current) return;
    const animation = pageRef.current?.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: 'cubic-bezier(.23,1,.32,1)' });
    return () => animation?.cancel();
  }, [view, reduced]);
  const editDraft = patch => { pending.current = null; setDraft(current => ({ ...current, ...patch })); };
  const pushKey = useCallback(key => {
    if (busyRef.current || !state.current.ready) return;
    const current = state.current.draft.raw, digits = CURRENCIES[settingsRef.current.currency].digits;
    let next = current;
    if (key === 'backspace') next = current.slice(0, -1) || '0';
    else if (key === 'clear') next = '0';
    else if (key === '.') { if (digits && !current.includes('.')) next += '.'; }
    else if (/^\d$/.test(key)) { const [whole, part] = current.split('.'); if (part !== undefined && part.length >= digits) return; if (part === undefined && whole.length >= 8) return; next = current === '0' ? key : current + key; }
    pending.current = null; state.current.draft = { ...state.current.draft, raw: next }; setDraft(current => ({ ...current, raw: next }));
  }, []);
  const save = useCallback(async () => {
    const { draft: d, amountMinor, ready } = state.current;
    if (!ready || busyRef.current || !amountMinor || !d.selected || !d.consumer) return;
    const payload = { id: pending.current?.id || crypto.randomUUID(), ledgerId: currentProfile.current.ledgerId, type: d.type, amountMinor, currency: settingsRef.current.currency, categoryId: d.selected, consumer: d.consumer, note: d.note, occurredAt: d.occurredAt, timezone };
    pending.current = payload;
    const entry = await run(() => service.current.addExpense(payload));
    if (entry) {
      const p = currentProfile.current; const expenses = p.expenses.some(e => e.id === entry.id) ? p.expenses : [...p.expenses, entry];
      const next = { ...p, expenses }; currentProfile.current = next; setProfile(next);
      setDraft({ ...blankDraft(), consumer: p.user.id, type: d.type }); pending.current = null; notify('savedShort'); haptic('success');
      if (!reduced && !keyboard.current) mascotRef.current?.animate([{ transform: 'rotate(-8deg) scale(1.06,.95)' }, { transform: 'rotate(-8deg) scale(1)' }], { duration: 260, easing: 'cubic-bezier(.23,1,.32,1)' });
    }
  }, [run, notify, reduced]);
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
    const release = () => stageRef.current?.removeAttribute('data-press');
    document.addEventListener('keydown', keydown); document.addEventListener('pointerdown', pointer); document.addEventListener('pointerup', release); document.addEventListener('pointercancel', release);
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('pointerdown', pointer); document.removeEventListener('pointerup', release); document.removeEventListener('pointercancel', release); };
  }, [pushKey, save, navigate]);
  async function updateSettings(patch) { await run(() => service.current.saveSettings({ ...settingsRef.current, ...patch, ...(patch.language ? { languageManual: true } : {}) })); }
  const startEditing = () => { setEditingType(draft.type); setEditing(structuredClone(categories)); navigate('manage'); };
  async function saveCategories(e) { e.preventDefault(); const p = await run(() => service.current.saveSettings({ ...settingsRef.current, [editingType === 'income' ? 'incomeCategories' : 'categories']: editing }), 'categoriesSaved'); if (p) navigate('record'); }
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
    if (!timeEditor.entry) { editDraft({ occurredAt }); setTimeEditor(null); return; }
    const entry = await run(() => service.current.updateEntryTime(timeEditor.entry.id, { occurredAt, timezone }, timeEditor.ledgerId));
    if (entry) {
      const p = { ...currentProfile.current, expenses: currentProfile.current.expenses.map(e => e.id === entry.id ? { ...entry, canDelete: e.canDelete } : e) };
      currentProfile.current = p; setProfile(p); setTimeEditor(null); notify('timeSaved');
    }
  }
  async function undo() { const entry = await run(() => service.current.restoreExpense(notice.undoId, notice.ledgerId)); if (entry) { const p = { ...currentProfile.current, expenses: [...currentProfile.current.expenses.filter(e => e.id !== entry.id), entry] }; currentProfile.current = p; setProfile(p); notify('restored'); } }
  const todayEntries = expenses.filter(e => e.dayKey === today && e.currency === settings.currency);
  const total = (list, type) => list.filter(e => (e.type || 'expense') === type).reduce((sum, e) => sum + e.amountMinor, 0);
  const todayExpense = total(todayEntries, 'expense'), todayIncome = total(todayEntries, 'income');
  const history = useMemo(() => expenses.filter(e => e.currency === historyCurrency && (period === 'all' || e.dayKey.startsWith(today.slice(0,7)))).sort((a,b) => (b.occurredAt || b.createdAt).localeCompare(a.occurredAt || a.createdAt)), [expenses, historyCurrency, period, today]);
  const historyExpense = total(history, 'expense'), historyIncome = total(history, 'income');
  const days = [...new Set(history.map(e => e.dayKey))];
  const saveLabel = t(busy ? 'saving' : !amountMinor ? 'enterAmount' : !draft.selected ? 'selectCategory' : draft.type === 'income' ? 'saveIncome' : 'save');
  const storageStatus = <div className="storage-state"><span id="storage-status" role="status">{t(failed ? 'unavailable' : !ready ? 'loading' : syncFailed ? 'syncFailed' : isRemote ? 'remoteStorage' : 'localStorage')}</span>{failed && <Button mode="plain" size="s" onClick={() => setRetryCount(n => n + 1)}>{t('retry')}</Button>}</div>;
  const secondary = !['record','history'].includes(view);
  const titleKey = { record: draft.type === 'income' ? 'incomeTitle' : 'recordTitle', history: 'historyTitle', settings: 'settingsTitle', profile: 'myProfile', account: 'accountTitle', circles: 'circlesTitle', manage: 'manageTitle' }[view];
  return <AppRoot appearance="light" platform={['ios','macos'].includes(telegram?.platform) ? 'ios' : 'base'} className="for-root" data-ui-kit="telegram-ui" data-view={view}><div className="app-shell">
    <header className="app-header"><a className="brand" href="#record" aria-label={t('record')} onClick={e => { e.preventDefault(); navigate('record'); }}><Icon name="home"/></a>
      <Button id="circle-switcher" mode="plain" className="ledger-switcher" disabled={disabled} onClick={() => isRemote ? setPicker(true) : navigate('circles')}><span>{circle?.name || t('personal')}</span><Icon name="chevronDown"/></Button>
      <Button className="profile-trigger" mode="plain" id="open-settings" aria-label={t('settingsTitle')} onClick={() => navigate('settings')} disabled={busy}><Avatar person={profile?.user}/></Button>
    </header>

    <main key={view} ref={pageRef} id={`${view}-view`} className="page">{view !== 'record' && <div className="page-heading"><h1 id={`${view}-title`} tabIndex={-1}>{t(titleKey)}</h1>{secondary && <Button mode="plain" size="s" className="text-button" onClick={() => navigate(view === 'settings' ? 'record' : 'settings')}>{t('back')}</Button>}</div>}
    {view === 'record' && <><div className="today-strip"><span className="today-icon" aria-hidden="true"><Icon name="arrowDown"/></span><div><span>{t('todayTotal')}</span><strong id="today-total">{money(todayExpense)}</strong></div><Button id="edit-draft-time" mode="plain" className={`date-label date-button ${draft.occurredAt ? 'has-custom-time' : ''}`} aria-label={t('editEntryTime')} disabled={disabled} onClick={() => setTimeEditor({})}><Icon name="clock"/>{new Intl.DateTimeFormat(locale, { month:'short',day:'numeric', ...(draft.occurredAt ? { hour:'2-digit',minute:'2-digit',hourCycle:'h23' } : {}) }).format(new Date(draft.occurredAt || Date.now()))}</Button></div><div className="record-layout"><section ref={stageRef} className={`amount-stage ${draft.raw.length >= 6 ? 'long-amount' : ''} ${draft.type === 'income' ? 'is-income' : ''}`} aria-label={t('amountInput')}><div className="amount-meta"><div className="type-toggle-pill" role="group" aria-label={t('transactionType')}>{['expense','income'].map(type => <Tappable Component="button" type="button" key={type} className={`type-pill-btn ${draft.type === type ? `active type-${type}` : ''}`} aria-pressed={draft.type === type} disabled={disabled} onClick={() => { editDraft({ type, selected:null }); haptic(); }}>{t(type)}</Tappable>)}</div><Select id="currency" className="currency-control" aria-label={t('currency')} value={settings.currency} disabled={disabled} onChange={e => updateSettings({ currency: e.target.value })}>{Object.keys(CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}</Select></div><div className="amount-line"><span className="currency-symbol">{draft.type === 'income' ? '+' : ''}{CURRENCIES[settings.currency].symbol}</span><output id="amount-display" data-length={draft.raw.length < 6 ? 'short' : draft.raw.length > 9 ? 'long' : draft.raw.length} aria-label={t('currentAmount')}>{amount}</output><span className="input-caret" aria-hidden="true"/></div><div className="amount-bottom"><span>{draft.selected ? categoryLabel(categories.find(c => c.id === draft.selected) || {}, settings.language) : ''}</span></div><Mascot mascotRef={mascotRef}/></section>
      <section className="purposes"><div className="section-heading"><h2>{t('categories')}</h2>{(!circle || circle.isAdmin) && <Button className="text-button" id="edit-categories" mode="plain" size="s" disabled={disabled} onClick={startEditing}>{t('editCategories')}</Button>}</div><Categories categories={categories} lang={settings.language} selected={draft.selected} disabled={disabled} onSelect={id => { editDraft({ selected:id }); haptic(); }}/></section>
      <section id="keypad" className="keypad" aria-label={t('keypad')}>{['1','2','3','4','5','6','7','8','9',digits ? '.' : 'clear','0','backspace'].map(key => <Tappable Component="button" type="button" className={`key ${key.length > 1 || key === '.' ? 'key-secondary' : ''}`} key={key} data-key={key} disabled={disabled} aria-label={key === 'clear' ? t('clear') : key === 'backspace' ? t('backspace') : key === '.' ? t('decimal') : key} onPointerDown={() => { if (!reduced && !disabled) stageRef.current?.setAttribute('data-press', 'true'); }} onClick={() => { pushKey(key); haptic(); }}>{key === 'clear' ? 'C' : key === 'backspace' ? <Icon name="backspace"/> : key === '.' ? decimal : key}</Tappable>)}</section>
      <section className="finish" aria-label={t('save')}><div className="entry-actions">{circle && settings.consumers.length > 1 && <div className="consumer-buttons" role="group" aria-label={t(draft.type === 'income' ? 'incomeOwner' : 'consumer')}>{settings.consumers.map(c => <Tappable Component="button" type="button" className={`consumer-chip consumer-color-${c.color}`} key={c.id} aria-pressed={draft.consumer === c.id} disabled={disabled} onClick={() => { editDraft({ consumer:c.id }); haptic(); }}><Avatar person={c}/><span>{c.name}</span></Tappable>)}</div>}<Button id="edit-note" mode="plain" className={`note-trigger ${draft.note ? "has-note" : ""}`} aria-label={t('note')} title={draft.note || t('note')} disabled={disabled} onClick={() => setNoteEditor(true)}><Icon name="edit"/></Button><div className="save-actions">{storageStatus}<Button id="save-expense" className="save-button save-confirm" size="l" loading={busy} aria-label={saveLabel} title={saveLabel} disabled={disabled || !amountMinor || !draft.selected || !draft.consumer} onClick={save}><Icon name="check"/></Button></div></div></section></div>
      </>}
    {view === 'history' && <><div className="history-controls"><SegmentedControl className="period-tabs" aria-label={t('period')}>{['month','all'].map(p => <SegmentedControl.Item key={p} selected={period === p} onClick={() => setPeriod(p)}>{t(p)}</SegmentedControl.Item>)}</SegmentedControl><Select id="history-currency" className="history-currency" aria-label={t('ledgerCurrency')} value={historyCurrency} onChange={e => setHistoryCurrency(e.target.value)}>{Object.keys(CURRENCIES).map(c => <option key={c}>{c}</option>)}</Select></div><section className="history-summary"><div className="history-summary-amount"><span>{t('netBalance')}</span><strong id="history-total">{money(historyIncome - historyExpense, historyCurrency)}</strong><small id="history-total-count">{countText(history.length, settings.language, historyCurrency)}</small></div><div className="balance-details"><div><span>{t('expense')}</span><strong>{money(historyExpense,historyCurrency)}</strong></div><div><span>{t('income')}</span><strong className="income-value">+{money(historyIncome,historyCurrency)}</strong></div></div></section><div className="history-list">{!history.length && <Placeholder className="empty-state" header={t('emptyTitle')} description={t('emptyText')}><span className="empty-face">◡</span><Button mode="filled" onClick={() => navigate('record')}>{t('newEntry')}</Button></Placeholder>}{days.map(day => <section key={day}><div className="history-day">{day === today ? t('today') : new Intl.DateTimeFormat(locale,{ timeZone:'UTC',month:'short',day:'numeric' }).format(new Date(`${day}T12:00:00Z`))}</div>{history.filter(e => e.dayKey === day).map(e => <Cell Component="article" readOnly multiline key={e.id} className={`expense-row ${e.type === 'income' ? 'is-income' : ''}`} before={<span className="category-icon" style={{ background:`var(--${e.category.color})` }}><Icon name={e.category.icon}/></span>} subtitle={<span className="expense-meta"><span className={`consumer-badge consumer-color-${e.member?.color || 'blue'}`}><i/>{e.member?.name || settings.consumers.find(c => c.id === e.consumer)?.name || t('unknownConsumer')}</span><button type="button" className="entry-time" aria-label={t('editEntryTime')} disabled={busy || e.canDelete === false} onClick={() => setTimeEditor({ entry:e, ledgerId:profile.ledgerId })}><time dateTime={e.occurredAt || e.createdAt}>{new Intl.DateTimeFormat(locale,{timeZone:e.timezone || timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(e.occurredAt || e.createdAt))}</time></button></span>} description={e.note ? <span className="expense-note">{e.note}</span> : undefined} after={<div className="expense-actions"><span className="expense-money">{e.type === 'income' ? '+' : '−'}{money(e.amountMinor,e.currency)}</span>{e.canDelete !== false && <Button className="delete-expense" mode="plain" size="s" disabled={busy} data-delete={e.id} aria-label={t('deleteExpense',{category:categoryLabel(e.category,settings.language),amount:money(e.amountMinor,e.currency)})} onClick={() => removeEntry(e)}><Icon name="trash"/></Button>}</div>}><strong>{categoryLabel(e.category,settings.language)}</strong></Cell>)}</section>)}</div><div className="today-balance"><span>{t('todayBalance')}</span><strong>{money(todayIncome - todayExpense)}</strong></div></>}
    {view === 'settings' && <div className="settings-home">{[['profile','myProfile'],['circles','circlesTitle'],['account','accountTitle']].map(([v,key]) => <Button key={v} mode="plain" className="settings-row" onClick={() => navigate(v)} disabled={!ready}>{v === 'profile' ? <Avatar person={profile?.user}/> : <Icon name={v === 'circles' ? 'users' : 'card'}/>}<span>{t(key)}</span><span aria-hidden="true">›</span></Button>)}<label className="settings-language"><span>{t('language')}</span><Select id="language" className="language-control" aria-label={t('language')} value={settings.language} disabled={disabled} onChange={e => updateSettings({ language:e.target.value })}><option value="zh">中文</option><option value="en">English</option><option value="uk">Українська</option></Select></label></div>}
    {view === 'profile' && profile && <ProfileEditor key={profile.user.id} user={profile.user} t={t} busy={busy} run={run} service={service.current}/>}
    {view === 'account' && profile && <AccountPage t={t} profile={profile} isRemote={isRemote} config={config} language={settings.language} busy={busy} run={run} service={service.current} onGoogle={login} onLogout={logout} copy={copy}/>}
    {view === 'circles' && profile && <CirclesPage t={t} profile={profile} busy={busy} isRemote={isRemote} run={run} service={service.current} onAccount={() => navigate('account')} onSwitch={switchCircle} copy={copy}/>}
    {view === 'manage' && <form id="category-form" onSubmit={saveCategories}><div className="category-editor">{editing.map(c => <div className="editor-row" key={c.id} data-expanded={editingCategoryId === c.id}><Tappable Component="button" type="button" className="category-icon editor-icon-trigger" style={{background:`var(--${c.color})`}} aria-label={t('categoryIcon',{name:categoryLabel(c,settings.language)})} aria-expanded={editingCategoryId === c.id} onClick={() => setEditingCategoryId(current => current === c.id ? null : c.id)}><Icon name={c.icon}/><Icon name="chevronDown"/></Tappable><Input className="editor-label" aria-label={t('categoryName',{name:categoryLabel(c,settings.language)})} value={categoryLabel(c,settings.language)} maxLength={24} required onChange={e => setEditing(items => items.map(x => x.id === c.id ? {...x,label:e.target.value} : x))}/><Select className="editor-select" data-field="icon" aria-label={t('categoryIcon',{name:c.label})} value={c.icon} onChange={e => setEditing(items => items.map(x => x.id === c.id ? {...x,icon:e.target.value} : x))}>{ICONS.filter(icon => !['google','users'].includes(icon)).map(icon => <option key={icon} value={icon}>{t(icon)}</option>)}</Select><Select className="editor-select" data-field="color" aria-label={t('categoryColor',{name:c.label})} value={c.color} onChange={e => setEditing(items => items.map(x => x.id === c.id ? {...x,color:e.target.value} : x))}>{COLORS.map(color => <option key={color} value={color}>{t(color)}</option>)}</Select><Button type="button" className="editor-remove" mode="plain" aria-label={t('removeCategory',{name:c.label})} onClick={() => editing.length > 1 ? setEditing(items => items.filter(x => x.id !== c.id)) : notify('keepCategory')}>×</Button></div>)}</div><Button type="button" id="add-category" className="add-category" stretched mode="outline" disabled={editing.length >= 18 || busy} onClick={() => setEditing(items => [...items,{id:crypto.randomUUID(),label:'',icon:'heart',color:'peach'}])}>{t('addCategory')}</Button><div className="editor-actions"><Button type="button" className="text-button" mode="plain" onClick={() => setEditing(structuredClone(editingType === 'income' ? DEFAULT_INCOME_CATEGORIES : DEFAULT_CATEGORIES))}>{t('resetCategories')}</Button><Button className="save-button" type="submit" disabled={busy}>{t('saveCategories')}</Button></div></form>}
    </main>{view !== 'record' && <footer className="app-footer">{storageStatus}</footer>}<nav className="bottom-nav" aria-label={t('navigation')}><SegmentedControl className="view-tabs" aria-label={t('navigation')}>{['record','history'].map(v => <SegmentedControl.Item key={v} className="tab" data-view={v} selected={view === v} aria-selected={view === v} onClick={() => navigate(v)}>{t(v === 'record' ? 'record' : 'ledger')}</SegmentedControl.Item>)}</SegmentedControl></nav>
    </div>{picker && profile && <CirclePicker profile={profile} t={t} busy={busy} onSwitch={switchCircle} onManage={() => navigate('circles')} onClose={() => setPicker(false)}/>}
    {noteEditor && <Sheet title={t('note')} onClose={() => setNoteEditor(false)}><form className="note-form" onSubmit={e => { e.preventDefault(); setNoteEditor(false); }}><Input id="note" className="note-field" autoFocus aria-label={t('note')} placeholder={t('notePlaceholder')} value={draft.note} maxLength={160} disabled={disabled} onChange={e => editDraft({ note:e.target.value })}/><Button type="submit" className="compact-save" aria-label={t('confirm')}><Icon name="check"/></Button></form></Sheet>}
    {timeEditor && <TimeEditor value={timeEditor.entry ? timeEditor.entry.occurredAt || timeEditor.entry.createdAt : draft.occurredAt} isDraft={!timeEditor.entry} t={t} busy={busy} onSave={saveTime} onClose={() => setTimeEditor(null)}/>}
    {notice && <Snackbar className={`notice ${notice.error ? 'error' : ''}`} key={notice.id} role="status" duration={notice.error || notice.undoId ? 2147480000 : 2200} onClose={() => setNotice(current => current?.id === notice.id ? null : current)} after={<span className="notice-actions">{notice.undoId && <Snackbar.Button id="undo-button" disabled={busy} onClick={undo}>{t('undo')}</Snackbar.Button>}<Snackbar.Button id="dismiss-notice" aria-label={t('closeNotice')} onClick={() => setNotice(null)}>×</Snackbar.Button></span>}><span id="notice-text">{notice.error ? translateError(notice.error,settings.language) : t(notice.key,notice.values)}</span></Snackbar>}
  </AppRoot>;
}

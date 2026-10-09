import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppRoot, Button, Cell, Input, Placeholder, SegmentedControl, Select, Snackbar, Tappable } from '@telegram-apps/telegram-ui';
import { CURRENCIES, CONSUMERS, COLORS, ICONS, DEFAULT_CATEGORIES, initialSettings, validateSettings, dateKey } from '../public/shared.mjs';
import { LOCALES, translate, translateError, categoryLabel } from '../public/i18n.mjs';
import { PREVIEW_KEY, localService, remoteService } from './services.mjs';
import { Icon, Mascot } from './icons.jsx';

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const telegram = window.Telegram?.WebApp;
const supported = version => telegram?.isVersionAtLeast?.(version);
function haptic(kind = 'selection') {
  if (!supported('6.1')) return;
  try {
    if (kind === 'success' || kind === 'error') telegram.HapticFeedback.notificationOccurred(kind);
    else if (kind === 'impact') telegram.HapticFeedback.impactOccurred('light');
    else telegram.HapticFeedback.selectionChanged();
  } catch {}
}
function countText(n, language, currency) {
  const plural = new Intl.PluralRules(LOCALES[language]).select(n);
  const unit = language === 'zh' ? '笔' : language === 'en' ? plural === 'one' ? 'entry' : 'entries' : ({ one: 'запис', few: 'записи', many: 'записів', other: 'записів' }[plural]);
  return `${n} ${unit} · ${currency}`;
}
const CategoryGrid = memo(function CategoryGrid({ categories, language, selected, disabled, onSelect }) {
  return <div className="categories" id="categories" role="group" aria-label={translate(language, 'categories')}>{categories.map(category => <Tappable Component="button" type="button" interactiveAnimation="background" className={`category ${selected === category.id ? 'selected' : ''}`} key={category.id} data-category={category.id} aria-pressed={selected === category.id} aria-label={categoryLabel(category, language)} disabled={disabled} onClick={() => onSelect(category.id)}><span className="check" aria-hidden="true">✓</span><span className="category-icon" style={{ background: `var(--${category.color})` }}><Icon name={category.icon}/></span><span className="category-label">{categoryLabel(category, language)}</span></Tappable>)}</div>;
});
const ConsumerPicker = memo(function ConsumerPicker({ language, consumer, disabled, onSelect }) {
  return <fieldset className="consumer-picker"><legend>{translate(language, 'consumer')}</legend><div className="consumer-options" id="consumers">{Object.entries(CONSUMERS).map(([id, name]) => <Tappable Component="button" type="button" className={`consumer-option consumer-${id} ${consumer === id ? 'selected' : ''}`} data-consumer={id} key={id} aria-pressed={consumer === id} disabled={disabled} onClick={() => onSelect(id)}><span className="consumer-avatar" aria-hidden="true"><Icon name="face"/></span><span>{name}</span><span className="consumer-check" aria-hidden="true">✓</span></Tappable>)}</div></fieldset>;
});
function ConsumerBadge({ consumer, t }) {
  const id = Object.hasOwn(CONSUMERS, consumer) ? consumer : 'unassigned';
  return <span className={`consumer-badge consumer-${id}`}><i aria-hidden="true"/>{CONSUMERS[id] || t('unknownConsumer')}</span>;
}

export default function App() {
  const [settings, setSettings] = useState(initialSettings);
  const [expenses, setExpenses] = useState([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('record');
  const [raw, setRaw] = useState('0');
  const [selected, setSelected] = useState(null);
  const [consumer, setConsumer] = useState(null);
  const [note, setNote] = useState('');
  const [mode, setMode] = useState(null);
  const [failed, setFailed] = useState(false);
  const [historyCurrency, setHistoryCurrency] = useState('JPY');
  const [period, setPeriod] = useState('month');
  const [editing, setEditing] = useState([]);
  const [notice, setNotice] = useState(null);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [today, setToday] = useState(() => dateKey(new Date(), timezone));
  const service = useRef(null), pending = useRef(null), busyRef = useRef(false), settingsRef = useRef(settings), stateRef = useRef({});
  const keyboard = useRef(false), direction = useRef(1), pageRef = useRef(null), mascotRef = useRef(null), stageRef = useRef(null);
  const disabled = busy || !ready;
  const t = useCallback((key, values) => translate(settings.language, key, values), [settings.language]);
  const locale = LOCALES[settings.language];
  const label = useCallback(category => categoryLabel(category, settings.language), [settings.language]);
  const money = useCallback((minor, currency = settings.currency) => new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: CURRENCIES[currency].digits, maximumFractionDigits: CURRENCIES[currency].digits }).format(minor / 10 ** CURRENCIES[currency].digits), [locale, settings.currency]);
  const [integer, fraction] = raw.split('.');
  const decimalDigits = CURRENCIES[settings.currency].digits;
  const amountMinor = Number(integer) * 10 ** decimalDigits + Number((fraction || '').padEnd(decimalDigits, '0') || 0);
  const decimalSeparator = new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === 'decimal')?.value || '.';
  const amountDisplay = Number(integer).toLocaleString(locale) + (fraction !== undefined ? decimalSeparator + fraction : '');
  stateRef.current = { ready, busy, view, raw, selected, consumer, note, amountMinor };

  const notify = useCallback((key, values, extra = {}) => { setNotice({ id: crypto.randomUUID(), key, values, ...extra }); if (extra.error) haptic('error'); }, []);
  const showError = useCallback(error => notify(null, null, { error: true, message: error.message || '暂时没有保存成功，请再试一次。' }), [notify]);
  const applyProfile = useCallback(profile => {
    const next = validateSettings(profile.settings);
    if (settingsRef.current.currency !== next.currency) { setRaw('0'); pending.current = null; }
    settingsRef.current = next; setSettings(next); setExpenses(profile.expenses);
    setSelected(current => next.categories.some(category => category.id === current) ? current : null);
  }, []);
  const changeBusy = value => { busyRef.current = value; setBusy(value); };
  const navigate = useCallback((next, focus = false) => {
    if (busyRef.current || !stateRef.current.ready || next === stateRef.current.view) return;
    direction.current = next === 'record' ? -1 : 1;
    if (next === 'manage') setEditing(structuredClone(settingsRef.current.categories));
    setView(next); window.scrollTo({ top: 0, behavior: 'instant' });
    if (focus) requestAnimationFrame(() => { const heading = document.querySelector(`#${next}-title`); heading?.focus({ preventScroll: true }); });
    haptic();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        if (telegram?.initData) {
          telegram.ready(); telegram.expand();
          if (supported('6.1')) { telegram.setHeaderColor('#f8f7f1'); telegram.setBackgroundColor('#f8f7f1'); }
          if (supported('7.10')) telegram.setBottomBarColor('#f8f7f1');
        }
        const response = await fetch('/api/config', { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('暂时连接不上，请刷新后再打开。');
        const config = await response.json();
        if (telegram?.initData && config.mode !== 'telegram') throw new Error('bot 服务还没有配置完成，请先配置服务端。');
        const backend = config.mode === 'telegram' ? remoteService(telegram) : localService();
        const profile = await backend.getProfile();
        if (cancelled) return;
        service.current = backend; setMode(config.mode); setHistoryCurrency(profile.settings.currency); applyProfile(profile); setReady(true);
      } catch (error) { if (!cancelled) { setFailed(true); showError(error); } }
    }
    boot();
    const storage = event => { if (event.key === PREVIEW_KEY && service.current && !busyRef.current) service.current.getProfile().then(profile => { if (!cancelled) applyProfile(profile); }).catch(showError); };
    const visible = () => { if (!document.hidden) setToday(dateKey(new Date(), timezone)); };
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = event => setReduced(event.matches);
    window.addEventListener('storage', storage); document.addEventListener('visibilitychange', visible); media.addEventListener('change', motion);
    return () => { cancelled = true; window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', visible); media.removeEventListener('change', motion); };
  }, [applyProfile, showError]);
  useEffect(() => { document.documentElement.lang = locale; document.title = `for. · ${t('title')}`; }, [locale, t]);
  useEffect(() => {
    if (!telegram?.BackButton) return;
    const back = () => navigate('record', true);
    telegram.BackButton.onClick(back);
    try { view === 'record' ? telegram.BackButton.hide() : telegram.BackButton.show(); } catch {}
    return () => telegram.BackButton.offClick?.(back);
  }, [view, navigate]);
  useEffect(() => {
    if (!supported('6.2')) return;
    try { amountMinor || note ? telegram.enableClosingConfirmation() : telegram.disableClosingConfirmation(); } catch {}
  }, [amountMinor, note]);
  useLayoutEffect(() => {
    const element = pageRef.current;
    if (!element || keyboard.current || reduced) return;
    const animation = element.animate([{ opacity: 0, transform: `translate3d(${direction.current * 12}px,0,0)` }, { opacity: 1, transform: 'translate3d(0,0,0)' }], { duration: 220, easing: 'cubic-bezier(.23,1,.32,1)' });
    return () => animation.cancel();
  }, [view, reduced]);

  const selectCategory = useCallback(id => { setSelected(id); pending.current = null; haptic(); }, []);
  const selectConsumer = useCallback(id => { setConsumer(id); pending.current = null; haptic(); }, []);
  const pushKey = useCallback(key => {
    if (busyRef.current || !stateRef.current.ready) return;
    const digits = CURRENCIES[settingsRef.current.currency].digits;
    const current = stateRef.current.raw;
    let next = current;
    if (key === 'backspace') next = current.slice(0, -1) || '0';
    else if (key === 'clear') next = '0';
    else if (key === '.') { if (digits && !current.includes('.')) next += '.'; }
    else if (/^\d$/.test(key)) {
      const [whole, part] = current.split('.');
      if (part !== undefined && part.length >= digits) return;
      if (part === undefined && whole.length >= 8) { notify('maxDigits'); return; }
      next = current === '0' ? key : current + key;
    }
    pending.current = null; stateRef.current.raw = next; setRaw(next);
  }, [notify]);
  const saveExpense = useCallback(async () => {
    const current = stateRef.current;
    if (busyRef.current || !current.ready || !current.amountMinor || !current.selected || !current.consumer) return;
    const payload = { id: pending.current?.id || crypto.randomUUID(), amountMinor: current.amountMinor, currency: settingsRef.current.currency, categoryId: current.selected, consumer: current.consumer, note: current.note, timezone };
    pending.current = payload; changeBusy(true);
    try {
      const entry = await service.current.addExpense(payload);
      setExpenses(current => current.some(e => e.id === entry.id) ? current : [...current, entry]);
      setRaw('0'); setSelected(null); setConsumer(null); setNote(''); pending.current = null;
      notify('saved', { person: CONSUMERS[entry.consumer], amount: money(entry.amountMinor, entry.currency) }); haptic('success');
      if (!reduced && !keyboard.current) mascotRef.current?.animate([{ transform: 'rotate(-8deg) scale(1.06,.95)' }, { transform: 'rotate(-8deg) scale(1)' }], { duration: 240, easing: 'cubic-bezier(.23,1,.32,1)' });
    } catch (error) { showError(error); }
    finally { changeBusy(false); }
  }, [money, notify, reduced, showError]);
  useEffect(() => {
    const keydown = event => {
      keyboard.current = true; document.documentElement.classList.add('keyboard-action');
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
      if (event.key === 'Escape' && stateRef.current.view !== 'record') { navigate('record', true); return; }
      if (stateRef.current.view !== 'record') return;
      if (/^[0-9.,]$/.test(event.key)) { event.preventDefault(); pushKey(event.key === ',' ? '.' : event.key); }
      else if (event.key === 'Backspace') { event.preventDefault(); pushKey('backspace'); }
      else if (event.key === 'Delete') { event.preventDefault(); pushKey('clear'); }
      else if (event.key === 'Enter' && event.target === document.body) { event.preventDefault(); saveExpense(); }
    };
    const pointer = () => { keyboard.current = false; document.documentElement.classList.remove('keyboard-action'); };
    const release = () => stageRef.current?.removeAttribute('data-press');
    document.addEventListener('keydown', keydown); document.addEventListener('pointerdown', pointer); document.addEventListener('pointerup', release); document.addEventListener('pointercancel', release); window.addEventListener('blur', release);
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('pointerdown', pointer); document.removeEventListener('pointerup', release); document.removeEventListener('pointercancel', release); window.removeEventListener('blur', release); };
  }, [navigate, pushKey, saveExpense]);

  async function updateSettings(patch) {
    if (busyRef.current || !ready) return;
    changeBusy(true);
    try { applyProfile(await service.current.saveSettings({ ...settingsRef.current, ...patch })); setNotice(null); if (patch.currency) notify('currencyChanged', { currency: patch.currency }); }
    catch (error) { showError(error); }
    finally { changeBusy(false); }
  }
  async function saveCategories(event) {
    event.preventDefault(); if (busyRef.current) return;
    let next;
    try { next = validateSettings({ ...settingsRef.current, categories: editing }); } catch (error) { showError(error); return; }
    changeBusy(true);
    try { applyProfile(await service.current.saveSettings(next)); changeBusy(false); navigate('record', true); notify('categoriesSaved'); }
    catch (error) { showError(error); }
    finally { changeBusy(false); }
  }
  async function deleteExpense(id) {
    if (busyRef.current) return;
    changeBusy(true);
    try { await service.current.deleteExpense(id); setExpenses(current => current.filter(e => e.id !== id)); notify('removed', null, { undoId: id }); }
    catch (error) { showError(error); }
    finally { changeBusy(false); }
  }
  async function restoreExpense(id) {
    if (busyRef.current) return;
    changeBusy(true);
    try { const entry = await service.current.restoreExpense(id); setExpenses(current => current.some(e => e.id === entry.id) ? current : [...current, entry]); notify('restored'); }
    catch (error) { showError(error); }
    finally { changeBusy(false); }
  }
  const todayEntries = useMemo(() => expenses.filter(e => e.dayKey === today && e.currency === settings.currency), [expenses, today, settings.currency]);
  const historyEntries = useMemo(() => expenses.filter(e => e.currency === historyCurrency && (period === 'all' || e.dayKey.startsWith(today.slice(0, 7)))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [expenses, historyCurrency, period, today]);
  const historyTotal = useMemo(() => historyEntries.reduce((sum, e) => sum + e.amountMinor, 0), [historyEntries]);
  const breakdown = useMemo(() => {
    const groups = new Map();
    historyEntries.forEach(entry => { const group = groups.get(entry.categoryId) || { category: entry.category, total: 0 }; group.total += entry.amountMinor; groups.set(entry.categoryId, group); });
    return [...groups.values()].sort((a, b) => b.total - a.total).slice(0, 6);
  }, [historyEntries]);
  const historyDays = useMemo(() => {
    const days = new Map(); historyEntries.forEach(entry => { const day = days.get(entry.dayKey) || []; day.push(entry); days.set(entry.dayKey, day); }); return [...days];
  }, [historyEntries]);
  const saveLabel = t(busy ? 'saving' : !amountMinor ? 'enterAmount' : !selected ? 'selectCategory' : !consumer ? 'selectConsumer' : 'save');
  const dateLabel = day => day === today ? t('today') : new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`));
  const platform = telegram?.platform === 'ios' || telegram?.platform === 'macos' ? 'ios' : 'base';

  return <AppRoot appearance="light" platform={platform} className="for-root" data-ui-kit="telegram-ui">
    <div className="app-shell">
      <header className="app-header"><a className="brand" href="#record" aria-label={t('record')} onClick={event => { event.preventDefault(); navigate('record'); }}><span className="brand-word">for<span>.</span></span></a><div className="header-actions">
        <SegmentedControl className="view-tabs" aria-label={t('navigation')}>
          <SegmentedControl.Item className="tab" data-view="record" selected={view !== 'history'} aria-selected={view !== 'history'} disabled={disabled} onClick={event => navigate('record', event.detail === 0)}>{t('record')}</SegmentedControl.Item>
          <SegmentedControl.Item className="tab" data-view="history" selected={view === 'history'} aria-selected={view === 'history'} disabled={disabled} onClick={event => navigate('history', event.detail === 0)}>{t('ledger')} <span className="count-dot" id="record-count">{expenses.length > 99 ? '99+' : expenses.length}</span></SegmentedControl.Item>
        </SegmentedControl>
        <Select id="language" className="language-control" before={<Icon name="globe"/>} aria-label={t('language')} value={settings.language} disabled={disabled} onChange={event => updateSettings({ language: event.target.value })}><option value="zh">中文</option><option value="en">EN</option><option value="uk">УКР</option></Select>
      </div></header>

      <main ref={pageRef} className="page" key={view} id={`${view}-view`} aria-labelledby={`${view}-title`}>
      {view === 'record' && <>
        <div className="page-heading"><h1 id="record-title" tabIndex={-1}>{t('recordTitle')}<span>{settings.language === 'zh' ? '？' : '?'}</span></h1><span className="date-label" id="today-label">{new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date())}</span></div>
        <div className="record-layout">
          <section ref={stageRef} className={`amount-stage ${raw.length >= 6 ? 'long-amount' : ''}`} aria-label={t('amountInput')}><div className="amount-meta"><span>{t('amountLabel')}</span><Select id="currency" className="currency-control" value={settings.currency} aria-label={t('currency')} disabled={disabled} onChange={event => updateSettings({ currency: event.target.value })}>{Object.keys(CURRENCIES).map(code => <option key={code} value={code}>{code} · {t(code)}</option>)}</Select></div>
            <div className="amount-line"><span className="currency-symbol" id="currency-symbol">{CURRENCIES[settings.currency].symbol}</span><output id="amount-display" aria-label={t('currentAmount')} data-length={raw.length < 6 ? 'short' : raw.length > 9 ? 'long' : raw.length}>{amountDisplay}</output><span className="input-caret" aria-hidden="true"/></div>
            <div className="amount-bottom"><span id="amount-hint">{selected ? label(settings.categories.find(c => c.id === selected)) : ''}</span><span className="small-spark" aria-hidden="true">✳</span></div><Mascot mascotRef={mascotRef}/>
          </section>
          <section className="purposes" aria-labelledby="purposes-title"><div className="section-heading"><h2 id="purposes-title">{t('categories')}</h2><Button id="edit-categories" className="text-button" size="s" mode="plain" before={<Icon name="edit"/>} disabled={disabled} onClick={() => navigate('manage', true)}>{t('editCategories')}</Button></div><CategoryGrid categories={settings.categories} language={settings.language} selected={selected} disabled={disabled} onSelect={selectCategory}/></section>
          <section id="keypad" className="keypad" aria-label={t('keypad')}>{['1','2','3','4','5','6','7','8','9',decimalDigits ? '.' : 'clear','0','backspace'].map(key => <Tappable Component="button" type="button" className={`key ${key.length > 1 || key === '.' ? 'key-secondary' : ''}`} data-key={key} key={key} id={key === '.' || key === 'clear' ? 'decimal-key' : undefined} disabled={disabled} aria-label={key === 'clear' ? t('clear') : key === '.' ? t('decimal') : key === 'backspace' ? t('backspace') : key} onPointerDownCapture={() => { if (!reduced && !disabled) stageRef.current?.setAttribute('data-press', 'true'); }} onClick={() => { pushKey(key); haptic('impact'); }}>{key === 'clear' ? 'C' : key === '.' ? decimalSeparator : key === 'backspace' ? <Icon name="backspace"/> : key}</Tappable>)}</section>
          <section className="finish" aria-label={t('save')}><ConsumerPicker language={settings.language} consumer={consumer} disabled={disabled} onSelect={selectConsumer}/><Input className="note-field" id="note" before={<Icon name="edit"/>} aria-label={t('note')} placeholder={t('notePlaceholder')} value={note} maxLength={160} disabled={disabled} onChange={event => { pending.current = null; setNote(event.target.value); }}/><Button size="l" stretched className="save-button" id="save-expense" disabled={disabled || !amountMinor || !selected || !consumer} loading={busy} aria-label={saveLabel} after={<span className="save-icon" aria-hidden="true">↗</span>} onClick={saveExpense}><span id="save-label">{saveLabel}</span></Button></section>
        </div>
        <div className="today-strip"><span className="today-icon" aria-hidden="true">↳</span><div><span>{t('todayTotal')}</span><strong id="today-total">{money(todayEntries.reduce((sum, e) => sum + e.amountMinor, 0))}</strong><small id="today-count">{countText(todayEntries.length, settings.language, settings.currency)}</small></div><Button className="text-button" size="s" mode="plain" data-view="history" onClick={() => navigate('history')}>{t('ledger')} →</Button></div>
      </>}
      {view === 'history' && <>
        <div className="page-heading"><h1 id="history-title" tabIndex={-1}>{t('historyTitle')}</h1><Button size="s" mode="plain" className="text-button" data-view="record" onClick={() => navigate('record')}>{t('newEntry')}</Button></div>
        <div className="history-controls"><SegmentedControl className="period-tabs" aria-label={t('period')}>{['month','all'].map(value => <SegmentedControl.Item data-period={value} key={value} selected={period === value} aria-selected={period === value} onClick={() => { setPeriod(value); haptic(); }}>{t(value)}</SegmentedControl.Item>)}</SegmentedControl><Select id="history-currency" className="history-currency" aria-label={t('ledgerCurrency')} value={historyCurrency} onChange={event => setHistoryCurrency(event.target.value)}>{Object.keys(CURRENCIES).map(code => <option value={code} key={code}>{code}</option>)}</Select></div>
        <section className="history-summary" aria-label={t('summary')}><div className="history-summary-amount"><span id="history-period-label">{t(period === 'all' ? 'allSpending' : 'monthSpending')}</span><strong id="history-total">{money(historyTotal, historyCurrency)}</strong><small id="history-total-count">{countText(historyEntries.length, settings.language, historyCurrency)}</small></div><div className="breakdown" id="breakdown">{breakdown.map(group => <div className="breakdown-row" key={group.category.id}><span>{label(group.category)}</span><div className="bar-track"><div className="bar-fill" style={{ transform: `scaleX(${historyTotal ? group.total / historyTotal : 0})` }}/></div><span>{money(group.total, historyCurrency)}</span></div>)}</div></section>
        <div id="history-list" className="history-list">{historyDays.length ? historyDays.map(([day, entries]) => <section key={day}><div className="history-day">{dateLabel(day)}</div>{entries.map(entry => <Cell key={entry.id} Component="article" readOnly multiline className="expense-row" before={<span className="category-icon" style={{ background: `var(--${entry.category.color})` }}><Icon name={entry.category.icon}/></span>} subtitle={<span className="expense-meta"><ConsumerBadge consumer={entry.consumer} t={t}/><time>{new Intl.DateTimeFormat(locale, { timeZone: entry.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(entry.createdAt))}</time></span>} description={entry.note ? <span className="expense-note">{entry.note}</span> : undefined} after={<div className="expense-actions"><span className="expense-money">{money(entry.amountMinor, entry.currency)}</span><Button className="delete-expense" mode="plain" size="s" disabled={busy} data-delete={entry.id} aria-label={t('deleteExpense', { category: label(entry.category), amount: money(entry.amountMinor, entry.currency) })} onClick={() => deleteExpense(entry.id)}><Icon name="trash"/></Button></div>}><strong>{label(entry.category)}</strong></Cell>)}</section>) : <Placeholder className="empty-state" header={t('emptyTitle')} description={t('emptyText')}><span className="empty-face" aria-hidden="true">◡</span><Button mode="filled" size="m" data-view="record" onClick={() => navigate('record')}>{t('newEntry')}</Button></Placeholder>}</div>
      </>}
      {view === 'manage' && <>
        <div className="page-heading"><h1 id="manage-title" tabIndex={-1}>{t('manageTitle')}</h1><Button size="s" mode="plain" id="cancel-edit" className="text-button" onClick={() => navigate('record', true)}>{t('back')}</Button></div>
        <form id="category-form" onSubmit={saveCategories}><div className="category-editor" id="category-editor">{editing.map(category => <div className="editor-row" key={category.id} data-editor-id={category.id}><span className="category-icon" style={{ background: `var(--${category.color})` }}><Icon name={category.icon}/></span><Input className="editor-label" data-field="label" value={label(category)} aria-label={t('categoryName', { name: label(category) })} maxLength={24} disabled={busy} required onChange={event => setEditing(current => current.map(c => c.id === category.id ? { ...c, label: event.target.value } : c))}/><Select className="editor-select" data-field="icon" aria-label={t('categoryIcon', { name: label(category) })} value={category.icon} disabled={busy} onChange={event => setEditing(current => current.map(c => c.id === category.id ? { ...c, icon: event.target.value } : c))}>{ICONS.map(type => <option value={type} key={type}>{t(type)}</option>)}</Select><Select className="editor-select" data-field="color" aria-label={t('categoryColor', { name: label(category) })} value={category.color} disabled={busy} onChange={event => setEditing(current => current.map(c => c.id === category.id ? { ...c, color: event.target.value } : c))}>{COLORS.map(color => <option value={color} key={color}>{t(color)}</option>)}</Select><Button type="button" className="editor-remove" size="s" mode="plain" disabled={busy} data-remove={category.id} aria-label={t('removeCategory', { name: label(category) })} onClick={() => { if (editing.length === 1) notify('keepCategory'); else setEditing(current => current.filter(c => c.id !== category.id)); }}>×</Button></div>)}</div><Button type="button" id="add-category" className="add-category" mode="outline" stretched disabled={busy || editing.length >= 18} onClick={() => { setEditing(current => [...current, { id: crypto.randomUUID(), label: '', icon: 'heart', color: 'peach' }]); requestAnimationFrame(() => document.querySelector('.editor-row:last-child input')?.focus()); }}>{t('addCategory')}</Button><div className="editor-actions"><Button type="button" size="s" mode="plain" className="text-button" id="reset-categories" disabled={busy} onClick={() => setEditing(structuredClone(DEFAULT_CATEGORIES))}>{t('resetCategories')}</Button><Button type="submit" size="l" className="save-button" loading={busy} disabled={busy} after={<span className="save-icon" aria-hidden="true">✓</span>}>{t('saveCategories')}</Button></div></form>
      </>}
      </main>
      <footer className="app-footer"><span id="storage-status" role="status">{t(failed ? 'unavailable' : !ready ? 'loading' : mode === 'telegram' ? 'remoteStorage' : 'localStorage')}</span></footer>
    </div>
    {notice && <Snackbar className={`notice ${notice.error ? 'error' : ''}`} id="notice" role="status" aria-live="polite" key={notice.id} duration={notice.error || notice.undoId ? 2147480000 : 3200} onClose={() => setNotice(current => current?.id === notice.id ? null : current)} before={<span className="notice-face" aria-hidden="true">{notice.error ? '!' : '✓'}</span>} after={<span className="notice-actions">{notice.undoId && <Snackbar.Button id="undo-button" disabled={busy} onClick={() => restoreExpense(notice.undoId)}>{t('undo')}</Snackbar.Button>}<Snackbar.Button id="dismiss-notice" aria-label={t('closeNotice')} onClick={() => setNotice(null)}>×</Snackbar.Button></span>}><span id="notice-text">{notice.error ? translateError(notice.message, settings.language) : t(notice.key, notice.values)}</span></Snackbar>}
  </AppRoot>;
}


import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppRoot, Button, Cell, Input, Placeholder, SegmentedControl, Select, Snackbar, Tappable } from '@telegram-apps/telegram-ui';
import { CURRENCIES, CONSUMERS, COLORS, ICONS, DEFAULT_CATEGORIES, DEFAULT_INCOME_CATEGORIES, resolveLanguage, initialSettings, validateSettings, dateKey, AVATARS, CONSUMER_COLORS } from '../public/shared.mjs';
import { LOCALES, translate, translateError, categoryLabel } from '../public/i18n.mjs';
import { PREVIEW_KEY, localService, remoteService } from './services.mjs';
import { Icon, Mascot } from './icons.jsx';

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const telegram = window.Telegram?.WebApp;
const browserLang = typeof navigator !== 'undefined' ? navigator.language : 'zh';
const detectedLang = resolveLanguage(telegram?.initDataUnsafe?.user?.language_code || browserLang, 'zh');
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
const ConsumerPicker = memo(function ConsumerPicker({ language, consumers, consumer, disabled, onSelect }) {
  const list = consumers && consumers.length ? consumers : DEFAULT_CONSUMERS;
  return <fieldset className="consumer-picker"><legend>{translate(language, 'consumer')}</legend><div className="consumer-options" id="consumers">{list.map(c => {
    const colorClass = `consumer-color-${c.color || 'milk'} consumer-${c.id}`;
    return <Tappable Component="button" type="button" className={`consumer-option ${colorClass} ${consumer === c.id ? 'selected' : ''}`} data-consumer={c.id} key={c.id} aria-pressed={consumer === c.id} disabled={disabled} onClick={() => onSelect(c.id)}>
      <span className="consumer-avatar" aria-hidden="true">
        {c.avatar && (c.avatar.startsWith('http') || c.avatar.startsWith('data:')) ? <img src={c.avatar} alt="" className="avatar-img" /> : <Icon name={c.avatar || 'cat'} />}
      </span>
      <span>{c.name}</span>
      <span className="consumer-check" aria-hidden="true">✓</span>
    </Tappable>;
  })}</div></fieldset>;
});
function ConsumerBadge({ consumer, consumers, t }) {
  const member = (consumers || DEFAULT_CONSUMERS).find(c => c.id === consumer);
  const colorClass = member ? `consumer-color-${member.color || 'milk'} consumer-${member.id}` : (consumer === 'liia' ? 'consumer-color-milk' : 'consumer-color-blue');
  const name = member ? member.name : (CONSUMERS[consumer] || t('unknownConsumer'));
  return <span className={`consumer-badge ${colorClass}`}><i aria-hidden="true"/>{name}</span>;
}

export default function App() {
  const [settings, setSettings] = useState(() => initialSettings(detectedLang));
  const [expenses, setExpenses] = useState([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('record');
  const [recordType, setRecordType] = useState('expense');
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
  const [today, setToday] = useState(() => dateKey(new Date(), timezone));
  const [shareInfo, setShareInfo] = useState({ code: '', isPaired: false, partner: null });
  const [socialInfo, setSocialInfo] = useState({ myFriendCode: '', friends: [], circles: [], activeCircleId: null });
  const [accountInfo, setAccountInfo] = useState({ hasGoogle: false, hasTelegram: false, googleEmail: null, tgUsername: null });
  const [friendCodeInput, setFriendCodeInput] = useState('');
  const [newCircleName, setNewCircleName] = useState('');
  const [selectedFriendIds, setSelectedFriendIds] = useState([]);
  const [syncCodeInput, setSyncCodeInput] = useState('');
  const [activeSyncCode, setActiveSyncCode] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const [myProfile, setMyProfile] = useState({ id: '', name: '', color: 'blue', avatar: 'cat' });
  const [pairCode, setPairCode] = useState('');
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('blue');
  const [editAvatar, setEditAvatar] = useState('cat');
  const service = useRef(null), pending = useRef(null), busyRef = useRef(false), settingsRef = useRef(settings), stateRef = useRef({});
  const keyboard = useRef(false), direction = useRef(1), pageRef = useRef(null), mascotRef = useRef(null), stageRef = useRef(null), amountLineRef = useRef(null);
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
    if (profile.share) setShareInfo(profile.share);
    if (profile.social) setSocialInfo(profile.social);
    if (profile.account) setAccountInfo(profile.account);
    if (profile.user) {
      setMyProfile(profile.user);
      setEditName(profile.user.name);
      setEditColor(profile.user.color);
      setEditAvatar(profile.user.avatar);
    }
    const pool = recordType === 'income' ? (next.incomeCategories || DEFAULT_INCOME_CATEGORIES) : next.categories;
    setSelected(current => pool.some(category => category.id === current) ? current : null);
    setConsumer(current => next.consumers.some(c => c.id === current) ? current : (next.consumers[0]?.id || null));
  }, [recordType]);
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
        if (config.googleClientId) setGoogleClientId(config.googleClientId);
        const isTelegram = Boolean(telegram?.initData);
        if (isTelegram && config.mode !== 'telegram') throw new Error('bot 服务还没有配置完成，请先配置服务端。');
        const hasSession = typeof localStorage !== 'undefined' && Boolean(localStorage.getItem('for_pocket_session_token'));
        const backend = (config.mode === 'telegram' && (isTelegram || hasSession)) ? remoteService(telegram) : localService(detectedLang);
        const profile = await backend.getProfile();
        if (cancelled) return;
        service.current = backend; setMode((isTelegram || hasSession) && config.mode === 'telegram' ? 'telegram' : 'local'); setHistoryCurrency(profile.settings.currency); applyProfile(profile);
        if (telegram?.initDataUnsafe?.user) {
          const tgUser = telegram.initDataUnsafe.user;
          const tgName = (tgUser.first_name || tgUser.username || '').trim();
          if (tgName && (!profile.user?.name || profile.user.name === '我')) {
            backend.updateUserProfile({
              name: tgName.slice(0, 24),
              color: profile.user?.color || 'blue',
              avatar: tgUser.photo_url || profile.user?.avatar || 'cat',
            }).then(p => { if (!cancelled) applyProfile(p); }).catch(() => {});
          }
        }
        setReady(true);
      } catch (error) { if (!cancelled) { setFailed(true); showError(error); } }
    }
    boot();
    const storage = event => { if (event.key === PREVIEW_KEY && service.current && !busyRef.current) service.current.getProfile().then(profile => { if (!cancelled) applyProfile(profile); }).catch(showError); };
    const visible = () => { if (!document.hidden) setToday(dateKey(new Date(), timezone)); };
    window.addEventListener('storage', storage); document.addEventListener('visibilitychange', visible);
    return () => { cancelled = true; window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', visible); };
  }, [applyProfile, showError]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.google?.accounts?.id || !googleClientId) return;
    try {
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async res => {
          if (!res.credential || !service.current) return;
          changeBusy(true);
          try {
            const updated = await service.current.loginWithGoogle(res.credential);
            applyProfile(updated);
            notify('linkSuccess');
            haptic('success');
          } catch (err) {
            showError(err);
          } finally {
            changeBusy(false);
          }
        },
      });
      const googleBtnEl = document.getElementById('google-signin-btn-container');
      if (googleBtnEl) {
        window.google.accounts.id.renderButton(googleBtnEl, {
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
        });
      }
    } catch {}
  }, [googleClientId, applyProfile, notify, showError]);
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
    if (!element) return;
    const animation = element.animate([
      { opacity: 0, transform: `translate3d(${direction.current * 16}px,0,0) scale(0.99)` },
      { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' }
    ], { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' });
    return () => animation.cancel();
  }, [view]);

  const selectCategory = useCallback(id => {
    setSelected(id); pending.current = null; haptic();
    mascotRef.current?.animate([
      { transform: 'rotate(-8deg) scale(1)' },
      { transform: 'rotate(-13deg) scale(1.12,0.92)' },
      { transform: 'rotate(-5deg) scale(0.98,1.03)' },
      { transform: 'rotate(-8deg) scale(1)' }
    ], { duration: 650, easing: 'cubic-bezier(.22,1,.36,1)' });
  }, []);
  const selectConsumer = useCallback(id => {
    setConsumer(id); pending.current = null; haptic();
    mascotRef.current?.animate([
      { transform: 'rotate(-8deg) scale(1)' },
      { transform: 'rotate(2deg) scale(1.14,0.9)' },
      { transform: 'rotate(-11deg) scale(0.97,1.04)' },
      { transform: 'rotate(-8deg) scale(1)' }
    ], { duration: 650, easing: 'cubic-bezier(.22,1,.36,1)' });
  }, []);
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
    amountLineRef.current?.animate([
      { transform: 'scale(1,1)' },
      { transform: 'scale(1.04,0.92)' },
      { transform: 'scale(0.99,1.02)' },
      { transform: 'scale(1.005,0.998)' },
      { transform: 'scale(1,1)' }
    ], { duration: 480, easing: 'cubic-bezier(.22,1,.36,1)' });
    mascotRef.current?.animate([
      { transform: 'rotate(-8deg) scale(1,1)' },
      { transform: 'rotate(-3deg) scale(1.14,0.88)' },
      { transform: 'rotate(-12deg) scale(0.96,1.05)' },
      { transform: 'rotate(-6deg) scale(1.01,0.99)' },
      { transform: 'rotate(-8deg) scale(1,1)' }
    ], { duration: 580, easing: 'cubic-bezier(.22,1,.36,1)' });
  }, [notify]);
  const saveExpense = useCallback(async () => {
    const current = stateRef.current;
    if (busyRef.current || !current.ready || !current.amountMinor || !current.selected || !current.consumer) return;
    const payload = { id: pending.current?.id || crypto.randomUUID(), type: recordType, amountMinor: current.amountMinor, currency: settingsRef.current.currency, categoryId: current.selected, consumer: current.consumer, note: current.note, timezone };
    pending.current = payload; changeBusy(true);
    try {
      const entry = await service.current.addExpense(payload);
      setExpenses(currentEntries => currentEntries.some(e => e.id === entry.id) ? currentEntries : [...currentEntries, entry]);
      setRaw('0'); setSelected(null); setNote(''); pending.current = null;
      const member = settingsRef.current.consumers?.find(c => c.id === entry.consumer);
      const isIncome = entry.type === 'income';
      notify(isIncome ? 'savedIncome' : 'saved', { person: member?.name || CONSUMERS[entry.consumer] || '', amount: money(entry.amountMinor, entry.currency) }); haptic('success');
      mascotRef.current?.animate([
        { transform: 'rotate(-8deg) scale(1) translateY(0)' },
        { transform: 'rotate(14deg) scale(1.22,1.12) translateY(-22px)' },
        { transform: 'rotate(-12deg) scale(1.08,0.94) translateY(-8px)' },
        { transform: 'rotate(5deg) scale(1.03,1.01) translateY(-2px)' },
        { transform: 'rotate(-8deg) scale(1) translateY(0)' }
      ], { duration: 850, easing: 'cubic-bezier(.22,1,.36,1)' });
    } catch (error) { showError(error); }
    finally { changeBusy(false); }
  }, [recordType, money, notify, showError]);
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
    if (busyRef.current) return;
    const isManualLanguage = patch.language !== undefined;
    const prevSettings = settingsRef.current;
    const nextSettings = { ...prevSettings, ...patch, ...(isManualLanguage ? { languageManual: true } : {}) };
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    if (patch.currency && patch.currency !== prevSettings.currency) {
      setRaw('0');
      pending.current = null;
    }
    if (!ready || !service.current) return;
    changeBusy(true);
    try {
      applyProfile(await service.current.saveSettings(nextSettings));
      setNotice(null);
      if (patch.currency && patch.currency !== prevSettings.currency) notify('currencyChanged', { currency: patch.currency });
    } catch (error) {
      settingsRef.current = prevSettings;
      setSettings(prevSettings);
      showError(error);
    } finally {
      changeBusy(false);
    }
  }

  const handleCopyCode = useCallback(() => {
    if (!shareInfo.code) return;
    try {
      navigator.clipboard?.writeText(shareInfo.code);
      notify('codeCopied');
      haptic('selection');
    } catch {
      notify('codeCopied');
    }
  }, [shareInfo.code, notify]);

  const handlePair = useCallback(async event => {
    event?.preventDefault();
    if (busyRef.current || !service.current) return;
    const clean = pairCode.trim().toUpperCase();
    if (clean.length !== 6) { showError(new Error(t('errorInvalidCode'))); return; }
    changeBusy(true);
    try {
      const updated = await service.current.pairLedger(clean);
      applyProfile(updated);
      setPairCode('');
      notify('pairedSuccess');
      haptic('success');
    } catch (err) { showError(err); }
    finally { changeBusy(false); }
  }, [pairCode, applyProfile, notify, showError, t]);

  const handleUnpair = useCallback(async () => {
    if (busyRef.current || !service.current) return;
    changeBusy(true);
    try {
      const updated = await service.current.unpairLedger();
      applyProfile(updated);
      notify('unpairedSuccess');
      haptic('selection');
    } catch (err) { showError(err); }
    finally { changeBusy(false); }
  }, [applyProfile, notify, showError]);

  const handleSaveUserProfile = useCallback(async event => {
    event?.preventDefault();
    if (busyRef.current || !service.current) return;
    const name = editName.trim();
    if (!name || Array.from(name).length > 24) { showError(new Error(t('errorConsumerName'))); return; }
    changeBusy(true);
    try {
      const updated = await service.current.updateUserProfile({ name, color: editColor, avatar: editAvatar });
      applyProfile(updated);
      notify('membersSaved');
      haptic('success');
    } catch (err) { showError(err); }
    finally { changeBusy(false); }
  }, [editName, editColor, editAvatar, applyProfile, notify, showError, t]);

  const handleCopyFriendCode = useCallback(() => {
    const code = socialInfo.myFriendCode || shareInfo.code;
    if (!code) return;
    try {
      navigator.clipboard?.writeText(code);
      notify('codeCopied');
      haptic('selection');
    } catch {
      notify('codeCopied');
    }
  }, [socialInfo.myFriendCode, shareInfo.code, notify]);

  const handleAddFriend = useCallback(async event => {
    event?.preventDefault();
    if (busyRef.current || !service.current) return;
    const clean = friendCodeInput.trim().toUpperCase();
    if (clean.length !== 6) { showError(new Error(t('errorInvalidCode'))); return; }
    changeBusy(true);
    try {
      const updated = await service.current.addFriend(clean);
      applyProfile(updated);
      setFriendCodeInput('');
      notify('friendAdded');
      haptic('success');
    } catch (err) { showError(err); }
    finally { changeBusy(false); }
  }, [friendCodeInput, applyProfile, notify, showError, t]);

  const handleCreateCircle = useCallback(async event => {
    event?.preventDefault();
    if (busyRef.current || !service.current) return;
    const name = newCircleName.trim();
    if (!name) { showError(new Error(t('circleNamePlaceholder'))); return; }
    if (selectedFriendIds.length > 3) { showError(new Error('好友圈成员最多 4 人（包含自己）')); return; }
    changeBusy(true);
    try {
      const updated = await service.current.createCircle(name, selectedFriendIds);
      applyProfile(updated);
      setNewCircleName('');
      setSelectedFriendIds([]);
      notify('circleCreated');
      haptic('success');
    } catch (err) { showError(err); }
    finally { changeBusy(false); }
  }, [newCircleName, selectedFriendIds, applyProfile, notify, showError, t]);

  const handleSwitchCircle = useCallback(async circleId => {
    if (busyRef.current || !service.current) return;
    changeBusy(true);
    try {
      const updated = await service.current.switchCircle(circleId);
      applyProfile(updated);
      notify('circleJoined');
      haptic('selection');
    } catch (err) { showError(err); }
    finally { changeBusy(false); }
  }, [applyProfile, notify, showError]);

  const handleLeaveCircle = useCallback(async circleId => {
    if (busyRef.current || !service.current) return;
    changeBusy(true);
    try {
      const updated = await service.current.leaveCircle(circleId);
      applyProfile(updated);
      notify('unpairedSuccess');
      haptic('selection');
    } catch (err) { showError(err); }
    finally { changeBusy(false); }
  }, [applyProfile, notify, showError]);

  const handleGetLinkCode = useCallback(async () => {
    if (busyRef.current || !service.current) return;
    changeBusy(true);
    try {
      const res = await service.current.getLinkCode();
      setActiveSyncCode(res.code);
      haptic('selection');
    } catch (err) { showError(err); }
    finally { changeBusy(false); }
  }, [showError]);

  const handleVerifyLinkCode = useCallback(async event => {
    event?.preventDefault();
    if (busyRef.current || !service.current) return;
    const clean = syncCodeInput.trim().toUpperCase();
    if (clean.length !== 6) { showError(new Error('请输入 6 位连携码')); return; }
    changeBusy(true);
    try {
      const res = await service.current.verifyLinkCode(clean);
      if (res.profile) applyProfile(res.profile);
      setSyncCodeInput('');
      setActiveSyncCode('');
      notify('linkSuccess');
      haptic('success');
    } catch (err) { showError(err); }
    finally { changeBusy(false); }
  }, [syncCodeInput, applyProfile, notify, showError]);

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

  const activeCircle = useMemo(() => {
    if (!socialInfo?.activeCircleId) return null;
    return (socialInfo?.circles || []).find(c => c.id === socialInfo.activeCircleId) || null;
  }, [socialInfo]);

  const activeCategories = useMemo(() => {
    if (recordType === 'income') {
      return settings.incomeCategories && settings.incomeCategories.length
        ? settings.incomeCategories
        : DEFAULT_INCOME_CATEGORIES;
    }
    return settings.categories;
  }, [recordType, settings.categories, settings.incomeCategories]);

  const todayEntries = useMemo(() => expenses.filter(e => e.dayKey === today && e.currency === settings.currency), [expenses, today, settings.currency]);
  const todayExpenseTotal = useMemo(() => todayEntries.filter(e => e.type !== 'income').reduce((sum, e) => sum + e.amountMinor, 0), [todayEntries]);
  const todayIncomeTotal = useMemo(() => todayEntries.filter(e => e.type === 'income').reduce((sum, e) => sum + e.amountMinor, 0), [todayEntries]);

  const historyEntries = useMemo(() => expenses.filter(e => e.currency === historyCurrency && (period === 'all' || e.dayKey.startsWith(today.slice(0, 7)))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [expenses, historyCurrency, period, today]);
  const historyExpenseTotal = useMemo(() => historyEntries.filter(e => e.type !== 'income').reduce((sum, e) => sum + e.amountMinor, 0), [historyEntries]);
  const historyIncomeTotal = useMemo(() => historyEntries.filter(e => e.type === 'income').reduce((sum, e) => sum + e.amountMinor, 0), [historyEntries]);
  const historyNetBalance = historyIncomeTotal - historyExpenseTotal;
  const historyTotal = historyExpenseTotal;

  const breakdown = useMemo(() => {
    const groups = new Map();
    historyEntries.filter(e => e.type !== 'income').forEach(entry => {
      const group = groups.get(entry.categoryId) || { category: entry.category, total: 0 };
      group.total += entry.amountMinor;
      groups.set(entry.categoryId, group);
    });
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
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <a className="brand" href="#record" aria-label={t('record')} onClick={event => { event.preventDefault(); navigate('record'); }}>
            <img src="/logo.png" alt="logo" className="brand-logo-img" />
            <span className="brand-word">for<span>.</span></span>
          </a>
          {activeCircle && (
            <div className="circle-header-chip" title={t('currentCircle')}>
              <Icon name="users" />
              <span>{activeCircle.name}</span>
            </div>
          )}
        </div>
        <div className="header-actions">
          <SegmentedControl className="view-tabs" aria-label={t('navigation')}>
            <SegmentedControl.Item className="tab" data-view="record" selected={view !== 'history'} aria-selected={view !== 'history'} disabled={disabled} onClick={event => navigate('record', event.detail === 0)}>{t('record')}</SegmentedControl.Item>
            <SegmentedControl.Item className="tab" data-view="history" selected={view === 'history'} aria-selected={view === 'history'} disabled={disabled} onClick={event => navigate('history', event.detail === 0)}>{t('ledger')} <span className="count-dot" id="record-count">{expenses.length > 99 ? '99+' : expenses.length}</span></SegmentedControl.Item>
          </SegmentedControl>
          <Select id="language" className="language-control" before={<Icon name="globe"/>} aria-label={t('language')} value={settings.language} disabled={disabled} onChange={event => updateSettings({ language: event.target.value })}><option value="zh">中文</option><option value="en">EN</option><option value="uk">УКР</option></Select>
        </div>
      </header>

      <main ref={pageRef} className="page" key={view} id={`${view}-view`} aria-labelledby={`${view}-title`}>
      {view === 'record' && <>
        <div className="page-heading"><h1 id="record-title" tabIndex={-1}>{t('recordTitle')}<span>{settings.language === 'zh' ? '？' : '?'}</span></h1><span className="date-label" id="today-label">{new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date())}</span></div>
        <div className="record-layout">
          <section ref={stageRef} className={`amount-stage ${raw.length >= 6 ? 'long-amount' : ''} ${recordType === 'income' ? 'is-income' : ''}`} aria-label={t('amountInput')}>
            <div className="amount-meta">
              <div className="type-toggle-pill" role="radiogroup" aria-label="Type">
                <button
                  type="button"
                  className={`type-pill-btn ${recordType === 'expense' ? 'active is-expense' : ''}`}
                  onClick={() => { setRecordType('expense'); setSelected(null); haptic(); }}
                >
                  {t('expense')}
                </button>
                <button
                  type="button"
                  className={`type-pill-btn ${recordType === 'income' ? 'active is-income' : ''}`}
                  onClick={() => { setRecordType('income'); setSelected(null); haptic(); }}
                >
                  {t('income')}
                </button>
              </div>
              <Select id="currency" className="currency-control" value={settings.currency} aria-label={t('currency')} disabled={disabled} onChange={event => updateSettings({ currency: event.target.value })}>{Object.keys(CURRENCIES).map(code => <option key={code} value={code}>{code} · {t(code)}</option>)}</Select>
            </div>
            <div ref={amountLineRef} className="amount-line"><span className="currency-symbol" id="currency-symbol">{CURRENCIES[settings.currency].symbol}</span><output id="amount-display" aria-label={t('currentAmount')} data-length={raw.length < 6 ? 'short' : raw.length > 9 ? 'long' : raw.length}>{amountDisplay}</output><span className="input-caret" aria-hidden="true"/></div>
            <div className="amount-bottom"><span id="amount-hint">{selected ? label(activeCategories.find(c => c.id === selected)) : ''}</span><span className="small-spark" aria-hidden="true">✳</span></div><Mascot mascotRef={mascotRef}/>
          </section>
          <section className="purposes" aria-labelledby="purposes-title">
            <div className="section-heading">
              <h2 id="purposes-title">{recordType === 'income' ? t('income') : t('categories')}</h2>
              {recordType === 'expense' && <Button id="edit-categories" className="text-button" size="s" mode="plain" before={<Icon name="edit"/>} disabled={disabled} onClick={() => navigate('manage', true)}>{t('editCategories')}</Button>}
            </div>
            <CategoryGrid categories={activeCategories} language={settings.language} selected={selected} disabled={disabled} onSelect={selectCategory}/>
          </section>
          <section id="keypad" className="keypad" aria-label={t('keypad')}>{['1','2','3','4','5','6','7','8','9',decimalDigits ? '.' : 'clear','0','backspace'].map(key => <Tappable Component="button" type="button" className={`key ${key.length > 1 || key === '.' ? 'key-secondary' : ''}`} data-key={key} key={key} id={key === '.' || key === 'clear' ? 'decimal-key' : undefined} disabled={disabled} aria-label={key === 'clear' ? t('clear') : key === '.' ? t('decimal') : key === 'backspace' ? t('backspace') : key} onPointerDownCapture={() => { if (!disabled) stageRef.current?.setAttribute('data-press', 'true'); }} onClick={() => { pushKey(key); haptic('impact'); }}>{key === 'clear' ? 'C' : key === '.' ? decimalSeparator : key === 'backspace' ? <Icon name="backspace"/> : key}</Tappable>)}</section>
          <section className="finish" aria-label={t('save')}>
            <ConsumerPicker language={settings.language} consumers={settings.consumers} consumer={consumer} disabled={disabled} onSelect={selectConsumer}/>
            <div className="finish-row">
              <Input className="note-field" id="note" before={<Icon name="edit"/>} aria-label={t('note')} placeholder={t('notePlaceholder')} value={note} maxLength={160} disabled={disabled} onChange={event => { pending.current = null; setNote(event.target.value); }}/>
              <Button size="l" className="save-fab" id="save-expense" disabled={disabled || !amountMinor || !selected || !consumer} loading={busy} aria-label={saveLabel} onClick={saveExpense}>
                <Icon name="check"/>
              </Button>
            </div>
          </section>
        </div>
        <div className="today-strip">
          <span className="today-icon" aria-hidden="true">↳</span>
          <div className="today-strip-stats">
            <div>
              <span>{t('todayExpense')}</span>
              <strong id="today-total">{money(todayExpenseTotal)}</strong>
            </div>
            {todayIncomeTotal > 0 && (
              <div>
                <span>{t('todayIncome')}</span>
                <strong style={{ color: 'var(--green)' }}>+{money(todayIncomeTotal)}</strong>
              </div>
            )}
            <small id="today-count">{countText(todayEntries.length, settings.language, settings.currency)}</small>
          </div>
          <Button className="text-button" size="s" mode="plain" data-view="history" onClick={() => navigate('history')}>{t('ledger')} →</Button>
        </div>
      </>}
      {view === 'history' && <>
        <div className="page-heading"><h1 id="history-title" tabIndex={-1}>{t('historyTitle')}</h1><Button size="s" mode="plain" className="text-button" data-view="record" onClick={() => navigate('record')}>{t('newEntry')}</Button></div>
        <div className="history-controls"><SegmentedControl className="period-tabs" aria-label={t('period')}>{['month','all'].map(value => <SegmentedControl.Item data-period={value} key={value} selected={period === value} aria-selected={period === value} onClick={() => { setPeriod(value); haptic(); }}>{t(value)}</SegmentedControl.Item>)}</SegmentedControl><Select id="history-currency" className="history-currency" aria-label={t('ledgerCurrency')} value={historyCurrency} onChange={event => setHistoryCurrency(event.target.value)}>{Object.keys(CURRENCIES).map(code => <option value={code} key={code}>{code}</option>)}</Select></div>
        <section className="history-summary" aria-label={t('summary')}>
          <div className="history-summary-amount">
            <span id="history-period-label">{t(period === 'all' ? 'allSpending' : 'monthSpending')}</span>
            <strong id="history-total">{money(historyExpenseTotal, historyCurrency)}</strong>
            {historyIncomeTotal > 0 && (
              <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 13, fontWeight: 700 }}>
                <span style={{ color: 'var(--green)' }}>+{money(historyIncomeTotal, historyCurrency)} {t('income')}</span>
                <span style={{ color: historyNetBalance >= 0 ? 'var(--green)' : 'var(--ink)' }}>{t('netBalance')}: {historyNetBalance >= 0 ? '+' : ''}{money(historyNetBalance, historyCurrency)}</span>
              </div>
            )}
            <small id="history-total-count">{countText(historyEntries.length, settings.language, historyCurrency)}</small>
          </div>
          <div className="breakdown" id="breakdown">{breakdown.map(group => <div className="breakdown-row" key={group.category.id}><span>{label(group.category)}</span><div className="bar-track"><div className="bar-fill" style={{ transform: `scaleX(${historyExpenseTotal ? group.total / historyExpenseTotal : 0})` }}/></div><span>{money(group.total, historyCurrency)}</span></div>)}</div>
        </section>
        <div id="history-list" className="history-list">{historyDays.length ? historyDays.map(([day, entries]) => <section key={day}><div className="history-day">{dateLabel(day)}</div>{entries.map(entry => <Cell key={entry.id} Component="article" readOnly multiline className="expense-row" before={<span className="category-icon" style={{ background: `var(--${entry.category.color})` }}><Icon name={entry.category.icon}/></span>} subtitle={<span className="expense-meta"><ConsumerBadge consumer={entry.consumer} consumers={settings.consumers} t={t}/>{entry.type === 'income' && <span className="income-badge">{t('income')}</span>}<time>{new Intl.DateTimeFormat(locale, { timeZone: entry.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(entry.createdAt))}</time></span>} description={entry.note ? <span className="expense-note">{entry.note}</span> : undefined} after={<div className="expense-actions"><span className={`expense-money ${entry.type === 'income' ? 'is-income' : ''}`} style={entry.type === 'income' ? { color: 'var(--green)' } : {}}>{entry.type === 'income' ? `+${money(entry.amountMinor, entry.currency)}` : money(entry.amountMinor, entry.currency)}</span><Button className="delete-expense" mode="plain" size="s" disabled={busy} data-delete={entry.id} aria-label={t('deleteExpense', { category: label(entry.category), amount: money(entry.amountMinor, entry.currency) })} onClick={() => deleteExpense(entry.id)}><Icon name="trash"/></Button></div>}><strong>{label(entry.category)}</strong></Cell>)}</section>) : <Placeholder className="empty-state" header={t('emptyTitle')} description={t('emptyText')}><span className="empty-face" aria-hidden="true">◡</span><Button mode="filled" size="m" data-view="record" onClick={() => navigate('record')}>{t('newEntry')}</Button></Placeholder>}</div>
      </>}
      {view === 'manage' && <>
        <div className="page-heading"><h1 id="manage-title" tabIndex={-1}>{t('manageTitle')}</h1><Button size="s" mode="plain" id="cancel-edit" className="text-button" onClick={() => navigate('record', true)}>{t('back')}</Button></div>
        <div className="manage-container">
          <section className="manage-card" aria-labelledby="account-link-title">
            <div className="manage-card-header">
              <h2 id="account-link-title" className="manage-card-title"><Icon name="google"/>{t('linkCodeLabel')} / {t('googleLogin')}</h2>
            </div>
            <p className="manage-card-desc">{t('linkSuccess')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>Telegram:</span>
                <strong>{accountInfo.tgUsername || (accountInfo.hasTelegram ? t('tgLinked') : t('tgNotLinked'))}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>Google:</span>
                <strong>{accountInfo.googleEmail || (accountInfo.hasGoogle ? t('googleLinked') : t('googleNotLinked'))}</strong>
              </div>
            </div>
            <div id="google-signin-btn-container" style={{ margin: '8px 0' }}/>
            <div style={{ borderTop: '1px dashed var(--line)', paddingTop: 12, marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#7c876c', marginBottom: 6 }}>{t('syncCodeHint')}</div>
              {activeSyncCode ? (
                <div className="share-code-box">
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 800 }}>{t('linkCodeLabel')}</div>
                    <div className="share-code-val">{activeSyncCode}</div>
                  </div>
                  <Button size="s" mode="filled" onClick={() => { navigator.clipboard?.writeText(activeSyncCode); notify('codeCopied'); }}><Icon name="copy" style={{ width: 14, height: 14, marginRight: 4 }}/>{t('copyCode')}</Button>
                </div>
              ) : (
                <Button size="s" mode="outline" disabled={busy} onClick={handleGetLinkCode} style={{ marginBottom: 10 }}>{t('generateLinkCode')}</Button>
              )}
              <form className="share-pair-form" onSubmit={handleVerifyLinkCode}>
                <input className="share-pair-input" placeholder={t('linkCodePlaceholder')} value={syncCodeInput} maxLength={6} disabled={busy} onChange={e => setSyncCodeInput(e.target.value.toUpperCase())}/>
                <Button type="submit" size="m" mode="filled" disabled={busy || syncCodeInput.trim().length !== 6}>{t('linkButton')}</Button>
              </form>
            </div>
          </section>

          <section className="manage-card" aria-labelledby="friends-manage-title">
            <div className="manage-card-header">
              <h2 id="friends-manage-title" className="manage-card-title"><Icon name="user"/>{t('friends')}</h2>
            </div>
            <p className="manage-card-desc">{t('needFriendsFirst')}</p>
            <div className="share-code-box">
              <div>
                <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 800 }}>{t('myFriendCode')}</div>
                <div className="share-code-val">{socialInfo.myFriendCode || shareInfo.code || '······'}</div>
              </div>
              <Button size="s" mode="filled" disabled={busy || (!socialInfo.myFriendCode && !shareInfo.code)} onClick={handleCopyFriendCode}>
                <Icon name="copy" style={{ width: 14, height: 14, marginRight: 4 }}/>{t('copyCode')}
              </Button>
            </div>
            <form className="share-pair-form" onSubmit={handleAddFriend}>
              <input className="share-pair-input" placeholder={t('friendCodePlaceholder')} value={friendCodeInput} maxLength={6} disabled={busy} onChange={e => setFriendCodeInput(e.target.value.toUpperCase())}/>
              <Button type="submit" size="m" mode="filled" disabled={busy || friendCodeInput.trim().length !== 6}>{t('addFriend')}</Button>
            </form>
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#7c876c', marginBottom: 8 }}>{t('friendList')} ({socialInfo.friends?.length || 0})</div>
              {socialInfo.friends && socialInfo.friends.length > 0 ? (
                <div className="friends-list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {socialInfo.friends.map(f => (
                    <div key={f.id} className="friend-item">
                      <span className="consumer-avatar" aria-hidden="true">
                        {f.avatar && (f.avatar.startsWith('http') || f.avatar.startsWith('data:')) ? <img src={f.avatar} alt="" className="avatar-img" /> : <Icon name={f.avatar || 'cat'} />}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{f.name}</div>
                        {f.tgUsername && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{f.tgUsername}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 0' }}>{t('noFriends')}</div>
              )}
            </div>
          </section>

          <section className="manage-card" aria-labelledby="circles-manage-title">
            <div className="manage-card-header">
              <h2 id="circles-manage-title" className="manage-card-title"><Icon name="users"/>{t('circleMax4')}</h2>
            </div>
            {activeCircle ? (
              <div style={{ background: 'rgba(230,235,215,0.6)', padding: '10px 14px', borderRadius: 12, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 800 }}>{t('currentCircle')}</div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--ink)' }}>{activeCircle.name} ({activeCircle.members?.length || 1}/4)</div>
                </div>
                <Button size="s" mode="outline" disabled={busy} onClick={() => handleSwitchCircle(null)}>{t('switchToDefaultLedger')}</Button>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{t('defaultLedger')}</div>
            )}

            {socialInfo.circles && socialInfo.circles.length > 0 && (
              <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {socialInfo.circles.map(c => {
                  const isActive = socialInfo.activeCircleId === c.id;
                  return (
                    <div key={c.id} className="circle-item">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <strong style={{ fontSize: 14 }}>{c.name}</strong>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {!isActive && <Button size="s" mode="filled" disabled={busy} onClick={() => handleSwitchCircle(c.id)}>{t('switchCircle')}</Button>}
                          <Button size="s" mode="plain" disabled={busy} onClick={() => handleLeaveCircle(c.id)}>{t('leaveCircle')}</Button>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {c.members?.map(mId => {
                          const f = (socialInfo.friends || []).find(friend => friend.id === mId || `u_${friend.id}` === mId);
                          const isMe = mId === myProfile.id || mId === `u_${myProfile.id}`;
                          const mName = isMe ? (myProfile.name || '我') : (f?.name || '成员');
                          return (
                            <span key={mId} className="circle-member-chip">
                              {mName}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <form onSubmit={handleCreateCircle} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#7c876c' }}>{t('createCircle')}</div>
              <Input
                placeholder={t('circleNamePlaceholder')}
                value={newCircleName}
                maxLength={24}
                disabled={busy}
                required
                onChange={e => setNewCircleName(e.target.value)}
              />
              {socialInfo.friends && socialInfo.friends.length > 0 ? (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{t('selectFriends')} ({selectedFriendIds.length}/3)</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {socialInfo.friends.map(f => {
                      const checked = selectedFriendIds.includes(f.id);
                      return (
                        <label key={f.id} className="circle-friend-check">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy || (!checked && selectedFriendIds.length >= 3)}
                            onChange={() => {
                              setSelectedFriendIds(prev => checked ? prev.filter(id => id !== f.id) : [...prev, f.id]);
                            }}
                          />
                          <span>{f.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('needFriendsFirst')}</div>
              )}
              <Button type="submit" size="m" mode="filled" disabled={busy || !newCircleName.trim() || selectedFriendIds.length > 3}>
                {t('createCircle')}
              </Button>
            </form>
          </section>

          <section className="manage-card" aria-labelledby="shared-ledger-title">
            <div className="manage-card-header">
              <h2 id="shared-ledger-title" className="manage-card-title"><Icon name="link"/>{t('sharedLedger')}</h2>
              {shareInfo.isPaired && <span className="share-paired-name">🤝 {t('pairedStatus', { partner: shareInfo.partner?.name || 'Ta' })}</span>}
            </div>
            <p className="manage-card-desc">{t('sharedLedgerIntro')}</p>
            {shareInfo.isPaired ? (
              <div className="share-paired-info">
                <div className="share-paired-name"><span>{t('pairedStatus', { partner: shareInfo.partner?.name || 'Ta' })}</span></div>
                <Button size="m" mode="outline" disabled={busy} onClick={handleUnpair}>{t('unpairButton')}</Button>
              </div>
            ) : (
              <>
                <div className="share-code-box">
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 800 }}>{t('myShareCode')}</div>
                    <div className="share-code-val">{shareInfo.code || '······'}</div>
                  </div>
                  <Button size="s" mode="filled" disabled={busy || !shareInfo.code} onClick={handleCopyCode}><Icon name="copy" style={{ width: 14, height: 14, marginRight: 4 }}/>{t('copyCode')}</Button>
                </div>
                <form className="share-pair-form" onSubmit={handlePair}>
                  <input className="share-pair-input" placeholder={t('partnerCodePlaceholder')} value={pairCode} maxLength={6} disabled={busy} onChange={e => setPairCode(e.target.value.toUpperCase())}/>
                  <Button type="submit" size="m" mode="filled" disabled={busy || pairCode.trim().length !== 6}>{t('connectButton')}</Button>
                </form>
              </>
            )}
          </section>

          <section className="manage-card" aria-labelledby="my-profile-title">
            <div className="manage-card-header"><h2 id="my-profile-title" className="manage-card-title"><Icon name="user"/>{t('manageMembers')}</h2></div>
            <p className="manage-card-desc">{t('manageMembersIntro')}</p>
            <form onSubmit={handleSaveUserProfile} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#7c876c', marginBottom: 6 }}>{t('consumerName', { name: '' })}</div>
                <Input className="editor-label" value={editName} maxLength={24} disabled={busy} required placeholder={myProfile.name || '我的名字'} onChange={e => setEditName(e.target.value)}/>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#7c876c', marginBottom: 6 }}>{t('avatar')}</div>
                <div className="avatar-grid">
                  {AVATARS.map(av => (
                    <button type="button" key={av} className={`avatar-btn ${editAvatar === av ? 'selected' : ''}`} onClick={() => { setEditAvatar(av); haptic(); }}>
                      <Icon name={av}/>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#7c876c', marginBottom: 6 }}>{t('consumerColor', { name: '' })}</div>
                <div className="color-palette">
                  {CONSUMER_COLORS.map(c => (
                    <button type="button" key={c} className={`color-dot-btn ${editColor === c ? 'selected' : ''}`} onClick={() => { setEditColor(c); haptic(); }} aria-label={t(c) || c}>
                      <span className="color-dot-inner" style={{ background: c === 'milk' ? '#fbf8f1' : `var(--${c})`, border: c === 'milk' ? '1px solid #dcd5c5' : 'none' }}/>
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                <Button type="submit" size="m" mode="filled" disabled={busy} loading={busy}>{t('saveMembers')}</Button>
              </div>
            </form>
          </section>

          <section className="manage-card" aria-labelledby="categories-manage-title">
            <div className="manage-card-header"><h2 id="categories-manage-title" className="manage-card-title"><Icon name="edit"/>{t('manageTitle')}</h2></div>
            <p className="manage-card-desc">{t('manageIntro')}</p>
            <form id="category-form" onSubmit={saveCategories}><div className="category-editor" id="category-editor">{editing.map(category => <div className="editor-row" key={category.id} data-editor-id={category.id}><span className="category-icon" style={{ background: `var(--${category.color})` }}><Icon name={category.icon}/></span><Input className="editor-label" data-field="label" value={label(category)} aria-label={t('categoryName', { name: label(category) })} maxLength={24} disabled={busy} required onChange={event => setEditing(current => current.map(c => c.id === category.id ? { ...c, label: event.target.value } : c))}/><Select className="editor-select" data-field="icon" aria-label={t('categoryIcon', { name: label(category) })} value={category.icon} disabled={busy} onChange={event => setEditing(current => current.map(c => c.id === category.id ? { ...c, icon: event.target.value } : c))}>{ICONS.map(type => <option value={type} key={type}>{t(type)}</option>)}</Select><Select className="editor-select" data-field="color" aria-label={t('categoryColor', { name: label(category) })} value={category.color} disabled={busy} onChange={event => setEditing(current => current.map(c => c.id === category.id ? { ...c, color: event.target.value } : c))}>{COLORS.map(color => <option value={color} key={color}>{t(color)}</option>)}</Select><Button type="button" className="editor-remove" size="s" mode="plain" disabled={busy} data-remove={category.id} aria-label={t('removeCategory', { name: label(category) })} onClick={() => { if (editing.length === 1) notify('keepCategory'); else setEditing(current => current.filter(c => c.id !== category.id)); }}>×</Button></div>)}</div><Button type="button" id="add-category" className="add-category" mode="outline" stretched disabled={busy || editing.length >= 18} onClick={() => { setEditing(current => [...current, { id: crypto.randomUUID(), label: '', icon: 'heart', color: 'peach' }]); requestAnimationFrame(() => document.querySelector('.editor-row:last-child input')?.focus()); }}>{t('addCategory')}</Button><div className="editor-actions"><Button type="button" size="s" mode="plain" className="text-button" id="reset-categories" disabled={busy} onClick={() => setEditing(structuredClone(DEFAULT_CATEGORIES))}>{t('resetCategories')}</Button><Button type="submit" size="l" className="save-button" loading={busy} disabled={busy} after={<span className="save-icon" aria-hidden="true">✓</span>}>{t('saveCategories')}</Button></div></form>
          </section>
        </div>
      </>}
      </main>
      <footer className="app-footer"><span id="storage-status" role="status">{t(failed ? 'unavailable' : !ready ? 'loading' : mode === 'telegram' ? 'remoteStorage' : 'localStorage')}</span></footer>
    </div>
    {notice && <Snackbar className={`notice ${notice.error ? 'error' : ''}`} id="notice" role="status" aria-live="polite" key={notice.id} duration={notice.error || notice.undoId ? 2147480000 : 3200} onClose={() => setNotice(current => current?.id === notice.id ? null : current)} before={<span className="notice-face" aria-hidden="true">{notice.error ? '!' : '✓'}</span>} after={<span className="notice-actions">{notice.undoId && <Snackbar.Button id="undo-button" disabled={busy} onClick={() => restoreExpense(notice.undoId)}>{t('undo')}</Snackbar.Button>}<Snackbar.Button id="dismiss-notice" aria-label={t('closeNotice')} onClick={() => setNotice(null)}>×</Snackbar.Button></span>}><span id="notice-text">{notice.error ? translateError(notice.message, settings.language) : t(notice.key, notice.values)}</span></Snackbar>}
  </AppRoot>;
}


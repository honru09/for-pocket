import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@telegram-apps/telegram-ui';
import { CURRENCIES, validateFixedCapital } from '../public/shared.mjs';
import { fixedCapitalSummary } from '../public/fixed-capital.mjs';
import { validTimezone } from '../public/timezone.mjs';
import { freeMoneyCopy } from '../public/free-money-copy.mjs';
import { createFreeMoneyRequestGate, freeMoneyDraft, freeMoneyPlan } from './free-money-plan.mjs';
import { Sheet } from './AccountViews.jsx';
import pocketArt from '../public/assets/pocket-materials-v2/pocket-open.webp';
import cashArt from '../public/assets/pocket-materials-v2/cash-note.webp';
import coinArt from '../public/assets/pocket-materials-v2/coin.webp';
import reserveArt from '../public/assets/pocket-materials-v2/reserve-envelope.webp';
import receiptArt from '../public/assets/pocket-materials-v2/receipt-stack.webp';
import calendarArt from '../public/assets/pocket-materials-v2/calendar.webp';
import './free-money.css';

const NOOP = () => {};
const localeFor = language => ({ zh: 'zh-CN', en: 'en-US', uk: 'uk-UA' })[language] || 'en-US';
function amountLabel(minor, currency, language) {
  const digits = CURRENCIES[currency]?.digits ?? 0;
  return new Intl.NumberFormat(localeFor(language), { style: 'currency', currency, currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(minor || 0) / 10 ** digits);
}
function capitalFor(settings, supplied) {
  const currency = supplied?.currency || settings.fixedCapital?.currency || settings.currency || 'JPY';
  try { return validateFixedCapital(supplied || settings.fixedCapital, currency); }
  catch { return validateFixedCapital(null, CURRENCIES[currency] ? currency : 'JPY'); }
}
function readableError(error, t, fallback) {
  try { const value = t(error?.message); if (value && value !== error?.message) return value; } catch {}
  return fallback;
}
function feedback() { try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light'); } catch {} }
function cycleText(summary, language, copy) {
  if (!summary) return '';
  const format = value => new Intl.DateTimeFormat(localeFor(language), { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
  return copy('cycle', { days: summary.cycleDays, start: format(summary.cycleStart), end: format(summary.cycleEnd) });
}

// Keep the pocket anchored while its contents travel behind the front lip.
// Decode before playback so slow image loading cannot skip the deposit.
export function FreeMoneyPocket({ motionKey = 0, compact = false }) {
  const root = useRef(null), playing = useRef(false), generation = useRef(0), finishTimer = useRef(null), [feeding, setFeeding] = useState(false);
  useEffect(() => () => { generation.current++; clearTimeout(finishTimer.current); playing.current = false; }, []);
  useEffect(() => {
    if (!motionKey || compact || playing.current) return;
    const request = ++generation.current;
    playing.current = true;
    Promise.all([...root.current.querySelectorAll('img')].map(img => img.decode?.().catch(() => {}) || Promise.resolve())).then(() => {
      if (request !== generation.current) return;
      setFeeding(true);
      finishTimer.current = setTimeout(() => { playing.current = false; setFeeding(false); }, 820);
    });
  }, [motionKey, compact]);
  return <div ref={root} className={`free-money-pocket${compact ? ' is-compact' : ''}${feeding ? ' is-feeding' : ''}`} aria-hidden="true">
    {!compact && <img className="free-money-pocket-reserve" src={reserveArt} alt="" draggable="false"/>}
    {!compact && <img className="free-money-pocket-cash" src={cashArt} alt="" draggable="false"/>}
    {!compact && <img className="free-money-pocket-coin" src={coinArt} alt="" draggable="false"/>}
    <img className="free-money-pocket-bag" src={pocketArt} alt="" draggable="false"/>
    {!compact && <img className="free-money-pocket-bag free-money-pocket-front" src={pocketArt} alt="" draggable="false"/>}
  </div>;
}

function MoneyField({ name, label, value, onChange, suffix, hint, error, disabled, numeric = false }) {
  const id = `free-money-${name}`;
  return <label className={`free-money-field${error ? ' has-error' : ''}`} htmlFor={id}>
    <span className="free-money-field-label">{label}{hint && <small>{hint}</small>}</span>
    <span className="free-money-input-wrap"><input id={id} type="text" inputMode={numeric ? 'numeric' : 'decimal'}
      autoComplete="off" maxLength={numeric ? 2 : 22} placeholder="0" value={value} disabled={disabled}
      aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={event => onChange(event.target.value)}/><b>{suffix}</b></span>
    {error && <span className="free-money-field-error" id={`${id}-error`}>{error}</span>}
  </label>;
}

function Breakdown({ capital, copy, language }) {
  const rows = [['income', 'incomesTotal', cashArt], ['fixed', 'expensesTotal', receiptArt], ['savings', 'savingsTarget', reserveArt]];
  return <dl className="free-money-breakdown">{rows.map(([label, field, asset]) => <div key={field}>
    <dt><img src={asset} alt="" aria-hidden="true"/>{copy(label)}</dt><dd>{amountLabel(capital[field], capital.currency, language)}</dd>
  </div>)}</dl>;
}

export function FreeMoneyWizardSheet({ open, onClose, settings, t, disabled = false, saveFixedCapital, analyzeBudget,
  capital: suppliedCapital, expenses = [], ledgerId, onActivated = NOOP }) {
  const current = capitalFor(settings, suppliedCapital), language = settings.language || 'zh';
  const copy = (key, params) => freeMoneyCopy(language, key, params);
  const currency = current.currency, timezone = validTimezone(settings.timezone) || 'Asia/Tokyo';
  const scope = JSON.stringify([ledgerId || '', currency]);
  const [page, setPage] = useState(current.enabled ? 'overview' : 'basics');
  const [draft, setDraft] = useState(() => freeMoneyDraft(current, currency));
  const [sessionCapital, setSessionCapital] = useState(current), [now, setNow] = useState(() => new Date());
  const [checked, setChecked] = useState(false), [saving, setSaving] = useState(false), [saveError, setSaveError] = useState('');
  const [analysisState, setAnalysisState] = useState('idle'), [analysisText, setAnalysisText] = useState('');
  const [notice, setNotice] = useState(''), [motion, setMotion] = useState(0);
  const gate = useRef(createFreeMoneyRequestGate(scope)), latest = useRef({ current, open, scope });
  latest.current = { current, open, scope };
  useLayoutEffect(() => {
    gate.current.reset(scope);
    setSaving(false); setSaveError(''); setAnalysisState('idle'); setAnalysisText(''); setNotice(''); setChecked(false);
    if (open) {
      const value = latest.current.current;
      setSessionCapital(value); setDraft(freeMoneyDraft(value, value.currency));
      setPage(value.enabled ? 'overview' : 'basics'); setNow(new Date()); setMotion(1);
    }
    return () => gate.current.reset();
  }, [open, scope]);
  useEffect(() => {
    if (!open) return;
    const refresh = () => { if (!document.hidden) setNow(new Date()); };
    const timer = setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [open]);

  const plan = freeMoneyPlan(draft, currency, { timezone, language, now });
  const overview = fixedCapitalSummary(expenses, sessionCapital, { currency, timezone, now, ledgerId });
  const summary = page === 'overview' ? overview : plan.summary;
  const invalidateAnalysis = () => { gate.current.cancel('analysis'); setAnalysisState('idle'); setAnalysisText(''); };
  const edit = (key, value) => { setDraft(previous => ({ ...previous, [key]: value })); setSaveError(''); setNotice(''); invalidateAnalysis(); };
  const moveTo = next => { feedback(); setPage(next); setChecked(false); setSaveError(''); setNotice(''); };
  const next = event => {
    event.preventDefault(); if (disabled || saving) return;
    const first = freeMoneyPlan({ ...draft, savings: '0', payday: '1' }, currency, { language, timezone, now });
    if (!first.capital) { setChecked(true); return; }
    moveTo('reserve'); setMotion(value => value + 1);
  };
  const analyze = async () => {
    const value = page === 'overview' ? sessionCapital : plan.capital;
    if (!value || !analyzeBudget || disabled || saving) return;
    const token = gate.current.begin('analysis'); if (!token) return;
    setAnalysisState('loading'); setAnalysisText('');
    try {
      const result = await analyzeBudget({ fixedCapital: value, currency, timezone });
      if (!gate.current.current(token) || !latest.current.open) return;
      setAnalysisText(typeof result?.text === 'string' ? result.text.trim().slice(0, 500) : '');
      setAnalysisState('success');
    } catch {
      if (gate.current.current(token) && latest.current.open) setAnalysisState('error');
    } finally { gate.current.finish(token); }
  };
  const save = async (event, pause = false) => {
    event?.preventDefault?.(); if (disabled || saving) return;
    const value = pause ? { ...sessionCapital, enabled: false } : plan.capital;
    if (!value) { setChecked(true); return; }
    const token = gate.current.begin('save'); if (!token) return;
    invalidateAnalysis(); setSaving(true); setSaveError('');
    try {
      if (typeof saveFixedCapital !== 'function') throw new Error('errorSave');
      const result = await saveFixedCapital(value);
      if (!gate.current.current(token) || !latest.current.open) return;
      if (!result) throw new Error('errorSave');
      const saved = capitalFor(settings, result.settings?.fixedCapital || value);
      setSessionCapital(saved); setDraft(freeMoneyDraft(saved, currency));
      setPage(pause ? 'basics' : 'overview'); setChecked(false); setNotice(pause ? 'paused' : 'saved');
      if (!pause) { feedback(); setMotion(m => m + 1); onActivated(saved); }
    } catch (cause) {
      if (gate.current.current(token) && latest.current.open) setSaveError(readableError(cause, t, copy('saveError')));
    } finally { if (gate.current.finish(token)) setSaving(false); }
  };
  const fieldError = key => checked && plan.errors[key] ? copy(`${plan.errors[key]}Error`) : '';
  const close = () => { gate.current.reset(scope); onClose(); };
  if (!open) return null;
  return <Sheet title={t('freeMoneyTitle')} className="free-money-sheet" onClose={close}>{closeWithMotion => <>
    <div className="free-money-hero">
      <div className="free-money-amount"><span>{copy('daily')}</span><strong data-testid="free-money-daily">{summary ? amountLabel(summary.dailyAllowance, currency, language) : '—'}</strong><small>{summary ? cycleText(summary, language, copy) : currency}</small></div>
      <FreeMoneyPocket motionKey={motion}/>
    </div>
    <div className="free-money-stage" key={page} data-page={page}>
      {page === 'overview' ? <>
        <div className="free-money-today"><span>{copy('today')}</span><strong>{amountLabel(overview.todayRemaining, currency, language)}</strong></div>
        <Breakdown capital={sessionCapital} copy={copy} language={language}/>
        <div className="free-money-cycle-line"><span>{copy('balance')}</span><b>{amountLabel(overview.cycleRemaining, currency, language)}</b></div>
        <p className="free-money-help">{copy('editHint')}</p>
      </> : <form id="free-money-plan-form" className="free-money-form" onSubmit={page === 'basics' ? next : save} noValidate>
        <div className="free-money-step-heading"><h3>{copy(page === 'basics' ? 'setup' : 'reserve')}</h3><span>{page === 'basics' ? '1' : '2'} / 2</span></div>
        {page === 'basics' ? <>
          <p className="free-money-help">{copy('intro')}</p>
          <MoneyField name="income" label={copy('income')} value={draft.income} onChange={value => edit('income', value)} suffix={currency} error={fieldError('income')} disabled={disabled || saving}/>
          <MoneyField name="fixed" label={copy('fixed')} value={draft.fixed} onChange={value => edit('fixed', value)} suffix={currency} error={fieldError('fixed')} disabled={disabled || saving}/>
        </> : <>
          <MoneyField name="savings" label={copy('savings')} hint={copy('reserveHint')} value={draft.savings} onChange={value => edit('savings', value)} suffix={currency} error={fieldError('savings')} disabled={disabled || saving}/>
          <MoneyField name="payday" label={copy('payday')} value={draft.payday} onChange={value => edit('payday', value)} suffix={copy('day')} error={fieldError('payday')} disabled={disabled || saving} numeric/>
          <p className="free-money-calendar-hint"><img src={calendarArt} alt="" aria-hidden="true"/>{copy('paydayHint')}</p>
          {checked && (plan.errors.income || plan.errors.fixed) && <p className="free-money-field-error" role="alert">{copy(`${plan.errors.income || plan.errors.fixed}Error`)}</p>}
        </>}
      </form>}
      {page !== 'basics' && analyzeBudget && <div className="free-money-analysis" aria-live="polite" aria-busy={analysisState === 'loading'}>
        <button type="button" onClick={analyze} disabled={disabled || saving || analysisState === 'loading' || !summary}>
          {analysisState === 'loading' ? copy('analyzing') : analysisState === 'error' ? t('retry') : copy('optional')}
        </button>
        <p>{analysisState === 'error' ? copy('analysisFailed') : analysisState === 'success' ? analysisText || copy('analysisEmpty') : copy('optionalHint')}</p>
      </div>}
    </div>
    {saveError && <p className="free-money-save-error" role="alert">{saveError}</p>}
    {notice && <p className="free-money-notice" role="status">{copy(notice)}</p>}
    <div className="free-money-actions">
      {page === 'basics' ? <Button type="submit" form="free-money-plan-form" className="free-money-primary" disabled={disabled || saving}>{copy('next')}</Button>
        : page === 'reserve' ? <><Button mode="plain" disabled={saving} onClick={() => moveTo('basics')}>{t('back')}</Button><Button type="submit" form="free-money-plan-form" className="free-money-primary" disabled={disabled || saving} aria-busy={saving}>{saving ? t('saving') : copy('save')}</Button></>
          : <><Button mode="plain" disabled={saving} onClick={closeWithMotion}>{copy('close')}</Button><Button className="free-money-primary" disabled={disabled || saving} onClick={() => moveTo('basics')}>{copy('adjust')}</Button></>}
    </div>
    {page === 'overview' && <button type="button" className="free-money-pause" disabled={disabled || saving} onClick={event => save(event, true)}>{saving ? t('saving') : copy('pause')}</button>}
  </>}</Sheet>;
}

export default function FreeMoney({ settings, expenses = [], ledgerId, t, disabled = false, saveFixedCapital, analyzeBudget, mode = 'settings' }) {
  const [open, setOpen] = useState(false);
  const current = useMemo(() => capitalFor(settings), [settings.fixedCapital, settings.currency]);
  const timezone = validTimezone(settings.timezone) || 'Asia/Tokyo';
  const summary = fixedCapitalSummary(expenses, current, { currency: current.currency, timezone, ledgerId });
  useLayoutEffect(() => { setOpen(false); }, [ledgerId]);
  // The pocket belongs to the settings drawer; quick entry stays uncluttered.
  if (mode !== 'settings') return null;
  return <section className={`free-money-card${current.enabled ? ' is-configured' : ''}`}>
    <button type="button" className="free-money-entry" disabled={disabled} onClick={() => { feedback(); setOpen(true); }} aria-label={t('freeMoneyTitle')}>
      <FreeMoneyPocket compact/>
      <span className="free-money-copy"><strong>{t('freeMoneyTitle')}</strong><small>{current.enabled ? `${freeMoneyCopy(settings.language, 'daily')} · ${amountLabel(summary.dailyAllowance, current.currency, settings.language)}` : t('freeMoneyHint')}</small></span>
      <span className="free-money-chevron" aria-hidden="true">›</span>
    </button>
    <FreeMoneyWizardSheet open={open} onClose={() => setOpen(false)} settings={settings} t={t} disabled={disabled}
      saveFixedCapital={saveFixedCapital} analyzeBudget={analyzeBudget} capital={current} expenses={expenses} ledgerId={ledgerId}/>
  </section>;
}

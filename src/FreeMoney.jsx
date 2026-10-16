import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@telegram-apps/telegram-ui';
import { CURRENCIES, validateFixedCapital } from '../public/shared.mjs';
import { fixedCapitalMajor, fixedCapitalMinor, fixedCapitalSummary } from './fixed-capital.mjs';
import { Sheet } from './AccountViews.jsx';
import './free-money.css';

import orbArt from '../public/assets/ui-kit-v1/free-money/free-money-orb-no-bubble-v2-web.png';
import wizardArt from '../public/assets/ui-kit-v1/free-money/free-money-wizard-tactile-v1-web.png';
import coinArt from '../public/assets/ui-kit-v1/free-money/free-money-coin-badge-tactile-v1-web.png';
import diagnosisArt from '../public/assets/ui-kit-v1/free-money/free-money-diagnosis-tactile-v1-web.png';
import confettiArt from '../public/assets/ui-kit-v1/free-money/free-money-confetti-sparkle-v1.svg';

const NOOP = () => {};
function readableError(error, t, fallback) {
  const value = error?.message;
  if (!value) return fallback;
  try {
    const translated = t(value);
    if (translated && translated !== value) return translated;
  } catch {}
  return value;
}

function amountLabel(minor, currency, language = 'zh') {
  const digits = CURRENCIES[currency]?.digits ?? 0;
  return new Intl.NumberFormat(language === 'uk' ? 'uk-UA' : language === 'en' ? 'en-US' : 'zh-CN', {
    style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(Number(minor || 0) / 10 ** digits);
}

function Field({ id, label, value, onChange, inputMode = 'decimal', suffix, hint, disabled = false }) {
  return <label className="free-money-field" htmlFor={id}>
    <span className="free-money-field-label">{label}{hint && <small>{hint}</small>}</span>
    <span className="free-money-input-wrap"><input id={id} inputMode={inputMode} type="text" value={value} disabled={disabled} onChange={event => onChange(event.target.value)} /><b>{suffix}</b></span>
  </label>;
}

export function FreeMoneyDiagnosisCard({ state = 'idle', analysis, error, t, onRetry = NOOP, amount, currency, language }) {
  const title = state === 'loading' ? t('freeMoneyCalculating') : state === 'error' ? t('freeMoneyAnalysisError') : state === 'success' ? (analysis?.generated ? t('freeMoneyPlanReady') : t('freeMoneyLocalReady')) : t('freeMoneyPreviewTitle');
  return <section className={`free-money-diagnosis-card is-${state}`} aria-live="polite" aria-busy={state === 'loading'}>
    <img src={diagnosisArt} alt="" aria-hidden="true" />
    <div className="free-money-diagnosis-copy"><strong>{title}</strong>
      {state === 'loading' && <span role="status">{t('freeMoneyCalculatingHint')}</span>}
      {state === 'error' && <><span>{error || t('freeMoneyAnalysisErrorHint')}</span><button type="button" onClick={onRetry}>{t('retry')}</button></>}
      {state === 'success' && <><span>{analysis?.text || t('freeMoneyLocalHint')}</span><em>{amountLabel(amount, currency, language)}</em></>}
      {state === 'idle' && <span>{t('freeMoneyPreviewHint')}</span>}
    </div>
  </section>;
}

export function FreeMoneyOrb({ t, onOpen, onDismissBubble, disabled = false }) {
  const [bubble, setBubble] = useState(true);
  const dismiss = event => { event.stopPropagation(); setBubble(false); onDismissBubble?.(); };
  return <div className="free-money-orb-entry" data-bubble={bubble ? 'open' : 'closed'}>
    {bubble && <div className="free-money-orb-bubble" role="status"><span>{t('freeMoneyOrbHint')}</span><button type="button" aria-label={t('closeNotice')} onClick={dismiss}>×</button></div>}
    <button type="button" className="free-money-orb" aria-label={t('freeMoneyTitle')} disabled={disabled} onClick={onOpen}><img src={orbArt} alt="" aria-hidden="true" /></button>
  </div>;
}

export function FreeMoneyCoinBadge({ summary, settings, t, onOpen, pulseKey }) {
  const [pulse, setPulse] = useState(false), previousKey = useRef(null);
  useEffect(() => {
    if (!pulseKey || previousKey.current === null) { previousKey.current = pulseKey; return undefined; }
    if (previousKey.current !== pulseKey) {
      previousKey.current = pulseKey; setPulse(true);
      const timer = setTimeout(() => setPulse(false), 260);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [pulseKey]);
  if (!summary) return null;
  const remaining = summary.todayRemaining ?? summary.dailyAllowance ?? 0;
  const currency = summary.currency || settings.currency;
  return <button type="button" className={`free-money-coin-badge ${pulse ? 'is-pulsing' : ''} ${remaining < 0 ? 'is-over' : ''}`} onClick={onOpen} aria-label={`${t('freeMoneyDaily')} ${amountLabel(remaining, currency, settings.language)}`}>
    <span className="free-money-coin-art"><img src={coinArt} alt="" aria-hidden="true" /></span>
    <span className="free-money-coin-copy"><small>{t('freeMoneyDaily')}</small><strong>{amountLabel(remaining, currency, settings.language)}</strong><em>{remaining < 0 ? t('freeMoneyOver') : t('freeMoneyOpenDetails')}</em></span>
  </button>;
}

function FreeMoneyDetailSheet({ open, onClose, summary, capital, settings, t, onEdit }) {
  if (!open) return null;
  const currency = summary?.currency || capital.currency || settings.currency;
  const amount = value => amountLabel(value, currency, settings.language);
  return <Sheet title={t('freeMoneyDetails')} className="free-money-sheet free-money-detail-sheet" onClose={onClose}>
    <div className="free-money-detail-grid">
      <div><span>{t('freeMoneyIncome')}</span><strong>{amount(capital.incomesTotal)}</strong></div>
      <div><span>{t('freeMoneyFixed')}</span><strong>{amount(capital.expensesTotal)}</strong></div>
      <div><span>{t('freeMoneySavings')}</span><strong>{amount(capital.savingsTarget)}</strong></div>
      <div><span>{t('freeMoneyDaily')}</span><strong>{amount(summary.dailyAllowance)}</strong></div>
      <div><span>{t('freeMoneyTodaySpent')}</span><strong>{amount(summary.todaySpent)}</strong></div>
      <div><span>{t('freeMoneyTodayRemaining')}</span><strong className={summary.todayRemaining < 0 ? 'is-negative' : ''}>{amount(summary.todayRemaining)}</strong></div>
      <div><span>{t('freeMoneyCycleRemaining')}</span><strong className={summary.cycleRemaining < 0 ? 'is-negative' : ''}>{amount(summary.cycleRemaining)}</strong></div>
    </div>
    <div className="sheet-actions"><Button mode="plain" onClick={onClose}>{t('back')}</Button><Button className="panel-primary compact-save" onClick={onEdit}>{t('freeMoneyEdit')}</Button></div>
  </Sheet>;
}

export function FreeMoneyWizardSheet({ open, onClose, settings, t, disabled, saveFixedCapital, analyzeBudget, capital: existingCapital, onActivated = NOOP }) {
  const timezone = settings.timezone || 'Asia/Tokyo';
  const budgetCurrency = existingCapital?.currency || settings.fixedCapital?.currency || settings.currency || 'JPY';
  const parsedCurrent = useMemo(() => { try { return validateFixedCapital(settings.fixedCapital, budgetCurrency); } catch { return validateFixedCapital(null, budgetCurrency); } }, [settings.fixedCapital, budgetCurrency]);
  const current = existingCapital || parsedCurrent;
  const currency = current.currency || budgetCurrency;
  const [step, setStep] = useState(1), [phase, setPhase] = useState('idle'), [saving, setSaving] = useState(false), [error, setError] = useState(''), [analysis, setAnalysis] = useState(null);
  const analysisRequest = useRef(0);
  const [draft, setDraft] = useState({ income: '', fixed: '', savings: '', payday: '1' });
  useEffect(() => {
    analysisRequest.current += 1;
    if (!open) return;
    setStep(1); setPhase('idle'); setError(''); setAnalysis(null);
    setDraft({ income: current.enabled ? fixedCapitalMajor(current.incomesTotal, currency) : '', fixed: current.enabled ? fixedCapitalMajor(current.expensesTotal, currency) : '', savings: current.enabled ? fixedCapitalMajor(current.savingsTarget, currency) : '', payday: String(current.payday || 1) });
  }, [open, current, currency]);
  const values = () => {
    const payday = String(draft.payday).trim();
    return {
      income: fixedCapitalMinor(draft.income, currency),
      fixed: fixedCapitalMinor(draft.fixed, currency),
      savings: String(draft.savings).trim() === '' ? 0 : fixedCapitalMinor(draft.savings, currency),
      payday: /^\d{1,2}$/.test(payday) ? Number(payday) : null,
    };
  };
  const toCapital = () => {
    const value = values();
    if (value.income === null || value.fixed === null || value.savings === null || value.payday === null || value.payday < 1 || value.payday > 31 || value.income < 1 || value.fixed > value.income) return null;
    if (value.fixed + value.savings > value.income) return null;
    return { enabled: true, currency, incomesTotal: value.income, expensesTotal: value.fixed, savingsTarget: value.savings, dailyAllowance: 0, payday: value.payday, lastCalculatedAt: null };
  };
  const invalidateAnalysis = () => { analysisRequest.current += 1; setError(''); setPhase('idle'); setAnalysis(null); };
  const next = () => { invalidateAnalysis(); if (!toCapital()) { setError(t('freeMoneyInvalid')); return; } setStep(2); };
  const analyze = async () => {
    const capital = toCapital();
    if (!capital) { setError(t('freeMoneyInvalid')); return; }
    const requestId = ++analysisRequest.current;
    setError(''); setPhase('loading'); setAnalysis(null);
    try {
      if (!analyzeBudget) throw new Error(t('freeMoneyAnalysisUnavailable'));
      const result = await analyzeBudget({ fixedCapital: capital, currency, timezone });
      if (requestId !== analysisRequest.current) return;
      setAnalysis(result || { generated: false }); setPhase('success');
    } catch (cause) {
      if (requestId !== analysisRequest.current) return;
      setError(readableError(cause, t, t('freeMoneyAnalysisUnavailable'))); setPhase('error');
    }
  };
  const activate = async () => {
    const capital = toCapital();
    if (!capital || phase !== 'success') return;
    setSaving(true); setError('');
    try {
      if (!saveFixedCapital) throw new Error(t('freeMoneySaveError'));
      const result = await saveFixedCapital(capital);
      if (result === false) { setError(t('freeMoneySaveError')); return; }
      onActivated(); onClose();
    } catch (cause) { setError(readableError(cause, t, t('freeMoneySaveError'))); }
    finally { setSaving(false); }
  };
  if (!open) return null;
  const previewCapital = toCapital();
  const preview = previewCapital ? fixedCapitalSummary([], previewCapital, { currency, timezone, now: new Date() }) : null;
  return <Sheet title={t('freeMoneyTitle')} className="free-money-sheet" onClose={() => !saving && onClose()}>
    <div className="free-money-sheet-art"><img src={step === 1 ? wizardArt : diagnosisArt} alt="" aria-hidden="true" /></div>
    <div className="free-money-stepper" aria-label={`${step}/2`}><span className={step === 1 ? 'active' : ''}>1</span><i/><span className={step === 2 ? 'active' : ''}>2</span></div>
    {step === 1 ? <div className="free-money-form"><p className="quiet-copy">{t('freeMoneyIntro')}</p><Field id="free-money-income" label={t('freeMoneyIncome')} value={draft.income} disabled={disabled || saving || phase === 'loading'} onChange={value => { setDraft(d => ({ ...d, income: value })); invalidateAnalysis(); }} suffix={currency}/><Field id="free-money-fixed" label={t('freeMoneyFixed')} value={draft.fixed} disabled={disabled || saving || phase === 'loading'} onChange={value => { setDraft(d => ({ ...d, fixed: value })); invalidateAnalysis(); }} suffix={currency}/>{error && <p className="field-error" role="alert">{error}</p>}<Button className="panel-primary compact-save" disabled={disabled || saving} onClick={next}>{t('freeMoneyNext')}</Button></div>
      : <div className="free-money-form"><p className="quiet-copy">{t('freeMoneySavingsIntro')}</p><Field id="free-money-savings" label={t('freeMoneySavings')} value={draft.savings} disabled={disabled || saving || phase === 'loading'} onChange={value => { setDraft(d => ({ ...d, savings: value })); invalidateAnalysis(); }} suffix={currency}/><Field id="free-money-payday" label={t('freeMoneyPayday')} inputMode="numeric" value={draft.payday} disabled={disabled || saving || phase === 'loading'} onChange={value => { setDraft(d => ({ ...d, payday: value })); invalidateAnalysis(); }} suffix={t('freeMoneyDay')}/>{preview && phase === 'idle' && <div className="free-money-preview"><span>{t('freeMoneyDaily')}</span><strong>{amountLabel(preview.dailyAllowance, currency, settings.language)}</strong></div>}<FreeMoneyDiagnosisCard state={phase} analysis={analysis} error={error} t={t} onRetry={analyze} amount={analysis?.summary?.dailyAllowance || preview?.dailyAllowance || 0} currency={currency} language={settings.language}/>{phase === 'error' ? <div className="sheet-actions"><Button mode="plain" disabled={saving} onClick={() => { invalidateAnalysis(); setStep(1); }}>{t('back')}</Button></div> : phase === 'success' ? <div className="sheet-actions"><Button mode="plain" disabled={saving} onClick={() => { invalidateAnalysis(); setStep(1); }}>{t('back')}</Button><Button className="panel-primary compact-save" disabled={disabled || saving} onClick={activate}>{saving ? t('saving') : t('freeMoneyEnable')}</Button></div> : <div className="sheet-actions"><Button mode="plain" disabled={saving} onClick={() => { invalidateAnalysis(); setStep(1); }}>{t('back')}</Button><Button className="panel-primary compact-save" disabled={disabled || saving} onClick={analyze}>{t('freeMoneyNext')}</Button></div>}{error && phase !== 'error' && <p className="field-error" role="alert">{error}</p>}</div>}
  </Sheet>;
}

export default function FreeMoney({ settings, expenses = [], ledgerId, t, disabled, updateSettings, saveFixedCapital, analyzeBudget, mode = 'settings', pulseKey, summary: suppliedSummary }) {
  const [open, setOpen] = useState(false), [detailOpen, setDetailOpen] = useState(false), [celebrating, setCelebrating] = useState(false), [disabling, setDisabling] = useState(false), [disableError, setDisableError] = useState('');
  const budgetCurrency = settings.fixedCapital?.currency || settings.currency || 'JPY';
  const current = useMemo(() => { try { return validateFixedCapital(settings.fixedCapital, budgetCurrency); } catch { return validateFixedCapital(null, budgetCurrency); } }, [settings.fixedCapital, budgetCurrency]);
  const configured = current.enabled;
  const summary = suppliedSummary || fixedCapitalSummary(expenses, current, { currency:budgetCurrency, timezone:settings.timezone, ledgerId });
  const activated = () => { setDisableError(''); setCelebrating(true); setTimeout(() => setCelebrating(false), 900); };
  const disable = async event => {
    event.stopPropagation();
    if (disabling || disabled || !saveFixedCapital) return;
    setDisabling(true); setDisableError('');
    try { await saveFixedCapital({ ...current, enabled: false }); }
    catch (cause) { setDisableError(readableError(cause, t, t('freeMoneySaveError'))); }
    finally { setDisabling(false); }
  };
  if (mode === 'home') return <>{configured ? <FreeMoneyCoinBadge summary={summary} settings={{ ...settings, currency:budgetCurrency }} t={t} onOpen={() => setDetailOpen(true)} pulseKey={pulseKey}/> : <FreeMoneyOrb t={t} disabled={disabled} onOpen={() => setOpen(true)}/>} {celebrating && <div className="free-money-confetti" aria-hidden="true"><img src={confettiArt} alt="" /></div>}<FreeMoneyDetailSheet open={detailOpen} onClose={() => setDetailOpen(false)} summary={summary} capital={current} settings={{ ...settings, currency:budgetCurrency }} t={t} onEdit={() => { setDetailOpen(false); setOpen(true); }}/><FreeMoneyWizardSheet open={open} onClose={() => setOpen(false)} settings={settings} t={t} disabled={disabled} saveFixedCapital={saveFixedCapital} analyzeBudget={analyzeBudget} capital={current} onActivated={activated}/></>;
  const daily = summary?.dailyAllowance || current.dailyAllowance || 0;
  return <section className={`free-money-card ${configured ? 'is-configured' : ''}`}><button type="button" className="free-money-entry" disabled={disabled} onClick={() => { setDisableError(''); setOpen(true); }} aria-label={t('freeMoneyTitle')}><span className="free-money-art-wrap"><img src={configured ? coinArt : orbArt} alt="" aria-hidden="true" /></span><span className="free-money-copy"><strong>{t('freeMoneyTitle')}</strong><small>{configured ? `${t('freeMoneyDaily')} · ${amountLabel(daily, budgetCurrency, settings.language)}` : t('freeMoneyHint')}</small></span><span className="free-money-chevron" aria-hidden="true">›</span></button>{configured && <div className="free-money-balance"><span>{t('freeMoneyLeft')}</span><strong>{amountLabel(summary?.cycleRemaining ?? 0, budgetCurrency, settings.language)}</strong><button type="button" disabled={disabled || disabling} aria-busy={disabling} onClick={disable}>{disabling ? t('saving') : t('freeMoneyTurnOff')}</button></div>}{disableError && <p className="free-money-inline-error" role="alert">{disableError}</p>}{celebrating && <div className="free-money-confetti" aria-hidden="true"><img src={confettiArt} alt="" /></div>}<FreeMoneyWizardSheet open={open} onClose={() => setOpen(false)} settings={settings} t={t} disabled={disabled} saveFixedCapital={saveFixedCapital} analyzeBudget={analyzeBudget} capital={current} onActivated={activated}/></section>;
}

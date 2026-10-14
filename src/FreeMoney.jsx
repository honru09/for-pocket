import React, { useMemo, useState } from 'react';
import { Button } from '@telegram-apps/telegram-ui';
import { CURRENCIES, validateFixedCapital } from '../public/shared.mjs';
import { calculateDailyAllowance, fixedCapitalAvailable, fixedCapitalMajor, fixedCapitalMinor } from './fixed-capital.mjs';
import { Sheet } from './AccountViews.jsx';
import './free-money.css';

import orbArt from '../public/assets/ui-kit-v1/free-money/free-money-orb-tactile-v1-web.png';
import coinArt from '../public/assets/ui-kit-v1/free-money/free-money-coin-badge-tactile-v1-web.png';
import diagnosisArt from '../public/assets/ui-kit-v1/free-money/free-money-diagnosis-tactile-v1-web.png';

function amountLabel(minor, currency, language = 'zh') {
  const digits = CURRENCIES[currency]?.digits ?? 0;
  return new Intl.NumberFormat(language === 'uk' ? 'uk-UA' : language === 'en' ? 'en-US' : 'zh-CN', {
    style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(Number(minor || 0) / 10 ** digits);
}

function Field({ label, value, onChange, inputMode = 'decimal', suffix }) {
  return <label className="free-money-field"><span>{label}</span><span className="free-money-input-wrap"><input inputMode={inputMode} type="text" value={value} onChange={event => onChange(event.target.value)} /><b>{suffix}</b></span></label>;
}

export default function FreeMoney({ settings, expenses = [], t, disabled, updateSettings }) {
  const currency = settings.currency || 'JPY';
  const current = useMemo(() => {
    try { return validateFixedCapital(settings.fixedCapital); } catch { return validateFixedCapital(null); }
  }, [settings.fixedCapital]);
  const configured = current.enabled;
  const available = fixedCapitalAvailable(expenses, current, { currency, timezone: settings.timezone });
  const allowance = configured ? (current.dailyAllowance || calculateDailyAllowance(current.incomesTotal, current.expensesTotal, current.savingsTarget, current.payday || 1, new Date(), settings.timezone)) : 0;
  const [open, setOpen] = useState(false), [step, setStep] = useState(1), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [draft, setDraft] = useState(() => ({
    income: configured ? fixedCapitalMajor(current.incomesTotal, currency) : '',
    fixed: configured ? fixedCapitalMajor(current.expensesTotal, currency) : '',
    savings: configured ? fixedCapitalMajor(current.savingsTarget, currency) : '',
    payday: configured ? String(current.payday || 1) : '1',
  }));
  const openWizard = () => {
    setDraft({ income: configured ? fixedCapitalMajor(current.incomesTotal, currency) : '', fixed: configured ? fixedCapitalMajor(current.expensesTotal, currency) : '', savings: configured ? fixedCapitalMajor(current.savingsTarget, currency) : '', payday: configured ? String(current.payday || 1) : '1' });
    setStep(1); setError(''); setOpen(true);
  };
  const submit = async () => {
    setError('');
    const income = fixedCapitalMinor(draft.income, currency), fixed = fixedCapitalMinor(draft.fixed, currency), savings = fixedCapitalMinor(draft.savings, currency), payday = Number(draft.payday) || 1;
    if (income === null || fixed === null || savings === null || fixed + savings > income) { setError(t('freeMoneyInvalid')); return; }
    const next = { enabled: true, incomesTotal: income, expensesTotal: fixed, savingsTarget: savings, dailyAllowance: calculateDailyAllowance(income, fixed, savings, payday, new Date(), settings.timezone), payday, lastCalculatedAt: new Date().toISOString() };
    setSaving(true);
    try {
      const result = await updateSettings({ fixedCapital: next });
      if (result === false) { setError(t('freeMoneySaveError')); return; }
      setOpen(false);
    } finally { setSaving(false); }
  };
  const disable = async () => { setSaving(true); try { await updateSettings({ fixedCapital: { ...current, enabled: false } }); } finally { setSaving(false); } };
  return <section className={`free-money-card ${configured ? 'is-configured' : ''}`}>
    <button type="button" className="free-money-entry" disabled={disabled} onClick={openWizard} aria-label={t('freeMoneyTitle')}>
      <span className="free-money-art-wrap"><img src={configured ? coinArt : orbArt} alt="" aria-hidden="true" /></span>
      <span className="free-money-copy"><strong>{t('freeMoneyTitle')}</strong><small>{configured ? `${t('freeMoneyDaily')} · ${amountLabel(allowance, currency, settings.language)}` : t('freeMoneyHint')}</small></span>
      <span className="free-money-chevron" aria-hidden="true">›</span>
    </button>
    {configured && <div className="free-money-balance"><span>{t('freeMoneyLeft')}</span><strong>{amountLabel(available, currency, settings.language)}</strong><button type="button" disabled={disabled || saving} onClick={disable}>{t('freeMoneyTurnOff')}</button></div>}
    {open && <Sheet title={t('freeMoneyTitle')} className="free-money-sheet" onClose={() => !saving && setOpen(false)}>
      <div className="free-money-sheet-art"><img src={step === 1 ? orbArt : diagnosisArt} alt="" aria-hidden="true" /></div>
      <div className="free-money-stepper" aria-label={`${step}/2`}><span className={step === 1 ? 'active' : ''}>1</span><i/><span className={step === 2 ? 'active' : ''}>2</span></div>
      {step === 1 ? <div className="free-money-form"><p className="quiet-copy">{t('freeMoneyIntro')}</p><Field label={t('freeMoneyIncome')} value={draft.income} onChange={value => setDraft(currentDraft => ({ ...currentDraft, income: value }))} suffix={currency}/><Field label={t('freeMoneyFixed')} value={draft.fixed} onChange={value => setDraft(currentDraft => ({ ...currentDraft, fixed: value }))} suffix={currency}/><Field label={t('freeMoneySavings')} value={draft.savings} onChange={value => setDraft(currentDraft => ({ ...currentDraft, savings: value }))} suffix={currency}/><Field label={t('freeMoneyPayday')} inputMode="numeric" value={draft.payday} onChange={value => setDraft(currentDraft => ({ ...currentDraft, payday: value }))} suffix={t('freeMoneyDay')}/>{error && <p className="field-error" role="alert">{error}</p>}<Button className="panel-primary compact-save" disabled={saving} onClick={() => setStep(2)}>{t('freeMoneyNext')}</Button></div>
        : <div className="free-money-diagnosis"><p className="quiet-copy">{t('freeMoneyReady')}</p><div className="free-money-preview"><span>{t('freeMoneyDaily')}</span><strong>{amountLabel((fixedCapitalMinor(draft.income, currency) || 0) - (fixedCapitalMinor(draft.fixed, currency) || 0) - (fixedCapitalMinor(draft.savings, currency) || 0), currency, settings.language)}</strong></div>{error && <p className="field-error" role="alert">{error}</p>}<div className="sheet-actions"><Button mode="plain" disabled={saving} onClick={() => setStep(1)}>{t('back')}</Button><Button className="panel-primary compact-save" disabled={saving} onClick={submit}>{saving ? t('saving') : t('freeMoneyEnable')}</Button></div></div>}
    </Sheet>}
  </section>;
}

import React, { useEffect, useId, useRef, useState } from 'react';
import { Button, Tappable, Textarea } from '@telegram-apps/telegram-ui';
import { CURRENCIES } from '../public/shared.mjs';
import { LOCALES, categoryLabel, translateError } from '../public/i18n.mjs';
import { Icon } from './icons.jsx';
import './ai-summary.css';

export default function AiSummary({ t, profile, settings, currency = settings?.currency || 'JPY', busy = false, run, service, isRemote = false, config = {}, onAccount }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState('month');
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const panelId = useId();
  const activeCurrency = Object.hasOwn(CURRENCIES, currency) ? currency : 'JPY';
  const language = settings?.language || 'zh';
  const scope = `${profile?.user?.id || ''}:${profile?.ledgerId || ''}:${activeCurrency}:${language}`;
  const scopeRef = useRef(scope), operationRef = useRef(0), workingRef = useRef(false), mountedRef = useRef(true);
  scopeRef.current = scope;
  const enabled = Boolean(isRemote && config?.aiEnabled && typeof service?.aiSummary === 'function');
  const currentResult = result?.scope === scope ? result : null;
  const stats = currentResult?.stats;
  const money = minor => new Intl.NumberFormat(LOCALES[language] || 'zh-CN', {
    style: 'currency', currency: activeCurrency, currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: CURRENCIES[activeCurrency].digits, maximumFractionDigits: CURRENCIES[activeCurrency].digits,
  }).format((Number.isFinite(Number(minor)) ? Number(minor) : 0) / 10 ** CURRENCIES[activeCurrency].digits);
  const date = day => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return '';
    const value = new Date(`${day}T12:00:00Z`);
    return Number.isFinite(value.getTime()) ? new Intl.DateTimeFormat(LOCALES[language] || 'zh-CN', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(value) : '';
  };
  const purposeLabel = entry => {
    const category = settings?.categories?.find(item => item.id === entry.categoryId || item.id === entry.id || item.label === entry.label);
    return category ? categoryLabel(category, language) : String(entry.label || '');
  };
  const byConsumer = Array.isArray(stats?.byConsumer) ? stats.byConsumer : [];
  const byCategory = Array.isArray(stats?.byCategory) ? stats.byCategory : [];

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; operationRef.current++; };
  }, []);

  useEffect(() => {
    operationRef.current++;
    workingRef.current = false;
    setOpen(false); setQuestion(''); setResult(null); setError(''); setWorking(false); setDetailsOpen(false);
  }, [scope]);

  const choosePeriod = next => {
    if (workingRef.current || busy || next === period) return;
    setPeriod(next); setResult(null); setError(''); setDetailsOpen(false);
  };

  const generate = async event => {
    event.preventDefault();
    if (workingRef.current || busy || !enabled) return;
    const requestScope = scope, requestId = ++operationRef.current;
    const current = () => mountedRef.current && scopeRef.current === requestScope && operationRef.current === requestId;
    workingRef.current = true;
    setWorking(true); setError('');
    const operation = async () => {
      try {
        const response = await service.aiSummary({ period, question: question.trim(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, currency: activeCurrency, ledgerId: profile?.ledgerId });
        if (!response?.stats || typeof response.text !== 'string') throw new Error('aiSummaryError');
        return response;
      } catch (caught) {
        if (current()) setError(translateError(caught?.message || 'aiSummaryError', language));
        return null;
      }
    };
    try {
      const response = await (run ? run(operation) : operation());
      if (response && current()) { setResult({ ...response, scope: requestScope }); setDetailsOpen(false); }
    } catch (caught) {
      if (current()) setError(translateError(caught?.message || 'aiSummaryError', language));
    } finally {
      if (current()) { workingRef.current = false; setWorking(false); }
    }
  };

  return <section className={`ai-recap ${open ? 'is-open' : ''}`}>
    <Tappable Component="button" type="button" className="ai-recap-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
      <span className="ai-recap-mark"><Icon name="spark"/></span><span>{t('aiSummaryTitle')}</span><Icon name="chevronDown"/>
    </Tappable>
    {open && <div id={panelId} className="ai-recap-body">
      {!isRemote ? <div className="ai-recap-gate"><p>{t('aiSummaryNeedLogin')}</p>{onAccount && <Button type="button" mode="plain" onClick={onAccount}>{t('signIn')}</Button>}</div>
        : !enabled ? <p className="ai-recap-hint">{t('aiSummaryUnavailable')}</p>
          : <>
            <form className="ai-recap-form" onSubmit={generate}>
              <div className="ai-recap-period" role="group" aria-label={t('aiSummaryPeriod')}>{['week', 'month'].map(value => <Tappable Component="button" type="button" key={value} aria-pressed={period === value} disabled={working || busy} onClick={() => choosePeriod(value)}>{t(value === 'week' ? 'aiSummaryWeek' : 'aiSummaryMonth')}</Tappable>)}</div>
              <Textarea className="ai-recap-question" aria-label={t('aiSummaryQuestion')} placeholder={t('aiSummaryQuestionPlaceholder')} rows={2} maxLength={300} value={question} onChange={event => setQuestion(event.target.value)} disabled={working || busy}/>
              <div className="ai-recap-actions"><Button type="submit" className="ai-recap-generate" disabled={working || busy}>{working ? t('aiSummaryGenerating') : t(currentResult ? 'aiSummaryRegenerate' : 'aiSummaryGenerate')}</Button>{!currentResult && <span>{t('aiSummaryHint')}</span>}</div>
            </form>
            {error && <p className="ai-recap-error" role="status">{error}</p>}
            {currentResult && <div className="ai-recap-result" aria-live="polite">
              <div className="ai-recap-caption"><span>{date(stats.startDay)} — {date(stats.endDay)}</span><span>{t('aiSummaryRecords', { n: stats.count || 0 })}</span></div>
              <div className="ai-recap-totals"><div><span>{t('expense')}</span><strong>{money(stats.expenseMinor)}</strong></div><div><span>{t('income')}</span><strong>{money(stats.incomeMinor)}</strong></div></div>
              <p className="ai-recap-text">{currentResult.text || t(stats.count > 0 ? 'aiSummaryStatsOnly' : 'aiSummaryNoRecords')}</p>
              {(byCategory.length > 0 || byConsumer.length > 0) && <div className="ai-recap-details">
                <Tappable Component="button" type="button" className="ai-recap-details-toggle" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}><span>{t('aiSummaryBreakdown')}</span><Icon name="chevronDown"/></Tappable>
                {detailsOpen && <div className="ai-recap-breakdown">
                  {byCategory.length > 0 && <div><h3>{t('aiSummaryByCategory')}</h3><ul>{byCategory.map((entry, index) => <li key={`${entry.categoryId || entry.label}-${index}`}><span>{purposeLabel(entry)}</span><strong>{money(entry.amountMinor)}</strong></li>)}</ul></div>}
                  {byConsumer.length > 0 && <div><h3>{t('aiSummaryByPerson')}</h3><ul>{byConsumer.map((entry, index) => <li key={`${entry.id || entry.name}-${index}`}><span>{entry.name}</span><strong>{money(entry.amountMinor)}</strong></li>)}</ul></div>}
                </div>}
              </div>}
            </div>}
          </>}
    </div>}
  </section>;
}

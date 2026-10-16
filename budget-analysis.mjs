import { CURRENCIES, resolveLanguage, validateFixedCapital } from './public/shared.mjs';
import { fixedCapitalSummary } from './public/fixed-capital.mjs';

function money(minor, currency) {
  const digits = CURRENCIES[currency]?.digits ?? 0;
  return (Number(minor || 0) / 10 ** digits).toFixed(digits) + ` ${currency}`;
}

export function budgetAnalysisPrompt(summary, language = 'zh') {
  const languageName = language === 'uk' ? 'natural Ukrainian' : language === 'en' ? 'natural English' : 'natural Simplified Chinese';
  return `Write one or two short, natural sentences in ${languageName} about this verified daily spending allowance. Be calm and practical, never judgmental. Do not mention AI, models, prompts, budgets as a financial product, or how the text was generated. Do not change, repeat, or invent numbers; do not give investment or debt advice. Keep the wording compact and friendly. Verified values: ${JSON.stringify({
    currency: summary.currency,
    dailyAllowance: money(summary.dailyAllowance, summary.currency),
    todaySpent: money(summary.todaySpent, summary.currency),
    todayRemaining: money(summary.todayRemaining, summary.currency),
    cycleSpent: money(summary.cycleSpent, summary.currency),
    cycleRemaining: money(summary.cycleRemaining, summary.currency),
    cycleDays: summary.cycleDays,
  })}`;
}

export async function analyzeBudget({ expenses = [], fixedCapital, currency, timezone = 'Asia/Tokyo', now = new Date(), ledgerId, language = 'zh' } = {}, provider) {
  const config = validateFixedCapital(fixedCapital, currency || 'JPY');
  const summary = fixedCapitalSummary(expenses, config, { currency, timezone, now, ledgerId });
  if (!provider?.enabled) return { fixedCapital: config, summary, text: '', generated: false };
  try {
    const text = await provider.summarize({ prompt: budgetAnalysisPrompt(summary, resolveLanguage(language, 'zh')) });
    return { fixedCapital: config, summary, text: typeof text === 'string' ? text.trim().slice(0, 360) : '', generated: Boolean(typeof text === 'string' && text.trim()) };
  } catch {
    return { fixedCapital: config, summary, text: '', generated: false };
  }
}


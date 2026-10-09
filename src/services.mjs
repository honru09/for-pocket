import { CURRENCIES, CONSUMERS, COLORS, ICONS, initialSettings, validateSettings, validateExpense, dateKey } from '../public/shared.mjs';

export const PREVIEW_KEY = 'for-pocket.preview.v1';
export function localService(defaultLang = 'zh') {
  const load = () => {
    const raw = localStorage.getItem(PREVIEW_KEY);
    if (!raw) return { settings: initialSettings(defaultLang), expenses: [] };
    const profile = JSON.parse(raw);
    profile.settings = validateSettings(profile.settings);
    if (!profile.settings.languageManual && profile.settings.language !== defaultLang) {
      profile.settings.language = defaultLang;
      try { localStorage.setItem(PREVIEW_KEY, JSON.stringify(profile)); } catch {}
    }
    if (!Array.isArray(profile.expenses) || !profile.expenses.every(e => e && typeof e.id === 'string' && Number.isSafeInteger(e.amountMinor) && e.amountMinor > 0 && CURRENCIES[e.currency] && e.category && ICONS.includes(e.category.icon) && COLORS.includes(e.category.color) && typeof e.category.label === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.dayKey) && !Number.isNaN(Date.parse(e.createdAt)) && typeof e.note === 'string' && typeof e.timezone === 'string' && (e.consumer == null || Object.hasOwn(CONSUMERS, e.consumer)))) throw new Error('本机记录格式有误，请先备份浏览器数据。');
    return profile;
  };
  const visible = profile => ({ settings: profile.settings, expenses: profile.expenses.filter(e => !e.deletedAt) });
  const mutate = callback => {
    const profile = load();
    const result = callback(profile);
    try { localStorage.setItem(PREVIEW_KEY, JSON.stringify(profile)); }
    catch { throw new Error('本机空间不足或存储被禁用，这笔还没保存。'); }
    return result;
  };
  return {
    getProfile: async () => visible(load()),
    saveSettings: async settings => mutate(profile => { profile.settings = validateSettings(settings); return visible(profile); }),
    addExpense: async payload => mutate(profile => {
      const existing = profile.expenses.find(e => e.id === payload.id);
      if (existing) {
        if (existing.deletedAt) throw new Error('这笔记录已移除，请重新输入。');
        return existing;
      }
      const now = new Date();
      const entry = { ...validateExpense(payload, profile.settings), createdAt: now.toISOString(), dayKey: dateKey(now, payload.timezone) };
      profile.expenses.push(entry); return entry;
    }),
    deleteExpense: async id => mutate(profile => { const entry = profile.expenses.find(e => e.id === id); if (!entry) throw new Error('这笔记录已经不存在。'); entry.deletedAt = new Date().toISOString(); return entry; }),
    restoreExpense: async id => mutate(profile => { const entry = profile.expenses.find(e => e.id === id); if (!entry) throw new Error('无法恢复这笔记录。'); delete entry.deletedAt; return entry; }),
  };
}
export function remoteService(telegram) {
  async function request(route, method = 'GET', body) {
    let response;
    try { response = await fetch(`/api${route}`, { method, headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': telegram?.initData || '' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('连接没成功，这次操作还未确认。请再试一次。'); }
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 401 ? '请从 Telegram bot 重新打开，以验证身份。' : data.error || '暂时没有保存成功，请再试一次。');
    return data;
  }
  return {
    getProfile: () => request('/profile'),
    saveSettings: settings => request('/settings', 'PUT', settings),
    addExpense: payload => request('/expenses', 'POST', payload),
    deleteExpense: id => request(`/expenses/${encodeURIComponent(id)}`, 'DELETE'),
    restoreExpense: id => request(`/expenses/${encodeURIComponent(id)}/restore`, 'POST'),
  };
}

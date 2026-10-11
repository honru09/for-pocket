import { initialSettings, validateSettings, validateExpense, validateUserProfile, validateEntryTime, dateKey } from '../public/shared.mjs';
export const PREVIEW_KEY = 'for-pocket.preview.v1';
export const SESSION_KEY = 'for-pocket.session.v1';
const FILE_MIME_BY_EXTENSION = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf',
  csv: 'text/csv', txt: 'text/plain', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const IMPORT_MIME_TYPES = new Set(Object.values(FILE_MIME_BY_EXTENSION));
function fileMime(file) { const type = String(file?.type || '').toLowerCase(); if (IMPORT_MIME_TYPES.has(type)) return type; const ext = String(file?.name || '').split('.').pop()?.toLowerCase(); return FILE_MIME_BY_EXTENSION[ext] || type; }
export function localService(defaultLang = 'zh') {
  const load = () => {
    const saved = localStorage.getItem(PREVIEW_KEY);
    const p = saved ? JSON.parse(saved) : { settings: initialSettings(defaultLang), expenses: [] };
    p.settings = validateSettings(p.settings);
    if (!Array.isArray(p.expenses)) throw new Error('errorLocalData');
    if (!p.settings.languageManual) p.settings.language = defaultLang;
    p.expenses = p.expenses.map(e => ({ ...e, member: e.member || p.settings.consumers.find(m => m.id === e.consumer) || null }));
    p.user ||= { id: 'u_local', name: ({ zh: '我', en: 'Me', uk: 'Я' })[p.settings.language], color: 'yellow', avatar: 'cloud' };
    if (['我', 'Me', 'Я'].includes(p.user.name) && p.user.color === 'blue' && p.user.avatar === 'cat') p.user = { ...p.user, color: 'yellow', avatar: 'cloud' };
    p.settings.consumers = [{ id: p.user.id, name: p.user.name, color: p.user.color, avatar: p.user.avatar }];
    return p;
  };
  const visible = p => ({ ledgerId: 'local', settings: p.settings, expenses: p.expenses.filter(e => !e.deletedAt).map(e => ({ ...e, canDelete: true })), user: p.user, account: { hasGoogle: false, hasTelegram: false }, social: { circles: [], activeCircleId: null, activeCircle: null } });
  const mutate = callback => {
    const p = load(), result = callback(p);
    try { localStorage.setItem(PREVIEW_KEY, JSON.stringify(p)); } catch { throw new Error('errorLocalSpace'); }
    return result;
  };
  return {
    getProfile: async () => visible(load()),
    saveSettings: async settings => mutate(p => { p.settings = validateSettings({ ...settings, consumers: p.settings.consumers }); return visible(p); }),
    updateUserProfile: async value => mutate(p => { p.user = { ...p.user, ...validateUserProfile(value) }; p.settings.consumers = [p.user]; return visible(p); }),
    addExpense: async value => mutate(p => {
      const existing = p.expenses.find(e => e.id === value.id);
      if (existing) { if (existing.deletedAt) throw new Error('errorDeleted'); return existing; }
      const valid = validateExpense(value, p.settings);
      const occurredAt = valid.occurredAt || new Date().toISOString();
      const entry = { ...valid, occurredAt, ledgerId: 'local', createdAt: new Date().toISOString(), dayKey: dateKey(new Date(occurredAt), valid.timezone), member: structuredClone(p.user), canDelete: true };
      p.expenses.push(entry); return entry;
    }),
    updateEntryTime: async (id, value) => mutate(p => { const e = p.expenses.find(e => e.id === id && !e.deletedAt); if (!e) throw new Error('errorMissing'); Object.assign(e, validateEntryTime(value.occurredAt, value.timezone), { updatedAt: new Date().toISOString() }); return e; }),
    deleteExpense: async id => mutate(p => { const e = p.expenses.find(e => e.id === id); if (!e) throw new Error('errorMissing'); e.deletedAt = new Date().toISOString(); return e; }),
    restoreExpense: async id => mutate(p => { const e = p.expenses.find(e => e.id === id); if (!e) throw new Error('errorMissing'); delete e.deletedAt; return e; }),
    aiParseExpense: async () => { throw new Error('errorAiNeedLogin'); },
    aiSummary: async () => { throw new Error('errorAiNeedLogin'); },
  };
}
export function remoteService(telegram) {
  let currentToken = localStorage.getItem(SESSION_KEY), ledgerId;
  let lastInitData = null, telegramDisabled = false;
  let profileRequestSequence = 0;
  // A delayed settings/profile response must not restore a ledger that a
  // newer circle or account action already replaced.
  const track = (p, sequence) => { if (sequence === profileRequestSequence && p?.ledgerId) ledgerId = p.ledgerId; return p; };
  const remember = p => {
    if (p?.sessionToken) {
      currentToken = p.sessionToken;
      try { localStorage.setItem(SESSION_KEY, currentToken); } catch {}
    }
    return p;
  };
  async function request(route, method = 'GET', body, { includeInitData = false, timeout = 15000 } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (!telegramDisabled && telegram?.initData && (includeInitData || !currentToken)) headers['X-Telegram-Init-Data'] = telegram.initData;
    if (currentToken) headers.Authorization = `Bearer ${currentToken}`;
    let response;
    try { response = await fetch(`/api${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) }); }
    catch { throw new Error('errorNetwork'); }
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error || 'errorSave'); error.status = response.status; throw error; }
    return remember(data);
  }
  async function exchangeTelegram() {
    if (telegramDisabled || !telegram?.initData || telegram.initData === lastInitData) return;
    const raw = telegram.initData;
    await request('/auth/telegram', 'POST', {}, { includeInitData: true });
    lastInitData = raw;
  }
  async function aiParseExpense({ text = '', file = null, files = [], enhanced = false, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone, ledgerId: requestedLedgerId } = {}) {
    await exchangeTelegram();
    const ledger = requestedLedgerId || ledgerId;
    const baseHeaders = {};
    if (!telegramDisabled && telegram?.initData && !currentToken) baseHeaders['X-Telegram-Init-Data'] = telegram.initData;
    if (currentToken) baseHeaders.Authorization = `Bearer ${currentToken}`;
    const selectedFiles = Array.isArray(files) ? files.filter(Boolean) : [];
    if (!selectedFiles.length && file) selectedFiles.push(file);
    const language = document.documentElement.lang || 'zh-CN';
    const parseOne = async (selectedFile, includeText = '') => {
      let response;
      try {
        let attachment;
        if (selectedFile) {
          const bytes = new Uint8Array(await selectedFile.arrayBuffer());
          const chunks = [];
          for (let offset = 0; offset < bytes.length; offset += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length))));
          attachment = { data: btoa(chunks.join('')), mimeType: fileMime(selectedFile), name: selectedFile.name || '' };
        }
        response = await fetch('/api/ai/parse-expense', {
          method: 'POST',
          headers: { ...baseHeaders, 'Content-Type': 'application/json', 'X-AI-Language': language },
          body: JSON.stringify({ text: String(includeText).slice(0, 12000), ...(attachment ? { file: attachment } : {}), enhanced: enhanced === true, timezone, language, ledgerId: ledger }),
          signal: AbortSignal.timeout(60000),
        });
      } catch (error) {
        if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw new Error('errorNetwork');
        throw new Error('errorNetwork');
      }
      let data = {};
      try { data = await response.json(); } catch { throw new Error('errorAiUnavailable'); }
      if (!response.ok) { const error = new Error(data.error || 'errorAiUnavailable'); error.status = response.status; throw error; }
      return data;
    };
    const textTruncated = String(text).length > 12000;
    if (!selectedFiles.length) {
      const result = remember(await parseOne(null, text));
      return textTruncated ? { ...result, warnings: [...(result?.warnings || []), 'errorTextTooLong'] } : result;
    }
    const results = [], warnings = textTruncated ? [{ code: 'errorTextTooLong', name: '' }] : [];
    for (let index = 0; index < selectedFiles.length; index += 1) {
      try {
        const result = remember(await parseOne(selectedFiles[index], index === 0 ? text : ''));
        const items = Array.isArray(result?.items) ? result.items : Array.isArray(result) ? result : [];
        results.push(...items.map(item => ({ ...item, sourceName: selectedFiles[index].name })));
        if (!items.length) warnings.push({ code: 'aiImportNoResult', name: selectedFiles[index].name });
        if (Array.isArray(result?.warnings)) warnings.push(...result.warnings.map(code => ({ code, name: selectedFiles[index].name })));
      } catch (error) {
        if (error.status === 401 || error?.message === 'errorLedgerChanged') throw error;
        warnings.push({ code: error?.message || 'errorAiUnavailable', name: selectedFiles[index].name });
      }
    }
    return { items: results, warnings };
  }
  const profileAction = async (route, body, method = 'POST') => {
    const sequence = ++profileRequestSequence;
    return track(await request(route, method, body), sequence);
  };
  return {
    getProfile: async () => { const sequence = ++profileRequestSequence; await exchangeTelegram(); return track(await request('/profile'), sequence); },
    saveSettings: ({ consumers, ...settings }, scope = ledgerId) => profileAction('/settings', { ...settings, ledgerId: scope }, 'PUT'),
    updateUserProfile: p => profileAction('/user-profile', p, 'PUT'),
    addExpense: payload => request('/expenses', 'POST', { ledgerId, ...payload }),
    importExpenses: async entries => {
      const scope = entries[0]?.ledgerId || ledgerId, saved = [];
      for (let offset = 0; offset < entries.length; offset += 50) {
        try { const result = await request('/expenses/import', 'POST', { ledgerId: scope, entries: entries.slice(offset, offset + 50) }); saved.push(...(result.entries || [])); }
        catch (error) { if (!saved.length) throw error; return { entries: saved, warnings: [error.message || 'errorSave'], partial: true }; }
      }
      return { entries: saved };
    },
    updateEntryTime: (id, value, scope = ledgerId) => request(`/expenses/${encodeURIComponent(id)}`, 'PUT', { ...value, ledgerId: scope }),
    deleteExpense: (id, scope = ledgerId) => request(`/expenses/${encodeURIComponent(id)}?ledgerId=${encodeURIComponent(scope)}`, 'DELETE'),
    restoreExpense: (id, scope = ledgerId) => request(`/expenses/${encodeURIComponent(id)}/restore`, 'POST', { ledgerId: scope }),
    aiParseExpense,
    aiSummary: async input => { await exchangeTelegram(); return request('/ai/summary', 'POST', { ledgerId, ...input }, { timeout: 60000 }); },
    loginWithGoogle: async (credential, link = false, language) => {
      const sequence = ++profileRequestSequence;
      const res = await request('/auth/google', 'POST', { credential, link, language });
      if (res.sessionToken) { currentToken = res.sessionToken; localStorage.setItem(SESSION_KEY, currentToken); }
      if (res.profile) track(res.profile, sequence);
      return res;
    },
    logout: async () => { ++profileRequestSequence; await request('/auth/logout', 'POST', {}); currentToken = null; ledgerId = undefined; telegramDisabled = true; localStorage.removeItem(SESSION_KEY); },
    getLinkCode: () => request('/auth/link-code', 'POST', {}),
    previewLink: code => request('/auth/link-preview', 'POST', { code }),
    verifyLink: async payload => { const sequence = ++profileRequestSequence; return track((await request('/auth/link-verify', 'POST', { ...payload, confirm: true })).profile, sequence); },
    createCircle: name => profileAction('/circles/create', { name }),
    switchCircle: circleId => profileAction('/circles/switch', { circleId }),
    getInvite: (circleId, renew = false) => request('/circles/invite', 'POST', { circleId, renew }),
    previewCircle: code => request('/circles/preview', 'POST', { code }),
    joinCircle: code => profileAction('/circles/join', { code, confirm: true }),
    renameCircle: (circleId, name) => profileAction('/circles/rename', { circleId, name }),
    setAdmin: (circleId, memberId, isAdmin) => profileAction('/circles/admin', { circleId, memberId, isAdmin }),
    removeMember: (circleId, memberId) => profileAction('/circles/remove', { circleId, memberId, confirm: true }),
    leaveCircle: circleId => profileAction('/circles/leave', { circleId, confirm: true }),
  };
}

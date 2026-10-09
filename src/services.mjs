import { CURRENCIES, CONSUMERS, COLORS, ICONS, initialSettings, validateSettings, validateExpense, dateKey } from '../public/shared.mjs';

export const PREVIEW_KEY = 'for-pocket.preview.v1';
export const SESSION_KEY = 'for-pocket.session.v1';

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
    if (!profile.share) profile.share = { code: 'P8M2K9', isPaired: false, partner: null };
    if (!profile.user) profile.user = { id: 'u_me', name: profile.settings.consumers?.[0]?.name || '我', color: profile.settings.consumers?.[0]?.color || 'blue', avatar: profile.settings.consumers?.[0]?.avatar || 'cat', friendCode: 'P8M2K9' };
    if (!profile.social) profile.social = { friendCode: 'P8M2K9', friends: [], circles: [], activeCircleId: null, activeCircle: null };
    return profile;
  };
  const visible = profile => ({
    settings: profile.settings,
    expenses: profile.expenses.filter(e => !e.deletedAt),
    share: profile.share || { code: 'P8M2K9', isPaired: false, partner: null },
    user: profile.user || { id: 'u_me', name: profile.settings.consumers?.[0]?.name || '我', color: profile.settings.consumers?.[0]?.color || 'blue', avatar: profile.settings.consumers?.[0]?.avatar || 'cat', friendCode: 'P8M2K9' },
    social: profile.social || { friendCode: 'P8M2K9', friends: [], circles: [], activeCircleId: null, activeCircle: null },
  });
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
    pairLedger: async code => mutate(profile => {
      if (String(code).trim().toUpperCase() === profile.share.code) throw new Error('不能连接自己的共享码。');
      profile.share.isPaired = true;
      profile.share.partner = { id: 'u_partner', name: 'Liia', color: 'milk', avatar: 'bunny' };
      const partnerMember = profile.settings.consumers.find(c => c.id === 'liia' || c.id === 'u_partner');
      if (!partnerMember) profile.settings.consumers.push({ id: 'u_partner', name: 'Liia', color: 'milk', avatar: 'bunny' });
      return visible(profile);
    }),
    unpairLedger: async () => mutate(profile => {
      profile.share.isPaired = false;
      profile.share.partner = null;
      return visible(profile);
    }),
    updateUserProfile: async user => mutate(profile => {
      profile.user = { ...profile.user, ...user };
      const myMember = profile.settings.consumers?.[0];
      if (myMember) {
        myMember.name = user.name || myMember.name;
        myMember.color = user.color || myMember.color;
        myMember.avatar = user.avatar || myMember.avatar;
      }
      return visible(profile);
    }),
    loginWithGoogle: async credential => mutate(profile => {
      profile.user.googleEmail = 'user@gmail.com';
      return visible(profile);
    }),
    getLinkCode: async () => ({ code: 'SYNC88' }),
    verifyLinkCode: async code => mutate(profile => {
      profile.user.googleEmail = profile.user.googleEmail || 'linked@gmail.com';
      return visible(profile);
    }),
    addFriend: async friendCode => mutate(profile => {
      const code = String(friendCode).trim().toUpperCase();
      if (!profile.social.friends.some(f => f.friendCode === code)) {
        profile.social.friends.push({ id: `u_${code}`, name: `好友 ${code}`, avatar: 'chick', color: 'mint', friendCode: code });
      }
      return visible(profile);
    }),
    createCircle: async (name, friendIds) => mutate(profile => {
      const circleId = `cir_${Date.now()}`;
      const friends = profile.social.friends.filter(f => friendIds.includes(f.id));
      const members = [{ id: profile.user.id, name: profile.user.name, avatar: profile.user.avatar, color: profile.user.color }, ...friends];
      const newCircle = { id: circleId, name, ownerId: profile.user.id, isOwner: true, memberCount: members.length, members };
      profile.social.circles.push(newCircle);
      profile.social.activeCircleId = circleId;
      profile.social.activeCircle = newCircle;
      profile.settings.consumers = members;
      return visible(profile);
    }),
    switchCircle: async circleId => mutate(profile => {
      if (!circleId) {
        profile.social.activeCircleId = null;
        profile.social.activeCircle = null;
      } else {
        const c = profile.social.circles.find(x => x.id === circleId);
        if (c) {
          profile.social.activeCircleId = c.id;
          profile.social.activeCircle = c;
          profile.settings.consumers = c.members;
        }
      }
      return visible(profile);
    }),
    leaveCircle: async circleId => mutate(profile => {
      profile.social.circles = profile.social.circles.filter(c => c.id !== circleId);
      if (profile.social.activeCircleId === circleId) {
        profile.social.activeCircleId = null;
        profile.social.activeCircle = null;
      }
      return visible(profile);
    }),
  };
}

export function remoteService(telegram, sessionToken = null) {
  let currentToken = sessionToken || (typeof localStorage !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null);
  async function request(route, method = 'GET', body) {
    let response;
    const headers = { 'Content-Type': 'application/json' };
    if (telegram?.initData) headers['X-Telegram-Init-Data'] = telegram.initData;
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

    try { response = await fetch(`/api${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('连接没成功，这次操作还未确认。请再试一次。'); }
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 401 ? '请先登录以验证身份。' : data.error || '暂时没有保存成功，请再试一次。');
    return data;
  }
  return {
    getProfile: () => request('/profile'),
    saveSettings: settings => request('/settings', 'PUT', settings),
    addExpense: payload => request('/expenses', 'POST', payload),
    deleteExpense: id => request(`/expenses/${encodeURIComponent(id)}`, 'DELETE'),
    restoreExpense: id => request(`/expenses/${encodeURIComponent(id)}/restore`, 'POST'),
    pairLedger: code => request('/pair', 'POST', { code }),
    unpairLedger: () => request('/unpair', 'POST'),
    updateUserProfile: profile => request('/user-profile', 'PUT', profile),
    loginWithGoogle: async credential => {
      const res = await request('/auth/google', 'POST', typeof credential === 'string' ? { credential } : credential);
      if (res?.sessionToken) {
        currentToken = res.sessionToken;
        try { localStorage.setItem(SESSION_KEY, res.sessionToken); } catch {}
      }
      return res.profile;
    },
    getLinkCode: () => request('/auth/link-code', 'POST'),
    verifyLinkCode: async code => {
      const res = await request('/auth/link-verify', 'POST', { code });
      return res.profile;
    },
    addFriend: friendCode => request('/friends/add', 'POST', { friendCode }),
    createCircle: (name, friendIds) => request('/circles/create', 'POST', { name, friendIds }),
    switchCircle: circleId => request('/circles/switch', 'POST', { circleId }),
    leaveCircle: circleId => request('/circles/leave', 'POST', { circleId }),
  };
}

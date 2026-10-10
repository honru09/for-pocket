import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Select } from '@telegram-apps/telegram-ui';
import { AVATARS, CONSUMER_COLORS } from '../public/shared.mjs';
import { Icon, CloudAvatar } from './icons.jsx';

export function Avatar({ person, className = '' }) {
  const cloud = !person?.avatar || person.avatar === 'cloud';
  return <span className={`person-avatar consumer-color-${person?.color || 'yellow'} ${cloud ? 'is-cloud' : ''} ${className}`} aria-hidden="true">{person?.avatar?.startsWith('https://') ? <img src={person.avatar} alt="" referrerPolicy="no-referrer"/> : cloud ? <CloudAvatar/> : <Icon name={person.avatar}/>}</span>;
}
export function Sheet({ title, onClose, children }) {
  const ref = useRef(null), id = React.useId();
  useEffect(() => {
    const focus = document.activeElement, d = ref.current;
    d.showModal(); const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { d.close(); document.body.style.overflow = previous; focus?.focus?.({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className="pocket-sheet" aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === ref.current) { const r = ref.current.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}><header><h2 id={id}>{title}</h2><Button mode="plain" size="s" aria-label={title + ' ×'} onClick={onClose}>×</Button></header>{children}</dialog>;
}
export function CirclePicker({ profile, t, busy, onSwitch, onManage, onClose }) {
  return <Sheet title={t('circlesTitle')} onClose={onClose}><div className="circle-picker-list"><Button mode="plain" className="picker-row" disabled={busy} onClick={() => onSwitch(null)}><Icon name="wallet"/><span>{t('personal')}</span>{!profile.social.activeCircleId && <span>✓</span>}</Button>{profile.social.circles.map(c => <Button key={c.id} className="picker-row" mode="plain" disabled={busy} onClick={() => onSwitch(c.id)}><span className="circle-stack">{c.members.slice(0, 3).map(p => <Avatar key={p.id} person={p}/>)}</span><span>{c.name}</span>{profile.social.activeCircleId === c.id && <span>✓</span>}</Button>)}</div><Button stretched mode="filled" onClick={onManage}>{t('manageCircle')}</Button></Sheet>;
}
function GoogleButton({ clientId, language, onCredential, t }) {
  const ref = useRef(null), callback = useRef(onCredential), [loaded, setLoaded] = useState(false);
  callback.current = onCredential;
  useEffect(() => {
    let cancelled = false;
    function render() {
      if (cancelled || !window.google?.accounts?.id || !ref.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, auto_select: false, callback: response => callback.current(response.credential) });
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', shape: 'pill', width: 240, locale: language });
      setLoaded(true);
    }
    const script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    script?.addEventListener('load', render); render();
    return () => { cancelled = true; script?.removeEventListener('load', render); };
  }, [clientId, language]);
  return <div className="google-login">{!loaded && <p>{t('googleLoading')}</p>}<div ref={ref}/></div>;
}
export function ProfileEditor({ user, t, busy, run, service }) {
  const [draft, setDraft] = useState({ name: user.name, color: user.color, avatar: user.avatar });
  return <form className="settings-form" onSubmit={e => { e.preventDefault(); run(() => service.updateUserProfile(draft), 'profileSaved'); }}><div className="profile-preview"><Avatar person={draft}/><strong>{draft.name}</strong></div><Input className="settings-input" id="profile-name" header={t('profileName')} aria-label={t('profileName')} maxLength={24} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} required disabled={busy}/><fieldset className="avatar-picker"><legend>{t('profileAvatar')}</legend>{AVATARS.map(avatar => <Button type="button" mode="plain" key={avatar} aria-label={t(avatar)} aria-pressed={draft.avatar === avatar} onClick={() => setDraft({ ...draft, avatar })}><Avatar person={{ ...draft, avatar }}/></Button>)}</fieldset><fieldset className="color-picker"><legend>{t('profileColor')}</legend>{CONSUMER_COLORS.map(color => <button type="button" key={color} className={`color-swatch consumer-color-${color}`} aria-label={t(color)} aria-pressed={draft.color === color} onClick={() => setDraft({ ...draft, color })}><span/></button>)}</fieldset><Button type="submit" className="panel-primary" stretched disabled={busy || !draft.name.trim()}>{t('saveCategories')}</Button></form>;
}
export function AccountPage({ t, profile, isRemote, config, language, busy, run, service, onGoogle, onLogout, copy }) {
  const [linkCode, setLinkCode] = useState(null), [input, setInput] = useState(''), [preview, setPreview] = useState(null);
  const viewLink = async e => { e.preventDefault(); const p = await run(() => service.previewLink(input)); if (p) setPreview({ ...p, code: input }); };
  const googleResponse = async credential => { const res = await onGoogle(credential); if (res?.linkTicket) setPreview({ ...res, ticket: res.linkTicket }); };
  return <div className="settings-form"><p className="quiet-copy">{t(isRemote ? 'linkHint' : 'signInHint')}</p>{isRemote && <div className="connected-accounts"><span>{t(profile.account.hasTelegram ? 'tgLinked' : 'tgNotLinked')}</span><span>{t(profile.account.hasGoogle ? 'googleLinked' : 'googleNotLinked')}</span>{profile.account.googleEmail && <small>{profile.account.googleEmail}</small>}</div>}
    {config.googleClientId ? <GoogleButton clientId={config.googleClientId} language={language} t={t} onCredential={googleResponse}/> : <p className="quiet-copy">{t('googleSetup')}</p>}
    {!isRemote && <><p className="quiet-copy">{t(config.telegramEnabled ? 'openTelegram' : 'localHint')}</p><p className="quiet-copy">{t('localImportHint')}</p></>}
    {isRemote && <><details className="settings-detail"><summary>{t('linkAccounts')}</summary><p className="quiet-copy">{t('linkHint')}</p><Button mode="outline" disabled={busy} onClick={async () => { const c = await run(() => service.getLinkCode()); if (c) setLinkCode(c); }}>{t('generateLinkCode')}</Button>{linkCode && <div className="code-card"><code>{linkCode.code}</code><Button mode="plain" onClick={() => copy(linkCode.code)}>{t('copyCode')}</Button><small>{t('expiresAt', { date: new Date(linkCode.expiresAt).toLocaleTimeString() })}</small></div>}<form className="inline-form" onSubmit={viewLink}><Input className="settings-input" aria-label={t('linkCodeLabel')} placeholder={t('linkCodePlaceholder')} maxLength={6} value={input} onChange={e => setInput(e.target.value.toUpperCase())}/><Button type="submit" disabled={busy || input.length !== 6}>{t('previewLink')}</Button></form></details>{!config.inTelegram && <Button mode="plain" className="danger-text" disabled={busy} onClick={onLogout}>{t('logout')}</Button>}</>}
    {preview && <Sheet title={t('linkAccounts')} onClose={() => setPreview(null)}><p className="quiet-copy">{t('linkPreview', { name: preview.target.name, n: preview.entries })}</p><p className="quiet-copy">{t('linkHint')}</p><div className="sheet-actions"><Button mode="plain" disabled={busy} onClick={() => setPreview(null)}>{t('decline')}</Button><Button disabled={busy} onClick={async () => { const p = await run(() => service.verifyLink({ code: preview.code, ticket: preview.ticket }), 'linkSuccess'); if (p) { setPreview(null); setLinkCode(null); setInput(''); } }}>{t('confirmLink')}</Button></div></Sheet>}
  </div>;
}
export function CirclesPage({ t, profile, busy, isRemote, run, service, onAccount, onSwitch, copy }) {
  const [name, setName] = useState(''), [code, setCode] = useState(''), [invite, setInvite] = useState(null), [preview, setPreview] = useState(null), [confirm, setConfirm] = useState(null), [selectedId, setSelectedId] = useState(profile.social.activeCircleId);
  const circle = profile.social.circles.find(c => c.id === selectedId);
  const [rename, setRename] = useState(circle?.name || '');
  const select = c => { setSelectedId(c.id); setRename(c.name); setInvite(null); };
  const create = async e => { e.preventDefault(); const p = await run(() => service.createCircle(name), 'circleCreated'); if (p) { setName(''); select(p.social.activeCircle); } };
  const previewCode = async e => { e.preventDefault(); const p = await run(() => service.previewCircle(code)); if (p) setPreview({ ...p, code }); };
  if (!isRemote) return <div className="settings-form"><p className="quiet-copy">{t('accountRequired')}</p><Button className="panel-primary" onClick={onAccount}>{t('signIn')}</Button></div>;
  return <div className="settings-form"><div className="circle-list">{profile.social.circles.map(c => <Button className="picker-row" mode="plain" key={c.id} onClick={() => select(c)} aria-pressed={selectedId === c.id}><span className="circle-stack">{c.members.slice(0, 3).map(p => <Avatar key={p.id} person={p}/>)}</span><span>{c.name}</span><small>{c.memberCount}</small></Button>)}</div>
    {!profile.social.circles.length && <p className="quiet-copy">{t('noCircles')}</p>}
    {circle && <section className="circle-detail"><div className="section-heading"><h2>{circle.name}</h2>{profile.social.activeCircleId !== circle.id && <Button size="s" mode="plain" onClick={() => onSwitch(circle.id)}>{t('switchCircle')}</Button>}</div><div className="member-list">{circle.members.map(p => <div className="member-row" key={p.id}><Avatar person={p}/><span><strong>{p.name}</strong>{p.isAdmin && <small>{t('admin')}</small>}</span>{circle.isAdmin && <Select className="member-menu" aria-label={`${t('manageMembers')} ${p.name}`} value="" disabled={busy} onChange={e => { const action = e.target.value; if (action === 'remove') setConfirm({ member: p }); else if (action === 'admin') run(() => service.setAdmin(circle.id, p.id, !p.isAdmin), 'circleUpdated'); }}><option value="">···</option><option value="admin">{t(p.isAdmin ? 'removeAdmin' : 'makeAdmin')}</option>{p.id !== profile.user.id && <option value="remove">{t('removeMember')}</option>}</Select>}</div>)}</div>
      <Button mode="outline" disabled={busy} onClick={async () => { const c = await run(() => service.getInvite(circle.id)); if (c) setInvite(c); }}>{t('inviteMembers')}</Button>
      {invite?.circleId === circle.id && <div className="code-card"><code>{invite.code}</code><Button mode="plain" onClick={() => copy(invite.code)}>{t('copyCode')}</Button><small>{t('expiresAt', { date: new Date(invite.expiresAt).toLocaleString() })}</small>{circle.isAdmin && <Button size="s" mode="plain" disabled={busy} onClick={async () => { const c = await run(() => service.getInvite(circle.id, true)); if (c) setInvite(c); }}>{t('renewInvite')}</Button>}</div>}
      {circle.isAdmin && <details className="settings-detail"><summary>{t('circleName')}</summary><form className="inline-form" onSubmit={e => { e.preventDefault(); run(() => service.renameCircle(circle.id, rename), 'circleUpdated'); }}><Input className="settings-input" aria-label={t('circleName')} value={rename} maxLength={24} onChange={e => setRename(e.target.value)}/><Button type="submit" disabled={busy || !rename.trim()}>{t('renameCircle')}</Button></form></details>}
      <Button className="danger-text" mode="plain" disabled={busy} onClick={() => setConfirm({ leave: true })}>{t('leaveCircle')}</Button>
    </section>}
    <details className="settings-detail" open={!profile.social.circles.length}><summary>{t('createCircle')}</summary><form className="inline-form" onSubmit={create}><Input className="settings-input" aria-label={t('circleName')} placeholder={t('circleNamePlaceholder')} value={name} maxLength={24} onChange={e => setName(e.target.value)} required/><Button type="submit" disabled={busy || !name.trim()}>{t('createCircle')}</Button></form></details>
    <details className="settings-detail" open={!profile.social.circles.length}><summary>{t('joinCircle')}</summary><form className="inline-form" onSubmit={previewCode}><Input className="settings-input" id="circle-invite-input" aria-label={t('inviteCode')} placeholder={t('inviteCode')} value={code} maxLength={6} onChange={e => setCode(e.target.value.toUpperCase())}/><Button type="submit" disabled={busy || code.length !== 6}>{t('previewInvite')}</Button></form></details>
    {preview && <Sheet title={t('invitedTo', { name: preview.circle.name })} onClose={() => setPreview(null)}><div className="invite-members">{preview.circle.members.map(p => <div key={p.id}><Avatar person={p}/><span>{p.name}</span></div>)}</div><p className="quiet-copy">{t('sharedHint')}</p><div className="sheet-actions"><Button mode="plain" onClick={() => setPreview(null)} disabled={busy}>{t('decline')}</Button><Button disabled={busy} onClick={async () => { const p = await run(() => service.joinCircle(preview.code), 'circleJoined'); if (p) { setPreview(null); setCode(''); select(p.social.activeCircle); } }}>{t('acceptInvite')}</Button></div></Sheet>}
    {confirm && circle && <Sheet title={t(confirm.leave ? 'leaveCircle' : 'removeMember')} onClose={() => setConfirm(null)}><p className="quiet-copy">{t(confirm.leave ? 'confirmLeave' : 'confirmRemove', { name: confirm.member?.name })}</p><div className="sheet-actions"><Button mode="plain" disabled={busy} onClick={() => setConfirm(null)}>{t('decline')}</Button><Button disabled={busy} onClick={async () => { const p = await run(() => confirm.leave ? service.leaveCircle(circle.id) : service.removeMember(circle.id, confirm.member.id), 'circleUpdated'); if (p) { setConfirm(null); setInvite(null); } }}>{t('confirm')}</Button></div></Sheet>}
  </div>;
}

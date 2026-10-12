import React, { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@telegram-apps/telegram-ui';
import { AVATARS, CONSUMER_COLORS } from '../public/shared.mjs';
import { Icon, CloudAvatar } from './icons.jsx';
import { imageFileToAvatarDataUrl, isAvatarImageType } from './avatar-image.mjs';

export function Avatar({ person, className = '' }) {
  const cloud = !person?.avatar || person.avatar === 'cloud';
  const image = typeof person?.avatar === 'string' && (/^https:\/\//.test(person.avatar) || /^data:image\//i.test(person.avatar));
  return <span className={`person-avatar consumer-color-${person?.color || 'yellow'} ${cloud ? 'is-cloud' : ''} ${className}`} aria-hidden="true">{image ? <img src={person.avatar} alt="" referrerPolicy="no-referrer"/> : cloud ? <CloudAvatar/> : <Icon name={person.avatar}/>}</span>;
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
  return <Sheet title={t('circlesTitle')} onClose={onClose}><div className="circle-picker-list"><Button mode="plain" className="picker-row" disabled={busy} onClick={() => onSwitch(null)}><span className="picker-content"><Icon name="wallet"/><span className="picker-name">{t('personal')}</span>{!profile.social.activeCircleId && <Icon name="check"/>}</span></Button>{profile.social.circles.map(c => <Button key={c.id} className="picker-row" mode="plain" disabled={busy} onClick={() => onSwitch(c.id)}><span className="picker-content"><span className="circle-stack">{c.members.slice(0, 3).map(p => <Avatar key={p.id} person={p}/>)}</span><span className="picker-name">{c.name}</span>{profile.social.activeCircleId === c.id && <Icon name="check"/>}</span></Button>)}</div><Button className="picker-row" mode="plain" onClick={onManage}><span className="picker-content"><Icon name="users"/><span className="picker-name">{t('manageCircle')}</span><span aria-hidden="true">›</span></span></Button></Sheet>;
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
  const [draft, setDraft] = useState({ name: user.name, color: user.color, avatar: user.avatar }), [avatarError, setAvatarError] = useState(''), [avatarBusy, setAvatarBusy] = useState(false);
  const avatarOperation = useRef(0);
  useEffect(() => () => { avatarOperation.current++; }, []);
  const chooseFile = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!isAvatarImageType(file.type) || file.size > 12 * 1024 * 1024) { setAvatarError(t('avatarUploadError')); return; }
    const operation = ++avatarOperation.current;
    setAvatarBusy(true);
    setAvatarError('');
    try {
      const value = await imageFileToAvatarDataUrl(file);
      if (operation !== avatarOperation.current) return;
      setDraft(current => ({ ...current, avatar: value }));
    } catch {
      if (operation === avatarOperation.current) setAvatarError(t('avatarUploadError'));
    } finally {
      if (operation === avatarOperation.current) setAvatarBusy(false);
    }
  };
  return <form className="settings-form" onSubmit={e => { e.preventDefault(); if (!avatarBusy) run(() => service.updateUserProfile(draft), 'profileSaved'); }}><div className="profile-preview"><Avatar person={draft}/><strong>{draft.name}</strong></div><label className="pocket-field profile-name-field" htmlFor="profile-name"><span>{t('profileName')}</span><input id="profile-name" name="nickname" autoComplete="nickname" maxLength={24} value={draft.name} onChange={e => setDraft(current => ({ ...current, name:e.target.value }))} required disabled={busy || avatarBusy}/></label><fieldset className="avatar-picker"><legend>{t('profileAvatar')}</legend>{AVATARS.map(avatar => <Button type="button" mode="plain" key={avatar} aria-label={t(avatar)} aria-pressed={draft.avatar === avatar} onClick={() => { avatarOperation.current++; setAvatarBusy(false); setDraft(current => ({ ...current, avatar })); }} disabled={busy}><Avatar person={{ ...draft, avatar }}/></Button>)}<label className={`avatar-upload ${avatarBusy ? 'is-processing' : ''}`}><input id="profile-avatar-upload" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={chooseFile} disabled={busy || avatarBusy}/><span aria-hidden="true">＋</span><small>{t('avatarUpload')}</small></label></fieldset>{avatarError && <p className="field-error">{avatarError}</p>}<fieldset className="color-picker"><legend>{t('profileColor')}</legend>{CONSUMER_COLORS.map(color => <button type="button" key={color} className={`color-swatch consumer-color-${color}`} aria-label={t(color)} aria-pressed={draft.color === color} onClick={() => setDraft(current => ({ ...current, color }))}><span/></button>)}</fieldset><Button type="submit" className="panel-primary compact-save" disabled={busy || avatarBusy || !draft.name.trim()}>{t('saveCategories')}</Button></form>;
}
export function AccountPage({ t, profile, isRemote, config, language, busy, run, service, onGoogle, onLogout, copy }) {
  const [linkCode, setLinkCode] = useState(null), [input, setInput] = useState(''), [preview, setPreview] = useState(null);
  const viewLink = async e => { e.preventDefault(); const p = await run(() => service.previewLink(input)); if (p) setPreview({ ...p, code: input }); };
  const googleResponse = async credential => { const res = await onGoogle(credential); if (res?.linkTicket) setPreview({ ...res, ticket: res.linkTicket }); };
  return <div className="settings-form account-view"><p className="quiet-copy">{t(isRemote ? 'linkHint' : 'signInHint')}</p>{isRemote && <div className="connected-accounts"><span>{t(profile.account.hasTelegram ? 'tgLinked' : 'tgNotLinked')}</span><span>{t(profile.account.hasGoogle ? 'googleLinked' : 'googleNotLinked')}</span>{profile.account.googleEmail && <small>{profile.account.googleEmail}</small>}</div>}
    {config.googleClientId ? <GoogleButton clientId={config.googleClientId} language={language} t={t} onCredential={googleResponse}/> : <p className="quiet-copy">{t('googleSetup')}</p>}
    {!isRemote && <><p className="quiet-copy">{t(config.telegramEnabled ? 'openTelegram' : 'localHint')}</p><p className="quiet-copy">{t('localImportHint')}</p></>}
    {isRemote && <><details className="settings-detail"><summary>{t('linkAccounts')}</summary><p className="quiet-copy">{t('linkHint')}</p><Button mode="outline" disabled={busy} onClick={async () => { const c = await run(() => service.getLinkCode()); if (c) setLinkCode(c); }}>{t('generateLinkCode')}</Button>{linkCode && <div className="code-card"><code>{linkCode.code}</code><Button mode="plain" onClick={() => copy(linkCode.code)}>{t('copyCode')}</Button><small>{t('expiresAt', { date: new Date(linkCode.expiresAt).toLocaleTimeString() })}</small></div>}<form className="inline-form" onSubmit={viewLink}><Input className="settings-input" aria-label={t('linkCodeLabel')} placeholder={t('linkCodePlaceholder')} maxLength={6} value={input} onChange={e => setInput(e.target.value.toUpperCase())}/><Button type="submit" disabled={busy || input.length !== 6}>{t('previewLink')}</Button></form></details>{!config.inTelegram && <Button mode="plain" className="danger-text" disabled={busy} onClick={onLogout}>{t('logout')}</Button>}</>}
    {preview && <Sheet title={t('linkAccounts')} onClose={() => setPreview(null)}><p className="quiet-copy">{t('linkPreview', { name: preview.target.name, n: preview.entries })}</p><p className="quiet-copy">{t('linkHint')}</p><div className="sheet-actions"><Button mode="plain" disabled={busy} onClick={() => setPreview(null)}>{t('decline')}</Button><Button disabled={busy} onClick={async () => { const p = await run(() => service.verifyLink({ code: preview.code, ticket: preview.ticket }), 'linkSuccess'); if (p) { setPreview(null); setLinkCode(null); setInput(''); } }}>{t('confirmLink')}</Button></div></Sheet>}
  </div>;
}
export function CirclesPage({ t, profile, busy, isRemote, run, service, onAccount, onSwitch, copy }) {
  const [name, setName] = useState(''), [code, setCode] = useState(''), [invite, setInvite] = useState(null), [preview, setPreview] = useState(null), [confirm, setConfirm] = useState(null), [selectedId, setSelectedId] = useState(profile.social.activeCircleId);
  const circle = profile.social.circles.find(c => c.id === selectedId);
  const [rename, setRename] = useState(circle?.name || ''), [renaming, setRenaming] = useState(false), [memberAction, setMemberAction] = useState(null);
  const renamePending = useRef(false), renameCancelled = useRef(false);
  const select = c => { setSelectedId(c.id); setRename(c.name); setRenaming(false); setInvite(null); setMemberAction(null); };
  const saveName = async () => {
    if (renamePending.current || renameCancelled.current || !circle?.isAdmin || !rename.trim()) return;
    if (rename.trim() === circle.name) { setRenaming(false); return; }
    renamePending.current = true;
    try { const p = await run(() => service.renameCircle(circle.id, rename.trim()), 'circleUpdated'); if (p) setRenaming(false); }
    finally { renamePending.current = false; }
  };
  const create = async e => { e.preventDefault(); const p = await run(() => service.createCircle(name), 'circleCreated'); if (p) { setName(''); select(p.social.activeCircle); } };
  const previewCode = async e => { e.preventDefault(); const p = await run(() => service.previewCircle(code)); if (p) setPreview({ ...p, code }); };
  if (!isRemote) return <div className="settings-form"><p className="quiet-copy">{t('accountRequired')}</p><Button className="panel-primary" onClick={onAccount}>{t('signIn')}</Button></div>;
  return <div className="settings-form circles-form"><div className="circle-list">{profile.social.circles.map(c => <Button className="picker-row" mode="plain" key={c.id} onClick={() => select(c)} aria-pressed={selectedId === c.id}><span className="picker-content"><span className="circle-stack">{c.members.slice(0, 3).map(p => <Avatar key={p.id} person={p}/>)}</span><span className="picker-name">{c.name}</span><small>{c.memberCount}</small></span></Button>)}</div>
    {!profile.social.circles.length && <p className="quiet-copy">{t('noCircles')}</p>}
    {circle && <section className="circle-detail"><div className="section-heading">
      {renaming ? <form className="circle-rename" onSubmit={e => { e.preventDefault(); saveName(); }}><Input autoFocus className="settings-input" aria-label={t('circleName')} value={rename} maxLength={24} required disabled={busy} onChange={e => setRename(e.target.value)} onBlur={saveName} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); renameCancelled.current = true; setRenaming(false); setRename(circle.name); } }}/></form> : circle.isAdmin ? <button type="button" className="circle-title" aria-label={t('renameCircle')} title={t('renameCircle')} disabled={busy} onClick={() => { renameCancelled.current = false; setRename(circle.name); setRenaming(true); }}>{circle.name}</button> : <h2>{circle.name}</h2>}
      {profile.social.activeCircleId !== circle.id && <Button size="s" mode="plain" onClick={() => onSwitch(circle.id)}>{t('switchCircle')}</Button>}</div>
      <div className="member-list">{circle.members.map(p => <div className="member-row" key={p.id}><Avatar person={p}/><span><strong>{p.name}</strong>{p.isAdmin && <small>{t('admin')}</small>}</span>{circle.isAdmin && <Button className="member-actions-trigger" mode="plain" size="s" aria-label={t('manageMembers') + ' ' + p.name} disabled={busy} onClick={() => setMemberAction(p)}><Icon name="more"/></Button>}</div>)}</div>
      <div className="circle-actions"><Button mode="plain" className="circle-action" disabled={busy} onClick={async () => { const c = await run(() => service.getInvite(circle.id)); if (c) setInvite(c); }}><span className="picker-content"><Icon name="link"/><span>{t('inviteMembers')}</span></span></Button>
      {invite?.circleId === circle.id && <div className="code-card"><code>{invite.code}</code><Button mode="plain" onClick={() => copy(invite.code)}>{t('copyCode')}</Button><small>{t('expiresAt', { date: new Date(invite.expiresAt).toLocaleString() })}</small>{circle.isAdmin && <Button size="s" mode="plain" disabled={busy} onClick={async () => { const c = await run(() => service.getInvite(circle.id, true)); if (c) setInvite(c); }}>{t('renewInvite')}</Button>}</div>}
      <Button className="danger-text circle-action" mode="plain" disabled={busy} onClick={() => setConfirm({ leave: true })}>{t('leaveCircle')}</Button></div>
    </section>}
    <div className="circle-tools"><details className="settings-detail" open={!profile.social.circles.length}><summary>{t('createCircle')}</summary><form className="inline-form" onSubmit={create}><Input className="settings-input" aria-label={t('circleName')} placeholder={t('circleNamePlaceholder')} value={name} maxLength={24} onChange={e => setName(e.target.value)} required/><Button type="submit" disabled={busy || !name.trim()}>{t('createCircle')}</Button></form></details>
    <details className="settings-detail" open={!profile.social.circles.length}><summary>{t('joinCircle')}</summary><form className="inline-form" onSubmit={previewCode}><Input className="settings-input" id="circle-invite-input" aria-label={t('inviteCode')} placeholder={t('inviteCode')} value={code} maxLength={6} onChange={e => setCode(e.target.value.toUpperCase())}/><Button type="submit" disabled={busy || code.length !== 6}>{t('previewInvite')}</Button></form></details></div>
    {memberAction && circle && <Sheet title={memberAction.name} onClose={() => setMemberAction(null)}><div className="member-action-list"><Button mode="plain" className="picker-row" disabled={busy} onClick={async () => { const p = await run(() => service.setAdmin(circle.id, memberAction.id, !memberAction.isAdmin), 'circleUpdated'); if (p) setMemberAction(null); }}>{t(memberAction.isAdmin ? 'removeAdmin' : 'makeAdmin')}</Button>{memberAction.id !== profile.user.id && <Button mode="plain" className="picker-row danger-text" disabled={busy} onClick={() => { setConfirm({ member: memberAction }); setMemberAction(null); }}>{t('removeMember')}</Button>}</div></Sheet>}
    {preview && <Sheet title={t('invitedTo', { name: preview.circle.name })} onClose={() => setPreview(null)}><div className="invite-members">{preview.circle.members.map(p => <div key={p.id}><Avatar person={p}/><span>{p.name}</span></div>)}</div><p className="quiet-copy">{t('sharedHint')}</p><div className="sheet-actions"><Button mode="plain" onClick={() => setPreview(null)} disabled={busy}>{t('decline')}</Button><Button disabled={busy} onClick={async () => { const p = await run(() => service.joinCircle(preview.code), 'circleJoined'); if (p) { setPreview(null); setCode(''); select(p.social.activeCircle); } }}>{t('acceptInvite')}</Button></div></Sheet>}
    {confirm && circle && <Sheet title={t(confirm.leave ? 'leaveCircle' : 'removeMember')} onClose={() => setConfirm(null)}><p className="quiet-copy">{t(confirm.leave ? 'confirmLeave' : 'confirmRemove', { name: confirm.member?.name })}</p><div className="sheet-actions"><Button mode="plain" disabled={busy} onClick={() => setConfirm(null)}>{t('decline')}</Button><Button disabled={busy} onClick={async () => { const p = await run(() => confirm.leave ? service.leaveCircle(circle.id) : service.removeMember(circle.id, confirm.member.id), 'circleUpdated'); if (p) { setConfirm(null); setInvite(null); } }}>{t('confirm')}</Button></div></Sheet>}
  </div>;
}

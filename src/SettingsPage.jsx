import React, { useState } from 'react';
import { Button } from '@telegram-apps/telegram-ui';
import { Avatar, Sheet } from './AccountViews.jsx';
import { Icon } from './icons.jsx';
import CandidateIcon from './CandidateIcon.jsx';
import FreeMoney from './FreeMoney.jsx';

export default function SettingsPage({ profile, settings, expenses = [], t, ready, disabled, navigate, updateSettings, onLocation, locationEnabled, onSoundPreview }) {
  const [themeOpen, setThemeOpen] = useState(false);
  const row = (view, label, icon) => <Button key={view} mode="plain" className="settings-row" onClick={() => navigate(view)} disabled={!ready}><Icon name={icon}/><span>{t(label)}</span><span aria-hidden="true">›</span></Button>;
  return <div className="settings-home settings-organized">
    <Button mode="plain" className="settings-profile" onClick={() => navigate('profile')} disabled={!ready}><Avatar person={profile?.user}/><span><strong>{profile?.user?.name}</strong><small>{t('myProfile')}</small></span><CandidateIcon name="avatar-customize-v1"/><span aria-hidden="true">›</span></Button>
    <section className="settings-group" aria-label={t('ledger')}>
      {row('circles','circlesTitle','users')}{row('account','accountTitle','card')}
    </section>
    <section className="settings-group" aria-label={t('settingsTools')}>
      {row('ai-import','aiImportTitle','receipt')}{row('recurring','recurringTitle','repeat')}
      <Button mode="plain" className="settings-row" onClick={onLocation} disabled={!ready}><CandidateIcon name="privacy-location-tactile-v1"/><span>{t('locationTitle')}</span><small>{t(locationEnabled ? 'locationAutoOn' : 'sound_off')}</small><span aria-hidden="true">›</span></Button>
      <FreeMoney settings={settings} expenses={expenses} t={t} disabled={disabled} updateSettings={updateSettings}/>
    </section>
    <section className="settings-group" aria-label={t('settingsPersonalize')}>
      <label className="settings-choice" htmlFor="language"><span>{t('language')}</span><select id="language" value={settings.language} disabled={disabled} onChange={e => updateSettings({ language:e.target.value })}><option value="zh">中文</option><option value="en">English</option><option value="uk">Українська</option></select></label>
      <div className="settings-choice theme-choice" aria-label={t('themeTitle')}><span>{t('themeTitle')}</span><span className="settings-theme-value"><i className={`theme-dot theme-dot-${settings.theme || 'matcha'}`} aria-hidden="true"/><span>{t(`theme_${settings.theme || 'matcha'}`)}</span><button type="button" className="theme-open" aria-label={t('themeTitle')} aria-haspopup="dialog" aria-expanded={themeOpen} disabled={disabled} onClick={() => setThemeOpen(true)}><Icon name="chevronDown"/></button></span><select id="theme-choice" className="theme-native-select" aria-label={t('themeTitle')} value={settings.theme || 'matcha'} disabled={disabled} onChange={e => updateSettings({ theme:e.target.value })}>{['matcha','cheese','peach','sea'].map(theme => <option key={theme} value={theme}>{t(`theme_${theme}`)}</option>)}</select></div>
      <label className="settings-choice" htmlFor="sound-choice"><span>{t('soundTitle')}</span><select id="sound-choice" value={settings.soundPack || 'off'} disabled={disabled} onChange={e => { onSoundPreview?.(e.target.value); updateSettings({ soundPack:e.target.value }); }}>{['off','water','wood'].map(sound => <option key={sound} value={sound}>{t(`sound_${sound}`)}</option>)}</select></label>
    </section>
    {themeOpen && <Sheet title={t('themeTitle')} className="theme-sheet" onClose={() => setThemeOpen(false)}><div className="theme-palette" role="group" aria-label={t('themeTitle')}>
      {['matcha','cheese','peach','sea'].map(theme => <button type="button" key={theme} data-theme-option={theme} className="theme-card" aria-pressed={(settings.theme || 'matcha') === theme} disabled={disabled} onClick={() => { updateSettings({ theme }); setThemeOpen(false); }}>
        <span className={`theme-preview preview-${theme}`} aria-hidden="true"><span className="preview-amount"><i/><i/><i/></span><span className="preview-pills"><i/><i/><i/></span><span className="preview-keys">{Array.from({ length:6 }, (_, i) => <i key={i}/>)}</span></span>
        <span className="theme-card-label">{t(`theme_${theme}`)}<Icon name="check"/></span>
      </button>)}
    </div></Sheet>}
  </div>;
}

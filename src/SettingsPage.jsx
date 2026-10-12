import React from 'react';
import { Button } from '@telegram-apps/telegram-ui';
import { Avatar } from './AccountViews.jsx';
import { Icon } from './icons.jsx';

export default function SettingsPage({ profile, settings, t, ready, disabled, navigate, updateSettings, onLocation, locationEnabled }) {
  const row = (view, label, icon) => <Button key={view} mode="plain" className="settings-row" onClick={() => navigate(view)} disabled={!ready}><Icon name={icon}/><span>{t(label)}</span><span aria-hidden="true">›</span></Button>;
  return <div className="settings-home settings-organized">
    <Button mode="plain" className="settings-profile" onClick={() => navigate('profile')} disabled={!ready}><Avatar person={profile?.user}/><span><strong>{profile?.user?.name}</strong><small>{t('myProfile')}</small></span><span aria-hidden="true">›</span></Button>
    <section className="settings-group" aria-label={t('ledger')}>
      {row('circles','circlesTitle','users')}{row('account','accountTitle','card')}
    </section>
    <section className="settings-group" aria-label={t('settingsTools')}>
      {row('ai-import','aiImportTitle','receipt')}{row('recurring','recurringTitle','repeat')}
      <Button mode="plain" className="settings-row" onClick={onLocation} disabled={!ready}><Icon name="pin"/><span>{t('locationTitle')}</span><small>{t(locationEnabled ? 'locationAutoOn' : 'sound_off')}</small><span aria-hidden="true">›</span></Button>
    </section>
    <section className="settings-group" aria-label={t('settingsPersonalize')}>
      <label className="settings-choice" htmlFor="language"><span>{t('language')}</span><select id="language" value={settings.language} disabled={disabled} onChange={e => updateSettings({ language:e.target.value })}><option value="zh">中文</option><option value="en">English</option><option value="uk">Українська</option></select></label>
      <label className="settings-choice" htmlFor="theme-choice"><span>{t('themeTitle')}</span><select id="theme-choice" value={settings.theme || 'matcha'} disabled={disabled} onChange={e => updateSettings({ theme:e.target.value })}>{['matcha','cheese','peach','sea'].map(theme => <option key={theme} value={theme}>{t(`theme_${theme}`)}</option>)}</select></label>
      <label className="settings-choice" htmlFor="sound-choice"><span>{t('soundTitle')}</span><select id="sound-choice" value={settings.soundPack || 'off'} disabled={disabled} onChange={e => updateSettings({ soundPack:e.target.value })}>{['off','water','wood'].map(sound => <option key={sound} value={sound}>{t(`sound_${sound}`)}</option>)}</select></label>
    </section>
  </div>;
}

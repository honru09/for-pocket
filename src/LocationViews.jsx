import React from 'react';
import { Button } from '@telegram-apps/telegram-ui';
import { Sheet } from './AccountViews.jsx';
import { Icon } from './icons.jsx';
import { locationLabel } from '../public/location.mjs';
import './location.css';

export function LocationSheet({ t, location, enabled, loading, onCapture, onRemove, onDisable, onClose }) {
  return <Sheet title={t('locationTitle')} onClose={onClose}>
    {location && <div className="location-preview"><Icon name="pin"/><div><strong>{locationLabel(location) || t('locationAttached')}</strong>{location.address && <span>{location.address}</span>}</div></div>}
    <p className="location-hint">{t('locationPrivacy')}</p>
    <div className="location-actions"><Button className="compact-save" disabled={loading} onClick={onCapture}>{t(loading ? 'locationLoading' : location ? 'locationRefresh' : 'locationUse')}</Button>
      {location && <Button mode="plain" onClick={onRemove}>{t('locationRemove')}</Button>}
      {enabled && <Button mode="plain" onClick={onDisable}>{t('locationDisable')}</Button>}
    </div>
    <p className="location-credit"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a><span> · </span><a href="https://github.com/komoot/photon" target="_blank" rel="noreferrer">Photon</a></p>
  </Sheet>;
}

export function Footprints({ items, t }) {
  if (!items.length) return null;
  return <details className="footprints"><summary><Icon name="pin"/><span>{t('footprintsTitle')}</span><small>{t(items.length === 1 ? 'footprintsPlacesOne' : 'footprintsPlaces', { n: items.length })}</small><Icon name="chevronDown"/></summary>
    <ul>{items.slice(0, 6).map(item => <li key={item.name}><span>{item.name}</span><small>{t(item.count === 1 ? 'footprintsCountOne' : 'footprintsCount', { n: item.count })}</small></li>)}</ul>
  </details>;
}

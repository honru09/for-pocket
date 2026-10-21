import React from 'react';
import pocket from '../public/assets/pocket-materials-v2/pocket-open.webp';
import cash from '../public/assets/pocket-materials-v2/cash-note.webp';
import coin from '../public/assets/pocket-materials-v2/coin.webp';
import envelope from '../public/assets/pocket-materials-v2/reserve-envelope.webp';
import book from '../public/assets/pocket-materials-v2/ledger-book.webp';
import receipts from '../public/assets/pocket-materials-v2/receipt-stack.webp';
import calendar from '../public/assets/pocket-materials-v2/calendar.webp';
import clip from '../public/assets/pocket-materials-v2/paperclip.webp';

const materials = { 'pocket-open':pocket, 'cash-note':cash, coin, 'reserve-envelope':envelope,
  'ledger-book':book, 'receipt-stack':receipts, calendar, paperclip:clip };

// Stable geometry keeps lazy decoded artwork from shifting text or hit areas.
// These are decorative siblings of real labels, never baked-in UI copy.
export default function JournalMaterial({ name, className = '' }) {
  const src = materials[name];
  if (!src) return null;
  return <img className={`journal-material ${className}`} data-material={name} src={src}
    alt="" aria-hidden="true" width="36" height="36" loading="lazy" decoding="async" draggable="false"/>;
}

export function ReceiptMaterial() {
  return <span className="receipt-material" aria-hidden="true">
    <JournalMaterial name="receipt-stack"/><JournalMaterial name="paperclip"/>
  </span>;
}

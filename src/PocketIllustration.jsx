import React from 'react';
import emptyLedger from '../public/assets/ui-kit-v1/illustrations/empty-ledger.png';
import importReview from '../public/assets/ui-kit-v1/illustrations/import-review.png';
import partialImport from '../public/assets/ui-kit-v1/illustrations/partial-import.png';
import sharedCircle from '../public/assets/ui-kit-v1/illustrations/shared-circle.png';
import pendingRetry from '../public/assets/ui-kit-v1/illustrations/pending-retry.png';
import offlineDraft from '../public/assets/ui-kit-v1/illustrations/offline-draft.png';
import locationPrivacy from '../public/assets/ui-kit-v1/illustrations/location-privacy.png';
import categorySuggestions from '../public/assets/ui-kit-v1/candidates-v3/illustrations/category-suggestions-tactile-v1-web.png';
import recurringReminder from '../public/assets/ui-kit-v1/candidates-v3/illustrations/recurring-reminder-tactile-v1-web.png';
import receiptReview from '../public/assets/ui-kit-v1/candidates-v3/illustrations/receipt-review-tactile-v1-web.png';
import summaryReview from '../public/assets/ui-kit-v1/candidates-v3/illustrations/summary-review-tactile-v1-web.png';
import exportEnvelope from '../public/assets/ui-kit-v1/candidates-v3/illustrations/export-envelope-tactile-v1-web.png';
import './pocket-illustrations.css';

const illustrations = {
  'empty-ledger': { src:emptyLedger, width:1536, height:1024 },
  'import-review': { src:importReview, width:1536, height:1024 },
  'partial-import': { src:partialImport, width:1536, height:1024 },
  'shared-circle': { src:sharedCircle, width:1536, height:1024 },
  'pending-retry': { src:pendingRetry, width:1536, height:1024 },
  'offline-draft': { src:offlineDraft, width:1536, height:1024 },
  'location-privacy': { src:locationPrivacy, width:1536, height:1024 },
  'category-suggestions-tactile-v1': { src:categorySuggestions, width:768, height:512, kind:'tactile' },
  'recurring-reminder-tactile-v1': { src:recurringReminder, width:768, height:512, kind:'tactile' },
  'receipt-review-tactile-v1': { src:receiptReview, width:512, height:512, kind:'tactile' },
  'summary-review-tactile-v1': { src:summaryReview, width:768, height:512, kind:'tactile' },
  'export-envelope-tactile-v1': { src:exportEnvelope, width:768, height:512, kind:'tactile' },
};

// Production state art and transparent tactile candidates share one API.
// Only a mounted, visible state loads its image; none are preloaded on entry.
export default function PocketIllustration({ name, compact = false, className = '' }) {
  const illustration = illustrations[name];
  if (!illustration) return null;
  return <img className={`pocket-illustration${compact ? ' is-compact' : ''}${illustration.kind === 'tactile' ? ' is-tactile' : ''}${className ? ` ${className}` : ''}`} data-illustration={name}
    src={illustration.src} width={illustration.width} height={illustration.height} alt="" aria-hidden="true"
    loading="lazy" decoding="async" draggable="false"/>;
}

import React from 'react';
import emptyLedger from '../public/assets/ui-kit-v1/illustrations/empty-ledger.png';
import importReview from '../public/assets/ui-kit-v1/illustrations/import-review.png';
import partialImport from '../public/assets/ui-kit-v1/illustrations/partial-import.png';
import sharedCircle from '../public/assets/ui-kit-v1/illustrations/shared-circle.png';
import pendingRetry from '../public/assets/ui-kit-v1/illustrations/pending-retry.png';
import offlineDraft from '../public/assets/ui-kit-v1/illustrations/offline-draft.png';
import locationPrivacy from '../public/assets/ui-kit-v1/illustrations/location-privacy.png';
import './pocket-illustrations.css';

const illustrations = {
  'empty-ledger': emptyLedger,
  'import-review': importReview,
  'partial-import': partialImport,
  'shared-circle': sharedCircle,
  'pending-retry': pendingRetry,
  'offline-draft': offlineDraft,
  'location-privacy': locationPrivacy,
};

// These are opaque paper illustrations, not transparent mascot stickers.
// Only a mounted, visible state loads its image; none are preloaded on entry.
export default function PocketIllustration({ name, compact = false }) {
  if (!illustrations[name]) return null;
  return <img className={`pocket-illustration${compact ? ' is-compact' : ''}`} data-illustration={name}
    src={illustrations[name]} width="1536" height="1024" alt="" aria-hidden="true"
    loading="lazy" decoding="async" draggable="false"/>;
}

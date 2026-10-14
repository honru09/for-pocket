import React from 'react';
import { Button, Placeholder } from '@telegram-apps/telegram-ui';
import PocketIllustration from './PocketIllustration.jsx';
import { Icon } from './icons.jsx';

export default function LedgerEmptyState({ ready, failed, filtered, t, onRetry, onRecord }) {
  const state = failed ? 'error' : !ready ? 'loading' : filtered ? 'filtered' : 'empty';
  const header = t({ error: 'unavailable', loading: 'loading', filtered: 'historyEmptyTitle', empty: 'emptyTitle' }[state]);
  const action = state === 'error' ? <Button mode="outline" onClick={onRetry}>{t('retry')}</Button> :
    state === 'loading' ? undefined : <Button mode="filled" onClick={onRecord}>{t('newEntry')}</Button>;
  return <Placeholder className="empty-state ledger-empty-state" data-state={state} header={header}
    description={state === 'empty' ? t('emptyText') : state === 'filtered' ? t('historyEmptyText') : undefined} action={action}>
    {state === 'empty' ? <PocketIllustration name="empty-ledger"/> :
      <span className="ledger-empty-symbol"><Icon name={state === 'error' ? 'storage-read-failed' : state === 'filtered' ? 'empty-filter' : 'book'}/></span>}
  </Placeholder>;
}

# Daily ledger digest scheduler

for. sends a short life-ledger update at 10:00, 13:00 and 20:00 in each
ledger's configured IANA timezone (`settings.timezone`). The default timezone
is `Asia/Tokyo`.

## Endpoints

Both endpoints are `POST`, accept `Content-Type: application/json`, and
require the `X-Cron-Secret` header. Set `CRON_SECRET` in Cloud Run and use the
same Secret Manager value in Cloud Scheduler. The process fallback is random
and should only be used for local tests.

### Hourly dispatcher

`POST /api/cron/tick` with `{}` inspects all active ledgers. A ledger is
eligible at local hours 10, 13 and 20; the same local date and slot is claimed
once. For a deployment that serves timezones with half-hour or quarter-hour
offsets, run this endpoint every 15 minutes (`*/15 * * * *`) instead of hourly
so local 10:00/13:00/20:00 is not missed. The endpoint itself remains
idempotent.

### Direct slot trigger

`POST /api/cron/digest` accepts:

```json
{ "slot": "morning" }
```

`slot` is one of `morning`, `noon`, or `evening`. An optional `ledgerId`
limits a manual retry to one ledger. The windows are half-open local ranges:

- `morning`: previous local day 00:00 through today 10:00;
- `noon`: today 10:00 through 13:00;
- `evening`: today 00:00 through 20:00.

The service skips deleted, income, transfer, and reimbursement rows. Amounts,
categories, and payer totals remain separated by currency; no exchange rate
is invented.

## Telegram delivery and retry behavior

The message is sent to each bound Telegram chat with ordinary notification
behavior. A successful recipient is checkpointed in the store and is not sent
again if another recipient fails. A failed delivery leaves that recipient
retryable and the slot claim in `failed` state, so Cloud Scheduler can retry
the request. A process crash between Telegram acceptance and its checkpoint
can still produce one duplicate; Telegram has no transactional send-and-store
operation, so strict exactly-once delivery is not possible with the JSON store.

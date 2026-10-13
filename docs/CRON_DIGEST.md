# Daily ledger messages

for. sends a short life-ledger update at 10:00, 13:00 and 20:00 in each
ledger's configured IANA timezone (`settings.timezone`). The default timezone
is `Asia/Tokyo`.

At 22:00 in each user's automatically detected timezone, a separate private
reminder is sent only if that person has no saved record dated today. The
selected circle does not affect this check. A partner's records do not count
as the user's own activity, even if an older release copied those records into
the personal ledger.

## Endpoints

Both endpoints are `POST`, accept `Content-Type: application/json`, and
require the `X-Cron-Secret` header. Set `CRON_SECRET` in Cloud Run and use the
same Secret Manager value in Cloud Scheduler. The process fallback is random
and should only be used for local tests.

### Dispatcher

`POST /api/cron/tick` with `{}` inspects all active ledgers. A ledger is
eligible at local hours 10, 13 and 20; the same local date and slot is claimed
once. For a deployment that serves timezones with half-hour or quarter-hour
offsets, run this endpoint every 15 minutes (`*/15 * * * *`) instead of hourly
so local 10:00/13:00/20:00 is not missed. The endpoint itself remains
idempotent. The same endpoint also checks the 22:00 personal reminder, using
`user.settings.timezone` with `Asia/Tokyo` as fallback. Use the 15-minute
schedule for this deployment so quarter-hour and half-hour timezones reach
their local 22:00 without a delay.

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

The message is sent to each bound Telegram chat as a silent Telegram notification
(`disable_notification: true`), so it never rings or vibrates. A successful
recipient is checkpointed in the store and is not sent
again if another recipient fails. A failed delivery leaves that recipient
retryable and the slot claim in `failed` state, so Cloud Scheduler can retry
the request. A process crash between Telegram acceptance and its checkpoint
can still produce one duplicate; Telegram has no transactional send-and-store
operation, so strict exactly-once delivery is not possible with the JSON store.

## 22:00 missing-entry reminder

`createMissingEntryReminderService` in `missing-entry-reminder.mjs` exposes
`tick({ at })` for the cron dispatcher. It accepts the same `store`, `token`,
`callTelegram` and `now` dependencies used by the existing digest service.
The HTTP tick handler must include the result and return `503` when its
`failed` count is greater than zero, so Scheduler can retry failed recipients.

- Ownership follows the record's public payer ID (`u_<uid>`), falling back to
  the legacy author or original personal source when necessary.
- Mirrored copies are deduplicated by record ID. The newest record state wins;
  a deletion tombstone prevents stale mirrors from suppressing a reminder.
- A valid expense, income, transfer or reimbursement dated today counts as
  having recorded. Deleted rows, invalid amounts and future-dated records do
  not count. The reminder never equates an empty ledger with zero spending.
- Only a known private Telegram destination receives the reminder. Group
  bindings and bindings belonging to a different user are rejected.
- The most recent private-chat language wins over the profile language.
  Chinese, English and Ukrainian each have their own concise text.
- `db.cron.missingEntryReminders["<uid>:<local-date>"]` stores a claim and the
  successful message ID. Repeated ticks, service restarts and switching circles
  do not resend a successful reminder. Failed sends can retry until local
  midnight, after checking again whether the user has since recorded a bill.
- The reminder is also a silent Telegram notification (`disable_notification: true`).
  Expense companion messages and emoji summaries use the same quiet delivery.

The narrow Telegram-accepted/store-not-checkpointed crash window described
above also applies to these reminders. No live test message is needed: the
unit tests inject the Telegram caller, clock and temporary store.

## Cloud Scheduler deployment check

The repository contains the HTTP endpoints and an idempotent setup script,
`scripts/setup-reminders.sh` (offline `--dry-run` by default; `--apply` configures
the cloud resources). See [deployment instructions](REACTION_NOTIFICATIONS.md).
A GitHub/Cloud Build release by itself does not create a timer. Inspect the existing job in project
`project-175c4bc7-52ff-4b6d-b53` before adding another job, to avoid duplicates.

Use one HTTP job with these fields:

| Field | Value |
| --- | --- |
| Target | `https://for-pocket-698348906987.asia-northeast1.run.app/api/cron/tick` |
| HTTP method | `POST` |
| Frequency | `*/15 * * * *` |
| Scheduler timezone | `Etc/UTC` (each recipient's timezone is resolved by the app) |
| Body | `{}` |
| Content-Type | `application/json` |
| X-Cron-Secret | Same private value as Cloud Run's `CRON_SECRET` |

Use a stable secret from Secret Manager, not the process-random local fallback.
Keep its value out of screenshots, Git, logs and command-line history. For a
private Cloud Run target, configure a Scheduler service account with
`roles/run.invoker` and an OIDC token; the app still requires `X-Cron-Secret`.
See Google's [HTTP target authentication guide](https://docs.cloud.google.com/scheduler/docs/http-target-auth).

Live verification (2026-10-14, project `project-175c4bc7-52ff-4b6d-b53`): the
`for-pocket-reminders-tick` job is enabled in `asia-northeast1`, runs every 15
minutes in `Etc/UTC`, targets the tick URL above, and its latest status is
reported as successful. The `for-pocket-reactions` Cloud Tasks queue is running
in `asia-northeast1`. No manual production run was triggered.

After deployment, check the job is enabled, its next scheduled run and its
last response status. A successful request should have a `200` response;
`401` means the configured secret does not match, while `503` asks Scheduler
to retry a failed delivery. Configure retry backoff within the same local
hour (for example, a 30-second minimum and a 5-minute maximum). Do not run a
manual trigger against production merely to test delivery: it can send real
digest or reminder messages to users.

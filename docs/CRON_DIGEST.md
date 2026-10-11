# Daily ledger digest scheduler

The service exposes two authenticated endpoints:

- `POST /api/cron/tick` — call this at the top of every hour. Each active ledger is evaluated in its own `settings.timezone`; only local 10:00, 13:00, and 20:00 trigger a digest.
- `POST /api/cron/digest` — direct slot trigger for `{ "slot": "morning" | "noon" | "evening" }`, useful for a manual retry or a three-job schedule.

Both requests need the `X-Cron-Secret` header. Set `CRON_SECRET` in Cloud Run and keep the same value in Secret Manager for Cloud Scheduler. The in-process fallback is intentionally random and is suitable only for local tests.

Example Cloud Scheduler request body:

```json
{ "slot": "morning" }
```

Use `Content-Type: application/json` and send the request to the deployed HTTPS service. Every ledger and slot is claimed by a same-local-date key, so retries do not send a duplicate message. Telegram delivery uses `disable_notification: true`.

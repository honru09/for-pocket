# Circle emoji bursts and quiet Telegram delivery

An individual tap remains an individual inbox item so the recipient can play
every animation. `burstId`, `burstIndex`, `burstCount`, and `burstLastAt` travel
with both GET items and POST acknowledgements. `burstIndex` belongs to that
particular event; `burstCount` is the current total and may continue growing.

For a sender/recipient pair in one circle, the same emoji joins the previous
burst when the server receives it within 3,000 ms of the previous event.
Changing emoji or waiting longer starts another burst. An idempotent POST
retry does not increment the count or move the deadline. Reactions created
before this feature remain playable as single events and are not retrospectively
sent to Telegram.

## Durable delivery

Each circle stores `reactionBursts` beside its individual reactions. A burst
has a quiet-notification deadline of `lastAt + 13,000 ms`: three seconds to
close the group, then ten more seconds before notification. The recipient's
latest Telegram conversation language determines the Chinese, English, or
Ukrainian text. Single emoji have no count suffix; repeated emoji add `×N`.
Every send uses `disable_notification: true` and only targets a private chat
bound to that user. Removed circle members receive no pending notifications.

The notification status, send lease, message id, task deadline and errors are
persisted. An application restart preserves pending work. Once sent, cron,
task retries and concurrent requests do not send it again. There is an
unavoidable narrow failure window if Telegram accepts a message and the
process dies before recording its message id: Telegram's `sendMessage` API has
no transaction or idempotency key. An expired lease permits recovery after a
crash; that narrow window may produce one duplicate.

## HTTP integration

`createReactionNotificationService()` accepts the store, bot token (or a test
`callTelegram`), clock and optional Cloud Tasks enqueue function.

- After a successful reaction POST transaction, await `afterReaction(result)`.
  This schedules the first durable wake-up before the HTTP response ends.
- `POST /api/cron/reactions` validates `X-Cron-Secret`, accepts
  `{ circleId, burstId, scheduledFor }`, then calls `deliver(body)`. Return 503
  when its result contains `failed > 0`, so Cloud Tasks retries.
- Call `tick()` from the cron repair path and opportunistically from requests.
  It also retries task enqueue failures and overdue deliveries.
- Call `start()` during startup and `close()` before closing the store.
- Account merges must remap each burst's `from` and `to`, just like reactions.

The local timer is a convenience, not a production scheduling guarantee.
Cloud Run can stop allocating CPU outside active HTTP requests. Production
must use Cloud Tasks for a wake-up around the intended deadline; the existing
hourly/quarter-hourly cron only supplies recovery if enqueueing failed.

Only one future task is queued for a burst. If people keep tapping beyond its
deadline, that task re-reads the burst and schedules another wake-up for the
latest deadline. A task name is a stable hash of circle/burst/deadline so
enqueue retries deduplicate. An older callback cannot replace a newer task's
checkpoint. Nothing in task bodies includes a Telegram token or chat id.

## Google Cloud setup

Environment variables:

```dotenv
REACTION_TASKS_QUEUE=for-pocket-reactions
REACTION_TASKS_LOCATION=asia-northeast1
GOOGLE_CLOUD_PROJECT=your-google-project-id
PUBLIC_URL=https://your-cloud-run-service.run.app
CRON_SECRET=<a-stable-secret-from-secret-manager>
# Optional when Cloud Run itself requires authenticated invocation:
REACTION_TASKS_SERVICE_ACCOUNT=tasks-invoker@your-google-project-id.iam.gserviceaccount.com
```

`VERTEX_PROJECT_ID` is accepted when `GOOGLE_CLOUD_PROJECT` is not set.
`createCloudTasksReactionQueue` returns null unless project, queue, public URL
and cron secret are configured. It uses the existing `google-auth-library`
and Application Default Credentials, with no new client SDK dependency.

Enable `cloudtasks.googleapis.com`, create the queue in the configured region,
and grant the Cloud Run runtime service account `roles/cloudtasks.enqueuer`
on that queue. Use queue retry settings (for example minimum backoff 5 seconds,
maximum backoff 300 seconds, retry duration one day) appropriate to temporary
Telegram outages. Keep the queue running.

The public Cloud Run endpoint authenticates with `X-Cron-Secret`. If using the
optional OIDC service-account setting, grant that account Cloud Run Invoker;
the enqueuing identity also needs permission to act as that account. Keep the
Cloud Tasks service agent's required token-minting permissions. Do not log
task request headers or print the cron secret.

The underlying JSON store expects one active writer. Retain the deployment's
single-instance configuration; a shared JSON file is not a multi-instance
transactional database.

See Google's [HTTP target task guide](https://cloud.google.com/tasks/docs/creating-http-target-tasks)
and [CreateTask REST reference](https://cloud.google.com/tasks/docs/reference/rest/v2/projects.locations.queues.tasks/create).

### Reviewable Cloud Shell setup

`scripts/setup-reminders.sh` sets up the existing public, single-container
Cloud Run service. Run it from a checkout in Google Cloud Shell with Bash,
authenticated `gcloud`, `jq`, OpenSSL, and standard coreutils installed.
Its defaults are project `project-175c4bc7-52ff-4b6d-b53`, region
`asia-northeast1`, and service `for-pocket`. Override `PROJECT`, `REGION`, and
`SERVICE` explicitly when targeting another deployment.

```sh
bash scripts/setup-reminders.sh --dry-run
# Apply only after reviewing the plan:
bash scripts/setup-reminders.sh --apply
```

The default and `--dry-run` print an offline plan with no Google API calls,
credential reads, generated secrets, or cloud changes. `--apply` inspects the
actual service first, preserves unrelated configuration, enables the two
required APIs, reuses/creates the reaction queue, adds only queue-scoped
Cloud Tasks Enqueuer for the runtime account, and reuses an existing Scheduler
job for the exact tick URL. Multiple matching jobs or a conflicting job name
stop setup rather than creating duplicates or repurposing another job.

An existing `CRON_SECRET` is reused, whether stored as a literal environment
value or Secret Manager reference. A missing secret is generated with OpenSSL
and added as a literal environment value; an existing Secret Manager reference
is retained. The script never rotates a configured secret. It passes sensitive
flags through permission-restricted temporary JSON files, suppresses
secret-bearing command output, and removes these files on exit. Do not run
this script with external tracing, terminal recording, or HTTP debug logging.

The caller needs read access to the service/policy/API/job/queue metadata,
permission to enable Scheduler and Tasks APIs, manage that queue's IAM and
Scheduler job, and update the Cloud Run service. Secret Manager Accessor is
also needed when reusing a referenced secret. A private Cloud Run target stops
with OIDC setup instructions; the script never changes who can access the app.

An environment update creates a Cloud Run revision using the existing image;
storage, scaling, image and other settings are preserved. Applying this setup
enables real scheduled delivery, but never manually runs a job or sends a test
Telegram message. Repeated applications preserve the same resources/secret.

The commands follow Google's [partial environment update reference](https://cloud.google.com/sdk/gcloud/reference/run/services/update),
[JSON/YAML flags-file syntax](https://cloud.google.com/sdk/gcloud/reference/topic/flags-file),
[Scheduler HTTP updates](https://cloud.google.com/sdk/gcloud/reference/scheduler/jobs/update/http),
[queue IAM binding reference](https://cloud.google.com/sdk/gcloud/reference/tasks/queues/add-iam-policy-binding),
and [safe Secret Manager file output](https://cloud.google.com/sdk/gcloud/reference/secrets/versions/access).

## Verification

```sh
node --test tests/reaction-notifications.test.mjs tests/circle-reactions.test.mjs
```

All Telegram calls and Cloud Tasks calls in these tests are injected fakes.
The suite verifies the 3-second boundary, idempotent sends, changing emoji,
quiet notification timing/count/language, restart recovery, concurrent sends,
membership and private-chat boundaries, task deduplication and rescheduling.

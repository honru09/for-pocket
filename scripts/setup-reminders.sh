#!/usr/bin/env bash
# Cloud Shell bootstrap for for-pocket's existing Cloud Run service.
# Default: review-only plan. Pass --apply after reviewing --dry-run.
set +x
set -euo pipefail
umask 077

PROJECT="${PROJECT:-project-175c4bc7-52ff-4b6d-b53}"
REGION="${REGION:-asia-northeast1}"
SERVICE="${SERVICE:-for-pocket}"
MODE=dry-run
for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE=dry-run ;;
    --apply) MODE=apply ;;
    --help|-h)
      printf '%s\n' 'Usage: PROJECT=... REGION=... SERVICE=... bash scripts/setup-reminders.sh [--dry-run|--apply]' \
        'Default is --dry-run (offline plan, no cloud calls). --apply requires authenticated gcloud, jq and openssl.'
      exit 0 ;;
    *) printf '%s\n' "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done
[[ "$PROJECT" =~ ^[a-z][a-z0-9-]{4,62}[a-z0-9]$ ]] || { printf '%s\n' 'Invalid PROJECT.' >&2; exit 2; }
[[ "$REGION" =~ ^[a-z]+(-[a-z]+)+[0-9]$ ]] || { printf '%s\n' 'Invalid REGION.' >&2; exit 2; }
[[ "$SERVICE" =~ ^[a-z][a-z0-9-]{0,61}[a-z0-9]$ ]] || { printf '%s\n' 'Invalid SERVICE.' >&2; exit 2; }

print_plan() {
  printf '%s\n' \
    "Project: $PROJECT  Region: $REGION  Cloud Run service: $SERVICE" \
    '1. Read the existing service, runtime account, URL, environment and public-invoker policy.' \
    '2. Reuse CRON_SECRET (including a Secret Manager reference). If missing, generate 32 random bytes without displaying them.' \
    '3. Enable Cloud Scheduler and Cloud Tasks APIs only if disabled.' \
    "4. Reuse the service's reaction queue or create $SERVICE-reactions in $REGION. Preserve existing queue settings." \
    '5. Add roles/cloudtasks.enqueuer for the runtime account on that queue only.' \
    '6. Patch only missing/changed reminder-related environment variables; retain image, volumes, scaling and other settings.' \
    "7. Reuse the existing job for /api/cron/tick, or create $SERVICE-reminders-tick; set */15 * * * * in Etc/UTC." \
    '8. Use POST {}, the existing secret header, bounded retry backoff, and retain unrelated headers/auth configuration.' \
    '9. Verify configuration only. Do not run jobs or send test Telegram messages.' \
    'A Cloud Run environment update creates a revision. This plan never changes the container image or storage.'
}
print_plan
if [[ "$MODE" == dry-run ]]; then
  printf '%s\n' 'Dry run complete: no credentials read, no cloud calls, no secrets generated, no changes applied.'
  exit 0
fi

for command in gcloud jq openssl mktemp; do
  command -v "$command" >/dev/null || { printf '%s\n' "Required command missing: $command" >&2; exit 1; }
done
# Prevent inherited shell tracing or HTTP debug logging from revealing secrets.
export CLOUDSDK_CORE_LOG_HTTP=false
export CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true
export CLOUDSDK_CORE_VERBOSITY=error
task_temp=$(mktemp -d /tmp/for-pocket-reminders.XXXXXXXX)
cleanup() {
  case "$task_temp" in
    /tmp/for-pocket-reminders.*)
      # Delete only files made by this script, never recursively delete a path.
      rm -f -- "$task_temp"/*.json "$task_temp"/cron-secret "$task_temp"/stderr
      rmdir -- "$task_temp" 2>/dev/null || true ;;
  esac
}
trap cleanup EXIT
die() { printf '%s\n' "$1" >&2; exit 1; }
read_cloud() {
  local destination=$1; shift
  # Never echo gcloud output on failure: error diagnostics may contain headers.
  if ! gcloud "$@" --quiet --verbosity=error >"$destination" 2>"$task_temp/stderr"; then
    die 'A Google Cloud inspection failed. Check authentication, resource names and the documented permissions; secret-bearing diagnostics were suppressed.'
  fi
}
change_cloud() {
  if ! gcloud "$@" --quiet --verbosity=error >"$task_temp/result.json" 2>"$task_temp/stderr"; then
    die 'A Google Cloud change failed. The script is safe to retry after fixing permissions/configuration; secret-bearing diagnostics were suppressed.'
  fi
}
read_cloud "$task_temp/service.json" run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=json
[[ $(jq '.spec.template.spec.containers | length' "$task_temp/service.json") == 1 ]] || die 'This script supports the existing single-container service only; multi-container services need an explicit target.'
read_cloud "$task_temp/policy.json" run services get-iam-policy "$SERVICE" --project="$PROJECT" --region="$REGION" --format=json
if ! jq -e 'any(.bindings[]?; .role == "roles/run.invoker" and any(.members[]?; . == "allUsers"))' "$task_temp/policy.json" >/dev/null \
   && ! jq -e '.metadata.annotations["run.googleapis.com/invoker-iam-disabled"] == "true"' "$task_temp/service.json" >/dev/null; then
  die 'The Cloud Run service is private. Configure an OIDC invoker first as described in docs/REACTION_NOTIFICATIONS.md; this script does not broaden public access.'
fi
runtime_account=$(jq -r '.spec.template.spec.serviceAccountName // empty' "$task_temp/service.json")
if [[ -z "$runtime_account" ]]; then
  read_cloud "$task_temp/project.json" projects describe "$PROJECT" --format=json
  runtime_account="$(jq -r '.projectNumber' "$task_temp/project.json")-compute@developer.gserviceaccount.com"
fi
[[ "$runtime_account" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.gserviceaccount\.com$ ]] || die 'Could not safely resolve the Cloud Run runtime account.'
env_value() { jq -r --arg key "$1" '[.spec.template.spec.containers[0].env[]? | select(.name == $key) | .value // empty][0] // empty' "$task_temp/service.json"; }
public_url=$(env_value PUBLIC_URL)
[[ -n "$public_url" ]] || public_url=$(jq -r '.status.url // empty' "$task_temp/service.json")
public_url=${public_url%/}
[[ "$public_url" =~ ^https://[a-zA-Z0-9.-]+$ ]] || die 'PUBLIC_URL must be a clean HTTPS origin for this setup.'
queue=$(env_value REACTION_TASKS_QUEUE)
[[ -n "$queue" ]] || queue="$SERVICE-reactions"
queue_region=$(env_value REACTION_TASKS_LOCATION)
[[ -n "$queue_region" ]] || queue_region=$REGION
[[ "$queue" =~ ^[a-zA-Z0-9_-]{1,100}$ && "$queue_region" =~ ^[a-z]+(-[a-z]+)+[0-9]$ ]] || die 'Existing reaction queue configuration is invalid.'
task_project=$(env_value GOOGLE_CLOUD_PROJECT)
[[ -n "$task_project" ]] || task_project=$(env_value VERTEX_PROJECT_ID)
[[ -z "$task_project" || "$task_project" == "$PROJECT" ]] || die 'Existing task/Vertex project differs from PROJECT. Resolve this explicitly before applying.'

# Inspect API state before enabling anything. An absent API makes its resources
# known to be unconfigured for this setup; permission errors never mean absent.
read_cloud "$task_temp/apis.json" services list --enabled --project="$PROJECT" --format=json
api_enabled() { jq -e --arg api "$1" 'any(.[]; .config.name == $api)' "$task_temp/apis.json" >/dev/null; }
if api_enabled cloudscheduler.googleapis.com; then
  read_cloud "$task_temp/jobs.json" scheduler jobs list --project="$PROJECT" --location="$REGION" --format=json
else
  printf '[]\n' >"$task_temp/jobs.json"
fi
job_uri="$public_url/api/cron/tick"
match_count=$(jq --arg uri "$job_uri" '[.[] | select(.httpTarget.uri == $uri)] | length' "$task_temp/jobs.json")
[[ "$match_count" -le 1 ]] || die 'More than one Scheduler job already targets this tick URL. Resolve duplicate jobs before running setup.'
if [[ "$match_count" == 1 ]]; then
  job=$(jq -r --arg uri "$job_uri" '.[] | select(.httpTarget.uri == $uri) | .name | split("/")[-1]' "$task_temp/jobs.json")
  job_exists=true
else
  job="$SERVICE-reminders-tick"
  if jq -e --arg name "$job" 'any(.[]; (.name | split("/")[-1]) == $name)' "$task_temp/jobs.json" >/dev/null; then
    die 'The intended Scheduler job name is already used by another target. No job has been overwritten.'
  fi
  job_exists=false
fi

secret_type=$(jq -r '[.spec.template.spec.containers[0].env[]? | select(.name == "CRON_SECRET")][0] | if .valueFrom.secretKeyRef then "reference" elif (.value // "") != "" then "literal" else "missing" end' "$task_temp/service.json")
if [[ "$secret_type" == reference ]]; then
  secret_name=$(jq -r '.spec.template.spec.containers[0].env[] | select(.name == "CRON_SECRET") | .valueFrom.secretKeyRef.name' "$task_temp/service.json")
  secret_version=$(jq -r '.spec.template.spec.containers[0].env[] | select(.name == "CRON_SECRET") | .valueFrom.secretKeyRef.key' "$task_temp/service.json")
  # Cloud Run can map an alias to a cross-project Secret Manager resource.
  secret_alias=$(jq -r --arg name "$secret_name" '(.spec.template.metadata.annotations["run.googleapis.com/secrets"] // .metadata.annotations["run.googleapis.com/secrets"] // "") | split(",")[] | split(":") | select(.[0] == $name) | .[1]' "$task_temp/service.json")
  [[ -z "$secret_alias" ]] || secret_name=$secret_alias
  if ! gcloud secrets versions access "$secret_version" --secret="$secret_name" --project="$PROJECT" --out-file="$task_temp/cron-secret" --quiet --verbosity=error >"$task_temp/result.json" 2>"$task_temp/stderr"; then
    die 'Cannot read the existing CRON_SECRET Secret Manager version. It was not replaced or rotated.'
  fi
elif [[ "$secret_type" == literal ]]; then
  jq -j '.spec.template.spec.containers[0].env[] | select(.name == "CRON_SECRET") | .value' "$task_temp/service.json" >"$task_temp/cron-secret"
else
  openssl rand -hex 32 | tr -d '\r\n' >"$task_temp/cron-secret"
fi
jq -n -e --rawfile value "$task_temp/cron-secret" '$value | length >= 16 and length <= 512 and test("^[!-~]+$")' >/dev/null || die 'CRON_SECRET is not a safe HTTP header value; the existing secret has not been changed.'

missing_apis=()
for api in cloudscheduler.googleapis.com cloudtasks.googleapis.com; do
  api_enabled "$api" || missing_apis+=("$api")
done
if [[ ${#missing_apis[@]} -gt 0 ]]; then
  change_cloud services enable "${missing_apis[@]}" --project="$PROJECT"
fi
read_cloud "$task_temp/queues.json" tasks queues list --project="$PROJECT" --location="$queue_region" --format=json
if ! jq -e --arg name "$queue" 'any(.[]; (.name | split("/")[-1]) == $name)' "$task_temp/queues.json" >/dev/null; then
  change_cloud tasks queues create "$queue" --project="$PROJECT" --location="$queue_region" --min-backoff=5s --max-backoff=300s --max-retry-duration=86400s --max-attempts=100
elif jq -e --arg name "$queue" 'any(.[]; (.name | split("/")[-1]) == $name and .state == "PAUSED")' "$task_temp/queues.json" >/dev/null; then
  change_cloud tasks queues resume "$queue" --project="$PROJECT" --location="$queue_region"
fi
change_cloud tasks queues add-iam-policy-binding "$queue" --project="$PROJECT" --location="$queue_region" --member="serviceAccount:$runtime_account" --role=roles/cloudtasks.enqueuer

# Build an update dictionary, never --set-env-vars / --env-vars-file (which
# replace all environment variables). Secret references stay references.
jq -n --slurpfile service "$task_temp/service.json" --arg project "$PROJECT" --arg queue "$queue" --arg region "$queue_region" --arg url "$public_url" --arg type "$secret_type" --rawfile secret "$task_temp/cron-secret" '
  ($service[0].spec.template.spec.containers[0].env // [] | map({key: .name, value: (.value // "")}) | from_entries) as $old |
  {REACTION_TASKS_QUEUE: $queue, REACTION_TASKS_LOCATION: $region, PUBLIC_URL: $url} +
  (if ($old.GOOGLE_CLOUD_PROJECT // $old.VERTEX_PROJECT_ID // "") == "" then {GOOGLE_CLOUD_PROJECT: $project} else {} end) +
  (if $type == "missing" then {CRON_SECRET: $secret} else {} end) |
  with_entries(select($old[.key] != .value)) | {"--update-env-vars": .}
' >"$task_temp/run-flags.json"
if [[ $(jq '."--update-env-vars" | length' "$task_temp/run-flags.json") -gt 0 ]]; then
  change_cloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" --flags-file="$task_temp/run-flags.json"
fi

# Protect existing unrelated headers and authentication on a reused job.
header_flag=--headers
[[ "$job_exists" == false ]] || header_flag=--update-headers
jq -n --arg flag "$header_flag" --rawfile secret "$task_temp/cron-secret" '{($flag): {"Content-Type": "application/json", "X-Cron-Secret": $secret}}' >"$task_temp/job-flags.json"
job_command=create
[[ "$job_exists" == false ]] || job_command=update
change_cloud scheduler jobs "$job_command" http "$job" --project="$PROJECT" --location="$REGION" --uri="$job_uri" --http-method=POST --schedule='*/15 * * * *' --time-zone=Etc/UTC --message-body='{}' --attempt-deadline=180s --min-backoff=30s --max-backoff=300s --max-retry-attempts=5 --max-retry-duration=3600s --flags-file="$task_temp/job-flags.json"
if [[ "$job_exists" == true ]] && jq -e --arg name "$job" 'any(.[]; (.name | split("/")[-1]) == $name and .state == "PAUSED")' "$task_temp/jobs.json" >/dev/null; then
  change_cloud scheduler jobs resume "$job" --project="$PROJECT" --location="$REGION"
fi
read_cloud "$task_temp/verify-job.json" scheduler jobs describe "$job" --project="$PROJECT" --location="$REGION" --format=json
jq -e --arg uri "$job_uri" --rawfile secret "$task_temp/cron-secret" '
  .httpTarget.uri == $uri and .httpTarget.httpMethod == "POST" and .schedule == "*/15 * * * *" and .state == "ENABLED" and
  ([.httpTarget.headers | to_entries[] | select(.key | ascii_downcase == "x-cron-secret") | .value][0] == $secret)
' "$task_temp/verify-job.json" >/dev/null || die 'Scheduler verification failed; no live job was triggered.'
printf '%s\n' "Configured queue $queue ($queue_region), runtime permission, and Scheduler job $job (*/15 UTC)." \
  'Secrets were kept private. No manual cron run or Telegram test message was sent.'

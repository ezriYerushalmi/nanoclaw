# Robi Garmin integration

Garmin is an independent data connector. Normal agent conversations read Robi
PostgreSQL and do not require Garmin to be online. The native hourly activity checker is separate from full/manual wellness synchronization.

## Connector and authentication

External package: `@nicolasvegam/garmin-connect-mcp@1.1.1`, published commit
`40ff136999977800c92b428c70ddf3d1741f3b11`. It is independently installed under
ignored `data/garmin-connector/node_modules`; its source is not vendored.
`connector.ts` uses the package's MCP SDK over stdio and only read operations.
The connector's complete tool inventory is not registered with the agent.

Authentication is unchanged. The ignored mode-0600
`data/garmin-connector/.env` holds the account and macOS Keychain service name,
not the password. `keychain-poc.ts` retrieves the existing password without
printing it and passes it to the connector only in process memory. Existing
OAuth/session state stays under ignored, permission-protected
`data/garmin-connector/home/.garmin-mcp`. Never put account identifiers, credentials,
private exports or raw real-account fixtures in Git.

The prior read-only POC can still be run with the same command, without `sync`.
No authentication/setup changes are required.

## Migrate and manually synchronize

From the repository root:

```bash
/Applications/Docker.app/Contents/Resources/bin/docker compose \
  -f apps/robi-health/compose.yaml run --rm admin migrate

node --env-file=data/garmin-connector/.env --import tsx \
  apps/robi-garmin/keychain-poc.ts sync
```

The host connector normalizes results and invokes the existing Robi health
container's operator-only stdin importer. There is no new public ingestion API,
PostgreSQL host port, Garmin container or credential access for the LLM.
The importer resolves the existing logical user from local health configuration.

Optional local settings: copy `sync-config.example.json` to ignored
`data/garmin-connector/sync-config.json`. Defaults are 14 local days of health
and 30 days of activities. Windows are bounded to 1-90 days. Incremental sync
refreshes from the previous successful sync date with a three-day overlap,
clamped to the configured window, including a bounded catch-up after outages.
Run a wider explicitly configured manual import if an outage exceeded that window.
Daily dates use the logical user's IANA timezone, currently Asia/Jerusalem.

No LLM is involved in synchronization. Each resource commits transactionally.
Failures retain previous facts and last-success timestamps, record a concise
error code, and allow the other resource to continue. The CLI exits unsuccessfully
if any resource failed. Logs contain counts/status, not health measurements.

## Database

Reuses existing PostgreSQL, migrations, connection and users. Migration
`apps/robi-health/migrations/002_garmin.sql` creates:

- `garmin_daily_health`: unique logical user/local date; nullable measured metrics.
- `workouts`: unique user/source/external activity ID; normalized source metrics,
  compact provider JSONB and separately preserved explicit `user_overrides`.
- `workout_splits`, `workout_hr_zones`, `workout_sets`: optional useful detail.
- `garmin_sync_state`: per-user resource success/source/error timestamps.

No existing workout model existed. Original weight/water tables are unchanged.
Repeat imports upsert stable IDs and replace returned detail collections without
creating duplicates. An unavailable detail collection preserves existing detail;
a returned empty collection is authoritative. No second-by-second streams are
stored. Missing readiness and strength sets are valid, not sync errors.

Manual workout reconciliation requires a single candidate of the same sport,
within two minutes of the start time, and duration and distance both within 5%.
Without both comparable metrics or with multiple candidates, it does not merge.
A confident match preserves the workout ID and original manual facts. Subsequent
Garmin imports do not modify `user_overrides`. Reads return device values,
overrides and effective values separately. No new manual workout or correction
write tool is introduced in this phase.

## Agent tools and authorization

Four tools read only PostgreSQL:

- `get_recovery_status`: exact local day, recovery metrics and freshness.
- `get_recent_workouts`: bounded normalized workout history.
- `get_workout_details`: summary, splits, zones and optional strength sets.
- `get_training_status`: exact-day status/load/readiness and recent workout context.

Registration requires Robi's scoped WhatsApp policy and local workspace marker
`garmin-enabled`. The installed `robi-garmin-data` skill describes technical tool
use without duplicating SOUL. The read API resolves sender authority from original
mailbox messages using the existing protected local mapping, not model arguments.
Yael/other participants and mixed-sender interactions cannot query these private
metrics. Do not disclose cached owner metrics to another participant. An answer
requested by the owner in the WhatsApp group is visible to group members.

Missing today returns missing/null; yesterday is never substituted. A successful
sync older than two hours or a subsequent sync error is marked stale. Responses
also expose actual source timestamps. This is a freshness threshold, not a sync
schedule. Garmin training-status codes remain provider codes when their meaning
has not been independently verified.

## Verification and tests

```bash
node --import tsx --test apps/robi-garmin/service.test.ts
/Applications/Docker.app/Contents/Resources/bin/docker compose \
  -f apps/robi-health/compose.yaml run --rm --entrypoint bun \
  admin test --isolate /robi/tests
node node_modules/typescript/bin/tsc -p apps/robi-health/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p container/agent-runner/tsconfig.json --noEmit
```

Scoped interaction/registration tests use Bun in the existing agent image.
Fixtures are synthetic. Real integration verified initial import, repeated import
without duplicates, and all four read services after the connector exited.
No shared NanoClaw core, WhatsApp adapter or authentication changes. The activity checker uses the existing persistent NanoClaw scheduler.


## Hourly lightweight checker

Native schedule: `0 8-23 * * *`, timezone `Asia/Jerusalem`. That is 08:00,
09:00, through 23:00 inclusive, 16 scheduled checks daily. No overnight polling.
Robi's group timezone is set to Asia/Jerusalem so the native cron parser handles
DST; other task expressions are preserved and use this group timezone too.

Register/reconcile the single schedule from the host:

```bash
node --import tsx apps/robi-garmin/register-checker.ts <ROBI_AGENT_GROUP_ID>
```

Registration reuses a live `robi-garmin-hourly-*` series rather than creating one
on startup. More than one matching series fails closed for operator review. The
operator-only ignored `data/garmin-connector/checker.json` pins the authorized
group for host-side imports. It is not mounted into agent containers.

The pre-task gate runs `garmin-check-gate.ts` inside the task container and emits
one stable-ID system request into the native outbound mailbox. It returns
`wakeAgent:false`; no model call occurs for polling. Robi's scoped host extension
validates the original task/series/script and protected group ID, then invokes
the existing Keychain-backed host connector. No new service, port, cron daemon,
credentials in the container, or NanoClaw core seam is introduced.

Manual operator check:

```bash
node --env-file=data/garmin-connector/.env --import tsx \
  apps/robi-garmin/keychain-poc.ts check
```

This calls `get_activities({start:0,limit:10})` once, compares returned stable IDs
with PostgreSQL, and stops if all are known. Only unseen IDs fetch summary,
splits and HR zones; strength/unknown types also attempt optional exercise sets.
No high-resolution streams or wellness endpoints are queried. Counts report
logical activity endpoint requests; OAuth refresh/retries can add HTTP requests.

The first recent-page check can include older activities absent from an earlier
bounded import. These are imported with their actual dates, not claimed to have
happened today. This checker covers only the returned page; the manual bounded
sync remains the catch-up path if more than ten unseen uploads occur between
checks or an old upload is not in that page.

## Durable analysis handoff

Migration `003_workout_analysis.sql` adds `workout_analysis_events`. A newly
recognized Garmin ID and its unique per-workout event commit in the same
PostgreSQL transaction. The full/manual sync does not create analysis events.
The existing conservative manual-workout reconciliation and `user_overrides`
remain unchanged.

The host drains pending events into native one-shot task series named
`garmin-analysis-<event UUID>`. It checks active and closed task history; replay
uses the same ID rather than another task. A crash after PostgreSQL persistence
but before task creation leaves a pending event for the next checker invocation.
A crash after task creation uses the already-persisted task. Delivery completes
the event after a normal text message; silent completed turns are reconciled on
the next checker invocation. Failed native tasks retain their history/retry state
and are not silently recreated as a fresh announcement.

Analysis receives a compact PostgreSQL snapshot of the workout/details, recent
training, and current recovery/freshness. Existing SOUL, fitness profile and memory
supply coaching and known weekly-plan context. No generic detection message is
sent. A proactive task has no new user WhatsApp message to react to: it must not
react to an unrelated old message; useful text uses native delivery, otherwise
silence is appropriate.

Scheduler state lives in host-bound NanoClaw SQLite mailboxes. Events live in
Robi's PostgreSQL volume. Container/image recreation does not discard either.
Mac reboot preserves data, but execution requires NanoClaw and Docker Desktop
running; Docker Desktop automatic startup is a separate operator setting.
The stable event/task identity prevents routine duplicate coaching jobs; native
WhatsApp delivery retains its existing retry semantics, not a new exactly-once
external delivery guarantee.

Transient checker failures are recorded under `garmin_sync_state` resource
`activity_checker` and do not send infrastructure messages. Auth-required failures
have a separate error code for later operator notification. An out-of-hours
recovery of a delayed checker request skips Garmin polling while still permitting
pending analysis handoff. No LLM is used for detection or synchronization.

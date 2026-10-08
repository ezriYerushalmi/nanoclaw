# Robi structured health data - Phase 2

This is a local Robi application, independent of NanoClaw's platform database.
No shared NanoClaw core changes. It exposes only weight logging, water logging,
and today's status. Personality, methodology, routing, debounce, and responses
remain in the existing workspace and WhatsApp extension.

## Existing topology verified before installation

| Project  | PostgreSQL container / database / user                   | Port                            | Network                   | Volume                          |
| -------- | -------------------------------------------------------- | ------------------------------- | ------------------------- | ------------------------------- |
| SpellIt  | `spellit-postgres-1` / `spellit` / `spellit` (16-alpine) | host 5432 to internal 5432      | `spellit_default`         | `spellit_spellit_postgres_data` |
| OneCLI   | `onecli-postgres-1` / `onecli` / `onecli` (18-alpine)    | localhost 5433 to internal 5432 | `onecli_onecli`           | `onecli_pgdata`                 |
| NanoClaw | SQLite central and two SQLite mailboxes per session      | no PostgreSQL listener          | runner on existing bridge | installation-local `data/`      |

Compose labels identify the owners. SpellIt PostgreSQL is in Docker, not a
native host PostgreSQL process. Those services, configurations, and volumes
were not changed. OneCLI's PostgreSQL is gateway infrastructure, not the
NanoClaw platform database.

## Isolation and connection

`robi-postgres`: PostgreSQL 16, database `robi_db`, volume `robi_postgres_data`,
private internal network `robi_database`, internal port 5432, no published port.
`robi_db_admin` owns migrations; runtime role `robi_db_user` has SELECT on users
and SELECT/INSERT on event tables, no UPDATE/DELETE/DDL privileges.
`robi-health-service` shares the DB network and has a separate `robi_api` network.
The only published port is **127.0.0.1:18765**, the health API, not PostgreSQL.
The existing gateway-managed runner reaches `host.docker.internal:18765` without
changing its network or core spawn logic. Database passwords never reach the
agent. The service is intentionally local, with no remote/public API auth flow.
Access to local host files is an operator trust boundary, not a sandbox against
malicious software running as the operator.

The service reads only the Robi group's session directory (read-only) and its
workspace health configuration (read-only); it never writes NanoClaw's SQLite files.
Initialization copies the operator's sender/group mapping into the ignored,
host-owned `data/robi-health/trusted-whatsapp.json`, mounted read-only into the
service and outside the agent workspace. Later workspace edits cannot redefine
the service's acknowledgment owner. Identity changes require an explicit operator
update to this trusted mapping.
The API accepts only an operation, tool input, session reference and active final
message reference. It opens the actual active-turn state and verifies all source
rows against original inbound messages. Identity is derived from the original
sender, channel and configured stable group ID, not from copied active-state
sender fields, `acknowledge`, a tool argument, or a model declaration.
Participant turns can read Ezri's status in this already shared coaching group;
they cannot write. There is no delegation. Calls outside an active scoped turn
fail closed, including scheduled/system turns.

## Runtime and data-access layer

The installed NanoClaw image already includes Bun 1.4.0. Bun's built-in SQL
PostgreSQL driver supplies parameterized, typed queries and transactions without
adding dependencies or a new ORM. Strict TypeScript models, explicit repositories,
services, and tools keep SQL out of agent tools.

- `src/db/`: pooled connection, bounded startup retry, checksum-verified migration runner.
- `migrations/001_health.sql`: users, weight_entries, water_entries, indexes, permissions.
- `src/repositories/`: explicit user, weight, and water repositories.
- `src/services/`: unit normalization, status and local-day queries.
- `src/tools/`: HTTP tool boundary; no SQL.
- `src/runtime/`: trusted source resolution against the original read-only mailboxes.
- Runner `modules/robi-whatsapp/health-tools.ts`: three MCP tools, scoped opt-in.
- `agent-skill/SKILL.md`: technical tool-use instructions, installed into the existing
  Codex per-group `.codex-shared/skills/robi-health-data/` directory; no persona duplication.

UUID logical users have external keys independent of WhatsApp and NanoClaw IDs.
The bootstrap creates Ezri with Asia/Jerusalem timezone. It imports no weight:
profile values without measured timestamps are not historical measurements.
Weight uses numeric(6,2); water uses integer milliliters and individual events.
All timestamps are timestamptz, supplied from JavaScript ISO UTC instants.
Optional event times must contain Z or an explicit offset; unknown times use now.
Today uses PostgreSQL's IANA timezone conversion to successive **local midnights**,
including 23/25-hour Israeli DST days; it is never a fixed UTC offset.

### Idempotency

Each event key is SHA-256 of configured conversation, selected original inbound
message ID and operation; unique `(user_id,idempotency_key)` prevents retry inserts.
Transactions serialize writes per logical user. Retries return the original event
including its timestamp; conflicting amount or explicit timestamp returns
`idempotency_conflict` instead of overwriting history. For a single report spanning
several messages, the source defaults to the final message. For distinct reports
within the same burst, optional `sourceMessageIndex` selects a 1-based original
message position. The service validates that position within the current burst
and derives its original ID; it never accepts a user/sender/JID from the model.
Thus 500, 250, 500 ml in three messages can remain three events even in one turn.
The same operation/source message is one event; conflicting calls require
clarification rather than silent replacement. Reaction targeting remains the
final message through the unchanged WhatsApp extension.

### Local configuration

`groups/health-coach/health-data.json` is ignored, with the shape of
`health-data.example.json`. It contains the logical user, API URL, `waterGlassMl`
and `waterTargetMl`. It contains no DB password. The confirmed profile water
target is 3000 ml; glass size is unset. Set `waterGlassMl` only after an explicit
user confirmation, then restart the health service to reload configuration.
Without it, glass inputs return a typed clarification, while ml/liter work.
`whatsapp-interaction.json` remains the existing local sender/group mapping.
No profile Markdown is parsed at runtime. Database identity is never a phone number.

## Commands (from repository root)

Initialization generates local random credentials without printing them; reuse
existing values on subsequent runs. Resolve the group/session directory with the
native CLI. Replace placeholders; never put private IDs into tracked examples.

```sh
node --import tsx apps/robi-health/src/init.ts \
  groups/health-coach data/v2-sessions/<ROBI_AGENT_GROUP_ID> \
  nanoclaw-agent-v2-<INSTALL_SLUG>:latest

# Start database, migrate explicitly, bootstrap logical user, then start API.
docker compose -f apps/robi-health/compose.yaml up -d postgres
docker compose -f apps/robi-health/compose.yaml run --rm admin migrate
docker compose -f apps/robi-health/compose.yaml run --rm admin seed
docker compose -f apps/robi-health/compose.yaml up -d health
docker compose -f apps/robi-health/compose.yaml ps

# Stop only Robi; named volume is preserved. Never add -v to down.
docker compose -f apps/robi-health/compose.yaml stop

# Real PostgreSQL tests use ONLY separate robi_health_test database.
docker compose -f apps/robi-health/compose.yaml run --rm --entrypoint bun \
  admin test --isolate /robi/tests
node node_modules/typescript/bin/tsc -p apps/robi-health/tsconfig.json --noEmit

# Inspect schema and non-sensitive counts through the administrative container.
docker compose -f apps/robi-health/compose.yaml exec postgres \
  psql -U robi_db_admin -d robi_db -c '\dt'
docker compose -f apps/robi-health/compose.yaml exec postgres \
  psql -U robi_db_admin -d robi_db -c 'SELECT count(*) FROM weight_entries;'

# After a glass-size/target setting change:
docker compose -f apps/robi-health/compose.yaml restart health
```

Restart the Robi group through `ncl groups restart --id <ROBI_AGENT_GROUP_ID>`
after installing the runner import; its next user message starts a fresh runner.
No container build or dependency change is needed: runner source is mounted live.

## Verification and backup readiness

Unit/integration tests cover real schema/migrations, events, history, latest weight,
water totals, DST boundaries, forbidden identity arguments, original-source
authority, unknown glass size, conversion, retries, status and least-privilege roles.
`tests/restart.ts before/after` verifies a test fixture across an actual PostgreSQL
restart; no sample health values are written to the production user.

For an operator-controlled future backup, standard `pg_dump -Fc -U robi_db_admin
-d robi_db` inside `robi-postgres` can write to an ignored private local backup
directory. Restore into a separate test database to verify backups. No automatic
or cloud backup is configured. Docker volumes are persistence, not backup.

## Future separation

Domain repositories have no embeddings, vectors, keywords or chat-history
dependency. Future immutable messages/conversations should retain original
source records; separate derived metadata, summaries and semantic memories can
refer to them. Current `source` and `source_message_id` provide provenance without
an FK to NanoClaw or a premature conversation table. Structured confirmed facts
stay in domain SQL tables. Choose a semantic retrieval engine separately later;
do not put every WhatsApp message directly into RAG.

Phase 3 can add confirmed meals/items and protein tracking using the same
authority, timestamp, provenance and migration boundaries. Meal classes and food
image analysis remain future work. None are implemented here.

## Phase 2 verification record

- 13 real PostgreSQL/authority integration tests passed (separate test database).
- 63 native runner/Robi tests passed, including unconfigured tool registration.
- 8 host WhatsApp/visibility tests passed.
- Configured-runtime MCP registration and API connectivity passed.
- Host, runner, and health-app strict TypeScript checks passed.
- Repeated migrations passed, and a test fixture survived an actual PostgreSQL restart.
- Both Robi containers are healthy. Original SpellIt/OneCLI container IDs and
  start times are unchanged. NanoClaw CLI is responsive and connection logs show
  WhatsApp connected. No live WhatsApp test messages or fake production health
  measurements were sent. The coaching runner was idle/stopped; its next inbound
  message loads the new tools and skill.
- The real user was bootstrapped with zero weight/water events. Target is 3000 ml;
  glass size remains unknown.
- Nothing was committed, staged, or pushed. Work remains on `robi`; the unrelated
  root `.gitignore` modification predates this phase and is excluded.

### Exact Phase 2 source file manifest

```text
apps/robi-health/.env.example
apps/robi-health/.gitignore
apps/robi-health/README.md
apps/robi-health/agent-skill/SKILL.md
apps/robi-health/compose.yaml
apps/robi-health/health-data.example.json
apps/robi-health/migrations/001_health.sql
apps/robi-health/src/cli.ts
apps/robi-health/src/config.ts
apps/robi-health/src/db/connection.ts
apps/robi-health/src/db/migrate.ts
apps/robi-health/src/domain.ts
apps/robi-health/src/init.ts
apps/robi-health/src/repositories/users.ts
apps/robi-health/src/repositories/water.ts
apps/robi-health/src/repositories/weight.ts
apps/robi-health/src/runtime/authority.ts
apps/robi-health/src/services/day.ts
apps/robi-health/src/services/health.ts
apps/robi-health/src/tools/http.ts
apps/robi-health/tests/authority.test.ts
apps/robi-health/tests/health.test.ts
apps/robi-health/tests/restart.ts
apps/robi-health/tsconfig.json
container/agent-runner/src/modules/robi-whatsapp/health-registration.test.ts
container/agent-runner/src/modules/robi-whatsapp/health-tools.test.ts
container/agent-runner/src/modules/robi-whatsapp/health-tools.ts
container/agent-runner/src/modules/robi-whatsapp/tools.ts
```

Ignored local files include `apps/robi-health/.env`,
`groups/health-coach/health-data.json`, `data/robi-health/trusted-whatsapp.json`,
and the installed per-group skill under `data/v2-sessions/`. Database contents
are in `robi_postgres_data`, never Git. The existing WhatsApp auth and real
interaction configuration remain ignored and unchanged.

Suggested commit split: (1) app schema, repositories, services, runtime authority,
Docker setup and PostgreSQL tests; (2) scoped runner health tools and their tests;
(3) documentation, safe examples and tool-use skill/initializer integration.
Keep initialization runnable at each commit by committing its skill source with it.
Do not include real configuration, test data, or the unrelated root ignore diff.

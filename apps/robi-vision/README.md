# Robi native image understanding

Provider: existing Codex app-server. Current observed model: gpt-6-astra.
The installed models_cache.json declares text/image input. No provider/model
configuration is changed. No additional dependencies, OCR, RAG, storage service,
or meal/workout database tables are added.

## Path and lifecycle

The installed WhatsApp adapter previously downloaded images into host
`data/attachments/` and emitted `attachments/<filename>`. That path was not
mounted into session containers, and the native inbox copier only stages inline
`data`. Images therefore appeared as inaccessible filenames.

The WhatsApp overlay now emits validated JPEG/PNG/WebP bytes through the native
inline attachment mechanism, preserving original source-message ID, detected
MIME and a UUID media ID. NanoClaw's unchanged session manager writes the original
into the ignored per-session `inbox/<message-id>/<uuid>.<extension>` and removes
inline bytes from the mailbox record. No resizing degrades screenshot numbers.
Existing files in the old host attachment directory are untouched.

Captions stay in their original message. Reply context now preserves the quoted
message reference and available textual preview. A quoted image can be resolved
from a retained same-group inbound record that has a staged local file. Older
images saved only through the broken host-path transport are unavailable to the
agent; resend them when needed. No quoted-image network fetching is added.

## Scoped tools and validation

Only a configured Robi workspace with `vision-enabled` exposes:

- `get_image_burst`: loads all current/quoted staged images together and returns
  native MCP image blocks to the existing model, with trusted original provenance.
- `validate_image_analysis`: accepts schema-constrained extraction from that model,
  validates it with existing Zod, verifies media IDs against the current context,
  and returns typed data. It does not call another model or persist health facts.

Schemas are in `container/agent-runner/src/modules/robi-whatsapp/vision/schema.ts`.
Food includes identified foods, estimated amounts/grams, nutrition ranges,
classification/confidence, visible food-source flags and uncertainty notes.
Workout includes optional sport, time/distance, distinct pace units, speed,
heart rate, elevation, training effect, splits, strength exercises and additional
visible scalar metrics. Other/unknown/fitness_related have description/confidence
without food/workout fields. Strict objects reject unexpected fields. Numeric
ranges and confidence are validated; validation cannot prove visual accuracy.

Methodology remains in nutrition-method.md and fitness-profile.md. The technical
skill requires honest estimates, omission of unseen values, latest explicit user
corrections, and concise SOUL-compliant responses. No model-derived classification
is considered an authoritative database fact. No meals/workouts are stored.

## Bursts, responses and authority

The existing per-group/per-sender 3000ms quiet window, message boundaries and order
are unchanged. Multiple images are supplied in one tool result. Realpath containment,
format/size checks and a 20-image ceiling prevent arbitrary file reads; unavailable
images fail safely. Source identity is read from original inbound records, not copied
active-state fields or model arguments. Yael can converse but existing database
write authorization remains owner-only. Neither image tool writes health data.

After local images load, get_image_burst emits one native 👀 reaction on the final
burst message, without typing. The final reaction updates that same message.
Existing final text delivery and typing immediately before actual text remain
unchanged. The validation tool does not create user-visible text or reactions.

This is one agent turn per burst, not necessarily one inference HTTP request.
The current provider starts text turns; the native tool cycle commonly needs about
three model inference requests (request images, inspect/submit structured extraction,
then respond), plus local tool execution. No second provider or analysis agent is
used. Direct initial image inputs/outputSchema would require further provider
integration; this phase leaves shared provider/runner core untouched.

## Enable and verify

From the repository root:

```bash
node --import tsx apps/robi-vision/init.ts \
  groups/<robi-workspace> data/v2-sessions/<robi-agent-group>/.codex-shared
pnpm run build
```

Restart the installed host service to activate the WhatsApp overlay. Next inbound
message starts a fresh agent with the copied skill and opt-in marker. Do not commit
local workspace configuration, media, Codex state, or private IDs.

Verification completed: 26 runner/vision regression tests; 2 configured native
MCP registration checks; 9 host attachment/text/reaction tests; 13 PostgreSQL and
authority tests; host/runner strict typechecks and host build. WhatsApp reconnected
after restart. The real synthetic model probe did not complete because its target
agent container exited before execution. No live WhatsApp image-recognition test
has been claimed. The MCP test verifies actual image bytes across the native
protocol; the schema test verifies known workout data, not a model's OCR accuracy.

Manual checks: send a clear food photo plus caption/follow-up within 3 seconds,
a workout screenshot, a blurry screenshot, and a participant image. Confirm one
turn per burst, honest metrics, appropriate reaction/text, and no health writes.

## Files in this phase

- `apps/robi-vision/init.ts`
- `apps/robi-vision/agent-skill/SKILL.md`
- `apps/robi-vision/README.md`
- `src/channels/whatsapp-image.ts`
- `src/channels/whatsapp-image.test.ts`
- `src/channels/whatsapp.ts` (installed adapter overlay)
- `container/agent-runner/src/modules/robi-whatsapp/vision/media.ts`
- `container/agent-runner/src/modules/robi-whatsapp/vision/schema.ts`
- `container/agent-runner/src/modules/robi-whatsapp/vision/tools.ts`
- `container/agent-runner/src/modules/robi-whatsapp/vision/vision.test.ts`
- `container/agent-runner/src/modules/robi-whatsapp/vision/registration.test.ts`
- `container/agent-runner/src/modules/robi-whatsapp/tools.ts` (scoped registration)
- `container/agent-runner/src/modules/robi-whatsapp/mailbox.ts` (image-review reaction)

Local only: Robi vision-enabled marker, copied per-group Codex skill, installation
upgrade-state marker. Earlier uncommitted Phase 2 and mailbox recovery changes
remain intact. Nothing is committed or pushed.

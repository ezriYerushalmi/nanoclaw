# Robi WhatsApp interaction overlay

Enabled by `/workspace/agent/whatsapp-interaction.json` in a selected agent workspace.
No file means the original native mailbox instance is returned unchanged. The file
contains `platformIds`, `acknowledgeSender` and `debounceMs`; no identities are baked
into the shared runner. Sessions already isolate mailbox state by conversation.

The installed mailbox composition wraps SqliteAgentMailbox. Pending messages are
read using the configured native page limit and stored as durable held rows in the
existing outbound session state store. Processing claims let subsequent normal
pages be read; they do not invoke the provider. Rows keep IDs, sender, timestamps,
media and boundaries. A mature sender burst is selected after the final arrival
has been quiet for debounceMs. A burst can span native read pages and is delivered
as one logical turn. Other senders stay held for their own turn.

The generic turn-policy seam begins a selected turn, prevents follow-up injection,
and finishes after native parsing and corrective retries. The mailbox stages
current-group text/reaction writes and exposes them to the native parser's delivery
ledger. Finalization emits one coherent text, otherwise one reaction on the last
message, otherwise silence only after explicit human-conversation classification.
An owner interaction with no decision receives the deterministic eyes reaction.
Model judgment still determines whether a conversation is human-to-human.

The separately registered silence tool is exposed only in opted-in workspaces.
It stores an outcome, never user facts. Message visibility is native group
membership; data authority is defined in SOUL.md. Do not grant group participants
admin roles merely to allow their messages into context.

Host overlay: src/modules/robi-whatsapp/policy.ts selects configured JIDs. The
WhatsApp adapter suppresses early typing only for these JIDs, and uses native
composing presence immediately before committed text. Original WhatsApp keys and
local receipt times are ordinary inbound metadata. Recent keys are recovered via
existing session mailbox history after a host restart (100 rows, up to 8 sessions).
No auth, routing, text notification flags, tables or separate persistence system.

Replay points after an upstream update:

- Preserve this module and the host policy module.
- Apply the generic turn-policy registry + poll-loop lifecycle calls.
- Wrap the selected mailbox in mailbox/compose.ts; load tools via modules/index.ts.
- Reapply the WhatsApp adapter overlay and helper files.
- Run extension, native parser/retry and channel tests before service restart.

Configuration example: `whatsapp-interaction.example.json` contains placeholders only.
For a new installation, replace the placeholders and save the result as
`groups/<agent-folder>/whatsapp-interaction.json` on the host. The group identifier
is WhatsApp's stable group ID; the owner phone uses international digits without
`+`. Do not overwrite an existing working configuration with this example.
The example is documentation and is never loaded by the runtime.

Keep the real configuration, agent profiles, session databases, WhatsApp auth,
and logs local. Existing repository ignore rules exclude `groups/`, `data/`,
`store/`, `logs/` and `.env` files. Do not force-add these paths.

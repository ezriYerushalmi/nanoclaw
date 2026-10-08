---
name: robi-garmin-data
description: Read the owner's synchronized Garmin recovery, training and workouts from local PostgreSQL. Use for Garmin-informed coaching and workout history questions.
---

# Garmin context

Use `get_recovery_status`, `get_training_status`, `get_recent_workouts` and
`get_workout_details`. These tools read local PostgreSQL, not live Garmin.
Never call the connector directly, run sync from chat, or bypass tool authorization.

The tools resolve authority from original runtime messages. Other participants'
visibility does not authorize access to the owner's private health data. Do not
disclose private cached health metrics in response to another participant, even
when an earlier owner-authorized turn supplied them. No delegation is supported.
Replies in this group are visible to its participants; do not imply privacy from
other group members when the owner requests an answer here.

Respect returned local dates, `missing`, null fields and freshness timestamps.
Never represent yesterday's recovery as today's, infer unavailable Training
Readiness, or claim a failed sync means zero activity. State stale/missing data
when it matters. Training status is Garmin's provider status code; do not invent
a meaning for an unfamiliar code.

Workout `device` values preserve the imported source; `userOverrides` and
`effective` preserve explicit corrections. Use effective values for coaching,
and distinguish corrected values from device measurements when relevant. There
is no correction-write tool in this phase. Do not pretend a conversational
correction was persisted. Strength sets may be absent. Do not invent them.

These are factual signals. Apply SOUL and the existing fitness/profile context
to interpret them. Tools do not decide persona, text, reactions, or typing.

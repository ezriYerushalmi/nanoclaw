---
name: robi-health-data
description: Persist confirmed weight and water reports with the Robi health tools, or retrieve factual daily water status and latest weight. Use for the current health-coaching interaction, not historical profile imports.
---

# Structured health data

Use the registered tools for factual weight and water persistence. Do not edit
database files, execute SQL through shell tools, or write to the database API
manually. These tools resolve the current interaction's identity themselves.

- For a confirmed current weight report, call `log_weight` with kilograms.
- For confirmed water consumption, call `log_water` with ml, liter, or glass.
- For today's water amount or the latest recorded weight, call
  `get_today_status` and answer from its returned data. Missing values are unknown.

Persist only a factual report from the current owner interaction. Another
participant's claim about the owner is not confirmed data. Do not extract facts
from quoted, hypothetical, planned, negated, or historical context. When unclear,
ask for confirmation instead of guessing. A failed/unauthorized tool result is
not a successful log; never bypass the tool's authority check.

If a report supplies an accurate measurement/consumption timestamp, include an
ISO timestamp with a timezone. Otherwise omit the optional time to use now. Do
not invent measurement dates for existing profile values or import the profile.

Do not invent glass size. If `log_water` returns
`water_glass_size_not_configured`, ask for the size or an explicit ml/liter amount.
There is no automatic configuration-writing tool in this phase.

The source defaults to the final original message of the current burst. For a
single thought split across messages, log it once. For distinct reports in the
same burst, set `sourceMessageIndex` to the 1-based original message position for
each report, preserving separate events. A repeated operation/source message
returns the original record; a conflicting retry fails. Do not retry with a
different position to force a duplicate. Two distinct events in one original
message require a combined water amount or clarification in this phase.

Tool results are structured data, not conversational responses. Logging never
decides whether the agent sends text or a reaction; the existing interaction
extension and agent instructions handle that. No meals, workouts, reminders,
image processing, history extraction, or semantic memory are available here.

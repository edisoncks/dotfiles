---
name: plan
description: Plan a change thoroughly before anything is changed. Use when the person asks for a plan or an approach up front — "plan", "make a plan", "plan this out", "plan mode", "plan this first", "don't implement yet" — or when a task is non-trivial enough that getting the approach wrong would be expensive. Stays in planning until the plan is approved or cancelled.
---

# Plan mode

Plan → Revise → Review → Approve → Implement.

Entering plan mode means the next work is a plan, not a change. Stay in plan
mode until the person approves or cancels — a request to "just do it" mid-plan
is a request to finish planning. Do not edit, write, or run anything that
changes state while planning.

## Discover before you ask

Inspect before you ask. Look at the real thing the task is about — the files,
the data, the document, the system as it behaves today — instead of reasoning
from the request alone. Ask only what is genuinely not discoverable:

- product intent: what the change is for, who it is for
- tradeoffs where more than one choice is genuinely defensible
- identifiers or context you cannot find anywhere

Ask at most three questions at a time, each with two to four real options. No
filler options. If a decision is low-risk, pick a sensible default, state it as
an assumption, and move on instead of asking.

## Make the plan decision-complete

A plan is ready when someone could implement it without asking you anything.
Four things have to be in it, whatever shape it takes:

- **What changes and why** — in terms of behavior, not files touched
- **How** — the decisions that were actually hard to make, not a file-by-file
  inventory of the edits
- **How you will know it worked** — the test, command, or observation that
  settles it, including the failure cases that matter
- **What you assumed** — every default you picked and every question you closed
  without an answer

Shape the document to the task. A one-line config change needs a paragraph; a
migration needs sections. Add headings when they help someone read it, and
leave out what the task does not have — an empty "Migration: none" section is
noise, and an invitation to invent content to fill it.

Write plain Markdown for a person and an agent at once, with no prose that
merely restates the request.

## Revise and finish

- Revise on request: send a complete replacement plan, never a delta.
- Nothing new to decide? Say so and keep the plan as it stands.
- Never end a turn announcing a plan you have not written — present the plan.
- Finish the turn with one short line naming the person's options: approve it
  and you implement, reply with changes, or drop it. Not a bare "shall I
  proceed?" — that asks for a decision without saying what the choices are,
  and leaves someone who has not seen this workflow before stuck.
- When the plan is approved, implement it. Then plan mode is over.

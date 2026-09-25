# Agents and AI

Read this when you touch anything a model or an automation does: drafts, the Anthropic gate, `askClaude`, workflows, or system actors.

## Rules
- **Refuse money by absence: `AGENT_EXECUTORS` has no executor for any `needsHuman:"always"` tool.** That means
  record_gift, refund, create_pledge, change_subscription and issue_receipt. `build97-agent` asserts the
  tool table and executors agree both ways; never add a "guarded" money executor. (BUILD-97)
- **Every agent instruction defaults to `AUTH_DRAFT`; `AUTH_SEND` is her signature on one instruction, and
  money never gets it.** The run path currently writes `sent=0` unconditionally. (BUILD-97)
- **Show the plan before the run, and refuse a plan that names a tool she did not sign for.** Do not trim it,
  or she runs a plan she did not read. (BUILD-97)
- **Route every agent write through `agentWrite`.** `agent_writes` keeps before/after so undo restores from
  `before` for 30 days, never by overwriting the whole row and undoing a human's later edit. (BUILD-97)
- **Stamp non-human writes with a system identity.** `AGENT_ACTOR` (`system:agent`), `system:workflow:<recipe>`,
  `system:stripe-webhook`, `system:auto`; never null. (BUILD-75, BUILD-97)
- **Hand the model rows Steward selected, never a database handle, SQL, HTTP or a route.** `agentReadPeople`
  is the whole surface: org-scoped and capped. (BUILD-97)
- **Put every Anthropic call behind `aiGate(orgId)`.** `ai_no_key` means the control is absent (503, never
  500); `ai_disabled` is the org's Settings switch (`orgs.ai_enabled`, undefined reads as ON). The agent adds
  `agentGate` for pause. (BUILD-96, BUILD-97)
- **Check the gate after the org-ownership check.** A cross-tenant probe must get 404, not 503. (BUILD-99)
- **Build the gate before `new Anthropic()`.** The constructor throws without a key. (BUILD-99)
- **Any new feature that sends org data to Anthropic joins the one disclosure:** steward-data-handling.md, the
  agreement's subprocessor table, the Settings line and the same gate. (BUILD-96)
- **Assert AI safety properties without a key.** Legs that need a key skip by name, because a property that
  needs a paid key goes unchecked. (BUILD-96, BUILD-97)
- **Give model output schemas no numeric field; Steward renders every figure from rows.** Every sentence cites
  a row it was handed or is dropped AND counted, and the page says how many. (BUILD-99, BUILD-100)
- **Refuse capacity language and outcome claims whatever they cite; send a numeric rule through
  `shared/thresholds.js`.** A document row says Steward has NOT read the file. (BUILD-99, BUILD-100)
- **The model transcribes and Steward does the arithmetic.** A cheque amount fills in only when box and line
  agree to the cent; the schema cannot express a fund, donor, confidence or resolved amount. (BUILD-95)
- **Never ask a model how confident it is.** Ask for independent evidence and compare it. (BUILD-95)
- **Use strict tool use (`additionalProperties:false`, every field required and nullable) for model output.**
  (BUILD-95, BUILD-97)
- **Keep models off the sequence send path and out of merge fields.** Personalization is her data and her
  per-track copy. (BUILD-94)
- **Steward never sends a draft.** Thank-you drafts, tribute notices, `threads.draft_note` (pledge,
  membership), `agent_drafts` and `milestone_drafts` wait for a human; `note_reminders` store facts, never
  note text. (BUILD-88b, BUILD-98, BUILD-101)
- **Thank-you drafts lift her greeting and sign-off verbatim and nothing else; one per gift.** No draft for a
  small pledge payment, anonymous, deceased/do-not-contact or sample donor. (BUILD-88b)
- **Hand a drafting module only what it may state.** The tribute notice gets no amount, so it cannot state one.
  (BUILD-98)
- **Sample, deceased and do-not-contact people generate no drafts or work** (`getDraftFor` returns null on
  `is_sample`). (BUILD-83, INCIDENT 2026-09-22)
- **AI stays invisible.** No chat surface; labels read "Suggest"/"Suggested"; client AI streams through
  `/ai/stream` via `askClaude` (= `streamAI`). (Strategic pivot)
- **Fire workflows only on new live events; never call `fireWorkflows` from an import, backfill or migration.**
  The lapse sweep fires only when the lapse happened while the donor was live in Steward. (BUILD-25)
- **Workflow recipes ship disabled.** Only `provisionNewOrgWorkflows` turns on `instant_gift_thanks`, and only
  at registration. (BUILD-13, BUILD-36)
- **Recipes added since BUILD-76 may not email a donor, and automated transactional donor mail does not
  grow without a deliberate decision.** Pinned in `workflows-e2e` §B76. (BUILD-75, BUILD-76)
- **Reserve the run row first (`ON CONFLICT (workflow_id, dedup_key) DO NOTHING`), keyed on the event's
  natural cycle id, and wrap each action so one failure does not abort the rest.** (BUILD-13)
- **Fire workflows fire-and-forget from webhooks; `recurring_failed` fires only on a new failure cycle.**
  Recipe #1's day-0 send advances `dunning_step` so dunning does not also send. (BUILD-13)
- **When automation gives up, hand over to a human with a thread, never silence.**
  `openSustainerLapseThread` opens one when the dunning cadence is exhausted. (Recurring recovery 2026-09-11)
- **Do not build the visual workflow canvas without new direction.** (BUILD-13)

## Gotchas
- **An outcome-claim filter that only refused uncited lines had no teeth.** Prove a refusal fires on a line
  that DOES cite something. (BUILD-100)
- **The donor profile auto-fires a "next move" stream on open.** Catch a failed stream in the panel; whether
  to fire only on press is Jonathan's call. (BUILD-98)
- **Production has no `ANTHROPIC_API_KEY` yet.** Both Anthropic features are absent, not broken, until it is
  set with a spend cap (MANUAL-STEPS). (BUILD-96)
- **`notify_owner` on an owner-less donor falls back to the ED and records `assignedFallback:true`.** Do not
  drop the alert. (BUILD-25)

## Where the code is
- `aiGate` / `agentGate` (server.js) — the one gate in front of Anthropic
- `shared/agentShape.js` `AGENT_TOOLS` — the closed tool set and its `needsHuman` column
- `AGENT_EXECUTORS`, `agentWrite`, `agentReadPeople`, `AGENT_ACTOR` (server.js); `/agent/*` routes
- `shared/briefShape.js`, `shared/grantOutline.js`, `shared/thresholds.js`, `shared/chequeRead.js`
- `shared/draftNote.js` — thank-you drafts
- `WORKFLOW_RECIPES`, `fireWorkflows`, `processWorkflowSweeps` (server.js)
- `tests/build97-agent`, `build96-ai-gate`, `workflows-e2e` suites

---

The sections below were moved verbatim from the old CLAUDE.md. Build entries they cite live in `docs/HISTORY.md`.

## The line that does not get crossed (moved from the old CRITICAL WORKING RULES)

- **THE LINE THAT DOES NOT GET CROSSED (BUILD-75 C.2): agents read, draft and propose. A human commits anything that moves money or reaches a donor.** No automation, workflow, AI feature, or future agent may charge/refund/reprice money or send donor-facing communication without a human having committed that specific action — the existing transactional exceptions (receipt auto-send, failed-card dunning, recurring-change confirmations) are documented product decisions about TRANSACTIONAL mail made by humans in advance, and the set must not grow without the same deliberate decision. An agent emailing the wrong thing to a major donor costs a relationship built over ten years, and there is no undo for that.

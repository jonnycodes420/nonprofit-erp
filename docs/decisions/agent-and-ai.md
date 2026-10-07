# Agents and AI

Read this when you touch anything a model or an automation does: drafts, the Anthropic gate, `askClaude`, workflows, or system actors.

## Rules
- **The Agent reads the objects too (AGENT-3).** Under each person in a plan or a draft batch are their grants
  (and the next open milestone), memberships, open pledges, gifts to campaigns and giving pages, peer-to-peer
  pages and auction wins (`agentObjects`, org-scoped, those people only). Each row's id may be cited and each
  amount may be used; the run re-reads them before it checks citations. The find gained `grantReportDue`
  (days), `memberExpiresFrom/To`, `auctionWinner` (any/unpaid), `fundraiser=pending`, and Show me reads
  `closeness=cooling` for every way of saying gone quiet (gone, went, going quiet, stopped giving, slipping,
  drifting, haven't heard from). A draft carries its `purpose` (thank_you, membership_renewal,
  funder_update, auction_pay, p2p_approval); a funder update starts from the org's own `grant_funder_update`
  template. A grant task carries `grantId`; a peer-to-peer approval reminder is a task for staff, never a
  message to the fundraiser.
- **A task lives on the person, like a draft (AGENT-3).** `create_task` opens their Thread when nothing is open
  and writes one timeline line, in the run's transaction, both undoable.
- **Any plan size finishes (AGENT-3).** Past `PLAN_BATCH_SIZE` (10) found or named people, the plan call runs
  ten people at a time, three at once; a batch cut short refuses the whole plan. Drafting was already batched.
- **No silent fallbacks (AGENT-3).** Every attempted AI call that gives way to the non-AI path calls
  `recordAiFallback(orgId, surface, err)` (aiClient.js): one log line and one `ai_fallbacks` row. The nightly
  real-AI run fails on any fallback during the run whose reason is not `ai_off`.
- **A plan's status is one rule (AGENT-3).** `agentShape.planListState` decides the list word from the run's
  steps; `/agent/plans` sends it as `listState` and the screen shows that.
- **A "find" is a list, not a plan (AI-FIX).** "Steward, find donors in North Carolina I haven't reached out to"
  is read with the donor list's own filters (`agentFindPeople`: the templates, then the model's filter form
  whenever the templates could not read every word) and answered as a read: how many match, the filters in
  words, the first twelve names. Nothing is written. A leading "Steward," is ignored. The filters gained
  `state` (postal code; a record written "NC" or "North Carolina" matches, `shared/usStates.js`) and
  `noContactSince` (no call, meeting, email or stewardship logged since; "a while" is six months). A plan's
  `cannot` never talks about rows or data; one that does is replaced with a plain sentence.
- **The Agent does the work through the screens' own routes.** A real action (contact details, owner,
  stage, groups, household, a logged call/meeting/email, the next step, make a volunteer, a shift, hours,
  start or stop a journey, a free event's guest list, mark a gift thanked, propose a merge) is the route a
  person's click calls, made in-process as the person who confirmed (`agentCall.js`). The route's own
  checks apply, and `middleware/auditTrail.js` records each write with the Agent as actor ("Agent, approved
  by"), from a header signed with the server secret, and the instruction as the summary. No raw SQL for a
  new tool, and no new money path: a gift is still only prepared, and `recordGift` runs on the person's
  press. (AGENT-2)
- **Done means Steward looked.** Each executor reads its result back (the volunteer record, the group
  member, the plan, the interaction, the gift to the cent) and returns `{ failed }` with the reason when it
  is not there. `OUTCOME_FAILED` is never counted Done, and the plan list says "Failed" or "Partly done".
  The run holds no transaction (`withClient`): each step commits and is its own undo. (AGENT-2)
- **No substitutes.** The planner may not put a note, tag or task in place of an action a tool can do; a
  part no tool can do goes in the plan's one-sentence `cannot`. An identity-confirming task ("which Ada")
  is dropped at plan time; two matches ask before planning. Every id a step uses must come from the lists
  Steward gave the model (staff, groups, households, journeys, shifts, events, gifts), or the step is
  dropped. A strict tool schema allows only 16 nullable fields, so new fields are plain types. (AGENT-2)
- **"Every gift in a window" is planned from the gift rows, not by the model guessing.** One `create_task`
  per gift, due dates from `dueDays` resolved on the server in the org's calendar, behind the AI switch and
  the plan sheet. A plan cut off at `max_tokens` is refused (422 `plan_truncated`), never half-run. (PARITY-1)
- **Journeys start themselves, and still send nothing.** Triggers: first gift, first recurring gift, next
  gift, membership payment, becomes a prospect, joins a group, giving anniversary, birthday, and (JOURNEYS-3)
  membership ending or lapsed, monthly gift failed or cancelled, card expiring, volunteer hours, first
  event, grant awarded, peer-to-peer goal. Ready-made journeys for those arrive off; their email steps are
  review drafts from the org's own EMAIL-1 templates. A live trigger respects the journey's audience and `trigger_filters` (amount, fund,
  campaign). `cultivation_plans.trigger_event` with a unique index enrols a donor once per event.
  `tests/parity1-groups-journeys.test.js`. (PARITY-1)
- **Every model call goes through `aiClient.js`, and it asks the org's AI switch first.** `anthropicFor(orgId)`
  for Anthropic, `transcribeAudio(orgId, …)` for OpenAI. No `new Anthropic()`, `@anthropic-ai/sdk` or provider
  URL anywhere else in the server; `tests/fix12-ai-switch.test.js` fails on one and proves zero calls with the
  switch off. Off reads "AI is turned off for your organization" and takes the non-AI path where one exists. (FIX-12)
- **A workflow recipe never emails a donor. Steward drafts it; a person sends it.** Recipe emails land in
  `milestone_drafts` (Communications → Drafts to review: Send, Mark reviewed, Send all reviewed). A leftover
  `send_email` action drafts too. Pinned by `tests/fix12-recipe-drafts.test.js`. (FIX-12)
- **Every waiting item has a door, and the door is not a send.** `POST /agent/waiting/:kind/:id/
  approve` and `/skip` dispatch to the path that already exists for each kind, so there is no
  second place a thank-you can be marked sent. Approve on a thank-you logs the interaction in
  HER name, marks the gift acknowledged and closes the thank-you thread; on a renewal note it
  logs the drafted note and closes the thread; on a drafted note it marks it `approved`, which
  is deliberately not `sent` because Steward does not send it. A GIFT is refused by name: money
  is confirmed by running its plan, and a generic approve button over a queue is exactly the
  shortcut that rule exists to prevent. Skip takes an optional reason and never does the thing.
  `tests/fix6-approval.test.js` drives the whole queue with a live mail sink and asserts the
  sink stayed empty. (FIX-6)
- **Reading the queue is not acting on it.** `GET /agent/waiting` writes nothing, asserted
  directly: three reads leave every draft unsent, unskipped and unlogged. (FIX-6)
- **A draft varies with the record, and invents nothing.** `thankYouDraft` chooses its sentence
  from facts the CALLER passes: first gift, monthly, months since the last gift, how many came
  before, the fund or campaign. A fact it is not given is a fact the letter does not mention, so
  there is no "your continued support" for somebody whose history we were not told. This is the
  template layer and it works with the Anthropic key off: the audit's three identical thank-yous
  were the template, not the AI. (FIX-6)
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
- **A read needs no drafting.** Opening a report, finding a person, counting and explaining a number are
  routed without a model (`agentShape.readIntent`) and answered by `POST /agent/instructions` with
  `{ read }`, writing NOTHING (no instruction row, no run, no audit). A sentence that asks Steward to DO
  something to people (draft, send, tag…) is never a read. A count is the report's own (`reportHooks.run`,
  the handler `GET /reports/:key` runs). (FIX-2 D)
- **An instruction that names one person reads that person, and a first name names somebody.** `agentShape.namedIn`
  matches whole tokens in any case; a first name that is an ordinary word ("will", "grace") only when capitalised; a
  token inside a whole name she wrote belongs to that name. One name matching several records answers `{ which }`
  BEFORE any plan and writes nothing; `personId` (one per ambiguous name) must be one of those records. Never a plan
  with a "Confirm which" task. (FIX-3 B)
- **News about one person is recognised by Steward, not a model.** A gift she tells it about, and "X became a
  volunteer (and wants N hours a week)" (`agentShape.volunteerNews`): the Volunteer role (`mark_volunteer` →
  `markVolunteer`), her availability as a volunteer internal note (`note_volunteer` → `volunteer_notes`, never
  `interactions`), and one welcome draft. (FIX-3 B)
- **A plan's headline is one short sentence** (`compilePlan`): a clause per kind of step, a person named once, at most
  three clauses (the rest fold into "and take N more steps"), at most `HEADLINE_MAX` characters. The steps list carries
  the detail, and the withheld count is its own line. (FIX-3 B)
- **Say which gate is shut.** `agentShape.draftingState` orders the causes: no `ANTHROPIC_API_KEY` first
  (one line that names the key, never the organisation's permission), then `orgs.ai_enabled`, then pause.
  Drafting off says what still works, what drafting adds, and shows Turn on drafting to an admin (it opens
  Agent → Guardrails → Drafting) or names the admins to anyone else. `GET /agent/status` is the read. (FIX-2 D)
- **One drafting switch.** Settings → Data and Agent → Guardrails both write `PATCH /org/ai-settings`
  (admin only), which audits who turned drafting on or off (`fin_audit_log`, entity `ai_drafting`). (FIX-2 D)
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
  Recipe #1 now drafts rather than sends (FIX-12), so dunning's own day-0 email always goes. (BUILD-13)
- **When automation gives up, hand over to a human with a thread, never silence.**
  `openSustainerLapseThread` opens one when the dunning cadence is exhausted. (Recurring recovery 2026-09-11)
- **Do not build the visual workflow canvas without new direction.** (BUILD-13)

- **A drafted message claims only what the record holds.** Every model-written draft for a donor or a
  segment goes through `guardDraft` (shared/suggestionGuard.js, record from draftCheck.js): a video only
  when one is ready for that person and with its own link; links, gift amounts, dates, meetings and events
  from the record. A failed draft is the template sentence, never an edit of the model's words. (FIX-27)
- **The Agent finds people through the one filter.** `agentFindPeople` reads the WHO in her words with
  Show me's templates (the model's filter form only when a campaign, event or ask is named) and hands the
  model exactly those people. (FIX-27)

## Gotchas
- **A strict tool may hold at most 16 union-typed params and 24 optional ones**, or the API refuses the whole
  request (400). One nullable field per filter is the shape that breaks it; use one array of `{ field, value }`
  with an enum. `tests/fix29-tool-schemas.test.js` counts every tool, and a new `input_schema` must be listed
  there. A non-strict tool has no such limit (FIX-29)
- **A model call's catch that falls back silently hides a rejected request.** Log it; in the Agent, stop the plan
  with one sentence, because a failed find plans for everybody. (FIX-29)
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

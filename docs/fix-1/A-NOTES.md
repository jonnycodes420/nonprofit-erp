# FIX-1 A — Steward Agent: notes for the lead

## What changed, by file
- `shared/agentShape.js` — PLAN_SCHEMA is steps only (no `summary`, `reads`, `expectedCount`);
  `compilePlan`, `describeStep`, `scopeFromInstruction`, `preparedGiftFromInstruction`,
  `isGiftNews`, `parseAmountCents`, `methodFromInstruction`, `runIsLive`, `stateLabel`,
  `outcomeLabel`, `confirmLabel`, `formatCents`. The "record/log a gift" MONEY_PATTERN is gone:
  gift news is PREPARED, never refused and never recorded by the agent. `validatePlan` is
  unchanged except that a `record_gift` step Steward prepared itself (`state:"confirm"`,
  `preparedBy:"steward"`) passes; a model-planned money step is still refused.
- `shared/suggestionGuard.js` — taken from parked 98b9f93 unchanged (it passes fix1-walk §4).
- `shared/vocabulary.js` — `isOrganisationRow`, `orgWordFor`, `giverWordFor`; `giverCountWord`
  now uses the same `isOrganisationRow`, so a count and a name agree about a row.
- `routes/agent.js` — `agentReadPeople(orgId, { ids })` scoped; `agentNamedIn` (only rows whose
  name appears in her words come back); `agentBuildPlan` asks the model for STEPS over the named
  rows (or the org when none are named), withholds and counts uncited steps; the new
  `agentPreparedGiftPlan` (no model, no key needed); `agentRunPlan` executes exactly the plan's
  steps, records a per-step outcome in `agent_runs.actions`, and marks a broken run `failed`
  with `finished_at` so nothing sits on "Running…". The confirm route records a prepared gift
  through `recordGift` with `actor(req)` (idempotency key `agent:<instruction>:<step>`), fires
  `gift_received` like the gift form, then runs; a second confirm is 409 (atomic
  `status='planned'` check). Confirm no longer needs an Anthropic key (the run calls no model);
  pause still blocks it.
- New routes: `GET /agent/runs/:id`, `GET /agent/plans`, `GET /agent/waiting`,
  `POST /agent/instructions/:id/discard` (status `set_aside`). Route inventory regenerated
  (618 → 622).
- `server.js` — `recordGift` added to the agent module's ctx.
- Client: `components/Agent.jsx` (new; the five views), `lib/tabRegistry.js` (Agent in TABS,
  MORE_TABS, PRIMARY_NAV before reports; workflows out of TABS, MORE_TABS, MORE_NAV),
  `App.jsx` (renders Agent; `navigateTo("workflows")` → Agent → Workflows;
  `navigateTo("settings",{section:"agent"})` → Agent → Guardrails; ink room background),
  `Dashboard.jsx` (Home's agent box is one line that opens Agent with the text and plans on
  arrival), `Settings.jsx` (Steward's activity section + AgentActivity removed),
  `Workflows.jsx` (`embedded` prop, `data-testid="workflow-recipe"`), `Donors.jsx` (the
  Suggested panel holds the stream until it ends and renders only guardSuggestion's kept
  sentences, plainText, plus the dropped-lines sentence; prompts no longer ask for markdown).
- `scripts/build97-number-census.js` — `components/Agent.jsx` added to SURFACES (0 sites; total
  stays 413).

## At merge
- tabRegistry: C inserts "volunteers" before "reports" in PRIMARY_NAV too. The target (§12) is
  `dashboard,donors,fundraising,volunteers,agent,reports,finance`; A only inserted "agent".
- `tests/fix1-agent.test.js` added to CORE in tests/run-all.sh (after build97-*).
- Lint warnings stay 673 (Agent.jsx draws its sub-views as plain functions because this lint
  config counts every JSX-only component as unused).

## Not done / for later
- The confirm path fires `gift_received` but does not call `autoUnlapseOnGift` or
  `calcWealthScore` (they live in routes/crm.js, not server.js's ctx). A lapsed donor whose gift
  is confirmed in Agent stays in Lapsed until the next move; worth one line when crm.js exposes it.
- `turned_on_by_name` shows an email where the user row has none cached in the token (`actor(req)`
  falls back to email) — pre-existing.
- The HAVE_KEY legs of build97-agent (plan by model, Home refusal) cannot run here without
  `ANTHROPIC_API_KEY`; Home's ask now opens Agent and the refusal shows there (same testid).

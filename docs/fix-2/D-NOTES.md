# FIX-2 D — the Agent room, and the Agent you can turn on

Branch `fix-2-d` (worktree `~/steward-fix2-d`, API 5841, preview 4441, db `steward_fix2_d`).
Parts: Part 0 findings 6, 7, 8; Part C's Agent room; Part D.

## What changed

- **The room (finding 6, Part C).** `client/src/components/Agent.jsx` rebuilt to Direction 2: the cream
  sheet (`agent-desk`, `T.bg`) takes the room and the ink (App's existing `bgDark` for the agent tab) is
  only its margin. The five views are a tab row along the sheet's top edge (active = ink 700 + 3px
  emerald bottom rule, no filled block). Plans: ask bar, then the instructions down the left
  (`agent-instruction-list`, each with its run's state in brass when the agent is doing something), the
  open plan on the right as a white checklist panel with its confirm at the foot. The margin carries a
  brass line of what the agent is doing (`agent-activity`). No dark-green panel is left inside the room
  (no `T.green900/650/800`), no hex literal. At 390 everything stacks; the tab row scrolls inside the
  sheet, the page never scrolls sideways. Every existing testid kept.
- **Drafting off is not a dead end (finding 7, Part D).** `GET /agent/status` (new, read-only) returns
  `configured`, `enabled`, `paused`, `isAdmin`, `admins` (names of the org's active admins) and the
  pure `agentShape.draftingState(...)`: `reason` in cause order (`ai_no_key` → `ai_disabled` →
  `agent_paused`), `canNow`, `adds`, `where`, `canTurnOn`, `whoCan`. The sheet shows:
  - key missing: ONE line naming `ANTHROPIC_API_KEY` (`agent-key-missing`), no org switch, no blame;
  - org switch off: what Steward can do now, what drafting adds, and **Turn on drafting**
    (`agent-turn-on-drafting`, admin only) which opens Guardrails scrolled to the setting; anyone else
    sees "Only an admin can turn drafting on: <names>" (`agent-drafting-who`) and no toggle;
  - paused: a line linking to Guardrails.
  Guardrails has a Drafting section (`agent-drafting-setting`, toggle `agent-drafting-toggle` for
  admins) writing `PATCH /org/ai-settings` — the SAME endpoint Settings → Data uses. That endpoint now
  audits who turned drafting on/off (`fin_audit_log`, entity `ai_drafting`, the person's name).
- **Reads need no drafting (finding 8, Part D).** `agentShape.readIntent(text)` routes reads without a
  model: a report by name or by question (LYBUNT, SYBUNT, Retention, Top Donors, Giving Summary, 3-Year,
  Annual, Gifts by Fund), a count of LYBUNT/SYBUNT, "what does X mean", and "find <name>". Anything that
  asks Steward to DO something to people (draft/send/email/tag/thank…) is never a read.
  `POST /agent/instructions` answers a read with `200 { read }` and writes NOTHING (no instruction row,
  no run, no audit); the LYBUNT count is the report's own (`reportHooks.run` in routes/crm.js — the same
  handler and params `GET /reports/:key` uses). The sheet shows the answer (`agent-read`) with
  **Open LYBUNT** (`navigateTo("reports", { report: "lybunt" })`, the existing deep link) and
  **Keep it in Your reports** (`{ savedReport: "std:lybunt" }` — LYBUNT is already an everyday report in
  Your reports, always current; saving a second copy as a builder definition would be a second
  computation of the same number, so the offer opens the kept one). A read the router cannot place, with
  no key, answers 503 with a sentence that names the key (the `error` stays `agent_unavailable`; a new
  `reason: "ai_no_key"` says what it is). Pause still stops reads; the money refusal still comes first.
- Plan step details now use the shared display date ("Sep 25", not "25 September").

## Files outside Agent.jsx / routes/agent.js / shared/agentShape.js

- `routes/crm.js`: `reportHooks` (declared beside `giftHooks`, filled at the end of mount, exported) and
  the audit write in `PATCH /org/ai-settings`. Nothing else.
- `App.jsx`: **no change** (the ink margin is App's existing `bgDark` for the agent tab; navigation uses
  the existing `navigateTo("reports", { report | savedReport })` and `("donors", { selectDonorId })`).
- `audit/route-inventory.json` regenerated on a fresh db: +`GET /agent/status` (637 routes). The regen also
  picked up F's `resendWebhookLimiter` on `POST /resend/webhook`, which F's commit had not regenerated.
- `docs/decisions/agent-and-ai.md`: three rules (a read needs no drafting; say which gate is shut; one
  drafting switch).
- `tests/run-all.sh`: `fix2-d-agent` appended to CORE.

## For the lead

- Home (Dashboard.jsx, not mine) still says "Not enabled for this organization yet" on a server with no
  key, and `build97-agent` asserts that exact text on Home. Not changed (it is an existing assertion and
  Home is not this workstream's file). The honest wording is `agentShape.KEY_MISSING_SENTENCE`.
- Screenshots: `docs/fix-2/D/` (1440 and 390: key missing, drafting off as admin and as staff, a plan open,
  the LYBUNT read, the Guardrails setting). Regenerate with `FIX2D_SHOTS=<dir> node tests/fix2-d-agent.test.js`.
- The browser leg overrides `GET /agent/status` (Playwright route, service workers blocked) to show the
  key-set-but-switch-off state on a stack with no key; the toggle's write is real (DB + audit checked).

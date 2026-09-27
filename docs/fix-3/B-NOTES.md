# FIX-3 B — the Agent's ask (findings 4 Agent half, 5, 6, 7)

Branch `fix-3-b`, worktree `~/steward-fix3-b`, database `steward_fix3_b`, ports 5921/4521.
Suite: `tests/fix3-b-agent.test.js` (appended to CORE). Screenshots: `docs/fix-3/B/`.

## Why "ada" read 398 people (finding 5)

`agentShape.scopeFromInstruction` required a PERSON to be named by at least two tokens of
their name ("a person needs two tokens to be named"), and `agentNamedIn` only fetched
candidates whose WHOLE name was a substring of the instruction. "ada just became a volunteer"
names a person by first name alone, so the scope was `null`, and `null` means "the whole
file": "Read your 398 people". Lower case was not the cause (matching was already
case-folded); "volunteer" was not parsed as anything (there was no volunteer path at all, so
the sentence went to the model with every record).

The fix is the class, a person called by their first name:
- `agentShape.namedIn(text, people)` → `{ ids, ambiguous, groups }`. Whole tokens, any case.
  A person's first name names every record carrying it. Three guards: a first name that is an
  ordinary word (`WORD_NAMES`: will, grace, mark, june…) names somebody only when she wrote
  it capitalised; a first name followed by a different capitalised word ("Ada Smith" when the
  record is Ada Lovelace) is somebody else; a token inside a whole name she wrote ("Ada
  Lovelace") belongs to that name and does not also call up every other Ada.
- `scopeFromInstruction` is now `namedIn(...).ids || null` (same contract).
- `agentNamedIn` also fetches records whose first word is one of her words
  (`agentShape.nameWords`), limit 200.

## The plan that fits (finding 6)

How a volunteer internal note is stored today: **`volunteer_notes`** (FIX-1 C), kinds
training / background_check / availability / note, read only by the Volunteers hub
(`GET /volunteer-hub/notes`), never by the timeline, Drift or drafts. The public sign-up
already writes availability there as kind `availability`. So nothing was invented.

- `agentShape.volunteerNews(text)` recognises "X became / is now / joined / signed up /
  wants to … volunteer", "mark / make / tag X as a volunteer", "new volunteer"; not a
  segment ("everyone who became…") and not a question ("how many volunteers…"). It pulls the
  availability: "15 hours a week", "4 hours a month", "Saturday mornings". No model.
- `agentShape.volunteerSteps(person, news, { instruction, welcome })`: (a) `mark_volunteer`
  unless already a volunteer, (b) `note_volunteer` kind availability when there is one,
  (c) `draft_note` purpose welcome unless deceased / do-not-contact / sample.
- Two new tools in `AGENT_TOOLS`, both `needsHuman: "never"`, undoable:
  - `mark_volunteer` → `markVolunteer(orgId, id, ctx.client)` (server.js's own write, which
    now takes an optional transaction client). Undo restores the previous `person_types`.
  - `note_volunteer` → `volunteer_notes` (actor `system:agent`), only onto a record that
    carries the Volunteer role by then. Undo deletes it (`AGENT_UNDO_DELETE_OK`).
- The welcome is `draftNote.volunteerWelcomeDraft`: her greeting and sign-off when she has
  taught Steward her voice, otherwise the plain middle sentence; it names no hours, role or
  date. A draft in `agent_drafts`; nothing sends.
- Route: `POST /agent/instructions` runs, in order: money refusal → pause → who is named →
  **if a name matches several records and this is not a read, answer `{ which }` and write
  nothing** → gift news → volunteer news → read → model. `personId` (one id, or an array,
  one per ambiguous name) is her pick; a pick that is not one of the matched records is 400
  `not_one_of_them` (so another org's id cannot get in). Volunteer news naming nobody on file
  or two people is 400 `volunteer_needs_person` with a sentence. The gift path's "ambiguous"
  400 is now the `{ which }` question too.
- The Agent room draws `{ which }` as "Which Ada?" with each record (email, last gift,
  volunteer) as a button; her pick re-asks with her earlier picks.

## The headline (finding 7)

`compilePlan` now builds: one short clause per kind of step, the person named once (in the
first clause about them), at most three clauses ("…, and take N more steps" beyond that),
Oxford comma, capitalised, one full stop, ≤ `HEADLINE_MAX` (100) characters (over that it
drops names for counts). "Steward will … then …" is gone from every plan. The withheld count
is no longer appended to the headline (the sheet already draws `plan.withheld` on its own
line). Examples:
- "Make Ada Lovelace a volunteer, note 15 hours a week, and draft a welcome."
- "Record a $5,000 gift from the Sunrise Foundation and open a follow-up."
- "Log a note on Ada Lovelace's record, add the tag "Volunteer", and take 3 more steps."

## The go button (finding 4, Agent half)

- Plans' one-line bar: `agent-ask-bar-go` "Show me the plan" beside the input at 1440,
  under it (full width) at 390. Emerald when there is text, a quiet cream-shade disabled
  button when empty (so an empty room still has one emerald control at most — fix2-c-cream
  §2c stays green). Enter submits (form).
- Ask: the textarea and `agent-ask-submit` side by side at 1440 (button at the box's
  bottom-right), button under the box at 390. Enter submits, Shift+Enter is a new line
  (IME composition respected). The line under says so.
- Home's one-line entry is workstream A's (Dashboard.jsx untouched).

## FIX-2 handoff §6 "Done · 2 of 2 steps" — fixed

`planState` counts the read row the sheet lists: "Done · 4 of 4 steps" for the Ada plan.

## How each guard was proven able to fail

- Red commit `9d60511`: 31 passed, 52 failed on the branch point — §5 scope (null), §6 (503
  `ai_no_key`, no volunteer path, no `{ which }`), §7 (run-on headlines with "then", 113–187
  chars, withheld as a second sentence), §4 (no bar button; Ask button outline, not beside).
- Planted after the fix, each went red and was reverted:
  - drop the ordinary-word capitalisation guard → "§5 a first name that is an ordinary word…
    names nobody" FAIL;
  - headline joined with "and then" and no fold → §7 FAIL on ada/five/mixed and the exact
    Ada headline;
  - `note_volunteer` also inserting an `interactions` row → "§6 …and NOTHING on the donor
    timeline" FAIL (intBefore 0, intAfter 1).

## Suites run (my stack, final tree)

build97-agent 97/0 · fix1-agent 105/0 · fix2-d-agent 94/0 · fix1-volunteers 54/0 ·
fix2-c-cream 194/0 · fix2-c-hex 3/0 · build97-numbers 72/0 · palette-census 13/0 ·
script-guards 488/0 · workflows-e2e 84/0 · actor-stamp 11/0 · claude-md 22/0 ·
fix3-b-agent 126/0 · fix1-walk (not in CORE) 80/0. All equal to the baseline counts. SKIP
grep of the suite logs: none. Lint 0 errors, 105 warnings (= branch point). TDZ 0 self-refs.
No route added, so no route inventory or tenant pair run.

## Assertions changed

None. No existing assertion text, census count or fixture was edited. (build97-agent,
fix1-agent, fix1-walk and fix2-d-agent pin the headline only loosely — "names the gift and
the follow-up" — and still pass.)

## For the lead

- CORE: `fix3-b-agent` appended after `fix2-c-cream`.
- `server.js`: `markVolunteer(orgId, personId, client = null)` and `markVolunteer` added to the
  agent mount ctx — a merge point if another workstream touches either spot.
- `shared/draftNote.js`: `volunteerWelcomeDraft` appended at the end.
- `docs/decisions/agent-and-ai.md`: three rules added above "Say which gate is shut".
- Prod walk (the lead's): on Harborlight, Agent → Ask, type the exact sentence. Harborlight
  probably has more than one Ada (the walk's plan carried a task "Confirm which Ada"; I did not
  read prod data to check), so expect **"Which Ada?"** first; pick one, then the plan: "Read <Ada>'s record" and the three
  steps under "Make <Ada> a volunteer, note 15 hours a week, and draft a welcome." Do NOT
  press Run the plan on the demo org (only seed-demo writes it); run it on a fixture org.

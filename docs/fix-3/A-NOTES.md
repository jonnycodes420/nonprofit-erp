# FIX-3 A — Home's bottom half (findings 1, 2, 3 and the Home half of 4)

Branch `fix-3-a`, cut from `fix-3` at `f1914b1`. Suite: `tests/fix3-a-home.test.js`
(appended to `tests/run-all.sh` CORE). Screenshots: `docs/fix-3/A/home-bottom-1440.png`,
`docs/fix-3/A/home-bottom-390.png` (viewport-size, scrolled so the bottom half shows,
fixture org `org_fx3ahome`).

## What changed

- **Finding 1: the right column goes empty.** I took the simpler fix: the lower sections
  run full width. Home's white panel is now a two-column **top** (`.home-shell-top`,
  which holds the header and every section up to and including the Thread, beside the
  Today rail) over a full-width **lower half** (`.home-shell-lower`, which holds every
  section after the Thread plus the "Set your words" line).
  - The Thread stays beside the rail because the rail's detail state opens from a Thread row.
  - `sectionStack` (Dashboard.jsx) is the old section-render IIFE, moved above the
    return so it can place both halves. Behaviour is unchanged: edit mode, drag,
    move-to-top and the hidden tray all work, and the tray follows the last section.
  - The board surface is not split.
  - Below 1100px nothing changes: the rail, then the work, then the lower half.
- **Finding 2: "One thank-you ready" looked broken.**
  - Each draft is one row: face, name, amount (· fund), the gift's date
    (`displayDateShort`), and an outlined **Read the draft** button that toggles to
    **Close**. It is never an underlined link.
  - The explainer is one quiet line under the heading, on the heading's left edge:
    "Plain for now. Paste three of your own thank-yous and Steward will write like you."
  - The footer (show more, mark all as sent, error) renders only when it holds
    something, so a single row has nothing under it.
- **Finding 3: the entry duplicated the Agent.**
  - The section no longer has its own title, sentence or pale button.
  - What remains is the daily line, shown only when it has something true to say.
    It opens Agent at *Waiting for you*, or at *Guardrails* when nothing is waiting.
    Below it sit one input and one Go button.
  - The words are handed to Agent by FIX-1's mechanism, unchanged:
    `onNavigate("agent",{agentText,autoAsk:true})`.
  - `dailyLine()` drops zero clauses and agrees in number. With every count at zero
    it says nothing. With one draft waiting it reads "1 draft is waiting for you."
    With work done and drafts waiting it reads "Steward did 14 things for you
    yesterday, and 6 drafts are waiting for you."
- **Finding 4 (Home half):** the Go button is emerald at full strength and always
  rendered. It is disabled (with a not-allowed cursor) until there is text, and
  Enter submits.
- **Found by looking at the screenshots** (the standing rule is no underlined links in
  the CRM):
  - At 390, every Home panel heading sat 16px right of its rows, because the phone's
    `.dash-cpad{padding:16px}` applied inside the panel. Fixed with
    `.home-shell .dash-cpad`.
  - Drift's "No donors drifting." was indented 32px from its heading.
    `OneLineEmpty flush`.
  - Drift's "why" and "Keep Steward's words" were underlined. The first is now a quiet
    emerald word; the second is an outlined button like "Set your words".
  - The institutional list sat directly on the empty line's baseline. It now has 12px
    of air above its rule.
- **Agent.jsx was not touched.**

## How each guard was proven able to fail

- **Red commit `d151196`.** Against the old code, 34 of 60 assertions failed:
  - every §1 daily-line case;
  - §2: the underline, the date, the second ask and the shell split;
  - §3 at 1440: all six finding-1 width/position checks (Drift, the queue and the entry
    were 730px wide beside a rail that ran to y=1872);
  - the row shape;
  - the underlined button;
  - the 24px of dead space;
  - the missing explainer line;
  - the title and sentence;
  - the 0.55 opacity.
- **Two assertions were added after red. Planted defect:** I put the underline back on
  "why" and removed the `.home-shell .dash-cpad` rule. Result: 3 failures. "nothing in
  the lower half is underlined" failed at both 1440 and 390, and "heading and row share
  one left edge" failed at 390 (x 53 vs 37). I then restored the code.
- **Passed on the old code too (not new guards):** "the entry hands the text to Agent
  the FIX-1 way", "the Go button is never hidden", "Enter carries the words into
  Agent" and "disabled until there is text". FIX-1 had already built these. They are
  kept as regressions.

## The daily-line stub

There is no `ANTHROPIC_API_KEY` locally, so `/agent/daily-line` answers
`available:false`. That case keeps BUILD-96's single sentence, now with "Open Agent →"
beside it. The browser leg therefore answers that one GET with
`page.route`, as an org with the model would get it. The line itself comes from the
same `dailyLine()` that §1 tests, and the route calls that function too. The page
blocks service workers (`serviceWorkers:"block"`), because otherwise the stub never
fires.

## Assertions changed (finding 3 calls for both)

`tests/build97-agent.test.js`:
1. `/Steward did 14 things for you yesterday, sent 0, 6 drafts waiting\./` is now
   `/^Steward did 14 things for you yesterday, and 6 drafts are waiting for you\.$/`.
   The zero clause "sent 0" is dropped and the waiting clause says what's true.
2. "…and it promises nothing happens until she says so" (`/Nothing happens until you
   say so/`) is now "…and it is one line into Agent, not a second ask". It asserts that
   the sentence is absent and the Go button is present. Finding 3 removes that
   sentence. This leg runs only with a key.

## For the lead

- `tests/run-all.sh`: one CORE line, `fix3-a-home`, appended after `fix2-c-cream`.
- Shared files other workstreams may touch:
  - `client/src/components/shared.jsx`: the `.home-shell*` CSS block and one mobile
    line.
  - `shared/agentShape.js`: `dailyLine` only.
- The gated case is unchanged. With no key, or with drafting off for the org, Home shows
  the one sentence and nothing to type into, per BUILD-96 and the build97 assertion.
  FIX-2 D made reads work without drafting in the Agent room, so an org with drafting
  off could in principle use Home's entry for reads. I did not change this because the
  build97 gated assertion pins it, and the brief does not call for it.
- The rail can still have blank space beside a long Thread in the top half. This is
  inside the top, not the lower sections the finding named. A sticky rail would fix it
  but needs `.home-shell{overflow:clip}`. I left it alone.

## Evidence (fresh `steward_fix3_a`, stack on :5911/:4511)

- `SUITES=…` over the 36 suites that read Dashboard.jsx, shared.jsx,
  agentShape.js or Home's test ids: **36 passed, 0 failed**.
- Every PASS count equals `baseline-counts.txt`, including build97-agent 97,
  build92-home-proportions 25, fix2-c-cream 194, empty-states 22 and fix2-e-no-iso 4.
- `fix3-a-home` 64/0.
- `fix1-walk` (pure, not in CORE) 80/0.
- The SKIP grep over the suite logs finds nothing.
- TDZ: 0 self-references.
- Client lint: 0 errors, 105 warnings, the same as the branch point.

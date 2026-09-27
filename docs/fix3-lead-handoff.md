# FIX-3 — lead handoff (27 September 2026, merged to main, live)

The brief is `claude/FIX-3.md`: 14 findings from Jonathan's walk after FIX-2.
Each workstream's notes are in `docs/fix-3/<X>-NOTES.md`, with their
screenshots in `docs/fix-3/<X>/`. The profile mockups and the built profile are
in `docs/fix-3/profile/`, and the prod walk is in `docs/fix-3/walk/`.

## 1. What shipped (PR #18, merge `2e051ff`)

| Part | Findings | What it does now |
|---|---|---|
| A | 1, 2, 3, 4 (Home) | Below the Thread, Home's sections run full width. Each thank-you draft is one row: person, amount, date and a **Read the draft** button, with the explainer on one quiet line. "Tell Steward what to do" is one line into Agent, with an always-drawn **Go** button that is disabled until there is text; Enter submits. The daily line says only what's true ("1 draft is waiting for you."), or nothing. |
| B | 4, 5, 6, 7 | The Agent's ask has an always-drawn **Show me the plan** button, and Enter submits. **Finding 5's cause:** a person counted as named only when two words of their name appeared, so "ada" named nobody and the plan read the whole file. A first name now names that person; an ordinary word counts as a name only when capitalised. "X just became a volunteer and wants to do N hours a week" is recognised in our own code. It makes three steps: tag Volunteer on the one record, an availability note in `volunteer_notes` (never the timeline), and one welcome draft. Two matches ask "Which Ada?" before any plan. Every headline is one short sentence, and the plan list counts the read step. |
| C | 8, 14 | `scripts/lib/demoRealPeople.js` defines a real person. The seed removes any such row before its teardown, and its teardown now clears every table with an `org_id`. `scripts/demo-real-people-check.js` is the read-only prod check. Harborlight's giving now looks real: ~40% of dollars online, 68 monthly givers, the Harbor Lights Gala, no future-dated gifts. The seed asserts all of it. |
| D | 9, 10, 11 | **Lock flash:** the plan starts *unknown*, and nothing draws a lock until it is known. **Next move:** three plain sentences. Who-it-serves and deadline claims, and acronyms, must be on the record or they are refused. **Profile:** built as **Direction 1**, Jonathan's pick. A "where we stand" band has one action, a More menu, and the next step pinned at 1440. Below it: What do I do next, What has happened, and eight collapsed "How we manage them" groups. The inventory test proves every element is still reachable. |
| E | 12, 13 | **Rail:** the seven groups, collapsible, with a search box; all 37 old ids deep-link. **Giving summary:** compares **the same point last year** through the Board's own figure source, so the two agree in cents. Reports now read the org's fiscal start month (it was hardcoded to July). |

Lead commits:
- the civil-date fix in `fix3-a-home` (test-clock ratchet);
- the loopback refusal and SELF_REFUSING classification for `fix3-d-profile-capture` (script-guards ratchet);
- a full LIKE-prefix escape in `demoRealPeople.js` (CodeQL #80, raised on the PR).

## 2. Evidence

- **Local full battery, merged tree:** 262 passed, 1 failed. The failure was script-guards (the unclassified capture script), which was then fixed: 495/0.
  - Per-suite PASS counts against FIX-2's final 255: no suite is lower.
  - The SKIP grep matches assertion names only.
- **Checks:** TDZ 0 self-references. Lint 0 errors, 105 warnings (unchanged). No routes added.
- **CI on PR #18:** test **263 passed, 0 failed**. CodeQL and analyze green after the #80 fix.
- **Main CI** (run 36351879172): test, deploy-railway and deploy-vercel all succeeded.
  - **Live:** `/health` buildSha `2e051ff…`, and `<meta name="build-sha">` `2e051ff…`.
  - Prod smoke: ok.

## 3. Prod: the demo

Jonathan approved the following. Outputs are in `docs/fix-3/walk/`.
1. `demo-real-people-check` **before**: OK, no real person in `org_b72demo`. It also found 0 online gifts, no Stripe account, and `is_demo_org=false`.
   - **So the "Jonathan Atkinson $1" and "Online $2 (2)" Jonathan saw were not in `org_b72demo` on prod** (see §6).
2. `seed-demo.js --i-know-this-is-prod`: 1,120 donors and 3,783 gifts. The year is 40.3% of dollars online, with 68 monthly givers and the gala. 13 donors drift; the top decile carries 74.7%; no real person.
3. The check **after**: OK, with 3,031 online gifts ($2,143,816), all minted by the seed. The org is `is_demo_org=true`, with no Stripe connection.
4. After the walk, a second re-seed wiped the walk's two planned instructions, and the check was OK again.

## 4. The prod walk (Harborlight, 1440 and 390): 60 passed, 0 failed

The script is `walk3.js` in the lead's scratchpad; `walk.json` and the captures are in `docs/fix-3/walk/`.
- **Home's bottom half:** full width, three thank-you rows each with a button, and the one-line entry with Go (disabled when empty). There is no "Steward did 0" line and no real name.
- **Agent:** the go button is drawn and disabled while empty, and enabled with text.
- **The Ada sentence, exactly as written:** Harborlight has **no Ada**. The seed never had one, and neither did main. Steward says it can't find who that is, plans nothing, and never says "Read your N people".
- **The same sentence with a demo name** ("margaret just became a volunteer…"): the plan reads only Margaret Chen's record. The headline is "Make Margaret Chen a volunteer, note 15 hours a week, and draft a welcome." The steps: Tag Volunteer, Note 15 hours a week, one welcome draft, and no "Confirm which" task.
- **Profile** (Verity Yarrowdale, Team plan): polled every 40ms from the first byte, and no lock marker appeared. It shows the four questions and no "Stream failed". The next move read as plain sentences and dropped one off-record line.
- **Reports:** the seven groups in order, and search.
- **Giving summary vs Board:** the summary says "…down from $355,423 at the same point last year". The Board's Same point last year is $355,423: same cents, same source.

## 5. Assertion and census changes (each called for by the brief)

- `build97-agent` ×2 (finding 3):
  - the daily line drops zero clauses;
  - the second ask's sentence gives way to the one-line entry.
- `fix2-b-reports` (finding 12): the seven group names and order; §5 folds the groups first.
- `build97-numbers` EXPECTED: Reports 42→40 and claims +2 (finding 13), Donors 117→116 (finding 10), total 413→410.
- Navigation only (finding 10): build98-volunteers, build101-renewals and fix2-e-profile open the group that now holds their element.

There was no stop-and-ask.

## 6. For Jonathan

- **Where did "Jonathan Atkinson $1" come from?** Prod `org_b72demo` never held it: no real person, no online gift, no Stripe account. The org walked on 27 September was probably another org.
  - Candidates: an org of your own where you gave $1, or "Harbor Music School (Demo)" from BUILD-50, which has your xjca2006 donor.
  - I didn't read any other org (your permission was Harborlight only). Tell me which org it was if you want it cleaned.
  - The guard and the seed's remover are in place either way.
- **The Ada sentence on prod** answers "could not find who that is", because no Ada exists in Harborlight. The prod walk showed the three-step plan with Margaret instead.
- **Your call on the suggestion checker:** it treats the org's mission as part of the record (D-NOTES). One line in `getAI` if you'd rather it didn't.
- **Your call on do-not-contact volunteers:** a do-not-contact person gets no Agent work, including the volunteer tag and note (B-NOTES).
- The $1 refund in Stripe is yours, as you said.

## 7. For a later FIX (seen, not fixed; no added scope)

- The report builder's date words still use a July fiscal year (E-NOTES).
- "Got it" on the Reports start-here banner is an underlined link.
- The profile's Contact figure still reads "0d ago" (pinned by fix2-e-profile).
- Home's Go stays emerald when disabled; Agent's disabled button is quiet. Pick one.
- A demo donor is named "Donor 978 Ashgrove", which is seed filler that shows on Home.
- `uploader` is 69/1 (not in CORE; pre-existing).

## 8. Databases, ports, scripts

- **Lead:** `~/steward-fix3` · `steward_fix3` · 5901/4501.
- **Workstreams:** `~/steward-fix3-{a..e}` (59x1/45x1, `steward_fix3_x`) are all merged. The worktrees, branches and databases are removed.
- **Scripts** (session scratchpad): `stack.sh`, `battery.sh`, `walk3.js`, `common-brief.md`.
- The prod demo commands run through `railway run` from `~/nonprofit-erp`, which is the directory linked to the Railway project.

# For the fleet · SCALE-5

SCALE-5 changed no screen. It changed when background work runs: smart moves (the automatic move to Lapsed, and back to Stewardship) now run for orgs whose people changed, within about five minutes, plus once a night per org. Sweeps (digests, nudges, scores, drift, mailbox reads) skip archived, internal-test and fixture orgs. Harborlight stays read-only. Every write below goes in org_stagewalk.

**Surfaces changed:** none drawn. Behaviour behind: a person's Stage (profile header, Pipeline), their Moves history (profile → Moves), the Thread's lapse steps, and how fast Donors, Home and Reports answer when many people are in.

| Check | Clicks | Expect now |
|---|---|---|
| Moves still happen (needs a write, org_stagewalk) | In org_stagewalk: add a person, record a gift dated 14 months ago, set Stage to Cultivate. Wait 6 minutes, then reopen the profile. | Stage reads **Lapsed**. Moves shows one line, "Auto: lapsed: no gift in the last 12 months", with no officer. |
| Off the happy path: a pledge (needs a write) | On that same person, add a pledge due next month. Wait 6 minutes and reopen. | Stage is back to **Stewardship**. Moves adds "Auto: they made a pledge". Then delete the pledge and wait 6 minutes: they go back to **Lapsed** with a second "Auto: lapsed" line (the delete is a change, so the next tick sees it). |
| Off the happy path: an officer's move wins (needs a write) | Move a different lapsing person to Qualify by hand. Wait 6 minutes. | They stay in Qualify. No automatic move is added. |
| Harborlight unchanged (read only) | Harborlight → Pipeline → the Lapsed column count. Open any lapsed person → Moves. | Same count as yesterday's walk. Moves are dated as before. Nothing moved twice. |
| Donors under load | Harborlight → Donors, a search, then page 2, five times in a row. | Each answers in about a second. No "Something went wrong", no blank list. |

**What could have broken nearby:** the Thread's lapse steps and "lapsing" journeys (they start from a stage change), the weekly digest and morning email (now live orgs only), Atlas and journey sweeps, scores and Drift refreshes, and mailbox sync. All of these should look the same for Harborlight and org_stagewalk, because both are live (demo and customer kinds). An org marked Internal test or archived no longer gets digests, nudges or mailbox reads.

**Needs a write:** rows 1 to 3 (org_stagewalk only).

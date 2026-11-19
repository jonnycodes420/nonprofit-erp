# For the fleet · NUMBERS-7

One answer to "is this person lapsed?" for the profile's tag, the Donors filters, Communications' "Lapsing or lapsed" audience and the nightly number check on /ops. Harborlight is read only; any write goes in org_stagewalk.

**Surfaces changed:** the donor profile's Lapsed / Lapsing / Current tag; Donors → Any tag → Lapsed and Lapsing (and the Directory counts); Communications → New campaign → Audience → "Lapsing or lapsed"; Re-engage and Lost & Found (they read the same linked-last-gift rule); /ops → Machine → "The nightly number check" (`lapse` and `quiet` lines). No layout changed.

**Clicks to try for the next three nights:**

| Check | Clicks | Expect |
|---|---|---|
| N7-1 tag = segment | Harborlight: Donors → Any tag → Lapsed, note the count; Any tag → Lapsing, note it. Communications → New campaign → Audience → Lapsing or lapsed | The audience line's count equals Lapsed plus Lapsing (minus anyone with no email, which the line says). |
| N7-2 a spouse holds (needs a write, org_stagewalk) | Two made-up people. Person A: Record a gift dated 14 months ago. Person B: Record a gift dated last month. A → Household and related → Link another → B as Spouse. Open A | A reads **Current**, not Lapsed, and is not in Lapsing or lapsed. Unlink them (off the happy path): A reads **Lapsed** and is in the audience. |
| N7-3 a gift dated ahead does not hold (needs a write, org_stagewalk) | Person C: gift 14 months ago. Person D (C's spouse): one gift dated next month (not scheduled). Open C | C reads **Lapsed**. Before this build C read Current. |
| N7-4 refunded in full (needs a write, org_stagewalk) | Person E: gift 14 months ago, and a gift last month. Refund last month's in full. Open E | E reads **Lapsed** and is in Lapsing or lapsed. Undo the refund: E reads **Current** and leaves the audience. |
| N7-5 the check | (super-admin) /ops → Machine → The nightly number check → Check now on org_stagewalk after N7-2..4 | No `lapse` or `quiet` problem. |

**What could have broken nearby:** Re-engage (Donors → Re-engage) and its badge, Lost & Found and the "Lost: over 24 months" report, the Directory's lapsed count, Home's Keep moves, the auto-lapse stage sweep (a person kept out of Lapsed only by a partner's gift dated ahead now moves to Lapsed on its next pass), journeys triggered on lapsing.

**Known, not this build (reads wrong, next brief):** the profile's "Next move · Lapsing donors" card and Home's "Keep · Lapsing" can name a person whose tag is Current (their spouse gave) or Lapsed (14 months out). Note it if you see it; it is expected until the next brief.

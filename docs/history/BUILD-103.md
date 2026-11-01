## BUILD-103 — peer-to-peer (2026-09-28)

Supporters raising money for the org from their own networks: a walk, a ride,
a birthday, a church team. Most of the machinery already existed and this
build did not start over. Steward already had `peer_fundraisers` under a
giving page, a token-only manage link, rollup for free (a fundraiser's gift
carries BOTH `peer_fundraiser_id` and the parent `giving_page_id`), a public
leaderboard and admin takedown. What it did not have was teams, anything worth
calling a dashboard, words a fundraiser could send, a soft credit, or a screen
an org could run an event from.

**Teams, and arithmetic that cannot drift.** A team is a row under the page. A
team's total is a live SUM over the same gift rows everything else sums, never
a stored counter, so page = teams + solo fundraisers + direct gifts in cents BY
CONSTRUCTION. The screen prints that identity rather than assuming it:
"$1,775 through teams + $125 through fundraisers with no team + $0 given to the
page directly = $1,900." Archiving a team takes it off the leaderboard and
leaves its gifts counted on the campaign, because the money did arrive.

**What a fundraiser may read of a gift, and the one function that decides.** A
first name and an amount, and only where the donor chose it.
`gifts.show_name_to_fundraiser` is FALSE by default and the default is the
decision: a gift given through a friend's page is still a gift to the
organisation, and the friend is not entitled to a list of who gave. The
dashboard's SELECT has no email column and is not going to have one.

**Words the fundraiser sends themselves.** Three drafts written from the
fundraiser's own page data: the ask, the nudge, the thank-you. They copy them,
or open them in their own mail client through a `mailto:`, and they go from
their inbox with their name on them. Steward sends nothing to a fundraiser's
contacts and never will: the drafts function takes no donor argument, which is
why it cannot leak one.

**Soft credit, and the two ways it could land on the wrong person.** Every gift
through a fundraiser page writes a `gift_soft_credits` row at 100% inside
`recordGift`. Hard credit stays on the donor and no giving total anywhere
moves. The fundraiser is matched to the CRM by EXACT EMAIL at sign-up and never
by name, and somebody nobody has heard of becomes a person typed VOLUNTEER,
never a donor: they are not a donor until they give, and typing them as one
would put somebody who has never given a penny into every donor list the office
reads. The one test plants a namesake at a different address and watches the
credit refuse to land on them.

**The manage link is hashed now.** It was the whole auth model and it was
stored in the clear. A row from before this build is migrated on its first use,
so every link already in somebody's inbox keeps working and stops being
readable in the database afterwards.

**The org's event view.** One screen per campaign: the totals with the identity
they foot to, every team and fundraiser against their goal, the leaderboard the
public sees, takedown per fundraiser and per team, a CSV through the one
`sendReportCsv`, and two saved reports over the same rows. First on the screen,
above all of it, is WHO HAS NOT RAISED ANYTHING YET, because that is the only
list on it anybody does something about.

**What the walk caught.** A new Fundraising part id that is not in `FR_LEGACY`
silently opens the Overview: `/dashboard?fr=p2p` landed on the wrong screen
until the id was registered. And `cents` inside `recordGift` is declared inside
a block, so the soft credit read an out-of-scope binding and wrote nothing at
all, quietly, with the gift itself landing perfectly.

Nothing about peer-to-peer goes on the marketing page until one real org has
run a campaign through it.

# ONBOARD-5 · Setup is one calm page at a time, one connection per page (25 Nov 2026)

Jonathan approved the mockup on 24 Nov ("just make it look so good, logos are good, I love this Stripe screen")
with no Mailchimp step, and asked for the org-specific pages and a Custom option on every choice row.

- **The page** (`client/src/pages/setup/`, route `/onboard/setup`, its own lazy chunk inside OnboardPages). Ten
  steps: Make it yours · Bring your donors · Receipts and letters · Funds, campaigns and events · How you talk ·
  Where gifts come in · QuickBooks · Email · Invite your team · You're set. Thin bars (click to jump), "Step N of 10",
  "About N minutes left" (the minutes of the steps not yet done), kicker, Fraunces headline, lead, Back · Skip for
  now · Continue, and "Book 30 minutes" under every page. Fraunces is Steward's own file
  (`client/public/fonts/fraunces-600-latin.woff2`, OFL), loaded only on this page.
- **The model** stays ONBOARD-4's `server/onboard/guided.js`, reshaped to ten steps. Stored on `onboard_guided`:
  skipped (as before), `current_step` (she resumes there on any device), `confirmed` (Continue on Funds and How you
  talk, the two pages with nothing to connect) and `finished_at` ("Go to Home"). Every other done-state is read.
  Home's card is now one line of it, "Finish setting up · N of 10", with the connections she skipped named as not
  connected; Settings → Account has "Open the setup" for every org. The /ops board shows each org's step and skips.
- **Every write goes through its owner**: /orgs/branding (logo, color), /org/vocabulary (fiscal month, sent whole),
  PATCH /orgs/:id (legal name, EIN, address, signer), /letters/signatures/org and UploadWordLetter (LETTERS-1),
  /finance/funds/:id (restricted), /fundraising/campaigns/:id (rename), /campaign-tidy/merge (LETTERS-1),
  /giving-sources (a read key, verified before it is kept), /oauth/:provider/start, /org/sending-domain, /auth/invite.
  New, in `setupPageRoutes.js`: the prefill reads (`setupData.js`), site colors (setupSite.readSite, writes nothing),
  How you talk in one POST (Major cut with Mid kept under it, the donor word pair, the addressee), yearly events
  (`org_yearly_events`) and owners (unowned or Major donors to a user or a pending invite).
- **The couple addressee** is HOUSEHOLD-1's `addresseeOf` with an optional org pattern (`orgs.addressee_pattern`,
  {first1} {first2} {last}), used only for two people who share a last name; household detail and export read it.
- **"You're set"** shows people in, lifetime giving and lapsed 12+ as Figures that open their rows (new source
  `setup-everyone`; Lapsed is `donors-by-status`), and the first three of Home's moves (ONBOARD-3's picker).
- **Logos** are each service's own mark (`client/public/logos/README.md` says where each came from), outside
  `client/src` so the four-color guard never sees a brand's own colors.
- **Giving sources** listed are the adapters that load (`/giving-sources/providers` `available`): Stripe, PayPal,
  Zeffy, Givebutter, plus statements for Cash App, Venmo and Toast. Square is left off the page (POS, not in the brief).
- **What the walk found and fixed**: How you talk's preview stated made-up numbers ("1 new donor and 12 donors to
  thank"); it now says only what the word does. The last page put the gift fact where the action goes. A connection
  started on the page now comes back to it (OAuthCallback reads `steward.setup.return` once).

## 11 · BUILD-100 (grants)

- **Nothing here needs a credential.** The report outline calls the same Anthropic
  gate the agent and the prospect brief do, so it comes alive the moment
  `ANTHROPIC_API_KEY` is set on Railway (already §7). Until then
  `POST /grants/:id/report-outline` answers 503 `outline_unavailable` and says
  which absence it is, rather than drafting anything.
- **The lead-time defaults are the brief's, and they are yours to change:** LOI 30
  days, proposal 30, decision 0, report 21, renewal 45 (`orgs.grant_lead_days`,
  per org, editable in the product). The brief said 30/30/0/21/45 and that is what
  shipped; say if the demo org should open on different ones.
- **One drill is yours, and it is the honest half:** ask for a report outline on a
  real grant with real spending against it and read what comes back. The suite
  proves every refusal — an outcome claim is dropped whatever it cites, and every
  figure on the page is rendered by Steward from the rows — but only a person
  reading real output can say whether the outline is worth a human writing the
  report from. Ten minutes, once the key is set.
- **QuickBooks spend against a grant still waits on 91f and the Intuit keys** (§9).
  Until then `grant_spend` is entered by hand and every screen SAYS so
  (`SPEND_SOURCE_NOTE`) rather than implying a bank feed nobody connected.
- **Three real grant exports would retire three guesses.** The Bloomerang,
  Instrumentl and Submittable presets declare their own confidence — `reported`,
  `reported` and `unconfirmed` — because no real file was in hand. A wrong column
  spelling is then one line in `shared/grantImport.js` and a suite that fails by
  name, never a file importing quietly wrong. NPSP's are documented.
- **ONBOARD-1: re-seed so Riverbend Food Pantry exists for the live demo.** The seed now adds a second demo org,
  before setup: sign in as director@riverbend.demo / demo-riverbend-2026, open Setup, give it the two files from
  `<API>/demo-site/riverbend/riverbend-salesforce-contacts.csv` and `…-donations.csv`, and the website
  `<API>/demo-site/riverbend/`. A re-seed puts it back to before setup. Same command as the earlier re-seeds.
- **ONBOARD-1: one real Salesforce Contacts + Donations pair (CKRH or Justin's Place) would retire the guesses** in
  `shared/setupFiles.js` (Contact ID on the gift report, "General Accounting Unit" as the fund). Until then setup is
  checked against the hand-built fixture only.
- **CLIENT-SAFE-1: re-seed so Meadowbrook Riding Center exists for the privacy-mode demo** (director@meadowbrook.demo /
  demo-meadowbrook-2026; privacy mode on, 6 clients, 2 held-back details). Same command as the earlier re-seeds.
- **GIVE-3: re-seed the demo** so Harborlight's three giving pages carry their layouts (year-end Campaign, Spring Paddle
  Story with a line per amount, GivingTuesday Simple). Same command as the earlier re-seeds.
- **GIVE-3: bank transfer (ACH) on the give form is a switch in Stripe**, not in Steward. In the platform Dashboard,
  Settings, Connect, Payment methods (for connected accounts), turn on "ACH Direct Debit"; each org's own Stripe can
  then show it. PayPal inside Stripe Checkout is the same switch only where Stripe offers it to the org's country.
  Cards, Apple Pay, Google Pay and Link need nothing. Venmo is not offered by Stripe.

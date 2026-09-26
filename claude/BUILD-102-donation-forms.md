# BUILD-102 — Donation Forms (Steward Give)

**Repo:** `nonprofit-erp` (Steward). Runs after BUILD-95 §5B (the giving-page builder, one registry, two surfaces) and BUILD-98 Part 1 (tributes and matching on `recordGift`). Own worktree, own port pair (check WORKTREE-NOTES.md for what is taken), branch `build-102` from current main, CI-gated pushes. Merge to main only on Jonathan's word.

**What this build is.** The first product in the Steward ecosystem that an org can buy on its own: a donation form good enough that an org on Givebutter, Zeffy or a clunky Bloomerang form switches for it, and then finds its donors already in a CRM. Forms anywhere: on Steward's giving pages and embedded on the org's own website with one line of code. Bloomerang's Donation Forms in Steward's terms.

**What does not move.** Steward never holds or moves money: every gift settles in the org's own connected Stripe account. The server prices every charge; an amount from the page is a request, never a fact. Every gift goes through `recordGift`. A form is a view onto the same data, not a second system: no second donor table, no second gift path, no second receipt renderer. Every write carries an actor. Every number on screen has a sentence. Thirty minutes a part, commit green, move on with a note. Affected suites per commit; the full battery is the gate, and nothing is called done before it runs. Tenant battery before Parts 1, 3 and 5.

---

## 1. A form is a giving page with a form config

No new table for forms. A form is a `giving_pages` row with a `form_config` JSONB beside the BUILD-95 widgets: suggested amounts (org's own list, default 25/50/100/250), a default frequency (one-time or monthly), the designation choice (none, fixed fund, or donor picks from a list the org names), whether tribute fields show, whether employer match shows, custom questions (below), thank-you message and redirect. `shared/formConfig.js` is the one validator the server and the editor both read, the `shared/pageWidgets.js` pattern. The editor is the existing page builder with a Form panel; the live phone preview renders the form with the same renderer the donor sees.

**One test.** A config naming a fund from another org is refused; an unknown key is refused by name; the preview and the public page render byte-identical form markup from the same config.

## 2. Multi-step, wallets, and the upsell

The public form becomes three short steps: amount and frequency, donor details, payment. Payment is Stripe Checkout on the connected account (wallets come with it: Apple Pay and Google Pay where the device supports them). A one-time gift at or above the org's threshold offers "Make it monthly?" once, with the monthly amount the org sets (default: a third of the one-time amount, rounded to a whole dollar). Declining is one tap and never asked twice. Cover-fees stays exactly as BUILD-08 built it, unchecked by default, gross-up computed on the server.

**One test.** A tampered amount still charges the server's price; the upsell appears once and a decline never re-appears on the same session; a monthly gift from the upsell writes one subscription and one gift through the existing webhook, and a redelivered webhook writes nothing.

## 3. Tributes, matching and custom questions

Tribute fields (in honour of, in memory of, notify someone) write through BUILD-98 Part 1's `writeGiftExtras`, so a tribute notice is a draft and Steward never sends it. Employer match is a free-text employer field that opens the 98 match pledge on the employer's record; there is no external matching-gift lookup in this build. Custom questions are a fixed set of types (short text, choice, yes/no), each stored as a custom field on the person through the existing custom-fields tables, so answers are queryable in the report builder like any other field.

**One test.** A memorial gift writes one gift, one honouree name and one draft notice with no amount in it; an employer match opens exactly one match pledge; a custom-question answer lands in the person's custom field and filters in a saved report.

## 4. Embedding on the org's own site

One script tag (`<script src="https://www.stewardapp.dev/embed.js" data-form="<id>">`) renders the form in a sandboxed iframe on the org's site, with an iframe snippet as the fallback. The iframe sizes itself to its content, carries the org's colours through the existing contrast guard, and never reads the host page. Payment always opens Checkout on Stripe's own page; no card field ever lives on the org's site. Settings shows both snippets with a live preview.

**One test.** The embed renders on a plain HTML fixture page served from another origin; the frame refuses to be driven by a postMessage from a foreign origin; an archived form's embed shows a quiet "this form is closed" line, not an error.

## 5. Thank-you, receipt and attribution

Each form has its own thank-you page (message, optional redirect) and its receipt goes through the existing `issueGiftReceipt` untouched. UTM source, medium and campaign are captured on the page, carried through Checkout metadata, and stored on the gift, so a report can answer "which email brought this gift in." A form tied to a campaign moves that campaign's thermometer by the existing attribution rules.

**One test.** A gift made with UTM tags stores all three on the gift; the receipt is the same PDF a non-form gift gets; the campaign thermometer moves by exactly the gift's intended amount (net of any covered fee, the existing rule).

## 6. Analytics and a simple A/B

Per form: views, starts (reached step 2), completions, average gift, and completion rate, each with its one-sentence definition, counted server-side from a small `form_events` table (no third-party tracker, no per-person tracking of who looked). A/B is two variants of one form (suggested amounts or headline only), split 50/50 by a cookie, with results shown as counts and never called a winner until each variant has at least 100 views; below that the screen says so in a sentence.

**One test.** Ten fixture views, six starts and three completions read back exactly; the funnel counts never exceed each other; a variant under 100 views shows no winner.

---

## HOW THIS BUILD ENDS

Full battery green, tenant battery, landing verifier, prod smoke, CI green on the merge, both SHAs, "prod is N behind main." On the demo org: one form embedded on a local fixture page, a test-mode monthly gift through the upsell, a memorial gift with a draft notice, UTM tags on a gift, and the form's funnel reading back. Walk it in a browser at 390 and 1440. Report each part with commit and minutes.

## FOR JONATHAN

- Upsell threshold and monthly suggestion are org settings; defaults are $100 and a third of the gift.
- An external matching-gift lookup (Double the Donation) is a vendor contract and a new subprocessor. Not in this build.
- Nothing about Steward Give goes on the marketing page until one real org has taken a real gift through a form.
- Selling Give on its own is a pricing decision, not a code one. The ecosystem pricing doc should settle it before any page says it.

---

## SESSION CONSTRAINTS (carried forward, 2026-09-25)

- Own worktree `~/steward-102`, branch `build-102` from `e744fff` (origin/main at
  BUILD-101). Ports 5691 / 4233, sinks 5692-5694,
  `SUITE_LOG_DIR=/tmp/steward-suite-logs-b102`, fixture prefix `b102_`.
- Never email a prospect. Never run the `org_creo` walk.
- Nothing is done until the full battery is green.
- Merge to main only on Jonathan's word.
- **BUILD-100 (grants) is green and unmerged on `build-100`.** This branch does
  not contain it.

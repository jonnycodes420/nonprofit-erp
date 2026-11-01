## 10 · BUILD-99 (major gifts)

- **The "major prospect" threshold default is $1,000** (`orgs.major_prospect_cents`,
  changeable per org). Say if the demo org should open on a different figure — the
  brief asked, and $1,000 is what shipped.
- **Nothing here needs a credential.** The prospect brief calls the same Anthropic
  gate the agent does, so it comes alive the moment `ANTHROPIC_API_KEY` is set on
  Railway (already in §7). Until then the route answers 503 `brief_unavailable`
  and the panel says the control is unavailable rather than inventing a page.
- **One drill is yours, and it is the honest half:** `ANTHROPIC_API_KEY=… BASE=…
  EMAIL=… PASSWORD=… DONOR=… node scripts/ops/build99-brief-drill.js`. The suite
  proves every refusal; only a person reading real output can say whether the page
  is worth carrying into a meeting. Ten minutes.
- **On the demo org after the merge deploys:** the brief's own ending —
  `BASE=<prod> EMAIL=admin@creoarts.org PASSWORD=… node scripts/ops/build99-walk.js`.
  It writes (a proposal, a pledge, three assignments, a plan), so run it on
  org_creo deliberately or not at all. It passed 36/36 against a local fixture org.

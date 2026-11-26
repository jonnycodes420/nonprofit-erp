// tests/lib/numbers9/thanks.js · NUMBERS-9 item 6 (W-1125-Finance-T7). ONE THANK-YOU BACKLOG.
//
// Fixture, all dated today: Juniper Ashgrove's two gifts no one has thanked ($410.25 and $95), one
// thanked ($60), a refund row (-$20); a gift on a sample person, Quill Sampleton ($700: sample data
// waits for no thanks); and a thank-you draft ready for one of Juniper's two. Waiting to be thanked is
// Juniper's two ($505.25), and the draft does not take its gift out.
// Home's figure (`unthanked`), the thank-you card's backlog (GET /thank-yous), Acknowledgments'
// backlog with her days set to 0 (every waiting gift is older than 0 days), and the Report builder's
// Thanked = No on or after the same day all read 2 gifts and $505.25.
//
// RED ON MAIN: /thank-yous has no backlog; the `unthanked` figure counts the sample person's $700
// (it checked only the gift's sample mark) while Acknowledgments did not; the Report builder's
// Thanked = No counted it too.
"use strict";
const cents = v => Math.round(Number(v || 0) * 100);

async function check({ tok, ORG, run, today, api, q, ok, person, give }) {
  console.log("\n§6 one thank-you backlog: Home = Acknowledgments = the thank-you card = the Report builder");
  const jun = await person("Juniper Ashgrove");
  const a = await give(jun, { amount: 410.25, date: today });
  await give(jun, { amount: 95, date: today });
  const thanked = await give(jun, { amount: 60, date: today });
  await q(`UPDATE gifts SET thanked_at = NOW() WHERE id=$1`, [thanked]);
  await q(`INSERT INTO gifts (id, org_id, donor_id, amount, date, type, refund_of, created_by, created_by_name)
           VALUES ($1,$2,$3,-20,$4,'refund',$5,'system:test','numbers9 fixture')`, ["g_n9r_" + run, ORG, jun, today, a]);
  const quill = await person("Quill Sampleton");
  await give(quill, { amount: 700, date: today });
  await q(`UPDATE donors SET is_sample = true WHERE id=$1 AND org_id=$2`, [quill, ORG]);
  // A draft ready for one of Juniper's gifts (the gift path may already have written one).
  await q(`INSERT INTO thank_you_drafts (id, org_id, donor_id, gift_id, body, voice) VALUES ($1,$2,$3,$4,'Dear Juniper, thank you.','plain')
           ON CONFLICT (org_id, gift_id) DO NOTHING`, ["ty_n9_" + run, ORG, jun, a]);
  await q(`UPDATE orgs SET ack_backlog_days = 0 WHERE id=$1`, [ORG]);

  const dash = (await api("GET", "/dashboards/people", tok)).body || {};
  const m = (dash.metrics || []).find(x => x.key === "giftsNotYetThanked") || {};
  const since = m.source && m.source.params && m.source.params.since;
  const home = since ? (await api("GET", `/figures/unthanked/rows?since=${since}&pageSize=200`, tok)).body || {} : {};
  const homeRows = (home.rows || []).filter(r => r.donorId === jun || r.donorId === quill);
  const homeN = homeRows.length, homeC = homeRows.reduce((s, r) => s + cents(r.amount), 0);
  ok("§6 fixture: Home's waiting gifts here are Juniper's two, $505.25 (the sample person's $700 is not owed thanks)",
    homeN === 2 && homeC === 50525, { n: homeN, cents: homeC, rows: homeRows.map(r => r.amount) });

  const ty = (await api("GET", "/thank-yous", tok)).body || {};
  const bl = ty.backlog || {};
  ok("§6 the thank-you card carries the backlog: the same count and cents as Home's figure, org-wide",
    bl.n === Number(m.value) && bl.n === (home.rows || []).length && bl.cents === (home.rows || []).reduce((s, r) => s + cents(r.amount), 0),
    { card: bl, figure: m.value, rows: (home.rows || []).length });
  ok("§6 a draft does not take its gift out of the backlog (drafted counts it, n still holds it)",
    bl.drafted >= 1 && bl.n >= 2, bl);
  ok("§6 the card says the backlog in words when the drafts differ from it",
    typeof bl.sentence === "string" && /waiting to be thanked since/.test(bl.sentence), bl.sentence);

  const ack = (await api("GET", "/acknowledgments/backlog", tok)).body || {};
  const ackMine = (ack.gifts || []).filter(g => g.donorId === jun || g.donorId === quill);
  ok("§6 Acknowledgments' backlog (older than 0 days) is the same gifts as Home's: count and cents",
    ackMine.length === homeN && ackMine.reduce((s, g) => s + cents(g.amount), 0) === homeC, { ack: ackMine.map(g => g.amount), homeN, homeC });
  ok("§6 its sentence says how it differs from Home's count (N of the M waiting since <day>)",
    /of the \d+ gifts? waiting to be thanked since/.test(ack.sentence || "") && ack.waiting && ack.waiting.n === Number(m.value), { sentence: ack.sentence, waiting: ack.waiting });

  const rb = (await api("POST", "/report-builder/run", tok, { definition: { entity: "gifts", columns: ["donor", "amount", "date"],
    filter: { op: "and", rules: [{ field: "acknowledged", cmp: "eq", value: false }, { field: "date", cmp: "on_or_after", value: since }] } } })).body || {};
  const rbRows = rb.rows || [];
  const rbC = rbRows.reduce((s, r) => s + cents(r.c1), 0);
  ok("§6 the Report builder's Thanked = No on or after that day is Home's backlog, count and cents",
    rbRows.length === Number(m.value) && rbC === (home.rows || []).reduce((s, r) => s + cents(r.amount), 0),
    { report: rbRows.length, reportCents: rbC, figure: m.value });
  ok("§6 the sample person's $700 is in none of them", !rbRows.some(r => cents(r.c1) === 70000) && !(home.rows || []).some(r => cents(r.amount) === 70000),
    rbRows.map(r => r.c1));
  return { since, backlog: bl };
}

module.exports = { check };

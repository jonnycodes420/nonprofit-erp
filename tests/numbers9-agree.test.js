// tests/numbers9-agree.test.js · NUMBERS-9. The build's one new suite. It guards money and tax
// figures: every money figure agrees with its neighbour, to the cent, on screen and on paper. A
// made-up org, Pellinore Saltmarsh Fund, each section on its own fixture.
//
// §1 A fund's card, its dialog and Finance's Posted (W-1122-Finance-F7). General Operating holds a
//    gift whose donor covered the card fee, posted at the gift before the fee ($103.20 gift, $100 row,
//    the demo seed's shape), and $40 of income entered by hand. Card and dialog print one line that
//    says gifts on the books and transactions in differ, with "$3.20 is the card fee" and "$40 ...
//    entered by hand" as lines that open their rows; the truth check's numbers9 pass agrees.
// §2 A letter's deductible is the donor's total deductible (W-1126-Donors-T3). Two gifts to one
//    event: $500 with $190 of dinner, and $100. The letters list says $410 deductible; the PDF says
//    "the deductible amount of these 2 gifts is $410.00" and names both gifts; the year-end
//    statement's total deductible is $410 too.
// §3 Last gift after a refund (W-1126-Finance-01). A $50 gift, $15 refunded: the Directory's row,
//    the profile's Last gift and Lifetime all read $35, and the refund is named.
// §4 Reports' lifetime = the profile's (W-1126-Atlas-01). A couple in one household, both gave last
//    fiscal year only: LYBUNT's people rows read each profile's Lifetime; the household line reads
//    their sum and names each person's part, never one name beside the sum.
// §5 A business and its linked giver (W-1125-Finance-37): tests/lib/numbers9/givesThrough.js.
// §6 One thank-you backlog (W-1125-Finance-T7): tests/lib/numbers9/thanks.js.
//
// PROVEN ABLE TO FAIL: run against main (c2e96c9) each section has a red check (see the report):
// §1 no gap line; §2 the PDF prints only "$310.00" and the statement says $600; §3 Last gift $50;
// §4 the household line has no parts; §5 no Gives through for an Owner; §6 the sample person's $700.
"use strict";
const { ok, summary, api, q, closeDb, civilToday } = require("./helpers");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");

const BASE = process.env.BASE || "http://localhost:5601";
const PASSWORD = "loadtest1234";
const addDays = require("../orgTime").addDays;
const cents = v => Math.round(Number(v || 0) * 100);

async function pdfText(buf) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) out += (await (await doc.getPage(i)).getTextContent()).items.map(t => t.str).join(" ") + " ";
  return out.replace(/\s+/g, " ");
}

(async () => {
  console.log("numbers9-agree (NUMBERS-9)");
  const run = require("crypto").randomBytes(4).toString("hex");
  const reg = await fetch(BASE + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: `Pellinore Saltmarsh Fund ${run}`, userName: "Rosalind Featherstonehaugh", email: `owner-${run}@numbers9.local`, password: PASSWORD, provisioned: true, demoData: false }) });
  const rb = await reg.json();
  if (reg.status !== 201 || !rb.token) throw new Error(`register-org: ${reg.status} ${JSON.stringify(rb).slice(0, 200)}`);
  const tok = rb.token, ORG = rb.org.id, today = civilToday();
  await q(`UPDATE orgs SET onboarding_complete=1, onboarded_at=NOW() WHERE id=$1`, [ORG]);
  await q(`UPDATE users SET welcomed_at=NOW() WHERE org_id=$1`, [ORG]);
  const person = async (name, extra = {}) => {
    const r = await api("POST", "/donors", tok, { name, email: `${name.split(" ")[0].toLowerCase()}-${run}@numbers9.invalid`, ...extra });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return r.body.id;
  };
  const give = async (id, body) => {
    const g = await api("POST", `/donors/${id}/gifts`, tok, { type: "cash", paymentMethod: "Check", ...body });
    const gid = g.body && (g.body.gift ? g.body.gift.id : g.body.id);
    if (!gid) throw new Error(`gift: ${g.status} ${JSON.stringify(g.body).slice(0, 200)}`);
    return gid;
  };
  const ctx = { tok, ORG, run, today, api, q, ok, person, give };

  // ── §1 a fund's card, its dialog and Finance's Posted ────────────────────
  console.log("\n§1 gifts on the books beside transactions in, on the card and in the dialog");
  const tamsin = await person("Tamsin Orrell");
  const plain = await give(tamsin, { amount: 300, date: today });
  const [{ fund_id: gen }] = await q(`SELECT fund_id FROM gifts WHERE id=$1`, [plain]);
  const fee = await give(tamsin, { amount: 100, date: today, fundId: gen });
  // The demo seed's shape: the donor covered the card fee after the row was posted at the gift.
  await q(`UPDATE gifts SET amount = 103.20, cover_fee_amount = 3.20 WHERE id=$1`, [fee]);
  await q(require("../donorSummary").DONOR_SUMMARY_UPDATE("AND d.id = $2"), [ORG, tamsin]);   // the person's stored totals move with the gift
  const [{ n: feeRows }] = await q(`SELECT COUNT(*)::int AS n FROM fin_transactions WHERE gift_id=$1 AND amount = 100`, [fee]);
  await api("POST", "/finance/transactions", tok, { date: today, description: "Raffle cash box", amount: 40, type: "income", fundId: gen });
  const fd = (await api("GET", "/finance/funds-detail", tok)).body || {};
  const card = (fd.funds || []).find(f => f.id === gen) || {};
  const dlg = (await api("GET", `/finance/funds-detail/rows?fund=${encodeURIComponent(gen)}`, tok)).body || {};
  ok("§1 fixture: the fee gift's ledger row is at $100", feeRows === 1, { feeRows });
  ok("§1 the card says the two figures differ, and why (the card fee, the income by hand)",
    /differ by \$36\.80/.test(card.gapWords || "") && /\$3\.20 is the card fee donors covered on 1 gift/.test(card.gapWords || "") && /\$40 in 1 income row entered by hand/.test(card.gapWords || ""), card.gapWords);
  ok("§1 the dialog prints the card's line, word for word", !!dlg.gapWords && dlg.gapWords === card.gapWords, { card: card.gapWords, dialog: dlg.gapWords });
  ok("§1 the dialog's two figures: $403.20 on the books, $440 in", dlg.postedCents === 40320 && dlg.inCents === 44000, { posted: dlg.postedCents, in: dlg.inCents });
  const feeLine = (card.gapLines || []).find(l => l.kind === "fee");
  const feeOpen = feeLine ? (await api("GET", `/figures/fund-books-gap/rows?fund=${encodeURIComponent(gen)}&kind=fee`, tok)).body || {} : {};
  ok("§1 the fee line opens the one gift, at $3.20", feeLine && feeLine.cents === 320 && cents(feeOpen.value) === 320 && (feeOpen.rows || []).length === 1, { feeLine, value: feeOpen.value });
  const a1 = await assertSurfacesAgree(ORG, { token: tok, only: ["numbers9", "numbers8"], soft: true, label: "§1" });
  ok("§1 the truth check: card = dialog = Finance's Posted, and the lines foot", a1.ok, a1.diffs);

  // ── §2 a letter's deductible is the donor's total ───────────────────────
  console.log("\n§2 a printed letter's deductible is the total across its gifts");
  const evId = `ev_n9_${run}`;
  await q(`INSERT INTO events (id,org_id,name,event_type,date) VALUES ($1,$2,'Saltmarsh Lantern Supper','gala',$3)`, [evId, ORG, addDays(today, -3)]);
  const hugo = await person("Hugo Pendragast", { address: "14 Wherry Lane", city: "Beaufort", state: "NC", zip: "28516" });
  const seat = await give(hugo, { amount: 500, date: addDays(today, -3), eventId: evId });
  await q(`UPDATE gifts SET quid_pro_quo_value = 190, quid_pro_quo_desc = 'Supper' WHERE id=$1`, [seat]);
  await give(hugo, { amount: 100, date: addDays(today, -2), eventId: evId });
  const choice = { eventId: evId, from: addDays(today, -30), to: today };
  const pv = (await api("POST", "/letters/giving/preview", tok, choice)).body || {};
  const mine = (pv.letters || []).find(l => l.donorId === hugo) || {};
  ok("§2 the letters list: $600 given, $410 deductible", cents(mine.total) === 60000 && cents(mine.deductible) === 41000 && cents(pv.deductible) === 41000, { total: mine.total, deductible: mine.deductible });
  const pdfRes = await fetch(BASE + "/letters/giving/pdf", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify(choice) });
  const text = pdfRes.status === 200 ? await pdfText(Buffer.from(await pdfRes.arrayBuffer())) : "";
  ok("§2 the PDF's deductible is the total: \"the deductible amount of these 2 gifts is $410.00\"", /deductible amount of these 2 gifts is \$410\.00/.test(text), text.slice(0, 600));
  ok("§2 the PDF names both gifts it covers", /your gift of \$500\.00/.test(text) && /your gift of \$100\.00/.test(text), text.slice(0, 600));
  const stRows = await q(`SELECT * FROM gifts WHERE org_id=$1 AND donor_id=$2 ORDER BY date`, [ORG, hugo]);
  const st = require("../statementTotals").statementLines(stRows, { year: true });
  ok("§2 the year-end statement's deductible is the same $410", st.deductibleCents === 41000, { statement: st.deductibleCents });
  ok("§2 the letter's text in the list says the same total", /deductible amount of these 2 gifts is \$410\.00/.test(mine.text || ""), mine.text);

  // ── §3 last gift after a refund ─────────────────────────────────────────
  console.log("\n§3 Last gift is net of its refund, with the refund named");
  const wynn = await person("Wynn Calderbank");
  const g50 = await give(wynn, { amount: 50, date: addDays(today, -1) });
  const rf = await api("POST", `/gifts/${g50}/refund`, tok, { amount: 15, date: today, reason: "Charged twice" });
  ok("§3 fixture: the $15 refund is recorded", rf.status === 200 || rf.status === 201, { status: rf.status, body: rf.body });
  const prof = (await api("GET", `/donors/${wynn}`, tok)).body || {};
  const F = prof.figures || {};
  ok("§3 the profile's Last gift is $35, the gift less its refund", cents(F.lastGift && F.lastGift.value) === 3500, F.lastGift);
  ok("§3 the profile names the refund under it", /Less a refund of \$15\.00 on \$50\.00/.test((F.lastGift && F.lastGift.under && F.lastGift.under.refundWords) || ""), F.lastGift && F.lastGift.under);
  ok("§3 Lifetime is the same $35 basis", cents(F.lifetime && F.lifetime.value) === 3500, F.lifetime);
  const list = (await api("GET", "/donors?limit=500", tok)).body;
  const row = (Array.isArray(list) ? list : (list && (list.donors || list.rows)) || []).find(d => d.id === wynn) || {};
  ok("§3 the Directory's row: last gift $35, $15 refunded on it", cents(row.last_gift_amount) === 3500 && cents(row.last_gift_refunded) === 1500, { amt: row.last_gift_amount, refunded: row.last_gift_refunded });
  ok("§3 the words: \"$35 · $50 less a $15 refund\"", (require("../shared/numbers/lastGift").lastGiftWords || (() => ""))({ cents: 3500, refundedCents: 1500 }) === "$35 · $50 less a $15 refund");

  // ── §4 Reports' lifetime = the profile's ────────────────────────────────
  console.log("\n§4 Reports and the profile give one lifetime");
  const ov = (await api("GET", "/fundraising/overview", tok)).body || {};
  const fyEnd = ov.period && ov.period.end, fyYear = fyEnd ? Number(String(fyEnd).slice(0, 4)) : null;
  const lastFy = ov.period && ov.period.start ? addDays(String(ov.period.start).slice(0, 10), -30) : addDays(today, -400);
  const ansel = await person("Ansel Brightwater"), mira = await person("Mira Brightwater");
  await give(ansel, { amount: 27600, date: lastFy });
  await give(mira, { amount: 4100, date: lastFy });
  await api("POST", "/households", tok, { name: "Ansel Brightwater", memberIds: [ansel, mira], primaryDonorId: ansel });
  const ly = (await api("GET", `/reports/lybunt?year=${fyYear}&yearMode=fiscal`, tok)).body || {};
  const lifeOf = async id => cents((((await api("GET", `/donors/${id}`, tok)).body || {}).figures || {}).lifetime?.value);
  const [la, lm] = [await lifeOf(ansel), await lifeOf(mira)];
  const pr = id => (ly.rows || []).find(r => r.id === id) || {};
  ok("§4 LYBUNT's people rows read each profile's Lifetime", cents(pr(ansel).lifetimeGiving) === la && cents(pr(mira).lifetimeGiving) === lm && la === 2760000,
    { ansel: [pr(ansel).lifetimeGiving, la], mira: [pr(mira).lifetimeGiving, lm] });
  const unit = (ly.units || []).find(u => u.members && u.members.some(m => m.id === ansel)) || {};
  ok("§4 the household line is their sum ($31,700), and it is not named as one person", cents(unit.lifetimeGiving) === la + lm && unit.name !== "Ansel Brightwater" && /household/i.test(unit.name || ""), { name: unit.name, life: unit.lifetimeGiving });
  ok("§4 the household line names each person's part at their profile's Lifetime",
    (unit.members || []).length === 2 && unit.members.every(m => cents(m.lifetimeGiving) === (m.id === ansel ? la : lm)), unit.members);

  // ── §5 and §6 ───────────────────────────────────────────────────────────
  await require("./lib/numbers9/givesThrough").check(ctx);
  await require("./lib/numbers9/thanks").check(ctx);

  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

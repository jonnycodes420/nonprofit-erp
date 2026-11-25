// tests/numbers8-money.test.js · NUMBERS-8. The build's one new suite. It guards money and donor
// mail: every money figure agrees with the one beside it, and a thank-you never thanks a gift that
// was not made. A made-up org, Fennimore Tidework Trust, each section on its own fixture.
//
// §1 A fund's card and its dialog are one number (W-1122-Finance-F7). General Operating holds a
//    posted gift, a gift that names no fund (it posts to the default), a waiting gift that names no
//    fund, an expense and a ledger row of another type ("transfer"). The card's Balance = the
//    dialog's, to the cent; its transactions = the dialog's count; its waiting = the dialog's.
// §2 Gives through (W-1125-Finance-37). Halloway Marine Works gives $5,000, $2,500 soft-credited
//    to its program officer, Perpetua Glass, who is linked as program officer only. Perpetua's
//    Gives through reads $2,500 for Halloway; Halloway's Given through it reads her at $2,500; the
//    figure opens $2,500 of rows (assertSurfacesAgree's numbers8 pass).
// §3 The LYBUNT chip opens the unit it names (W-1124-Donors-T2). Two spouses in one household and a
//    third person gave last fiscal year and not this one: the report's people are 3 rows and its
//    households 2; the chip sends "people" or "households" with its own year, and Reports reads it.
// §4 Unthanked is one definition (W-1125-Finance-T7). Home's "Gifts not yet thanked since <day>"
//    = the Report builder's Gifts, Thanked = No, dated on or after that day, in count and cents,
//    with a refund row and a thanked gift in the mix.
// §5 A thank-you never thanks a gift that was not made (W-1125-Fundraising-17). "Thank you, major
//    gift" previewed as Ana Ruiz-Quell, who has never given, says "Ana hasn't given yet. Preview
//    this as someone who has.", offers the newest giver, and never prints "of your gift"; previewed
//    as a giver it carries their gift; a draft for Ana is refused.
//
// PROVEN ABLE TO FAIL: run against main (5c922c6's descendants, before this build) every section is
// red: §1 the dialog nets the "transfer" row and has no waiting figure; §2 no Gives through; §3 the
// chip sends no unit; §4 Thanked = No counts the refund row; §5 the preview says "of your gift".
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary, api, q, closeDb, civilToday } = require("./helpers");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");

const BASE = process.env.BASE || "http://localhost:5601";
const PASSWORD = "loadtest1234";
const addDays = require("../orgTime").addDays;
const cents = v => Math.round(Number(v || 0) * 100);

(async () => {
  console.log("numbers8-money (NUMBERS-8)");
  const run = require("crypto").randomBytes(4).toString("hex");
  const reg = await fetch(BASE + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: `Fennimore Tidework Trust ${run}`, userName: "Odile Marchbank", email: `owner-${run}@numbers8.local`, password: PASSWORD, provisioned: true, demoData: false }) });
  const rb = await reg.json();
  if (reg.status !== 201 || !rb.token) throw new Error(`register-org: ${reg.status} ${JSON.stringify(rb).slice(0, 200)}`);
  const tok = rb.token, ORG = rb.org.id, today = civilToday();
  await q(`UPDATE orgs SET onboarding_complete=1, onboarded_at=NOW() WHERE id=$1`, [ORG]);
  await q(`UPDATE users SET welcomed_at=NOW() WHERE org_id=$1`, [ORG]);
  const person = async (name, extra = {}) => {
    const r = await api("POST", "/donors", tok, { name, email: `${name.split(" ")[0].toLowerCase()}-${run}@numbers8.invalid`, ...extra });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return r.body.id;
  };
  const give = async (id, body) => {
    const g = await api("POST", `/donors/${id}/gifts`, tok, { type: "cash", paymentMethod: "Check", ...body });
    const gid = g.body && (g.body.gift ? g.body.gift.id : g.body.id);
    if (!gid) throw new Error(`gift: ${g.status} ${JSON.stringify(g.body).slice(0, 200)}`);
    return gid;
  };

  // ── §1 a fund's card and its dialog ───────────────────────────────────────
  console.log("\n§1 a fund's card and its dialog are one number");
  const wren = await person("Wren Albrighton");
  const named = await give(wren, { amount: 300, date: today });
  const [{ fund_id: gen }] = await q(`SELECT fund_id FROM gifts WHERE id=$1`, [named]);
  await q(`UPDATE orgs SET default_fund_id=$2 WHERE id=$1`, [ORG, gen]);
  const noFund = await give(wren, { amount: 120, date: today });
  await q(`UPDATE gifts SET fund_id = NULL WHERE id=$1`, [noFund]);            // posted to the default, names no fund
  const waits = await give(wren, { amount: 75.5, date: today });
  await q(`UPDATE gifts SET fund_id = NULL WHERE id=$1`, [waits]);
  await q(`DELETE FROM fin_transactions WHERE gift_id=$1`, [waits]);            // not on the books: waiting
  await api("POST", "/finance/transactions", tok, { date: today, description: "Harbour moorings", amount: 40, type: "expense", fundId: gen });
  await q(`INSERT INTO fin_transactions (id, org_id, date, description, amount, type, fund_id, source, created_by, created_by_name)
           VALUES ($1,$2,$3,'Moved to reserve',25,'transfer',$4,'manual','system:test','numbers8 fixture')`, ["ft_n8x_" + run, ORG, today, gen]);
  const fd = (await api("GET", "/finance/funds-detail", tok)).body || {};
  const card = (fd.funds || []).find(f => f.id === gen) || {};
  const dlg = (await api("GET", `/finance/funds-detail/rows?fund=${encodeURIComponent(gen)}`, tok)).body || {};
  ok("§1 fixture: the card reads $380 on the books (300 + 120 posted, 40 out; the transfer is in no balance)", card.balanceCents === 38000, { balance: card.balanceCents });
  ok("§1 the dialog's balance is the card's, to the cent", dlg.netCents === card.balanceCents && dlg.balanceCents === card.balanceCents, { card: card.balanceCents, net: dlg.netCents, balance: dlg.balanceCents });
  ok("§1 the dialog counts the card's transactions (income and expense rows: 3)", card.transactions === 3 && dlg.count === 3, { card: card.transactions, dialog: dlg.count });
  ok("§1 the card's waiting ($75.50 in 1 gift, naming no fund) is the dialog's", card.waiting && card.waiting.cents === 7550 && card.waiting.count === 1
    && dlg.waitingCents === 7550 && dlg.waitingCount === 1, { card: card.waiting, dialog: [dlg.waitingCents, dlg.waitingCount] });
  ok("§1 the dialog says what each figure counts, including the gift that names no fund", /^Balance \$380 from 3 transactions/.test(dlg.sentence || "")
    && /1 row of another type is in no balance/.test(dlg.sentence || "") && /names? no fund and posts? here/.test(dlg.sentence || ""), dlg.sentence);
  const a1 = await assertSurfacesAgree(ORG, { token: tok, only: ["numbers8"], soft: true, label: "§1" });
  ok("§1 the truth check's numbers8 pass agrees", a1.ok, a1.diffs);

  // ── §2 gives through ─────────────────────────────────────────────────────
  console.log("\n§2 a business shows the people who give through it, and they show it");
  const halloway = await person("Halloway Marine Works", { kind: "organisation" });
  await q(`UPDATE donors SET kind='organisation' WHERE id=$1`, [halloway]);
  const perpetua = await person("Perpetua Glass");
  await q(`INSERT INTO donor_relationships (id, org_id, donor_id_a, donor_id_b, relationship_type, notes, created_by, created_by_name)
           VALUES ($1,$2,$3,$4,'program_officer','','system:test','numbers8 fixture')`, ["rel_n8_" + run, ORG, halloway, perpetua]);
  await give(halloway, { amount: 5000, date: today, softCredits: [{ donorId: perpetua, amount: 2500 }] });
  const mine = (await api("GET", `/donors/${perpetua}/relationships`, tok)).body || {};
  const theirs = (await api("GET", `/donors/${halloway}/relationships`, tok)).body || {};
  const gt = (mine.givesThrough || []).find(x => x.id === halloway);
  const tp = (theirs.throughPeople || []).find(x => x.id === perpetua);
  ok("§2 Perpetua (a program officer, not an owner) has Gives through Halloway Marine Works: $2,500", gt && gt.cents === 250000 && gt.name === "Halloway Marine Works", mine.givesThrough);
  ok("§2 Halloway's Given through it lists her at the same $2,500", tp && tp.cents === 250000, theirs.throughPeople);
  const rows2 = (await api("GET", `/figures/gives-through/rows?donor=${perpetua}&through=${halloway}`, tok)).body || {};
  ok("§2 the figure opens $2,500 of rows", cents(rows2.value) === 250000 && (rows2.rows || []).length === 1, { value: rows2.value, n: (rows2.rows || []).length });
  const a2 = await assertSurfacesAgree(ORG, { token: tok, only: ["numbers8"], soft: true, label: "§2" });
  ok("§2 the truth check's Gives through pair agrees", a2.ok, a2.diffs);

  // ── §3 the LYBUNT chip opens the unit it names ───────────────────────────
  console.log("\n§3 a people count opens people");
  const ov = (await api("GET", "/fundraising/overview", tok)).body || {};
  const fyEnd = (ov.period && ov.period.end) || null;
  const fyYear = fyEnd ? Number(String(fyEnd).slice(0, 4)) : null;
  const lastFy = ov.period && ov.period.start ? addDays(String(ov.period.start).slice(0, 10), -30) : addDays(today, -400);
  const sp1 = await person("Agatha Quillon"), sp2 = await person("Barnaby Quillon"), solo = await person("Cressida Venn");
  await api("POST", `/donors/${sp1}/relationships`, tok, { relatedDonorId: sp2, relationshipType: "spouse" });   // one giving unit (households.js UNIT_LINK_TYPES)
  for (const id of [sp1, sp2, solo]) await give(id, { amount: 90, date: lastFy });
  const ly = (await api("GET", `/reports/lybunt?year=${fyYear}&yearMode=fiscal`, tok)).body || {};
  const lyPeople = (ly.rows || []).filter(r => [sp1, sp2, solo].includes(r.id)).length;
  ok("§3 fixture: the report's people rows hold the three, and its household rows are one fewer", lyPeople === 3 && ly.units && ly.units.length === (ly.rows || []).length - 1,
    { rows: (ly.rows || []).length, units: ly.units && ly.units.length });
  const bar = fs.readFileSync(path.join(__dirname, "../client/src/components/fundraising/OverviewPeriodBar.jsx"), "utf8");
  const rep = fs.readFileSync(path.join(__dirname, "../client/src/components/Reports.jsx"), "utf8");
  ok("§3 the chip's people count opens people, its households count households, each with the chip's year and basis",
    /onNavigate\("reports", \{ report: "lybunt", unit, year, yearMode:/.test(bar) && /openBunt\("people"\)/.test(bar) && /openBunt\("households"\)/.test(bar));
  const app = fs.readFileSync(path.join(__dirname, "../client/src/App.jsx"), "utf8");
  ok("§3 the app hands Reports the unit and the year the chip sent (the walk found them dropped)", /yearMode:opts\.yearMode,unit:opts\.unit,year:opts\.year\}/.test(app));
  ok("§3 Reports lists the unit it was sent (people: one row per person) and the chip's year",
    /initialParams\?\.unit === "people"/.test(rep) && /initialParams\?\.year/.test(rep) && /\(!byPerson && d\.units\) \|\| d\.rows/.test(rep));

  // ── §4 unthanked is one definition ──────────────────────────────────────
  console.log("\n§4 Home's not-yet-thanked = the report's Thanked = No, for the same window");
  const tess = await person("Tessaly Brightwater");
  const t1 = await give(tess, { amount: 640, date: today });
  const t2 = await give(tess, { amount: 85.25, date: today });
  await api("POST", `/gifts/${t2}/thank`, tok, {}).catch(() => null);
  await q(`UPDATE gifts SET thanked_at = NOW() WHERE id=$1 AND thanked_at IS NULL`, [t2]);
  await give(tess, { amount: -60, date: today, type: "refund", notes: "refund of part of the gift" }).catch(async () => {
    await q(`INSERT INTO gifts (id, org_id, donor_id, amount, date, type, created_by, created_by_name) VALUES ($1,$2,$3,-60,$4,'refund','system:test','numbers8 fixture')`, ["g_n8r_" + run, ORG, tess, today]);
  });
  const dash = (await api("GET", "/dashboards/people", tok)).body || {};
  const m = (dash.metrics || []).find(x => x.key === "giftsNotYetThanked") || {};
  const since = m.source && m.source.params && m.source.params.since;
  const home = since ? (await api("GET", `/figures/unthanked/rows?since=${since}&pageSize=200`, tok)).body || {} : {};
  ok("§4 Home's figure says its window in words", /^Gifts not yet thanked since [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(m.label || ""), m.label);
  const rb4 = (await api("POST", "/report-builder/run", tok, { definition: { entity: "gifts", columns: ["donor", "amount", "date"],
    filter: { op: "and", rules: [{ field: "acknowledged", cmp: "eq", value: false }, { field: "date", cmp: "on_or_after", value: since }] } } })).body || {};
  const rbRows = rb4.rows || [];
  const amt = r => cents(r.c1);   // the run answers columns as c0, c1, … in the order asked
  const rbCents = rbRows.reduce((s, r) => s + amt(r), 0);
  const homeCents = (home.rows || []).reduce((s, r) => s + cents(r.amount), 0);
  ok("§4 the report's Thanked = No rows are Home's rows: the same count", rbRows.length === (home.rows || []).length && rbRows.length === Number(m.value), { report: rbRows.length, home: (home.rows || []).length, figure: m.value });
  ok("§4 and the same cents (the refund row is neither thanked nor waiting)", rbCents === homeCents, { report: rbCents, home: homeCents });
  ok("§4 fixture: Tessaly's unthanked $640 is in both, her thanked gift in neither", rbRows.some(r => amt(r) === 64000) && !rbRows.some(r => amt(r) === 8525), rbRows.map(r => r.c1));
  void t1;

  // ── §5 a thank-you never thanks a gift that was not made ────────────────
  console.log("\n§5 a gift template previewed for someone who has never given");
  const ana = await person("Ana Ruiz-Quell");
  const giver = await person("Lucan Forsythe");
  await give(giver, { amount: 12000, date: today });
  const et = (await api("POST", "/email-templates", tok, { starterKey: "person_thanks_major" })).body || {};
  const tid = (et.template || et).id;
  const pv = (await api("POST", `/email-templates/${tid}/preview`, tok, { as: ana })).body || {};
  ok("§5 previewed as Ana: \"Ana hasn't given yet. Preview this as someone who has.\"", pv.noGift && pv.noGift.sentence === "Ana hasn't given yet. Preview this as someone who has.", pv.noGift);
  const [newest] = await q(`SELECT d.id FROM donors d JOIN gifts g ON g.donor_id=d.id AND g.org_id=d.org_id WHERE d.org_id=$1 AND d.deleted_at IS NULL ORDER BY g.date DESC NULLS LAST, g.id LIMIT 1`, [ORG]);
  ok("§5 it offers the newest giver (Preview as's own pick when nobody is chosen)", pv.noGift && pv.noGift.lastGiver && pv.noGift.lastGiver.id === newest.id && newest.id !== ana, { offered: pv.noGift, newest });
  ok("§5 the preview never thanks her for a gift (no \"of your gift\", no gift sentence)", !/your gift|gift of \$|A gift of this size/i.test(pv.html || "") && !/of your gift/i.test(pv.subject || ""), String(pv.html || "").replace(/<[^>]+>/g, " ").slice(0, 300));
  const pg = (await api("POST", `/email-templates/${tid}/preview`, tok, { as: giver })).body || {};
  ok("§5 previewed as Lucan, who gave $12,000, it carries his gift and no notice", !pg.noGift && /\$12,000/.test(pg.html || ""), String(pg.html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300));
  const tk = (await api("GET", "/templates", tok)).body || {};
  const kind = ((tk.templates || tk.rows || tk) instanceof Array ? (tk.templates || tk.rows || tk) : []).find(t => t.kind === "thanks_major") || {};
  await api("PUT", "/templates/thanks_major", tok, { subject: kind.subject || "Thank you", body: kind.body || "Thank you for your gift of {{gift_amount}}." });
  const dr = await api("POST", "/templates/thanks_major/draft", tok, { donorId: ana });
  ok("§5 a draft of it for Ana is refused: she has no gift on file", dr.status === 409 && dr.body && dr.body.error === "missing_fields" && /gift amount/.test(dr.body.sentence || ""), { status: dr.status, body: dr.body });

  // ── §6 every figure-source request carries the session (W-1125-Fundraising-02) ──────────────
  console.log("\n§6 the census: no figure-source request goes out without the auth header");
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : /\.(jsx?|mjs)$/.test(e.name) ? [path.join(d, e.name)] : []);
  const bad = [];
  for (const f of walk(path.join(__dirname, "../client/src"))) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    lines.forEach((l, i) => {
      if (!/\/figures\//.test(l) || !/\bfetch\(/.test(l) || /\bapiFetch\(/.test(l)) return;
      // a raw fetch of a figure source must take its header from api.js authHeaders(), never build "Bearer <token>" itself
      if (!/authHeaders\(\)/.test(l)) bad.push(`${path.relative(path.join(__dirname, ".."), f)}:${i + 1}`);
    });
  }
  ok("§6 every figure-source fetch in the client goes through apiFetch or api.js authHeaders()", bad.length === 0, bad);
  const apiSrc = fs.readFileSync(path.join(__dirname, "../client/src/api.js"), "utf8");
  ok("§6 a 401 to a request with no token reads her sentence and the way back, never \"No token provided\"",
    /res\.status === 401 && !token\) throw Object\.assign\(new Error\(SIGNED_OUT_SENTENCE\)/.test(apiSrc) && /Sign in again/.test(apiSrc));

  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

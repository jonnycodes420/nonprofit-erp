// tests/ledger3-funds.test.js · LEDGER-3. The build's one new suite. It guards money: which fund a
// gift lands on, that Finance's fund figures and Reports' Gifts by fund are one number, and that
// posting waiting gifts to the books (and undoing it) foots to the cent.
//
// §1 One default fund. An org whose unrestricted funds are General Operating (the oldest) and
//    "Abbey Reserve" (first by name, made later): a gift with no fund lands on General Operating,
//    orgs.default_fund_id is stamped once as the system's pick (so the deposit sheet's blank memo
//    still asks: no person chose it), and Finance's fund list marks General Operating Default.
// §2 Finance = Reports. For every fund, "Received this fiscal year (gifts)" equals Reports' Gifts by
//    fund row for the same days and the rows its figure opens, to the cent, with a split gift and a
//    partial refund in the mix (assertSurfacesAgree's funds pass, tests/lib/ledger3Checks.js).
// §3 Post to the books. Three imported gifts: two this fiscal year on one deposit (waiting) and one
//    from before it (history). A GET writes nothing; the deposit lists 2 gifts and their total;
//    posting writes exactly two ledger rows, each on its gift's fund (a no-fund gift on the
//    default), the books move by the batch's cents, a stale second post is refused, history never
//    posts, and Undo removes exactly that batch, after which a second Undo is refused.
//
// PROVEN ABLE TO FAIL (each planted, each red, then put back):
//   · defaultFund.js ordering by name instead of created_at → §1 red (Abbey Reserve).
//   · fundBooks.js summing gifts.amount instead of the split line → §2 red (the split gift).
//   · ledgerPost.js posting a no-fund gift with fund_id NULL → §3 red (the default's balance).
//   · Undo deleting more than its batch (`OR source = 'gift'`) → §3 red (a live gift's row gone, 8 undone).
"use strict";
const { ok, summary, api, q, closeDb, civilToday } = require("./helpers");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");

const BASE = process.env.BASE || "http://localhost:5601";
const PASSWORD = "loadtest1234";
const addDays = require("../orgTime").addDays;
const cents = v => Math.round(Number(v || 0) * 100);

(async () => {
  console.log("ledger3-funds (LEDGER-3)");
  const run = require("crypto").randomBytes(4).toString("hex");
  const reg = await fetch(BASE + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: `Ledger Three Quillmere Fund ${run}`, userName: "Odessa Varnham", email: `owner-${run}@ledger3.local`, password: PASSWORD, provisioned: true, demoData: false }) });
  const rb = await reg.json();
  if (reg.status !== 201 || !rb.token) throw new Error(`register-org: ${reg.status} ${JSON.stringify(rb).slice(0, 200)}`);
  const tok = rb.token, ORG = rb.org.id, today = civilToday();
  await q(`UPDATE orgs SET onboarding_complete=1, onboarded_at=NOW() WHERE id=$1`, [ORG]);
  await q(`UPDATE users SET welcomed_at=NOW() WHERE org_id=$1`, [ORG]);
  const person = async (name) => {
    const r = await api("POST", "/donors", tok, { name, email: `${name.split(" ")[0].toLowerCase()}-${run}@ledger3.invalid` });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return r.body.id;
  };
  const give = async (id, body) => {
    const g = await api("POST", `/donors/${id}/gifts`, tok, { type: "cash", paymentMethod: "Check", ...body });
    const gid = g.body && (g.body.gift ? g.body.gift.id : g.body.id);
    if (!gid) throw new Error(`gift: ${g.status} ${JSON.stringify(g.body).slice(0, 200)}`);
    return gid;
  };

  // ── §1 one default fund ──────────────────────────────────────────────────
  console.log("\n§1 one default fund");
  // The org's own General Operating may be made by its first ledger write; make sure it is the oldest.
  let [gen] = await q(`SELECT id, created_at FROM fin_funds WHERE org_id=$1 AND restricted = false ORDER BY created_at, id LIMIT 1`, [ORG]);
  if (!gen) {
    await q(`INSERT INTO fin_funds (id, org_id, name, restricted, created_at) VALUES ($1,$2,'General Operating',false, NOW() - interval '1 day')`, ["ff_l3gen_" + run, ORG]);
    [gen] = await q(`SELECT id FROM fin_funds WHERE id=$1`, ["ff_l3gen_" + run]);
  }
  await q(`UPDATE fin_funds SET created_at = NOW() - interval '1 day' WHERE id=$1`, [gen.id]);
  // Main has no default_fund_by (the suite is run there to see it red), so the fixture falls back.
  const setDefault = (id, by) => q(`UPDATE orgs SET default_fund_id = $2, default_fund_by = $3 WHERE id=$1`, [ORG, id, by])
    .catch(() => q(`UPDATE orgs SET default_fund_id = $2 WHERE id=$1`, [ORG, id]));
  await setDefault(null, null);
  const abbey = (await api("POST", "/finance/funds", tok, { name: "Abbey Reserve", restricted: false })).body || {};
  const boat = (await api("POST", "/finance/funds", tok, { name: "Kestrel Boat Fund", restricted: true })).body || {};
  ok("§1 fixture: an unrestricted fund first by name (Abbey Reserve) and a restricted one, both newer than General Operating", !!abbey.id && !!boat.id, { abbey, boat });
  const ida = await person("Ida Thornbury");
  const g1 = await give(ida, { amount: 400, date: today });
  const [g1row] = await q(`SELECT fund_id FROM gifts WHERE id=$1`, [g1]);
  const [org1] = await q(`SELECT * FROM orgs WHERE id=$1`, [ORG]);
  ok("§1 a gift with no fund lands on General Operating (the oldest), never Abbey Reserve (first by name)", g1row.fund_id === gen.id, { got: g1row.fund_id, gen: gen.id, abbey: abbey.id });
  ok("§1 the org's default is stamped once, as the system's pick", org1.default_fund_id === gen.id && org1.default_fund_by === "system:defaultFund", { id: org1.default_fund_id, by: org1.default_fund_by });
  const [ft1] = await q(`SELECT fund_id, COUNT(*) OVER ()::int AS n FROM fin_transactions WHERE gift_id=$1`, [g1]);
  ok("§1 its ledger row is on the same fund (recordGift's Rule 3 through the one helper)", ft1 && ft1.n === 1 && ft1.fund_id === gen.id, ft1);
  const [chosen] = await q(`SELECT ${require("../shared/numbers/defaultFund").CHOSEN_SQL("o")} AS c FROM orgs o WHERE o.id=$1`, [ORG]).catch(() => [{ c: "no default_fund_by column" }]);
  ok("§1 the deposit sheet's blank memo still asks: nobody CHOSE a default", chosen.c === null, chosen);
  const fl = (await api("GET", "/finance/funds", tok)).body || [];
  ok("§1 Finance's fund list marks General Operating, and only it, as the default", fl.filter(f => f.isOrgDefault).map(f => f.id).join() === gen.id, fl.map(f => [f.name, f.isOrgDefault]));
  const fd1 = (await api("GET", "/finance/funds-detail", tok)).body || {};
  ok("§1 the fund cards say Default on General Operating only", (fd1.funds || []).filter(f => f.isDefault).map(f => f.id).join() === gen.id, (fd1.funds || []).map(f => [f.name, f.isDefault]));
  // A default a person chose wins over "the oldest", in the write and on the screen alike.
  await setDefault(abbey.id, rb.user && rb.user.id || "u_person");
  const g1b = await give(ida, { amount: 30, date: today });
  const [g1brow] = await q(`SELECT g.fund_id, ft.fund_id AS ledger_fund FROM gifts g LEFT JOIN fin_transactions ft ON ft.gift_id = g.id WHERE g.id=$1`, [g1b]);
  const fl1b = (await api("GET", "/finance/funds", tok)).body || [];
  ok("§1 a default a person chose (orgs.default_fund_id) is where a no-fund gift and its ledger row land, and what the list marks",
    g1brow.fund_id === abbey.id && g1brow.ledger_fund === abbey.id && fl1b.filter(f => f.isOrgDefault).map(f => f.id).join() === abbey.id, { g1brow, marked: fl1b.filter(f => f.isOrgDefault).map(f => f.name) });
  await setDefault(gen.id, "system:defaultFund");

  // ── §2 Finance's fund figures = Reports' Gifts by fund ───────────────────
  console.log("\n§2 Finance's received this fiscal year = Reports' Gifts by fund");
  const jory = await person("Jory Pellwood");
  await give(jory, { amount: 250, date: addDays(today, -2), fundId: abbey.id });
  await give(jory, { amount: 500, date: addDays(today, -1), fundLines: [{ fundId: boat.id, amount: 300 }, { fundId: gen.id, amount: 200 }] });
  const big = await give(jory, { amount: 1000, date: today, fundId: boat.id });
  const rf = await api("POST", `/gifts/${big}/refund`, tok, { amount: 125.5, date: today, reason: "Part was meant for next year" });
  ok("§2 fixture: a split gift and a partial refund", rf.status < 300, rf.body);
  const fd2 = (await api("GET", "/finance/funds-detail", tok)).body || {};
  const card = id => (fd2.funds || []).find(f => f.id === id) || {};
  const from = fd2.fiscalYearFrom;
  const bg = (await api("GET", `/reports/by-group?groupBy=funds&from=${from}&to=${today}`, tok)).body || {};
  const row = id => ((bg.rows || []).find(r => r.source && r.source.params && r.source.params.fund === id) || {});
  ok("§2 Kestrel Boat Fund: Finance's received ($300 line + $1,000 − $125.50 = $1,174.50) is Reports' row, to the cent",
    card(boat.id).received && card(boat.id).received.cents === 117450 && cents(row(boat.id).total) === 117450, { finance: card(boat.id).received, reports: row(boat.id) });
  ok("§2 General Operating: $400 + the $200 line = $600 on both", card(gen.id).received && card(gen.id).received.cents === 60000 && cents(row(gen.id).total) === 60000,
    { finance: card(gen.id).received, reports: row(gen.id) });
  const agree2 = await assertSurfacesAgree(ORG, { token: tok, only: ["funds"], skip: ["flows11", "flows14", "flows18", "flows20"], soft: true, label: "§2" });
  ok("§2 the truth check's funds pass agrees for every fund (card = report row = rows opened; waiting = its rows)", agree2.ok, agree2.diffs);

  // ── §3 post to the books, and Undo ───────────────────────────────────────
  console.log("\n§3 Post to the books");
  const fyFrom = from;
  const imp = "imp_l3_" + run;
  const wren = await person("Wren Calloway");
  const by = ["system:ledger3-test", "Ledger 3 fixture"];
  // Two imported gifts this fiscal year on one deposit sheet (waiting), one from before it (history).
  const dep = `sheet:${addDays(today, -3)}`;
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,fund_id,import_id,deposit_ref,deposited_on,created_by,created_by_name)
           VALUES ($1,$2,$3,75.25,$4,'cash','Check',$5,$6,$7,$8,$9,$10), ($11,$2,$3,40.10,$4,'cash','Check',NULL,$6,$7,$8,$9,$10),
                  ($12,$2,$3,900,$13,'cash','Check',$5,$6,NULL,NULL,$9,$10)`,
    ["g_l3w1_" + run, ORG, wren, addDays(today, -3), boat.id, imp, dep, addDays(today, -3), ...by, "g_l3w2_" + run, "g_l3h_" + run, addDays(fyFrom, -30)]);
  // The totals kept on a person, by the one writer (NUMBERS-6), as the app leaves them.
  await require("../shared/numbers/donorTotals").recomputeOrgStoredTotals(require("../db").query, ORG);
  const ftCount = async () => Number((await q(`SELECT COUNT(*)::int AS n FROM fin_transactions WHERE org_id=$1`, [ORG]))[0].n);
  const before = await ftCount();
  const sum0 = (await api("GET", "/finance/summary", tok)).body || {};
  const lp = (await api("GET", "/finance/ledger-post", tok)).body || {};
  ok("§3 reading the waiting list writes nothing (a GET never changes state; imports never post on their own)", (await ftCount()) === before, { before, after: await ftCount() });
  const grp = (lp.groups || []).find(g => g.key === "ref:" + dep);
  ok("§3 the deposit lists its 2 gifts and their total, $115.35, before anything posts",
    grp && grp.n === 2 && grp.cents === 11535 && grp.label === `Deposit sheet, ${new Date(addDays(today, -3) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`, grp);
  ok("§3 the gift from before this fiscal year is history: in no deposit", !(lp.groups || []).some(g => g.key === "none" || g.cents === 90000), lp.groups);
  ok("§3 Finance's Waiting to post = Post to the books' list", !!lp.waiting && Number(sum0.ledgerStatus.waiting.cents) === Number(lp.waiting.cents) + Number(lp.undated.cents)
    && Number(sum0.ledgerStatus.history.cents) === 90000, { status: sum0.ledgerStatus, lp: [lp.waiting, lp.undated] });
  if (!grp) throw new Error("§3: no deposit to post (Post to the books is missing)");
  const stale = await api("POST", "/finance/ledger-post", tok, { groups: [{ key: grp.key, rows: grp.rows, cents: grp.cents + 1 }] });
  ok("§3 a deposit that is not what she saw is refused, and nothing posts", stale.status === 409 && (await ftCount()) === before, { status: stale.status, body: stale.body });
  const bal = (fd, id) => ((fd.funds || []).find(f => f.id === id) || {}).balanceCents;
  const posted = await api("POST", "/finance/ledger-post", tok, { groups: [{ key: grp.key, rows: grp.rows, cents: grp.cents }] });
  const fd3 = (await api("GET", "/finance/funds-detail", tok)).body || {};
  const rows3 = await q(`SELECT gift_id, fund_id, ROUND(amount*100)::int AS c, post_batch_id, created_by FROM fin_transactions WHERE org_id=$1 AND post_batch_id=$2 ORDER BY gift_id`, [ORG, posted.body && posted.body.batchId]);
  ok("§3 posting writes exactly two ledger rows, $115.35, stamped with the batch and her", posted.status === 201 && posted.body.n === 2 && posted.body.cents === 11535
    && rows3.length === 2 && rows3.reduce((a, r) => a + r.c, 0) === 11535 && rows3.every(r => r.created_by && !/^system:/.test(r.created_by)) && (await ftCount()) === before + 2, { body: posted.body, rows3 });
  ok("§3 each row is on its gift's fund; the gift with no fund posts to the default",
    rows3.find(r => r.gift_id === "g_l3w1_" + run)?.fund_id === boat.id && rows3.find(r => r.gift_id === "g_l3w2_" + run)?.fund_id === gen.id, rows3);
  ok("§3 the books move by the batch: Kestrel +$75.25, General Operating +$40.10",
    bal(fd3, boat.id) - bal(fd2, boat.id) === 7525 && bal(fd3, gen.id) - bal(fd2, gen.id) === 4010, { boat: [bal(fd2, boat.id), bal(fd3, boat.id)], gen: [bal(fd2, gen.id), bal(fd3, gen.id)] });
  const sum1 = (await api("GET", "/finance/summary", tok)).body || {};
  ok("§3 Posted grows and Waiting shrinks by exactly $115.35; History is untouched",
    sum1.ledgerStatus.posted.cents - sum0.ledgerStatus.posted.cents === 11535 && sum0.ledgerStatus.waiting.cents - sum1.ledgerStatus.waiting.cents === 11535
      && sum1.ledgerStatus.history.cents === 90000, { before: sum0.ledgerStatus, after: sum1.ledgerStatus });
  const again = await api("POST", "/finance/ledger-post", tok, { groups: [{ key: grp.key, rows: grp.rows, cents: grp.cents }] });
  ok("§3 the same deposit a second time posts nothing (it is not waiting any more)", again.status === 409 && (await ftCount()) === before + 2, { status: again.status, body: again.body });
  const undo = await api("POST", `/finance/ledger-post/${posted.body.batchId}/undo`, tok, {});
  const fd4 = (await api("GET", "/finance/funds-detail", tok)).body || {};
  const sum2 = (await api("GET", "/finance/summary", tok)).body || {};
  ok("§3 Undo removes exactly that batch: two rows, $115.35, and nothing else", undo.status === 200 && undo.body.undone === 2 && undo.body.cents === 11535 && (await ftCount()) === before
    && bal(fd4, boat.id) === bal(fd2, boat.id) && bal(fd4, gen.id) === bal(fd2, gen.id), { undo: undo.body, n: await ftCount(), before });
  ok("§3 after Undo the three figures are where they started, to the cent", ["posted", "waiting", "history"].every(k => sum2.ledgerStatus[k].cents === sum0.ledgerStatus[k].cents),
    { before: sum0.ledgerStatus, after: sum2.ledgerStatus });
  const [g1still] = await q(`SELECT COUNT(*)::int AS n FROM fin_transactions WHERE gift_id=$1`, [g1]);
  ok("§3 a live gift's own row is untouched by the Undo", g1still.n === 1, g1still);
  const undo2 = await api("POST", `/finance/ledger-post/${posted.body.batchId}/undo`, tok, {});
  ok("§3 a second Undo is refused", undo2.status === 409, undo2.body);
  const agree3 = await assertSurfacesAgree(ORG, { token: tok, only: ["funds"], skip: ["flows11", "flows14", "flows18", "flows20"], soft: true, label: "§3" });
  ok("§3 the truth check's funds pass still agrees after post and Undo", agree3.ok, agree3.diffs);

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });

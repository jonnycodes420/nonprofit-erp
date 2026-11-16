// tests/flows14.test.js · FLOWS-14: refund rows, households and owners, round three.
//
// The fleet's six, each driven the way the screen drives it (HTTP), each planted
// red against main's code before the fix (the PR says which), then asked of
// assertSurfacesAgree by name (tests/lib/flows14Checks.js):
//   §1 W-1115-Finance-07X   a deposit undone after its gift was refunded leaves no refund row;
//                           a refunded gift is deleted as a pair ("Delete the gift and its refund")
//   §2 W-1116-Fundraising-07 the Giving summary's average is its total over its gifts, after a
//                           refund too (the stored answer moves with it)
//   §3 W-1115-Finance-34X   a household member's ask is theirs, or says it is the household's
//   §4 W-1116-Fundraising-15X the thank-you starter's gift is the last gift, never a refund;
//                           a refund fires no gift trigger
//   §5 W-1115-Finance-02X   a gift refunded in full waits for no thanks, on Home's count too
//   §6 W-1115-Donors-06X    officer portfolios and Unassigned add up to the Donors tab
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilPlusDays, civilToday, mailTypesOn } = require("./helpers");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");

const ORG = "org_flows14", EMAIL = "admin@flows14.local", PASSWORD = "loadtest1234";
const U = { admin: "u_f14_admin", dana: "u_f14_dana" };
const C = v => Math.round(Number(v || 0) * 100);

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'Flows Fourteen','flows-fourteen',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ari Admin','admin'), ($5,$2,'dana@flows14.local',$4,'Dana Field','member')`,
    [U.admin, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4), U.dana]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_f14_gen',$1,'General Operating',false)`, [ORG]).catch(() => {});
  return login(EMAIL, PASSWORD);
}
const person = (id, name, extra = {}) => {
  const cols = { id, org_id: ORG, name, email: `${id}@flows14.example`, created_by: "test:flows14", created_by_name: "FLOWS-14 test", ...extra };
  const k = Object.keys(cols);
  return q(`INSERT INTO donors (${k.join(",")}) VALUES (${k.map((_, i) => "$" + (i + 1)).join(",")})`, k.map(x => cols[x]));
};
const gift = async (tok, donor, amount, extra = {}) => {
  const r = await api("POST", `/donors/${donor}/gifts`, tok, { amount, date: civilToday(), type: "cash", payment_method: "Check", fund_id: "ff_f14_gen", ...extra });
  return (r.body && (r.body.id || (r.body.gift && r.body.gift.id))) || null;
};
const refund = (tok, id, amount, reason = "charged twice") => api("POST", `/gifts/${id}/refund`, tok, { amount, date: civilToday(), reason });
const agreeOn = async (tok, names, label) => {
  const out = await assertSurfacesAgree(ORG, { token: tok, soft: true, only: names, label });
  ok(`${label}: assertSurfacesAgree (${names.join(", ")})`, out.ok, out.diffs);
};
const until = async (fn, tries = 20) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 500)); } return null; };

(async () => {
  const tok = await freshOrg();
  const today = civilToday();

  // ── §1 W-1115-Finance-07X · a refund goes with its gift ──
  {
    const dep = await api("POST", "/deposits/commit", tok, { paste: `Rowan Quill\t25.00\t2201`, depositDate: today, slipTotal: 25,
      resolutions: { 1: { fundId: "ff_f14_gen" } }, lines: [] });
    ok("§1 the deposit is recorded (the fixture)", dep.status < 300 && dep.body && dep.body.id, dep.status + " " + JSON.stringify(dep.body).slice(0, 200));
    const [g] = await q(`SELECT id, donor_id FROM gifts WHERE org_id=$1 AND import_id=$2`, [ORG, dep.body && dep.body.id]);
    const rf = g ? await refund(tok, g.id, 25) : { status: 0 };
    ok("§1 the deposited $25 is refunded in full (the fixture)", rf.status === 201, rf.body);
    const undo = await api("POST", `/imports/${dep.body && dep.body.id}/reverse`, tok, {});
    ok("§1 the deposit is undone", [200, 201, 202].includes(undo.status), undo.status + " " + JSON.stringify(undo.body).slice(0, 200));
    await until(async () => (await q(`SELECT reversed_at FROM imports WHERE id=$1`, [dep.body && dep.body.id]))[0]?.reversed_at);
    const left = await q(`SELECT id, amount FROM gifts WHERE org_id=$1 AND refund_of=$2`, [ORG, g && g.id]);
    ok("§1 undoing the deposit took its refund row with it (no −$25 left standing alone)", left.length === 0, left);

    await person("d_f14_pair", "Tamsin Pairwell");
    const pg = await gift(tok, "d_f14_pair", 40);
    await refund(tok, pg, 40);
    const refused = await api("DELETE", `/gifts/${pg}`, tok);
    ok("§1 a refunded gift alone is refused, and the refusal offers the pair", refused.status === 409 && refused.body.error === "has_refunds" && refused.body.pairButton === "Delete the gift and its refund", refused.body);
    const both = await api("DELETE", `/gifts/${pg}?withRefunds=1`, tok);
    const rows = await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id='d_f14_pair'`, [ORG]);
    ok("§1 Delete the gift and its refund: both rows gone, in one go", both.status === 200 && both.body.refundsRemoved === 1 && rows.length === 0, { status: both.status, body: both.body, rows });
    const [led] = await q(`SELECT COUNT(*)::int AS n FROM fin_transactions t WHERE t.org_id=$1 AND t.gift_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.id=t.gift_id)`, [ORG]);
    ok("§1 no ledger line is left pointing at either row", led.n === 0, led);
    await agreeOn(tok, ["orphanRefunds"], "§1");
  }

  // ── §2 W-1116-Fundraising-07 · the average is the total over the gifts ──
  {
    await person("d_f14_avg1", "Avery Mean"); await person("d_f14_avg2", "Bo Median");
    await gift(tok, "d_f14_avg1", 100); const g50 = await gift(tok, "d_f14_avg2", 50);
    // A refund row left standing by an undo before the fix (the fleet's Silas): written as the old undo left it.
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,refund_of,created_by,created_by_name) VALUES ('g_f14_orphan',$1,'d_f14_avg1',-25,$2,'refund','g_f14_gone','test:flows14','FLOWS-14 test')`, [ORG, today]);
    const gs = (await api("GET", `/reports/giving-summary?from=${civilPlusDays(-1)}&to=${today}`, tok)).body || {};
    ok("§2 the Giving summary: Total $125 over 2 gifts, Average $62.50 (Total ÷ Gifts, never the gifts' own average $75)",
      C(gs.total) === 12500 && Number(gs.giftCount) === 2 && C(gs.avgGift) === 6250, JSON.stringify({ total: gs.total, giftCount: gs.giftCount, avgGift: gs.avgGift }));
    await q(`DELETE FROM gifts WHERE id='g_f14_orphan' AND org_id=$1`, [ORG]);
    // The stored answer (the fiscal year, served from the store) moves with a refund.
    const fy1 = (await api("GET", "/reports/giving-summary?period=fiscal", tok)).body || {};
    const r = await refund(tok, g50, 10, "part back");
    const fy2 = (await api("GET", "/reports/giving-summary?period=fiscal", tok)).body || {};
    ok("§2 a refund moves the stored answer: Total less $10, and the Average still Total ÷ Gifts",
      r.status === 201 && C(fy2.total) === C(fy1.total) - 1000 && C(fy2.avgGift) === Math.round(C(fy2.total) / Number(fy2.giftCount)),
      JSON.stringify({ before: [fy1.total, fy1.giftCount, fy1.avgGift], after: [fy2.total, fy2.giftCount, fy2.avgGift] }));
    await agreeOn(tok, ["averageFoots"], "§2");
  }

  // ── §3 W-1115-Finance-34X · a person's ask reads their own gifts, or says it is the household's ──
  {
    await q(`INSERT INTO households (id,org_id,name) VALUES ('hh_f14',$1,'The Okafor household')`, [ORG]).catch(e => console.log("household insert:", e.message));
    await person("d_f14_sam1", "Samir Okafor", { household_id: "hh_f14" });
    await person("d_f14_sam2", "Samir T. Okafor", { household_id: "hh_f14" });
    await gift(tok, "d_f14_sam1", 250, { date: civilPlusDays(-60) }); await gift(tok, "d_f14_sam1", 125.5, { date: civilPlusDays(-30) });
    await gift(tok, "d_f14_sam2", 75.25, { date: civilPlusDays(-400) });
    const ins = await until(async () => { const b = (await api("GET", "/insights/donor/d_f14_sam2", tok)).body; return b && !b.preparing && !b.stale && /Ask \$/.test(JSON.stringify(b)) ? b : null; }, 30);
    const words = (JSON.stringify(ins || {}).match(/Ask \$[\d,]+: [^"]*/) || [""])[0];
    ok("§3 Samir T.'s ask names the household when it reads Samir's $250 (never 'largest gift $250' as his own)",
      !!words && (/the Okafor household's largest gift \$250/.test(words) || !/largest gift \$250/.test(words)), words || JSON.stringify(ins).slice(0, 300));
    await agreeOn(tok, ["askOwnGifts"], "§3");
  }

  // ── §4 W-1116-Fundraising-15X · the starter's gift is the last gift, never a refund ──
  {
    await person("d_f14_silas", "Silo Inglemere");
    await gift(tok, "d_f14_silas", 500, { date: civilPlusDays(-90) });
    const g25 = await gift(tok, "d_f14_silas", 25);
    await refund(tok, g25, 25);
    await mailTypesOn(ORG, "everyone");   // the preview names who a send reaches; nothing is sent
    const pv = (await api("POST", "/campaigns/segment-preview", tok, { segment: { mode: "manual", donorIds: ["d_f14_silas"] } })).body || {};
    ok("§4 the thank-you starter's preview reads the last gift: $500, never $-25 or the refunded $25",
      pv.first && pv.first.id === "d_f14_silas" && pv.first.giftAmount === "$500", JSON.stringify(pv.first));
    const [cnt] = await q(`SELECT COUNT(*)::int AS n FROM cultivation_plans WHERE org_id=$1 AND donor_id='d_f14_silas'`, [ORG]).catch(() => [{ n: 0 }]);
    const refundRow = (await q(`SELECT id FROM gifts WHERE org_id=$1 AND refund_of=$2`, [ORG, g25]))[0];
    const [ev] = refundRow ? await q(`SELECT payload FROM events_outbox WHERE org_id=$1 AND payload->>'giftId' = $2`, [ORG, refundRow.id]) : [];
    const { fires } = require("../server/outreach/handlers/giftFacts");
    ok("§4 a refund row fires no gift trigger (journeys, sequences)", !!ev && fires(ev.payload) === false, { payload: ev && ev.payload, plans: cnt });
    await agreeOn(tok, ["lastGiftIsGift"], "§4");
  }

  // ── §5 W-1115-Finance-02X · a gift refunded in full waits for no thanks, anywhere ──
  {
    const [o] = await q(`SELECT LEFT(created_at::text, 10) AS since FROM orgs WHERE id=$1`, [ORG]);
    const since = civilPlusDays(-500) < o.since ? civilPlusDays(-500) : o.since;
    const f = (await api("GET", `/figures/unthanked/rows?since=${since}&page=1&pageSize=200`, tok)).body || {};
    const ids = new Set((f.rows || []).map(r => r.id));
    const bad = await q(`SELECT id, amount, refunded_in_full FROM gifts WHERE org_id=$1 AND (amount < 0 OR refunded_in_full IS TRUE)`, [ORG]);
    ok("§5 Home's gifts not yet thanked lists no refund row and no gift refunded in full", bad.length > 0 && bad.every(b => !ids.has(b.id)), { listed: [...ids].length, bad: bad.filter(b => ids.has(b.id)) });
    const { thankState } = await import("../shared/thankState.js").catch(() => ({ thankState: () => ({}) }));   // red, not a crash, where it is missing
    ok("§5 a row's thank-you state: refunded in full → 'Refunded, no thank-you needed'; a refund row → none",
      thankState({ amount: 25, refunded_in_full: true }).words === "Refunded, no thank-you needed" && thankState({ amount: -25, refund_of: "g" }) === null
      && thankState({ amount: 25 }).key === "not_yet", "");
    await agreeOn(tok, ["thanksRule"], "§5");
  }

  // ── §6 W-1115-Donors-06X · the portfolios add up to the Donors tab ──
  {
    await q(`UPDATE donors SET assigned_to=$2, assigned_to_name='Ari Admin', stage='cultivate' WHERE org_id=$1 AND id IN ('d_f14_avg1','d_f14_sam1')`, [ORG, U.admin]);
    await q(`UPDATE donors SET assigned_to=$2, assigned_to_name='Dana Field', stage='steward' WHERE org_id=$1 AND id IN ('d_f14_avg2')`, [ORG, U.dana]);
    const r = (await api("GET", "/portfolio/officers", tok)).body || {};
    const tab = (await api("GET", "/donors?role=donor&limit=1", tok)).body || {};
    const off = (r.officers || []).reduce((n, o) => n + Number(o.portfolio_count), 0);
    const un = r.file && r.file.unassigned ? Number(r.file.unassigned.portfolio_count) : null;
    ok("§6 the strip has an Unassigned row, and officers + Unassigned = the Donors tab",
      un != null && off + un + (r.file.other ? r.file.other.count : 0) === Number(tab.total) && /add up to the \d+ donors on the Donors tab/.test(r.file.sentence || ""),
      JSON.stringify({ off, un, tab: tab.total, sentence: r.file && r.file.sentence }));
    const owner = (await api("GET", "/donors?role=donor&limit=50&assignedTo=none", tok)).body || {};
    ok("§6 the Owner filter's Unassigned is the strip's row", owner.total === un && (owner.donors || []).every(d => !d.assigned_to), { total: owner.total, un });
    await agreeOn(tok, ["portfolioFoots"], "§6");
  }

  summary("flows14");
  await closeDb();
})().catch(async e => { console.error(e); ok("flows14 ran to the end", false, e.message); summary("flows14"); await closeDb().catch(() => {}); });

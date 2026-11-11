// tests/money4.test.js: MONEY-4. GRANTS, REFUNDS, OFFLINE RECURRING, EIN AND IMPORT FOOTING.
// Guards money, donor data and what a donor sees. One fresh org (made-up names), then:
//   §1 W-1107-Finance-31 / W-1109-Finance-33: Wexford (awarded $120,000, no award
//      row) says "Awarded $120,000 · $0 received of $120,000", never "No payments
//      set up"; NEA (awarded, no amount, $35,000 typed Received) records its
//      award from the ask and the $35,000 becomes its first payment (GIFTS-1's
//      path). An awarded grant's application deadlines disappear from the
//      Deadlines list, the Calendar and Home's count; its report deadline stays.
//      scripts/ops/money4-grant-awards.js lists what it would record.
//   §2 W-1109-Finance-27: Record a refund. A partial refund nets the total and
//      keeps the count; the receipt is voided and reissued for the net. A full
//      refund drops the count and voids the receipt. A Stripe gift asks first,
//      naming the amount, then refunds in Stripe (mocked) once; Stripe's echo
//      changes nothing.
//   §3 W-1107-Finance-24: Recurring giving lists offline plans with a Source,
//      and MRR includes them ($250 monthly + $60 weekly = $510, by hand).
//   §4 W-1109-Fundraising-35X: the footer's EIN is orgs.ein; the editor's copy
//      is not read and can no longer be saved. scripts/ops/money4-ein-copies.js lists the org.
//   §5 W-1109-Finance-15 / W-1109-Atlas-13X: an import foots in rows AND dollars
//      ("File $13,650 = imported $3,675 + set aside $9,975 (future-dated
//      $3,375; matches deleted people $6,600) ✓"), and the list's flag is the
//      receipt's footing: a row whose columns disagree reads ✗ in both, even
//      with a stored "reconciled" in its summary.
//   §6 (browser, production build) the same screens, by clicks.
// HOW IT GOES RED ON MAIN: "payments not set up" / "No payments set up", no
// first payment, closed deadlines listed and counted (§1); no refund route (§2);
// offline plans missing and MRR $0 (§3); footer 84-2917365 (§4); no footing (§5).
// PLANTED: GET /imports's flag reads summary.reconciled instead of the footing → §5 red.
// Tests set their own clock (tests/clock.js). Sends nothing; Stripe is a local mock.
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { ok, summary, login, api, q, closeDb, browserLegOrSkip, STRIPE_MOCK_PORT } = require("./helpers");
const { civilDay, dayOffset } = require("./clock");
const { DIST } = require("./lib/dist");

const ORG = "org_money4";
const SLUG = "money4-larkspur";
const PASSWORD = "loadtest1234";
const EMAIL = `${ORG}@test.local`;
const TODAY = civilDay(undefined, "America/New_York");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const optional = f => { try { return require(f); } catch { return null; } };
const ACT = ["system:test/money4", "MONEY-4 test"];

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,legal_name,ein,receipt_address,receipts_enabled,stripe_account_id,stripe_connected)
           VALUES ($1,'Larkspur Money Four Trust',$2,1,'active','team','America/New_York','Larkspur Money Four Trust Inc','82-4331907','9 Fixture Lane',true,'acct_money4',true)`, [ORG, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ottoline Brack','admin')`, ["u_" + ORG, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
async function person(id, name, kind = "individual", deleted = false) {
  await q(`INSERT INTO donors (id,org_id,name,email,kind,person_types,created_by,created_by_name,deleted_at) VALUES ($1,$2,$3,$4,$5,'["donor"]'::jsonb,$6,$7,${deleted ? "NOW()" : "NULL"})`,
    [id, ORG, name, `${id}@money4.example.org`, kind, ...ACT]);
  return id;
}
const gift = async (tok, donor, body) => { const r = await api("POST", `/donors/${donor}/gifts`, tok, { idempotencyKey: crypto.randomUUID(), ...body }); return { ...r, id: r.body && (r.body.gift ? r.body.gift.id : r.body.id) }; };
const one = async (sql, a) => (await q(sql, a))[0] || {};

// The Stripe mock: every request recorded, a refund answered as made.
const stripeCalls = [];
function stripeMock() {
  return new Promise(res => {
    const srv = http.createServer((req, r) => { let b = ""; req.on("data", d => b += d); req.on("end", () => {
      stripeCalls.push({ url: req.url, body: b, account: req.headers["stripe-account"] || "" });
      r.setHeader("content-type", "application/json");
      r.end(JSON.stringify(req.url.startsWith("/v1/refunds") ? { id: "re_money4", object: "refund", status: "succeeded" } : { ok: true }));
    }); });
    srv.on("error", () => res(null));
    srv.listen(STRIPE_MOCK_PORT, () => res(srv));
  });
}
const stripeLib = require("stripe");
async function fire(evt) {
  const payload = JSON.stringify(evt);
  const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest" });
  return (await fetch((process.env.BASE || "http://localhost:5601") + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload })).status;
}

(async () => {
  const tok = await freshOrg();
  const mock = await stripeMock();
  const GA = await import("../shared/grantAwardLine.js");
  const { deadlineWord } = await import("../shared/grantDeadline.js");

  // ── §1 · GRANTS: ONE STATE MACHINE ─────────────────────────────────────
  console.log("\n— §1 · Wexford and NEA —");
  await person("d_m4t_wexford", "Wexford Foundation", "organization");
  await person("d_m4t_nea", "Northbay Endowment for the Arts", "organization");
  await q(`INSERT INTO grants (id,org_id,funder,funder_donor_id,program,status,amount,amount_requested,amount_awarded,deadline,created_by,created_by_name)
           VALUES ('gr_m4t_wexford',$1,'Wexford Foundation','d_m4t_wexford','Harbour literacy','awarded',120000,120000,120000,$2,$3,$4)`, [ORG, dayOffset(37), ...ACT]);
  await q(`INSERT INTO grants (id,org_id,funder,funder_donor_id,program,status,amount,amount_requested,amount_awarded,received,deadline,created_by,created_by_name)
           VALUES ('gr_m4t_nea',$1,'Northbay Endowment for the Arts','d_m4t_nea','Summer arts','awarded',50000,50000,NULL,35000,$2,$3,$4)`, [ORG, dayOffset(20), ...ACT]);
  for (const [id, kind, d] of [["gm_m4t_loi", "loi_due", 5], ["gm_m4t_dec", "decision", 9], ["gm_m4t_rep", "report_due", 6]])
    await q(`INSERT INTO grant_milestones (id,org_id,grant_id,kind,due_date,state,created_by,created_by_name) VALUES ($1,$2,'gr_m4t_wexford',$3,$4,'pending',$5,$6)`, [id, ORG, kind, dayOffset(d), ...ACT]);
  const grantG = async id => { const g = (await api("GET", `/grants/${id}`, tok)).body || {};
    return { amount: Number(g.amount), amountAwarded: Number(g.amount_awarded) || 0, received: Number(g.received) || 0, status: g.status, deadline: String(g.deadline || "").slice(0, 10), awardPledgeId: g.award_pledge_id || null }; };
  const W = await grantG("gr_m4t_wexford");
  const wl = GA.grantAwardLine(W) || {};
  ok("§1 Wexford says Awarded $120,000 · $0 received of $120,000, never 'payments not set up'", wl.text === "Awarded $120,000 · $0 received of $120,000" && !/not set up/.test(wl.text), wl);
  const wt = GA.grantMoneyTiles(W, (d, o) => deadlineWord(d, TODAY, o), { pursuing: false });
  const tv = k => (wt.find(x => x.key === k) || {}).value;
  ok("§1 Wexford's tiles: Awarded $120,000, Received $0, Remaining $120,000, no 'No payments set up'",
    tv("awarded") === "$120,000" && tv("received") === "$0" && tv("remaining") === "$120,000" && !wt.some(x => /No payments/.test(String(x.value))), wt);
  const wp = (await api("GET", "/grants/gr_m4t_wexford/award-plan", tok)).body || {};
  ok("§1 Wexford's award panel reads from payments: $0 received of $120,000 awarded", wp.sentence === "$0.00 received of $120,000.00 awarded, $120,000.00 still to come." && wp.awardedCents === 12000000, wp);
  const N = await grantG("gr_m4t_nea");
  const nl = GA.grantAwardLine(N) || {};
  const nt = GA.grantMoneyTiles(N, (d, o) => deadlineWord(d, TODAY, o), { pursuing: false });
  ok("§1 NEA says one story: Awarded · $35,000 received · award amount not recorded · Record the award",
    nl.text === "Awarded · $35,000 received · award amount not recorded ·" && nl.action === "Record the award"
    && (nt.find(x => x.key === "received") || {}).value === "$35,000" && (nt.find(x => x.key === "awarded") || {}).value === "Not recorded", { nl, nt });
  const npPlan = (await api("GET", "/grants/gr_m4t_nea/award-plan", tok)).body || {};
  ok("§1 NEA's Record the award is prefilled from the ask ($50,000)", npPlan.askCents === 5000000, npPlan);
  // the script, before anything is recorded
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest" });
  const cl = await pool.connect();
  const lines = [];
  const dry = await require("../scripts/ops/money4-grant-awards.js").run({ client: cl, orgId: ORG, log: l => lines.push(l) });
  ok("§1 the grant script (dry run) would record both awards, NEA from its ask with its $35,000 as the first payment",
    dry.recorded === 2 && dry.rows.find(r => r.grantId === "gr_m4t_nea").amountCents === 5000000 && /\$35,000\.00 typed Received becomes its first payment/.test(lines.join("\n"))
    && (await one(`SELECT COUNT(*)::int AS n FROM pledges WHERE org_id=$1`, [ORG])).n === 0, lines);
  // moving to Awarded asks for the award (the stage machine)
  await q(`INSERT INTO grants (id,org_id,funder,funder_donor_id,program,status,amount,amount_requested,created_by,created_by_name) VALUES ('gr_m4t_sub',$1,'Wexford Foundation','d_m4t_wexford','Next year','submitted',8000,8000,$2,$3)`, [ORG, ...ACT]);
  const mv = await api("PATCH", "/grants/gr_m4t_sub/stage", tok, { status: "awarded" });
  ok("§1 moving to Awarded without an award asks for it (award_required)", mv.status === 409 && mv.body.code === "award_required", mv.body);
  // NEA's award, recorded the way the button records it
  const aw = await api("PUT", "/grants/gr_m4t_nea/award", tok, { amountAwarded: 50000, installmentCount: 1 });
  const first = await q(`SELECT amount::float AS a, external_id FROM gifts WHERE org_id=$1 AND donor_id='d_m4t_nea'`, [ORG]);
  ok("§1 recording NEA's award turns its $35,000 into the first payment (GIFTS-1's path, once)",
    aw.status === 200 && first.length === 1 && first[0].a === 35000 && first[0].external_id === "gifts1-received:gr_m4t_nea" && aw.body.firstPayment && aw.body.firstPayment.cents === 3500000, { aw: aw.body, first });
  const np = (await api("GET", "/grants/gr_m4t_nea/award-plan", tok)).body || {};
  const N2 = await grantG("gr_m4t_nea");
  ok("§1 NEA then reads $35,000 received of $50,000, Remaining $15,000", np.receivedCents === 3500000 && np.outstandingCents === 1500000 && N2.received === 35000 && N2.amountAwarded === 50000, { np, N2 });
  const aw2 = await api("PUT", "/grants/gr_m4t_nea/award", tok, { amountAwarded: 50000 });
  ok("§1 a second press writes no second payment", aw2.status === 200 && (await one(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND donor_id='d_m4t_nea'`, [ORG])).n === 1);
  // deadlines
  const dl = ((await api("GET", "/grants/deadlines", tok)).body || {}).milestones || [];
  const wex = dl.filter(m => m.grantId === "gr_m4t_wexford");
  ok("§1 Wexford's application deadlines (LOI, decision, its own date) disappear from Deadlines; its report stays",
    wex.length === 1 && wex[0].kind === "report_due", wex.map(m => [m.kind, m.id, m.band]));
  const cal = ((await api("GET", `/calendar/items?from=${TODAY}&to=${dayOffset(40)}&types=deadline`, tok)).body || {}).items || [];
  ok("§1 the Calendar draws only Wexford's report deadline", cal.filter(i => i.ref && i.ref.grantId === "gr_m4t_wexford").map(i => i.ref.milestoneId).join() === "gm_m4t_rep", cal.map(i => i.title));
  const home = (await api("GET", "/dashboard/home", tok)).body || {};
  ok("§1 Home counts one grant deadline soon (the report), not three", home.grantDeadlinesSoon === 1, home.grantDeadlinesSoon);

  // ── §2 · RECORD A REFUND ───────────────────────────────────────────────
  console.log("\n— §2 · refunds —");
  const JUNO = await person("d_m4t_juno", "Juno Calloway");
  const g500 = await gift(tok, JUNO, { amount: 500, date: dayOffset(-10) });
  const g120 = await gift(tok, JUNO, { amount: 120, date: dayOffset(-30) });
  const rc = await api("POST", `/gifts/${g500.id}/receipt`, tok, { send: false });
  const sumOf = async () => one(`SELECT total_giving::float AS t, gift_count AS n FROM donors WHERE id=$1`, [JUNO]);
  ok("fixture: $620 in two gifts, the $500 receipted", (await sumOf()).t === 620 && (await sumOf()).n === 2 && rc.status === 201, await sumOf());
  const noWhy = await api("POST", `/gifts/${g500.id}/refund`, tok, { amount: 200, date: TODAY });
  ok("§2 a refund needs a reason", noWhy.status === 400 && noWhy.body.error === "reason_required", noWhy.body);
  const p1 = await api("POST", `/gifts/${g500.id}/refund`, tok, { amount: 200, date: TODAY, reason: "Charged twice for the gala table" });
  const s1 = await sumOf();
  const orig = await one(`SELECT amount::float AS a, refunded_in_full FROM gifts WHERE id=$1`, [g500.id]);
  const neg = await q(`SELECT amount::float AS a, refund_of, refund_reason, created_by FROM gifts WHERE org_id=$1 AND refund_of=$2`, [ORG, g500.id]);
  ok("§2 a partial refund writes a linked negative row and keeps the gift as it was",
    p1.status === 201 && orig.a === 500 && !orig.refunded_in_full && neg.length === 1 && neg[0].a === -200 && neg[0].refund_reason === "Charged twice for the gala table" && neg[0].created_by === "u_" + ORG, { p1: p1.body, orig, neg });
  ok("§2 the total nets it out ($420) and the count stays 2", s1.t === 420 && s1.n === 2, s1);
  const rcs = await q(`SELECT receipt_number, amount::float AS a, voided_at IS NOT NULL AS v, void_reason FROM receipts WHERE org_id=$1 AND gift_id=$2 ORDER BY created_at`, [ORG, g500.id]);
  ok("§2 the receipt is voided and reissued for the net $300", rcs.length === 2 && rcs[0].v && /Refunded \$200/.test(rcs[0].void_reason) && !rcs[1].v && rcs[1].a === 300
    && p1.body.sentence === `Recorded a $200 refund of the $500 gift; $300 remains. Receipt #${rcs[0].receipt_number} is void, and #${rcs[1].receipt_number} for $300 is ready.`, { rcs, s: p1.body.sentence });
  const lst = ((await api("GET", `/donors/${JUNO}/receipts`, tok)).body || []).find(r => !r.voided_at && r.gift_id === g500.id) || {};
  ok("§2 the reissued receipt carries no 'gift changed' flag (the gift's net is $300)", lst.id && !lst.drift, lst);
  const over = await api("POST", `/gifts/${g500.id}/refund`, tok, { amount: 400, date: TODAY, reason: "x" });
  ok("§2 more than what is left is refused, saying what is left", over.status === 409 && over.body.sentence === "Only $300 of this $500 gift is left to refund.", over.body);
  const p2 = await api("POST", `/gifts/${g500.id}/refund`, tok, { amount: 300, date: TODAY, reason: "Donor asked for the rest back" });
  const s2 = await sumOf();
  const last = await one(`SELECT last_gift_amount::float AS a FROM donors WHERE id=$1`, [JUNO]);
  ok("§2 a full refund drops the count to 1 and the total to $120; the last gift is no longer the refunded one",
    p2.status === 201 && p2.body.full === true && s2.t === 120 && s2.n === 1 && last.a === 120, { s2, last, b: p2.body });
  ok("§2 and voids the receipt with nothing reissued", (await one(`SELECT COUNT(*)::int AS n FROM receipts WHERE gift_id=$1 AND voided_at IS NULL`, [g500.id])).n === 0);
  const del = await api("DELETE", `/gifts/${g500.id}`, tok);
  ok("§2 a refunded gift stays with its refund (no delete leaving the negative row alone)", del.status === 409 && del.body.error === "has_refunds", del.body);
  // Stripe
  await q(`UPDATE gifts SET stripe_payment_id='pi_money4_120', payment_method='Card' WHERE id=$1`, [g120.id]);
  stripeCalls.length = 0;
  const ask = await api("POST", `/gifts/${g120.id}/refund`, tok, { amount: 50, date: TODAY, reason: "Event cancelled" });
  ok("§2 a Stripe gift asks first, naming the amount, and nothing moves", ask.status === 409 && ask.body.error === "stripe_confirm"
    && ask.body.sentence === "This gift was paid by card through Stripe. Refunding it sends $50 back to Juno Calloway's card. Refund $50?"
    && stripeCalls.length === 0 && (await one(`SELECT COUNT(*)::int AS n FROM gifts WHERE refund_of=$1`, [g120.id])).n === 0, ask.body);
  const wrongAmt = await api("POST", `/gifts/${g120.id}/refund`, tok, { amount: 50, date: TODAY, reason: "Event cancelled", confirmStripe: true, confirmAmount: 60 });
  ok("§2 a confirm that names another amount moves nothing", wrongAmt.status === 409 && stripeCalls.length === 0, wrongAmt.body);
  const yes = await api("POST", `/gifts/${g120.id}/refund`, tok, { amount: 50, date: TODAY, reason: "Event cancelled", confirmStripe: true, confirmAmount: 50 });
  const rf = stripeCalls.filter(c => c.url.startsWith("/v1/refunds"));
  ok("§2 on the confirm, one Stripe refund for 5000 cents on the org's account, then the row", !mock ? true
    : yes.status === 201 && rf.length === 1 && /payment_intent=pi_money4_120/.test(rf[0].body) && /amount=5000\b/.test(rf[0].body) && rf[0].account === "acct_money4", { yes: yes.body, rf });
  const echo = await fire({ id: "evt_money4_echo", type: "charge.refunded", account: "acct_money4", data: { object: { id: "ch_money4", payment_intent: "pi_money4_120", amount: 12000, amount_refunded: 5000 } } });
  const g120now = await one(`SELECT amount::float AS a FROM gifts WHERE id=$1`, [g120.id]);
  ok("§2 Stripe's charge.refunded echo changes nothing (the gift stays $120, its refund $50)", echo === 200 && g120now.a === 120
    && (await one(`SELECT -SUM(amount)::float AS r FROM gifts WHERE refund_of=$1`, [g120.id])).r === 50, { echo, g120now });

  // ── §3 · RECURRING GIVING ──────────────────────────────────────────────
  console.log("\n— §3 · offline plans on Recurring giving —");
  const ROW = await person("d_m4t_rowan", "Rowan Fairweather");
  const WEN = await person("d_m4t_wendell", "Wendell Ashgrove");
  const pl1 = await api("POST", `/donors/${ROW}/offline-plans`, tok, { amount: 250, frequency: "monthly", startDate: dayOffset(-15), method: "Check" });
  const pl2 = await api("POST", `/donors/${WEN}/offline-plans`, tok, { amount: 60, frequency: "weekly", startDate: dayOffset(-3), method: "Cash" });
  const roster = ((await api("GET", "/recurring/roster", tok)).body || {}).subs || [];
  const offl = roster.filter(s => s.source === "offline");
  ok("§3 both offline plans are listed, each with its Source", pl1.status === 201 && pl2.status === 201 && offl.length === 2 && offl.every(s => s.sourceLabel === "Recorded by staff · offline"), roster);
  const movement = (await api("GET", "/recurring/movement", tok)).body || {};
  ok("§3 MRR includes them: $250 + $60 × 52 / 12 = $510, labeled", movement.mrr === 510 && movement.mrrOffline === 510 && movement.mrrCard === 0
    && movement.mrrWords === "$510 a month, all from 2 offline plans recorded by staff.", movement);

  // ── §4 · ONE EIN ───────────────────────────────────────────────────────
  console.log("\n— §4 · the EIN —");
  await q(`INSERT INTO portal_settings (org_id, enabled, ein_line) VALUES ($1, true, 'Tax ID (EIN): 84-2917365') ON CONFLICT (org_id) DO UPDATE SET enabled=true, ein_line=EXCLUDED.ein_line`, [ORG]);
  const cfg = (await api("GET", `/portal/${SLUG}/config`, null)).body || {};
  ok("§4 the public footer reads the Tax Receipts EIN (82-4331907), never the editor's copy", cfg.theme && cfg.theme.einLine === "Tax ID (EIN): 82-4331907", cfg.theme && cfg.theme.einLine);
  await api("PUT", "/portal-settings", tok, { einLine: "Tax ID (EIN): 11-2223334" });
  ok("§4 the editor can no longer save an EIN of its own", (await one(`SELECT ein_line FROM portal_settings WHERE org_id=$1`, [ORG])).ein_line === "Tax ID (EIN): 84-2917365"
    && ((await api("GET", "/portal-settings", tok)).body || {}).ein_line === "Tax ID (EIN): 82-4331907");
  const einLines = [];
  const ein = await require("../scripts/ops/money4-ein-copies.js").run({ client: cl, log: l => einLines.push(l) });
  ok("§4 the EIN script lists this org's differing copy", ein.some(r => r.orgId === ORG && r.kind === "differs"), einLines);
  cl.release(); await pool.end();

  // ── §5 · IMPORT FOOTING ────────────────────────────────────────────────
  console.log("\n— §5 · an import foots in rows and dollars —");
  for (const i of [1, 2, 3]) await person(`d_m4t_gone${i}`, ["", "Perpetua Gone", "Bartholomew Gone", "Isadora Gone"][i], "individual", true);
  const grid = [["Date", "Donor", "Email", "Amount"]];
  for (let i = 0; i < 14; i++) grid.push([dayOffset(-40 + i), `Reader ${String.fromCharCode(65 + i)} Thornwood`, `reader${i}@money4.example.org`, String(100 + i * 25)]);
  for (let i = 0; i < 3; i++) grid.push([dayOffset(30 + i), `Future ${String.fromCharCode(65 + i)} Ashby`, `future${i}@money4.example.org`, String(1000 + i * 125)]);
  for (const i of [1, 2, 3]) grid.push([dayOffset(-20), ["", "Perpetua Gone", "Bartholomew Gone", "Isadora Gone"][i], `d_m4t_gone${i}@money4.example.org`, String(2000 + i * 100)]);
  // By hand: 14 gifts $100..$425 = $3,675; future-dated $1,000+$1,125+$1,250 = $3,375; deleted $2,100+$2,200+$2,300 = $6,600; file $13,650.
  const body = { fileName: "test-donors.csv", sheets: [{ name: "Sheet1", grid }] };
  await api("POST", "/sheet-import/understand", tok, body);
  const c = await api("POST", "/sheet-import/commit", tok, { ...body, background: true });
  for (let i = 0; i < 400 && c.status === 202; i++) { const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(c.body.importId)}`, tok); if (j.body.status !== "running") break; await new Promise(r => setTimeout(r, 150)); }
  const IMP = c.body.importId;
  const rec = ((await api("GET", `/imports/${IMP}`, tok)).body || {}).import || {};
  // TRUTH-6: the future-dated rows come in as scheduled, never set aside.
  const FOOT = "File $13,650 = imported $3,675 + scheduled $3,375 + set aside $6,600 (matches deleted people $6,600) ✓";
  ok("§5 the receipt foots in dollars, the set-aside named by reason", rec.footing && rec.footing.dollarsSentence === FOOT, rec.footing);
  ok("§5 and in rows", rec.footing && rec.footing.rowsSentence === "20 rows in the file = 17 written + 3 set aside ✓", rec.footing && rec.footing.rowsSentence);
  const listRow = async () => ((await api("GET", "/imports", tok)).body.imports || []).find(x => x.id === IMP) || {};
  const lr = await listRow();
  ok("§5 the list's flag is the receipt's footing (both reconciled)", lr.reconciled === true && rec.reconciled === true && !!rec.footing && rec.footing.balanced === true, lr);
  // An existing row whose columns disagree with its ledger, with a stored "reconciled" in its summary.
  await q(`UPDATE imports SET rows_set_aside = rows_set_aside + 1, summary_json = (summary_json::jsonb || '{"reconciled": true}'::jsonb)::text WHERE id=$1`, [IMP])
    .catch(() => q(`UPDATE imports SET rows_set_aside = rows_set_aside + 1, summary_json = summary_json || '{"reconciled": true}'::jsonb WHERE id=$1`, [IMP]));
  const lr2 = await listRow();
  const rec2 = ((await api("GET", `/imports/${IMP}`, tok)).body || {}).import || {};
  ok("§5 a row that does not foot reads ✗ on the list AND on its receipt, never one of each", lr2.reconciled === false && rec2.reconciled === false && !!rec2.footing && rec2.footing.balanced === false
    && /✗$/.test(rec2.footing.rowsSentence) && lr2.footing && lr2.footing.balanced === false, { lr2: [lr2.reconciled, lr2.findings], rec2: [rec2.reconciled, rec2.footing && rec2.footing.rowsSentence] });
  await q(`UPDATE imports SET rows_set_aside = rows_set_aside - 1 WHERE id=$1`, [IMP]);

  // ── §6 · THE BROWSER (production build) ────────────────────────────────
  const why = (() => {
    if (!optional(PW)) return "(playwright is not installed at " + PW + ")";
    if (!fs.existsSync(path.join(DIST, "index.html")) && !fs.existsSync(path.join(DIST, "app.html"))) return "(no client dist at " + DIST + ")";
    return null;
  })();
  if (browserLegOrSkip(why, "(browser leg)")) { if (mock) mock.close(); await closeDb(); summary(); return; }
  console.log("\n— §6 · the browser —");
  const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
    [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
  const txt = async sel => ((await page.locator(sel).first().innerText({ timeout: 10000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
  try {
    await page.goto(`${APP}/app/grants?grant=gr_m4t_wexford`, { waitUntil: "networkidle", timeout: 60000 });
    const gp = await txt('[data-testid="grant-profile"]');
    ok("§6 Wexford's page: $0 received of $120,000, no 'No payments set up', no Application Deadline date",
      gp.includes("Awarded $120,000 · $0 received of $120,000") && !/No payments set up|not set up/.test(gp) && !/Application Deadline/.test(gp), gp.slice(0, 500));
    const RUBY = await person("d_m4t_ruby", "Ruby Halloran");
    await gift(tok, RUBY, { amount: 80, date: dayOffset(-4) });
    await page.goto(`${APP}/donors/${RUBY}`, { waitUntil: "networkidle" });
    await page.locator("button,[role=tab]", { hasText: /^Giving/ }).first().click();
    await page.locator('[data-testid="dp-gift-refund"]').first().click({ timeout: 15000 });
    await page.locator('[data-testid="refund-amount"]').fill("30");
    await page.locator('[data-testid="refund-reason"]').fill("Wrong amount keyed");
    await page.locator('[data-testid="refund-save"]').click();
    const done = await txt('[data-testid="refund-done"]');
    ok("§6 Record a refund by clicks says what it did", done === "Recorded a $30 refund of the $80 gift; $50 remains.", done);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.locator('[data-testid="dp-gift-refunded"]').first().waitFor({ timeout: 10000 }).catch(() => {});
    const lbl = await txt('[data-testid="dp-gift-refunded"]');
    ok("§6 the gift says it was refunded, beside its amount", lbl === "Refunded $30, net $50", lbl);
    await page.goto(`${APP}/app/fundraising`, { waitUntil: "networkidle" });
    await page.getByText("Money in", { exact: true }).first().click();
    await page.getByText("Recurring giving", { exact: true }).first().click();
    await page.locator('[data-testid="rec-source"]').first().waitFor({ timeout: 12000 }).catch(() => {});
    const mw = await txt('[data-testid="rec-mrr-words"]');
    const src = await page.locator('[data-testid="rec-source"]').allInnerTexts().catch(() => []);
    ok("§6 Recurring giving lists the offline plans with their Source, and MRR says so", src.filter(s => s.includes("Offline")).length === 2 && mw === "$510 a month, all from 2 offline plans recorded by staff.", { src, mw });
    await page.goto(`${APP}/portal/${SLUG}`, { waitUntil: "networkidle" });
    const body6 = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    ok("§6 the portal footer shows the one EIN", body6.includes("Tax ID (EIN): 82-4331907") && !body6.includes("84-2917365"), body6.slice(-300));
    await page.goto(`${APP}/app/settings?section=imports`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="imports-open"]', { hasText: "test-donors.csv" }).first().click({ timeout: 15000 });
    const foot = await txt('[data-testid="import-receipt-footing-dollars"]');
    ok("§6 the import receipt foots in dollars", foot === FOOT, foot);
  } finally { await browser.close(); }
  if (mock) mock.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });

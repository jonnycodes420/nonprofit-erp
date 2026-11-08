// tests/pledges2.test.js: PLEDGES-2. PLEDGES, RECURRING GIFTS AND "WHAT THEY
// SUPPORT" BEHAVE LIKE A BOOKKEEPER EXPECTS.
// Guards money and donor data. One fresh org (made-up names), then:
//   §1 W-1107-Finance-25X: $150 against four $100 installments applies oldest
//      due first and the $50 over carries to the next one; a payment above the
//      balance asks (an extra gift, or reduce to the balance) and writes nothing
//      until it is answered.
//   §2 W-1107-Finance-20X: Next move after the payment says this fiscal year's
//      part from what was paid ($150 left, not $100), from shared/numbers/pledges.js.
//   §3 W-1107-Finance-18X: deleting a pledge leaves no "Pledged" line, no
//      collect task and no collect move; the timeline says one "Pledge deleted"
//      line, and Undo puts it all back.
//   §4 W-1107-Finance-30X: Write off asks first, naming the amount; confirmed,
//      it writes an audit row and can be undone.
//   §5 W-1107-Finance-24/-23: an offline recurring plan: create, Behind when a
//      payment is late, add payments, turn a gift on file into one, cancel asks.
//   §6 (browser) W-1107-Finance-20: after a payment the rail and the Giving tab
//      say the same count, with no reload; W-1107-Finance-01X: switching
//      profiles fast, each "What they support" panel shows that person's funds.
// HOW IT GOES RED ON MAIN: $150 flags no installment (§1); no question above the
// balance (§1); "This year's part" counts unflagged installments (§2); the
// "Pledged" line stays (§3); write-off on one PUT (§4); no plan routes (§5);
// "4 installments" beside "3 left", and the last person's funds on the next (§6).
// PLANTED: pledgePayments.relay skipped (the overage dropped) → §1 red.
// Tests set their own clock (tests/clock.js). Sends nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { ok, summary, login, api, q, closeDb, browserLegOrSkip, drainQueue } = require("./helpers");
const { civilDay, dayOffset } = require("./clock");
const { DIST } = require("./lib/dist");

const ORG = "org_pledges2";
const PASSWORD = "loadtest1234";
const EMAIL = `${ORG}@test.local`;
const TODAY = civilDay(undefined, "America/New_York");
const C = v => Math.round(Number(v || 0) * 100);
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const optional = f => { try { return require(f); } catch { return null; } };
const plusDays = n => dayOffset(n);

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  // The fiscal year starts this month, so it runs eleven months past today: the
  // first three installments below fall in it, the fourth (400 days on) does not.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,vocabulary_json)
           VALUES ($1,'Pledge Two Lantern Guild',$2,1,'active','team','America/New_York',$3)`,
    [ORG, ORG.replace(/_/g, "-"), JSON.stringify({ fiscal_year_start_month: Number(TODAY.slice(5, 7)) })]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Odile Farrant','admin')`, ["u_" + ORG, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
async function person(id, name) {
  await q(`INSERT INTO donors (id,org_id,name,email,kind,person_types,created_by,created_by_name) VALUES ($1,$2,$3,$4,'individual','["donor"]'::jsonb,'system:test/pledges2','PLEDGES-2 test')`,
    [id, ORG, name, `${id}@pledges2.example.org`]);
  return id;
}
const pledgeOf = async (tok, donor, id) => ((await api("GET", `/donors/${donor}/pledges`, tok)).body || []).find(p => p.id === id);
const instRows = id => q(`SELECT seq, LEFT(due_date::text,10) AS due, ROUND(amount::numeric*100)::int AS cents, paid_gift_id FROM pledge_installments WHERE pledge_id=$1 ORDER BY seq`, [id]);

(async () => {
  const tok = await freshOrg();
  const BRAM = await person("d_pl2_bram", "Bram Ellery");
  const sched = [[0, 100], [30, 100], [60, 100], [400, 100]].map(([d, a]) => ({ dueDate: plusDays(d), amount: a }));

  // ── §1 · PAYMENTS APPLY OLDEST DUE FIRST; OVER THE BALANCE ASKS ──────────
  console.log("\n— §1 · oldest due first, the overage carries —");
  const pl = await api("POST", `/donors/${BRAM}/pledges`, tok, { amount: 400, dueDate: TODAY, installments: sched });
  const PL = pl.body && pl.body.id;
  ok("fixture: a $400 pledge in four $100 installments", pl.status === 201 && (await instRows(PL)).length === 4, pl.body);
  const pay = await api("POST", `/donors/${BRAM}/gifts`, tok, { amount: 150, date: TODAY, pledgeId: PL, idempotencyKey: crypto.randomUUID() });
  ok("a $150 payment is recorded", pay.status === 201, pay.body);
  const leftOf = async () => ((await pledgeOf(tok, BRAM, PL)).installments || []).map(i => C(i.left));
  const rows = await instRows(PL);
  ok("the first $100 installment is marked paid by the $150", rows[0].paid_gift_id === pay.body.gift.id && rows.filter(r => r.paid_gift_id).length === 1, rows);
  ok("the schedule is not split or re-dated: four $100 installments on their dates", rows.length === 4 && rows.every((r, k) => r.cents === 10000 && r.due === sched[k].dueDate), rows);
  ok("the $50 over carries to the next installment: $0, $50, $100, $100 left", JSON.stringify(await leftOf()) === "[0,5000,10000,10000]", await leftOf());
  const after1 = await pledgeOf(tok, BRAM, PL);
  ok("3 installments are left (unpaidCount)", after1.unpaidCount === 3, after1.unpaidCount);
  ok("$250 is the balance", C(after1.balance) === 25000, after1.balance);
  ok("this fiscal year's part is $150 ($300 due in it, less $150 paid)", C(after1.dueThisYear) === 15000, after1.dueThisYear);
  // A $100 payment next goes to the oldest still owed: the $50 left, then $50 of the next.
  const pay2 = await api("POST", `/donors/${BRAM}/gifts`, tok, { amount: 100, date: TODAY, pledgeId: PL, idempotencyKey: crypto.randomUUID() });
  const rows2 = await instRows(PL);
  ok("a next $100 completes the second installment ($50 left on it), then $50 of the third",
     rows2[1].paid_gift_id === pay2.body.gift.id && !rows2[2].paid_gift_id && JSON.stringify(await leftOf()) === "[0,0,5000,10000]", { rows2, left: await leftOf() });

  console.log("\n— §1 · a payment above the balance asks —");
  const giftsBefore = Number((await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG]))[0].n);
  const big = await api("POST", `/donors/${BRAM}/gifts`, tok, { amount: 400, date: TODAY, pledgeId: PL, idempotencyKey: crypto.randomUUID() });
  ok("$400 against $150 left asks (409 over_balance)", big.status === 409 && big.body.code === "over_balance", big.status);
  ok("the question names the balance and the extra", C(big.body.balance) === 15000 && C(big.body.extra) === 25000, big.body);
  ok("it offers an extra gift or reducing to the balance", JSON.stringify(big.body.choices) === '["extra_gift","reduce"]', big.body.choices);
  ok("the question writes nothing", Number((await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG]))[0].n) === giftsBefore);
  const KEY = crypto.randomUUID();
  const ext = await api("POST", `/donors/${BRAM}/gifts`, tok, { amount: 400, date: TODAY, pledgeId: PL, overBalance: "extra_gift", idempotencyKey: KEY });
  ok("as an extra gift: $150 pays the pledge, $250 is its own gift", ext.status === 201 && C(ext.body.gift.amount) === 15000 && ext.body.gift.pledge_id === PL
     && ext.body.extraGift && C(ext.body.extraGift.amount) === 25000 && !ext.body.extraGift.pledge_id, { gift: ext.body.gift, extra: ext.body.extraGift });
  ok("the extra gift carries its actor", !!(ext.body.extraGift && ext.body.extraGift.created_by), ext.body.extraGift && ext.body.extraGift.created_by);
  const replay = await api("POST", `/donors/${BRAM}/gifts`, tok, { amount: 400, date: TODAY, pledgeId: PL, overBalance: "extra_gift", idempotencyKey: KEY });
  ok("a replay writes neither gift again", replay.status === 200 && Number((await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG]))[0].n) === giftsBefore + 2, replay.status);
  const full = await pledgeOf(tok, BRAM, PL);
  ok("the pledge is paid in full, with no surplus", C(full.paid) === 40000 && C(full.balance) === 0 && C(full.surplus) === 0 && full.unpaidCount === 0, full);
  const PL2 = (await api("POST", `/donors/${BRAM}/pledges`, tok, { amount: 200, dueDate: TODAY })).body.id;
  const red = await api("POST", `/donors/${BRAM}/gifts`, tok, { amount: 260, date: TODAY, pledgeId: PL2, overBalance: "reduce", idempotencyKey: crypto.randomUUID() });
  ok("reduce to the balance: the payment is $200, nothing else", red.status === 201 && C(red.body.gift.amount) === 20000 && !red.body.extraGift, red.body.gift && red.body.gift.amount);

  // ── §2 · NEXT MOVE AFTER A PAYMENT ────────────────────────────────────────
  console.log("\n— §2 · Next move says what is left —");
  const CORA = await person("d_pl2_cora", "Cora Waddell");
  const PL3 = (await api("POST", `/donors/${CORA}/pledges`, tok, { amount: 400, dueDate: TODAY, installments: sched })).body.id;
  await api("POST", `/donors/${CORA}/gifts`, tok, { amount: 150, date: TODAY, pledgeId: PL3, idempotencyKey: crypto.randomUUID() });
  await drainQueue(q).catch(() => {});
  const mv = (await api("GET", `/insights/donor/${CORA}`, tok)).body || {};
  const say = (mv.move && mv.move.item && mv.move.item.how && mv.move.item.how.say) || "";
  ok("Next move is the pledge to collect", mv.move && mv.move.kind === "pledges", mv.move && mv.move.kind);
  ok("it says this year's part is $150 after $150 was paid", /This year's part is \$150\b/.test(say), say);
  ok("it never says $100 is this year's part", !/This year's part is \$100\b/.test(say), say);

  // ── §3 · DELETE LEAVES NOTHING BEHIND ─────────────────────────────────────
  console.log("\n— §3 · deleting a pledge —");
  const DELL = await person("d_pl2_dell", "Delphine Ashgrove");
  const PL4 = (await api("POST", `/donors/${DELL}/pledges`, tok, { amount: 900, dueDate: plusDays(20) })).body.id;
  await api("POST", "/tasks", tok, { title: "Open pledges to collect: Delphine Ashgrove. Collect $900: the pledge as promised.", due: plusDays(5), type: "donor", donorId: DELL, priority: "medium" });
  const lineOf = () => q(`SELECT id, note FROM interactions WHERE org_id=$1 AND donor_id=$2 ORDER BY created_at`, [ORG, DELL]);
  ok("fixture: the pledge's \"Pledged\" line is on the timeline", (await lineOf()).some(l => /^Pledged \$900/.test(l.note)), (await lineOf()).map(l => l.note));
  const del = await api("DELETE", `/pledges/${PL4}`, tok);
  ok("the delete succeeds with an Undo", del.status === 200 && !!del.body.undoId, del.body);
  const lines = await lineOf();
  ok("no \"Pledged\" line is left", !lines.some(l => /^Pledged /.test(l.note)), lines.map(l => l.note));
  ok("the timeline says one \"Pledge deleted\" line", lines.filter(l => /^Pledge deleted/.test(l.note)).length === 1, lines.map(l => l.note));
  const tasks = await q(`SELECT voided_at FROM tasks WHERE org_id=$1 AND donor_id=$2`, [ORG, DELL]);
  ok("the collect task is voided", tasks.length === 1 && !!tasks[0].voided_at, tasks);
  await drainQueue(q).catch(() => {});
  const mvDel = (await api("GET", `/insights/donor/${DELL}`, tok)).body || {};
  ok("no collect move is left for the deleted pledge", !(mvDel.move && mvDel.move.item && mvDel.move.item.pledgeId === PL4), mvDel.move && mvDel.move.kind);
  const undo = await api("POST", `/deleted-records/${del.body.undoId}/restore`, tok);
  const back = await lineOf();
  ok("Undo brings the pledge back", undo.status === 200 && !!(await pledgeOf(tok, DELL, PL4)), undo.body);
  ok("Undo brings its \"Pledged\" line back and takes the \"Pledge deleted\" line away",
     back.some(l => /^Pledged \$900/.test(l.note)) && !back.some(l => /^Pledge deleted/.test(l.note)), back.map(l => l.note));
  ok("Undo brings the collect task back", !(await q(`SELECT voided_at FROM tasks WHERE org_id=$1 AND donor_id=$2`, [ORG, DELL]))[0].voided_at);

  // ── §4 · WRITE OFF ASKS FIRST ─────────────────────────────────────────────
  console.log("\n— §4 · write-off —");
  const PL5 = (await api("POST", `/donors/${DELL}/pledges`, tok, { amount: 500, dueDate: plusDays(10) })).body.id;
  await api("POST", `/donors/${DELL}/gifts`, tok, { amount: 120, date: TODAY, pledgeId: PL5, idempotencyKey: crypto.randomUUID() });
  const ask = await api("PUT", `/pledges/${PL5}`, tok, { status: "written_off" });
  ok("one click does not write off: it asks", ask.status === 409 && ask.body.code === "confirm_write_off", ask.status);
  ok("the question states the amount ($380 still owed)", /\$380\b/.test(ask.body.sentence || "") && C(ask.body.balance) === 38000, ask.body.sentence);
  ok("nothing changed", (await q(`SELECT status FROM pledges WHERE id=$1`, [PL5]))[0].status === "open");
  const audit0 = Number((await q(`SELECT COUNT(*)::int n FROM fin_audit_log WHERE org_id=$1`, [ORG]))[0].n);
  const wo = await api("PUT", `/pledges/${PL5}`, tok, { status: "written_off", confirmed: true });
  ok("confirmed, it is written off", wo.status === 200 && (await q(`SELECT status FROM pledges WHERE id=$1`, [PL5]))[0].status === "written_off", wo.status);
  // The audit middleware writes its row as the response finishes: wait for it (bounded).
  let audited = false;
  for (let k = 0; k < 40 && !audited; k++) {
    audited = Number((await q(`SELECT COUNT(*)::int n FROM fin_audit_log WHERE org_id=$1`, [ORG]))[0].n) > audit0;
    if (!audited) await new Promise(r => setTimeout(r, 100));
  }
  ok("and an audit row is written", audited);
  const unwo = await api("PUT", `/pledges/${PL5}`, tok, { status: "open" });
  ok("Undo (back to open) needs no confirm and restores it", unwo.status === 200 && (await q(`SELECT status FROM pledges WHERE id=$1`, [PL5]))[0].status === "open", unwo.status);

  // ── §5 · AN OFFLINE RECURRING PLAN ────────────────────────────────────────
  console.log("\n— §5 · a recurring plan staff record —");
  const ELSA = await person("d_pl2_elsa", "Elsa Brightwater");
  // Weekly from 28 days ago: expected 28, 21, 14 and 7 days ago and today. A
  // payment is late after 7 days, so four were due by now.
  const START = plusDays(-28);
  const mk = await api("POST", `/donors/${ELSA}/offline-plans`, tok, { amount: 25, frequency: "weekly", startDate: START, method: "check" });
  const PLAN = mk.body && mk.body.id;
  ok("staff create a plan by hand (no email to the donor)", mk.status === 201 && !!PLAN && mk.body.kind === "offline", mk.body);
  ok("it is labelled apart from a card plan", /offline/i.test(mk.body.label || "") && !/stripe/i.test(mk.body.label || ""), mk.body.label);
  ok("with no payments it is Behind: four missed", mk.body.behind === true && mk.body.missed === 4 && mk.body.status === "behind", { behind: mk.body.behind, missed: mk.body.missed });
  ok("its next expected date is the first unpaid one", mk.body.nextExpected === START, mk.body.nextExpected);
  const sent = await q(`SELECT COUNT(*)::int n FROM recurring_proposals WHERE org_id=$1`, [ORG]).catch(() => [{ n: 0 }]);
  ok("no donor invitation was made", Number(sent[0].n) === 0);
  for (const d of [-28, -21, -14]) await api("POST", `/offline-plans/${PLAN}/payments`, tok, { date: plusDays(d), idempotencyKey: crypto.randomUUID() });
  const g0 = await api("POST", `/donors/${ELSA}/gifts`, tok, { amount: 25, date: plusDays(-7), idempotencyKey: crypto.randomUUID() });
  let st = (((await api("GET", `/donors/${ELSA}/offline-plans`, tok)).body || {}).plans || [])[0] || {};
  ok("three payments recorded: still Behind, one missed", st.paidCount === 3 && st.behind === true && st.missed === 1, { paid: st.paidCount, missed: st.missed });
  ok("each payment is a gift with the plan's amount and its actor", (await q(`SELECT COUNT(*)::int n FROM gifts WHERE offline_plan_id=$1 AND amount=25 AND created_by IS NOT NULL`, [PLAN]).catch(() => [{ n: -1 }]))[0].n === 3);
  const conv = await api("POST", `/offline-plans/${PLAN}/convert`, tok, { giftIds: [g0.body.gift && g0.body.gift.id, ext.body.gift && ext.body.gift.id] });
  ok("a gift on file becomes a payment; another person's pledge payment does not", conv.status === 200 && conv.body.converted === 1 && conv.body.skipped === 1, conv.body);
  st = (conv.body && conv.body.plan) || { payments: [] };
  ok("caught up: on track, next expected today", st.behind === false && st.status === "active" && st.nextExpected === TODAY, { status: st.status, next: st.nextExpected });
  ok("the payment history lists all four, oldest first", st.payments.length === 4 && st.payments[0].date === plusDays(-28) && st.payments[3].date === plusDays(-7), st.payments.map(p => p.date));
  const c1 = await api("POST", `/offline-plans/${PLAN}/cancel`, tok, {});
  ok("Cancel asks first", c1.status === 409 && c1.body.code === "confirm_cancel" && /\$25/.test(c1.body.sentence || ""), c1.body);
  const c2 = await api("POST", `/offline-plans/${PLAN}/cancel`, tok, { confirmed: true });
  ok("confirmed, the plan is cancelled and its payments stay", c2.status === 200 && !!c2.body.plan && c2.body.plan.status === "cancelled" && c2.body.plan.payments.length === 4, c2.body.plan && c2.body.plan.status);
  const late = await api("POST", `/offline-plans/${PLAN}/payments`, tok, { date: TODAY });
  ok("a cancelled plan takes no payments", late.status === 400, late.status);
  const other = await freshOther();
  ok("another org cannot read the plan", (await api("POST", `/offline-plans/${PLAN}/payments`, other, { date: TODAY })).status === 404);

  // ── §6 · THE BROWSER: THE RAIL AND THE TAB AGREE; EACH PANEL ITS OWN ─────
  const why = (() => {
    if (!optional(PW)) return "(playwright is not installed at " + PW + ")";
    if (!fs.existsSync(path.join(DIST, "index.html")) && !fs.existsSync(path.join(DIST, "app.html"))) return "(no client dist at " + DIST + ")";
    return null;
  })();
  if (browserLegOrSkip(why, "(browser leg)")) { await closeDb(); summary(); return; }
  console.log("\n— §6 · the browser —");
  const FINN = await person("d_pl2_finn", "Finnian Holloway");
  const PL6 = (await api("POST", `/donors/${FINN}/pledges`, tok, { amount: 400, dueDate: TODAY, installments: sched })).body.id;
  // Two people with their own funds, for the fast switch.
  const funds = (await api("GET", "/finance/funds", tok)).body || [];
  const mkFund = async (name) => { const r = await api("POST", "/finance/funds", tok, { name, restricted: true }); return r.body && (r.body.id || (r.body.fund && r.body.fund.id)); };
  const F1 = await mkFund("Lantern Reading Room"), F2 = await mkFund("Harbour Choir");
  const GUS = await person("d_pl2_gus", "Gus Penhallow"), HAL = await person("d_pl2_hal", "Halcyon Prentiss");
  await api("POST", `/donors/${GUS}/gifts`, tok, { amount: 7300, date: TODAY, fund_id: F1, idempotencyKey: crypto.randomUUID() });
  await api("POST", `/donors/${HAL}/gifts`, tok, { amount: 45, date: TODAY, fund_id: F2, idempotencyKey: crypto.randomUUID() });
  ok("fixture: two restricted funds", !!F1 && !!F2, { F1, F2, n: funds.length });
  await drainQueue(q).catch(() => {});

  const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let loads = 0;
  page.on("load", () => { loads++; });
  await page.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
  const go = async url => {
    await page.evaluate(u => { const s = window.history.state || {}; window.history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx: (s.idx || 0) + 1 }, "", u); window.dispatchEvent(new PopStateEvent("popstate")); }, url);
  };
  const until = (fn, arg, t = 12000) => page.waitForFunction(fn, arg, { timeout: t }).then(() => true).catch(() => false);
  const txt = async sel => ((await page.locator(sel).first().textContent({ timeout: 4000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
  try {
    await page.goto(`${APP}/donors/${FINN}`, { waitUntil: "networkidle", timeout: 60000 });
    const loads0 = loads;
    await page.locator('[data-tab="giving"]').first().click({ timeout: 20000 });
    await page.locator(`#pledge-${PL6}`).waitFor({ timeout: 20000 });
    await page.locator('[data-testid="dp-pledge-record"]').first().click();
    const form = page.locator('[data-testid="dp-add-gift-form"]');
    await form.waitFor({ timeout: 10000 });
    await form.getByPlaceholder("Amount ($)").fill("150");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    const agree = await until(([id]) => {
      const rail = (document.querySelector('[data-testid="dp-open-pledge-words"]') || {}).textContent || "";
      const row = (document.querySelector(`#pledge-${id}`) || {}).textContent || "";
      return /3 installments left/.test(rail) && /3 installments left/.test(row);
    }, [PL6]);
    ok("§6 after a $150 payment the rail and the Giving tab both say 3 installments left", agree,
       { rail: await txt('[data-testid="dp-open-pledge-words"]'), row: (await txt(`#pledge-${PL6}`)).slice(0, 160) });
    ok("§6 no reload happened", loads === loads0, { loads: loads - loads0 });

    // Over the balance: the form asks, and the extra gift is its own.
    await page.locator('[data-testid="dp-pledge-record"]').first().click();
    await form.waitFor({ timeout: 10000 });
    await form.getByPlaceholder("Amount ($)").fill("300");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    const asked = await page.locator('[data-testid="confirm-yes"]').waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    const dialog = asked ? await txt('[role="dialog"]') : "";
    ok("§6 a $300 payment on $250 left asks, naming both choices", asked && /\$50(\.00)? as an extra gift/.test(dialog) && /Reduce to \$250/.test(dialog), dialog.slice(0, 200));
    if (asked) await page.locator('[data-testid="confirm-yes"]').click();
    const extraLanded = await until(() => !/3 installments left|1 installment left/.test((document.querySelector('[data-testid="dp-open-pledge-words"]') || {}).textContent || "x"));
    const fin = (await q(`SELECT COALESCE(SUM(amount),0)::float s FROM gifts WHERE donor_id=$1 AND pledge_id IS NULL`, [FINN]))[0].s;
    ok("§6 the $50 over is its own gift and the pledge is paid", extraLanded && C(fin) === 5000, { fin });

    // Fast switching: each panel shows that person's funds.
    await go(`/donors/${GUS}`);
    await page.locator('[data-tab="giving"]').first().click({ timeout: 20000 });
    const gusOk = await until(() => /Lantern Reading Room/.test(document.body.innerText) && /\$7,300/.test(document.body.innerText));
    ok("§6 Gus's panel shows Gus's fund", gusOk);
    await go(`/donors/${HAL}`);
    await page.waitForTimeout(60);
    await go(`/donors/${GUS}`);
    await page.waitForTimeout(60);
    await go(`/donors/${HAL}`);
    await page.locator('[data-tab="giving"]').first().click({ timeout: 20000 }).catch(() => {});
    const halOk = await until(() => /What they support/.test(document.body.innerText) && /Harbour Choir/.test(document.body.innerText));
    await page.waitForTimeout(1500);   // a slow answer for Gus would land by now
    // The person's own fund cards: from the heading to the restricted split (the
    // Suggested Asks box below names the org's other funds, "Not yet engaged with").
    const panel = await page.evaluate(() => { const t = document.body.innerText, i = t.indexOf("What they support"), j = t.indexOf("Restricted vs Unrestricted", i); return i < 0 ? "" : t.slice(i, j < 0 ? i + 400 : j); });
    ok("§6 after switching fast, Halcyon's panel shows Halcyon's fund", halOk && /Harbour Choir/.test(panel) && /\$45\b/.test(panel), panel.slice(0, 200));
    ok("§6 and never Gus's", !/Lantern Reading Room/.test(panel) && !/\$7,300/.test(panel), panel.slice(0, 200));
  } catch (e) {
    ok("§6 ran to the end", false, String(e && e.message || e).split("\n")[0]);
  }
  await browser.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("suite ran", false, e.message); await closeDb().catch(() => {}); summary(); });

async function freshOther() {
  const O = ORG + "_b";
  await q(`DELETE FROM users WHERE org_id=$1`, [O]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [O]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Other Pledge Guild',$2,1,'active','team','America/New_York')`, [O, O.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Pim Arbor','admin')`, ["u_" + O, O, `${O}@test.local`, bcrypt.hashSync(PASSWORD, 4)]);
  return login(`${O}@test.local`, PASSWORD);
}

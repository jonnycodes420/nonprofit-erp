// tests/pledges3.test.js: PLEDGES-3. PLEDGES, GRANTS AND RECEIPTS TELL ONE STORY.
// Guards money and donor data. One fresh org (made-up names), then:
//   §1 W-1107-Finance-20: Lavinia's $1,200 pledge (four $300 installments, two
//      past, $600 received, the pledge's own date Dec 15-shaped, its paid flags
//      stale) says the SAME five values (pledged, received, open, next amount,
//      next date) on her profile, Fundraising's Pledges list, the three
//      Fundraising figure dialogs and the Calendar. Next is the next
//      installment's OPEN amount, never the pledge total.
//   §2 W-1107-Finance-25X: $150 on four $100 installments: the form's words say
//      "This covers the Dec installment and $50 of Jan." before Save, and the
//      schedule says the next installment is $50, not $100.
//   §3 W-1107-Finance-31: Awarded $120,000 by status alone (no award row) says
//      "payments not set up · Set up payments", never "Record the award",
//      Received and % Funded say "No payments set up", and the application deadline stops
//      counting down (a report date still does).
//   §4 W-1108-Finance-09X: a receipted $100 gift edited to $150 says "Gift
//      changed after this receipt" on the gift's receipt and in Tax receipts;
//      one click voids it (note kept) and issues $150. A $0 gift: the click
//      voids and issues nothing, and a $0 gift can't be receipted.
//   §5 (browser, production build) the same, by clicks.
// HOW IT GOES RED ON MAIN: no `summary` on either pledge read, figure rows dated
// by the pledge's date / a paid installment and saying "Due", the Calendar
// drawing installments by stale paid flags at face value (§1); no cover words,
// next $100 (§2); "Record the award", $0 / 0%, "38d" (§3); no drift, no
// reissue route, a $0 gift receipted through issueGiftReceipt (§4).
// PLANTED: shared/numbers/pledges.js summaryOf's nextAmount = the pledge total → §1 red.
// Tests set their own clock (tests/clock.js). Sends nothing (receipts are made with send:false).
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { ok, summary, login, api, q, closeDb, browserLegOrSkip } = require("./helpers");
const { civilDay, dayOffset } = require("./clock");
const { DIST } = require("./lib/dist");

const ORG = "org_pledges3";
const PASSWORD = "loadtest1234";
const EMAIL = `${ORG}@test.local`;
const TODAY = civilDay(undefined, "America/New_York");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const optional = f => { try { return require(f); } catch { return null; } };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longDay = d => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,legal_name,ein,receipt_address,receipts_enabled)
           VALUES ($1,'Pledge Three Wren Society',$2,1,'active','team','America/New_York','Pledge Three Wren Society Inc','12-3456782','3 Fixture Row',true)`,
    [ORG, ORG.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Perpetua Vane','admin')`, ["u_" + ORG, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
async function person(id, name) {
  await q(`INSERT INTO donors (id,org_id,name,email,kind,person_types,created_by,created_by_name) VALUES ($1,$2,$3,$4,'individual','["donor"]'::jsonb,'system:test/pledges3','PLEDGES-3 test')`,
    [id, ORG, name, `${id}@pledges3.example.org`]);
  return id;
}
const gift = async (tok, donor, body) => { const r = await api("POST", `/donors/${donor}/gifts`, tok, { idempotencyKey: crypto.randomUUID(), ...body }); return { ...r, id: r.body && (r.body.gift ? r.body.gift.id : r.body.id) }; };

(async () => {
  const tok = await freshOrg();
  const { pledgeCoverWords } = await import("../shared/pledgeCover.js");
  const GA = await import("../shared/grantAwardLine.js");
  const { deadlineWord } = await import("../shared/grantDeadline.js");

  // ── §1 · ONE PLEDGE, ONE READER ─────────────────────────────────────────
  console.log("\n— §1 · Lavinia's pledge, the same five values everywhere —");
  const LAV = await person("d_pl3t_lavinia", "Lavinia Ashcombe");
  const due = [-66, -36, -5, 25].map(n => dayOffset(n));
  const PL = (await api("POST", `/donors/${LAV}/pledges`, tok, { amount: 1200, dueDate: dayOffset(37), installments: due.map(d => ({ dueDate: d, amount: 300 })) })).body.id;
  await gift(tok, LAV, { amount: 300, date: due[0], pledgeId: PL });
  await gift(tok, LAV, { amount: 300, date: due[1], pledgeId: PL });
  // The fleet's rows: the payments are on the pledge, the paid flags are not (written before the relay).
  await q(`UPDATE pledge_installments SET paid_gift_id=NULL, paid_at=NULL WHERE pledge_id=$1`, [PL]);
  const WORDS = `$1,200 pledged · $600 received · $600 open · next $300 due ${longDay(due[2])}`;
  const prof = ((await api("GET", `/donors/${LAV}/pledges`, tok)).body || []).find(p => p.id === PL) || {};
  const s = prof.summary || {};
  ok("§1 the profile's pledge read carries the five values", s.pledged === 1200 && s.received === 600 && s.open === 600 && s.nextAmount === 300 && s.nextDue === due[2], s);
  ok("§1 Next is the next installment's open amount ($300), never the pledge total", s.nextAmount === 300 && s.nextAmount !== s.pledged, s);
  ok("§1 the profile says them in one sentence", s.words === WORDS, s.words);
  const list = (await api("GET", "/fundraising/pledges", tok)).body || {};
  const row = (list.pledges || []).find(p => p.id === PL) || {};
  ok("§1 Fundraising's Pledges list says the same sentence and Next $300", row.summary && row.summary.words === WORDS && row.summary.nextAmount === 300, row.summary);
  for (const [key, qs, amount] of [["pledges-open", "", 600], ["pledges-due", `to=${dayOffset(200)}`, 600], ["pledges-overdue", `before=${TODAY}`, 300]]) {
    const f = (await api("GET", `/figures/${key}/rows?${qs}`, tok)).body || {};
    const r = (f.rows || []).find(x => x.id === PL) || {};
    ok(`§1 the ${key} dialog row is dated by the next installment and says the five values`,
      String(r.date || "").slice(0, 10) === due[2] && r.detail === WORDS && Math.round(Number(r.amount) * 100) === amount * 100, r);
  }
  const calRes = await api("GET", `/calendar/items?from=${dayOffset(-68)}&to=${dayOffset(-6)}&types=pledge`, tok);   // 62 days, the Calendar's cap
  const cal = calRes.body || {};
  const calNext = (await api("GET", `/calendar/items?from=${dayOffset(-10)}&to=${dayOffset(40)}&types=pledge`, tok)).body || {};
  ok("§1 the Calendar draws no paid installment, whatever its stale flag says", calRes.status === 200 && !(cal.items || []).some(i => i.donorId === LAV && i.start < due[2]), (cal.items || []).map(i => i.start));
  const nov = (calNext.items || []).find(i => i.donorId === LAV && i.start === due[2]) || {};
  ok("§1 the Calendar's next installment is $300 open and says the five values", nov.amount === 300 && String(nov.detail || "").endsWith(WORDS), nov);

  // ── §2 · $150 ON A $100 INSTALLMENT ────────────────────────────────────
  console.log("\n— §2 · the $150 payment —");
  const ODO = await person("d_pl3t_odo", "Odo Marchbank");
  const four = [25, 56, 86, 117].map(n => dayOffset(n));
  const PL2 = (await api("POST", `/donors/${ODO}/pledges`, tok, { amount: 400, dueDate: four[0], installments: four.map(d => ({ dueDate: d, amount: 100 })) })).body.id;
  const before = ((await api("GET", `/donors/${ODO}/pledges`, tok)).body || []).find(p => p.id === PL2);
  const m = n => MON[Number(four[n].slice(5, 7)) - 1];
  ok("§2 before Save the form says what $150 covers", pledgeCoverWords(before, 150) === `This covers the ${m(0)} installment and $50 of ${m(1)}.`, pledgeCoverWords(before, 150));
  ok("§2 above the whole balance it says Save will ask about the extra", /\$50 is more than is open\. Save asks whether to record the extra as a separate gift\./.test(pledgeCoverWords(before, 450)), pledgeCoverWords(before, 450));
  const p150 = await gift(tok, ODO, { amount: 150, date: TODAY, pledgeId: PL2 });
  const after = ((await api("GET", `/donors/${ODO}/pledges`, tok)).body || []).find(p => p.id === PL2) || {};
  ok("§2 the $150 is recorded", p150.status === 201, p150.body);
  ok("§2 the schedule's next installment is the $50 still open, not $100", after.summary && after.summary.nextAmount === 50 && after.summary.nextDue === four[1], after.summary);
  ok("§2 the installments read $0, $50, $100, $100 left", JSON.stringify((after.installments || []).map(i => i.left)) === "[0,50,100,100]", after.installments);

  // ── §3 · AWARDED BY STATUS ALONE ───────────────────────────────────────
  console.log("\n— §3 · Wexford, awarded with no award row —");
  await q(`INSERT INTO grants (id,org_id,funder,program,status,amount,amount_requested,amount_awarded,deadline,created_by,created_by_name)
           VALUES ('gr_pl3t_wexford',$1,'Wexford Foundation','Harbour literacy','awarded',120000,120000,120000,$2,'system:test/pledges3','PLEDGES-3 test')`, [ORG, dayOffset(38)]);
  const gr = ((await api("GET", "/grants", tok)).body || []);
  const wex = (Array.isArray(gr) ? gr : gr.grants || []).find(g => g.id === "gr_pl3t_wexford") || {};
  const G = { amount: Number(wex.amount), amountAwarded: Number(wex.amount_awarded), received: Number(wex.received) || 0, status: wex.status, deadline: String(wex.deadline || "").slice(0, 10), awardPledgeId: wex.award_pledge_id || null };
  const line = GA.grantAwardLine(G) || {};
  ok("§3 the line says Awarded $120,000 · payments not set up · Set up payments", `${line.text} ${line.action}` === "Awarded $120,000 · payments not set up · Set up payments", line);
  ok("§3 it never says Record the award", !/Record the award/.test(`${line.text} ${line.action}`), line);
  const word = (d, o) => deadlineWord(d, TODAY, o);
  const tiles = GA.grantMoneyTiles(G, word, { pursuing: false });
  const t = k => tiles.find(x => x.key === k) || {};
  ok("§3 Received and % Funded say No payments set up, not $0 and 0%", t("received").value === "No payments set up" && t("funded").value === "No payments set up", tiles);
  ok("§3 the application deadline stops counting down once awarded", !tiles.some(x => /\d+d$/.test(String(x.word || ""))) && t("deadline").word === "Closed", tiles);
  const withReport = GA.grantMoneyTiles({ ...G, reportDue: dayOffset(20) }, word, { pursuing: false });
  ok("§3 a report deadline still counts down", (withReport.find(x => x.key === "report") || {}).word === "20d", withReport);
  const dls = ((await api("GET", "/grants/deadlines", tok)).body || {}).milestones || [];
  const wexDl = dls.find(x => x.grantId === "gr_pl3t_wexford") || {};
  ok("§3 Deadlines still lists Wexford's date, closed, with no countdown", wexDl.band === "closed" && !/due in/.test(wexDl.sentence || "") && /application is closed/.test(wexDl.sentence || ""), wexDl);

  // ── §4 · A RECEIPT IS A SNAPSHOT ───────────────────────────────────────
  console.log("\n— §4 · receipts and changed gifts —");
  const HAR = await person("d_pl3t_harper", "Harper Quillon");
  const g100 = await gift(tok, HAR, { amount: 100, date: dayOffset(-2) });
  const rc = await api("POST", `/gifts/${g100.id}/receipt`, tok, { send: false });
  ok("fixture: a $100 gift with its receipt", rc.status === 201 && Number(rc.body.amount) === 100, rc.body);
  const put = await api("PUT", `/gifts/${g100.id}`, tok, { amount: 150 });
  ok("fixture: the gift goes to $150", put.status === 200 && Number((await q(`SELECT amount FROM gifts WHERE id=$1`, [g100.id]))[0].amount) === 150, put.body);
  const mine = ((await api("GET", `/donors/${HAR}/receipts`, tok)).body || []).find(r => r.id === rc.body.id) || {};
  ok("§4 the issued receipt still says $100 (never edited)", Number(mine.amount) === 100, mine);
  ok("§4 the gift's receipt says it changed, with Void and reissue", mine.drift && mine.drift.sentence === "Gift changed after this receipt: the receipt says $100 and the gift is now $150. Void and reissue?" && mine.drift.action === "Void and reissue", mine.drift);
  const listed = (((await api("GET", "/receipts", tok)).body || {}).receipts || []).find(r => r.id === rc.body.id) || {};
  ok("§4 Tax receipts says the same", listed.drift && listed.drift.sentence === mine.drift.sentence, listed.drift);
  const re = await api("POST", `/receipts/${rc.body.id}/reissue`, tok, {});
  const old = (await q(`SELECT voided_at, void_reason, receipt_number FROM receipts WHERE id=$1`, [rc.body.id]))[0];
  const now = await q(`SELECT amount, receipt_number FROM receipts WHERE gift_id=$1 AND voided_at IS NULL`, [g100.id]);
  ok("§4 one click voids the old receipt, keeping why", re.status === 200 && old.voided_at && /Gift changed after this receipt \(receipt \$100, gift now \$150\)/.test(old.void_reason) && /Reissued as #/.test(old.void_reason), { re: re.body, old });
  ok("§4 and issues a new $150 receipt under a new number", now.length === 1 && Number(now[0].amount) === 150 && now[0].receipt_number !== old.receipt_number, now);
  const again = ((await api("GET", `/donors/${HAR}/receipts`, tok)).body || []).filter(r => !r.voided_at);
  ok("§4 the reissued receipt carries no flag", again.length === 1 && !again[0].drift, again);
  // Marlowe-shaped: a receipt standing against a $0 gift.
  const MAR = await person("d_pl3t_marlowe", "Marlowe Tessaly");
  const g200 = await gift(tok, MAR, { amount: 200, date: dayOffset(-3) });
  const rc2 = await api("POST", `/gifts/${g200.id}/receipt`, tok, { send: false });
  await api("PUT", `/gifts/${g200.id}`, tok, { amount: 0 });
  const zero = ((await api("GET", `/donors/${MAR}/receipts`, tok)).body || []).find(r => r.id === rc2.body.id) || {};
  ok("§4 a receipt against a $0 gift says a $0 gift can't carry one", zero.drift && zero.drift.zero === true && /a \$0 gift can't carry a receipt\. Void it\?$/.test(zero.drift.sentence), zero.drift);
  const re0 = await api("POST", `/receipts/${rc2.body.id}/reissue`, tok, {});
  const left0 = await q(`SELECT COUNT(*)::int AS n FROM receipts WHERE gift_id=$1 AND voided_at IS NULL`, [g200.id]);
  ok("§4 for a $0 gift the click voids it and makes nothing", re0.status === 200 && re0.body.receipt === null && left0[0].n === 0, re0.body);
  const try0 = await api("POST", `/gifts/${g200.id}/receipt`, tok, { send: false });
  ok("§4 a $0 gift can't be receipted", try0.status === 409 && try0.body.error === "zero_gift", try0.body);

  // ── §5 · THE BROWSER (production build) ────────────────────────────────
  const why = (() => {
    if (!optional(PW)) return "(playwright is not installed at " + PW + ")";
    if (!fs.existsSync(path.join(DIST, "index.html")) && !fs.existsSync(path.join(DIST, "app.html"))) return "(no client dist at " + DIST + ")";
    return null;
  })();
  if (browserLegOrSkip(why, "(browser leg)")) { await closeDb(); summary(); return; }
  console.log("\n— §5 · the browser —");
  const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
    [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
  const txt = async sel => ((await page.locator(sel).first().innerText({ timeout: 8000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
  try {
    await page.goto(`${APP}/donors/${LAV}`, { waitUntil: "networkidle", timeout: 60000 });
    const banner = await txt('[data-testid="dp-open-pledge-words"]');
    ok("§5 Lavinia's profile says the five values", banner.includes(WORDS), banner);
    await page.goto(`${APP}/app/fundraising`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="fr-pledges"] button').first().click({ timeout: 20000 });
    await page.waitForFunction(w => ((document.querySelector('[role="dialog"]') || {}).textContent || "").includes(w), WORDS, { timeout: 12000 }).catch(() => {});
    const dlg = await txt('[role="dialog"]');
    ok("§5 the Fundraising dialog says the same five values", dlg.includes(WORDS), dlg.slice(0, 400));
    await page.keyboard.press("Escape");
    await page.getByText("Every pledge →").click({ timeout: 10000 });
    await page.locator('[data-testid="pledge-row"]').first().waitFor({ timeout: 10000 });
    const lavRow = page.locator('[data-testid="pledge-row"]', { hasText: "Lavinia Ashcombe" });
    const nextCell = ((await lavRow.locator('[data-testid="pledge-next"]').innerText().catch(() => "")) || "").replace(/\s+/g, " ");
    ok("§5 the Pledges list's Next column says $300, the next installment, not $1,200", /^\$300(\.00)? /.test(nextCell) && nextCell.includes(longDay(due[2])), nextCell);
    ok("§5 and the row says the five values", ((await lavRow.innerText()) || "").replace(/\s+/g, " ").includes(WORDS));
    // The $150 case, by the profile's own form.
    const PIP = await person("d_pl3t_pip", "Pip Ellacombe");
    await api("POST", `/donors/${PIP}/pledges`, tok, { amount: 400, dueDate: four[0], installments: four.map(d => ({ dueDate: d, amount: 100 })) });
    await page.goto(`${APP}/donors/${PIP}`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="dp-pledge-record"]').first().click({ timeout: 20000 });
    const form = page.locator('[data-testid="dp-add-gift-form"]');
    await form.getByPlaceholder("Amount ($)").fill("150");
    const cover = await txt('[data-testid="dp-pledge-cover"]');
    ok("§5 before Save the form says what $150 covers", cover === `This covers the ${m(0)} installment and $50 of ${m(1)}.`, cover);
    await form.getByRole("button", { name: "Save", exact: true }).click();
    const fifty = await page.waitForFunction(() => /next \$50 due/.test((document.querySelector('[data-testid="dp-open-pledge-words"]') || {}).textContent || ""), null, { timeout: 12000 }).then(() => true).catch(() => false);
    ok("§5 after it, the schedule says next $50, not $100", fifty, await txt('[data-testid="dp-open-pledge"]'));
    // The grant.
    await page.goto(`${APP}/app/grants?grant=gr_pl3t_wexford`, { waitUntil: "networkidle" });
    const fl = await txt('[data-testid="grant-funder-line"]');
    const stats = await txt(".grant-stat-grid");
    ok("§5 Wexford says payments not set up · Set up payments", fl.includes("Awarded $120,000 · payments not set up · Set up payments") && !/Record the award/.test(fl), fl);
    ok("§5 its tiles say No payments set up and no countdown", /Received No payments set up/.test(stats) && /% Funded No payments set up/.test(stats) && !/\b38d\b/.test(stats), stats);
    // The receipt: edit a receipted gift and see the flag on the gift.
    const ROW = await person("d_pl3t_rowan", "Rowan Fetherby");
    const gR = await gift(tok, ROW, { amount: 100, date: dayOffset(-2) });
    await api("POST", `/gifts/${gR.id}/receipt`, tok, { send: false });
    await page.goto(`${APP}/donors/${ROW}`, { waitUntil: "networkidle" });
    await page.locator('[data-tab="giving"]').first().click({ timeout: 20000 }).catch(() => {});
    await page.locator('[data-testid="dp-receipt-made"]').first().waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await page.locator('input[placeholder="Amount"]').first().fill("150");
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    const yes = page.locator('[data-testid="confirm-yes"]');
    if (await yes.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) await yes.click();
    const flagged = await page.locator('[data-testid="dp-receipt-drift"]').waitFor({ timeout: 12000 }).then(() => true).catch(() => false);
    ok("§5 the edited gift's receipt says Gift changed after this receipt", flagged && /Gift changed after this receipt.*Void and reissue\?/.test(await txt('[data-testid="dp-receipt-drift"]')), await txt('[data-testid="dp-receipt-made"]'));
    if (flagged) await page.locator('[data-testid="dp-receipt-drift-go"]').click();
    const gone = await page.waitForFunction(() => !document.querySelector('[data-testid="dp-receipt-drift-go"]'), null, { timeout: 12000 }).then(() => true).catch(() => false);
    const live = await q(`SELECT amount FROM receipts WHERE gift_id=$1 AND voided_at IS NULL`, [gR.id]);
    ok("§5 one click voids and reissues it at $150", gone && live.length === 1 && Number(live[0].amount) === 150, live);
  } finally { await browser.close(); }
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });

// BUILD-101 Part 2 — RENEWALS THAT COME AROUND.
//
// The brief's one test, and what it rests on:
//   §1  a membership expiring in 20 days opens EXACTLY ONE thread, labelled
//       with the person, the level and the date, with a renewal note drafted;
//   §2  running the sweep twice opens nothing new;
//   §3  deceased, do-not-contact and do-not-solicit get no thread, and a date
//       outside the window (ahead OR already past) gets none;
//   §4  past expiry a membership moves to Grace, past the grace period Lapsed;
//   §5  an EARLY renewal extends from the OLD expiry, not from today, and the
//       renewal thread closes as an outcome on the payment's own line;
//   §6  a payment through another door of EXACTLY the level price is that
//       renewal (with the benefits split); a different amount is just a gift;
//   §7  a lapsed member never appears in LYBUNT and a lapsed donor never
//       appears in lapsed members;
//   §8  Home's one line counts memberships expiring this month, by hand;
//   §9  the org's two numbers merge over what is stored.
//
// Standard scratch stack. Fixture orgs are b101_.

const fs = require("fs"), path = require("path");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const haveBrowser = () => { try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; }
  return fs.existsSync(path.join(__dirname, "..", "client", "dist", "index.html")); };

const O = "b101_ren";
const PW = "loadtest1234";

async function reset() {
  for (const t of ["memberships", "receipts", "fin_transactions", "interactions", "thank_you_drafts", "threads", "tasks", "workflow_runs",
                   "gifts", "membership_levels", "donors", "users", "budgets", "accounts", "fin_funds"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [O]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [O]).catch(() => {});
}
const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

(async () => {
  console.log("build101-renewals");
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at)
           VALUES ($1,'Riverside Zoo','b101-ren',1,'team','active','America/New_York',NOW())`, [O]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b101ren',$1,'b101-ren@example.org',$2,'Rae Admin','admin')`,
    [O, bcrypt.hashSync(PW, 4)]);
  const tok = await login("b101-ren@example.org");
  await api("POST", "/onboarding/complete", tok, {});
  const today = (await api("GET", "/dashboard/home", tok)).body.today;
  ok("§0 the org's civil today is known", /^\d{4}-\d{2}-\d{2}$/.test(today || ""), today);

  const lv = await api("POST", "/membership-levels", tok, { name: "Family", price: 100, fmv: 25, term: "12_months" });
  const L = lv.body.id;
  const people = [
    // id, name, expires, flags
    ["maya", "Maya Chen", addDays(today, 20), {}],
    ["leo", "Leo Park", addDays(today, 10), {}],
    ["mo", "Mo Grant", addDays(today, 12), {}],
    ["dora", "Dora Late", addDays(today, 15), { deceased: true }],
    ["dan", "Dan Quiet", addDays(today, 15), { do_not_contact: true }],
    ["dee", "Dee Noask", addDays(today, 15), { do_not_solicit: true }],
    ["far", "Farrah Far", addDays(today, 45), {}],
    ["yday", "Yves Yesterday", addDays(today, -1), {}],
    ["old", "Olga Old", addDays(today, -40), {}],
    ["lena", "Lena Lapsed", addDays(today, -200), {}],
  ];
  for (const [k, name, exp, f] of people) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,deceased,do_not_contact,do_not_solicit)
             VALUES ($1,$2,$3,$4,'steward',$5,$6,$7)`,
      ["b101r_" + k, O, name, k + "@example.org", !!f.deceased, !!f.do_not_contact, !!f.do_not_solicit]);
    await q(`INSERT INTO memberships (id,org_id,donor_id,level_id,joined_on,starts_on,expires_on,status,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$5,$6,$7,'system:test','test')`,
      ["mb_r_" + k, O, "b101r_" + k, L, addDays(exp, -364), exp, k === "lena" ? "lapsed" : "active"]);
  }
  await q(`INSERT INTO donors (id,org_id,name,email,stage) VALUES ('b101r_don',$1,'Don Lapsed','don@example.org','lapsed')`, [O]);

  // ── §1 · one thread, labelled, with a drafted note ─────────────────────────
  const s1 = (await api("POST", "/memberships/run-sweep", tok, {})).body;
  const opened = new Set(s1.rows.map(r => r.donorId));
  ok("§1 Maya's membership (20 days out) opens a thread", opened.has("b101r_maya"), s1);
  const [th] = await q(`SELECT * FROM threads WHERE org_id=$1 AND donor_id='b101r_maya' AND closed_at IS NULL`, [O]);
  const [y, m, d] = addDays(today, 20).split("-");
  const month = ["January","February","March","April","May","June","July","August","September","October","November","December"][+m - 1];
  ok("§1 …labelled with her first name, the level and the date",
     th && th.next_step_label === `Renew Maya's Family membership, expires ${+d} ${month}` && th.next_step_type === "membership_renewal", th && th.next_step_label);
  ok("§1 …with the renewal note already drafted, naming the price", th && /\$100/.test(th.draft_note || "") && /Family membership/.test(th.draft_note || ""), th && th.draft_note);
  ok("§1 …and it is ONE thread", (await q(`SELECT COUNT(*)::int n FROM threads WHERE org_id=$1 AND donor_id='b101r_maya'`, [O]))[0].n === 1);
  ok("§1 three due members (Maya, Leo, Mo) opened three threads", s1.opened === 3 && opened.has("b101r_leo") && opened.has("b101r_mo"), s1.rows);

  // ── §2 · the sweep again ───────────────────────────────────────────────────
  const threadsBefore = (await q(`SELECT COUNT(*)::int n FROM threads WHERE org_id=$1`, [O]))[0].n;
  const s2 = (await api("POST", "/memberships/run-sweep", tok, {})).body;
  ok("§2 a second sweep opens nothing new", s2.opened === 0 && (await q(`SELECT COUNT(*)::int n FROM threads WHERE org_id=$1`, [O]))[0].n === threadsBefore, s2);
  // A person whose thread is dismissed is not re-raised for the SAME expiry.
  await q(`UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason='handled_outside' WHERE org_id=$1 AND donor_id='b101r_mo'`, [O]);
  ok("§2 a dismissed renewal thread is not reopened for the same expiry",
     (await api("POST", "/memberships/run-sweep", tok, {})).body.opened === 0);

  // ── §3 · who gets none ─────────────────────────────────────────────────────
  for (const k of ["dora", "dan", "dee"])
    ok(`§3 ${k} (deceased / do-not-contact / do-not-solicit) gets no renewal thread`, !opened.has("b101r_" + k));
  ok("§3 45 days out is outside the 30-day window", !opened.has("b101r_far"));
  ok("§3 a date already past opens no thread", !opened.has("b101r_yday") && !opened.has("b101r_old"));

  // ── §4 · grace, then lapsed ────────────────────────────────────────────────
  const st = async k => (await q(`SELECT status FROM memberships WHERE id=$1`, ["mb_r_" + k]))[0].status;
  ok("§4 expired yesterday → Grace", await st("yday") === "grace");
  ok("§4 expired 40 days ago (grace 30) → Lapsed", await st("old") === "lapsed");
  ok("§4 20 days out is still Active", await st("maya") === "active");

  // ── §5 · an early renewal extends from the OLD expiry ──────────────────────
  const oldExp = addDays(today, 20);
  const ren = await api("POST", "/memberships/mb_r_maya/renew", tok, { paymentMethod: "check", idempotencyKey: "b101-ren-maya" });
  ok("§5 Maya renews early", ren.status === 201, ren.body);
  ok("§5 …the new term starts the day AFTER the old expiry, not today",
     ren.body.membership && ren.body.membership.starts_on === addDays(oldExp, 1) && ren.body.membership.starts_on !== today, ren.body.membership);
  ok("§5 …and runs twelve months from there", ren.body.membership.expires_on === addDays(addDays(oldExp, 1).replace(/^(\d{4})/, (_, yy) => String(+yy + 1)), -1), ren.body.membership.expires_on);
  ok("§5 …keeping the date she first joined", ren.body.membership.joined_on === addDays(oldExp, -364));
  ok("§5 the old term is marked renewed, not lapsed", await st("maya") === "renewed");
  const [rg] = await q(`SELECT amount, quid_pro_quo_value, deductible_amount FROM gifts WHERE id=$1`, [ren.body.giftId]);
  ok("§5 the payment is ONE $100 gift carrying the $25 of benefits", Number(rg.amount) === 100 && Number(rg.quid_pro_quo_value) === 25 && Number(rg.deductible_amount) === 75, rg);
  const [closed] = await q(`SELECT close_kind, closing_interaction_id FROM threads WHERE id=$1`, [th.id]);
  ok("§5 the renewal thread closed as an OUTCOME on the payment's line", closed.close_kind === "outcome" && !!closed.closing_interaction_id, closed);
  ok("§5 renewing the old term again is refused", (await api("POST", "/memberships/mb_r_maya/renew", tok, {})).status === 409);
  const again = await api("POST", "/memberships/mb_r_maya/renew", tok, { idempotencyKey: "b101-ren-maya" });
  ok("§5 a retried renewal (same key) returns the same membership", again.status === 200 && again.body.duplicate === true, again.body);

  // ── §6 · a payment through another door ───────────────────────────────────
  const giftsLeo = await api("POST", "/donors/b101r_leo/gifts", tok, { amount: 100, date: today, type: "cash", idempotencyKey: "b101-leo-1" });
  ok("§6 Leo pays $100 through the ordinary gift form", giftsLeo.status < 300, giftsLeo.body);
  const [leoNew] = await q(`SELECT * FROM memberships WHERE org_id=$1 AND donor_id='b101r_leo' AND status='active'`, [O]);
  ok("§6 …which IS his renewal: a new term from the old expiry", leoNew && leoNew.renewed_from === "mb_r_leo" && leoNew.starts_on === addDays(addDays(today, 10), 1), leoNew);
  const [lg] = await q(`SELECT quid_pro_quo_value, deductible_amount FROM gifts WHERE org_id=$1 AND idempotency_key='b101-leo-1'`, [O]);
  ok("§6 …and the gift now carries the benefits split", Number(lg.quid_pro_quo_value) === 25 && Number(lg.deductible_amount) === 75, lg);
  ok("§6 …and his renewal thread closed as an outcome",
     (await q(`SELECT close_kind FROM threads WHERE org_id=$1 AND donor_id='b101r_leo' AND next_step_type='membership_renewal'`, [O]))[0].close_kind === "outcome");
  const moGift = await api("POST", "/donors/b101r_mo/gifts", tok, { amount: 120, date: today, type: "cash", idempotencyKey: "b101-mo-1" });
  ok("§6 Mo's $120 is a gift, not a renewal (never a near miss)",
     moGift.status < 300 && await st("mo") === "active"
     && (await q(`SELECT quid_pro_quo_value FROM gifts WHERE org_id=$1 AND idempotency_key='b101-mo-1'`, [O]))[0].quid_pro_quo_value === null);

  // ── §7 · lapsed members and lapsed donors are different lists ─────────────
  const [ty, tm] = today.split("-").map(Number);
  const FY = tm >= 7 ? ty + 1 : ty;
  const fyStart = `${FY - 1}-07-01`;
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ('g_b101r_lena',$1,'b101r_lena',50,$2,'cash')`, [O, today]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ('g_b101r_don',$1,'b101r_don',80,$2,'cash')`, [O, addDays(fyStart, -30)]);
  const lyb = (await api("GET", `/reports/lybunt?year=${FY}&yearMode=fiscal`, tok)).body;
  const lapsedMembers = (await api("GET", "/memberships?status=lapsed", tok)).body.members.map(x => x.donor_id);
  ok("§7 Lena lapsed as a member but gave this month: in lapsed members", lapsedMembers.includes("b101r_lena"));
  ok("§7 …and NOT in LYBUNT", !lyb.rows.some(r => r.id === "b101r_lena"), lyb.rows.map(r => r.id));
  ok("§7 Don lapsed as a donor: in LYBUNT", lyb.rows.some(r => r.id === "b101r_don"));
  ok("§7 …and NOT in lapsed members (he never was one)", !lapsedMembers.includes("b101r_don"));

  // ── §8 · Home's line, against a hand count ────────────────────────────────
  // Held (active/grace) memberships whose expiry falls in this calendar month.
  const ym = today.slice(0, 7);
  const held = await q(`SELECT expires_on FROM memberships WHERE org_id=$1 AND status IN ('active','grace')`, [O]);
  const hand = held.filter(r => r.expires_on && r.expires_on.slice(0, 7) === ym).length;
  const home = (await api("GET", "/dashboard/home", tok)).body;
  ok("§8 Home counts the memberships expiring this month", home.membershipsExpiringThisMonth === hand, { home: home.membershipsExpiringThisMonth, hand });
  const HN = await import("../shared/homeNote.js");
  ok("§8 …in one line, and none when it is zero",
     HN.membershipSentence(6) === "Six memberships expire this month." && HN.membershipSentence(0) === null);

  // ── §9 · the org's numbers ────────────────────────────────────────────────
  await api("PUT", "/org/membership-settings", tok, { renewalDays: 45 });
  const ms = (await api("GET", "/org/membership-settings", tok)).body;
  ok("§9 changing the window keeps the grace period", ms.renewalDays === 45 && ms.graceDays === 30, ms);
  ok("§9 a nonsense number is refused", (await api("PUT", "/org/membership-settings", tok, { graceDays: -3 })).status === 400);
  const s3 = (await api("POST", "/memberships/run-sweep", tok, {})).body;
  ok("§9 with a 45-day window, Farrah (45 days out) now gets her thread", s3.rows.some(r => r.donorId === "b101r_far"), s3.rows);

  // ── §10 · the browser: the profile panel, renewing from it ────────────────
  // Found by the walk: the history list compared rows by object identity, so
  // the membership a person HOLDS was also listed again beneath itself.
  if (!haveBrowser()) console.log("  SKIP — no Playwright or client/dist (browser leg)");
  else {
    const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
    const lj = await (await fetch(BASE + "/auth/login", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "b101-ren@example.org", password: PW }) })).json();
    const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = []; page.on("pageerror", e => errs.push(String(e)));
    await page.goto(APP + "/login");
    await page.evaluate(d => { localStorage.setItem("npe_token", d.token); localStorage.setItem("npe_user", JSON.stringify(d.user)); localStorage.setItem("npe_org", JSON.stringify(d.org)); }, lj);
    await page.goto(APP + "/donors/b101r_far"); await page.waitForSelector("[data-testid=membership-panel]", { timeout: 15000 });
    const panel = () => page.locator("[data-testid=membership-panel]").innerText();
    const before = await panel();
    ok("§10 the profile shows the membership she holds, and lists it once", /Family/.test(before) && (before.match(/Active/g) || []).length === 1, before);
    await page.locator("[data-testid=membership-renew]").click();
    await page.locator("[data-testid=membership-save]").click();
    // FIX-1 — wait for the history to reload too, not only the sentence: the
    // sentence can land a render before the Renewed row (a battery-load flake).
    await page.waitForFunction(() => { const t = document.querySelector("[data-testid=membership-panel]")?.innerText || "";
      return /renewing early cost no time/.test(t) && /Renewed/.test(t); }, null, { timeout: 15000 }).catch(() => {});
    const after = await panel();
    ok("§10 renewing from the profile says the new term starts after the old one", /cost no time/.test(after), after);
    ok("§10 …shows the old term as Renewed, and the current one once", /Renewed/.test(after) && (after.match(/Active/g) || []).length === 1, after);
    ok("§10 no page error", errs.length === 0, errs);
    await b.close();
  }

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

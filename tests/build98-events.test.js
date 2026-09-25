// BUILD-98 (switch) Part 4 — THE DONOR SIDE OF A GALA.
//
// A ticket is a gift that bought something, and the receipt says so. Each
// assertion is a way that goes wrong in front of a donor or an auditor:
//   §1  a $150 ticket with a $60 dinner receipts $90 deductible — the gift is
//       the full $150, the receipt states both figures;
//   §2  a level whose value is more than its price is refused (a negative
//       deductible is a typo, not a tax position), and capacity holds;
//   §3  a $2,500 sponsor who has not paid is a PLEDGE and a recognition line —
//       not money — and pays down like any pledge;
//   §4  tables group the guest list;
//   §5  attendance lands on twelve timelines ONCE, however often the list is
//       saved, and a no-show says so;
//   §6  a ticket bought online is priced by the server, never by the page,
//       and the webhook writes the split and the guest-list row;
//   §7  another org can touch none of it.
//
// Standard scratch stack (tests/README.md); §6 needs STRIPE_WEBHOOK_SECRET.

const crypto = require("crypto");
const fs = require("fs"), path = require("path");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const haveBrowser = () => { try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; }
  return fs.existsSync(path.join(__dirname, "..", "client", "dist", "index.html")); };
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_b98e", OTHER = "org_b98e2";
const PW = "loadtest1234";
const cents = v => Math.round(Number(v) * 100);

async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of ["receipts", "pledge_installments", "thank_you_drafts", "threads", "tasks", "workflow_runs", "fin_transactions",
                     "interactions", "event_attendees", "event_levels", "events", "gifts", "pledges", "donors", "users",
                     "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

function stripeSig(payload) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${sig}`;
}

(async () => {
  console.log("build98-events");
  await reset();
  for (const [id, name, acct] of [[ORG, "Barn Gala Society", "acct_b98e"], [OTHER, "Somebody Else", "acct_b98e2"]])
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,receipt_address,legal_name,ein,receipts_enabled,
                               stripe_account_id,stripe_connected,timezone,timezone_confirmed_at)
             VALUES ($1,$2,$3,1,'team','active','12 Barn Lane, Lexington, KY 40507',$2,'12-3456789',true,$4,true,'America/New_York',NOW())`,
      [id, name, id.replace(/_/g, "-"), acct]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b98e',$1,'b98e@example.org',$2,'Allie Barnett','admin')`, [ORG, bcrypt.hashSync(PW, 4)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b98e2',$1,'b98e-o@example.org',$2,'Other','admin')`, [OTHER, bcrypt.hashSync(PW, 4)]);
  const tok = await login("b98e@example.org"), tok2 = await login("b98e-o@example.org");

  const ev = await api("POST", "/events", tok, { name: "Barn Gala 2026", eventType: "gala", date: "2026-11-14", location: "The Red Barn", capacity: 120 });
  const EVID = ev.body.id || ev.body.event?.id;
  ok("an event is created", !!EVID, ev.body);

  // ── §1 the $150 ticket ───────────────────────────────────────────────────
  const tl = await api("POST", `/events/${EVID}/levels`, tok, { kind: "ticket", name: "Dinner ticket", price: 150, fmv: 60, capacity: 100 });
  const TIX = tl.body.id;
  const reg = await api("POST", `/events/${EVID}/register`, tok, { name: "Margaret Ruiz", email: "margaret@example.org", levelId: TIX, quantity: 1, paymentMethod: "Check", idempotencyKey: "b98e-1" });
  ok("§1 registering buys the ticket", reg.status === 201, reg.body);
  const [g] = await q(`SELECT amount, deductible_amount, quid_pro_quo_value, quid_pro_quo_desc FROM gifts WHERE id=$1`, [reg.body.giftId]);
  ok("§1 the gift is the full $150 — what she paid and what the org received", cents(g.amount) === 15000);
  ok("§1 …of which $60 is the dinner", cents(g.quid_pro_quo_value) === 6000 && /Dinner ticket/.test(g.quid_pro_quo_desc));
  ok("§1 …and $90 is deductible", cents(g.deductible_amount) === 9000);
  const rc = await api("POST", `/gifts/${reg.body.giftId}/receipt`, tok, { send: false });
  const [rrow] = await q(`SELECT amount, deductible_amount, snapshot FROM receipts WHERE gift_id=$1 AND voided_at IS NULL`, [reg.body.giftId]);
  ok("§1 the receipt is issued", (rc.status === 200 || rc.status === 201) && !!rrow, rc.body);
  ok("§1 THE RECEIPT SAYS $90 DEDUCTIBLE, on a $150 gift", rrow && cents(rrow.amount) === 15000 && cents(rrow.deductible_amount) === 9000, rrow);
  const snap = rrow ? (typeof rrow.snapshot === "string" ? JSON.parse(rrow.snapshot) : rrow.snapshot) : {};
  ok("§1 …and names what was received in exchange", /Dinner ticket/.test(snap.quidProQuoDesc || "") && cents(snap.quidProQuoValue) === 6000, snap);
  const again = await api("POST", `/events/${EVID}/register`, tok, { name: "Margaret Ruiz", email: "margaret@example.org", levelId: TIX, quantity: 1, idempotencyKey: "b98e-1" });
  const [gc] = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND idempotency_key='b98e-1'`, [ORG]);
  ok("§1 a double-tapped register makes ONE gift", again.status === 201 && gc.n === 1);

  // ── §2 refusals ───────────────────────────────────────────────────────────
  const neg = await api("POST", `/events/${EVID}/levels`, tok, { kind: "ticket", name: "Backwards", price: 50, fmv: 80 });
  ok("§2 a value more than the price is refused", neg.status === 400 && /negative/.test(neg.body.error || ""));
  const tiny = await api("POST", `/events/${EVID}/levels`, tok, { kind: "ticket", name: "Two seats", price: 40, fmv: 0, capacity: 2 });
  const full1 = await api("POST", `/events/${EVID}/register`, tok, { name: "Seat One", email: "s1@example.org", levelId: tiny.body.id, quantity: 2 });
  const full2 = await api("POST", `/events/${EVID}/register`, tok, { name: "Seat Two", email: "s2@example.org", levelId: tiny.body.id, quantity: 1 });
  ok("§2 capacity holds: the third seat is refused", full1.status === 201 && full2.status === 409, full2.body);
  const zeroFmv = await q(`SELECT deductible_amount, quid_pro_quo_value FROM gifts WHERE id=$1`, [full1.body.giftId]);
  ok("§2 a level worth nothing in return is fully deductible", cents(zeroFmv[0].deductible_amount) === 8000 && cents(zeroFmv[0].quid_pro_quo_value) === 0);

  // ── §3 the sponsor ───────────────────────────────────────────────────────
  const sl = await api("POST", `/events/${EVID}/levels`, tok, { kind: "sponsor", name: "Gold sponsor", price: 2500, fmv: 0, recognition: "{{name}}, Gold sponsor of the Barn Gala" });
  const sp = await api("POST", `/events/${EVID}/register`, tok, { name: "Acme Feed & Seed", email: "hello@acmefeed.example.org", levelId: sl.body.id, paid: false });
  ok("§3 an unpaid sponsor registers", sp.status === 201, sp.body);
  const [pl] = await q(`SELECT amount, status FROM pledges WHERE id=$1`, [sp.body.pledgeId]);
  ok("§3 …as a PLEDGE of $2,500", pl && cents(pl.amount) === 250000 && pl.status === "open");
  ok("§3 …and NOT as money", !sp.body.giftId);
  const guests = await api("GET", `/events/${EVID}/guests`, tok);
  ok("§3 the recognition line reads as the org wrote it", (guests.body.recognition || []).includes("Acme Feed & Seed, Gold sponsor of the Barn Gala"), guests.body.recognition);
  const acme = (guests.body.guests || []).find(x => x.name === "Acme Feed & Seed");
  await api("POST", `/donors/${acme.donor_id}/gifts`, tok, { amount: 2500, date: "2026-10-01", idempotencyKey: "b98e-spon-pay" });
  const [pl2] = await q(`SELECT status FROM pledges WHERE id=$1`, [sp.body.pledgeId]);
  ok("§3 when the cheque arrives, the sponsorship pledge closes", pl2.status === "fulfilled");

  // ── §4 + §5 twelve guests, tables, attendance ────────────────────────────
  const ids = [];
  for (let i = 1; i <= 12; i++) {
    const r = await api("POST", `/events/${EVID}/register`, tok, { name: `Guest ${i} Person`, email: `g${i}@b98e.example.org`, levelId: TIX, quantity: 1, idempotencyKey: `b98e-g${i}` });
    ids.push(r.body.attendee?.id);
    await api("PUT", `/events/${EVID}/attendees/${r.body.attendee.id}/table`, tok, { table: i <= 6 ? "4" : "head table" });
  }
  const gl = await api("GET", `/events/${EVID}/guests`, tok);
  ok("§4 the guest list groups by table", (gl.body.tables["Table 4"] || []).length === 6 && (gl.body.tables["head table"] || gl.body.tables["Head table"] || []).length === 6, Object.keys(gl.body.tables || {}));
  const att = await api("POST", `/events/${EVID}/attendance`, tok, { attended: ids.slice(0, 10), noShow: ids.slice(10) });
  ok("§5 attendance is saved for twelve", att.body.updated === 12 && att.body.timelineLines === 12, att.body);
  const lines = await q(`SELECT note FROM interactions WHERE org_id=$1 AND metadata->>'via'='event_attendance' AND metadata->>'event_id'=$2`, [ORG, EVID]);
  ok("§5 twelve timelines carry the event", lines.length === 12);
  ok("§5 ten say they came, two say they did not", lines.filter(l => /^Came to/.test(l.note)).length === 10 && lines.filter(l => /did not come/.test(l.note)).length === 2);
  const att2 = await api("POST", `/events/${EVID}/attendance`, tok, { attended: ids.slice(0, 10), noShow: ids.slice(10) });
  const lines2 = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND metadata->>'via'='event_attendance' AND metadata->>'event_id'=$2`, [ORG, EVID]);
  ok("§5 saving the list again writes nothing twice", att2.body.timelineLines === 0 && lines2[0].n === 12);

  // ── §6 a ticket bought online ────────────────────────────────────────────
  const [donor] = await q(`SELECT id FROM donors WHERE org_id=$1 AND LOWER(email)='margaret@example.org'`, [ORG]);
  const piId = "pi_b98e_" + Date.now();
  const payload = JSON.stringify({ id: "evt_" + piId, type: "payment_intent.succeeded", account: "acct_b98e",
    data: { object: { id: piId, amount_received: 30000, receipt_email: "online.buyer@example.org",
      metadata: { donor_email: "online.buyer@example.org", donor_name: "Online Buyer", org_id: ORG, event_level_id: TIX, event_qty: "2", frequency: "once" } } } });
  const wh = await fetch(`${BASE}/stripe/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": stripeSig(payload) }, body: payload });
  void donor;
  const [og] = await q(`SELECT amount, deductible_amount, quid_pro_quo_value FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2`, [ORG, piId]);
  ok("§6 the webhook accepts the ticket payment", wh.status === 200, await wh.text().catch(() => ""));
  ok("§6 two $150 tickets: $300 gift, $120 received, $180 deductible", og && cents(og.amount) === 30000 && cents(og.quid_pro_quo_value) === 12000 && cents(og.deductible_amount) === 18000, og);
  const onl = await q(`SELECT a.quantity FROM event_attendees a JOIN donors d ON d.id=a.donor_id WHERE a.event_id=$1 AND LOWER(d.email)='online.buyer@example.org'`, [EVID]);
  ok("§6 …and the buyer is on the guest list with two places", onl.length === 1 && onl[0].quantity === 2, onl);
  const pub = await fetch(`${BASE}/org/org-b98e/event/${EVID}/public`).then(r => r.json());
  const pubTix = (pub.levels || []).find(l => l.id === TIX);
  ok("§6 the public page shows the level and what is deductible", pubTix && pubTix.price === 150 && pubTix.deductible === 90, pub);
  ok("§6 …and no guest list", !("guests" in pub) && !("recognition" in pub) && !(pub.levels || []).some(l => "guests" in l));

  // ── §7 the wall ──────────────────────────────────────────────────────────
  ok("§7 another org cannot read the guest list", (await api("GET", `/events/${EVID}/guests`, tok2)).status === 404);
  ok("§7 …or register into it", (await api("POST", `/events/${EVID}/register`, tok2, { name: "X", email: "x@example.org", levelId: TIX })).status === 404);
  ok("§7 …or mark attendance", (await api("POST", `/events/${EVID}/attendance`, tok2, { attended: ids })).status === 404);
  ok("§7 …or edit a level", (await api("PUT", `/event-levels/${TIX}`, tok2, { price: 1 })).status === 404);

  // ── §8 the screens ───────────────────────────────────────────────────────
  if (!haveBrowser()) console.log("  SKIP — no Playwright or client/dist (browser leg)");
  else {
    const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errs = []; page.on("pageerror", e => errs.push(e.message));
    page.on("console", m => { if (m.type() === "error" && /ErrorBoundary/.test(m.text())) errs.push(m.text()); });
    // The public ticket page states the deductible part BEFORE she pays.
    await page.goto(`${APP}/give/org-b98e?event=${EVID}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const tix = await page.locator('[data-testid="tickets-deductible"]').innerText().catch(() => "");
    ok("§8 the public ticket page says what is deductible before payment", /\$90(\.00)? is tax-deductible/.test(tix), tix);
    // The staff desk: Fundraising → Events opens the event and its guest list.
    const lj = await (await page.request.post(BASE + "/auth/login", { data: { email: "b98e@example.org", password: PW } })).json();
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await page.evaluate(d => { localStorage.setItem("npe_token", d.token); localStorage.setItem("npe_user", JSON.stringify(d.user)); localStorage.setItem("npe_org", JSON.stringify(d.org)); }, lj);
    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.locator("button:visible", { hasText: "Fundraising" }).first().click(); await page.waitForTimeout(1000);
    await page.locator("button:visible", { hasText: /^Events$/ }).first().click(); await page.waitForTimeout(1200);
    ok("§8 Fundraising → Events lists the gala", (await page.locator('[data-testid="events-desk"]').innerText().catch(() => "")).includes("Barn Gala 2026"));
    await page.locator("button:visible", { hasText: "Barn Gala 2026" }).first().click(); await page.waitForTimeout(1500);
    const detail = await page.locator('[data-testid="event-detail"]').innerText().catch(() => "");
    ok("§8 the event shows its levels with the deductible part", /Dinner ticket/.test(detail) && /\$90(\.00)? deductible/.test(detail), detail.slice(0, 300));
    ok("§8 …the guest list, and the sponsor line for the programme", detail.includes("Guest 1 Person") && detail.includes("Gold sponsor of the Barn Gala"));
    ok("§8 with no page errors", errs.length === 0, errs);
    await browser.close();
  }

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

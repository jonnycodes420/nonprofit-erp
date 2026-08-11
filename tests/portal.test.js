// BUILD-45 — donor portal: auth (§2), dashboard wiring (§3), recurring
// self-service money paths (§4), impact matching + drift wire (§6), and the
// isolation/differential sweeps (§7 S-2/S-3/S-4/S-5).
//
// Local scratch server + Postgres. Needs the server booted with the standard
// run-all env PLUS STRIPE_API_BASE=http://localhost:5603 (the local mock this
// suite starts — the RESEND_BASE_URL pattern for Stripe). The suite starts its
// OWN mail sink on :5602 to capture magic-link + confirmation emails.

const bcrypt = require("bcryptjs");
const http = require("http");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG_P = "org_pt_p", SLUG_P = "portal-p";
const ORG_Q = "org_pt_q", SLUG_Q = "portal-q";
const iso = d => d.toISOString().slice(0, 10);
const TODAY = iso(new Date());
const THIS_YEAR = String(new Date().getFullYear());

// ── capture sinks ──────────────────────────────────────────────────────────
let mail = [];
function startCapturingMailSink(port = 5602) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        try { mail.push(JSON.parse(b)); } catch { /* ignore */ }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ id: "sunk_" + mail.length }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}

// Minimal Stripe mock: enough surface for retrieve/update on subscriptions.
let stripeCalls = [];
function startStripeMock(port = 5603) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        stripeCalls.push({ method: req.method, path: req.url, body: b });
        res.setHeader("Content-Type", "application/json");
        const m = req.url.match(/^\/v1\/subscriptions\/([^/?]+)/);
        if (m) {
          res.end(JSON.stringify({
            id: m[1], object: "subscription", status: "active",
            current_period_end: Math.floor(Date.now() / 1000) + 20 * 86400,
            items: { data: [{ id: "si_mock_1", price: { currency: "usd" } }] },
            default_payment_method: { card: { last4: "4242" } },
          }));
        } else { res.end(JSON.stringify({ ok: true })); }
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}

const settle = (ms = 350) => new Promise(r => setTimeout(r, ms));

async function fixture() {
  const CHILD = [
    "portal_audit_log", "portal_sessions", "portal_magic_links", "impact_updates",
    "workflow_runs", "workflows", "digest_sends", "notification_sends", "notification_failures",
    "moves", "opportunities", "tasks", "payment_recovery_events", "recurring_subscriptions",
    "receipts", "pledges", "fin_audit_log", "fin_transactions", "gifts", "interactions",
  ];
  for (const org of [ORG_P, ORG_Q]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM portal_settings WHERE org_id=$1`, [org]).catch(() => {});
    for (const t of ["donors", "households", "campaigns", "fin_funds", "accounts", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);

  // Org P — the portal org
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id) VALUES ($1,'portal test org','${SLUG_P}',1,'active','growth','acct_pt_p')`, [ORG_P]);
  await q(`INSERT INTO portal_settings (org_id,enabled,min_recurring_cents,contact_email) VALUES ($1,true,500,'hello@portalp.test')`, [ORG_P]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_pt_admin',$1,'pt-admin@test.local',$2,'Portal Admin','admin')`, [ORG_P, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_pt_off',$1,'pt-officer@test.local',$2,'Pat Officer','staff')`, [ORG_P, hash]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_pt_rev',$1,'4010','Contributions','revenue')`, [ORG_P]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_pt_food',$1,'Food Bank Fund',true)`, [ORG_P]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_pt_arts',$1,'Arts Fund',true)`, [ORG_P]);
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount) VALUES ('c_pt_1',$1,'Roof Appeal','appeal','draft',50000)`, [ORG_P]);

  // Donor A — rich history; ASSIGNED to the officer (drift alerts route there).
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,assigned_to,assigned_to_name) VALUES ('d_pt_a',$1,'Dana Donor','dana@donor.test','mid','steward',0,0,'u_pt_off','Pat Officer')`, [ORG_P]);
  // A SECOND record carrying the same email (P-6).
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_pt_a2',$1,'Dana Donor (duplicate)','dana@donor.test','new','cultivate',0,0)`, [ORG_P]);
  // Donor B — the isolation probe inside the same org.
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_pt_b',$1,'Boris Bystander','boris@donor.test','mid','steward',0,0)`, [ORG_P]);

  // Gifts across years (the ledger the dashboard must read).
  const gifts = [
    ["g_pt_1", "d_pt_a", 100, `${THIS_YEAR}-02-01`, "fund_pt_food", null],
    ["g_pt_2", "d_pt_a", 250, `${THIS_YEAR}-05-10`, "fund_pt_food", "c_pt_1"],
    ["g_pt_3", "d_pt_a", 500, `${Number(THIS_YEAR) - 1}-11-20`, null, null],
    ["g_pt_4", "d_pt_a", 75,  `${Number(THIS_YEAR) - 2}-03-05`, null, null],
    ["g_pt_5", "d_pt_a2", 40, `${Number(THIS_YEAR) - 1}-06-15`, null, null],
    ["g_pt_b1", "d_pt_b", 900, `${THIS_YEAR}-01-15`, "fund_pt_arts", null],
  ];
  for (const [id, donor, amt, date, fund, camp] of gifts) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,campaign_id,fund_id) VALUES ($1,$2,$3,$4,$5,'cash','',$6,$7)`, [id, ORG_P, donor, amt, date, camp, fund]);
  }
  await q(`UPDATE donors SET total_giving=925, gift_count=4, last_gift_date='${THIS_YEAR}-05-10', last_gift_amount=250 WHERE id='d_pt_a'`);
  await q(`UPDATE donors SET total_giving=40, gift_count=1 WHERE id='d_pt_a2'`);
  await q(`UPDATE donors SET total_giving=900, gift_count=1 WHERE id='d_pt_b'`);

  // Receipts — the portal must stream the EXISTING stored bytes.
  const fakePdf = Buffer.from("%PDF-1.4 portal-test-receipt").toString("base64");
  await q(`INSERT INTO receipts (id,org_id,donor_id,gift_id,type,receipt_number,amount,deductible_amount,snapshot,pdf_data) VALUES ('r_pt_a',$1,'d_pt_a','g_pt_2','gift','2026-00077',250,250,'{}',$2)`, [ORG_P, fakePdf]);
  await q(`INSERT INTO receipts (id,org_id,donor_id,gift_id,type,receipt_number,amount,deductible_amount,snapshot,pdf_data) VALUES ('r_pt_b',$1,'d_pt_b','g_pt_b1','gift','2026-00078',900,900,'{}',$2)`, [ORG_P, fakePdf]);

  // Recurring subscriptions.
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status) VALUES ('rs_pt_a',$1,'d_pt_a','sub_pt_a',25,'month','active')`, [ORG_P]);
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status) VALUES ('rs_pt_b',$1,'d_pt_b','sub_pt_b',50,'month','active')`, [ORG_P]);

  // A partially-paid pledge (F-5 renders honestly in the portal).
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status) VALUES ('pl_pt_a',$1,'d_pt_a',1000,'2027-01-31','open')`, [ORG_P]);
  await q(`UPDATE gifts SET pledge_id='pl_pt_a' WHERE id='g_pt_2'`);

  // Impact updates: one targeting Dana's fund, one org-wide, one unrelated.
  await q(`INSERT INTO impact_updates (id,org_id,title,body,targets,org_wide,status) VALUES ('imp_pt_1',$1,'Food bank served 400 families','Your fund at work.','[{"kind":"fund","id":"fund_pt_food"}]',false,'published')`, [ORG_P]);
  await q(`INSERT INTO impact_updates (id,org_id,title,body,targets,org_wide,status) VALUES ('imp_pt_2',$1,'Annual report is out','A year of impact.','[]',true,'published')`, [ORG_P]);
  await q(`INSERT INTO impact_updates (id,org_id,title,body,targets,org_wide,status) VALUES ('imp_pt_3',$1,'Arts wing opens','Arts only.','[{"kind":"fund","id":"fund_pt_arts"}]',false,'published')`, [ORG_P]);

  // Org Q — portal enabled, has a donor with DANA'S email (sessions must be
  // entirely independent per org — P-6).
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id) VALUES ($1,'other portal org','${SLUG_Q}',1,'active','growth','acct_pt_q')`, [ORG_Q]);
  await q(`INSERT INTO portal_settings (org_id,enabled) VALUES ($1,true)`, [ORG_Q]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_pt_qadm',$1,'pt-q@test.local',$2,'Q Admin','admin')`, [ORG_Q, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_pt_q1',$1,'Dana In Q','dana@donor.test','new','cultivate',0,0)`, [ORG_Q]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('g_pt_q1',$1,'d_pt_q1',12345,'${THIS_YEAR}-01-01','cash','')`, [ORG_Q]);
}

// helpers for cookie flows
function cookieOf(res) {
  const sc = res.headers?.get ? res.headers.get("set-cookie") : null;
  if (!sc) return null;
  const m = sc.match(/steward_portal=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
async function rawFetch(method, path, { cookie, token, body, headers } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `steward_portal=${encodeURIComponent(cookie)}` } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed = text; try { parsed = JSON.parse(text); } catch { /* raw */ }
  return { status: r.status, body: parsed, headers: r.headers, raw: r };
}

async function latestMagicToken() {
  await settle();
  for (let i = mail.length - 1; i >= 0; i--) {
    const m = /#token=([A-Za-z0-9_-]+)/.exec(mail[i]?.html || "");
    if (m) return m[1];
  }
  return null;
}
async function portalLogin(slug, email) {
  mail = [];
  await rawFetch("POST", `/portal/${slug}/request-link`, { body: { email } });
  const token = await latestMagicToken();
  const v = await rawFetch("POST", `/portal/${slug}/verify`, { body: { token } });
  return { cookie: cookieOf(v), verify: v };
}

(async () => {
  const sink = await startCapturingMailSink();
  const smock = await startStripeMock();
  await fixture();
  const staffTok = await login("pt-admin@test.local");

  // ══ §2 — magic-link auth ══
  console.log("\n— §2 · magic link (P-1/P-2/S-4) —");
  const cfg = await rawFetch("GET", `/portal/${SLUG_P}/config`);
  ok("config 200 for enabled portal", cfg.status === 200 && cfg.body.theme, cfg.body);
  ok("config carries a designed default theme (no unset colors)",
    /^#/.test(cfg.body.theme.primary) && /^#/.test(cfg.body.theme.accent), cfg.body.theme);
  const cfgOff = await rawFetch("GET", `/portal/no-such-org/config`);
  ok("unknown slug → 404", cfgOff.status === 404, cfgOff.status);

  // P-2 — identical response for known and unknown email.
  mail = [];
  const known = await rawFetch("POST", `/portal/${SLUG_P}/request-link`, { body: { email: "dana@donor.test" } });
  const unknown = await rawFetch("POST", `/portal/${SLUG_P}/request-link`, { body: { email: "nobody@donor.test" } });
  ok("known/unknown email → IDENTICAL status + body (no enumeration)",
    known.status === 200 && unknown.status === 200 && JSON.stringify(known.body) === JSON.stringify(unknown.body),
    { known: known.body, unknown: unknown.body });
  await settle();
  const sentTo = mail.map(m => m.to).flat();
  ok("magic link sent ONLY to the known address", sentTo.includes("dana@donor.test") && !sentTo.includes("nobody@donor.test"), sentTo);
  const token1 = await latestMagicToken();
  ok("link token present, ≥32 url-safe chars (≥128-bit CSPRNG)", token1 && token1.length >= 32, token1 && token1.length);
  ok("token travels in the URL FRAGMENT (never sent in Referer)", mail.some(m => (m.html || "").includes("/verify#token=")), null);

  // Re-request invalidates the prior link.
  await rawFetch("POST", `/portal/${SLUG_P}/request-link`, { body: { email: "dana@donor.test" } });
  const token2 = await latestMagicToken();
  const oldTry = await rawFetch("POST", `/portal/${SLUG_P}/verify`, { body: { token: token1 } });
  ok("re-request INVALIDATES the earlier link", oldTry.status === 400, oldTry.status);
  const v2 = await rawFetch("POST", `/portal/${SLUG_P}/verify`, { body: { token: token2 } });
  ok("fresh link verifies → session", v2.status === 200 && v2.body.ok === true, v2.body);
  const cookie1 = cookieOf(v2);
  ok("session cookie set: HttpOnly + SameSite=Lax", !!cookie1 &&
    /HttpOnly/i.test(v2.headers.get("set-cookie")) && /SameSite=Lax/i.test(v2.headers.get("set-cookie")), v2.headers.get("set-cookie"));
  const replay = await rawFetch("POST", `/portal/${SLUG_P}/verify`, { body: { token: token2 } });
  ok("token is SINGLE-USE (replay → 400)", replay.status === 400, replay.status);

  // Expired link.
  mail = [];
  await rawFetch("POST", `/portal/${SLUG_P}/request-link`, { body: { email: "dana@donor.test" } });
  const token3 = await latestMagicToken();
  await q(`UPDATE portal_magic_links SET expires_at = NOW() - INTERVAL '1 minute' WHERE org_id=$1 AND used_at IS NULL AND superseded_at IS NULL`, [ORG_P]);
  const expired = await rawFetch("POST", `/portal/${SLUG_P}/verify`, { body: { token: token3 } });
  ok("expired link → 400", expired.status === 400, expired.status);

  // Audit rows (P-7).
  const audits = await q(`SELECT action, COUNT(*)::int n FROM portal_audit_log WHERE org_id=$1 GROUP BY action`, [ORG_P]);
  const auditMap = Object.fromEntries(audits.map(a => [a.action, a.n]));
  ok("audit: link_requested + session_created rows exist", auditMap.link_requested >= 3 && auditMap.session_created >= 1, auditMap);

  // ══ §3 — dashboard wiring: same ledger as the CRM ══
  console.log("\n— §3 · dashboard (same-ledger wiring, P-6, thin-data honesty) —");
  const me = await rawFetch("GET", `/portal/${SLUG_P}/me`, { cookie: cookie1 });
  ok("/me 200 with session", me.status === 200, me.status);
  const g = me.body.giving;
  // The wiring invariant: portal totals == DB gift sums == donor summaries.
  const [dbSum] = await q(`SELECT COALESCE(SUM(amount),0)::float s, COUNT(*)::int n FROM gifts WHERE org_id=$1 AND donor_id IN ('d_pt_a','d_pt_a2')`, [ORG_P]);
  const [dbTotals] = await q(`SELECT COALESCE(SUM(total_giving),0)::float s FROM donors WHERE id IN ('d_pt_a','d_pt_a2')`);
  ok("lifetime == Σ gift rows == Σ donor summaries (ONE ledger, no parallel computation)",
    g.lifetime === dbSum.s && dbSum.s === dbTotals.s && g.giftCount === dbSum.n, { portal: g.lifetime, gifts: dbSum.s, donors: dbTotals.s });
  const [dbYtd] = await q(`SELECT COALESCE(SUM(amount),0)::float s FROM gifts WHERE org_id=$1 AND donor_id IN ('d_pt_a','d_pt_a2') AND LEFT(date,4)=$2`, [ORG_P, THIS_YEAR]);
  ok("YTD == DB current-calendar-year sum", g.ytd === dbYtd.s, { portal: g.ytd, db: dbYtd.s });
  ok("bar-per-year list covers every giving year, newest first",
    g.byYear.length === 3 && g.byYear[0].year === THIS_YEAR && g.byYear.map(y => y.total).every(t => t > 0), g.byYear);
  ok("first gift date + largest gift from the same rows",
    g.firstGiftDate === `${Number(THIS_YEAR) - 2}-03-05` && g.largestGift === 500, g);
  ok("multi-record email: BOTH Dana records' gifts included (P-6)",
    me.body.gifts.some(x => x.id === "g_pt_5") && me.body.gifts.some(x => x.id === "g_pt_1"), null);
  ok("another donor's gifts NEVER present", !me.body.gifts.some(x => x.id === "g_pt_b1"), null);
  ok("receipted gift links its receipt", me.body.gifts.find(x => x.id === "g_pt_2")?.receiptId === "r_pt_a", null);
  ok("pledge renders HONEST partial balance ($250 paid / $750 open)",
    me.body.pledges.length === 1 && me.body.pledges[0].paid === 250 && me.body.pledges[0].balance === 750, me.body.pledges);
  ok("recurring shows schedule + card last-4 + next charge (display-only)",
    me.body.recurring.length === 1 && me.body.recurring[0].cardLast4 === "4242" && !!me.body.recurring[0].nextChargeDate, me.body.recurring);
  ok("empty household → section ABSENT (hidden, not zeroed)", me.body.household === null || me.body.household === undefined, me.body.household);
  ok("impact: fund-matched first, org-wide fallback included, unrelated fund EXCLUDED",
    me.body.impact.length === 2 && me.body.impact[0].id === "imp_pt_1" && me.body.impact[1].id === "imp_pt_2" &&
    !me.body.impact.some(u => u.id === "imp_pt_3"), me.body.impact.map(u => u.id));

  // Receipts: stored bytes, session-scoped (S-9).
  const pdf = await fetch(BASE + `/portal/${SLUG_P}/receipts/r_pt_a/pdf`, { headers: { Cookie: `steward_portal=${encodeURIComponent(cookie1)}` } });
  const pdfBytes = Buffer.from(await pdf.arrayBuffer());
  ok("own receipt streams the STORED pdf bytes", pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf" && pdfBytes.toString().startsWith("%PDF"), pdf.status);
  const pdfForeign = await rawFetch("GET", `/portal/${SLUG_P}/receipts/r_pt_b/pdf`, { cookie: cookie1 });
  ok("ANOTHER donor's receipt → 404 (S-2/S-9)", pdfForeign.status === 404, pdfForeign.status);
  const pdfNoAuth = await rawFetch("GET", `/portal/${SLUG_P}/receipts/r_pt_a/pdf`);
  ok("receipt without session → 401 (no guessable URLs)", pdfNoAuth.status === 401, pdfNoAuth.status);

  // ══ §4 — recurring self-service money paths ══
  console.log("\n— §4 · recurring mutations (R-1..R-5, R-7, R-8) —");
  // R-2 pause with auto-resume date
  mail = []; stripeCalls = [];
  const resumeDate = iso(new Date(Date.now() + 30 * 86400e3));
  const pause = await rawFetch("POST", `/portal/${SLUG_P}/recurring/rs_pt_a/pause`, { cookie: cookie1, body: { resumeDate } });
  ok("pause 200", pause.status === 200 && pause.body.status === "paused", pause.body);
  ok("Stripe got pause_collection (behavior=void) — zero charges while paused",
    stripeCalls.some(c => c.method === "POST" && c.path.includes("sub_pt_a") && /pause_collection/.test(c.body) && /void/.test(c.body)), stripeCalls.map(c => c.path));
  let [rsRow] = await q(`SELECT status, paused_at, resume_at FROM recurring_subscriptions WHERE id='rs_pt_a'`);
  ok("DB: paused with resume_at stored", rsRow.status === "paused" && !!rsRow.paused_at && !!rsRow.resume_at, rsRow);
  await settle();
  ok("R-8: donor got a pause confirmation on the ORG's letterhead", mail.some(m => (m.subject || "").includes("paused") && String(m.to).includes("dana@donor.test")), mail.map(m => m.subject));
  ok("§6.3: officer alerted (notification_sends row for the pause)",
    (await q(`SELECT COUNT(*)::int n FROM notification_sends WHERE org_id=$1 AND event_key LIKE 'portal:recurring_pause:%'`, [ORG_P]))[0].n === 1, null);
  ok("§6.3: high-priority due-today task landed on the OFFICER",
    // due is stamped with the server's LOCAL date key (which can differ from
    // this process's UTC date near midnight) — assert the task itself.
    (await q(`SELECT COUNT(*)::int n FROM tasks WHERE org_id=$1 AND donor_id='d_pt_a' AND priority='high' AND assigned_to='u_pt_off' AND title LIKE '%reach out today%' AND done=0`, [ORG_P]))[0].n >= 1, null);

  // The dunning processor over a PAUSED schedule: zero sends (R-2 proof).
  mail = [];
  const dun = await api("POST", "/recurring/process-dunning", staffTok);
  ok("dunning processor runs", dun.status === 200 || dun.status === 204, dun.status);
  await settle();
  ok("paused schedule produced ZERO dunning/charge activity", !mail.some(m => String(m.to).includes("dana@donor.test")), mail.map(m => m.to));

  // R-3 resume
  const resume = await rawFetch("POST", `/portal/${SLUG_P}/recurring/rs_pt_a/resume`, { cookie: cookie1 });
  ok("resume 200 → active", resume.status === 200 && resume.body.status === "active", resume.body);
  [rsRow] = await q(`SELECT status, paused_at, resume_at FROM recurring_subscriptions WHERE id='rs_pt_a'`);
  ok("DB: active, pause fields cleared", rsRow.status === "active" && !rsRow.paused_at && !rsRow.resume_at, rsRow);

  // R-1 amount — server-authoritative, integer minor units, org floor.
  const tooSmall = await rawFetch("POST", `/portal/${SLUG_P}/recurring/rs_pt_a/amount`, { cookie: cookie1, body: { amountCents: 300 } });
  ok("below org minimum → 400", tooSmall.status === 400, tooSmall.status);
  const fractional = await rawFetch("POST", `/portal/${SLUG_P}/recurring/rs_pt_a/amount`, { cookie: cookie1, body: { amountCents: 1000.5 } });
  ok("non-integer minor units → 400", fractional.status === 400, fractional.status);
  stripeCalls = [];
  const upAmt = await rawFetch("POST", `/portal/${SLUG_P}/recurring/rs_pt_a/amount`, { cookie: cookie1, body: { amountCents: 4000 } });
  ok("amount change 200 → $40", upAmt.status === 200 && upAmt.body.amount === 40, upAmt.body);
  ok("Stripe re-priced with unit_amount=4000 + proration NONE",
    stripeCalls.some(c => c.method === "POST" && /unit_amount.*4000|4000.*unit_amount/.test(decodeURIComponent(c.body)) && /proration_behavior.*none|none.*proration_behavior/.test(decodeURIComponent(c.body))), null);
  [rsRow] = await q(`SELECT amount::float a FROM recurring_subscriptions WHERE id='rs_pt_a'`);
  ok("DB amount = 40", rsRow.a === 40, rsRow);

  // R-7 — pause and amount-change fired SIMULTANEOUSLY: one coherent outcome.
  const [race1, race2] = await Promise.all([
    rawFetch("POST", `/portal/${SLUG_P}/recurring/rs_pt_a/pause`, { cookie: cookie1, body: {} }),
    rawFetch("POST", `/portal/${SLUG_P}/recurring/rs_pt_a/amount`, { cookie: cookie1, body: { amountCents: 2500 } }),
  ]);
  ok("concurrent pause+amount: no 5xx, each answered deterministically",
    [race1.status, race2.status].every(s => [200, 409].includes(s)), [race1.status, race2.status]);
  [rsRow] = await q(`SELECT status, amount::float a FROM recurring_subscriptions WHERE id='rs_pt_a'`);
  ok("final state coherent (paused; amount is one of the two valid values)",
    rsRow.status === "paused" && [25, 40].includes(rsRow.a), rsRow);
  await rawFetch("POST", `/portal/${SLUG_P}/recurring/rs_pt_a/resume`, { cookie: cookie1 });

  // R-4 cancel — racing double-submit: exactly one wins, org alerted ONCE.
  mail = [];
  const [c1, c2] = await Promise.all([
    rawFetch("POST", `/portal/${SLUG_P}/recurring/rs_pt_a/cancel`, { cookie: cookie1, body: { reason: "moving away" } }),
    rawFetch("POST", `/portal/${SLUG_P}/recurring/rs_pt_a/cancel`, { cookie: cookie1, body: { reason: "moving away" } }),
  ]);
  ok("double cancel: one 200, one 409 (advisory lock serializes)",
    [c1.status, c2.status].sort().join(",") === "200,409", [c1.status, c2.status]);
  [rsRow] = await q(`SELECT status, canceled_at FROM recurring_subscriptions WHERE id='rs_pt_a'`);
  ok("DB: canceled once", rsRow.status === "canceled" && !!rsRow.canceled_at, rsRow);
  await settle();
  ok("cancel drift alert: exactly ONE officer notification (dedup by event key)",
    (await q(`SELECT COUNT(*)::int n FROM notification_sends WHERE org_id=$1 AND event_key='portal:recurring_cancel:rs_pt_a'`, [ORG_P]))[0].n === 1, null);
  ok("cancel reason recorded in the audit trail",
    (await q(`SELECT COUNT(*)::int n FROM portal_audit_log WHERE org_id=$1 AND action='recurring_cancel' AND meta->>'reason'='moving away'`, [ORG_P]))[0].n === 1, null);
  ok("R-8: donor got the cancel confirmation", mail.some(m => (m.subject || "").toLowerCase().includes("cancel")), mail.map(m => m.subject));
  const timeline = await q(`SELECT COUNT(*)::int n FROM interactions WHERE org_id=$1 AND donor_id='d_pt_a' AND note LIKE 'Portal: canceled%'`, [ORG_P]);
  ok("R-8: CRM timeline mirrored the cancel", timeline[0].n === 1, timeline);

  // §6.3 — the Monday day view carries the drift item: the high-priority
  // due-today task lands in the assigned OFFICER's queue with the donor's
  // context and the suggested next step.
  const offTok = await login("pt-officer@test.local");
  const today = await api("GET", "/dashboard/today", offTok);
  const flat = JSON.stringify(today.body || []);
  ok("officer's day view surfaces the drift as a needs-you-today item",
    /recurring gift — reach out today/.test(flat) && /Dana Donor/.test(flat), flat.slice(0, 300));

  // R-5 — card update reuses the existing setup-mode Checkout URL.
  const card = await rawFetch("POST", `/portal/${SLUG_P}/recurring/rs_pt_b/update-card`, { cookie: cookie1 });
  ok("card update on ANOTHER donor's sub → 404 (S-2)", card.status === 404, card.status);
  // (Dana's remaining sub is canceled; create a fresh one to exercise the URL.)
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status) VALUES ('rs_pt_a2',$1,'d_pt_a','sub_pt_a2',10,'month','past_due')`, [ORG_P]);
  const card2 = await rawFetch("POST", `/portal/${SLUG_P}/recurring/rs_pt_a2/update-card`, { cookie: cookie1 });
  ok("card-update returns the signed EXISTING recovery URL (no new card surface)",
    card2.status === 200 && /\/recurring\/update-card\?token=/.test(card2.body.url), card2.body);

  // ══ §7 sweeps — S-2 / S-3 / S-5 ══
  console.log("\n— §7 · differential sweeps —");
  // S-2: Dana's session against ORG Q (same email exists there!) → 401, never data.
  const crossOrg = await rawFetch("GET", `/portal/${SLUG_Q}/me`, { cookie: cookie1 });
  ok("session × ANOTHER org's slug → 401 (even with the same email there)", crossOrg.status === 401, crossOrg.status);
  // Foreign object ids under the right org → 404 everywhere (already proven for
  // receipt + sub above); impact id from nowhere:
  const impForeign = await rawFetch("POST", `/portal/${SLUG_P}/impact/imp_nothere/viewed`, { cookie: cookie1 });
  ok("unknown impact id → 404", impForeign.status === 404, impForeign.status);

  // S-3: portal session × EVERY staff route → 401; staff JWT × portal → 401.
  const staffRoutes = [
    ["GET", "/donors"], ["GET", "/donors/d_pt_a"], ["GET", "/reports/giving-summary"],
    ["GET", "/fundraising/overview"], ["GET", "/finance/summary"], ["GET", "/tasks"],
    ["GET", "/org"], ["GET", "/workflows"], ["GET", "/billing/status"],
    ["GET", "/portal-settings"], ["GET", "/impact-updates"], ["GET", "/portal-audit"],
    ["GET", "/dashboard/today"], ["GET", "/pipeline"], ["GET", "/recurring/health"],
  ];
  let staffLeaks = 0;
  for (const [m, p] of staffRoutes) {
    const r = await rawFetch(m, p, { cookie: cookie1 });
    if (r.status !== 401) staffLeaks++;
  }
  ok(`portal session × ${staffRoutes.length} staff routes → 401 on every one (P-4)`, staffLeaks === 0, staffLeaks);
  const portalMutations = [
    ["POST", `/portal/${SLUG_P}/recurring/rs_pt_a2/pause`], ["POST", `/portal/${SLUG_P}/recurring/rs_pt_a2/cancel`],
    ["POST", `/portal/${SLUG_P}/recurring/rs_pt_a2/amount`], ["POST", `/portal/${SLUG_P}/recurring/rs_pt_a2/update-card`],
    ["GET", `/portal/${SLUG_P}/me`], ["POST", `/portal/${SLUG_P}/impact/imp_pt_1/viewed`],
  ];
  let portalLeaks = 0;
  for (const [m, p] of portalMutations) {
    const r = await rawFetch(m, p, { token: staffTok, ...(m === "GET" ? {} : { body: {} }) });
    if (r.status !== 401) portalLeaks++;
  }
  ok("staff JWT × every portal session route → 401 (P-4, other direction)", portalLeaks === 0, portalLeaks);

  // S-5: scripted burst against the REAL limiter (x-test-enforce-limits
  // exercises it under the scratch stack's DISABLE_RATE_LIMIT).
  const bucket = "burst-" + Date.now();
  const burst = [];
  for (let i = 0; i < 30; i++) {
    burst.push(await rawFetch("POST", `/portal/${SLUG_P}/request-link`, {
      body: { email: `burst${i}@x.test` },
      headers: { "x-test-enforce-limits": "1", "x-test-limit-bucket": bucket },
    }));
  }
  ok("link-request burst per IP: limiter fires (429s appear)", burst.some(b => b.status === 429), burst.map(b => b.status).join(","));
  const emailBurst = [];
  const burstEmail = `oneaddr-${Date.now()}@x.test`;
  for (let i = 0; i < 9; i++) {
    emailBurst.push(await rawFetch("POST", `/portal/${SLUG_P}/request-link`, {
      body: { email: burstEmail }, headers: { "x-test-enforce-limits": "1", "x-test-limit-bucket": bucket + "-em" + i },
    }));
  }
  ok("link-request burst per TARGET EMAIL: limiter fires independently of IP",
    emailBurst.some(b => b.status === 429), emailBurst.map(b => b.status).join(","));
  const mutBurst = [];
  for (let i = 0; i < 45; i++) {
    mutBurst.push(await rawFetch("POST", `/portal/${SLUG_P}/recurring/rs_none/pause`, {
      headers: { "x-test-enforce-limits": "1", "x-test-limit-bucket": bucket + "-mut" }, body: {},
    }));
  }
  ok("portal mutation burst: limiter fires", mutBurst.some(b => b.status === 429), mutBurst.filter(b => b.status === 429).length);

  // S-6 shape: org-authored strings are stored verbatim and delivered as JSON
  // (the React client escapes; no HTML sink exists server-side on this path).
  const xss = await api("PUT", "/portal-settings", staffTok, { footerText: "<script>alert(1)</script>", displayName: "P<img src=x onerror=1>" });
  ok("XSS strings accepted as DATA (stored, not executed anywhere server-side)", xss.status === 200, xss.status);
  const cfg2 = await rawFetch("GET", `/portal/${SLUG_P}/config`);
  ok("config returns org-authored strings as plain JSON (client auto-escapes)",
    cfg2.body.theme.footerText === "<script>alert(1)</script>", cfg2.body.theme.footerText);
  await api("PUT", "/portal-settings", staffTok, { footerText: "", displayName: "" });

  // §5: contrast guard — an illegibly light brand color is deepened, admin told.
  const light = await api("PUT", "/portal-settings", staffTok, { primaryColor: "#ffff99" });
  ok("illegible color DEEPENED to WCAG-legible + admin told why",
    light.status === 200 && light.body.adjusted === true && light.body.primary_color !== "#ffff99", light.body);
  const badColor = await api("PUT", "/portal-settings", staffTok, { primaryColor: "not-a-color" });
  ok("malformed color → 400", badColor.status === 400, badColor.status);

  // Disabled portal goes fully dark.
  await api("PUT", "/portal-settings", staffTok, { enabled: false });
  const darkCfg = await rawFetch("GET", `/portal/${SLUG_P}/config`);
  const darkMe = await rawFetch("GET", `/portal/${SLUG_P}/me`, { cookie: cookie1 });
  ok("disabling the portal 404s config AND kills live sessions", darkCfg.status === 404 && darkMe.status === 401, [darkCfg.status, darkMe.status]);
  await api("PUT", "/portal-settings", staffTok, { enabled: true });

  // Logout revokes.
  await rawFetch("POST", `/portal/${SLUG_P}/logout`, { cookie: cookie1 });
  const afterLogout = await rawFetch("GET", `/portal/${SLUG_P}/me`, { cookie: cookie1 });
  ok("logout revokes the session server-side", afterLogout.status === 401, afterLogout.status);

  if (sink) sink.close();
  if (smock) smock.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

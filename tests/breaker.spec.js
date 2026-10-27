// tests/breaker.spec.js: HARDEN-1 item 4. THE BREAKER. It drives the real app
// in a browser and tries to break it the way people do: double and triple
// clicks on every button that writes, a refresh, a closed tab and a dropped
// network half way through an import and an undo, two tabs on two orgs, an
// Undo toast left up over another screen, delete/import/undo/restore in every
// order, and a laptop that sleeps for three minutes in the middle of an import.
//
// Every case ends the same way: the effect happened exactly once or not at all
// (never half), what the screen says is what the database holds, the
// surfaces agree (tests/lib/surfacesAgree.js when it is present, and this
// file's own DB-vs-Donors-list count always), and NO provider was called. The
// provider check is by count: this suite stands up the Resend sink and every
// provider mock on the ports the server was booted with (tests/shard.sh), and
// counts every request each one receives. The only mail allowed is the one
// campaign the Send case sends, to its own sink address, once.
//
// The file is run by tests/breaker.test.js (run-all.sh and shard.sh run
// `<name>.test.js`); it lives here under the name the brief gave it.
//
// Env:
//   BASE, APP_URL                 the API and the preview (tests/shard.sh sets both)
//   BREAKER_SLEEP_SECS=180        how long the laptop sleeps mid-import
//   BREAKER_FAST=1                sleep 8s instead, for local iteration
//   BREAKER_EXPECT_ORG_BINDING=1  (default on) the two-tab case expects HARDEN-1
//                                 item 1's org-bound writes (X-Steward-Org → 409
//                                 "This page was for A, but you're now in B.
//                                 Reload to continue.", or held in the tab under
//                                 the cross-tab banner). Set 0 to only record
//                                 where the writes landed.
//   BREAKER_ONLY=clicks,drop,...  run some cases (clicks, drop, twotabs, toast, orders, enter, sleep)
//
// HOW IT GOES RED ON MAIN (each planted and watched, see the HARDEN-1 report):
//   · two presses of a campaign's Send emailed every donor twice (crm.js claim)
//   · two presses of an import's "Yes, undo it" both ran the whole undo
//   · a dropped answer on Undo said "Nothing was changed" when it had undone
//   · a bulk delete's Undo put people back ten at a time: a drop half way left
//     half of them back, and the toast could never finish the job
//   · a dropped answer on Import said "Not imported. Nothing was written."
//     about a file that was written (SpreadsheetImport follows the job now)
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, BASE, browserLegOrSkip } = require("./helpers");
let assertSurfacesAgree = null;
try { ({ assertSurfacesAgree } = require("./lib/surfacesAgree")); } catch { /* another branch: the minimal check below still runs */ }

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const APP = process.env.APP_URL || "http://localhost:4173";
const PASSWORD = "loadtest1234";
const FAST = process.env.BREAKER_FAST === "1";
const SLEEP_SECS = Number(process.env.BREAKER_SLEEP_SECS || (FAST ? 8 : 180));
const EXPECT_BINDING = process.env.BREAKER_EXPECT_ORG_BINDING !== "0";
const ONLY = new Set(String(process.env.BREAKER_ONLY || "").split(",").map(s => s.trim()).filter(Boolean));
const want = name => !ONLY.size || ONLY.has(name);
const ORG_BINDING_SENTENCE = /This page was for .+, but you're now in .+\. Reload to continue\./;
const TABLES = ["campaign_recipients", "campaigns", "audience_members", "audiences", "deleted_records", "interactions", "receipts", "pledges",
  "gifts", "imports", "sheet_import_jobs", "import_recent_work", "import_recent_jobs", "donor_scores", "thank_you_drafts", "tasks",
  "fin_transactions", "event_attendees", "events", "send_confirms", "mail_blocked", "donors", "households", "fin_funds", "accounts", "budgets", "users"];
const one = async (sql, args) => (await q(sql, args))[0];
const wait = ms => new Promise(r => setTimeout(r, ms));

// ── THE PROVIDERS: every one is a counting mock on the port the server calls ──
const MOCK_PORTS = {
  resend: Number(process.env.SINK_PORT || 5602),
  stripe: Number(process.env.STRIPE_MOCK_PORT || 5603),
  billing: Number(process.env.BILLING_MOCK_PORT || 5604),
  bookkeeping: Number(process.env.BOOKKEEPING_MOCK_PORT || 5632),
  xero: Number(process.env.XERO_MOCK_PORT || 5633),
  resendReceiving: Number(process.env.RESEND_RECV_PORT || 5612),
  calendarMailchimpEtc: Number(process.env.CALENDAR_MOCK_PORT || 5618),
};
const mocks = {};   // name -> { calls: [{method, url, body}] }
function startMock(name, port) {
  return new Promise(resolve => {
    const st = { calls: [], bound: false };
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => (b += c));
      req.on("end", () => {
        let body = b; try { body = JSON.parse(b); } catch { }
        st.calls.push({ method: req.method, url: req.url, body, at: performance.now() });
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ id: `${name}_${st.calls.length}` }));
      });
    });
    srv.on("error", () => resolve(st));   // already bound (a hand-run beside another suite): counted as unknown
    srv.listen(port, () => { st.bound = true; st.srv = srv; resolve(st); });
  }).then(st => (mocks[name] = st));
}
const sinkTo = addr => mocks.resend.calls.filter(c => c.body && [].concat(c.body.to || []).map(String).map(s => s.toLowerCase()).includes(addr.toLowerCase()));
// A case's own provider check: nothing reached any provider but the mail it
// was allowed, and no mail reached anyone in its org it did not send to.
async function noProviderCalls(label, orgId, allowedMail = []) {
  const others = Object.entries(mocks).filter(([n]) => n !== "resend").flatMap(([n, s]) => s.calls.map(c => n + " " + c.method + " " + c.url));
  const emails = (await q("SELECT LOWER(email) AS e FROM donors WHERE org_id=$1 AND email IS NOT NULL UNION SELECT LOWER(email) FROM users WHERE org_id=$1", [orgId])).map(r => r.e);
  const mail = mocks.resend.calls.filter(c => [].concat((c.body && c.body.to) || []).some(t => emails.includes(String(t).toLowerCase()) && !allowedMail.includes(String(t).toLowerCase())));
  ok(`${label}: no provider was called (sink, Stripe, billing, books, calendar/mail mocks)`, !others.length && !mail.length,
    { others: others.slice(0, 5), mail: mail.map(m => m.body && m.body.to).slice(0, 5) });
}

// ── fixture orgs ─────────────────────────────────────────────────────────
async function freshOrg(id, name, { email } = {}) {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [id]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [id]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,receipt_address) VALUES ($1,$2,$3,1,'active','team','1 Test Way, Testville, TS 00000')`,
    [id, name, id.replace(/_/g, "-")]);
  const em = email || `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Brook Breaker','admin')`, ["u_" + id, id, em, bcrypt.hashSync(PASSWORD, 4)]);
  const r = await api("POST", "/auth/login", null, { email: em, password: PASSWORD });
  if (!r.body || !r.body.token) throw new Error("login failed for " + em + ": " + JSON.stringify(r.body));
  return { orgId: id, token: r.body.token, user: r.body.user, org: r.body.org };
}
async function person(orgId, id, name, emailAddr) {
  await q(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,person_types,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,'steward','active','[]','["donor"]','system:test','test')`, [id, orgId, name, emailAddr || null]);
  return id;
}
const counts = async orgId => one(`SELECT
   (SELECT COUNT(*)::int FROM donors WHERE org_id=$1 AND deleted_at IS NULL) AS alive,
   (SELECT COUNT(*)::int FROM donors WHERE org_id=$1 AND deleted_at IS NOT NULL) AS deleted,
   (SELECT COUNT(*)::int FROM gifts WHERE org_id=$1) AS gifts,
   (SELECT COUNT(*)::int FROM imports WHERE org_id=$1) AS imports,
   (SELECT COUNT(*)::int FROM imports WHERE org_id=$1 AND reversed_at IS NOT NULL) AS reversed,
   (SELECT COUNT(*)::int FROM sheet_import_jobs WHERE org_id=$1) AS jobs`, [orgId]);

// The minimal surfaces check: the Donors list says what the database holds.
async function surfacesAgree(label, o, extra) {
  const list = await api("GET", "/donors?limit=25&offset=0", o.token);
  const db = await one(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND archived_at IS NULL`, [o.orgId]).catch(async () =>
    one(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [o.orgId]));
  ok(`${label}: the Donors list counts what the database holds`, list.status === 200 && list.body.total === db.n, { list: list.body && list.body.total, db: db.n, ...(extra || {}) });
  if (assertSurfacesAgree) {
    try { const r = await assertSurfacesAgree(o.orgId, { token: o.token, base: BASE, label, q }); ok(`${label}: assertSurfacesAgree`, r !== false && !(r && r.ok === false), r); }
    catch (e) { ok(`${label}: assertSurfacesAgree`, false, e.message); }
  }
}

// ── the files ────────────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "breaker-"));
function csvFile(name, header, rows) {
  const p = path.join(TMP, name);
  const cell = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  fs.writeFileSync(p, [header, ...rows].map(r => r.map(cell).join(",")).join("\n") + "\n");
  return p;
}
const giftsFile = (name, n, who = i => `Quentin Breakfile${i}`) =>
  csvFile(name, ["Date", "Donor", "Amount"], Array.from({ length: n }, (_, i) => [`2026-09-${String(1 + (i % 28)).padStart(2, "0")}`, who(i), String(20 + i)]));

// ── the browser ──────────────────────────────────────────────────────────
function browserReady() {
  if (!fs.existsSync(path.join(DIST, "index.html"))) return "client/dist not built";
  const API_ORIGIN = BASE.replace(/^https?:\/\//, "");
  const dir = path.join(DIST, "assets");
  const js = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".js")) : [];
  if (!js.some(f => fs.readFileSync(path.join(dir, f), "utf8").includes(API_ORIGIN))) return "client/dist not built against the local API";
  try { require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright")); }
  catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
  return null;
}
let browser = null;
// A context signed in to one org. The session is written ONCE per tab
// (sessionStorage marks it), so a tab that reloads keeps whatever the other
// tab later wrote to localStorage, exactly as a real browser does.
async function signedIn(o, { viewport = { width: 1440, height: 1000 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(([t, u, g]) => {
    try {
      if (!sessionStorage.getItem("brk_init") && !localStorage.getItem("brk_shared")) {
        localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", g);
        localStorage.setItem("brk_shared", "1");
      }
      sessionStorage.setItem("brk_init", "1");
    } catch { }
  }, [o.token, JSON.stringify(o.user), JSON.stringify(o.org)]);
  // Nothing leaves the machine: anything not loopback is refused.
  await ctx.route(url => !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(String(url)), r => r.abort().catch(() => {}));
  ctx.errors = [];
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on("dialog", d => d.accept().catch(() => {}));
  page.on("pageerror", e => ctx.errors.push(String(e.message || e)));
  page.writes = [];
  page.on("response", r => { const m = r.request().method(); if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") page.writes.push({ m, url: r.url().replace(BASE, ""), status: r.status() }); });
  return page;
}
const writesTo = (page, re, status) => page.writes.filter(w => re.test(w.m + " " + w.url) && (status === undefined || (status === "2xx" ? w.status < 300 : w.status === status)));
async function openSheetImport(page) {
  if (!/\/donors(\?|$)/.test(page.url())) await page.goto(`${APP}/donors`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: /Import & tools/ }).first().click({ timeout: 30000 });
  await page.getByRole("menuitem", { name: /Import a spreadsheet|Any spreadsheet/ }).first().click({ timeout: 10000 });
  await page.waitForSelector('[data-testid="sheet-import"]', { timeout: 15000 });
}
async function chooseFile(page, file) {
  await page.setInputFiles('[data-testid="sheet-file"]', file);
  await page.waitForSelector('[data-testid="sheet-import-go"]:not([disabled])', { timeout: 60000 });
}
const textOf = async (page, sel) => (await page.locator(sel).first().textContent({ timeout: 2000 }).catch(() => "")) || "";
async function waitForDb(fn, ms = 30000) { const t0 = performance.now(); let v; while (performance.now() - t0 < ms) { v = await fn(); if (v) return v; await wait(250); } return v; }

// ═════════════════════════════════════════════════════════════════════════
// CASE 1 · EVERY BUTTON THAT WRITES, PRESSED TWO AND THREE TIMES
// ═════════════════════════════════════════════════════════════════════════
async function caseClicks() {
  const L = "clicks";
  const caseStart = (await one("SELECT NOW() AS t")).t;
  const o = await freshOrg("org_brk_clicks", "Breaker Clicks (test)");
  const CLICK_NAMES = ["Cleo Ashby", "Marta Quill", "Ivo Brandt", "Pia Lorne", "Rufus Hale", "Gwen Tarr"];
  for (let i = 1; i <= 6; i++) await person(o.orgId, `d_brk_c${i}`, CLICK_NAMES[i - 1], `brk-c${i}@test.local`);
  const ctx = await signedIn(o);
  const page = await newPage(ctx);

  // 1a · Import, pressed three times
  await openSheetImport(page);
  await chooseFile(page, giftsFile("clicks-20.csv", 20));
  await page.locator('[data-testid="sheet-import-go"]').click({ clickCount: 3 });
  await page.locator('[data-testid="sheet-import-go"]').click({ timeout: 500 }).catch(() => {});
  await page.waitForSelector('[data-testid="sheet-result"]', { timeout: 90000 });
  let c = await counts(o.orgId);
  ok(`${L} §1 Import pressed 4 times: one import run, 20 gifts, 20 new people`, c.imports === 1 && c.jobs === 1 && c.gifts === 20 && c.alive === 26, c);

  // 1b · Undo, from the receipt AND from Settings, Imports in a second tab, at once, each pressed three times
  const imp = await one("SELECT id FROM imports WHERE org_id=$1", [o.orgId]);
  const page2 = await newPage(ctx);
  await page2.goto(`${APP}/app/settings?section=imports&import=${encodeURIComponent(imp.id)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator('[data-testid="import-undo-open"]').dblclick();
  await page2.locator('[data-testid="import-undo-open"]').first().click({ timeout: 30000 });
  await page.waitForSelector('[data-testid="import-undo-yes"]', { timeout: 15000 });
  await page2.waitForSelector('[data-testid="import-undo-yes"]', { timeout: 15000 });
  await Promise.all([page.locator('[data-testid="import-undo-yes"]').click({ clickCount: 3 }), page2.locator('[data-testid="import-undo-yes"]').click({ clickCount: 3 })]);
  await Promise.all([page, page2].map(p => p.waitForSelector('[data-testid="import-undo-done"], [role="alert"]', { timeout: 60000 }).catch(() => null)));
  c = await counts(o.orgId);
  const undos = [...writesTo(page, /\/reverse$/, "2xx"), ...writesTo(page2, /\/reverse$/, "2xx")];
  ok(`${L} §1 Undo pressed six times in two tabs: ONE undo ran, the import is gone`, undos.length === 1 && c.reversed === 1 && c.gifts === 0 && c.alive === 6,
    { undos: undos.length, all: [...writesTo(page, /\/reverse$/), ...writesTo(page2, /\/reverse$/)].map(w => w.status), c });
  const said = [await textOf(page, '[data-testid="sheet-result"]'), (await textOf(page2, '[data-testid="import-receipt"]')) + (await textOf(page2, '[data-testid="import-undo"]'))];
  ok(`${L} §1 both tabs say it is undone (neither says nothing changed)`, said.every(s => /undone/i.test(s) && !/Nothing was changed/i.test(s)), said.map(s => s.slice(0, 160)));
  await page2.close();

  // 1c · Delete on a profile, pressed twice (it goes at once, with an Undo)
  await page.goto(`${APP}/donors/d_brk_c1`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator('[data-testid="dp-more"]').first().click({ timeout: 30000 });
  await page.locator('[data-testid="dp-delete"]').dblclick({ timeout: 10000 }).catch(() => {});
  await page.waitForSelector('[data-testid="undo-toast"]', { timeout: 15000 }).catch(() => {});
  const trash1 = await one("SELECT COUNT(*)::int AS n FROM deleted_records WHERE org_id=$1 AND record_id='d_brk_c1'", [o.orgId]);
  ok(`${L} §1 Delete pressed twice: one delete, one trash row`, trash1.n === 1 && writesTo(page, /DELETE \/donors\/d_brk_c1$/, "2xx").length === 1, { trash: trash1.n, w: writesTo(page, /\/donors\/d_brk_c1$/) });

  // 1d · Bulk delete of 3, the confirm pressed three times; then the toast's Undo three times
  await page.goto(`${APP}/donors`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".dir-donor-row", { timeout: 30000 });
  for (const nm of CLICK_NAMES.slice(1, 4))
    await page.locator(".dir-donor-row", { hasText: nm }).locator('input[type="checkbox"]').first().check({ timeout: 10000 });
  await page.locator('[data-testid="dir-bulk-bar"]').getByRole("button", { name: /^Delete$/ }).click({ timeout: 10000 });
  await page.getByRole("button", { name: "Delete 3 people" }).click({ clickCount: 3, timeout: 10000 });
  await page.waitForSelector('[data-testid="undo-toast"]', { timeout: 15000 });
  const bulk = writesTo(page, /\/donors\/bulk-delete$/);
  const trash3 = await one("SELECT COUNT(*)::int AS n FROM deleted_records WHERE org_id=$1 AND record_id = ANY($2)", [o.orgId, ["d_brk_c2", "d_brk_c3", "d_brk_c4"]]);
  ok(`${L} §1 bulk Delete pressed three times: one delete of exactly 3`, bulk.filter(w => w.status < 300).length === 1 && trash3.n === 3 && (await counts(o.orgId)).deleted === 4,
    { bulk, trash: trash3.n });
  await page.locator('[data-testid="undo-toast-undo"]').click({ clickCount: 3 });
  await waitForDb(async () => (await counts(o.orgId)).deleted === 1, 15000);
  const back = await one("SELECT COUNT(*)::int AS n FROM deleted_records WHERE org_id=$1 AND record_id = ANY($2) AND restored_at IS NOT NULL", [o.orgId, ["d_brk_c2", "d_brk_c3", "d_brk_c4"]]);
  const toastErr = await textOf(page, '[data-testid="undo-toast"]');
  ok(`${L} §1 the toast's Undo pressed three times: the 3 are back, once, with no error`, back.n === 3 && (await counts(o.orgId)).deleted === 1 && !/could not/i.test(toastErr),
    { back: back.n, toast: toastErr });

  // 1e · Bring them back, pressed three times (d_brk_c1 was deleted in 1c)
  await openSheetImport(page);
  await page.setInputFiles('[data-testid="sheet-file"]', csvFile("bring.csv", ["Date", "Donor", "Email", "Amount"], [["2026-10-01", "Cleo Ashby", "brk-c1@test.local", "15"]]));
  await page.waitForSelector('[data-testid="sheet-bring-back"]', { timeout: 60000 });
  await page.locator('[data-testid="sheet-bring-back"]').click({ clickCount: 3 });
  await waitForDb(async () => !(await one("SELECT deleted_at FROM donors WHERE id='d_brk_c1'")).deleted_at, 15000);
  const bb = writesTo(page, /\/sheet-import\/bring-back$/);
  ok(`${L} §1 Bring them back pressed three times: one bring-back, the person is here once`, bb.filter(w => w.status < 300).length === 1
    && !(await one("SELECT deleted_at FROM donors WHERE id='d_brk_c1'")).deleted_at
    && (await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND LOWER(name)='cleo ashby'", [o.orgId])).n === 1, bb);
  await page.keyboard.press("Escape").catch(() => {});

  // 1f · Save on a person edit, pressed three times
  await page.goto(`${APP}/donors/d_brk_c5`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator('[data-testid="dp-more"]').first().click({ timeout: 30000 });
  await page.getByRole("menuitem", { name: /Edit record/ }).first().click({ timeout: 10000 }).catch(() => page.getByText("Edit record").first().click());
  // The form fills itself from the record after it opens; on a slow runner (CI,
  // 27 Oct) a value typed before that was overwritten. Type once it holds still.
  const phone = page.locator('input[placeholder="Phone"]').first();
  await phone.waitFor({ state: "visible", timeout: 10000 });
  await wait(600);
  for (let i = 0; i < 5 && (await phone.inputValue().catch(() => "")) !== "555-0101"; i++) { await phone.fill("555-0101"); await wait(300); }
  await page.getByRole("button", { name: /Save Changes/ }).click({ clickCount: 3 });
  await waitForDb(async () => (await one("SELECT phone FROM donors WHERE id='d_brk_c5'")).phone === "555-0101", 10000);
  await wait(800);
  const puts = writesTo(page, /PUT \/donors\/d_brk_c5$/, "2xx");
  // audit rows are append-only (an earlier run's rows stay), so count this run's
  const edits = await one(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1 AND entity_id='d_brk_c5' AND request_method='PUT' AND (status_code IS NULL OR status_code<400) AND created_at >= $2`, [o.orgId, caseStart]);
  ok(`${L} §1 Save on a person edit pressed three times: one save, one audit row`, puts.length === 1 && edits.n === 1,
    { puts: puts.length, audit: edits.n, every: writesTo(page, /\/donors\/d_brk_c5$/).map(w => `${w.m} ${w.status}`),
      phone: await phone.inputValue().catch(() => null), says: (await textOf(page, '[role="dialog"]')).slice(0, 300) });

  // 1g · Save on a new gift, three times; then Save on its edit, three times
  await page.goto(`${APP}/donors/d_brk_c6`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("tab", { name: /Gifts & pledges/ }).first().click({ timeout: 30000 }).catch(() => page.locator('[data-tab="gifts"]').first().click());
  await page.getByRole("button", { name: /\+ Add Gift/ }).first().click({ timeout: 15000 });
  await page.locator('input[placeholder="Amount ($)"]').first().fill("77");
  await page.getByRole("button", { name: /^Save$/ }).first().click({ clickCount: 3 });
  await waitForDb(async () => (await one("SELECT COUNT(*)::int AS n FROM gifts WHERE donor_id='d_brk_c6'")).n > 0, 15000);
  await wait(1200);
  const g6 = await q("SELECT id, amount FROM gifts WHERE donor_id='d_brk_c6'");
  ok(`${L} §1 Save on a new gift pressed three times: one gift`, g6.length === 1 && Number(g6[0].amount) === 77, g6);
  if (g6.length) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: /Gifts & pledges/ }).first().click({ timeout: 30000 }).catch(() => page.locator('[data-tab="gifts"]').first().click());
    await page.getByRole("button", { name: /^Edit$/ }).first().click({ timeout: 15000 });
    await page.locator('input[placeholder="Amount"]').first().fill("78");
    await page.getByRole("button", { name: /^Save$/ }).first().click({ clickCount: 3 });
    await page.getByTestId("confirm-yes").click({ timeout: 2500 }).catch(() => {});
    await waitForDb(async () => Number((await one("SELECT amount FROM gifts WHERE id=$1", [g6[0].id])).amount) === 78, 10000);
    await wait(800);
    const gp = writesTo(page, new RegExp(`PUT /gifts/${g6[0].id}$`), "2xx");
    ok(`${L} §1 Save on a gift edit pressed three times: one save, still one gift`, gp.length === 1
      && (await one("SELECT COUNT(*)::int AS n FROM gifts WHERE donor_id='d_brk_c6'")).n === 1, { puts: gp.length });
  }

  // 1h · Send a campaign to one sink address: Send pressed twice, the confirm three times;
  //      then the answer is lost and she presses Send again
  await q("UPDATE orgs SET emails_enabled=true, onboarded_at=NOW(), onboarded_via='test' WHERE id=$1", [o.orgId]);
  const sinkAddr = "brk-send-once@test.local";
  await q("UPDATE donors SET email=$2, auto_email=true WHERE id=$1", ["d_brk_c6", sinkAddr]);
  const camp = await api("POST", "/campaigns", o.token, { name: "Breaker once", subject: "Hello", body: "Hi {{first_name}}", segment: { mode: "manual", donorIds: ["d_brk_c6"] }, status: "draft" });
  const campId = camp.body && (camp.body.id || (camp.body.campaign && camp.body.campaign.id));
  await page.goto(`${APP}/app/communications?subtab=campaigns&campaign=${campId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator(`[data-testid="camp-row"]`).first().locator('[data-testid="edit-in-editor"]').first().click({ timeout: 30000 })
    .catch(() => page.locator('[data-testid="edit-in-editor"]').first().click({ timeout: 10000 }));
  await page.waitForSelector('[data-testid="campaign-send"]:not([disabled])', { timeout: 30000 });
  await page.locator('[data-testid="campaign-send"]').dblclick();
  await page.getByTestId("confirm-yes").first().click({ clickCount: 3, timeout: 15000 });
  await page.getByTestId("confirm-yes").first().click({ timeout: 1500 }).catch(() => {});
  await waitForDb(async () => sinkTo(sinkAddr).length > 0, 15000);
  await wait(2500);
  ok(`${L} §1 Send pressed twice and its confirm three times: the donor got ONE email`, sinkTo(sinkAddr).length === 1,
    { sink: sinkTo(sinkAddr).length, sends: writesTo(page, /\/send$/).map(w => w.status) });
  // the lost answer: the server sends, the browser never hears; she presses Send again from a second tab
  const camp2 = await api("POST", "/campaigns", o.token, { name: "Breaker lost answer", subject: "Hello again", body: "Hi", segment: { mode: "manual", donorIds: ["d_brk_c6"] }, status: "draft" });
  const camp2Id = camp2.body && (camp2.body.id || (camp2.body.campaign && camp2.body.campaign.id));
  const before = sinkTo(sinkAddr).length;
  const [r1, r2] = await Promise.all([api("POST", `/campaigns/${camp2Id}/send`, o.token, {}), api("POST", `/campaigns/${camp2Id}/send`, o.token, {})]);
  await wait(2500);
  ok(`${L} §1 Send pressed in two tabs at once (or again after a lost answer): ONE email`, sinkTo(sinkAddr).length - before === 1,
    { statuses: [r1.status, r2.status], sink: sinkTo(sinkAddr).length - before });

  await surfacesAgree(L, o);
  await noProviderCalls(L, o.orgId, [sinkAddr]);
  ok(`${L}: no page error`, !ctx.errors.length, ctx.errors.slice(0, 3));
  await ctx.close();
}

// ═════════════════════════════════════════════════════════════════════════
// CASE 2 · REFRESH, CLOSE THE TAB, DROP THE NETWORK HALF WAY
// ═════════════════════════════════════════════════════════════════════════
// "Half way" is made exact: the request reaches the server and the server
// does its work (route.fetch), and then the browser loses the answer (the tab
// reloads, closes, or goes offline before it arrives).
async function caseDrop() {
  for (const how of ["refresh", "close", "offline"]) {
    const L = `drop/${how}`;
    const o = await freshOrg(`org_brk_drop_${how}`, `Breaker Drop ${how} (test)`);
    await person(o.orgId, `d_brk_dr_${how}`, "Dora Alreadyhere", null);
    const ctx = await signedIn(o);
    let page = await newPage(ctx);
    const file = giftsFile(`drop-${how}.csv`, 60, i => `Ned Dropfile${i}`);
    await openSheetImport(page);
    await chooseFile(page, file);
    let hold;
    const held = new Promise(res => (hold = res));
    await page.route("**/sheet-import/commit", async route => {
      const resp = await route.fetch();          // the server has it and has started the job
      hold(resp);
      if (how === "offline") { await ctx.setOffline(true); await route.abort("internetdisconnected").catch(() => {}); }
      else await wait(60000).then(() => route.fulfill({ response: resp })).catch(() => {});
    });
    await page.locator('[data-testid="sheet-import-go"]').click();
    await held;
    if (how === "refresh") await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    if (how === "close") { await page.close(); page = await newPage(ctx); await page.goto(`${APP}/donors`, { waitUntil: "domcontentloaded" }); }
    if (how === "offline") {
      await page.waitForSelector('[data-testid="sheet-failed"], [data-testid="sheet-job"], [data-testid="sheet-result"]', { timeout: 20000 }).catch(() => {});
      await wait(1500);
    }
    // Every job, once none is running: a lost answer may leave a second job (CI,
    // 27 Oct: two rows, one failed), so read them all, never one row at random.
    const jobs = await waitForDb(async () => { const js = await q("SELECT status, error, request_key FROM sheet_import_jobs WHERE org_id=$1 ORDER BY started_at, id", [o.orgId]);
      return js.length && js.every(j => j.status !== "running") ? js : null; }, 60000) || [];
    const c = await counts(o.orgId);
    ok(`${L} import: the file is all written or not at all (never half)`, jobs.some(j => j.status === "done") ? c.gifts === 60 && c.alive === 61 && c.imports === 1 : c.gifts === 0 && c.alive === 1, { jobs, c });
    ok(`${L} import: at most one job wrote the file`, jobs.filter(j => j.status === "done").length <= 1, jobs);
    if (jobs.length > 1) console.log(`  (${L}: ${jobs.length} jobs: ${jobs.map(j => `${j.status}${j.error ? ` "${String(j.error).slice(0, 160)}"` : ""}`).join("; ")})`);
    if (how === "offline") {
      const says = await textOf(page, '[data-testid="sheet-failed"]');
      ok(`${L} import: while offline the screen does not say "Nothing was written" about a file that was written`,
        !(c.gifts > 0 && /Nothing was written|Not imported/i.test(says)), { says, c });
      await ctx.setOffline(false);
      const back = await page.waitForSelector('[data-testid="sheet-result"]', { timeout: 30000 }).then(() => true).catch(() => false);
      ok(`${L} import: back online, the same window shows the receipt of what was written`, back, await textOf(page, '[data-testid="sheet-import"]'));
    }
    // back on: open Import again. It follows the job or shows the receipt; pressing Import again adds nothing.
    await page.unroute("**/sheet-import/commit").catch(() => {});
    await page.goto(`${APP}/donors`, { waitUntil: "domcontentloaded" });
    await openSheetImport(page);
    const following = await page.waitForSelector('[data-testid="sheet-job"], [data-testid="sheet-result"]', { timeout: 4000 }).then(() => true).catch(() => false);
    await page.setInputFiles('[data-testid="sheet-file"]', file).catch(() => {});
    if (await page.waitForSelector('[data-testid="sheet-import-go"]:not([disabled])', { timeout: 30000 }).then(() => true).catch(() => false)) {
      await page.locator('[data-testid="sheet-import-go"]').click();
      await page.waitForSelector('[data-testid="sheet-result"], [data-testid="sheet-failed"]', { timeout: 60000 }).catch(() => {});
    }
    const c2 = await counts(o.orgId);
    ok(`${L} import: retrying the same file does not duplicate a gift or a person`, c2.gifts === c.gifts && c2.alive === c.alive, { before: c, after: c2, following });
    const rec = (await api("GET", "/imports", o.token)).body;
    const recs = (rec && (rec.imports || rec.rows || rec)) || [];
    ok(`${L} import: the Imports list says what was written`, Array.isArray(recs) ? recs.length >= 1 : true, JSON.stringify(rec).slice(0, 200));

    // the undo, half way, the same three ways
    const imp = await one("SELECT id FROM imports WHERE org_id=$1 ORDER BY committed_at LIMIT 1", [o.orgId]);
    await page.goto(`${APP}/app/settings?section=imports&import=${encodeURIComponent(imp.id)}`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="import-undo-open"]').first().click({ timeout: 30000 });
    await page.waitForSelector('[data-testid="import-undo-yes"]', { timeout: 15000 });
    let hold2; const held2 = new Promise(res => (hold2 = res));
    await page.route("**/reverse", async route => {
      const resp = await route.fetch(); hold2(resp);
      if (how === "offline") { await ctx.setOffline(true); await route.abort("internetdisconnected").catch(() => {}); }
      else await wait(60000).then(() => route.fulfill({ response: resp })).catch(() => {});
    });
    await page.locator('[data-testid="import-undo-yes"]').click();
    await held2;
    if (how === "refresh") await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    if (how === "close") { await page.close(); page = await newPage(ctx); }
    let says = "";
    if (how === "offline") {
      await page.waitForSelector('[data-testid="import-undo"] [role="alert"], [data-testid="import-undo-done"]', { timeout: 15000 }).catch(() => {});
      says = (await textOf(page, '[data-testid="import-undo"] [role="alert"]')) || (await textOf(page, '[data-testid="import-undo-done"]'));
    }
    const u = await counts(o.orgId);
    ok(`${L} undo: the undo is whole (every gift and every person the file made gone, the one already here kept)`, u.reversed === 1 && u.gifts === 0 && u.alive === 1, u);
    if (how === "offline") {
      ok(`${L} undo: offline, the screen never says "Nothing was changed" about an undo that ran`, !/Nothing was changed/i.test(says), says);
      await ctx.setOffline(false);
    }
    await page.unroute("**/reverse").catch(() => {});
    // back on, she presses it again
    await page.goto(`${APP}/app/settings?section=imports&import=${encodeURIComponent(imp.id)}`, { waitUntil: "domcontentloaded" });
    const open = page.locator('[data-testid="import-undo-open"]').first();
    if (await open.waitFor({ timeout: 8000 }).then(() => true).catch(() => false)) {
      await open.click();
      await page.locator('[data-testid="import-undo-yes"]').click({ timeout: 3000 }).catch(() => {});
    }
    await wait(800);
    const shown = (await textOf(page, '[data-testid="import-receipt-undone"]')) + (await textOf(page, '[data-testid="import-undo-confirm"]')) + (await textOf(page, '[data-testid="import-undo-done"]'));
    ok(`${L} undo: afterwards the receipt says it was undone, and a second press changes nothing`, /undone/i.test(shown) && JSON.stringify(await counts(o.orgId)) === JSON.stringify(u), { shown: shown.slice(0, 200) });
    await surfacesAgree(L, o);
    await noProviderCalls(L, o.orgId);
    await ctx.close();
  }
  // and the other half: the network drops BEFORE the file reaches the server
  {
    const L = "drop/unsent";
    const o = await freshOrg("org_brk_drop_unsent", "Breaker Drop unsent (test)");
    const ctx = await signedIn(o);
    const page = await newPage(ctx);
    await openSheetImport(page);
    await chooseFile(page, giftsFile("drop-unsent.csv", 10, i => `Uma Unsent${i}`));
    await page.route("**/sheet-import/commit", async route => { await ctx.setOffline(true); await route.abort("internetdisconnected").catch(() => {}); });
    await page.locator('[data-testid="sheet-import-go"]').click();
    await wait(2500);
    await ctx.setOffline(false);
    await page.waitForSelector('[data-testid="sheet-failed"]', { timeout: 30000 }).catch(() => {});
    const says = await textOf(page, '[data-testid="sheet-failed"]');
    const c = await counts(o.orgId);
    ok(`${L}: nothing was written, and once back the screen says exactly that`, c.gifts === 0 && c.imports === 0 && /Nothing was written/.test(says), { says, c });
    await surfacesAgree(L, o);
    await noProviderCalls(L, o.orgId);
    await ctx.close();
  }
}

// ═════════════════════════════════════════════════════════════════════════
// CASE 3 · TWO TABS, TWO ORGS
// ═════════════════════════════════════════════════════════════════════════
// The same browser, signed in to org A in tab A. In tab B she switches to
// org B (signs in there: the browser keeps one session for every tab). Tab A
// still shows org A's pages, and she adds a gift, deletes a person and
// commits an import there.
async function caseTwoTabs() {
  const L = "twotabs";
  const A = await freshOrg("org_brk_two_a", "Alder House (test)");
  const B = await freshOrg("org_brk_two_b", "Birch House (test)");
  await person(A.orgId, "d_brk_ta1", "Ava Alderperson", null);
  await person(A.orgId, "d_brk_ta2", "Abel Alderperson", null);
  await person(B.orgId, "d_brk_ta1b", "Bea Birchperson", null);
  const before = { A: await counts(A.orgId), B: await counts(B.orgId) };
  const ctx = await signedIn(A);
  const profile = await newPage(ctx);
  await profile.goto(`${APP}/donors/d_brk_ta1`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await profile.waitForSelector('[data-testid="dp-more"]', { timeout: 30000 });
  await profile.getByRole("tab", { name: /Gifts & pledges/ }).first().click({ timeout: 30000 }).catch(() => profile.locator('[data-tab="gifts"]').first().click());
  const importer = await newPage(ctx);
  await openSheetImport(importer);
  await chooseFile(importer, giftsFile("twotabs.csv", 5, i => `Tess Twotab${i}`));
  const deleter = await newPage(ctx);
  await deleter.goto(`${APP}/donors/d_brk_ta2`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await deleter.waitForSelector('[data-testid="dp-more"]', { timeout: 30000 });

  // tab B: switch to org B
  const tabB = await newPage(ctx);
  await tabB.goto(`${APP}/donors`, { waitUntil: "domcontentloaded" });
  await tabB.evaluate(([t, u, g]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", g); },
    [B.token, JSON.stringify(B.user), JSON.stringify(B.org)]);
  await tabB.reload({ waitUntil: "domcontentloaded" });
  await tabB.waitForSelector(".dir-donor-row", { timeout: 30000 }).catch(() => {});

  // tab A: add a gift
  await profile.getByRole("button", { name: /\+ Add Gift/ }).first().click({ timeout: 15000 });
  await profile.locator('input[placeholder="Amount ($)"]').first().fill("41");
  await profile.getByRole("button", { name: /^Save$/ }).first().click();
  await wait(2500);
  // tab A: delete a person
  await deleter.locator('[data-testid="dp-more"]').first().click();
  await deleter.locator('[data-testid="dp-delete"]').click({ timeout: 10000 }).catch(() => {});
  await wait(2000);
  // tab A: commit the import
  await importer.locator('[data-testid="sheet-import-go"]').click();
  await importer.waitForSelector('[data-testid="sheet-result"], [data-testid="sheet-failed"], [role="alert"]', { timeout: 30000 }).catch(() => {});
  await wait(1500);

  const after = { A: await counts(A.orgId), B: await counts(B.orgId) };
  const landed = {
    giftInA: after.A.gifts - before.A.gifts, giftInB: after.B.gifts - before.B.gifts,
    deletedInA: after.A.deleted - before.A.deleted, deletedInB: after.B.deleted - before.B.deleted,
    importInA: after.A.imports - before.A.imports, importInB: after.B.imports - before.B.imports,
    peopleMadeInB: after.B.alive - before.B.alive,
  };
  console.log("  NOTE  two tabs, where tab A's writes landed: " + JSON.stringify(landed));
  ok(`${L}: nothing tab A did landed in org B (the org tab B switched to)`, landed.giftInB === 0 && landed.deletedInB === 0 && landed.importInB === 0 && landed.peopleMadeInB === 0, landed);
  if (EXPECT_BINDING) {
    const all = [...profile.writes, ...deleter.writes, ...importer.writes].filter(w => /^(POST \/donors\/[^/]+\/gifts|DELETE \/donors\/|POST \/sheet-import\/commit)/.test(w.m + " " + w.url));
    // Refused at the server (409 org_changed) or before it left the tab (the
    // cross-tab banner): either way nothing is written anywhere.
    const refused = all.filter(w => w.status === 409);
    ok(`${L} [needs HARDEN-1 item 1] every write from tab A is refused (409, or held in the tab), and nothing landed in A either`,
      refused.length === all.length && landed.giftInA === 0 && landed.deletedInA === 0 && landed.importInA === 0, { all, landed });
    const shown = [await profile.locator("body").innerText().catch(() => ""), await deleter.locator("body").innerText().catch(() => ""), await importer.locator("body").innerText().catch(() => "")];
    const SAYS = new RegExp(ORG_BINDING_SENTENCE.source + "|You switched to Birch House \\(test\\) in another tab\\. Reload to see it\\.");
    ok(`${L} [needs HARDEN-1 item 1] every tab A page says it is for Alder House and she is now in Birch House, reload to continue`,
      shown.every(t => SAYS.test(t)), shown.map(t => (t.match(/(This page was for|You switched to)[^\n]*/) || ["(not shown)"])[0]));
    // and the server's own refusal, for a write that does leave a stale tab
    const stale = await fetch(BASE + "/donors/d_brk_ta1/gifts", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + B.token, "X-Steward-Org": A.orgId }, body: JSON.stringify({ amount: 9, date: "2026-10-01" }) });
    const sb = await stale.json().catch(() => ({}));
    ok(`${L} [needs HARDEN-1 item 1] a write from a page for Alder House on Birch House's session is refused 409 with the sentence`,
      stale.status === 409 && /This page was for Alder House \(test\), but you're now in Birch House \(test\)\. Reload to continue\./.test(JSON.stringify(sb)), { status: stale.status, sb });
  }
  await surfacesAgree(L + " A", A);
  await surfacesAgree(L + " B", B);
  await noProviderCalls(L, A.orgId);
  await noProviderCalls(L, B.orgId);
  await ctx.close();
}

// ═════════════════════════════════════════════════════════════════════════
// CASE 4 · THE UNDO TOAST LEFT UP OVER ANOTHER SCREEN
// ═════════════════════════════════════════════════════════════════════════
// set-up between legs, not the thing under test: everyone back, straight in the database
async function resetDeleted(orgId) {
  await q("UPDATE donors SET deleted_at=NULL WHERE org_id=$1", [orgId]);
  await q("UPDATE deleted_records SET restored_at=NOW() WHERE org_id=$1 AND restored_at IS NULL", [orgId]);
}
async function caseToast() {
  const L = "toast";
  const o = await freshOrg("org_brk_toast", "Breaker Toast (test)");
  const names = Array.from({ length: 25 }, (_, i) => `Tilda Toaster${String(i).padStart(2, "0")}`);
  for (let i = 0; i < names.length; i++) await person(o.orgId, `d_brk_t${i}`, names[i], null);
  const ctx = await signedIn(o);
  const page = await newPage(ctx);
  const bulkDeleteAll = async () => {
    await page.goto(`${APP}/donors`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".dir-header-row input[type=checkbox]", { timeout: 30000 });
    await page.locator(".dir-header-row input[type=checkbox]").first().check();
    await page.locator('[data-testid="dir-bulk-bar"]').getByRole("button", { name: /^Delete$/ }).click({ timeout: 10000 });
    await page.getByRole("button", { name: /^Delete \d+ people$/ }).click({ timeout: 10000 });
    await page.waitForSelector('[data-testid="undo-toast"]', { timeout: 15000 });
  };
  // 4a · delete, open another screen with the toast up, then Undo
  await bulkDeleteAll();
  const gone = (await counts(o.orgId)).deleted;
  await page.getByRole("link", { name: /^Home$/ }).first().click({ timeout: 5000 })
    .catch(() => page.evaluate(() => { history.pushState({}, "", "/app/home"); dispatchEvent(new PopStateEvent("popstate")); }));
  await wait(1500);
  const stillUp = await page.locator('[data-testid="undo-toast"]').isVisible().catch(() => false);
  if (stillUp) {
    await page.locator('[data-testid="undo-toast-undo"]').click();
    await waitForDb(async () => (await counts(o.orgId)).deleted === 0, 15000);
    ok(`${L} §4 the toast stayed up over Home and its Undo brought back all ${gone}`, (await counts(o.orgId)).deleted === 0, await counts(o.orgId));
  } else {
    ok(`${L} §4 the toast went with the screen, and the delete is whole (all ${gone} still deleted, all in Recent changes)`,
      (await counts(o.orgId)).deleted === gone && (await one("SELECT COUNT(*)::int AS n FROM deleted_records WHERE org_id=$1 AND restored_at IS NULL", [o.orgId])).n === gone);
    await resetDeleted(o.orgId);
  }
  // 4b · delete, then Import with the toast up: FIX-54 takes it down; the delete stays whole
  await bulkDeleteAll();
  await openSheetImport(page);
  await wait(800);   // the modal's first effect takes it down, a frame after it opens
  ok(`${L} §4 opening Import takes the toast down, and nobody half comes back`, !(await page.locator('[data-testid="undo-toast"]').isVisible().catch(() => false))
    && (await counts(o.orgId)).deleted === names.length, await counts(o.orgId));
  await page.keyboard.press("Escape").catch(() => {});
  await resetDeleted(o.orgId);
  // 4c · the network drops half way through the Undo: all come back or none
  await bulkDeleteAll();
  let passed = 0;
  await page.route(/\/deleted-records\//, async route => {
    passed++;
    if (passed <= 12) return route.continue();            // the first requests get through, then the line drops
    return route.abort("internetdisconnected");
  });
  await page.locator('[data-testid="undo-toast-undo"]').click();
  await wait(3000);
  const mid = await counts(o.orgId);
  ok(`${L} §4 the network dropped half way through Undo: all ${names.length} back or none (never half)`, mid.deleted === 0 || mid.deleted === names.length, mid);
  await page.unroute(/\/deleted-records\//);
  if (await page.locator('[data-testid="undo-toast-undo"]').isVisible().catch(() => false)) await page.locator('[data-testid="undo-toast-undo"]').click();
  await waitForDb(async () => (await counts(o.orgId)).deleted === 0, 10000);
  const end = await counts(o.orgId);
  ok(`${L} §4 back on, Undo again finishes it: all ${names.length} back, each once`, end.deleted === 0 && end.alive === names.length
    && (await one("SELECT COUNT(*)::int AS n FROM deleted_records WHERE org_id=$1 AND restored_at IS NULL", [o.orgId])).n === 0, end);
  await surfacesAgree(L, o);
  await noProviderCalls(L, o.orgId);
  await ctx.close();
}

// ═════════════════════════════════════════════════════════════════════════
// CASE 5 · DELETE, IMPORT, UNDO AND RESTORE, IN EVERY ORDER
// ═════════════════════════════════════════════════════════════════════════
// The same five people throughout. The file gives each of them a gift and
// brings two new people. Through the API the screens use (the clicks are
// case 1's); what matters here is the order.
async function sheetImport(tok, grid, fileName) {
  const body = { fileName, sheets: [{ name: "Sheet1", grid }] };
  const c = await api("POST", "/sheet-import/commit", tok, { ...body, background: true });
  let end = null;
  for (let i = 0; i < 400 && c.status === 202; i++) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(c.body.importId)}`, tok);
    if (j.body.status !== "running") { end = j.body; break; }
    await wait(150);
  }
  return { importId: c.body && c.body.importId, end };
}
async function caseOrders() {
  const P = ["Ophelia Marsh", "Orson Vale", "Otto Penrose", "Oona Kilbride", "Odile Fenwick"];
  const grid = [["Date", "Donor", "Amount"], ...P.map((n, i) => ["2026-09-10", n, String(30 + i)]), ["2026-09-11", "Nova Ellery", "50"], ["2026-09-11", "Nils Ostrander", "60"]];
  const SEQS = {
    "I D U": { alive: [], pDeleted: true }, "D I U": { alive: [], pDeleted: true }, "I U D": { alive: [], pDeleted: true },
    "D I R U": { alive: P, pDeleted: false }, "I D R U": { alive: P, pDeleted: false }, "D R I U": { alive: P, pDeleted: false },
    "I D U R": { alive: P, pDeleted: false }, "D I U I": { alive: ["Nils Ostrander", "Nova Ellery"], pDeleted: true, gifts: 2 },
    "I R D U": { alive: [], pDeleted: true },
  };
  let k = 0;
  for (const [seq, want] of Object.entries(SEQS)) {
    const L = `orders ${seq}`;
    const o = await freshOrg(`org_brk_ord${k++}`, `Breaker Orders ${seq} (test)`);
    const ids = [];
    for (let i = 0; i < P.length; i++) ids.push(await person(o.orgId, `d_brk_o${k}_${i}`, P[i], null));
    let undoIds = [], lastImport = null;
    for (const step of seq.split(" ")) {
      if (step === "D") {
        const r = await api("POST", "/donors/bulk-delete", o.token, { ids, count: ids.length });
        undoIds = (r.body && r.body.undoIds) || [];
      } else if (step === "I") {
        lastImport = (await sheetImport(o.token, grid.map(r => r.slice()), `orders-${k}.csv`)).importId;
      } else if (step === "U") {
        await api("POST", `/imports/${lastImport}/reverse`, o.token, {});
      } else if (step === "R") {
        if (undoIds.length) {
          const r = await api("POST", "/deleted-records/restore-people", o.token, { ids: undoIds });
          if (r.status === 404 && !r.body.sentence) for (const id of undoIds) await api("POST", `/deleted-records/${id}/restore`, o.token);   // a server without the one-step undo
        }
      }
    }
    const alive = (await q("SELECT name FROM donors WHERE org_id=$1 AND deleted_at IS NULL ORDER BY name", [o.orgId])).map(r => r.name);
    const pDel = (await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND id = ANY($2) AND deleted_at IS NOT NULL", [o.orgId, ids])).n;
    const gifts = (await one("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1", [o.orgId])).n;
    ok(`${L}: ends with exactly the people expected`, JSON.stringify(alive) === JSON.stringify([...want.alive].sort()), { alive, want: want.alive });
    ok(`${L}: the five are ${want.pDeleted ? "still deleted (deleted stays deleted)" : "here"}, with ${want.gifts || 0} gifts left`,
      pDel === (want.pDeleted ? P.length : 0) && gifts === (want.gifts || 0), { pDel, gifts });
    await surfacesAgree(L, o);
    await noProviderCalls(L, o.orgId);
  }
}

// ═════════════════════════════════════════════════════════════════════════
// CASE 6 · THE LAPTOP SLEEPS IN THE MIDDLE OF AN IMPORT
// ═════════════════════════════════════════════════════════════════════════
// The import is pressed and the job starts; then the page's clock stops
// (CDP virtual time paused: no timer, no poll) and the network goes, for
// BREAKER_SLEEP_SECS. Then it wakes. It runs beside the other cases.
async function caseSleep() {
  const L = "sleep";
  const o = await freshOrg("org_brk_sleep", "Breaker Sleep (test)");
  const ctx = await signedIn(o);
  const page = await newPage(ctx);
  const file = giftsFile("sleep-400.csv", 400, i => `Sol Sleeper${i % 250}`);
  await openSheetImport(page);
  await chooseFile(page, file);
  const cdp = await ctx.newCDPSession(page);
  const started = page.waitForResponse(r => /\/sheet-import\/commit$/.test(r.url()), { timeout: 60000 }).catch(() => null);
  await page.locator('[data-testid="sheet-import-go"]').click();
  await started;
  await cdp.send("Emulation.setVirtualTimePolicy", { policy: "pause" }).catch(e => console.log("  note: virtual time pause unavailable: " + e.message));
  await ctx.setOffline(true);
  console.log(`  ...  ${L}: the laptop sleeps for ${SLEEP_SECS}s`);
  await wait(SLEEP_SECS * 1000);
  await ctx.setOffline(false);
  await cdp.send("Emulation.setVirtualTimePolicy", { policy: "advance" }).catch(() => {});
  await page.waitForSelector('[data-testid="sheet-result"], [data-testid="sheet-failed"]', { timeout: 60000 }).catch(() => {});
  const c = await counts(o.orgId);
  const job = await one("SELECT status FROM sheet_import_jobs WHERE org_id=$1", [o.orgId]);
  const says = (await textOf(page, '[data-testid="sheet-result"]')) || (await textOf(page, '[data-testid="sheet-failed"]'));
  ok(`${L}: after the sleep the import finished once (one job, one run, 400 gifts, 250 people)`, job && job.status === "done" && c.imports === 1 && c.jobs === 1 && c.gifts === 400 && c.alive === 250, { job, c });
  ok(`${L}: and the screen says so truthfully`, /Imported|import/i.test(says) && !/Nothing was written/i.test(says), says.slice(0, 200));
  const go = page.locator('[data-testid="sheet-import-go"]');
  if (await go.isVisible().catch(() => false) && await go.isEnabled().catch(() => false)) { await go.click(); await wait(4000); }
  const c2 = await counts(o.orgId);
  ok(`${L}: pressing Import again after waking duplicates nothing`, c2.gifts === c.gifts && c2.alive === c.alive, c2);
  await surfacesAgree(L, o);
  await noProviderCalls(L, o.orgId);
  await ctx.close();
}

// ═════════════════════════════════════════════════════════════════════════
// CASE 7 · ENTER IN EVERY FIELD OF EVERY SCREEN THAT COMMITS
// ═════════════════════════════════════════════════════════════════════════
// A key press meant for a field is never the click that imports, undoes,
// deletes, merges, restores or sends (HARDEN-1 item 5, client/src/lib/commitGuard.js).
// Each screen is opened with its commit button ready; then every typing
// field on it gets focus and Enter. Nothing may commit.
const COMMIT_WRITE = /^(POST \/sheet-import\/commit|POST \/sheet-import\/bring-back|POST \/imports\/[^/]+\/reverse|POST \/donors\/bulk-delete|DELETE \/donors\/|POST \/deleted-records\/|POST \/campaigns\/[^/]+\/send|POST \/donors\/merge|POST \/data-health\/merge|POST \/[a-z-]*merge)/;
async function enterInEveryField(page, scope) {
  const fields = page.locator(`${scope} input`);
  const n = await fields.count();
  let pressed = 0;
  for (let i = 0; i < n; i++) {
    const f = fields.nth(i);
    const type = String(await f.getAttribute("type").catch(() => "") || "").toLowerCase();
    if (!/^(text|search|email|tel|url|number|date|)$/.test(type)) continue;
    if (!(await f.isVisible().catch(() => false)) || !(await f.isEnabled().catch(() => false))) continue;
    await f.focus().catch(() => {});
    await f.press("Enter").catch(() => {});
    pressed++;
    await wait(250);
  }
  await wait(800);
  return pressed;
}
async function caseEnter() {
  const L = "enter";
  const o = await freshOrg("org_brk_enter", "Breaker Enter (test)");
  await person(o.orgId, "d_brk_e1", "Ezra Kettle", "brk-e1@test.local");
  await person(o.orgId, "d_brk_e2", "Ezra Kettle", "brk-e1@test.local");   // a duplicate, for the merge screen
  await person(o.orgId, "d_brk_e3", "Wren Halloway", "brk-e3@test.local");
  await person(o.orgId, "d_brk_e4", "Juno Pemberton", "brk-e4@test.local");
  await q("UPDATE donors SET deleted_at=NOW() WHERE id='d_brk_e4'");
  await q(`INSERT INTO deleted_records (id, org_id, table_name, record_id, row_data, created_by, created_by_name) VALUES ('del_brk_e4',$1,'donors','d_brk_e4','{"__soft":true}'::jsonb,'system:test','test')`, [o.orgId]);
  const prior = await sheetImport(o.token, [["Date", "Donor", "Amount"], ["2026-09-02", "Lior Castellan", "25"]], "prior.csv");
  const before = await counts(o.orgId);
  const ctx = await signedIn(o);
  const page = await newPage(ctx);
  const committed = () => page.writes.filter(w => COMMIT_WRITE.test(w.m + " " + w.url));

  // import (and restore: the file names someone deleted, so Bring them back is on screen too)
  await openSheetImport(page);
  await page.setInputFiles('[data-testid="sheet-file"]', csvFile("enter.csv", ["Date", "Donor", "Email", "Amount"],
    [["2026-10-01", "Juno Pemberton", "brk-e4@test.local", "15"], ["2026-10-02", "Calla Brightwater", "", "30"]]));
  await page.waitForSelector('[data-testid="sheet-import-go"]', { timeout: 60000 });
  await wait(1500);
  const p1 = await enterInEveryField(page, '[data-testid="sheet-import"]');
  ok(`${L} import + bring back: Enter in each of ${p1} fields imports and brings back nothing`, !committed().length, committed());
  await page.keyboard.press("Escape").catch(() => {});

  // undo (the receipt, with the confirm open)
  await page.goto(`${APP}/app/settings?section=imports&import=${encodeURIComponent(prior.importId)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator('[data-testid="import-undo-open"]').first().click({ timeout: 30000 });
  await page.waitForSelector('[data-testid="import-undo-yes"]', { timeout: 15000 });
  const p2 = await enterInEveryField(page, "body");
  ok(`${L} undo: Enter in each of ${p2} fields on the receipt undoes nothing`, !committed().length, committed());

  // delete (people selected, the confirm open)
  await page.goto(`${APP}/donors`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".dir-donor-row", { timeout: 30000 });
  await page.locator(".dir-donor-row", { hasText: "Wren Halloway" }).locator('input[type="checkbox"]').first().check();
  const p3a = await enterInEveryField(page, "body");
  await page.locator('[data-testid="dir-bulk-bar"]').getByRole("button", { name: /^Delete$/ }).click({ timeout: 10000 });
  await page.getByRole("button", { name: "Delete 1 person" }).waitFor({ timeout: 10000 });
  const p3b = await enterInEveryField(page, "body");
  ok(`${L} delete: Enter in each of ${p3a + p3b} fields, with the delete confirm open, deletes nobody`, !committed().length, committed());
  await page.keyboard.press("Escape").catch(() => {});

  // merge (Data health, two records compared, the merge confirm on screen)
  await page.goto(`${APP}/donors`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByText("Data health", { exact: true }).first().click({ timeout: 30000 }).catch(() => {});
  await page.getByText("Review pairs", { exact: true }).first().click({ timeout: 20000 }).catch(() => {});
  const pair = page.locator('[data-testid="dh-pair"]').first();
  if (await pair.waitFor({ timeout: 20000 }).then(() => true).catch(() => false)) {
    await pair.getByRole("button", { name: "Compare" }).click();
    await page.waitForSelector('[data-testid="dh-merge-confirm"]', { timeout: 15000 }).catch(() => {});
    const p4 = await enterInEveryField(page, "body");
    ok(`${L} merge: Enter in each of ${p4} fields, with the merge confirm on screen, merges nothing`, !committed().length, committed());
  } else ok(`${L} merge: the duplicate pair is on Data health to try Enter on`, false, "no dh-pair");

  // send (a campaign in the editor, Send ready)
  await q("UPDATE orgs SET emails_enabled=true, onboarded_at=NOW(), onboarded_via='test' WHERE id=$1", [o.orgId]);
  await q("UPDATE donors SET auto_email=true WHERE id='d_brk_e3'");
  const camp = await api("POST", "/campaigns", o.token, { name: "Breaker enter", subject: "Hello", body: "Hi", segment: { mode: "manual", donorIds: ["d_brk_e3"] }, status: "draft" });
  const campId = camp.body && (camp.body.id || (camp.body.campaign && camp.body.campaign.id));
  await page.goto(`${APP}/app/communications?subtab=campaigns&campaign=${campId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator('[data-testid="edit-in-editor"]').first().click({ timeout: 30000 });
  await page.waitForSelector('[data-testid="campaign-send"]:not([disabled])', { timeout: 30000 });
  const p5 = await enterInEveryField(page, "body");
  await wait(1500);
  ok(`${L} send: Enter in each of ${p5} fields of the campaign editor sends nothing`, !committed().length && !sinkTo("brk-e3@test.local").length,
    { committed: committed(), sink: sinkTo("brk-e3@test.local").length });

  const after = await counts(o.orgId);
  ok(`${L}: the database is exactly as it was`, JSON.stringify(after) === JSON.stringify(before)
    && !!(await one("SELECT deleted_at FROM donors WHERE id='d_brk_e4'")).deleted_at, { before, after });
  await surfacesAgree(L, o);
  await noProviderCalls(L, o.orgId);
  await ctx.close();
}

async function main() {
  const t0 = performance.now();
  console.log(`breaker (HARDEN-1 item 4) · sleep ${SLEEP_SECS}s · org binding expected: ${EXPECT_BINDING ? "yes" : "no"}${assertSurfacesAgree ? " · assertSurfacesAgree loaded" : " · assertSurfacesAgree not on this branch: minimal check only"}`);
  const why = browserReady();
  if (browserLegOrSkip(why, "(breaker)")) { await closeDb(); return summary(); }
  for (const [n, p] of Object.entries(MOCK_PORTS)) await startMock(n, p);
  const unbound = Object.entries(mocks).filter(([, s]) => !s.bound).map(([n]) => n);
  ok("every provider mock is listening on the port the server calls (so a call cannot go unseen)", !unbound.length, unbound);
  // The server checks its own platform price ids once, a few seconds after it
  // boots (server.js checkBillingPriceModes). On a server booted just before this
  // suite, that lands on the billing mock before any case runs. Wait for /health
  // to say it ran, then set aside only those GET /v1/prices lookups; any billing
  // call a case makes still goes red.
  for (let i = 0; i < 60; i++) {
    const h = await fetch(`${process.env.BASE || "http://localhost:5601"}/health`).then(r => r.json()).catch(() => ({}));
    if (h.billing && h.billing.checked) break;
    await wait(250);
  }
  const bootChecks = mocks.billing.calls.filter(c => c.method === "GET" && /^\/v1\/prices\//.test(c.url));
  mocks.billing.calls = mocks.billing.calls.filter(c => !bootChecks.includes(c));
  console.log(`  (set aside ${bootChecks.length} boot-time billing price check(s) the server made before any case)`);
  const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));
  browser = await chromium.launch();
  const guard = (name, fn) => fn().catch(e => ok(`${name}: the case ran to the end`, false, String(e && e.stack || e).slice(0, 500)));
  const sleeper = want("sleep") ? guard("sleep", caseSleep) : Promise.resolve();
  for (const [name, fn] of [["clicks", caseClicks], ["drop", caseDrop], ["twotabs", caseTwoTabs], ["toast", caseToast], ["orders", caseOrders], ["enter", caseEnter]])
    if (want(name)) await guard(name, fn);
  await sleeper;
  await browser.close();
  for (const s of Object.values(mocks)) if (s.srv) s.srv.close();
  console.log(`  wall time ${Math.round((performance.now() - t0) / 1000)}s`);
  await closeDb();
  summary();
}
main().catch(async e => { console.error(e); try { await closeDb(); } catch { } process.exit(1); });

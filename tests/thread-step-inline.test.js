// FIX (2026-09-09) item 3 — THE PROPOSED STEP IS EDITABLE FROM THE ROW.
//
// "If the first thing a user does with every suggestion is retype it, the
// suggestion is costing time rather than saving it." So every surface that
// proposes a next step renders it as an INPUT carrying the proposed text —
// one click and it is yours — never a static label with an Edit affordance,
// and never a proposal made server-side that the row never shows.
//
// Two surfaces, in a real browser:
//   §1  the log flow: the step is an input, prefilled from the note, focused
//       by a single click, and what is SAVED is what was typed over it
//   §2  the drift row: the step it is about to open is shown and editable
//       inline before saving (it used to be derived server-side, unseen)
//
// Browser suite conventions (BUILD-44 Part 6): SKIP cleanly without Playwright
// or a localhost-API dist; the app is served from :4173 (the API's CORS
// allowlist) — reuse a running preview else self-serve; seed auth from the
// REAL /auth/login payload.
const path = require("path");
const fs = require("fs");
const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, closeDb, civilToday } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const PORT = 4173;
const APP = `http://localhost:${PORT}`;
const ORG = "org_stepinline";
const iso = d => new Date(d).toISOString().slice(0, 10);
const daysAgo = n => {
  const [y, m, d] = civilToday().split("-").map(Number);
  return iso(Date.UTC(y, m - 1, d) - n * 86400000);
};

const skip = why => { console.log("  SKIP  " + why + "\n\n0 passed, 0 failed (suite skipped)"); process.exit(0); };
if (!fs.existsSync(path.join(DIST, "index.html"))) skip("client/dist not built");
const API_ORIGIN = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
const distJs = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
if (!distJs.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(API_ORIGIN)))
  skip("client/dist not built against the local API");
let chromium;
try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); }
catch { skip("Playwright not found (set PLAYWRIGHT_DIR)"); }

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png" };
async function frontendBase() {
  try { const r = await fetch(APP + "/", { signal: AbortSignal.timeout(1500) }); if (r.ok) return null; } catch { }
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    if (url.startsWith("/_vercel/")) { res.statusCode = 404; return res.end(); }
    let file = path.join(DIST, url);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
    res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => srv.listen(PORT, r));
  return srv;
}

(async () => {
  console.log("thread-step-inline (FIX 2026-09-09, item 3)");
  const CHILD = ["threads", "workflow_runs", "workflows", "moves", "opportunities", "tasks", "receipts", "pledges",
    "fin_audit_log", "fin_transactions", "gifts", "interactions", "notification_sends", "metric_snapshots"];
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["donors", "campaigns", "fin_funds", "accounts", "budgets", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Step Inline Org','step-inline',1,'active','growth')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_stepinline',$1,'stepinline@t.local',$2,'Step Admin','admin')`,
    [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_si4010',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name)
           VALUES ('d_si_meet',$1,'Ada Fennimore','ada@si.test','steward','u_stepinline','Step Admin')`, [ORG]);
  // A clean yearly pattern ending ~15 months ago → high-confidence drift.
  await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,gift_count,last_gift_date,created_by,created_by_name)
           VALUES ('d_si_drift',$1,'Owen Marchetti','owen@si.test','steward',5000,5,$2,'u_stepinline','Step Admin')`,
    [ORG, daysAgo(455)]);
  for (let i = 5; i >= 1; i--)
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name)
             VALUES ($1,$2,'d_si_drift',1000,$3,'u_stepinline','Step Admin')`,
      [`g_si${i}`, ORG, daysAgo(455 + (i - 1) * 365)]);

  const login = await api("POST", "/auth/login", null, { email: "stepinline@t.local", password: "loadtest1234" });
  ok("login ok", login.status === 200, login.status);
  const auth = login.body;

  const srv = await frontendBase();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  page.on("pageerror", e => { if (!/Unexpected token '<'/.test(e.message)) console.log("  [pageerror]", e.message.slice(0, 160)); });
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org)]);

  // ── §1 · the log flow ────────────────────────────────────────────────────
  console.log("\n— §1 · the log flow's proposed step —");
  await page.goto(APP + "/donors/d_si_meet", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.click('button:has-text("Log a conversation")');
  await page.waitForTimeout(600);
  ok("the log flow opened", /Log a conversation/.test(await page.innerText("body")));
  await page.click('button:has-text("Meeting")');
  await page.fill('input[placeholder^="One line"]', "She asked for the import report.");
  await page.waitForTimeout(400);

  const stepSel = '[aria-label="Next step"]';
  const shape = await page.$eval(stepSel, el => ({ tag: el.tagName, value: el.value, ro: el.readOnly, disabled: el.disabled })).catch(() => null);
  ok("the proposed step is an INPUT, not a static label or a fixed list",
     shape && shape.tag === "INPUT" && !shape.ro && !shape.disabled, shape);
  ok("it is PREFILLED with the step the note asked for",
     shape && shape.value === "Send the import report", shape && shape.value);
  ok("the screen says which rule proposed it",
     /From your note/i.test(await page.innerText(".modal-sheet-inner")), null);
  ok("and offers the touch-type default in one click",
     await page.$('button:has-text("Use the Meeting default instead")') !== null);

  // ONE click puts the cursor in it — no Edit affordance in between.
  await page.click(stepSel);
  ok("one click focuses it (the row IS the editor)",
     await page.evaluate(s => document.activeElement === document.querySelector(s), stepSel));

  await page.fill(stepSel, "Send the import report and the fund list");
  await page.fill('[aria-label="Next step due date"]', shape ? "2026-10-01" : "2026-10-01");
  await page.click('button:has-text("Save")');
  await page.waitForTimeout(1200);
  const [th] = await q(`SELECT * FROM threads WHERE org_id=$1 AND donor_id='d_si_meet' AND closed_at IS NULL`, [ORG]);
  ok("what is SAVED is what was typed over the suggestion",
     th && th.next_step_label === "Send the import report and the fund list", th && th.next_step_label);
  ok("the edited due date is saved too", th && th.due_date === "2026-10-01", th && th.due_date);

  // ── §2 · the drift row ───────────────────────────────────────────────────
  console.log("\n— §2 · the drift row's proposed step —");
  await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);
  const driftRow = await page.$('text=Owen Marchetti');
  ok("the drifting donor is on the day view", driftRow !== null);
  await page.click('button:has-text("Not drifting")');
  await page.waitForTimeout(300);
  const lineSel = 'input[placeholder^="Why isn\'t this drifting"]';
  await page.fill(lineSel, "Spoke to him. He asked for the spring appeal letter.");
  await page.waitForTimeout(400);
  const dShape = await page.$eval(".drift-step-input", el => ({ tag: el.tagName, value: el.value, ro: el.readOnly })).catch(() => null);
  ok("the step the row is about to open is SHOWN, as an input",
     dShape && dShape.tag === "INPUT" && !dShape.ro, dShape);
  ok("prefilled from the line the user just wrote",
     dShape && dShape.value === "Send the spring appeal letter", dShape && dShape.value);
  await page.click(".drift-step-input");
  ok("one click focuses it, from the row",
     await page.evaluate(() => document.activeElement === document.querySelector(".drift-step-input")));
  await page.fill(".drift-step-input", "Send the spring appeal letter by hand");
  await page.click('button:has-text("Save")');
  await page.waitForTimeout(1500);
  const [dth] = await q(`SELECT * FROM threads WHERE org_id=$1 AND donor_id='d_si_drift' AND closed_at IS NULL`, [ORG]);
  ok("the drift row saves the EDITED step, not the one it derived",
     dth && dth.next_step_label === "Send the spring appeal letter by hand", dth && dth.next_step_label);

  await browser.close();
  if (srv) srv.close();
  summary("thread-step-inline");
  await closeDb();
})().catch(e => { console.error(e); process.exit(1); });

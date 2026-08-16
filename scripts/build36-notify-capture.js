// BUILD-36 Part A — capture the real officer-notification emails for review.
// Drives the LOCAL scratch server (booted with RESEND_BASE_URL=http://localhost:5602)
// like tests/notifications.test.js, captures the REAL email bytes off the sink,
// and renders each to a DSF3 PNG via Playwright (~/steward-qa).
//
// Writes docs/build36-<date>/:
//   officer-gift-email.{html,png}    the assigned-officer gift alert (A1)
//   task-assignment-email.{html,png} the "someone assigned you a task" email (A2)
//   daily-reminder-email.{html,png}  the daily due/overdue reminder (A3)
//   README.md
//
// Usage (server booted per tests/README.md, with RESEND_BASE_URL=…:5602):
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build36-notify-capture.js

const http = require("http");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const BASE = require("./lib/prodGuard").writerBase("http://localhost:5601"); // loopback default + --i-know-this-is-prod for remote (BUILD-55)
const DB_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
if (!/localhost|127\.0\.0\.1/.test(BASE) || !/localhost|127\.0\.0\.1/.test(DB_URL)) {
  console.error("Refusing to run against non-local BASE/DATABASE_URL."); process.exit(1);
}
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
const q = (s, p) => pool.query(s, p).then(r => r.rows);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ORG = "org_cap36";
const OUT = path.join(__dirname, "..", "docs", "build36-" + new Date().toISOString().slice(0, 10));

let captured = [];
const mock = http.createServer((req, res) => {
  let b = ""; req.on("data", c => (b += c));
  req.on("end", () => { try { captured.push({ path: req.url, body: b ? JSON.parse(b) : null }); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "m" })); });
});
const mailTo = to => captured.filter(e => e.path === "/emails" && (e.body?.to === to || e.body?.to?.includes?.(to)));
async function waitFor(fn, tries = 60) { for (let i = 0; i < tries; i++) { if (await fn()) return true; await sleep(50); } return false; }
async function api(method, p, token, body) {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = t; try { j = JSON.parse(t); } catch {} return { status: r.status, body: j };
}
async function login(email) {
  const r = await api("POST", "/auth/login", null, { email, password: "loadtest1234" });
  return r.body.token;
}

(async () => {
  await new Promise(res => mock.listen(5602, res));
  for (const t of ["notification_sends", "digest_sends", "workflow_runs", "workflows", "tasks", "gifts", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  // A branded org so the emails carry the header band (accent green).
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,brand_accent,brand_accent_fg)
           VALUES ($1,'creo arts collective','creo-cap36',1,'active','team','#1a6b4a','#ffffff')`, [ORG]);
  const mkUser = (id, email, name, role = "staff") =>
    q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, ORG, email, bcrypt.hashSync("loadtest1234", 10), name, role]);
  await mkUser("u_cap_ed", "ed@cap36.local", "the director", "admin");
  await mkUser("u_cap_off", "olivia@cap36.local", "olivia officer", "staff");
  await q(`INSERT INTO donors (id,org_id,name,assigned_to,assigned_to_name,stage,gift_count,total_giving) VALUES ('d_cap',$1,'margaret whitfield','u_cap_off','olivia officer','cultivate',1,2500)`, [ORG]);
  const tEd = await login("ed@cap36.local");

  const wfs = (await api("GET", "/workflows", tEd)).body;
  const thanks = wfs.find(w => w.recipe_key === "instant_gift_thanks");
  await api("PUT", `/workflows/${thanks.id}`, tEd, { enabled: true, config: { notify: "both", threshold: 0 } });

  // (A1) officer gift email
  captured = [];
  await api("POST", "/donors/d_cap/gifts", tEd, { amount: 2500, date: "2026-08-01" });
  await waitFor(() => mailTo("olivia@cap36.local").length === 1);
  const giftHtml = mailTo("olivia@cap36.local")[0].body.html;

  // (A2) task assignment email
  captured = [];
  await api("POST", "/tasks", tEd, { title: "Call Margaret to schedule the studio visit", assignedTo: "u_cap_off", donorId: "d_cap", due: "2026-08-20" });
  await waitFor(() => mailTo("olivia@cap36.local").length === 1);
  const taskHtml = mailTo("olivia@cap36.local")[0].body.html;

  // (A3) daily reminder email
  const TODAY = "2026-08-05";
  await q(`DELETE FROM tasks WHERE org_id=$1`, [ORG]);
  const mkTask = (id, due, done = 0) =>
    q(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,assigned_to,donor_id,updated_at) VALUES ($1,$2,$3,$4,'medium','donor',$5,'u_cap_off','d_cap',NOW())`,
      [id, ORG, id === "t_td" ? "Send Margaret the gala invitation" : `Follow up: ${id}`, due, done]);
  await mkTask("t_od1", "2026-07-01");
  await mkTask("t_od2", "2026-07-22");
  await mkTask("t_td", TODAY);
  captured = [];
  await api("POST", "/digests/run-daily", tEd, { today: TODAY });
  await sleep(200);
  const dailyHtml = mailTo("olivia@cap36.local")[0]?.body?.html || "<p>(no reminder captured)</p>";

  fs.mkdirSync(OUT, { recursive: true });
  const files = [
    ["officer-gift-email", giftHtml, "A1 — the assigned officer hears about a gift to a donor they own, branded, no unsubscribe footer."],
    ["task-assignment-email", taskHtml, "A2 — someone assigned the officer a task (title, donor, due, link)."],
    ["daily-reminder-email", dailyHtml, "A3 — the daily due-today + overdue reminder (sent only when non-empty)."],
  ];
  for (const [name, html] of files) fs.writeFileSync(path.join(OUT, name + ".html"), html);

  // Render each to a DSF3 PNG (email in a light card on a neutral page).
  if (process.env.PLAYWRIGHT_DIR) {
    const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR, "node_modules", "playwright"));
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 620, height: 400 }, deviceScaleFactor: 3 });
    for (const [name, html] of files) {
      await page.setContent(`<div style="background:#e9e6df;padding:28px;font-family:Georgia,serif;"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 6px 30px rgba(0,0,0,.12);">${html}</div></div>`, { waitUntil: "networkidle" });
      await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: true });
      console.log("rendered", name + ".png");
    }
    await browser.close();
  } else {
    console.log("PLAYWRIGHT_DIR unset — wrote HTML only (no PNGs)");
  }

  fs.writeFileSync(path.join(OUT, "README.md"),
    `# BUILD-36 Part A — officer notification emails (real captured bytes)\n\n` +
    files.map(([n, , d]) => `- \`${n}.html\` / \`${n}.png\` — ${d}`).join("\n") +
    `\n\nAll three are INTERNAL staff mail: branded org header band, NO donor unsubscribe footer.\n` +
    `Captured from the local scratch server's Resend sink; behavior is asserted by tests/notifications.test.js.\n`);

  // cleanup
  for (const t of ["notification_sends", "digest_sends", "workflow_runs", "workflows", "tasks", "gifts", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await pool.end();
  await new Promise(r => mock.close(r));
  console.log("wrote", OUT);
})();

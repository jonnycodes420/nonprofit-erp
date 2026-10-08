#!/usr/bin/env node
// FIX-34 C · the walk. "Add to:" in Book a visit with two calendars, and the
// connection card naming the API that refused, at 1440 and 390. Loopback only:
// it builds its own fixture org (org_fix34c_walk) and its own stand-in for
// Google and Microsoft on CALENDAR_MOCK_PORT, and removes the org afterwards.
for (const [k, v] of [["BASE", process.env.BASE], ["APP_URL", process.env.APP_URL]]) {
  if (v && !/localhost|127\.0\.0\.1/.test(v)) { console.error(`Refusing: ${k} is not loopback (${v}).`); process.exit(2); }
}
const path = require("path");
const fs = require("fs");
const http = require("http");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const BASE = process.env.BASE || "http://localhost:5601";
const APP = process.env.APP_URL || "http://localhost:4173";
const PORT = Number(process.env.CALENDAR_MOCK_PORT || 6318);
const OUT = path.join(__dirname, "..", "docs", "fix-34");
const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
const ORG = "org_fix34c_walk", UID = "u_fix34c_walk", EMAIL = "ann@org_fix34c_walk.local", DONOR = "d_fix34c_walk";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (s, a) => pool.query(s, a).then(r => r.rows);

const mock = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const send = (c, o) => { res.writeHead(c, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  if (p.startsWith("/calendar/v3/")) return send(403, { error: { code: 403, status: "PERMISSION_DENIED",
    errors: [{ reason: "accessNotConfigured" }], details: [{ reason: "SERVICE_DISABLED" }] } });
  if (p === "/gmail/v1/users/me/profile") return send(200, { historyId: "1" });
  if (p === "/gmail/v1/users/me/messages") return send(200, { messages: [] });
  if (p.startsWith("/v1.0/")) return send(200, { id: "x", value: [] });
  send(404, {});
});
const TABLES = ["mailbox_sync_runs", "meeting_effects", "calendar_events", "mailbox_connections", "tasks", "threads", "interactions", "donor_scores", "donors", "users"];
async function clean() { for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {}); await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {}); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise(r => mock.listen(PORT, r));
  await clean();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,onboarded_at,subscription_status,plan,timezone)
           VALUES ($1,'Riverside Literacy','fix34c-walk',1,NOW(),'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ann Lowe','admin')`, [UID, ORG, EMAIL, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,created_by,created_by_name)
           VALUES ($1,$2,'Rosa Diaz','rosa@example.com','active',300,'system:test','test')`, [DONOR, ORG]);
  const { sealBag } = await import(path.join(__dirname, "..", "shared", "secretBox.js"));
  const sealed = sealBag({ accessToken: "tok", refreshToken: "ref", scope: null }, { aad: ORG });
  await q(`INSERT INTO mailbox_connections (id,org_id,user_id,provider,address,status,credentials_sealed,token_expires_at,calendar_granted,created_by,created_by_name) VALUES
           ('mbx_fix34cw_g',$1,$2,'google','ann@riverside.org','active',$3,NOW() + INTERVAL '1 day',true,'system:test','test'),
           ('mbx_fix34cw_m',$1,$2,'microsoft','ann@riverside.org','active',$3,NOW() + INTERVAL '1 day',true,'system:test','test')`, [ORG, UID, sealed]);
  const auth = await (await fetch(BASE + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: "loadtest1234" }) })).json();
  if (!auth.token) throw new Error("login failed " + JSON.stringify(auth).slice(0, 200));
  const H = { "content-type": "application/json", authorization: "Bearer " + auth.token };
  // Check again, with Google Calendar switched off in the stand-in.
  const chk = await (await fetch(BASE + "/mailbox/google/sync", { method: "POST", headers: H, body: "{}" })).json();
  console.log("Check again said:", chk.sentence);

  const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
  const browser = await chromium.launch();
  for (const [w, tag] of [[1440, "1440"], [390, "390"]]) {
    const p = await browser.newPage({ viewport: { width: w, height: 2400 }, deviceScaleFactor: 2 });
    await p.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org)]);
    await p.goto(`${APP}/donors/${DONOR}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForSelector('[data-testid="dp-book-visit"]', { timeout: 30000 });
    await p.locator('[data-testid="dp-book-visit"]').first().click();
    await p.waitForSelector('[data-testid="dp-book-calendar"]', { timeout: 10000 });
    const line = await p.locator('[data-testid="dp-book-calendar"]').first();
    console.log(`@${tag} Add to:`, (await line.innerText()).replace(/\s+/g, " "));
    await line.scrollIntoViewIfNeeded();
    const rail = p.locator('[data-testid="dp-rail-relationship"]').first();
    await rail.screenshot({ path: path.join(OUT, `c-book-visit-${tag}.png`) });
    await p.goto(`${APP}/dashboard?tab=settings&sub=connections&focus=inbox`, { waitUntil: "domcontentloaded" });
    await p.waitForSelector('[data-testid="health-error"]', { timeout: 30000 })
      .catch(async e => { await p.screenshot({ path: "/tmp/fix34c-debug.png" }); throw e; });
    const card = p.locator('[data-testid="inbox-provider-google"]').first();
    console.log(`@${tag} card:`, (await p.locator('[data-testid="health-error"]').first().innerText()).replace(/\s+/g, " "));
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: path.join(OUT, `c-connection-refused-${tag}.png`) });
    await p.close();
  }
  await browser.close();
  await clean(); await pool.end(); mock.close();
})().catch(async e => { console.error(e); await clean().catch(() => {}); process.exit(1); });

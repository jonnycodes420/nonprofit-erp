// BUILD-36 B2 — capture the Directory bulk "Assign owner ▾" bar (active + a
// pending-invite officer in the dropdown). Seeds a small Team org, logs in via a
// minted token, selects donors, opens the dropdown, screenshots. DSF3.
//
// Usage (server booted with CORS_ORIGIN=http://localhost:4173; preview on 4173):
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build36-bulkassign-capture.js

const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const API = "http://localhost:5601";
const BASE = process.env.BASE || "http://localhost:4173";
const DB_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
const OUT = path.join(__dirname, "..", "docs", "build36-" + new Date().toISOString().slice(0, 10));
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
const q = (s, p) => pool.query(s, p).then(r => r.rows);
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR, "node_modules", "playwright"));
const ORG = "org_b36cap";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const t of ["invites", "donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Creo Arts Collective','b36cap',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b36_ed',$1,'ed@b36.local',$2,'Ada Director','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b36_off',$1,'off@b36.local',$2,'Olivia Officer','staff')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  // a pending invite (shows in the dropdown as "Benjamin — invited")
  await q(`INSERT INTO invites (id,org_id,email,role,token,invited_by,expires_at) VALUES ('inv_b36',$1,'benjamin@creoarts.org','staff','tok_b36','u_b36_ed',NOW()+INTERVAL '7 days')`, [ORG]);
  const names = ["Margaret Whitfield", "Thomas Reed", "Eleanor Fitzgerald", "James Cho", "Patricia Nunez", "Robert Ellis"];
  for (let i = 0; i < names.length; i++)
    await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,last_gift_date,gift_count) VALUES ($1,$2,$3,$4,'cultivate',$5,'2026-05-01',3)`,
      [`d_b36_${i}`, ORG, names[i], `donor${i}@b36.local`, 1000 * (i + 2)]);

  // mint a token
  const r = await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "ed@b36.local", password: "loadtest1234" }) });
  const auth = await r.json();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
  await page.addInitScript(([tok, user, org]) => {
    localStorage.setItem("npe_token", tok);
    localStorage.setItem("npe_user", user);
    localStorage.setItem("npe_org", org);
  }, [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org)]);
  const T = { timeout: 6000 };
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  // Navigate to Donors via the sidebar nav button.
  await page.getByRole("button", { name: "Donors" }).first().click(T)
    .catch(async () => { await page.getByText("Donors", { exact: true }).first().click(T).catch(() => {}); });
  // Wait for the directory to render a seeded donor row.
  await page.getByText("Margaret Whitfield").first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  // Select-all header checkbox → the bulk bar appears.
  await page.locator('input[type=checkbox]').first().click(T).catch(() => {});
  await page.waitForTimeout(800);
  const assignBtn = page.getByRole("button", { name: /Assign owner/ }).first();
  await assignBtn.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await assignBtn.click(T).catch(() => {});
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "bulk-assign-owner.png"), fullPage: false });
  const sawAssign = await assignBtn.count();
  const sawInvited = await page.getByText(/invited/).count().catch(() => 0);
  console.log("captured bulk-assign-owner.png · assignBtn=", sawAssign, "invitedRow=", sawInvited);

  await browser.close();
  for (const t of ["invites", "donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await pool.end();
})();

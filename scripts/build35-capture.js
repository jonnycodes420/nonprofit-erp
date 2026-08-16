// BUILD-35 DSF3 capture + live drive — the "Set up Steward" activation
// checklist. Drives the REAL flow on a FRESH org end-to-end: fresh state
// (1/6), an exact deep link, mid-progress after real changes (each item checks
// ITSELF off), dismiss → chip → persistence across reload (org-wide, server-
// side), completion → one GoldMoment → the card is gone forever.
//
// Local stack only (tests/README.md recipe + a built client on :4173):
//   PLAYWRIGHT_DIR=$HOME/steward-qa BASE=http://localhost:4173 API=http://localhost:5601 \
//     node scripts/build35-capture.js
// Uses tests/helpers' scratch-Postgres access for the ONE item with no API
// entry path (stripe_account_id is written by the real Stripe Connect
// callback) — everything else flips through the real routes.
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR, "node_modules", "playwright"));
const { q, closeDb } = require("../tests/helpers");

const BASE = require("./lib/prodGuard").writerBase("http://localhost:4173"); // loopback default + --i-know-this-is-prod for remote (BUILD-55)
const API = process.env.API || "http://localhost:5601";
const OUT = process.env.OUT || "docs/build35-2026-08-04";
const EMAIL = "founder@fresh-setup.local";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let checks = 0, bad = 0;
const check = (name, cond, extra) => { checks++; if (cond) console.log("  PASS  " + name); else { bad++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra) : "")); } };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // ── A truly fresh org, repeatable: purge any prior run's org first ────────
  const [old] = await q(`SELECT org_id FROM users WHERE email=$1`, [EMAIL]);
  if (old) {
    for (const t of ["digest_sends", "workflow_runs", "workflows", "giving_pages", "invites", "interactions", "gifts", "donors", "users"]) {
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [old.org_id]).catch(() => {});
    }
    await q(`DELETE FROM accounts WHERE org_id=$1`, [old.org_id]).catch(() => {});
    await q(`DELETE FROM fin_funds WHERE org_id=$1`, [old.org_id]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [old.org_id]);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 3 });

  let res = await page.request.post(`${API}/auth/register-org`, { data: { orgName: "Fresh Setup Collective", userName: "Fable Founder", email: EMAIL, password: "demo1234x" } });
  const j = await res.json();
  if (!j.token) throw new Error("register failed: " + JSON.stringify(j));
  const authed = { headers: { Authorization: "Bearer " + j.token } };
  await page.request.post(`${API}/onboarding/complete`, authed);

  // 6 real donors through the real route → the donors item checks itself off.
  for (let i = 0; i < 6; i++) {
    await page.request.post(`${API}/donors`, { ...authed, data: { name: `Setup Donor ${i}`, email: `d${i}@fresh.local` } });
  }

  await page.goto(BASE + "/login");
  await page.evaluate(({ token, user, org }) => {
    localStorage.setItem("npe_token", token);
    localStorage.setItem("npe_user", JSON.stringify(user));
    localStorage.setItem("npe_org", JSON.stringify(org));
  }, { token: j.token, user: j.user, org: { ...j.org, onboarding_complete: 1 } });

  // ── Fresh: 1 of 6, donors pre-checked ────────────────────────────────────
  await page.goto(BASE + "/dashboard"); await sleep(3200);
  check("card shows on a fresh org at 1 of 6 (donors imported)", await page.getByText("1 of 6").count() === 1);
  check("undone rows carry the why-line + CTA", await page.getByText("automations are how Steward watches your donors while you work").count() === 1);
  await page.screenshot({ path: path.join(OUT, "setup-fresh-1of6.png"), fullPage: true });
  console.log("  ✓ setup-fresh-1of6");

  // ── Deep link: the workflow row lands ON the Workflows tab ───────────────
  await page.getByText("Turn on your first automation").click(); await sleep(1800);
  check("workflow row deep-links to the Workflows tab", await page.getByText("Automations that do the").count() === 1);
  await page.screenshot({ path: path.join(OUT, "setup-deeplink-workflows.png"), fullPage: false });
  console.log("  ✓ setup-deeplink-workflows");

  // ── Real changes flip items (no stored steps): address, page, workflow, invite ─
  await page.request.patch(`${API}/orgs/${j.org.id}`, { ...authed, data: { receiptAddress: "12 Main St, Fairhope, AL 36532" } });
  await page.request.post(`${API}/giving-pages`, { ...authed, data: { title: "Annual Fund", goalAmount: 5000 } });
  const wfs = await (await page.request.get(`${API}/workflows`, authed)).json();
  const wfId = (wfs.workflows || wfs || [])[0]?.id;
  if (wfId) await page.request.put(`${API}/workflows/${wfId}`, { ...authed, data: { enabled: true } });
  await page.request.post(`${API}/auth/invite`, { ...authed, data: { email: "officer@fresh-setup.local", role: "staff" } });

  await page.goto(BASE + "/dashboard"); await sleep(3200);
  check("after the real changes the card reads 5 of 6 — items checked THEMSELVES off", await page.getByText("5 of 6").count() === 1);
  await page.screenshot({ path: path.join(OUT, "setup-mid-progress.png"), fullPage: true });
  console.log("  ✓ setup-mid-progress");

  // ── Dismiss → chip → persists across reload (server-side, org-wide) ──────
  await page.getByRole("button", { name: "I'll finish later" }).click(); await sleep(600);
  check("dismiss collapses to the chip", await page.getByRole("button", { name: /Finish setting up Steward/ }).count() === 1);
  await page.reload(); await sleep(3000);
  check("the chip persists across reload (org-wide server state)", await page.getByRole("button", { name: /Finish setting up Steward/ }).count() === 1);
  await page.screenshot({ path: path.join(OUT, "setup-collapsed-chip.png"), fullPage: false });
  console.log("  ✓ setup-collapsed-chip");
  await page.getByRole("button", { name: /Finish setting up Steward/ }).click(); await sleep(600);
  check("chip expands back to the card", await page.getByText("5 of 6").count() === 1);

  // ── Complete the last item (Stripe Connect writes stripe_account_id; no
  //    API path — the one direct-DB flip) → the GoldMoment, once ────────────
  await q(`UPDATE orgs SET stripe_account_id='acct_capture_demo' WHERE id=$1`, [j.org.id]);
  await page.reload(); await sleep(3200);
  check("completion renders the one GoldMoment", await page.getByText("Steward is set up.").count() === 1);
  check("the checklist rows are gone at completion", await page.getByText("of 6").count() === 0);
  await page.screenshot({ path: path.join(OUT, "setup-complete-moment.png"), fullPage: true });
  console.log("  ✓ setup-complete-moment");

  await page.reload(); await sleep(3000);
  check("after the moment fired once, the card is gone forever", await page.getByText("Steward is set up.").count() === 0 && await page.getByText("Set up Steward").count() === 0);
  await page.screenshot({ path: path.join(OUT, "setup-gone-after-complete.png"), fullPage: true });
  console.log("  ✓ setup-gone-after-complete");

  await browser.close();
  await closeDb();
  console.log(`\n${checks - bad}/${checks} checks passed → ${OUT}`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

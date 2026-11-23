// tests/lib/live2WriteLeg.js · LIVE-2. THE SMOKE WALK'S WRITE LEG: SCREENS MOVE FROM WHAT A WRITE CHANGED.
//
// 1. A gift saved through the one gift path answers X-Steward-Changed naming
//    the gift, the person and the totals (server/shared/changedTables.js).
// 2. On the profile, Household → Add → pick a person → Group: the card names
//    the household with no reload.
// 3. Donors → tick a person → More → Move to trash: the row leaves the list and
//    the foot's "Trash (n)" counts them, with no reload. Red on main: the count
//    listened for an event nothing sent, and said "Trash (0)" until a reload.
// Made-up people in their own org (org_live2_walk), written fresh each run.
"use strict";
const bcrypt = require("bcryptjs");

module.exports = async function live2WriteLeg(browser, { ok, q, api, APP, BASE }) {
  const ORG = "org_live2_walk";
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Live Two Walk','live2-walk',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Holt','admin')`, ["u_" + ORG, ORG, `${ORG}@test.local`, bcrypt.hashSync("loadtest1234", 4)]);
  for (const [id, name] of [["a", "Odile Brackenfeld"], ["b", "Perrin Quistwater"], ["c", "Saoirse Mallowby"]]) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,created_by,created_by_name) VALUES ($1,$2,$3,$4,'steward','["donor"]','system:test','test')`,
      [`d_${ORG}_${id}`, ORG, name, `${id}@live2.example.org`]);
  }
  const a = (await api("POST", "/auth/login", null, { email: `${ORG}@test.local`, password: "loadtest1234" })).body;

  // 1 · the gift's answer says what it changed
  const g = await fetch(`${BASE}/donors/d_${ORG}_a/gifts`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + a.token },
    body: JSON.stringify({ amount: 125, date: require("../clock").civilDay(), type: "check" }) });
  const topics = String(g.headers.get("x-steward-changed") || "").split(",");
  await api("POST", `/donors/d_${ORG}_c/gifts`, a.token, { amount: 40, date: require("../clock").civilDay(), type: "check" });   // a giver, so the default list shows them
  ok("§live2 a saved gift answers X-Steward-Changed naming the gift, the person and the totals",
     g.status < 300 && ["gift", "person", "totals"].every(t => topics.includes(t)), { status: g.status, header: g.headers.get("x-steward-changed") });
  const ex = await fetch(`${BASE}/donors/d_${ORG}_a`, { method: "OPTIONS", headers: { Origin: APP, "Access-Control-Request-Method": "POST" } });
  const g2 = await fetch(`${BASE}/donors/d_${ORG}_a/gifts`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + a.token, Origin: APP },
    body: JSON.stringify({ amount: 5, date: require("../clock").civilDay(), type: "check" }) });
  ok("§live2 …and a browser on another origin may read it (Access-Control-Expose-Headers)",
     /x-steward-changed/i.test(g2.headers.get("access-control-expose-headers") || ""), { preflight: ex.status, expose: g2.headers.get("access-control-expose-headers") });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
    [a.token, JSON.stringify(a.user), JSON.stringify(a.org)]);
  const page = await ctx.newPage();
  page.on("dialog", d => d.accept().catch(() => {}));
  try {
    // 2 · a household made on the profile shows on the profile, no reload
    await page.goto(`${APP}/donors/d_${ORG}_a`, { waitUntil: "networkidle", timeout: 45000 });
    await page.getByRole("tab", { name: /^Giving/ }).first().click().catch(() => page.getByRole("button", { name: /^Giving/ }).first().click());
    const hh = page.locator('[data-testid="dp-household"]').first();
    await hh.waitFor({ timeout: 20000 });
    const before = await hh.innerText();
    await page.locator('[data-testid="dp-household-add"]').click();
    const dlg = page.getByRole("dialog");
    await dlg.locator("label", { hasText: "Perrin Quistwater" }).first().click({ timeout: 15000 });
    await dlg.getByRole("button", { name: /create|group|save/i }).last().click();
    const moved = await page.waitForFunction(() => /Household/.test((document.querySelector('[data-testid="dp-household"]') || {}).innerText || "") &&
      !/Not in a household/.test(document.querySelector('[data-testid="dp-household"]').innerText), null, { timeout: 8000 }).then(() => true, () => false);
    ok("§live2 Household → Add → Group: the profile names the household with no reload", /Not in a household/.test(before) && moved, { before, after: await hh.innerText() });

    // 3 · Move to trash: the row leaves and "Trash (n)" counts it, no reload
    await page.goto(`${APP}/donors?view=directory`, { waitUntil: "networkidle", timeout: 45000 });
    const tl = page.locator('[data-testid="trash-link"]').first();
    await tl.waitFor({ timeout: 20000 });
    const t0 = await tl.innerText();
    const row = page.locator(".dir-donor-row", { hasText: "Saoirse Mallowby" }).first();
    await row.locator('input[type="checkbox"]').first().check();
    await page.locator('[data-testid="bulk-more"]').first().click();
    await page.locator('[data-testid="bulk-trash"]').first().click();
    await page.waitForTimeout(800);
    const inc = page.locator('[data-testid="bulk-trash-include"]').first();   // "and their gifts": she has one
    if (await inc.count()) { const box = inc.locator('input[type="checkbox"]'); if (await box.count()) await box.first().check(); else await inc.click(); }
    await page.locator('[data-testid="bulk-trash-go"]').first().click();
    const counted = await page.waitForFunction(() => /Trash \(1\)/.test((document.querySelector('[data-testid="trash-link"]') || {}).innerText || ""), null, { timeout: 8000 }).then(() => true, () => false);
    const gone = (await page.locator(".dir-donor-row", { hasText: "Saoirse Mallowby" }).count()) === 0;
    ok("§live2 Donors → Move to trash: the row leaves and the foot says Trash (1), with no reload", t0 === "Trash (0)" && counted && gone, { before: t0, after: await tl.innerText().catch(() => "(gone)"), gone });
  } finally { await ctx.close(); }
};

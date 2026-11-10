// tests/address1-street.test.js: ADDRESS-1. A PERSON EDITED BY HAND CAN HAVE A
// STREET ADDRESS, AND A MERGE KEEPS IT. Guards donor data: the mailing address
// a receipt, a letter and a year-end statement go to.
//
//   §1 Edit donor (PUT /donors/:id) saves the street and the apartment line,
//      and a change to them is kept in donor_address_history with its actor.
//   §2 a caller that sends no street (older clients, the list's quick edits)
//      never clears the street an import wrote.
//   §3 + Add donor (POST /donors) saves the full mailing address.
//   §4 the profile's Contact reads the full mailing address (rail contact.address).
//   §5 Compare and merge: every field starts on the KEPT record's value even
//      when the other record was edited more recently; a blank on the kept
//      record starts on the other's value (nothing thrown away); keeping the
//      other record instead starts every field on that one's; the street and
//      apartment are offered and land on the kept record.
//   §6 (browser) the Edit form labels every field, saves a street typed into
//      it, and the profile's Contact shows it at once; the merge button names the record the merge
//      will make ("Merge into <resulting name>"), following the Name pick.
//
// HOW IT GOES RED ON MAIN (f18b00e): §1 PUT ignores address/address2, so the
// street stays empty. §3 POST drops them. §5 the defaults are "the newer
// value wins", so the other record's name and street are pre-picked, and there
// is no choicesFor. §6 the form has no Street field and its fields have only
// placeholders; the button says "Merge into <kept name>" whichever name is picked.
//
// Standard scratch stack (tests/README.md). Sends nothing. Made-up people only.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, browserLegOrSkip } = require("./helpers");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");
const { DIST } = require("./lib/dist");

const PASSWORD = "loadtest1234";
const ORG = "org_address1_street";
const EMAIL = `${ORG}@test.local`;
const P = s => `${ORG}_${s}`;
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Address Test Trust',$2,1,'active','team','America/New_York')`, [ORG, ORG.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + ORG, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
// age: years since created; touched: days since updated (the newer record is the other one).
const person = (id, name, f = {}) => q(
  `INSERT INTO donors (id,org_id,name,email,address,address2,city,state,zip,stage,gift_count,created_by,created_by_name,created_at,updated_at)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'steward',$10,'system:test/address1','ADDRESS-1 test',NOW()-($11::int * INTERVAL '1 year'),NOW()-($12::int * INTERVAL '1 day'))`,
  [P(id), ORG, name, f.email || null, f.address || null, f.address2 || null, f.city || null, f.state || null, f.zip || null,
   f.gifts || 0, f.age || 3, f.touched == null ? 400 : f.touched]);
const row = async id => (await q(`SELECT name, address, address2, city, state, zip FROM donors WHERE id=$1`, [id]))[0];

(async () => {
  const tok = await freshOrg();
  ok("§0 signed in", !!tok);

  // §1 Edit donor saves street and apartment.
  await person("ann", "Ann Tidewell", { city: "Portland", state: "ME", zip: "04101" });
  const put = await api("PUT", `/donors/${P("ann")}`, tok, { name: "Ann Tidewell", stage: "steward", status: "active", tags: [],
    address: "12 Wharf Street", address2: "Apt 3B", city: "Portland", state: "ME", zip: "04101" });
  const ann = await row(P("ann"));
  ok("§1 the Edit form's street is saved", put.status === 200 && ann.address === "12 Wharf Street", { status: put.status, ann });
  ok("§1 …and the apartment line", ann.address2 === "Apt 3B", ann);
  ok("§1 the reply carries both, for the profile to show", put.body && put.body.address === "12 Wharf Street" && put.body.address2 === "Apt 3B", put.body && [put.body.address, put.body.address2]);
  const [hist] = await q(`SELECT before, after, created_by FROM donor_address_history WHERE donor_id=$1 ORDER BY created_at DESC LIMIT 1`, [P("ann")]);
  ok("§1 the change is kept in the address history, with who made it", hist && hist.after.address === "12 Wharf Street" && !hist.before.address && hist.created_by === "u_" + ORG, hist);
  const clear = await api("PUT", `/donors/${P("ann")}`, tok, { name: "Ann Tidewell", stage: "steward", status: "active", tags: [],
    address: "12 Wharf Street", address2: "", city: "Portland", state: "ME", zip: "04101" });
  ok("§1 clearing the apartment line clears it", clear.status === 200 && (await row(P("ann"))).address2 === null, await row(P("ann")));

  // §2 a PUT without the street leaves the imported one alone.
  await person("imp", "Imogen Portside", { address: "40 Ferry Lane", address2: "Unit 2", city: "Bath", state: "ME", zip: "04530" });
  await api("PUT", `/donors/${P("imp")}`, tok, { name: "Imogen Portside", stage: "steward", status: "active", tags: [], city: "Bath", state: "ME", zip: "04530" });
  const imp = await row(P("imp"));
  ok("§2 a save that does not carry the street keeps the imported one", imp.address === "40 Ferry Lane" && imp.address2 === "Unit 2", imp);

  // §3 + Add donor saves the full address.
  const add = await api("POST", "/donors", tok, { name: "Theo Newcombe", stage: "prospect", address: "7 Harbor Road", address2: "Suite 100", city: "Rockland", state: "ME", zip: "04841" });
  const theo = add.body && add.body.id ? await row(add.body.id) : null;
  ok("§3 + Add donor saves the street, apartment, city, state and ZIP", add.status === 201 && theo && theo.address === "7 Harbor Road" && theo.address2 === "Suite 100" && theo.city === "Rockland" && theo.zip === "04841", { status: add.status, theo });

  // §4 the profile's Contact reads the full mailing address.
  const rail = await api("GET", `/donors/${P("ann")}/rail`, tok);
  ok("§4 the profile's Contact has the full mailing address", rail.body && rail.body.contact && rail.body.contact.address === "12 Wharf Street, Portland, ME 04101", rail.body && rail.body.contact);

  // §5 Compare and merge: defaults start on the KEPT record.
  // Kept (more gifts) is older and untouched; the other was edited yesterday.
  await person("kept", "Margaret Hollis", { gifts: 4, age: 5, touched: 400, email: "mh@example.org", address: "9 Elm Street", address2: "Apt 1", city: "Camden", state: "ME", zip: "04843" });
  await person("other", "Peggy Hollis", { gifts: 1, age: 1, touched: 1, address: "22 Bay View", address2: "Floor 2", city: "Belfast", state: "ME", zip: "04915" });
  await q(`UPDATE donors SET employer=NULL WHERE id=$1`, [P("kept")]);
  await q(`UPDATE donors SET employer='Penobscot Boatworks' WHERE id=$1`, [P("other")]);
  const pair = (await api("GET", `/data-health/pair?a=${P("other")}&b=${P("kept")}`, tok)).body;
  ok("§5 the record with more gifts is the kept one", pair.keptId === P("kept"), pair.keptId);
  const fieldKeys = (pair.fields || []).map(f => f.key + ":" + f.label);
  ok("§5 the compare screen offers the street and the apartment", fieldKeys.includes("address:Street address") && fieldKeys.includes("address2:Apt, suite"), fieldKeys);
  const c = pair.choices || {};
  ok("§5 the name starts on the kept record's, though the other was edited later", c.name === "kept", c.name);
  ok("§5 the street, apartment, city and ZIP start on the kept record's", ["address", "address2", "city", "state", "zip"].every(k => c[k] === "kept"), c);
  ok("§5 a field the kept record leaves blank starts on the other's value", c.employer === "other", c.employer);
  const flip = pair.choicesFor && pair.choicesFor[P("other")];
  ok("§5 keeping the other record instead starts every field on that one's", flip && flip.name === "kept" && flip.address === "kept" && flip.employer === "kept", flip);
  const m = await api("POST", "/data-health/merge", tok, { keptId: P("kept"), mergedId: P("other"), choices: pair.choices });
  const after = await row(P("kept"));
  ok("§5 the merge keeps the kept record's street and apartment", m.status < 300 && after.address === "9 Elm Street" && after.address2 === "Apt 1" && after.city === "Camden", { status: m.status, after });
  ok("§5 …and its name", after.name === "Margaret Hollis", after.name);
  { const r = await assertSurfacesAgree(ORG, { token: tok, soft: true, label: "after the merge" });
    ok(`§5 every surface agrees after the merge (${r.ms}ms)`, r.ok, r.diffs.join(" | ")); }
  // Picking the other's street moves the whole address as one piece.
  await person("k2", "Ruth Calder", { gifts: 3, age: 4, address: "1 North Road", address2: "Apt 9", city: "Union", state: "ME", zip: "04862" });
  await person("o2", "Ruthie Calder", { gifts: 0, age: 1, touched: 2, address: "5 South Road", address2: "", city: "Hope", state: "ME", zip: "04847" });
  const p2 = (await api("GET", `/data-health/pair?a=${P("k2")}&b=${P("o2")}`, tok)).body;
  const ADDR = ["address", "address2", "city", "state", "zip", "country"];
  const m2 = await api("POST", "/data-health/merge", tok, { keptId: P("k2"), mergedId: P("o2"), choices: { ...p2.choices, ...Object.fromEntries(ADDR.map(k => [k, "other"])), name: "other" } });
  const r2 = await row(P("k2"));
  ok("§5 picking the other's street brings its whole address, and its name", m2.status < 300 && r2.address === "5 South Road" && !r2.address2 && r2.city === "Hope" && r2.name === "Ruthie Calder", r2);

  // §6 the browser: the Edit form and the merge button.
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
    if (!js.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser leg)")) {
    await person("walk", "Walter Brine", { city: "Portland", state: "ME", zip: "04101" });
    await person("wk", "Nora Vance", { gifts: 2, age: 5, address: "3 Pier Road", city: "Lubec", state: "ME", zip: "04652" });
    await person("wo", "Eleanor Vance", { gifts: 0, age: 1, touched: 1, address: "8 Pier Road", city: "Lubec", state: "ME", zip: "04652" });
    const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    // As smoke-walk: /ai/stream 503 is the AI gate refusing with no key on the
    // local stack (the gate working), filtered by URL; anything else counts.
    const NOISE = /\/_vercel\/|fonts\.googleapis|\/favicon|\/ai\/stream/;
    page.on("console", msg => { if (msg.type() === "error" && !NOISE.test((msg.location() || {}).url || "") && !/Download the React DevTools/.test(msg.text())) errors.push(msg.text()); });
    page.on("response", r => { if (r.status() >= 400 && !NOISE.test(r.url())) errors.push(r.status() + " " + r.url()); });
    await page.addInitScript(([tk, u, o]) => {
      localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
    await page.goto(`${APP}/donors/${P("walk")}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-testid="dp-more"]').first().click();
    await page.getByRole("menuitem", { name: "Edit record" }).click();
    const dlg = page.getByRole("dialog", { name: "Edit donor profile" });
    await dlg.locator('[data-testid="edit-birth-month"]').waitFor({ timeout: 20000 });
    ok("§6 the Edit form has a Street address field", await dlg.locator('[data-testid="edit-address"]').count() === 1);
    const labels = await dlg.evaluate(d => [...d.querySelectorAll("input, textarea, select")].map(el => {
      const l = el.closest("label"); const named = (l && l.textContent.trim()) || el.getAttribute("aria-label") || "";
      return { ph: el.getAttribute("placeholder") || "", named };
    }));
    ok("§6 every field in the Edit form has a label, not just a placeholder", labels.length >= 10 && labels.every(x => x.named), labels.filter(x => !x.named));
    const order = await dlg.evaluate(d => [...d.querySelectorAll("label > span:first-child")].map(s => s.textContent.trim()));
    const iS = order.indexOf("Street address"), iA = order.indexOf("Apt, suite (optional)"), iC = order.indexOf("City");
    ok("§6 Street address and Apt, suite sit above City", iS >= 0 && iA === iS + 1 && iC > iA, order);
    await dlg.getByLabel("Street address").fill("55 Commercial Street", { timeout: 5000 }).catch(() => {});
    await dlg.getByLabel("Apt, suite (optional)").fill("Apt 4", { timeout: 5000 }).catch(() => {});
    await dlg.getByRole("button", { name: "Save Changes" }).click();
    await dlg.waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    const saved = await row(P("walk"));
    ok("§6 a street typed into the Edit form is saved", saved.address === "55 Commercial Street" && saved.address2 === "Apt 4", saved);
    const about = page.locator('[data-testid="dp-rail-address"]', { hasText: "55 Commercial Street" });
    await about.waitFor({ timeout: 15000 }).catch(() => {});
    const aboutText = (await about.textContent().catch(() => "")) || "";
    ok("§6 the profile's Contact shows the full mailing address without a refresh", aboutText.includes("55 Commercial Street, Apt 4, Portland, ME 04101"), aboutText);
    await page.locator('[data-testid="dp-more"]').first().click().catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});

    // The merge button says the name the record will have.
    // FLOWS-4: a merge keeps the record it was started from, so it starts from Nora's.
    await page.goto(`${APP}/donors/${P("wk")}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-testid="dp-more"]').first().click();
    await page.getByRole("menuitem", { name: /^Merge with/ }).click();
    await page.getByRole("dialog").locator("input").first().fill("Eleanor");
    await page.getByRole("dialog").getByRole("button", { name: /Eleanor Vance/ }).first().click();
    const cmp = page.getByRole("dialog", { name: /Compare and merge/ });
    const btn = cmp.locator('[data-testid="dh-merge-confirm"]');
    await btn.waitFor({ timeout: 20000 });
    ok("§6 the button starts on the kept record's name", (await btn.textContent()).trim() === "Merge into Nora Vance", await btn.textContent());
    const pressedStreet = await cmp.locator("button[aria-pressed=true]", { hasText: "3 Pier Road" }).count();
    ok("§6 the street starts on the kept record's", pressedStreet === 1, pressedStreet);
    await cmp.getByRole("button", { name: "Eleanor Vance" }).click();
    ok("§6 picking the other name changes the button to that name", (await btn.textContent()).trim() === "Merge into Eleanor Vance", await btn.textContent());
    await btn.click();
    await page.locator('[data-testid="mw-done"]').waitFor({ timeout: 15000 }).catch(() => {});
    const done = (await page.locator('[data-testid="mw-done"]').textContent().catch(() => "")) || "";
    const merged = await row(P("wk"));
    ok("§6 the merge makes the record the button named", merged.name === "Eleanor Vance" && /^Merged into Eleanor Vance\./.test(done), { name: merged.name, done });
    ok("§6 no console error or API 4xx/5xx on the walk", errors.length === 0, errors.slice(0, 4));
    await browser.close();
  }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });

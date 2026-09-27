// FIX-2 finding 9 — "last grant" ON CHURCHES AND BUSINESSES.
//
// Jonathan's 27 September walk saw Hope Presbyterian Church, Ironworks Coffee
// Roasters and Rivet Bakery labelled "last grant". Only a foundation or a
// donor-advised fund makes a grant; everybody else's is a gift. The rule is
// shared/institutional.js lastGiftWord (FIX-1, 8ffa957), which reads the funder
// type, then the imported donor type, then the name.
//
// Those three come from the BUILD-89 demo file (scripts/build89-demo-seed.js),
// which writes through /donors/import-combined with donorType church/business
// and no funder type. So this suite builds its organisations the SAME way, on
// its own fixture org, rather than by SQL: a guard that inserts the columns the
// rule reads would pass on a shape the product never writes.
//
//   §1 every surface: the phrase "last grant" is written in exactly one place
//      (shared/institutional.js), and no client, route or shared file picks
//      between "grant" and "gift" by itself
//   §2 the server: /drift's institutional rows for those three say "last
//      gift"; a foundation and a DAF say "last grant"
//   §3 Home: the rendered list says the same, at 1440 and 390

const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + String(JSON.stringify(extra)).slice(0, 600) : "")); }
};
const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ORG = "org_fx2egrant", EMAIL = "fx2egrant@example.org", PW = "loadtest1234";
const THREE = ["Hope Presbyterian Church", "Ironworks Coffee Roasters", "Rivet Bakery"];

function surfaces() {
  const out = [];
  const walk = d => {
    for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      const rel = d + "/" + e.name;
      if (e.isDirectory()) { if (!["node_modules", "dist"].includes(e.name)) walk(rel); }
      else if (/\.(js|jsx|mjs)$/.test(e.name)) out.push(rel);
    }
  };
  ["client/src", "shared", "routes", "lib"].forEach(d => fs.existsSync(path.join(root, d)) && walk(d));
  for (const f of fs.readdirSync(root)) if (/\.js$/.test(f)) out.push(f);
  return out;
}

(async () => {
  console.log("fix2-e-grant-word");
  console.log("\n— §1 · one place decides the word —");
  const files = surfaces();
  const said = files.filter(f => /last grant/i.test(strip(fs.readFileSync(path.join(root, f), "utf8"))));
  ok('§1 "last grant" is written only in shared/institutional.js', said.length === 1 && said[0] === "shared/institutional.js", said);
  const PICK = /\?\s*["'`](last )?grants?["'`]\s*:\s*["'`](last )?gifts?["'`]|\?\s*["'`](last )?gifts?["'`]\s*:\s*["'`](last )?grants?["'`]/i;
  const picks = files.filter(f => f !== "shared/institutional.js" && PICK.test(strip(fs.readFileSync(path.join(root, f), "utf8"))));
  ok("§1 no other file chooses between grant and gift on its own", picks.length === 0, picks);
  const lastWordReaders = files.filter(f => /lastWord/.test(fs.readFileSync(path.join(root, f), "utf8")));
  const computes = lastWordReaders.filter(f => f.startsWith("routes/") && /lastWord:\s*INST\.lastGiftWord\(/.test(fs.readFileSync(path.join(root, f), "utf8")));
  ok("§1 the server fills every row's word from lastGiftWord", computes.length >= 1, lastWordReaders);

  console.log("\n— §2 · /drift, on organisations imported the way the demo file imports them —");
  const h = require("./helpers");
  const bcrypt = require("bcryptjs");
  const reset = async () => {
    for (const t of ["fin_transactions", "interactions", "gifts", "threads", "donors", "fin_audit_log", "import_batches", "users", "fin_funds", "accounts"])
      await h.q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
    await h.q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  };
  await reset();
  await h.q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status) VALUES ($1,'Grant Word Fixture','fx2e-grant',1,'team','active')`, [ORG]);
  await h.q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx2egrant',$1,$2,$3,'Gus Grant','admin')`, [ORG, EMAIL, bcrypt.hashSync(PW, 4)]);
  const tok = await h.login(EMAIL, PW);
  const org = (name, donorType, i) => ({ name, email: `fx2eg${i}@example.org`, kind: "organisation", donorType, organization: name, contactName: "Ann Lee" });
  const donors = [org(THREE[0], "church", 1), org(THREE[1], "business", 2), org(THREE[2], "business", 3),
                  org("Sunrise Family Foundation", "foundation", 4), org("Schwab Charitable", "", 5)];
  const d0 = h.civilPlusDays(-40);
  const gifts = donors.map((d, i) => ({ donorIndex: i, amount: 500 + i * 100, date: d0, fund: "General Operating", paymentMethod: "Check", type: i === 3 ? "grant" : "cash" }));
  const imp = await h.api("POST", "/donors/import-combined", tok, { donors, gifts });
  ok("§2 fixture: the five organisations imported", imp.status === 200 && imp.body.created === 5, imp.body);
  const dr = await h.api("GET", "/drift", tok);
  const by = Object.fromEntries(((dr.body && dr.body.institutional) || []).map(r => [r.name, r]));
  for (const n of THREE) ok(`§2 ${n} says "last gift"`, by[n] && by[n].lastWord === "last gift", by[n]);
  ok('§2 the foundation says "last grant"', by["Sunrise Family Foundation"] && by["Sunrise Family Foundation"].lastWord === "last grant", by["Sunrise Family Foundation"]);
  ok('§2 the donor-advised fund says "last grant"', by["Schwab Charitable"] && by["Schwab Charitable"].lastWord === "last grant", by["Schwab Charitable"]);

  console.log("\n— §3 · Home, as drawn —");
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { console.log("  SKIP  §3 browser: Playwright is not installed here (CI has none)"); }
  if (chromium && process.env.APP_URL) {
    const lr = await h.api("POST", "/auth/login", null, { email: EMAIL, password: PW });
    const browser = await chromium.launch();
    const shots = path.join(root, "docs/fix-2/E");
    fs.mkdirSync(shots, { recursive: true });
    for (const [w, hgt] of [[1440, 900], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width: w, height: hgt } });
      await page.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
        [lr.body.token, JSON.stringify(lr.body.user), JSON.stringify(lr.body.org)]);
      await page.goto(process.env.APP_URL + "/dashboard", { waitUntil: "networkidle" });
      const found = await page.waitForFunction(() => /Institutional giving/i.test(document.body.innerText), null, { timeout: 15000 }).then(() => true).catch(() => false);
      const rows = await page.evaluate(names => {
        const head = [...document.querySelectorAll("div")].find(d => /^Institutional giving/i.test(d.innerText.trim()) && d.children.length === 0);
        const box = head && head.parentElement;
        if (box) box.scrollIntoView({ block: "start" });
        return names.map(n => { const el = box && [...box.querySelectorAll("div")].find(d => d.innerText.startsWith(n) && d.children.length <= 3); return [n, el ? el.innerText.replace(/\s+/g, " ") : null]; });
      }, [...THREE, "Sunrise Family Foundation"]);
      ok(`§3 @${w} Home shows the institutional list`, found);
      for (const [n, t] of rows.slice(0, 3)) ok(`§3 @${w} ${n}: "last gift", never "last grant"`, t && /last gift/.test(t) && !/last grant/.test(t), t);
      ok(`§3 @${w} the foundation: "last grant"`, rows[3][1] && /last grant/.test(rows[3][1]), rows[3][1]);
      ok(`§3 @${w} …and the dates read as dates`, rows.every(([, t]) => t && !/\d{4}-\d{2}-\d{2}/.test(t)), rows);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(shots, `${w}-home-institutional.png`) });
      await page.close();
    }
    await browser.close();
  } else if (chromium) console.log("  SKIP  §3 browser: APP_URL is not set");

  await reset();
  await h.closeDb();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

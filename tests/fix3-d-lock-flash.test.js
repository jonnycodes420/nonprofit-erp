// FIX-3 finding 9 — NOTHING RENDERS AS LOCKED UNTIL THE ORG'S PLAN IS KNOWN.
//
// The walk (27 September): the donor profile flashed "locked, a Team feature"
// for a split second on every open, before the plan loaded. The profile held
// its tier in `useState("core")`, so "not loaded yet" and "not included" were
// the same value, and every lock drew until the fetch answered. The
// directory's portfolio legend did the same (`{tier:"core"}` as its default).
//
// The rule: the plan has THREE states — unknown, included, not included — and
// only "not included" may draw a lock. Unknown shows the loading state.
//
//   §1 source (runs anywhere): the entitlement module says unknown is its own
//      value; no plan state in the client starts as "core"; App's tier of a
//      not-yet-loaded billing is unknown; the profile's lockMajor draws the
//      pending state for unknown and the lock only for a known Core plan.
//   §2 browser (the stack): a Team org whose plan answers SLOWLY (the
//      plan/entitlement fetches are held 2.5s by a Playwright route). The DOM
//      is polled every 40ms through the delay: no locked marker ever appears;
//      then the Team feature renders. A Core org's control leg proves the
//      poll does see a lock when one is drawn (the guard can fail).

const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + String(JSON.stringify(extra)).slice(0, 600) : "")); }
};
const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const read = f => { try { return fs.readFileSync(path.join(root, f), "utf8"); } catch { return ""; } };
const walk = d => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(d, e.name)) : /\.(jsx?|mjs)$/.test(e.name) ? [path.join(d, e.name)] : []);

const TEAM = { org: "org_fx3dlockt", email: "fx3dlockt@example.org", user: "u_fx3dlockt", donor: "d_fx3dlockt" };
const CORE = { org: "org_fx3dlockc", email: "fx3dlockc@example.org", user: "u_fx3dlockc", donor: "d_fx3dlockc" };
const PW = "loadtest1234";
const DELAY_MS = 2500;
// The plan/entitlement fetches: /billing/status (App) and /portfolio/officers
// (the profile's and the directory's tier).
const PLAN_ROUTES = /\/(billing\/status|portfolio\/officers)(\?|$)/;

(async () => {
  console.log("fix3-d-lock-flash");
  console.log("\n— §1 · the source —");
  const ent = await import("../client/src/lib/entitlement.js").catch(() => null);
  ok("§1 client/src/lib/entitlement.js exists", !!ent);
  if (ent) {
    ok("§1 unknown is its own value, distinct from Core", ent.PLAN_UNKNOWN && ent.PLAN_UNKNOWN !== "core" && ent.PLAN_UNKNOWN !== "team", ent.PLAN_UNKNOWN);
    ok("§1 an unknown plan never locks", ent.planLocks(ent.PLAN_UNKNOWN) === false && ent.planLocks(undefined) === false && ent.planLocks(null) === false);
    ok("§1 …and is never known", ent.planKnown(ent.PLAN_UNKNOWN) === false && ent.planKnown(null) === false);
    ok("§1 a Core plan locks a Team feature", ent.planLocks("core") === true && ent.planKnown("core") === true);
    ok("§1 a portal plan locks it too (it is not Team)", ent.planLocks("portal") === true);
    ok("§1 a Team plan does not lock", ent.planLocks("team") === false && ent.planKnown("team") === true);
  }
  // No plan state in the client starts life as "core": that default IS the flash.
  const starts = [];
  for (const f of walk("client/src")) {
    const s = strip(read(f));
    for (const m of s.matchAll(/useState\(\s*(\{[^}]*\btier\s*:\s*["'](core|portal)["'][^}]*\}|["'](core|portal)["'])\s*\)/g)) starts.push(`${f}: ${m[0]}`);
    for (const m of s.matchAll(/tier\s*:\s*["']core["']\s*,\s*single_user/g)) starts.push(`${f}: ${m[0]}`);
  }
  ok("§1 no plan state in client/src starts as \"core\" before the plan loads", starts.length === 0, starts);
  const app = strip(read("client/src/App.jsx"));
  const pto = (app.match(/function planTierOf\(billing\)\{[\s\S]*?\n\}/) || [""])[0];
  ok("§1 App: a billing that has not loaded is PLAN_UNKNOWN, not a tier", /if\(!billing\)return PLAN_UNKNOWN;/.test(pto), pto.slice(0, 200));
  const dp = strip(read("client/src/components/DonorProfile.jsx"));
  const lm = (dp.match(/const lockMajor=\([\s\S]*?\n  \);/) || [""])[0];
  ok("§1 the profile's lockMajor draws the pending state while the plan is unknown", /planKnown\(planTier\)/.test(lm) && /<PlanPending/.test(lm), lm.slice(0, 400));
  ok("§1 the profile's plan starts unknown", /useState\(PLAN_UNKNOWN\)/.test(dp));
  const dd = strip(read("client/src/components/DonorDirectory.jsx"));
  ok("§1 the directory's Core hint reads a KNOWN Core plan, not \"not Team\"", /planLocks\(portfolioMeta\.tier\)&&<span/.test(dd) && !/!teamPortfolios&&<span/.test(dd));
  const sh = strip(read("client/src/components/shared.jsx"));
  ok("§1 shared.jsx exports the one pending state", /export function PlanPending\(/.test(sh));

  console.log("\n— §2 · a slow plan, as drawn —");
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { console.log("  SKIP  §2 browser: Playwright is not installed here (CI has none)"); return done(); }
  if (!process.env.APP_URL) { console.log("  SKIP  §2 browser: APP_URL is not set"); return done(); }
  const h = require("./helpers");
  const bcrypt = require("bcryptjs");
  const reset = async fx => {
    for (const t of ["threads", "interactions", "gifts", "tasks", "donors", "fin_audit_log", "users"])
      await h.q(`DELETE FROM ${t} WHERE org_id=$1`, [fx.org]).catch(() => {});
    await h.q(`DELETE FROM orgs WHERE id=$1`, [fx.org]).catch(() => {});
  };
  const seed = async (fx, plan) => {
    await reset(fx);
    await h.q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status) VALUES ($1,$2,$3,1,$4,'active')`,
      [fx.org, "Lock Fixture " + plan, fx.org.replace(/_/g, "-"), plan]);
    await h.q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Lia Lock','admin')`,
      [fx.user, fx.org, fx.email, bcrypt.hashSync(PW, 4)]);
    // A second officer, so the directory draws its portfolio legend.
    await h.q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Omar Officer','member')`,
      [fx.user + "b", fx.org, "b." + fx.email, bcrypt.hashSync(PW, 4)]);
    await h.q(`INSERT INTO donors (id,org_id,name,email,stage,status,total_giving,gift_count,last_gift_date,assigned_to)
               VALUES ($1,$2,'Mara Majorgift','mara@example.org','cultivate','active',5000,1,$3,$4)`, [fx.donor, fx.org, h.civilPlusDays(-40), fx.user]);
    await h.q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,5000,$4,'cash',$5,'Lia Lock')`,
      ["g_" + fx.donor, fx.org, fx.donor, h.civilPlusDays(-40), fx.user]);
  };
  await seed(TEAM, "team");
  await seed(CORE, "core");

  // Anything that says "this is locked": the shared frosted preview, its
  // Team-plan card, the directory's Core hint, a lock glyph in the rail.
  const probe = () => {
    const out = [];
    if (document.querySelector(".locked-feature")) out.push("locked-feature");
    const txt = document.body ? document.body.innerText : "";
    if (/Unlock with Team/.test(txt)) out.push("Unlock with Team");
    if (/on the Team plan/.test(txt)) out.push("on the Team plan");
    if (document.querySelector('[title="Team plan"]')) out.push("rail lock");
    // Not a lock: the loading state that stands in for one.
    if (document.querySelector("[data-testid=plan-pending]")) out.push("pending");
    return out;
  };

  const browser = await chromium.launch();
  const openWatched = async (fx, w, hgt, target, settle) => {
    const lr = await h.api("POST", "/auth/login", null, { email: fx.email, password: PW });
    // A service worker would answer the fetch before page.route sees it.
    const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, serviceWorkers: "block" });
    const page = await ctx.newPage();
    await page.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lr.body.token, JSON.stringify(lr.body.user), JSON.stringify(lr.body.org)]);
    let held = 0;
    await page.route(u => PLAN_ROUTES.test(new URL(u).pathname), async route => {
      held++;
      await new Promise(r => setTimeout(r, DELAY_MS));
      await route.continue().catch(() => {});
    });
    const seen = new Set();
    let polls = 0;
    const t0 = Date.now();
    await page.goto(`${process.env.APP_URL}${target}`, { waitUntil: "commit" });
    // Poll through the whole delay and a little past it.
    while (Date.now() - t0 < DELAY_MS + settle) {
      const s = await page.evaluate(probe).catch(() => []);
      s.forEach(x => seen.add(x));
      polls++;
      await new Promise(r => setTimeout(r, 40));
    }
    return { page, seen: [...seen].filter(x => x !== "pending"), pending: seen.has("pending"), polls, held };
  };

  for (const [w, hgt] of [[1440, 900], [390, 844]]) {
    // The Team org: the plan is slow, and nothing may lock while it is.
    const t = await openWatched(TEAM, w, hgt, `/donors/${TEAM.donor}`, 1500);
    ok(`§2 @${w} the plan fetches were held (the delay is real)`, t.held >= 1, t.held);
    ok(`§2 @${w} the DOM was polled through the delay`, t.polls >= 20, t.polls);
    ok(`§2 @${w} a Team org's profile never shows a locked marker while its plan loads`, t.seen.length === 0, t.seen);
    ok(`§2 @${w} …it shows the loading state instead`, t.pending);
    if (w === 1440) {
      const feature = await t.page.waitForSelector("[data-testid=dp-move-stage]", { state: "attached", timeout: 10000 }).then(() => true).catch(() => false);
      ok(`§2 @${w} …then the Team feature renders (Move Stage)`, feature);
    }
    const lockedAfter = (await t.page.evaluate(probe)).filter(x => x !== "pending");
    ok(`§2 @${w} …and no lock once the plan is known`, lockedAfter.length === 0, lockedAfter);
    await t.page.context().close();

    // The directory, same slow plan.
    const d = await openWatched(TEAM, w, hgt, `/donors`, 1500);
    ok(`§2 @${w} a Team org's directory never shows a Core hint while its plan loads`, d.seen.length === 0, d.seen);
    await d.page.context().close();

    // The control: a Core org DOES draw a lock once its plan is known, and
    // the same poll sees it. Without this, a probe that sees nothing proves nothing.
    const c = await openWatched(CORE, w, hgt, `/donors/${CORE.donor}`, 3000);
    ok(`§2 @${w} control: a Core org's profile draws the lock once the plan is known (the poll can see one)`, c.seen.includes("locked-feature"), c.seen);
    await c.page.context().close();
  }
  await browser.close();
  await reset(TEAM); await reset(CORE);
  await h.closeDb();
  done();
})().catch(e => { console.error(e); process.exit(1); });

function done() { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }

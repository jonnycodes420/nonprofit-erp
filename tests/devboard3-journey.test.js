// DEVBOARD-3 · THE ADMIN VIEW LEADS TO OPS AND MAP, AND ONE PAGE SHOWS HOW ALL OF STEWARD WORKS.
//
// This guards security and donor data: the Journey tab reads every customer
// org's tables, so it exists for live super-admins only and must never carry a
// donor's name or an amount, only counts and timestamps.
//
//   §1 /admin leads to Ops, Map and Journey (the nav it renders), /ops leads
//      back; signed out, staff and an org admin get 404 on every new route.
//   §2 Journey: each fixture customer org is at its right step, with the days
//      it has sat there (7 days is not stuck, 8 is), archived and non-customer
//      orgs are absent, and no donor name or amount appears in the answer or
//      on the rendered page.
//   §3 every module path in ops/flow.json exists, and GET /ops/flow draws them.
//   §4 the diagram's boxes are buttons, and each one opens its details.
//   RED ON MAIN: /ops/journey and /ops/flow do not exist (404 for the
//   super-admin), ops/flow.json and the views are not there.
//
// WHAT WOULD MAKE THIS FAIL (planted and watched go red, see the PR):
//   · a customer row that carries a donor's name                      → §2
//   · ops/flow.json naming a module that was deleted                  → §3
//
// Run on the scratch stack: BASE, DATABASE_URL (see tests/run-all.sh).
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { testNow, civilDay } = require("./clock");

const ROOT = path.join(__dirname, "..");
const HQ = "org_db3_hq";
const A = "org_db3_larkspur", B = "org_db3_wrenfield", C = "org_db3_thistle", E = "org_db3_sedge", GONE = "org_db3_gone";
const CUSTS = [A, B, C, E, GONE];
const ORGS = [HQ, ...CUSTS];
const PW = "loadtest1234";
const SUPER = "db3-super@t.local", ADMIN = "db3-admin@t.local", STAFF = "db3-staff@t.local";
const DONOR = "Persimmon Quackenbush", AMOUNT = 4321.87;
const DAY = 86400000;

async function reset() {
  for (const t of ["digest_sends", "giving_pages", "data_health_dismissals", "imports", "invites", "gifts", "donors", "user_sessions", "fin_audit_log"])
    await q(`DELETE FROM ${t} WHERE org_id = ANY($1)`, [ORGS]).catch(() => {});
  await q(`DELETE FROM users WHERE org_id = ANY($1)`, [ORGS]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id = ANY($1)`, [ORGS]).catch(() => {});
}

// Bundle a client file with esbuild and render it on the server (no browser).
function render(rel, build) {
  if (!fs.existsSync(path.join(ROOT, rel))) return "";       // not there (main before this build): every check on it is red
  const esbuild = require(path.join(ROOT, "client", "node_modules", "esbuild"));
  const out = path.join(os.tmpdir(), `db3-${path.basename(rel, ".jsx")}-${process.pid}.cjs`);
  esbuild.buildSync({ entryPoints: [path.join(ROOT, rel)], bundle: true, platform: "node", format: "cjs",
    outfile: out, external: ["react", "react-dom", "react-router-dom"], jsx: "automatic", nodePaths: [path.join(ROOT, "client", "node_modules")], logLevel: "silent" });
  const Module = require("module");
  const req = Module.createRequire(path.join(ROOT, "client", "package.json"));
  const React = req("react"), { renderToStaticMarkup } = req("react-dom/server"), RR = req("react-router-dom");
  const m = new Module(out); m.paths = Module._nodeModulePaths(path.join(ROOT, "client")); m._compile(fs.readFileSync(out, "utf8"), out);
  fs.rmSync(out, { force: true });
  return renderToStaticMarkup(build(React, m.exports, RR));
}

(async () => {
  await reset();
  const T = testNow();
  const at = days => new Date(T - days * DAY).toISOString();
  const hash = bcrypt.hashSync(PW, 10);
  const org = (id, name, kind, created, extra = {}) => q(
    `INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind,timezone,created_at,timezone_confirmed_at,archived_at,ein,receipt_signature_name)
     VALUES ($1,$2,$3,1,'active','team',$4,'America/New_York',$5,$6,$7,$8,$9)`,
    [id, name, id.replace(/_/g, "-"), kind, created, extra.tz || null, extra.archived || null, extra.ein || null, extra.sig || null]);
  await org(HQ, "Devboard Three HQ", "internal_test", at(40));
  await org(A, "Larkspur Tide Pool Society", "customer", at(20), { tz: at(19) });
  await org(B, "Wrenfield Allotment Trust", "customer", at(10), { tz: at(10) });
  await org(C, "Thistlecombe Choir", "customer", at(30), { tz: at(30), ein: "12-3456789", sig: "Ottoline Brack" });
  await org(E, "Sedgemoor Lantern Club", "customer", at(7));
  await org(GONE, "Quoinbury Archive Friends", "customer", at(60), { archived: at(1) });
  const user = (id, o, email, role, sup, nudge = false) => q(
    `INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin,notify_thread_nudge,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, o, email, hash, id, role, sup, nudge, at(1)]);
  await user("u_db3_super", HQ, SUPER, "admin", true);
  await user("u_db3_admin", HQ, ADMIN, "admin", false);
  await user("u_db3_staff", HQ, STAFF, "staff", false);
  await user("u_db3_a", A, "a@db3.t.local", "admin", false);
  await user("u_db3_b", B, "b@db3.t.local", "admin", false);
  await user("u_db3_c", C, "c@db3.t.local", "admin", false, true);
  // Every customer has a donor with a name and a gift with an amount: neither may reach the page.
  for (const o of CUSTS) {
    await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ($1,$2,$3,$4,'system:test','test')`, [`d_db3_${o}`, o, DONOR, `${o}@db3.t.local`]);
    // A's gift came in with an import that is not on record, so A has no first gift by hand.
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,import_id,created_at,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,'system:test','test')`,
      [`g_db3_${o}`, o, `d_db3_${o}`, AMOUNT, civilDay(T - 3 * DAY), o === A || o === E || o === GONE ? "imp_db3_none" : null, o === B ? at(2) : at(26)]);
  }
  // B: invited 9 days ago, imported 8, reviewed a pair 7, gift 2 (above) → on Receipts for 2 days.
  // C: every step, each on its own day.
  for (const [o, d] of [[B, 9], [C, 29]]) await q(`INSERT INTO invites (id,org_id,email,role,token,expires_at,created_at) VALUES ($1,$2,$3,'staff',$4,$5,$6)`,
    [`inv_db3_${o}`, o, `colleague@${o}.t.local`, `tok_db3_${o}`, at(-7), at(d)]);
  for (const [o, d] of [[B, 8], [C, 28]]) await q(`INSERT INTO imports (id,org_id,name,shape,committed_at,actor_user_id) VALUES ($1,$2,'people.csv','people',$3,'u_db3_x')`, [`imp_db3_${o}`, o, at(d)]);
  for (const [o, d] of [[B, 7], [C, 27]]) await q(`INSERT INTO data_health_dismissals (id,org_id,kind,key,created_by,created_by_name,created_at) VALUES ($1,$2,'pair',$3,'system:test','test',$4)`,
    [`dhd_db3_${o}`, o, `k_${o}`, at(d)]);
  await q(`INSERT INTO fin_audit_log (id,org_id,user_id,user_name,action,entity_type,entity_id,changes,created_at) VALUES
           ('fa_db3_ein',$1,'u_db3_c','c','updated','org',$1,$2,$3), ('fa_db3_sig',$1,'u_db3_c','c','updated','org',$1,$4,$5)`,
    [C, JSON.stringify({ before: { ein: "[redacted]" }, after: { ein: "[redacted]" } }), at(25.5),
     JSON.stringify({ before: { receipt_signature_name: null }, after: { receipt_signature_name: "x" } }), at(25)]);
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,status,created_at) VALUES ('gp_db3_c',$1,'thistle','Sing with us','active',$2)`, [C, at(24)]);
  await q(`INSERT INTO digest_sends (id,org_id,digest_type,period_key,recipient_user_id,created_at) VALUES ('dg_db3_c',$1,'thread_nudge','day:x','u_db3_c',$2)`, [C, at(23)]);
  for (const d of [20, 19, 18, 17, 16]) await q(`INSERT INTO user_sessions (id,user_id,org_id,created_at,last_active_at) VALUES ($1,'u_db3_c',$2,$3,$3)`, [`ses_db3_${d}`, C, at(d)]);

  console.log("\n§1 · /admin leads to Ops, Map and Journey; /ops leads back; 404 for anyone else");
  const nav = render("client/src/pages/ops/AdminOpsNav.jsx", (React, m, RR) => React.createElement(RR.MemoryRouter, null, React.createElement(m.default)));
  const links = [...nav.matchAll(/<a\b([^>]*)>/g)].map(x => ({ href: (/href="([^"]*)"/.exec(x[1]) || [])[1], label: (/data-ops-link="([^"]*)"/.exec(x[1]) || [])[1] }));
  for (const [label, href] of [["Ops", "/ops"], ["Map", "/ops?tab=map"], ["Journey", "/ops?tab=journey"]])
    ok(`/admin's nav links ${label} to ${href}`, links.some(l => l.label === label && l.href === href), links);
  const admin = fs.readFileSync(path.join(ROOT, "client/src/pages/AdminDashboard.jsx"), "utf8");
  ok("the admin view renders that nav at the top of its main column", /\{\/\* Main \*\/\}\s*\n\s*<div[^\n]*>\s*\n\s*<AdminOpsNav \/>/.test(admin));
  const main = fs.readFileSync(path.join(ROOT, "client/src/main.jsx"), "utf8");
  ok("/admin and /ops are both behind RequireSuperAdmin", /path="\/admin"\s+element=\{<RequireSuperAdmin>/.test(main) && /path="\/ops"\s+element=\{<RequireSuperAdmin>/.test(main));
  const opsPage = fs.readFileSync(path.join(ROOT, "client/src/pages/OpsPage.jsx"), "utf8");
  ok("/ops has a Back to admin link", /<Link to="\/admin"[^>]*>← Back to admin<\/Link>/.test(opsPage));
  ok("/ops has the Journey and How it works tabs", /\["journey", "Journey"\]/.test(opsPage) && /\["flow", "How it works"\]/.test(opsPage));
  const sup = await login(SUPER), adm = await login(ADMIN), staff = await login(STAFF);
  for (const p of ["/ops/journey", "/ops/flow"]) {
    for (const [who, tok] of [["signed out", null], ["staff", staff], ["an org admin", adm]]) {
      const r = await api("GET", p, tok);
      ok(`${who} gets 404 on GET ${p}`, r.status === 404 && !/Larkspur|steps|boxes/.test(JSON.stringify(r.body || "")), r.status);
    }
    const r = await api("GET", p, sup);
    ok(`the super-admin gets GET ${p}`, r.status === 200 && r.body && r.body.ok === true, r.status);
  }

  console.log("\n§2 · Journey: each customer at its step, with how long it has sat, and no donor");
  const j = await api("GET", "/ops/journey", sup);
  const steps = (j.body && j.body.steps) || [];
  ok("the path is the ten onboarding steps, in order", steps.map(s => s.title).join("|") ===
    "Signed up|Org set up|Team invited|First import|Duplicates reviewed|First gift recorded|Receipts set|Giving page live|Daily email on|First week active", steps.map(s => s.title));
  ok("each step says what the customer sees, what Steward does and how it is detected", steps.every(s => s.sees && s.behind && s.detect));
  ok("each step after sign-up opens the demo through the safe link", steps.slice(1).every(s => s.demo && (/^\/login\?next=%2F/.test(s.demo) || /^\/give\/[a-z0-9-]+$/.test(s.demo))), steps.map(s => s.demo));
  ok("a step lists its Map checks with their last result", steps.find(s => s.id === "setup").checks.some(c => c.id === "Set-A" && c.says));
  const rows = (j.body && j.body.orgs && j.body.orgs.rows) || [];
  const row = name => rows.find(r => r.name === name);
  const a = row("Larkspur Tide Pool Society"), b = row("Wrenfield Allotment Trust"), c = row("Thistlecombe Choir"), e = row("Sedgemoor Lantern Club");
  ok("Larkspur is on Team invited, 19 days, stuck", a && a.current === "team" && a.stuckDays === 19 && a.stuck === true, a);
  ok("Wrenfield is on Receipts set, 2 days, not stuck", b && b.current === "receipts" && b.stuckDays === 2 && b.stuck === false && b.reachedCount === 6, b);
  ok("…Wrenfield's first gift is the one recorded by hand 2 days ago", b && Math.abs(new Date(b.steps.find(s => s.id === "gift").at) - (T - 2 * DAY)) < 60000, b && b.steps);
  ok("Sedgemoor has sat 7 days on Org set up: a week is not yet stuck", e && e.current === "setup" && e.stuckDays === 7 && e.stuck === false, e);
  ok("Thistlecombe has done all ten", c && c.current === "done" && c.reachedCount === 10 && c.stuck === false, c);
  ok("…its receipts are dated by the later of the two audit rows", c && Math.abs(new Date(c.steps.find(s => s.id === "receipts").at) - (T - 25 * DAY)) < 60000, c && c.steps);
  ok("…its first active week is the fifth active day", c && c.steps.find(s => s.id === "week").at.slice(0, 10) === civilDay(T - 16 * DAY), c && c.steps.find(s => s.id === "week"));
  ok("an archived customer and a non-customer org are not listed", !row("Quoinbury Archive Friends") && !row("Devboard Three HQ"));
  const body = JSON.stringify(j.body);
  ok("no donor name in the answer", !body.includes("Persimmon") && !body.includes("Quackenbush"));
  ok("no amount in the answer", !/4321|4,321/.test(body));
  const html = render("client/src/pages/ops/JourneyView.jsx", (React, m) => React.createElement(m.default, { data: j.body }));
  ok("the page lists each fixture customer at its step", /data-org-row="Larkspur Tide Pool Society"/.test(html) && /data-on-step="team"/.test(html) && /data-on-step="receipts"/.test(html));
  ok("…and shows Larkspur's 19 days as stuck (brass)", /data-stuck="1"[^>]*><span[^>]*background:#C9A84C[^>]*>19 days here/.test(html), html.match(/data-stuck="1".{0,160}/));
  ok("no donor name or amount on the rendered page", !/Persimmon|Quackenbush|4321|4,321/.test(html));
  const open = render("client/src/pages/ops/JourneyView.jsx", (React, m) => React.createElement(m.default, { data: j.body, initialStep: "receipts" }));
  ok("a step opens its details: what she sees, Open in demo, its checks", /data-step-detail="receipts"/.test(open) && /Open in demo/.test(open) && /data-check="Rcpt-A"/.test(open));

  console.log("\n§3 · every module in ops/flow.json exists");
  const FLOW = require("../server/admin/opsFlow");
  const flow = FLOW.readFlow();
  const problems = FLOW.validateFlow(flow);
  ok("ops/flow.json names only modules that exist, and every box names one", problems.length === 0, problems);
  const f = await api("GET", "/ops/flow", sup);
  ok("GET /ops/flow draws every box with its modules, each present", f.body && f.body.boxes.length === flow.boxes.length
    && f.body.boxes.every(x => x.modules.length && x.modules.every(m => m.exists)) && f.body.problems.length === 0, f.body && f.body.problems);
  ok("…with the Machine's worker and queue health, and each box's Map area", f.body && f.body.health && f.body.health.queue && f.body.boxes.filter(x => x.area).length === flow.boxes.length);

  console.log("\n§4 · the diagram's boxes open their details");
  const drawn = render("client/src/pages/ops/FlowView.jsx", (React, m) => React.createElement(m.default, { data: f.body, now: T }));
  ok("every box is drawn as a button", flow.boxes.every(x => new RegExp(`role="button" tabindex="0" data-box="${x.id}"`).test(drawn)), drawn.slice(0, 400));
  ok("no details are open before a box is chosen", !/data-box-detail=/.test(drawn));
  for (const x of flow.boxes) {
    const d = render("client/src/pages/ops/FlowView.jsx", (React, m) => React.createElement(m.default, { data: f.body, now: T, initialSelected: x.id }));
    ok(`${x.title} opens its details: its modules, live health and Map area`, new RegExp(`data-box-detail="${x.id}"`).test(d)
      && x.modules.every(p => d.includes(`data-module="${p}"`)) && /Worker:/.test(d) && /On the Map/.test(d));
  }

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await reset(); await closeDb(); } catch { /* closing */ } process.exit(1); });

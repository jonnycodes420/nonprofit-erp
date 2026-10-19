// tests/onboard1-setup.test.js · ONBOARD-1. "SET UP STEWARD FOR ME."
//
// Donor data, money and email in one suite. On a fresh org, a two-file
// Salesforce export (Contacts + Donations) and a saved website served from
// localhost (no live fetch) must produce, after ONE Start:
//   * every donor and gift, to the cent, with the Closed Lost row left out by
//     name; the funds the file names; the receipt details with the site's EIN
//     (and receipts still OFF);
//   * three journeys, every one paused; three thank-you drafts; three
//     PREPARED invitations and no invites row;
//   * a "Steward is ready" readout with five people to call;
//   * ZERO emails to anybody (the mail sink and every outbound request), and
//     no journey active;
// and "Undo all of setup" must leave the org with no donors, gifts, funds or
// journeys. A prepared invitation sends exactly one email only when a person
// presses Send. With no AI key, every step still runs on template words.
//
// Planted defects that turned this red: `enabled: true` on the journey step
// ("no journey active"); the Closed Won filter removed from setupFiles
// ("to the cent"); setup calling /auth/invite in its invites step ("zero
// emails"); undo skipping fin_funds ("no funds after undo").
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const PORT = Number(process.env.MATRIX_PORT || 5696);
const SITE = Number(process.env.ONBOARD1_SITE_PORT || 5694);
const SINK = Number(process.env.ONBOARD1_SINK_PORT || 5693);
process.env.PORT = String(PORT);
process.env.BASE = `http://localhost:${PORT}`;
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) process.env.DB_SSL = "disable";
process.env.DISABLE_BACKGROUND_TICKS = "1";
process.env.DISABLE_RATE_LIMIT = "1";
process.env.SESSION_CACHE_TTL_MS = "0";
process.env.TEST_MODE = "1";
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-test-secret";
process.env.RESEND_API_KEY = "re_dummy_local";
process.env.RESEND_BASE_URL = `http://localhost:${SINK}`;
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";
process.env.SETUP_SITE_ALLOW_LOCAL = "1";
delete process.env.ANTHROPIC_API_KEY;   // AI off: the template words must carry every step

const OUTBOUND = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => { OUTBOUND.push(String(url && url.url || url)); return realFetch(url, opts); };
// Setup reads the site through safeFetch.js (FIX-43), not the global fetch.
require("../safeFetch").observers.add(r => OUTBOUND.push(r.url));

const { ok, summary, login, api, q, closeDb, waitFor, importWorkSettled } = require("./helpers");
const FX = path.join(__dirname, "fixtures", "onboard1");
const ORG = "org_onb1", SLUG = "onb1-test", ADMIN = "onb1-admin@example.org", USER = "u_onb1";
const EIN = "61-1234567";

// The saved website, served the way a real one is.
const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".txt": "text/plain" };
const site = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const f = u.pathname === "/" ? "index.html" : u.pathname.replace(/^\/+/, "");
  const p = path.join(FX, "site", path.basename(f));
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
  res.end(fs.readFileSync(p));
});
// The mail sink: every email the server tries to send lands here.
const mail = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", d => { b += d; });
  req.on("end", () => { try { mail.push(JSON.parse(b)); } catch { mail.push({ raw: b }); } res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"id":"sunk"}'); });
});

const TABLES = ["setup_invites", "setup_files", "setup_runs", "agent_writes", "agent_runs", "agent_instructions", "readout_events", "readouts",
  "import_recent_jobs", "import_merges", "imports", "thank_you_drafts", "fin_transactions", "interactions", "gifts", "cultivation_plans",
  "cultivation_templates", "group_members", "audiences", "email_templates", "invites", "threads", "tasks", "donors", "fin_funds",
  "data_health_runs", "ai_fallbacks", "user_sessions", "users"];
// Every table that carries this org's rows (the ledger accounts, the audit
// rows' children, whatever a route made on the side), a few passes so the
// foreign keys come apart in any order. Only org_onb1, only on localhost.
async function reset() {
  const tabs = (await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of [...TABLES, ...tabs]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
    const gone = await q(`DELETE FROM orgs WHERE id=$1 RETURNING id`, [ORG]).catch(() => null);
    if (gone) return;
  }
}
const n = async (sql) => Number((await q(sql, [ORG]))[0].n);

(async () => {
  console.log("onboard1-setup (ONBOARD-1)");
  await new Promise(r => site.listen(SITE, r));
  await new Promise(r => sink.listen(SINK, r));
  require("../server.js");
  await waitFor(async () => (await realFetch(`http://localhost:${PORT}/health`).then(r => r.ok).catch(() => false)), { timeout: 60000, interval: 250 });
  await new Promise(r => setTimeout(r, 1500));
  await reset();

  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled)
           VALUES ($1,'Cedar Hollow Community Pantry',$2,0,'active','team','America/New_York',NOW(),false)`, [ORG, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Rowan Achterberg','admin')`, [USER, ORG, ADMIN, pw]);
  const tok = await login(ADMIN);
  ok("fixture admin signed in", !!tok);
  const mail0 = mail.length;

  // ── §1 the plan, before anything happens ────────────────────────────────
  console.log("\n§1 a plan first, and nothing written");
  const files = ["salesforce-contacts.csv", "salesforce-donations.csv"].map(f => ({ name: f, text: fs.readFileSync(path.join(FX, f), "utf8") }));
  const made = await api("POST", "/setup/runs", tok, { files, siteUrl: `http://localhost:${SITE}/`, tools: ["stripe", "checks"] });
  const R = made.body || {};
  ok("§1 the plan is made", made.status === 201 && R.status === "planned" && R.plan, { status: made.status, body: made.body });
  ok("§1 both files are Salesforce, said with the columns that gave it away",
    !!R.plan && R.plan.files.length === 2 && R.plan.files.every(f => f.system === "Salesforce" && f.because), R.plan && R.plan.files);
  ok("§1 the plan counts 40 people and 99 gifts, $29,536.00, in code",
    !!R.plan && R.plan.counts.donors === 40 && R.plan.counts.gifts === 99 && R.plan.counts.giftCents === 2953600 && R.plan.counts.setAside === 1, R.plan && R.plan.counts);
  ok("§1 it says what it will do, what it prepares, and asks at most ten questions",
    !!R.plan && R.plan.auto.length >= 4 && R.plan.prepared.length >= 2 && R.plan.questions.length >= 1 && R.plan.questions.length <= 10,
    R.plan && { auto: R.plan.auto.length, prepared: R.plan.prepared.length, q: R.plan.questions.map(x => x.key) });
  ok("§1 every question arrives with a default already picked", !!R.plan && R.plan.questions.every(x => x.default !== undefined), R.plan && R.plan.questions);
  ok("§1 the site's EIN is a fact, not a question", !!R.site && R.site.facts.ein && R.site.facts.ein.value === EIN && !R.plan.questions.some(x => x.key === "ein"), R.site && R.site.facts.ein);
  ok("§1 nothing was written before Start: no donor, no gift, no fund",
    (await n(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1`)) === 0 && (await n(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`)) === 0
    && (await n(`SELECT COUNT(*)::int n FROM fin_funds WHERE org_id=$1`)) === 0);

  // ── §2 one Start, and the work runs on the server ────────────────────────
  console.log("\n§2 Start");
  const st = await api("POST", `/setup/runs/${R.id}/start`, tok, {});
  ok("§2 Start is accepted and the work runs on its own", st.status === 202 && st.body.status === "running", { status: st.status, body: st.body && st.body.error });
  let cur = null;
  await waitFor(async () => { cur = (await api("GET", "/setup/current", tok)).body.run; return cur && ["done", "failed"].includes(cur.status); }, { timeout: 90000, interval: 300 });
  ok("§2 setup finished", cur && cur.status === "done", cur && { status: cur.status, error: cur.error, steps: cur.steps.map(s => `${s.key}:${s.status}${s.error ? " " + s.error : ""}`) });

  if (process.env.ONBOARD1_DEBUG) console.log(JSON.stringify({ plan: R.plan, steps: cur && cur.steps.map(s => ({ k: s.key, st: s.status, sentence: s.result && s.result.sentence })), readout: cur && cur.readout }, null, 1));

  // ── §3 to the cent ──────────────────────────────────────────────────────
  console.log("\n§3 donors and gifts, to the cent");
  const gifts = (await q(`SELECT COUNT(*)::int n, COALESCE(SUM(ROUND(amount*100)),0)::bigint c FROM gifts WHERE org_id=$1`, [ORG]))[0];
  ok("§3 99 gifts, $29,536.00 to the cent; the Closed Lost row is not among them", gifts.n === 99 && Number(gifts.c) === 2953600, gifts);
  ok("§3 40 donors", (await n(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`)) === 40);
  const imp = cur && cur.steps.find(s => s.key === "import");
  ok("§3 the import step reads its numbers back from the database and says it footed", !!imp && imp.result && imp.result.footed === true && imp.result.setAside.length === 1, imp && imp.result);
  const funds = (await q(`SELECT name FROM fin_funds WHERE org_id=$1`, [ORG])).map(r => r.name);
  ok("§3 the three funds the file names exist", ["Weekend Backpacks", "Mobile Pantry", "General Operating"].every(f => funds.includes(f)), funds);

  // ── §4 profile, receipt, journeys, templates, invites ─────────────────────
  console.log("\n§4 the basics");
  const [org] = await q(`SELECT ein, legal_name, receipt_address, receipts_enabled, mission, brand_accent, logo_data, setup_started_at, setup_completed_at FROM orgs WHERE id=$1`, [ORG]);
  ok("§4 the receipt carries the fixture EIN, legal name and address", org.ein === EIN && org.legal_name === "Cedar Hollow Community Pantry, Inc." && /412 Mill Road/.test(org.receipt_address || ""), org);
  ok("§4 receipts stay OFF: turning them on is hers", org.receipts_enabled === false, org.receipts_enabled);
  ok("§4 mission, brand colour and logo came from the site", /no family in our county/i.test(org.mission || "") && org.brand_accent && /^data:image\/png;base64,/.test(org.logo_data || ""), { m: org.mission, a: org.brand_accent, l: !!org.logo_data });
  const js = await q(`SELECT name, journey_enabled FROM cultivation_templates WHERE org_id=$1 AND archived_at IS NULL`, [ORG]);
  ok("§4 three journeys", js.length === 3, js);
  ok("§4 ZERO journeys active", js.every(x => x.journey_enabled === false), js);
  const tpl = await q(`SELECT name, blocks::text AS b FROM email_templates WHERE org_id=$1 AND name LIKE 'Thank you, in your words%'`, [ORG]);
  ok("§4 three thank-you drafts, the first carrying their own sentence", tpl.length === 3 && tpl.some(t => /standing with us/.test(t.b)), tpl.map(t => t.name));
  const prep = await q(`SELECT name, status FROM setup_invites WHERE org_id=$1`, [ORG]);
  ok("§4 two invitations prepared, none sent", prep.length === 2 && prep.every(p => p.status === "prepared"), prep);
  ok("§4 the admin running setup is on her own team page and is NOT invited again (walk defect)", !prep.some(p => p.name === "Rowan Achterberg"), prep.map(p => p.name));
  ok("§4 a hyphenated surname stays whole, its title its own (walk defect: \"Haskins, Bell , Development Manager\")",
    prep.some(p => p.name === "Teodor Haskins-Bell"), prep.map(p => p.name));
  ok("§4 no invites row exists: a prepared invitation is not an invitation", (await n(`SELECT COUNT(*)::int n FROM invites WHERE org_id=$1`)) === 0);

  // ── §5 the finish line ──────────────────────────────────────────────────
  console.log("\n§5 Steward is ready");
  const ro = cur && cur.readout;
  ok("§5 the readout names five people to call, each with a reason", !!ro && ro.calls.length === 5 && ro.calls.every(c => c.name && c.reason), ro && ro.calls);
  ok("§5 it says what it did and what is waiting on her", !!ro && ro.did.length >= 4 && ro.waiting.some(w => w.kind === "invite") && ro.waiting.some(w => w.kind === "connection"), ro && { did: ro.did.length, waiting: ro.waiting.map(w => w.kind) });
  ok("§5 the minutes are stored on the org", !!org.setup_started_at && !!org.setup_completed_at && typeof ro.minutes === "number", { s: org.setup_started_at, c: org.setup_completed_at, m: ro && ro.minutes });
  // The import's own job writes its readout when it ends; setup waits for it,
  // so "Steward is ready" is still the newest row once that work has settled
  // (walk defect: the import's "What your history shows" took Home's row).
  await importWorkSettled(ORG);
  await new Promise(r => setTimeout(r, 1500));
  const home = await api("GET", "/readouts/latest", tok);
  ok("§5 the same readout is the row on Home's Thread", home.body.readout && home.body.readout.title === "Steward is ready" && home.body.readout.sourceKind === "setup", home.body);
  ok("§5 every write is on the agent ledger", (await n(`SELECT COUNT(*)::int n FROM agent_writes WHERE org_id=$1`)) >= 8);

  // ── §6 nothing reached anybody ──────────────────────────────────────────
  console.log("\n§6 zero emails");
  ok("§6 ZERO emails reached the mail sink", mail.length === mail0, mail.slice(mail0).map(m => m.to));
  ok("§6 no request left for a mail service", !OUTBOUND.some(u => /resend|sendgrid|postmark|mailgun|:5693/i.test(u)), OUTBOUND.filter(u => /resend|:5693/.test(u)));
  ok("§6 every outbound request was to the local site or this server", OUTBOUND.every(u => new RegExp(`localhost:(${SITE}|${PORT})|127\\.0\\.0\\.1:(${SITE}|${PORT})`).test(u)), [...new Set(OUTBOUND.map(u => u.split("/").slice(0, 3).join("/")))]);

  // ── §6b the logo address comes from their page, so it gets the page's wall
  {
    process.env.SETUP_SITE_ALLOW_LOCAL = "0";
    const SETUP = require("../setup");
    const blocked = await SETUP.fetchLogo(`http://localhost:${SITE}/logo.png`);
    const meta = await SETUP.fetchLogo("http://169.254.169.254/latest/logo.png");
    process.env.SETUP_SITE_ALLOW_LOCAL = "1";
    ok("§6b a logo on a private or loopback host is never fetched (review defect: the logo skipped the wall)", blocked === null && meta === null, { blocked: !!blocked, meta: !!meta });
  }

  // ── §7 her click sends one invitation ───────────────────────────────────
  console.log("\n§7 Send is hers");
  const [one] = await q(`SELECT id FROM setup_invites WHERE org_id=$1 ORDER BY name LIMIT 1`, [ORG]);
  await api("PUT", `/setup/invites/${one.id}`, tok, { email: "marisol@example.org" });
  const s1 = await api("POST", `/setup/invites/${one.id}/send`, tok, {});
  const s2 = await api("POST", `/setup/invites/${one.id}/send`, tok, {});
  ok("§7 Send makes one invitation and emails it once; a second press sends nothing", s1.status === 200 && s2.status === 409
    && (await n(`SELECT COUNT(*)::int n FROM invites WHERE org_id=$1`)) === 1 && mail.length === mail0 + 1, { s1: s1.status, s2: s2.status, mail: mail.length - mail0 });

  // ── §7b FIX-43 Part 2: the gone-quiet journey fires on its group by rule ─
  // Planted defect that turned this red: setup building the journey with no
  // triggerFilters.groupId (the sweep watches only journeys that name a group).
  console.log("\n§7b gone quiet fires");
  {
    const [gq] = await q(`SELECT id, trigger_key, trigger_filters FROM cultivation_templates WHERE org_id=$1 AND name LIKE 'Gone quiet%' AND archived_at IS NULL`, [ORG]);
    const [grp] = gq ? await q(`SELECT kind, rules FROM audiences WHERE org_id=$1 AND id=$2`, [ORG, (gq.trigger_filters || {}).groupId]) : [];
    ok("§7b the gone-quiet journey watches the gave-last-year-not-this-year group by rule", !!gq && gq.trigger_key === "joined_group" && !!grp && /lybunt/.test(JSON.stringify(grp.rules)), { gq, grp });
    // Today minus a year is always inside the prior fiscal year, whatever month it starts.
    const lastYear = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    const lapse = async name => {
      const d = await api("POST", "/donors", tok, { name: `${name} Lapsed` });
      await api("POST", `/donors/${d.body.id}/gifts`, tok, { amount: 75, date: lastYear });
      await api("POST", "/journeys/run-sweep", tok, {});
      return d.body.id;
    };
    const plans = id => n(`SELECT COUNT(*)::int n FROM cultivation_plans WHERE org_id=$1 AND template_id='${gq && gq.id}' AND donor_id='${id}'`);
    const paused1 = await lapse("Pia");
    const on = await api("PATCH", `/journeys/${gq && gq.id}`, tok, { enabled: true });
    const joined = await lapse("Quentin");
    await api("POST", "/journeys/run-sweep", tok, {});
    ok("§7b a person who enters the group after it is turned on starts the journey, once", on.status === 200 && (await plans(joined)) === 1, { on: on.status, plans: await plans(joined) });
    ok("§7b somebody already in the group when it was turned on is not started (the starting line)", (await plans(paused1)) === 0);
    await api("PATCH", `/journeys/${gq && gq.id}`, tok, { enabled: false });
    const paused2 = await lapse("Rhea");
    ok("§7b a paused journey starts nobody", (await plans(paused2)) === 0 && (await plans(paused1)) === 0);
    // Back the way §8 expects it: no plans, none of these three people.
    const ids = [paused1, joined, paused2].map(x => `'${x}'`).join(",");
    for (const t of ["cultivation_plans", "tasks", "interactions", "fin_transactions", "gifts", "group_sweep_seen"]) await q(`DELETE FROM ${t} WHERE org_id=$1 AND donor_id IN (${ids})`, [ORG]).catch(() => {});
    await q(`DELETE FROM donors WHERE org_id=$1 AND id IN (${ids})`, [ORG]).catch(e => console.log("cleanup:", e.message));
  }

  // ── §8 undo all of setup ────────────────────────────────────────────────
  console.log("\n§8 Undo all of setup");
  const u = await api("POST", `/setup/runs/${R.id}/undo`, tok, {});
  ok("§8 undo reports nothing kept", u.status === 200 && u.body.ok === true, u.body);
  const left = {
    donors: await n(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1`),
    gifts: await n(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`),
    funds: await n(`SELECT COUNT(*)::int n FROM fin_funds WHERE org_id=$1`),
    journeys: await n(`SELECT COUNT(*)::int n FROM cultivation_templates WHERE org_id=$1`),
    templates: await n(`SELECT COUNT(*)::int n FROM email_templates WHERE org_id=$1`),
    groups: await n(`SELECT COUNT(*)::int n FROM audiences WHERE org_id=$1`),
  };
  ok("§8 the org has no donors, gifts, funds or journeys", left.donors === 0 && left.gifts === 0 && left.funds === 0 && left.journeys === 0, left);
  ok("§8 and none of the templates or groups setup made", left.templates === 0 && left.groups === 0, left);
  const [after] = await q(`SELECT ein, legal_name, mission, logo_data, setup_started_at FROM orgs WHERE id=$1`, [ORG]);
  ok("§8 the profile is back as it was", !after.ein && !after.legal_name && !after.mission && !after.logo_data && !after.setup_started_at, after);

  await reset();
  await closeDb();
  site.close(); sink.close();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

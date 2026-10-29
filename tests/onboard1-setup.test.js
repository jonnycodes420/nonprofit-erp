// tests/onboard1-setup.test.js · ONBOARD-1. "SET UP STEWARD FOR ME."
//
// Donor data, money and email in one suite. On a fresh org, a two-file
// Salesforce export (Contacts + Donations) and a saved website served from
// localhost (no live fetch) must produce a plan whose spreadsheet lines are the
// one reader's own counts (FIX-55: setup never reads a file its own way and
// Start imports nothing; she imports each file from the import screen), and,
// after ONE Start:
//   * the receipt details with the site's EIN (and receipts still OFF);
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
// ("no journey active"); setup counting a spreadsheet its own way (FIX-55:
// the plan read 443 people and 0 gifts from the event workbook, "the one
// reader's own counts"); setup calling /auth/invite in its invites step ("zero
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
const { testNow } = require("./clock");
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

const TABLES = ["old_report_checks", "historical_totals", "stored_sheets", "old_report_batches", "group_sweep_seen", "setup_invites", "setup_files", "setup_runs", "agent_writes", "agent_runs", "agent_instructions", "readout_events", "readouts",
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
  // FIX-55: the plan hands every spreadsheet to the one reader. Each file's
  // line is what POST /sheet-import/understand says about it, and the plan
  // counts nothing itself. Start imports nothing.
  console.log("\n§1 a plan first, and nothing written");
  const R0 = await import("../shared/sheetRead.js");
  const texts = Object.fromEntries(["salesforce-contacts.csv", "salesforce-donations.csv"].map(f => [f, fs.readFileSync(path.join(FX, f), "utf8")]));
  const files = Object.entries(texts).map(([name, text]) => ({ name, text }));
  const made = await api("POST", "/setup/runs", tok, { files, siteUrl: `http://localhost:${SITE}/`, tools: ["stripe", "checks"] });
  const R = made.body || {};
  ok("§1 the plan is made", made.status === 201 && R.status === "planned" && R.plan, { status: made.status, body: made.body });
  const pick = c => ({ people: c.people, gifts: c.gifts, giftCents: c.giftCents, pledges: c.pledges });
  // IMPORT-5: the Salesforce pair is ONE import, read together (each sheet
  // named for its file, as the import screen names them), people linked by Contact ID
  const pairName = "salesforce-contacts.csv + salesforce-donations.csv";
  const pairSheets = Object.entries(texts).map(([name, text]) => ({ name: name.replace(/\.csv$/, ""), grid: R0.gridFromText(text) }));
  const readerSays = { [pairName]: pick(((await api("POST", "/sheet-import/understand", tok, { fileName: pairName, sheets: pairSheets })).body || {}).counts || {}) };
  ok("§1 the Salesforce pair is one spreadsheet step carrying the one reader's own counts, the same as the import screen's",
    !!R.plan && R.plan.files.length === 1 && R.plan.files.every(f => f.role === "sheet" && f.reader && f.reader.ok && f.name === pairName
      && (f.fileIds || []).length === 2 && JSON.stringify(pick(f.reader.counts)) === JSON.stringify(readerSays[f.name])),
    R.plan && { files: R.plan.files.map(f => [f.name, f.role, f.reader && pick(f.reader.counts || {})]), readerSays });
  ok("§1 IMPORT-5: the pair imports with no question (99 gifts, 40 people)", !!R.plan && R.plan.files[0] && R.plan.files[0].reader.questions === 0
    && R.plan.files[0].reader.counts.gifts === 99 && R.plan.files[0].reader.counts.people === 40, R.plan && R.plan.files[0] && R.plan.files[0].reader);
  ok("§1 the plan counts nothing itself and has no import step", !!R.plan && !R.plan.counts && !R.plan.auto.some(a => a.step === "import" || /^Import /.test(a.sentence)),
    R.plan && { counts: R.plan.counts, auto: R.plan.auto.map(a => a.sentence) });
  ok("§1 every other step is listed on its own, each with a tick she can take off",
    !!R.plan && ["profile", "groups", "templates", "journeys", "invites", "connections"].every(k => R.plan.choosable.includes(k)
      && [...R.plan.auto, ...R.plan.prepared].some(a => a.step === k)), R.plan && R.plan.choosable);
  ok("§1 it asks at most ten questions, each with a default already picked",
    !!R.plan && R.plan.questions.length <= 10 && R.plan.questions.every(x => x.default !== undefined), R.plan && R.plan.questions);
  ok("§1 the site's EIN is a fact, not a question", !!R.site && R.site.facts.ein && R.site.facts.ein.value === EIN && !R.plan.questions.some(x => x.key === "ein"), R.site && R.site.facts.ein);
  ok("§1 nothing was written before Start: no donor, no gift, no fund",
    (await n(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1`)) === 0 && (await n(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`)) === 0
    && (await n(`SELECT COUNT(*)::int n FROM fin_funds WHERE org_id=$1`)) === 0);
  const back = await api("GET", `/setup/runs/${R.id}/files/${R.plan && R.plan.files[0] && (R.plan.files[0].fileIds || [R.plan.files[0].id])[0]}`, tok);
  ok("§1 the plan hands the file back as she gave it, for the import screen", back.status === 200 && back.body.text === texts[back.body.name], { status: back.status, name: back.body && back.body.name });

  // ── §1b she imports from the plan's import screen ──────────────────────
  // The import screen's own write (POST /sheet-import/commit), its receipt
  // and its Undo. IMPORT-5: the Contacts + Donations pair goes in as ONE
  // import with no column questions; each gift attaches by Contact ID, and the
  // Closed Lost donation is set aside by name.
  console.log("\n§1b the import screen imports, not Start");
  const commit = async (fileName, sheets) => {
    const r = await api("POST", "/sheet-import/commit", tok, { background: true, fileName, sheets, answers: {} });
    if (r.status !== 202) return { r, end: null };
    let j = null;
    await waitFor(async () => { j = (await api("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok)).body; return j && j.status !== "running"; }, { timeout: 120000, interval: 200 });
    return { r, end: j, importId: r.body.importId };
  };
  const contacts = Object.fromEntries(R0.gridFromText(texts["salesforce-contacts.csv"]).slice(1).map(c => [c[0], c]));
  const won = R0.gridFromText(texts["salesforce-donations.csv"]).slice(1).filter(d => d[5] === "Closed Won");
  const imports = [];
  const c = await commit(pairName, pairSheets);
  ok("§1b the Salesforce pair imports as one, through the import screen's own write", c.end && c.end.status === "done", c.end || c.r.body);
  if (c.importId) imports.push(c.importId);
  // each Closed Won donation is on the person its Contact ID names, to the cent
  const onPerson = await q(`SELECT d.external_donor_id AS cid, ROUND(SUM(g.amount)*100)::bigint AS c FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.org_id=$1 GROUP BY 1`, [ORG]);
  const wantBy = {};
  for (const d of won) wantBy[d[1]] = (wantBy[d[1]] || 0) + Math.round(Number(d[3]) * 100);
  ok("§1b every gift is on the person its Contact ID names, to the cent", onPerson.length === Object.keys(wantBy).length
    && onPerson.every(r => wantBy[r.cid] === Number(r.c) && contacts[r.cid]), onPerson.slice(0, 5));
  const g0 = (await q(`SELECT COUNT(*)::int n, COALESCE(SUM(ROUND(amount*100)),0)::bigint c FROM gifts WHERE org_id=$1`, [ORG]))[0];
  ok("§1b 99 gifts, $29,536.00 to the cent, and 40 people", g0.n === 99 && Number(g0.c) === 2953600
    && (await n(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`)) === 40, g0);
  const before = { gifts: g0.n, donors: await n(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1`) };

  // ── §2 one Start, and the work runs on the server ────────────────────────
  console.log("\n§2 Start");
  const st = await api("POST", `/setup/runs/${R.id}/start`, tok, { steps: R.plan.choosable });
  ok("§2 Start is accepted and the work runs on its own", st.status === 202 && st.body.status === "running", { status: st.status, body: st.body && st.body.error });
  let cur = null;
  await waitFor(async () => { cur = (await api("GET", "/setup/current", tok)).body.run; return cur && ["done", "failed"].includes(cur.status); }, { timeout: 90000, interval: 300 });
  ok("§2 setup finished", cur && cur.status === "done", cur && { status: cur.status, error: cur.error, steps: cur.steps.map(s => `${s.key}:${s.status}${s.error ? " " + s.error : ""}`) });

  if (process.env.ONBOARD1_DEBUG) console.log(JSON.stringify({ plan: R.plan, steps: cur && cur.steps.map(s => ({ k: s.key, st: s.status, sentence: s.result && s.result.sentence })), readout: cur && cur.readout }, null, 1));

  // ── §3 Start imported nothing ────────────────────────────────────────────
  console.log("\n§3 Start writes no person and no gift");
  ok("§3 the same gifts and people as the import screen left", (await n(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`)) === before.gifts
    && (await n(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1`)) === before.donors);
  ok("§3 there is no import step", !!cur && !cur.steps.some(s => s.key === "import" || s.key === "funds"), cur && cur.steps.map(s => s.key));

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
    const lastYear = new Date(testNow() - 365 * 864e5).toISOString().slice(0, 10);
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
  ok("§8 setup's undo leaves her imports alone: each has its own receipt and Undo",
    (await n(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`)) === before.gifts);
  const rev = [];
  for (const id of [...imports].reverse()) rev.push((await api("POST", `/imports/${id}/reverse`, tok, {})).status);
  ok("§8 the import undoes from its own receipt", rev.length === 1 && rev.every(x => x === 200), rev);
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

  // ── §9 FIX-43 Part 3 + FIX-55: a gift list, an old report, and the ticks ─
  // The gift list is the reader's (its plan line is the reader's own counts,
  // and it is imported from the import screen); a giving summary among the
  // files is an old report, kept out of the import and checked by RECONCILE-1,
  // its one line in the readout. Start with only the old-report check ticked
  // makes no groups, drafts or journeys.
  // Planted defects that turned this red: readFilesFor passing the report to
  // the import ("the report is not gifts"); the finish step skipping the check
  // ("one line in the readout"); chosenSteps ignoring the ticks ("unticked").
  console.log("\n§9 a gift list, an old report, and only one step ticked");
  {
    const giftsCsv = ["Donor Name,Email,Gift Date,Amount,Fund",
      "Ada Lovelace,ada@example.org,2025-03-02,500.50,General Operating",
      "Ada Lovelace,ADA@example.org,2025-06-01,250.00,General Operating",
      "\"Babbage, Charles\",,2025-11-30,750.00,Building Fund",
      "Grace Hopper,grace@example.org,2026-01-15,33.33,"].join("\n");
    const reportCsv = "Year,Total Raised,Gifts,Donors\n2025,1500.50,3,2\n";
    const made2 = await api("POST", "/setup/runs", tok, { files: [{ name: "gift-history.csv", text: giftsCsv }, { name: "giving-summary-2025.csv", text: reportCsv }], tools: [] });
    const R2 = made2.body || {};
    const gf = R2.plan && R2.plan.files.find(f => f.name === "gift-history.csv");
    const want2 = (((await api("POST", "/sheet-import/understand", tok, { fileName: "gift-history.csv", sheets: [{ name: "Sheet1", grid: R0.gridFromText(giftsCsv) }] })).body || {}).counts) || {};
    ok("§9 the gift list's plan line is the reader's: 4 gifts, $1,533.83", made2.status === 201 && gf && gf.role === "sheet" && gf.reader
      && gf.reader.counts.gifts === 4 && gf.reader.counts.giftCents === 153383 && gf.reader.counts.gifts === want2.gifts && gf.reader.counts.giftCents === want2.giftCents,
      { status: made2.status, gf, want2: { gifts: want2.gifts, giftCents: want2.giftCents } });
    ok("§9 the giving summary is an old report, not gifts", !!R2.plan && R2.plan.files.some(f => f.name === "giving-summary-2025.csv" && f.role === "old_report")
      && R2.plan.auto.some(a => a.step === "old_reports" && /giving-summary-2025\.csv/.test(a.sentence)), R2.plan && R2.plan.files);
    const c9 = await (async () => {
      const r = await api("POST", "/sheet-import/commit", tok, { background: true, fileName: "gift-history.csv", sheets: [{ name: "Sheet1", grid: R0.gridFromText(giftsCsv) }], answers: {} });
      let j = null;
      if (r.status === 202) await waitFor(async () => { j = (await api("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok)).body; return j && j.status !== "running"; }, { timeout: 60000, interval: 200 });
      return { j, importId: r.body && r.body.importId };
    })();
    const g2 = (await q(`SELECT COUNT(*)::int n, COALESCE(SUM(ROUND(amount*100)),0)::bigint c FROM gifts WHERE org_id=$1`, [ORG]))[0];
    ok("§9 the gift list imported from the import screen: 4 gifts, $1,533.83 to the cent, the report's line not among them", c9.j && c9.j.status === "done" && g2.n === 4 && Number(g2.c) === 153383, { g2, j: c9.j && c9.j.status });
    await api("POST", `/setup/runs/${R2.id}/start`, tok, { steps: ["old_reports"] });
    let c2 = null;
    await waitFor(async () => { c2 = (await api("GET", "/setup/current", tok)).body.run; return c2 && c2.id === R2.id && ["done", "failed"].includes(c2.status); }, { timeout: 90000, interval: 300 });
    ok("§9 setup finished", c2 && c2.status === "done", c2 && { status: c2.status, steps: c2.steps.map(x => `${x.key}:${x.status}${x.error ? " " + x.error : ""}`) });
    const made9 = { groups: await n(`SELECT COUNT(*)::int n FROM audiences WHERE org_id=$1`), templates: await n(`SELECT COUNT(*)::int n FROM email_templates WHERE org_id=$1`),
      journeys: await n(`SELECT COUNT(*)::int n FROM cultivation_templates WHERE org_id=$1`) };
    ok("§9 Start did only the ticked step: the unticked groups, drafts and journeys were skipped and made nothing",
      Object.values(made9).every(v => v === 0) && ["groups", "templates", "journeys"].every(k => (c2.steps.find(x => x.key === k) || {}).status === "skipped"), { made9, steps: c2 && c2.steps.map(x => `${x.key}:${x.status}`) });
    const [sheet] = await q(`SELECT id, report_kind FROM stored_sheets WHERE org_id=$1 AND kind='old_report' AND removed_at IS NULL`, [ORG]);
    const [chk] = sheet ? await q(`SELECT result FROM old_report_checks WHERE org_id=$1 AND sheet_id=$2`, [ORG, sheet.id]) : [];
    ok("§9 the old report is kept under Reports and RECONCILE-1 checked it: it matches to the cent", !!sheet && sheet.report_kind === "giving_summary" && chk && chk.result.status === "matches", { sheet, chk: chk && { s: chk.result.status, t: chk.result.sentence } });
    const line = c2 && c2.readout && c2.readout.did.find(d => d.step === "old_report");
    ok("§9 \"Steward is ready\" carries the check in one line, linking to the full check", !!line && /giving-summary-2025\.csv: Matches Steward to the cent\./.test(line.sentence)
      && line.open && line.open.kind === "old_report_check" && sheet && line.open.id === sheet.id, line);
    const u2 = await api("POST", `/setup/runs/${R2.id}/undo`, tok, {});
    const r9 = c9.importId ? await api("POST", `/imports/${c9.importId}/reverse`, tok, {}) : { status: 0 };
    const left2 = { gifts: await n(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`), donors: await n(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1`),
      sheets: await n(`SELECT COUNT(*)::int n FROM stored_sheets WHERE org_id=$1 AND removed_at IS NULL`), totals: await n(`SELECT COUNT(*)::int n FROM historical_totals WHERE org_id=$1`) };
    ok("§9 setup's undo takes the old report back out, and the import's own Undo the gifts", u2.status === 200 && r9.status === 200 && Object.values(left2).every(v => v === 0), { u: u2.body, r9: r9.status, left2 });
  }

  await reset();
  await closeDb();
  site.close(); sink.close();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

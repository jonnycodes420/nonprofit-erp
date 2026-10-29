// setup.js · ONBOARD-1. "SET UP STEWARD FOR ME."
//
// A new org hands Steward three things: its donor files, its website address
// and the tools it takes gifts with. This module reads them, writes a PLAN in
// plain sentences (what it will do on its own, what it prepares for a click,
// and the questions only a person can answer), and, after the one Start, does
// the work through the SAME routes a person's clicks call (agentCall.js), so
// every route's own checks, the audit middleware and the org scoping apply.
//
// WHAT IT IS. The seventh persona on the one engine (shared/agentPersonas.js
// "setup"). Its instruction is an agent_instructions row, its run an
// agent_runs row, and every row it creates or changes is an agent_writes row
// with the before-image, so "Undo all of setup" is a walk of that ledger in
// reverse, never a guess.
//
// THE LINES IT NEVER CROSSES.
//   * It never emails anybody. Staff invites are PREPARED (setup_invites); a
//     person presses Send, and only that press calls POST /auth/invite.
//   * It never reaches a donor and never turns anything on: journeys are
//     created with enabled:false, receipts stay off, no thank-you is sent.
//   * It never records money and never reads a spreadsheet its own way
//     (FIX-55). Every donor file goes to the one reader: the plan shows what
//     POST /sheet-import/understand found in it (the same preview, counts and
//     questions the import screen shows), and she imports it from that screen
//     (SpreadsheetImport), with its receipt and its Undo. Start writes no
//     person and no gift.
//   * Every step is hers to leave out: the plan lists each one with a tick,
//     and Start does only the ticked ones.
//   * AI writes sentences, never facts. Counts and cents are the reader's;
//     the site's facts are setupSite.js's. With AI off every step runs with
//     the template sentences below.
//
// THE RUN SURVIVES A CLOSED TAB. The files are stored (setup_files) and each
// step's state is on the run row, so the work continues on the server, and a
// run found mid-step after a restart resumes from the first unfinished step.
"use strict";

const { query, run, uuid } = require("./db");
const AC = require("./agentCall");
const site = require("./setupSite");
const SF = require("./safeFetch");

const ACTOR = { id: "system:setup", name: "Steward (setup)" };
// FIX-55: no import step and no funds step. A spreadsheet is imported from the
// import screen (the one reader), never by Start.
const STEP_KEYS = ["read_site", "profile", "groups", "templates", "journeys", "invites", "connections", "finish"];
// The steps the plan lists with a tick. read_site goes with profile; "old_reports"
// is the finish step's check of an old report.
const CHOOSABLE = ["profile", "groups", "templates", "journeys", "invites", "connections", "old_reports"];
// Tables whose new rows a step created are ledgered by diffing ids before and
// after the step, so a row a route made on the side (a starter template a
// journey step needed) is caught too.
const WATCHED = ["fin_funds", "email_templates", "audiences", "cultivation_templates", "campaigns"];
const STARTER_GROUPS = ["first_gift", "lybunt", "monthly", "top_tenth"];
const TOOL_CARDS = {
  stripe: { label: "Stripe", focus: "stripe" }, paypal: { label: "PayPal", focus: "paypal" },
  zeffy: { label: "Zeffy", focus: "zeffy" }, givebutter: { label: "Givebutter", focus: "givebutter" },
  square: { label: "Square", focus: "square" }, quickbooks: { label: "QuickBooks", focus: "quickbooks" },
  checks: { label: "Checks", focus: null }, other: { label: "Something else", focus: null },
};
const TOOL_KEYS = Object.keys(TOOL_CARDS);

let deps = { aiGate: null, anthropicFor: null, recordAiFallback: null, orgTz: null, orgToday: null };
function configure(d) { deps = { ...deps, ...d }; }

const plural = (n, one, many) => `${Number(n).toLocaleString("en-US")} ${n === 1 ? one : many}`;
const dollars = c => "$" + (Math.round(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const j = v => (typeof v === "string" ? JSON.parse(v) : v);

async function filesMod() { return import("./shared/setupFiles.js"); }

// ── SCHEMA ──────────────────────────────────────────────────────────────────
async function ensureSchema(pool) {
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS setup_started_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS setup_runs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      instruction_id TEXT, agent_run_id TEXT,
      -- planned | running | done | undone | failed
      status TEXT NOT NULL DEFAULT 'planned',
      site_url TEXT, tools JSONB NOT NULL DEFAULT '[]'::jsonb,
      site JSONB, files_read JSONB, plan JSONB, answers JSONB NOT NULL DEFAULT '{}'::jsonb,
      steps JSONB NOT NULL DEFAULT '{}'::jsonb, readout JSONB, error TEXT,
      heartbeat_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, undone_at TIMESTAMPTZ,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_setup_runs_org ON setup_runs (org_id, created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS setup_files (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      run_id TEXT NOT NULL REFERENCES setup_runs(id) ON DELETE CASCADE,
      name TEXT NOT NULL, body TEXT NOT NULL, bytes INTEGER,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_setup_files_run ON setup_files (run_id)`);
  // A PREPARED invitation is not an invitation: nothing is emailed until a
  // person presses Send, which calls the one invite route.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS setup_invites (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      run_id TEXT REFERENCES setup_runs(id) ON DELETE SET NULL,
      name TEXT NOT NULL, title TEXT, email TEXT, role TEXT NOT NULL DEFAULT 'staff',
      status TEXT NOT NULL DEFAULT 'prepared',     -- prepared | sent | dismissed
      source_url TEXT, invite_id TEXT, sent_at TIMESTAMPTZ, sent_by TEXT, sent_by_name TEXT,
      created_by TEXT NOT NULL, created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_setup_invites_org ON setup_invites (org_id, status)`);
}

// ── READING (no writes to anything but the run row) ─────────────────────────
// FIX-55: setup never reads a spreadsheet its own way. A file arrives as the
// sheets of cells the import screen reads (SpreadsheetImport's readSheetFile,
// or gridFromText for a CSV's text, the same function), with its own bytes so
// the plan can hand that very file to the import screen after a closed tab.
async function storedFiles(orgId, runId) {
  return query(`SELECT id, name, body FROM setup_files WHERE org_id=? AND run_id=? ORDER BY created_at, id`, [orgId, runId]);
}

// Every stored file as { id, name, sheets }. A CSV given as text becomes its
// sheet the reader's way; a run stored before FIX-55 (records) becomes a grid
// of its columns.
async function filesFor(orgId, runId) {
  const R = await import("./shared/sheetRead.js");
  return (await storedFiles(orgId, runId)).map(f => {
    const b = j(f.body) || {};
    let sheets = Array.isArray(b.sheets) ? b.sheets : null;
    if (!sheets && b.text != null) sheets = [{ name: "Sheet1", grid: R.gridFromText(String(b.text)) }];
    if (!sheets && Array.isArray(b.records) && b.records.length) {
      const hs = Object.keys(b.records[0]);
      sheets = [{ name: "Sheet1", grid: [hs, ...b.records.map(r => hs.map(h => r[h] ?? null))] }];
    }
    return { id: f.id, name: f.name, sheets: sheets || [], suggestedDate: b.suggestedDate || null, hasBytes: !!b.bytes };
  });
}

// Which files are old reports, and which go to the one reader. Deciding a
// file's kind is not counting it: an old report (a giving summary, a LYBUNT
// list, a by-fund table) is not gifts, and RECONCILE-1 checks it against what
// the imports brought in (FIX-43 Part 3). Every other file is the reader's.
async function sortFiles(orgId, runId) {
  const F = await filesMod();
  const sheets = [], oldReports = [];
  for (const f of await filesFor(orgId, runId)) {
    const filled = f.sheets.filter(s => Array.isArray(s.grid) && s.grid.some(r => Array.isArray(r) && r.some(c => c != null && String(c).trim() !== "")));
    // Only a one-table file can be an old report; a workbook is the reader's.
    const rep = filled.length === 1 ? oldReportIn(F, { name: f.name, text: csvFromGrid(filled[0].grid) }) : null;
    if (rep) oldReports.push({ ...rep, fileId: f.id });
    else sheets.push(f);
  }
  return { sheets, oldReports };
}

// What the one reader found in a file: POST /sheet-import/understand, called
// as the person, with the body the import screen sends. Its counts, button and
// questions are copied as they are; nothing here adds them up.
async function readerSaw(call, f) {
  if (!call) return null;
  const r = await AC.call(call, "POST", "/sheet-import/understand",
    { fileName: f.name, sheets: f.sheets, answers: f.suggestedDate ? { suggestedDate: f.suggestedDate } : {}, overrides: {} });
  if (r.status >= 400 || !r.body) return { ok: false, sentence: (r.body && (r.body.message || r.body.error)) || `Steward could not read ${f.name}.` };
  const c = r.body.counts || {};
  const pick = ["records", "people", "persons", "donors", "pledgers", "volunteers", "gifts", "giftCents", "undatedGifts", "pledges", "pledgeCents", "pledgeOpenCents", "aside"];
  return { ok: true, counts: Object.fromEntries(pick.filter(k => typeof c[k] === "number").map(k => [k, c[k]])),
    button: (r.body.button && r.body.button.text) || null, ready: !!r.body.ready,
    questions: (r.body.questions || []).filter(x => !x.optional).length, fileKind: r.body.fileKind || null };
}

// Is this file an old report, and if so its table and REPORTS-5's guess.
// A file the import reads as people or gifts stays an import file unless its
// own name or columns say it is a list about people (a LYBUNT, retention, top
// donors or board report), whose amounts are not gifts.
const LIST_KINDS = ["lybunt", "retention", "top_donors", "board_report", "grant_report"];
function oldReportIn(F, p) {
  const O = require("./oldReports");
  const text = String(p.text || "");
  const t = O.parseCsv(text);
  if (!t.headers.length || !t.rows.length) return null;
  const g = O.guessReport({ fileName: p.name, headers: t.headers, rows: t.rows });
  if (g.kind === "other") return null;
  const role = F.fileRole(p);
  if ((role === "donors" || role === "gifts") && !LIST_KINDS.includes(g.kind)) return null;
  const wide = t.headers.filter(h => /^(fy\s*)?(19|20)\d{2}$/i.test(String(h).trim())).length >= 1
    && !t.headers.some(h => /^(amount|total|gift total|revenue)$/i.test(String(h).trim()));
  return { name: p.name, text, headers: t.headers, rows: t.rows, kind: g.kind, system: g.system, period: g.period, why: g.why,
    mapping: wide ? { wide: true, amountRow: 0 } : O.guessMapping(t.headers) };
}
const csvCell = v => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function csvFromGrid(grid) {
  return (grid || []).filter(r => Array.isArray(r)).map(r => r.map(csvCell).join(",")).join("\n");
}

// The questions a computer can't answer, each with a default already picked.
// Never more than about ten; the rest go under Later. The questions about a
// spreadsheet are the import screen's own, asked there.
function buildQuestions({ siteRead }) {
  const qs = [];
  const add = (key, text, options, def, extra = {}) => qs.push({ key, text, options, default: def, ...extra });
  for (const sq of (siteRead && siteRead.questions) || []) {
    if (["ein", "address", "legalName"].includes(sq.key))
      add(sq.key, sq.text, sq.options || null, sq.options ? sq.options[0] : "", { kind: "text", receipt: true });
    else if (sq.key === "mission") add("mission", sq.text, null, "", { kind: "text" });
  }
  return { now: qs.slice(0, 10), later: qs.slice(10) };
}

// Each step its own line with its own tick (FIX-55): `step` is the key Start
// receives when it is ticked.
function planSentences({ siteRead, oldReports = [], tools, staff }) {
  const auto = [], prepared = [];
  if (siteRead && siteRead.ok) {
    const got = ["mission", "logoUrl", "brandPrimary", "address", "ein", "legalName"].filter(k => siteRead.facts[k]);
    auto.push({ step: "profile", sentence: `Fill in your profile and branding from ${plural(siteRead.pagesRead.length, "page", "pages")} of your site (${got.length} of 6 details found).` });
  } else if (siteRead) auto.push({ step: "profile", sentence: `Skip your website: ${siteRead.reason}.`, fixed: true });
  for (const rep of oldReports)
    auto.push({ step: "old_reports", sentence: `Check ${rep.name}, your old report, against what Steward has${rep.period ? ` for ${rep.period.label}` : ""}, and say where they agree.` });
  auto.push({ step: "groups", sentence: "Add the starter groups: first gift this year, gave last year but not yet this year, monthly givers and the top tenth by lifetime giving." });
  auto.push({ step: "templates", sentence: "Write a thank-you email and two variations in your words, as drafts for you to read." });
  auto.push({ step: "journeys", sentence: "Build three journeys, all paused: a new-donor welcome, a gone-quiet note and a card-failed note for monthly donors." });
  if (staff.length) prepared.push({ step: "invites", sentence: `Invitations for ${staff.map(s => s.name).join(", ")}, ready for you to send.` });
  const conn = [...new Set(tools)].filter(t => TOOL_CARDS[t] && TOOL_CARDS[t].focus);
  if (conn.length) prepared.push({ step: "connections", sentence: `Connections for ${conn.map(t => TOOL_CARDS[t].label).join(", ")}. Connecting is your click.` });
  prepared.push({ step: "receipts", sentence: "Your receipt with your legal name, address and EIN. Turning receipts on stays your decision.", fixed: true });
  return { auto, prepared };
}

// The plan's line for each file. A spreadsheet carries what the reader saw;
// it is imported from the import screen, never by Start.
async function planFiles(orgId, runId, call) {
  const sorted = await sortFiles(orgId, runId);
  const files = [];
  for (const f of sorted.sheets) files.push({ id: f.id, name: f.name, role: "sheet", hasBytes: f.hasBytes, reader: await readerSaw(call, f) });
  for (const rep of sorted.oldReports) files.push({ id: rep.fileId, name: rep.name, role: "old_report", evidence: rep.why, rows: rep.rows.length });
  return { files, oldReports: sorted.oldReports };
}

// Build (or rebuild) a run's plan from what is stored. Writes only the run row.
// `call` is the person's session, for the reader; without it (a plan a
// super-admin prepared) the reader's numbers are filled in by readSheets when
// the org's own person opens the plan.
async function planRun(orgId, runId, { call = null } = {}) {
  const [r] = await query(`SELECT * FROM setup_runs WHERE id=? AND org_id=?`, [runId, orgId]);
  if (!r) return null;
  const siteRead = r.site_url ? await site.readSite(r.site_url) : null;
  const { files, oldReports } = await planFiles(orgId, runId, call);
  const tools = (j(r.tools) || []).filter(t => TOOL_KEYS.includes(t));
  const users = new Set((await query(`SELECT lower(name) AS n FROM users WHERE org_id=? AND name IS NOT NULL`, [orgId])).map(u => u.n));
  const staff = (siteRead && siteRead.facts.staff ? siteRead.facts.staff.value : []).filter(p => !users.has(p.name.toLowerCase()));
  const questions = buildQuestions({ siteRead });
  const sentences = planSentences({ siteRead, oldReports, tools, staff });
  const plan = { ...sentences, questions: questions.now, later: questions.later, files, tools, staff,
    choosable: CHOOSABLE.filter(k => [...sentences.auto, ...sentences.prepared].some(a => a.step === k && !a.fixed)) };
  const answers = Object.fromEntries(questions.now.map(q => [q.key, q.default]));
  const siteStore = siteRead ? { ok: siteRead.ok, reason: siteRead.reason || null, pagesRead: siteRead.pagesRead, facts: siteRead.facts, questions: siteRead.questions } : null;
  await run(`UPDATE setup_runs SET site=?, files_read=?, plan=?, answers=?, updated_at=NOW() WHERE id=? AND org_id=?`,
    [JSON.stringify(siteStore), JSON.stringify(files), JSON.stringify(plan), JSON.stringify({ ...answers, ...(j(r.answers) || {}) }), runId, orgId]);
  return plan;
}

// The reader's numbers for a plan's spreadsheets, read again as the person
// (a plan a super-admin prepared has none yet). Writes only the run row.
async function readSheets(orgId, runId, call) {
  const r = await loadRun(orgId, runId);
  if (!r || !r.plan) return null;
  const { files } = await planFiles(orgId, runId, call);
  const plan = { ...r.plan, files };
  await run(`UPDATE setup_runs SET files_read=?, plan=?, updated_at=NOW() WHERE id=? AND org_id=?`, [JSON.stringify(files), JSON.stringify(plan), runId, orgId]);
  return plan;
}

// One stored file as she gave it, so the plan can hand it to the import screen.
async function fileFor(orgId, runId, fileId) {
  const [f] = await query(`SELECT id, name, body FROM setup_files WHERE org_id=? AND run_id=? AND id=?`, [orgId, runId, fileId]);
  if (!f) return null;
  const b = j(f.body) || {};
  return { id: f.id, name: f.name, bytes: b.bytes || null, text: b.bytes ? null : (b.text != null ? String(b.text) : null),
    lastModified: b.lastModified || null };
}

// Start's ticks: a step she unticked is skipped before it runs, read_site with
// profile, and the old-report check rides the finish step.
function chosenSteps(plan, ticked) {
  const offered = new Set((plan && plan.choosable) || []);
  const on = new Set(Array.isArray(ticked) ? ticked.map(String) : [...offered]);
  const steps = {};
  const off = k => offered.has(k) && !on.has(k);
  const skip = { status: "skipped", result: { sentence: "Left out, as you chose.", skipped: true, unticked: true } };
  for (const k of ["profile", "groups", "templates", "journeys", "invites", "connections"]) if (off(k)) steps[k] = skip;
  if (off("profile")) steps.read_site = skip;
  if (off("old_reports")) steps.finish = { status: "waiting", oldReports: false };
  return steps;
}

// ── THE LEDGER ──────────────────────────────────────────────────────────────
async function ledger(ctx, { tool, table, entityId, before, after, cites }) {
  const id = "aw_" + uuid().slice(0, 10);
  await run(`INSERT INTO agent_writes (id,org_id,run_id,instruction_id,tool,entity_table,entity_id,before_row,after_row,cites)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, ctx.orgId, ctx.agentRunId, ctx.instructionId, tool, table, String(entityId),
     before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, JSON.stringify(cites || [{ kind: "setup_run", id: ctx.runId }])]);
  return id;
}
async function idsOf(orgId) {
  const out = {};
  for (const t of WATCHED) out[t] = new Set((await query(`SELECT id FROM ${t} WHERE org_id=?`, [orgId]).catch(() => [])).map(r => r.id));
  return out;
}
async function ledgerNew(ctx, tool, before) {
  const after = await idsOf(ctx.orgId);
  let n = 0;
  for (const t of WATCHED) for (const id of after[t]) if (!before[t].has(id)) { await ledger(ctx, { tool, table: t, entityId: id, before: null }); n++; }
  return n;
}
const ORG_COLS = ["name", "mission", "website", "logo_data", "brand_accent", "brand_accent_fg", "brand_primary", "brand_secondary",
  "voice_samples", "legal_name", "ein", "receipt_address", "receipt_signature_name", "receipt_signature_title"];
async function orgImage(orgId) {
  const [o] = await query(`SELECT ${ORG_COLS.join(", ")} FROM orgs WHERE id=?`, [orgId]);
  return o || {};
}

// ── THE STEPS ───────────────────────────────────────────────────────────────
// Each returns { sentence, rows?, figures? }. Each is safe to run again after a
// restart: it reads what is already there before it writes.
const STEPS = {
  async read_site(ctx) {
    const s = ctx.run.site;
    if (!s) return { sentence: "No website was given, so your profile is as you left it.", skipped: true };
    if (!s.ok) return { sentence: `Your website was not read: ${s.reason}.`, skipped: true };
    return { sentence: `Read ${plural(s.pagesRead.length, "page", "pages")} of your site.`, rows: s.pagesRead };
  },

  async profile(ctx) {
    const s = ctx.run.site, a = ctx.run.answers || {};
    const f = (s && s.ok && s.facts) || {};
    const val = k => (f[k] ? f[k].value : null);
    const before = await orgImage(ctx.orgId);
    const changes = [];
    const patch = {};
    const mission = String(a.mission || val("mission") || "").trim();
    if (mission && !before.mission) patch.mission = mission;
    if (s && s.ok && !before.website) patch.website = ctx.run.site_url;
    const legal = String(a.legalName || val("legalName") || "").trim();
    if (legal && !before.legal_name) patch.legalName = legal;
    const ein = String(a.ein || val("ein") || "").trim();
    if (ein && !before.ein) patch.ein = ein;
    const ad = val("address");
    const addr = String(a.address || (ad ? `${ad.line1}, ${ad.city}, ${ad.state} ${ad.zip}` : "")).trim();
    if (addr && !before.receipt_address) patch.receiptAddress = addr;
    const staff = val("staff") || [];
    const lead = staff.find(x => /director|president|ceo|founder/i.test(x.title));
    if (lead && !before.receipt_signature_name) { patch.receiptSignatureName = lead.name; patch.receiptSignatureTitle = lead.title; }
    if (Object.keys(patch).length) {
      if (patch.mission || patch.website) { patch.mission = patch.mission || before.mission || null; patch.website = patch.website || before.website || null; }
      const r = await AC.call(ctx.call, "PATCH", `/orgs/${ctx.orgId}`, patch);
      if (r.status >= 400) changes.push(`Profile not saved: ${(r.body && (r.body.message || r.body.error)) || r.status}`);
      else changes.push(...Object.keys(patch).map(k => ({ mission: "mission", website: "website", legalName: "legal name", ein: "EIN",
        receiptAddress: "receipt address", receiptSignatureName: "receipt signer", receiptSignatureTitle: null }[k])).filter(Boolean));
    }
    // Branding: the accent colour, and the logo as an image the site serves.
    const brand = {};
    if (val("brandPrimary") && !before.brand_accent) brand.brandAccent = val("brandPrimary");
    if (val("logoUrl") && !before.logo_data) {
      const logo = await fetchLogo(val("logoUrl"));
      if (logo) brand.logoData = logo;
    }
    if (Object.keys(brand).length) {
      const r = await AC.call(ctx.call, "PUT", "/orgs/branding", brand);
      if (r.status < 400) { if (brand.brandAccent) changes.push("brand color"); if (brand.logoData) changes.push("logo"); }
    }
    // A voice sample for the thank-you drafts: their own words, never ours.
    const voice = String(val("voiceSample") || "").trim();
    const hadVoice = Array.isArray(j(before.voice_samples)) && j(before.voice_samples).length;
    if (voice.length >= 40 && !hadVoice) {
      const r = await AC.call(ctx.call, "PUT", "/org/voice-samples", { samples: [voice] });
      if (r.status < 400) changes.push("a sample of how you write");
    }
    // Vocabulary: program names are kept where the vocabulary list keeps
    // words; a program is not a fund until a person says so.
    const after = await orgImage(ctx.orgId);
    const changed = Object.fromEntries(ORG_COLS.filter(c => JSON.stringify(before[c]) !== JSON.stringify(after[c])).map(c => [c, before[c]]));
    if (Object.keys(changed).length) await ledger(ctx, { tool: "setup_profile", table: "orgs", entityId: ctx.orgId, before: changed,
      after: Object.fromEntries(Object.keys(changed).map(c => [c, after[c]])) });
    const words = changes.filter(x => typeof x === "string" && !/^Profile not saved/.test(x));
    return { sentence: words.length ? `Filled in your ${words.join(", ")}.` : "Your profile already had everything your site shows.",
      problems: changes.filter(x => /^Profile not saved/.test(x)) };
  },

  // FIX-55: no import step and no funds step. Each spreadsheet is imported
  // from the import screen (SpreadsheetImport, the one reader), with its own
  // receipt and Undo; Start never writes a person or a gift.

  async groups(ctx) {
    const before = await idsOf(ctx.orgId);
    const made = [];
    for (const key of STARTER_GROUPS) {
      const r = await AC.call(ctx.call, "POST", `/groups/starters/${key}`);
      if (r.status < 400) made.push(key);
    }
    await ledgerNew(ctx, "setup_groups", before);
    const [lyb] = await query(`SELECT id FROM audiences WHERE org_id=? AND rules::text LIKE '%lybunt%' ORDER BY created_at DESC LIMIT 1`, [ctx.orgId]).catch(() => []);
    ctx.run.steps.groups = { ...(ctx.run.steps.groups || {}), lybuntGroupId: lyb ? lyb.id : null };
    return { sentence: made.length ? `Added ${plural(made.length, "starter group", "starter groups")}.` : "Your starter groups were already there.", lybuntGroupId: lyb ? lyb.id : null };
  },

  async templates(ctx) {
    const s = ctx.run.site || {};
    const voice = s.facts && s.facts.voiceSample ? s.facts.voiceSample.value : "";
    const orgName = (await orgImage(ctx.orgId)).name || "";
    const drafts = await thankYouWords(ctx.orgId, { voice, orgName });
    const before = await idsOf(ctx.orgId);
    let n = 0;
    for (const [i, d] of drafts.list.entries()) {
      const name = `Thank you, in your words (draft ${i + 1} of 3)`;
      const [dup] = await query(`SELECT id FROM email_templates WHERE org_id=? AND name=? AND archived_at IS NULL`, [ctx.orgId, name]);
      if (dup) continue;
      const c = await AC.call(ctx.call, "POST", "/email-templates", { starterKey: "thank_you" });
      if (c.status >= 400 || !c.body) continue;
      const t = c.body.template || c.body;
      // The first richtext block is the letter ("Hi {{first_name}}," then the
      // paragraphs); only its paragraphs are replaced, every other block stays.
      let swapped = false;
      const blocks = Array.isArray(t.blocks) ? t.blocks.map(b => {
        if (swapped || !b || b.type !== "richtext" || !Array.isArray(b.blocks) || !/\{\{first_name\}\}/.test((b.blocks[0] || {}).text || "")) return b;
        swapped = true;
        return { ...b, blocks: [{ type: "p", text: "Hi {{first_name}}," }, ...d.paragraphs.map(p => ({ type: "p", text: p }))] };
      }) : t.blocks;
      await AC.call(ctx.call, "PUT", `/email-templates/${t.id}`, { name, subject: d.subject, preheader: t.preheader, blocks });
      n++;
    }
    await ledgerNew(ctx, "setup_templates", before);
    return { sentence: `Wrote ${plural(n, "thank-you draft", "thank-you drafts")} ${drafts.ai ? "in your voice" : "from your own words"}. Nothing was sent; they wait in Templates for you to read.`, ai: drafts.ai };
  },

  async journeys(ctx) {
    const before = await idsOf(ctx.orgId);
    const out = [];
    const mk = async body => {
      const r = await AC.call(ctx.call, "POST", "/journeys", { ...body, enabled: false });
      if (r.status < 400 && r.body) out.push({ id: r.body.id, name: r.body.name, enabled: !!r.body.enabled });
      return r;
    };
    await mk({ presetKey: "new_donor_first_year" });
    const gid = (ctx.run.steps.groups || {}).lybuntGroupId;
    if (gid) {
      await mk({ name: "Gone quiet: a personal note", trigger: "joined_group", groupId: gid,
        triggerFilters: { groupId: gid },
        description: "When somebody gave last year and not yet this year, a note from you and a call on your list.",
        steps: [{ type: "send", label: "A short note from you", offsetDays: 0, starter: "thank_you" },
                { type: "follow_up", label: "Call if they have not given", offsetDays: 14 }] });
    }
    await mk({ presetKey: "recurring_failed" });
    await ledgerNew(ctx, "setup_journeys", before);
    const on = out.filter(x => x.enabled).length;
    if (on) throw new Error("a journey came back switched on");
    return { sentence: `Built ${plural(out.length, "journey", "journeys")}, all paused: ${out.map(x => x.name).join(", ")}. Turn each on when you are ready.`, rows: out };
  },

  async invites(ctx) {
    const s = ctx.run.site || {};
    const staff = s.facts && s.facts.staff ? s.facts.staff.value : [];
    // Somebody who already signs in to this org is not invited again: the
    // director running setup is usually on her own website's team page.
    const users = new Set((await query(`SELECT lower(name) AS n FROM users WHERE org_id=? AND name IS NOT NULL`, [ctx.orgId])).map(u => u.n));
    let n = 0, already = 0;
    for (const p of staff) {
      if (users.has(p.name.toLowerCase())) { already++; continue; }
      const [dup] = await query(`SELECT id FROM setup_invites WHERE org_id=? AND lower(name)=lower(?) AND status<>'dismissed'`, [ctx.orgId, p.name]);
      if (dup) continue;
      const id = "si_" + uuid().slice(0, 10);
      await run(`INSERT INTO setup_invites (id,org_id,run_id,name,title,role,source_url,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, ctx.orgId, ctx.runId, p.name, p.title || null, /director|president|ceo|founder/i.test(p.title || "") ? "admin" : "staff", p.url || null, ACTOR.id, ACTOR.name]);
      await ledger(ctx, { tool: "setup_invites", table: "setup_invites", entityId: id, before: null });
      n++;
    }
    return { sentence: (n ? `Prepared ${plural(n, "invitation", "invitations")} for the people on your site. Nothing was sent: add an email and press Send.` : "No new team names were found to invite.")
      + (already ? ` ${plural(already, "person", "people")} on your site already ${already === 1 ? "has" : "have"} an account.` : ""), prepared: n, already };
  },

  async connections(ctx) {
    const P = ctx.run.plan || {};
    const fromFile = (ctx.run.answers || {}).connect_from_file === "no" ? [] : (P.fileTools || []);
    const keys = [...new Set([...(P.tools || []), ...fromFile])].filter(t => TOOL_CARDS[t] && TOOL_CARDS[t].focus);
    return { sentence: keys.length ? `${plural(keys.length, "connection is", "connections are")} ready for your click: ${keys.map(k => TOOL_CARDS[k].label).join(", ")}.` : "No connections to make.", cards: keys };
  },

  async finish(ctx) {
    const drift = await AC.call(ctx.call, "GET", "/drift");
    const list = (drift.body && Array.isArray(drift.body.list) ? drift.body.list : [])
      .filter(x => x && x.donorId).sort((a, b) => (Number(b.valueAtRisk) || 0) - (Number(a.valueAtRisk) || 0)).slice(0, 5);
    let calls = list.map(x => ({ donorId: x.donorId, name: x.donorName, reason: x.reason }));
    if (calls.length < 5) {
      // Drift reads a pattern; a new file can be too young for one. The rest
      // come from the same rule Home uses for "gave last year, not this year".
      const yr = Number(String(ctx.today).slice(0, 4));
      const more = await query(`SELECT d.id, d.name, MAX(g.date) AS last, SUM(ROUND(g.amount*100))::bigint AS cents
          FROM donors d JOIN gifts g ON g.donor_id=d.id AND g.org_id=d.org_id
         WHERE d.org_id=? AND d.deleted_at IS NULL AND COALESCE(d.deceased,false)=false AND COALESCE(d.do_not_contact,false)=false
         GROUP BY d.id, d.name HAVING MAX(g.date) < ? AND MAX(g.date) >= ?
         ORDER BY SUM(g.amount) DESC LIMIT 10`, [ctx.orgId, `${yr}-01-01`, `${yr - 1}-01-01`]);
      for (const m of more) {
        if (calls.length >= 5 || calls.some(c => c.donorId === m.id)) continue;
        calls.push({ donorId: m.id, name: m.name, reason: `Gave ${dollars(Number(m.cents))} in all, last on ${String(m.last).slice(0, 10)}, and nothing yet this year.` });
      }
    }
    // FIX-43 Part 3: an old report in the files is checked by RECONCILE-1,
    // through the old-reports route a person's own upload takes, so it is
    // stored, checked and undone exactly as that one is.
    const reports = [];
    const wantReports = (ctx.run.steps.finish || {}).oldReports !== false;
    for (const rep of wantReports ? ctx.files.oldReports || [] : []) {
      const b = await AC.call(ctx.call, "POST", "/old-reports/batches", {});
      if (b.status >= 400 || !b.body || !b.body.id) continue;
      await ledger(ctx, { tool: "setup_old_report", table: "old_report_batches", entityId: b.body.id, before: null, after: { id: b.body.id } });
      const fileName = /\.csv$/i.test(rep.name) ? rep.name : rep.name.replace(/\.[^.]+$/, "") + ".csv";
      const r = await AC.call(ctx.call, "POST", `/old-reports/batches/${b.body.id}/files`, {
        file: "data:text/csv;base64," + Buffer.from(rep.text, "utf8").toString("base64"), fileName,
        kind: rep.kind, system: rep.system, periodFrom: rep.period ? rep.period.from : undefined, periodTo: rep.period ? rep.period.to : undefined,
        pull: true, mapping: rep.mapping, why: rep.why });
      if (r.status >= 400 || !r.body) { reports.push({ name: rep.name, sheetId: null, sentence: `${rep.name} was kept out of the import, and could not be checked: ${(r.body && r.body.sentence) || "the old report was refused"}.` }); continue; }
      const c = r.body.check;
      reports.push({ name: rep.name, sheetId: r.body.sheetId, status: c ? c.status : "not_checked",
        sentence: c && c.sentence ? `${rep.name}: ${c.sentence}` : `${rep.name} is kept under Reports; Steward could not check it.` });
    }
    return { sentence: `${plural(calls.length, "person", "people")} to call tomorrow.`, calls, reports };
  },
};


// A logo the site serves, as the data URI the branding route stores.
async function fetchLogo(url) {
  try {
    const n = site.normaliseSiteUrl(url);
    if (!n.ok) return null;
    // The logo address comes from THEIR page, so it gets the same wall as the
    // page itself, through the one safe fetch (FIX-43).
    const r = await SF.safeFetch(n.url.href, { headers: { accept: "image/*" }, maxBytes: 400 * 1024, timeoutMs: 8000, allowLocal: site.allowLocal() });
    if (!r.ok) return null;
    const type = String(r.headers.get("content-type") || "").split(";")[0].trim();
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(type)) return null;
    const buf = r.body;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch { return null; }
}

// THE THANK-YOU WORDS. AI may rephrase; it never adds a fact. The tokens
// ({{first_name}}, {{last_gift_amount}}) are the only facts, and they are
// filled by the template engine, not by the model. With AI off these three
// are built from the org's own sentence and plain template words.
const TEMPLATE_THANKS = (orgName, voice) => [
  { subject: "Thank you, {{first_name}}",
    paragraphs: [voice || `Thank you for standing with ${orgName || "us"}.`, "Your gift of {{last_gift_amount}} arrived, and it is already at work."] },
  { subject: "Your gift arrived, {{first_name}}",
    paragraphs: ["Your gift of {{last_gift_amount}} came in this week, and I wanted you to hear about it from a person.", voice || "We are so grateful you are part of this."] },
  { subject: "{{first_name}}, thank you",
    paragraphs: [`Everything that happens at ${orgName || "our organization"} happens because people like you choose to help.`, "Thank you for your gift of {{last_gift_amount}}. It matters here."] },
];
async function thankYouWords(orgId, { voice, orgName }) {
  const base = TEMPLATE_THANKS(orgName, voice);
  if (!deps.anthropicFor) return { list: base, ai: false };
  const gate = deps.aiGate ? await deps.aiGate(orgId) : { ok: false };
  if (!gate.ok) { if (deps.recordAiFallback) await deps.recordAiFallback(orgId, "setup_thanks", { code: "ai_off", reason: gate.reason }).catch(() => {}); return { list: base, ai: false }; }
  try {
    const client = deps.anthropicFor(orgId);
    const r = await client.messages.create({ model: "claude-haiku-4-5-20251001", max_tokens: 900, thinking: { type: "disabled" },   // the ASK-3 rule: a short rephrase, no thinking
      system: "You rewrite three short donor thank-you emails so they sound like the organization's own sample. Keep every {{token}} exactly. Add no facts, numbers, names or claims that are not in the input. No em dashes. Reply as JSON: {\"drafts\":[{\"subject\":\"\",\"paragraphs\":[\"\",\"\"]}]}.",
      messages: [{ role: "user", content: JSON.stringify({ sample: voice, drafts: base }) }] });
    const text = (r.content || []).map(c => c.text || "").join("");
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const ok = Array.isArray(parsed.drafts) && parsed.drafts.length === 3 && parsed.drafts.every(d =>
      d && typeof d.subject === "string" && Array.isArray(d.paragraphs) && d.paragraphs.length >= 1
      && !/\u2014/.test(d.subject + d.paragraphs.join(" ")) && !/\$\d|\b\d{2,}\b/.test(d.subject + d.paragraphs.join(" ")));
    if (!ok) throw Object.assign(new Error("draft_check_failed"), { code: "draft_check_failed" });
    return { list: parsed.drafts.map(d => ({ subject: d.subject.slice(0, 120), paragraphs: d.paragraphs.slice(0, 3).map(p => String(p).slice(0, 600)) })), ai: true };
  } catch (e) {
    if (deps.recordAiFallback) await deps.recordAiFallback(orgId, "setup_thanks", e).catch(() => {});
    return { list: base, ai: false };
  }
}

// ── THE RUN ─────────────────────────────────────────────────────────────────
const RUNNING = new Set();

async function loadRun(orgId, runId) {
  const [r] = await query(`SELECT * FROM setup_runs WHERE id=? AND org_id=?`, [runId, orgId]);
  if (!r) return null;
  for (const k of ["site", "plan", "answers", "steps", "readout", "tools", "files_read"]) r[k] = j(r[k]) || (k === "steps" || k === "answers" ? {} : null);
  return r;
}

async function saveSteps(orgId, runId, steps) {
  await run(`UPDATE setup_runs SET steps=?, heartbeat_at=NOW(), updated_at=NOW() WHERE id=? AND org_id=?`, [JSON.stringify(steps), runId, orgId]);
}

// Do every step not yet done, in order. Called after Start and on resume.
async function execute(orgId, runId, call) {
  if (RUNNING.has(runId)) return;
  RUNNING.add(runId);
  try {
    const r = await loadRun(orgId, runId);
    if (!r || r.status !== "running") return;
    const today = deps.orgToday && deps.orgTz ? deps.orgToday(await deps.orgTz(orgId)) : new Date().toISOString().slice(0, 10);   // ORG_TZ_SEAM_OK
    const ctx = { orgId, runId, run: r, call: { ...call, instructionId: r.instruction_id, instructionText: "Set up Steward for me" },
      agentRunId: r.agent_run_id, instructionId: r.instruction_id, today, files: await sortFiles(orgId, runId) };
    for (const key of STEP_KEYS) {
      const st = r.steps[key] || {};
      if (st.status === "done" || st.status === "skipped") continue;
      r.steps[key] = { ...st, status: "running", startedAt: st.startedAt || new Date().toISOString() };
      await saveSteps(orgId, runId, r.steps);
      try {
        const result = await STEPS[key](ctx);
        r.steps[key] = { ...r.steps[key], status: result && result.skipped ? "skipped" : "done", result, finishedAt: new Date().toISOString() };
      } catch (e) {
        r.steps[key] = { ...r.steps[key], status: "failed", error: String(e && e.message || e).slice(0, 400) };
        await saveSteps(orgId, runId, r.steps);
        await run(`UPDATE setup_runs SET status='failed', error=? WHERE id=? AND org_id=?`, [r.steps[key].error, runId, orgId]);
        await run(`UPDATE agent_runs SET status='failed', finished_at=NOW(), error=? WHERE id=? AND org_id=?`, [r.steps[key].error, r.agent_run_id, orgId]).catch(() => {});
        return;
      }
      await saveSteps(orgId, runId, r.steps);
    }
    const readout = await finishReadout(orgId, r, ctx.call, ctx.today);
    await run(`UPDATE setup_runs SET status='done', completed_at=NOW(), readout=?, updated_at=NOW() WHERE id=? AND org_id=?`, [JSON.stringify(readout), runId, orgId]);
    await run(`UPDATE orgs SET setup_completed_at=NOW() WHERE id=?`, [orgId]);
    await run(`UPDATE agent_runs SET status='done', finished_at=NOW(), read_summary=?, actions=? WHERE id=? AND org_id=?`,
      [readout.headline, JSON.stringify(readout.did.map(d => d.sentence)), r.agent_run_id, orgId]).catch(() => {});
    await run(`UPDATE agent_instructions SET status='done', updated_at=NOW() WHERE id=? AND org_id=?`, [r.instruction_id, orgId]).catch(() => {});
  } finally { RUNNING.delete(runId); }
}

// "Steward is ready." Every line from a step's own result; the minutes from
// the stored clock.
async function finishReadout(orgId, r, call, today) {
  const res = k => (r.steps[k] && r.steps[k].result) || {};
  const did = [];
  const push = (step, sentence, open) => { if (sentence) did.push({ step, sentence, open: open || null }); };
  // A step she unticked did nothing, so it says nothing here.
  const pushStep = (step, open) => { const x = res(step); if (!x.unticked) push(step, x.sentence, open); };
  // FIX-55: the people and gifts are what her imports from the plan brought
  // in (each with its own receipt and Undo), read from the database.
  const [held] = await query(`SELECT (SELECT COUNT(*)::int FROM donors WHERE org_id=? AND deleted_at IS NULL) AS people,
      (SELECT COUNT(*)::int FROM gifts WHERE org_id=?) AS gifts, (SELECT COALESCE(SUM(ROUND(amount*100)),0)::bigint FROM gifts WHERE org_id=?) AS cents`, [orgId, orgId, orgId]);
  const imp = { donors: Number(held.people) || 0, gifts: Number(held.gifts) || 0, cents: Number(held.cents) || 0 };
  if (imp.donors) push("import", `${plural(imp.donors, "person", "people")} and ${plural(imp.gifts, "gift", "gifts")} (${dollars(imp.cents)}) are in Steward, from the files you imported. Each import has its own receipt and Undo.`, { kind: "import" });
  pushStep("profile", { kind: "settings", section: "org" });
  pushStep("groups", { kind: "tab", tab: "groups" });
  pushStep("templates", { kind: "tab", tab: "templates" });
  pushStep("journeys", { kind: "settings", section: "journeys" });
  // FIX-43 Part 3: the old report's check, in one line, opening the full check.
  for (const rep of res("finish").reports || []) push("old_report", rep.sentence, rep.sheetId ? { kind: "old_report_check", id: rep.sheetId } : null);
  const waiting = [];
  const inv = await query(`SELECT id, name, title, email FROM setup_invites WHERE org_id=? AND status='prepared' ORDER BY created_at`, [orgId]);
  for (const i of inv) waiting.push({ kind: "invite", id: i.id, sentence: `Send ${i.name}'s invitation${i.title ? ` (${i.title})` : ""}.` });
  for (const c of res("connections").cards || []) waiting.push({ kind: "connection", key: c, sentence: `Connect ${TOOL_CARDS[c].label}.`, focus: TOOL_CARDS[c].focus });
  const [o] = await query(`SELECT ein, legal_name, receipt_address FROM orgs WHERE id=?`, [orgId]);
  if (!o.ein || !o.legal_name || !o.receipt_address) waiting.push({ kind: "receipt", sentence: "Add your legal name, address and EIN so receipts can go out." });
  const dup = await healthDuplicates(call);
  if (dup) waiting.push({ kind: "duplicates", count: dup, sentence: `We found ${plural(dup, "possible duplicate", "possible duplicates")}. Review now or later?` });
  const calls = res("finish").calls || [];
  const [clock] = await query(`SELECT setup_started_at FROM orgs WHERE id=?`, [orgId]);
  const minutes = clock && clock.setup_started_at ? Math.max(0, (Date.now() - new Date(clock.setup_started_at).getTime()) / 60000) : null;
  const headline = imp.donors ? `${plural(imp.donors, "person", "people")} and ${plural(imp.gifts, "gift", "gifts")} are in Steward.` : "Steward is set up.";
  // The same readout, as the LIVE-1 row on Home's Thread. Home's layout does
  // not change: this is one more readout row, shaped the way they all are.
  const rid = "ro_" + uuid().slice(0, 10);
  const lines = [
    { kind: "setup_did", count: did.length, cents: imp.cents || 0, sentence: headline.replace(/\.$/, ""), why: "What setup did, each step from its own result.", rows: did },
    { kind: "setup_waiting", count: waiting.length, cents: 0, sentence: `${plural(waiting.length, "thing is", "things are")} waiting on you`, why: "Questions and clicks only a person can make.", rows: waiting },
    { kind: "setup_calls", count: calls.length, cents: 0, sentence: `${plural(calls.length, "person", "people")} to call tomorrow`, why: "Drift's top five by dollars at stake; while a new file is too young for Drift's patterns, the people who gave most last year and not yet this year.", rows: calls },
  ];
  await run(`INSERT INTO readouts (id, org_id, source_kind, source_id, title, headline, lines, for_date, created_by, created_by_name)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [rid, orgId, "setup", r.id, "Steward is ready", headline, JSON.stringify(lines), today, ACTOR.id, ACTOR.name]);
  await run(`INSERT INTO agent_writes (id,org_id,run_id,instruction_id,tool,entity_table,entity_id,before_row,after_row,cites) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ["aw_" + uuid().slice(0, 10), orgId, r.agent_run_id, r.instruction_id, "setup_finish", "readouts", rid, null, null, JSON.stringify([{ kind: "setup_run", id: r.id }])]);
  return { headline, did, waiting, calls, minutes: minutes == null ? null : Math.round(minutes * 100) / 100,
    minutesSentence: minutes == null ? null : minutes < 1 ? `Setup took ${plural(Math.max(1, Math.round(minutes * 60)), "second", "seconds")} from Start to ready.` : `Setup took ${Math.round(minutes)} minutes from Start to ready.`,
    readoutId: rid };
}

// The duplicate count Data health shows, from its own route.
async function healthDuplicates(call) {
  const r = await AC.call(call, "GET", "/data-health").catch(() => null);
  return Number(r && r.body && r.body.counts && r.body.counts.duplicates) || 0;
}

// ── UNDO ALL OF SETUP ───────────────────────────────────────────────────────
// The ledger, newest first. An import is reversed by its own route (which
// removes its gifts and the people it created); a row setup created is
// removed; a row it changed is put back to its before-image.
const UNDO_DELETE = new Set(["fin_funds", "email_templates", "audiences", "cultivation_templates", "campaigns", "setup_invites", "readouts"]);
async function undoAll(orgId, runId, call) {
  const r = await loadRun(orgId, runId);
  if (!r) return { ok: false, reason: "not_found" };
  if (r.status === "undone") return { ok: false, reason: "already_undone" };
  if (RUNNING.has(runId)) return { ok: false, reason: "still_running" };
  const writes = await query(`SELECT * FROM agent_writes WHERE org_id=? AND run_id=? AND undone_at IS NULL ORDER BY created_at DESC, id DESC`, [orgId, r.agent_run_id]);
  const done = [], kept = [];
  // Imports first: their gifts hold the funds the import created.
  const order = [...writes.filter(w => w.entity_table === "imports"), ...writes.filter(w => w.entity_table !== "imports")];
  for (const w of order) {
    const t = w.entity_table;
    let ok = false;
    try {
      if (t === "imports") {
        const x = await AC.call(call, "POST", `/imports/${w.entity_id}/reverse`, {});
        ok = x.status < 400 || (x.body && x.body.error === "already_reversed");
        if (!ok) kept.push({ table: t, id: w.entity_id, why: (x.body && (x.body.message || x.body.error)) || String(x.status) });
        // Anybody the file brought in that the reverse kept (a person held by
        // a row setup also made) goes with it: setup made them and nothing else did.
        if (ok) {
          await run(`DELETE FROM import_merges WHERE org_id=? AND import_id=?`, [orgId, w.entity_id]).catch(() => {});
          await run(`DELETE FROM donors d WHERE d.org_id=? AND d.created_import_id=? AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id=d.id)`, [orgId, w.entity_id]).catch(e => kept.push({ table: "donors", id: w.entity_id, why: e.code || e.message }));
        }
      } else if (t === "old_report_batches") {
        const x = await AC.call(call, "POST", `/old-reports/batches/${w.entity_id}/undo`, {});
        ok = x.status < 400;
        if (!ok) kept.push({ table: t, id: w.entity_id, why: (x.body && (x.body.sentence || x.body.error)) || String(x.status) });
      } else if (t === "orgs") {
        const before = j(w.before_row) || {};
        const cols = Object.keys(before).filter(c => ORG_COLS.includes(c));
        if (cols.length) await run(`UPDATE orgs SET ${cols.map(c => `${c}=?`).join(", ")} WHERE id=?`,
          [...cols.map(c => (c === "voice_samples" && before[c] != null ? JSON.stringify(before[c]) : before[c])), orgId]);
        ok = true;
      } else if (UNDO_DELETE.has(t)) {
        if (t === "fin_funds") {
          const [used] = await query(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=? AND fund_id=?`, [orgId, w.entity_id]);
          if (used.n) { kept.push({ table: t, id: w.entity_id, why: "gifts a person recorded use it" }); continue; }
          await run(`UPDATE orgs SET default_fund_id=NULL WHERE id=? AND default_fund_id=?`, [orgId, w.entity_id]).catch(() => {});
        }
        if (t === "cultivation_templates") await run(`DELETE FROM cultivation_plans WHERE org_id=? AND template_id=?`, [orgId, w.entity_id]).catch(() => {});
        if (t === "audiences") await run(`DELETE FROM group_members WHERE org_id=? AND group_id=?`, [orgId, w.entity_id]).catch(() => {});
        await run(`DELETE FROM ${t} WHERE id=? AND org_id=?`, [w.entity_id, orgId]);
        ok = true;
      }
    } catch (e) { kept.push({ table: t, id: w.entity_id, why: e.code || e.message }); }
    if (ok) {
      await run(`UPDATE agent_writes SET undone_at=NOW(), undone_by=?, undone_by_name=? WHERE id=? AND org_id=?`, [call.userId, call.userName || null, w.id, orgId]);
      done.push(t);
    }
  }
  await run(`UPDATE setup_runs SET status='undone', undone_at=NOW(), updated_at=NOW() WHERE id=? AND org_id=?`, [runId, orgId]);
  await run(`UPDATE orgs SET setup_started_at=NULL, setup_completed_at=NULL WHERE id=?`, [orgId]);
  const counts = done.reduce((m, t) => (m[t] = (m[t] || 0) + 1, m), {});
  return { ok: kept.length === 0, undone: done.length, counts, kept,
    sentence: kept.length ? `Undid ${plural(done.length, "change", "changes")}. ${plural(kept.length, "thing was", "things were")} kept because something else uses ${kept.length === 1 ? "it" : "them"}.`
      : `Undid all of setup: ${plural(done.length, "change", "changes")} put back. Your organization is as it was before setup.` };
}

// A run marked running that no process is working on (the server restarted
// mid-step) and whose heartbeat has gone quiet.
const STALE_MS = 60 * 1000;
function isOrphaned(r) {
  return !!r && r.status === "running" && !RUNNING.has(r.id)
    && (!r.heartbeat_at || Date.now() - new Date(r.heartbeat_at).getTime() > STALE_MS);
}

module.exports = { configure, ensureSchema, planRun, readSheets, fileFor, chosenSteps, CHOOSABLE, execute, undoAll, loadRun, isOrphaned, STEP_KEYS, TOOL_CARDS, TOOL_KEYS, ACTOR,
  buildQuestions, planSentences, TEMPLATE_THANKS, thankYouWords, fetchLogo };

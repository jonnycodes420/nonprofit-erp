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
//   * It never records money a person has not seen: the only gifts it writes
//     are the file's own history, through the one import route, after Start.
//   * AI writes sentences, never facts. Counts, cents, matches and mapping are
//     computed in code (shared/setupFiles.js, setupSite.js). With AI off every
//     step runs with the template sentences below.
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
const STEP_KEYS = ["read_site", "profile", "import", "funds", "groups", "templates", "journeys", "invites", "connections", "finish"];
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
async function storedFiles(orgId, runId) {
  return query(`SELECT name, body FROM setup_files WHERE org_id=? AND run_id=? ORDER BY created_at, id`, [orgId, runId]);
}

async function readFilesFor(orgId, runId, today) {
  const F = await filesMod();
  const files = await storedFiles(orgId, runId);
  const parsed = files.map(f => {
    const b = j(f.body);
    return b && b.records ? { name: f.name, records: b.records } : { name: f.name, text: b && b.text != null ? b.text : String(f.body) };
  });
  // FIX-43 Part 3: an old report (a giving summary, a LYBUNT list, a by-fund
  // table) is not gifts. It stays out of the import and is checked against
  // what the import brought in, by RECONCILE-1's own check.
  const reports = [], rest = [];
  for (const p of parsed) { const rep = oldReportIn(F, p); if (rep) reports.push(rep); else rest.push(p); }
  const read = F.readSetupFiles(rest, { anchorDate: today, currentYear: Number(String(today).slice(0, 4)) });
  read.oldReports = reports;
  for (const rep of reports) read.perFile.push({ name: rep.name, system: null, role: "old_report", evidence: rep.why, rows: rep.rows.length });
  return read;
}

// Is this file an old report, and if so its table and REPORTS-5's guess.
// A file the import reads as people or gifts stays an import file unless its
// own name or columns say it is a list about people (a LYBUNT, retention, top
// donors or board report), whose amounts are not gifts.
const LIST_KINDS = ["lybunt", "retention", "top_donors", "board_report", "grant_report"];
function oldReportIn(F, p) {
  const O = require("./oldReports");
  const text = p.text != null ? String(p.text) : csvFromRecords(p.records || []);
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
function csvFromRecords(records) {
  if (!records.length) return "";
  const hs = Object.keys(records[0]);
  return [hs, ...records.map(r => hs.map(h => r[h]))].map(r => r.map(csvCell).join(",")).join("\n");
}

// The questions a computer can't answer, each with a default already picked.
// Never more than about ten; the rest go under Later.
function buildQuestions({ siteRead, filesRead, thanksDefault, tools, fileTools }) {
  const qs = [];
  const add = (key, text, options, def, extra = {}) => qs.push({ key, text, options, default: def, ...extra });
  for (const sq of (siteRead && siteRead.questions) || []) {
    if (["ein", "address", "legalName"].includes(sq.key))
      add(sq.key, sq.text, sq.options || null, sq.options ? sq.options[0] : "", { kind: "text", receipt: true });
    else if (sq.key === "mission") add("mission", sq.text, null, "", { kind: "text" });
  }
  if (filesRead && filesRead.donors.length) {
    add("thanks", thanksDefault.sentence || "Have the gifts in these files been thanked already?",
      [{ value: "none", label: "Yes, they were thanked where they came from" }, { value: "all", label: "No, draft thank-yous for the recent ones" }],
      thanksDefault.mode, { kind: "choice" });
  }
  if (filesRead && filesRead.funds.length) {
    add("funds", `${plural(filesRead.funds.length, "column value looks", "column values look")} like funds: ${filesRead.funds.map(f => f.name).join(", ")}. Keep them as funds?`,
      [{ value: "keep", label: "Keep them as funds" }, { value: "general", label: "Put everything in General Operating" }], "keep", { kind: "choice" });
  }
  const unnamed = fileTools.filter(t => !tools.includes(t) && TOOL_CARDS[t] && TOOL_CARDS[t].focus);
  if (unnamed.length) {
    add("connect_from_file", `Your file says gifts came by ${unnamed.map(t => TOOL_CARDS[t].label).join(" and ")}. Get those connections ready?`,
      [{ value: "yes", label: "Yes, get them ready" }, { value: "no", label: "Not now" }], "yes", { kind: "choice" });
  }
  return { now: qs.slice(0, 10), later: qs.slice(10) };
}

function planSentences({ siteRead, filesRead, tools, fileTools, staff }) {
  const auto = [], prepared = [];
  if (siteRead && siteRead.ok) {
    const got = ["mission", "logoUrl", "brandPrimary", "address", "ein", "legalName"].filter(k => siteRead.facts[k]);
    auto.push({ step: "read_site", sentence: `Fill in your profile and branding from ${plural(siteRead.pagesRead.length, "page", "pages")} of your site (${got.length} of 6 details found).` });
  } else if (siteRead) auto.push({ step: "read_site", sentence: `Skip your website: ${siteRead.reason}.` });
  if (filesRead) {
    const sys = filesRead.systems.length ? filesRead.systems.join(" and ") : "your files";
    auto.push({ step: "import", sentence: `Import ${plural(filesRead.donors.length, "person", "people")} and ${plural(filesRead.gifts.length, "gift", "gifts")} (${dollars(filesRead.giftCents)}) from ${sys}, checked to the cent.` });
    if (filesRead.setAside.length) auto.push({ step: "import", sentence: `Leave out ${plural(filesRead.setAside.length, "row that was", "rows that were")} not money received, each listed with its reason.` });
    if (filesRead.funds.length) auto.push({ step: "funds", sentence: `Create ${plural(filesRead.funds.length, "fund", "funds")}, ordered by dollars: ${filesRead.funds.map(f => f.name).join(", ")}.` });
  }
  for (const rep of (filesRead && filesRead.oldReports) || [])
    auto.push({ step: "finish", sentence: `Check ${rep.name}, your old report, against what Steward has${rep.period ? ` for ${rep.period.label}` : ""}, and say where they agree.` });
  auto.push({ step: "groups", sentence: "Add the starter groups: first gift this year, gave last year but not yet this year, monthly givers and the top tenth by lifetime giving." });
  auto.push({ step: "templates", sentence: "Write a thank-you email and two variations in your words, as drafts for you to read." });
  auto.push({ step: "journeys", sentence: "Build three journeys, all paused: a new-donor welcome, a gone-quiet note and a card-failed note for monthly donors." });
  if (staff.length) prepared.push({ step: "invites", sentence: `Invitations for ${staff.map(s => s.name).join(", ")}, ready for you to send.` });
  const conn = [...new Set([...tools, ...fileTools])].filter(t => TOOL_CARDS[t] && TOOL_CARDS[t].focus);
  if (conn.length) prepared.push({ step: "connections", sentence: `Connections for ${conn.map(t => TOOL_CARDS[t].label).join(", ")}. Connecting is your click.` });
  prepared.push({ step: "receipts", sentence: "Your receipt with your legal name, address and EIN. Turning receipts on stays your decision." });
  return { auto, prepared };
}

// Build (or rebuild) a run's plan from what is stored. Writes only the run row.
async function planRun(orgId, runId, { today }) {
  const [r] = await query(`SELECT * FROM setup_runs WHERE id=? AND org_id=?`, [runId, orgId]);
  if (!r) return null;
  const F = await filesMod();
  const siteRead = r.site_url ? await site.readSite(r.site_url) : null;
  const filesRead = await readFilesFor(orgId, runId, today);
  const tools = (j(r.tools) || []).filter(t => TOOL_KEYS.includes(t));
  const fileTools = F.toolsFromMethods(filesRead.methods);
  const IT = require("./importThanks");
  const priorImports = (await query(`SELECT COUNT(*)::int AS n FROM imports WHERE org_id=? AND reversed_at IS NULL`, [orgId]))[0].n;
  const system = filesRead.systems.includes("Salesforce") ? "salesforce" : null;
  const thanksDefault = IT.defaultAnswer({ firstImport: priorImports === 0, system, count: filesRead.gifts.length });
  const users = new Set((await query(`SELECT lower(name) AS n FROM users WHERE org_id=? AND name IS NOT NULL`, [orgId])).map(u => u.n));
  const staff = (siteRead && siteRead.facts.staff ? siteRead.facts.staff.value : []).filter(p => !users.has(p.name.toLowerCase()));
  const questions = buildQuestions({ siteRead, filesRead, thanksDefault, tools, fileTools });
  const sentences = planSentences({ siteRead, filesRead, tools, fileTools, staff });
  const files = filesRead.perFile.map(p => ({ name: p.name, rows: p.rows, role: p.role,
    system: p.system ? p.system.label : null, evidence: p.evidence,
    because: p.system && p.system.signals.length ? `its columns ${p.system.signals.slice(0, 3).join(", ")}` : null }));
  const plan = { ...sentences, questions: questions.now, later: questions.later, files,
    counts: { donors: filesRead.donors.length, gifts: filesRead.gifts.length, giftCents: filesRead.giftCents,
      setAside: filesRead.setAside.length, funds: filesRead.funds.length },
    funds: filesRead.funds, setAside: filesRead.setAside, tools, fileTools, staff,
    giftAlone: filesRead.giftAlone };
  const answers = Object.fromEntries(questions.now.map(q => [q.key, q.default]));
  const siteStore = siteRead ? { ok: siteRead.ok, reason: siteRead.reason || null, pagesRead: siteRead.pagesRead, facts: siteRead.facts, questions: siteRead.questions } : null;
  await run(`UPDATE setup_runs SET site=?, files_read=?, plan=?, answers=?, updated_at=NOW() WHERE id=? AND org_id=?`,
    [JSON.stringify(siteStore), JSON.stringify(files), JSON.stringify(plan), JSON.stringify({ ...answers, ...(j(r.answers) || {}) }), runId, orgId]);
  return plan;
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

  async import(ctx) {
    // The run id is saved BEFORE the write, so a restart part-way through
    // never imports the same files twice: a retry that finds gifts carrying
    // this id finishes the bookkeeping instead of writing again.
    const existing = (ctx.run.steps.import || {}).importId;
    if (existing) {
      const [had] = await query(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=? AND import_id=?`, [ctx.orgId, existing]);
      if (had.n && ctx.run.steps.import.result) return ctx.run.steps.import.result;
      if (had.n) throw new Error("the import was interrupted after its write; open Imports to check it before running setup again");
    }
    const F = ctx.filesRead;
    if (!F.donors.length) {
      if (F.giftAlone) return { sentence: `${plural(F.giftAloneCount, "gift", "gifts")} in a file with no people in it. Open Import to link them to your records.`, prepared: true };
      return { sentence: "No donor file was given, so nothing was imported.", skipped: true };
    }
    const keepFunds = (ctx.run.answers || {}).funds !== "general";
    const gifts = F.gifts.map(g => keepFunds ? g : { ...g, fund: "" });
    const donors = F.donors.map(({ _line, _freqMonthlyClaim, _staleChargeClaim, staleFrequency, address1, ...d }) => d);
    const importId = "imp_" + uuid().replace(/-/g, "").slice(0, 16);
    ctx.run.steps.import = { ...(ctx.run.steps.import || {}), importId };
    await saveSteps(ctx.orgId, ctx.runId, ctx.run.steps);
    const mode = (ctx.run.answers || {}).thanks === "all" ? "all" : "none";
    const t0 = Date.now();
    const before = await idsOf(ctx.orgId);
    // A gifts-only file's people were grouped the Import screen's way, and go
    // in the way that screen sends them (no identityResolved: the combined
    // import's own email match against people already on file applies).
    const res = await AC.call(ctx.call, "POST", "/donors/import-combined", { donors, gifts, identityResolved: !F.fromGiftFile, importId,
      thanks: { mode }, headers: F.headers });
    if (res.status >= 400) throw new Error("the import was refused: " + ((res.body && (res.body.message || res.body.error)) || res.status));
    const sem = await AC.call(ctx.call, "POST", "/donors/import-semantics", {
      pledges: (F.pledges.pledges || []).map(p => ({ donorExternalId: p.donorExternalId, amount: p.amount, date: p.date, externalId: p.externalId, status: p.status })),
      merges: (F.merges || []).map(m => ({ surviving: m.surviving, survivingEmail: m.survivingEmail || "", folded: m.folded })),
    });
    const rec = (res.body && res.body.reconciliation) || {};
    const rows = rec.rows || {}, dol = rec.dollars || {};
    const names = ctx.filesRead.perFile.map(p => p.name).join(" + ");
    const recd = await AC.call(ctx.call, "POST", "/imports", {
      id: importId, name: "Setup: " + names, sourceFilename: names, shape: "gift_file_with_donors",
      migrationSource: F.systems.includes("Salesforce") ? "salesforce" : undefined,
      startedAt: new Date(t0).toISOString(), thanks: { mode },
      summary: { giftsCreated: Number(rows.created) || 0, donorsCreated: Number(res.body.created) || 0,
        rowsSetAside: (Number(rows.skipped) || 0) + F.setAside.length, rowsErrored: Number(rows.errored) || 0,
        dollarsIn: Number(dol.inFile) || 0, dollarsCreated: Number(dol.created) || 0,
        dollarsSetAside: Number(dol.skipped) || 0, dollarsErrored: Number(dol.errored) || 0,
        duplicates: Number(res.body.duplicates) || 0, donorsMatched: Number(res.body.donorsMatched) || 0,
        leadSentence: `Imported by setup from ${names}.`, setAsideBeforeImport: F.setAside },
    });
    await ledger(ctx, { tool: "setup_import", table: "imports", entityId: importId, before: null, after: { id: importId } });
    // "Ready" means the import's own work is finished too: its recent-gift job
    // and the readout it writes. Without this wait that readout lands AFTER
    // "Steward is ready" and takes its place on Home (the walk caught it).
    await importWorkDone(ctx.orgId, importId);
    await ledgerNew(ctx, "setup_import", before);
    // Read back from the database, never from what was sent.
    const [back] = await query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(ROUND(amount*100)),0)::bigint AS cents FROM gifts WHERE org_id=? AND import_id=?`, [ctx.orgId, importId]);
    const [people] = await query(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=? AND created_import_id=?`, [ctx.orgId, importId]);
    const backCents = Number(back.cents);
    const footed = backCents === F.giftCents;
    const result = {
      importId, recorded: recd.status < 400,
      donors: people.n, gifts: back.n, cents: backCents, fileCents: F.giftCents, footed,
      setAside: F.setAside, semantics: sem.status < 400,
      sentence: `Imported ${plural(people.n, "person", "people")} and ${plural(back.n, "gift", "gifts")} (${dollars(backCents)}), `
        + (footed ? "to the cent of what your files hold." : `which is ${dollars(Math.abs(F.giftCents - backCents))} ${backCents < F.giftCents ? "less" : "more"} than your files hold; the import's own record lists every row.`)
        + (F.setAside.length ? ` ${plural(F.setAside.length, "row was", "rows were")} left out because ${F.setAside.length === 1 ? "it was" : "they were"} not money received (${[...new Set(F.setAside.map(s => s.stage))].join(", ")}).` : ""),
    };
    ctx.run.steps.import = { ...(ctx.run.steps.import || {}), importId, result };
    return result;
  },

  async funds(ctx) {
    const F = ctx.filesRead;
    if (!F.funds.length) return { sentence: "Your files name no funds, so gifts sit in General Operating.", skipped: true };
    if ((ctx.run.answers || {}).funds === "general") return { sentence: "Every gift went to General Operating, as you asked." };
    const have = await query(`SELECT f.id, f.name, COALESCE(SUM(ROUND(g.amount*100)),0)::bigint AS cents
        FROM fin_funds f LEFT JOIN gifts g ON g.org_id=f.org_id AND g.fund_id=f.id WHERE f.org_id=? GROUP BY f.id, f.name`, [ctx.orgId]);
    const byName = new Map(have.map(h => [h.name.toLowerCase(), h]));
    const before = await idsOf(ctx.orgId);
    for (const f of F.funds) {
      if (byName.has(f.name.toLowerCase())) continue;
      await AC.call(ctx.call, "POST", "/finance/funds", { name: f.name, restricted: false });
    }
    await ledgerNew(ctx, "setup_funds", before);
    const ordered = F.funds.map(f => `${f.name} ${dollars(f.cents)}`);
    return { sentence: `Your funds, by dollars: ${ordered.join(", ")}.`, rows: F.funds };
  },

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
    for (const rep of ctx.filesRead.oldReports || []) {
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

const IMPORT_WAIT_MS = 10 * 60 * 1000;
async function importWorkDone(orgId, importId) {
  const until = Date.now() + IMPORT_WAIT_MS;
  while (Date.now() < until) {
    const [job] = await query(`SELECT status, finished_at FROM import_recent_jobs WHERE import_id=? AND org_id=?`, [importId, orgId]);
    const settled = !job || (job.status !== "running" && !!job.finished_at);
    if (settled) {
      const [ro] = await query(`SELECT 1 AS x FROM readouts WHERE org_id=? AND source_kind='import' AND source_id=?`, [orgId, importId]);
      const [g] = await query(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=? AND import_id=?`, [orgId, importId]);
      if (ro || !g.n || !job) return true;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

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
      agentRunId: r.agent_run_id, instructionId: r.instruction_id, today, filesRead: await readFilesFor(orgId, runId, today) };
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
  const imp = res("import");
  push("import", imp.sentence, imp.importId ? { kind: "import", id: imp.importId } : null);
  push("profile", res("profile").sentence, { kind: "settings", section: "org" });
  push("funds", res("funds").sentence, { kind: "settings", section: "giving" });
  push("groups", res("groups").sentence, { kind: "tab", tab: "groups" });
  push("templates", res("templates").sentence, { kind: "tab", tab: "templates" });
  push("journeys", res("journeys").sentence, { kind: "settings", section: "journeys" });
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
  const headline = imp.donors ? `Imported ${plural(imp.donors, "person", "people")} and ${plural(imp.gifts, "gift", "gifts")}${imp.footed ? ", checked to the cent" : ""}.` : "Steward is set up.";
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

module.exports = { configure, ensureSchema, planRun, execute, undoAll, loadRun, isOrphaned, STEP_KEYS, TOOL_CARDS, TOOL_KEYS, ACTOR,
  buildQuestions, planSentences, TEMPLATE_THANKS, thankYouWords, fetchLogo };

// routes/prospect.js — PROSPECT-1. ROOM TO GIVE.
//
//   GET    /donors/:id/room-to-give          the word and its reasons for one person
//   GET    /prospects/room-to-give           every person's word, for the Donors column
//   POST   /screening/preview                how many people, and which fields, would leave
//   POST   /screening/file                   the file itself (CSV download)
//   POST   /screening/import/preview         the returned file's headers, for the column mapper
//   POST   /screening/import                 bring the results in; unmatched rows are listed
//   DELETE /donors/:id/screening             one person's screening rows
//   DELETE /screening                        the whole organisation's (admin)
//   GET    /donors/:id/public-filing         the public filing as last looked up (never calls out)
//   POST   /donors/:id/public-filing/refresh look it up in the loaded IRS file (irs_bmf), never the network
//   POST   /donors/:id/prospect-brief        the Researcher's one-page brief, saved to their files
//   PUT    /org/users/:id/major-gifts        an admin gives or takes the permission
//
// Every one of them is for admins and staff with the major gifts permission,
// read live (prospect.canSee). Every write is recorded by the one audit write
// (middleware/auditTrail.js); nothing here writes an audit row. Nothing here
// sends anything to anybody.
"use strict";
const express = require("express");
const P = require("../prospect");

const routers = { r0: express.Router() };

function mount(ctx) {
const { query, run, wrap, requireAuth, requireAdmin, checkWriteAccess, uuid } = ctx;
const app = routers.r0;
const mg = P.requireMajorGifts(wrap);
const newId = p => `${p}_${uuid().replace(/-/g, "").slice(0, 16)}`;
async function actor(req) {
  const [u] = await query(`SELECT name FROM users WHERE id = ?`, [req.user.userId]);
  return { id: req.user.userId, name: (u && u.name) || null };
}
async function donorRow(orgId, id) {
  const [d] = await query(`SELECT id, name, kind, funder_ein, person_types FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [id, orgId]);
  return d || null;
}
const isOrg = d => d && (d.kind === "organisation" || (Array.isArray(d.person_types) && d.person_types.includes("organization")));

// ── Room to give ────────────────────────────────────────────────────────────
app.get("/donors/:id/room-to-give", requireAuth, mg, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const d = await donorRow(orgId, req.params.id);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const a = (await P.roomToGive(orgId, [d.id])).get(d.id);
  const own = { key: "donor-lifetime", params: { donor: d.id } };
  res.json({ donorId: d.id, word: a.word, label: a.label, annualCents: a.annualCents,
    reasons: a.reasons.map(r => ({ key: r.key, text: r.text, screening: !!r.screening, source: r.screening ? null : own })),
    screening: a.screening || null, screeningMoved: a.screeningMoved });
}));

app.get("/prospects/room-to-give", requireAuth, mg, wrap(async (req, res) => {
  const all = await P.roomToGive(req.user.orgId);
  const donors = {};
  for (const [id, a] of all) donors[id] = { word: a.word, label: a.label, rank: a.rank };
  res.json({ donors });
}));

// ── The screening file, out ─────────────────────────────────────────────────
async function chosen(req) {
  const orgId = req.user.orgId;
  const b = req.body || {};
  if (b.groupId) {
    const G = require("../groups");
    const g = await G.groupById(orgId, String(b.groupId));
    if (!g) return null;
    return G.memberIds(orgId, g);
  }
  return Array.isArray(b.donorIds) ? b.donorIds.map(String).slice(0, 25000) : [];
}
app.post("/screening/preview", requireAuth, mg, wrap(async (req, res) => {
  const ids = await chosen(req);
  if (!ids) return res.status(404).json({ error: "That group was not found." });
  res.json(P.filePreview(await P.fileRows(req.user.orgId, ids)));
}));
app.post("/screening/file", requireAuth, mg, wrap(async (req, res) => {
  const ids = await chosen(req);
  if (!ids) return res.status(404).json({ error: "That group was not found." });
  const rows = await P.fileRows(req.user.orgId, ids);
  if (!rows.length) return res.status(400).json({ error: "Nobody to put in the file. Organisations and erased people are never sent." });
  if (req.audit) req.audit.summary(`Prepared a screening file of ${rows.length} ${rows.length === 1 ? "person" : "people"}`, { count: rows.length, entityType: "donor" });
  const day = await P.today(req.user.orgId);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="screening-file-${day}.csv"`);
  res.send("﻿" + P.fileCsv(rows));
}));

// ── The screening file, back ────────────────────────────────────────────────
const MAX_CSV = 5 * 1024 * 1024;
app.post("/screening/import/preview", requireAuth, mg, wrap(async (req, res) => {
  const csv = String((req.body || {}).csv || "");
  if (!csv.trim()) return res.status(400).json({ error: "The file is empty." });
  if (csv.length > MAX_CSV) return res.status(400).json({ error: "The file is larger than 5 MB. Split it and bring it in twice." });
  const { headers, rows } = await P.parseCsv(csv);
  res.json({ headers, standardFields: P.RESULT_FIELDS.map(f => ({ key: f.key, label: f.label })), proposal: Object.fromEntries(
    Object.entries(P.proposeMapping(headers)).map(([h, k]) => [h, k === "ignore" ? "ignore" : `std:${k}`])),
    rowCount: rows.length, sample: rows.slice(0, 3) });
}));

app.post("/screening/import", requireAuth, checkWriteAccess, mg, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const b = req.body || {};
  const provider = String(b.provider || "").trim().slice(0, 120);
  const screenedOn = String(b.screenedOn || "").trim();
  if (!provider) return res.status(400).json({ error: "Say which provider screened the file, so every result names its source." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(screenedOn) || Number.isNaN(Date.parse(screenedOn))) return res.status(400).json({ error: "Give the date the file was screened, as a date." });
  const csv = String(b.csv || "");
  if (!csv.trim()) return res.status(400).json({ error: "The file is empty." });
  if (csv.length > MAX_CSV) return res.status(400).json({ error: "The file is larger than 5 MB." });
  const mapping = {};
  for (const [h, k] of Object.entries(b.mapping || {})) mapping[h] = String(k || "ignore").replace(/^std:/, "");
  const mapped = new Set(Object.values(mapping));
  if (!mapped.has("steward_id") && !mapped.has("email") && !(mapped.has("zip") && (mapped.has("name") || mapped.has("last_name")))) {
    return res.status(400).json({ error: "Map the Steward ID, the email, or the name and ZIP, so each row can be matched to one person." });
  }
  if (![...mapped].some(k => /capacity|real_estate|other_gifts|foundation|business/.test(k))) {
    return res.status(400).json({ error: "Map at least one result column (capacity, real estate, other gifts, foundation ties or business affiliations)." });
  }
  const { rows } = await P.parseCsv(csv);
  const read = rows.map(r => P.readRow(r, mapping));
  const matched = await P.matchRows(orgId, read);
  const who = await actor(req);
  const importId = newId("scr");
  const ok = matched.filter(m => m.donorId);
  const unmatched = matched.filter(m => !m.donorId).map(m => ({ row: m.line, name: m.name, email: m.email, why: m.why }));
  const before = await P.roomToGive(orgId, ok.map(m => m.donorId));
  await run(`INSERT INTO screening_imports (id, org_id, provider, screened_on, filename, rows_in, matched, unmatched, created_by, created_by_name)
             VALUES (?,?,?,?,?,?,?,?::jsonb,?,?)`,
    [importId, orgId, provider, screenedOn, String(b.fileName || "").slice(0, 200) || null, rows.length, ok.length, JSON.stringify(unmatched), who.id, who.name]);
  for (const m of ok) {
    // One provider's latest screening per person: a re-run replaces it.
    await run(`DELETE FROM screening_results WHERE org_id = ? AND donor_id = ? AND lower(provider) = lower(?)`, [orgId, m.donorId, provider]);
    await run(`INSERT INTO screening_results (id, org_id, donor_id, import_id, provider, screened_on, capacity_low_cents, capacity_high_cents,
                 real_estate_low_cents, real_estate_high_cents, other_gifts, foundation_ties, business_affiliations, created_by, created_by_name)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [newId("scrr"), orgId, m.donorId, importId, provider, screenedOn, m.capacityLowCents, m.capacityHighCents,
        m.realEstateLowCents, m.realEstateHighCents, m.otherGifts, m.foundationTies, m.businessAffiliations, who.id, who.name]);
  }
  const after = await P.roomToGive(orgId, ok.map(m => m.donorId));
  const names = new Map(ok.length ? (await query(`SELECT id, name FROM donors WHERE org_id = ? AND id = ANY(?)`, [orgId, ok.map(m => m.donorId)])).map(r => [r.id, r.name]) : []);
  const strongNow = ok.filter(m => after.get(m.donorId).word === "strong" && before.get(m.donorId).word !== "strong")
    .map(m => ({ donorId: m.donorId, name: names.get(m.donorId) || m.name }));
  if (req.audit) req.audit.summary(`Brought in ${provider}'s screening file: ${ok.length} matched, ${unmatched.length} not matched`, { count: ok.length, entityType: "screening result" });
  res.json({ importId, provider, screenedOn, rows: rows.length, matched: ok.length, unmatched, strongNow });
}));

app.delete("/donors/:id/screening", requireAuth, mg, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const d = await donorRow(orgId, req.params.id);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const [{ n }] = await query(`SELECT COUNT(*)::int AS n FROM screening_results WHERE org_id = ? AND donor_id = ?`, [orgId, d.id]);
  await run(`DELETE FROM screening_results WHERE org_id = ? AND donor_id = ?`, [orgId, d.id]);
  if (req.audit) { req.audit.entity("donor", d.id, d.name); req.audit.summary(`Deleted ${n} screening ${n === 1 ? "result" : "results"} for one person`, { count: n }); }
  res.json({ deleted: n });
}));
app.delete("/screening", requireAuth, requireAdmin, mg, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [{ n }] = await query(`SELECT COUNT(*)::int AS n FROM screening_results WHERE org_id = ?`, [orgId]);
  await run(`DELETE FROM screening_results WHERE org_id = ?`, [orgId]);
  if (req.audit) req.audit.summary(`Deleted every screening result for the organisation (${n})`, { count: n, entityType: "screening result" });
  res.json({ deleted: n });
}));

// ── Public filings ──────────────────────────────────────────────────────────
app.get("/donors/:id/public-filing", requireAuth, mg, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const d = await donorRow(orgId, req.params.id);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const [r] = await query(`SELECT * FROM public_filings WHERE org_id = ? AND donor_id = ? AND source_date IS NOT NULL`, [orgId, d.id]);
  res.json({ ein: d.funder_ein ? P.cleanEin(d.funder_ein) : null, isOrganization: isOrg(d), filing: r && r.found ? P.shapeFiling(r) : null,
    notFound: r && !r.found ? { ein: r.ein, fetchedAt: r.fetched_at, source: P.sourceLine(r.source_date) } : null });
}));
// Reads irs_bmf (loaded by scripts/load-irs-bmf.js) and records what it found
// on the person. Nothing here reaches the network.
app.post("/donors/:id/public-filing/refresh", requireAuth, checkWriteAccess, mg, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const d = await donorRow(orgId, req.params.id);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const ein = P.cleanEin(d.funder_ein);
  if (!ein) return res.status(400).json({ error: "Add the organisation's EIN to its record first." });
  const got = await P.lookupFiling(ein);
  if (got.error) return res.status(400).json({ error: got.error });
  if (got.notLoaded) return res.json({ ein, notLoaded: true, message: got.message, filing: null, notFound: null });
  const who = await actor(req);
  const f = got.filing;
  await run(`INSERT INTO public_filings (org_id, donor_id, ein, name, total_assets_cents, grants_paid_cents, revenue_cents, income_cents, tax_year, tax_period,
               form, filing_url, source_url, source_file, source_date, found, fetched_at, created_by, created_by_name)
             VALUES (?,?,?,?,?,NULL,?,?,?,?,NULL,NULL,?,?,?::date,?,NOW(),?,?)
             ON CONFLICT (org_id, donor_id) DO UPDATE SET ein = EXCLUDED.ein, name = EXCLUDED.name, total_assets_cents = EXCLUDED.total_assets_cents,
               grants_paid_cents = NULL, revenue_cents = EXCLUDED.revenue_cents, income_cents = EXCLUDED.income_cents, tax_year = EXCLUDED.tax_year,
               tax_period = EXCLUDED.tax_period, form = NULL, filing_url = NULL, source_url = EXCLUDED.source_url, source_file = EXCLUDED.source_file,
               source_date = EXCLUDED.source_date, found = EXCLUDED.found, fetched_at = NOW(), created_by = EXCLUDED.created_by, created_by_name = EXCLUDED.created_by_name`,
    [orgId, d.id, ein, f ? f.name : null, f ? f.totalAssetsCents : null, f ? f.revenueCents : null, f ? f.incomeCents : null,
      f ? f.taxYear : null, f ? f.taxPeriod : null, P.BMF_PAGE, f ? f.sourceFile : null, f ? f.sourceDate : got.sourceDate, !!f, who.id, who.name]);
  const [r] = await query(`SELECT * FROM public_filings WHERE org_id = ? AND donor_id = ?`, [orgId, d.id]);
  res.json({ ein, filing: r.found ? P.shapeFiling(r) : null, notFound: r.found ? null : { ein, fetchedAt: r.fetched_at, source: P.sourceLine(r.source_date) } });
}));

// ── The Researcher's prospect brief ─────────────────────────────────────────
app.post("/donors/:id/prospect-brief", requireAuth, checkWriteAccess, mg, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const d = await donorRow(orgId, req.params.id);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const B = require("../prospectBrief");
  const brief = await B.build(orgId, d.id);
  const who = await actor(req);
  const id = "mat_" + uuid().replace(/-/g, "").slice(0, 12);
  const text = B.toText(brief);
  await run(`INSERT INTO donor_materials (id, org_id, donor_id, file_name, file_type, file_data, notes, uploaded_by, major_gifts_only)
             VALUES (?,?,?,?,?,?,?,?,true)`,
    [id, orgId, d.id, brief.fileName, "text/plain", Buffer.from(text, "utf8").toString("base64"),
      "Prospect brief drafted by the Researcher from Steward's own record, the screening results and the public filing only. Never sent.", who.name || ""]);
  if (req.audit) { req.audit.entity("donor", d.id, d.name); req.audit.summary("Researcher drafted a prospect brief and saved it to the person's files"); }
  res.status(201).json({ materialId: id, fileName: brief.fileName, brief });
}));

// ── The permission ──────────────────────────────────────────────────────────
app.put("/org/users/:id/major-gifts", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [u] = await query(`SELECT id, role FROM users WHERE id = ? AND org_id = ? AND deactivated_at IS NULL`, [req.params.id, orgId]);
  if (!u) return res.status(404).json({ error: "Not found" });
  const on = !!(req.body || {}).on;
  await run(`UPDATE users SET can_major_gifts = ? WHERE id = ? AND org_id = ?`, [on, u.id, orgId]);
  res.json({ id: u.id, canMajorGifts: u.role === "admin" ? true : on });
}));
}

module.exports = { routers, mount };

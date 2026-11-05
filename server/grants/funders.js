// server/grants/funders.js — funders, grant documents and outlines, and programs.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const { requireAuth404 } = require("../../auth");   // FIX-20 Part 0: the file doors
const { fileLimiter } = require("../shared/fileLimiter");   // one limiter, shared by the two file doors
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex
const FL = require("./funderLink");   // GRANTS-FIX: the one resolver of a grant's funder

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  ASSET_ID_RE, OU, actor, checkWriteAccess, getThemeAsset, grantDocRow, grantDocs, grantImportMod, grantRow,
  grantShapeMod, orgFundNamesG, orgOfficerNames, parseMoneyOrThrow, query, requireAdmin, requireAuth,
  requireCrm, run, toCents, toDollars, uuid, wrap,
} = ctx;

// THE ONE PLACE A FUNDER IS RESOLVED, and the one place a person is refused.
// A grant is an institutional relationship; a cheque from a private individual
// is a GIFT. Calling it a grant puts it in the wrong half of every report an
// auditor reads, which is why this is a refusal and not a warning.
async function resolveFunder(orgId, funderDonorId) {
  const G = await grantShapeMod();
  const [d] = await query(
    "SELECT id, name, kind, funder_type, funder_ein FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL",
    [funderDonorId, orgId]);
  const problem = G.funderProblem(d);
  if (problem) return { ok: false, problem };
  return { ok: true, funder: d };
}
let app = routers.r1;

// GET /funders — the organisations this org has asked, with what they have
// given and what is open. A funder with no grants yet is still a funder.
app.get("/funders", requireAuth, wrap(async (req, res) => {
  const G = await grantShapeMod();
  const orgId = req.user.orgId;
  const rows = await query(
    `SELECT d.id, d.name, d.funder_type, d.email, d.city, d.state, d.total_giving,
            COUNT(g.id)::int AS grant_count,
            COALESCE(SUM(CASE WHEN g.status = ANY(?::text[]) THEN COALESCE(g.amount_requested, g.amount) END),0) AS open_requested,
            COALESCE(SUM(CASE WHEN g.status IN ('awarded','reporting','closed') THEN COALESCE(g.amount_awarded, g.amount) END),0) AS awarded_total
       FROM donors d
       LEFT JOIN grants g ON g.funder_donor_id = d.id AND g.org_id = d.org_id AND g.is_sample IS NOT TRUE
      WHERE d.org_id=? AND d.deleted_at IS NULL AND LOWER(COALESCE(d.kind,'person')) IN ('organisation','organization')
        AND (d.funder_type IS NOT NULL OR g.id IS NOT NULL)
      GROUP BY d.id, d.name, d.funder_type, d.email, d.city, d.state, d.total_giving
      ORDER BY d.name`,
    [G.OPEN_STATUS_KEYS.concat(Object.keys(G.STATUS_ALIASES).filter(a => G.STATUS_ALIASES[a] && G.OPEN_STATUS_KEYS.includes(G.STATUS_ALIASES[a]))), orgId]);
  res.json({
    funders: rows.map(r => ({
      funderId: r.id, name: r.name, funderType: r.funder_type || null,
      funderTypeLabel: G.funderTypeLabel(r.funder_type), email: r.email || null,
      city: r.city || null, state: r.state || null,
      grantCount: r.grant_count,
      openRequested: toDollars(toCents(r.open_requested) || 0),
      awardedTotal: toDollars(toCents(r.awarded_total) || 0),
      lifetimeGiving: toDollars(toCents(r.total_giving) || 0),
    })),
    funderTypes: G.FUNDER_TYPES,
  });
}));

// PUT /funders/:donorId — say what kind of funder an organisation is. It lives
// on the FUNDER because the Sunrise Foundation is a private foundation across
// every grant it ever makes; per-grant storage would let two rows disagree.
app.put("/funders/:donorId", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const G = await grantShapeMod();
  const r = await resolveFunder(req.user.orgId, req.params.donorId);
  if (!r.ok) {
    const code = r.problem.code === "funder_not_found" ? 404 : 400;
    return res.status(code).json({ error: r.problem.message, code: r.problem.code });
  }
  // BUILD-100 Part 6 FIX — an ABSENT funderType leaves it alone. The first cut
  // read `String(req.body.funderType || "")` whether the key was there or not,
  // so a body carrying only an EIN was refused for a bad funder type: a route
  // that cannot be called with one field is not a route somebody can use.
  const hasType = Object.prototype.hasOwnProperty.call(req.body, "funderType");
  const t = !hasType ? undefined
    : (req.body.funderType === null || req.body.funderType === "" ? null : String(req.body.funderType));
  if (t !== undefined && t !== null && !G.FUNDER_TYPE_KEYS.includes(t)) {
    return res.status(400).json({ error: `Funder type must be one of: ${G.FUNDER_TYPES.map(x => x.label).join(", ")}.`, code: "bad_funder_type" });
  }
  // BUILD-100 Part 6 — the EIN, if they have it. Nine digits or nothing: a
  // half-typed tax id that still matched on a prefix would be worse than none.
  const I = await grantImportMod();
  let ein;
  if (Object.prototype.hasOwnProperty.call(req.body, "ein")) {
    const raw = req.body.ein;
    if (raw === null || String(raw).trim() === "") ein = null;
    else {
      ein = I.normalizeEin(raw);
      if (!ein) return res.status(400).json({ code: "bad_ein",
        error: "An EIN is nine digits, written 12-3456789. Leave it blank if you do not have it." });
    }
  }
  if (t !== undefined) {
    await run("UPDATE donors SET funder_type=?, updated_at=NOW() WHERE id=? AND org_id=?", [t, r.funder.id, req.user.orgId]);
  }
  if (ein !== undefined) {
    // The partial unique index is the arbiter: two records claiming one EIN is a
    // duplicate to merge, and the route says so rather than swallowing 23505.
    try {
      await run("UPDATE donors SET funder_ein=?, updated_at=NOW() WHERE id=? AND org_id=?", [ein, r.funder.id, req.user.orgId]);
    } catch (e) {
      if (String(e.code) === "23505") {
        const [dup] = await query("SELECT name FROM donors WHERE org_id=? AND funder_ein=? AND deleted_at IS NULL",
          [req.user.orgId, ein]);
        return res.status(409).json({ code: "ein_already_on_file",
          error: `${(dup && dup.name) || "Another record"} already carries that EIN. If they are the same funder, merge the two records.` });
      }
      throw e;
    }
  }
  const [after] = await query("SELECT funder_type, funder_ein FROM donors WHERE id=? AND org_id=?", [r.funder.id, req.user.orgId]);
  const type = (after && after.funder_type) || null;
  res.json({ funderId: r.funder.id, name: r.funder.name, funderType: type, funderTypeLabel: G.funderTypeLabel(type),
             ein: (after && after.funder_ein) || null });
}));

// GET /funders/:donorId/grants — a funder's own record: every grant, in order.
app.get("/funders/:donorId/grants", requireAuth, wrap(async (req, res) => {
  const G = await grantShapeMod();
  const r = await resolveFunder(req.user.orgId, req.params.donorId);
  if (!r.ok) {
    const code = r.problem.code === "funder_not_found" ? 404 : 400;
    return res.status(code).json({ error: r.problem.message, code: r.problem.code });
  }
  const funds = await orgFundNamesG(req.user.orgId);
  const officers = await orgOfficerNames(req.user.orgId);
  const rows = await query(
    `SELECT g.*, d.name AS funder_name, d.funder_type
       FROM grants g JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id
      WHERE g.org_id=? AND g.funder_donor_id=? ORDER BY g.created_at DESC`,
    [req.user.orgId, r.funder.id]);
  const grants = rows.map(x => grantRow({ ...x, status_canonical: G.normalizeStatus(x.status) }, { funds, officers }));
  res.json({
    funder: { funderId: r.funder.id, name: r.funder.name, funderType: r.funder.funder_type || null,
              funderTypeLabel: G.funderTypeLabel(r.funder.funder_type), ein: r.funder.funder_ein || null },
    grants,
    statuses: G.GRANT_STATUSES, restrictions: G.RESTRICTIONS, declineReasons: G.DECLINE_REASONS,
  });
}));

// POST /funders/:donorId/grants — one request to one funder.
app.post("/funders/:donorId/grants", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const G = await grantShapeMod();
  const orgId = req.user.orgId;
  const fr = await resolveFunder(orgId, req.params.donorId);
  if (!fr.ok) {
    const code = fr.problem.code === "funder_not_found" ? 404 : 400;
    return res.status(code).json({ error: fr.problem.message, code: fr.problem.code });
  }
  let reqCents;
  try { reqCents = parseMoneyOrThrow(req.body.amountRequested, "amountRequested"); }
  catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }

  const status = G.normalizeStatus(req.body.status || "researching") || String(req.body.status || "");
  if (G.AWARDED_STATUS_KEYS.includes(status)) {
    return res.status(400).json({ code: "award_required", error: "award_required",
      sentence: "Add the grant at the stage it was in before the yes, then record the award, so the pledge goes on the funder." });
  }
  const v = G.validateGrant({
    program: req.body.program, amountRequestedCents: reqCents, status,
    restriction: req.body.restriction, restrictedFrom: req.body.restrictedFrom,
    restrictedUntil: req.body.restrictedUntil,
  }, { mode: "create" });
  if (!v.ok) return res.status(400).json({ error: v.errors[0].message, code: "invalid_grant", errors: v.errors });

  const fund = await checkGrantFund(orgId, req.body.fundId || null);
  if (!fund.ok) return res.status(404).json({ error: "Fund not found" });
  const officer = await checkGrantOfficer(orgId, req.body.officerId || null);
  if (!officer.ok) return OU.refuse(res, "officerId");

  const id = newId("gr");
  await run(
    `INSERT INTO grants (id,org_id,funder,funder_donor_id,program,amount,amount_requested,status,
                         restriction,restricted_from,restricted_until,fund_id,cycle_name,officer_id,officer,
                         notes,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, orgId, fr.funder.name, fr.funder.id, G.sanitizeProgram(req.body.program),
     toDollars(reqCents), toDollars(reqCents), status,
     req.body.restriction || null, req.body.restrictedFrom || null, req.body.restrictedUntil || null,
     fund.fundId, G.sanitizeCycle(req.body.cycleName), officer.officerId, officer.officerName || "",
     G.sanitizeNotes(req.body.notes), actor(req).id, actor(req).name]);
  const [row] = await query(
    `SELECT g.*, d.name AS funder_name, d.funder_type FROM grants g
       JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id WHERE g.id=?`, [id]);
  res.status(201).json(grantRow({ ...row, status_canonical: G.normalizeStatus(row.status) },
    { funds: await orgFundNamesG(orgId), officers: await orgOfficerNames(orgId) }));
}));

// ── GRANTS-FIX · LINK A GRANT TO ITS FUNDER ─────────────────────────────────
// GET /grants/:id/funder-search?q= — the picker: the org's organizations by
// name, then EIN, the exact-name match first. With no q it searches the
// grant's own typed name, so the likely record is the first thing shown.
app.get("/grants/:id/funder-search", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [g] = await query("SELECT id, funder, funder_donor_id FROM grants WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!g) return res.status(404).json({ error: "Grant not found" });
  const text = req.query.q !== undefined ? String(req.query.q).slice(0, 200) : (g.funder || "");
  const results = await FL.searchFunderOrgs({ q: query, r: run }, orgId, text);
  const typed = text.trim().replace(/\s+/g, " ");
  res.json({ grantId: g.id, typedName: g.funder || "", linkedId: g.funder_donor_id || null, q: text, results,
    canCreate: !!typed && !results.some(x => x.exact), createName: typed });
}));

// POST /grants/:id/funder-link { donorId } | { createName } — set the grant's
// funder record. Picking keeps the typed name on the grant and never renames
// the record; createName adds an organization (funder type unset) first.
app.post("/grants/:id/funder-link", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [g] = await query("SELECT id, funder, funder_donor_id FROM grants WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!g) return res.status(404).json({ error: "Grant not found" });
  const db = { q: query, r: run };
  let donorId = req.body && req.body.donorId ? String(req.body.donorId) : null, created = false;
  if (!donorId) {
    const name = String((req.body && req.body.createName) || "").trim().replace(/\s+/g, " ").slice(0, 200);
    if (!name) return res.status(400).json({ error: "Choose a funder, or type the name of a new one." });
    const p = await FL.planFunder(db, orgId, name);
    if (p.action === "link") donorId = p.donorId;     // already on file: link it, never a second record
    else {
      donorId = await FL.createFunderOrg(db, orgId, name, actor(req));
      created = true;
    }
  }
  const fr = await resolveFunder(orgId, donorId);
  if (!fr.ok) {
    const code = fr.problem.code === "funder_not_found" ? 404 : 400;
    return res.status(code).json({ error: fr.problem.message, code: fr.problem.code });
  }
  await FL.linkGrant(db, orgId, g.id, fr.funder.id);
  if (req.audit) {
    req.audit.entity("grant", g.id); req.audit.action("linked funder");
    req.audit.before({ funder_donor_id: g.funder_donor_id || null });
    req.audit.summary(`Linked the ${g.funder || "grant"} grant to the funder record ${fr.funder.name}${created ? " (added as a new funder)" : ""}.`);
  }
  res.json({ ok: true, grantId: g.id, funderId: fr.funder.id, funderName: fr.funder.name, created,
    sentence: created ? `Added ${fr.funder.name} as a funder and linked this grant to it.` : `Linked this grant to ${fr.funder.name}.` });
}));

async function checkGrantFund(orgId, fundId) {
  if (!fundId) return { ok: true, fundId: null };
  const [f] = await query("SELECT id FROM fin_funds WHERE id=? AND org_id=?", [fundId, orgId]);
  return f ? { ok: true, fundId: f.id } : { ok: false };
}
async function checkGrantOfficer(orgId, officerId) {
  const { ok, user: u } = await OU.orgUser(orgId, officerId);
  if (!ok) return { ok: false };
  return u ? { ok: true, officerId: u.id, officerName: u.name } : { ok: true, officerId: null, officerName: null };
}

// GET /funders/:donorId/documents — EVERY document across a funder's grants.
// The brief asks for this because the question is "have we ever signed
// anything with these people", and that question spans grants.
app.get("/funders/:donorId/documents", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const fr = await resolveFunder(orgId, req.params.donorId);
  if (!fr.ok) {
    const code = fr.problem.code === "funder_not_found" ? 404 : 400;
    return res.status(code).json({ error: fr.problem.message, code: fr.problem.code });
  }
  const rows = await query(
    `SELECT d.*, g.program, g.funder, g.status AS grant_status, f.name AS funder_name
       FROM grant_documents d
       JOIN grants g ON g.id = d.grant_id AND g.org_id = d.org_id
       LEFT JOIN donors f ON f.id = g.funder_donor_id AND f.org_id = g.org_id
      WHERE d.org_id=? AND g.funder_donor_id=? ORDER BY d.uploaded_at ASC`, [orgId, fr.funder.id]);
  // Versions are PER GRANT, not per funder — "proposal #2" means the second
  // proposal on that grant, and numbering across grants would be a figure
  // nobody could reconcile against anything.
  const byGrant = new Map();
  for (const r of rows) {
    if (!byGrant.has(r.grant_id)) byGrant.set(r.grant_id, []);
    byGrant.get(r.grant_id).push(grantDocRow(r, orgId));
  }
  const documents = [];
  for (const [, list] of byGrant) documents.push(...grantDocs.withVersions(list));
  documents.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
  res.json({
    funder: { funderId: fr.funder.id, name: fr.funder.name },
    documents, sentence: grantDocs.documentSentence(documents), docTypes: grantDocs.DOC_TYPES,
  });
}));

// GET /grant-documents/:id — the signed, expiring, PRIVATE door.
// Unauthenticated by design (a browser fetches a file with no auth header);
// the URL carries its own signature and the org comes from the STORED ROW.
// FIX-20 Part 0: the signature is no longer enough on its own. The link also
// needs a signed-in user of the org on the stored row (the client fetches it
// with the session and saves the bytes), so a copied link opened anywhere
// else is a 404.
app.get("/grant-documents/:id", fileLimiter, requireAuth404, wrap(async (req, res) => {
  const id = String(req.params.id || "");
  if (!ASSET_ID_RE.test(id)) return res.status(404).json({ error: "not_found" });
  const [row] = await query(
    `SELECT org_id FROM portal_assets WHERE id = ? AND kind = ? AND deleted_at IS NULL`,
    [id, grantDocs.DOC_ASSET_KIND]);
  if (!row || row.org_id !== req.user.orgId) return res.status(404).json({ error: "not_found" });
  const v = grantDocs.verifyDocUrl({ orgId: row.org_id, assetId: id, e: req.query.e, s: req.query.s });
  // ONE answer for expired and for wrong-org alike, so a probe cannot tell
  // "this agreement exists in another tenant" from "this link is old".
  if (!v.ok) return res.status(403).json({ error: "link_expired" });
  const asset = await getThemeAsset(id);
  if (!asset) return res.status(404).json({ error: "not_found" });
  // The stored filename is looked up for the download name; the bytes are
  // addressed by asset id, so the name is only ever a label.
  const [meta] = await query(
    "SELECT file_name FROM grant_documents WHERE asset_id=? AND org_id=? LIMIT 1", [id, row.org_id]);
  res.set("Content-Type", asset.contentType);
  // A document is never rendered inline: a PDF viewer in our own origin is a
  // parser we did not choose running on a file a funder sent.
  const safeName = grantDocs.sanitizeFilename((meta && meta.file_name) || "document", asset.contentType);
  res.set("Content-Disposition", `attachment; filename="${safeName.replace(/"/g, "")}"`);
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Cache-Control", `private, max-age=${Math.max(0, Math.floor((v.expiresAt - Date.now()) / 1000))}`);
  res.set("ETag", `"${asset.id}"`);
  res.send(asset.buffer);
}));

// GET /grant-outlines/:runId — read one back. It is an agent run, so it is on
// the Activity screen with everything else the agent did.
app.get("/grant-outlines/:runId", requireAuth, wrap(async (req, res) => {
  const [r] = await query("SELECT * FROM agent_runs WHERE id=? AND org_id=?", [req.params.runId, req.user.orgId]);
  if (!r || !r.actions || !r.actions.payload) return res.status(404).json({ error: "Outline not found" });
  res.json({ runId: r.id, writtenAt: r.finished_at, ...r.actions.payload });
}));

// ── Programs ───────────────────────────────────────────────────────────────
app.get("/programs", requireAuth, wrap(async (req, res) => {
  const programs = await query(
    "SELECT * FROM programs WHERE org_id = ? ORDER BY created_at DESC",
    [req.user.orgId]
  );
  const result = await Promise.all(programs.map(async p => {
    const grants = await query(
      `SELECT pg.grant_id as "grantId", g.funder, g.program, pg.allocated
       FROM program_grants pg
       JOIN grants g ON g.id = pg.grant_id AND g.org_id = ?
       WHERE pg.program_id = ? AND pg.org_id = ?`,
      [req.user.orgId, p.id, req.user.orgId]
    );
    return { ...p, grants };
  }));
  res.json(result);
}));

app.post("/programs", requireAuth, wrap(async (req, res) => {
  const { name, description, budget, spent, staff, participantCount, startDate, endDate, status, outcomes, metrics } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const id = newId("prg");
  await run(
    `INSERT INTO programs (id,org_id,name,description,budget,spent,staff,participant_count,start_date,end_date,status,outcomes,metrics)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, name, description || "", budget || 0, spent || 0,
     JSON.stringify(staff || []), participantCount || 0,
     startDate || null, endDate || null, status || "active",
     outcomes || "", JSON.stringify(metrics || {})]
  );
  const rows = await query("SELECT * FROM programs WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}));

app.put("/programs/:id", requireAuth, wrap(async (req, res) => {
  const { name, description, budget, spent, staff, participantCount, startDate, endDate, status, outcomes, metrics } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const affected = await run(
    `UPDATE programs
     SET name=?,description=?,budget=?,spent=?,staff=?,participant_count=?,
         start_date=?,end_date=?,status=?,outcomes=?,metrics=?,updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [name, description || "", budget || 0, spent || 0,
     JSON.stringify(staff || []), participantCount || 0,
     startDate || null, endDate || null, status || "active",
     outcomes || "", JSON.stringify(metrics || {}),
     req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Program not found" });
  const rows = await query("SELECT * FROM programs WHERE id = ?", [req.params.id]);
  res.json(rows[0]);
}));

app.delete("/programs/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { changes } = await run("DELETE FROM programs WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" }); // BUILD-75 B: a foreign/unknown id answers 404, never a false success — one answer everywhere
  res.json({ success: true });
}));

app.post("/programs/:id/grants", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { grantId, allocated } = req.body;
  if (!grantId) return res.status(400).json({ error: "grantId required" });

  const programExists = await query(
    "SELECT id FROM programs WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!programExists.length) return res.status(404).json({ error: "Program not found" });

  const grantExists = await query(
    "SELECT id FROM grants WHERE id = ? AND org_id = ?",
    [grantId, req.user.orgId]
  );
  if (!grantExists.length) return res.status(404).json({ error: "Grant not found" });

  const id = newId("pg");
  await run(
    `INSERT INTO program_grants (id,org_id,program_id,grant_id,allocated)
     VALUES (?,?,?,?,?)
     ON CONFLICT (program_id, grant_id) DO UPDATE SET allocated=EXCLUDED.allocated`,
    [id, req.user.orgId, req.params.id, grantId, allocated || 0]
  );
  res.json({ success: true });
}));

app.delete("/programs/:id/grants/:grantId", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { changes } = await run(
    "DELETE FROM program_grants WHERE program_id = ? AND grant_id = ? AND org_id = ?",
    [req.params.id, req.params.grantId, req.user.orgId]
  );
  if (!changes) return res.status(404).json({ error: "Not found" }); // BUILD-75 B: a foreign/unknown id answers 404, never a false success — one answer everywhere
  res.json({ success: true });
}));
}

module.exports = { routers, mount };

// server/grants/helpers.js — what more than one grants file reads.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it before the route modules, and what its mount()
// returns is on ctx for every module mounted after it.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).

function mount(ctx) {
const {
  grantDocs, query, toCents, toDollars,
} = ctx;

// Finance entity-routing FIX — award-side double-count guard, the DETECTION
// arm. Before marking a grant awarded, the client asks: is there a recent
// MANUAL money-in already in the ledger that looks like this grant's money
// (funder name in vendor/description, or the exact grant amount)? Read-only,
// org-scoped (foreign grant → 404); the human decides via the prompt whether
// to link (PUT adoptTxnId) or book separately. 180-day window, newest first.

// ── BUILD-100 (grants) Part 1 — FUNDERS AND GRANTS ─────────────────────────
// A funder is an ORGANISATION on file (BUILD-80's `kind`), not a string in a
// column, and a grant is one request to one of them. shared/grantShape.js holds
// every rule; these routes are its writers. The existing `grants` table gains
// the columns rather than being replaced — db.js says why.
async function grantShapeMod() { return import("../../shared/grantShape.js"); }

// The wire shape. Money leaves as dollars AND as integer cents, because the
// pipeline is summed in cents and a screen that re-derives cents from a float is
// how a total ends up a penny out.
function grantRow(r, { funds, officers } = {}) {
  const reqC = toCents(r.amount_requested != null ? r.amount_requested : r.amount) || 0;
  const awdC = toCents(r.amount_awarded) || 0;
  const recC = toCents(r.received) || 0;
  return {
    id: r.id,
    funderId: r.funder_donor_id || null,
    funderName: r.funder_name || r.funder || "",
    funderType: r.funder_type || null,
    program: r.program || "",
    amountRequested: toDollars(reqC), amountRequestedCents: reqC,
    amountAwarded: awdC ? toDollars(awdC) : null, amountAwardedCents: awdC,
    received: toDollars(recC), receivedCents: recC,
    status: r.status_canonical || r.status,
    restriction: r.restriction || null,
    restrictedFrom: r.restricted_from || null,
    restrictedUntil: r.restricted_until || null,
    fundId: r.fund_id || null,
    fundName: r.fund_id && funds ? (funds.get(r.fund_id) || null) : null,
    cycleName: r.cycle_name || null,
    officerId: r.officer_id || null,
    officerName: r.officer_id && officers ? (officers.get(r.officer_id) || null) : (r.officer || ""),
    awardPledgeId: r.award_pledge_id || null,
    declineReason: r.decline_reason || null,
    declinedOn: r.declined_on || null,
    reapply: r.reapply === null || r.reapply === undefined ? null : !!r.reapply,
    deadline: r.deadline || null,
    reportDue: r.report_due || null,
    notes: r.notes || "",
    createdByName: r.created_by_name || "",
    awardedAt: r.awarded_at || null,
  };
}

async function orgFundNamesG(orgId) {
  const rows = await query("SELECT id, name FROM fin_funds WHERE org_id=?", [orgId]);
  return new Map(rows.map(r => [r.id, r.name]));
}
async function orgOfficerNames(orgId) {
  const rows = await query("SELECT id, name FROM users WHERE org_id=?", [orgId]);
  return new Map(rows.map(r => [r.id, r.name]));
}

function grantDocUrl(orgId, assetId) {
  return grantDocs.signDocUrl({ orgId, assetId });
}

function grantDocRow(r, orgId) {
  return {
    id: r.id, grantId: r.grant_id,
    docType: r.doc_type, docTypeLabel: grantDocs.docTypeLabel(r.doc_type),
    fileName: r.file_name, contentType: r.content_type || null, bytes: r.bytes || null,
    notes: r.notes || "",
    // ISO, ALWAYS. `uploaded_at` is a timestamptz and pg hands it back as a JS
    // Date; `String(date)` is "Thu Sep 25 2026 …", which sorts lexically by
    // WEEKDAY NAME. Both the version numbering and the funder list sort on this
    // value, so a Date here silently numbered "proposal #1" and "#2" by the day
    // of the week they were uploaded. Same class as BUILD-86's TO_CHAR lesson.
    uploadedAt: r.uploaded_at instanceof Date ? r.uploaded_at.toISOString() : r.uploaded_at,
    uploadedByName: r.uploaded_by_name || "",
    // The link is minted PER READ and lives thirty minutes. A stored URL is a
    // URL that outlives the reason it was made.
    url: grantDocUrl(orgId, r.asset_id),
    funderName: r.funder_name || r.funder || "", program: r.program || "",
  };
}

// ── BUILD-100 (grants) Part 6 — READING SOMEBODY ELSE'S GRANT SPREADSHEET ───
// shared/grantImport.js is the preset — a preset on the mapper, never a second
// importer (the 89d rule, fourth application). This is the ONE write path it
// lands through, and it writes grants and funders and NOTHING ELSE: no gift, no
// pledge, no milestone, no thread. An imported file is history (BUILD-83), and a
// report that was due last March is not a follow-up somebody has to close this
// morning.
async function grantImportMod() { return import("../../shared/grantImport.js"); }
return { grantDocRow, grantImportMod, grantRow, grantShapeMod, orgFundNamesG, orgOfficerNames };
}

module.exports = { mount };

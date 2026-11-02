// server/imports/helpers.js — what more than one imports file reads.
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
  GC_READY, _titleCaseWord, checkGiftExtras, donorByNameOrCreate, inviteeDisplayName, orgToday, orgTz, query,
  round2, run, uuid, writeGiftExtras,
} = ctx;
let GC = null;
GC_READY.then(m => { GC = m; });
// BUILD-57 §2b — BULK-IMPORT ids carry FULL uuid entropy (32 hex). The 8-hex
// ids minted elsewhere are fine one-at-a-time, but the import writes 500 rows
// per statement, where a single global-pkey collision (8 hex = 32 bits —
// birthday-collides at real multi-tenant scale) aborted the WHOLE batch and
// lost its rows (the BUILD-54 finding, hit live in a pre-push run). Width,
// not retry: 2^128 puts the class out of reach on every import mint site.
const importId = prefix => prefix + uuid().replace(/-/g, "");
// WIRE-1: an imported gift names its campaign; Reports filtered by campaign
// match on campaign_id. One org-scoped lookup, exact and case-insensitive. A
// name two campaigns share is left unresolved rather than guessed.
async function campaignIdResolver(orgId) {
  const rows = await query("SELECT id, name FROM campaigns WHERE org_id=?", [orgId]);
  const byName = new Map();
  for (const r of rows) {
    const k = String(r.name || "").trim().toLowerCase();
    if (!k) continue;
    byName.set(k, byName.has(k) ? null : r.id);
  }
  return name => byName.get(String(name || "").trim().toLowerCase()) || null;
}
const IMPORT_RUN_ID_RE = /^imp_[A-Za-z0-9_-]{4,40}$/;

// BUILD-72 Part 1 — an import that does not reconcile is not a 500. The
// transaction has already rolled back by the time this runs (db.js's
// withTransaction ROLLBACKs on throw), so nothing landed; the caller gets 409
// plus the equation that failed, and the client renders the dollar discrepancy
// on the summary screen. Wrap an import handler in this instead of `wrap`.
const wrapImport = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => {
  if (e && e.code === "import_unreconciled") {
    console.error("[import] ABORTED — did not reconcile:", e.message, JSON.stringify(e.reconciliation));
    return res.status(409).json({
      error: "import_unreconciled",
      message: e.message,
      reconciliation: e.reconciliation,
    });
  }
  return next(e);
});
// A "Last, First" flip must NOT eat a corporate name like "Acme, Inc." → "Inc. Acme".
const _CORP_SUFFIX = /^(inc|llc|l\.l\.c|llp|ltd|co|corp|company|foundation|fdn|trust|fund|society|assn|association|partners|group|plc|gmbh|nfp)\.?$/i;
function normalizeName(raw) {
  if (raw == null) return raw;
  let s = String(raw).replace(/\s+/g, " ").trim();
  if (!s) return s;
  const parts = s.split(",");
  if (parts.length === 2 && parts[0].trim() && parts[1].trim() && !_CORP_SUFFIX.test(parts[1].trim()))
    s = parts[1].trim() + " " + parts[0].trim();
  const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, "");
  const allUpper = letters && letters === letters.toUpperCase();
  const allLower = letters && letters === letters.toLowerCase();
  if (allUpper || allLower) s = s.replace(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*/g, w => _titleCaseWord(w));
  return s;
}

// ── FIX-37 · THE RECENT-GIFT WORK RUNS BEHIND THE SCREEN ────────────────
// Once an import's rows are saved, the request answers. Its recent gifts
// (recordGift, one by one, for the last 30 days) and the after-change step
// for everybody the file touched run here, after the response, as one job
// per import run. SCALE-1: the job is a row on the queue (jobQueue.js,
// `importRecent`, keyed by the run), so it runs in the worker when there is
// one, survives a restart, and never runs twice at once for the same run.
//
//   import_recent_jobs   one row per run: progress, the thank-you answer, errors
//   import_recent_work   one row per recent gift still to do (deleted when done)
//
// The work rows are written in the import's own transaction, so a recent
// gift is never only in memory: a restart picks the job up where it stopped
// (resumeRecentWork, at boot). Undo cancels the job, waits for the gift in
// flight, and then removes everything as before. When the job finishes it
// writes the readout, if the run has been recorded by then; POST /imports
// writes it instead when the job finished first. Whoever comes second writes
// it, once (readout_claimed).
const RECENT_WORK_ACTOR = { id: "system:import-recent-gifts", name: "Steward (your import's recent gifts)" };
const recentJobs = new Map();   // import id → { promise, cancelled }
const IT = require("../../importThanks");
// SCALE-1: "an import request is running for this org" is a row, not a Map,
// because the job may run in the worker while the request runs in a web
// replica. A row older than ten minutes is a request whose process died.
function markImportInFlight(orgId, res) {
  const id = importId("iif_");
  const ready = run(`INSERT INTO import_in_flight (id, org_id) VALUES (?,?)`, [id, orgId]).catch(() => {});
  let done = false;
  const end = () => { if (done) return; done = true; ready.then(() => run(`DELETE FROM import_in_flight WHERE id=?`, [id])).catch(() => {}); };
  res.on("finish", end); res.on("close", end);
}

async function queueRecentWork(txq, orgId, runId, gifts, { actorId, actorName, thanks, touched = [] }) {
  const up = await txq(
    `INSERT INTO import_recent_jobs (import_id, org_id, status, total, thanks, touched, created_by, created_by_name)
     VALUES (?,?,'running',?,?::jsonb,?::jsonb,?,?)
     ON CONFLICT (import_id) DO UPDATE SET total = import_recent_jobs.total + EXCLUDED.total, status='running',
       finished_at=NULL, thanks=COALESCE(EXCLUDED.thanks, import_recent_jobs.thanks),
       touched = import_recent_jobs.touched || EXCLUDED.touched
     WHERE import_recent_jobs.org_id = EXCLUDED.org_id AND import_recent_jobs.status <> 'cancelled'
     RETURNING import_id`,
    [runId, orgId, gifts.length, thanks ? JSON.stringify(thanks) : null, JSON.stringify(touched),
     actorId || RECENT_WORK_ACTOR.id, actorName || RECENT_WORK_ACTOR.name]);
  if (!up.length) throw new Error("This import was undone; start it again to bring the file in.");
  const [{ s }] = await txq(`SELECT COALESCE(MAX(seq),0)::int AS s FROM import_recent_work WHERE import_id=?`, [runId]);
  const ROWS = 1000;
  for (let i = 0; i < gifts.length; i += ROWS) {
    const part = gifts.slice(i, i + ROWS), params = [];
    const tuples = part.map((g, k) => { params.push(importId("irw_"), orgId, runId, s + i + k + 1, JSON.stringify(g)); return "(?,?,?,?,?::jsonb)"; });
    await txq(`INSERT INTO import_recent_work (id, org_id, import_id, seq, gift) VALUES ${tuples.join(",")}`, params);
  }
}

// A chunk that arrives while the run's job is working leaves one waiting row
// behind it, which is how its gifts are picked up: the job never runs twice
// at once for the same run, and never forgets the work that came in late.
const JQ = require("../../jobQueue");
function kickRecentWork(orgId, runId) {
  return JQ.enqueue({ name: "importRecent", orgId, key: "importRecent:" + runId, payload: { orgId, runId }, priority: 3 })
    .catch(e => console.error("[import-recent] enqueue:", runId, e.message));
}

// The readout for an import run, written once, by whichever of the job's end
// and POST /imports comes second. A run with no job (a donors-only file) has
// nothing to wait for.
async function writeImportReadoutOnce(orgId, runId) {
  const [imp] = await query(`SELECT id, name FROM imports WHERE id=? AND org_id=?`, [runId, orgId]);
  if (!imp) return null;
  const [job] = await query(`SELECT status FROM import_recent_jobs WHERE import_id=? AND org_id=?`, [runId, orgId]);
  if (job) {
    if (job.status !== "done") return null;
    const claimed = await query(`UPDATE import_recent_jobs SET readout_claimed=true WHERE import_id=? AND readout_claimed=false RETURNING import_id`, [runId]);
    if (!claimed.length) return null;
  }
  const giftIds = await query(`SELECT id, donor_id FROM gifts WHERE org_id=? AND import_id=?`, [orgId, runId]);
  const made = (await query(`SELECT id FROM donors WHERE org_id=? AND created_import_id=?`, [orgId, runId])).map(r => r.id);
  if (!giftIds.length) return null;
  return require("../../readout").writeReadout(orgId, {
    sourceKind: "import", sourceId: runId, sourceName: imp.name,
    giftIds: giftIds.map(g => g.id), donorIds: [...new Set([...giftIds.map(g => g.donor_id), ...made])],
    stamp: `csv_import:${runId}`, today: orgToday(await orgTz(orgId)),   // ORG_TZ_SEAM_OK
    firstImport: await IT.isFirstImport(query, orgId, runId),
  });
}

// LIVE-1 — the org's saved value answers, as one function: (field, raw) →
// the value she chose, or the raw value when she has said nothing about it.
async function importValueMapper(orgId) {
  const rows = await query(`SELECT field, raw_norm, value FROM import_value_mappings WHERE org_id=?`, [orgId]).catch(() => []);
  const m = new Map(rows.map(r => [r.field + "|" + r.raw_norm, r.value]));
  const norm = v => String(v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return (field, raw) => (raw ? (m.get(field + "|" + norm(raw)) || raw) : raw);
}

async function recalcDonorSummaryBatch(donorIds, orgId) {
  // LIVE-1: the query moved to afterChange.js, the one after-change step, so
  // there is one copy of it.
  return require("../../afterChange").recalcDonorSummaryBatch(query, donorIds, orgId);
}

// buildAssigneeResolver — for a Team org, validate the per-donor `assignedTo`
// the import payload carries (from the client's owner-column mapping) and return
// a resolver donor→{ id, name, pendingInviteId, pendingName }. Two kinds of
// assignee are honored:
//   - a real user id in THIS org → { id, name }               (lands on the board)
//   - "invite:<id>" for a PENDING invite in this org → { pendingInviteId,
//     pendingName } (held until the officer accepts — see /auth/invite/accept)
// Core/lapsed orgs (not team tier) get a no-op resolver, so a Core import always
// lands UNASSIGNED regardless of payload. An `assignedTo` that matches neither a
// real user nor a live pending invite resolves to all-null (never silently
// mis-assigns across orgs or to a stale/expired id).
async function buildAssigneeResolver(donors, orgId, isTeam) {
  const NONE = { id: null, name: null, pendingInviteId: null, pendingName: null };
  if (!isTeam) return () => NONE;
  const raw = [...new Set(donors.map(d => d && d.assignedTo).filter(Boolean).map(String))];
  const userIds = raw.filter(v => !v.startsWith("invite:"));
  const inviteIds = raw.filter(v => v.startsWith("invite:")).map(v => v.slice("invite:".length)).filter(Boolean);

  const validUsers = new Map();
  if (userIds.length) {
    const rows = await query("SELECT id, name FROM users WHERE id = ANY(?) AND org_id = ? AND deactivated_at IS NULL", [userIds, orgId]);
    rows.forEach(r => validUsers.set(r.id, r.name));
  }
  const validInvites = new Map();
  if (inviteIds.length) {
    const rows = await query(
      "SELECT id, email FROM invites WHERE id = ANY(?) AND org_id = ? AND accepted_at IS NULL AND expires_at > NOW()",
      [inviteIds, orgId]
    );
    rows.forEach(r => validInvites.set(r.id, inviteeDisplayName(r.email)));
  }
  return (d) => {
    const v = d && d.assignedTo ? String(d.assignedTo) : null;
    if (!v) return NONE;
    if (v.startsWith("invite:")) {
      const inviteId = v.slice("invite:".length);
      if (!validInvites.has(inviteId)) return NONE;
      return { id: null, name: null, pendingInviteId: inviteId, pendingName: d.assignedToName || validInvites.get(inviteId) || null };
    }
    if (!validUsers.has(v)) return NONE;
    return { id: v, name: d.assignedToName || validUsers.get(v) || null, pendingInviteId: null, pendingName: null };
  };
}

// ── BUILD-72 Part 1 — THE IMPORT RECONCILIATION INVARIANT ───────────────────
// The class fix. The instance bugs (F-4's twin collapse in BUILD-45, and 0.1b's
// far worse "a matched donor's gifts vanish" found in BUILD-72 Part 0) were both
// the same shape: a row entered the importer and left no trace. Counting donors
// on the summary screen never caught it, because the thing that disappeared was
// money.
//
// So every importer now keeps a ledger, and every row it touches must land in
// EXACTLY ONE bucket:
//
//     rows_in_file    = created + skipped_by_user + errored
//     dollars_in_file = created + skipped_by_user + errored
//
// Both equations are computed by the importer itself, asserted before the
// transaction commits, and returned to the client for display. If either fails
// to balance the import ABORTS AND ROLLS BACK, naming the discrepancy in
// dollars — on the user's screen, at run time. A collapse bug introduced years
// from now by someone else fails here instead of silently eating a Sunday's
// offering.
//
// The dollar equation is the one that matters: a row count can be right while
// money is wrong.
function importLedger(kind, unit = "gift") {
  return {
    kind, unit,
    rows:    { inFile: 0, created: 0, skipped: 0, errored: 0 },
    dollars: { inFile: 0, created: 0, skipped: 0, errored: 0 },
    // The file's RAW total, before the importer's whole-dollar rounding. The
    // normalized `dollars.inFile` above is what the equation balances on; this
    // is what the file actually said. The gap between them is the blind spot
    // guarded in assertBalanced().
    rawDollarsInFile: 0,
    rawRowsWithCents: 0,
    // BUILD-73 Part 1 — the PER-ROW cents ledger. BUILD-72's blind-spot guard
    // compares the file's TOTAL cents against the created TOTAL's cents, which
    // leaves one documented residual: per-row rounding whose errors CANCEL
    // ($33.33 -> 33 and $66.67 -> 67 net to $100.00 on both sides). The
    // equation reads clean, the total-level rule sees no cents to compare, and
    // every affected donor's record is still individually wrong. This
    // accumulates what each row actually lost, so the refusal below is decided
    // per row and subsumes the total-level case entirely.
    rawCentsDropped: 0,
    skippedReasons: {},
    erroredReasons: {},
    _tally(map, reason, n, amount) {
      const e = map[reason] || (map[reason] = { rows: 0, dollars: 0 });
      e.rows += n; e.dollars += amount;
    },
    // Every row in the payload announces itself here FIRST, before any routing
    // decision. Nothing may be created, skipped or errored that did not.
    saw(amount, n = 1, rawAmount = null) {
      this.rows.inFile += n;
      this.dollars.inFile += round2(amount);
      const raw = rawAmount == null ? amount : rawAmount;
      this.rawDollarsInFile = round2(this.rawDollarsInFile + round2(raw));
      if (Math.abs(round2(raw) - Math.round(raw)) >= 0.005) this.rawRowsWithCents += n;
      // What THIS row lost (or gained) to the importer's rounding, accumulated
      // as an absolute magnitude so a +$0.33 and a -$0.33 cannot cancel each
      // other out of existence. `amount` is the normalized figure the importer
      // will actually store; `raw` is what the file said.
      this.rawCentsDropped = round2(this.rawCentsDropped + Math.abs(round2(round2(raw) - round2(amount))) * n);
    },
    created(amount, n = 1) { this.rows.created += n; this.dollars.created += round2(amount); },
    skipped(reason, amount, n = 1) {
      this.rows.skipped += n; this.dollars.skipped += round2(amount);
      this._tally(this.skippedReasons, reason, n, round2(amount));
    },
    errored(reason, amount, n = 1) {
      this.rows.errored += n; this.dollars.errored += round2(amount);
      this._tally(this.erroredReasons, reason, n, round2(amount));
    },
    balance() {
      const rowsAccounted    = this.rows.created + this.rows.skipped + this.rows.errored;
      const dollarsAccounted = round2(this.dollars.created + this.dollars.skipped + this.dollars.errored);
      const rowGap    = this.rows.inFile - rowsAccounted;
      const dollarGap = round2(this.dollars.inFile - dollarsAccounted);
      return {
        rowsAccounted, dollarsAccounted, rowGap, dollarGap,
        rowsBalanced: rowGap === 0,
        dollarsBalanced: Math.abs(dollarGap) < 0.005,
        balanced: rowGap === 0 && Math.abs(dollarGap) < 0.005,
      };
    },
    // The report the client renders verbatim on the summary screen. The user
    // sees the equation, not a reassurance.
    report() {
      const b = this.balance();
      return {
        kind: this.kind, unit: this.unit,
        rows: { ...this.rows, accounted: b.rowsAccounted, balanced: b.rowsBalanced },
        dollars: { ...this.dollars, accounted: b.dollarsAccounted, balanced: b.dollarsBalanced },
        skippedReasons: this.skippedReasons,
        erroredReasons: this.erroredReasons,
        balanced: b.balanced,
        rowGap: b.rowGap, dollarGap: b.dollarGap,
        rawDollarsInFile: round2(this.rawDollarsInFile),
        rawRowsWithCents: this.rawRowsWithCents,
        rawCentsDropped: round2(this.rawCentsDropped),
      };
    },
    // Throws inside the transaction → db.js's withTransaction ROLLBACKs → the
    // route's catch turns it into a 409 carrying this report. Nothing lands.
    assertBalanced() {
      // ── THE CENTS BLIND SPOT (BUILD-72 Step A) ──────────────────────────
      // The equation compares dollars-in-file to dollars-created. If BOTH
      // SIDES TRUNCATE IDENTICALLY it balances, reports success, and money is
      // gone — the one hole in the guarantee Part 1 established, sitting
      // exactly on the $33.33-stores-as-33 defect. So the ledger also carries
      // the file's RAW total, and refuses an import whose cents were absorbed
      // silently: rows arrived carrying cents, yet not a cent survived into
      // what was created. A balanced equation is not permission to lose money.
      // BUILD-73 Part 1 tightens this from the TOTAL to the ROW. The
      // production audit (audit/BUILD-73-FINDINGS.md) found no cents anywhere
      // in the database — not one row out of 7,571 — which is exactly what a
      // system that rounds at every write door looks like from the inside. The
      // rule is therefore stated at the only place it is true: a row that
      // arrived carrying cents must not be stored without them. This subsumes
      // BUILD-72's total-level rule (a total can only lose cents if some row
      // did) and closes its documented cancelling residual.
      if (round2(this.rawCentsDropped) >= 0.005) {
        const lost = round2(this.rawCentsDropped);
        const err = new Error(
          `Import aborted · ${this.rawRowsWithCents} row(s) in the file carry cents that would not be stored: ` +
          `$${lost.toFixed(2)} would be silently dropped across ${this.rows.inFile} row(s). Nothing was saved.`);
        err.code = "import_unreconciled";
        err.reconciliation = { ...this.report(), centsBlindSpot: true,
          rawDollarsInFile: this.rawDollarsInFile, rawRowsWithCents: this.rawRowsWithCents, centsDropped: lost };
        throw err;
      }
      const b = this.balance();
      if (b.balanced) return;
      const parts = [];
      if (!b.rowsBalanced)
        parts.push(`${Math.abs(b.rowGap)} ${this.unit} row(s) ${b.rowGap > 0 ? "unaccounted for" : "counted twice"}`);
      if (!b.dollarsBalanced)
        parts.push(`$${Math.abs(b.dollarGap).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${b.dollarGap > 0 ? "unaccounted for" : "counted twice"}`);
      const err = new Error(`Import aborted, the file did not reconcile: ${parts.join("; ")}. Nothing was saved.`);
      err.code = "import_unreconciled";
      err.reconciliation = this.report();
      throw err;
    },
  };
}

// A per-batch SAVEPOINT. One transaction wraps the whole import so the final
// assertion can roll everything back — but a single bad batch must still be
// survivable and COUNTED as errored rather than killing the request. Postgres
// aborts a transaction on any statement error, so each batch runs inside its
// own savepoint: released on success, rolled back to on failure.
async function withSavepoint(client, name, fn) {
  await client.query(`SAVEPOINT ${name}`);
  try {
    const r = await fn();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return { ok: true, result: r };
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return { ok: false, error: e };
  }
}

// A potential-duplicate GROUP is same resolved donor + same gift date + same
// amount. Steward cannot tell two gala tickets from a doubled file and must not
// try: groups are DETECTED and SURFACED, never resolved automatically, and the
// default selection is keep-all (see the import routes' `skipRowKeys`).
function duplicateGroupsFrom(rows) {
  const byFp = new Map();
  for (const r of rows) {
    const fp = `${r.donorId}|${r.date}|${r.amount}`;
    if (!byFp.has(fp)) byFp.set(fp, []);
    byFp.get(fp).push(r);
  }
  const groups = [];
  for (const [fp, members] of byFp) {
    if (members.length < 2) continue;
    const [donorId, date, amount] = fp.split("|");
    groups.push({ key: fp, donorId, date, amount: Number(amount), count: members.length });
  }
  groups.sort((a, b) => b.count - a.count || b.amount - a.amount);
  return groups;
}

// ── BUILD-87 PART 1 — NAMED IMPORTS AND HISTORY ────────────────────────────
// An import used to exist only as a screen. Closing it destroyed the only
// record that it had ever happened, so "what did we load in March" had no
// answer and "Import 14" would have been the best name anyone could give it.
//
// Every run gets a row. The NAME defaults to the file's own name with the
// extension stripped ("steward-leads" beats "Import 14"), is editable on the
// review step, and is unique within the org — a second run of the same file
// is "steward-leads (2)", never a second row wearing the first one's name.
//
// The SUMMARY is the read-back object the BUILD-83 receipt already computed,
// STORED verbatim. Reopening a receipt shows what the import said when it
// committed; it never recomputes against a database that has moved on.
//
// NO UNDO IN THIS BUILD. Reading an import's history is not reversing it, and
// a half-undo of 25,000 rows is worse than none. A future part owns that.

// The name, made unique within the org. Pure: the caller supplies what is
// already taken. " (2)" is appended, then " (3)", and so on.
function uniqueImportName(base, taken) {
  const b = String(base || "").trim().slice(0, 120) || "Import";
  const used = new Set((taken || []).map(n => String(n)));
  if (!used.has(b)) return b;
  for (let n = 2; n < 1000; n++) { const c = `${b} (${n})`; if (!used.has(c)) return c; }
  return `${b} (${Date.now()})`;
}


// ══ TRANS-1 · THE MOVE ═════════════════════════════════════════════════════
//
// "Moving takes about a day. You keep your old system until you trust us, and
// there is nothing new to learn." The objection demos close against is not the
// product, it is the move, so these routes exist to make that sentence true
// and provable.
//
// The pure layer is shared/movePlan.js. Nothing here computes a figure twice:
// the FILE side of every comparison is read from the `imports` row that was
// written at commit time (the BUILD-87 rule -- the file is gone, and a number
// recomputed from the database is not evidence about the file), and the HELD
// side is read from the database now, scoped to the move by `import_id`.
const moveMod = () => import("../../shared/movePlan.js");

// A deposit is REVERSIBLE AS A WHOLE, for twenty-four hours. A slip keyed wrong
// is discovered the same day, and unpicking eleven gifts by hand is how a total
// stops matching. After the window it is history: correct it gift by gift, on
// the record, where the correction is visible.
const DEPOSIT_REVERSE_HOURS = 24;

// NOT requireAdmin any more, and that is the one gate this changes. Importing
// takes checkWriteAccess, so a staff member can import a file; if undoing it
// took an admin, the person who had just put forty gifts on the wrong org
// would be shown an Undo button and refused by it. So: an admin may undo any
// whole-import run, and anybody may undo THEIR OWN. A deposit's 24 hours and
// its admin-only posture are otherwise untouched.
// INT-BUILD-1 0e — WHO MAY UNDO AN IMPORT, ONE ANSWER FOR EVERY UNDO ROUTE.
// An admin, or the person who ran it. The role is re-read live (a demoted
// admin loses it on the next request, as with requireAdmin), and a row with
// no recorded runner is an admin's alone. The only Undo buttons are on the
// result screen of the run itself, which only its runner ever sees.
const UNDO_NOT_YOURS = "Only an admin, or the person who ran this import, can undo it.";
async function mayUndoImport(req, ranBy) {
  if (ranBy && ranBy === req.user.userId) return true;
  const [me] = await query("SELECT role FROM users WHERE id=? AND org_id=?", [req.user.userId, req.user.orgId]);
  return !!(me && me.role === "admin");
}

async function importGiftExtras(orgId, pending, who) {
  await GC_READY;
  const out = { softCredits: 0, tributes: 0, tributeNotices: 0, matches: 0, peopleCreated: 0, unresolved: [] };
  const cache = new Map();
  const made = { count: 0 };
  const byName = async (name, opts = {}) => {
    const id = await donorByNameOrCreate(orgId, name, { ...opts, who, cache, made });
    out.peopleCreated = made.count;
    return id;
  };
  for (const { giftId, g } of pending) {
    const [gift] = await query("SELECT * FROM gifts WHERE id=? AND org_id=?", [giftId, orgId]);
    if (!gift) continue;
    const cents = Math.round(Number(gift.amount) * 100);
    const raw = {};
    const c = g.credit;
    if (c.softCredit && c.softCredit.name) {
      const pid = await byName(c.softCredit.name, { create: true });
      if (pid && pid !== gift.donor_id) raw.softCredits = [{ donorId: pid, amount: c.softCredit.amount ?? null, pct: c.softCredit.pct ?? null, role: "recommender" }];
      else if (!pid) out.unresolved.push({ kind: "soft_credit", name: c.softCredit.name });
    }
    if (c.tribute && c.tribute.name) {
      const type = GC.normaliseTributeType(c.tribute.type) || GC.TRIBUTE_HONOR;
      if (!GC.normaliseTributeType(c.tribute.type) && c.tribute.type) out.unresolved.push({ kind: "tribute_type", name: c.tribute.type });
      const hid = await byName(c.tribute.name);
      raw.tribute = { type, donorId: hid, name: c.tribute.name, notifyName: c.tribute.notifyName || null };
    }
    if (c.matchEmployer) {
      const eid = await byName(c.matchEmployer, { create: true, kind: "organisation" });
      if (eid && eid !== gift.donor_id) raw.match = { employerId: eid };
    }
    const ck = await checkGiftExtras(orgId, gift.donor_id, cents, raw);
    if (ck.errors || ck.notFound) { out.unresolved.push({ kind: "gift_credit", name: giftId, why: (ck.errors || ["not found"]).join("; ") }); continue; }
    const r = await writeGiftExtras(orgId, gift, ck.extras, { actorId: who.id, actorName: who.name });
    out.softCredits += r.softCredits; if (ck.extras.tribute) out.tributes++;
    if (r.tributeNotice) out.tributeNotices++; if (r.matchPledgeId) out.matches++;
  }
  return out;
}
return { DEPOSIT_REVERSE_HOURS, IMPORT_RUN_ID_RE, IT, JQ, RECENT_WORK_ACTOR, UNDO_NOT_YOURS, buildAssigneeResolver, campaignIdResolver, duplicateGroupsFrom, importGiftExtras, importId, importLedger, importValueMapper, kickRecentWork, markImportInFlight, mayUndoImport, moveMod, normalizeName, queueRecentWork, recalcDonorSummaryBatch, recentJobs, uniqueImportName, withSavepoint, wrapImport, writeImportReadoutOnce };
}

module.exports = { mount };

// server/imports/combined.js — the combined import of people and gifts in one file (/donors/import-combined).
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const lapseRule = require("../../lapseRule");   // FIX-49: the one lapse rule
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex

const routers = {
  r1: express.Router(),
};

// IMPORT-8 · THE PEOPLE ALREADY IN THE ORG, read once for the write and for
// the workbook screen's preview ("1,481 already in Steward, 4,914 new"), so
// the two can never disagree. Moved out of the route verbatim; the name key
// (existingByName) is new: a row with no email and no ID, or one whose only
// namesake here has no email, is that person when exactly one person in the
// org has the name (on 4 Nov a 6,424-row workbook would have duplicated 1,701).
async function loadExistingPeople(q, orgId) {
  const { donorIdKey } = await import("../../shared/importShape.js");
  const existingEmailRows = await q(
    "SELECT id, name, LOWER(email) AS e, external_donor_id FROM donors WHERE org_id=? AND email IS NOT NULL AND email != '' AND deleted_at IS NULL ORDER BY created_at, id",
    [orgId]
  );
  const existingByEmail = new Map();
  for (const r of existingEmailRows) if (!existingByEmail.has(r.e)) existingByEmail.set(r.e, r.id);
  // BUILD-88a A.7 — a shared email is a HOUSEHOLD, not a person. Two people
  // behind kanefamily59@gmail.com are two records; matching the second import
  // of Marilyn to Gerald because they share an inbox is the same merge this
  // part exists to stop, one run later. When the caller has already resolved
  // identity, an existing donor is claimed by email AND a compatible name
  // (the ONE name-matching seam, shared/importShape.js).
  const { matchNameKey, matchNamesCompatible } = await import("../../shared/importShape.js");
  const existingHouseholds = new Map();   // email → [{ id, mk }]
  for (const r of existingEmailRows) {
    if (!existingHouseholds.has(r.e)) existingHouseholds.set(r.e, []);
    existingHouseholds.get(r.e).push({ id: r.id, mk: matchNameKey(r.name), extKey: donorIdKey(r.external_donor_id) });
  }
  // ── TRANS-1 Part 4 — THE OLD SYSTEM'S OWN ID MATCHES FIRST ──────────────
  // An import used to match a person by email and nothing else, while
  // `external_donor_id` was written on the way in and never read again. That
  // is the whole re-import story: a director who fixes a typo'd address in
  // DonorPerfect and exports again got a SECOND record, because the only key
  // Steward matched on was the one she had just changed. Her own system's id
  // is the stable key and it is now the first one tried — email, then name,
  // stay exactly as they were behind it.
  const existingByExtId = new Map();
  const extIdRows = await q(
    `SELECT id, external_donor_id, external_donor_ids FROM donors
       WHERE org_id=? AND deleted_at IS NULL
         AND (external_donor_id IS NOT NULL OR external_donor_ids IS NOT NULL)
       ORDER BY created_at, id`, [orgId]);
  for (const r of extIdRows) {
    const ids = [r.external_donor_id, ...(Array.isArray(r.external_donor_ids) ? r.external_donor_ids : [])];
    for (const one of ids) {
      const k = donorIdKey(one);
      if (k && !existingByExtId.has(k)) existingByExtId.set(k, r.id);
    }
  }
  const existingMatch = (emailLower, name, extKey) => {
    const list = existingHouseholds.get(emailLower);
    if (!list || !list.length) return undefined;
    // FIX-33: two DIFFERENT ids from the old system are two records there.
    // An email alone does not join them; only an email AND a compatible name
    // does. Without this, which of a file's twins merged depended on whether
    // they fell in the same 500-donor chunk: "Sam Sanchez" (D20001) was folded
    // into "Samantha Sanchez" (D10610) only because chunk one had committed
    // her first. The pair stays two records and waits in Data health.
    if (list.length === 1) {
      const only = list[0];
      if (extKey && only.extKey && only.extKey !== extKey && !matchNamesCompatible(only.mk, matchNameKey(name))) return undefined;
      return only.id;
    }
    const mk = matchNameKey(name);
    const hit = list.find(x => matchNamesCompatible(x.mk, mk));
    return hit ? hit.id : undefined;   // a name nobody at that address answers to is a NEW member of the household
  };
  const existingByName = new Map();   // name key → [{ id, hasEmail, extKey }]
  for (const r of await q("SELECT id, name, email, external_donor_id FROM donors WHERE org_id=? AND deleted_at IS NULL", [orgId])) {
    const k = (matchNameKey(r.name) || {}).key; if (!k) continue;
    if (!existingByName.has(k)) existingByName.set(k, []);
    existingByName.get(k).push({ id: r.id, hasEmail: !!String(r.email || "").trim(), extKey: donorIdKey(r.external_donor_id) });
  }
  return { existingByEmail, existingByExtId, existingMatch, existingByName, matchNameKey };
}
// One rule for "this row is someone already here", in the order the write
// tries it: the old system's ID, the email (with a compatible name when the
// file's identity was resolved), then a name only one person here has.
function existingFor(E, d, { identityResolved, donorIdKey }) {
  const extKey = donorIdKey(d.externalDonorId);
  if (extKey && E.existingByExtId.has(extKey)) return { id: E.existingByExtId.get(extKey), how: "externalId" };
  const emailLower = String(d.email || "").toLowerCase().trim();
  if (emailLower) {
    const id = identityResolved ? E.existingMatch(emailLower, d.name, extKey) : E.existingByEmail.get(emailLower);
    if (id) return { id, how: "email" };
  }
  const nk = (E.matchNameKey(d.name) || {}).key;
  const list = (nk && E.existingByName.get(nk)) || [];
  if (list.length === 1 && (!emailLower || !list[0].hasEmail) && !(extKey && list[0].extKey && list[0].extKey !== extKey)) return { id: list[0].id, how: "name" };
  return null;
}

function mount(ctx) {
const {
  IMPORT_DONOR_BATCH, IMPORT_GIFT_BATCH, IMPORT_RUN_ID_RE, IT, MB_READY, PT_READY, actor, birthdayMod,
  buildAssigneeResolver, campaignIdResolver, cfEvent, cfShape, checkPlanLimit, checkRecordBand,
  checkWriteAccess, duplicateGroupsFrom, ensureOrgLedger, importGiftExtras, importId, importLedger,
  importValueMapper, keepImportedTotals, kickRecentWork, loadCfDefs, markDonorsForGeocoding,
  markImportInFlight, membershipSettings, normalizeGiftDate, normalizeName, orgFiscalYearStart, orgPlanTier,
  orgToday, orgTz, parseMoneyOrThrow, query, queryTx, queueRecentWork, rateLimitDisabled,
  recalcDonorSummaryBatch, requireAuth, round2, run, runTx, toCents, toDollars, uuid, validateCustomFields,
  withAdvisoryLock, withSavepoint, withTransaction, wrapImport,
} = ctx;
let MB = null;
MB_READY.then(m => { MB = m; });
let PT = null;
PT_READY.then(m => { PT = m; });

// NUMBERS-4: from this many new people, a combined import refreshes the
// planner's statistics once it commits (see after its transaction below).
const IMPORT_ANALYZE_AT = 1000;
let app = routers.r1;

app.post("/donors/import-combined", requireAuth, checkWriteAccess, wrapImport(async (req, res) => {
  markImportInFlight(req.user.orgId, res);   // FIX-37: the background job waits for this request
  const { donors, gifts } = req.body;
  // BUILD-82 Part 2.5 — a gift sheet imported ALONE links to the donors the
  // org already has (Donor ID first, then email, then name); donors may be
  // empty in that mode and no new donor is ever minted from a bare id.
  const linkToExisting = req.body.linkToExisting === true;
  if (!Array.isArray(donors) || (!donors.length && !linkToExisting))
    return res.status(400).json({ error: "donors array required" });
  if (!Array.isArray(gifts))
    return res.status(400).json({ error: "gifts array required" });

  // The link-key normalisation must match shared/importShape.js donorIdKey
  // (4212 ≡ "004212" ≡ "4212.0" ≡ " 4212 ") — the client and this resolver
  // read the same seam via dynamic import so there is exactly one.
  const { donorIdKey } = await import("../../shared/importShape.js");
  const buildExistingResolver = async (q) => {
    const rows = await q(
      `SELECT id, external_donor_id, external_donor_ids, LOWER(email) AS e, LOWER(name) AS n
         FROM donors WHERE org_id=? AND deleted_at IS NULL`, [req.user.orgId]);
    const byExt = new Map(), byEmail = new Map(), byName = new Map();
    for (const r of rows) {
      const ids = [r.external_donor_id, ...(Array.isArray(r.external_donor_ids) ? r.external_donor_ids : [])];
      for (const one of ids) { const k = donorIdKey(one); if (k && !byExt.has(k)) byExt.set(k, r.id); }
      if (r.e && !byEmail.has(r.e)) byEmail.set(r.e, r.id);
      if (r.n && !byName.has(r.n)) byName.set(r.n, r.id);
    }
    return (g) => {
      const k = donorIdKey(g.donorExternalId);
      if (k && byExt.has(k)) return byExt.get(k);
      const em = String(g.email || "").toLowerCase().trim();
      if (em && byEmail.has(em)) return byEmail.get(em);
      const nm = String(g.name || "").toLowerCase().trim();
      if (nm && byName.has(nm)) return byName.get(nm);
      return null;
    };
  };

  // IMPORT-8 · THE WORKBOOK SCREEN'S PREVIEW SAYS WHO IS ALREADY HERE. The
  // same rule the write uses (existingFor), before anything is written:
  // "1,481 already in Steward, 4,914 new". Reads only.
  if (req.body.dryRun === true && req.body.matchPeople === true) {
    const E = await loadExistingPeople(query, req.user.orgId);
    const byKey = { externalId: 0, email: 0, name: 0 };
    const ids = new Set();
    let matched = 0;
    const sample = [];
    for (const d of donors) {
      if (!d || !String(d.name || "").trim()) continue;
      const hit = existingFor(E, d, { identityResolved: req.body.identityResolved === true, donorIdKey });
      if (!hit) continue;
      matched++; byKey[hit.how]++; ids.add(hit.id);
      if (sample.length < 20) sample.push({ line: d._line || null, name: d.name, how: hit.how });
    }
    const named = donors.filter(d => d && String(d.name || "").trim()).length;
    return res.json({ dryRun: true, matchPeople: true, rows: named, matched, people: ids.size, new: named - matched, byKey, sample });
  }
  // TRUTH-3 item 5 · A FUND NAME CLOSE TO ONE SHE HAS IS ASKED, NOT CREATED
  // SILENTLY. A dry run with `fundCheck` lists every fund the file names that
  // is an existing fund in other words ("General" beside "General Operating":
  // server/finance/fundMerge.js fundKey). The write then takes her answers in
  // `fundMatches` ({ "General": "<fund id>" } uses that fund; "new" makes one).
  if (req.body.dryRun === true && req.body.fundCheck === true) {
    const FM = require("../finance/fundMerge");
    const names = [...new Set((gifts || []).map(g => String((g && g.fund) || "").trim()).filter(Boolean))];
    const fundQuestions = [];
    for (const name of names) {
      const near = await FM.closeFund(query, req.user.orgId, name);
      if (near) fundQuestions.push({ file: name, existing: { id: near.id, name: near.name },
        sentence: `The file names "${name}", and you have a fund called "${near.name}". Is it the same fund?` });
    }
    return res.json({ dryRun: true, fundCheck: true, fundQuestions });
  }
  // Dry run: resolve and report BEFORE anything is written — the pre-write
  // summary for a gift-sheet-alone import states its link counts honestly.
  if (linkToExisting && req.body.dryRun === true) {
    const resolve = await buildExistingResolver(query);
    let byKey = { donorId: 0, email: 0, name: 0 };
    const refused = [];
    for (const g of gifts) {
      const id = resolve(g);
      if (!id) { refused.push({ line: g.line || null, id: g.donorExternalId || "", reason: "no_donor_match" }); continue; }
      if (donorIdKey(g.donorExternalId)) byKey.donorId++; else if (g.email) byKey.email++; else byKey.name++;
    }
    return res.json({ dryRun: true, linkable: gifts.length - refused.length, byKey, refused: refused.slice(0, 2000), refusedCount: refused.length });
  }

  const orgId = req.user.orgId;

  // ── TRANS-1 Part 3 — THE RUN ID EXISTS BEFORE THE WRITE ─────────────────
  // `import_id` was a deposit-only column: the file importer never stamped
  // it, because the `imports` row is recorded by the client AFTER the write,
  // so the id did not exist yet. That is also why the Move Report could not
  // scope "what Steward holds from THIS file" to anything.
  //
  // The client now mints the run id first and passes it here and to
  // POST /imports, so one file's gifts and the people it created carry it.
  // A chunked import passes the SAME id for every chunk, which is what makes
  // the report whole rather than per-chunk. An absent or malformed id leaves
  // the column NULL and behaves exactly as before.
  const runId = IMPORT_RUN_ID_RE.test(String(req.body.importId || ""))
    ? String(req.body.importId) : null;

  // Plan limit check (same as /donors/import)
  const orgForLimit = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  if (orgForLimit.length) {
    const recordCheck = await checkPlanLimit(orgForLimit[0], "records");
    if (!recordCheck.isTrial && recordCheck.limit !== 999999999) {
      const validCount = donors.filter(d => d.name).length;
      const remaining = recordCheck.limit - recordCheck.current;
      if (remaining <= 0 || validCount > remaining) {
        return res.status(403).json({
          error: "record_limit",
          message: remaining <= 0
            ? `You've reached your donor record limit of ${recordCheck.limit}.`
            : `This import would add ${validCount} records but you can only add ${remaining} more.`,
          current: recordCheck.current, limit: recordCheck.limit,
          allowed: Math.max(0, remaining), plan: orgForLimit[0].plan, isTrial: false,
        });
      }
    }
  }

  // BUILD-72 Part 1 — the reconciliation ledger for THIS request. The client
  // chunks a large file 500 donors at a time and sums these across chunks for
  // the file-level figure the summary screen shows.
  const ledger = importLedger("donors+gifts");
  // The user's explicit deselections from the pre-commit duplicate review.
  // Absent (a headless import, or a user who clicked straight through) = KEEP
  // ALL: the failure mode of this design is a duplicate the user can delete,
  // never a gift that vanished. Those are not symmetrical.
  const skipRowKeys = new Set(Array.isArray(req.body.skipRowKeys) ? req.body.skipRowKeys : []);
  let roundingAdjustment = 0;
  let duplicateGroups = [];
  let sabotageBudget = rateLimitDisabled() ? (Number(req.body.__sabotageDropRows) || 0) : 0;
  // Hoisted above the transaction: the post-commit recalcs and the response
  // below read these, and they must survive the callback's scope.
  let externalIdDupes = 0, externalIdCollisionCount = 0;
  // TRANS-1 Part 4 — how each person was matched, so a re-import's own small
  // report can say it. Counted here rather than derived, because "matched by
  // the old system's id" is the claim the move is sold on.
  let matchedByExternalId = 0, matchedByEmail = 0, matchedByName = 0;
  const matchedExtIdFills = [];   // matched donors whose source id we did not hold yet
  const matchedBirthdayFills = []; // PARITY-3 6a: matched people with no birthday on file yet
  const matchedAboutFills = [];    // DATES-1: matched people with no "About them" yet
  const matchedWealthFills = [];   // WEALTH-1: matched people with no Wealth Score yet
  let giftsInserted = 0, financeSynced = 0, fundsCreated = 0;
  // IMPORT-2 item 4: every Notes / Comments / Background cell becomes a dated
  // note on the person, once per person per wording, tagged with this run so
  // the run's undo removes it. It used to ride only on the gift line.
  const importNoteSeen = new Set();
  let importNotesCreated = 0;
  let duplicateCandidates = { withinFile: 0, samples: [] };
  let matchesExistingCount = 0;
  const affectedDonorIds = new Set();
  const matchedCfMerges = [];   // BUILD-78 — custom values for donors matched rather than created

  // ── BUILD-78 Part 3 — THE COLUMN AXIS. The client computes the physical
  // column count ONCE at parse entry and sends the disposition ledger as a
  // SEPARATE structure; this check refuses the write when they disagree.
  // Exactly one disposition per column, from the closed set — a metric whose
  // left side is derived from its right side cannot fail, so the two sides
  // arrive independently and are compared here, before anything is written.
  let columnSummary = null;
  if (req.body.columns) {
    const { summarizeColumnLedger } = await cfShape();
    const inFile = Number(req.body.columns.inFile) || 0;
    columnSummary = summarizeColumnLedger(inFile, Array.isArray(req.body.columns.ledger) ? req.body.columns.ledger : []);
    if (!columnSummary.balanced) {
      return res.status(409).json({
        error: "columns_unreconciled",
        message: `your file has ${inFile} columns but ${columnSummary.accounted} have a disposition${columnSummary.counts.invalid ? ` (${columnSummary.counts.invalid} invalid)` : ""}: nothing was imported`,
        columns: columnSummary,
      });
    }
  }

  // ── BUILD-78 — custom-field values ride the rows as RAW strings and are
  // validated HERE, through the one seam, before the transaction opens. The
  // client refuses bad rows with line numbers before submitting; a value
  // failing here means a client bug, and the answer is refusal, not storage.
  const cfDonorDefs = await loadCfDefs("donor", orgId);
  const cfGiftDefs = await loadCfDefs("gift", orgId);
  const cfDelims = req.body.customFieldDelimiters || {};   // key → declared delimiter (multi-select, mapping time)
  const cfRefused = [];
  const donorCfById = new Map();   // donorIndex → validated {key: storedValue}
  for (let i = 0; i < donors.length; i++) {
    if (!donors[i].customFields) continue;
    const v = await validateCustomFields("donor", orgId, donors[i].customFields, { defs: cfDonorDefs, delimiters: cfDelims });
    if (!v.ok) { cfRefused.push({ donorIndex: i, entity: "donor", errors: v.errors }); continue; }
    donorCfById.set(i, v.values);
  }
  const giftCfByIdx = new Map();   // gift array index → validated values
  for (let i = 0; i < gifts.length; i++) {
    if (!gifts[i].customFields) continue;
    const v = await validateCustomFields("gift", orgId, gifts[i].customFields, { defs: cfGiftDefs, delimiters: cfDelims });
    if (!v.ok) { cfRefused.push({ giftIndex: i, entity: "gift", errors: v.errors }); continue; }
    giftCfByIdx.set(i, v.values);
  }
  if (cfRefused.length) {
    return res.status(422).json({ error: "custom_field_values_refused",
      message: `${cfRefused.length} row(s) carry custom-field values the field definitions refuse, nothing was imported`,
      refused: cfRefused.slice(0, 20) });
  }

  // Importer identity
  const importerRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const importerName = importerRow[0]?.name || "";
  const importerId   = req.user.userId;

  // Owner-column assignment (Team only) — mirrors /donors/import. Per-donor
  // `assignedTo` from a mapped owner column routes each donor to its officer's
  // portfolio (in_pipeline). Core orgs → no-op (imported unassigned).
  const isTeamOrg = orgForLimit.length ? orgPlanTier(orgForLimit[0]) === "team" : false;
  const resolveAssignee = await buildAssigneeResolver(donors, orgId, isTeamOrg);

  // BUILD-27 Part C (scenario 3): serialize the email dedup + donor insert for
  // THIS org so two parallel imports can't both pre-load the email set, both miss
  // each other's in-flight rows, and both insert an overlapping donor. The
  // advisory lock makes the check-then-insert dedup atomic per org (different orgs
  // still import fully in parallel) WITHOUT a hard UNIQUE(email) the product can't
  // have — duplicate emails are legitimately possible and the merge tool handles
  // them. Shared results are hoisted out so the gift-attach step below can use them.
  let duplicates = 0;
  let created = 0;
  const donorsToInsert = [];
  const indexToId = {}; // donorIndex → the donor id this row's gifts belong to
                        // (newly generated, OR an existing donor we matched)
  const matchedIds = new Set(); // donors we matched rather than created
  let namelessRows = 0;         // donor rows with no usable name — counted, never silent
  const explicitStageIds = []; // donors whose file had an explicit stage column — never re-inferred over
  const batchErrors = [];
  const failedIds = new Set(); // IDs whose batch failed — drop their gifts too
  // 46 params/row → 46,000 of Postgres's 65,535 bound-parameter cap. Halves the
  // donor round trips (51 batches → 26) for the same reason as GIFT_BATCH.
  const DONOR_BATCH = IMPORT_DONOR_BATCH;

  // BUILD-72 Part 1 — ONE transaction for the whole request. The reconciliation
  // invariant is asserted before it commits, so an import that does not balance
  // rolls back in full rather than landing a short count. Individual batches run
  // inside SAVEPOINTs so one bad batch is survivable AND counted, instead of
  // killing the request or (as before) vanishing into a warning nobody reads.
  const pendingGiftCredit = [];   // BUILD-98 Part 1 — soft credits/tributes/matches, applied after commit
  const recentGiftsToRecord = [];   // LIVE-1 — gifts from the last 30 days, written by recordGift after commit
  let recentQueued = 0;
  // FIX-37: the run the background work belongs to (an API caller that sent
  // no run id gets one), and the answer to "already thanked?". An import that
  // arrives without an answer gets the same default the preview offers.
  const jobRunId = runId || importId("imp_");
  let thanksAnswer = IT.cleanAnswer(req.body.thanks);
  if (!thanksAnswer) {
    const today0 = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
    const recentN = (Array.isArray(req.body.gifts) ? req.body.gifts : [])
      .filter(g => g && g.date && !require("../../historyGifts").isOldHistory(String(g.date).slice(0, 10), today0)).length;
    const d = IT.defaultAnswer({ firstImport: await IT.isFirstImport(query, orgId, runId),
      system: await IT.recognizeSystem(req.body.headers), count: recentN });
    thanksAnswer = { mode: d.mode };
  }
  await withAdvisoryLock(`import:${orgId}`, async () => {
  await withTransaction(async (txc) => {
  // Email dedup. BUILD-72 Part 1: the dedup now keeps the EXISTING donor's ID
  // instead of throwing it away. That one change is the whole 0.1b fix — a
  // matched donor used to get no `indexToId` entry, and the gift loop below
  // then discarded EVERY GIFT THEY BROUGHT, silently, with a 200 and a summary
  // that only ever mentioned donors. A second file with two known donors and
  // $1,800 of new gifts landed $0. Matching a donor is not a reason to lose
  // their money; it is the reason to attach it to the right record.
  // IMPORT-8: who in the file is already in the org, read by one helper that
  // the workbook screen's preview (dryRun + matchPeople) asks too.
  const E = await loadExistingPeople((sql, params) => queryTx(txc, sql, params), orgId);
  const { existingByEmail, existingByExtId, existingMatch } = E;
  // BUILD-82 Part 2.5 — the existing-record resolver for a gift-sheet-alone
  // import, built INSIDE the transaction so it sees a consistent snapshot.
  const resolveExisting = linkToExisting ? await buildExistingResolver((sql, params) => queryTx(txc, sql, params)) : null;
  const seenEmails = new Map(); // within-file email → the id we already assigned it

  // Generate all donor IDs in JS before inserting — gifts reference these IDs directly,
  // no extra round trip needed.
  // BUILD-82 — identityResolved: the workbook flow runs the FULL identity
  // pass client-side (ID → email-with-compatible-name → phone, with a review
  // list and undo) BEFORE submitting. The blunt within-file email fold here
  // would undo that work — two household members legitimately share an
  // address book — so it is skipped; matching against donors ALREADY on file
  // still applies.
  const identityResolved = req.body.identityResolved === true;
  const seenExtIds = new Map();   // within-file source id → the id we assigned it
  // One place decides that a row is somebody we already hold, and in what
  // order the keys are tried. TRANS-1 Part 4 put the source id in front.
  const claimMatch = (idx, d, priorId, how) => {
    duplicates++; indexToId[idx] = priorId; matchedIds.add(priorId);
    if (how === "externalId") matchedByExternalId++; else if (how === "email") matchedByEmail++;
    // BUILD-78 4.5 — a matched donor's custom values FILL MISSING keys
    // only: a re-run never clobbers what is already on the record.
    const cfv = donorCfById.get(idx);
    if (cfv && Object.keys(cfv).length) matchedCfMerges.push({ donorId: priorId, values: cfv });
    // PARITY-3 6a — and a birthday, fill-missing the same way.
    if (d.birthday && typeof d.birthday === "object") matchedBirthdayFills.push({ donorId: priorId, b: d.birthday });
    // DATES-1 — and "About them", fill-missing the same way.
    if (d.aboutThem) matchedAboutFills.push({ donorId: priorId, text: d.aboutThem });
    // WEALTH-1 — and a Wealth Score, fill-missing the same way (a score somebody set is never overwritten).
    if (d.wealthScore != null) matchedWealthFills.push({ donorId: priorId, n: d.wealthScore });
    // A person matched by email who ALSO carries a source id teaches Steward
    // that id, so the NEXT export matches on the stable key even if she
    // corrects the address in the old system first. Fill-missing only, and
    // deliberately NOT added to `existingByExtId`: within this one file the
    // match order stays exactly what it was, so a second row carrying the
    // same id but a different person cannot be pulled onto this record by an
    // id we only just inferred.
    const k = donorIdKey(d.externalDonorId);
    if (how !== "externalId" && k && !existingByExtId.has(k)) {
      matchedExtIdFills.push({ donorId: priorId, externalDonorId: String(d.externalDonorId) });
    }
  };
  donors.forEach((d, idx) => {
    if (!d.name || !String(d.name).trim()) { namelessRows++; return; }
    const emailLower = (d.email || "").toLowerCase().trim();
    // 1. The old system's own id. It is the key that does not change when a
    //    fundraiser fixes a name or an address, so it is tried first, and it
    //    applies whether or not the client resolved identity: an id is an id.
    const extKey = donorIdKey(d.externalDonorId);
    if (extKey) {
      const byId = existingByExtId.get(extKey) || (identityResolved ? undefined : seenExtIds.get(extKey));
      if (byId) { claimMatch(idx, d, byId, "externalId"); return; }
    }
    if (emailLower) {
      // 2. Already on file, or already claimed earlier in THIS file → route this
      // row's gifts to that donor. `duplicates` still counts donors not
      // created, so the existing summary sentence stays true.
      const priorId = (identityResolved ? existingMatch(emailLower, d.name, extKey) : existingByEmail.get(emailLower))
        || (identityResolved ? undefined : seenEmails.get(emailLower));
      if (priorId) { claimMatch(idx, d, priorId, "email"); return; }
    }
    // 3. IMPORT-8: a name only one person in the org has, when no email or ID
    //    on either side says they are two people (existingFor, the preview's rule)
    {
      const hit = existingFor(E, d, { identityResolved, donorIdKey });
      if (hit && hit.how === "name") { matchedByName++; claimMatch(idx, d, hit.id, "name"); return; }
    }
    const id = importId("d_");
    if (emailLower && !identityResolved) seenEmails.set(emailLower, id);
    if (extKey) seenExtIds.set(extKey, id);
    indexToId[idx] = id;
    donorsToInsert.push({ ...d, _id: id, _cfValidated: donorCfById.get(idx) || null });
    if (d._stageExplicit) explicitStageIds.push(id);
  });

  // ── Bulk-insert donors (500/batch, one multi-row INSERT per batch) ──
  for (let bi = 0; bi < donorsToInsert.length; bi += DONOR_BATCH) {
    const batch = donorsToInsert.slice(bi, bi + DONOR_BATCH);
    const params = [];
    const tuples = batch.map(d => {
      const a = resolveAssignee(d);
      params.push(
        d._id, orgId, normalizeName(d.name), d.email||"", d.phone||"",
        d.status||"new",
        // BUILD-83 Part 3.5 — only a stage the FILE stated is a stage; anything
        // inferred is a suggestion and `stage` stays NULL until a human places
        // them. (The post-insert pass below fills suggested_stage from history.)
        d._stageExplicit ? (d.stage || null) : null,
        toDollars(toCents(d.total)||0), toDollars(toCents(d.lastAmount)||0),  // BUILD-73: cents preserved
        d.lastGift||null, parseInt(d.gifts)||(d.total?1:0),
        JSON.stringify(Array.isArray(d.tags)?d.tags:[]),
        d.notes||"", d.city||null, d.state||null,
        a.id, a.name,   // assigned_to / assigned_to_name — Team owner-column routing.
        // Assignment IS board membership (BUILD-30): no separate in_pipeline flag.
        a.pendingInviteId, a.pendingName,   // pending assignment held for an invited-but-not-accepted officer
        // BUILD-58 Part 2: deceased / do-not-contact — never silently discarded.
        d.deceased === true || d.deceased === "true",
        d.doNotContact === true || d.doNotContact === "true",
        // BUILD-77 Part 1: the flag FAMILY + address/zip + the sustainer state
        // — scanned from free text by the importer, confirmed by a human on
        // the summary's "we flagged these" list.
        d.doNotSolicit === true, d.doNotMail === true, d.doNotEmail === true,
        d.deceasedDate || null, d.address || null, d.zip || null,
        d.importedSustainer === true,
        d.importedSustainerAmount != null ? toDollars(toCents(d.importedSustainerAmount) || 0) : null,
        d.importedSustainerLastGift || null,
        // BUILD-78 — validated through the ONE seam above; raw never lands.
        d._cfValidated && Object.keys(d._cfValidated).length ? JSON.stringify(d._cfValidated) : null,
        // BUILD-80 Part 6 — the source system's donor id, TEXT, as given.
        d.externalDonorId || null,
        // BUILD-80 Part 7 — organisation / anonymous, never a person surface.
        d.kind || null,
        // BUILD-84 P0-2 — the person on an organization's row.
        d.contactName || null,
        // BUILD-82 — the standard list is complete; these arrive whole.
        d.middleName || null, d.suffix || null, d.salutation || null, d.spouse || null,
        d.email2 || null, d.mobile || null, d.address2 || null, d.country || null,
        d.donorType || null, d.board === true,
        d.householdId || null,
        Array.isArray(d.externalDonorIds) && d.externalDonorIds.length ? JSON.stringify(d.externalDonorIds) : null,
        d.firstGift || null,
        // BUILD-83 Part 3.5 — the inference the CLIENT made (from the aggregate
        // total/last-gift columns) is a suggestion too, and it is the only one a
        // donor with no gift rows will ever get: the post-insert pass below only
        // revisits donors whose gifts landed. Without this a gift-less prospect
        // came out of the import with no stage and no suggestion at all.
        // …and a donor the file says nothing about is still a PROSPECT — the
        // default the insert always used. A suggestion of "we don't know yet"
        // is a suggestion; leaving it null would drop them off every board.
        d._stageExplicit ? null : (d.stage || "prospect"),
        // BUILD-94 Part 2 — the combined/workbook path could not type a
        // person, so a file carrying volunteers imported all of them as
        // donors and quietly moved every giving total. Same rule as the
        // donor-only path: nothing stated ⇒ a donor, which is what every
        // pre-BUILD-94 file meant.
        JSON.stringify(PT.normalizeTypes(d.personTypes === undefined ? ["donor"] : d.personTypes)),
        // TRANS-1 Part 3 — the run that created this person, so the Move
        // Report can count the people one file brought.
        runId
      );
      return "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
    });
    // SAVEPOINT, not a nested transaction: we are already inside the request's
    // one transaction, so a failed batch must be rolled back to a point rather
    // than poisoning everything after it.
    const r = await withSavepoint(txc, `dbatch_${bi}`, () => runTx(txc,
      `INSERT INTO donors
         (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,
          last_gift_date,gift_count,tags,notes,city,state,assigned_to,assigned_to_name,
          pending_assignee_invite_id,pending_assignee_name,deceased,do_not_contact,
          do_not_solicit,do_not_mail,do_not_email,deceased_date,address,zip,
          imported_sustainer,imported_sustainer_amount,imported_sustainer_last_gift,custom_fields,external_donor_id,kind,contact_name,
          middle_name,suffix,salutation,spouse_name,email2,mobile,address2,country,
          donor_type,board_member,external_household_id,external_donor_ids,first_gift_date,suggested_stage,
          person_types,created_import_id)
       VALUES ${tuples.join(",")}`,
      params
    ));
    if (r.ok) {
      created += batch.length;
      // BUILD-98 (switch) Part 6 — a wealth screen the old CRM carried lands on
      // its own four columns, as the vendor wrote it, inside the same savepointed
      // transaction as the person it belongs to.
      for (const d of batch) {
        const w = wealthScreenParams(d);
        if (w) await runTx(txc, `UPDATE donors SET wealth_screen_source=?, wealth_screen_rating=?, wealth_screen_capacity=?, wealth_screen_date=?
                                   WHERE id=? AND org_id=?`, [w.source, w.rating, w.capacity, w.date, d._id, orgId]);
      }
      // PARITY-3 6a — a birthday the file carried, re-checked here rather than
      // trusted from the browser. Half a birthday, or February 30, is dropped.
      const _B = await birthdayMod();
      for (const d of batch) {
        const b = d.birthday;
        if (!b || typeof b !== "object") continue;
        const y = b.year == null || b.year === "" ? null : Number(b.year);
        if (!_B.validBirthday(Number(b.month), Number(b.day), y)) continue;
        await runTx(txc, `UPDATE donors SET birth_month=?, birth_day=?, birth_year=? WHERE id=? AND org_id=?`,
          [Number(b.month), Number(b.day), y, d._id, orgId]);
      }
      // DATES-1 — "About them", held to the profile's 500 characters.
      for (const d of batch) {
        const a = String(d.aboutThem || "").trim().slice(0, 500);
        if (a) await runTx(txc, `UPDATE donors SET about_them=? WHERE id=? AND org_id=?`, [a, d._id, orgId]);
      }
      // WEALTH-1 — her own Wealth Score column, re-checked here (1 to 5 only), set by her.
      for (const d of batch) {
        const n = Number(d.wealthScore);
        if (Number.isInteger(n) && n >= 1 && n <= 5) await runTx(txc,
          `UPDATE donors SET wealth_rating=?, wealth_rating_set_at=NOW(), wealth_rating_set_by=?, wealth_rating_set_by_name=? WHERE id=? AND org_id=?`,
          [n, actor(req).id, actor(req).name, d._id, orgId]);
      }
    } else {
      console.error(`[combined-import] donor batch ${bi}–${bi+batch.length} failed:`, r.error.message);
      batchErrors.push({ rows:`${bi+1}–${bi+batch.length}`, error:r.error.message });
      batch.forEach(d => failedIds.add(d._id));
    }
  }

  // BUILD-78 — matched donors: fill-missing merge of the file's custom
  // values (existing keys win; a re-run never claws a record backwards).
  for (const m of matchedCfMerges) {
    await runTx(txc,
      `UPDATE donors SET custom_fields = ?::jsonb || COALESCE(custom_fields, '{}'::jsonb) WHERE id=? AND org_id=?`,
      [JSON.stringify(m.values), m.donorId, orgId]);
  }

  // TRANS-1 Part 4 — teach a matched record the source id it arrived with, so
  // the NEXT export matches on the key that does not change. Fill-missing
  // only: `external_donor_id IS NULL` is in the WHERE, so a record that
  // already answers to an id is never repointed at another one.
  for (const f of matchedExtIdFills) {
    await runTx(txc,
      `UPDATE donors SET external_donor_id = ? WHERE id=? AND org_id=? AND external_donor_id IS NULL`,
      [f.externalDonorId, f.donorId, orgId]);
    // IMPORT-2: a record that already answers to one id still learns this one
    // as an id it ALSO answers to, never in place of the first. A history file
    // that names the second id then finds the person.
    await runTx(txc,
      `UPDATE donors SET external_donor_ids = COALESCE(external_donor_ids, '[]'::jsonb) || jsonb_build_array(?::text)
        WHERE id=? AND org_id=? AND external_donor_id IS NOT NULL AND external_donor_id <> ?
          AND NOT (COALESCE(external_donor_ids, '[]'::jsonb) @> jsonb_build_array(?::text))`,
      [f.externalDonorId, f.donorId, orgId, f.externalDonorId, f.externalDonorId]);
  }
  for (const f of matchedWealthFills) {   // WEALTH-1
    const n = Number(f.n);
    if (Number.isInteger(n) && n >= 1 && n <= 5) await runTx(txc,
      `UPDATE donors SET wealth_rating=?, wealth_rating_set_at=NOW(), wealth_rating_set_by=?, wealth_rating_set_by_name=? WHERE id=? AND org_id=? AND wealth_rating IS NULL`,
      [n, actor(req).id, actor(req).name, f.donorId, orgId]);
  }
  for (const f of matchedAboutFills) {
    const a = String(f.text || "").trim().slice(0, 500);
    if (a) await runTx(txc, `UPDATE donors SET about_them=? WHERE id=? AND org_id=? AND (about_them IS NULL OR about_them='')`, [a, f.donorId, orgId]);
  }
  if (matchedBirthdayFills.length) {
    const _B = await birthdayMod();
    for (const f of matchedBirthdayFills) {
      const y = f.b.year == null || f.b.year === "" ? null : Number(f.b.year);
      if (!_B.validBirthday(Number(f.b.month), Number(f.b.day), y)) continue;
      await runTx(txc,
        `UPDATE donors SET birth_month=?, birth_day=?, birth_year=? WHERE id=? AND org_id=? AND birth_month IS NULL`,
        [Number(f.b.month), Number(f.b.day), y, f.donorId, orgId]);
    }
  }

  // ── Build gift+interaction records ──
  // Filter to gifts whose donor was actually inserted (not deduped or batch-failed).
  // §1.2 F-4 — (donor, amount, date) is NEVER a dedup key: forty $100 Sunday
  // gifts in a transaction export are forty gifts, and the old silent collapse
  // here dropped 39 of them. The ONLY gift-level dedup is an explicit
  // external-ID column from the source system (unique per org at the DB —
  // uq_gifts_external — so a re-run with IDs is also cross-run idempotent).
  // Same-(donor,amount,date) twins WITHOUT an external ID are all inserted and
  // COUNTED into duplicateCandidates so a human can review the report — never
  // silently collapsed.
  // ── BUILD-88a A.7 — AN ID THAT REPEATS IS NOT ALWAYS A DUPLICATE ────────
  // Mapping "Legacy ID" to the standard gift id (A.7) made a latent rule
  // visible: the external id was treated as globally unique, so ANY repeat was
  // dropped as "already imported". In the 2,500-row file 28 pairs of rows share
  // a legacy number and are plainly different gifts — different donors,
  // different dates, different amounts. A four-digit legacy number collides;
  // that is arithmetic, not duplication, and dropping those rows loses real
  // money behind a balanced-looking equation.
  //
  // THE RULE: an id identifies a gift only together with what the gift IS. A
  // repeat carrying the same date and amount is the same gift and still
  // dedupes (that is what makes a re-import a no-op). A repeat carrying a
  // DIFFERENT date or amount is an id collision: the row is imported, it does
  // NOT claim the id (external_id stays NULL, so the database's unique index
  // cannot drop it either), and the collision is counted and reported.
  const giftIdent = (date, amount) => `${date}|${amount}`;
  const externalIdsInRequest = [...new Set(gifts
    .map(g => (g.externalId || g.external_id || "").toString().trim().slice(0, 128))
    .filter(Boolean))];
  const existingByExternalId = new Map();
  if (externalIdsInRequest.length) {
    const rows = await queryTx(txc,
      "SELECT external_id, date, amount FROM gifts WHERE org_id=? AND external_id = ANY(?)",
      [orgId, externalIdsInRequest]);
    for (const r of rows) if (!existingByExternalId.has(r.external_id)) existingByExternalId.set(r.external_id, giftIdent(r.date, parseFloat(r.amount)));
  }
  const seenExternalIds = new Map(); // within-file external id → the gift it identifies
  const fpCounts = new Map();        // informational twin report, NOT a filter
  const giftsToInsert = [];
  // LIVE-1 · VALUES MAP THEMSELVES. What she said a file's value means ("CHK"
  // is a check, "Gala 25" is the Gala fund) is applied to every later file.
  const valueAs = await importValueMapper(orgId);
  // BUILD-72 Part 1 — every row announces itself to the ledger BEFORE any
  // routing decision, then lands in exactly one bucket. There is no `continue`
  // in this loop that does not first record where the row went.
  const importToday = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK — hoisted once for the future-date policy below
  for (let gi = 0; gi < gifts.length; gi++) {
    const g = gifts[gi];
    // BUILD-73 Part 2 — parsed to integer cents at the edge, stored exactly.
    // Was `Math.round(rawAmt)`, which is how $33.33 became $33 on the way in.
    const gCents = toCents(g.amount);
    const rawAmt = gCents === null ? (Number(g.amount) || 0) : toDollars(gCents);
    const amt    = rawAmt;                    // no rounding: what the file said is what lands
    ledger.saw(amt, 1, rawAmt);
    // Kept at 0 and still reported, so a client reading this field does not
    // break. It can only become non-zero if a rounding path is reintroduced —
    // which tests/money-cents.test.js fails on first.
    roundingAdjustment += round2(rawAmt - amt);

    const donorId = g.donorIndex != null ? indexToId[g.donorIndex]
      : (resolveExisting ? resolveExisting(g) : undefined);
    if (!donorId) { ledger.errored(g.donorIndex != null ? "donor_row_unusable" : "no_donor_match", amt); continue; }
    if (failedIds.has(donorId)) { ledger.errored("donor_batch_failed", amt); continue; }
    // BUILD-77 Part 3c — a NEGATIVE amount is a refund/adjustment row: it
    // imports as a negative gift (reducing the dollar total, not the row
    // count) so the donor's net lifetime is true. Only exact zero skips.
    if (amt === 0) { ledger.skipped("zero_amount", amt); continue; }

    const date = normalizeGiftDate(g.date);
    if (!date) { ledger.errored("unparseable_or_missing_date", amt); continue; }
    if (date > importToday) { ledger.errored("future_date", amt); continue; }   // Part 2c policy: a gift is a thing that happened
    const rowKey = `${donorId}|${date}|${amt}`;
    // The user's explicit deselection from the pre-commit review — the ONLY way
    // a row is dropped on purpose, and it is counted as such.
    if (skipRowKeys.has(rowKey)) { ledger.skipped("user_deselected", amt); continue; }

    let externalId = (g.externalId || g.external_id || "").toString().trim().slice(0, 128) || null;
    if (externalId) {
      const ident = giftIdent(date, amt);
      const seen = seenExternalIds.get(externalId);
      const onFile = existingByExternalId.get(externalId);
      if (seen !== undefined && seen === ident) {
        externalIdDupes++; ledger.skipped("external_id_repeated_in_file", amt); continue;
      }
      if (seen !== undefined || (onFile !== undefined && onFile !== ident)) {
        // A collision, not a duplicate: keep the money, surrender the id.
        externalIdCollisionCount++;
        externalId = null;
        fpCounts.set(rowKey, (fpCounts.get(rowKey) || 0) + 1);
      } else {
        seenExternalIds.set(externalId, ident);
      }
    } else {
      fpCounts.set(rowKey, (fpCounts.get(rowKey) || 0) + 1);
    }
    giftsToInsert.push({ donorId, amount:amt, date, type:g.type||"cash", campaign:g.campaign||"", notes:g.notes||"", externalId, rowKey,
      // BUILD-88a A.7 — the fund the gift is restricted to and the method the
      // money arrived by. Both columns were detected by the mapper and then
      // hardcoded to NULL here, which is why every imported gift in every org
      // has no fund and no payment method, and why a column with a standard
      // home read as "→ new custom field" on the receipt.
      fund: valueAs("fund", String(g.fund || "").trim().slice(0, 120)) || null,
      paymentMethod: valueAs("paymentMethod", String(g.paymentMethod || "").trim().slice(0, 60)) || null,
      // BUILD-98 Part 1 — the row's soft credit, tribute and matching employer,
      // as NAMES; written after the transaction commits (importGiftExtras).
      credit: (g.softCredit || g.tribute || g.matchEmployer)
        ? { softCredit: g.softCredit || null, tribute: g.tribute || null, matchEmployer: g.matchEmployer || null } : null,
      customFields: giftCfByIdx.get(gi) || null });   // BUILD-78 — validated above
  }
  duplicateCandidates = {
    withinFile: [...fpCounts.values()].filter(n => n > 1).reduce((s, n) => s + (n - 1), 0),
    samples: [...fpCounts.entries()].filter(([, n]) => n > 1).slice(0, 10)
      .map(([fp, n]) => { const [dId, date, amount] = fp.split("|"); return { donor: donorNameById(dId), amount: Number(amount), date, count: n }; }),
  };
  // The reviewable groups — same donor, same date, same amount. DETECTED and
  // SURFACED, never resolved automatically; every member is imported unless the
  // user deselects it by rowKey.
  //
  // TWO kinds, and the second is what makes a re-import honest. Since BUILD-72
  // a matched donor's gifts actually land (Part 0's 0.1b), so re-uploading the
  // same file genuinely creates a second set of gifts. That is the deliberate
  // trade — a duplicate the user can delete beats a gift they never learn about
  // — but it is only defensible if the user is TOLD. So rows matching a gift
  // already on file are flagged `matches_existing`, on top of within-file twins.
  // ── The sabotage seam (test-only, gated on DISABLE_RATE_LIMIT — the scratch /
  // CI boot; never set in prod). tests/import-reconciliation.test.js drives a
  // double that DROPS rows here, exactly where every real silent-loss bug in
  // this file has lived: the row was seen, then left the pipeline with nothing
  // recording where it went. The invariant must ABORT the whole import rather
  // than succeed with a short count. A guard nobody has watched fail is a guess.
  if (sabotageBudget > 0 && giftsToInsert.length) {
    giftsToInsert.splice(0, Math.min(sabotageBudget, giftsToInsert.length));
  }

  const resolvedDonorIds = [...new Set(giftsToInsert.map(g => g.donorId))];
  const existingGiftFps = new Set();
  if (resolvedDonorIds.length) {
    const exRows = await queryTx(txc,
      "SELECT donor_id, date, amount FROM gifts WHERE org_id = ? AND donor_id = ANY(?)",
      [orgId, resolvedDonorIds]);
    // BUILD-73 Part 2 — the fingerprint must use the SAME representation as
    // rowKey below. It rounded to a whole dollar, which was harmless while
    // storage did too; now that gifts carry cents, a rounding fingerprint would
    // silently stop matching its own rows.
    for (const r of exRows) existingGiftFps.add(`${r.donor_id}|${r.date}|${parseFloat(r.amount)}`);
  }
  const seenExisting = new Set();
  duplicateGroups = [
    ...duplicateGroupsFrom(giftsToInsert)
      .map(gr => ({ ...gr, kind: "within_file", donor: donorNameById(gr.donorId) })),
    ...giftsToInsert
      .filter(g => existingGiftFps.has(g.rowKey) && !seenExisting.has(g.rowKey) && seenExisting.add(g.rowKey))
      .map(g => ({ key: g.rowKey, kind: "matches_existing", donorId: g.donorId,
                   donor: donorNameById(g.donorId), date: g.date, amount: g.amount, count: 1 })),
  ];
  matchesExistingCount = duplicateGroups.filter(g => g.kind === "matches_existing").length;
  function donorNameById(dId) { const d = donorsToInsert.find(x => x._id === dId); return d ? String(d.name).trim() : dId; }

  // ── Finance sync setup (Gap 1) ───────────────────────────────────────────
  // fyStart mirrors /dashboard/my-stats exactly: July 1 fiscal year boundary.
  // ORG_TZ_SEAM_OK — one fiscal-year definition, in the org's timezone.
  const fyStart = orgFiscalYearStart(await orgTz(orgId));

  // BUILD-58 W-3: the ONE ledger helper — self-heals a chartless org loudly.
  const ledgerC = await ensureOrgLedger(orgId, { heal: true });
  // BUILD-83 Part 6: the chart is still PROVISIONED on import (an org must have
  // its accounts), but the import posts nothing to it. See the note below.
  void ledgerC;
  // ── BUILD-88a A.7 — A FUND NAMED IN THE FILE IS A FUND ──────────────────
  // The file's Fund/Designation column carries the org's own restrictions
  // ("Building Campaign", "Scholarship", "Youth Ministry"). They are matched
  // to the funds the org already has, case- and space-insensitively, and the
  // rest are CREATED — once, here, before the gifts are written, so every
  // gift that named a fund gets a real fund_id. A fund is not guessed at: the
  // match is on the name the file wrote, never on what it might have meant
  // ("GENERAL" and "General Operating" are two funds until a human merges
  // them). New funds arrive UNRESTRICTED — a restriction is a board decision,
  // not a spreadsheet column — and the import says how many it made.
  const fundKey = n => String(n || "").trim().toLowerCase().replace(/\s+/g, " ");
  const fundIdByKey = new Map();
  {
    const wanted = new Map();   // key → the file's own spelling (first wins)
    for (const g of giftsToInsert) { const k = fundKey(g.fund); if (k && !wanted.has(k)) wanted.set(k, String(g.fund).trim()); }
    if (wanted.size) {
      // FIX-45: oldest first, so a name two funds share resolves the same way every time.
      const existing = await queryTx(txc, "SELECT id, name FROM fin_funds WHERE org_id=? ORDER BY created_at, id", [orgId]);
      for (const f of existing) { const k = fundKey(f.name); if (k && !fundIdByKey.has(k)) fundIdByKey.set(k, f.id); }
      // TRUTH-3: her answer to "is it the same fund?" (the fundCheck dry run) is used, never guessed.
      const answers = req.body.fundMatches && typeof req.body.fundMatches === "object" ? req.body.fundMatches : {};
      const ownIds = new Set(existing.map(f => f.id));
      for (const [name, fid] of Object.entries(answers)) { const k = fundKey(name); if (k && ownIds.has(String(fid)) && !fundIdByKey.has(k)) fundIdByKey.set(k, String(fid)); }
      const toCreate = [...wanted.entries()].filter(([k]) => !fundIdByKey.has(k));
      for (let fi = 0; fi < toCreate.length; fi += 200) {
        const slice = toCreate.slice(fi, fi + 200);
        const params = [], tuples = [];
        for (const [k, name] of slice) {
          const id = importId("ff_");
          fundIdByKey.set(k, id);
          params.push(id, orgId, name.slice(0, 120), "Created by import", false);
          tuples.push("(?,?,?,?,?)");
        }
        const fres = await withSavepoint(txc, `fbatch_${fi}`, () => runTx(txc,
          `INSERT INTO fin_funds (id,org_id,name,description,restricted) VALUES ${tuples.join(",")}`, params));
        if (fres.ok) fundsCreated += slice.length;
        else { for (const [k] of slice) fundIdByKey.delete(k); console.error("[combined-import] fund batch failed:", fres.error.message); }
      }
    }
  }

  // Donor names map: built from the already-prepared donorsToInsert list (no extra query)
  const donorNameMap = Object.fromEntries(donorsToInsert.map(d => [d._id, String(d.name).trim()]));

  // ── Bulk-insert gifts + interactions (both in the same transaction) ────────
  // BUILD-83 FIX — BATCH SIZE IS A ROUND-TRIP BUDGET, and at workbook scale the
  // round trips ARE the import. Every batch costs four trips to the database
  // (SAVEPOINT · INSERT gifts RETURNING · INSERT interactions · RELEASE), so
  // 90,523 gifts at 200/batch was 453 batches ≈ 1,800 trips. On a local socket
  // (~0.1ms) that is invisible — the write measured 16s. Against a hosted
  // database (~50-100ms round trip) it is three to four minutes, which is
  // exactly the 221.4s Jonathan measured on production against the same file.
  // Postgres caps a statement at 65,535 bound parameters: gifts bind 14 each
  // (13 before A.7 added payment_method), interactions 8, so 2,000 rows/batch
  // is 28,000 and 16,000 — comfortably
  // inside it — and takes the trip count from ~1,800 to ~185.
  const GIFT_BATCH = IMPORT_GIFT_BATCH;   // 16 params/row (WIRE-1 added campaign_id) → 32,000 of the 65,535 cap
  const campaignIdOf = await campaignIdResolver(orgId);
  // GIFTS-1: an Event or Campaign column that names an event exactly links the gift.
  const eventIdOf = await require("../events/eventGifts").eventIdsByName(query, orgId);

  // ── LIVE-1 · A CSV GIFT BEHAVES LIKE EVERY OTHER GIFT ───────────────────
  // A gift from the last HISTORY_DAYS days is new to the donor: it is written
  // by recordGift with `history: true` after this transaction commits, so it
  // gets a thank-you draft and can start a journey exactly as the same gift
  // from Stripe would. An older gift is history: it is recorded here in the
  // batch and counted everywhere, and starts nothing, which is precisely what
  // recordGift's own FIX-36 branch does with it. Both are counted in this
  // ledger as created now; a recent gift recordGift then refuses is moved
  // to "skipped" or "errored" on the receipt, never lost from the count.
  const HG = require("../../historyGifts");
  for (let i = giftsToInsert.length - 1; i >= 0; i--) {
    const g = giftsToInsert[i];
    if (!HG.isOldHistory(g.date, importToday)) {
      recentGiftsToRecord.unshift({ ...g, fundId: (g.fund && fundIdByKey.get(fundKey(g.fund))) || null,
                                    campaignId: campaignIdOf(g.campaign), eventId: eventIdOf(g.campaign) });
      giftsToInsert.splice(i, 1);
      ledger.created(g.amount);
    }
  }

  for (let bi = 0; bi < giftsToInsert.length; bi += GIFT_BATCH) {
    const batch = giftsToInsert.slice(bi, bi + GIFT_BATCH);
    const giftParams = [], giftTuples = [];
    const rowByGid = new Map();
    batch.forEach((g, gi) => {
      const gid = importId("g_");
      rowByGid.set(gid, g);
      giftParams.push(gid, orgId, g.donorId, g.amount, g.date, g.type, g.campaign, campaignIdOf(g.campaign),
        // A.7 — was a hardcoded NULL. The fund the row named, resolved above.
        (g.fund && fundIdByKey.get(fundKey(g.fund))) || null,
        g.notes, g.externalId || null, actor(req).id, actor(req).name,
        g.customFields && Object.keys(g.customFields).length ? JSON.stringify(g.customFields) : null,
        g.paymentMethod || null, runId, bi + gi,   // NUMBERS-4: its place in the file (lastGift.js)
        eventIdOf(g.campaign));
      giftTuples.push("(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
      affectedDonorIds.add(g.donorId);
    });
    let keptCount = 0, ftCount = 0;
    let keptRows = [];
    // SAVEPOINT inside the request's one transaction: a bad batch is rolled
    // back to here and COUNTED as errored, instead of poisoning the rest.
    const bres = await withSavepoint(txc, `gbatch_${bi}`, async () => {
      // F-4: the external-ID partial unique (uq_gifts_external) is the ONE
      // cross-run gift dedup — a re-imported file with source IDs is a
      // strict no-op at the DB. RETURNING tells us which rows genuinely
      // landed so interactions + ledger stamps are only written for those
      // (a skipped gift must not orphan an interaction or a ledger row).
      const kept = await queryTx(txc,
        `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,campaign_id,fund_id,notes,external_id,created_by,created_by_name,custom_fields,payment_method,import_id,import_row,event_id)
         VALUES ${giftTuples.join(",")}
         ON CONFLICT (org_id, external_id) WHERE external_id IS NOT NULL DO NOTHING
         RETURNING id`,
        giftParams
      );
      const intParams = [], intTuples = [], ftParams = [], ftTuples = [];
      for (const r of kept) {
        const g = rowByGid.get(r.id);
        if (!g) continue;
        keptRows.push(g);
        if (g.credit) pendingGiftCredit.push({ giftId: r.id, g });
        // BUILD-88a A.1 — the timeline entry LINKS to its gift and carries no
        // copy of the amount. It used to read "Gift received: $5,000 (cash)",
        // which is how the same gift came to be drawn twice on a donor's
        // record — once from the gift row, once from this sentence.
        intParams.push(importId("int_"), orgId, g.donorId, "gift", g.notes || "", g.date, importerId, importerName, r.id);
        intTuples.push("(?,?,?,?,?,?,?,?,?)");
        // BUILD-83 Part 6 — IMPORT NEVER POSTS TO THE LEDGER. Gift history is
        // CRM data: it is what the org already raised, not money moving through
        // Steward. Ledger entries are created by the org, or by LIVE gifts
        // (Stripe webhook / a gift logged here), from an opening balance the
        // org sets. Posting an imported history made Finance open on FY revenue
        // $1,010,106.39, expenses $0, and a "Cash on hand, all-time" equal to
        // the FY figure — a set of books an accountant can disprove in a
        // minute. The gift rows are untouched; Reports still show every dollar,
        // and Finance's unledgered-giving explainer (BUILD-26 B1) says so.
      }
      if (intTuples.length) {
        await runTx(txc,
          `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,gift_id) VALUES ${intTuples.join(",")}`,
          intParams
        );
      }
      const noteParams = [], noteTuples = [];
      for (const r of kept) {
        const g = rowByGid.get(r.id);
        const text = g && String(g.notes || "").trim();
        if (!text || !g.date) continue;
        const k = g.donorId + "\u0000" + text.toLowerCase();
        if (importNoteSeen.has(k)) continue;
        importNoteSeen.add(k);
        noteParams.push(importId("int_"), orgId, g.donorId, "note", text, g.date, importerId, importerName, runId,
          JSON.stringify({ source: "donor-import", from: "notes column" }));
        noteTuples.push("(?,?,?,?,?,?,?,?,?,?::jsonb)");
      }
      if (noteTuples.length) {
        await runTx(txc,
          `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,import_id,metadata) VALUES ${noteTuples.join(",")}`,
          noteParams);
        importNotesCreated += noteTuples.length;
      }
      // One bulk INSERT for FY fin_transactions — same tx as gifts, rolls back together
      if (ftTuples.length) {
        await runTx(txc,
          `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,donor_id,source,gift_id,created_by,created_by_name)
           VALUES ${ftTuples.join(",")} ON CONFLICT (gift_id) WHERE gift_id IS NOT NULL DO NOTHING`,
          ftParams
        );
      }
      keptCount = kept.length; ftCount = ftTuples.length;
    });

    if (bres.ok) {
      giftsInserted += keptCount;
      financeSynced += ftCount;
      const keptSet = new Set(keptRows);
      for (const g of batch) {
        if (keptSet.has(g)) { ledger.created(g.amount); continue; }
        // Refused by the external-ID unique: NOT a loss — this gift was already
        // imported on an earlier run. Still a skip, and still counted, or the
        // equation could never balance on a deliberate re-import.
        externalIdDupes++;
        ledger.skipped("external_id_already_imported", g.amount);
      }
    } else {
      console.error(`[combined-import] gift batch ${bi}–${bi+batch.length} failed:`, bres.error.message);
      batchErrors.push({ rows: `${bi+1}–${bi+batch.length}`, error: bres.error.message });
      // The batch rolled back to its savepoint — every row in it is ERRORED,
      // counted and reported. Never silently gone.
      for (const g of batch) ledger.errored("gift_insert_failed", g.amount);
    }
  }

  // FIX-37: the recent gifts are written as WORK for the background job, in
  // this same transaction, so a gift the file brought is saved with the file.
  if (recentGiftsToRecord.length || created || affectedDonorIds.size) {
    await queueRecentWork((sql, params) => queryTx(txc, sql, params), orgId, jobRunId,
      recentGiftsToRecord.map(({ credit, ...g }) => ({ ...g, credit: credit || null })),
      { actorId: importerId, actorName: importerName, thanks: thanksAnswer,
        touched: [...new Set([...affectedDonorIds, ...donorsToInsert.map(d => d._id).filter(id => !failedIds.has(id))])] });
    recentQueued = recentGiftsToRecord.length;
  }

  // NUMBERS-2: before the recompute below, a stated total the file's gifts do
  // not reach is kept as its own figure, in this same transaction.
  await keepImportedTotals((sql, params) => queryTx(txc, sql, params), orgId,
    donorsToInsert.map(d => d._id).filter(id => !failedIds.has(id)), req.body.sourceName, runId);   // FEEL-1

  // ── THE ASSERTION. Before this transaction commits, the equations must hold.
  // A throw here rolls the whole import back (db.js withTransaction) and the
  // route answers 409 with the discrepancy named in dollars.
  ledger.assertBalanced();
  }); // end withTransaction — nothing above has committed until here
  }); // end withAdvisoryLock(import:orgId)

  // NUMBERS-4: a big file is most of an org the planner has never seen. Until
  // autovacuum gets to it, every statement after this one (the recompute, the
  // background job, the scores and rhythms) is planned as if the org had one
  // person, and a join over 25,000 people planned that way is a loop of
  // 25,000 by 25,000 (PERF-2). Two ANALYZEs (a sample, about a second) end
  // that. A role that does not own the tables gets a warning, not an error.
  // LIST-2: and the drift and scores tables the Donors list reads next, each on
  // a guarded connection (statement and lock timeouts), so it can never block.
  if (created >= IMPORT_ANALYZE_AT) await require("../../middleware/analyzeAfterImport").analyzeAfterImportGuarded("combined-import");

  // FIX-37: the recent gifts go through the one gift path BEHIND THE SCREEN
  // (runRecentWork). Totals for the file's older gifts are brought up to date
  // here, in the request, so every screen reads them right away.
  if (affectedDonorIds.size) {
    try { await recalcDonorSummaryBatch([...affectedDonorIds], orgId); }
    catch (e) { console.error(`[combined-import] batch recalc failed:`, e.message); }
  }
  giftsInserted += recentQueued;
  for (const g of recentGiftsToRecord) affectedDonorIds.add(g.donorId);

  // BUILD-83 — the round-trip budget, logged: batch counts are the number that
  // moves when this import is slow on a hosted database.
  console.log(`[combined-import] org=${orgId} donors=${created} (${Math.ceil(created / IMPORT_DONOR_BATCH)} batches) gifts=${giftsInserted} (${Math.ceil(giftsInserted / IMPORT_GIFT_BATCH)} batches) — ~${Math.ceil(created / IMPORT_DONOR_BATCH) * 2 + Math.ceil(giftsInserted / IMPORT_GIFT_BATCH) * 4} write round trips`);

  // ── BUILD-83 Part 2.1 — THE RECEIPT. The pre-write summary is a promise;
  // this is what the database actually holds, read back over the ids THIS
  // request inserted (never org-wide totals — an existing org would drown the
  // comparison). The completion screen puts promise and receipt side by side
  // and goes red on any mismatch: a choice the screen quoted the legend for
  // and then did not apply is data loss of the same class as a 200 on a
  // destroyed gift, and this is what catches it.
  let writtenReadback = null;
  try {
    const insertedIds = donorsToInsert.map(d => d._id).filter(id => !failedIds.has(id));
    if (insertedIds.length) {
      const rb = await query(
        `SELECT COUNT(*)::int AS donors,
                COUNT(*) FILTER (WHERE deceased)::int AS deceased,
                COUNT(*) FILTER (WHERE do_not_contact)::int AS do_not_contact,
                COUNT(*) FILTER (WHERE do_not_solicit)::int AS do_not_solicit,
                COUNT(*) FILTER (WHERE do_not_mail)::int AS do_not_mail,
                COUNT(*) FILTER (WHERE do_not_email)::int AS do_not_email,
                COUNT(*) FILTER (WHERE deceased OR do_not_contact OR do_not_solicit OR do_not_mail OR do_not_email)::int AS excluded,
                COUNT(*) FILTER (WHERE imported_sustainer)::int AS sustainers
           FROM donors WHERE org_id=? AND id = ANY(?) AND deleted_at IS NULL`,
        [orgId, insertedIds]);
      const gb = await query(
        `SELECT COUNT(*)::int AS gifts, COALESCE(SUM(amount),0)::numeric AS cash
           FROM gifts WHERE org_id=? AND donor_id = ANY(?)`, [orgId, insertedIds]);
      // BUILD-83 FIX (item 2) — the receipt answers EVERY field the promise
      // declares (shared/importShape.js IMPORT_PROMISE_FIELDS), and each one is
      // an aggregate over the ids this request inserted — never a query per row.
      const pl = await query(
        `SELECT COUNT(*)::int AS pledges FROM pledges WHERE org_id=? AND donor_id = ANY(?)`, [orgId, insertedIds]);
      const pp = await query(
        `SELECT COUNT(*)::int AS c FROM gifts WHERE org_id=? AND donor_id = ANY(?) AND LOWER(COALESCE(type,'')) LIKE '%pledge payment%'`,
        [orgId, insertedIds]);
      // Merges and pledge COMMITMENTS are written by /donors/import-semantics,
      // which reads its own writes back — this route reports only what it wrote.
      writtenReadback = { ...(rb[0] || {}), gifts: gb[0] ? Number(gb[0].gifts) : 0,
                          cash: gb[0] ? Math.round(Number(gb[0].cash) * 100) / 100 : 0,
                          pledgePayments: pp[0] ? Number(pp[0].c) : 0 };
      void pl;
    } else writtenReadback = { donors: 0, excluded: 0, gifts: 0, cash: 0, pledgePayments: 0 };
  } catch (e) { console.error("[import] read-back failed:", e.message); writtenReadback = { error: e.message }; }

  // LIVE-1 · THE ONE AFTER-CHANGE STEP, once for every person the file
  // touched (its totals are the batch recalc the import always ran). History:
  // moving someone into a group by importing them starts no journey.
  // FIX-37: it runs at the end of the background job, for everyone the run
  // touched (runRecentWork), so the request does not wait on it.
  kickRecentWork(orgId, jobRunId);

  // Gap 2: Promote donor status — same thresholds as single-gift route
  // (total_giving > 20000 → 'major', > 5000 → 'mid', ELSE keep existing)
  // Runs after recalcDonorSummary so total_giving is accurate before promotion.
  // FIX-49 decision 7: no second giving-level rule. donors.status is no
  // longer promoted to mid/major on lifetime totals; the level is the one
  // rule in donorStatus.js (the org's cut points, last 12 months).

  // Infer pipeline stage from recalculated giving data — the authoritative
  // inference happens HERE (after gifts load + totals recalc), not on the client
  // guess, so a wide file with year-column gifts but no total/last-gift column is
  // still staged correctly. An EXPLICIT stage column in the file always wins:
  // donors flagged `_stageExplicit` are excluded so their mapped stage survives.
  // SQL mirrors client-side inferStage() exactly, including its qualify/solicit
  // bands — see Donors.jsx's inferStage for the reasoning (a donor with no gift
  // history but an email/phone on file gets a reachable path to 'qualify'; a
  // substantial gift 90-180 days ago reads as 'solicit' rather than folding into
  // the generic 'cultivate' bucket).
  if (affectedDonorIds.size > 0) {
    try {
      // ORG_TZ_SEAM_OK — "days since the last gift" is civil-date arithmetic in
      // the ORG's calendar. CURRENT_DATE was the POSTGRES session zone, a THIRD
      // timezone alongside the server's and UTC, so a donor could cross the
      // 365-day lapsed line on a different day than their own calendar says.
      const _stageToday = orgToday(await orgTz(orgId));
      // FIX-60: a pledge holds a person off Lapsed (lapseRule.js pledgeHold).
      const stageParams = [_stageToday, ...require("../../shared/numbers/lapse").holdSql("donors.id", _stageToday).args, _stageToday, _stageToday, orgId, [...affectedDonorIds]];
      let excludeClause = "";
      if (explicitStageIds.length) { excludeClause = " AND id <> ALL(?)"; stageParams.push(explicitStageIds); }
      await run(
        // BUILD-83 Part 3.5 — writes SUGGESTED_STAGE, never stage. A donor the
        // file placed explicitly (_stageExplicit) keeps their real stage and is
        // excluded from this update, exactly as before.
        `UPDATE donors
         SET suggested_stage = CASE
           WHEN total_giving = 0 AND last_gift_date IS NULL
                AND (COALESCE(email,'') != '' OR COALESCE(phone,'') != '') THEN 'qualify'
           WHEN total_giving = 0 AND last_gift_date IS NULL            THEN 'prospect'
           WHEN last_gift_date IS NOT NULL
                AND (?::date - last_gift_date::date) >= ${lapseRule.LAPSED_DAYS}
                AND NOT ${require("../../shared/numbers/lapse").holdSql("donors.id", _stageToday).sql} THEN 'lapsed'
           WHEN last_gift_date IS NOT NULL
                AND (?::date - last_gift_date::date) < 90
                AND total_giving > 0                                   THEN 'steward'
           WHEN last_gift_date IS NOT NULL
                AND (?::date - last_gift_date::date) BETWEEN 90 AND 180
                AND total_giving >= 1000                                THEN 'solicit'
           WHEN total_giving > 0                                        THEN 'cultivate'
           ELSE 'prospect'
         END,
         updated_at = NOW()
         WHERE org_id = ? AND id = ANY(?)${excludeClause}
           AND deleted_at IS NULL`,
        stageParams
      );
    } catch (e) { console.error(`[combined-import] stage inference failed:`, e.message); }
  }

  // BUILD-78 4.4 — persist header→FIELD ID mappings so the next import of
  // this shape resolves the same fields even after every label is renamed.
  // Post-commit and non-fatal: a mapping upsert must never kill an import.
  if (Array.isArray(req.body.fieldMappings) && req.body.fieldMappings.length) {
    try {
      const { normalizeHeaderText } = await cfShape();
      const ownIds = new Set([...cfDonorDefs, ...cfGiftDefs].map(d => d.id));
      for (const fm of req.body.fieldMappings.slice(0, 200)) {
        if (!fm || !ownIds.has(fm.fieldId)) continue;   // a foreign field id buys nothing
        const entity = fm.entity === "gift" ? "gift" : "donor";
        await run(
          `INSERT INTO import_field_mappings (org_id, entity, header_norm, field_id, updated_at)
           VALUES (?,?,?,?,NOW())
           ON CONFLICT (org_id, entity, header_norm) DO UPDATE SET field_id = EXCLUDED.field_id, updated_at = NOW()`,
          [orgId, entity, normalizeHeaderText(fm.header), fm.fieldId]);
      }
    } catch (e) { console.error("[combined-import] field-mapping upsert failed:", e.message); }
  }

  // BUILD-78 Part 9 — an imported custom value is as auditable as a hand-typed
  // one. The donor/gift ROW already carries the BUILD-75 importer actor, but
  // the custom-field audit trail did not see the import; record ONE summarizing
  // values_written event (not one per value — that would be thousands) so a
  // reviewer of custom_field_events can distinguish import writes from manual
  // ones and attribute them to the importer.
  try {
    const cfDonorWrites = donorCfById.size;
    const cfGiftWrites = giftCfByIdx.size;
    const cfSource = `import of ${req.body.sourceFileName || "a file"}`;
    if (cfDonorWrites) await cfEvent(req, orgId, "donor", "values_written",
      { detail: { via: "import", source: cfSource, rows: cfDonorWrites, keys: [...new Set([...donorCfById.values()].flatMap(v => Object.keys(v)))] } });
    if (cfGiftWrites) await cfEvent(req, orgId, "gift", "values_written",
      { detail: { via: "import", source: cfSource, rows: cfGiftWrites, keys: [...new Set([...giftCfByIdx.values()].flatMap(v => Object.keys(v)))] } });
  } catch (e) { console.error("[combined-import] custom-field audit event failed:", e.message); }

  // BUILD-84 P0-4 — geocoding is queued by the WRITE that changed addresses.
  let geocodeQueued = null;
  try { geocodeQueued = await markDonorsForGeocoding(orgId); }
  catch (e) { console.error("[combined-import] geocode mark failed:", e.message); }

  // BUILD-98 Part 1 — soft credits, tributes and expected matches, written
  // AFTER the gifts committed (they point at gift rows). A name that cannot be
  // placed is counted and named, never guessed.
  let giftCredit = null;
  if (pendingGiftCredit.length) {
    try { giftCredit = await importGiftExtras(orgId, pendingGiftCredit, actor(req)); }
    catch (e) { console.error("[combined-import] gift credit failed:", e.message); giftCredit = { error: e.message }; }
  }

  // BUILD-99 (major gifts) Part 6 — open asks from the file, written after the
  // people exist. A proposal is NOT a gift: nothing below touches gifts, donor
  // totals or the ledger, which is why an imported pipeline cannot inflate a
  // giving history.
  let proposalsImported = null;
  if (Array.isArray(req.body.proposals) && req.body.proposals.length) {
    try {
      proposalsImported = await importProposals(orgId, req.body.proposals, actor(req),
        // `indexToId` is the import's OWN donorIndex → donor id map, the same one
        // the gift rows resolve through, so a proposal on row 7 lands on the
        // person row 7 created rather than on whoever sorted seventh.
        idx => (Number.isInteger(idx) ? (indexToId[idx] || null) : null));
    } catch (e) { console.error("[combined-import] proposals failed:", e.message); proposalsImported = { error: e.message }; }
  }

  // BUILD-101 Part 6 — memberships named in the file, written after the
  // people exist (the client sends them with the LAST chunk). History only:
  // no gift, no ledger row, and a level the org does not have is HELD.
  let membershipsImported = null;
  if (Array.isArray(req.body.memberships) && req.body.memberships.length) {
    try { membershipsImported = await importMemberships(orgId, req.body.memberships, actor(req)); }
    catch (e) { console.error("[combined-import] memberships failed:", e.message); membershipsImported = { error: e.message }; }
  }

  res.json({ created, giftsInserted, importNotesCreated, duplicates, donorsUpdated: affectedDonorIds.size, financeSynced, batchErrors, geocodeQueued,
             // LIVE-1 — the recent gifts recordGift wrote, the thank-yous it
             // drafted, and how long the after-change step took.
             // FIX-37: the recent gifts are queued, not yet written: the
             // screen follows them on GET /imports/:id/progress.
             recentQueued, importId: jobRunId, thanks: thanksAnswer,
             memberships: membershipsImported, // BUILD-101 Part 6
             written: writtenReadback,   // BUILD-83 Part 2.1 — read from the DB after commit
             giftCredit,                 // BUILD-98 Part 1 — soft credits / tributes / matches written
             proposals: proposalsImported, // BUILD-99 Part 6 — open asks, routed off the cash total
             duplicateCandidates, externalIdDupes,
             // A.7 — rows whose source id was already taken by a DIFFERENT
             // gift: imported, un-idded, and said out loud.
             externalIdCollisions: externalIdCollisionCount,
             columns: columnSummary,
             // BUILD-72 Part 1 — matched donors are now reported, and their
             // gifts actually landed. `duplicates` still counts donors NOT
             // created; `donorsMatched` says what became of them.
             donorsMatched: matchedIds.size, namelessRows,
             // TRANS-1 Part 4 — HOW they were matched. A re-import's small
             // report leads on "matched by your system's own id", because
             // that is the claim the move is sold on, so it is counted at the
             // point of matching rather than guessed afterwards.
             matchedByExternalId, matchedByEmail, matchedByName,
             externalIdsLearned: matchedExtIdFills.length,
             // The equations, for the summary screen. The user sees the
             // arithmetic, not a reassurance that it worked.
             reconciliation: ledger.report(),
             roundingAdjustment: round2(roundingAdjustment),
             // BUILD-88a A.7 — the funds this chunk had to create, so the
             // summary can say "fifteen funds" instead of leaving it to be
             // discovered on the Finance page.
             fundsCreated,
             duplicateGroups, matchesExistingCount });
  // GTM-1b 1 — AFTER AN IMPORT, COUNT. The file is the thing that changes an
  // org's size, so this is where the active-donor count is re-taken. It runs
  // AFTER the response: the import's own summary must not wait on it, and a
  // failure here must never turn a successful import into an error. It never
  // touches the subscription — it records one notice and tells the admin.
  checkRecordBand(req.user.orgId).catch(e => console.error("[tier] band check after import:", e.message));
}));


// BUILD-98 Part 1 — an imported gift's soft credit, tribute and matching
// employer, from NAMES. Resolution is deterministic and org-scoped: an email or
// an exact name that points at exactly one record is that record; a person
// named as a soft credit who is not on file is CREATED (a DAF recommender is a
// person the org should know); an honouree who is not on file stays a NAME
// (a memorial is often for somebody who never gave); a matching employer is
// found by exact name or created as an organisation.
// ── BUILD-99 (major gifts) Part 6 — PROPOSALS FROM A FILE ──────────────────
// Written AFTER the import transaction commits, the same seam BUILD-98's gift
// extras use and for the same reason: a proposal points at a person, and the
// people are created inside that transaction.
//
// THREE RULES, and each one is why this is not just an INSERT loop:
//   · A PROPOSAL IS NOT A GIFT. Nothing here touches `gifts`, `donors.total_giving`
//     or the ledger. An imported open ask is money that has NOT arrived, and the
//     import receipt routes it off the cash total by name ("open proposals").
//   · ONE OPEN PER FUND STILL HOLDS. A file carrying two open asks on one person
//     for one fund is a file with a duplicate in it; the second is SKIPPED and
//     COUNTED, never written and never silently merged into the first.
//   · A STAGE OR PROBABILITY THE PRODUCT DOES NOT RECOGNISE IS NOT GUESSED. An
//     unreadable stage falls back to `identified` and is COUNTED as having done
//     so; an unreadable probability is left BLANK, which the weighted total
//     already knows how to say out loud. Neither is invented.
async function importProposals(orgId, rows, who, donorIdByIndex) {
  const P = await import("../../shared/proposalShape.js");
  const out = { written: 0, skippedDuplicate: 0, stageDefaulted: 0, probabilityDropped: 0,
                unresolved: [], fundsCreated: 0 };
  if (!Array.isArray(rows) || !rows.length) return out;

  const fundCache = new Map();
  const fundIdFor = async (name) => {
    const nm = String(name || "").trim();
    if (!nm) return null;
    const key = nm.toLowerCase();
    if (fundCache.has(key)) return fundCache.get(key);
    const [hit] = await query("SELECT id FROM fin_funds WHERE org_id=? AND LOWER(name)=LOWER(?) LIMIT 1", [orgId, nm]);
    let id = hit ? hit.id : null;
    if (!id) {
      // A fund named in a file IS a fund (BUILD-88a A.7), created UNRESTRICTED —
      // a restriction is a board decision, not a column.
      id = newId("fund");
      await run("INSERT INTO fin_funds (id,org_id,name,restricted,description) VALUES (?,?,?,false,'Created by an import')",
        [id, orgId, nm.slice(0, 120)]);
      out.fundsCreated++;
    }
    fundCache.set(key, id);
    return id;
  };
  const ownerCache = new Map();
  const ownerFor = async (name) => {
    const nm = String(name || "").trim();
    if (!nm) return null;
    const key = nm.toLowerCase();
    if (ownerCache.has(key)) return ownerCache.get(key);
    // Matched to a user of THIS org by name or email, exactly; ambiguity resolves
    // to nobody (the import owner-matching rule — never mis-assign).
    const hits = await query(
      "SELECT id, name FROM users WHERE org_id=? AND (LOWER(name)=LOWER(?) OR LOWER(email)=LOWER(?)) LIMIT 2", [orgId, nm, nm]);
    const u = hits.length === 1 ? hits[0] : null;
    ownerCache.set(key, u);
    return u;
  };

  for (const r of rows) {
    let donorId = null;
    if (r.donorIndex !== undefined && r.donorIndex !== null) donorId = donorIdByIndex(Number(r.donorIndex));
    if (!donorId && r.donorName) {
      const [d] = await query("SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(name)=LOWER(?) ORDER BY created_at, id LIMIT 1",
        [orgId, String(r.donorName).trim()]);
      donorId = d ? d.id : null;
    }
    if (!donorId) { out.unresolved.push({ purpose: String(r.purpose || "").slice(0, 80), donorName: r.donorName || null, why: "nobody on file to put it on" }); continue; }

    let askCents = 0;
    try { askCents = parseMoneyOrThrow(r.askAmount, "askAmount"); } catch { askCents = 0; }
    if (!(askCents > 0)) { out.unresolved.push({ purpose: String(r.purpose || "").slice(0, 80), why: "no ask amount that could be read" }); continue; }

    // THE STAGE WORD MAY BE THE FILE'S, NOT STEWARD'S. A Salesforce export says
    // "Prospecting"; a Bloomerang or DonorPerfect one says "Submitted" or
    // "Negotiation". Steward's own key is tried first, then NPSP's documented
    // ladder (which those words overlap), and only then does it default — so a
    // real export's vocabulary is READ rather than flattened to Identified and
    // counted as a failure.
    let stage = String(r.stage || "").trim().toLowerCase();
    if (!P.stageFor(stage)) {
      const NP = await import("../../shared/npspPreset.js");
      const mapped = NP.npspProposalStage(r.stage);
      if (mapped) stage = mapped;
      else { stage = "identified"; out.stageDefaulted++; }
    }
    const prob = P.normalizeProbability(r.probability);
    if (prob === undefined) out.probabilityDropped++;

    const fundId = await fundIdFor(r.fund);
    const owner = await ownerFor(r.owner);
    const purpose = P.sanitizePurpose(r.purpose) || "Ask";
    const close = /^\d{4}-\d{2}-\d{2}$/.test(String(r.expectedClose || "")) ? String(r.expectedClose) : null;

    const id = newId("opp");
    const ins = await query(
      `INSERT INTO opportunities
         (id,org_id,donor_id,name,target_amount,status,proposal_stage,probability,fund_id,notes,
          officer_id,officer_name,expected_close,created_by,created_by_name,updated_at)
       SELECT ?::text,?::text,?::text,?::text,?::numeric,?::text,?::text,?::integer,?::text,?::text,
              ?::text,?::text,?::date,?::text,?::text,NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM opportunities x WHERE x.org_id=?::text AND x.donor_id=?::text
            AND COALESCE(x.fund_id,'') = ?::text AND x.proposal_stage = ANY(?::text[]))
       RETURNING id`,
      [id, orgId, donorId, purpose, toDollars(askCents), P.statusForStage(stage), stage,
       prob == null || prob === undefined ? null : prob, fundId, P.sanitizeNotes(r.notes),
       owner ? owner.id : null, owner ? owner.name : null, close, who.id, who.name,
       orgId, donorId, fundId || "", P.isOpenStage(stage) ? P.OPEN_STAGE_KEYS : []]);
    if (ins.length) out.written++;
    else out.skippedDuplicate++;
  }
  return out;
}
// The vendor's wealth-screen figures off an import row, trimmed and capped.
// Hoisted (a function declaration) because the import route above calls it.
function wealthScreenParams(d) {
  const w = d && d.wealthScreen;
  if (!w || typeof w !== "object") return null;
  const t = (v, n) => (v == null ? null : (String(v).trim().slice(0, n) || null));
  const o = { source: t(w.source, 40) || "Wealth screening", rating: t(w.rating, 64), capacity: t(w.capacity, 64), date: t(w.date, 32) };
  return o.rating || o.capacity || o.date ? o : null;
}

// ── BUILD-101 Part 6 — MEMBERSHIPS FROM A FILE ────────────────────────────
// Rows arrive already read by shared/membershipImport.js. Each is placed on a
// person — by EMAIL, exactly, or by NAME when the row has no email (the oldest
// matching record, the proposals/soft-credit rule) — and on one of the org's
// OWN levels, matched case-insensitively. Everything that cannot be placed is
// HELD with its line number and the reason; nothing is created to make a row
// fit. An imported membership is history: it carries no payment (no gift, no
// ledger row), its status comes from its dates, and a re-run adds nothing.
async function importMemberships(orgId, rows, who) {
  await MB_READY;
  const MI = await import("../../shared/membershipImport.js");
  const out = { written: 0, skippedDuplicate: 0, held: [] };
  const levels = await query("SELECT * FROM membership_levels WHERE org_id=?", [orgId]);
  const today = orgToday(await orgTz(orgId));                  // ORG_TZ_SEAM_OK
  const { graceDays } = await membershipSettings(orgId);
  const hold = (r, why) => out.held.push({ line: Number.isInteger(r.line) ? r.line : null, name: r.name || r.email || null, level: r.level || null, why });
  for (const r of rows.slice(0, 50000)) {
    const level = MI.matchLevel(levels, r.level);
    if (!level) { hold(r, `no level called "${String(r.level || "").slice(0, 60)}": add it in Members, or fix the file`); continue; }
    const iso = v => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const starts = iso(r.starts) || iso(r.joined);
    if (!starts) { hold(r, "no start date that could be read"); continue; }
    let donor = null;
    if (r.email) [donor] = await query("SELECT id FROM donors WHERE org_id=? AND LOWER(email)=LOWER(?) AND deleted_at IS NULL ORDER BY created_at LIMIT 1", [orgId, r.email]);
    if (!donor && r.name) [donor] = await query("SELECT id FROM donors WHERE org_id=? AND LOWER(name)=LOWER(?) AND deleted_at IS NULL ORDER BY created_at LIMIT 1", [orgId, String(r.name).trim()]);
    if (!donor) { hold(r, "no one on file with that email or name"); continue; }
    const expires = iso(r.expires) || MB.expiryFor({ term: level.term, startsOn: starts });
    const [dup] = await query("SELECT id FROM memberships WHERE org_id=? AND donor_id=? AND level_id=? AND starts_on=?", [orgId, donor.id, level.id, starts]);
    if (dup) { out.skippedDuplicate++; continue; }
    const status = MB.statusOn({ expiresOn: expires, today, graceDays });
    try {
      await run(`INSERT INTO memberships (id,org_id,donor_id,level_id,joined_on,starts_on,expires_on,status,status_changed_on,source,created_by,created_by_name)
                 VALUES (?,?,?,?,?,?,?,?,?,'import',?,?)`,
        [newId("mb"), orgId, donor.id, level.id, iso(r.joined) || starts, starts, expires, status,
         status === "lapsed" ? MB.addDaysCivil(expires, graceDays + 1) : null, who.id, who.name]);
      out.written++;
    } catch (e) {
      if (e.code !== "23505") throw e;
      hold(r, "this person already holds a current membership");
    }
  }
  return out;
}
}

module.exports = { routers, mount };

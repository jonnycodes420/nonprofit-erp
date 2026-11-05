// server/imports/routes.js — importing people (/donors/import, the semantics check) and the import runs (/imports).
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const { CAMPAIGN_GIFT_MATCH, NOT_DELETED } = require("../../campaignMatch");   // NUMBERS-1: which gifts count toward a campaign
const PW = require("../../pledgeWrite");   // FIX-60: the one writer of a pledge and its installments
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  DEPOSIT_REVERSE_HOURS, IMPORT_RUN_ID_RE, IT, PT_READY, UNDO_NOT_YOURS, actor, buildAssigneeResolver,
  checkPlanLimit, checkRecordBand, checkWriteAccess, importId, importLedger, keepImportedTotals,
  markDonorsForGeocoding, mayUndoImport, money, moveMod, normalizeName, orgPlanTier, orgRow, orgToday, orgTz,
  orgTzName, parseMoneyOrThrow, query, recalcDonorSummary, recalcPledgePayment, recentJobs,
  recomputeScoresForOrg, requireAuth, round2, run, runTx, toCents, toDollars, uniqueImportName, uuid,
  withAdvisoryLock, withTransaction, wrap, wrapImport, writeImportReadoutOnce,
} = ctx;
let PT = null;
PT_READY.then(m => { PT = m; });
// What the screen is told: a job is still running until its finish has been
// written (see above).
const recentJobStatus = j => (j.status === "done" && !j.finished_at ? "running" : j.status);

// Undo, while the work runs: stop it, wait for the gift in flight, and clear
// what was still to do. The undo then removes what was done, by the run id.
async function cancelRecentWork(orgId, runId) {
  await run(`UPDATE import_recent_jobs SET status='cancelled', finished_at=NOW() WHERE import_id=? AND org_id=?`, [runId, orgId]);
  const job = recentJobs.get(runId);
  if (job) job.cancelled = true;
  // Wait for the gift in flight, wherever the job runs: it stops at its next
  // gift or batch, and its queue row stops running.
  for (let i = 0; i < 600; i++) {
    const busy = await query(`SELECT 1 FROM job_queue WHERE key=? AND status='running' LIMIT 1`, ["importRecent:" + runId]);
    if (!busy.length) break;
    await new Promise(r => setTimeout(r, 100));
  }
  await run(`DELETE FROM import_recent_work WHERE import_id=? AND org_id=?`, [runId, orgId]);
}

// What the import screen shows while the work runs.
function recentProgressSentence(j) {
  const total = Number(j.total) || 0, done = Math.min(Number(j.done) || 0, total);
  const thanks = IT.cleanAnswer(typeof j.thanks === "string" ? JSON.parse(j.thanks) : j.thanks);
  const verb = thanks && thanks.mode === "none" ? "Checking" : "Thanking and checking";
  if (recentJobStatus(j) === "done") return `Done: ${total.toLocaleString("en-US")} recent ${total === 1 ? "gift" : "gifts"} checked.`;
  if (j.status === "cancelled") return "Stopped: this import was undone.";
  return `${verb} ${total.toLocaleString("en-US")} recent ${total === 1 ? "gift" : "gifts"}: ${done.toLocaleString("en-US")} done`;
}
let app = routers.r1;

app.post("/donors/import", requireAuth, wrap(async (req, res) => {
  const { donors } = req.body;
  if (!Array.isArray(donors) || donors.length === 0)
    return res.status(400).json({ error: "donors array required" });

  // ── Plan limit check (unchanged — keep 403 + UpgradeModal flow exactly) ──
  const orgForLimit = await query("SELECT * FROM orgs WHERE id=?", [req.user.orgId]);
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
            : `This import would add ${validCount} records but you can only add ${remaining} more (limit: ${recordCheck.limit}).`,
          current: recordCheck.current,
          limit: recordCheck.limit,
          allowed: Math.max(0, remaining),
          plan: orgForLimit[0].plan,
          isTrial: false,
        });
      }
    }
  }

  // ── Owner-column assignment (Team only) ──
  // A Team org's import may carry per-donor `assignedTo` (mapped from an owner/
  // officer column on the client). Validate + resolve; Core orgs → no-op (land
  // unassigned). An assigned donor also joins the working board (in_pipeline).
  const isTeamOrg = orgForLimit.length ? orgPlanTier(orgForLimit[0]) === "team" : false;
  const resolveAssignee = await buildAssigneeResolver(donors, req.user.orgId, isTeamOrg);

  // ── Dedup by email against existing donors (case-insensitive) ──
  // Comment: future option is merge/update rather than skip.
  const existingEmailRows = await query(
    "SELECT LOWER(email) AS e FROM donors WHERE org_id=? AND email IS NOT NULL AND email != '' AND deleted_at IS NULL",
    [req.user.orgId]
  );
  const existingEmails = new Set(existingEmailRows.map(r => r.e));
  const seenEmails = new Set(); // within-import dedup

  // BUILD-72 Part 1 — the invariant applies here too. This path carries no
  // gifts, so the "dollars" it reconciles are the lifetime totals the file
  // states for each donor: losing a donor row loses that figure, and it should
  // be as visible as a lost gift.
  const ledger = importLedger("donors", "donor");
  let duplicates = 0, namelessRows = 0;
  // BUILD-79 Part 2.3 — "already on file" and "another row of this same file"
  // are different facts. In a fresh org NOTHING is on file; every collapse is
  // the file folding onto itself, and the language must say so.
  let duplicatesOnFile = 0, duplicatesInFile = 0;
  const donorsToInsert = [];

  for (const d of donors) {
    const stated = round2(parseFloat(d.total) || 0);
    ledger.saw(stated);
    if (!d.name || !String(d.name).trim()) {
      namelessRows++; ledger.skipped("no_usable_name", stated); continue;
    }
    const emailLower = (d.email || "").toLowerCase().trim();
    if (emailLower) {
      if (existingEmails.has(emailLower)) {
        duplicates++; duplicatesOnFile++; ledger.skipped("already_in_steward", stated); continue;
      }
      if (seenEmails.has(emailLower)) {
        duplicates++; duplicatesInFile++; ledger.skipped("duplicate_within_this_import", stated); continue;
      }
      seenEmails.add(emailLower);
    }
    donorsToInsert.push(d);
  }

  // ── Batched bulk INSERTs (500/batch, one statement per batch) ──
  // 17 columns × 500 rows = 8,500 params — well under PG's 65,535 placeholder limit.
  // runTx's ?→$n substitution handles the flat positional array correctly.
  const BATCH = 500;
  let created = 0;
  const batchErrors = [];
  const createdDonorIds = [];

  for (let bi = 0; bi < donorsToInsert.length; bi += BATCH) {
    const batch = donorsToInsert.slice(bi, bi + BATCH);

    // Build one flat params array and matching VALUE tuples in a single pass
    // so column order and param order are always in sync.
    const params = [];
    const batchIds = [];   // LIVE-1: who this batch created, for the after-change step
    const tuples = batch.map(d => {
      const a = resolveAssignee(d);
      const rowId = importId("d_");
      batchIds.push(rowId);
      params.push(
        rowId, req.user.orgId,
        normalizeName(d.name),
        d.email   || "",
        d.phone   || "",
        d.status  || "new",
        // BUILD-83 Part 3.5, applied to this path by BUILD-84 P0-3 — A STAGE
        // IS A DECISION. import-combined already wrote every inference to
        // suggested_stage and left `stage` NULL; the donor-only path (the one
        // a gift-less file takes, which is exactly the file whose stages are
        // pure guesswork) was still writing them into `stage` as decisions.
        d._stageExplicit ? (d.stage || null) : null,
        toDollars(toCents(d.total)      || 0),   // BUILD-73: cents preserved, was Math.round
        toDollars(toCents(d.lastAmount) || 0),   // BUILD-73: cents preserved, was Math.round
        d.lastGift || null,
        parseInt(d.gifts) || (d.total ? 1 : 0),
        JSON.stringify(Array.isArray(d.tags) ? d.tags : []),
        d.notes || "",
        d.city  || null,
        d.state || null,
        a.id,               // assigned_to — a mapped owner column → real user (Team), else null.
        a.name,             // assigned_to_name. Assignment IS board membership (BUILD-30) —
                            // an assigned donor is in the officer's portfolio AND on their board.
        a.pendingInviteId,  // pending_assignee_invite_id — held for an invited-but-not-accepted officer
        a.pendingName,      // pending_assignee_name — display label until they accept
        // BUILD-58 Part 2: deceased / do-not-contact flags — mapped from the
        // file, never silently discarded again.
        d.deceased === true || d.deceased === "true",
        d.doNotContact === true || d.doNotContact === "true",
        // BUILD-84 P0-2 — the donor type and the contact person on an
        // organization's record. BUILD-84 P0-4 — the address the map
        // geocodes from, which this path could not carry at all.
        d.kind || null,
        d.contactName || null,
        d.address || null,
        d.zip || null,
        d.country || null,
        d._stageExplicit ? null : (d.stage || "prospect"),
        // BUILD-94 Part 1 — a mapped photo URL lands as a QUEUED fetch, never
        // an inline one: 25,000 outbound requests inside the import
        // transaction is how an import times out.
        photoImportUrl(d),
        photoImportUrl(d) ? "pending" : null,
        // BUILD-94 Part 2 — the person's type, and whether they are reachable.
        // A Mailchimp row carries both; every other file carries neither and
        // gets the defaults it always had (a donor, reachable).
        JSON.stringify(PT.normalizeTypes(d.personTypes === undefined ? ["donor"] : d.personTypes)),
        // AN UNSUBSCRIBED MAILCHIMP CONTACT IMPORTS AS UNSUBSCRIBED. Never as
        // reachable. Importing only the subscribed file and losing every
        // unsubscribe Mailchimp was honouring is how the first campaign out of
        // Steward goes to people who asked her to stop.
        d.unsubscribed === true || d.unsubscribed === "true"
      );
      return "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
    });

    try {
      await withTransaction(async (client) => {
        await runTx(client,
          `INSERT INTO donors
             (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,
              last_gift_date,gift_count,tags,notes,city,state,assigned_to,assigned_to_name,
              pending_assignee_invite_id,pending_assignee_name,deceased,do_not_contact,
              kind,contact_name,address,zip,country,suggested_stage,
              photo_source_url,photo_fetch_status,person_types,do_not_email)
           VALUES ${tuples.join(",")}`,
          params
        );
      });
      created += batch.length;
      createdDonorIds.push(...batchIds);
      for (const d of batch) ledger.created(round2(parseFloat(d.total) || 0));
    } catch (e) {
      const rowStart = bi + 1;
      const rowEnd   = bi + batch.length;
      console.error(`[import] batch rows ${rowStart}–${rowEnd} failed:`, e.message);
      batchErrors.push({ rows: `${rowStart}–${rowEnd}`, error: e.message });
      // Counted, not swallowed: a failed batch is `errored`, and the equation
      // still has to balance.
      for (const d of batch) ledger.errored("donor_insert_failed", round2(parseFloat(d.total) || 0));
    }
  }

  // The donors-only path commits per batch (each batch is independent and a
  // partial donor load is recoverable), so the assertion here is a REPORT and a
  // loud server-side error rather than a rollback — there is nothing left to
  // roll back by the time it runs. The combined + gift-history paths, which
  // move money, hold one transaction and genuinely abort.
  const bal = ledger.balance();
  if (!bal.balanced) {
    console.error("[import] DONOR LEDGER DID NOT BALANCE:", JSON.stringify(ledger.report()));
  }

  // BUILD-84 P0-4 — the import is a write, so it is where addresses become
  // geocode work. Marking is cheap and local; the lookups happen on the tick.
  let geocodeQueued = null;
  try { geocodeQueued = await markDonorsForGeocoding(req.user.orgId); }
  catch (e) { console.error("[geocode] mark after import failed:", e.message); }

  // BUILD-94 Part 2 — an unsubscribed contact has to be unsubscribed in the
  // place the SEND path actually reads. do_not_email on the row is what a
  // human sees on the profile; email_suppressions is what donorMailDecision
  // consults before every marketing send, and it is the one that matters.
  // Both, or the flag is decoration.
  let unsubscribedImported = 0;
  try {
    const unsubs = (req.body.donors || []).filter(d => (d.unsubscribed === true || d.unsubscribed === "true") && d.email);
    for (const d of unsubs) {
      const email = String(d.email).toLowerCase();
      const [already] = await query(
        `SELECT 1 AS x FROM email_suppressions WHERE LOWER(email)=? AND org_id=? AND reason='unsubscribed' LIMIT 1`,
        [email, req.user.orgId]);
      if (already) continue;
      await run(`INSERT INTO email_suppressions (id, org_id, email, reason, source) VALUES (?,?,?,?,?)`,
        [newId("sup"), req.user.orgId, email, "unsubscribed", "import"]);
      unsubscribedImported++;
    }
  } catch (e) { console.error("[import] unsubscribe suppressions:", e.message); }

  // BUILD-94 Part 1 — how many rows carried a photo URL to fetch. Reported so
  // the import screen can say it, rather than photos appearing minutes later
  // with nothing having said they would.
  let photosQueued = 0;
  try {
    const [pq] = await query(
      `SELECT COUNT(*)::int AS n FROM donors WHERE org_id = ? AND photo_fetch_status = 'pending'`,
      [req.user.orgId]);
    photosQueued = pq ? pq.n : 0;
  } catch (e) { console.error("[person-photo] queued count:", e.message); }
  // LIVE-1 · the one after-change step, once for everyone this file created.
  // `recalc: false`: a donors-only file carries the totals the old system
  // stated and no gift rows, so recomputing from gifts would zero them.
  await keepImportedTotals(query, req.user.orgId, createdDonorIds, req.body.sourceName);
  await require("../../afterChange").afterChange(req.user.orgId, createdDonorIds, { door: "csv_import", history: true, recalc: false });
  res.json({ created, duplicates, duplicatesOnFile, duplicatesInFile, batchErrors, namelessRows, geocodeQueued, photosQueued, unsubscribedImported, reconciliation: ledger.report() });
  // GTM-1b 1 — AFTER AN IMPORT, COUNT. The file is the thing that changes an
  // org's size, so this is where the active-donor count is re-taken. It runs
  // AFTER the response: the import's own summary must not wait on it, and a
  // failure here must never turn a successful import into an error. It never
  // touches the subscription — it records one notice and tells the admin.
  checkRecordBand(req.user.orgId).catch(e => console.error("[tier] band check after import:", e.message));
}));

app.post("/donors/import-semantics", requireAuth, checkWriteAccess, wrapImport(async (req, res) => {
  const orgId = req.user.orgId;
  const pledges = Array.isArray(req.body.pledges) ? req.body.pledges : [];
  const inKind = Array.isArray(req.body.inKind) ? req.body.inKind : [];
  const links = Array.isArray(req.body.links) ? req.body.links : [];
  const reviewTwins = Array.isArray(req.body.reviewTwins) ? req.body.reviewTwins : [];
  const merges = Array.isArray(req.body.merges) ? req.body.merges : [];
  // BUILD-80 Part 9 — the import's own health, persisted: every headline
  // stat carries the caveat while refusals exceed 5% of rows, the goal card
  // stays empty, and the thank-you queue reads the largest gifts first.
  if (req.body.fileStats && Number(req.body.fileStats.rows) > 0) {
    const fsIn = req.body.fileStats;
    await run("UPDATE orgs SET last_import_stats=? WHERE id=?", [JSON.stringify({
      rows: Number(fsIn.rows) || 0,
      refused: Number(fsIn.refused) || 0,
      refusedDollars: Number(fsIn.refusedDollars) || 0,
      largestGifts: Array.isArray(fsIn.largestGifts) ? fsIn.largestGifts.slice(0, 5).map(g => ({ name: String(g.name || ""), dollars: Number(g.dollars) || 0, line: g.line || null, confirmed: false })) : [],
      at: new Date().toISOString(),
    }), orgId]);
  }
  const counts = { pledges: 0, inKind: 0, links: 0, personsCreated: 0, twinsFlagged: 0, merges: 0, unresolved: [] };
  const mergeRows = [];

  // BUILD-82 — a pledge/in-kind row from a workbook names its person by the
  // SOURCE system's id; that outranks email and name (same order as the join).
  // Normalisation is shared/importShape.js donorIdKey (4212 ≡ 004212 ≡ 4212.0),
  // resolved in JS over one org-wide key load — never string surgery in SQL.
  const { donorIdKey: extKey } = await import("../../shared/importShape.js");
  let extIdMap = null;
  const extIdLookup = async (externalId) => {
    const xk = extKey(externalId);
    if (!xk) return null;
    if (!extIdMap) {
      extIdMap = new Map();
      const rows = await query(
        "SELECT id, name, external_donor_id, external_donor_ids FROM donors WHERE org_id=? AND deleted_at IS NULL AND (external_donor_id IS NOT NULL OR external_donor_ids IS NOT NULL) ORDER BY created_at, id",
        [orgId]);
      for (const r of rows) {
        const ids = [r.external_donor_id, ...(Array.isArray(r.external_donor_ids) ? r.external_donor_ids : [])];
        for (const one of ids) { const k = extKey(one); if (k && !extIdMap.has(k)) extIdMap.set(k, { id: r.id, name: r.name }); }
      }
    }
    return extIdMap.get(xk) || null;
  };
  const findDonor = async (email, name, externalId) => {
    const byExt = await extIdLookup(externalId);
    if (byExt) return byExt;
    const em = String(email || "").trim().toLowerCase();
    if (em && em.includes("@")) {
      const r = await query("SELECT id, name FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(email)=?", [orgId, em]);
      if (r.length === 1) return r[0];
    }
    const nm = String(name || "").trim();
    if (!nm) return null;
    const exact = await query("SELECT id, name FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(name)=LOWER(?)", [orgId, nm]);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null; // ambiguous — never mis-link
    const parts = nm.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const fuzzy = await query(
        "SELECT id, name FROM donors WHERE org_id=? AND deleted_at IS NULL AND name ILIKE ? AND name ILIKE ? LIMIT 3",
        [orgId, `%${parts[0]}%`, `%${parts[parts.length - 1]}%`]);
      if (fuzzy.length === 1) return fuzzy[0];
    }
    return null;
  };
  // A LINK names a PERSON — resolution is name-first (the spouse on a soft
  // credit shares the couple's email, so email-first would dissolve her into
  // the base record) and DETERMINISTIC (exact name matches take the earliest
  // record; a fuzzy both-token match only when unique) so a re-post never
  // mints a second copy of the same person.
  const findPersonByName = async (name) => {
    const nm = String(name || "").trim();
    if (!nm) return null;
    const exact = await query(
      "SELECT id, name FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(name)=LOWER(?) ORDER BY created_at, id LIMIT 1", [orgId, nm]);
    if (exact.length) return exact[0];
    const parts = nm.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const fuzzy = await query(
        "SELECT id, name FROM donors WHERE org_id=? AND deleted_at IS NULL AND name ILIKE ? AND name ILIKE ? ORDER BY created_at, id LIMIT 2",
        [orgId, `%${parts[0]}%`, `%${parts[parts.length - 1]}%`]);
      if (fuzzy.length === 1) return fuzzy[0];
    }
    return null;
  };
  const createPerson = async (name, email) => {
    const id = importId("d_");
    await run(
      `INSERT INTO donors (id,org_id,name,email,stage,status,tags,notes,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, orgId, name, (email || null), "prospect", "active", JSON.stringify([]), null, actor(req).id, actor(req).name]);
    counts.personsCreated++;
    return { id, name };
  };
  const linkExists = async (a, b, type) => {
    const r = await query(
      "SELECT id FROM donor_relationships WHERE org_id=? AND donor_id_a=? AND donor_id_b=? AND relationship_type=?",
      [orgId, a, b, type]);
    return r.length > 0;
  };

  // FIX-60: the run this history file is (the client mints it before the
  // gifts are written), so Undo import takes these pledges with its gifts.
  const semRunId = IMPORT_RUN_ID_RE.test(String(req.body.importId || "")) ? String(req.body.importId) : null;
  for (const p of pledges) {
    const donor = await findDonor(p.donorEmail, p.donorName, p.donorExternalId);
    if (!donor) { counts.unresolved.push({ kind: "pledge", name: p.donorName }); continue; }
    const idem = `import:pledge:${p.externalId || `${p.donorName}:${p.amount}:${p.date || ""}`}`.slice(0, 200);
    const due = p.dueDate || p.date || (await (async () => orgToday(await orgTz(orgId)))());  // ORG_TZ_SEAM_OK
    let amountCents;
    try { amountCents = parseMoneyOrThrow(p.amount, "amount"); } catch { amountCents = 0; }
    if (!(amountCents > 0)) { counts.unresolved.push({ kind: "pledge", name: p.donorName, reason: "no_amount" }); continue; }
    // FIX-60 · THE ONE PLEDGE WRITER, with its installments. The payments that
    // name this pledge are linked once it is written, and each becomes a paid
    // installment of exactly its amount, oldest first; what is left is one
    // installment due on the pledge's date. A SHELL states no schedule anybody
    // wrote down, so what is left of it has no date (never late, never chased).
    const link = async pledgeId => {
      if (p.externalId) {
        // link the payments that name this pledge in their notes
        return (await query(
          `UPDATE gifts SET pledge_id=? WHERE org_id=? AND pledge_id IS NULL AND notes ILIKE ? RETURNING id`,
          [pledgeId, orgId, `%on pledge ${p.externalId}%`])).map(r => r.id);
      }
      if (p.shell) {
        // BUILD-88a A.7 — a SHELL pledge: the export carried the payments and
        // no commitment row. Its payments are this donor's gifts whose notes
        // are in the pledge-payment family (the same BUILD-80 vocabulary that
        // made the shell); they are linked to it so the record shows twelve
        // promised and seven arrived instead of seven unrelated gifts.
        const linked = await query(
          `UPDATE gifts SET pledge_id=? WHERE org_id=? AND donor_id=? AND pledge_id IS NULL
             AND notes ~* 'pledge[[:space:]]+(payment|installment)' RETURNING id`,
          [pledgeId, orgId, donor.id]);
        counts.pledgePaymentsLinked = (counts.pledgePaymentsLinked || 0) + linked.length;
        return linked.map(r => r.id);
      }
      return [];
    };
    const wrote = await PW.writePledge({ orgId, donorId: donor.id, amountCents, dueDate: due,
      status: p.status === "fulfilled" ? "fulfilled" : "open", notes: (p.notes || "").slice(0, 500) || null,
      idempotencyKey: idem, createdBy: actor(req).id, createdByName: actor(req).name,
      importId: semRunId || "semantics:" + idem.slice(0, 120),   // SEND-GATE-1: an imported pledge is never reminded
      plan: p.shell ? { firstDue: null, undatedOk: true } : { firstDue: due }, link },
      { door: "history_import", history: true });
    if (wrote.created) {
      counts.pledges++;
      // NUMBERS-2: the linked payments decide the pledge's status (fulfilled,
      // surplus), the same as a payment recorded by hand.
      // A pledge the file called fulfilled stays so (its payments may be in no file).
      if (p.status !== "fulfilled") await recalcPledgePayment(wrote.id, orgId);
    }
  }

  for (const k of inKind) {
    const donor = await findDonor(k.donorEmail, k.donorName);
    if (!donor) { counts.unresolved.push({ kind: "in_kind", name: k.donorName }); continue; }
    const note = `In-kind gift${k.description ? `: ${k.description}` : ""}${k.fmv ? ` (fair market value $${Number(k.fmv).toLocaleString()})` : " (no value stated)"}`;
    const dupe = await query(
      "SELECT id FROM interactions WHERE org_id=? AND donor_id=? AND type='in_kind' AND note=? AND date IS NOT DISTINCT FROM ?",
      [orgId, donor.id, note, k.date || null]);
    if (dupe.length) continue;
    await run(
      `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by) VALUES (?,?,?,?,?,?,?)`,
      [importId("int_"), orgId, donor.id, "in_kind", note, k.date || null, req.user.userId]);
    counts.inKind++;
  }

  for (const l of links) {
    let baseDonor = null;
    if (l.type === "soft_credit" && l.baseGiftExternalId) {
      const g = await query(
        "SELECT donor_id FROM gifts WHERE org_id=? AND external_id=? LIMIT 1", [orgId, l.baseGiftExternalId]);
      if (g.length) baseDonor = { id: g[0].donor_id };
    }
    if (!baseDonor && (l.corpName || l.corpKey)) baseDonor = await findDonor("", l.corpName);
    if (!baseDonor) { counts.unresolved.push({ kind: l.type, name: l.personName }); continue; }
    let person = await findPersonByName(l.personName);
    if (!person && l.personName) person = await createPerson(l.personName, "");
    if (!person) continue;
    if (person.id === baseDonor.id) {
      // The credited person grouped into the base record (a spouse on the
      // couple's shared email): a household fold, not a link — counted so
      // the summary can say where the 46 spouses went.
      counts.householdFolds = (counts.householdFolds || 0) + 1;
      continue;
    }
    if (await linkExists(person.id, baseDonor.id, l.type)) continue;
    const when = l.date ? String(l.date).slice(0, 4) : "";
    const note = l.type === "soft_credit"
      ? `Soft credit on gift ${l.baseGiftExternalId || ""} ($${Number(l.dollars || 0).toLocaleString()}${l.date ? `, ${l.date}` : ""})`
      : l.type === "matching_gift"
        ? `Corporate match by ${l.corpName} ($${Number(l.dollars || 0).toLocaleString()}${l.date ? `, ${l.date}` : ""})`
        : `$${Number(l.dollars || 0).toLocaleString()} via ${l.corpName}${when ? `, ${when}` : ""}`;
    await run(
      `INSERT INTO donor_relationships (id,org_id,donor_id_a,donor_id_b,relationship_type,notes) VALUES (?,?,?,?,?,?)`,
      [importId("rel_"), orgId, person.id, baseDonor.id, l.type, note]);
    counts.links++;
  }

  for (const t of reviewTwins) {
    const donor = await findDonor("", t.name);
    if (!donor) continue;
    const r = await query("SELECT tags FROM donors WHERE id=?", [donor.id]);
    let tags = [];
    try { tags = Array.isArray(r[0]?.tags) ? r[0].tags : JSON.parse(r[0]?.tags || "[]"); } catch { tags = []; }
    if (!tags.includes("possible-duplicate")) {
      tags.push("possible-duplicate");
      await run("UPDATE donors SET tags=? WHERE id=?", [JSON.stringify(tags), donor.id]);
      counts.twinsFlagged++;
    }
  }

  // BUILD-80 Part 6.2 — the merge review list, persisted: surviving donor,
  // folded identity variants (with their gift ids), reviewable and undoable.
  // BUILD-83 FIX — a merge this route cannot store is REPORTED, never skipped
  // in silence. The BUILD-82 workbook sent `folded` as a string and every one
  // of 266 folds hit a bare `continue`: the donors were merged, no undo record
  // was written, and the completion screen said "0 merges logged" while 25,300
  // rows became 25,034 donors. A shape this route does not understand is a
  // defect that must be visible on the screen that reports the import.
  //
  // It is also written in ONE round trip per import, not three per merge: 266
  // folds × (lookup + existence check + insert) is ~800 trips to the database,
  // which is minutes on a hosted one. Everything below is set-based.
  const usableMerges = [], unstorable = [];
  for (const m of merges) {
    if (!m || !m.surviving || !Array.isArray(m.folded) || !m.folded.length) unstorable.push(m);
    else usableMerges.push(m);
  }
  if (unstorable.length) {
    counts.mergesUnstorable = unstorable.length;
    counts.mergeShapeSamples = unstorable.slice(0, 3).map(m => JSON.stringify(m).slice(0, 160));
    console.error(`[import-semantics] ${unstorable.length} merge(s) could not be stored (unrecognised shape):`,
                  counts.mergeShapeSamples.join(" | "));
  }
  if (usableMerges.length) {
    // one read for what is already stored…
    const already = new Set((await query(
      "SELECT surviving, folded::text AS folded FROM import_merges WHERE org_id=?", [orgId]))
      .map(r => r.surviving + "\u0000" + r.folded));
    // …one read to resolve every surviving donor by name or email at once…
    const wantEmails = [...new Set(usableMerges.map(m => String(m.survivingEmail || "").trim().toLowerCase()).filter(e => e.includes("@")))];
    const wantNames = [...new Set(usableMerges.map(m => String(m.surviving || "").trim().toLowerCase()).filter(Boolean))];
    const survRows = (wantEmails.length || wantNames.length) ? await query(
      `SELECT id, LOWER(email) AS e, LOWER(name) AS n FROM donors
        WHERE org_id=? AND deleted_at IS NULL AND (LOWER(email) = ANY(?) OR LOWER(name) = ANY(?))
        ORDER BY created_at, id`, [orgId, wantEmails, wantNames]) : [];
    const byEmail = new Map(), byName = new Map();
    for (const r of survRows) {
      if (r.e && !byEmail.has(r.e)) byEmail.set(r.e, r.id);
      if (r.n && !byName.has(r.n)) byName.set(r.n, r.id);
    }
    // …and one INSERT for all of them.
    const rows = [], params = [], tuples = [];
    for (const m of usableMerges) {
      const foldedJson = JSON.stringify(m.folded);
      if (already.has(m.surviving + "\u0000" + foldedJson)) { mergeRows.push({ surviving: m.surviving, folded: m.folded, existing: true }); continue; }
      const donorId = byEmail.get(String(m.survivingEmail || "").trim().toLowerCase())
        || byName.get(String(m.surviving || "").trim().toLowerCase()) || null;
      const id = importId("mrg_");
      params.push(id, orgId, donorId, m.surviving, foldedJson, actor(req).id, actor(req).name);
      tuples.push("(?,?,?,?,?,?,?)");
      rows.push({ id, surviving: m.surviving, folded: m.folded });
    }
    for (let i = 0; i < tuples.length; i += 500) {
      const slice = tuples.slice(i, i + 500);
      await run(`INSERT INTO import_merges (id,org_id,donor_id,surviving,folded,created_by,created_by_name) VALUES ${slice.join(",")}`,
                params.slice(i * 7, (i + slice.length) * 7));
    }
    counts.merges = rows.length;
    mergeRows.push(...rows);
  }

  // BUILD-83 FIX (item 2) — this route reads ITS OWN writes back, so the
  // completion screen can compare every promised figure against the database
  // rather than against what the request believed it did.
  let written = null;
  try {
    const [mg] = await query("SELECT COUNT(*)::int AS c FROM import_merges WHERE org_id=? AND undone_at IS NULL", [orgId]);
    const [pg2] = await query("SELECT COUNT(*)::int AS c FROM pledges WHERE org_id=?", [orgId]);
    written = { merges: Number(mg?.c) || 0, pledges: Number(pg2?.c) || 0 };
  } catch (e) { console.error("[import-semantics] read-back failed:", e.message); written = { error: e.message }; }
  res.json({ ok: true, counts, written, merges: mergeRows });
  // GTM-1b 1 — AFTER AN IMPORT, COUNT. The file is the thing that changes an
  // org's size, so this is where the active-donor count is re-taken. It runs
  // AFTER the response: the import's own summary must not wait on it, and a
  // failure here must never turn a successful import into an error. It never
  // touches the subscription — it records one notice and tells the admin.
  checkRecordBand(req.user.orgId).catch(e => console.error("[tier] band check after import:", e.message));
}));

// The default name: the filename with its extension stripped. A path, a
// Windows path and a bare name all reduce to the same thing.
function defaultImportName(sourceFilename) {
  const raw = String(sourceFilename || "").split(/[\\/]/).pop().trim();
  return raw.replace(/\.[A-Za-z0-9]{1,8}$/, "").trim() || "Import";
}

// THE INVARIANT, ASSERTED AGAINST THE STORED ROW. BUILD-72 Part 1 established
// it for the live write: rows in = created + set aside + errored, and the same
// in dollars. It now also has to hold for the row we keep, because a history
// that does not reconcile is a history that cannot be trusted to answer a
// question about money. Dollars are compared in INTEGER CENTS — a float
// comparison here would be the bug the invariant exists to catch.
//
// A disagreement is a FINDING, reported on the row and on the receipt. It is
// never repaired silently: the numbers are evidence, and evidence that edits
// itself to look consistent is worth nothing.
// ── BUILD-88a A.7 — THE IMPORTS MADE BEFORE THE FIX ───────────────────────
// Until this build /donors/import-combined hardcoded NULL for a gift's fund
// and had no payment_method column at all, so every gift imported before it
// carries neither — including in orgs already running. We do NOT back-fill by
// guessing which fund a gift belonged to; a fund is an accounting fact and a
// guess at one is worse than a blank. The runs that predate the fix say so on
// their own row instead, and the remedy is the file the org already has:
// re-importing is a no-op for anything carrying an external gift id.
const FUND_METHOD_FIX_AT = "2026-09-16T00:00:00.000Z";
function importNotices(row) {
  const out = [];
  const at = row.committed_at ? new Date(row.committed_at).toISOString() : null;
  if (at && at < FUND_METHOD_FIX_AT)
    out.push("Funds and payment methods from this import were not stored. Re-import the file to fill them.");
  return out;
}

function importFindings(row, summary) {
  const out = [];
  const n = v => Number(v) || 0;
  const s = summary && typeof summary === "object" ? summary : {};
  // FIX-52: a pledge is a row the file brought in, as much as a gift is. The
  // spreadsheet import stores how many it made; every other shape has none.
  // A receipt written before FIX-52 kept the same figures under summary.counts.
  const sc = s.counts && typeof s.counts === "object" && row.shape === "sheet" ? s.counts : {};
  const rowsIn = n(row.rows_in), created = n(row.gifts_created), pledges = n(s.pledgesCreated ?? sc.pledgesCreated),
        aside = n(row.rows_set_aside), errored = n(row.rows_errored);
  if (rowsIn !== created + pledges + aside + errored) {
    out.push(`Rows do not reconcile: ${rowsIn} in the file, ${created} gifts${pledges ? ` + ${pledges} pledges` : ""} created + ${aside} set aside + ${errored} errored = ${created + pledges + aside + errored}.`);
  }
  const c = v => money.toCents(v) ?? 0;
  const inC = c(row.dollars_in), madeC = c(row.dollars_created),
        pledgeC = s.pledgeDollarsCreated != null ? c(s.pledgeDollarsCreated) : sc.pledgeCents != null ? n(sc.pledgeCents) : 0,
        asideC = c(s.dollarsSetAside), errC = c(s.dollarsErrored);
  if (inC !== madeC + pledgeC + asideC + errC) {
    out.push(`Dollars do not reconcile: ${money.formatCents(inC)} in the file, ${money.formatCents(madeC)} in gifts${pledgeC ? ` + ${money.formatCents(pledgeC)} in pledges` : ""} created + ${money.formatCents(asideC)} set aside + ${money.formatCents(errC)} errored = ${money.formatCents(madeC + pledgeC + asideC + errC)}.`);
  }
  // The stored columns against the summary's own copy of the same figures.
  // These are written in one request from one object; if they ever differ,
  // something between the screen and the row is lying.
  const pairs = [["rowsIn", rowsIn], ["giftsCreated", created], ["donorsCreated", n(row.donors_created)],
                 ["rowsSetAside", aside], ["rowsErrored", errored]];
  for (const [k, stored] of pairs) {
    if (s[k] != null && Number(s[k]) !== stored) {
      out.push(`Stored ${k} is ${stored} but the receipt shows ${Number(s[k])}.`);
    }
  }
  if (s.dollarsIn != null && c(s.dollarsIn) !== inC) out.push(`Stored dollars in is ${money.formatCents(inC)} but the receipt shows ${money.formatCents(c(s.dollarsIn))}.`);
  if (s.dollarsCreated != null && c(s.dollarsCreated) !== madeC) out.push(`Stored dollars created is ${money.formatCents(madeC)} but the receipt shows ${money.formatCents(c(s.dollarsCreated))}.`);
  return out;
}

// FIX-11 Part 4 — `gift_file_with_donors` is a gift file imported against an
// org where those donors did not exist, so the import created them too. It is
// its own shape because it is the one import besides a deposit that reverses
// as a whole (see WHOLE_IMPORT_SHAPES): everything in it came out of one file.
const IMPORT_SHAPES = new Set(["workbook", "transaction", "aggregate", "wide", "donors", "gifts",
                               "deposit", "gift_file_with_donors", "unknown"]);

// Record a run. Called by the importer once the write has committed, with the
// same object the receipt is rendering.
app.post("/imports", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const b = req.body || {};
  const summary = (b.summary && typeof b.summary === "object" && !Array.isArray(b.summary)) ? b.summary : {};
  const sourceFilename = String(b.sourceFilename || "").slice(0, 300) || null;
  const base = String(b.name || "").trim() || defaultImportName(sourceFilename);
  const taken = (await query("SELECT name FROM imports WHERE org_id=?", [orgId])).map(r => r.name);
  const name = uniqueImportName(base, taken);
  const shape = IMPORT_SHAPES.has(String(b.shape || "")) ? String(b.shape) : "unknown";
  // TRANS-1 — which system this file came out of. Stored on the run so a
  // named import says where it came from, and the Move Report knows which
  // vendor to name. Validated against the tile list: an unknown string is
  // dropped rather than stored, because it would print as a vendor name.
  const { moveTile: moveTileFor } = await import("../../shared/movePlan.js");
  const migrationSource = moveTileFor(String(b.migrationSource || "").trim())
    ? String(b.migrationSource).trim() : null;
  const int = v => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const dol = v => money.toDollars(money.toCents(v) ?? 0);
  const started = b.startedAt && !isNaN(Date.parse(b.startedAt)) ? new Date(b.startedAt).toISOString() : null;
  // WHO ran it, by the name a colleague would recognise. actor(req) carries the
  // email (it is the identifier that is always present); the Imports page is
  // read by a person, so the person's name is looked up once and stored beside
  // the id — the row must still read correctly after the user has left.
  const act = actor(req);
  const [me] = act.id ? await query("SELECT name FROM users WHERE id=? AND org_id=?", [act.id, orgId]) : [];
  const actorName = (me && me.name) || act.name || null;
  // TRANS-1 Part 3 — the client mints the run id BEFORE the write so the
  // gifts can carry it, then hands it back here. Validated to the same shape
  // this route would have generated, and refused if the org already used it,
  // so a replayed request cannot overwrite a recorded run.
  // FIX-37: the answer the import ran under. The job holds the one the
  // gifts were actually written with; the client's copy is the fallback.
  const thanksFrom = async runIdOf => {
    const [j] = runIdOf ? await query(`SELECT thanks FROM import_recent_jobs WHERE import_id=? AND org_id=?`, [runIdOf, orgId]) : [];
    const a = IT.cleanAnswer(j ? (typeof j.thanks === "string" ? JSON.parse(j.thanks) : j.thanks) : null) || IT.cleanAnswer(b.thanks);
    return a ? JSON.stringify(a) : null;
  };
  let id = importId("imp_");
  if (/^imp_[A-Za-z0-9_-]{4,40}$/.test(String(b.id || ""))) {
    const taken = await query("SELECT id FROM imports WHERE id=? AND org_id=?", [String(b.id), orgId]);
    if (taken.length) return res.status(409).json({ error: "run_already_recorded", id: String(b.id) });
    id = String(b.id);
  }
  const thanksSaved = await thanksFrom(id);
  await run(
    `INSERT INTO imports (id, org_id, name, source_filename, shape, started_at, committed_at,
       rows_in, gifts_created, donors_created, donors_merged, rows_set_aside, rows_errored,
       dollars_in, dollars_created, actor_user_id, actor_user_name, summary_json, migration_source, thanks_answer)
     VALUES (?,?,?,?,?,?,NOW(),?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb)`,
    [id, orgId, name, sourceFilename, shape, started,
     int(b.rowsIn), int(b.giftsCreated), int(b.donorsCreated), int(b.donorsMerged),
     int(b.rowsSetAside), int(b.rowsErrored), dol(b.dollarsIn), dol(b.dollarsCreated),
     act.id, actorName, JSON.stringify(summary), migrationSource, thanksSaved]);
  const [row] = await query("SELECT * FROM imports WHERE id=? AND org_id=?", [id, orgId]);
  // MAIL-1: her first real donor file is what turns Steward's mail on for the org.
  await require("../../onboarded").stampOnboardedFromImport(query, orgId, id)
    .catch(e => console.error("[mail-1] onboarded stamp:", e.message));
  require("../../routes/dataHealth").afterImport(orgId, id);   // CLEAN-1: Data health runs after every import
  // LIVE-1 · "WHAT THIS TOLD US". Written from the rows this run wrote (its
  // gifts carry the run id, its new people carry it too), and from what the
  // after-change step saw when the file was saved (stamped with the run id).
  // FIX-37: while the run's recent gifts are still being worked through, the
  // job writes it when it finishes (writeImportReadoutOnce).
  let readout = null;
  try { readout = await writeImportReadoutOnce(orgId, id); }
  catch (e) { console.error("[readout] import:", e.message); }
  const [jobNow] = await query(`SELECT status, finished_at FROM import_recent_jobs WHERE import_id=? AND org_id=?`, [id, orgId]);
  const findings = importFindings(row, summary);
  if (findings.length) console.error("[imports] run recorded WITH FINDINGS:", id, findings.join(" "));
  res.json({ ok: true, id, name, reconciled: findings.length === 0, findings,
             readout: readout ? { id: readout.id, headline: readout.headline } : null,
             working: !!(jobNow && recentJobStatus(jobNow) === "running") && !readout });
}));

// FIX-58 · WHO, BY NAME. The person who ran an import, by the name they go by
// now; a row stamped before FIX-57 holds an email there, and a system run its
// identity, which reads as Steward.
const IMPORT_WHO_SQL = `CASE WHEN i.actor_user_name LIKE 'system:%' THEN 'Steward'
                              ELSE COALESCE(NULLIF(TRIM(u.name), ''), i.actor_user_name) END`;
// FIX-58 · "DOLLARS IN" IS NEVER ONE SUM OF GIFTS AND PROMISES. What came in
// as gifts (a pledge's paid first year included) and what is still pledged,
// each from the receipt as it was stored. A spreadsheet receipt from before
// FIX-58 did not store its first payments' dollars, so those are read from
// the payments it wrote. The gift history read "$566,183.93" here, the file's
// net with its refunds, while its 278 gifts are $571,129.93.
async function importGivenParts(orgId, rows) {
  const old = rows.filter(r => r.shape === "sheet" && !(r.summary_json && (typeof r.summary_json === "string" ? /"givenCents"/.test(r.summary_json) : r.summary_json.givenCents != null))).map(r => r.id);
  const paid = new Map(old.length ? (await query(`SELECT import_id, ROUND(SUM(amount)*100)::bigint AS c FROM gifts WHERE org_id=? AND import_id = ANY(?) AND pledge_id IS NOT NULL GROUP BY import_id`,
    [orgId, old])).map(x => [x.import_id, Number(x.c) || 0]) : []);
  return (r, summary) => {
    const c = v => money.toCents(v) ?? 0;
    const sc = summary.counts && typeof summary.counts === "object" ? summary.counts : {};
    const pledgeC = summary.pledgeDollarsCreated != null ? c(summary.pledgeDollarsCreated) : sc.pledgeCents != null ? Number(sc.pledgeCents) || 0 : 0;
    const firstC = summary.givenCents != null ? Number(summary.givenCents) - c(r.dollars_created) : paid.get(r.id) || 0;
    const givenC = c(r.dollars_created) + firstC;
    const pledgedC = summary.pledgedOpenCents != null ? Number(summary.pledgedOpenCents) || 0 : Math.max(0, pledgeC - firstC);
    return { dollarsGiven: givenC / 100, dollarsPledged: pledgedC / 100,
             dollarsInWords: pledgedC ? `${money.formatCentsPlain(givenC)} given · ${money.formatCentsPlain(pledgedC)} pledged` : givenC || Number(r.gifts_created) ? money.formatCentsPlain(givenC) : "No gifts" };
  };
}

// POLISH-2 Part 6: the Imports list shows files she brought in. A connection's
// scheduled check ("PayPal - checked 2026-10-12", shape 'source') is that
// connection's history and is read there (GET /connections/:id/log), so it is
// left out here unless a caller asks for everything with ?include=checks.
app.get("/imports", requireAuth, wrap(async (req, res) => {
  const withChecks = req.query.include === "checks";
  const rows = await query(
    `SELECT i.id, i.name, i.source_filename, i.shape,
            TO_CHAR(i.committed_at AT TIME ZONE ?, 'YYYY-MM-DD') AS committed_on,
            i.committed_at, ${IMPORT_WHO_SQL} AS actor_user_name, i.rows_in, i.gifts_created, i.donors_created,
            i.donors_merged, i.rows_set_aside, i.rows_errored, i.dollars_in, i.dollars_created, i.summary_json,
            i.migration_source, i.thanks_answer, i.reversed_at
       FROM imports i LEFT JOIN users u ON u.id = i.actor_user_id AND u.org_id = i.org_id
      WHERE i.org_id=? ${withChecks ? "" : "AND COALESCE(i.shape, '') <> 'source'"}
      ORDER BY i.committed_at DESC, i.id DESC LIMIT 200`,
    [await orgTzName(req.user.orgId), req.user.orgId]);
  const given = await importGivenParts(req.user.orgId, rows);
  // POLISH-5: a running job's day is the org's, like the committed rows' (TO_CHAR above).
  const tzOrg = await orgTz(req.user.orgId);
  // FIX-52: a spreadsheet import still being written, or one that failed and
  // was rolled back, is on the list too, read from its job, never guessed.
  const jobs = await query(`SELECT j.id, j.file_name, j.status, j.phase, j.done, j.total, j.error, j.started_at, j.created_by_name
                              FROM sheet_import_jobs j WHERE j.org_id=? AND j.status IN ('running','failed') AND j.started_at > NOW() - interval '7 days'
                               AND NOT EXISTS (SELECT 1 FROM imports i WHERE i.id=j.id AND i.org_id=j.org_id)
                             ORDER BY j.started_at DESC LIMIT 20`, [req.user.orgId]);
  const recent = await recentGiftRuns(req.user.orgId, rows);
  res.json({
    imports: jobs.map(j => ({ id: j.id, name: j.file_name || "Spreadsheet", sourceFilename: j.file_name, shape: "sheet",
      committedOn: orgToday(tzOrg, new Date(j.started_at)), committedAt: j.started_at, by: j.created_by_name || null,   // ORG_TZ_SEAM_OK
      state: j.status === "running" ? "in_progress" : "failed", phase: j.phase, done: Number(j.done) || 0, total: Number(j.total) || 0,
      sentence: j.status === "running" ? `In progress: ${j.phase || "starting"}.` : `Not imported. ${j.error || ""} Nothing was written.`,
      rowsIn: 0, giftsCreated: 0, donorsCreated: 0, donorsMerged: 0, rowsSetAside: 0, rowsErrored: 0, dollarsIn: 0, dollarsCreated: 0,
      reconciled: true, findings: [], notices: [] })).concat(rows.map(r => {
      const summary = typeof r.summary_json === "string" ? JSON.parse(r.summary_json) : (r.summary_json || {});
      // FIX-58: an undone import says Undone, and only that
      const findings = r.reversed_at ? [] : importFindings(r, summary);
      return {
        id: r.id, name: r.name, sourceFilename: r.source_filename, shape: r.shape,
        committedOn: r.committed_on, committedAt: r.committed_at, by: r.actor_user_name || null,
        rowsIn: Number(r.rows_in) || 0, giftsCreated: Number(r.gifts_created) || 0,
        donorsCreated: Number(r.donors_created) || 0, donorsMerged: Number(r.donors_merged) || 0,
        rowsSetAside: Number(r.rows_set_aside) || 0, rowsErrored: Number(r.rows_errored) || 0,
        dollarsIn: Number(r.dollars_in) || 0, dollarsCreated: Number(r.dollars_created) || 0,
        ...given(r, summary),
        reconciled: findings.length === 0, findings, notices: importNotices(r),
        // TRANS-1 — a named import says where the file came from, and whether
        // it has a Move Report to open. `hasMoveReport` is the presence of the
        // stored file facts, not a guess from the source name: a run recorded
        // before this build has a source but nothing to compare.
        migrationSource: r.migration_source || null,
        hasMoveReport: !!(summary && summary.moveFile),
        // FIX-37: what she answered about the last 30 days' thank-yous; HARDEN-1:
        // only for a run that had gifts from those 30 days to thank.
        thanks: recent.has(r.id) ? IT.answerSentence(IT.cleanAnswer(r.thanks_answer)) || null : null,
        state: r.reversed_at ? "undone" : "done",
        pledgesCreated: Number(summary.pledgesCreated) || 0,
        ...peopleLine(r, summary),
        sheetRows: summary.sheetRows || null,   // IMPORT-7
      };
    })),
  });
}));

// FIX-37: how far an import's recent-gift work has got, for the import
// screen's progress line. Its readout is included once the work is done.
app.get("/imports/:id/progress", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [j] = await query(`SELECT * FROM import_recent_jobs WHERE import_id=? AND org_id=?`, [req.params.id, orgId]);
  if (!j) return res.status(404).json({ error: "not_found", message: "No work is running for that import." });
  const [ro] = recentJobStatus(j) === "done" ? await query(
    `SELECT id, headline FROM readouts WHERE org_id=? AND source_kind='import' AND source_id=? AND removed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [orgId, req.params.id]) : [];
  const errors = typeof j.errors === "string" ? JSON.parse(j.errors) : (j.errors || []);
  // JOBS-1: a gift's thank-you draft is its event's handler, written a moment
  // after the gift, so the count is the drafts that exist for this run's gifts,
  // read now, not a tally taken as each gift was written.
  const [ty] = await query(
    `SELECT COUNT(*)::int AS n FROM thank_you_drafts t JOIN gifts g ON g.id = t.gift_id AND g.org_id = t.org_id
      WHERE t.org_id = ? AND g.import_id = ?`, [orgId, req.params.id]);
  res.json({ status: recentJobStatus(j), total: Number(j.total) || 0, done: Math.min(Number(j.done) || 0, Number(j.total) || 0),
             thankYouDrafts: ty ? ty.n : 0, errors, sentence: recentProgressSentence(j),
             readout: ro ? { id: ro.id, headline: ro.headline } : null });
}));

// HARDEN-1 · A RUN WITH NO RECENT GIFTS THANKED NOBODY. The answer to "have the
// last 30 days been thanked?" is shown only on a run that had a gift dated in
// the 30 days before it committed; a contacts file drafted no thank-yous.
async function recentGiftRuns(orgId, rows) {
  const ids = rows.filter(r => r.thanks_answer).map(r => r.id);
  if (!ids.length) return new Set();
  const hit = await query(`SELECT DISTINCT g.import_id AS id FROM gifts g JOIN imports i ON i.id=g.import_id AND i.org_id=g.org_id
                            WHERE g.org_id=? AND g.import_id = ANY(?) AND g.date IS NOT NULL
                              AND g.date::date >= (i.committed_at::date - 30)`, [orgId, ids]);
  return new Set(hit.map(x => x.id));
}
// HARDEN-1 · A FILE OF PEOPLE IS COUNTED IN PEOPLE. Its receipt read "0 rows in
// the file" after writing 656 people: rows_in counts gift rows. A run with no
// gift rows says what it did with its people instead (stored on the run, never
// recomputed: the reader keeps its rows and matches; the old mapper its counts).
function peopleLine(r, summary) {
  const gifts = Number(r.gifts_created) || 0, rowsIn = Number(r.rows_in) || 0;
  const made = Number(r.donors_created) || 0;
  const matched = summary.peopleMatched != null ? Number(summary.peopleMatched) || 0 : Number(r.donors_merged) || Number(summary.donorsMatched) || 0;
  if (rowsIn || gifts || !(made + matched)) return { peopleRowsIn: null, peopleSentence: null };
  const rowsP = summary.personRowsInFile != null ? Number(summary.personRowsInFile) || 0 : null;
  const folded = rowsP != null ? Math.max(0, rowsP - made - matched) : 0;
  const n = (k, w) => `${k.toLocaleString("en-US")} ${k === 1 ? w : w + "s"}`;
  const parts = [`${made.toLocaleString("en-US")} added`, `${matched.toLocaleString("en-US")} already here`];
  if (folded) parts.push(`${n(folded, "row")} for someone named on another row`);
  return { peopleRowsIn: rowsP, peopleMatched: matched,
           peopleSentence: `${rowsP != null ? n(rowsP, "row") + " of people" : `${(made + matched).toLocaleString("en-US")} ${made + matched === 1 ? "person" : "people"}`} in the file = ${parts.join(" + ")}. No gifts in this file.` };
}

// One run, with the receipt exactly as it was shown.
app.get("/imports/:id", requireAuth, wrap(async (req, res) => {
  const [r] = await query(`SELECT i.*, ${IMPORT_WHO_SQL} AS actor_user_name FROM imports i LEFT JOIN users u ON u.id = i.actor_user_id AND u.org_id = i.org_id
                             WHERE i.id=? AND i.org_id=?`, [req.params.id, req.user.orgId]);
  if (!r) return res.status(404).json({ error: "import not found" });
  const summary = typeof r.summary_json === "string" ? JSON.parse(r.summary_json) : (r.summary_json || {});
  // FIX-58: an undone import says Undone, and only that
  const findings = r.reversed_at ? [] : importFindings(r, summary);
  const given = (await importGivenParts(req.user.orgId, [r]))(r, summary);
  // FIX-58: the gift rows said once, each part opening its rows
  const src = part => ({ key: "import-gifts", params: { import: r.id, ...(part ? { part } : {}) } });
  const giftLine = summary.giftLine ? { ...summary.giftLine, sources: { gifts: src("gifts"), first: src("first"), all: src(null) } } : null;
  res.json({
    import: {
      id: r.id, name: r.name, sourceFilename: r.source_filename, shape: r.shape,
      startedAt: r.started_at, committedAt: r.committed_at, by: r.actor_user_name || null,
      rowsIn: Number(r.rows_in) || 0, giftsCreated: Number(r.gifts_created) || 0,
      donorsCreated: Number(r.donors_created) || 0, donorsMerged: Number(r.donors_merged) || 0,
      rowsSetAside: Number(r.rows_set_aside) || 0, rowsErrored: Number(r.rows_errored) || 0,
      dollarsIn: Number(r.dollars_in) || 0, dollarsCreated: Number(r.dollars_created) || 0,
      reconciled: findings.length === 0, findings, notices: importNotices(r),
      migrationSource: r.migration_source || null,
      hasMoveReport: !!(summary && summary.moveFile),
      thanks: (await recentGiftRuns(req.user.orgId, [r])).has(r.id) ? IT.answerSentence(IT.cleanAnswer(r.thanks_answer)) || null : null,
      ...peopleLine(r, summary),
      ...given, giftLine,
      // IMPORT-7: each sheet's rows, each count named (routes/sheetImport.js sheetAccount)
      sheetRows: summary.sheetRows || null,
      // FIX-52: the pledges it made are part of what it brought in, and every
      // receipt that reverses as a whole offers Undo for its window, whether
      // or not it reconciles: an import that went wrong is when undo matters.
      pledgesCreated: Number(summary.pledgesCreated ?? (r.shape === "sheet" && summary.counts ? summary.counts.pledgesCreated : 0)) || 0,
      pledgeDollarsCreated: summary.pledgeDollarsCreated != null ? Number(summary.pledgeDollarsCreated) || 0
        : r.shape === "sheet" && summary.counts && summary.counts.pledgeCents != null ? (Number(summary.counts.pledgeCents) || 0) / 100 : 0,
      reversedAt: r.reversed_at || null,
      ...importUndoWindow(r),
      summary,
    },
  });
}));

// ── THE MOVE REPORT ────────────────────────────────────────────────────────
//
// What Steward HOLDS from one import, in the same shape buildMoveFileFacts
// produced for the file. Scoped by `import_id`, which is why the two columns
// are comparable at all: both sides are counting the same run's rows.
// THE HELD SIDE IS THE WHOLE MOVE, NOT ONE RUN.
//
// This scoped itself to a single `import_id`, and the screen it produced was
// the opposite of the thing this page exists to do. A re-export is the org's
// WHOLE file again, so the file side of the second report was 13 gifts and
// $4,222.02 while the held side counted only the 5 rows that run happened to
// create: the headline read "8 fewer gifts than your file and $3,124.84 less
// than your file", and "People: your file says 6, Steward holds 0", about a
// move in which precisely nothing had been lost.
//
// So the two sides are measured the same way: the file is everything the
// export contained, and what Steward holds is everything the move has landed
// up to and including this run. For a first import the two definitions are
// identical; for a re-import this is the only one that is true. "Since last
// time" stays per-run, because that genuinely is about one run.
async function moveRunIds(orgId, imp) {
  if (!imp.migration_source) return [imp.id];
  // NO TIMESTAMP ARITHMETIC. This read `committed_at <= ?` with the run's own
  // committed_at, and a run EXCLUDED ITSELF: Postgres keeps microseconds
  // (…56.77548) and a JavaScript Date only holds milliseconds, so the value
  // that came out of the row was a few microseconds earlier than the row by
  // the time it went back in. The second Move Report then compared a 13-gift
  // file against the 8 gifts of the FIRST run alone. The order is taken from
  // the database and cut at this run by ID, which cannot round.
  const rows = await query(
    `SELECT id FROM imports
      WHERE org_id=? AND migration_source=? AND reversed_at IS NULL
      ORDER BY committed_at ASC, id ASC`, [orgId, imp.migration_source]);
  const ids = [];
  for (const r of rows) { ids.push(r.id); if (r.id === imp.id) break; }
  return ids.includes(imp.id) ? ids : [imp.id];
}

async function moveHeldFacts(orgId, importId) {
  const [g] = await query(
    // HARDEN-1: a deleted person's gifts are not held. They stay as rows
    // (deletion is soft), and this read counted them: on 27 Oct an org whose
    // people from the move had all been deleted read "3,315 gifts,
    // $2,887,186.01". Same predicate as the people and top-donor reads below.
    `SELECT COUNT(*)::int gifts, COALESCE(SUM(ROUND(g.amount*100)),0)::bigint cents
       FROM gifts g WHERE g.org_id=? AND g.import_id = ANY(?) AND ${NOT_DELETED("g")}`, [orgId, importId]);
  const years = await query(
    // `gifts.date` is TEXT in 'YYYY-MM-DD', so the year is LEFT(date,4) -- the
    // same seam every other report here groups by. EXTRACT() does not apply to
    // a text column and answers 42883.
    `SELECT LEFT(g.date, 4)::int y, COALESCE(SUM(ROUND(g.amount*100)),0)::bigint cents
       FROM gifts g
      WHERE g.org_id=? AND g.import_id = ANY(?) AND g.date IS NOT NULL AND g.date <> '' AND ${NOT_DELETED("g")}
      GROUP BY 1 ORDER BY 1 DESC`, [orgId, importId]);
  const [p] = await query(
    `SELECT COUNT(*)::int people,
            COUNT(DISTINCT external_household_id)::int households,
            COUNT(*) FILTER (WHERE imported_sustainer IS TRUE)::int recurring
       FROM donors WHERE org_id=? AND created_import_id = ANY(?) AND deleted_at IS NULL`, [orgId, importId]);
  // The people this run's gifts actually landed on -- which includes anyone
  // it MATCHED rather than created, so the top-25 column is not silently
  // short by every returning donor.
  const top = await query(
    // The identity precedence here MUST be the one buildMoveFileFacts used on
    // the file side (source id, then e-mail, then name). It read e-mail first,
    // and the moment donors started carrying their source id the two columns
    // keyed differently: every figure still footed, but the top-donor rows no
    // longer lined up and the headline stopped claiming a match it had.
    `SELECT COALESCE(NULLIF(d.external_donor_id,''), NULLIF(d.email,''), d.name) k, d.name,
            COALESCE(SUM(ROUND(g.amount*100)),0)::bigint cents, COUNT(g.*)::int gifts
       FROM gifts g JOIN donors d ON d.id=g.donor_id
      WHERE g.org_id=? AND g.import_id = ANY(?) AND d.deleted_at IS NULL
      GROUP BY 1,2 ORDER BY cents DESC, d.name ASC LIMIT 25`, [orgId, importId]);
  return {
    people: Number(p?.people) || 0,
    households: Number(p?.households) || 0,
    gifts: Number(g?.gifts) || 0,
    cents: Number(g?.cents) || 0,
    recurringPeople: Number(p?.recurring) || 0,
    byYear: years.map(r => ({ year: Number(r.y), cents: Number(r.cents) })),
    topDonors: top.map(r => ({ key: String(r.k || "").toLowerCase(), name: r.name, cents: Number(r.cents), gifts: r.gifts })),
  };
}

app.get("/imports/:id/move-report", requireAuth, wrap(async (req, res) => {
  const M = await moveMod();
  const orgId = req.user.orgId;
  const [r] = await query("SELECT * FROM imports WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!r) return res.status(404).json({ error: "import not found" });
  const summary = typeof r.summary_json === "string" ? JSON.parse(r.summary_json) : (r.summary_json || {});
  // The file side, as stored at commit. An import recorded before this build
  // has no stored file facts, and the honest answer is to say so rather than
  // to reconstruct the file from the rows it produced and call that a match.
  const file = summary.moveFile || null;
  const runIds = await moveRunIds(orgId, r);
  const held = await moveHeldFacts(orgId, runIds);
  const typed = (r.old_system_gifts != null || r.old_system_cents != null)
    ? { gifts: r.old_system_gifts, cents: r.old_system_cents } : null;
  const vendor = r.migration_source ? M.moveTileLabel(r.migration_source) : "";

  if (!file) {
    return res.json({
      moveReport: null, held, vendor,
      unavailable: "This import ran before Steward started keeping the file's own figures, so there is nothing to compare it against. The next import you run will have a full Move Report.",
      import: { id: r.id, name: r.name, committedAt: r.committed_at, source: r.migration_source || null },
    });
  }
  const report = M.buildMoveReport({ file, held, typed, vendor, runs: runIds.length });
  res.json({
    moveReport: report, file, held, vendor,
    since: M.buildSinceLastTime({
      giftsCreated: Number(r.gifts_created) || 0,
      centsCreated: Math.round((Number(r.dollars_created) || 0) * 100),
      peopleCreated: Number(r.donors_created) || 0,
      giftsAlreadyHeld: Number(summary.externalIdDupes) || 0,
      peopleMatched: Number(summary.donorsMatched) || 0,
    }),
    import: { id: r.id, name: r.name, committedAt: r.committed_at, source: r.migration_source || null,
              by: r.actor_user_name || null },
  });
}));


// The board's copy of the proof. Rendered from the SAME payload the screen
// renders, so the two cannot disagree about a figure -- the rule the board
// packet already follows. Every number keeps its defining sentence as a
// footnote, because a treasurer reading this has no hover.
async function renderMoveReportPdf({ report, org, imp, vendor }) {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ margin: 50, size: "LETTER", bufferPages: true });
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const INK = "#0f1a12", GREY = "#5a554f", BRASS = "#c9a84c", CREAM = "#f0ede6";
    const PW = doc.page.width, L = 50, R = PW - 50;
    const money = c => {
      const n = Math.trunc(Number(c) || 0);
      return (n < 0 ? "-$" : "$") + (Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const num = n => (Math.trunc(Number(n) || 0)).toLocaleString("en-US");
    const cell = (l, f, h, matches, isMoney) => {
      const y = doc.y;
      doc.font("Helvetica").fontSize(10).fillColor(INK).text(l, L, y, { width: 240 });
      doc.font("Helvetica").fontSize(10).fillColor(GREY)
         .text(isMoney ? money(f) : num(f), L + 240, y, { width: 110, align: "right" });
      doc.font(matches ? "Helvetica" : "Helvetica-Bold").fontSize(10).fillColor(matches ? INK : "#8a6d1f")
         .text(isMoney ? money(h) : num(h), L + 355, y, { width: 110, align: "right" });
      doc.y = y + 16;
    };

    doc.rect(0, 0, PW, 84).fill(INK);
    doc.font("Helvetica").fontSize(9).fillColor(BRASS).text(String(org?.name || ""), L, 24);
    doc.font("Helvetica-Bold").fontSize(19).fillColor(CREAM).text("Move Report", L, 40, { width: PW - 100 });
    doc.font("Helvetica").fontSize(9).fillColor("#cfc9bd")
       .text(vendor ? `Moving from ${vendor}` : "Proof that nothing was lost", L, 64);
    doc.y = 108;

    // The headline is the proof, so it leads the page too.
    doc.font("Helvetica-Bold").fontSize(14).fillColor(INK)
       .text(report.headline, L, doc.y, { width: R - L });
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(9).fillColor(GREY)
       .text(`${imp?.name || "This import"}${imp?.committedAt ? ` · imported ${String(imp.committedAt).slice(0, 10)}` : ""}${imp?.by ? ` by ${imp.by}` : ""}`,
             L, doc.y, { width: R - L });
    doc.moveDown(1);

    const head = (t) => {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY).text(String(t).toUpperCase(), L, doc.y);
      doc.y += 4;
      doc.font("Helvetica").fontSize(8).fillColor(GREY)
         .text("YOUR FILE", L + 240, doc.y - 14, { width: 110, align: "right" })
         .text("IN STEWARD", L + 355, doc.y - 14, { width: 110, align: "right" });
      doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor("#d4cfc6").lineWidth(0.7).stroke();
      doc.y += 6;
    };

    head("Your file, and what Steward holds");
    for (const l of report.lines) cell(l.label, l.file, l.held, l.matches, l.money);
    if (report.byYear.length) {
      doc.moveDown(0.8); head("Dollars by year");
      for (const l of report.byYear) cell(l.label, l.file, l.held, l.matches, l.money);
    }
    if (report.topDonors.length) {
      doc.moveDown(0.8); head(`Top ${report.topDonors.length} donors by what this move brought`);
      for (const d of report.topDonors) cell(d.name, d.file, d.held, d.matches, true);
    }
    if (report.typed && report.typed.length) {
      doc.moveDown(0.8); head("Compared against your old system's own totals");
      for (const t of report.typed) cell(t.label, t.typedValue, t.held, t.matches, t.money);
    }
    if (report.differences.length || report.mismatchedDonors.length) {
      doc.moveDown(0.8);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY).text("WHAT DIFFERS, EXACTLY", L, doc.y);
      doc.y += 6;
      for (const d of report.differences) {
        doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(
          `${d.label}: your file says ${d.money ? money(d.file) : num(d.file)}, Steward holds ${d.money ? money(d.held) : num(d.held)}.`,
          L, doc.y, { width: R - L });
        doc.y += 3;
      }
      for (const d of report.mismatchedDonors) {
        doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(
          `${d.name}: your file says ${money(d.file)}, Steward holds ${money(d.held)}.`, L, doc.y, { width: R - L });
        doc.y += 3;
      }
    }

    // Every number's sentence, as footnotes: a treasurer reading paper has
    // no hover, and a figure without its definition is not evidence.
    doc.moveDown(1.2);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(GREY).text("WHAT EACH FIGURE MEANS", L, doc.y);
    doc.y += 5;
    for (const l of report.lines) {
      doc.font("Helvetica").fontSize(7.5).fillColor(GREY)
         .text(`${l.label} · ${l.sentence}`, L, doc.y, { width: R - L });
      doc.y += 2;
    }
    doc.moveDown(0.6);
    doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(GREY).text(
      "The left column is your file's own figures, recorded when it was imported. The right column is read from Steward now. Nothing here was typed by us.",
      L, doc.y, { width: R - L });

    doc.end();
  });
}

app.get("/imports/:id/move-report/pdf", requireAuth, wrap(async (req, res) => {
  const M = await moveMod();
  const orgId = req.user.orgId;
  const [r] = await query("SELECT * FROM imports WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!r) return res.status(404).json({ error: "import not found" });
  const summary = typeof r.summary_json === "string" ? JSON.parse(r.summary_json) : (r.summary_json || {});
  const file = summary.moveFile || null;
  if (!file) return res.status(409).json({ error: "no_move_report",
    message: "This import ran before Steward started keeping the file's own figures, so there is no Move Report to print." });
  const runIds = await moveRunIds(orgId, r);
  const held = await moveHeldFacts(orgId, runIds);
  const typed = (r.old_system_gifts != null || r.old_system_cents != null)
    ? { gifts: r.old_system_gifts, cents: r.old_system_cents } : null;
  const vendor = r.migration_source ? M.moveTileLabel(r.migration_source) : "";
  const report = M.buildMoveReport({ file, held, typed, vendor, runs: runIds.length });
  const org = await orgRow(orgId);
  const pdf = await renderMoveReportPdf({ report, org, vendor, imp: {
    name: r.name, committedAt: r.committed_at, by: r.actor_user_name || null } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="move-report-${r.id}.pdf"`);
  res.setHeader("Content-Length", pdf.length);
  res.end(pdf);
}));

// The org's own totals, from the system they are leaving. A person's figure
// typed from memory is never folded into the headline -- it gets its own
// column -- so this stores it and nothing else.
app.post("/imports/:id/old-system-totals", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [r] = await query("SELECT id FROM imports WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!r) return res.status(404).json({ error: "import not found" });
  const clear = req.body?.clear === true;
  const gifts = clear ? null : (req.body?.gifts == null || req.body.gifts === "" ? null : Math.trunc(Number(req.body.gifts)));
  const cents = clear ? null : (req.body?.cents == null || req.body.cents === "" ? null : Math.trunc(Number(req.body.cents)));
  if (!clear && ((gifts != null && !(Number.isFinite(gifts) && gifts >= 0)) ||
                 (cents != null && !(Number.isFinite(cents) && cents >= 0))))
    return res.status(400).json({ error: "bad_totals", message: "Enter a whole number of gifts and a dollar total." });
  await run(`UPDATE imports SET old_system_gifts=?, old_system_cents=? WHERE id=? AND org_id=?`,
            [gifts, cents, req.params.id, orgId]);
  res.json({ ok: true, typed: clear ? null : { gifts, cents } });
}));
// FIX-11 Part 4 — THE SECOND SHAPE THAT REVERSES AS A WHOLE, and it is a
// deliberate widening of the rule below it, so here is the reasoning.
//
// "An import is undone gift by gift, on the record" is right for an ordinary
// import: those gifts landed on donors who already existed and have a history
// of their own, so pulling the import out wholesale would reach into records
// the import did not create. A gift file imported against an org where NONE of
// those donors existed is the opposite case: every gift AND every person came
// out of that one file, there is no prior history to disturb, and the thing a
// customer needs when they have just imported the wrong file, or the right
// file onto the wrong org, is one undo.
//
// The safety is the same machinery, unchanged: gifts by `import_id`, and
// people only where `created_import_id` is this run AND they have no other
// gift and no other interaction. A person who has acquired any history since
// stays, and so do their gifts.
// WIRE-1: "gifts" is the gift-history file matched to people already on file;
// its gifts carry the run id, so it reverses as a whole like the others.
// IMPORT-2: "history" is a notes and history file. It has no gifts; it undoes
// by its interactions, tasks and relationships, and by the flags and tags it
// set, all recorded on the run.
// LIVE-1: "transaction", the one-row-per-gift file through Import + History,
// undoes as a whole too. Its gifts carry the run id and the people it created
// carry it as `created_import_id`, which is everything the undo needs, and
// what it now starts (thank-you drafts, journeys, a readout) is undone with it.
// HARDEN-1: the old "Import Donors" mapper is retired; every door opens the one
// reader. Its past runs ("aggregate", a contacts or totals file; "wide", a
// year-columns file; "workbook" and "both", two sheets) carry the run id on
// their gifts and on the people they made, so each undoes whole from its
// receipt like the others, for the reader's 30 days.
const WHOLE_IMPORT_SHAPES = new Set(["deposit", "gift_file_with_donors", "gifts", "history", "transaction", "sheet", "aggregate", "wide", "workbook", "both"]);
// FIX-52: the spreadsheet import's screen promises Undo for 30 days, and now keeps it.
const SHAPE_REVERSE_HOURS = { deposit: DEPOSIT_REVERSE_HOURS, gift_file_with_donors: 24 * 7, gifts: 24 * 7, history: 24 * 7, transaction: 24 * 7, sheet: 24 * 30,
                              aggregate: 24 * 30, wide: 24 * 30, workbook: 24 * 30, both: 24 * 30 };
// Whether a receipt offers Undo, and until when. The route below is the judge.
function importUndoWindow(r) {
  if (!WHOLE_IMPORT_SHAPES.has(r.shape) || !r.committed_at) return { canUndo: false, undoUntil: null };
  const until = new Date(new Date(r.committed_at).getTime() + (SHAPE_REVERSE_HOURS[r.shape] || DEPOSIT_REVERSE_HOURS) * 3600e3);
  return { canUndo: !r.reversed_at && until > new Date(), undoUntil: until.toISOString() };
}

// LIVE-1 — every journey an import's gift started: its open step's thread is
// closed as handled outside, then the plan and its steps are deleted, so a
// re-import of the same file starts them afresh.
async function stopImportJourneys(orgId, importId, who) {
  const plans = await query(`SELECT id FROM cultivation_plans WHERE org_id=? AND started_import_id=?`, [orgId, importId]);
  if (!plans.length) return 0;
  const ids = plans.map(p => p.id);
  const steps = await query(`SELECT thread_id FROM cultivation_plan_steps WHERE org_id=? AND plan_id = ANY(?) AND thread_id IS NOT NULL`, [orgId, ids]);
  const threadIds = steps.map(s => s.thread_id);
  if (threadIds.length)
    await run(`UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason='handled_outside'
                WHERE org_id=? AND id = ANY(?) AND closed_at IS NULL`, [orgId, threadIds]);
  // FIX-37: and the timeline lines the journeys wrote ("Journey started",
  // each step it opened) go with them: an undo is as if the file never came,
  // and a person the file created is otherwise kept alive by those lines.
  await run(`DELETE FROM interactions WHERE org_id=? AND (id IN (SELECT start_interaction_id FROM cultivation_plans WHERE org_id=? AND id = ANY(?))
                                                       OR metadata->>'plan_id' = ANY(?))`, [orgId, orgId, ids, ids]);
  await run(`DELETE FROM cultivation_plan_steps WHERE org_id=? AND plan_id = ANY(?)`, [orgId, ids]);
  await run(`DELETE FROM cultivation_plans WHERE org_id=? AND id = ANY(?)`, [orgId, ids]);
  void who;
  return ids.length;
}

// FIX-52 · WHAT UNDO WILL REMOVE, before she confirms. Counted from the rows
// the run tagged, still there now; people deleted by hand since are counted
// separately, because Undo finishes removing them too.
app.get("/imports/:id/undo-preview", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId, id = req.params.id;
  const [imp] = await query("SELECT * FROM imports WHERE id=? AND org_id=?", [id, orgId]);
  if (!imp) return res.status(404).json({ error: "not_found", message: "That import is not on this organization." });
  const win = importUndoWindow(imp);
  const sj = imp.summary_json ? (typeof imp.summary_json === "string" ? JSON.parse(imp.summary_json) : imp.summary_json) : {};
  const n = async (sql, args) => Number(((await query(sql, args))[0] || {}).n) || 0;
  const counts = {
    gifts: await n("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=? AND import_id=?", [orgId, id]),
    pledges: await n("SELECT COUNT(*)::int AS n FROM pledges WHERE org_id=? AND import_id=?", [orgId, id]),
    people: await n("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=? AND created_import_id=?", [orgId, id]),
    alreadyDeleted: await n("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=? AND created_import_id=? AND deleted_at IS NOT NULL", [orgId, id]),
    events: await n("SELECT COUNT(*)::int AS n FROM events WHERE org_id=? AND import_id=?", [orgId, id]),
    attendance: await n("SELECT COUNT(*)::int AS n FROM event_attendees WHERE org_id=? AND import_id=?", [orgId, id]),
    households: await n("SELECT COUNT(*)::int AS n FROM households WHERE org_id=? AND import_id=?", [orgId, id]),
    notes: await n("SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=? AND import_id=?", [orgId, id]),
    customFields: (sj.customFieldsCreated || []).length,
    peopleRestored: (sj.personChanges || []).length,
    peopleMatched: Number(sj.peopleMatched) || 0,
  };
  const parts = [];
  const add = (k, one, many) => { if (counts[k]) parts.push(`${counts[k].toLocaleString("en-US")} ${counts[k] === 1 ? one : many}`); };
  add("gifts", "gift", "gifts"); add("pledges", "pledge", "pledges"); add("people", "person", "people"); add("events", "event", "events");
  add("attendance", "attendance", "attendances"); add("households", "household", "households"); add("notes", "timeline line", "timeline lines");
  add("customFields", "custom field", "custom fields");
  const sentence = (parts.length ? `Undo removes ${parts.join(", ")}` : "Undo removes what is left of this import")
    + (counts.alreadyDeleted ? ` (${counts.alreadyDeleted.toLocaleString("en-US")} of the people were already deleted)` : "")
    // FIX-55: the receipt counts everyone in the file who was already here; Undo
    // puts back only those the import changed, and says which of them it is
    + (counts.peopleRestored ? (() => {
        const r = counts.peopleRestored, m = Number(sj.peopleMatched) || 0, rs = r.toLocaleString("en-US");
        if (m > r) return `, and puts back as they were the ${rs} of the ${m.toLocaleString("en-US")} people already here that this import changed (it changed nothing on the other ${(m - r).toLocaleString("en-US")})`;
        return `, and puts ${rs} ${r === 1 ? "person who was already here" : "people who were already here"} back as they were`;
      })() : "")
    + ". It sends nothing and starts nothing.";
  res.json({ ...win, reversedAt: imp.reversed_at || null, counts, sentence });
}));

// The Undo itself (POST /imports/:id/reverse, its status, and the job that
// runs a big one) is server/imports/undo.js; IMPORT-7 moved it, and it reads
// these from here.
ctx.importUndoParts = { cancelRecentWork, stopImportJourneys, WHOLE_IMPORT_SHAPES, SHAPE_REVERSE_HOURS };

// Only the mapped column, and only a string. Anything else is not a URL and
// the row is left alone rather than queued to fail.
function photoImportUrl(d) {
  const v = d && d.photo;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
}

module.exports = { routers, mount };

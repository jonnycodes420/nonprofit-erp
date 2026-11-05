// server/imports/recentGifts.js — an import's recent gifts, recorded after the file lands (the importRecent job).
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
  IT, JQ, RECENT_WORK_ACTOR, importGiftExtras, kickRecentWork, orgToday, orgTz, query,
  recalcDonorSummaryBatch, recentJobs, recordGift, run, withAdvisoryLock, writeImportReadoutOnce,
} = ctx;

// Set-based recalc for MANY donors in ONE query — the import hang fix. The
// per-donor recalcDonorSummary loop was ~2 round trips per donor; at 1,500+
// donors that's thousands of sequential queries whose latency (small locally,
// large against a remote Supabase) made a big import appear to hang on
// "Importing…". This computes total/count/last-gift-date and the amount of the
// most-recent gift (tie-break by created_at) for the whole set at once, matching
// recalcDonorSummary's semantics exactly. No-op on an empty set.
// LIVE-1 — recent imported gifts go through recordGift several people at a
// time (RECENT_GIFT_LANES), each person's own gifts in date order on one lane,
// so "is this their first gift" and the person's totals stay exact while a
// file with hundreds of recent gifts does not wait on them one by one.
const RECENT_GIFT_LANES = 6;
// What a file's recent gifts could set off, read ONCE for the file: the
// triggers with a journey switched on, the sequences that are live, and the
// people with an open pledge or a membership a gift could renew. recordGift
// skips the checks that cannot fire, which takes a recent imported gift from
// about two dozen round trips to about half that.
async function importGiftContext(orgId) {
  const safe = p => p.catch(() => []);
  const [j, sq, pl, mb] = await Promise.all([
    safe(query(`SELECT DISTINCT trigger_key AS k FROM cultivation_templates WHERE org_id=? AND journey_enabled=true AND archived_at IS NULL AND trigger_key IS NOT NULL`, [orgId])),
    safe(query(`SELECT DISTINCT trigger AS k FROM sequences WHERE org_id=? AND status='active' AND tracks IS NOT NULL`, [orgId])),
    safe(query(`SELECT DISTINCT donor_id AS d FROM pledges WHERE org_id=? AND status='open'`, [orgId])),
    safe(query(`SELECT DISTINCT donor_id AS d FROM memberships WHERE org_id=? AND status IN ('active','grace')`, [orgId])),
  ]);
  return { armed: { journeys: new Set(j.map(r => r.k)), sequences: new Set(sq.map(r => r.k)) },
           pledgers: new Set(pl.map(r => r.d)), members: new Set(mb.map(r => r.d)) };
}
function recentGiftHints(ctx, donorId) {
  return { armed: ctx.armed,
           ...(ctx.pledgers.has(donorId) ? {} : { applyInstallment: false }),
           ...(ctx.members.has(donorId) ? {} : { membershipRenewal: false }) };
}

async function forEachByDonor(list, fn) {
  const byDonor = new Map();
  for (const g of list) { if (!byDonor.has(g.donorId)) byDonor.set(g.donorId, []); byDonor.get(g.donorId).push(g); }
  const queues = [...byDonor.values()].map(q => q.sort((a, b) => String(a.date).localeCompare(String(b.date))));
  let next = 0;
  const lane = async () => { while (next < queues.length) { const q = queues[next++]; for (const g of q) await fn(g); } };
  await Promise.all(Array.from({ length: Math.min(RECENT_GIFT_LANES, queues.length) }, lane));
}
// The job never writes beside an import request for the same org: a chunked
// file sends its next chunk while the job works on the last one, and the two
// writing the same people at once deadlocked (import2-history, the battery).
// So the job waits until no import request for the org is in flight, then
// takes the import's own advisory lock for one small batch at a time; a new
// chunk's transaction waits for at most that one batch.
const RECENT_BATCH = 50;
async function importsIdle(orgId) {
  for (;;) {
    const busy = await query(`SELECT 1 FROM import_in_flight WHERE org_id=? AND started_at > NOW() - INTERVAL '10 minutes' LIMIT 1`, [orgId]);
    if (!busy.length) return;
    await new Promise(r => setTimeout(r, 250));
  }
}
JQ.handle("importRecent", async ({ orgId, runId }) => {
  const job = { cancelled: false };
  recentJobs.set(runId, job);
  try { await runRecentWork(orgId, runId, job); }
  finally { recentJobs.delete(runId); }
});

async function runRecentWork(orgId, runId, job) {
  const [jr] = await query(`SELECT * FROM import_recent_jobs WHERE import_id=? AND org_id=?`, [runId, orgId]);
  if (!jr || jr.status === "cancelled") return;
  const thanks = IT.cleanAnswer(typeof jr.thanks === "string" ? JSON.parse(jr.thanks) : jr.thanks);
  const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  const gctx = await importGiftContext(orgId);
  let done = 0, thankYous = 0, lastSaved = Date.now();
  const errors = [], credits = [];
  const save = async () => {
    const d = done, t = thankYous; done = 0; thankYous = 0;
    await run(`UPDATE import_recent_jobs SET done = done + ?, thank_yous = thank_yous + ? WHERE import_id=?`, [d, t, runId]);
  };
  for (;;) {
    if (job.cancelled) break;
    // Undo may come from another process: the run's own row says so.
    const [st] = await query(`SELECT status FROM import_recent_jobs WHERE import_id=?`, [runId]);
    if (!st || st.status === "cancelled") { job.cancelled = true; break; }
    await importsIdle(orgId);
    const rows = await query(`SELECT id, gift FROM import_recent_work WHERE import_id=? AND org_id=? ORDER BY seq LIMIT ${RECENT_BATCH}`, [runId, orgId]);
    if (!rows.length) break;
    const list = rows.map(r => ({ ...(typeof r.gift === "string" ? JSON.parse(r.gift) : r.gift), _workId: r.id }));
    await withAdvisoryLock(`import:${orgId}`, async () => {
    // The totals of the people these land on are brought up to date FIRST,
    // so recordGift's "is this their first gift" reads the file's older gifts.
    await recalcDonorSummaryBatch(list.map(g => g.donorId), orgId).catch(e => console.error("[import-recent] recalc:", e.message));
    await forEachByDonor(list, async g => {
      if (job.cancelled) return;
      try {
        const isNew = IT.treatAsNew(thanks, g.amount);
        const w = await recordGift({
          orgId, donorId: g.donorId, amount: g.amount, date: g.date, type: g.type, campaign: g.campaign,
          campaignId: g.campaignId, eventId: g.eventId || null, notes: g.notes, fundId: g.fundId, paymentMethod: g.paymentMethod,
          externalId: g.externalId || null, conflict: g.externalId ? "external" : undefined,
          importId: runId, history: true, today, alreadyThanked: !isNew,
          post: false,             // BUILD-83 Part 6: an import never posts to the ledger
          actorId: jr.created_by, actorName: jr.created_by_name, source: "csv-import",
          door: "csv_import", afterChange: false,   // the step runs once for the whole run below
          ...recentGiftHints(gctx, g.donorId),
        });
        if (!w.duplicate) {
          // JOBS-1: the draft is the gift's event's handler; GET /imports/:id/progress counts the drafts that exist.
          if (g.customFields && Object.keys(g.customFields).length)
            await run("UPDATE gifts SET custom_fields=? WHERE id=? AND org_id=?", [JSON.stringify(g.customFields), w.gift.id, orgId]);
          if (g.credit) credits.push({ giftId: w.gift.id, g });
        }
      } catch (e) {
        console.error("[import-recent] gift:", e.message);
        errors.push({ rows: `recent gift ${g.date}`, error: e.message });
      }
      await run(`DELETE FROM import_recent_work WHERE id=?`, [g._workId]).catch(() => {});
      done++;
      if (Date.now() - lastSaved > 700) { lastSaved = Date.now(); await save(); }
    });
    });   // end withAdvisoryLock
    await save();
  }
  await save();
  if (credits.length) await importGiftExtras(orgId, credits, RECENT_WORK_ACTOR).catch(e => console.error("[import-recent] credit:", e.message));
  if (errors.length) await run(`UPDATE import_recent_jobs SET errors = errors || ?::jsonb WHERE import_id=?`, [JSON.stringify(errors.slice(0, 200)), runId]);
  if (job.cancelled) return;
  // The one after-change step, once for everybody the run touched so far:
  // its gifts' people and the people it created.
  const [tj] = await query(`SELECT touched FROM import_recent_jobs WHERE import_id=?`, [runId]);
  const touchedRaw = tj ? (typeof tj.touched === "string" ? JSON.parse(tj.touched) : tj.touched) : [];
  const fromGifts = (await query(`SELECT DISTINCT donor_id AS id FROM gifts WHERE org_id=? AND import_id=?`, [orgId, runId])).map(r => r.id);
  const touched = [...new Set([...(touchedRaw || []), ...fromGifts])];
  await importsIdle(orgId);
  await withAdvisoryLock(`import:${orgId}`, () => require("../../afterChange").afterChangeNow(orgId, touched, { door: "csv_import", history: true, runTag: runId }))
    .catch(e => console.error("[import-recent] after-change:", e.message));
  const left = await query(`SELECT 1 FROM import_recent_work WHERE import_id=? LIMIT 1`, [runId]);
  if (left.length || job.cancelled) return;   // another chunk arrived; the loop runs again
  // Done, then the readout, then finished: the screen reads "done" only once
  // finished_at is set, so it never shows a finished run without its readout.
  await run(`UPDATE import_recent_jobs SET status='done', finished_at=NULL WHERE import_id=? AND status='running'`, [runId]);
  await writeImportReadoutOnce(orgId, runId).catch(e => console.error("[readout] import job:", e.message));
  await run(`UPDATE import_recent_jobs SET finished_at=NOW() WHERE import_id=? AND status='done'`, [runId]);
}

// A run that was mid-way when SCALE-1 deployed has no queue row yet. Each one
// still running is enqueued once at boot (a second enqueue of a waiting key
// is a no-op, so every replica doing this is harmless).
async function resumeRecentWork() {
  const jobs = await query(`SELECT import_id, org_id FROM import_recent_jobs WHERE status='running'`).catch(() => []);
  for (const j of jobs) kickRecentWork(j.org_id, j.import_id);
}
require("../../bootGate").afterMigrations(() => { resumeRecentWork().catch(e => console.error("[import-recent] resume:", e.message)); }, 8000, { unref: true });   // FIX-51
return {  };
}

module.exports = { mount };

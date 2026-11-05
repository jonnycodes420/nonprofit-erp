// SPLIT-2: moved VERBATIM from server.js (its functions from lines 12418-12746). server.js requires the boot modules in
// order: every helpers-N first (a function existed from the start, as hoisting made it), then
// steps-1, steps-2 … in the order the statements ran. Each "SPLIT-2 server.js piece N" block is
// server.js's own text; tests read server.js through readSource("server.js"), which puts the
// pieces back in order. The lines outside the blocks are the wiring: this module's copy of each
// server.js name it reads (bind), and __boot.share() after a declaration or a write, which
// refreshes every module's copy.
// eslint-disable-next-line no-var, no-global-assign
var __dirname = require("path").join(__dirname, "..", "..");   // server.js's folder, as the moved code expects
const __boot = require("./share");
const __share = __boot.share;
let ASSET_ID_RE, NUMBERS, RETENTION_FLOOR, checkThemeImageDimensions, computeFirstTouchDelay, computeRecoveryRate, computeStewardshipDebt, computeThreadHealth, newId, normalizeUploadImage, orgTime, orgToday, orgTz, putThemeAsset, query, run, uploadImageError;
__boot.register(c => {
  if ("ASSET_ID_RE" in c) ASSET_ID_RE = c.ASSET_ID_RE;
  if ("NUMBERS" in c) NUMBERS = c.NUMBERS;
  if ("RETENTION_FLOOR" in c) RETENTION_FLOOR = c.RETENTION_FLOOR;
  if ("checkThemeImageDimensions" in c) checkThemeImageDimensions = c.checkThemeImageDimensions;
  if ("computeFirstTouchDelay" in c) computeFirstTouchDelay = c.computeFirstTouchDelay;
  if ("computeRecoveryRate" in c) computeRecoveryRate = c.computeRecoveryRate;
  if ("computeStewardshipDebt" in c) computeStewardshipDebt = c.computeStewardshipDebt;
  if ("computeThreadHealth" in c) computeThreadHealth = c.computeThreadHealth;
  if ("newId" in c) newId = c.newId;
  if ("normalizeUploadImage" in c) normalizeUploadImage = c.normalizeUploadImage;
  if ("orgTime" in c) orgTime = c.orgTime;
  if ("orgToday" in c) orgToday = c.orgToday;
  if ("orgTz" in c) orgTz = c.orgTz;
  if ("putThemeAsset" in c) putThemeAsset = c.putThemeAsset;
  if ("query" in c) query = c.query;
  if ("run" in c) run = c.run;
  if ("uploadImageError" in c) uploadImageError = c.uploadImageError;
});

// SPLIT-2 server.js piece 747

// Cohort year-over-year donor retention: what % of last year's donors gave
// again this year. This is a real, correct metric fundraisers already
// benchmark against — unlike stewardship_debt's invented composite score.
// Originally computed inline only inside GET /annual-fund; extracted here so
// /annual-fund and the Home dashboard's retention metric call the exact same
// code, not two copies that can drift. Deliberately preserves /annual-fund's
// exact original logic (fetch all gifts, bucket by calendar year via JS
// `Date.getFullYear()`) rather than rewriting as a SQL date-range query —
// a rewrite risks a subtle timezone-parsing mismatch that would make the two
// callers disagree. Pass `gifts` when the caller already has the org's full
// gift list (e.g. /annual-fund) to avoid fetching it twice. Pass `userId` to
// scope retention to just that user's assigned donors (same assigned_to
// pattern as GET /dashboard/today) — /annual-fund never passes this, so its
// behavior is unchanged.
async function computeRetentionRate(orgId, { year = null, gifts, userId, startMonth = null } = {}) {
  // NUMBERS-2 · ONE RETENTION, the Fundraising Effectiveness Project's: of the
  // people who gave last fiscal year (the org's own year, Settings), the share
  // who have given again this fiscal year. A gift is above zero (a refund is
  // not giving) from a person who is not deleted, the same rows as Reports'
  // retention-window, so every screen that shows the rate shows one number.
  // `year` is the start year of the fiscal year (for a January year, the
  // calendar year); it defaults to the year today is in, in the org's time.
  // `startMonth: 1` asks for calendar years instead (ARCH-1: /annual-fund).
  const tzOrg = await orgTz(orgId);   // ORG_TZ_SEAM_OK
  const today = orgToday(tzOrg);
  const sm = startMonth || orgTime.orgFiscalStartMonth(tzOrg);
  // NUMBERS-3: the year's days come from shared/numbers/fiscalYear.js.
  const yearDays = y => { const f = NUMBERS.fiscalYear.yearStarting(y, sm); return { from: f.start, to: f.end }; };
  if (year == null) year = NUMBERS.fiscalYear.startYearOf(today, sm);
  const prevYear = year - 1;
  const cur = yearDays(year), prev = yearDays(prevYear);
  const curTo = cur.to < today ? cur.to : today;
  const period = { from1: prev.from, to1: prev.to, from0: cur.from, to0: curTo,
    label: NUMBERS.fiscalYear.yearStarting(year, sm).chartLabel, prevLabel: NUMBERS.fiscalYear.yearStarting(prevYear, sm).chartLabel,
    next: yearDays(year + 1).from, fiscalStartMonth: sm };
  let assignedIds = null;
  if (userId) {
    const assignedRows = await query("SELECT id FROM donors WHERE org_id = ? AND assigned_to = ? AND deleted_at IS NULL", [orgId, userId]);
    assignedIds = new Set(assignedRows.map(r => r.id));
  }
  let thisYearDonorIds, prevYearDonorIds, firstGiftDate;
  if (!gifts) {
    const [pairs, [first]] = await Promise.all([
      query(`SELECT g.donor_id, (g.date >= ?) AS cur FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
              WHERE g.org_id = ? AND d.deleted_at IS NULL AND ${NUMBERS.money.GIFT("g")}
                AND ((g.date >= ? AND g.date <= ?) OR (g.date >= ? AND g.date <= ?))
              GROUP BY 1, 2`, [cur.from, orgId, prev.from, prev.to, cur.from, curTo]),
      query(`SELECT MIN(LEFT(date, 10) COLLATE "C") AS first FROM gifts
              WHERE org_id = ? AND date IS NOT NULL AND date <> ''${userId ? " AND donor_id = ANY(?)" : ""}`,
            userId ? [orgId, [...assignedIds]] : [orgId]),
    ]);
    const kept = assignedIds ? pairs.filter(r => assignedIds.has(r.donor_id)) : pairs;
    thisYearDonorIds = new Set(kept.filter(r => r.cur).map(r => r.donor_id));
    prevYearDonorIds = new Set(kept.filter(r => !r.cur).map(r => r.donor_id));
    firstGiftDate = first?.first || null;
  } else {
  let allGifts = gifts.filter(g => NUMBERS.money.isGift(g) && !g.deleted_at);
  if (assignedIds) allGifts = allGifts.filter(g => assignedIds.has(g.donor_id));
  const d10 = g => String(g.date || "").slice(0, 10);
  thisYearDonorIds = new Set(allGifts.filter(g => d10(g) >= cur.from && d10(g) <= curTo).map(g => g.donor_id));
  prevYearDonorIds = new Set(allGifts.filter(g => d10(g) >= prev.from && d10(g) <= prev.to).map(g => g.donor_id));
  firstGiftDate = gifts.reduce((min, g) => {
    const d = g.date ? String(g.date).slice(0, 10) : null;
    return d && (!min || d < min) ? d : min;
  }, null);
  }
  const retained = [...thisYearDonorIds].filter(id => prevYearDonorIds.has(id)).length;
  const retentionRate = prevYearDonorIds.size > 0 ? Math.round(retained / prevYearDonorIds.size * 100) : null;
  const historyDays = firstGiftDate
    ? (orgTime.daysBetween(firstGiftDate, orgToday(await orgTz(orgId))) ?? 0)
    : 0;
  const thinData = prevYearDonorIds.size < RETENTION_FLOOR.MIN_PRIOR_YEAR_DONORS
    || historyDays < RETENTION_FLOOR.MIN_HISTORY_DAYS;
  return {
    retentionRate, retained,
    thisYearDonorIds, prevYearDonorIds,
    thisYearCount: thisYearDonorIds.size, prevYearCount: prevYearDonorIds.size,
    year, prevYear, period,
    thinData, historyDays,
    floor: { minPriorYearDonors: RETENTION_FLOOR.MIN_PRIOR_YEAR_DONORS, minHistoryDays: RETENTION_FLOOR.MIN_HISTORY_DAYS },
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 748

// SCALE-1: the reads are independent, so they run in one parallel batch and
// the writes follow. `out` (optional) receives the full first-touch and
// retention results, so GET /metrics/stewardship-summary?scope=all, which
// snapshots and then shows those same two figures, computes each once.
// SCALE-2: each upsert below writes only when the value moved. An unchanged
// snapshot is no change at all, so the per-org summary (orgSummary.js, which
// watches this table) keeps serving the stored stewardship figures; a moved
// one is a change, and the next read recomputes with today's point in it.
async function snapshotMetricsForOrg(orgId, out = null) {
  const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK (FIX-14 Part 2b)
  const [debt, firstTouch, recovery, retentionAll] = await Promise.all([
    computeStewardshipDebt(orgId), computeFirstTouchDelay(orgId), computeRecoveryRate(orgId), computeRetentionRate(orgId),
  ]);
  if (out) { out.firstTouch = firstTouch; out.retention = retentionAll; }
  const { avgDays } = firstTouch;
  await run(
    `INSERT INTO metric_snapshots (id, org_id, metric_key, value, snapshot_date) VALUES (?,?,?,?,?)
     ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value
       WHERE metric_snapshots.value IS DISTINCT FROM EXCLUDED.value`,
    [newId("ms"), orgId, "stewardship_debt", debt, today]
  );
  if (avgDays != null) {
    await run(
      `INSERT INTO metric_snapshots (id, org_id, metric_key, value, snapshot_date) VALUES (?,?,?,?,?)
       ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value
       WHERE metric_snapshots.value IS DISTINCT FROM EXCLUDED.value`,
      [newId("ms"), orgId, "first_touch_delay", avgDays, today]
    );
  }
  const { rate: recoveryRate } = recovery;
  if (recoveryRate != null) {
    await run(
      `INSERT INTO metric_snapshots (id, org_id, metric_key, value, snapshot_date) VALUES (?,?,?,?,?)
       ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value
       WHERE metric_snapshots.value IS DISTINCT FROM EXCLUDED.value`,
      [newId("ms"), orgId, "recovery_rate", recoveryRate, today]
    );
  }
  // ── BUILD-85 — DOES THE FOLLOW-UP ENGINE RUN? ──────────────────────────
  // The Thread's central claim is that closing one conversation opens the
  // next. Nothing counted it, so the claim was untestable. These three do:
  // how much is open, how fast it clears, and — the one that matters — the
  // rate at which a close becomes the next commitment. A rising open count
  // with a falling continuation rate is a list being cleared, not a set of
  // relationships being kept, and only the trend can tell those apart.
  try {
    const th = await computeThreadHealth(orgId, { days: 30 });
    const put = async (key, val) => run(
      `INSERT INTO metric_snapshots (id, org_id, metric_key, value, snapshot_date) VALUES (?,?,?,?,?)
       ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value
       WHERE metric_snapshots.value IS DISTINCT FROM EXCLUDED.value`,
      [newId("ms"), orgId, key, val, today]);
    await put("threads_open", th.open);
    if (th.medianDaysToClose != null) await put("thread_days_to_close", th.medianDaysToClose);
    // THIN DATA IS NEVER SNAPSHOTTED (the BUILD-76 retention rule): a rate
    // over four closes is an artifact that would outlive the thinness that
    // made it and sit in the trend line forever.
    if (th.continuationRate != null) await put("thread_continuation_rate", th.continuationRate);
  } catch (e) { console.error("[metrics] thread health:", e.message); }

  const { retentionRate, thinData: retentionThin } = retentionAll;
  // BUILD-76 follow-up: a thin-data rate is never snapshotted — a 100%-on-16-
  // donors artifact in the trend line would outlive the thin data that made it.
  if (retentionRate != null && !retentionThin) {
    await run(
      `INSERT INTO metric_snapshots (id, org_id, metric_key, value, snapshot_date) VALUES (?,?,?,?,?)
       ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value
       WHERE metric_snapshots.value IS DISTINCT FROM EXCLUDED.value`,
      [newId("ms"), orgId, "retention_rate", retentionRate, today]
    );
  }
  // BUILD-76 Part 4 — log_capture_rate: of the drift items marked done in the
  // trailing 30 days, what share carried a line. This is the funnel metric
  // that tells BUILD-77 whether the logging-as-a-byproduct loop actually
  // works on the pilot — skips are RECORDED (metadata.skipped), so an honest
  // denominator exists. Only snapshotted once anyone has used the loop.
  const capture = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE metadata->>'skipped' = 'false')::int AS with_note
       FROM interactions
      WHERE org_id = ? AND metadata->>'via' = 'drift_done'
        AND created_at > NOW() - INTERVAL '30 days'`, [orgId]);
  if ((capture[0]?.total || 0) > 0) {
    const rate = Math.round((capture[0].with_note / capture[0].total) * 100);
    await run(
      `INSERT INTO metric_snapshots (id, org_id, metric_key, value, snapshot_date) VALUES (?,?,?,?,?)
       ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value
       WHERE metric_snapshots.value IS DISTINCT FROM EXCLUDED.value`,
      [newId("ms"), orgId, "log_capture_rate", rate, today]
    );
  }
  return debt;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 788
// PARITY-2 Part 4: an auction item's photo, on the BUILD-51 asset seam
// (kind 'auction', the campaign-photo rules). A stored /portal-assets/ path
// echoes through unchanged; a data URI is checked, normalised and stored.
async function storeAuctionPhoto(orgId, v) {
  if (typeof v !== "string" || !v) return { url: null };
  if (v.startsWith("/portal-assets/")) {
    const id = v.slice("/portal-assets/".length);
    if (!ASSET_ID_RE.test(id)) return { error: "bad_image", message: "That photo could not be read." };
    const [own] = await query(`SELECT id FROM portal_assets WHERE id=? AND org_id=?`, [id, orgId]);
    return own ? { url: v } : { error: "bad_image", message: "That photo could not be read." };
  }
  const uerr = uploadImageError(v);
  if (uerr) return { error: "bad_image", message: uerr };
  const m = String(v).match(/^data:([^;]+);base64,(.*)$/s);
  let buffer;
  try { buffer = Buffer.from(m[2], "base64"); } catch { return { error: "bad_image", message: "That photo could not be read." }; }
  const dims = checkThemeImageDimensions("campaign", m[1], buffer);
  if (!dims.ok) return { error: "bad_image_dimensions", message: dims.message };
  const norm = await normalizeUploadImage("campaign", m[1], buffer);
  if (norm.error) return { error: norm.error, message: norm.message || "That photo could not be read." };
  const asset = await putThemeAsset({ orgId, kind: "auction", isPublic: true, buffer: norm.buffer, contentType: norm.contentType,
    width: norm.width ?? dims.width, height: norm.height ?? dims.height });
  return { url: asset.path };
}
// SPLIT-2 end

__share({ computeRetentionRate, snapshotMetricsForOrg, storeAuctionPhoto });

#!/usr/bin/env node
// BUILD-75 Phase 0 — TWO PRODUCTION AUDITS. READ-ONLY. No writes, ever.
//
// 0.1 — RECEIPT NUMBERING. allocateReceiptNumber (server.js) derives the year
//   prefix from `new Date().getFullYear()` — the PROCESS clock, which is UTC
//   in production. From 19:00 EST on Dec 31, every receipt allocated is
//   numbered for the following year while the org is still in the old one.
//   This audit measures whether that has ALREADY happened, on two axes:
//     A. prefix year vs the ALLOCATION instant's civil year in the org's
//        timezone  →  the clock defect itself, directly.
//     B. prefix year vs the GIFT's civil-date year (type=gift) or the
//        statement's tax_year (type=year_end)  →  what Phase 0.1(1) asks.
//        NOTE: B can legitimately differ — a receipt correctly issued in
//        January for a December gift carries a January-year prefix. B is
//        reported for completeness; A is the defect.
//   "Issued" — every receipt row renders its PDF at allocation (pdf_data is
//   written in the same INSERT), so allocated == rendered by construction.
//   The signal that a document is in a donor's hands is sent_at (emailed).
//   Staff PDF downloads are not tracked; that limitation is reported, not
//   papered over.
//
// 0.2 — DIGEST DEDUP. processDailyTaskReminders keys digest_sends on the
//   UTC civil day (localDateKey on a UTC process clock) and gates sends on
//   UTC hours [6,12). This audit reports, per org timezone as OBSERVED:
//     1. duplicate pairs: two daily_tasks rows for one recipient whose SEND
//        INSTANTS fall on the same org-local civil day (should be impossible
//        if the key matched the local day),
//     2. gap days between a recipient's first and last send with no row —
//        with the honest caveat that tasks have no completed_at, so "a digest
//        should have existed" is approximated by tasks created on/before and
//        due on/before that day (an already-done task at the time is
//        indistinguishable from a still-open one),
//     3. the actual send-hour distribution per org, in the org's timezone.
//
// Usage:
//   railway run -- node scripts/build75-phase0-audit.js --i-know-this-is-prod
//
// Identity is verified BEFORE the connection is used for anything: /health
// must report this product, and the database must report the same name
// /health does. Loopback is not identity, and neither is a connection string.

const { Client } = require("pg");
const { assertServerIdentity } = require("./lib/prodGuard");

const CONFIRM = "--i-know-this-is-prod";
const HEALTH = process.env.HEALTH_URL || "https://nonprofit-erp-production.up.railway.app";
const url = process.env.DATABASE_URL || "";

if (!url) { console.error("Set DATABASE_URL. This script only ever READS."); process.exit(1); }
const isLoopback = /localhost|127\.0\.0\.1/.test(url);
if (!isLoopback && !process.argv.includes(CONFIRM)) {
  console.error(`\nREFUSED: DATABASE_URL is remote. Add ${CONFIRM}.\n(Read-only, but a remote target is always an explicit act.)\n`);
  process.exit(1);
}

// ── Layer 0: identity, before the connection is used for anything ──────────
let expectedDb = null;
if (!isLoopback) {
  const h = assertServerIdentity(HEALTH);
  expectedDb = h.database;
  console.log(`[identity] ${HEALTH} → product=${h.product} database=${h.database} sha=${(h.buildSha || "").slice(0, 7)}`);
}

// Civil date/hour of an instant in a zone — same Intl discipline as orgTime.js.
const _fmt = new Map();
function civil(tz, instant) {
  let f = _fmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
    _fmt.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(instant).map(x => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, year: +p.year, hour: +p.hour % 24 };
}
const DEFAULT_TZ = "America/New_York"; // orgTime.js DEFAULT_TZ — the seam's fallback
function orgZone(tzRaw) {
  if (!tzRaw) return DEFAULT_TZ;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tzRaw }); return tzRaw; } catch { return DEFAULT_TZ; }
}

(async () => {
  const client = new Client({ connectionString: url, ssl: isLoopback ? false : { rejectUnauthorized: false } });
  await client.connect();

  const dbName = (await client.query("SELECT current_database()")).rows[0].current_database;
  if (expectedDb && dbName !== expectedDb) {
    console.error(`\nREFUSED: connected to database "${dbName}" but /health reports "${expectedDb}".\n`);
    await client.end(); process.exit(1);
  }
  console.log(`[identity] connected database = ${dbName}\n`);

  // ══ 0.1 — RECEIPT NUMBERING ═══════════════════════════════════════════════
  console.log("═══ 0.1 RECEIPT NUMBERING AUDIT ═══");
  const receipts = (await client.query(`
    SELECT r.id, r.org_id, o.name AS org_name, o.timezone AS org_tz,
           r.type, r.tax_year, r.receipt_number, r.created_at, r.sent_at, r.sent_to,
           r.voided_at, r.gift_id, g.date AS gift_date, g.is_sample
      FROM receipts r
      JOIN orgs o ON o.id = r.org_id
      LEFT JOIN gifts g ON g.id = r.gift_id
     ORDER BY r.created_at ASC`)).rows;
  console.log(`receipts total: ${receipts.length}`);

  const mismA = [], mismB = [];
  for (const r of receipts) {
    const tz = orgZone(r.org_tz);
    const prefix = String(r.receipt_number || "").slice(0, 4);
    const alloc = civil(tz, new Date(r.created_at));
    if (+prefix !== alloc.year) mismA.push({ ...r, tz, prefix, allocLocal: alloc.ymd });
    if (r.type === "gift") {
      const giftYear = r.gift_date ? String(r.gift_date).slice(0, 4) : null;
      if (giftYear && prefix !== giftYear) mismB.push({ ...r, tz, prefix, giftYear });
    } else if (r.type === "year_end") {
      if (r.tax_year != null && +prefix !== +r.tax_year) mismB.push({ ...r, tz, prefix, giftYear: String(r.tax_year) });
    }
  }

  console.log(`\nAxis A — prefix year ≠ allocation civil year in org tz (THE DEFECT): ${mismA.length}`);
  for (const m of mismA) {
    console.log(`  ${m.receipt_number}  org=${m.org_name}  tz=${m.tz}  allocated_local=${m.allocLocal}  created_at_utc=${new Date(m.created_at).toISOString()}  type=${m.type}  emailed=${m.sent_at ? "YES → " + m.sent_to : "no"}  voided=${m.voided_at ? "yes" : "no"}  sample_gift=${m.is_sample ? "yes" : "no"}`);
  }

  console.log(`\nAxis B — prefix year ≠ gift civil year / tax_year (informational): ${mismB.length}`);
  for (const m of mismB) {
    console.log(`  ${m.receipt_number}  org=${m.org_name}  type=${m.type}  gift/tax year=${m.giftYear}  allocated_utc=${new Date(m.created_at).toISOString()}  emailed=${m.sent_at ? "YES → " + m.sent_to : "no"}  voided=${m.voided_at ? "yes" : "no"}  sample_gift=${m.is_sample ? "yes" : "no"}`);
  }

  const emailedA = mismA.filter(m => m.sent_at && !m.voided_at);
  console.log(`\nIssued (emailed, active) with a wrong-axis-A prefix: ${emailedA.length}   ← THE GATE`);

  // How close has production actually come to the Dec-31 window? Receipts
  // allocated when the org-local date and the UTC date DISAGREED at all
  // (any day of year) — the general form of the rollover exposure.
  const dateSplit = receipts.filter(r => {
    const tz = orgZone(r.org_tz);
    const inst = new Date(r.created_at);
    return civil(tz, inst).ymd !== inst.toISOString().slice(0, 10);
  });
  console.log(`allocated during a local/UTC date-disagreement window (evening local): ${dateSplit.length}`);
  for (const r of dateSplit.slice(0, 20)) {
    const tz = orgZone(r.org_tz);
    console.log(`  ${r.receipt_number}  org=${r.org_name}  local=${civil(tz, new Date(r.created_at)).ymd}  utc=${new Date(r.created_at).toISOString()}  emailed=${r.sent_at ? "yes" : "no"}`);
  }

  // Org timezone inventory — how many orgs even carry a non-default tz.
  const tzRows = (await client.query("SELECT COALESCE(NULLIF(timezone,''),'(unset)') tz, COUNT(*) n FROM orgs GROUP BY 1 ORDER BY 2 DESC")).rows;
  console.log("\norg timezone inventory:");
  for (const t of tzRows) console.log(`  ${t.tz}: ${t.n}`);

  // ══ 0.2 — DIGEST DEDUP ════════════════════════════════════════════════════
  console.log("\n═══ 0.2 DIGEST DEDUP AUDIT ═══");
  const sends = (await client.query(`
    SELECT ds.*, o.name AS org_name, o.timezone AS org_tz
      FROM digest_sends ds JOIN orgs o ON o.id = ds.org_id
     ORDER BY ds.created_at ASC`)).rows;
  const byType = {};
  for (const s of sends) byType[s.digest_type] = (byType[s.digest_type] || 0) + 1;
  console.log(`digest_sends total: ${sends.length}  by type: ${JSON.stringify(byType)}`);

  const daily = sends.filter(s => s.digest_type === "daily_tasks");

  // (1) duplicate pairs: same recipient, send instants on the same org-local day
  const seen = new Map(); const dupes = [];
  for (const s of daily) {
    const tz = orgZone(s.org_tz);
    const localDay = civil(tz, new Date(s.created_at)).ymd;
    const k = `${s.org_id}|${s.recipient_user_id}|${localDay}`;
    if (seen.has(k)) dupes.push({ first: seen.get(k), second: s, localDay, tz });
    else seen.set(k, s);
  }
  console.log(`\n(1) duplicate daily_tasks sends collapsing to one org-local day: ${dupes.length}`);
  for (const d of dupes) {
    console.log(`  org=${d.first.org_name} user=${d.first.recipient_user_id} local_day=${d.localDay} (${d.tz})`);
    console.log(`     keys ${d.first.period_key} @ ${new Date(d.first.created_at).toISOString()}  AND  ${d.second.period_key} @ ${new Date(d.second.created_at).toISOString()}`);
  }

  // (2) gap days per recipient between first and last send, with the
  //     approximate "should a digest have existed" check (see header caveat).
  console.log("\n(2) gap days (approximate — tasks lack completed_at):");
  const byRecip = new Map();
  for (const s of daily) {
    const k = `${s.org_id}|${s.recipient_user_id}`;
    if (!byRecip.has(k)) byRecip.set(k, []);
    byRecip.get(k).push(s);
  }
  let gapTotal = 0;
  for (const [k, rows] of byRecip) {
    const tz = orgZone(rows[0].org_tz);
    const days = rows.map(r => civil(tz, new Date(r.created_at)).ymd).sort();
    const have = new Set(days);
    const gaps = [];
    for (let d = new Date(days[0] + "T12:00:00Z"); d < new Date(days[days.length - 1] + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
      const ymd = d.toISOString().slice(0, 10);
      if (!have.has(ymd)) gaps.push(ymd);
    }
    if (!gaps.length) continue;
    const [orgId, userId] = k.split("|");
    for (const g of gaps) {
      const due = (await client.query(
        `SELECT COUNT(*) n FROM tasks WHERE org_id=$1 AND due IS NOT NULL AND due <> ''
           AND LEFT(due,10) <= $2 AND created_at <= ($2::date + interval '1 day')`,
        [orgId, g])).rows[0].n;
      gapTotal++;
      console.log(`  org=${rows[0].org_name} user=${userId} missing local day ${g} (${tz}) — tasks plausibly due by then: ${due}`);
    }
  }
  if (!gapTotal) console.log("  none");

  // (3) observed send hours, org-local
  console.log("\n(3) observed send instants per org, in the ORG's timezone:");
  const hourBuckets = new Map();
  for (const s of daily) {
    const tz = orgZone(s.org_tz);
    const c = civil(tz, new Date(s.created_at));
    const k = `${s.org_name} (${tz})`;
    if (!hourBuckets.has(k)) hourBuckets.set(k, []);
    hourBuckets.get(k).push(`${c.ymd} ${String(c.hour).padStart(2, "0")}h [key ${s.period_key}]`);
  }
  for (const [k, v] of hourBuckets) {
    console.log(`  ${k}:`);
    for (const line of v) console.log(`    ${line}`);
  }
  if (!daily.length) console.log("  (no daily_tasks sends recorded)");

  // Weekly/monthly period keys, for completeness — those go through per-org
  // weekBounds/monthBounds already; report keys + instants so the transition
  // decision in Phase A.2/A.3 is made against observed reality.
  const wkmo = sends.filter(s => s.digest_type !== "daily_tasks");
  if (wkmo.length) {
    console.log("\nweekly/monthly sends (observed, org-local):");
    for (const s of wkmo) {
      const tz = orgZone(s.org_tz);
      const c = civil(tz, new Date(s.created_at));
      console.log(`  ${s.digest_type}  org=${s.org_name}  key=${s.period_key}  sent_local=${c.ymd} ${String(c.hour).padStart(2, "0")}h (${tz})`);
    }
  }

  await client.end();
  console.log("\n[done] read-only audit complete — nothing was written.");
})().catch(e => { console.error("AUDIT FAILED:", e); process.exit(1); });

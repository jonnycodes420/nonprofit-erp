// nightlyCheck.js · HARDEN-1 item 5. A NIGHTLY CHECK ON PROD THAT ONLY READS.
//
// At 3:30 AM in New York (America/New_York, so it follows daylight saving)
// the worker reads five things that must never be true, and mails Jonathan
// ONLY if one of them is. Nothing here fixes, changes or deletes anything.
//
//   a. A deleted person shows on a list or in a count: the Donors list (the
//      same route the page reads), a group's people (groups.js, the function
//      the group page reads), an event's guest list (the event route).
//   b. An import's receipt does not foot: the gifts and cents its imports row
//      says it made, against the gifts that carry its import_id (plus any of
//      them since deleted, which sit in deleted_records), in cents.
//   c. An automatic donor message went to a person whose Automatic emails
//      switch was off (email_log.gate / donor_ids, written by sendGate.js),
//      or went out of an org whose Donor mail is off, or reached a donor
//      without passing the gate at all.
//   d. An org's Donors list total differs from its Home total: the same two
//      routes the two screens read (GET /donors, GET /org/setup-status).
//   e. A real organization (Kind = Customer, orgKind.js) holds rows from an
//      import whose file (its cells' fingerprint, recorded on the preview's
//      and the commit's audit rows by routes/sheetImport.js) was first
//      previewed in a different org.
//
// READ-ONLY, TWICE OVER. Each check runs inside db.withReadOnlyTransaction:
// BEGIN; SET TRANSACTION READ ONLY; ... ROLLBACK, and every query() the routes
// it calls in process make goes to that one client (the ambient transaction),
// so a write anywhere in a check fails instead of landing. When
// NIGHTLY_CHECK_DATABASE_URL is set, that client also logs in as a role that
// can only SELECT. The only writes the job makes are its own bookkeeping,
// outside the checks and never to org data: the night's claim (one
// ops_alert_marks row, so several instances run it once), the tick_log row
// every job gets (recordTick), and opsAlert's own hourly mark.
//
// THE READ-ONLY ROLE JONATHAN CREATES ON PROD (once; then set
// NIGHTLY_CHECK_DATABASE_URL on the worker to its connection string):
//
//   CREATE ROLE steward_nightly_check LOGIN PASSWORD '<a new password>';
//   ALTER ROLE steward_nightly_check SET default_transaction_read_only = on;
//   GRANT CONNECT ON DATABASE postgres TO steward_nightly_check;
//   GRANT USAGE ON SCHEMA public TO steward_nightly_check;
//   GRANT SELECT ON ALL TABLES IN SCHEMA public TO steward_nightly_check;
//   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO steward_nightly_check;
//
// (`postgres` is the database name in the Supabase connection string; use
// the one in DATABASE_URL. No INSERT, UPDATE, DELETE, TRUNCATE or sequence
// grant, and it owns nothing.)
//
// WHO HEARS. Only opsAlert (server.js), which sends to FOUNDER_EMAIL and to no
// one else, and only when a check is red. A clean night sends nothing.
"use strict";

const db = require("./db");
const mailPolicy = require("./mailPolicy");
const orgTime = require("./orgTime");
const inProcess = require("./inProcess");

const NY = { timezone: "America/New_York" };
// The window opens at 3:30 and stays open until 5:00, so a tick that was late
// (a deploy, a slow queue) still runs that night; the claim keeps it to one.
const WINDOW = { from: 3 * 60 + 30, to: 5 * 60 };
const NO_STORE = Symbol.for("steward.orgSummary.noStore");
const FRESH = Symbol.for("steward.orgSummary.fresh");

let deps = null;   // { opsAlert, signInternalToken }
function configure(d) { deps = d; }

const plural = (n, one, many) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const cents = c => "$" + (Number(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The orgs a check looks at: every org, or the ones a suite names.
async function orgsToCheck(orgIds) {
  return db.query(
    `SELECT o.id, o.name, o.org_kind,
            (SELECT u.id FROM users u WHERE u.org_id = o.id AND u.deactivated_at IS NULL
              ORDER BY (u.role = 'admin') DESC, u.created_at LIMIT 1) AS user_id
       FROM orgs o ${orgIds ? "WHERE o.id = ANY(?)" : ""} ORDER BY o.id`, orgIds ? [orgIds] : []);
}

// A screen's route, run in this process as a person in that org, inside the
// read-only transaction. The stored-answer cache is told neither to answer
// nor to store, so the route computes and writes nothing.
async function screen(userId, path) {
  const token = await deps.signInternalToken(userId);
  if (!token) throw new Error(`no token for ${userId}`);
  const r = await inProcess.get(path, { headers: { authorization: `Bearer ${token}` }, marks: [FRESH, NO_STORE] });
  if (r.status !== 200) throw new Error(`${path} answered ${r.status}: ${String(r.body).slice(0, 200)}`);
  return JSON.parse(r.body);
}

// Deleted means either: the row says so (deleted_at), or the delete is on
// record and was never undone (a trash row in deleted_records, unrestored),
// which is how FIX-54's "they came back" looked: deleted_at cleared by a door
// that was not her Undo.
async function deletedAmong(orgId, ids) {
  if (!ids || !ids.length) return [];
  return (await db.query(
    `SELECT id FROM donors WHERE org_id = ? AND id = ANY(?) AND deleted_at IS NOT NULL
     UNION
     SELECT r.record_id FROM deleted_records r WHERE r.org_id = ? AND r.table_name = 'donors' AND r.restored_at IS NULL AND r.record_id = ANY(?)`,
    [orgId, ids, orgId, ids])).map(r => r.id);
}

// ── a · a deleted person on a list or in a count ─────────────────────────
async function checkDeletedShown({ orgIds } = {}) {
  const GR = require("./groups");
  const found = [];
  for (const org of await orgsToCheck(orgIds)) {
    if (!org.user_id) continue;
    const where = [];
    for (const role of ["donor", null]) {
      const list = await screen(org.user_id, "/donors/ids" + (role ? `?role=${role}` : ""));
      const bad = await deletedAmong(org.id, list.ids || []);
      if (bad.length) where.push(`${plural(bad.length, "deleted person", "deleted people")} on the Donors list${role ? "" : " (everyone)"}`);
    }
    const groups = await GR.listGroups(org.id);
    const counts = await GR.memberCounts(org.id, groups);
    for (let i = 0; i < groups.length; i++) {
      const ids = await GR.memberIds(org.id, groups[i]);
      const bad = await deletedAmong(org.id, ids);
      if (bad.length) where.push(`${plural(bad.length, "deleted person", "deleted people")} in the group "${groups[i].name}"`);
      if (Number(counts[i]) !== ids.length) where.push(`the group "${groups[i].name}" counts ${counts[i]} but lists ${ids.length}`);
    }
    const events = await db.query(`SELECT id, name FROM events WHERE org_id = ? ORDER BY date DESC NULLS LAST, id LIMIT 300`, [org.id]);
    for (const ev of events) {
      const page = await screen(org.user_id, `/events/${encodeURIComponent(ev.id)}`);
      const bad = await deletedAmong(org.id, (page.attendees || []).map(a => a.donor_id).filter(Boolean));
      if (bad.length) where.push(`${plural(bad.length, "deleted person", "deleted people")} on the guest list of "${ev.name}"`);
    }
    if (where.length) found.push(`${org.name} (${org.id}): ${where.join("; ")}.`);
  }
  return { key: "a", title: "Deleted people stay off every list and count", ok: !found.length, lines: found };
}

// ── b · an import receipt that does not foot ─────────────────────────────
async function checkImportReceipts({ orgIds } = {}) {
  const rows = await db.query(
    `SELECT i.id, i.org_id, o.name AS org_name, i.name, COALESCE(i.gifts_created, 0)::int AS said_gifts,
            ROUND(COALESCE(i.dollars_created, 0) * 100)::bigint AS said_cents,
            COALESCE(g.n, 0)::int + COALESCE(t.n, 0)::int AS gifts,
            COALESCE(g.c, 0)::bigint + COALESCE(t.c, 0)::bigint AS gift_cents
       FROM imports i JOIN orgs o ON o.id = i.org_id
       LEFT JOIN LATERAL (SELECT COUNT(*) AS n, SUM(ROUND(x.amount * 100)) AS c FROM gifts x
                           WHERE x.org_id = i.org_id AND x.import_id = i.id) g ON true
       LEFT JOIN LATERAL (SELECT COUNT(*) AS n, SUM(ROUND((r.row_data->>'amount')::numeric * 100)) AS c FROM deleted_records r
                           WHERE r.org_id = i.org_id AND r.table_name = 'gifts' AND r.restored_at IS NULL
                             AND r.row_data->>'import_id' = i.id) t ON true
      WHERE i.reversed_at IS NULL ${orgIds ? "AND i.org_id = ANY(?)" : ""}
        AND (COALESCE(i.gifts_created, 0) > 0 OR COALESCE(g.n, 0) > 0)
        AND (COALESCE(i.gifts_created, 0) <> COALESCE(g.n, 0) + COALESCE(t.n, 0)
             OR ROUND(COALESCE(i.dollars_created, 0) * 100) <> COALESCE(g.c, 0) + COALESCE(t.c, 0))
      ORDER BY i.org_id, i.id LIMIT 50`, orgIds ? [orgIds] : []);
  const lines = rows.map(r =>
    `${r.org_name} (${r.org_id}): the import "${r.name}" (${r.id}) says ${plural(r.said_gifts, "gift", "gifts")}, ${cents(r.said_cents)}; `
    + `the gifts that carry its id are ${plural(r.gifts, "gift", "gifts")}, ${cents(r.gift_cents)}.`);
  return { key: "b", title: "Every import receipt foots against its gifts, to the cent", ok: !lines.length, lines };
}

// ── c · automatic donor mail with a switch off ───────────────────────────
// email_log keeps 30 days; the check reads the last 25 hours, so each send is
// looked at on one night (the hour over covers a late run).
function donorKindsSql() {
  // A kind not in KIND_CATEGORY is donor mail (mailPolicy.categoryOf).
  return Object.keys(mailPolicy.KIND_CATEGORY || {}).filter(k => mailPolicy.categoryOf(k) !== mailPolicy.CATEGORY.DONOR);
}
async function checkAutoMailSwitches({ orgIds } = {}) {
  const notDonor = donorKindsSql();
  const exempt = [...require("./sendGate").EXEMPT_KINDS];
  const base = `e.status = 'sent' AND e.org_id IS NOT NULL AND e.created_at >= NOW() - INTERVAL '25 hours'
                AND COALESCE(e.kind, '') <> ALL(?::text[]) ${orgIds ? "AND e.org_id = ANY(?)" : ""}`;
  const args = orgIds ? [notDonor, orgIds] : [notDonor];
  const lines = [];
  // 1. to a person whose switch was off when it went
  const toOff = await db.query(
    `SELECT e.org_id, o.name AS org_name, e.kind, COUNT(DISTINCT d.id)::int AS people, COUNT(DISTINCT e.id)::int AS n
       FROM email_log e JOIN orgs o ON o.id = e.org_id
       JOIN donors d ON d.org_id = e.org_id AND d.id = ANY(e.donor_ids)
      WHERE ${base} AND COALESCE(e.gate, '') NOT IN ('exempt', 'staff_confirm')
        AND d.auto_email IS NOT TRUE AND (d.auto_email_at IS NULL OR d.auto_email_at < e.created_at)
      GROUP BY e.org_id, o.name, e.kind ORDER BY e.org_id`, args);
  for (const r of toOff) lines.push(`${r.org_name} (${r.org_id}): ${plural(r.n, "automatic message", "automatic messages")} (${r.kind || "no kind"}) went to ${plural(r.people, "person", "people")} whose Automatic emails switch is off.`);
  // 2. out of an org whose Donor mail is off
  const orgOff = await db.query(
    `SELECT e.org_id, o.name AS org_name, COUNT(*)::int AS n
       FROM email_log e JOIN orgs o ON o.id = e.org_id
      WHERE ${base} AND o.emails_enabled = FALSE AND COALESCE(e.kind, '') <> ALL(?::text[])
      GROUP BY e.org_id, o.name ORDER BY e.org_id`, [...args, exempt]);
  for (const r of orgOff) lines.push(`${r.org_name} (${r.org_id}): ${plural(r.n, "donor message", "donor messages")} went out while the org's Donor mail is off.`);
  // 3. a donor message that never passed the gate (no arm recorded), once the
  // gate records its arm at all
  const noGate = await db.query(
    `SELECT e.org_id, o.name AS org_name, COUNT(*)::int AS n
       FROM email_log e JOIN orgs o ON o.id = e.org_id
      WHERE ${base} AND e.gate IS NULL
        AND e.created_at > (SELECT MIN(created_at) FROM email_log WHERE gate IS NOT NULL)
      GROUP BY e.org_id, o.name ORDER BY e.org_id`, args);
  for (const r of noGate) lines.push(`${r.org_name} (${r.org_id}): ${plural(r.n, "donor message", "donor messages")} went out without passing the automatic-email gate.`);
  return { key: "c", title: "No automatic donor mail past a switch that is off", ok: !lines.length, lines };
}

// ── d · the Donors list total against Home's ─────────────────────────────
// The Donors list for everyone (no role chosen) against Home's "N people on
// file" (the setup line). Home leaves sample people out on purpose, so an org
// holding sample data is not comparable and is named as skipped, not red.
async function checkListVsHome({ orgIds } = {}) {
  const lines = [], skipped = [];
  for (const org of await orgsToCheck(orgIds)) {
    if (!org.user_id) continue;
    const [{ n: samples }] = await db.query(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id = ? AND deleted_at IS NULL AND is_sample IS TRUE`, [org.id]);
    if (samples) { skipped.push(`${org.id}: holds sample people`); continue; }
    const list = await screen(org.user_id, "/donors?limit=1&offset=0");
    const setup = await screen(org.user_id, "/org/setup-status");
    const item = (setup.items || []).find(i => i.key === "donors");
    if (!item) continue;
    if (Number(list.total) !== Number(item.count)) {
      lines.push(`${org.name} (${org.id}): the Donors list says ${Number(list.total).toLocaleString("en-US")}, Home says ${Number(item.count).toLocaleString("en-US")}.`);
    }
  }
  return { key: "d", title: "The Donors list and Home count the same people", ok: !lines.length, lines, skipped };
}

// ── e · a file previewed in one org, imported into a real one ────────────
function parseAfter(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}
async function checkCrossOrgImport({ orgIds } = {}) {
  const commits = await db.query(
    `SELECT a.org_id, o.name AS org_name, a.after_fields, a.created_at
       FROM fin_audit_log a JOIN orgs o ON o.id = a.org_id
      WHERE a.request_path = '/sheet-import/commit' AND o.org_kind = 'customer'
        AND a.after_fields IS NOT NULL ${orgIds ? "AND a.org_id = ANY(?)" : ""}`, orgIds ? [orgIds] : []);
  const lines = [];
  const firstPreview = new Map();
  for (const c of commits) {
    const after = parseAfter(c.after_fields);
    if (!after || !after.file || !after.importId) continue;
    if (!firstPreview.has(after.file)) {
      const [p] = await db.query(
        `SELECT a.org_id, o.name AS org_name, a.created_at FROM fin_audit_log a LEFT JOIN orgs o ON o.id = a.org_id
          WHERE a.request_path = '/sheet-import/understand' AND a.after_fields->>'file' = ?
          ORDER BY a.created_at, a.id LIMIT 1`, [after.file]);
      firstPreview.set(after.file, p || null);
    }
    // The org the page said it previewed in (sheet-import commit refuses a
    // different one since HARDEN-1 item 1), else the first preview of the file.
    const said = after.previewOrgId && after.previewOrgId !== c.org_id ? { org_id: after.previewOrgId, org_name: null } : null;
    const p = said || firstPreview.get(after.file);
    if (!p || p.org_id === c.org_id) continue;
    const [made] = await db.query(
      `SELECT (SELECT COUNT(*)::int FROM gifts WHERE org_id = ? AND import_id = ?) AS gifts,
              (SELECT COUNT(*)::int FROM donors WHERE org_id = ? AND created_import_id = ?) AS people`,
      [c.org_id, after.importId, c.org_id, after.importId]);
    if (!made.gifts && !made.people) continue;
    lines.push(`${c.org_name} (${c.org_id}): the import ${after.importId} made ${plural(made.people, "person", "people")} and ${plural(made.gifts, "gift", "gifts")} from a file first previewed in ${p.org_name || "another org"} (${p.org_id}).`);
  }
  return { key: "e", title: "No customer holds rows from a file previewed in another org", ok: !lines.length, lines };
}

const CHECKS = [checkDeletedShown, checkImportReceipts, checkAutoMailSwitches, checkListVsHome, checkCrossOrgImport];

// Every check, each in its own read-only transaction. A check that cannot run
// is red with its error: a check that quietly did not run is the failure this
// job exists to catch.
async function runChecks({ orgIds = null } = {}) {
  const results = [];
  for (const fn of CHECKS) {
    // `refusedWrites`: writes a route tried on the way (a cache it stores) and
    // the read-only transaction refused. They are counted, never made.
    try { results.push(await db.withReadOnlyTransaction(async (client, st) => ({ ...(await fn({ orgIds })), refusedWrites: st.refused }))); }
    catch (e) {
      results.push({ key: fn.name, title: fn.name, ok: false, error: true,
        lines: [`The check could not run: ${String(e && e.message || e).slice(0, 300)}`] });
    }
  }
  return results;
}

function alertText(results, night) {
  const red = results.filter(r => !r.ok);
  const subject = `Nightly check, ${night}: ${plural(red.length, "check", "checks")} found something wrong`;
  const body = [`The nightly check read prod at 3:30 AM New York time and changed nothing. ${red.length} of ${results.length} checks are red.`, ""];
  for (const r of red) { body.push(`${r.key}. ${r.title}:`); for (const l of r.lines.slice(0, 20)) body.push(`  ${l}`); if (r.lines.length > 20) body.push(`  and ${r.lines.length - 20} more.`); body.push(""); }
  return { subject, body: body.join("\n") };
}

// One run: the checks, then at most one alert, to Jonathan, only when red.
async function runNightlyCheck({ night = null, orgIds = null, now = new Date() } = {}) {
  const n = night || orgTime.orgClock(NY, now).date;
  const results = await runChecks({ orgIds });
  const red = results.filter(r => !r.ok);
  let alert = null;
  if (red.length) {
    const t = alertText(results, n);
    alert = await deps.opsAlert(`nightly_check:${n}`, t.subject, t.body);
  }
  return { night: n, results, red: red.map(r => r.key), alert };
}

// The tick (routes/jobs.js, every 5 minutes on the worker): inside the window,
// claim the night once across every instance, then run.
function inWindow(now = new Date()) {
  const c = orgTime.orgClock(NY, now);
  const m = c.hour * 60 + c.minute;
  return { open: m >= WINDOW.from && m < WINDOW.to, night: c.date };
}
async function tick(now = new Date()) {
  const w = inWindow(now);
  if (!w.open) return "outside the 3:30 AM window";
  const claimed = await db.query(`INSERT INTO ops_alert_marks (hour_key) VALUES (?) ON CONFLICT DO NOTHING RETURNING hour_key`,
    [`nightly-check-ran:${w.night}`]);
  if (!claimed.length) return `already ran for ${w.night}`;
  const out = await runNightlyCheck({ night: w.night, now });
  return out.red.length ? `RED ${out.red.join(",")} (alert: ${JSON.stringify(out.alert)})` : `clean for ${w.night}`;
}

module.exports = { configure, runNightlyCheck, runChecks, tick, inWindow, alertText, CHECKS, WINDOW };

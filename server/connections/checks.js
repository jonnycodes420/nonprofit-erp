// server/connections/checks.js · HONEST-3 item 1 (W-1126-Integrations-01). A BADGE SAYS CONNECTED
// ONLY WHEN THE CONNECTION WORKS TODAY.
//
// Third night running, the fleet found badges saying Connected or Working while the panel under them
// said "example", "no sign-in held", "connecting turned off" or, for QuickBooks, nothing ever sent
// with 273 gifts waiting and auto-sync off. And "badges still rest on a Nov 23 check with no counts
// kept". The cause, read on staging: Harborlight's sources hold no credential (the demo holds none
// by design), so processGivingSources, which reads only sources with a sealed credential, never
// checked them. The Nov 23 15:26 "check" was the staging seed stamping last_synced_at when it wrote
// the rows. Nothing ever checked again, and nothing kept what was read.
//
// So, three things, in this one file:
//   reasonsOf   what stops a connection working today, each in a few words ("auto-sync off")
//   badgeOf     THE one badge: Connected only with a credential held, connecting on and a check in
//               the last 24 hours that passed. Anything else is "Needs attention" with its reason.
//               The Settings card, the panel under it, the tiles and every FlowWord read it.
//   runChecks   the daily check, for every org holding a connection: one row per connection per run
//               in connection_checks, with what it read (gifts seen, sent, waiting, this week).
// The panel shows the last three runs with their counts.
"use strict";

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_AFTER_MS = 23 * 60 * 60 * 1000;   // the job ticks hourly; an org is checked once a day
const LOCK_TIMEOUT = "1s";
const RETRIES = 20;
const ACTOR = { id: "system:connections/checks", name: "Steward (daily connection check)" };

const LABEL = { connected: "Connected", attention: "Needs attention", not_connected: "Not connected",
  unavailable: "Not available yet", file: "Brought in as a file" };
const DEFINITION = {
  connected: "A sign-in is held, connecting is on, and Steward's check in the last 24 hours passed.",
  attention: "Something stops this working today. The reason is beside it.",
  not_connected: "Steward is not reading this one.",
  unavailable: "Steward cannot connect to this one yet.",
  file: "A file somebody brings in. There is no sign-in to hold and nothing to check.",
};

// ── THE TABLE ──────────────────────────────────────────────────────────────
async function withRetry(client, sql) {
  for (let attempt = 1; ; attempt++) {
    try { return await client.query(sql); }
    catch (e) {
      if (e.code !== "55P03" || attempt >= RETRIES) throw e;   // lock_not_available
      await new Promise(r => setTimeout(r, Math.min(3000, 200 * attempt)));
    }
  }
}
async function ensureCheckTable(pool) {
  const client = await pool.connect();
  try {
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    await withRetry(client, `CREATE TABLE IF NOT EXISTS connection_checks (
        id BIGSERIAL PRIMARY KEY,
        org_id TEXT NOT NULL,
        card_key TEXT NOT NULL,
        checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ok BOOLEAN NOT NULL,
        reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
        counts JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by TEXT NOT NULL,
        created_by_name TEXT)`);
    await withRetry(client, `CREATE INDEX IF NOT EXISTS connection_checks_org_card
        ON connection_checks (org_id, card_key, checked_at DESC)`);
    return { ok: true };
  } finally {
    await client.query("RESET lock_timeout").catch(() => {});
    client.release();
  }
}
let READY = null;
function ready() {
  if (!READY) READY = ensureCheckTable(require("../db/pool").pool).catch(e => { READY = null; throw e; });
  return READY;
}

// ── WHAT STOPS IT WORKING TODAY ────────────────────────────────────────────
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const monDay = at => { const d = new Date(at); return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); };

/**
 * @param card   a card from buildConnectionCards, with its flow
 * @param facts  { demo, oauthReady, qbo, qboAutoSync, now }
 */
function reasonsOf(card, facts = {}) {
  if (!card.connected || isFileCard(card)) return [];
  const now = facts.now ? new Date(facts.now).getTime() : Date.now();
  const r = [];
  if (facts.demo) r.push("example data");
  if (card.credentialHeld === false) r.push("no sign-in held");
  if (card.oauthProvider && facts.oauthReady === false) r.push("connecting turned off");
  if (card.status === "broken") r.push("last check failed");
  if (card.status === "quiet" && card.silentDays != null) r.push(`nothing in ${card.silentDays} days`);
  if (card.kind === "own_stripe" && card.takesGifts === false) r.push("giving pages off");
  if (card.kind === "bookkeeping" && card.provider === "quickbooks") {
    const q = facts.qbo;
    if (q && q.gapFunds && q.gapFunds.length) r.push(`${plural(q.gapFunds.length, "fund")} not mapped`);
    if (q && q.noDeposit) r.push("no deposit account");
    if (facts.qboAutoSync === false) r.push("auto-sync off");
    if (q && !q.sentEver) r.push("nothing sent yet");
  }
  if (card.kind === "bookkeeping" && card.sends === false) r.push("sending not available yet");
  if (card.kind === "email_marketing" && !card.mapped) r.push(`no ${card.audienceNoun || "audience"} chosen`);
  // A source Steward reads on a schedule: a read older than a day is a read that stopped.
  if (card.kind === "source" || card.kind === "pos" || (card.kind === "email_marketing" && card.mapped)) {
    if (card.credentialHeld !== false && !facts.demo) {
      const at = card.lastSyncedAt ? new Date(card.lastSyncedAt).getTime() : null;
      if (!at) r.push("never read");
      else if (now - at > DAY_MS) r.push(`not read since ${monDay(card.lastSyncedAt)}`);
    }
  }
  return [...new Set(r)];
}

const isFileCard = c => c.kind === "statements" || c.mode === "file";

// ── THE ONE BADGE ──────────────────────────────────────────────────────────
// `checks` are this card's newest runs, newest first ({ at, ok, reasons, counts }).
function badgeOf(card, { reasons = [], checks = [], now = null } = {}) {
  const t = now ? new Date(now).getTime() : Date.now();
  const out = (state, reason = null) => ({ state, label: LABEL[state], reason, definition: DEFINITION[state],
    words: reason ? `${LABEL[state]} · ${reason}` : LABEL[state] });
  if (!card.connected) return out(card.flow && card.flow.state === "unavailable" ? "unavailable" : "not_connected");
  if (isFileCard(card)) return out("file");
  if (reasons.length) return out("attention", reasons.slice(0, 2).join(", "));
  const last = checks[0];
  if (!last) return out("attention", "not checked yet");
  const at = new Date(last.at).getTime();
  if (!(t - at <= DAY_MS)) return out("attention", `not checked since ${monDay(last.at)}`);
  if (!last.ok) return out("attention", (last.reasons && last.reasons[0]) || "last check failed");
  return out("connected");
}

// ── WHAT A CHECK READ ──────────────────────────────────────────────────────
function countsOf(card, facts = {}) {
  const c = {};
  if (card.kind === "pos") c.seen = Number(card.sales30) || 0;
  else if (card.kind === "bookkeeping") c.sent = Number(card.deposits30) || 0;
  else if (card.kind === "email_marketing") c.updated = Number(card.lastUpdatedCount) || 0;
  else c.seen = Number(card.gifts30) || 0;
  if (card.kind === "bookkeeping" && card.provider === "quickbooks" && facts.qbo) c.waiting = Number(facts.qbo.pendingCount) || 0;
  if (facts.week && facts.week[card.id] != null) c.week = facts.week[card.id];
  return c;
}
// One line for the panel: "Nov 27 · 24 gifts seen in 30 days, 9 this week · passed"
function checkSentence(chk) {
  const n = chk.counts || {}, parts = [];
  if (n.seen != null) parts.push(`${n.seen.toLocaleString("en-US")} seen in 30 days`);
  if (n.updated != null) parts.push(`${n.updated.toLocaleString("en-US")} records updated on the last read`);
  if (n.week != null) parts.push(`${n.week.toLocaleString("en-US")} this week`);
  if (n.sent != null) parts.push(`${n.sent.toLocaleString("en-US")} sent in 30 days`);
  if (n.waiting != null) parts.push(`${n.waiting.toLocaleString("en-US")} waiting`);
  const verdict = chk.ok ? "passed" : `needs attention (${(chk.reasons || []).join(", ") || "failed"})`;
  return `${monDay(chk.at)} · ${parts.length ? parts.join(", ") + " · " : ""}${verdict}`;
}

// The newest three runs of every card in an org, newest first.
async function recentChecks(query, orgId, per = 3) {
  await ready();
  const rows = await query(
    `SELECT card_key, checked_at, ok, reasons, counts FROM (
       SELECT c.*, ROW_NUMBER() OVER (PARTITION BY card_key ORDER BY checked_at DESC, id DESC) AS rn
         FROM connection_checks c WHERE org_id = ?) x
      WHERE rn <= ? ORDER BY card_key, checked_at DESC`, [orgId, per]);
  const by = {};
  for (const r of rows) {
    const chk = { at: new Date(r.checked_at).toISOString(), ok: r.ok === true,
      reasons: Array.isArray(r.reasons) ? r.reasons : [], counts: r.counts && typeof r.counts === "object" ? r.counts : {} };
    chk.sentence = checkSentence(chk);
    (by[r.card_key] = by[r.card_key] || []).push(chk);
  }
  return by;
}

// Gifts dated in the last seven days, per source: the count the "Connects directly" tile shows.
async function weekCounts(query, orgId) {
  const rows = await query(
    `SELECT giving_source_id AS id, COUNT(*)::int AS n FROM gifts
      WHERE org_id = ? AND giving_source_id IS NOT NULL AND date >= TO_CHAR(NOW() - INTERVAL '7 days', 'YYYY-MM-DD')
      GROUP BY giving_source_id`, [orgId]);
  return Object.fromEntries(rows.map(r => [r.id, Number(r.n) || 0]));
}

// ── THE DAILY CHECK ────────────────────────────────────────────────────────
// Every org holding a connection (a giving source, a books, an email tool, or its own Stripe) whose
// newest check is older than 23 hours. One row per connected card, with its reasons and counts.
async function orgsDue(query, now) {
  await ready();
  const rows = await query(
    `WITH held AS (
       SELECT org_id FROM giving_sources WHERE status <> 'disconnected'
       UNION SELECT org_id FROM bookkeeping_connections WHERE status <> 'disconnected'
       UNION SELECT org_id FROM email_marketing_connections WHERE status <> 'disconnected'
       UNION SELECT id FROM orgs WHERE stripe_account_id IS NOT NULL)
     SELECT h.org_id FROM held h JOIN orgs o ON o.id = h.org_id
      WHERE o.archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM connection_checks c WHERE c.org_id = h.org_id AND c.checked_at > ?::timestamptz)`,
    [new Date(new Date(now).getTime() - DUE_AFTER_MS).toISOString()]);
  return rows.map(r => r.org_id);
}

async function checkOrg(deps, orgId, { now = new Date() } = {}) {
  await ready();
  const { connectionsFor } = require("./honest");
  const body = await connectionsFor(deps, orgId, { now, skipChecks: true });
  const week = await weekCounts(deps.query, orgId);
  let n = 0;
  for (const card of body.cards) {
    if (!card.connected || isFileCard(card)) continue;
    const reasons = card.reasons || [];
    await deps.run(
      `INSERT INTO connection_checks (org_id, card_key, checked_at, ok, reasons, counts, created_by, created_by_name)
       VALUES (?, ?, ?::timestamptz, ?, ?::jsonb, ?::jsonb, ?, ?)`,
      [orgId, card.id, new Date(now).toISOString(), reasons.length === 0, JSON.stringify(reasons),
       JSON.stringify(countsOf(card, { qbo: card._qbo, week })), ACTOR.id, ACTOR.name]);
    n++;
  }
  return n;
}

async function runChecks(deps, { now = new Date(), orgId = null } = {}) {
  const ids = orgId ? [orgId] : await orgsDue(deps.query, now);
  const out = { orgs: [], checked: 0 };
  for (const id of ids) {
    try { out.checked += await checkOrg(deps, id, { now }); out.orgs.push(id); }
    catch (e) { console.error("[connection-checks]", id, e.message); }
  }
  return out;
}

// The inbox card (Gmail, Outlook) through the same badge. Its "check" is the mailbox's own read: the
// last time it read mail, and whether that read failed. A demo's example mailbox holds no sign-in.
function mailboxBadge(p, { demo = false, row = null, now = null } = {}) {
  const card = { connected: !!p.connected, kind: "mailbox" };
  const reasons = [];
  if (p.connected) {
    if (demo || p.example) reasons.push("example data");
    if (row && !row.credentials_sealed && !p.example) reasons.push("no sign-in held");
    if (!p.configured) reasons.push("connecting turned off");
    if (p.paused) reasons.push("paused");
    if (p.lastError) reasons.push("last read failed");
  }
  const at = (p.health && p.health.lastMailReadAt) || p.lastSyncedAt;
  return badgeOf(card, { reasons: [...new Set(reasons)], checks: at ? [{ at, ok: !p.lastError, reasons: [] }] : [], now });
}

module.exports = { ensureCheckTable, mailboxBadge, reasonsOf, badgeOf, countsOf, checkSentence, recentChecks, weekCounts,
  runChecks, checkOrg, LABEL, DEFINITION, DAY_MS, ACTOR, isFileCard };

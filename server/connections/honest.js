// server/connections/honest.js · HONEST-1 item 1. THE CARDS, EACH WITH ITS ONE STATUS.
//
// GET /connections (Settings, Connections), Home's connection lines and Finance's QuickBooks line
// all come through connectionsFor, so the badge, the detail and Home read the same `flow` from
// ./status.js and can never disagree. The facts status.js needs beyond the card (what is waiting
// for QuickBooks and why, whether a provider can be connected on this deployment) are read here,
// each from the function the rest of the product already uses for it.
"use strict";

const { buildConnectionCards } = require("./cards");
const { flowOf, summarize } = require("./status");

// QuickBooks: what is waiting, what is stopping it, and whether anything has ever gone.
// Pending is qboSync.pendingRowsSql, the same definition as the Pending list and its figure.
async function qboFacts(query, orgId) {
  const [c] = await query(
    `SELECT * FROM bookkeeping_connections WHERE org_id=? AND vendor='quickbooks' AND status <> 'disconnected'`, [orgId]);
  const [o] = await query("SELECT qbo_sync_enabled, qbo_auto_sync FROM orgs WHERE id=?", [orgId]);
  if (!c || !o || o.qbo_sync_enabled !== true) return null;
  const QS = require("../../qboSync");
  const map = QS.readMapping(c);
  const since = QS.startDateOf(c, map);
  const q = QS.pendingRowsSql(orgId, since);
  const rows = await query(q.sql, q.args);
  const gaps = await QS.mappingGaps(orgId, map);
  const ever = await QS.sentSummary(orgId, "1900-01-01");
  const [tzRow] = await query("SELECT timezone FROM orgs WHERE id=?", [orgId]);
  return {
    paused: require("../finance/qboPause").pausedOf(c, (tzRow && tzRow.timezone) || undefined),   // HONEST-4 item 2
    autoSync: o.qbo_auto_sync === true,
    pendingCount: rows.length, pendingCents: rows.reduce((t, r) => t + Number(r.cents || 0), 0),
    gapFunds: gaps.ok ? [] : gaps.funds, noDeposit: !gaps.ok && gaps.depositAccount === false,
    sentEver: ever.gifts > 0, lastSentAt: ever.lastAt,
    figureSource: { key: "qbo-pending", params: { since } },
  };
}

// Whether a provider can be connected on this deployment at all: its OAuth app is configured and
// not held back. The same test as GET /oauth/status, so a card and its Connect button agree.
async function oauthReadiness() {
  const O = await import("../../shared/oauth.js");
  const { oauthEnv } = require("../shared/oauthFlow");
  const out = {};
  for (const key of O.PROVIDER_KEYS) {
    if (O.PROVIDERS[key].held) { out[key] = false; continue; }
    const { values } = oauthEnv(key, O.ENV_VARS);
    out[key] = !!(values.clientId && values.clientSecret && values.redirectUri);
  }
  return out;
}

// HONEST-3 item 1: every card also carries `reasons` (what stops it working today), `checks` (the
// daily check's last three runs with their counts) and `badge`, from server/connections/checks.js.
// The Settings card, the panel, the tiles and FlowWord all draw the badge; none decides one.
// `skipChecks` is the daily check itself, which reads the cards before it writes a run.
async function connectionsFor(deps, orgId, { now = null, skipChecks = false } = {}) {
  const CK = require("./checks");
  const body = await buildConnectionCards(deps, orgId);
  const today = deps.orgToday(await deps.orgTz(orgId));                // ORG_TZ_SEAM_OK
  const ready = await oauthReadiness();
  const needsQbo = body.cards.some(c => c.kind === "bookkeeping" && c.provider === "quickbooks" && c.connected);
  const qbo = needsQbo ? await qboFacts(deps.query, orgId) : null;
  const [org] = await deps.query("SELECT org_kind, qbo_auto_sync FROM orgs WHERE id=?", [orgId]);
  const demo = require("../../orgKind").isDemoOrg(org);   // HONEST-2 item 1: a demo's connections are examples
  const checks = skipChecks ? {} : await CK.recentChecks(deps.query, orgId);
  // HONEST-4 item 1: each card's proof (its last real activity, what moved in 30 days), from its own rows.
  const PF = require("./proof");
  const act = await PF.realActivity(deps.query, orgId);
  const [tzRow] = await deps.query("SELECT timezone FROM orgs WHERE id=?", [orgId]);
  const tz = (tzRow && tzRow.timezone) || "America/New_York";
  for (const card of body.cards) {
    const oauthReady = card.oauthProvider ? ready[card.oauthProvider] !== false : null;
    card.flow = flowOf(card, { today, qbo, demo, oauthReady });
    const isQbo = card.kind === "bookkeeping" && card.provider === "quickbooks";
    card.reasons = CK.reasonsOf(card, { demo, oauthReady, now, qbo: isQbo ? qbo : null, qboAutoSync: isQbo ? org && org.qbo_auto_sync === true : null });
    if (isQbo && skipChecks) Object.defineProperty(card, "_qbo", { value: qbo, enumerable: false });
    card.checks = checks[card.id] || [];
    card.proof = PF.proofOf(card, { demo, act: act[card.id] || null, tz });
    card.example = !!(card.proof && card.proof.example);
    if (card.example && card.flow) card.flow = { ...card.flow, example: true };
    card.badge = CK.badgeOf(card, { reasons: card.reasons, checks: card.checks, now, example: card.example });
  }
  // HONEST-4 item 6: a 30-day figure that moved since the last check says why.
  if (!skipChecks) {
    const why = await require("./weekWhy").monthWhys(deps.query, orgId, body.cards, { now: now || new Date() }).catch(() => ({}));
    for (const card of body.cards) if (why[card.id] && card.proof) card.proof.moved30.why = why[card.id];
  }
  const sum = summarize(body.cards);
  // HONEST-3 item 2: when a connection needs someone, whether anyone will be emailed about it.
  const alertReach = sum.counts.needs_you && !skipChecks ? await require("./alertReach").alertReach(deps.query, orgId) : null;
  return { ...body, flowCounts: sum.counts, flowSentence: sum.sentence, alertReach };
}

module.exports = { connectionsFor, qboFacts, oauthReadiness };

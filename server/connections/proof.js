// server/connections/proof.js · HONEST-4 items 1 and 3. EVERY CONNECTION PROVES ITSELF WITH ITS
// LAST REAL ACTIVITY.
//
// HubSpot's Connected Apps page shows a dot and a Last Activity date, and leaves the status blank
// when an app has no live status. The fleet (W-1128-Integrations-N4) found Steward's public status
// page saying "Stripe gift sync Working" while the app said Needs attention over example data, and
// the demo's Mailchimp, Gmail and Outlook saying "Working" and "Connected and synced" over a seeded
// file. So every card now carries a `proof`, from that connection's own rows:
//
//   last     the last real thing it did, in words: "Last gift read Nov 26, 2:14 PM"
//   moved30  records and dollars moved through it in the last 30 days
//   example  true when its rows are the demo's or sample rows. An example is never Connected,
//            never counted as a connection, and says "Example data" where the status would be.
//
// "Real" means a row that is not sample data, in an org that is not a demo. The time is when
// Steward read the row (its created_at), in the org's own time zone. Nothing here writes.
"use strict";

const EXAMPLE_WORDS = "Example data";
const EXAMPLE_SENTENCE = "Example data: nothing real has come through it.";
const NEVER = "No real activity yet.";
const money = cents => "$" + (Math.round(Number(cents) || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "Nov 26, 2:14 PM" in the org's own zone.
function stampWords(at, tz = "America/New_York") {
  const d = new Date(at);
  if (isNaN(d)) return "";
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  return `${day}, ${time}`;
}

// The verb each kind does, for "Last <noun> <verb> <when>".
function whatOf(card) {
  if (card.kind === "bookkeeping") return "Last sent to " + (card.label || "the books");
  if (card.kind === "email_marketing") return "Last read";
  if (card.kind === "pos") return "Last sale read";
  if (card.kind === "own_stripe") return "Last gift taken";
  return "Last gift read";
}

// One round trip: per connection, when Steward last read a REAL row through it, and whether every
// row through it is a sample. Keys are giving_source ids, plus "own_stripe" for the org's own Stripe.
async function realActivity(query, orgId) {
  const rows = await query(
    `SELECT COALESCE(giving_source_id, CASE WHEN stripe_payment_id IS NOT NULL THEN 'own_stripe' END) AS k,
            MAX(created_at) FILTER (WHERE COALESCE(is_sample, false) = false) AS real_at,
            COUNT(*)::int AS n, COUNT(*) FILTER (WHERE COALESCE(is_sample, false) = false)::int AS real_n
       FROM gifts WHERE org_id = ? AND (giving_source_id IS NOT NULL OR stripe_payment_id IS NOT NULL)
      GROUP BY 1`, [orgId]);
  const out = {};
  for (const r of rows) if (r.k) out[r.k] = { at: r.real_at ? new Date(r.real_at).toISOString() : null, n: Number(r.n) || 0, realN: Number(r.real_n) || 0 };
  return out;
}

const isExample = (card, { demo = false, act = null } = {}) =>
  !!card.connected && (demo || (!!act && act.n > 0 && act.realN === 0));

/**
 * The proof on one card.
 * @param card   a card from buildConnectionCards
 * @param facts  { demo, act (realActivity[card id]), tz }
 */
function proofOf(card, { demo = false, act = null, tz } = {}) {
  if (!card.connected || card.kind === "statements" || card.mode === "file") return null;
  const example = isExample(card, { demo, act });
  const cents = card.kind === "pos" ? Number(card.takings30Cents) || 0
    : card.kind === "bookkeeping" ? Number(card.deposits30Cents) || 0 : Number(card.dollars30Cents) || 0;
  const records = card.kind === "pos" ? Number(card.sales30) || 0
    : card.kind === "bookkeeping" ? Number(card.deposits30) || 0
    : card.kind === "email_marketing" ? Number(card.lastUpdatedCount) || 0 : Number(card.gifts30) || 0;
  const noun = card.kind === "pos" ? "sale" : card.kind === "bookkeeping" ? "record sent" : card.kind === "email_marketing" ? "record updated" : "gift";
  const nouns = card.kind === "bookkeeping" ? "records sent" : card.kind === "email_marketing" ? "records updated" : noun + "s";
  const moved30 = card.kind === "email_marketing"
    ? { records, cents: null, words: `${records.toLocaleString("en-US")} ${records === 1 ? noun : nouns} on the last read` }
    : { records, cents, words: `${records.toLocaleString("en-US")} ${records === 1 ? noun : nouns}, ${money(cents)} in the last 30 days` };
  if (example) return { example: true, last: null, lastWords: EXAMPLE_SENTENCE, moved30: { ...moved30, words: `${EXAMPLE_WORDS}: ${moved30.words}` } };
  const at = card.kind === "bookkeeping" ? card.lastSentAt
    : card.kind === "email_marketing" ? (card.credentialHeld === false ? null : card.lastSyncedAt)
    : act && act.at ? act.at : null;
  return { example: false, last: at ? { at, what: whatOf(card) } : null,
    lastWords: at ? `${whatOf(card)} ${stampWords(at, tz)}` : NEVER, moved30 };
}

// ── THE PUBLIC STATUS PAGE ─────────────────────────────────────────────────
// The page's Stripe and giving-source lines read the same rule: a line says Working only when a
// real org (not a demo) holds that connection and real activity came through it within the window.
// No real connection to measure: "unknown", which the page shows with no status word at all.
// Each line states its last real activity, across every real org, by time only (never an org).
async function platformActivity(query) {
  const [s] = await query(
    `SELECT MAX(g.created_at) AS at FROM gifts g JOIN orgs o ON o.id = g.org_id
      WHERE NOT ${require("../../orgKind").demoOrgSql("o")} AND o.archived_at IS NULL AND o.stripe_account_id IS NOT NULL
        AND g.giving_source_id IS NULL AND g.stripe_payment_id IS NOT NULL AND COALESCE(g.is_sample, false) = false`);
  const [held] = await query(
    `SELECT COUNT(*)::int AS n FROM orgs o WHERE o.stripe_account_id IS NOT NULL AND o.archived_at IS NULL AND NOT ${require("../../orgKind").demoOrgSql("o")}`);
  const [src] = await query(
    `SELECT MAX(g.created_at) AS at FROM gifts g JOIN giving_sources gs ON gs.id = g.giving_source_id AND gs.org_id = g.org_id
       JOIN orgs o ON o.id = g.org_id
      WHERE NOT ${require("../../orgKind").demoOrgSql("o")} AND o.archived_at IS NULL AND gs.status <> 'disconnected'
        AND gs.credentials_sealed IS NOT NULL AND COALESCE(g.is_sample, false) = false`);
  const [srcHeld] = await query(
    `SELECT COUNT(*)::int AS n FROM giving_sources gs JOIN orgs o ON o.id = gs.org_id
      WHERE gs.status <> 'disconnected' AND gs.credentials_sealed IS NOT NULL AND o.archived_at IS NULL AND NOT ${require("../../orgKind").demoOrgSql("o")}`);
  return { stripe: { held: Number(held && held.n) || 0, at: s && s.at ? new Date(s.at).toISOString() : null },
           sources: { held: Number(srcHeld && srcHeld.n) || 0, at: src && src.at ? new Date(src.at).toISOString() : null } };
}

// The state and detail of one public line, from its health check and its real activity.
// `health` is the check that already ran ("up" | "degraded" | "down" | "unknown", with its detail).
const PUBLIC_WINDOW_DAYS = 14;
function publicLine(health, act, { noun, now = Date.now() } = {}) {
  if (!act || !act.held) return { state: "unknown", detail: `No live ${noun} connection to measure yet.` };
  const last = act.at ? `Last real gift read ${stampWords(act.at, "America/New_York")} ET.` : "No real gift has been read yet.";
  if (health.state !== "up") return { state: health.state, detail: [health.detail, last].filter(Boolean).join(" ") };
  if (!act.at || now - new Date(act.at).getTime() > PUBLIC_WINDOW_DAYS * 86400000)
    return { state: "unknown", detail: `${last} Nothing real came through in the last ${PUBLIC_WINDOW_DAYS} days, so there is nothing to call working.` };
  return { state: "up", detail: last };
}

module.exports = { proofOf, realActivity, isExample, stampWords, platformActivity, publicLine,
  EXAMPLE_WORDS, EXAMPLE_SENTENCE, PUBLIC_WINDOW_DAYS };

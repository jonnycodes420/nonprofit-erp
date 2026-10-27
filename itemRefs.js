// itemRefs.js · THREAD-2. THE THINGS A SENTENCE NAMES, FROM THIS ORG ONLY.
//
// A Thread step reads "Invite Margaret to the Harbor Run". The person is
// already on the row; the event is only words. This reads the org's own
// events, campaigns, journeys and groups once, and returns the refs whose
// names appear in the text, so shared/itemLinks.js can link them.
//
// Tenant rule: every read is WHERE org_id = ?, so a name can only ever link
// to a record of the org the reader is in.
"use strict";

let LINKS = null;
const LINKS_READY = import("./shared/itemLinks.js").then(m => { LINKS = m; return m; });
async function links() { return LINKS || LINKS_READY; }

// Names shorter than this are words, not names ("Run", "Gala" alone).
const MIN_NAME = 4;

async function orgCatalog(query, orgId) {
  const safe = p => p.catch(() => []);
  const [events, campaigns, journeys, groups] = await Promise.all([
    safe(query(`SELECT id, name, date FROM events WHERE org_id = ?`, [orgId])),
    safe(query(`SELECT id, name, goal_amount FROM campaigns WHERE org_id = ?`, [orgId])),
    safe(query(`SELECT id, name FROM cultivation_templates WHERE org_id = ? AND archived_at IS NULL`, [orgId])),
    safe(query(`SELECT id, name FROM audiences WHERE org_id = ? AND kind IS NOT NULL`, [orgId])),
  ]);
  const out = [];
  for (const e of events) out.push({ kind: "event", id: e.id, name: e.name, date: require("./orgTime").civilOf(e.date) });   // HARDEN-1: a DATE column is a Date; String() of it is not a day
  for (const c of campaigns) out.push({ kind: "campaign", id: c.id, name: c.name, fundraising: Number(c.goal_amount) > 0 });
  for (const j of journeys) out.push({ kind: "journey", id: j.id, name: j.name });
  for (const g of groups) out.push({ kind: "group", id: g.id, name: g.name });
  return out.filter(r => String(r.name || "").trim().length >= MIN_NAME);
}

// The catalog refs named anywhere in `texts`.
function refsNamedIn(texts, catalog) {
  const hay = (Array.isArray(texts) ? texts : [texts]).map(t => String(t || "")).join("\n");
  if (!hay.trim() || !catalog || !catalog.length) return [];
  const seen = new Set();
  const out = [];
  for (const r of catalog) {
    const name = String(r.name).trim();
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "iu");
    if (re.test(hay) && !seen.has(r.kind + ":" + r.id)) { seen.add(r.kind + ":" + r.id); out.push(r); }
  }
  return out;
}

// The person a row is about, never with a blank name.
async function personRef(d) {
  const L = await links();
  return { kind: "person", id: d.id, name: L.nameOrFallback(d.name, d.email), email: d.email || null };
}

// The module, once loaded (it loads at boot); for a sync email renderer.
function linksNow() { return LINKS; }

module.exports = { links, linksNow, LINKS_READY, orgCatalog, refsNamedIn, personRef };

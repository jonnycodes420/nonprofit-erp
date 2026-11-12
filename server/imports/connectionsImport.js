// server/imports/connectionsImport.js · CONNECT-1. "INTRODUCED BY" AND "GUEST OF" FROM A FILE.
//
// The spreadsheet import's mapper reads two columns onto the person
// (shared/sheetRead.js introducedBy, guestOf): the name or email of whoever
// brought them in. Here each is matched to ONE person already in Steward
// (after this file's own people are written, so a file may name someone in
// it): an email by the email on file, otherwise the name, whole and ignoring
// case. Nobody is ever created for it. A value that names nobody, or more
// than one person, links nothing and is listed for review on the import's
// summary. Links carry the import's id, so Undo removes them with it
// (server/imports/undo.js), and a Guest of link names the import's event
// when the file is one. Set-wise: one read of the people, one of the links
// already there, and the new links inserted in batches.
"use strict";
const { newId } = require("../shared/newId");

const KIND_WORDS = { introduced_by: "Introduced by", guest_of: "Guest of" };
const norm = v => String(v || "").trim().replace(/\s+/g, " ").toLowerCase();

async function linkFromFile({ query, orgId, people, personIds, importId, who, eventId = null }) {
  const asks = [];
  for (const p of people || []) {
    const newcomerId = (personIds.get(p.key) || [])[0];
    if (!newcomerId) continue;
    const line = (p.lines || [])[0] || null;
    if (p.introducedBy) asks.push({ newcomerId, raw: p.introducedBy, type: "introduced_by", name: p.name, line });
    if (p.guestOf) asks.push({ newcomerId, raw: p.guestOf, type: "guest_of", name: p.name, line });
  }
  const out = { linked: 0, unmatched: [] };
  if (!asks.length) return out;
  const emails = [...new Set(asks.filter(a => a.raw.includes("@")).map(a => norm(a.raw)))];
  const names = [...new Set(asks.filter(a => !a.raw.includes("@")).map(a => norm(a.raw)))];
  const found = await query(
    `SELECT id, lower(trim(COALESCE(email, ''))) AS email, lower(regexp_replace(trim(COALESCE(name, '')), '\\s+', ' ', 'g')) AS name
       FROM donors WHERE org_id = ? AND deleted_at IS NULL
        AND (lower(trim(COALESCE(email, ''))) = ANY(?::text[]) OR lower(regexp_replace(trim(COALESCE(name, '')), '\\s+', ' ', 'g')) = ANY(?::text[]))`,
    [orgId, emails, names]);
  const byEmail = new Map(), byName = new Map();
  const add = (m, k, id) => { if (!k) return; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(id); };
  for (const r of found) { add(byEmail, r.email, r.id); add(byName, r.name, r.id); }
  const want = [];
  for (const a of asks) {
    const hits = [...((a.raw.includes("@") ? byEmail : byName).get(norm(a.raw)) || [])].filter(id => id !== a.newcomerId);
    if (hits.length === 1) { want.push({ ...a, connectorId: hits[0] }); continue; }
    out.unmatched.push({ donorId: a.newcomerId, name: a.name, kind: KIND_WORDS[a.type], value: a.raw.slice(0, 200), line: a.line,
      why: hits.length ? `${hits.length} people in Steward match "${a.raw}"; link the right one on their profile.` : `Nobody in Steward matches "${a.raw}"; nobody was added for it.` });
  }
  if (!want.length) return out;
  const ev = t => (t === "guest_of" ? eventId || null : null);
  const had = new Set((await query(
    `SELECT donor_id_a, donor_id_b, relationship_type, COALESCE(event_id, '') AS ev FROM donor_relationships
      WHERE org_id = ? AND donor_id_a = ANY(?::text[]) AND relationship_type IN ('introduced_by', 'guest_of')`,
    [orgId, [...new Set(want.map(w => w.newcomerId))]])).map(r => `${r.donor_id_a}|${r.donor_id_b}|${r.relationship_type}|${r.ev}`));
  const rows = [];
  for (const w of want) {
    const k = `${w.newcomerId}|${w.connectorId}|${w.type}|${ev(w.type) || ""}`;
    if (had.has(k)) continue;
    had.add(k);
    rows.push([newId("drel"), w.newcomerId, w.connectorId, w.type, ev(w.type)]);
  }
  for (let i = 0; i < rows.length; i += 500) {
    const b = rows.slice(i, i + 500);
    await query(
      `INSERT INTO donor_relationships (id, org_id, donor_id_a, donor_id_b, relationship_type, event_id, created_by, created_by_name, import_id)
       SELECT x.id, ?, x.a, x.b, x.t, x.ev, ?, ?, ? FROM unnest(?::text[], ?::text[], ?::text[], ?::text[], ?::text[]) AS x(id, a, b, t, ev) RETURNING id`,
      [orgId, who.id, who.name, importId, b.map(r => r[0]), b.map(r => r[1]), b.map(r => r[2]), b.map(r => r[3]), b.map(r => r[4])]);
  }
  out.linked = rows.length;
  return out;
}

module.exports = { linkFromFile };

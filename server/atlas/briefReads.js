// server/atlas/briefReads.js · ATLAS-8 item 5. THE BRIEF READS THE WHOLE RECORD.
//
// Jarvis (22 Nov): "Brief me" said no conversation was logged over a record
// holding a meeting and three volunteer shifts, and left out every About fact.
// The brief (answers.js personAnswer) read only `interactions` rows with a
// written note, of seven types: a meeting held on the calendar, a call logged
// with no note, an event they came to and a volunteer shift were all invisible.
//
// Now the last conversation is the profile's own rule (meetings.js
// conversationsWith: a held meeting, a call, an email, an ask, a touch, an
// event they came to), and a volunteer shift counts too. The About facts are
// what the profile's About section shows beside the note: roles, employer,
// spouse, birthday and tags.
"use strict";

const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const TYPE = { call: "Call", meeting: "Meeting", email: "Email", note: "Note", visit: "Visit", ask: "Ask", stewardship: "Thank-you", letter: "Letter",
  text: "Text", gift_sent: "Gift sent", event_invite: "Event invite", event: "Came to", volunteer: "Volunteer shift" };

// The newest `limit` conversations of any kind, volunteer shifts among them: { id, type, date, note, section }.
async function lastConversations(query, orgId, donorId, limit = 3, today = null) {
  const M = require("../../meetings");
  const [talk, shifts] = await Promise.all([
    M.conversationsWith(orgId, donorId, { limit }).catch(e => { console.error("[atlas] brief conversations:", e.message); return []; }),
    query(`SELECT id, LEFT(date, 10) AS date, hours, role, note FROM volunteer_shifts WHERE org_id=? AND person_id=? AND date IS NOT NULL AND LEFT(date, 10) <= ? ORDER BY date DESC, id DESC LIMIT ?`, [orgId, donorId, today || "9999-12-31", limit]).catch(() => []),
  ]);
  const rows = [
    ...talk.map(c => ({ id: c.id, type: c.type, date: String(c.date || "").slice(0, 10), note: c.note || "", section: "timeline" })),
    ...shifts.map(s => ({ id: s.id, type: "volunteer", date: String(s.date).slice(0, 10), note: [`${Number(s.hours)} ${Number(s.hours) === 1 ? "hour" : "hours"}`, s.role, s.note].filter(Boolean).join(", "), section: "timeline" })),
  ];
  const seen = new Set();
  return rows.filter(r => r.date && !seen.has(r.id) && seen.add(r.id))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id))).slice(0, limit);
}

// The About facts beside the About note, each one line, or [].
async function aboutFacts(query, orgId, donorId) {
  const [d] = await query(`SELECT person_types, employer, spouse_name, birth_month, birth_day, birth_year, tags FROM donors WHERE id=? AND org_id=?`, [donorId, orgId]).catch(() => []);
  if (!d) return [];
  const parse = v => { if (Array.isArray(v)) return v; try { const x = JSON.parse(v || "[]"); return Array.isArray(x) ? x : []; } catch { return String(v || "").split(",").map(s => s.trim()).filter(Boolean); } };
  const out = [];
  const roles = parse(d.person_types).filter(Boolean);
  if (roles.length && !(roles.length === 1 && roles[0] === "donor")) out.push(`Roles: ${roles.map(r => String(r).replace(/_/g, " ")).join(", ")}`);
  if (String(d.employer || "").trim()) out.push(`Works at ${String(d.employer).trim()}`);
  if (String(d.spouse_name || "").trim()) out.push(`Spouse: ${String(d.spouse_name).trim()}`);
  if (d.birth_month && d.birth_day) out.push(`Birthday: ${MON[Number(d.birth_month) - 1]} ${Number(d.birth_day)}${d.birth_year ? `, ${d.birth_year}` : ""}`);
  const tags = parse(d.tags).filter(t => t && !/^(?:card-failed|stale-frequency)$/.test(t));
  if (tags.length) out.push(`Tags: ${tags.slice(0, 8).join(", ")}`);
  return out;
}

module.exports = { lastConversations, aboutFacts, TYPE };

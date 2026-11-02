// server/shared/crmCommon.js — the small helpers more than one CRM domain reads.
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
  actor, query, rbCentsEv,
} = ctx;

// FIX-2 A — EVERY NUMBER OPENS. Each figure below is computed THROUGH its
// source (figureSources.js): the value is the aggregate over the exact query
// the drill-through pages, so a figure and its rows cannot disagree. Every
// figure leaves here carrying that `source`, and a blank carries the sentence
// that says what is missing and when it will appear.
const figureSources = require("../../figureSources");
// FIX-19: every user id that comes from the request is checked against the org here.
const OU = require("../../orgUsers");
// PARITY-1 Part D: Groups (saved lists, static or by rule).
const GR = require("../../groups");

function eventLevelPayload(l, taken = 0) {
  return { id: l.id, kind: l.kind, name: l.name, price: Number(l.price), fmv: Number(l.fmv),
    memberPrice: l.member_price == null ? null : Number(l.member_price),
    deductible: (rbCentsEv(l.price) - rbCentsEv(l.fmv)) / 100, capacity: l.capacity, taken,
    remaining: l.capacity == null ? null : Math.max(0, l.capacity - taken), recognition: l.recognition,
    picture: l.picture || null,   // FIX-41
    benefits: Array.isArray(l.benefits) ? l.benefits : [],
    retired: !!l.retired_at };   // FIX-41: kept on every guest, hidden from new use
}

// The signed-in person as a timeline line names them: their id and their name.
async function staffWho(req) {
  const who = actor(req);
  const [u] = who.id ? await query("SELECT name FROM users WHERE id=? AND org_id=?", [who.id, req.user.orgId]) : [];
  return { id: who.id, name: (u && u.name) || who.name };
}
return { GR, OU, eventLevelPayload, figureSources, staffWho };
}

module.exports = { mount };

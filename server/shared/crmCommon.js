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
  actor, pruneUnreferencedAssets, query, rbCentsEv,
} = ctx;
const birthdayMod = () => import("../../shared/birthday.js");   // PARITY-3 6a

// FIX-2 A — EVERY NUMBER OPENS. Each figure below is computed THROUGH its
// source (figureSources.js): the value is the aggregate over the exact query
// the drill-through pages, so a figure and its rows cannot disagree. Every
// figure leaves here carrying that `source`, and a blank carries the sentence
// that says what is missing and when it will appear.
const figureSources = require("../../figureSources");
// FIX-19: every user id that comes from the request is checked against the org here.
const OU = require("../../orgUsers");
// PARITY-1: giving level, lifecycle, retained and closeness, defined once.
const DS = require("../../donorStatus");
// PARITY-1 Part D: Groups (saved lists, static or by rule).
const GR = require("../../groups");

// The money in a sentence: whole dollars when there are no cents.
function sentenceMoney(v) {
  const c = Math.abs(Math.round((Number(v) || 0) * 100));
  const whole = c % 100 === 0;
  return "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}

// The hub's single read. One payload so the landing screen is one request
// rather than five that arrive in a different order every time.
// MAIL-1 Part 3: ONE SENTENCE ABOUT WHETHER HER EMAIL GOES, decided by the
// mail policy (mailPolicy.js), never a raw flag. Before the donor file is in:
// "Email turns on once your donor file is in." Once it sends: the From address.
const mailPolicy = require("../../mailPolicy");

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
async function pruneCampaignAssets(orgId) {
  const rows = await query(`SELECT hero_image_url FROM campaigns WHERE org_id = ? AND hero_image_url IS NOT NULL`, [orgId]);
  const keep = [];
  for (const r of rows) {
    const m = /^\/portal-assets\/(pa_[a-f0-9]{24})$/.exec(String(r.hero_image_url));
    if (m) keep.push(m[1]);
  }
  await pruneUnreferencedAssets(orgId, "campaign", keep);
}
return { DS, GR, OU, birthdayMod, eventLevelPayload, figureSources, mailPolicy, pruneCampaignAssets, sentenceMoney, staffWho };
}

module.exports = { mount };

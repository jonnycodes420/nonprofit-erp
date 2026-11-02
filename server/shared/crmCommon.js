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
  actor, geocode, orgToday, orgTz, pruneUnreferencedAssets, query, rbCentsEv, run, uuid, giftHooks,
} = ctx;
const birthdayMod = () => import("../../shared/birthday.js");   // PARITY-3 6a

// ── Gift date normalization ────────────────────────────────────────────────
// Enforces ISO YYYY-MM-DD so MAX(date) string comparison = chronological order.
// BUILD-77 Part 2a — NO date default, anywhere. This used to fall back to
// today() twice (empty → today, unparseable → today, via the
// platform-dependent native Date parser in between): a real file's
// "03-16-2020" failed in the BROWSER's parser upstream, fell through to
// now(), and turned a drifting seasonal donor into "Gave $25,000 on
// September 4 — not yet thanked" (September 4 because new Date() is UTC —
// tomorrow's date every evening, while the page header still said the
// org-local September 3). A gift with an unparseable date is an ERROR with
// its line number, never a gift dated today. The CLIENT parses the messy
// formats (importShape.normalizeDate, nine explicit formats, no native
// fallback); the server accepts calendar-valid ISO and refuses everything
// else — refusal is visible, a default is not.
function normalizeGiftDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || y < 1900 || y > 2100) return null;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= dim ? s : null;
}

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

async function orgRow(orgId) { const [o] = await query("SELECT * FROM orgs WHERE id=?", [orgId]); return o || {}; }

// NUMBERS-2 · a total the file stated, with no gifts behind it, is kept as
// its own figure (donorSummary.js KEEP_IMPORTED_TOTAL) under the file's name.
async function keepImportedTotals(q, orgId, ids, sourceName) {
  if (!ids || !ids.length) return;
  const words = String(sourceName || "").replace(/\s+/g, " ").trim().slice(0, 80) || "your old system";
  // NUMBERS-4: in batches (donorSummary.js), so a 25,000-person file is linear.
  const DS = require("../../donorSummary");
  await DS.keepImportedTotalsFor(q, orgId, ids, words, orgToday(await orgTz(orgId)));   // ORG_TZ_SEAM_OK
  // FIX-49: and the one statement, so first_gift_date reads the old system's
  // first (or last) gift the moment the file is in, not at the next gift.
  await DS.recomputeSummaries(q, orgId, ids);
}

// The hub's single read. One payload so the landing screen is one request
// rather than five that arrive in a different order every time.
// MAIL-1 Part 3: ONE SENTENCE ABOUT WHETHER HER EMAIL GOES, decided by the
// mail policy (mailPolicy.js), never a raw flag. Before the donor file is in:
// "Email turns on once your donor file is in." Once it sends: the From address.
const mailPolicy = require("../../mailPolicy");

// markDonorsForGeocoding(orgId, opts) — recompute every affected donor's
// address key and set the status the key implies. A row whose key is unchanged
// AND already `ok` is left alone: that is the caching requirement, enforced in
// SQL rather than trusted to a caller.
//   · no address at all      → 'no_address', coordinates cleared
//   · key changed / new      → 'pending'
//   · key same and 'ok'      → untouched, never looked up twice
// `donorIds` scopes it to one write; omitted, it sweeps the org (used after an
// import, where naming every id would be a 25,000-element array).
async function markDonorsForGeocoding(orgId, { donorIds = null } = {}) {
  const scope = donorIds && donorIds.length ? " AND id = ANY(?)" : "";
  const params = donorIds && donorIds.length ? [orgId, donorIds] : [orgId];
  const rows = await query(
    `SELECT id, address, address2, city, state, zip, country, geocode_key, geocode_status
       FROM donors WHERE org_id = ? AND deleted_at IS NULL${scope}`, params);
  const toPending = [], toNoAddress = [];
  const keyById = new Map();
  for (const d of rows) {
    const key = geocode.addressKey(d);
    if (!key) {
      if (d.geocode_status !== "no_address") toNoAddress.push(d.id);
      continue;
    }
    if (d.geocode_status === "ok" && d.geocode_key === key) continue;   // never twice
    if (d.geocode_status === "pending" && d.geocode_key === key) continue;
    toPending.push(d.id);
    keyById.set(d.id, key);
  }
  const CH = 1000;
  for (let i = 0; i < toNoAddress.length; i += CH)
    await run(`UPDATE donors SET geocode_status='no_address', geocode_key=NULL, latitude=NULL, longitude=NULL,
                 geocoded_at=NOW(), geocode_provider=NULL WHERE org_id=? AND id = ANY(?)`,
              [orgId, toNoAddress.slice(i, i + CH)]);
  for (let i = 0; i < toPending.length; i += CH) {
    const slice = toPending.slice(i, i + CH);
    // One statement per chunk, key per row via an unnested pair list.
    await run(`UPDATE donors SET geocode_status='pending', geocode_key=v.key, latitude=NULL, longitude=NULL
                 FROM (SELECT * FROM UNNEST(?::text[], ?::text[]) AS t(id, key)) AS v
                WHERE donors.id = v.id AND donors.org_id = ?`,
              [slice, slice.map(id => keyById.get(id)), orgId]);
  }
  return { pending: toPending.length, noAddress: toNoAddress.length, scanned: rows.length };
}

// ── Custom Fields (BUILD-78) ────────────────────────────────────────────────
// The definitions table (custom_field_defs) is the ONLY authority on shape;
// values live in a custom_fields JSONB column ON the donor/gift row. Every
// value write goes through validateCustomFields (customFields.js) — THE one
// seam (spec 1.4); a second validation implementation anywhere is the defect.
// There is NO hard-delete path in this build: archive hides a field from the
// record, the mapper and the export, and destroys nothing (spec 1.6).
const CF_ENTITIES = ["donor", "gift"];
// Part 9 — definition changes and value writes land in the audit trail as
// their OWN event types, each carrying an actor identity (never a boolean).
async function cfEvent(req, orgId, entity, event, { fieldId, entityId, detail } = {}) {
  await run(
    `INSERT INTO custom_field_events (id,org_id,entity,field_id,entity_id,event,detail,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    ["cfe_" + uuid().slice(0, 12), orgId, entity, fieldId || null, entityId || null, event,
     JSON.stringify(detail || {}), actor(req).id, actor(req).name]
  );
}
async function cfShape() { return import("../../shared/customFieldShape.js"); }

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
// CLEAN-1: Data health's merge and address tidy mark the survivor for geocoding.
giftHooks.markDonorsForGeocoding = markDonorsForGeocoding;
return { CF_ENTITIES, DS, GR, OU, birthdayMod, cfEvent, cfShape, eventLevelPayload, figureSources, keepImportedTotals, mailPolicy, markDonorsForGeocoding, normalizeGiftDate, orgRow, pruneCampaignAssets, sentenceMoney, staffWho };
}

module.exports = { mount };

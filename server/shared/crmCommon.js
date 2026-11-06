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
  ALL_PIPELINE_STAGES, MB_READY, actor, geocode, mbCents, orgTime, orgToday, orgTz, orgTzName,
  pruneUnreferencedAssets, query, rbCentsEv, run, uuid, giftHooks, reportHooks,
} = ctx;
let MB = null;
MB_READY.then(m => { MB = m; });
// ARCH-1: a timestamp tested against the org's civil days (a fiscal year, a
// report's from..to), cut at the ORG's midnight through the one seam, never at
// the database's (`?::date`). Placeholders stay where they were: from, then to.
const inOrgDays = (col, orgCol, from, to) => orgTime.orgDayWindowSql(col, orgTime.orgTzSql(orgCol), from, to);
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
// Stage-weighted forecast: a donor's current stage is a rough close-probability
// for their open asks. Solicit is near the ask; prospect is far off.
const STAGE_WEIGHT = { prospect: 0.1, qualify: 0.2, cultivate: 0.4, solicit: 0.7, steward: 0.9, lapsed: 0.05 };

// ── assignment = portfolio = pipeline membership (BUILD-30, the ONE definition) ─
// A donor assigned to an officer IS in that officer's portfolio, and a donor in
// a portfolio IS on that officer's pipeline board. Assignment is the single
// membership state — there is NO separate "on the board" flag (the old
// `in_pipeline` column is retired/dormant; nothing reads or writes it). Every
// count, label, and board render for portfolio/pipeline derives from this one
// helper, so Home's Portfolio card, Home's Pipeline card, the Pipeline board,
// and the Donors "My Pipeline"/Team views can never disagree again.
//
// Returns a SQL WHERE fragment (using the given table alias) + params selecting
// an officer's portfolio, org-scoped. Unassigned donors match NOTHING here —
// they live in the Directory only and never appear on any board (preserving the
// "the board is not the whole donor list" guarantee). scope:
//   'mine'      → the caller's own assigned donors (assigned_to = userId)
//   'all'       → every assigned donor in the org (assigned_to IS NOT NULL)
//   assignedTo  → one specific officer's portfolio (overrides scope)
function portfolioMembership({ orgId, userId, scope = "mine", assignedTo = null, alias = "d" }) {
  const a = alias ? alias + "." : "";
  // stage ∈ the 6 canonical pipeline stages — every real donor has one (validation
  // only permits these), so for real data "assigned" ⟺ "member". The clause is a
  // belt-and-braces guard so a donor in some non-pipeline stage can never make the
  // Portfolio card, the Pipeline card, and the board disagree — all three exclude
  // it identically. It also keeps the board's per-stage columns exhaustive.
  // BUILD-83 Part 3.5 — an imported donor's `stage` is NULL until a human
  // places them, but assignment IS membership (BUILD-30's single definition):
  // assigning someone from an import must never make them vanish off the board.
  // So membership reads the placed stage OR the suggestion, and the CARD says
  // which it is. Moving the card writes `stage` and the suggestion stops
  // mattering for that donor.
  const clauses = [`${a}org_id = ?`, `${a}deleted_at IS NULL`, `COALESCE(${a}stage, ${a}suggested_stage) = ANY(?)`];
  const params = [orgId, ALL_PIPELINE_STAGES];
  if (assignedTo) {
    clauses.push(`${a}assigned_to = ?`); params.push(String(assignedTo));
  } else if (scope === "all") {
    clauses.push(`${a}assigned_to IS NOT NULL`);
  } else {
    clauses.push(`${a}assigned_to = ?`); params.push(String(userId));
  }
  return { where: clauses.join(" AND "), params };
}
// ═══ SEC-1 · TWO-FACTOR AND SESSIONS ═══════════════════════════════════════
// Every route below is the signed-in person's own, except the three marked
// OWNER, which take an admin and a teammate in the same organisation. Every
// one is audited by the trail above every router; the verbs are named here.
const TF = require("../../twoFactor");
const { newId } = require("./newId");   // IDS-1: every new row id is prefix + 20 hex

// THE ORG'S STEWARD START DATE — 0.6's answer depends on it. A thank-you is not
// owed for a gift that arrived before the product did: an imported file is
// history. The first COMMITTED import is the honest boundary, and the honest
// proxy for it is the earliest donor this org actually created, which is what
// an import writes. Falls back to the org's own creation date.
async function orgStewardStart(orgId) {
  // TO_CHAR, not ::date — pg hands a DATE back as a JS Date object, and
  // String()-then-slice on one yields "Tue Aug 12", which then compares
  // against a TEXT ISO column as garbage and silently matches nothing. The
  // count read zero and looked like good news. Format in SQL; the boundary
  // leaves the database as the string it will be compared as.
  // THE FIRST IMPORT, not the org row. An org can be created weeks before
  // anybody loads a file, and using the earlier of the two counted a pile of
  // imported history as thank-yous owed — which is exactly the thing 0.6's
  // start date exists to prevent. The first donor this org created IS the
  // first committed import; the org's own creation is only the fallback for a
  // shop that has not imported yet.
  // The DAY is the org's, not the database session's: TO_CHAR of a
  // timestamptz formats in the session's zone, so on a UTC database a donor
  // created at 9pm in New York started "tomorrow", and that evening's gifts
  // were dropped from the thank-yous owed (found by RECONCILE-1's CI run).
  const tz = await orgTzName(orgId);
  const [row] = await query(
    `SELECT TO_CHAR(COALESCE(
        (SELECT MIN(created_at) FROM donors WHERE org_id = ?),
        (SELECT created_at FROM orgs WHERE id = ?),
        NOW()
      ) AT TIME ZONE ?, 'YYYY-MM-DD') AS d`, [orgId, orgId, tz]);
  return row && row.d ? String(row.d) : null;
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

// The org as the year arithmetic needs it: its timezone and the fiscal start
// month it chose (vocabulary_json), which orgTz alone does not carry.
async function orgForYears(orgId) {
  const [row] = await query("SELECT vocabulary_json FROM orgs WHERE id=?", [orgId]);
  return { ...(await orgTz(orgId)), vocabulary_json: row ? row.vocabulary_json : null };
}

async function orgRow(orgId) { const [o] = await query("SELECT * FROM orgs WHERE id=?", [orgId]); return o || {}; }

// NUMBERS-2 · a total the file stated, with no gifts behind it, is kept as
// its own figure (donorSummary.js KEEP_IMPORTED_TOTAL) under the file's name.
async function keepImportedTotals(q, orgId, ids, sourceName, importId = null) {
  if (!ids || !ids.length) return;
  const words = String(sourceName || "").replace(/\s+/g, " ").trim().slice(0, 80) || "your old system";
  // NUMBERS-4: in batches (donorSummary.js), so a 25,000-person file is linear.
  const DS = require("../../donorSummary");
  await DS.keepImportedTotalsFor(q, orgId, ids, words, orgToday(await orgTz(orgId)), importId);   // ORG_TZ_SEAM_OK
  // FIX-49: and the one statement, so first_gift_date reads the old system's
  // first (or last) gift the moment the file is in, not at the next gift.
  await DS.recomputeSummaries(q, orgId, ids);
}

// ── Gift history bulk import ───────────────────────────────────────────────
// Accepts pre-matched gifts (donorId already resolved by frontend) and inserts
// them transactionally, then recalcs each affected donor's summary. Deduplicates
// by exact (donor_id, amount, date) fingerprint so re-running is safe.
// ── BUILD-80 Part 5/7 — the SEMANTIC rows an import carries besides gifts ──
// One follow-up call after the chunked /donors/import-combined: pledge
// commitments (never in totals — the pledges table), in-kind records (FMV +
// description as an interaction, never a $0 gift), and relationship links
// (soft credits, corporate-match attributions, DAF recommendations — the
// money stays where it legally landed, the PERSON gets the relationship).
// Donor resolution: email first, then a unique name match (both name tokens;
// an ambiguous name never links — same rule as owner matching); a person who
// exists only through links (a soft-credited spouse, a DAF advisor) is
// created with no gift. Idempotent: pledges ride the BUILD-72
// idempotency_key; links and in-kind check for their own row first.
// BUILD-80 Part 9 — the last import's health, one read for every surface.
async function importHealth(orgId) {
  const [o] = await query("SELECT last_import_stats FROM orgs WHERE id=?", [orgId]);
  let st = o?.last_import_stats;
  if (typeof st === "string") { try { st = JSON.parse(st); } catch { st = null; } }
  if (!st || !st.rows) return { stats: null, caveat: null };
  const ratio = st.refused / st.rows;
  const caveat = ratio > 0.05
    ? `computed on ${(st.rows - st.refused).toLocaleString()} of ${st.rows.toLocaleString()} rows; ${st.refused.toLocaleString()} could not be read`
    : null;
  return { stats: st, caveat };
}

// ── BUILD-99 Part 1 — PROPOSALS ────────────────────────────────────────────
// A proposal is one ask to one person or household: purpose, ask amount,
// expected close, stage, a probability SHE set, the fund it lands in, the
// officer who owns it, notes. shared/proposalShape.js holds every rule; these
// routes are its only writers. Nothing here infers a capacity, a probability or
// an amount — see that module's header for why the probability list is closed.
//
// The rows live in `opportunities` (BUILD-15's table, extended — db.js says
// why), so the pipeline board's ask totals, wonThisPeriod and officer activity
// keep reading THE SAME ROWS. One ask, one place.
async function proposalMod() { return import("../../shared/proposalShape.js"); }

// IMPORT-2: the interaction types that are records of money or machinery, not
// of anybody talking to anybody. A person with nothing but these has no
// history yet, which is a different fact from being distant.
const NOT_HISTORY_TYPES = ["gift", "payment", "email_open", "stage_change", "activity", "in_kind", "material"];

// ── Fundraising (BUILD-11) ──────────────────────────────────────────────────
// The Fundraising tab is a home over primitives that already exist: org-level
// goals (fundraising_goals), campaigns that carry a goal (campaigns.goal_amount),
// and giving pages. Nothing here stores a "raised" total — every figure is a
// live SUM over gifts, so a thermometer can never drift from reality. A
// "fundraising campaign" is simply a campaigns row with goal_amount set; the
// email lifecycle (campaigns.status) is untouched — fundraising lifecycle is
// derived from the campaign's dates instead.
//
// computeFundraisingPace: shared pace/thermometer math. Degrades gracefully —
// no goal → no thermometer (percent null); no dates → progress with no
// "days left"/pace; goal met → celebratory state. Never invents a number.
// FUNDRAISING-2: an org can take a gift through its own pages once Stripe
// Connect is linked and Stripe has said it can charge (the webhook keeps
// stripe_connected to Stripe's charges_enabled).
const orgTakesGifts = org => !!(org && org.stripe_connected && org.stripe_account_id);

// The hub's single read. One payload so the landing screen is one request
// rather than five that arrive in a different order every time.
// MAIL-1 Part 3: ONE SENTENCE ABOUT WHETHER HER EMAIL GOES, decided by the
// mail policy (mailPolicy.js), never a raw flag. Before the donor file is in:
// "Email turns on once your donor file is in." Once it sends: the From address.
const mailPolicy = require("../../mailPolicy");
// The day Home's "gifts not yet thanked" counts from (its first import, else
// the fiscal year's start), so the thank-you starter is Home's own count.
reportHooks.thanksSince = async orgId => (await orgStewardStart(orgId)) || (await reportHooks.yearWindows(orgId)).cur.from;

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

// The badge's read of the assessment — minimal, and null unless the donor is
// actually DRIFTING (an excluded/ok/lapsed/not-eligible donor gets no badge
// by construction; the Part 1 exclusion assertions ride on this being the
// only shape any list payload carries).
function driftBadgeField(a) {
  return a && a.state === "drifting"
    ? { state: "drifting", confidence: a.confidence, reason: a.reason }
    : null;
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
    [newId("cfe"), orgId, entity, fieldId || null, entityId || null, event,
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
function membershipLevelPayload(l, counts = null) {
  const priceCents = mbCents(l.price), fmvCents = mbCents(l.fmv);
  return { id: l.id, name: l.name, price: priceCents / 100, fmv: fmvCents / 100, deductible: (priceCents - fmvCents) / 100,
    term: l.term, termLabel: MB ? MB.TERM_LABEL[l.term] : l.term, scope: l.scope,
    picture: l.picture || null,   // FIX-41
    benefits: Array.isArray(l.benefits) ? l.benefits : [], active: l.active !== false,
    // PARITY-2 Part 1: the card's words, whether it is on the public page,
    // where it sorts, and the one frequency it may renew on by itself.
    description: l.description || "", hidden: l.hidden === true, position: Number(l.position) || 0,
    priceSuffix: MB ? MB.TERM_PRICE_SUFFIX[l.term] || "" : "",
    autoRenewFrequency: MB ? MB.autoRenewFrequency(l.term) : null,
    fmvSentence: MB ? MB.fmvSentence({ priceCents, fmvCents }) : null, counts };
}

// The Members screen: every membership, counts by level and status, sortable
// by expiry (soonest first by default — that is the list someone works from).
// ── BUILD-101 Part 3 — LAPSED MEMBERS ARE THEIR OWN LIST ──────────────────
// A lapsed member and a lapsed donor are different people with different
// asks. This list reads ONLY the memberships table (and, to say whether they
// still give, the gifts that were not membership payments). Nothing here is
// read by Drift, LYBUNT or SYBUNT, and nothing those compute is read here —
// the suite proves both directions byte for byte. A person who lapsed as a
// member and still gives is shown as both.
const LAPSED_MEMBER_SQL = figureSources.LAPSED_MEMBER_SQL;   // REPORTS-4: one definition, in figureSources.js

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
return { CF_ENTITIES, DS, GR, LAPSED_MEMBER_SQL, NOT_HISTORY_TYPES, OU, STAGE_WEIGHT, TF, birthdayMod, cfEvent, cfShape, driftBadgeField, eventLevelPayload, figureSources, importHealth, inOrgDays, keepImportedTotals, mailPolicy, markDonorsForGeocoding, membershipLevelPayload, normalizeGiftDate, orgForYears, orgRow, orgStewardStart, orgTakesGifts, portfolioMembership, proposalMod, pruneCampaignAssets, sentenceMoney, staffWho };
}

module.exports = { mount };

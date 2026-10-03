// prospect.js — PROSPECT-1. ROOM TO GIVE: THE FACTS HALF.
//
// Reads the org's own rows for each person and hands them to the pure rule in
// shared/roomToGive.js, which turns them into a word and its reasons. Also the
// screening file both ways (out: the layout providers accept; in: what came
// back, stored as ranges with the provider's name and the date), and the
// public filing for an organisation with an EIN (ProPublica Nonprofit
// Explorer, looked up only when a person presses the button and cached).
//
// WHO SEES ANY OF IT: admins, and staff an admin gave the major gifts
// permission. `canSee` reads the LIVE row on every request, never the JWT.
"use strict";
const { query } = require("./db");
const orgTime = require("./orgTime");

let R = null, IS = null;
const rtg = async () => (R = R || await import("./shared/roomToGive.js"));
const importShape = async () => (IS = IS || await import("./shared/importShape.js"));

const toC = v => Math.round(Number(v || 0) * 100);

// ── WHO MAY SEE IT ──────────────────────────────────────────────────────────
async function canSee(userId) {
  if (!userId) return false;
  const [u] = await query(`SELECT role, can_major_gifts, deactivated_at FROM users WHERE id = ?`, [userId]);
  if (!u || u.deactivated_at) return false;
  return u.role === "admin" || !!u.can_major_gifts;
}
function requireMajorGifts(wrap) {
  return wrap(async (req, res, next) => {
    if (!(await canSee(req.user && req.user.userId))) {
      return res.status(403).json({ error: "major_gifts_only", message: "Room to give and screening results are for admins and staff with the major gifts permission." });
    }
    next();
  });
}

async function today(orgId, q = query) {
  const [o] = await q(`SELECT timezone FROM orgs WHERE id = ?`, [orgId]);
  return orgTime.orgToday({ timezone: o && o.timezone });
}

// ── THE SCREENING ROW, latest per person ────────────────────────────────────
function shapeScreening(r) {
  if (!r) return null;
  const n = v => (v == null ? null : Number(v));
  return { id: r.id, provider: r.provider, screenedOn: r.screened_on,
    capacityLowCents: n(r.capacity_low_cents), capacityHighCents: n(r.capacity_high_cents),
    realEstateLowCents: n(r.real_estate_low_cents), realEstateHighCents: n(r.real_estate_high_cents),
    otherGifts: r.other_gifts || null, foundationTies: r.foundation_ties || null, businessAffiliations: r.business_affiliations || null,
    createdAt: r.created_at };
}
async function latestScreening(orgId, donorIds, q = query) {
  const rows = await q(`SELECT DISTINCT ON (donor_id) * FROM screening_results WHERE org_id = ?
      ${donorIds ? "AND donor_id = ANY(?)" : ""} ORDER BY donor_id, screened_on DESC, created_at DESC`,
    donorIds ? [orgId, donorIds] : [orgId]);
  return new Map(rows.map(r => [r.donor_id, shapeScreening(r)]));
}

// ── THE FACTS, for one person or the whole org at once ─────────────────────
// Each query reads every person asked about in one pass, so the Donors column
// and the Ask why list cost the same handful of queries as one profile.
async function loadFacts(orgId, donorIds = null, q = query) {
  const only = donorIds ? " AND donor_id = ANY(?)" : "";
  const a = donorIds ? [orgId, donorIds] : [orgId];
  const t = await today(orgId, q);
  const [gifts, scores, subs, events, hours, screening] = await Promise.all([
    q(`SELECT donor_id, id, LEFT(date, 10) AS date, amount::text AS amount, fund_id, COALESCE(campaign_id, NULLIF(campaign, '')) AS camp,
             COALESCE(payment_method, '') || ' ' || COALESCE(type, '') AS method, match_employer_id, recurring_subscription_id
             FROM gifts WHERE org_id = ? AND amount > 0 AND date IS NOT NULL${only}`, a),
    q(`SELECT donor_id, engagement, generosity FROM donor_scores WHERE org_id = ?${only}`, a),
    q(`SELECT donor_id, amount::text AS amount, interval FROM recurring_subscriptions
             WHERE org_id = ? AND status IN ('active','past_due','recovering','recovered')${only}`, a),
    q(`SELECT donor_id, COUNT(DISTINCT event_id)::int AS n FROM event_attendees WHERE org_id = ? AND donor_id IS NOT NULL${only} GROUP BY donor_id`, a),
    q(`SELECT person_id AS donor_id, COALESCE(SUM(hours), 0)::text AS h FROM volunteer_shifts WHERE org_id = ?${donorIds ? " AND person_id = ANY(?)" : ""} GROUP BY person_id`, a),
    latestScreening(orgId, donorIds, q),
  ]);
  const facts = new Map();
  const get = id => {
    if (!facts.has(id)) facts.set(id, { today: t, gifts: [], engagement: 0, generosity: 0, monthly: null, events: 0, hours: 0, screening: null });
    return facts.get(id);
  };
  for (const id of donorIds || []) get(id);
  for (const g of gifts) get(g.donor_id).gifts.push({ id: g.id, date: g.date, cents: toC(g.amount), fund: g.fund_id, campaign: g.camp,
    method: g.method, matched: !!g.match_employer_id, recurring: !!g.recurring_subscription_id });
  for (const s of scores) Object.assign(get(s.donor_id), { engagement: s.engagement, generosity: s.generosity });
  for (const s of subs) {
    const per = /year|annual/i.test(s.interval || "") ? Math.round(toC(s.amount) / 12) : toC(s.amount);
    const f = get(s.donor_id);
    f.monthly = { cents: (f.monthly ? f.monthly.cents : 0) + per };
  }
  for (const e of events) get(e.donor_id).events = e.n;
  for (const h of hours) get(h.donor_id).hours = Number(h.h);
  for (const [id, s] of screening) get(id).screening = s;
  return facts;
}

// Every person's word, or only the ones asked about. A person with no facts at
// all is Not yet known, and says so.
async function roomToGive(orgId, donorIds = null, q = query) {
  const RT = await rtg();
  const facts = await loadFacts(orgId, donorIds, q);
  const out = new Map();
  for (const [id, f] of facts) out.set(id, { ...RT.assess(f), screening: f.screening });
  return out;
}

// ── THE SCREENING FILE, OUT ─────────────────────────────────────────────────
// The layout screening providers accept: an id to send back, the name split,
// the mailing address, the email, and the spouse's name where Steward has one.
// Nothing else leaves: no gifts, no notes, no scores.
const FILE_FIELDS = ["Steward ID", "First name", "Last name", "Address", "City", "State", "ZIP", "Email", "Spouse name"];
async function fileRows(orgId, donorIds) {
  if (!donorIds.length) return [];
  return query(`SELECT id, name, address, address2, city, state, zip, email, spouse_name FROM donors
      WHERE org_id = ? AND id = ANY(?) AND deleted_at IS NULL AND erased_at IS NULL
        AND COALESCE(kind, '') NOT IN ('organisation', 'anonymous')
      ORDER BY lower(name), id`, [orgId, donorIds]);
}
function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  if (parts.length < 2) return [parts[0] || "", ""];
  return [parts.slice(0, -1).join(" "), parts[parts.length - 1]];
}
const csvCell = v => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function fileCsv(rows) {
  const lines = [FILE_FIELDS.join(",")];
  for (const r of rows) {
    const [first, last] = splitName(r.name);
    lines.push([r.id, first, last, [r.address, r.address2].filter(Boolean).join(", "), r.city, r.state, r.zip, r.email, r.spouse_name].map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}
function filePreview(rows) {
  const n = rows.length;
  const withAddress = rows.filter(r => r.address && r.zip).length;
  const withEmail = rows.filter(r => r.email).length;
  const withSpouse = rows.filter(r => r.spouse_name).length;
  return { count: n, fields: FILE_FIELDS, withAddress, withEmail, withSpouse,
    sentence: `${n} ${n === 1 ? "person" : "people"} will leave Steward in this file, with only these fields: ${FILE_FIELDS.join(", ")}. No gifts, notes or scores are in it.` };
}

// ── THE SCREENING FILE, BACK ────────────────────────────────────────────────
// The provider's returned file goes through the column mapper: each header is
// mapped to one of these, or ignored. A range may arrive as one column
// ("$25,000 - $50,000") or as a low and a high column.
const RESULT_FIELDS = [
  { key: "steward_id", label: "Steward ID (sent out in the file)", match: /steward.?id|^id$|constituent.?id|record.?id/i },
  { key: "name", label: "Full name", match: /^(full.?)?name$/i },
  { key: "first_name", label: "First name", match: /first/i },
  { key: "last_name", label: "Last name", match: /last|surname/i },
  { key: "email", label: "Email", match: /e-?mail/i },
  { key: "zip", label: "ZIP", match: /zip|postal/i },
  { key: "capacity_range", label: "Capacity range", match: /capacity.*(range)?$|gift.?capacity|wealth.?capacity/i },
  { key: "capacity_low", label: "Capacity, low end", match: /capacity.*(low|min|from)/i },
  { key: "capacity_high", label: "Capacity, high end", match: /capacity.*(high|max|to)/i },
  { key: "real_estate_range", label: "Real estate value range", match: /real.?estate/i },
  { key: "real_estate_low", label: "Real estate, low end", match: /real.?estate.*(low|min)/i },
  { key: "real_estate_high", label: "Real estate, high end", match: /real.?estate.*(high|max)/i },
  { key: "other_gifts", label: "Known gifts to other charities", match: /other.*(gift|giving|charit)|philanthrop|charitable.?gifts/i },
  { key: "foundation_ties", label: "Foundation or donor-advised fund ties", match: /foundation|daf|donor.?advised/i },
  { key: "business_affiliations", label: "Business affiliations", match: /business|affiliation|employer|board/i },
];
const RESULT_KEYS = RESULT_FIELDS.map(f => f.key);

function proposeMapping(headers) {
  const taken = new Set();
  const out = {};
  // Low/high before the range, so "Capacity low" is not claimed as a range.
  const order = ["steward_id", "email", "zip", "first_name", "last_name", "name", "capacity_low", "capacity_high", "capacity_range",
    "real_estate_low", "real_estate_high", "real_estate_range", "other_gifts", "foundation_ties", "business_affiliations"];
  for (const h of headers) out[h] = "ignore";
  for (const key of order) {
    const f = RESULT_FIELDS.find(x => x.key === key);
    const h = headers.find(x => out[x] === "ignore" && f.match.test(String(x).trim()));
    if (h && !taken.has(key)) { out[h] = key; taken.add(key); }
  }
  return out;
}

// "$25,000 - $50,000", "$25K-$50K", "25000 to 50000", "$1M+", "$5,000,000 and up".
function parseMoney(s) {
  const m = String(s || "").replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)\s*(k|m|mm|million|thousand)?\b/i);
  if (!m) return null;
  let n = Number(m[1]);
  const u = (m[2] || "").toLowerCase();
  if (u === "k" || u === "thousand") n *= 1e3;
  if (u === "m" || u === "mm" || u === "million") n *= 1e6;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
function parseRange(s) {
  const t = String(s || "").trim();
  if (!t) return [null, null];
  const bits = t.split(/\s*(?:-|–|to)\s*/i).filter(Boolean);
  if (bits.length >= 2) return [parseMoney(bits[0]), parseMoney(bits[1])];
  const v = parseMoney(t);
  if (v == null) return [null, null];
  if (/\+|and up|or more|plus/i.test(t)) return [v, null];
  return [v, v];
}

async function parseCsv(text) {
  const S = await importShape();
  const recs = S.parseCsvRecords(String(text || "").replace(/^﻿/, "")).filter(r => r.cells.some(c => String(c).trim() !== ""));
  if (!recs.length) return { headers: [], rows: [] };
  const headers = recs[0].cells.map(h => String(h).trim());
  const rows = recs.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, String(r.cells[i] == null ? "" : r.cells[i]).trim()])));
  return { headers, rows };
}

// One returned row, in Steward's words.
function readRow(raw, mapping) {
  const v = {};
  for (const [h, key] of Object.entries(mapping || {})) {
    if (!RESULT_KEYS.includes(key)) continue;
    const x = raw[h];
    if (x != null && String(x).trim() !== "") v[key] = String(x).trim();
  }
  const range = (lowKey, highKey, rangeKey) => {
    let lo = v[lowKey] != null ? parseMoney(v[lowKey]) : null, hi = v[highKey] != null ? parseMoney(v[highKey]) : null;
    if (lo == null && hi == null && v[rangeKey]) [lo, hi] = parseRange(v[rangeKey]);
    if (lo != null && hi != null && lo > hi) [lo, hi] = [hi, lo];
    return [lo, hi];
  };
  const [capLo, capHi] = range("capacity_low", "capacity_high", "capacity_range");
  const [reLo, reHi] = range("real_estate_low", "real_estate_high", "real_estate_range");
  const name = v.name || [v.first_name, v.last_name].filter(Boolean).join(" ");
  return { stewardId: v.steward_id || null, name: name || null, email: v.email ? v.email.toLowerCase() : null, zip: v.zip || null,
    capacityLowCents: capLo, capacityHighCents: capHi, realEstateLowCents: reLo, realEstateHighCents: reHi,
    otherGifts: v.other_gifts || null, foundationTies: v.foundation_ties || null, businessAffiliations: v.business_affiliations || null };
}

// A returned row is matched to ONE person or to nobody. The id Steward sent
// out first; then an email that belongs to exactly one person; then the full
// name with the ZIP, when exactly one person has both. Anything else is listed
// as unmatched with the reason. Steward never guesses between two people.
async function matchRows(orgId, rows) {
  const people = await query(`SELECT id, lower(name) AS name, lower(email) AS email, lower(email2) AS email2, LEFT(COALESCE(zip, ''), 5) AS zip
      FROM donors WHERE org_id = ? AND deleted_at IS NULL AND erased_at IS NULL`, [orgId]);
  const byId = new Map(people.map(p => [p.id, p]));
  const out = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    if (r.stewardId) {
      if (byId.has(r.stewardId)) { out.push({ ...r, line, donorId: r.stewardId, how: "id" }); return; }
    }
    if (r.email) {
      const hit = people.filter(p => p.email === r.email || p.email2 === r.email);
      if (hit.length === 1) { out.push({ ...r, line, donorId: hit[0].id, how: "email" }); return; }
      if (hit.length > 1) { out.push({ ...r, line, donorId: null, why: "That email belongs to more than one person." }); return; }
    }
    if (r.name && r.zip) {
      const hit = people.filter(p => p.name === r.name.toLowerCase() && p.zip && p.zip === String(r.zip).slice(0, 5));
      if (hit.length === 1) { out.push({ ...r, line, donorId: hit[0].id, how: "name and ZIP" }); return; }
      if (hit.length > 1) { out.push({ ...r, line, donorId: null, why: "More than one person has that name and ZIP." }); return; }
    }
    out.push({ ...r, line, donorId: null, why: r.stewardId ? "No person in Steward has that Steward ID." : "No one person in Steward has that ID, email, or name and ZIP." });
  });
  return out;
}

// ── PUBLIC FILINGS (ProPublica Nonprofit Explorer) ──────────────────────────
// GET https://projects.propublica.org/nonprofits/api/v2/organizations/:ein.json
// No key. Called only when a person presses Look up, never on a page render,
// and the answer is cached in public_filings (a second press within a day
// reads the cache). A TEST_MODE server, or PROPUBLICA_FIXTURES, reads saved
// answers instead, so no test reaches the network; production refuses both.
const PP_BASE = "https://projects.propublica.org/nonprofits/api/v2";
const PP_PAGE = ein => `https://projects.propublica.org/nonprofits/organizations/${ein}`;
const cleanEin = e => String(e || "").replace(/\D/g, "");
function parseFiling(ein, json) {
  if (!json || !json.organization) return null;
  const withData = Array.isArray(json.filings_with_data) ? [...json.filings_with_data] : [];
  withData.sort((a, b) => Number(b.tax_prd || 0) - Number(a.tax_prd || 0));
  const f = withData[0] || null;
  const noData = Array.isArray(json.filings_without_data) ? [...json.filings_without_data].sort((a, b) => Number(b.tax_prd || 0) - Number(a.tax_prd || 0))[0] : null;
  const num = v => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
  const form = f ? ({ 0: "990", 1: "990-EZ", 2: "990-PF" }[f.formtype] || null) : (noData && noData.formtype_str) || null;
  return {
    ein, name: json.organization.name || null,
    totalAssetsCents: f ? num(f.totassetsend) : null,
    // Grants paid is a 990-PF line (contributions, gifts, grants paid). A
    // regular 990 has no such line here, so it stays unknown, not zero.
    grantsPaidCents: f && f.formtype === 2 ? num(f.contrpdpbks) : null,
    taxYear: f ? Number(f.tax_prd_yr) || null : noData ? Number(noData.tax_prd_yr) || null : null,
    form,
    filingUrl: (f && f.pdf_url) || (noData && noData.pdf_url) || PP_PAGE(ein),
    sourceUrl: PP_PAGE(ein),
  };
}
async function fetchFiling(ein) {
  const e = cleanEin(ein);
  if (e.length !== 9) return { error: "That EIN is not nine digits." };
  // TEST_MODE servers (the battery, CI, a local walk) always read the saved
  // answers in tests/fixtures/propublica, so no test can reach the network.
  const dir = process.env.PROPUBLICA_FIXTURES || (process.env.TEST_MODE === "1" ? require("path").join(__dirname, "tests", "fixtures", "propublica") : null);
  if (dir) {
    if (process.env.NODE_ENV === "production") throw new Error("PROPUBLICA_FIXTURES is a test setting and is refused in production.");
    const fs = require("fs"), path = require("path");
    const p = path.join(dir, `${e}.json`);
    if (!fs.existsSync(p)) return { notFound: true, ein: e };
    return { filing: parseFiling(e, JSON.parse(fs.readFileSync(p, "utf8"))) };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`${PP_BASE}/organizations/${e}.json`, { signal: ctl.signal, headers: { "User-Agent": "Steward (stewardapp.dev)" } });
    if (r.status === 404) return { notFound: true, ein: e };
    if (!r.ok) return { error: `The public filing service answered ${r.status}. Try again later.` };
    return { filing: parseFiling(e, await r.json()) };
  } catch (err) {
    return { error: "The public filing service could not be reached just now." };
  } finally { clearTimeout(timer); }
}
function shapeFiling(r) {
  if (!r) return null;
  const n = v => (v == null ? null : Number(v));
  return { ein: r.ein, name: r.name, found: r.found, totalAssetsCents: n(r.total_assets_cents), grantsPaidCents: n(r.grants_paid_cents),
    taxYear: r.tax_year, form: r.form, filingUrl: r.filing_url, sourceUrl: r.source_url,
    source: "ProPublica Nonprofit Explorer", fetchedAt: r.fetched_at };
}

module.exports = { canSee, requireMajorGifts, today, loadFacts, roomToGive, latestScreening, shapeScreening,
  FILE_FIELDS, fileRows, fileCsv, filePreview, RESULT_FIELDS, proposeMapping, parseCsv, readRow, matchRows, parseRange, parseMoney,
  fetchFiling, parseFiling, shapeFiling, cleanEin, rtg };

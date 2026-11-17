// server/admin/sales/propublica.js · SALES-4 item 4. FIND NONPROFITS THAT FIT.
//
// ProPublica's Nonprofit Explorer API (public, free, built on the IRS's 990 data) is the only
// source. Nothing else is fetched: no other site, no scraping. Two calls:
//   search        /api/v2/search.json?state[id]=KY&ntee[id]=5&c_code[id]=3[&q=…][&page=n]
//                 25 organizations a page: EIN, name, city, state, NTEE code. No revenue.
//   organization  /api/v2/organizations/<ein>.json
//                 the address and ZIP, and the latest filing's year and total revenue.
// WHAT THE API DOES NOT HAVE: the 990's phone number and its officers. They are in the filing
// itself, which ProPublica does not serve to programs (its XML download sits behind a security
// check), so Steward says so on the screen and offers Find contact and a CSV instead.
//
// A category is an NTEE major group (ProPublica's ntee[id]) plus the code prefixes that count.
// Revenue is the latest filing's total revenue, else the IRS master file's revenue amount.
"use strict";

const BASE = () => process.env.PROPUBLICA_API_BASE || "https://projects.propublica.org/nonprofits/api/v2";
const ORG_PAGE = ein => `https://projects.propublica.org/nonprofits/organizations/${digits(ein)}`;
const TIMEOUT_MS = 12000;
const STATES = ["KY", "OH", "TN"];
// ProPublica's search has no OR and filters NTEE only by major group (its ntee[id], 1 to 10), so a
// category is either keyword searches (each run, the results joined) or a major group read four
// pages at a time and kept by its code prefixes.
const CATEGORIES = [
  { key: "food", label: "Food banks and pantries (K31)", queries: ["food pantry", "pantry", "food bank", "hunger"], prefixes: ["K3"] },
  { key: "equine", label: "Equine and animal-assisted therapy", queries: ["therapeutic riding", "equine", "hippotherapy", "animal assisted"], prefixes: ["D", "E", "P"] },
  { key: "youth", label: "Youth development (O)", group: 5, prefixes: ["O"] },
  { key: "arts", label: "Arts, culture and humanities (A)", group: 1, prefixes: ["A"] },
  { key: "human", label: "Human services (P)", group: 5, prefixes: ["P"] },
];
const PAGES_PER_STEP = 4, MAX_DETAILS = 40;
const DEFAULT_REVENUE = { min: 100000, max: 2000000 };
const SENTENCES = {
  source: "From ProPublica's Nonprofit Explorer (IRS 990 data). Revenue is the latest filing's total revenue, with its tax year.",
  missing: "ProPublica's data has no phone number or officers for these organizations: the 990 lists them, but the filing itself isn't available to programs. Use Find contact on each, or bring a CSV that has them.",
  unreachable: "ProPublica couldn't be reached from Steward's server just now. Search on projects.propublica.org yourself, save the results as a CSV, and bring them in below: the same columns work.",
};

const digits = v => String(v == null ? "" : v).replace(/\D/g, "");
const einOf = v => { const d = digits(v); return d.length >= 8 && d.length <= 9 ? d.padStart(9, "0") : null; };
const norm = s => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|incorporated|corp|corporation|the|co|llc)\b/g, " ").replace(/\s+/g, " ").trim();
const nameKey = (name, city) => `${norm(name)}|${norm(city)}`;

async function getJson(url, fetcher) {
  const f = fetcher || fetch;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await f(url, { headers: { Accept: "application/json", "User-Agent": "Steward sales prospecting" }, signal: ctl.signal });
    if (!r.ok) { const e = new Error(`ProPublica answered ${r.status}`); e.status = r.status; throw e; }
    const ct = String((r.headers && r.headers.get && r.headers.get("content-type")) || "");
    if (ct && !/json/i.test(ct)) throw new Error("ProPublica answered with a page, not data");
    return await r.json();
  } finally { clearTimeout(t); }
}

// One step of a search (keyword categories: page n of each keyword; group categories: four pages),
// with each kept organization's revenue and address, fetched four at a time, at most 40.
async function search({ state = "KY", category = "food", page = 0, q = "" } = {}, { fetcher = null } = {}) {
  const cat = CATEGORIES.find(c => c.key === category) || CATEGORIES[0];
  const st = /^[A-Za-z]{2}$/.test(String(state || "")) ? String(state).toUpperCase() : "KY";
  const step = Math.max(0, Number(page) || 0);
  const extra = String(q || "").trim();
  const calls = cat.queries
    ? cat.queries.map(w => ({ q: [w, extra].filter(Boolean).join(" "), page: step }))
    : Array.from({ length: PAGES_PER_STEP }, (_, i) => ({ q: extra, page: step * PAGES_PER_STEP + i, group: cat.group }));
  let bodies;
  try {
    bodies = await Promise.all(calls.map(c => {
      const qs = new URLSearchParams({ "state[id]": st, "c_code[id]": "3", page: String(c.page) });
      if (c.group) qs.set("ntee[id]", String(c.group));
      if (c.q) qs.set("q", c.q);
      return getJson(`${BASE()}/search.json?${qs}`, fetcher).catch(e => (e.status === 404 ? { organizations: [], num_pages: 0 } : Promise.reject(e)));
    }));
  } catch (e) { return { error: "unreachable", message: SENTENCES.unreachable, detail: String(e.message || e).slice(0, 200) }; }
  const seen = new Set(), kept = [];
  for (const b of bodies) for (const o of b.organizations || []) {
    const row = { ein: einOf(o.ein), name: String(o.name || "").trim(), city: o.city || null, state: o.state || st, ntee: o.ntee_code || o.raw_ntee_code || null };
    if (!row.ein || !row.name || seen.has(row.ein)) continue;
    seen.add(row.ein);
    // A keyword hit counts unless its code says it is something else; a group page keeps its prefixes only.
    const code = String(row.ntee || "").toUpperCase();
    if (cat.queries ? (!code || cat.prefixes.some(p => code.startsWith(p))) : cat.prefixes.some(p => code.startsWith(p))) kept.push(row);
  }
  const out = [];
  const some = kept.slice(0, MAX_DETAILS);
  for (let i = 0; i < some.length; i += 4) {
    out.push(...await Promise.all(some.slice(i, i + 4).map(o => detail(o.ein, { fetcher }).then(d => ({ ...o, ...d })).catch(() => ({ ...o, revenue: null, year: null, detailError: true })))));
  }
  const most = Math.max(0, ...bodies.map(b => Number(b.num_pages || 0)));
  const steps = cat.queries ? most : Math.ceil(most / PAGES_PER_STEP);
  return { ok: true, state: st, category: cat.key, page: step, pages: Math.max(1, steps), looked: seen.size, total: kept.length, rows: out };
}

async function detail(ein, { fetcher = null } = {}) {
  const b = await getJson(`${BASE()}/organizations/${ein}.json`, fetcher);
  const o = b.organization || {};
  const f = (b.filings_with_data || []).slice().sort((x, y) => Number(y.tax_prd_yr || 0) - Number(x.tax_prd_yr || 0))[0] || null;
  const revenue = f && f.totrevenue != null ? Number(f.totrevenue) : o.revenue_amount != null ? Number(o.revenue_amount) : null;
  return { address: o.address || null, zip: o.zipcode || null, revenue: Number.isFinite(revenue) ? revenue : null,
    year: f ? Number(f.tax_prd_yr) || null : (o.tax_period ? Number(String(o.tax_period).slice(0, 4)) : null), ntee: o.ntee_code || undefined,
    phone: null, officers: [], sourceUrl: ORG_PAGE(ein) };
}

// Keep a row when its revenue is known and inside the range (both ends included).
function inRange(row, { min = DEFAULT_REVENUE.min, max = DEFAULT_REVENUE.max } = {}) {
  return row.revenue != null && row.revenue >= Number(min) && row.revenue <= Number(max);
}

// A CSV of ProPublica results (or any list with these columns), read the same way.
const CSV_COLS = { ein: ["ein", "employer identification number", "strein"], name: ["name", "organization", "organization name", "org name"],
  city: ["city"], state: ["state"], revenue: ["revenue", "total revenue", "totrevenue", "revenue amount"], year: ["year", "tax year", "tax_prd_yr", "fiscal year"],
  phone: ["phone", "telephone", "phone number"], address: ["address", "street"], zip: ["zip", "zipcode", "zip code"],
  ed: ["executive director", "ed", "ed name"], dd: ["development director", "dd", "dd name"], ntee: ["ntee", "ntee code", "ntee_code"] };
function fromCsv(text) {
  const rows = require("./importCsv").parseCsv(String(text || ""));
  if (!rows.length) return { error: "invalid", message: "The file has no rows." };
  const head = rows[0].map(h => String(h || "").trim().toLowerCase());
  const col = k => head.findIndex(h => CSV_COLS[k].includes(h));
  const at = Object.fromEntries(Object.keys(CSV_COLS).map(k => [k, col(k)]));
  if (at.name < 0) return { error: "invalid", message: "The file needs a Name column (and ideally EIN, City, State, Revenue, Year)." };
  const money = v => { const n = Number(String(v || "").replace(/[$,\s]/g, "")); return Number.isFinite(n) && String(v || "").trim() ? n : null; };
  const out = rows.slice(1).map(r => {
    const g = k => (at[k] >= 0 ? String(r[at[k]] == null ? "" : r[at[k]]).trim() : "");
    const officers = [g("ed") ? { name: g("ed"), title: "Executive Director", role: "ED" } : null, g("dd") ? { name: g("dd"), title: "Development Director", role: "Development Director" } : null].filter(Boolean);
    const ein = einOf(g("ein"));
    return { ein, name: g("name"), city: g("city") || null, state: g("state").toUpperCase().slice(0, 2) || null, revenue: money(g("revenue")), year: Number(g("year")) || null,
      phone: g("phone") || null, address: g("address") || null, zip: g("zip") || null, ntee: g("ntee") || null, officers, sourceUrl: ein ? ORG_PAGE(ein) : null };
  }).filter(r => r.name);
  return { ok: true, rows: out };
}

// Which of these rows are already sales organizations: by EIN, then by name and city.
async function existing(query, rows) {
  const orgs = await query(`SELECT id, name, city, ein FROM sales_orgs WHERE deleted_at IS NULL`);
  const byEin = new Map(), byName = new Map();
  for (const o of orgs) { const e = einOf(o.ein); if (e) byEin.set(e, o); byName.set(nameKey(o.name, o.city), o); }
  return rows.map(r => {
    const hit = (r.ein && byEin.get(r.ein)) || byName.get(nameKey(r.name, r.city)) || null;
    return hit ? { id: hit.id, name: hit.name, by: r.ein && byEin.get(r.ein) ? "ein" : "name" } : null;
  });
}

module.exports = { STATES, CATEGORIES, DEFAULT_REVENUE, SENTENCES, ORG_PAGE, einOf, norm, nameKey, search, detail, inRange, fromCsv, existing };

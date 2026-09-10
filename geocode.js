// geocode.js — BUILD-84 P0-4. THE ONE PLACE AN ADDRESS BECOMES COORDINATES.
//
// ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
// The Donors → Map tab geocoded IN THE BROWSER, at RENDER time, one address
// per request, 1.2s apart, storing nothing. Navigating away and back started
// over. Refreshing started over. Three separate problems rode on that:
//
//   · It does not work at any real size. 444 donors is nine minutes of crawl;
//     a 25,000-donor org is not reachable at all.
//   · It was pointed at the PUBLIC Nominatim instance, whose usage policy caps
//     bulk geocoding at four requests a minute, requires results be cached on
//     the caller's side, and forbids systematic queries. Rendering a map inside
//     a paid product by hammering it on every page load and caching nothing
//     failed at least three of those.
//   · It sent donor home addresses to a third party on every page view.
//
// ── THE RULE ───────────────────────────────────────────────────────────────
// Geocode ONCE, at WRITE time, server side, in a background job. The map reads
// stored coordinates and makes no network call to any geocoder, ever.
//
// A record whose `geocode_key` still matches its address is never looked up
// again — which is the provider's caching requirement satisfied BY
// CONSTRUCTION rather than by a cache someone has to remember to check.
//
// ── THE PROVIDER SEAM ──────────────────────────────────────────────────────
// Same shape as assetStore.js's storage driver and RESEND_BASE_URL's mail
// seam: one selector, one interface, an explicit "not configured" state that
// the product SAYS OUT LOUD instead of quietly degrading.
//
//   GEOCODE_PROVIDER=geocodio   + GEOCODIO_API_KEY=…       (US/CA, batch)
//   GEOCODE_PROVIDER=nominatim  + GEOCODE_NOMINATIM_BASE=… (SELF-HOSTED ONLY)
//   unset                        → "unconfigured": the job does not run, no
//                                  address leaves the server, and the map says
//                                  so in a sentence.
//
// The public Nominatim instance is REFUSED here by hostname. It is not an
// option for a commercial product at this shape, and leaving the door open
// would mean one env var away from the terms problem this build exists to
// remove.

const PUBLIC_NOMINATIM_HOSTS = new Set([
  "nominatim.openstreetmap.org",
  "nominatim.osm.org",
  "nominatim.openstreetmap.de",
]);

// The identifying User-Agent every request carries — the Nominatim policy
// requires one, and a provider with a support desk deserves to know who is
// calling. Version tracks the product, not this file.
const USER_AGENT = "Steward/1.1 (nonprofit CRM; +https://www.stewardapp.dev; support@stewardapp.dev)";

// ── The address key ────────────────────────────────────────────────────────
// The exact string the coordinates belong to. Two records with the same key
// have the same answer, and a record whose key has not changed is never looked
// up twice. Normalised so a whitespace or case edit is not a new address.
function addressKey(d = {}) {
  const parts = [d.address, d.address2, d.city, d.state, d.zip, d.country]
    .map(v => String(v ?? "").trim())
    .filter(Boolean);
  if (!parts.length) return "";
  // A country alone, or a lone "US" default, is not an address anyone can map.
  const meaningful = [d.address, d.city, d.state, d.zip].some(v => String(v ?? "").trim());
  if (!meaningful) return "";
  return parts.join(", ").toLowerCase().replace(/\s+/g, " ");
}

// The query string sent to the provider — the same fields, un-lowercased.
function addressQuery(d = {}) {
  return [d.address, d.address2, d.city, d.state, d.zip, d.country]
    .map(v => String(v ?? "").trim()).filter(Boolean).join(", ");
}

function providerConfig(env = process.env) {
  const explicit = String(env.GEOCODE_PROVIDER || "").trim().toLowerCase();
  const key = String(env.GEOCODIO_API_KEY || "").trim();
  const nomBase = String(env.GEOCODE_NOMINATIM_BASE || "").trim();
  const want = explicit || (key ? "geocodio" : nomBase ? "nominatim" : "");
  if (want === "geocodio") {
    if (!key) return { name: "unconfigured", reason: "GEOCODE_PROVIDER=geocodio but GEOCODIO_API_KEY is not set" };
    return { name: "geocodio", key, base: String(env.GEOCODIO_API_BASE || "https://api.geocod.io/v1.9").replace(/\/+$/, "") };
  }
  if (want === "nominatim") {
    if (!nomBase) return { name: "unconfigured", reason: "GEOCODE_PROVIDER=nominatim but GEOCODE_NOMINATIM_BASE is not set" };
    let host = "";
    try { host = new URL(nomBase).hostname.toLowerCase(); } catch { return { name: "unconfigured", reason: "GEOCODE_NOMINATIM_BASE is not a URL" }; }
    if (PUBLIC_NOMINATIM_HOSTS.has(host))
      return { name: "unconfigured", reason: `${host} is the PUBLIC Nominatim instance — its usage policy forbids this; point GEOCODE_NOMINATIM_BASE at a self-hosted instance` };
    return { name: "nominatim", base: nomBase.replace(/\/+$/, "") };
  }
  return { name: "unconfigured", reason: "no geocoding provider is configured (set GEOCODIO_API_KEY, or GEOCODE_NOMINATIM_BASE for a self-hosted instance)" };
}

function geocodingConfigured(env = process.env) {
  return providerConfig(env).name !== "unconfigured";
}

// ── Drivers ────────────────────────────────────────────────────────────────
// Each returns, per input, one of:
//   { status: "ok", lat, lng }        a location
//   { status: "not_found" }           the provider looked and found nothing
//   { status: "failed", error }       the LOOKUP failed — retryable, never
//                                     confused with "this address is not real"
// and each reports how many HTTP requests it spent, so the job can log a
// round-trip budget the way the import logs its write trips.

// Geocodio: US and Canada, POST a list, one request per batch of up to 10,000.
// $1.00 per 1,000 lookups with 2,500 free per day (1 Feb 2026), so a
// 25,000-donor first import is a one-time $25 — or free spread over ten days.
const GEOCODIO_BATCH = 1000;
async function geocodeGeocodio(queries, cfg, { fetchImpl = fetch } = {}) {
  const out = new Array(queries.length).fill(null);
  let requests = 0;
  for (let i = 0; i < queries.length; i += GEOCODIO_BATCH) {
    const slice = queries.slice(i, i + GEOCODIO_BATCH);
    requests++;
    let payload;
    try {
      const res = await fetchImpl(`${cfg.base}/geocode?api_key=${encodeURIComponent(cfg.key)}&limit=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
        body: JSON.stringify(slice),
      });
      if (!res.ok) throw new Error(`geocodio ${res.status}`);
      payload = await res.json();
    } catch (e) {
      for (let j = 0; j < slice.length; j++) out[i + j] = { status: "failed", error: e.message };
      continue;
    }
    // Batch responses come back as { results: [ { query, response: { results: [...] } } ] },
    // IN INPUT ORDER — read by index, never by matching the query string back
    // (that is the substring-over-structured-data class this build censused).
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    for (let j = 0; j < slice.length; j++) {
      const hit = rows[j]?.response?.results?.[0];
      const loc = hit?.location;
      out[i + j] = (loc && typeof loc.lat === "number" && typeof loc.lng === "number")
        ? { status: "ok", lat: loc.lat, lng: loc.lng }
        : { status: "not_found" };
    }
  }
  return { results: out, requests };
}

// Self-hosted Nominatim: one query per request. No artificial delay — the
// instance is the operator's own — but still one at a time, in order.
async function geocodeNominatim(queries, cfg, { fetchImpl = fetch } = {}) {
  const out = [];
  let requests = 0;
  for (const q of queries) {
    requests++;
    try {
      const url = `${cfg.base}/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
      const res = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" } });
      if (!res.ok) throw new Error(`nominatim ${res.status}`);
      const data = await res.json();
      const hit = Array.isArray(data) ? data[0] : null;
      const lat = hit ? parseFloat(hit.lat) : NaN, lng = hit ? parseFloat(hit.lon) : NaN;
      out.push(Number.isFinite(lat) && Number.isFinite(lng) ? { status: "ok", lat, lng } : { status: "not_found" });
    } catch (e) {
      out.push({ status: "failed", error: e.message });
    }
  }
  return { results: out, requests };
}

// geocodeAddresses(queries, opts) — the seam every caller uses. Never called
// from a read path.
async function geocodeAddresses(queries = [], opts = {}) {
  const cfg = opts.config || providerConfig(opts.env || process.env);
  if (cfg.name === "unconfigured")
    return { provider: cfg.name, reason: cfg.reason, requests: 0,
             results: queries.map(() => ({ status: "failed", error: "geocoding is not configured" })) };
  const driver = cfg.name === "geocodio" ? geocodeGeocodio : geocodeNominatim;
  const { results, requests } = await driver(queries, cfg, opts);
  return { provider: cfg.name, results, requests };
}

// The statuses a donor row may hold. `pending` is the only non-terminal one.
const GEOCODE_STATUSES = ["pending", "ok", "no_address", "not_found", "failed"];

module.exports = {
  USER_AGENT, PUBLIC_NOMINATIM_HOSTS, GEOCODE_STATUSES, GEOCODIO_BATCH,
  addressKey, addressQuery, providerConfig, geocodingConfigured, geocodeAddresses,
};

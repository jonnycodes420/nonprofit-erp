// DEVBOARD-2 · THE MAP: every part of Steward, its checks and their last results.
//
// ops/map.json holds the areas and their checks. Results come from two places
// and this file is where they meet, as pure functions, so the route, the page
// and the test read one answer:
//   · the walk: board.json's `results` (the last verdict per walk check), put
//     in the area whose `prefixes` hold the check's letters (Prof4 → Profile);
//     a prefix no area holds lands in Unsorted, never nowhere.
//   · Jonathan's marks: rows of ops_checks (append-only). A Fail opens an item;
//     more Fails on that check while it is open join it; a Pass verifies it.
//     The item's state is derived from the rows, never stored.
//
// Open in demo: a link is built only here (demoHref). It goes through the
// sign-in page (/login?next=…) so the person signs in as the demo director,
// it only ever names paths inside the app, and a person is looked up by name
// in the demo org alone (see opsMapRoutes.js). Anything else gives no link.
"use strict";

const fs = require("fs");
const path = require("path");

const MAP_PATH = path.join(__dirname, "..", "..", "ops", "map.json");
// The demo is data, not code (arch-check: no app code names one org). map.json's
// `demo` block names it; demoPeople also requires the orgs row to be a demo org,
// so a map naming a customer's org links to nobody.
const DEMO = (JSON.parse(fs.readFileSync(MAP_PATH, "utf8")).demo) || {};
const DEMO_ORG = DEMO.org || null;                  // = scripts/ci/seed-demo.js ORG (the test checks)
const DEMO_SLUG = DEMO.givingSlug || null;          // its public giving page
const DEMO_DIRECTOR = DEMO.signIn || null;
const NEVER = DEMO.never || [];
const APP_PATHS = [/^\/dashboard(?:[?#]|$)/, /^\/donors(?:[/?#]|$)/, /^\/app\/[a-z0-9-]+(?:[?#]|$)/,
  ...(DEMO_SLUG && /^[a-z0-9-]+$/.test(DEMO_SLUG) ? [new RegExp(`^/give/${DEMO_SLUG}(?:[/?#]|$)`)] : [])];
const RECORD_ID = /^[A-Za-z0-9_-]{1,80}$/;

const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const lettersOf = s => (/^(?:W-\d{4}-)?([A-Za-z]+)/.exec(String(s || "")) || [])[1] || "";

function readMap(file = MAP_PATH) {
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  const problems = validateMap(m);
  if (problems.length) throw new Error(`${path.basename(file)} is not a map: ${problems.slice(0, 3).join("; ")}`);
  return m;
}
function validateMap(m) {
  const out = [];
  if (!m || !Array.isArray(m.areas)) return ["needs areas[]"];
  const ids = new Set(), checks = new Set(), prefixes = new Map();
  for (const a of m.areas) {
    if (!a.id || ids.has(a.id)) out.push(`area id ${a.id || "(none)"} missing or repeated`);
    ids.add(a.id);
    if (!a.name) out.push(`${a.id}: no name`);
    for (const p of a.prefixes || []) {
      if (prefixes.has(norm(p))) out.push(`prefix ${p} is in both ${prefixes.get(norm(p))} and ${a.id}`);
      prefixes.set(norm(p), a.id);
    }
    for (const c of a.checks || []) {
      if (!c.id || checks.has(norm(c.id))) out.push(`check id ${c.id || "(none)"} missing or repeated`);
      checks.add(norm(c.id));
      if (!c.says) out.push(`${c.id}: says nothing`);
      if (c.open && !safePath(c.open)) out.push(`${c.id}: ${c.open} is not a demo path`);
    }
    if (a.open && !safePath(a.open)) out.push(`${a.id}: ${a.open} is not a demo path`);
  }
  return out;
}

// A path inside the app, on the allowed list, naming no org.
function safePath(p) {
  if (typeof p !== "string" || !p.startsWith("/") || p.startsWith("//") || /[\\\s]/.test(p)) return false;
  if (/[?&](org|orgId|org_id|support)=/i.test(p) || /org_[a-z0-9]/i.test(p)) return false;
  return APP_PATHS.some(re => re.test(p));
}
// The link "Open in demo" opens. `personId` must come from the demo org's own
// rows (opsMapRoutes resolves it); a check with a person not found there opens
// the list it lives in, never a guess.
function demoHref(target, personId) {
  let p = target.open || null;
  if (target.person) {
    if (personId && RECORD_ID.test(personId)) p = `/donors/${encodeURIComponent(personId)}${target.tab === "giving" ? "#gifts" : ""}`;
    else p = p || `/donors?q=${encodeURIComponent(target.person)}`;
  }
  if (!p || !safePath(p)) return null;
  if (target.public) return p;                         // the public giving page needs no sign-in
  return `/login?next=${encodeURIComponent(p)}`;
}

// Jonathan's marks → items. rows: [{ id, area_id, check_id, verdict, note, has_shot, created_at, created_by_name }]
function itemsFromChecks(rows) {
  const byCheck = new Map();
  // In the order they were marked: seq (the insert order) when the rows carry it.
  const sorted = [...rows].sort((a, b) => (a.seq != null && b.seq != null ? Number(a.seq) - Number(b.seq) : new Date(a.created_at) - new Date(b.created_at)));
  const items = [];
  for (const r of sorted) {
    const k = norm(r.check_id);
    const open = byCheck.get(k);
    if (r.verdict === "fail") {
      if (open) { open.notes.push(note(r)); continue; }
      const on = isoDay(r.created_at);
      const item = { id: `J-${on.slice(5, 7)}${on.slice(8, 10)}-${r.check_id}`, source: "jonathan", area: r.area_id, check: r.check_id,
        words: r.note, state: "open", opened: on, openedAt: iso(r.created_at), verifiedAt: null, shot: r.has_shot ? r.id : null,
        markId: r.id, notes: [note(r)] };
      let n = 2; while (items.some(i => i.id === item.id)) item.id = `J-${on.slice(5, 7)}${on.slice(8, 10)}-${r.check_id}-${n++}`;
      items.push(item); byCheck.set(k, item);
    } else if (r.verdict === "pass" && open) {
      open.state = "verified"; open.verifiedAt = iso(r.created_at); byCheck.delete(k);
    }
  }
  return items;
}
const iso = t => new Date(t).toISOString();   // created_at, a timestamp (never a stored day)
const isoDay = t => iso(t).slice(0, 10);
const note = r => ({ on: iso(r.created_at), words: r.note, shot: r.has_shot ? r.id : null, by: r.created_by_name || null });

// The last mark per check: { [norm(check)]: { verdict, at } }
function lastMarks(rows) {
  const out = {};
  for (const r of rows) {
    const k = norm(r.check_id), at = iso(r.created_at);
    if (!out[k] || out[k].at <= at) out[k] = { verdict: r.verdict, at };   // rows come in insert order
  }
  return out;
}

// The board's walk items, merged with Jonathan's: a walk item still open shows
// verified when Jonathan passed its check on or after its last walk FAIL.
function mergeBoard(board, rows) {
  const marks = lastMarks(rows);
  const results = board.results || {};
  const items = board.items.map(it => {
    if (!(it.state === "open" || it.state === "reopened") || !it.check) return it;
    const m = marks[norm(it.check)];
    if (!m || m.verdict !== "pass") return it;
    const lastFail = [it.opened, ...(it.history || []).map(h => h.on), results[norm(it.check)] && results[norm(it.check)].verdict === "FAIL" ? results[norm(it.check)].date : null]
      .filter(Boolean).sort().pop() || "";
    return m.at.slice(0, 10) >= lastFail ? { ...it, state: "verified", verifiedBy: "jonathan", verifiedAt: m.at } : it;
  });
  return { ...board, items: [...items, ...itemsFromChecks(rows)] };
}

// The one answer of GET /ops/map.
function buildMap(map, board, rows, personIds = {}) {
  const results = board.results || {};
  const marks = lastMarks(rows);
  const merged = mergeBoard(board, rows).items;
  const areaOfPrefix = new Map();
  for (const a of map.areas) for (const p of a.prefixes || []) areaOfPrefix.set(norm(p), a.id);
  const mapCheckArea = new Map();
  for (const a of map.areas) for (const c of a.checks || []) mapCheckArea.set(norm(c.id), a.id);
  const areaFor = check => mapCheckArea.get(norm(check)) || areaOfPrefix.get(norm(lettersOf(check))) || "unsorted";
  const live = it => it.state === "open" || it.state === "reopened";
  const itemView = it => ({ id: it.id, source: it.source, check: it.check || null, words: it.words, state: it.state, opened: it.opened || null, shot: it.shot || null });

  const openItem = k => { const it = merged.find(i => i.check && norm(i.check) === k && live(i)); return it ? itemView(it) : null; };
  const out = map.areas.map(a => ({ id: a.id, name: a.name, prefixes: a.prefixes || [], open: a.open ? demoHref({ open: a.open }) : null, checks: [], walkChecks: [], items: [] }));
  out.push({ id: "unsorted", name: "Unsorted", prefixes: [], open: null, checks: [], walkChecks: [], items: [],
    says: "Walk checks whose prefix no area holds. Add the prefix to an area in ops/map.json." });
  const byId = new Map(out.map(a => [a.id, a]));

  for (const a of map.areas) for (const c of a.checks || []) {
    const k = norm(c.id), w = results[k];
    byId.get(a.id).checks.push({ id: c.id, says: c.says, person: c.person || null,
      open: c.open || c.person ? demoHref(c, c.person ? personIds[c.person] : null) : null,
      walk: w ? { verdict: w.verdict, date: w.date } : null,
      mark: marks[k] || null, item: openItem(k) });
  }
  // Walk checks the map does not name: their own row in the area their prefix names.
  for (const [k, w] of Object.entries(results)) {
    if (mapCheckArea.has(k)) continue;
    byId.get(areaFor(w.check)).walkChecks.push({ id: w.check, verdict: w.verdict, date: w.date, words: w.words || "", mark: marks[k] || null });
  }
  for (const it of merged) if (live(it)) byId.get(it.area && byId.has(it.area) ? it.area : areaFor(it.check)).items.push(itemView(it));
  for (const a of out) a.walkChecks.sort((x, y) => x.id.localeCompare(y.id, undefined, { numeric: true }));
  return out;   // Unsorted is always there, so a stray prefix is never out of sight
}

module.exports = { MAP_PATH, DEMO_ORG, DEMO_SLUG, DEMO_DIRECTOR, NEVER, readMap, validateMap, safePath, demoHref, itemsFromChecks, lastMarks, mergeBoard, buildMap, norm, lettersOf };

// LEAD-IMPORT-1 · TWO SHAPES, ONE IMPORTER: Muse's single walk report and the
// QA fleet lead's morning summary (lead-YYYY-MM-DD.md).
//
// The lead summary lists the night's fails, one per line, each with an ID
// W-<MMDD>-<Area>-<n> (date, fleet area, check number), sorted into five tiers:
//   1 money or donor-facing wrong · 2 silent state changes · 3 dead ends
//   4 slowness · 5 copy
// and, inside a tier, repeats above new fails. A line can be a list line
//   "1. **W-1107-Donors-12** · REPEAT · The rail reads $0 · evidence: donors/12.png"
// or a table row with a header naming its columns (ID, Tier, Area, Check,
// New/Repeat, What, Evidence). The tier comes from the row's own cell or
// "T1"/"Tier 1" token, else from the heading it sits under ("## Tier 1 · …",
// or a heading that names the tier: "Money or donor-facing wrong").
// A line with an ID and PASS (or under a "Passing again" heading) verifies.
//
// Every line that is not read is reported with why (`unread`), never dropped
// silently. Pure functions: the import script and the /ops upload both use them.
"use strict";

const BOARD = require("./board");
const MAP = require("./opsMap");

const TIERS = { 1: "Money or donor-facing wrong", 2: "Silent state changes", 3: "Dead ends", 4: "Slowness", 5: "Copy" };
const TIER_WORDS = [[1, /money|donor[- ]facing/i], [2, /silent/i], [3, /dead[- ]?end/i], [4, /slow/i], [5, /\bcopy\b|wording/i]];
// The fleet's five areas and the Map area each one opens in (ops/map.json `fleet`).
const FLEET = (() => {
  const m = require("fs").readFileSync(MAP.MAP_PATH, "utf8");
  return (JSON.parse(m).fleet || []).map(f => ({ name: f.name, map: f.map, tokens: (f.tokens || []).map(MAP.norm) }));
})();
const fleetOf = token => FLEET.find(f => f.tokens.includes(MAP.norm(token)) || MAP.norm(f.name) === MAP.norm(token)) || null;

const LEAD_ID = /\bW-(\d{4})-([A-Za-z][A-Za-z-]*?)-(\d+)\b/;
const SEEN_RE = /\b(NEW|REPEAT)(?:ED)?\b/;
const PASS_RE = /\b(PASS|PASSED|PASSING)\b/;
const clean = s => String(s).replace(/[*_`]/g, "").replace(/[✅❌⏭️⚠️✔✗✘☑🔁🆕]/gu, " ").replace(/\s+/g, " ").trim();
const isRule = raw => /^\s*\|?\s*:?-{3,}/.test(raw);
const isHeading = raw => /^\s*#{1,6}\s/.test(raw);
const EVIDENCE_RE = /\b(?:evidence|evid\.?|see|shot|screenshot)\s*(?:ref)?\s*[:→=-]+\s*(.+)$/i;
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/;
const PATHISH_RE = /(\S+\.(?:png|jpe?g|webp|gif|md|txt|json|log|webm|mp4|html)(?:#\S+)?)/i;

// Which shape is this text? A lead summary names tiers and NEW/REPEAT, or is
// called lead-YYYY-MM-DD.md; anything else is read as a walk report.
function shapeOf(text, fileName = "") {
  if (/^lead-\d{4}-\d{2}-\d{2}/i.test(String(fileName).split(/[\\/]/).pop())) return "lead";
  return /\btier\s*[1-5]\b/i.test(text) && SEEN_RE.test(text) && LEAD_ID.test(text) ? "lead" : "walk";
}

function tierOfHeading(raw) {
  const t = clean(raw.replace(/^\s*#+\s*/, ""));
  const n = /\btier\s*([1-5])\b|^\s*T([1-5])\b/i.exec(t);
  if (n) return Number(n[1] || n[2]);
  for (const [k, re] of TIER_WORDS) if (re.test(t)) return k;
  return null;
}
const tierToken = s => { const m = /\b(?:tier\s*|T)([1-5])\b/i.exec(s); return m ? Number(m[1]) : null; };

function evidenceIn(s) {
  const e = EVIDENCE_RE.exec(s);
  if (e) return { ref: clean(e[1]).replace(/[.;,]$/, ""), cut: e.index };
  const l = LINK_RE.exec(s);
  if (l) return { ref: l[1], cut: l.index };
  const p = PATHISH_RE.exec(s);
  if (p) return { ref: p[1], cut: p.index };
  return { ref: null, cut: -1 };
}

// The header row of a table names its columns; a cell is found by its name.
const COLS = { id: /^(id|item|fail)$/i, tier: /^tier$/i, area: /^area$/i, check: /^(check|#|no\.?)$/i,
  seen: /^(new\s*\/\s*repeat|status|seen|new or repeat|repeat)$/i, words: /^(what|description|finding|summary|words|line)$/i, evidence: /^(evidence|ref|evidence ref|link|proof)$/i };
function headerOf(cells) {
  const out = {};
  cells.forEach((c, i) => { for (const [k, re] of Object.entries(COLS)) if (out[k] == null && re.test(clean(c))) out[k] = i; });
  return out.id != null || (out.tier != null && out.words != null) ? out : null;
}

// Parse a lead summary. Returns { date, items, passes, unread }.
//   items:  [{ id, date, check, checkNo, fleetArea, area, tier, seen, words, evidence, rank, line }]
//   passes: [{ id, check, area, line }]
//   unread: [{ line, text, why }]
function parseLead(text, fileName = "") {
  const lines = String(text).split(/\r?\n/);
  const items = [], passes = [], unread = [];
  let tier = null, passing = false, header = null, title = false;
  const miss = (n, raw, why) => unread.push({ line: n, text: clean(raw).slice(0, 240), why });
  lines.forEach((raw, i) => {
    const n = i + 1;
    if (!raw.trim() || isRule(raw)) return;
    if (isHeading(raw)) {
      const t = tierOfHeading(raw);
      if (t) { tier = t; passing = false; }
      else if (/pass|verified|fixed|cleared|now green/i.test(raw)) { passing = true; tier = null; }
      else if (title) { tier = null; passing = false; miss(n, raw, "a heading that names no tier"); }
      title = true;
      return;
    }
    const cells = raw.includes("|") ? raw.split("|").slice(1, -1).map(s => s.trim()) : null;
    const idm = LEAD_ID.exec(raw);
    if (cells && !idm) {
      const h = headerOf(cells);
      if (h) { header = h; return; }
    }
    if (!idm) return miss(n, raw, "no fail ID (W-MMDD-Area-n) on this line");
    const [full, md, areaTok, checkNo] = idm;
    const fleet = fleetOf(areaTok);
    if (!fleet) return miss(n, raw, `"${areaTok}" is not one of the fleet's areas (${FLEET.map(f => f.name).join(", ")})`);
    const check = `${areaTok}-${checkNo}`;
    const cell = k => (cells && header && header[k] != null ? clean(cells[header[k]] || "") : null);
    const line = clean(raw);
    if (passing || (PASS_RE.test(cell("seen") || line) && !/\bFAIL/.test(line))) {
      passes.push({ id: full, check, area: fleet.map, line: n });
      return;
    }
    const t = (cell("tier") && tierToken(cell("tier")) || Number(cell("tier"))) || tierToken(line.replace(full, "")) || tier;
    if (!t || !TIERS[t]) return miss(n, raw, "a fail with no tier (no Tier heading above it and no tier on the line)");
    // In its own cell any case reads; on a line only the capitals do ("a new gift" is prose).
    const seen = cells && header && header.seen != null ? (SEEN_RE.exec(String(cell("seen")).toUpperCase()) || [])[1] || null
      : (SEEN_RE.exec(line) || [])[1] || null;
    let evidence, words;
    if (cells && header) {
      evidence = cell("evidence") || null;
      words = cell("words") || "";
      if (evidence) { const l = LINK_RE.exec(cells[header.evidence]); if (l) evidence = l[1]; }
    } else {
      const ev = evidenceIn(raw);
      evidence = ev.ref;
      let rest = ev.cut >= 0 ? raw.slice(0, ev.cut) : raw;
      rest = clean(rest).replace(/^[-+>\d.)\s]+/, "").replace(full, "").replace(SEEN_RE, "").replace(/\(\s*\)/g, "");
      // The description is what is left once the fields are taken out: a segment
      // that is only an area's name, a tier or a check number is a field, not words.
      const field = seg => !seg || FLEET.some(f => MAP.norm(f.name) === MAP.norm(seg)) || /^(?:tier\s*|T)[1-5]$/i.test(seg) || /^check\s*#?\s*\d+$/i.test(seg);
      words = rest.split(/\s*[·|]\s*|\s+[—–]\s+|^\s*[—–:]\s*/).map(s => s.replace(/^[\s:,-]+|[\s:,(-]+$/g, "").trim()).filter(s => !field(s)).join(" · ");
    }
    if (!seen) return miss(n, raw, "a fail with no NEW or REPEAT");
    items.push({ id: full, mmdd: md, check, checkNo: Number(checkNo), fleetArea: fleet.name, area: fleet.map, tier: Number(t), seen,
      words: words || "", evidence: evidence || null, rank: items.length + 1, line: n });
  });
  return { date: BOARD.walkDate(text, fileName), items, passes, unread };
}

// The lead's order: tier, then repeats above new fails, then the order it wrote them.
const leadOrder = (a, b) => (a.tier || 9) - (b.tier || 9) || (b.seen === "REPEAT") - (a.seen === "REPEAT") || (a.rank || 1e9) - (b.rank || 1e9) || String(a.id).localeCompare(String(b.id));

// Apply a lead summary to the board: each fail is a walk FAIL on its check (so
// a REPEAT finds yesterday's item, and one that was fixed is reopened), each
// pass a walk PASS. The board item also carries the lead's tier, area, NEW or
// REPEAT, evidence and rank. Never touches the board it was handed.
function applyLead(board, lead, { date, file = null }) {
  const verdicts = [...lead.items.map(it => ({ check: it.check, verdict: "FAIL", words: it.words })),
    ...lead.passes.map(p => ({ check: p.check, verdict: "PASS", words: "" }))];
  const { board: next, changes } = BOARD.applyWalk(board, verdicts, { date, file });
  const byCheck = new Map(lead.items.map(it => [MAP.norm(it.check), it]));
  for (const it of next.items) {
    const l = it.source === "walk" && it.check && byCheck.get(MAP.norm(it.check));
    if (!l) continue;
    Object.assign(it, { tier: l.tier, area: l.area, fleetArea: l.fleetArea, seen: l.seen, evidence: l.evidence, rank: l.rank, leadId: l.id, words: l.words || it.words });
  }
  for (const p of lead.passes) { const k = MAP.norm(p.check); const r = next.results && next.results[k]; if (r) r.area = p.area; }
  for (const l of lead.items) { const r = next.results && next.results[MAP.norm(l.check)]; if (r) { r.area = l.area; r.tier = l.tier; } }
  const w = next.walks.find(x => x.date === date);
  if (w) { w.kind = "lead"; w.tiers = Object.fromEntries(Object.keys(TIERS).map(k => [k, lead.items.filter(i => i.tier === Number(k)).length])); }
  return { board: next, changes };
}

// A walk report's lines that parseWalk does not read (so the preview can list them).
function walkUnread(text) {
  const out = [];
  String(text).split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim() || isRule(raw) || isHeading(raw)) return;
    if (BOARD.parseWalk(raw).length) return;
    const cells = raw.includes("|") ? raw.split("|").slice(1, -1).map(clean) : null;
    if (cells && cells.some(c => /^(check|result|finding|verdict)$/i.test(c))) return;   // the table's header row
    out.push({ line: i + 1, text: clean(raw).slice(0, 240), why: "no PASS, FAIL or SKIP with a check id on this line" });
  });
  return out;
}

// One answer for either shape: { shape, date, verdicts?, lead?, unread, apply(board) }.
function readReport(text, fileName = "") {
  const shape = shapeOf(text, fileName);
  if (shape === "lead") {
    const lead = parseLead(text, fileName);
    return { shape, date: lead.date, lead, unread: lead.unread, count: lead.items.length + lead.passes.length,
      apply: (board, date) => applyLead(board, lead, { date: date || lead.date, file: fileName || null }) };
  }
  const verdicts = BOARD.parseWalk(text);
  const date = BOARD.walkDate(text, fileName);
  return { shape, date, verdicts, unread: walkUnread(text), count: verdicts.length,
    apply: (board, d) => BOARD.applyWalk(board, verdicts, { date: d || date, file: fileName || null }) };
}

module.exports = { TIERS, FLEET, fleetOf, shapeOf, parseLead, applyLead, leadOrder, walkUnread, readReport };

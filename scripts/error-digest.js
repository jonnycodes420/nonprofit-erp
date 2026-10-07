#!/usr/bin/env node
// HARDEN-1 item 6 · THE ERROR DIGEST.
//
// Production exceptions already reach Jonathan one at a time (Sentry email).
// This reads a day of production logs and says what kept happening: every error
// line grouped by TYPE (the error class or first line, with ids, numbers, UUIDs
// and emails normalised away) and by ROUTE (method and path, when the line
// carries one), counted, with first and last seen and one example each. It
// writes docs/errors/YYYY-MM-DD.md.
//
// Input: the output of `railway logs --json` (one JSON object per line with
// `timestamp` and `message`), or plain text lines (then nothing has a time).
// Shapes it knows:
//   [500] POST /agent/instructions ...      server.js's final error handler
//   [uncaughtException] ... / [unhandledRejection]: ...
//   [agent] plan failed 400 ...             and any other "[tag] ... failed"
//   Error: ... / TypeError: ... / error: ... (pg)   an error object's first line
//   [tag] message                           any other tagged error line
//   npm error ...                           the npm wrapper (a stop or restart)
// Lines that belong to the error above or below them (stack frames "at ...",
// the "{ code: 'XX000', ... }" property dump, a closing "}") are folded into
// the nearest error printed within half a second, never counted on their own.
// Railway can stamp those lines a few microseconds out of print order, so the
// fold looks both ways.
//
//   node scripts/error-digest.js --in logs.jsonl [--day YYYY-MM-DD] [--out docs/errors]
//   railway logs --json ... | node scripts/error-digest.js --day 2026-10-06
//   node scripts/error-digest.js --self-test     (the parser's checks, on tests/fixtures/error-digest.jsonl)
"use strict";
const fs = require("fs");
const path = require("path");

// ── NORMALISING ─────────────────────────────────────────────────────────────
function normalise(s) {
  return String(s)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[uuid]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b(?:org|d|u|ai|arun|ses|log|g|gift|camp|ev|fund|th|ad|et|grant|rs|sub|pi|ch|cus|in|evt|price|prod|acct|tok|req)_[A-Za-z0-9_-]{3,}\b/g, "[id]")
    .replace(/\b[0-9a-f]{12,}\b/gi, "[hex]")
    .replace(/\b\d+(?:\.\d+)?\b/g, "N")
    .replace(/\s+/g, " ")
    .trim();
}
// A path's ids become :id, so /donors/d_b72_27/contact and /donors/d_9/contact are one route.
function normalisePath(p) {
  return String(p).split("?")[0].split("/").map(seg =>
    !seg ? seg
      : /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) || /\d/.test(seg) && /^[A-Za-z0-9_.:-]+$/.test(seg) && (/_/.test(seg) || /^\d+$/.test(seg) || /^[0-9a-f]{8,}$/i.test(seg)) ? ":id"
      : seg).join("/");
}

// ── CLASSIFYING ONE LINE ────────────────────────────────────────────────────
const CONTINUATION = /^(\s+\S|\s*}\s*,?$|\s*{\s*$|\s*\]\s*,?$|\s*\[\s*$|\s*\.\.\. \d+ more)/;
const ROUTE_LINE = /^\[(5\d\d)\]\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S*)\s*(.*)$/;
const ERROR_CLASS = /^(?:Uncaught )?([A-Z][A-Za-z]*(?:Error|Exception)|error|AbortError|FetchError)(?: \[[A-Z_]+\])?: (.*)$/;
const TAGGED = /^\[([A-Za-z][\w:. -]{0,40})\]:?\s*(.*)$/;
const NPM = /^npm (error|ERR!|warn)\b/;

function classify(message) {
  const m = String(message).replace(/\r/g, "");
  if (!m.trim()) return { cont: true };
  if (CONTINUATION.test(m)) return { cont: true };
  let r;
  if ((r = ROUTE_LINE.exec(m))) return { route: `${r[2]} ${normalisePath(r[3])}`, status: r[1], rest: r[4].trim(), head: "route" };
  if (NPM.test(m)) return { npm: true, text: m.trim() };
  if ((r = /^\[(uncaughtException|unhandledRejection)\]:?\s*(?:[-\u2014]\s*process will exit:?\s*)?(.*)$/.exec(m)))
    return { type: `[${r[1]}] ${normalise(r[2] || "(no message)")}`, head: "process", tag: r[1], rest: r[2] };
  if ((r = ERROR_CLASS.exec(m.trim()))) return { type: `${r[1]}: ${normalise(r[2])}`, head: "error" };
  if ((r = TAGGED.exec(m.trim()))) return { type: `[${r[1]}] ${normalise(r[2])}`, head: "tagged" };
  return { type: normalise(m), head: "other" };
}

// ── READING THE INPUT ───────────────────────────────────────────────────────
function readEntries(text) {
  const out = [];
  let i = 0;
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let ts = null, msg = line;
    if (line.trim().startsWith("{")) {
      try {
        const j = JSON.parse(line);
        msg = j.message != null ? String(j.message) : "";
        ts = j.timestamp || j.time || null;
      } catch { /* a plain line that happens to start with a brace */ }
    }
    out.push({ ts, t: ts ? Date.parse(ts) : null, msg, seq: i++ });
  }
  // The same line fetched twice (two deployments' windows overlap) counts once.
  const seen = new Set();
  for (let k = out.length - 1; k >= 0; k--) {
    if (!out[k].ts) continue;
    const key = out[k].ts + "\u0000" + out[k].msg;
    if (seen.has(key)) out.splice(k, 1); else seen.add(key);
  }
  // Order by time, then by input order; nanosecond strings sort as text.
  out.sort((a, b) => (a.ts && b.ts ? (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.seq - b.seq) : a.seq - b.seq));
  return out;
}

// ── THE PARSER (pure) ───────────────────────────────────────────────────────
// lines -> events: [{ type, route, ts, example, frames }]
const NEAR_MS = 500;
function parseEvents(text, { day = null } = {}) {
  let entries = readEntries(text);
  if (day) entries = entries.filter(e => !e.ts || String(e.ts).slice(0, 10) === day);
  const events = [];
  let pending = [];          // continuation lines seen before their head
  let npmBurst = null;
  const near = (a, b) => a.t == null || b.t == null || Math.abs(a.t - b.t) <= NEAR_MS;
  const last = () => events[events.length - 1];
  for (const e of entries) {
    const c = classify(e.msg);
    if (c.cont) {
      const ev = last();
      if (ev && near(ev, e) && ev.head !== "npm") ev.lines.push(e.msg);
      else pending.push(e);
      continue;
    }
    if (c.npm) {
      // The npm wrapper prints several lines for one stop; they are one event.
      if (npmBurst && near(npmBurst, e)) { npmBurst.lines.push(e.msg); if (/signal|code|ERR!/.test(c.text)) npmBurst.detail.push(c.text); continue; }
      if (/^npm warn/.test(c.text)) continue;   // a config warning, not an error
      npmBurst = { head: "npm", type: null, route: null, ts: e.ts, t: e.t, lines: [e.msg], detail: [c.text], example: e.msg };
      events.push(npmBurst);
      continue;
    }
    npmBurst = null;
    const ev = last();
    // "[500] POST /x" with nothing after it takes its type from the error the
    // handler prints next.
    if (ev && ev.head === "route" && !ev.type && (c.head === "error" || c.head === "other" || c.head === "tagged") && near(ev, e)) {
      ev.type = c.type; ev.lines.push(e.msg); ev.example = ev.example + " " + e.msg.trim();
      continue;
    }
    // A process-level line ("[unhandledRejection]: error: ...") already says its type.
    const nev = { head: c.head, type: c.type || null, route: c.route || null, ts: e.ts, t: e.t, lines: [e.msg], example: e.msg.trim() };
    if (c.head === "route" && c.rest) nev.type = (classify(c.rest).type) || normalise(c.rest);
    // Frames printed BEFORE this line, within half a second, are its own.
    nev.lines.unshift(...pending.filter(p => near(p, e)).map(p => p.msg));
    pending = [];
    events.push(nev);
  }
  for (const ev of events) {
    if (ev.head === "npm") {
      const sig = ev.detail.find(d => /signal/.test(d));
      const cmd = ev.detail.find(d => /command sh -c/.test(d));
      ev.type = `npm: the server process stopped${sig ? ` (${sig.replace(/^npm (error|ERR!) /, "")})` : ""}${cmd ? `, ${cmd.replace(/^npm (error|ERR!) command /, "")}` : ""}`;
    }
    if (!ev.type) ev.type = ev.route ? "(an error with no message)" : normalise(ev.example);
    // Where it happened, when no route says: the first app frame in its stack.
    const frame = ev.lines.map(l => /\bat (?:async )?([\w.<>$]+) \(\/app\/(?!node_modules|db\.js)([^:)]+)/.exec(l)).find(Boolean);
    ev.where = frame ? `${frame[1]} (${frame[2]})` : null;
  }
  return events;
}

// events -> groups by type and by route, newest and most frequent first.
function digest(events) {
  const byType = new Map(), byRoute = new Map();
  for (const ev of events) {
    const k = ev.type + "\u0000" + (ev.route || "");
    const g = byType.get(k) || { type: ev.type, route: ev.route, where: ev.where, count: 0, first: ev.ts, last: ev.ts, example: ev.example };
    g.count++;
    if (ev.ts && (!g.first || ev.ts < g.first)) g.first = ev.ts;
    if (ev.ts && (!g.last || ev.ts > g.last)) { g.last = ev.ts; }
    if (!g.where && ev.where) g.where = ev.where;
    byType.set(k, g);
    if (ev.route) {
      const r = byRoute.get(ev.route) || { route: ev.route, count: 0, types: new Set(), first: ev.ts, last: ev.ts };
      r.count++; r.types.add(ev.type);
      if (ev.ts && (!r.first || ev.ts < r.first)) r.first = ev.ts;
      if (ev.ts && (!r.last || ev.ts > r.last)) r.last = ev.ts;
      byRoute.set(ev.route, r);
    }
  }
  const order = (a, b) => b.count - a.count || String(b.last || "").localeCompare(String(a.last || ""));
  return {
    total: events.length,
    types: [...byType.values()].sort(order),
    routes: [...byRoute.values()].map(r => ({ ...r, types: [...r.types] })).sort(order),
  };
}

// ── THE PAGE ────────────────────────────────────────────────────────────────
const cell = s => String(s == null ? "" : s).replace(/\|/g, "/").replace(/\u2014/g, "-").replace(/\s+/g, " ").trim();
const clip = (s, n) => { const t = cell(s); return t.length > n ? t.slice(0, n - 3) + "..." : t; };
const hm = ts => (ts ? String(ts).slice(11, 19) : "");
function render(day, d, { source = "railway logs" } = {}) {
  const lines = [`# Production errors, ${day}`, ""];
  if (!d.total) {
    lines.push(`No error lines in the production logs for ${day} (read from ${source}).`, "");
    return lines.join("\n");
  }
  const routed = d.routes.reduce((s, r) => s + r.count, 0);
  lines.push(
    `${d.total} error${d.total === 1 ? "" : "s"} in ${d.types.length} kind${d.types.length === 1 ? "" : "s"}; ${routed} of them came from a request with a route. ` +
    `Times are UTC. Read from ${source}; ids, numbers and UUIDs are folded together, so one kind can cover many records.`, "",
    "## By type", "",
    "| Count | Type | Route or place | First | Last | Example |",
    "|---:|---|---|---|---|---|",
    ...d.types.map(g => `| ${g.count} | ${clip(g.type, 120)} | ${cell(g.route || g.where || "")} | ${hm(g.first)} | ${hm(g.last)} | ${clip(g.example, 160)} |`),
    "");
  if (d.routes.length) {
    lines.push("## By route", "",
      "| Count | Route | Types | First | Last |",
      "|---:|---|---|---|---|",
      ...d.routes.map(r => `| ${r.count} | ${cell(r.route)} | ${clip(r.types.join("; "), 160)} | ${hm(r.first)} | ${hm(r.last)} |`),
      "");
  }
  return lines.join("\n");
}

// ── SELF-TEST ───────────────────────────────────────────────────────────────
function selfTest() {
  const fixture = path.join(__dirname, "..", "tests", "fixtures", "error-digest.jsonl");
  const ev = parseEvents(fs.readFileSync(fixture, "utf8"), { day: "2026-10-06" });
  const d = digest(ev);
  const fails = [];
  const ok = (name, cond, got) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  (got " + JSON.stringify(got) + ")"}`); if (!cond) fails.push(name); };
  const t = re => d.types.find(g => re.test(g.type));
  const r = route => d.routes.find(x => x.route === route);
  // The [500] shape: two different donors on one route are one route and one type.
  ok("[500] lines group by route with ids folded to :id", r("PATCH /donors/:id/contact") && r("PATCH /donors/:id/contact").count === 2, d.routes);
  ok("a bare [500] line takes its type from the error printed after it", t(/^TypeError: Cannot read properties of undefined/) && t(/^TypeError/).route === "PATCH /donors/:id/contact", d.types.map(x => x.type));
  ok("[500] with the message on the same line keeps it", r("POST /agent/instructions") && r("POST /agent/instructions").types.some(x => /^Error: model call timed out after N ms/.test(x)), d.routes);
  ok("[uncaughtException] is its own type", t(/^\[uncaughtException\] RangeError: Invalid time value/) && t(/^\[uncaughtException\]/).count === 1, d.types.map(x => x.type));
  ok("[unhandledRejection] is its own type", !!t(/^\[unhandledRejection\]/), d.types.map(x => x.type));
  ok("[agent] ... failed lines group with their numbers folded", t(/^\[agent\] plan failed N/) && t(/^\[agent\] plan failed N/).count === 2, d.types.map(x => x.type));
  ok("org ids fold: eleven [scores] lines are one type", t(/^\[scores\] \[id\]: column "pattern"/) && t(/^\[scores\]/).count === 3, d.types.map(x => x.type + " x" + x.count));
  ok("a pg error's frames and property dump fold into ONE event, even printed out of order", t(/^error: \(EMAXCONNSESSION\)/) && t(/^error: \(EMAXCONNSESSION\)/).count === 2, d.types.map(x => x.type + " x" + x.count));
  ok("its place comes from the first app frame", t(/^error: \(EMAXCONNSESSION\)/) && /reconcileStripeVsGifts|syncAllGmail/.test(t(/^error: \(EMAXCONNSESSION\)/).where), t(/EMAX/));
  ok("no stack frame or property line is counted as an error", !d.types.some(x => /^at |^N?\s*(code|length|severity|detail):/.test(x.type) || x.type === "}"), d.types.map(x => x.type));
  ok("the npm wrapper's five lines are one stop, and its config warning is not an error", t(/^npm: the server process stopped \(signal SIGTERM\)/) && t(/^npm:/).count === 1 && !t(/omit=dev/), d.types.map(x => x.type));
  ok("lines from another day are left out", !d.types.some(x => /yesterday-only/.test(x.type)), d.types.map(x => x.type));
  ok("most frequent first", d.types[0].count >= d.types[d.types.length - 1].count, d.types.map(x => x.count));
  const page = render("2026-10-06", d);
  ok("the page has no em dash", !/\u2014/.test(page), null);
  ok("the page has both tables", /## By type/.test(page) && /## By route/.test(page), null);
  ok("an empty day says so in a sentence", /^No error lines/m.test(render("2026-10-06", digest([]))), null);
  console.log(fails.length ? `\n${fails.length} check(s) failed.` : "\nAll error-digest checks passed.");
  return fails.length ? 1 : 0;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function arg(name) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; }
if (require.main === module) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const inFile = arg("--in");
  const text = inFile ? fs.readFileSync(inFile, "utf8") : fs.readFileSync(0, "utf8");
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const day = arg("--day") || yesterday;
  const outDir = arg("--out") || path.join(__dirname, "..", "docs", "errors");
  const d = digest(parseEvents(text, { day }));
  const page = render(day, d, { source: arg("--source") || "railway logs, production service nonprofit-erp" });
  if (process.argv.includes("--print")) { process.stdout.write(page); process.exit(0); }
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${day}.md`);
  fs.writeFileSync(file, page);
  console.log(`${d.total} errors in ${d.types.length} kinds for ${day} -> ${path.relative(process.cwd(), file)}`);
}

module.exports = { parseEvents, digest, render, normalise, normalisePath, classify };

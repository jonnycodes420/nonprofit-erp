// tests/polish2/isoDates.js — POLISH-2 Part 4. NO ISO DATE IN A SENTENCE.
//
// A person reads "Oct 8, 2026" (shared/displayDate.js), never "2026-10-08".
// Inputs, CSV, exports, API payloads, SQL, keys and file names keep ISO; this
// scan only looks at text a person reads. It is a SOURCE scan, so it names
// the line to fix rather than the screen it happened to show up on.
//
// The rule, kept narrow so every hit is a real defect:
//   1. A template literal (client/src, routes, shared, server.js) that reads
//      as words, with a word and a space right before an interpolation that
//      cuts a date to its ISO day: `${String(x).slice(0, 10)}` or
//      `${x.toISOString().slice(0, 10)}`. Literals that read as SQL, URLs,
//      keys or file names are skipped (`/`, `=`, `::`, INTERVAL, .csv, ...).
//   2. A JSX child in client/src that drops a raw date column straight into
//      visible text: `since {row.started_at}`, `{g.gift_date}` beside words.
//      An attribute value (`={...}`) or a formatter's argument is not text.
//   3. Half an ISO date in a screen: `String(t.nextStep.due).slice(5)` reads
//      "10-14", which is the same defect with the year cut off.
//
// ISO_IN_TEXT is for the browser leg: no rendered ISO day on Home, Journeys,
// Imports or Ask.
const fs = require("fs");
const path = require("path");

const ISO_IN_TEXT = /\b\d{4}-\d{2}-\d{2}\b/;

const CUT = /\$\{[^`{}]*?(?:\.slice\(\s*0\s*,\s*10\s*\)|\.toISOString\(\))\s*\}/;
const WORD_BEFORE = /[A-Za-z]{2,}[,:]?\s\$\{[^`{}]*?(?:\.slice\(\s*0\s*,\s*10\s*\)|toISOString\(\))/;
const NOT_PROSE = /(console\.|Error\(|\$filter|\/|=|::|INTERVAL|\.csv|\.json|\.pdf|\.xlsx|\bSELECT\b|\bWHERE\b|\bFROM\b|https?:|<\w)/;
const RAW_DATE = /(^|[^=\w$])\{\s*([\w$]+(?:\??\.[\w$]+)*\??\.(?:\w+_at|\w+_on|\w+_date|date|createdAt|updatedAt|startedAt|appliedOn))\s*\}/;

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|jsx|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

function scanIsoDates(rootDir) {
  const files = [
    ...walk(path.join(rootDir, "client", "src"), []),
    ...walk(path.join(rootDir, "routes"), []),
    ...walk(path.join(rootDir, "shared"), []),
    path.join(rootDir, "server.js"),
  ].filter(f => fs.existsSync(f));
  const hits = [];
  for (const file of files) {
    const rel = path.relative(rootDir, file);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      // Rule 1: a sentence that prints a cut-to-ISO day.
      // A log line, an error message or a provider query is not read by a person.
      const logLine = /console\.|Error\(|\$filter|^\+?\s*`?\[/.test(t) || (i > 0 && /console\.\w+\(/.test(lines[i - 1]) && !/;\s*$/.test(lines[i - 1]));
      for (const lit of logLine ? [] : line.match(/`[^`]*`/g) || []) {
        if (!CUT.test(lit) || !WORD_BEFORE.test(lit)) continue;
        const text = lit.replace(/\$\{[^}]*\}/g, " ");
        if (NOT_PROSE.test(text)) continue;
        if (!/[a-z]{2,}\s+[a-z]{2,}/i.test(text)) continue;
        hits.push({ file: rel, line: i + 1, text: t.slice(0, 160) });
      }
      // Rule 3: half an ISO date ("10-14") cut off a date in a screen.
      if (/\.jsx$/.test(file) && /(?:due|[dD]ate|_on)\b[^;]{0,40}?\)\.slice\(5\)/.test(line)) {
        hits.push({ file: rel, line: i + 1, text: t.slice(0, 160) });
        return;
      }
      // Rule 2: a raw date column as a JSX child beside words.
      if (/\.jsx$/.test(file)) {
        const m = RAW_DATE.exec(line);
        if (!m) return;
        const before = line.slice(0, m.index + m[1].length);
        const rest = line.replace(m[0], " ").replace(/\{[^}]*\}/g, " ").replace(/<[^>]*>/g, " ");
        if (/=\s*$/.test(before)) return;
        if (/\(\s*$/.test(before)) return;
        if (!/[A-Za-z]{3,}\s/.test(rest)) return;
        hits.push({ file: rel, line: i + 1, text: t.slice(0, 160) });
      }
    });
  }
  return hits;
}

module.exports = { scanIsoDates, ISO_IN_TEXT };

if (require.main === module) {
  const hits = scanIsoDates(path.resolve(__dirname, "..", ".."));
  for (const h of hits) console.log(`${h.file}:${h.line}  ${h.text}`);
  console.log(`${hits.length} ISO date(s) in text`);
}

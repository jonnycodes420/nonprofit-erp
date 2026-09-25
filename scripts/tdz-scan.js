#!/usr/bin/env node
// scripts/tdz-scan.js — BUILD-96 Part 6. THE TDZ CLASS, FOUND BY GREP.
//
// This defect has cost four builds (BUILD-84 `stageBasis`, BUILD-89 `onPanel`,
// BUILD-95, BUILD-96 `const INK = INK;`) and it is invisible to everything
// cheap: `const`/`let`/`class` hoist WITHOUT initialising, so reading one early
// throws ReferenceError at RUNTIME. node --check passes. Unit tests pass.
// eslint's default config passes. The failure surfaces as a whole screen
// replaced by its error boundary, or — worse — as a plausible domain message
// when a catch around the render swallows it.
//
// So this is a text scan, deliberately. It is not a parser and does not try to
// be: it reports candidates and says which shape each one is, and the standing
// rule in CLAUDE.md says how to triage them.
//
// TWO SHAPES:
//   SELF-REFERENCE   `const INK = INK;` — the read is on the SAME line as the
//                    declaration, so no line-number comparison can see it.
//                    ALWAYS a bug. This is the one BUILD-96 wrote.
//   READS-ABOVE      a line above the declaration mentions the name. A bug when
//                    that line runs at module/component evaluation time; legal
//                    when it is inside a function body called later.
//
// Exit 1 if any SELF-REFERENCE is found (those need no judgement); READS-ABOVE
// is reported and does not fail, because triaging it needs a human.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DECL = /^\s*(?:export\s+)?(?:const|let|class)\s+([A-Za-z_$][\w$]*)/;
const COMMENT = /^\s*(?:\/\/|\*|\/\*)/;
const esc = n => n.replace(/\$/g, "\\$");

// ── A NAME IS ONLY A READ IF IT IS NOT A PROPERTY AND NOT A KEY ─────────────
// The second version of this scanner still reported 241 "self-references", and
// every one sampled was a PROPERTY ACCESS sharing a spelling with the binding:
//
//     const blob = await r.blob();          // `.blob` is r's method
//     const mode = seg?.mode || "all";      // `.mode` is seg's field
//     const max  = Math.max(...);           // `.max` is Math's
//
// and the reads-above noise was mostly OBJECT KEYS (`due: addCivilDays(...)`
// "reading" a `due` declared 100 lines later). Neither is the binding.
//
// So a read must be an identifier that is NOT preceded by `.` (or `?.`) and NOT
// immediately followed by `:`. That is what distinguishes the binding from a
// property with the same name, and it is the difference between a scanner
// somebody runs and one they stop running.
const readRe = name =>
  new RegExp("(?<![.\\w$?])" + esc(name) + "\\b(?!\\s*:)");

// ── WHY THIS STRIPS BEFORE IT MATCHES ──────────────────────────────────────
// The first version of this scanner reported 309 self-references and 676
// reads-above across 105 files, and essentially all of them were noise. The
// worst example is exact and worth keeping:
//
//     const s = String(v).replace(/\s+/g, " ").trim();
//
// A bare word-boundary search for `s` on that right-hand side matches the `s`
// inside the REGEX ESCAPE `\s+`, so the scanner called a correct line a bug. A
// scanner that cries wolf 985 times is worse than no scanner: nobody runs it
// twice, and the rule it was written to enforce dies with it.
//
// So every line is reduced to its CODE before any name is looked for: comments,
// string literals, template literals and regex literals become blanks of the
// same length, which preserves column numbers while removing everything that
// only looks like an identifier.
function stripNonCode(line) {
  let out = "", i = 0, n = line.length;
  while (i < n) {
    const c = line[i], d = line[i + 1];
    if (c === "/" && d === "/") { out += " ".repeat(n - i); break; }
    if (c === "/" && d === "*") {                                  // single-line /* */
      const end = line.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out += " ".repeat(stop - i); i = stop; continue;
    }
    if (c === '"' || c === "'" || c === "`") {                      // string/template
      let j = i + 1;
      while (j < n && line[j] !== c) { if (line[j] === "\\") j++; j++; }
      const stop = Math.min(j + 1, n);
      out += " ".repeat(stop - i); i = stop; continue;
    }
    // A regex literal, distinguished from division by what precedes it.
    if (c === "/") {
      const prev = out.replace(/\s+$/, "").slice(-1);
      const canBeRegex = prev === "" || "=(,:[!&|?{};+*%<>~^".includes(prev);
      if (canBeRegex) {
        let j = i + 1, inClass = false, closed = false;
        while (j < n) {
          if (line[j] === "\\") { j += 2; continue; }
          if (line[j] === "[") inClass = true;
          else if (line[j] === "]") inClass = false;
          else if (line[j] === "/" && !inClass) { closed = true; break; }
          j++;
        }
        if (closed) {
          let stop = j + 1;
          while (stop < n && /[gimsuyd]/.test(line[stop])) stop++;
          out += " ".repeat(stop - i); i = stop; continue;
        }
      }
    }
    out += c; i++;
  }
  return out.length >= n ? out.slice(0, n) : out + " ".repeat(n - out.length);
}

// Names this short are overwhelmingly arrow/loop parameters — a DIFFERENT
// binding that merely shares a spelling with something declared later in the
// file, which is not a TDZ hazard at all. Excluded from READS-ABOVE (where the
// evidence is only "the spelling appears earlier"), but NOT from
// SELF-REFERENCE, where the declaration and the read are provably the same
// binding on the same line.
const TOO_SHORT_FOR_READS_ABOVE = 3;

// ── ONLY THIS DECLARATOR'S INITIALISER ─────────────────────────────────────
// The third version still reported 37 "self-references", and every one sampled
// was a MULTI-STATEMENT LINE where the read is in a LATER statement:
//
//     const i = l.findIndex(r => r.id === id), j = i + delta;
//     const in90 = new Date(today); in90.setDate(in90.getDate() + 90);
//
// By the time `j = i + delta` or `in90.setDate(...)` runs, the binding is
// initialised. That is not a TDZ hazard; it is ordinary code that happens to
// share a line. So the initialiser is cut at the first `;` or `,` that sits at
// bracket depth zero — the end of THIS declarator — and nothing after it counts.
function initialiserOnly(rhs) {
  let depth = 0;
  for (let i = 0; i < rhs.length; i++) {
    const c = rhs[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0 && (c === ";" || c === ",")) return rhs.slice(0, i);
  }
  return rhs;
}

// A line that declares this name as a parameter or its own binding is not a
// read of the later one.
const declaresItself = (code, name) =>
  new RegExp("(?:const|let|var|class|function)\\s+" + esc(name) + "\\b").test(code) ||
  new RegExp("(?:\\(|,|^)\\s*" + esc(name) + "\\s*(?:,|\\)|=>)").test(code);

function scan(file) {
  const src = fs.readFileSync(file, "utf8").split("\n");
  const rel = path.relative(ROOT, file);
  const hits = [];

  const code = src.map(stripNonCode);

  // Shape 1 — self-reference, on the declaration line itself.
  code.forEach((line, i) => {
    const m = DECL.exec(line);
    if (!m) return;
    const name = m[1];
    const after = line.slice(line.indexOf(name) + name.length);
    const eq = after.indexOf("=");
    if (eq < 0) return;                                   // no initialiser
    // Destructuring renames and `=>` are not assignment.
    if (after[eq + 1] === ">" || after[eq - 1] === "=") return;
    const init = initialiserOnly(after.slice(eq + 1));
    // SHADOWING IS LEGAL, even when it is confusing:
    //
    //     const g = (raw.gifts || []).map(g => ({ id: g.id, ... }));
    //
    // the inner `g` is the arrow's own parameter and has nothing to do with the
    // binding being declared. This was the last false positive in the client,
    // and excluding it is what took the self-reference count to one real shape.
    const shadowed = new RegExp("(?:\\(|,|^)\\s*" + esc(name) + "\\s*(?:,|\\)\\s*=>|=>)").test(init);
    if (!shadowed && readRe(name).test(init)) {
      hits.push({ kind: "SELF-REFERENCE", rel, line: i + 1, name, text: src[i].trim() });
    }
  });

  // Shape 2 — read above the declaration.
  const decl = new Map();
  code.forEach((line, i) => {
    const m = DECL.exec(line);
    if (m && !decl.has(m[1])) decl.set(m[1], i);
  });
  for (const [name, line] of decl) {
    if (name.length < TOO_SHORT_FOR_READS_ABOVE) continue;
    const re = readRe(name);
    for (let i = 0; i < line; i++) {
      if (COMMENT.test(src[i])) continue;
      if (!re.test(code[i])) continue;
      if (declaresItself(code[i], name)) continue;
      hits.push({ kind: "READS-ABOVE", rel, line: i + 1, name, declaredAt: line + 1,
                  text: src[i].trim().slice(0, 100) });
      break;
    }
  }
  return hits;
}

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|dist|\.git/.test(e.name)) walk(p, out); }
    else if (/\.(jsx?|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
};

// READS-ABOVE is behind a flag, and that is a judgement about usefulness.
//
// After four rounds of precision work SELF-REFERENCE reports ZERO false
// positives on this codebase and catches the exact shape BUILD-96 wrote.
// READS-ABOVE still reports ~209 candidates, and the large majority are
// function parameters or locals that merely share a spelling with a binding
// declared later in the file — legal, and not a hazard. It cannot be made exact
// without a real scope analysis (a parser, not a scan).
//
// Leaving 209 lines of mostly-noise in the default output is how a scanner
// stops being run at all, so the default is the signal that needs no judgement.
// `--all` adds the candidates when somebody is specifically hunting a
// blank-screen bug, which is the only time they are worth reading.
const ALL = process.argv.includes("--all");
const args = process.argv.slice(2).filter(a => a !== "--all");
let files = [];
if (!args.length) {
  for (const d of ["client/src", "shared"]) {
    const full = path.join(ROOT, d);
    if (fs.existsSync(full)) walk(full, files);
  }
} else {
  for (const a of args) {
    const full = path.isAbsolute(a) ? a : path.join(process.cwd(), a);
    if (fs.statSync(full).isDirectory()) walk(full, files);
    else files.push(full);
  }
}

let selfRefs = 0, readsAbove = 0;
for (const f of files) {
  for (const h of scan(f)) {
    if (h.kind === "SELF-REFERENCE") {
      selfRefs++;
      console.log(`SELF-REFERENCE  ${h.rel}:${h.line}  ${h.name}  —  ${h.text}`);
    } else {
      readsAbove++;
      if (ALL) console.log(`reads-above     ${h.rel}:${h.line}  reads ${h.name}, declared at :${h.declaredAt}  —  ${h.text}`);
    }
  }
}

console.log(`\n${files.length} file(s) · ${selfRefs} self-reference(s) · ${readsAbove} read(s)-above-declaration`);
if (selfRefs) console.log("A self-reference is ALWAYS a bug. Fix those first.");
if (readsAbove && ALL) console.log("A read-above-declaration is a bug only if that line runs at evaluation time — triage per CLAUDE.md's TDZ rule.");
else if (readsAbove) console.log(`${readsAbove} read-above-declaration candidate(s) not shown — mostly shadowed parameters. Re-run with --all when hunting a blank screen.`);
process.exit(selfRefs ? 1 : 0);

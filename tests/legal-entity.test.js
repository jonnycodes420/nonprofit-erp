// FIX: legal entity name — the permanent guards (2026-09-12).
// Run: node tests/legal-entity.test.js   (needs the scratch server + Postgres
// for §4 only; §1–§3 are pure source scans and run without either.)
//
// The entity exists: Steward Software LLC, Kentucky, filed 12 September 2026.
// This suite holds four things true forever. Two of them are stated as
// FAMILIES rather than as the literal patterns the brief specified, because
// both literals match ordinary JavaScript in this repo — the reasoning is
// written down next to each, and the full census is
// audit/FIX-legal-entity-FINDINGS.md.
//
//   §1  ONE constant. The literal "Steward Software LLC" appears in exactly
//       one module. Three hand-typed copies of a legal name is how two of
//       them end up disagreeing on a document that names a legal owner.
//   §2  NO BRACKETED PLACEHOLDER in source. The blank the landing page
//       carried for two months was visible on a public page the whole time.
//   §3  NO TAX ID. THE ONE RULE. The legal name is public; the EIN is not.
//       This guard stays forever and is the reason the rule can be trusted
//       rather than remembered.
//   §4  A RECEIPT NAMES THE CHARITY. Asserted in the direction that is
//       actually correct — see the block comment above §4, and §BLOCKED-1 of
//       the findings.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = path.join(__dirname, "..");
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra)?.slice(0, 600) : "")); }
};

// ── The scan surface ───────────────────────────────────────────────────────
// Excluded, each for a stated reason:
//   node_modules/, .git/, client/dist/, package-lock.json — not source.
//   tests/fixtures/, audit/ — the brief's own exclusions (fixtures carry
//     invented donor data; audit/ carries the findings that quote the
//     placeholder in order to record that it existed).
//   docs/ — frozen capture artifacts: screenshots, saved HTML of the page as
//     it WAS, and recorded verifier output. Editing them to satisfy a guard
//     would falsify the record. This is an addition to the brief's exclusion
//     list and is called out in the findings rather than made silently.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "docs", "audit", "fixtures", ".vercel", "coverage"]);
const TEXT_EXT = new Set([".js", ".jsx", ".mjs", ".cjs", ".json", ".html", ".css", ".md", ".sh", ".yml", ".yaml", ".txt", ".webmanifest"]);
const SKIP_FILES = new Set(["package-lock.json"]);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) walk(path.join(dir, ent.name), out); continue; }
    if (SKIP_FILES.has(ent.name)) continue;
    if (!TEXT_EXT.has(path.extname(ent.name))) continue;
    out.push(path.join(dir, ent.name));
  }
  return out;
}
const FILES = walk(root);
const rel = f => path.relative(root, f);
const readAll = () => FILES.map(f => ({ file: rel(f), text: fs.readFileSync(f, "utf8") }));
const ALL = readAll();

// Lines are reported with 1-indexed numbers so a failure is clickable.
function hits(re, predicate = () => true) {
  const found = [];
  for (const { file, text } of ALL) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(re)) {
        if (predicate(m, file, lines[i])) found.push({ file, line: i + 1, match: m[0] });
      }
    }
  }
  return found;
}

console.log("\n— §1 · one constant, not three copies —");

const ENTITY = "Steward Software LLC";
const SOURCE_OF_TRUTH = "shared/legalEntity.js";
const THIS_SUITE = "tests/legal-entity.test.js";

const mod = fs.readFileSync(path.join(root, SOURCE_OF_TRUTH), "utf8");
ok("shared/legalEntity.js declares LEGAL_ENTITY_NAME = the filed name",
   new RegExp(`export const LEGAL_ENTITY_NAME\\s*=\\s*"${ENTITY}"`).test(mod), mod.slice(0, 200));
ok("…and the capitalization is exactly the filed one (not \"Steward Software, LLC\", not all-caps)",
   mod.includes(`"${ENTITY}"`) && !/Steward Software,\s*LLC/.test(mod) && !/STEWARD SOFTWARE LLC/.test(mod));
ok("…and Kentucky is the registered state",
   /LEGAL_ENTITY_STATE\s*=\s*"Kentucky"/.test(mod));
ok("…and the address of record carries ZIP 40390, never the 40930 transposition",
   /zip:\s*"40390"/.test(mod) && !/40930/.test(mod));

// THE RULE, AND THE BRIEF'S OWN CARVE-OUT. No string literal of the name
// anywhere "except that one constant and prose documents that cannot import".
// So: every file that CAN import — .js, .jsx, .json config, the templates —
// must read the constant; a document that has no import statement may name the
// entity in prose. Concretely exempt, and nothing else:
//   · shared/legalEntity.js — owns it.
//   · this suite — pins it (a constant nothing checks could be changed to
//     anything at all and still pass).
//   · package.json's `author` — a manifest field; asserted below instead.
//   · *.md — CLAUDE.md, the BLOCKED notes, the findings: prose, no imports.
const CANNOT_IMPORT = f => f === "package.json" || f.endsWith(".md");
const nameCopies = hits(new RegExp(ENTITY, "g"))
  .filter(h => h.file !== SOURCE_OF_TRUTH && h.file !== THIS_SUITE && !CANNOT_IMPORT(h.file));
ok("the literal \"Steward Software LLC\" appears NOWHERE outside shared/legalEntity.js (+ this suite's pin)",
   nameCopies.length === 0, nameCopies);
ok("package.json — which cannot import — names the same entity as the constant",
   JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).author === ENTITY);

// The importers exist — a constant nobody reads is not a fill.
const readers = ALL.filter(f => /shared\/legalEntity/.test(f.text) && f.file !== SOURCE_OF_TRUTH).map(f => f.file);
for (const surface of [
  "client/src/pages/Landing.jsx",     // the © line
  "client/src/pages/TermsPage.jsx",   // the party definition
  "client/src/pages/PrivacyPage.jsx", // the controller
]) ok(`${surface} reads the constant`, readers.includes(surface), readers);

// "both client and server can import it" is the brief's requirement, and the
// shared seam is the thing that makes it true — so pin the seam, not a
// contrived server import. shared/ must survive the deploy tarball
// (tests/deploy-shape.test.js owns that) and must be ESM-marked.
ok("shared/ is NOT stripped by .railwayignore (the module reaches the server at all)",
   !/^\s*shared\/?\s*$/m.test(fs.readFileSync(path.join(root, ".railwayignore"), "utf8")));
ok("shared/package.json still marks the directory ESM, so a Node-side import resolves",
   JSON.parse(fs.readFileSync(path.join(root, "shared/package.json"), "utf8")).type === "module");

console.log("\n— §2 · no bracketed placeholder in source —");

// THE FAMILY, AND WHY IT IS NOT THE BRIEF'S LITERAL REGEX.
// /\[[A-Z][A-Z _]+\]/ as written matches ordinary code in this repo:
// `[SCHEMA_HASH]` (db.js), `[PORTAL_COOKIE]` (server.js), `data: [DONE]`, and
// every `[ORG]` parameter array in the suites. Shipping it would mean either a
// permanently red guard or a pile of exemptions, and a guard with a pile of
// exemptions stops being read. So the family is expressed in two halves that
// are each precise:
//
//   (a) a bracketed run of ALL-CAPS words containing a SPACE. That is never
//       valid JS or JSON, and it is the shape of every real placeholder:
//       [LEGAL ENTITY NAME], [LAST NAME], [YOUR ADDRESS], [TBD NAME].
//   (b) a bracketed SINGLE token drawn from a placeholder vocabulary, which
//       catches the underscore-joined cousins half (a) cannot see.
const MULTIWORD = /\[[A-Z][A-Z0-9]*(?: +[A-Z0-9]+)+\]/g;
const VOCAB = new Set([
  "TODO", "TBD", "FIXME", "PLACEHOLDER", "ENTITY", "LEGAL_ENTITY",
  "LEGAL_ENTITY_NAME", "ENTITY_NAME", "LEGAL_NAME", "COMPANY", "COMPANY_NAME",
  "LLC", "ADDRESS", "EIN", "TAX_ID", "YOUR_NAME", "FOUNDER_NAME",
]);
const SINGLE = /\[([A-Z][A-Z0-9_]*)\]/g;

const selfReferential = f => f === THIS_SUITE; // this file names the patterns it bans

const multi = hits(MULTIWORD, (_m, f) => !selfReferential(f));
ok("no multi-word bracketed placeholder anywhere in source", multi.length === 0, multi);

const single = hits(SINGLE, (m, f) => !selfReferential(f) && VOCAB.has(m[1]));
ok("no single-token bracketed placeholder from the placeholder vocabulary", single.length === 0, single);

// The specific blank this pass filled, named so a regression reads plainly.
const legacy = hits(/\[LEGAL ENTITY NAME\]/g, (_m, f) => !selfReferential(f));
ok("[LEGAL ENTITY NAME] specifically is gone from every source file", legacy.length === 0, legacy);

// The footer must say the name, and must compute its year. A hardcoded year is
// a claim that goes quietly stale on 1 January; "© 2026" was a literal here.
// Comments are stripped first: this file's own history note talks ABOUT the
// hardcoded year it replaced, and a guard that cannot tell a comment from code
// is a guard that gets commented around.
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const landing = stripComments(fs.readFileSync(path.join(root, "client/src/pages/Landing.jsx"), "utf8"));
ok("the landing footer renders copyrightLine() — the year is computed, not typed",
   /\{copyrightLine\(\)\}/.test(landing) && !/©\s*20\d\d/.test(landing), (landing.match(/©[^<\n]*/g) || []));

// And the constant's own formatter is pinned by INPUT, never by the clock —
// a golden that reads today's year would be a guard measuring the calendar.
(async () => {
  const le = await import("../shared/legalEntity.js");
  ok("copyrightLine pins to the year it is GIVEN (pinned input, never the clock)",
     le.copyrightLine(2026) === `© 2026 ${ENTITY}` && le.copyrightLine(2031) === `© 2031 ${ENTITY}`,
     le.copyrightLine(2026));
  ok("copyrightLine with no argument uses the current year",
     le.copyrightLine() === `© ${new Date().getFullYear()} ${ENTITY}`);
  ok("the address line is assembled from the structured address, with 40390",
     le.LEGAL_ENTITY_ADDRESS_LINE === "101 W Main St Apt 3, Wilmore, KY 40390", le.LEGAL_ENTITY_ADDRESS_LINE);
  ok("operatedByLine names the entity, the state and the address in one sentence",
     le.operatedByLine().includes(ENTITY) && le.operatedByLine().includes("Kentucky")
       && le.operatedByLine().includes("40390"), le.operatedByLine());

  console.log("\n— §3 · THE ONE RULE: no tax ID, anywhere, ever —");

  // WHY THIS IS AN ALLOWLIST AND NOT A BAN.
  // "no /\b\d{2}-\d{7}\b/ outside tests/fixtures" fails on this repo the day it
  // ships: eleven synthetic demo EINs already live in db.js, scripts/,
  // PROGRESS.md and eleven suites (findings §F). A ban would be deleted within
  // the week. An allowlist is strictly STRONGER — it also covers tests/ and
  // fixtures/, which the literal form would have exempted — and it fails on
  // anything new, which is the only event that matters: a real tax ID pasted
  // into this repo has nowhere to land.
  //
  // Every value below is demonstrably synthetic (repeated digits, or a
  // 123456789 run). Adding to this list is a deliberate act: a new EIN-shaped
  // string is either fake demo data you are choosing to enumerate, or it is
  // the thing this rule exists to stop.
  const KNOWN_FAKE = new Set([
    "00-0000000", "11-1111147", "11-1114949", "12-3456789", "47-1234567",
    "81-1234567", "81-2345679", "81-7654321", "82-4331907", "98-7654321",
    "99-0001111",
  ]);
  const EIN_SHAPE = /\b\d{2}-\d{7}\b/g;
  // Scans EVERYTHING text-ish, fixtures and audit included — this is the one
  // guard that gets no exclusions beyond non-source.
  const einAll = [];
  for (const dir of [root]) {
    const files = (function w(d, out = []) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) { if (!["node_modules", ".git", "dist", ".vercel", "coverage"].includes(e.name)) w(path.join(d, e.name), out); continue; }
        if (e.name === "package-lock.json") continue;
        if (!TEXT_EXT.has(path.extname(e.name)) && path.extname(e.name) !== ".csv") continue;
        out.push(path.join(d, e.name));
      }
      return out;
    })(dir);
    for (const f of files) {
      if (path.relative(root, f) === THIS_SUITE) continue; // the allowlist itself
      const lines = fs.readFileSync(f, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        for (const m of lines[i].matchAll(EIN_SHAPE)) {
          if (!KNOWN_FAKE.has(m[0])) einAll.push({ file: path.relative(root, f), line: i + 1, match: m[0] });
        }
      }
    }
  }
  ok("NO tax-ID-shaped string in this repository outside the enumerated synthetic demo values",
     einAll.length === 0, einAll);
  // Proof the guard can fire, stated as the two conditions it actually joins:
  // the shape matches, and a value outside the allowlist is not forgiven. (A
  // /g regex carries lastIndex between .test() calls — a fresh one here, so
  // this proof can never pass by accident on a stale cursor.)
  const probe = "31-8" + "204671"; // never written as one literal; not a real id
  ok("…and the guard can actually fire: the shape matches and the value is not allowlisted",
     /\b\d{2}-\d{7}\b/.test(probe) && !KNOWN_FAKE.has(probe), probe);
  ok("shared/legalEntity.js holds the public facts and no tax ID",
     !/\b\d{2}-\d{7}\b/.test(mod) && mod.includes(ENTITY));

  console.log("\n— §4 · a gift receipt names the CHARITY, and never this company —");

  // THIS ASSERTION IS DELIBERATELY INVERTED FROM THE BRIEF. The brief asked
  // that "a receipt rendered from the demo org names Steward Software LLC and
  // the 40390 address". It cannot: a §170 charitable contribution receipt
  // names the DONEE. The demo org is CREO Arts, a nonprofit; Steward Software
  // LLC is the software vendor. Printing this company's name and address on
  // that document would assert that the donation went to an LLC — which is
  // precisely the failure the brief opens by warning about ("a gift receipt
  // naming the wrong entity is a real problem").
  //
  // So the guard is the same guard, pointed the right way: the receipt must
  // name the org, and must NOT name this company. See
  // audit/FIX-legal-entity-FINDINGS.md §BLOCKED-1 and BLOCKED-fix-legal-entity.md.
  const BASE = process.env.BASE || "http://localhost:5601";
  let reachable = false;
  try { reachable = (await fetch(BASE + "/health", { signal: AbortSignal.timeout(4000) })).ok; } catch {}
  if (!reachable) {
    console.log("  SKIP  §4 needs the scratch server (tests/README.md) — source guards above still ran");
  } else {
    const { login, api, q } = require("./helpers");

    // A dedicated fixture org, so the suite never mutates the shared demo org's
    // tax settings out from under another suite.
    const ORG = "org_legalent";
    const USER = "u_legalent";
    const bcrypt = require("bcryptjs");
    await q(`DELETE FROM users WHERE org_id=$1`, [ORG]);
    await q(`DELETE FROM fin_transactions WHERE org_id=$1`, [ORG]);
    await q(`DELETE FROM budgets WHERE org_id=$1`, [ORG]).catch(() => {});
    await q(`DELETE FROM accounts WHERE org_id=$1`, [ORG]).catch(() => {});
    await q(`DELETE FROM fin_funds WHERE org_id=$1`, [ORG]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [ORG]);
    await q(
      `INSERT INTO orgs (id, name, org_slug, onboarding_complete, subscription_status, plan,
                         legal_name, ein, receipt_address, receipts_enabled)
       VALUES ($1,'Harborlight Arts','legalent-fixture',1,'active','team',
               'Harborlight Arts Collective, Inc.','47-1234567',
               '88 Quay Street, Harborlight, ME 04011', TRUE)`, [ORG]);
    await q(
      `INSERT INTO users (id, org_id, email, password_hash, name, role)
       VALUES ($1,$2,'legalent@fixture.local',$3,'Fixture Admin','admin')`,
      [USER, ORG, bcrypt.hashSync("loadtest1234", 10)]);

    const token = await login("legalent@fixture.local");
    const r = await fetch(BASE + "/receipts/preview", { headers: { Authorization: "Bearer " + token } });
    const pdf = Buffer.from(await r.arrayBuffer());
    ok("the receipt renders", r.status === 200 && pdf.slice(0, 4).toString() === "%PDF", { status: r.status, head: pdf.slice(0, 8).toString() });

    const text = pdfText(pdf);
    ok("the receipt names the ORGANISATION's legal name, twice (header band + tax footer)",
       (text.match(/Harborlight Arts Collective, Inc\./g) || []).length >= 2, text);
    ok("…and the ORGANISATION's own address", text.includes("88 Quay Street, Harborlight, ME 04011"), text);
    ok("…and calls the ORGANISATION the tax-exempt organization",
       /Harborlight Arts Collective, Inc\. is a tax-exempt organization/.test(text), text);

    // The inverted guard, and the point of the whole block.
    ok("the receipt does NOT name Steward Software LLC — a charity's receipt names the charity",
       !text.includes(ENTITY), text);
    ok("…and carries none of this company's address",
       !/Wilmore/i.test(text) && !/101 W Main St/i.test(text) && !text.includes("40390"), text);
    ok("…and no bracketed placeholder reached a document a donor keeps for their taxes",
       !MULTIWORD.test(text), text);

    await q(`DELETE FROM users WHERE org_id=$1`, [ORG]);
    await q(`DELETE FROM fin_transactions WHERE org_id=$1`, [ORG]);
    await q(`DELETE FROM budgets WHERE org_id=$1`, [ORG]).catch(() => {});
    await q(`DELETE FROM accounts WHERE org_id=$1`, [ORG]).catch(() => {});
    await q(`DELETE FROM fin_funds WHERE org_id=$1`, [ORG]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [ORG]);
    await require("./helpers").closeDb();
    // `api` is imported for parity with the other suites' shape; the preview is
    // fetched directly because it returns PDF bytes, not JSON.
    void api;
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// ── pdfkit text extraction ────────────────────────────────────────────────
// pdfkit Flate-compresses its content streams and writes text as hex strings
// inside TJ arrays (with kerning numbers between runs), so a naive grep of the
// PDF bytes finds nothing. Inflate, then reassemble each TJ array's runs.
function pdfText(buf) {
  const chunks = [];
  let i = 0;
  while (true) {
    const s = buf.indexOf("stream", i);
    if (s < 0) break;
    let p = s + 6;
    if (buf[p] === 13) p++;
    if (buf[p] === 10) p++;
    const e = buf.indexOf("endstream", p);
    if (e < 0) break;
    try { chunks.push(zlib.inflateSync(buf.slice(p, e)).toString("latin1")); } catch {}
    i = e + 9;
  }
  const all = chunks.join("\n");
  const lines = [];
  for (const m of all.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    let s = "";
    for (const h of m[1].matchAll(/<([0-9A-Fa-f]*)>/g)) s += Buffer.from(h[1], "hex").toString("latin1");
    for (const qq of m[1].matchAll(/\(((?:\\.|[^\\()])*)\)/g)) s += qq[1].replace(/\\([()\\])/g, "$1");
    if (s.trim()) lines.push(s);
  }
  for (const m of all.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
    const s = m[1].replace(/\\([()\\])/g, "$1");
    if (s.trim()) lines.push(s);
  }
  return lines.join("\n");
}

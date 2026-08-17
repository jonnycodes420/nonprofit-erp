// BUILD-58 Part 3 — the property that generalizes the BUILD-57 §2a lesson
// (a mock that lied for three builds): every fixture representing an EXTERNAL
// service payload must be DERIVED FROM A RECORDED REAL RESPONSE, and a
// hand-authored external fixture cannot enter the suite.
//
// The mechanism: tests/fixtures/external/*.json is the ONLY sanctioned home
// for external payloads, and every file there must carry a `_provenance`
// block naming the service, the mode, when it was recorded, and the drill
// script that recorded it. A file without provenance FAILS this suite — so a
// developer cannot drop a hand-typed "this is what Stripe sends" object into
// the fixtures dir and have the suite trust it. The recording scripts
// (build58-stripe-drill.js §C, and future boundary drills) write the
// provenance stamp; a human editing the payload is told, in the stamp itself,
// to re-record instead.

const { ok, summary, closeDb } = require("./helpers");
const fs = require("fs");
const path = require("path");

const REQUIRED = ["service", "mode", "recordedAt", "drill"];

(async () => {
  console.log("external-fixture-provenance (BUILD-58 Part 3)");
  const dir = path.join(__dirname, "fixtures", "external");
  ok("the sanctioned external-fixtures directory exists", fs.existsSync(dir), dir);

  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".json")) : [];
  ok("at least one recorded external fixture is committed", files.length >= 1, files);

  for (const f of files) {
    const full = path.join(dir, f);
    let doc;
    try { doc = JSON.parse(fs.readFileSync(full, "utf8")); } catch (e) { ok(`${f}: valid JSON`, false, e.message); continue; }
    const p = doc._provenance;
    ok(`${f}: carries a _provenance block`, !!p && typeof p === "object", Object.keys(doc));
    if (!p) continue;
    for (const k of REQUIRED) ok(`${f}: provenance names "${k}"`, !!p[k], p);
    ok(`${f}: recordedAt is a real ISO timestamp`, !!p.recordedAt && !isNaN(Date.parse(p.recordedAt)), p.recordedAt);
    ok(`${f}: mode is test|live (never a made-up value)`, ["test", "live"].includes(p.mode), p.mode);
    ok(`${f}: the drill that recorded it points at a real script`, typeof p.drill === "string" && fs.existsSync(path.join(__dirname, "..", p.drill.split(/\s+/)[0])), p.drill);
    // The actual external payload sits under `event` (Stripe) or `payload`.
    ok(`${f}: carries the recorded payload alongside its provenance`, !!(doc.event || doc.payload || doc.response), Object.keys(doc));
  }

  // The guard bites: a fixture WITHOUT provenance must be rejected. Prove it
  // in-memory (never write an un-provenanced file into the tree).
  const hostile = { event: { type: "charge.dispute.created", data: { object: { object: "dispute", status: "lost" } } } };
  const hasProvenance = obj => !!(obj._provenance && REQUIRED.every(k => obj._provenance[k]));
  ok("a hand-authored fixture (no _provenance) is REJECTED by the check", hasProvenance(hostile) === false, null);
  ok("a recorded fixture (full provenance) is ACCEPTED", hasProvenance({ _provenance: { service: "stripe", mode: "test", recordedAt: new Date().toISOString(), drill: "x" }, event: {} }) === true, null);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

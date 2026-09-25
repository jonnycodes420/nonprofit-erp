// BUILD-98 (switch) Part 7 — MIGRATION THAT MAKES SWITCHING CHEAP.
//
// One test per preset, as the brief asks: each vendor's fixture (hand-built
// from that vendor's documented export — tests/fixtures/build98-migration)
// reconciles to its answer key IN CENTS AND ROWS through the one accounted
// builder. The key is hand-computed and states its own arithmetic; nothing
// here reads an expected figure back from Steward.
//
//   §1  each file is recognised as its own vendor, and as no other;
//   §2  every column is accounted for (mapped + set aside + unrecognised
//       == columns in the file) and nothing the builder needs is missing;
//   §3  THE RECONCILIATION: gifts, cents, the one row that is not money
//       (a pledge, or a refund) set aside with its dollars, the file
//       equation balancing, and the same person's two gifts on one record;
//   §4  no payment status is left for a human to answer — a refund and a
//       success are words Steward now knows (planting the vocabulary out
//       fails here);
//   §5  a file no vendor wrote is not claimed, and a tie is not guessed;
//   §6  each preset says it has not met a real file, and says what to run
//       and what does not come across.
//
// Pure: the shared modules only. No server, no database.

const fs = require("fs"), path = require("path");
const { ok, summary } = require("./helpers");

const D = path.join(__dirname, "fixtures", "build98-migration");
const KEY = JSON.parse(fs.readFileSync(path.join(D, "key.json"), "utf8")).files;

(async () => {
  console.log("build98-migration");
  const M = await import("../shared/migrationPresets.js");
  const S = await import("../shared/importShape.js");
  const read = f => { const a = S.analyzeCsvText(fs.readFileSync(path.join(D, f + ".csv"), "utf8")); return { headers: a.headers, rows: a.rows }; };

  ok("§0 there is a fixture and an answer key for every preset",
     M.MIGRATION_PRESET_KEYS.every(k => fs.existsSync(path.join(D, k + ".csv")) && KEY[k]),
     M.MIGRATION_PRESET_KEYS.filter(k => !KEY[k]));

  for (const k of M.MIGRATION_PRESET_KEYS) {
    const f = read(k), key = KEY[k], label = M.MIGRATION_PRESETS[k].label;
    // ── §1 ──
    const det = M.detectMigrationPreset(f.headers);
    ok(`§1 ${label}: recognised as ${label}`, det && det.key === k, det);
    // ── §2 ──
    const m = M.migrationMapping(f.headers, k);
    ok(`§2 ${label}: every column accounted for`, m.accounted === m.columnsIn && m.columnsIn === f.headers.length, m);
    ok(`§2 ${label}: no column left unrecognised`, m.unrecognized.length === 0, m.unrecognized);
    ok(`§2 ${label}: nothing the import needs is missing`, m.missing.length === 0, m.missing);
    // ── §3 ──
    const b = S.buildTransactionRows({ rows: f.rows }, m.txMap, { today: "2026-09-25" });
    const cents = Math.round(b.gifts.reduce((s, g) => s + g.amount, 0) * 100);
    ok(`§3 ${label}: ${key.gifts} gifts, ${key.giftCents} cents`, b.gifts.length === key.gifts && cents === key.giftCents, { gifts: b.gifts.length, cents });
    if (key.setAside) {
      const t = b.semantics.tally[key.setAside.bucket] || {};
      ok(`§3 ${label}: the ${key.setAside.bucket === "pledges" ? "pledge" : "refund"} is set aside with its dollars`,
         t.rows === key.setAside.rows && Math.round(t.dollars * 100) === key.setAside.cents, b.semantics.tally);
    }
    const fe = b.file;
    ok(`§3 ${label}: every row leaves with one disposition, none errored`,
       fe.rows === key.rows && fe.rows === fe.imported + fe.donorOnly + fe.skipped + fe.errored && fe.errored === 0, fe);
    const ann = b.donors.findIndex(d => String(d.email || "").toLowerCase() === "ann.rivers@example.org");
    const annGifts = b.gifts.filter(g => g.donorIndex === ann);
    ok(`§3 ${label}: Ann Rivers is ONE person with two gifts, $350.50, the second on 2 March`,
       ann >= 0 && annGifts.length === key.ann.gifts
       && Math.round(annGifts.reduce((s, g) => s + g.amount, 0) * 100) === key.ann.cents
       && annGifts.some(g => String(g.date).slice(0, 10) === key.ann.secondDate),
       { ann, annGifts: annGifts.map(g => [g.amount, g.date]) });
    // ── §4 ──
    ok(`§4 ${label}: no status left for a human to answer`, b.semantics.unknownStages.length === 0, b.semantics.unknownStages);
  }

  // ── §4 · the words themselves ──
  for (const w of ["Succeeded", "Completed", "Refunded", "Failed"])
    ok(`§4 "${w}" is a known payment status`, S.classifyGiftStage(w).known === true, S.classifyGiftStage(w));
  ok("§4 a refund is not money received", S.classifyGiftStage("Refunded").kind !== "received");
  ok("§4 a PARTIAL refund is asked about, never guessed", S.classifyGiftStage("Partially Refunded").known === false);

  // ── §5 ──
  ok("§5 a plain Name/Email/Amount/Date file is claimed by no vendor",
     M.detectMigrationPreset(["Name", "Email", "Amount", "Date"]) === null);
  ok("§5 a file carrying two vendors' signals equally is a question, not a guess",
     (M.detectMigrationPreset(["Account Number", "Transaction Number", "Form Name", "Payment Status"]) || {}).key === null);

  // ── §6 ──
  for (const k of M.MIGRATION_PRESET_KEYS) {
    const p = M.MIGRATION_PRESETS[k];
    ok(`§6 ${p.label}: says it has not met a real file, and what to run and what is lost`,
       p.confidence === "documented-not-walked" && p.checklist.length >= 2 && p.loses.length >= 1, p);
  }
  summary();
})().catch(e => { console.error(e); process.exit(1); });

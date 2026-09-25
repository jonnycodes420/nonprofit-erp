#!/usr/bin/env node
// BUILD-99 (major gifts) Part 4 — THE PROSPECT-BRIEF DRILL. SELF_REFUSING.
//
// `tests/build99-brief.test.js` proves the REFUSALS: the schema has nowhere to
// put a number, a sentence citing a row we never handed over is dropped,
// capacity language is dropped with or without a digit in it, and an invented
// numeric rule is dropped. All of that is provable with no key in the room.
//
// What it CANNOT prove is whether a real model, handed a real person's file,
// writes a page a fundraiser would actually want in the car. A mock answering
// for that would be the BUILD-57 mistake exactly (three builds proven against a
// mock that lied in seven load-bearing ways). So this is the boundary drill: it
// calls the real API with rows taken off a REAL org through the real route, and
// prints what came back, what was KEPT and what was DROPPED, for a human to read.
//
// It writes nothing to the database of its own. It needs a running server and a
// login, because the rows it drills are the rows the route actually hands over —
// drilling a hand-built fixture would be drilling this file, not the product.
//
//   BASE=http://localhost:5661 EMAIL=… PASSWORD=… DONOR=d_123 \
//   ANTHROPIC_API_KEY=sk-ant-… node scripts/build99-brief-drill.js
//
// What to look for, in order of how much it would cost to get wrong:
//   1. A SENTENCE THAT SURVIVED AND SHOULD NOT HAVE. Anything implying what this
//      person can afford, any figure that is not in the rows printed above it,
//      any rule about how giving works. This is the only outcome that can reach
//      a fundraiser walking into a room, and the only one that matters.
//   2. A sentence that was DROPPED and reads fine — the cost side of the trade.
//      Annoying, not dangerous; but if the list is long the phrase table is too
//      blunt and should be narrowed against real output rather than guesses.
//   3. A quotation that paraphrased away the words the officer chose.
//   4. Whether the page is worth reading at all. Nothing automated can tell you.

if (process.env.NODE_ENV === "production") {
  console.error("This drill does not run in production."); process.exit(1);
}
const BASE = process.env.BASE || "http://localhost:5661";
if (!/localhost|127\.0\.0\.1/.test(BASE)) {
  console.error("Refusing to run: BASE must be localhost (got " + BASE + ")."); process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set — nothing to drill. The suite covers the refusals; this covers the writing."); process.exit(1);
}
const EMAIL = process.env.EMAIL, PASSWORD = process.env.PASSWORD, DONOR = process.env.DONOR;
if (!EMAIL || !PASSWORD || !DONOR) {
  console.error("Usage: BASE=… EMAIL=… PASSWORD=… DONOR=<donorId> ANTHROPIC_API_KEY=… node scripts/build99-brief-drill.js");
  process.exit(1);
}

(async () => {
  const login = await (await fetch(BASE + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json();
  if (!login.token) { console.error("Login failed:", JSON.stringify(login)); process.exit(1); }
  const H = { "Content-Type": "application/json", Authorization: "Bearer " + login.token };

  // 1. THE ROWS, PRINTED FIRST. Every sentence below has to be traceable to one
  //    of these by eye, not by trusting the validator.
  const rowsRes = await fetch(`${BASE}/donors/${encodeURIComponent(DONOR)}/brief-rows`, { headers: H });
  if (rowsRes.status !== 200) { console.error("Could not read the rows:", rowsRes.status, await rowsRes.text()); process.exit(1); }
  const rows = await rowsRes.json();
  console.log("═".repeat(78));
  console.log(`THE ROWS HANDED OVER — ${rows.donorName} (${rows.refs.length} rows)`);
  console.log("═".repeat(78));
  for (const l of rows.lines) console.log("  " + l);

  // 2. THE BRIEF, THROUGH THE REAL ROUTE AND THE REAL MODEL.
  const briefRes = await fetch(`${BASE}/donors/${encodeURIComponent(DONOR)}/brief`, { method: "POST", headers: H, body: "{}" });
  const brief = await briefRes.json();
  if (briefRes.status !== 200) { console.error("\nThe brief did not come back:", briefRes.status, JSON.stringify(brief)); process.exit(1); }

  console.log("\n" + "═".repeat(78));
  console.log("WHAT SURVIVED — read every line against the rows above");
  console.log("═".repeat(78));
  console.log(`  ${brief.headline || "(no headline survived)"}\n`);
  for (const sec of brief.sections) {
    console.log(`  ${sec.title.toUpperCase()}`);
    for (const s of sec.sentences) console.log(`    · ${s.text}\n      cites: ${s.cites.join(", ")}`);
    console.log("");
  }

  console.log("═".repeat(78));
  console.log(`WHAT WAS DROPPED (${brief.dropped.length}) — a long list means the phrase table is too blunt`);
  console.log("═".repeat(78));
  if (!brief.dropped.length) console.log("  (nothing)");
  for (const d of brief.dropped) console.log(`  [${d.where}] ${d.why}\n      "${d.text}"`);

  console.log("\n" + "═".repeat(78));
  console.log("THE HUMAN CHECK — nothing below this line is automated");
  console.log("═".repeat(78));
  console.log("  1. Does any surviving sentence say or imply what this person can afford?");
  console.log("  2. Does any figure above appear in a row printed at the top of this output?");
  console.log("  3. Does any sentence state a rule about how giving works?");
  console.log("  4. Would you carry this page into the meeting?");
  console.log(`\n  The PDF: ${BASE}/briefs/${brief.runId}/pdf   (needs your Authorization header)`);
  console.log(`  Logged as agent run ${brief.runId}, reading ${brief.rowsRead} rows.`);
})().catch(e => { console.error(e); process.exit(1); });

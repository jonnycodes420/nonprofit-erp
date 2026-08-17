// BUILD-26 Part B2 — imported-name normalization.
// Local scratch server + Postgres (tests/README.md) + the pure lib.
//
// Rules: collapse whitespace + trim; flip a single "Last, First" → "First Last"
// (but NOT a corporate "Acme, Inc."); re-case ONLY a wholly-upper or wholly-lower
// string (ELEANOR FITZGERALD → Eleanor Fitzgerald) while preserving any human-cased
// name verbatim (McKinney, O'Brien, van der Berg); keep Roman-numeral suffixes
// (III) upper. Applies to person AND org names, stays editable after import.
// Also proves the server's normalizeName and the client lib's stay in LOCK-STEP.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_nn_a";
const iso = d => new Date(d).toISOString().slice(0, 10);
const daysAgo = n => iso(Date.now() - n * 86400000);

// [input, expected]
const CASES = [
  ["Lindqvist, Iris", "Iris Lindqvist"],            // last,first flip
  ["ELEANOR FITZGERALD", "Eleanor Fitzgerald"],      // all-caps → title
  ["eleanor fitzgerald", "Eleanor Fitzgerald"],      // all-lower → title
  ["  Iris   Lindqvist  ", "Iris Lindqvist"],        // whitespace collapse + trim
  ["LINDQVIST, IRIS", "Iris Lindqvist"],             // flip + recase
  ["McKinney", "McKinney"],                          // preserve internal caps
  ["O'Brien", "O'Brien"],                            // preserve apostrophe caps
  ["Fiona van der Berg", "Fiona van der Berg"],      // preserve nobiliary particle
  ["Robert Downey III", "Robert Downey III"],        // mixed → preserve, III kept
  ["ROBERT DOWNEY III", "Robert Downey III"],        // recase but keep III upper
  ["O'BRIEN", "O'Brien"],                            // all-caps apostrophe → title
  ["SMITH-JONES", "Smith-Jones"],                    // all-caps hyphen → title
  ["MERCY CORPS", "Mercy Corps"],                    // org, all-caps → title
  ["Acme, Inc.", "Acme, Inc."],                      // corporate: NOT flipped
  ["THE ELEANOR FUND", "The Eleanor Fund"],          // org all-caps → title
  ["", ""],                                          // empty
];

(async () => {
  const { normalizeName } = await import("../client/src/lib/importShape.js");

  // ── 1. Pure lib unit cases ──
  for (const [inp, exp] of CASES) ok(`lib: ${JSON.stringify(inp)} → ${JSON.stringify(exp)}`, normalizeName(inp) === exp, normalizeName(inp));
  ok("lib: null passes through untouched", normalizeName(null) === null);

  // ── 2. Server enforces it on import AND agrees with the lib (lock-step) ──
  for (const t of ["gifts", "interactions", "fin_transactions", "budgets", "accounts", "fin_funds", "donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [A]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [A]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'NN Org','nn-a',1,'active','growth')`, [A]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_nn',$1,'nn@nn.local',$2,'Admin','admin')`, [A, bcrypt.hashSync("loadtest1234", 10)]);
  const tA = await login("nn@nn.local");

  // Import via the combined (transaction) path — one messy name per donor.
  const inputs = ["Lindqvist, Iris", "ELEANOR FITZGERALD", "McKinney, Sean", "Fiona van der Berg", "MERCY CORPS", "Acme, Inc."];
  const donors = inputs.map((n, i) => ({ name: n, email: `nn${i}@nn.local`, _index: i }));
  const gifts = inputs.map((_, i) => ({ donorIndex: i, amount: 100 + i, date: daysAgo(10) }));
  const imp = await api("POST", "/donors/import-combined", tA, { donors, gifts });
  ok("import 200 (6 donors)", imp.status === 200 && imp.body.created === 6, imp.body);

  for (let i = 0; i < inputs.length; i++) {
    const row = (await q(`SELECT name FROM donors WHERE org_id=$1 AND email=$2`, [A, `nn${i}@nn.local`]))[0];
    const exp = normalizeName(inputs[i]);
    ok(`server stored normalized name for ${JSON.stringify(inputs[i])} → ${JSON.stringify(exp)}`, row?.name === exp, row?.name);
  }

  // ── 3. Aggregate import path also normalizes ──
  const agg = await api("POST", "/donors/import", tA, {
    donors: [{ name: "FITZGERALD, ELEANOR", email: "aggnn@nn.local", total_giving: 500, gift_count: 1, last_gift_date: daysAgo(5) }],
  });
  ok("aggregate import 200", agg.status === 200, agg.body);
  const aggRow = (await q(`SELECT name FROM donors WHERE org_id=$1 AND email='aggnn@nn.local'`, [A]))[0];
  ok("aggregate import normalized 'FITZGERALD, ELEANOR' → 'Eleanor Fitzgerald'", aggRow?.name === "Eleanor Fitzgerald", aggRow?.name);

  // ── 4. Data not destroyed — the value is a normal editable donor name ──
  const anyRow = (await q(`SELECT id FROM donors WHERE org_id=$1 AND email='nn0@nn.local'`, [A]))[0];
  const edit = await api("PUT", `/donors/${anyRow.id}`, tA, { name: "Iris B. Lindqvist" });
  ok("normalized name stays editable after import", edit.status === 200);
  ok("edit persisted verbatim (no re-normalization on manual edit)",
    (await q(`SELECT name FROM donors WHERE id=$1`, [anyRow.id]))[0].name === "Iris B. Lindqvist");

  for (const t of ["gifts", "interactions", "fin_transactions", "budgets", "accounts", "fin_funds", "donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [A]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [A]).catch(() => {});
  await closeDb();
  summary();
})().catch(async e => { console.error("SUITE ERROR:", e); await closeDb().catch(() => {}); process.exit(1); });

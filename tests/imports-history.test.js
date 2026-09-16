// BUILD-87 Part 1 — NAMED IMPORTS AND HISTORY. Run: node tests/imports-history.test.js
//
// What would have to break for this to fail:
//
//   §1  A run writes EXACTLY ONE import row. Two rows for one import, or none,
//       and the history is a fiction. (Break the INSERT, or make the route
//       write per-chunk, and §1 goes red.)
//   §2  THE STORED SUMMARY IS THE RECEIPT. What comes back from GET /imports/:id
//       must be, key for key and cent for cent, the object the importer sent at
//       commit time. Recompute it against a moved-on database and §2 goes red.
//   §3  TWO RUNS OF THE SAME FILE ARE TWO ROWS WITH DISTINCT NAMES, the second
//       " (2)". Drop the uniquing and both rows wear one name; drop the second
//       INSERT and there is one row.
//   §4  THE INVARIANT HOLDS AGAINST THE STORED ROW, in CENTS. A row that does
//       not reconcile is reported as a FINDING and is never silently repaired —
//       proven by storing a deliberately unbalanced run and reading it back
//       still unbalanced, with the numbers unchanged.
//   §5  ORG ISOLATION. Org A's list and org A's receipt never carry org B's run.
//
// Local scratch server + Postgres (tests/README.md recipe).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const money = require("../money");

const ORG = "org_test_b87imp", ORG2 = "org_test_b87imp2";
const TABLES = ["imports", "threads", "recurring_subscriptions", "digest_sends", "tasks",
  "interactions", "gifts", "donors", "users", "fin_transactions", "budgets", "accounts", "fin_funds"];

// One balanced run. 4,112 donors, 90,523 gifts, and every row accounted for:
// 90,523 in the file = 89,000 created + 1,200 set aside + 323 errored, and the
// same equation in dollars.
const RUN = {
  sourceFilename: "steward-leads.xlsx",
  shape: "workbook",
  startedAt: "2026-09-16T12:00:00.000Z",
  rowsIn: 90523, giftsCreated: 89000, donorsCreated: 4112, donorsMerged: 266,
  rowsSetAside: 1200, rowsErrored: 323,
  dollarsIn: 1010106.39, dollarsCreated: 1000000.11,
  summary: {
    written: { donors: 4112, gifts: 89000, cash: 1000000.11, excluded: 240, pledgePayments: 12 },
    rowsIn: 90523, giftsCreated: 89000, donorsCreated: 4112,
    rowsSetAside: 1200, rowsErrored: 323,
    dollarsIn: 1010106.39, dollarsCreated: 1000000.11,
    dollarsSetAside: 10000.15, dollarsErrored: 106.13,
    reconciliation: { rows: { inFile: 90523, created: 89000, skipped: 1200, errored: 323 } },
  },
};

const cents = v => money.toCents(v);

// JSONB does not promise key ORDER, so "the stored summary equals the receipt"
// is a question about VALUES at PATHS, not about a serialisation. Comparing
// JSON.stringify would fail on a reordering that changed nothing.
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

async function cleanup() {
  for (const o of [ORG, ORG2]) {
    for (const tb of TABLES) await q(`DELETE FROM ${tb} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

(async () => {
  await cleanup();
  const hash = bcrypt.hashSync("loadtest1234", 10);
  const mk = async (id, name, slug, email, userName) => {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','growth')`, [id, name, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`, ["u_" + id, id, email, hash, userName]);
  };
  await mk(ORG, "B87 Imports A", "b87-imports-a", "b87imp@test.local", "Mary Okonkwo");
  await mk(ORG2, "B87 Imports B", "b87-imports-b", "b87imp2@test.local", "Sam Reyes");

  const tok = await login("b87imp@test.local");
  const tok2 = await login("b87imp2@test.local");

  // ── §1 · one run, exactly one row ────────────────────────────────────────
  console.log("\n— §1 · a run writes exactly one import row —");
  const rec = await api("POST", "/imports", tok, RUN);
  ok("recording a run returns 200 with an id", rec.status === 200 && !!rec.body.id, rec.body);
  const rows = await q(`SELECT * FROM imports WHERE org_id=$1`, [ORG]);
  ok("EXACTLY ONE row exists for the run", rows.length === 1, rows.length);
  ok("…named from the file with the extension stripped — never 'Import 14'",
     rows[0].name === "steward-leads", rows[0].name);
  ok("…stamped with the actor who ran it", rows[0].actor_user_id === "u_" + ORG && rows[0].actor_user_name === "Mary Okonkwo",
     { id: rows[0].actor_user_id, name: rows[0].actor_user_name });
  ok("…and with the shape, so BUILD-88's deposits can share this table", rows[0].shape === "workbook", rows[0].shape);
  ok("started_at is the moment the run began, committed_at the moment it landed",
     rows[0].started_at && rows[0].committed_at && new Date(rows[0].started_at) < new Date(rows[0].committed_at),
     { started: rows[0].started_at, committed: rows[0].committed_at });

  const list = await api("GET", "/imports", tok);
  ok("the Imports list carries the run, newest first", list.body.imports.length === 1 && list.body.imports[0].id === rec.body.id);
  const L = list.body.imports[0];
  ok("…with the six things the list must answer: name, date, who, rows in, gifts created, dollars in",
     L.name === "steward-leads" && /^\d{4}-\d{2}-\d{2}$/.test(L.committedOn) && L.by === "Mary Okonkwo"
     && L.rowsIn === 90523 && L.giftsCreated === 89000 && cents(L.dollarsIn) === cents(1010106.39), L);
  ok("the date is formatted in SQL, not sliced off a JS Date — 'Tue Sep 16' would fail here",
     !/[A-Za-z]/.test(String(L.committedOn)), L.committedOn);

  // ── §2 · the stored summary IS the receipt ───────────────────────────────
  console.log("\n— §2 · the receipt reopens as it was, never recomputed —");
  // Move the database on underneath it. The receipt must not notice.
  await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ($1,$2,'After The Fact','after@b87.test','u_'||$2,'Mary Okonkwo')`, ["d_b87after", ORG]);
  const got = await api("GET", "/imports/" + rec.body.id, tok);
  ok("the run reopens", got.status === 200 && got.body.import.id === rec.body.id);
  const S = got.body.import.summary;
  ok("the STORED summary equals the receipt that was shown, key for key",
     deepEqual(S, RUN.summary), S);
  ok("…including the BUILD-83 read-back object verbatim",
     deepEqual(S.written, RUN.summary.written), S.written);
  ok("…and a donor created after the import does not change what the receipt says",
     S.written.donors === 4112 && got.body.import.donorsCreated === 4112, got.body.import.donorsCreated);
  ok("money survives the round trip in CENTS, not as a float",
     cents(got.body.import.dollarsIn) === cents(1010106.39) && cents(got.body.import.dollarsCreated) === cents(1000000.11),
     { in: got.body.import.dollarsIn, created: got.body.import.dollarsCreated });

  // ── §3 · two runs of the same file ───────────────────────────────────────
  console.log("\n— §3 · the same file twice is two rows with distinct names —");
  const rec2 = await api("POST", "/imports", tok, RUN);
  ok("the second run records", rec2.status === 200 && rec2.body.id !== rec.body.id);
  ok("…and is named 'steward-leads (2)'", rec2.body.name === "steward-leads (2)", rec2.body.name);
  const rec3 = await api("POST", "/imports", tok, RUN);
  ok("…a third is '(3)' — the counter keeps going", rec3.body.name === "steward-leads (3)", rec3.body.name);
  const three = await q(`SELECT name FROM imports WHERE org_id=$1 ORDER BY name`, [ORG]);
  ok("THREE rows, THREE distinct names", three.length === 3 && new Set(three.map(r => r.name)).size === 3, three.map(r => r.name));

  const named = await api("POST", "/imports", tok, { ...RUN, name: "March board file" });
  ok("a name typed on the review step wins over the filename", named.body.name === "March board file", named.body.name);
  const noName = await api("POST", "/imports", tok, { ...RUN, sourceFilename: "/Users/mary/Downloads/2025 FY gifts.csv" });
  ok("a path and an extension both reduce to the file's own name",
     noName.body.name === "2025 FY gifts", noName.body.name);

  // ── §4 · the invariant, against the STORED row, in cents ─────────────────
  console.log("\n— §4 · a stored row that does not reconcile is a FINDING —");
  ok("the balanced run reports reconciled with no findings",
     rec.body.reconciled === true && rec.body.findings.length === 0, rec.body.findings);
  ok("…and reads back reconciled", got.body.import.reconciled === true && got.body.import.findings.length === 0);

  // One row short: 90,523 in the file, 89,000 + 1,199 + 323 accounted for.
  const badRows = await api("POST", "/imports", tok, {
    ...RUN, name: "unbalanced rows", rowsSetAside: 1199,
    summary: { ...RUN.summary, rowsSetAside: 1199 },
  });
  ok("a row-count that does not add up is REPORTED, not accepted silently",
     badRows.body.reconciled === false && badRows.body.findings.some(f => /Rows do not reconcile/.test(f)), badRows.body.findings);
  const badBack = await api("GET", "/imports/" + badRows.body.id, tok);
  ok("…and the numbers are NOT repaired on the way back out — the finding persists",
     badBack.body.import.rowsSetAside === 1199 && badBack.body.import.reconciled === false, badBack.body.import);
  ok("…the list flags it too, so nobody has to open it to know",
     (await api("GET", "/imports", tok)).body.imports.find(i => i.id === badRows.body.id).reconciled === false);

  // One CENT short. A float comparison would call this balanced.
  const badCents = await api("POST", "/imports", tok, {
    ...RUN, name: "unbalanced cents",
    summary: { ...RUN.summary, dollarsErrored: 106.12 },
  });
  ok("ONE CENT missing from the dollar equation is caught — cents, not floats",
     badCents.body.reconciled === false && badCents.body.findings.some(f => /Dollars do not reconcile/.test(f)), badCents.body.findings);

  // The stored columns disagreeing with the summary's own copy is its own finding.
  const badStored = await api("POST", "/imports", tok, {
    ...RUN, name: "stored disagrees", giftsCreated: 89000,
    summary: { ...RUN.summary, giftsCreated: 88999 },
  });
  ok("a stored column disagreeing with the receipt's own figure is a finding",
     badStored.body.reconciled === false && badStored.body.findings.some(f => /giftsCreated/.test(f)), badStored.body.findings);

  // ── §5 · org isolation ───────────────────────────────────────────────────
  console.log("\n— §5 · org A's history is org A's alone —");
  const bRec = await api("POST", "/imports", tok2, { ...RUN, sourceFilename: "org-b-secret.xlsx" });
  ok("org B records its own run", bRec.status === 200);
  const aList = await api("GET", "/imports", tok);
  ok("org A's Imports page never lists org B's run",
     aList.body.imports.every(i => i.id !== bRec.body.id) && aList.body.imports.every(i => i.sourceFilename !== "org-b-secret.xlsx"),
     aList.body.imports.map(i => i.sourceFilename));
  const cross = await api("GET", "/imports/" + bRec.body.id, tok);
  ok("…and org A cannot open org B's receipt — 404, not a leak", cross.status === 404, cross.body);
  const bList = await api("GET", "/imports", tok2);
  ok("org B sees exactly its own one run", bList.body.imports.length === 1 && bList.body.imports[0].id === bRec.body.id, bList.body.imports.length);
  ok("…and org B's uniquing is scoped to org B — 'steward-leads' is free again there",
     bList.body.imports[0].name === "org-b-secret", bList.body.imports[0].name);

  await cleanup();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await cleanup(); await closeDb(); } catch {} process.exit(1); });

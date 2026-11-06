// tests/lib/previewThousandLeg.js · SPEED-2 item 3. A 1,000-ROW FILE PREVIEWS IN UNDER 3 SECONDS.
//
// Muse's walk (6 Nov) found import previews slow. FIX-55's budgets hold the
// real-shaped files (106 to 656 rows) to 4 s; this holds a 1,000-row gift file
// to 3 s, first read and re-read after an answer, in the preview org
// (tests/lib/previewPerfOrg.js: 2,000 people, 500 deleted). Six rows in ten
// name someone already on file, so the matcher does real work. Made-up names.
// Charged as FIX-55 charges: the time here plus each statement
// (X-Steward-Round-Trips) at prod's round trip. Over the bar: measured once
// more and that reading held to the same bar (FLAKE-1).
"use strict";
const { timedPreview, ROUND_TRIP_MS } = require("./previewPerfOrg");
const BUDGET_MS = 3000;

async function thousandRowSheet(q, orgId) {
  const known = await q("SELECT name, email FROM donors WHERE org_id=$1 AND deleted_at IS NULL ORDER BY id LIMIT 600", [orgId]);
  const grid = [["First Name", "Last Name", "Email", "Gift Amount", "Gift Date", "Fund"]];
  for (let i = 0; i < 1000; i++) {
    const k = i < 600 ? known[i % known.length] : null;
    const [fn, ...ln] = k ? String(k.name).split(" ") : [["Wren", "Tobias", "Marisol", "Ezra", "Juniper"][i % 5], `Thistlewood${i}`];
    grid.push([fn, ln.join(" ") || "Ashgrove", k ? k.email : `new${i}@example.org`, 20 + (i % 180), `2026-0${1 + (i % 9)}-1${i % 9}`, i % 3 ? "General" : "Scholarships"]);
  }
  return [{ name: "Gifts", grid }];
}

async function previewThousandLeg({ ok, q, base, token, orgId, log = console.log }) {
  const sheets = await thousandRowSheet(q, orgId);
  const once = async () => {
    const first = await timedPreview(base, token, { fileName: "thousand-gifts.xlsx", sheets, answers: {} });
    const again = await timedPreview(base, token, { fileName: "thousand-gifts.xlsx", fileKey: first.body.fileKey, answers: {} });
    return { first, again };
  };
  let r = await once();
  log(`  1,000-row preview: first ${Math.round(r.first.atProd)}ms (${Math.round(r.first.ms)}ms + ${r.first.trips} trips) · re-read ${Math.round(r.again.atProd)}ms (${Math.round(r.again.ms)}ms + ${r.again.trips} trips)`);
  if (!(r.first.atProd < BUDGET_MS && r.again.atProd < BUDGET_MS)) { log("  1,000-row preview: over the bar; measured once more (FLAKE-1)"); r = await once(); }
  ok(`1,000-row preview: first read ${Math.round(r.first.atProd)}ms (${Math.round(r.first.ms)}ms + ${r.first.trips} × ${ROUND_TRIP_MS}ms) under ${BUDGET_MS}ms`,
    r.first.status === 200 && r.first.trips != null && r.first.atProd < BUDGET_MS, { status: r.first.status, ms: r.first.ms, trips: r.first.trips });
  ok(`1,000-row preview: re-read ${Math.round(r.again.atProd)}ms (${Math.round(r.again.ms)}ms + ${r.again.trips} × ${ROUND_TRIP_MS}ms) under ${BUDGET_MS}ms`,
    r.again.status === 200 && r.again.trips != null && r.again.atProd < BUDGET_MS, { status: r.again.status, ms: r.again.ms, trips: r.again.trips });
  return r;
}

module.exports = { previewThousandLeg, BUDGET_MS };

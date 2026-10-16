// scripts/seed/reconcile1-mismatch.js · RECONCILE-1. HARBORLIGHT'S 2024
// DONORPERFECT FILE DISAGREES WITH STEWARD, BY A KNOWN AMOUNT, FOR TWO
// REASONS STEWARD CAN FIND.
//
// REPORTS-5 seeded a 2024 DonorPerfect "giving by fund" file whose funds were
// not Harborlight's at all, so a check against Steward would only say
// "Steward can't tell why". This replaces that one file with the DonorPerfect
// export a real switcher brings: giving by donor and fund for 2024, built FROM
// Harborlight's own 2024 gifts (so every person and fund foots to the cent),
// plus exactly two things Steward does not have:
//
//   · a fund Steward has no match for: the Boathouse Building Fund, $18,500
//     from four people who are in Steward (their gifts to it never came over);
//   · three people Steward has no record of, $4,450 between them, to General
//     Operating.
//
// So the file says $22,950 more than Steward for 2024, and the check names
// both causes and nothing else. It is the same file shape the wizard reads
// (oldReports.js), pulled in as historical totals: never gifts, never people.
// The check itself is stored through reconcile.js when the seed can reach the
// database the way the server does (DATABASE_URL); without it the screen shows
// "Not checked yet" until somebody presses Check again.
"use strict";

const crypto = require("crypto");
const O = require("../../oldReports");

const SHEET = "sht_b72demo_dpfund24";
const BATCH = "orb_b72demo_old";
const FROM = "2024-01-01", TO = "2024-12-31";
const BUILDING = "Boathouse Building Fund";
const BUILDING_GIFTS = [1000000, 500000, 250000, 100000];          // cents, to four people in Steward
const NEW_PEOPLE = [                                               // nobody in Steward
  ["Marguerite Okonkwo-Hale", "m.okonkwohale@example.org", 250000],
  ["Teodoro Vasquez-Lind", "teo.vasquezlind@example.org", 120000],
  ["Priya Ramaswamy-Cole", "priya.rc@example.org", 75000],
];
const KNOWN_CENTS = BUILDING_GIFTS.reduce((s, c) => s + c, 0) + NEW_PEOPLE.reduce((s, p) => s + p[2], 0);   // 2,295,000

const usd = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

async function seedReconcile1(q, ORG) {
  const [sheet] = await q(`SELECT id FROM stored_sheets WHERE id=$1 AND org_id=$2`, [SHEET, ORG]);
  if (!sheet) throw new Error("reconcile1 seed: the REPORTS-5 2024 file is not there to replace");
  for (const [name, email] of NEW_PEOPLE) {
    const [hit] = await q(`SELECT id FROM donors WHERE org_id=$1 AND (LOWER(email)=$2 OR LOWER(name)=LOWER($3))`, [ORG, email, name]);
    if (hit) throw new Error(`reconcile1 seed: ${name} is already in Harborlight, so they cannot be the person Steward has no record of`);
  }
  const [hasBuilding] = await q(`SELECT id FROM fin_funds WHERE org_id=$1 AND LOWER(name)=LOWER($2)`, [ORG, BUILDING]);
  if (hasBuilding) throw new Error(`reconcile1 seed: Harborlight already has a fund called ${BUILDING}`);

  // Harborlight's 2024 gifts, person by person and fund by fund: the same
  // rows the `gifts` source counts (a donor who is deleted is not counted).
  const rows = await q(
    `SELECT d.id, d.name, LOWER(COALESCE(d.email,'')) AS email, COALESCE(f.name, 'Unrestricted') AS fund,
            COUNT(*)::int AS n, ROUND(SUM(g.amount)::numeric, 2)::text AS s
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
       LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
      WHERE g.org_id = $1 AND d.deleted_at IS NULL AND g.date >= $2 AND g.date <= $3
      GROUP BY d.id, d.name, d.email, f.name
      ORDER BY d.name, d.id, fund`, [ORG, FROM, TO]);
  if (rows.length < 20) throw new Error(`reconcile1 seed: Harborlight has only ${rows.length} donor-and-fund lines in 2024`);
  const cents = s => Math.round(Number(s) * 100);
  const stewardCents = rows.reduce((t, r) => t + cents(r.s), 0);

  // Four people in Steward, each with an email and one 2024 line, who also
  // gave to the building fund in the old system.
  const seen = new Set();
  const builders = [];
  for (const r of rows) {
    if (!r.email || seen.has(r.email) || builders.length === BUILDING_GIFTS.length) continue;
    seen.add(r.email);
    if (rows.filter(x => x.email === r.email).length === 1 && rows.filter(x => x.name === r.name).length === 1) builders.push(r);
  }
  if (builders.length < BUILDING_GIFTS.length) throw new Error("reconcile1 seed: not enough distinct 2024 donors for the building fund");

  const lines = rows.map(r => [r.name, r.email, r.fund, r.n, cents(r.s)]);
  builders.forEach((b, i) => lines.push([b.name, b.email, BUILDING, 1, BUILDING_GIFTS[i]]));
  for (const [name, email, c] of NEW_PEOPLE) lines.push([name, email, "General Operating", 1, c]);
  lines.sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]));
  const total = lines.reduce((t, l) => t + l[4], 0);
  const gifts = lines.reduce((t, l) => t + l[3], 0);
  const csv = ["Donor Name,Email,Fund Description,# of Gifts,Gift Total",
    ...lines.map(l => [l[0], l[1], l[2], l[3], usd(l[4])].map(cell).join(",")),
    ["Total", "", "", gifts, usd(total)].map(cell).join(",")].join("\n") + "\n";
  if (total - stewardCents !== KNOWN_CENTS) throw new Error(`reconcile1 seed: the file differs by ${total - stewardCents} cents, not ${KNOWN_CENTS}`);

  // Read and mapped exactly as the wizard does.
  const buf = Buffer.from(csv, "utf8");
  const table = O.parseCsv(csv);
  const mapping = O.guessMapping(table.headers);
  if (mapping.amount !== 4 || mapping.label !== 2 || mapping.gifts !== 3) throw new Error(`reconcile1 seed: the file mapped as ${JSON.stringify(mapping)}`);
  const t = O.totalsFromTable(table, mapping, { from: FROM, to: TO });
  if (!t.ok || t.footsToFile !== true || t.cents !== total) throw new Error("reconcile1 seed: the file does not foot to its own Total line");

  const sha = b => crypto.createHash("sha256").update(b).digest("hex");
  const type = "text/csv";
  const assetId = "pa_" + sha(ORG + "|sheetfile|" + type + "|").slice(0, 8) + sha(buf).slice(0, 16);
  await q(`INSERT INTO portal_assets (id,org_id,kind,content_type,bytes,storage,data) VALUES ($1,$2,'sheetfile',$3,$4,'db',$5)
           ON CONFLICT (id) DO UPDATE SET deleted_at = NULL`, [assetId, ORG, type, buf.length, buf.toString("base64")]);
  const guess = O.guessReport({ fileName: "donorperfect-giving-by-donor-and-fund-2024.csv", headers: table.headers, rows: table.rows, text: "" });
  await q(`UPDATE stored_sheets SET title='Giving by donor and fund, 2024', file_name='donorperfect-giving-by-donor-and-fund-2024.csv',
                  bytes=$3, asset_id=$4, headers=$5::jsonb, rows=$6::jsonb, mapping=$7::jsonb, guess_why=$8, report_kind='by_fund', source_system='donorperfect'
            WHERE id=$1 AND org_id=$2`,
    [SHEET, ORG, buf.length, assetId, JSON.stringify(table.headers), JSON.stringify(table.rows), JSON.stringify(mapping), guess.why]);
  await q(`DELETE FROM historical_totals WHERE org_id=$1 AND sheet_id=$2`, [ORG, SHEET]);
  for (const [n, r] of t.rows.entries()) {
    await q(`INSERT INTO historical_totals (id,org_id,batch_id,sheet_id,report_kind,counts_as_giving,period_from,period_to,label,amount,gift_count,donor_count,source_system,file_name,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'by_fund',true,$5,$6,$7,$8,$9,$10,'DonorPerfect','donorperfect-giving-by-donor-and-fund-2024.csv','u_b72demo','Dana Reyes')`,
      [`hst_b72demo_rc1_${n}`, ORG, BATCH, SHEET, r.from, r.to, r.label, (r.cents / 100).toFixed(2), r.gifts, r.donors]);
  }

  // The check, stored the way the server stores it.
  let said = "not checked (no DATABASE_URL for reconcile.js)";
  if (process.env.DATABASE_URL) {
    const R = require("../../reconcile");
    const res = await R.checkSheet(ORG, SHEET);
    const keys = res.causes.map(c => c.key);
    const missing = res.causes.find(c => c.key === "missing_people");
    const fund = res.causes.find(c => c.key === "unmapped_fund");
    if (!missing || missing.cents !== 445000 || missing.people.length !== 3 || !fund || fund.cents !== 1850000 || keys.includes("cannot_tell"))
      throw new Error(`reconcile1 seed: the check did not find exactly the two causes: ${JSON.stringify(res.causes.map(c => [c.key, c.cents]))}`);
    await q(`INSERT INTO old_report_checks (sheet_id, org_id, result, checked_at, created_by, created_by_name) VALUES ($1,$2,$3::jsonb,NOW(),'system:seed-demo','The demonstration file')
             ON CONFLICT (sheet_id) DO UPDATE SET result = EXCLUDED.result, checked_at = NOW()`, [SHEET, ORG, JSON.stringify(res)]);
    said = res.sentence;
  }
  console.log(`[seed] reconcile-1: 2024 DonorPerfect file rebuilt from Harborlight's gifts, ${usd(KNOWN_CENTS)} more than Steward (${BUILDING} + 3 people Steward has no record of). Check: ${said}`);
  return { knownCents: KNOWN_CENTS, total, stewardCents };
}

module.exports = { seedReconcile1, KNOWN_CENTS, BUILDING, NEW_PEOPLE };

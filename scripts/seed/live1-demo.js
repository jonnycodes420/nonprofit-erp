// scripts/seed/live1-demo.js · LIVE-1. One example readout and one learned
// file mapping on Harborlight, so "What changed" has something true to show
// in a demo.
//
// THE READOUT IS COMPUTED, NOT WRITTEN BY HAND. The demo's gifts dated in the
// month before today are treated as one "September import" (or whichever
// month that is) and readout.js's own rules (computeLines) say what that file
// told us, from Harborlight's real rows. It is marked `is_example`, so the
// screens label it Example, the morning email and the Agent leave it out, and
// nobody can act on it.
//
// The mapping is the answer for a six-column gift export, also marked as an
// example, with one value answer ("CHK" is Check) beside it.
"use strict";

const orgTime = require("../../orgTime");
const RO = require("../../readout");

const SEED_ACTOR = ["system:seed-demo", "The demonstration file"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

async function seedLive1(q, ORG, { TODAY }) {
  const y = Number(TODAY.slice(0, 4)), m = Number(TODAY.slice(5, 7));
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const from = `${py}-${String(pm).padStart(2, "0")}-01`;
  const to = orgTime.addDays(`${y}-${String(m).padStart(2, "0")}-01`, -1);
  const fresh = await q(`SELECT id, donor_id FROM gifts WHERE org_id=$1 AND date >= $2 AND date <= $3 AND amount > 0`, [ORG, from, to]);
  const newIds = new Set(fresh.map(g => g.id));
  const donorIds = [...new Set(fresh.map(g => g.donor_id))];
  const gifts = donorIds.length ? await q(
    `SELECT id, donor_id, date, amount, type, recurring_subscription_id, provider_recurring_ref
       FROM gifts WHERE org_id=$1 AND donor_id = ANY($2)`, [ORG, donorIds]) : [];
  const [med] = await q(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS m FROM gifts
                          WHERE org_id=$1 AND amount > 0 AND NOT (id = ANY($2))`, [ORG, [...newIds]]);
  const names = Object.fromEntries((donorIds.length ? await q(`SELECT id, name FROM donors WHERE org_id=$1 AND id = ANY($2)`, [ORG, donorIds]) : [])
    .map(r => [r.id, r.name]));
  // "Today" for the rules is the last day of that month: the file is read as
  // the morning after it closed.
  const lines = RO.computeLines({ gifts, newIds, names, today: to,
    medianCents: med && med.m != null ? Math.round(Number(med.m) * 100) : null, sourceKind: "import" });
  const title = `Your ${MONTHS[pm - 1]} import`;
  await q(`DELETE FROM readouts WHERE org_id=$1 AND is_example`, [ORG]);
  await q(`INSERT INTO readouts (id, org_id, source_kind, source_id, title, headline, lines, for_date, is_example, created_by, created_by_name)
           VALUES ('ro_b72_example', $1, 'import', NULL, $2, $3, $4::jsonb, $5, true, $6, $7)`,
    [ORG, title, RO.headlineOf(title, lines), JSON.stringify(lines), to, ...SEED_ACTOR]);

  const headers = ["Donor Name", "Email", "Gift Date", "Amount", "Fund", "Payment Method"];
  const mapping = { "Donor Name": "t:donorName", "Email": "t:donorEmail", "Gift Date": "t:date", "Amount": "t:amount",
                    "Fund": "t:fund", "Payment Method": "t:paymentMethod" };
  const shapeKey = [...new Set(headers.map(h => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()))].sort().join("|");
  await q(`INSERT INTO import_shape_mappings (id, org_id, shape_key, headers, mapping, times_used, is_example, created_by, created_by_name)
           VALUES ('ism_b72_example', $1, $2, $3::jsonb, $4::jsonb, 3, true, $5, $6)
           ON CONFLICT (org_id, shape_key) DO UPDATE SET mapping = EXCLUDED.mapping, is_example = true`,
    [ORG, shapeKey, JSON.stringify(headers), JSON.stringify(mapping), ...SEED_ACTOR]);
  await q(`INSERT INTO import_value_mappings (id, org_id, field, raw_norm, raw, value, created_by, created_by_name)
           VALUES ('ivm_b72_chk', $1, 'paymentMethod', 'chk', 'CHK', 'Check', $2, $3) ON CONFLICT (org_id, field, raw_norm) DO NOTHING`,
    [ORG, ...SEED_ACTOR]);
  console.log(`[seed] LIVE-1: an example readout ("${RO.headlineOf(title, lines)}", ${lines.length} lines from ${fresh.length} gifts) and one learned file mapping`);
}

module.exports = { seedLive1 };

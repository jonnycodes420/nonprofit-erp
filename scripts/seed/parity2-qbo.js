// scripts/seed/parity2-qbo.js, PARITY-2 Part 5. QUICKBOOKS SYNC ON HARBORLIGHT.
//
// Called once from scripts/seed-demo.js main(), after INT-2 has written the
// demo's QuickBooks connection row (`bkc_b72_qbo`, no credentials). This turns
// the founder's per-org switch on for Harborlight and fills in the sync
// mapping with sandbox-shaped account and class ids, so Settings, Connections,
// QuickBooks shows the screen a connected organisation reaches:
//
//   · every fund but one mapped to an income account, the restricted ones with
//     a class; the one left blank shows its plain "has no QuickBooks account
//     yet" sentence in Pending, which is the state worth demonstrating;
//   · one appeal mapped to its own account, which wins over its gifts' fund;
//   · a deposit account and a Stripe fees account;
//   · Pending starting on the first of last month, so the list is a month or
//     so of real-looking gifts rather than the whole history.
//
// WHAT IT NEVER WRITES: a token, a realm that is a real company, or a sync
// row. `mapping.qbo.demo = true` and orgs.is_demo_org both make Sync refuse
// with "This is the demonstration file's example connection", so a prospect
// pressing Sync on the demo sees what would happen and nothing leaves.
// seed-demo.js asserts the demo holds no sealed credentials just before this
// runs, and this writes none.
"use strict";

async function seedParity2Qbo(q, ORG, { today }) {
  const funds = await q(`SELECT id, name, restricted FROM fin_funds WHERE org_id=$1 ORDER BY name`, [ORG]);
  const camps = await q(`SELECT id, name FROM campaigns WHERE org_id=$1 ORDER BY created_at ASC`, [ORG]);
  // Sandbox-shaped: QuickBooks ids are short integers per company, class ids
  // long ones. None of these is a real company's.
  const INCOME = [
    { accountId: "79", accountName: "Contributions Income:Individual Gifts" },
    { accountId: "80", accountName: "Contributions Income:Restricted Gifts" },
    { accountId: "81", accountName: "Contributions Income:Program Support" },
  ];
  const CLASSES = [
    { classId: "5000000000000041871", className: "Youth Arts" },
    { classId: "5000000000000041872", className: "Mentoring" },
  ];
  const fundMap = {};
  funds.forEach((f, i) => {
    if (i === funds.length - 1 && funds.length > 1) return;   // one left unmapped, on purpose
    const acct = f.restricted ? INCOME[1] : INCOME[0];
    fundMap[f.id] = { ...acct, ...(f.restricted ? CLASSES[i % CLASSES.length] : { classId: null, className: null }) };
  });
  fundMap.__none = { ...INCOME[0], classId: null, className: null };
  const campMap = {};
  const appeal = camps.find(c => /appeal|spring|year.end|giving/i.test(c.name)) || camps[0];
  if (appeal) campMap[appeal.id] = { ...INCOME[2], ...CLASSES[1] };
  const [y, m] = String(today).slice(0, 7).split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  const qbo = {
    mode: "salesreceipt", startDate: prev, demo: true,
    depositAccount: { id: "4", name: "Undeposited Funds" },
    feeAccount: { id: "93", name: "Merchant Account Fees" },
    funds: fundMap, campaigns: campMap, items: {},
  };
  await q(`UPDATE orgs SET qbo_sync_enabled=true, qbo_auto_sync=false WHERE id=$1`, [ORG]);
  const r = await q(
    `UPDATE bookkeeping_connections SET mapping = jsonb_set(COALESCE(mapping, '{}'::jsonb), '{qbo}', $2::jsonb),
            realm_id = COALESCE(realm_id, 'demo-realm'), updated_at = NOW()
      WHERE org_id=$1 AND vendor='quickbooks' AND status <> 'disconnected' RETURNING id`, [ORG, JSON.stringify(qbo)]);
  if (!r.length) throw new Error("PARITY-2 Part 5 seed: the demo has no QuickBooks connection row to map");
  const mapped = Object.keys(fundMap).filter(k => k !== "__none").length;
  console.log(`[assert] QuickBooks sync: on for the demo, ${mapped} of ${funds.length} funds mapped (one left blank on purpose), `
    + `${Object.keys(campMap).length} appeal mapped, Pending from ${prev} · example connection, sends nothing`);
}

module.exports = { seedParity2Qbo };

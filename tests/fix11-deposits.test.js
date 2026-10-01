// tests/fix11-deposits.test.js — FIX-11 Part 3. THE ONE GUARD THIS BUILD EARNED.
//
//     THE DEPOSITS FILE FOR A MONTH FOOTS TO THE CENT AGAINST GROSS MINUS
//     FEES, AND NO NON-CASH GIFT APPEARS IN IT.
//
// Both halves are the same promise about one number. A deposits file is a
// claim about a bank statement: these lines, added up, are what reached the
// account. If the fees are missing the claim is wrong by the fees; if a stock
// gift is inside a deposit the claim is wrong by the stock, and a bookkeeper
// who imports it has booked money the bank never saw. Either way the error is
// invisible, because the file still looks like a file.
//
// Jonathan's August export had no fee column at all — twenty-six card gifts,
// $11,478 — so its total could never have equalled the bank. It also carried
// stock and in-kind gifts in the same list as cash, and six TOTALS rows inside
// the CSV body, which a QuickBooks import reads as six transactions.
//
// WHAT IS ASSERTED:
//   §1  the file's own Amount column, added up, equals gross minus fees — read
//       out of the bytes that were written, not from the payload that made
//       them, because the bytes are what a bookkeeper imports
//   §2  every fee is a NEGATIVE NUMBER in the file, not a quoted string. The
//       CSV writer's formula guard prefixes a leading "-" in a TEXT cell with
//       an apostrophe, so `'-3.68` went out and QuickBooks reads it as text.
//       This is the assertion that caught it.
//   §3  no non-cash gift is in the deposits file, and all of them are in the
//       non-cash file, with their value
//   §4  no TOTALS row anywhere in either CSV body
//   §5  a cheque's number is stored and exported
//   §6  the three formats are the same money in different columns, and a
//       format Steward does not know is refused BY NAME
//   §7  the refusal fires: a month that does not foot writes no file
//   §8  org A's file holds nothing of org B's
//
// HOW IT WOULD GO RED: drop the fee from the group (§1); emit amounts as
// strings (§2); stop filtering non-cash out of the grouping (§3); put the
// totals back in the CSV (§4); read the cheque number from notes again (§5);
// fall back to the Steward columns for an unknown format (§6); remove the
// assertion (§7). Each was planted and watched.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");
const DEP = require("../depositsFile");

const A = "org_f11bkA", B = "org_f11bkB";
const PW = bcrypt.hashSync("loadtest1234", 10);
const MONTH = { from: "2026-08-01", to: "2026-08-31" };

async function wipe(orgId) {
  const tables = await q(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name='org_id' ORDER BY table_name`);
  for (const r of tables) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [orgId]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [orgId]).catch(() => {});
}

// A month with every shape in it: card money in two payouts with fees, a
// cheque-and-cash deposit sheet, a cheque with a number and one without, a
// stock gift and an in-kind gift, and two funds.
async function seedOrg(orgId, tag, scale = 1) {
  await wipe(orgId);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,$2,$3,1,'active','team')`, [orgId, "Books " + tag, "books-" + tag]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [`u_${orgId}`, orgId, `admin-${tag}@f11bk.local`, PW]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`, [`ffg_${orgId}`, orgId]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'Scholarship',true)`, [`ffs_${orgId}`, orgId]);
  await q(`INSERT INTO donors (id,org_id,name,email) VALUES ($1,$2,'Ada Petrossian','ada@f11bk.local')`, [`d_${orgId}`, orgId]);

  const g = async (id, amount, date, type, method, fundId, fee, cheque, depOn, depRef) =>
    q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,fund_id,
                          processor_fee_amount,check_number,deposited_on,deposit_ref,notes,
                          created_by,created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'u_test','Dana Reyes')`,
      [id, orgId, `d_${orgId}`, amount, date, type, method, fundId, fee, cheque, depOn, depRef,
       type === "stock" ? "40 shares of ACME" : type === "in kind" ? "A donated minibus" : null]);

  const S = scale;
  // payout one: two gifts, two funds, fees
  await g(`g_${orgId}_1`, 100 * S, "2026-08-03", "cash", "Card", `ffg_${orgId}`, 2.50, null, "2026-08-05", `po_${orgId}_1`);
  await g(`g_${orgId}_2`, 250 * S, "2026-08-04", "cash", "Card", `ffs_${orgId}`, 5.80, null, "2026-08-05", `po_${orgId}_1`);
  // payout two: one gift, a fee
  await g(`g_${orgId}_3`, 40 * S, "2026-08-10", "cash", "Card", `ffg_${orgId}`, 1.18, null, "2026-08-12", `po_${orgId}_2`);
  // a deposit sheet: two cheques (one numbered, one not) and cash, no fees
  await g(`g_${orgId}_4`, 500 * S, "2026-08-15", "check", "Check", `ffg_${orgId}`, 0, "1041", "2026-08-15", `sheet:2026-08-15`);
  await g(`g_${orgId}_5`, 75 * S, "2026-08-15", "check", "Check", `ffs_${orgId}`, 0, null, "2026-08-15", `sheet:2026-08-15`);
  await g(`g_${orgId}_6`, 20 * S, "2026-08-15", "cash", "Cash", `ffg_${orgId}`, 0, null, "2026-08-15", `sheet:2026-08-15`);
  // NON-CASH: revenue that never reached a bank, so NO deposit at all
  await g(`g_${orgId}_7`, 800 * S, "2026-08-18", "stock", "Stock", `ffs_${orgId}`, 0, null, null, null);
  await g(`g_${orgId}_8`, 300 * S, "2026-08-20", "in kind", "In kind", `ffg_${orgId}`, 0, null, null, null);
}

const CASH_GROSS = 100 + 250 + 40 + 500 + 75 + 20;       // 985.00
const FEES = 2.50 + 5.80 + 1.18;                          // 9.48
const NET = CASH_GROSS - FEES;                            // 975.52
const NON_CASH = 800 + 300;                               // 1100.00

const csv = async (path, token) => {
  const r = await fetch(BASE + path, { headers: { Authorization: "Bearer " + token } });
  return { status: r.status, text: await r.text(), cd: r.headers.get("content-disposition") };
};
const parse = text => text.trim().split(/\r?\n/).map(l => {
  // enough CSV for a file this suite wrote: quoted cells with escaped quotes
  const out = []; let cur = "", inQ = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (inQ) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c; }
    else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur); return out;
});

(async () => {
  console.log("fix11-deposits (FIX-11 Part 3)");
  await seedOrg(A, "a");
  await seedOrg(B, "b", 7);           // org B's numbers are deliberately different
  const tokA = await login("admin-a@f11bk.local");
  const tokB = await login("admin-b@f11bk.local");
  ok("fixture logins minted", !!tokA && !!tokB);
  if (!tokA) return summary();

  // ── §1 · THE FILE'S OWN COLUMN FOOTS TO GROSS MINUS FEES ────────────────
  const dep = await csv(`/reports/deposits?from=${MONTH.from}&to=${MONTH.to}&format=csv`, tokA);
  ok("§1 the deposits file was written", dep.status === 200 && /attachment/.test(dep.cd || ""), { status: dep.status });
  const depRows = parse(dep.text);
  const head = depRows[0];
  const amountCol = head.findIndex(h => /^Amount$/i.test(h));
  ok("§1 …with an Amount column", amountCol >= 0, { head });
  // Steward's own flavour writes a per-deposit total line as well as the
  // lines, so the footing is checked on the vendor file, which is one row per
  // line and nothing else — the shape a bookkeeper actually imports.
  const qb = await csv(`/reports/deposits?from=${MONTH.from}&to=${MONTH.to}&format=csv&flavour=quickbooks`, tokA);
  const qbRows = parse(qb.text);
  const qbAmt = qbRows[0].findIndex(h => /^Amount$/i.test(h));
  const sumCents = qbRows.slice(1).reduce((s, r) => s + Math.round(parseFloat(r[qbAmt]) * 100), 0);
  ok("§1 every line in the QuickBooks deposits file, added up, IS the net that reached the bank",
    sumCents === Math.round(NET * 100), { sumCents, expected: Math.round(NET * 100), rows: qbRows.length - 1 });

  // ── §2 · A FEE IS A NEGATIVE NUMBER, NOT A QUOTED STRING ────────────────
  const feeLines = qbRows.slice(1).filter(r => /Processing fees/i.test(r.join(" ")));
  ok("§2 the file carries a fee line per payout", feeLines.length === 2, { feeLines: feeLines.length });
  ok("§2 …each one negative", feeLines.every(r => parseFloat(r[qbAmt]) < 0),
    { amounts: feeLines.map(r => r[qbAmt]) });
  ok("§2 …and a NUMBER, not a string the formula guard quoted",
    feeLines.every(r => /^-\d+\.\d\d$/.test(r[qbAmt])) && !/'-/.test(qb.text),
    { amounts: feeLines.map(r => r[qbAmt]), hasApostrophe: /'-/.test(qb.text) });
  const feeTotal = feeLines.reduce((s, r) => s + Math.round(parseFloat(r[qbAmt]) * 100), 0);
  ok("§2 …adding up to exactly the fees that were charged", feeTotal === -Math.round(FEES * 100),
    { feeTotal, expected: -Math.round(FEES * 100) });

  // ── §3 · NO NON-CASH GIFT IS IN A DEPOSIT ───────────────────────────────
  ok("§3 the deposits file mentions no stock and no in-kind gift",
    !/stock/i.test(qb.text) && !/in kind/i.test(qb.text) && !/minibus/i.test(qb.text) && !/ACME/i.test(qb.text),
    { stock: /stock/i.test(qb.text), inKind: /in kind/i.test(qb.text) });
  const nc = await csv(`/reports/non-cash?from=${MONTH.from}&to=${MONTH.to}&format=csv`, tokA);
  const ncRows = parse(nc.text);
  ok("§3 …and BOTH of them are in the non-cash file", ncRows.length === 3, { rows: ncRows.length - 1 });
  const ncValue = ncRows[0].findIndex(h => /^Value$/i.test(h));
  const ncSum = ncRows.slice(1).reduce((s, r) => s + Math.round(parseFloat(r[ncValue]) * 100), 0);
  ok("§3 …at their full value, and that value is NOT in the deposits file",
    ncSum === Math.round(NON_CASH * 100) && sumCents !== Math.round((NET + NON_CASH) * 100),
    { ncSum, expected: Math.round(NON_CASH * 100) });
  ok("§3 …with a description of what was given",
    /ACME/.test(nc.text) && /minibus/i.test(nc.text), { sample: nc.text.slice(0, 200) });

  // ── §4 · NO TOTALS ROWS IN EITHER CSV BODY ──────────────────────────────
  const detail = await csv(`/reports/bookkeeper?from=${MONTH.from}&to=${MONTH.to}&format=csv`, tokA);
  const detailRows = parse(detail.text);
  // EIGHT gifts: six cash and both non-cash ones. The gift-detail file is the
  // full record of what was received, which is why it keeps the non-cash gifts
  // and marks them; it is the DEPOSITS file they must stay out of.
  ok("§4 the gift-detail CSV has one header row and then only gifts",
    detailRows.length === 9 && !detailRows.some(r => /^TOTAL/i.test(r[0] || "")),
    { rows: detailRows.length - 1, firstCells: detailRows.map(r => r[0]).slice(0, 10) });
  const cashCol = detailRows[0].findIndex(h => /Cash or non-cash/i.test(h));
  ok("§4 …and it marks which of them are non-cash",
    detailRows.slice(1).filter(r => r[cashCol] === "Non-cash").length === 2,
    { marks: detailRows.slice(1).map(r => r[cashCol]) });
  ok("§4 …and no TOTALS BY FUND section inside it",
    !/TOTALS BY FUND/i.test(detail.text));
  ok("§4 the deposits CSV has none either",
    !qbRows.some(r => /^TOTAL/i.test(r[0] || "")) && !/TOTALS BY FUND/i.test(qb.text));
  // The totals are not lost: they are on the payload the screen shows.
  const payload = await api("GET", `/reports/bookkeeper?from=${MONTH.from}&to=${MONTH.to}`, tokA);
  ok("§4 …because the totals are on the payload instead",
    payload.body.total === CASH_GROSS.toFixed(2) + ""
      || Math.round(payload.body.totalCents) === Math.round((CASH_GROSS + NON_CASH) * 100),
    { total: payload.body.total, totalCents: payload.body.totalCents });

  // ── §5 · THE CHEQUE NUMBER IS A FIELD ───────────────────────────────────
  const chkCol = detailRows[0].findIndex(h => /^Check number$/i.test(h));
  ok("§5 the gift-detail file has a Check number column", chkCol >= 0, { head: detailRows[0] });
  const numbered = detailRows.slice(1).filter(r => String(r[chkCol] || "").trim());
  ok("§5 …carrying the number that was recorded", numbered.length === 1 && numbered[0][chkCol] === "1041",
    { numbered: numbered.map(r => r[chkCol]) });
  ok("§5 …and the screen flags the cheque that has none",
    (payload.body.issues || []).some(i => i.key === "no_check_number" && i.count === 1),
    { issues: (payload.body.issues || []).map(i => i.key + ":" + i.count) });

  // ── §6 · ONE SET OF MONEY, THREE COLUMN SETS ────────────────────────────
  const xero = await csv(`/reports/deposits?from=${MONTH.from}&to=${MONTH.to}&format=csv&flavour=xero`, tokA);
  const xRows = parse(xero.text);
  const xAmt = xRows[0].findIndex(h => /Amount/i.test(h));
  const xSum = xRows.slice(1).reduce((s, r) => s + Math.round(parseFloat(r[xAmt]) * 100), 0);
  ok("§6 the Xero file is the same money in different columns", xSum === sumCents,
    { xSum, qbSum: sumCents, xeroHead: xRows[0] });
  ok("§6 …and the two files have different headings", xRows[0].join(",") !== qbRows[0].join(","));
  const bad = await csv(`/reports/deposits?from=${MONTH.from}&to=${MONTH.to}&format=csv&flavour=sage`, tokA);
  ok("§6 a format Steward does not know is refused by name, not silently swapped",
    bad.status === 400 && /sage/i.test(bad.text), { status: bad.status, body: bad.text.slice(0, 160) });

  // ── §7 · THE REFUSAL FIRES ──────────────────────────────────────────────
  // Proven on the pure layer, because the live schema cannot produce the
  // defect: NUMERIC(12,2) makes the row sum and the database sum agree by
  // construction, so a guard driven only through the app could never be shown
  // to work. Same reasoning as bookkeeper.js.
  const built = DEP.depositGroups([
    { cents: 10000, feeCents: 300, type: "cash", fund: "General", depositedOn: "2026-08-05", depositRef: "po_1" },
  ]);
  ok("§7 a correct month refuses nothing", DEP.depositsRefusals(built, 10000, 0).length === 0);
  ok("§7 a gross that disagrees is refused", DEP.depositsRefusals(built, 10001, 0).length === 1,
    { refusals: DEP.depositsRefusals(built, 10001, 0) });
  const torn = { ...built, groups: built.groups.map(g => ({ ...g, netCents: g.netCents + 1 })) };
  ok("§7 a net that is not gross minus fees is refused",
    DEP.depositsRefusals(torn, 10000, 0).some(r => /net/i.test(r)), { refusals: DEP.depositsRefusals(torn, 10000, 0) });
  const lost = { ...built, groups: built.groups.map(g => ({ ...g, lines: [{ fund: "General", cents: 9900 }] })) };
  ok("§7 a fund line that lost a gift is refused",
    DEP.depositsRefusals(lost, 10000, 0).some(r => /fund lines/i.test(r)), { refusals: DEP.depositsRefusals(lost, 10000, 0) });
  ok("§7 …and the refusal says nothing is wrong with the gifts",
    /nothing is wrong with your gifts/i.test(String(DEP.depositsRefusalMessage(DEP.depositsRefusals(torn, 10000, 0)))));

  // ── §8 · ONE ORG'S BOOKS ────────────────────────────────────────────────
  const bDep = await csv(`/reports/deposits?from=${MONTH.from}&to=${MONTH.to}&format=csv&flavour=quickbooks`, tokB);
  const bSum = parse(bDep.text).slice(1).reduce((s, r) => s + Math.round(parseFloat(r[qbAmt]) * 100), 0);
  ok("§8 org B's file is org B's money", bSum === Math.round((CASH_GROSS * 7 - FEES) * 100),
    { bSum, expected: Math.round((CASH_GROSS * 7 - FEES) * 100) });
  ok("§8 …and org A's file contains none of org B's references",
    !qb.text.includes(`po_${B}_1`) && !qb.text.includes(`sheet:2026-08-15,${B}`),
    { leak: qb.text.includes(`po_${B}_1`) });
  ok("§8 …and nothing of org B's is in org A's gift detail",
    !detail.text.includes(`g_${B}_1`), { leak: detail.text.includes(`g_${B}_1`) });

  await wipe(A); await wipe(B);
  await closeDb();
  summary();
})().catch(async e => {
  console.error(e);
  try { await closeDb(); } catch { /* already closed */ }
  process.exit(1);
});

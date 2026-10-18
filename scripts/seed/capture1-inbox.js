// scripts/seed/capture1-inbox.js · CAPTURE-1. HARBORLIGHT'S "TO CONFIRM" PILE,
// AND A MONTH OF GIFT-TO-THANK-YOU TIMES.
//
// Six cards, each from a committed, plainly fake document in
// tests/fixtures/capture1/ (written by scripts/capture1-make-fixtures.js):
//
//   · three checks photographed as one batch with their deposit slip, which
//     totals what the checks do ($1,825.00): one matched by the printed name,
//     one by name and address with a fund Steward is unsure of, one nobody
//     has a record of (New person, prefilled from the check);
//   · a pledge form (matched by email), and a donor-advised fund grant letter
//     (the fund is the giver, the advisor it names gets the soft credit);
//   · one address change, already applied and listed under "Done for you"
//     with Undo for thirty days.
//
// Nothing here records money: the five money cards are WAITING, exactly as a
// person would find them. What Steward "read" is stored the way the server
// stores a read, and never holds a routing or account number (the fixtures'
// MICR line is checked against every row this file writes).
//
// It also gives about forty of Harborlight's last-30-day gifts a received
// time and a thanked time, so the thank-yous screen's clock line shows a
// believable number. Idempotent: every row it owns starts `cap_b72demo_`.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { FIXTURES, FAKE_ROUTING, FAKE_ACCOUNT } = require("../capture1-make-fixtures");

const PRE = "cap_b72demo_";
const DIR = path.join(__dirname, "..", "..", "tests", "fixtures", "capture1");
const WHO = ["system:seed-demo", "The demonstration file"];
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const usd = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });

async function seedCapture1(q, ORG) {
  for (const t of ["capture_items", "capture_batches"]) {
    const [r] = await q(`SELECT to_regclass($1) AS t`, [t]);
    if (!r.t) throw new Error(`capture1 seed: table ${t} does not exist (db.js has not built it)`);
  }
  for (const c of ["received_at", "thanked_at"]) {
    const [r] = await q(`SELECT 1 AS ok FROM information_schema.columns WHERE table_name='gifts' AND column_name=$1`, [c]);
    if (!r) throw new Error(`capture1 seed: gifts.${c} does not exist`);
  }

  // ── start clean: only rows this file owns ─────────────────────────────────
  await q(`DELETE FROM capture_items WHERE org_id=$1 AND id LIKE $2`, [ORG, PRE + "%"]);
  await q(`DELETE FROM capture_batches WHERE org_id=$1 AND id LIKE $2`, [ORG, PRE + "%"]);

  const [org] = await q(`SELECT timezone, default_fund_id FROM orgs WHERE id=$1`, [ORG]);
  if (!org) throw new Error("capture1 seed: Harborlight is not there");
  const [gen] = await q(`SELECT id, name FROM fin_funds WHERE org_id=$1 AND name='General Operating'`, [ORG]);
  if (!gen) throw new Error("capture1 seed: Harborlight has no General Operating fund");
  const defaultFund = org.default_fund_id
    ? (await q(`SELECT id, name FROM fin_funds WHERE id=$1 AND org_id=$2`, [org.default_fund_id, ORG]))[0] || gen
    : gen;

  // The Building Fund the check memo and the pledge form both name.
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted,description) VALUES ($1,$2,'Building Fund',true,'The new boathouse and classroom.')
           ON CONFLICT (id) DO NOTHING`, [PRE + "fund_building", ORG]);
  const [building] = await q(`SELECT id, name FROM fin_funds WHERE org_id=$1 AND name='Building Fund'`, [ORG]);
  if (building.id !== PRE + "fund_building") throw new Error("capture1 seed: Harborlight already had a different Building Fund");

  // ── the people the documents name ─────────────────────────────────────────
  const person = async (key, name, { email = null, address = null, city = null, state = null, zip = null, kind = "person" } = {}) => {
    const id = PRE + key;
    await q(`INSERT INTO donors (id,org_id,name,email,address,city,state,zip,kind,status,stage,person_types,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active','donor','["donor"]'::jsonb,$10,$11)
             ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email, address=EXCLUDED.address, city=EXCLUDED.city,
               state=EXCLUDED.state, zip=EXCLUDED.zip, deleted_at=NULL`,
      [id, ORG, name, email, address, city, state, zip, kind, ...WHO]);
    return id;
  };
  const f1 = FIXTURES["check-1.png"], f2 = FIXTURES["check-2.png"], f3 = FIXTURES["check-3.png"];
  const pf = FIXTURES["pledge-form.pdf"], daf = FIXTURES["daf-letter.pdf"], ac = FIXTURES["address-change.png"];
  for (const [n] of [[f1.payer], [f2.payer], [f3.payer], [pf.donorName], [daf.fundOrg], [daf.advisorName], [ac.donorName]]) {
    const hit = await q(`SELECT id FROM donors WHERE org_id=$1 AND LOWER(name)=LOWER($2) AND id NOT LIKE $3 AND deleted_at IS NULL`, [ORG, n, PRE + "%"]);
    if (hit.length) throw new Error(`capture1 seed: Harborlight already has a ${n}, so the card's match would not be the one this seed describes`);
  }
  const margaret = await person("margaret", f1.payer, { email: "margaret.lindqvist@example.org", address: "18 Alder Lane", city: "Portland", state: "ME", zip: "04102" });
  const okafor = await person("okafor", f2.payer, { address: "7 Pier Street", city: "South Portland", state: "ME", zip: "04106" });
  await q(`DELETE FROM donors WHERE id=$1 AND org_id=$2`, [PRE + "hollis", ORG]);    // Hollis Tran is nobody Steward knows
  const sarah = await person("sarah", pf.donorName, { email: pf.email, city: "Portland", state: "ME" });
  const dafOrg = await person("daf", daf.fundOrg, { kind: "organisation", address: "PO Box 5500", city: "Example City", state: "MA", zip: "02100" });
  const james = await person("whitford", daf.advisorName, { email: "james.whitford@example.org", city: "Falmouth", state: "ME" });
  const OLD_ANA = { line1: "9 Cumberland Ave", city: "Portland", state: "ME", postal: "04101" };
  const ana = await person("ana", ac.donorName, { email: "ana.ruiz@example.org", address: ac.line1, city: ac.city, state: ac.state, zip: ac.postal });

  // ── the stored documents: private, the org's staff only ───────────────────
  const stored = {};
  for (const name of Object.keys(FIXTURES)) {
    const buf = fs.readFileSync(path.join(DIR, name));
    const type = name.endsWith(".pdf") ? "application/pdf" : "image/png";
    const id = "pa_" + sha(ORG + "|person|" + type + "|").slice(0, 8) + sha(buf).slice(0, 16);
    await q(`INSERT INTO portal_assets (id,org_id,kind,content_type,bytes,storage,data,is_public) VALUES ($1,$2,'person',$3,$4,'db',$5,false)
             ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, is_public = false`, [id, ORG, type, buf.length, buf.toString("base64")]);
    stored[name] = { id, type };
  }

  // ── the batch and its deposit slip ────────────────────────────────────────
  const BATCH = PRE + "batch1";
  const checksCents = f1.cents + f2.cents + f3.cents;
  if (checksCents !== FIXTURES["deposit-slip.png"].cents) throw new Error("capture1 seed: the fixture slip does not total its checks");
  await q(`INSERT INTO capture_batches (id,org_id,slip_asset_id,slip_cents,checks_cents,created_by,created_by_name,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW() - INTERVAL '50 minutes')`,
    [BATCH, ORG, stored["deposit-slip.png"].id, FIXTURES["deposit-slip.png"].cents, checksCents, ...WHO]);

  const item = async (key, o) => {
    await q(`INSERT INTO capture_items (id,org_id,kind,stakes,status,source,batch_id,asset_id,content_type,file_name,page,received_at,
               read,proposal,ai,headline,sentence,applied,undo_until,decided_at,decided_by,decided_by_name,created_by,created_by_name,created_at,donor_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW() - ($12 || ' minutes')::interval,$13::jsonb,$14::jsonb,'read',$15,$16,$17::jsonb,$18,$19,$20,$21,$22,$23,
                     NOW() - ($12 || ' minutes')::interval,$24)`,
      [PRE + key, ORG, o.kind, o.stakes, o.status || "waiting", o.source, o.batch || null, stored[o.file].id, stored[o.file].type, o.file, o.page || null,
        String(o.minutesAgo), JSON.stringify(o.read), JSON.stringify(o.proposal), o.headline, o.sentence,
        o.applied ? JSON.stringify(o.applied) : null, o.applied ? new Date(Date.now() + 30 * 86400000) : null,
        o.applied ? new Date(Date.now() - o.minutesAgo * 60000) : null, o.applied ? WHO[0] : null, o.applied ? "Steward" : null, ...WHO, o.donorId || null]);
  };
  const checkRead = f => ({ payer: f.payer, amountDigits: (f.cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","), amountWords: f.words,
    memo: f.memo, date: f.date, chequeNumber: f.number, line1: f.address.split(",")[0] });
  const settled = f => ({ cents: f.cents, settled: true, sentence: null });

  await item("check1", { kind: "check", stakes: "money", source: "photo", batch: BATCH, file: "check-1.png", minutesAgo: 48,
    read: checkRead(f1),
    proposal: { amount: settled(f1), date: "2026-10-12",
      donor: { state: "matched", selectedId: margaret, choices: [{ id: margaret, name: f1.payer, why: "the name printed on the check" }], prefill: null, by: "printed_name" },
      fund: { id: building.id, name: building.name, unsure: false, why: "the memo line says Building Fund" } },
    headline: `Log ${usd(f1.cents)} check from ${f1.payer}, Building Fund?`,
    sentence: `Check ${f1.number} from ${f1.payer} for ${usd(f1.cents)}, dated October 12. The figures and the words agree, and the memo names the Building Fund.` });
  await item("check2", { kind: "check", stakes: "money", source: "photo", batch: BATCH, file: "check-2.png", minutesAgo: 47,
    read: checkRead(f2),
    proposal: { amount: settled(f2), date: "2026-10-13",
      donor: { state: "matched", selectedId: okafor, choices: [{ id: okafor, name: f2.payer, why: "the name and street on the check" }], prefill: null, by: "name_address" },
      fund: { id: defaultFund.id, name: defaultFund.name, unsure: true, why: `the memo says "for the boathouse", which is not the name of a fund, so this is your default fund until you choose` } },
    headline: `Log ${usd(f2.cents)} check from ${f2.payer}, ${defaultFund.name}?`,
    sentence: `Check ${f2.number} from ${f2.payer} for ${usd(f2.cents)}. The figures and the words agree. The memo says "for the boathouse", so check the fund.` });
  await item("check3", { kind: "check", stakes: "money", source: "photo", batch: BATCH, file: "check-3.png", minutesAgo: 46,
    read: checkRead(f3),
    proposal: { amount: settled(f3), date: "2026-10-14",
      donor: { state: "new", selectedId: null, choices: [], by: null,
        prefill: { name: f3.payer, email: "", line1: "302 Fore Street Apt 4", city: "Portland", state: "ME", postal: "04101" } },
      fund: { id: defaultFund.id, name: defaultFund.name, unsure: true, why: "the memo line is blank, so this is your default fund" } },
    headline: `Log ${usd(f3.cents)} check from ${f3.payer} (new person), ${defaultFund.name}?`,
    sentence: `Check ${f3.number} from ${f3.payer} for ${usd(f3.cents)}. Steward has nobody by this name, so confirming adds them with the address on the check.` });
  await item("pledge", { kind: "pledge", stakes: "money", source: "email", file: "pledge-form.pdf", page: 1, minutesAgo: 190,
    read: { donorName: pf.donorName, email: pf.email, fundName: pf.fundName, frequency: pf.frequency, installments: pf.installments, startDate: pf.startDate,
      amountDigits: "5,000.00" },
    proposal: { amount: { cents: pf.cents, settled: true, sentence: null }, date: pf.startDate,
      pledge: { frequency: pf.frequency, installments: pf.installments, startDate: pf.startDate },
      donor: { state: "matched", selectedId: sarah, choices: [{ id: sarah, name: pf.donorName, why: "the email on the form" }], prefill: null, by: "email" },
      fund: { id: building.id, name: building.name, unsure: false, why: "the form names the Building Fund" } },
    headline: `Log ${usd0(pf.cents)} pledge from ${pf.donorName}, paid quarterly, Building Fund?`,
    sentence: `A pledge form from ${pf.donorName}: ${usd0(pf.cents)} to the Building Fund, four quarterly payments of ${usd0(pf.cents / 4)} starting November 1.` });
  await item("daf", { kind: "daf_grant", stakes: "money", source: "forward", file: "daf-letter.pdf", page: 1, minutesAgo: 320,
    read: { donorName: daf.fundOrg, advisorName: daf.advisorName, fundName: daf.fundName, amountDigits: "2,000.00", date: daf.date, grantNumber: daf.grantNumber },
    proposal: { amount: { cents: daf.cents, settled: true, sentence: null }, date: "2026-10-09",
      donor: { state: "matched", selectedId: dafOrg, choices: [{ id: dafOrg, name: daf.fundOrg, why: "the fund's name on the letter" }], prefill: null, by: "printed_name" },
      advisor: { state: "matched", selectedId: james, id: james, name: daf.advisorName, choices: [{ id: james, name: daf.advisorName, why: "the advisor the letter names" }] },
      fund: { id: gen.id, name: gen.name, unsure: false, why: "the letter designates General Operating" } },
    headline: `Log ${usd0(daf.cents)} grant from ${daf.fundOrg}, recommended by ${daf.advisorName}, General Operating?`,
    sentence: `A donor-advised fund grant of ${usd0(daf.cents)} from ${daf.fundOrg}. The gift is from the fund; ${daf.advisorName}, who recommended it, gets the soft credit.` });
  // Already applied: the record carries the new address, the card holds the old.
  await item("address", { kind: "address_change", stakes: "low", status: "applied", source: "photo", file: "address-change.png", minutesAgo: 75,
    read: { donorName: ac.donorName, line1: ac.line1, city: ac.city, state: ac.state, postal: ac.postal },
    proposal: { donor: { state: "matched", selectedId: ana, choices: [{ id: ana, name: ac.donorName, why: "the name on the note" }], prefill: null, by: "printed_name" } },
    donorId: ana,
    applied: { table: "donors", donorId: ana, field: "address",
      before: { address: OLD_ANA.line1, city: OLD_ANA.city, state: OLD_ANA.state, zip: OLD_ANA.postal },
      after: { address: ac.line1, city: ac.city, state: ac.state, zip: ac.postal },
      summary: `Updated ${ac.donorName}'s address to ${ac.line1}, ${ac.city} ${ac.state} ${ac.postal}.` },
    headline: `Update ${ac.donorName}'s address`,
    sentence: `A note from ${ac.donorName} asking Harborlight to change the address on file to ${ac.line1}, ${ac.city} ${ac.state} ${ac.postal}.` });

  // Nothing this file wrote may carry the fixture's bank numbers.
  const leak = await q(`SELECT id FROM capture_items WHERE org_id=$1 AND id LIKE $2 AND (capture_items::text LIKE $3 OR capture_items::text LIKE $4)`,
    [ORG, PRE + "%", "%" + FAKE_ROUTING + "%", "%" + FAKE_ACCOUNT + "%"]);
  if (leak.length) throw new Error(`capture1 seed: a card holds the fixture's routing or account number: ${leak.map(r => r.id).join(", ")}`);

  // ── a month of gift-to-thank-you times ────────────────────────────────────
  const tz = org.timezone || "America/New_York";
  const gifts = await q(
    `SELECT g.id, g.date FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
      WHERE g.org_id=$1 AND d.deleted_at IS NULL AND g.date ~ '^\\d{4}-\\d{2}-\\d{2}$'
        AND g.date::date >= (NOW() AT TIME ZONE $2)::date - 29 AND g.date::date <= (NOW() AT TIME ZONE $2)::date
      ORDER BY g.date, g.id LIMIT 48`, [ORG, tz]);
  if (gifts.length < 30) throw new Error(`capture1 seed: Harborlight has only ${gifts.length} gifts in the last 30 days`);
  // Hours from received to thanked: mostly a day or three, a few slow ones,
  // and null = not thanked yet. Repeats in order; no randomness.
  const DELAYS = [20, 30, 44, 52, 26, 70, 96, 38, 60, 210, 48, 34, 120, 56, 28, null, 66, 40, 150, 46, null, 72, 24, 58];
  for (const [i, g] of gifts.entries()) {
    const h = DELAYS[i % DELAYS.length];
    const hourOfDay = 9 + (i * 7) % 8;
    await q(`UPDATE gifts SET received_at = LEAST(NOW(), (($3::date + ($4 || ' hours')::interval) AT TIME ZONE $5)),
                              thanked_at = CASE WHEN $6::int IS NULL THEN NULL
                                ELSE LEAST(NOW(), LEAST(NOW(), (($3::date + ($4 || ' hours')::interval) AT TIME ZONE $5)) + ($6::int || ' hours')::interval) END
              WHERE id=$1 AND org_id=$2`, [g.id, ORG, g.date, String(hourOfDay), tz, h]);
  }
  const [avg] = await q(
    `SELECT COUNT(*)::int AS n, ROUND(AVG(EXTRACT(EPOCH FROM (thanked_at - received_at)) / 86400)::numeric, 1)::text AS days
       FROM gifts WHERE org_id=$1 AND thanked_at IS NOT NULL AND received_at IS NOT NULL
        AND received_at >= NOW() - INTERVAL '30 days'`, [ORG]);
  const [waiting] = await q(`SELECT COUNT(*)::int AS n FROM capture_items WHERE org_id=$1 AND status='waiting'`, [ORG]);
  if (waiting.n !== 5) throw new Error(`capture1 seed: ${waiting.n} cards are waiting, not 5`);
  console.log(`[seed] capture-1: ${waiting.n} cards waiting in To confirm (3 checks in a batch that matches its $1,825.00 slip, a pledge form, a DAF letter) + 1 address change done for you; gift-to-thank-you over ${avg.n} thanked gifts in 30 days averages ${avg.days} days.`);
  return { waiting: waiting.n, avgDays: Number(avg.days), thanked: avg.n };
}

module.exports = { seedCapture1, PRE };

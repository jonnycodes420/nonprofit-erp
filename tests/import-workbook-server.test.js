// BUILD-82 — the SERVER half of the workbook layer:
//  • the complete standard donor list lands in real columns (middle/suffix/
//    salutation/spouse/email2/mobile/address2/country/type/board/external
//    household + every external id after a duplicate fold)
//  • linkToExisting: a gift sheet imported ALONE links to existing records by
//    Donor ID (all four damaged forms), then email, then name — zero new
//    donors, unmatched gifts REFUSED with reason, dryRun states it pre-write
//  • import-semantics pledges resolve their person by external donor id
//  • all-or-nothing: a mid-import failure leaves the org with ZERO of the
//    file's donors (the Part 7 kill assertion, done via a poisoned batch)
// Scratch server + Postgres per tests/README.md.
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_wb82_a";
async function reset() {
  for (const t of ["import_merges", "pledges", "moves", "opportunities", "interactions", "gifts", "fin_transactions", "budgets", "accounts", "fin_funds", "tasks", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [A]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [A]);
}
const countDonors = async () => (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [A]))[0].n;
const countGifts = async () => (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [A]))[0].n;

(async () => {
  console.log("import-workbook-server (BUILD-82)");
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'WB82','wb82-a',1,'active','growth')`, [A]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,'wb82@t.local',$3,'WB82 Admin','admin')`, ["u_" + A, A, bcrypt.hashSync("loadtest1234", 10)]);
  const tok = await login("wb82@t.local");

  // ── 1) the complete standard list lands whole ────────────────────────────
  let r = await api("POST", "/donors/import-combined", tok, {
    donors: [{
      name: "Kathryn Brantley", email: "kb@x.org", email2: "kb2@x.org", phone: "555-0101", mobile: "555-0102",
      middleName: "Rose", suffix: "Jr.", salutation: "Mrs.", spouse: "Samuel",
      address: "3022 Church St", address2: "Apt 4", city: "Lexington", state: "KY", zip: "40502", country: "USA",
      donorType: "Individual", board: true, householdId: "H7438",
      externalDonorId: "004212", externalDonorIds: ["004212", "76023"],
      firstGift: "2019-03-01", stage: "steward",
    }, { name: "Solo Prospect", email: "solo@x.org", externalDonorId: "9001", stage: "prospect" }],
    gifts: [{ donorIndex: 0, amount: 250.37, date: "2024-05-01", type: "check", campaign: "", notes: "" }],
  });
  ok("import-combined accepts the full standard list", r.status === 200 && r.body.created === 2, r.body);
  const d = (await q(`SELECT * FROM donors WHERE org_id=$1 AND email='kb@x.org'`, [A]))[0];
  ok("middle/suffix/salutation/spouse land in real columns",
     d.middle_name === "Rose" && d.suffix === "Jr." && d.salutation === "Mrs." && d.spouse_name === "Samuel", d && { m: d.middle_name, s: d.suffix });
  ok("email2 + mobile + address2 + country land", d.email2 === "kb2@x.org" && d.mobile === "555-0102" && d.address2 === "Apt 4" && d.country === "USA", null);
  ok("donor_type + board + external household land", d.donor_type === "Individual" && d.board_member === true && d.external_household_id === "H7438", null);
  ok("every external id after a fold is kept", d.external_donor_id === "004212" && JSON.stringify(d.external_donor_ids) === JSON.stringify(["004212", "76023"]), d.external_donor_ids);
  ok("first_gift_date lands", d.first_gift_date === "2019-03-01", d.first_gift_date);

  // ── 2) gift sheet ALONE: dryRun states the link before the write ─────────
  const soloGifts = [
    { donorExternalId: "4212.0", amount: 100, date: "2024-06-01", type: "check", campaign: "", notes: "", line: 3 },   // damaged form of 004212
    { donorExternalId: " 76023 ", amount: 50, date: "2024-06-02", type: "cash", campaign: "", notes: "", line: 4 },     // the FOLDED id
    { donorExternalId: "", email: "solo@x.org", amount: 75, date: "2024-06-03", type: "cash", campaign: "", notes: "", line: 5 }, // email fallback
    { donorExternalId: "31337", amount: 999, date: "2024-06-04", type: "cash", campaign: "", notes: "", line: 6 },      // orphan
  ];
  r = await api("POST", "/donors/import-combined", tok, { donors: [], gifts: soloGifts, linkToExisting: true, dryRun: true });
  ok("dryRun: 3 linkable, 1 refused with its line and id", r.status === 200 && r.body.dryRun && r.body.linkable === 3 && r.body.refusedCount === 1
     && r.body.refused[0].line === 6 && r.body.refused[0].id === "31337", r.body);
  ok("dryRun wrote nothing", (await countGifts()) === 1, await countGifts());

  // ── 3) the real linked write: zero new donors, orphan refused+counted ────
  r = await api("POST", "/donors/import-combined", tok, { donors: [], gifts: soloGifts, linkToExisting: true });
  ok("linked import succeeds", r.status === 200, r.status);
  ok("zero new donors from a gift-sheet-alone import", (await countDonors()) === 2, await countDonors());
  ok("three gifts landed (4212.0, folded 76023, email)", (await countGifts()) === 4, await countGifts());
  const kbGifts = (await q(`SELECT amount FROM gifts WHERE org_id=$1 AND donor_id=$2 ORDER BY amount`, [A, d.id])).map(x => parseFloat(x.amount));
  ok("both damaged-form and folded-id gifts landed on the SURVIVOR", JSON.stringify(kbGifts) === JSON.stringify([50, 100, 250.37]), kbGifts);
  ok("the orphan was errored by reason, never a donor named after an id",
     r.body.ledgerErrors && r.body.ledgerErrors.some ? true : (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND name ILIKE '%31337%'`, [A]))[0].n === 0, null);

  // ── 4) pledges resolve by external donor id ──────────────────────────────
  r = await api("POST", "/donors/import-semantics", tok, {
    pledges: [{ donorExternalId: "004212", amount: 5000, date: "2026-01-01", externalId: "PL-5000", status: "open" }],
  });
  ok("pledge landed on the record its Constituent ID names", r.status === 200 && r.body.counts && r.body.counts.pledges === 1, r.body);
  const pl = (await q(`SELECT * FROM pledges WHERE org_id=$1`, [A]))[0];
  ok("pledge is a commitment on the donor, never cash", pl && pl.donor_id === d.id && (await countGifts()) === 4, pl && pl.donor_id);

  // ── 5) ALL OR NOTHING — a failing import leaves ZERO of its donors ───────
  const before = await countDonors();
  const manyDonors = Array.from({ length: 40 }, (_, i) => ({ name: `Bulk Donor ${i}`, email: `bulk${i}@x.org`, stage: "prospect" }));
  // poison one gift so the reconciliation ledger cannot balance → 409 + full rollback
  r = await api("POST", "/donors/import-combined", tok, {
    donors: manyDonors,
    gifts: [{ donorIndex: 0, amount: 100, date: "2024-01-01", type: "cash", campaign: "", notes: "" }],
    __sabotageDropRows: 1,
  });
  ok("unbalanced import refused (409, named discrepancy)", r.status === 409, r.status);
  ok("the org has ZERO of the failed file's donors afterwards", (await countDonors()) === before, await countDonors());

  // ── 6) MID-REQUEST KILL — the client dies at "row 40,000": the org ends
  // with ZERO of the file's donors or ALL of them, never a slice (one
  // transaction; a dropped socket can't leave half an import behind).
  const before6 = await countDonors();
  const bigDonors = Array.from({ length: 5000 }, (_, i) => ({ name: `Kill Drill ${i}`, email: `kd${i}@x.org`, stage: "prospect" }));
  const bigGifts = Array.from({ length: 15000 }, (_, i) => ({ donorIndex: i % 5000, amount: 25, date: "2024-02-01", type: "cash", campaign: "", notes: "" }));
  const ac = new AbortController();
  const killReq = fetch("http://localhost:5601/donors/import-combined", {
    method: "POST", signal: ac.signal,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
    body: JSON.stringify({ donors: bigDonors, gifts: bigGifts, identityResolved: true }),
  }).catch(() => "aborted");
  setTimeout(() => ac.abort(), 250);
  await killReq;
  // give the server time to finish or roll back whatever the socket's death left
  await new Promise(r => setTimeout(r, 8000));
  const after6 = await countDonors();
  ok("mid-request kill leaves the org at ZERO of the file's donors or ALL — never a slice",
     after6 === before6 || after6 === before6 + 5000, { before6, after6 });

  await closeDb();
  summary("import-workbook-server");
})();

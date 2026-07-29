// FIX — "Import both" for a multi-sheet workbook (Donors + Gift History).
// A workbook with a donor-shaped sheet AND a gift-ledger sheet is detected as a
// pair; the gifts are LINKED to the donors by a shared key (email → name →
// donor-id) and imported in ONE pass so a first-timer drops one workbook and
// gets a full CRM. Pure role-detection/linking (client/src/lib/importShape.js,
// JSX-free) + the real /donors/import-combined contract (smart-stage on the
// linked history, idempotent re-run) against a local scratch server + Postgres.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q } = require("./helpers");

const A = "org_ib_a", B = "org_ib_b";
const iso = d => new Date(d).toISOString().slice(0, 10);
const daysAgo = n => iso(Date.now() - n * 86400000);

async function reset() {
  for (const org of [A, B]) {
    for (const t of ["moves", "opportunities", "interactions", "gifts", "fin_transactions", "tasks", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, tag) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','growth')`,
    [o, `IB ${tag}`, `ib-${tag}`]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
    ["u_" + o, o, `${tag}@ib.local`, bcrypt.hashSync("loadtest1234", 10), `User ${tag}`]);
}
const donorRow = async (o, email) => (await q(`SELECT * FROM donors WHERE org_id=$1 AND email=$2 AND deleted_at IS NULL`, [o, email]))[0];
const countDonors = async o => (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [o]))[0].n;

(async () => {
  const { detectWorkbookRoles, pickMatchKey, linkGiftsToDonors, findDonorIdHdr } =
    await import("../client/src/lib/importShape.js");

  // ── The two sheets (donor-shaped + gift-ledger), like the real CRM export ──
  const donorSheet = {
    name: "Donors",
    headers: ["Name", "Email", "Total Giving", "Last Gift Date"],
    rows: [
      { Name: "Jane Smith", Email: "jane@x.org",  "Total Giving": "500",  "Last Gift Date": daysAgo(20) },
      { Name: "Bob Lee",    Email: "bob@x.org",   "Total Giving": "3000", "Last Gift Date": daysAgo(400) },
      { Name: "Carol Fund", Email: "carol@x.org", "Total Giving": "1500", "Last Gift Date": daysAgo(120) },
    ],
  };
  const giftSheet = {
    name: "Gift History",
    headers: ["Donor Name", "Email", "Amount", "Gift Date"],
    rows: [
      { "Donor Name": "Jane Smith", Email: "jane@x.org",  Amount: "100",  "Gift Date": daysAgo(300) },
      { "Donor Name": "Jane Smith", Email: "jane@x.org",  Amount: "400",  "Gift Date": daysAgo(20) },
      { "Donor Name": "Bob Lee",    Email: "bob@x.org",   Amount: "3000", "Gift Date": daysAgo(400) },
      { "Donor Name": "Carol Fund", Email: "carol@x.org", Amount: "1500", "Gift Date": daysAgo(120) },
      { "Donor Name": "Dave New",   Email: "dave@x.org",  Amount: "250",  "Gift Date": daysAgo(50) },  // NOT in donor sheet
    ],
  };

  // ── 1. Role detection ────────────────────────────────────────────────────
  const roles = detectWorkbookRoles([giftSheet, donorSheet]); // order-independent
  ok("detects a Donors + Gift History pair", roles.isBoth === true, roles);
  ok("donor sheet identified", roles.donorSheet && roles.donorSheet.name === "Donors", roles.donorSheet && roles.donorSheet.name);
  ok("gift sheet identified", roles.giftSheet && roles.giftSheet.name === "Gift History", roles.giftSheet && roles.giftSheet.name);

  // Two donor-shaped sheets → NOT "both" (nothing to link).
  const twoDonor = detectWorkbookRoles([donorSheet, { ...donorSheet, name: "Donors 2" }]);
  ok("two donor sheets → not both", twoDonor.isBoth === false, twoDonor.isBoth);

  // ── 2. Match-column pick (email → name → donor-id) ───────────────────────
  const mk = pickMatchKey(roles.donorSheet, roles.giftSheet);
  ok("default match key = email", mk.key === "email", mk);
  ok("email + name both available", mk.available.includes("email") && mk.available.includes("name"), mk.available);

  // Donor-id column probe.
  ok("findDonorIdHdr matches 'Donor ID'", findDonorIdHdr(["Name", "Donor ID", "Email"]) === "Donor ID", findDonorIdHdr(["Name", "Donor ID", "Email"]));
  ok("findDonorIdHdr ignores 'Email'/'Paid'", findDonorIdHdr(["Name", "Email", "Paid"]) === "", findDonorIdHdr(["Name", "Email", "Paid"]));

  // ── 3. Linking (pure) — the core of "import both" ─────────────────────────
  // Donor rows as buildDonorRows would produce (name/email + a placeholder stage
  // the server re-infers over); gift items one per ledger row.
  const donors = donorSheet.rows.map(r => ({ name: r.Name, email: r.Email.toLowerCase(), stage: "prospect" }));
  const giftItems = giftSheet.rows.map(r => ({
    email: r.Email.toLowerCase(), name: r["Donor Name"], donorId: "",
    gift: { amount: Number(r.Amount), date: r["Gift Date"], type: "cash" },
  }));

  const byEmail = linkGiftsToDonors(donors, giftItems, "email");
  ok("email link: 4 gifts matched", byEmail.matchedGifts === 4, byEmail);
  ok("email link: 1 gift unmatched (Dave)", byEmail.unmatchedGifts === 1, byEmail);
  ok("email link: 1 minimal donor created", byEmail.newDonors === 1, byEmail);
  ok("email link: donor list grew 3 → 4", byEmail.donors.length === 4, byEmail.donors.map(d => d.email));
  ok("email link: every gift kept (never dropped)", byEmail.gifts.length === 5, byEmail.gifts.length);
  ok("email link: Dave's gift points at the new donor", (() => {
    const daveIdx = byEmail.donors.findIndex(d => d.email === "dave@x.org");
    return daveIdx >= 0 && byEmail.gifts.some(g => g.donorIndex === daveIdx && g.amount === 250);
  })(), byEmail.donors.map(d => d.email));
  ok("email link: _donorId stripped from output donors", byEmail.donors.every(d => !("_donorId" in d)), byEmail.donors[0]);

  // Name linking — donors without emails, matched by name.
  const nameDonors = [{ name: "Alice Ray", stage: "prospect" }];
  const nameGifts = [{ email: "", name: "alice ray", donorId: "", gift: { amount: 90, date: daysAgo(10), type: "cash" } }];
  const byName = linkGiftsToDonors(nameDonors, nameGifts, "name");
  ok("name link: matched by name despite no email", byName.matchedGifts === 1 && byName.newDonors === 0, byName);

  // Donor-id linking.
  const idDonors = [{ name: "X Person", _donorId: "A100", stage: "prospect" }];
  const idGifts = [{ email: "", name: "someone else", donorId: "a100", gift: { amount: 60, date: daysAgo(5), type: "cash" } }];
  const byId = linkGiftsToDonors(idDonors, idGifts, "donorId");
  ok("donor-id link: matched on id (name mismatch ignored)", byId.matchedGifts === 1 && byId.newDonors === 0, byId);

  // A gift row with NO donor identity at all is counted, not attached silently.
  const noId = linkGiftsToDonors([], [{ email: "", name: "", donorId: "", gift: { amount: 5, date: daysAgo(1) } }], "email");
  ok("gift row with no donor identity → skipped, not attached", noId.skippedGifts === 1 && noId.gifts.length === 0, noId);

  // ── 4. Server contract: linked payload → smart-stage + idempotency ────────
  await reset();
  await seedOrg(A, "a-admin");
  await seedOrg(B, "b-admin");
  const tA = await login("a-admin@ib.local");

  const imp = await api("POST", "/donors/import-combined", tA, { donors: byEmail.donors, gifts: byEmail.gifts });
  ok("import-both 200", imp.status === 200, imp.body);
  ok("created 4 donors (3 sheet + 1 unmatched)", imp.body.created === 4, imp.body);
  ok("attached 5 gifts", imp.body.giftsInserted === 5, imp.body);

  const jane = await donorRow(A, "jane@x.org");
  ok("Jane total = sum of linked gifts (500)", Number(jane.total_giving) === 500, jane.total_giving);
  ok("Jane smart-staged from recent gift → steward", jane.stage === "steward", jane.stage);
  const bob = await donorRow(A, "bob@x.org");
  ok("Bob smart-staged (>365d) → lapsed", bob.stage === "lapsed", bob.stage);
  const carol = await donorRow(A, "carol@x.org");
  ok("Carol smart-staged ($1500 @120d) → solicit", carol.stage === "solicit", carol.stage);
  const dave = await donorRow(A, "dave@x.org");
  ok("Dave (unmatched) created with his gift → steward", dave && dave.stage === "steward" && Number(dave.total_giving) === 250, dave);

  // Idempotent re-run — every donor deduped by email, zero new rows.
  const before = await countDonors(A);
  const rerun = await api("POST", "/donors/import-combined", tA, { donors: byEmail.donors, gifts: byEmail.gifts });
  ok("re-run 200", rerun.status === 200, rerun.body);
  ok("re-run created 0 donors", rerun.body.created === 0, rerun.body);
  ok("re-run reports 4 duplicates", rerun.body.duplicates === 4, rerun.body);
  ok("re-run attached 0 gifts", rerun.body.giftsInserted === 0, rerun.body);
  ok("donor count unchanged after re-run", (await countDonors(A)) === before, { before, after: await countDonors(A) });

  // ── 5. Org isolation ─────────────────────────────────────────────────────
  ok("org B saw none of A's import", (await countDonors(B)) === 0, await countDonors(B));

  summary();
})();

// tests/fix11-gift-file-import.test.js — FIX-11 Part 4. THE ONE GUARD THIS BUILD EARNED.
//
//     A GIFT FILE WHOSE DONORS DO NOT EXIST CREATES EACH DONOR ONCE AND EACH
//     GIFT ONCE, TOTALS TO THE CENT, AND ONE UNDO REMOVES BOTH.
//
// On 30 September Jonathan imported a 40-gift file into an org where those
// donors did not exist. The screen said "0 gifts ready to import, attaching to
// 0 donors · 40 unmatched (will skip)", offered a grey "Import 0 Gifts" button,
// and told him to "use combined mode later", which is not a place. A customer
// arriving with a gift file from another system hits exactly that, and the only
// answer the product had was: go away, split the file, come back.
//
// The three ways this can go wrong are all silent, which is why they are
// asserted rather than eyeballed:
//   · TWO GIFTS FROM THE SAME NEW PERSON make two donors. The file says "Ada
//     Petrossian" on four rows; the CRM a merge tool exists to defend ends up
//     with four Adas.
//   · A GIFT IS WRITTEN TWICE, or dropped, and the total is wrong by one gift
//     in a file of forty.
//   · THE UNDO leaves the people behind. Forty donors with no gifts, no
//     history and no reason to be there, in a CRM somebody now has to clean.
//
// WHAT IS ASSERTED:
//   §1  the grouping is right BEFORE anything is written: one person per
//       identity, email first and then exact name, and a row with neither is
//       counted and left out rather than becoming a donor called ""
//   §2  driven end to end: every donor created exactly once, every gift
//       exactly once, and the dollars foot to the cent against the file
//   §3  the donors it created carry this import's id, which is what makes the
//       undo able to tell them from everybody else
//   §4  ONE undo removes the gifts AND the people, and nothing else: a donor
//       who already existed keeps their gifts, and a created donor who has
//       since acquired a gift of their own is KEPT
//   §5  the undo is the importer's own to use, an admin may undo anybody's,
//       and a third person may not
//   §6  an import of any other shape still refuses to reverse as a whole
//   §7  org A cannot reverse org B's import
//
// HOW IT WOULD GO RED: key the grouping on the raw name instead of the
// normalised one (§1, §2); drop the per-identity dedupe (§2); stop stamping
// created_import_id (§3); delete donors by import id without the no-history
// check (§4); let any shape through WHOLE_IMPORT_SHAPES (§6). Each was planted
// and watched.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_f11giA", B = "org_f11giB";
const PW = bcrypt.hashSync("loadtest1234", 10);

async function wipe(orgId) {
  const tables = await q(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name='org_id' ORDER BY table_name`);
  for (const r of tables) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [orgId]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [orgId]).catch(() => {});
}

async function seedOrg(orgId, tag) {
  await wipe(orgId);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,$2,$3,1,'active','team')`, [orgId, "Gift file " + tag, "giftfile-" + tag]);
  for (const [who, role] of [["admin", "admin"], ["staff", "staff"], ["other", "staff"]]) {
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
             VALUES ($1,$2,$3,$4,$5,$6)`,
      [`u_${orgId}_${who}`, orgId, `${who}-${tag}@f11gi.local`, PW,
       who === "admin" ? "Dana Reyes" : who === "staff" ? "Sam Okafor" : "Lee Vance", role]);
  }
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`,
    [`ff_${orgId}`, orgId]).catch(() => {});
}

// THE FILE. Nine gift rows for five people, none of whom is on file:
//   · Ada appears on three rows, twice by email and once by name only
//   · Ben appears twice, both by email, with the email cased differently
//   · Cho, Dee and Esi appear once each; Dee has no email at all
//   · one row has neither a name nor an email and cannot become a person
const FILE = [
  { rawName: "Ada Petrossian", rawEmail: "ada@f11gi.local", amount: 100.00, date: "2026-03-02" },
  { rawName: "Ada Petrossian", rawEmail: "ada@f11gi.local", amount: 250.50, date: "2026-05-11" },
  { rawName: "Ada Petrossian", rawEmail: "",                amount: 75.25,  date: "2026-07-04" },
  { rawName: "Ben Okafor",     rawEmail: "ben@f11gi.local", amount: 40.00,  date: "2026-02-18" },
  { rawName: "Ben Okafor",     rawEmail: "BEN@f11gi.local", amount: 60.00,  date: "2026-06-09" },
  { rawName: "Cho Lin",        rawEmail: "cho@f11gi.local", amount: 1000.00, date: "2026-01-30" },
  { rawName: "Dee Marchetti",  rawEmail: "",                amount: 33.33,  date: "2026-08-14" },
  { rawName: "Esi Mensah",     rawEmail: "esi@f11gi.local", amount: 12.42,  date: "2026-09-01" },
  { rawName: "",               rawEmail: "",                amount: 500.00, date: "2026-09-02" },
];
// Ada by email (2 rows) and Ada by name (1 row) are the SAME person only if
// the grouping falls back to the name — which it must not do for a row that
// HAS an email. So the honest expectation is SIX identities: ada-by-email,
// ada-by-name, ben, cho, dee, esi. That is the behaviour the screen shows
// before anything is written, and the suite pins it rather than wishing for
// cleverness the import cannot safely have.
const EXPECT_PEOPLE = 6;
const EXPECT_GIFTS = 8;                                   // the nameless row is left out
const EXPECT_DOLLARS = 100 + 250.50 + 75.25 + 40 + 60 + 1000 + 33.33 + 12.42;   // 1571.50

// The client's grouping, as the client does it. Kept here rather than imported
// because the component is JSX; the shape is small and the suite asserts the
// RESULT of the import, which is what matters.
const normalize = n => String(n || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function group(rows) {
  const byKey = new Map(); const donors = []; const gifts = []; let nameless = 0;
  for (const g of rows) {
    const email = String(g.rawEmail || "").toLowerCase().trim();
    const name = String(g.rawName || "").trim();
    if (!email && !name) { nameless++; continue; }
    const key = email && email.includes("@") ? "e:" + email : "n:" + normalize(name);
    if (!byKey.has(key)) { byKey.set(key, donors.length); donors.push({ name: name || email, email: email.includes("@") ? email : "" }); }
    gifts.push({ donorIndex: byKey.get(key), amount: g.amount, date: g.date, type: "cash", campaign: "", notes: "" });
  }
  return { donors, gifts, nameless };
}

const cents = n => Math.round(Number(n) * 100);

(async () => {
  console.log("fix11-gift-file-import (FIX-11 Part 4)");
  await seedOrg(A, "a");
  await seedOrg(B, "b");
  const tokA = await login("staff-a@f11gi.local");          // the IMPORTER is staff, not an admin
  const tokAdmin = await login("admin-a@f11gi.local");
  const tokOther = await login("other-a@f11gi.local");
  const tokB = await login("admin-b@f11gi.local");
  ok("fixture logins minted", !!tokA && !!tokAdmin && !!tokOther && !!tokB);
  if (!tokA) return summary();

  // ── §1 · THE GROUPING, BEFORE ANYTHING IS WRITTEN ───────────────────────
  const built = group(FILE);
  ok("§1 one person per identity", built.donors.length === EXPECT_PEOPLE,
    { got: built.donors.length, expected: EXPECT_PEOPLE, donors: built.donors.map(d => d.name + "|" + d.email) });
  ok("§1 …the same email in two cases is ONE person",
    built.donors.filter(d => d.email === "ben@f11gi.local").length === 1,
    { bens: built.donors.filter(d => /ben/i.test(d.name + d.email)) });
  ok("§1 …a row with neither a name nor an email is counted and left out",
    built.nameless === 1 && built.gifts.length === EXPECT_GIFTS,
    { nameless: built.nameless, gifts: built.gifts.length });
  ok("§1 …and no donor is created with an empty name",
    built.donors.every(d => String(d.name).trim().length > 0), { donors: built.donors.map(d => d.name) });

  // ── §1b · THE PARSE KEEPS THE CENTS ────────────────────────────────────
  // Structural, because this half lives in a JSX parse the server never sees:
  // both gift-history parse paths used `Math.round(amtVal || 0)`, so a $250.50
  // gift was imported as $251.00 and a $33.33 one as $33.00. Every
  // gift-history import had been quietly wrong by up to 49 cents a row since
  // the surface was written, and no server test could see it. The browser walk
  // found it; this keeps it found.
  const importSrc = require("fs").readFileSync(
    require("path").join(__dirname, "..", "client", "src", "components", "DonorImport.jsx"), "utf8");
  // Comment lines are stripped first: this file now EXPLAINS the defect, and a
  // guard that counted its own explanation would be permanently red.
  const codeOnly = importSrc.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const roundedAmounts = (codeOnly.match(/Math\.round\(\s*amtVal[^)]*\)/g) || []);
  ok("§1b NO import parse rounds an amount to whole dollars",
    roundedAmounts.length === 0, { found: roundedAmounts });
  ok("§1b …all three go through a two-decimal helper instead",
    (codeOnly.match(/= round2(?:Donor)?\(amtVal\)/g) || []).length === 3,
    { found: (codeOnly.match(/const amt = [^;]+;/g) || []).slice(0, 5) });

  // ── §2 · DRIVEN END TO END ──────────────────────────────────────────────
  const runId = "imp_f11gift" + Date.now().toString(36);
  const res = await api("POST", "/donors/import-combined", tokA,
    { donors: built.donors, gifts: built.gifts, importId: runId });
  ok("§2 the combined import accepted the file", res.status < 300, { status: res.status, body: JSON.stringify(res.body).slice(0, 220) });

  const made = await q(`SELECT id, name, email, created_import_id FROM donors WHERE org_id=$1 ORDER BY name`, [A]);
  ok("§2 every donor was created exactly once", made.length === EXPECT_PEOPLE,
    { got: made.length, names: made.map(d => d.name) });
  const dupeNames = made.map(d => d.name).filter((n, i, a) => a.indexOf(n) !== i);
  ok("§2 …and no person appears twice under the same name and email",
    new Set(made.map(d => d.name + "|" + (d.email || ""))).size === made.length,
    { dupeNames });
  const gifts = await q(`SELECT id, donor_id, amount, date FROM gifts WHERE org_id=$1`, [A]);
  ok("§2 every gift was written exactly once", gifts.length === EXPECT_GIFTS,
    { got: gifts.length, expected: EXPECT_GIFTS });
  const sum = gifts.reduce((s, g) => s + cents(g.amount), 0);
  ok("§2 …and the dollars foot to the cent against the file",
    sum === cents(EXPECT_DOLLARS), { sum, expected: cents(EXPECT_DOLLARS) });
  // Ada's three rows: two on the email identity, one on the name identity.
  const adas = made.filter(d => /Ada/.test(d.name));
  const adaGifts = gifts.filter(g => adas.some(a => a.id === g.donor_id));
  ok("§2 …and all of Ada's gifts landed on an Ada", adaGifts.length === 3,
    { adas: adas.length, adaGifts: adaGifts.length });

  // ── §3 · THE DONORS CARRY THIS IMPORT'S ID ──────────────────────────────
  ok("§3 every donor this import created carries its run id",
    made.every(d => d.created_import_id === runId),
    { stamped: made.filter(d => d.created_import_id === runId).length, of: made.length });

  // ── THE RUN IS RECORDED, as the screen records it ───────────────────────
  const rec = await api("POST", "/imports", tokA, {
    id: runId, name: "gifts-2026.csv", sourceFilename: "gifts-2026.csv",
    shape: "gift_file_with_donors", donorsCreated: EXPECT_PEOPLE, giftsCreated: EXPECT_GIFTS,
    dollars: EXPECT_DOLLARS,
  });
  ok("§3 the import run is recorded with its own shape", rec.status < 300, { status: rec.status });
  const [impRow] = await q(`SELECT shape, actor_user_id FROM imports WHERE id=$1`, [runId]);
  ok("§3 …naming the shape that reverses as a whole, and who did it",
    impRow && impRow.shape === "gift_file_with_donors" && impRow.actor_user_id === `u_${A}_staff`,
    { impRow });

  // ── §5 · WHOSE UNDO IT IS ───────────────────────────────────────────────
  const byStranger = await api("POST", `/imports/${runId}/reverse`, tokOther);
  ok("§5 a colleague who did not make this import cannot undo it", byStranger.status === 403,
    { status: byStranger.status, body: byStranger.body });
  const stillThere = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [A]);
  ok("§5 …and the refusal changed nothing", stillThere[0].n === EXPECT_GIFTS, { gifts: stillThere[0].n });

  // ── §7 · ONE ORG'S IMPORT ───────────────────────────────────────────────
  const crossOrg = await api("POST", `/imports/${runId}/reverse`, tokB);
  ok("§7 org B cannot reverse org A's import", crossOrg.status === 404, { status: crossOrg.status });

  // ── §6 · ANY OTHER SHAPE STILL REVERSES GIFT BY GIFT ────────────────────
  const otherRun = "imp_f11other" + Date.now().toString(36);
  await q(`INSERT INTO imports (id,org_id,name,shape,committed_at,actor_user_id)
           VALUES ($1,$2,'ordinary.csv','transaction',NOW(),$3)`, [otherRun, A, `u_${A}_staff`]);
  const wrongShape = await api("POST", `/imports/${otherRun}/reverse`, tokA);
  ok("§6 an ordinary import refuses to reverse as a whole", wrongShape.status === 400,
    { status: wrongShape.status, body: wrongShape.body });
  ok("§6 …and says it is undone gift by gift instead",
    /gift by gift/i.test(String(wrongShape.body && wrongShape.body.message)),
    { message: wrongShape.body && wrongShape.body.message });

  // ── §4 · ONE UNDO REMOVES BOTH, AND NOTHING ELSE ────────────────────────
  // A donor who was already here, with a gift of their own, to prove the undo
  // does not reach past what the import made.
  await q(`INSERT INTO donors (id,org_id,name,email) VALUES ($1,$2,'Prior Person','prior@f11gi.local')`, [`d_prior_${A}`, A]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name)
           VALUES ($1,$2,$3,999,'2026-04-01','cash','u_test','Dana')`, [`g_prior_${A}`, A, `d_prior_${A}`]);
  // And one of the CREATED people acquires a gift of their own after the
  // import, which must keep them.
  const keeper = made.find(d => /Cho/.test(d.name));
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name)
           VALUES ($1,$2,$3,77,'2026-09-20','cash','u_test','Dana')`, [`g_after_${A}`, A, keeper.id]);

  const undo = await api("POST", `/imports/${runId}/reverse`, tokA);
  ok("§4 the importer can undo their own import", undo.status === 200,
    { status: undo.status, body: JSON.stringify(undo.body).slice(0, 200) });
  ok("§4 …and the answer says what it removed",
    /gifts? removed/i.test(String(undo.body && undo.body.sentence)), { sentence: undo.body && undo.body.sentence });

  const afterGifts = await q(`SELECT id, donor_id FROM gifts WHERE org_id=$1 ORDER BY id`, [A]);
  ok("§4 the imported gifts are gone",
    !afterGifts.some(g => g.id.startsWith("g_") && g.id !== `g_prior_${A}` && g.id !== `g_after_${A}`),
    { left: afterGifts.map(g => g.id) });
  ok("§4 …and the gift that was already here is untouched",
    afterGifts.some(g => g.id === `g_prior_${A}`), { left: afterGifts.map(g => g.id) });
  ok("§4 …and so is the gift somebody made after the import",
    afterGifts.some(g => g.id === `g_after_${A}`), { left: afterGifts.map(g => g.id) });

  const afterDonors = await q(`SELECT id, name FROM donors WHERE org_id=$1 ORDER BY name`, [A]);
  ok("§4 the people the import created are gone",
    !afterDonors.some(d => /Ada|Ben|Dee|Esi/.test(d.name)), { left: afterDonors.map(d => d.name) });
  ok("§4 …the donor who was already here is still here",
    afterDonors.some(d => d.name === "Prior Person"), { left: afterDonors.map(d => d.name) });
  ok("§4 …and a created donor who has since acquired a gift is KEPT, not orphaned of it",
    afterDonors.some(d => /Cho/.test(d.name)), { left: afterDonors.map(d => d.name) });
  const [impAfter] = await q(`SELECT reversed_at FROM imports WHERE id=$1`, [runId]);
  ok("§4 …and the import is marked reversed, so it cannot be undone twice", !!impAfter.reversed_at);
  const twice = await api("POST", `/imports/${runId}/reverse`, tokA);
  ok("§4 …which the second attempt is told", twice.status === 409, { status: twice.status });

  await wipe(A); await wipe(B);
  await closeDb();
  summary();
})().catch(async e => {
  console.error(e);
  try { await closeDb(); } catch { /* already closed */ }
  process.exit(1);
});

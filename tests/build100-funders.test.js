// BUILD-100 (grants) Part 1 — FUNDERS AND GRANTS.
//
// A funder is an organisation on file; a grant is one request to one of them.
// The assertions are the ways that could stop being true:
//   §1  the pure rules — six statuses with the older spellings as ALIASES (so a
//       legacy row and a new one are the same thing everywhere), a closed list
//       of funder types and restrictions, and time-restricted money that cannot
//       exist without the date it is released;
//   §2  A PERSON CAN NEVER BE A FUNDER, refused by name at every door;
//   §3  Awarded writes EXACTLY ONE pledge on the FUNDER, in cents, with its
//       schedule — and a second press writes nothing more;
//   §4  a payment applies to that pledge from the ordinary gift path;
//   §5  Declined stores a reason from the list, the date, and whether to reapply;
//   §6  the pipeline reconciles to a hand count and carries its sentences;
//   §7  org A can read, award or decline none of org B's grants.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "b100_fund", OTHER = "b100_fund2";
const ME = "b100f@example.org", THEM = "b100f-other@example.org";
const PW = "loadtest1234";

const CHILD = ["grant_interactions", "program_grants", "grants", "pledge_installments",
  "fin_transactions", "interactions", "threads", "tasks", "opportunities", "moves",
  "gifts", "pledges", "donors", "users", "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const mkOrg = id => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at)
   VALUES ($1,$1,$2,1,'team','active','America/New_York',NOW())
   ON CONFLICT (id) DO UPDATE SET plan='team', subscription_status='active'`, [id, id.replace(/_/g, "-")]);
const mkUser = (id, org, email, name) => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
  [id, org, email, bcrypt.hashSync(PW, 4), name]);
const mkOrgDonor = (id, org, name) => q(
  `INSERT INTO donors (id,org_id,name,email,kind,stage,total_giving,gift_count)
   VALUES ($1,$2,$3,$4,'organisation','cultivate',0,0)`, [id, org, name, id + "@example.org"]);
const mkPerson = (id, org, name) => q(
  `INSERT INTO donors (id,org_id,name,email,kind,stage,total_giving,gift_count)
   VALUES ($1,$2,$3,$4,'person','cultivate',500,1)`, [id, org, name, id + "@example.org"]);
const cents = v => Math.round(Number(v) * 100);

(async () => {
  console.log("build100-funders");
  await reset();
  await mkOrg(ORG); await mkOrg(OTHER);
  await mkUser("u_b100f", ORG, ME, "Allie Barnett");
  await mkUser("u_b100f2", OTHER, THEM, "Not Allie");
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_b100','${ORG}','Youth programme',true)`).catch(() => {});
  await mkOrgDonor("fd_sunrise", ORG, "The Sunrise Foundation");
  await mkOrgDonor("fd_acme", ORG, "Acme Corporate Giving");
  await mkPerson("p_marg", ORG, "Margaret Ruiz");
  await mkOrgDonor("fd_other", OTHER, "Somebody Else Trust");
  const tok = await login(ME), tok2 = await login(THEM);

  const G = await import("../shared/grantShape.js");

  // ── §1 · THE PURE RULES ─────────────────────────────────────────────────
  console.log("\n— §1 · six statuses, and the old spellings are aliases —");
  ok("§1 six statuses, in order",
     G.STATUS_KEYS.join(",") === "researching,loi,submitted,awarded,declined,closed", G.STATUS_KEYS);
  ok("§1 three of them are live in the pipeline", G.OPEN_STATUS_KEYS.join(",") === "researching,loi,submitted");
  // THE PROPERTY THAT MATTERS: this table has carried other spellings for a
  // year, and a legacy row must not become invisible the day the vocabulary
  // changes. Every alias resolves to a REAL status, never to a guess.
  const aliasProblems = Object.entries(G.STATUS_ALIASES)
    .filter(([, canon]) => !G.STATUS_KEYS.includes(canon)).map(([a, c]) => `${a}→${c}`);
  ok("§1 every legacy spelling maps to a real status", aliasProblems.length === 0, aliasProblems);
  ok("§1 'prospecting' is Researching", G.normalizeStatus("prospecting") === "researching");
  ok("§1 'applied' and 'draft' are both Submitted",
     G.normalizeStatus("applied") === "submitted" && G.normalizeStatus("draft") === "submitted");
  ok("§1 'rejected' is Declined", G.normalizeStatus("rejected") === "declined");
  ok("§1 a status nobody ships resolves to nothing, rather than to a guess",
     G.normalizeStatus("vibing") === null);
  ok("§1 six funder types and no seventh", G.FUNDER_TYPE_KEYS.length === 6
     && G.FUNDER_TYPE_KEYS.includes("private_foundation") && G.FUNDER_TYPE_KEYS.includes("daf_sponsor"), G.FUNDER_TYPE_KEYS);
  ok("§1 unrestricted is the only restriction that is not restricted",
     G.RESTRICTIONS.filter(r => !r.restricted).map(r => r.key).join(",") === "unrestricted");
  ok("§1 time-restricted is the only one that carries dates",
     G.RESTRICTIONS.filter(r => r.dated).map(r => r.key).join(",") === "time_restricted");
  // THE ONE THIS RULE EXISTS FOR.
  const noDate = G.validateGrant({ status: "submitted", restriction: "time_restricted" }, { mode: "patch" });
  ok("§1 time-restricted money WITHOUT its release date is refused",
     !noDate.ok && /release/.test(noDate.errors[0].message), noDate.errors);
  ok("§1 …and with it, accepted",
     G.validateGrant({ status: "submitted", restriction: "time_restricted", restrictedUntil: "2027-06-30" }, { mode: "patch" }).ok);
  ok("§1 a release date before the period starts is refused",
     !G.validateGrant({ status: "submitted", restriction: "time_restricted",
                        restrictedFrom: "2027-07-01", restrictedUntil: "2027-06-30" }, { mode: "patch" }).ok);
  ok("§1 program-restricted needs no dates", G.validateGrant({ status: "submitted", restriction: "program_restricted" }, { mode: "patch" }).ok);
  ok("§1 a declined grant needs a reason from the list",
     !G.validateGrant({ status: "declined" }, { mode: "patch" }).ok
     && G.validateGrant({ status: "declined", declineReason: "not_a_fit" }, { mode: "patch" }).ok);
  ok("§1 free text is not a decline reason",
     !G.validateGrant({ status: "declined", declineReason: "they were rude" }, { mode: "patch" }).ok);
  // The open pipeline is never called a forecast, because nobody has put a
  // probability on a foundation's decision.
  const openSent = G.openPipelineSentence({ cents: 5000000, count: 3 }, c => "$" + c / 100);
  ok("§1 the open pipeline says what it is and is NOT a forecast",
     /what you have asked for, not what anybody expects to land/.test(openSent) && !/forecast|weighted|probability/i.test(openSent), openSent);

  // ── §2 · A PERSON CAN NEVER BE A FUNDER ─────────────────────────────────
  console.log("\n— §2 · a grant is an institutional relationship —");
  ok("§2 the pure rule refuses a person", !!G.funderProblem({ id: "x", name: "Margaret", kind: "person" }));
  ok("§2 …and says WHY, in terms somebody can act on",
     /cheque from an individual is a gift/.test(G.funderProblem({ id: "x", name: "Margaret", kind: "person" }).message));
  ok("§2 an organisation is fine", G.funderProblem({ id: "x", name: "Sunrise", kind: "organisation" }) === null);
  ok("§2 a row with NO kind is refused, not assumed institutional",
     !!G.funderProblem({ id: "x", name: "Unknown", kind: null }));
  const personGrant = await api("POST", "/funders/p_marg/grants", tok,
    { program: "Youth programme", amountRequested: 10000, status: "submitted" });
  ok("§2 the route refuses a grant on a person",
     personGrant.status === 400 && personGrant.body.code === "funder_must_be_an_organisation",
     JSON.stringify(personGrant.body).slice(0, 220));
  ok("§2 …and planted nothing", (await q("SELECT COUNT(*)::int c FROM grants WHERE org_id=$1", [ORG]))[0].c === 0);
  ok("§2 a person cannot be given a funder type either",
     (await api("PUT", "/funders/p_marg", tok, { funderType: "private_foundation" })).status === 400);
  ok("§2 …and a person's grant list is refused too",
     (await api("GET", "/funders/p_marg/grants", tok)).status === 400);

  // ── §3 · AWARDED WRITES EXACTLY ONE PLEDGE ──────────────────────────────
  console.log("\n— §3 · the award is a pledge on the funder, not a gift —");
  const ft = await api("PUT", "/funders/fd_sunrise", tok, { funderType: "private_foundation" });
  ok("§3 the funder's type saves on the FUNDER", ft.status === 200 && ft.body.funderType === "private_foundation", ft.body);
  ok("§3 a type nobody ships is refused",
     (await api("PUT", "/funders/fd_sunrise", tok, { funderType: "vibes_based" })).status === 400);
  const g1 = await api("POST", "/funders/fd_sunrise/grants", tok, {
    program: "Youth programme — general support", amountRequested: "25,000.00",
    status: "submitted", restriction: "program_restricted", fundId: "f_b100",
    cycleName: "Spring 2027", officerId: "u_b100f", notes: "Two-year ask, second year contingent." });
  ok("§3 the grant is written", g1.status === 201, JSON.stringify(g1.body).slice(0, 250));
  ok("§3 '25,000.00' is $25,000, not NaN — a grant can hold cents now",
     g1.body.amountRequestedCents === cents(25000), g1.body.amountRequestedCents);
  ok("§3 it points at the funder RECORD, not a string", g1.body.funderId === "fd_sunrise" && g1.body.funderName === "The Sunrise Foundation");
  ok("§3 …and the legacy text column is kept in step",
     (await q("SELECT funder FROM grants WHERE id=$1", [g1.body.id]))[0].funder === "The Sunrise Foundation");
  ok("§3 the restriction, fund, cycle and officer are on it",
     g1.body.restriction === "program_restricted" && g1.body.fundId === "f_b100"
     && g1.body.cycleName === "Spring 2027" && g1.body.officerId === "u_b100f", g1.body);

  const pledgesBefore = (await q("SELECT COUNT(*)::int c FROM pledges WHERE org_id=$1", [ORG]))[0].c;
  const aw = await api("PUT", `/grants/${g1.body.id}/award`, tok,
    { amountAwarded: 20000, frequency: "quarterly", installmentCount: 4, firstDue: "2027-01-15" });
  ok("§3 awarding succeeds", aw.status === 200 && aw.body.status === "awarded", JSON.stringify(aw.body).slice(0, 250));
  ok("§3 the awarded amount is what they gave, not what we asked",
     aw.body.amountAwardedCents === cents(20000) && aw.body.amountRequestedCents === cents(25000), aw.body);
  const pls = await q("SELECT id, donor_id, amount, status FROM pledges WHERE org_id=$1", [ORG]);
  ok("§3 EXACTLY ONE pledge was written", pls.length === pledgesBefore + 1, { before: pledgesBefore, now: pls.length });
  ok("§3 …ON THE FUNDER", pls[0].donor_id === "fd_sunrise", pls[0]);
  ok("§3 …for $20,000 to the cent", cents(pls[0].amount) === cents(20000), pls[0].amount);
  ok("§3 …and the grant points back at it", aw.body.awardPledgeId === pls[0].id);
  const inst = await q("SELECT seq, due_date, amount FROM pledge_installments WHERE pledge_id=$1 ORDER BY seq", [pls[0].id]);
  ok("§3 the funder's payment schedule is stored as instalments", inst.length === 4, inst.length);
  ok("§3 …and they sum to the award, to the cent",
     inst.reduce((s, r) => s + cents(r.amount), 0) === cents(20000), inst.map(r => r.amount));
  ok("§3 NO GIFT was written — an award is a commitment, not money received",
     (await q("SELECT COUNT(*)::int c FROM gifts WHERE org_id=$1", [ORG]))[0].c === 0);
  // Pressing award twice must not double the commitment.
  const aw2 = await api("PUT", `/grants/${g1.body.id}/award`, tok, { amountAwarded: 20000 });
  ok("§3 awarding a second time writes NO second pledge",
     aw2.status === 200 && (await q("SELECT COUNT(*)::int c FROM pledges WHERE org_id=$1", [ORG]))[0].c === pledgesBefore + 1);
  ok("§3 …and it is still the same pledge", aw2.body.awardPledgeId === pls[0].id);
  const noFunder = await q(`INSERT INTO grants (id,org_id,funder,program,amount,status,created_by_name)
                            VALUES ('gr_b100_orphan',$1,'Unlinked Trust','Legacy row',5000,'submitted','fixture') RETURNING id`, [ORG]);
  ok("§3 a legacy grant with no funder RECORD is refused at award, by name",
     (await api("PUT", `/grants/gr_b100_orphan/award`, tok, { amountAwarded: 5000 })).body.code === "funder_not_linked",
     noFunder.length);

  // ── §4 · A PAYMENT APPLIES TO IT ────────────────────────────────────────
  console.log("\n— §4 · the funder's cheque closes an instalment —");
  const pay = await api("POST", "/donors/fd_sunrise/gifts", tok,
    { amount: 5000, date: "2027-01-15", idempotencyKey: "b100-pay1" });
  ok("§4 the cheque is recorded as an ordinary gift", pay.status === 201 || pay.status === 200, JSON.stringify(pay.body).slice(0, 200));
  const paid = await q("SELECT seq, paid_gift_id FROM pledge_installments WHERE pledge_id=$1 ORDER BY seq", [pls[0].id]);
  ok("§4 it applied to the award pledge's first instalment, with no extra step",
     paid[0].paid_gift_id !== null, paid.map(r => [r.seq, r.paid_gift_id]));
  ok("§4 …and only the first", paid.filter(r => r.paid_gift_id).length === 1, paid.map(r => r.paid_gift_id));

  // ── §5 · DECLINED ───────────────────────────────────────────────────────
  console.log("\n— §5 · a no, with its reason, its date and whether to try again —");
  const g2 = await api("POST", "/funders/fd_acme/grants", tok,
    { program: "Equipment", amountRequested: 8000, status: "submitted" });
  ok("§5 a second grant on a different funder", g2.status === 201, JSON.stringify(g2.body).slice(0, 200));
  ok("§5 a reason off the list is refused",
     (await api("PUT", `/grants/${g2.body.id}/decline`, tok, { declineReason: "they were rude" })).status === 400);
  const dec = await api("PUT", `/grants/${g2.body.id}/decline`, tok,
    { declineReason: "too_many_asks", declinedOn: "2027-03-01", reapply: true });
  ok("§5 declining stores the reason", dec.status === 200 && dec.body.declineReason === "too_many_asks", dec.body);
  ok("§5 …the date", dec.body.declinedOn === "2027-03-01");
  ok("§5 …and whether to reapply", dec.body.reapply === true);
  ok("§5 the status is Declined", dec.body.status === "declined");

  // ── §6 · THE PIPELINE ───────────────────────────────────────────────────
  console.log("\n— §6 · the pipeline, reconciled by hand —");
  await api("POST", "/funders/fd_sunrise/grants", tok, { program: "Capacity building", amountRequested: 12000, status: "researching" });
  await api("POST", "/funders/fd_acme/grants", tok, { program: "Sponsorship", amountRequested: 3000, status: "loi", cycleName: "Autumn 2027" });
  const pipe = await api("GET", "/grants/pipeline", tok);
  ok("§6 the pipeline loads", pipe.status === 200, JSON.stringify(pipe.body).slice(0, 200));
  const [handAll] = await q("SELECT COUNT(*)::int c FROM grants WHERE org_id=$1 AND is_sample IS NOT TRUE", [ORG]);
  ok("§6 every grant in the org is on it", pipe.body.grants.length === handAll.c, { screen: pipe.body.grants.length, db: handAll.c });
  ok("§6 all six statuses are present, so an empty column is visibly empty", pipe.body.byStatus.length === 6);
  ok("§6 every status tile carries its sentence",
     pipe.body.byStatus.every(r => typeof r.sentence === "string" && r.sentence.length > 20),
     pipe.body.byStatus.map(r => r.sentence));
  // An OPEN grant counts at what was requested; an AWARDED one at what was
  // awarded. Hand-computed here rather than read back off the API.
  const HAND_OPEN = cents(12000) + cents(3000) + cents(5000);   // researching + loi + the orphan legacy row
  ok("§6 the open pipeline is what has been asked for and not answered",
     pipe.body.openPipeline.cents === HAND_OPEN, { api: pipe.body.openPipeline.cents, hand: HAND_OPEN });
  const awardedRow = pipe.body.byStatus.find(r => r.status === "awarded");
  ok("§6 the awarded column counts what they AWARDED, not what we asked",
     awardedRow.cents === cents(20000) && awardedRow.count === 1, awardedRow);
  const declinedRow = pipe.body.byStatus.find(r => r.status === "declined");
  ok("§6 the declined column counts what we asked for", declinedRow.cents === cents(8000) && declinedRow.count === 1, declinedRow);
  ok("§6 the open-pipeline sentence names the count", /3 open grants/.test(pipe.body.openPipeline.sentence), pipe.body.openPipeline.sentence);
  ok("§6 no sentence prints a whole amount with a trailing .00",
     [...pipe.body.byStatus.map(r => r.sentence), pipe.body.openPipeline.sentence]
       .every(x => !/\$[\d,]+\.00\b/.test(String(x || ""))),
     pipe.body.byStatus.map(r => r.sentence).filter(x => /\.00\b/.test(x)));
  const byCycle = await api("GET", "/grants/pipeline?cycle=Autumn%202027", tok);
  ok("§6 filtering by cycle works", byCycle.body.grants.length === 1 && byCycle.body.grants[0].cycleName === "Autumn 2027", byCycle.body.grants.map(g => g.cycleName));
  const byOfficer = await api("GET", "/grants/pipeline?officerId=u_b100f", tok);
  ok("§6 filtering by officer works", byOfficer.body.grants.length >= 1 && byOfficer.body.grants.every(g => g.officerId === "u_b100f"));
  const byProgram = await api("GET", "/grants/pipeline?program=Equipment", tok);
  ok("§6 filtering by programme works", byProgram.body.grants.length === 1 && /Equipment/.test(byProgram.body.grants[0].program));
  ok("§6 an unknown status filter is refused rather than silently ignored",
     (await api("GET", "/grants/pipeline?status=vibing", tok)).status === 400);
  // A LEGACY SPELLING MUST NOT VANISH from a filter.
  await q("UPDATE grants SET status='prospecting' WHERE id IN (SELECT id FROM grants WHERE org_id=$1 AND status='researching' LIMIT 1)", [ORG]);
  const legacy = await api("GET", "/grants/pipeline?status=researching", tok);
  ok("§6 a grant stored under a LEGACY spelling still answers its canonical filter",
     legacy.body.grants.length >= 1, legacy.body.grants.map(g => g.status));
  ok("§6 …and reads back as the canonical status",
     legacy.body.grants.every(g => G.STATUS_KEYS.includes(g.status)), legacy.body.grants.map(g => g.status));

  console.log("\n— §6b · the funder's own record —");
  const fr = await api("GET", "/funders/fd_sunrise/grants", tok);
  const [handSunrise] = await q("SELECT COUNT(*)::int c FROM grants WHERE org_id=$1 AND funder_donor_id='fd_sunrise'", [ORG]);
  ok("§6b the funder's record lists exactly its own grants", fr.body.grants.length === handSunrise.c, { api: fr.body.grants.length, db: handSunrise.c });
  ok("§6b …and carries its type", fr.body.funder.funderType === "private_foundation" && fr.body.funder.funderTypeLabel === "Private foundation");
  const funders = await api("GET", "/funders", tok);
  ok("§6b the funder list holds both organisations and NO people",
     funders.body.funders.length === 2 && !funders.body.funders.some(f => f.name === "Margaret Ruiz"),
     funders.body.funders.map(f => f.name));
  ok("§6b …with what is open and what has been awarded on each",
     funders.body.funders.find(f => f.funderId === "fd_sunrise").awardedTotal === 20000,
     funders.body.funders.map(f => [f.name, f.awardedTotal]));

  // ── §7 · THE WALL ───────────────────────────────────────────────────────
  console.log("\n— §7 · another org can touch none of it —");
  ok("§7 a foreign funder's grants are 404", (await api("GET", "/funders/fd_sunrise/grants", tok2)).status === 404);
  ok("§7 a foreign funder cannot be typed", (await api("PUT", "/funders/fd_sunrise", tok2, { funderType: "corporate" })).status === 404);
  ok("§7 …and the type did not change",
     (await q("SELECT funder_type FROM donors WHERE id='fd_sunrise'"))[0].funder_type === "private_foundation");
  ok("§7 a grant cannot be written on a foreign funder",
     (await api("POST", "/funders/fd_sunrise/grants", tok2, { program: "x", amountRequested: 1, status: "submitted" })).status === 404);
  ok("§7 a foreign grant cannot be awarded",
     (await api("PUT", `/grants/${g1.body.id}/award`, tok2, { amountAwarded: 1 })).status === 404);
  ok("§7 …and no pledge was planted", (await q("SELECT COUNT(*)::int c FROM pledges WHERE org_id=$1", [OTHER]))[0].c === 0);
  ok("§7 a foreign grant cannot be declined",
     (await api("PUT", `/grants/${g1.body.id}/decline`, tok2, { declineReason: "not_a_fit" })).status === 404);
  ok("§7 …and its status is untouched", (await q("SELECT status FROM grants WHERE id=$1", [g1.body.id]))[0].status === "awarded");
  const theirs = await api("GET", "/grants/pipeline", tok2);
  ok("§7 their pipeline is empty, not somebody else's", theirs.body.grants.length === 0);
  ok("§7 …with an honest sentence", /Nothing is with a funder right now/.test(theirs.body.openPipeline.sentence), theirs.body.openPipeline.sentence);
  ok("§7 their funder list holds none of org A's", (await api("GET", "/funders", tok2)).body.funders.length === 0);

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

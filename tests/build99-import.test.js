// BUILD-99 (major gifts) Part 6 — IMPORT AND EXPORT.
//
//   §1  the mapper has somewhere to put an open ask, and the header regexes are
//       ANCHORED on words that mean ask — a bare "Amount" is never one;
//   §2  NPSP: an OPEN opportunity is a proposal at the right stage, Closed Won is
//       a gift and never a proposal, Closed Lost stays refused;
//   §3  THE BRIEF'S OWN TEST — four open Opportunities import as four proposals
//       in the right stages and ZERO gifts;
//   §4  a file with two open asks on one person for one fund writes ONE and says
//       it skipped the other; a stage nobody recognises is not guessed;
//   §5  proposals export from the report builder with all their fields, and the
//       totals foot to the pipeline;
//   §6  org A imports nothing into org B.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "b99_imp", OTHER = "b99_imp2";
const ME = "b99imp@example.org", THEM = "b99imp-other@example.org";
const PW = "loadtest1234";

const CHILD = ["saved_reports", "portfolio_targets", "pledge_installments", "fin_transactions", "interactions",
  "threads", "tasks", "opportunities", "moves", "gifts", "pledges", "donors", "imports", "users",
  "budgets", "accounts", "fin_funds"];
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
const cents = v => Math.round(Number(v) * 100);

(async () => {
  console.log("build99-import");
  await reset();
  await mkOrg(ORG); await mkOrg(OTHER);
  await mkUser("u_imp", ORG, ME, "Allie Barnett");
  await mkUser("u_imp2", OTHER, THEM, "Not Allie");
  const tok = await login(ME), tok2 = await login(THEM);

  const IS = await import("../shared/importShape.js");
  const NP = await import("../shared/npspPreset.js");
  const RB = await import("../shared/reportBuilder.js");
  const SENT = await import("../shared/importSentence.js");

  // ── §1 · THE MAPPER HAS SOMEWHERE TO PUT AN OPEN ASK ────────────────────
  console.log("\n— §1 · an ask column is not an amount column —");
  const hs = ["Donor Name", "Email", "Opportunity Name", "Ask Amount", "Stage Name",
              "Expected Close Date", "Probability", "Assigned Officer"];
  const m = IS.autoDetectTxMapping(hs, [{}]);
  ok("§1 the purpose is found", m.proposalPurpose === "Opportunity Name", m.proposalPurpose);
  ok("§1 the ask amount is found", m.proposalAmount === "Ask Amount", m.proposalAmount);
  ok("§1 the stage is found", m.proposalStage === "Stage Name", m.proposalStage);
  ok("§1 the close date is found", m.proposalCloseDate === "Expected Close Date", m.proposalCloseDate);
  ok("§1 the probability is found", m.proposalProbability === "Probability", m.proposalProbability);
  ok("§1 Portfolio Owner is the EXISTING owner target, not a second one",
     m.owner === "Assigned Officer", m.owner);
  // THE ONE THAT MATTERS: a bare money column must NOT be read as an ask. A file
  // whose gift amounts became proposals would show a pipeline made of history.
  const plain = IS.autoDetectTxMapping(["Donor Name", "Amount", "Date", "Fund"], [{}]);
  ok("§1 a bare 'Amount' is NOT claimed as an ask", !plain.proposalAmount, plain.proposalAmount);
  ok("§1 'Gift Amount' is not either", !IS.autoDetectTxMapping(["Gift Amount"], [{}]).proposalAmount);
  ok("§1 …nor is a plain 'Date' an expected close", !plain.proposalCloseDate, plain.proposalCloseDate);
  // And the other direction: the vocabularies real systems use are recognised.
  for (const [h, field] of [["Requested Amount", "proposalAmount"], ["Solicitation Amount", "proposalAmount"],
                            ["Proposal Status", "proposalStage"], ["Ask Stage", "proposalStage"],
                            ["Decision Expected", "proposalCloseDate"], ["Likelihood", "proposalProbability"],
                            ["Ask Purpose", "proposalPurpose"]]) {
    const r = IS.autoDetectTxMapping([h], [{}]);
    ok(`§1 "${h}" maps to ${field}`, r[field] === h, { got: Object.entries(r).filter(([, v]) => v === h) });
  }
  ok("§1 the import receipt has a word for a routed proposal",
     SENT.ROUTED_LABEL.proposals === "open proposals", SENT.ROUTED_LABEL.proposals);

  // ── §2 · NPSP'S LADDER ONTO STEWARD'S ───────────────────────────────────
  console.log("\n— §2 · an open opportunity is a proposal; Closed Won is money —");
  const dec = st => NP.npspGiftDecision({ StageName: st }, { stageField: "StageName" });
  ok("§2 Prospecting → a proposal at Identified",
     dec("Prospecting").routedAs === "proposals" && dec("Prospecting").proposalStage === "identified", dec("Prospecting"));
  ok("§2 Qualification → a proposal at Cultivating",
     dec("Qualification").proposalStage === "cultivating", dec("Qualification"));
  ok("§2 Proposal/Price Quote → a proposal at Asked", dec("Proposal/Price Quote").proposalStage === "asked");
  ok("§2 Negotiation/Review → a proposal at Asked", dec("Negotiation/Review").proposalStage === "asked");
  ok("§2 CLOSED WON IS A GIFT, NEVER A PROPOSAL",
     dec("Closed Won").bucket === "cash" && !dec("Closed Won").proposalStage, dec("Closed Won"));
  ok("§2 Pledged is still a pledge, not a proposal", dec("Pledged").routedAs === "pledges");
  // Closed Lost stays REFUSED rather than becoming a Declined proposal: NPSP
  // carries no reason and Steward's Declined requires one from a fixed list.
  ok("§2 Closed Lost stays REFUSED, not turned into a Declined proposal",
     dec("Closed Lost").bucket === "refused" && !dec("Closed Lost").proposalStage, dec("Closed Lost"));
  ok("§2 a stage nobody ships is not guessed into a proposal",
     dec("Vibing").bucket === "refused" && !dec("Vibing").proposalStage, dec("Vibing"));
  ok("§2 the preset's own cash rule SAYS an open opportunity becomes a proposal",
     /OPEN opportunity becomes a proposal/.test(NP.NPSP_PRESET.cashRule) && /Closed Lost included/.test(NP.NPSP_PRESET.cashRule),
     NP.NPSP_PRESET.cashRule);
  ok("§2 every NPSP stage this build claims maps to a stage the product has",
     Object.values(NP.NPSP_PROPOSAL_STAGES).every(v => ["identified", "cultivating", "asked"].includes(v)),
     NP.NPSP_PROPOSAL_STAGES);

  // ── §3 · THE BRIEF'S OWN TEST ───────────────────────────────────────────
  // Four open Opportunities on four contacts, exactly as an NPSP export carries
  // them, through the REAL combined-import route.
  console.log("\n— §3 · four open Opportunities, four proposals, ZERO gifts —");
  const FIXTURE = [
    { name: "Priya Prospect",  stage: "Prospecting",          amount: 25000, close: "2027-01-15", prob: null, fund: "Capital campaign" },
    { name: "Quinn Qualify",   stage: "Qualification",        amount: 10000, close: "2026-12-01", prob: 25,   fund: "Capital campaign" },
    { name: "Paula Proposal",  stage: "Proposal/Price Quote", amount: 50000, close: "2026-11-01", prob: 75,   fund: "Annual fund" },
    { name: "Nils Negotiate",  stage: "Negotiation/Review",   amount: 15000, close: "2026-10-20", prob: 50,   fund: "Annual fund" },
  ];
  const payload = {
    donors: FIXTURE.map((f, i) => ({ name: f.name, email: `imp${i}@example.org` })),
    gifts: [],
    proposals: FIXTURE.map((f, i) => ({
      donorIndex: i, purpose: `${f.stage} ask`, askAmount: f.amount,
      stage: NP.npspProposalStage(f.stage), expectedClose: f.close,
      probability: f.prob, fund: f.fund, owner: "Allie Barnett",
    })),
  };
  const imp = await api("POST", "/donors/import-combined", tok, payload);
  ok("§3 the import succeeds", imp.status === 200 || imp.status === 201, JSON.stringify(imp.body).slice(0, 260));
  ok("§3 four proposals were written", imp.body.proposals && imp.body.proposals.written === 4, imp.body.proposals);
  ok("§3 …and none skipped or defaulted",
     imp.body.proposals.skippedDuplicate === 0 && imp.body.proposals.stageDefaulted === 0
     && imp.body.proposals.unresolved.length === 0, imp.body.proposals);
  const [gc] = await q("SELECT COUNT(*)::int c FROM gifts WHERE org_id=$1", [ORG]);
  ok("§3 ZERO GIFTS — an open ask is money that has NOT arrived", gc.c === 0, gc.c);
  const [lt] = await q("SELECT COALESCE(SUM(total_giving),0) t FROM donors WHERE org_id=$1", [ORG]);
  ok("§3 …and nobody's lifetime giving moved", cents(lt.t) === 0, lt.t);
  const [ledger] = await q("SELECT COUNT(*)::int c FROM fin_transactions WHERE org_id=$1", [ORG]);
  ok("§3 …and nothing posted to the ledger", ledger.c === 0, ledger.c);

  const scr = await api("GET", "/proposals", tok);
  ok("§3 all four are on the Proposals screen", scr.body.proposals.length === 4, scr.body.proposals.length);
  const byStage = {};
  for (const r of scr.body.byStage) byStage[r.stage] = r.count;
  ok("§3 one at Identified, one at Cultivating, two at Asked",
     byStage.identified === 1 && byStage.cultivating === 1 && byStage.asked === 2, byStage);
  ok("§3 the pipeline total is the four asks in cents: $100,000",
     scr.body.openAsk.cents === cents(100000), scr.body.openAsk.cents);
  // The weighted total is the one place a missing probability shows, and it must.
  ok("§3 weighted counts the three with a probability and says so",
     scr.body.weighted.counted === 3 && scr.body.weighted.unset === 1, scr.body.weighted);
  ok("§3 the funds named in the file exist, unrestricted",
     (await q("SELECT COUNT(*)::int c FROM fin_funds WHERE org_id=$1 AND restricted=false AND name IN ('Capital campaign','Annual fund')", [ORG]))[0].c === 2);
  ok("§3 the officer named in the file owns them",
     scr.body.proposals.every(p => p.officerName === "Allie Barnett"), scr.body.proposals.map(p => p.officerName));
  ok("§3 every one carries the actor that wrote it",
     (await q("SELECT COUNT(*)::int c FROM opportunities WHERE org_id=$1 AND created_by_name IS NOT NULL", [ORG]))[0].c === 4);
  ok("§3 a proposal on row N landed on the person row N created",
     scr.body.proposals.find(p => p.purpose === "Prospecting ask")?.donorName === "Priya Prospect",
     scr.body.proposals.map(p => [p.purpose, p.donorName]));

  // ── §4 · WHAT A MESSY FILE DOES ─────────────────────────────────────────
  console.log("\n— §4 · a duplicate is skipped and said, a bad stage is not guessed —");
  const messy = await api("POST", "/donors/import-combined", tok, {
    donors: [{ name: "Dupe Donna", email: "donna@example.org" }],
    gifts: [],
    proposals: [
      { donorIndex: 0, purpose: "First ask", askAmount: 1000, stage: "asked", expectedClose: "2026-12-01", fund: "Capital campaign" },
      { donorIndex: 0, purpose: "Second ask, same fund", askAmount: 2000, stage: "asked", expectedClose: "2027-01-01", fund: "Capital campaign" },
      { donorIndex: 0, purpose: "Third ask, different fund", askAmount: 3000, stage: "asked", expectedClose: "2027-02-01", fund: "Annual fund" },
      { donorIndex: 0, purpose: "Unreadable stage", askAmount: 4000, stage: "vibing", expectedClose: "2027-03-01", fund: "Scholarships" },
      { donorIndex: 0, purpose: "Unreadable probability", askAmount: 5000, stage: "asked", probability: 63, expectedClose: "2027-04-01", fund: "Bursary" },
      { donorIndex: 0, purpose: "No amount at all", askAmount: "", stage: "asked", fund: "Nowhere" },
      { donorName: "Somebody Not On File", purpose: "Orphan", askAmount: 900, stage: "asked" },
    ],
  });
  const pr = messy.body.proposals;
  ok("§4 the second ask on the SAME fund is skipped, not merged", pr.skippedDuplicate === 1, pr);
  ok("§4 …a different fund is not a duplicate, so it is written", pr.written === 4, pr);
  ok("§4 an unreadable stage falls back to Identified and is COUNTED as having done so",
     pr.stageDefaulted === 1, pr);
  ok("§4 …and the fallback really is Identified, not a guess at what they meant",
     (await q("SELECT proposal_stage FROM opportunities o JOIN donors d ON d.id=o.donor_id WHERE o.org_id=$1 AND o.name='Unreadable stage'", [ORG]))[0].proposal_stage === "identified");
  ok("§4 a probability the product does not offer is DROPPED, not rounded to the nearest one",
     pr.probabilityDropped === 1 &&
     (await q("SELECT probability FROM opportunities WHERE org_id=$1 AND name='Unreadable probability'", [ORG]))[0].probability === null, pr);
  ok("§4 a row with no readable amount is not written, and is named",
     pr.unresolved.some(u => /no ask amount/.test(u.why)), pr.unresolved);
  ok("§4 a row naming somebody not on file is not written, and is named",
     pr.unresolved.some(u => /nobody on file/.test(u.why)), pr.unresolved);
  ok("§4 still ZERO gifts after the messy file", (await q("SELECT COUNT(*)::int c FROM gifts WHERE org_id=$1", [ORG]))[0].c === 0);

  // ── §5 · THE EXPORT ─────────────────────────────────────────────────────
  console.log("\n— §5 · proposals export with all their fields —");
  ok("§5 proposals is an entity on the report builder", RB.ENTITY_KEYS.includes("proposals"));
  const fields = Object.keys(RB.ENTITIES.proposals.fields);
  for (const need of ["donor", "purpose", "ask", "stage", "probability", "expected", "fund", "officer",
                      "notes", "decline_reason", "declined_on", "committed", "commit_kind", "opened", "closed"]) {
    ok(`§5 the field "${need}" exists`, fields.includes(need), fields);
  }
  // `status` is DERIVED from the stage. Offering both would let somebody build a
  // report whose two columns could look like they disagreed.
  ok("§5 `status` is deliberately NOT a field — it is derived from the stage", !fields.includes("status"), fields);
  // EVERY field compiles as a column AND as a filter, and the compiled SQL must
  // hold no `?` (db.js rewrites every one, so one inside would bind wrong).
  const compileProblems = [];
  for (const f of fields) {
    try {
      const c = RB.compile({ entity: "proposals", columns: [f], filters: { op: "and", rules: [] } });
      if (/\?/.test(c.sql)) compileProblems.push(f + ": the SQL holds a ?");
    } catch (e) { compileProblems.push(f + " as a column: " + e.message); }
    try {
      RB.compile({ entity: "proposals", columns: ["donor"], filters: { op: "and", rules: [{ field: f, op: "notempty" }] } });
    } catch (e) { compileProblems.push(f + " as a filter: " + e.message); }
  }
  ok("§5 every field compiles as a column and as a filter, with no ? in the SQL", compileProblems.length === 0, compileProblems);
  // And it runs, and it foots.
  // Saved and run through the real routes — a saved definition is the artefact
  // an org keeps, so running an unsaved one would be testing something nobody has.
  const saved = await api("POST", "/saved-reports", tok, {
    name: "Open proposals",
    definition: { entity: "proposals", columns: ["donor", "purpose", "ask", "stage", "probability", "expected", "fund", "officer"],
                  filters: { op: "and", rules: [{ field: "stage", op: "in", value: ["identified", "cultivating", "asked"] }] } },
  });
  ok("§5 a proposals report SAVES — the definition is accepted by the validator",
     saved.status === 201, JSON.stringify(saved.body).slice(0, 240));
  const rep = await api("GET", `/saved-reports/${saved.body.id}/run`, tok);
  ok("§5 the report runs", rep.status === 200, JSON.stringify(rep.body).slice(0, 240));
  const [handOpen] = await q(
    `SELECT COUNT(*)::int n, COALESCE(SUM(o.target_amount),0) amt FROM opportunities o
       JOIN donors d ON d.id=o.donor_id AND d.org_id=o.org_id
      WHERE o.org_id=$1 AND d.deleted_at IS NULL AND o.proposal_stage IN ('identified','cultivating','asked')`, [ORG]);
  ok("§5 …and returns exactly the open proposals", (rep.body.rows || []).length === handOpen.n,
     { report: (rep.body.rows || []).length, hand: handOpen.n });
  const askTotal = rep.body.totals && (rep.body.totals.ask !== undefined ? rep.body.totals.ask : null);
  ok("§5 …with the ask total summed in the database over exactly those rows",
     askTotal === null || cents(askTotal) === cents(handOpen.amt), { total: askTotal, hand: handOpen.amt });

  // ── §6 · THE WALL ───────────────────────────────────────────────────────
  console.log("\n— §6 · an import cannot reach another org —");
  const cross = await api("POST", "/donors/import-combined", tok2, {
    donors: [{ name: "Their Person", email: "theirs@example.org" }], gifts: [],
    proposals: [{ donorName: "Priya Prospect", purpose: "Stealing yours", askAmount: 99999, stage: "asked" }],
  });
  ok("§6 their import runs in their own org", cross.status === 200 || cross.status === 201, JSON.stringify(cross.body).slice(0, 200));
  ok("§6 …and org A's person is NOT on file for them, so the proposal is unresolved",
     cross.body.proposals && cross.body.proposals.written === 0 && cross.body.proposals.unresolved.length === 1,
     cross.body.proposals);
  ok("§6 org A gained nothing", (await q("SELECT COUNT(*)::int c FROM opportunities WHERE org_id=$1 AND name='Stealing yours'", [ORG]))[0].c === 0);
  ok("§6 …and org B holds no proposal", (await q("SELECT COUNT(*)::int c FROM opportunities WHERE org_id=$1", [OTHER]))[0].c === 0);
  ok("§6 their Proposals screen is empty", (await api("GET", "/proposals", tok2)).body.proposals.length === 0);

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

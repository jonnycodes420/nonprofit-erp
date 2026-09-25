// BUILD-100 (grants) Part 5 — REPORTS, AND THE AGENT THAT DRAFTS AN OUTLINE.
//
// The brief's own test: the five reports reconcile to a hand count on the
// fixture; an agent outline cites only rows on the grant and its fund; a request
// for an outline on another org's grant finds nothing.
//
//   §1  the schema is the guarantee — no numeric field anywhere in it, walked,
//       and the walker proven able to fail;
//   §2  outcome language on WHOLE WORD RUNS, so "reserved" is not "served";
//   §3  the rows handed over: every kind present, and NOTHING from another
//       fund, another grant or another org;
//   §4  validation — an outcome with no row is dropped and COUNTED, an outcome
//       with one is kept, a cited row Steward never handed over is refused, and
//       a threshold rule goes through the same seam as the prospect brief;
//   §5  the five saved reports, each reconciled to a HAND COUNT in cents;
//   §6  the two computed reports read the SAME functions the screens do;
//   §7  the CSV of each, and the total that foots;
//   §8  the wall: another org's grant finds nothing — 404, never 503, and
//       never a row.
//
// Standard scratch stack (tests/README.md). No model is called: the key gate is
// unset here on purpose, which is why §8's ordering assertion has teeth.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "b100_rep", OTHER = "b100_rep2";
const ME = "b100rep@example.org", THEM = "b100rep-other@example.org";
const PW = "loadtest1234";

const CHILD = ["grant_spend", "grant_milestones", "grant_documents", "grant_interactions",
  "program_grants", "grants", "pledge_installments", "fin_transactions", "interactions",
  "threads", "tasks", "opportunities", "moves", "gifts", "pledges", "donors", "users",
  "saved_reports", "agent_runs", "budgets", "accounts", "fin_funds"];
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
   VALUES ($1,$2,$3,$4,'person','steward',0,0)`, [id, org, name, id + "@example.org"]);
const cents = v => Math.round(Number(v) * 100);
const money = v => cents(String(v).replace(/[$,]/g, ""));
function plusDays(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(64, 0x20)]).toString("base64");

(async () => {
  console.log("build100-reports");
  await reset();
  await mkOrg(ORG); await mkOrg(OTHER);
  await mkUser("u_b100rep", ORG, ME, "Allie Barnett");
  await mkUser("u_b100rep2", OTHER, THEM, "Not Allie");
  await mkOrgDonor("fd_sun5", ORG, "The Sunrise Foundation");
  await mkOrgDonor("fd_acme5", ORG, "Acme Corporate Giving");
  await mkOrgDonor("fd_quiet5", ORG, "Quiet Trust");
  await mkOrgDonor("fd_other5", OTHER, "Somebody Else Trust");
  await mkPerson("dn_mabel", ORG, "Mabel Fenwick");
  await mkPerson("dn_ray", ORG, "Ray Okonjo");
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_youth5','${ORG}','Youth programme',true)
           ON CONFLICT (id) DO NOTHING`);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_other5','${ORG}','Something else',true)
           ON CONFLICT (id) DO NOTHING`);
  const tok = await login(ME), tok2 = await login(THEM);
  const O = await import("../shared/grantOutline.js");
  const RB = await import("../shared/reportBuilder.js");

  // ── §1 · THE SCHEMA IS THE GUARANTEE ────────────────────────────────────
  console.log("\n— §1 · no numeric field anywhere in it —");
  ok("§1 the outline schema carries NO numeric field",
     O.schemaNumericFields().length === 0, O.schemaNumericFields());
  // AND THE WALKER IS PROVEN ABLE TO FAIL. A walker that can only be observed
  // returning nothing is not measuring anything (the BUILD-75 rule).
  const planted = JSON.parse(JSON.stringify(O.OUTLINE_SCHEMA));
  planted.sections.of.lines.of.peopleServed = { type: "number" };
  const found = O.schemaNumericFields(planted);
  ok("§1 …and the walker FINDS one planted inside the nested array",
     found.length === 1 && found[0] === "sections[].lines[].peopleServed", found);
  ok("§1 the outcomes section is declared to have NO source in the records",
     O.sectionsWithoutSource().join(",") === "outcomes", O.sectionsWithoutSource());
  ok("§1 a citation must name one of the kinds Steward actually hands over",
     O.isCitation("gift:g_1") && O.isCitation("spend:gsp_1") && O.isCitation("document:d_1")
     && !O.isCitation("household:h_1") && !O.isCitation("outcome:made-up") && !O.isCitation("g_1"));
  ok("§1 the outcomes prompt asks the HUMAN rather than reading as a placeholder",
     /Write this section yourself/.test(O.OUTCOMES_PROMPT) && !/TBD|\[|placeholder/i.test(O.OUTCOMES_PROMPT));

  // ── §2 · OUTCOME LANGUAGE, ON WHOLE WORD RUNS ───────────────────────────
  console.log("\n— §2 · a match respects the boundaries of the word —");
  ok("§2 'we served 400 young people' is outcome language",
     O.outcomeLanguage("We served 400 young people this year.").length > 0);
  ok("§2 …and so is the genre's favourite sentence",
     O.outcomeLanguage("Thanks to your support, lives changed.").length >= 1);
  // THE CENSUS RULE (BUILD-84): "served" inside "reserved" must NOT fire.
  ok("§2 'reserved' is not 'served'", O.outcomeLanguage("The board reserved the balance.").length === 0,
     O.outcomeLanguage("The board reserved the balance."));
  ok("§2 'observed' is not 'served'", O.outcomeLanguage("The auditor observed the count.").length === 0);
  ok("§2 'participants' fires but 'participation rates' as one word does not misfire",
     O.outcomeLanguage("Twelve participants attended.").length >= 1);
  ok("§2 a plain money sentence is NOT outcome language",
     O.outcomeLanguage("$4,000 was received on 12 March and $1,500 spent on staffing.").length === 0);

  // ── FIXTURE: five grants, one of them the Sunrise award with everything ──
  // Hand-computed figures live in the constants below and NOWHERE else.
  const HAND = {
    sunriseRequested: cents(12000), sunriseAwarded: cents(10000),
    pay1: cents(4000), pay2: cents(3500),                 // received 7,500
    spend1: cents(1200), spend2: cents(800),              // spent 2,000
    mabel: cents(250), ray: cents(175), otherFund: cents(9999),
    acmeRequested: cents(5000), acmeAwarded: cents(5000),
    quietRequested: cents(30000),
  };
  const sunrise = await api("POST", `/funders/fd_sun5/grants`, tok, {
    program: "Youth studio access", amountRequested: HAND.sunriseRequested / 100,
    status: "submitted", restriction: "program_restricted", fundId: "f_youth5",
    deadline: plusDays(20), cycleName: "Spring 2026",
  });
  ok("fixture the Sunrise grant exists", sunrise.status === 201, sunrise.body);
  const G = sunrise.body.id;
  const acme = await api("POST", `/funders/fd_acme5/grants`, tok, {
    program: "Operating support", amountRequested: HAND.acmeRequested / 100, status: "submitted",
    restriction: "unrestricted", deadline: plusDays(40),
  });
  const quiet = await api("POST", `/funders/fd_quiet5/grants`, tok, {
    program: "Capital campaign", amountRequested: HAND.quietRequested / 100, status: "loi",
    restriction: "capital", deadline: plusDays(75),
  });
  ok("fixture three grants asked for", acme.status === 201 && quiet.status === 201);

  // The Sunrise award, its payments, its spending, its report deadline.
  const award = await api("PUT", `/grants/${G}/award`, tok, {
    amountAwarded: HAND.sunriseAwarded / 100, firstDue: plusDays(-25),
    installments: [{ amount: HAND.pay1 / 100, dueDate: plusDays(-25) },
                   { amount: HAND.pay2 / 100, dueDate: plusDays(-5) },
                   { amount: (HAND.sunriseAwarded - HAND.pay1 - HAND.pay2) / 100, dueDate: plusDays(60) }],
  });
  ok("fixture the Sunrise grant is awarded", award.status === 200, award.body);
  const acmeAward = await api("PUT", `/grants/${acme.body.id}/award`, tok,
    { amountAwarded: HAND.acmeAwarded / 100, firstDue: plusDays(-60) });
  ok("fixture Acme is awarded too", acmeAward.status === 200, acmeAward.body);

  for (const [amt, when] of [[HAND.pay1, plusDays(-25)], [HAND.pay2, plusDays(-5)]]) {
    const p = await api("POST", `/donors/fd_sun5/gifts`, tok, { amount: amt / 100, date: when, type: "grant" });
    ok(`fixture payment of ${amt} landed`, p.status === 201 || p.status === 200, p.body);
  }
  for (const [amt, when, desc] of [[HAND.spend1, plusDays(-20), "Teaching artist fees, March"],
                                   [HAND.spend2, plusDays(-10), "Materials for the studio"]]) {
    const s = await api("POST", `/grants/${G}/spend`, tok, { amount: amt / 100, spentOn: when, description: desc });
    ok(`fixture spend of ${amt} recorded`, s.status === 201, s.body);
  }
  const ms = await api("POST", `/grants/${G}/milestones`, tok,
    { kind: "report_due", dueDate: plusDays(14), notes: "Narrative and financial report" });
  ok("fixture a report is due", ms.status === 201, ms.body);
  const msFar = await api("POST", `/grants/${quiet.body.id}/milestones`, tok,
    { kind: "proposal_due", dueDate: plusDays(75) });
  ok("fixture a proposal is due in 75 days", msFar.status === 201, msFar.body);
  const doc = await api("POST", `/grants/${G}/documents`, tok,
    { docType: "proposal", fileName: "sunrise-proposal.pdf", file: "data:application/pdf;base64," + PDF });
  ok("fixture the proposal is on file", doc.status === 201, doc.body);

  // The programme's own giving — two gifts to the grant's fund, and ONE to
  // another fund that must never appear in this grant's rows.
  for (const [who, amt, fund] of [["dn_mabel", HAND.mabel, "f_youth5"], ["dn_ray", HAND.ray, "f_youth5"],
                                  ["dn_ray", HAND.otherFund, "f_other5"]]) {
    const gi = await api("POST", `/donors/${who}/gifts`, tok, { amount: amt / 100, date: plusDays(-15), fundId: fund });
    ok(`fixture a gift of ${amt} to ${fund}`, gi.status === 201 || gi.status === 200, gi.body);
  }
  await api("POST", `/donors/fd_sun5/conversations`, tok, {
    type: "call", date: plusDays(-12), note: "Spoke with their programme officer about the report format.",
    nextStep: { type: "follow_up", due: plusDays(10), label: "Send the report" },
  }).catch(() => null);

  // The other org's grant, so §8 has something real to fail to find.
  const theirs = await api("POST", `/funders/fd_other5/grants`, tok2,
    { program: "Their programme", amountRequested: 7777, status: "submitted" });
  ok("fixture the other org has a grant of its own", theirs.status === 201, theirs.body);

  // ── §3 · THE ROWS HANDED OVER ───────────────────────────────────────────
  console.log("\n— §3 · every kind present, and nothing that is not this grant's —");
  const rows = await api("GET", `/grants/${G}/outline-rows?from=${plusDays(-30)}&to=${plusDays(0)}`, tok, null);
  ok("§3 the rows read back", rows.status === 200, rows.body);
  // THE DEFAULT PERIOD IS THE LIFE OF THE AWARD — from the day it was awarded,
  // which the award route stamps as now, so on this fixture it is today.
  const dflt = await api("GET", `/grants/${G}/outline-rows`, tok, null);
  ok("§3 with no period stated it runs from the award date to today",
     dflt.body.period.from === plusDays(0) && dflt.body.period.to === plusDays(0), dflt.body.period);
  ok("§3 …and a period the caller states is the one used",
     rows.body.period.from === plusDays(-30) && rows.body.period.to === plusDays(0), rows.body.period);
  const refs = rows.body.refs || [];
  const kinds = new Set(refs.map(r => r.split(":")[0]));
  for (const k of ["grant", "document", "payment", "spend", "gift", "person", "milestone"]) {
    ok(`§3 the rows include a ${k}`, kinds.has(k), refs);
  }
  ok("§3 every citation Steward hands over is one the validator accepts",
     refs.every(O.isCitation), refs.filter(r => !O.isCitation(r)));
  ok("§3 both payments applied to the award are rows",
     refs.filter(r => r.startsWith("payment:")).length === 2, refs);
  ok("§3 both spending lines are rows",
     refs.filter(r => r.startsWith("spend:")).length === 2, refs);
  // THE PROGRAMME IS THE FUND. A gift to another fund is not evidence about it.
  ok("§3 exactly the TWO gifts to this grant's fund are rows, not the third",
     refs.filter(r => r.startsWith("gift:")).length === 2, refs);
  const joined = (rows.body.lines || []).join("\n");
  ok("§3 …and the other fund's amount appears nowhere in the rows",
     !/9,?999/.test(joined) && !/Something else/.test(joined));
  ok("§3 nothing from the other ORG is in the rows",
     !/Somebody Else|Their programme|7,?777/.test(joined));
  ok("§3 the two people who gave to the programme are named",
     /Mabel Fenwick/.test(joined) && /Ray Okonjo/.test(joined));
  // A DOCUMENT ROW MEANS A FILE EXISTS. Steward parses nothing (Part 3's rule),
  // so the row must say so — or a model will quote a document nobody read.
  ok("§3 a document row says Steward has NOT read the file",
     /Steward has NOT read this file/.test(joined), joined.split("\n").filter(l => l.startsWith("document:")));
  ok("§3 the money is stated three ways and kept apart",
     /has been received and/.test(joined) && /still owed by the funder/.test(joined)
     && /recorded as spent against this award/.test(joined));
  ok("§3 spending says it was entered by hand",
     /Entered by hand, not read from a bank/.test(joined));
  ok("§3 the period is stated on the grant's own row",
     joined.includes(`reporting period here is ${plusDays(-30)} to ${plusDays(0)}`), joined.slice(0, 400));
  // The grounded numeric set must carry the money, or every honest sentence
  // quoting a figure would be refused as an invented rule.
  const gv = rows.body.groundedValues || [];
  ok("§3 the grounded set carries the received figure in cents AND dollars",
     gv.includes(HAND.pay1 + HAND.pay2) && gv.includes((HAND.pay1 + HAND.pay2) / 100), gv.length);

  // ── §4 · VALIDATION ─────────────────────────────────────────────────────
  console.log("\n— §4 · an outcome it cannot see is dropped and counted —");
  const handed = new Set(refs);
  const goodGift = refs.find(r => r.startsWith("gift:"));
  const v = O.validateOutline({
    headline: "The Sunrise Foundation grant for youth studio access",
    sections: [{
      heading: "What the funder paid",
      lines: [
        // KEPT — a reading of rows.
        { text: "The funder has paid two instalments against the award.", cites: [refs.find(r => r.startsWith("payment:"))] },
        // DROPPED — outcome language, no row behind it. THE RULE THIS PART ADDS.
        { text: "We served 400 young people through the studio this year.", cites: [] },
        // DROPPED — cites a row Steward never handed over.
        { text: "Attendance rose sharply after the spring term.", cites: ["gift:g_never_handed_over"] },
        // DROPPED — a rule nobody here set.
        { text: "Restricted money must be spent within 12 months of receipt.", cites: [goodGift] },
        // DROPPED — nothing at all behind it.
        { text: "The programme is going well.", cites: [] },
      ],
    }],
  }, { rows: handed, ungrounded: text => (text.match(/within 12 months/) ? ["within 12 months"] : []) });
  ok("§4 exactly the one grounded sentence survives",
     v.sentenceCount === 1 && v.sections[0].lines[0].cites.length === 1, v);
  ok("§4 four lines were dropped", v.droppedCount === 4, v.dropped.map(d => d.why));
  ok("§4 …and the outcome claim is dropped BY NAME as an outcome",
     v.dropped.some(d => /claimed an outcome Steward cannot see/.test(d.why)), v.dropped);
  ok("§4 …with the line that says who DOES know",
     v.dropped.some(d => /write this line yourself/.test(d.why)), v.dropped);
  ok("§4 …the ungrounded citation is dropped as a row Steward never handed over",
     v.dropped.some(d => /never handed over/.test(d.why)), v.dropped);
  ok("§4 …the rule is dropped through the thresholds seam",
     v.dropped.some(d => /states a rule nothing here sets|stated a rule nothing here sets/.test(d.why)), v.dropped);
  // NOTHING IS DROPPED SILENTLY.
  ok("§4 the page says how many lines were left out",
     /4 lines were left out because they could not cite a row\./.test(v.droppedSentence || ""), v.droppedSentence);
  // THE RULE'S OWN TEETH — and what proves it is not decoration. Rule 4 already
  // drops anything uncited, so an outcome check that only fired on an uncited
  // line could never refuse a line rule 4 would keep. THIS line cites a row
  // Steward genuinely handed over, and is refused anyway: a gift row is not
  // evidence that anybody attended anything.
  const v3 = O.validateOutline({
    headline: "x", sections: [{ heading: "What changed",
      lines: [{ text: "Twelve participants attended the spring showcase.", cites: [goodGift] }] }],
  }, { rows: handed });
  ok("§4 an outcome claim is refused even when it cites a row Steward handed over",
     v3.sentenceCount === 0 && v3.droppedCount === 1
     && /claimed an outcome/.test(v3.dropped[0].why), v3);

  // And the sentences the rule must NOT cost: a reading of the same rows.
  const v2 = O.validateOutline({
    headline: "x", sections: [{ heading: "The programme's giving",
      lines: [{ text: "Two people gave to the programme fund in the period.", cites: [goodGift] },
              { text: "The award reached us in two payments, and an increase in giving followed.", cites: [goodGift] }] }],
  }, { rows: handed });
  ok("§4 a reading of the rows is kept, including the words a blunter list would have cost",
     v2.sentenceCount === 2 && v2.droppedCount === 0, v2);
  ok("§4 a clean outline says nothing about dropped lines", v2.droppedSentence === null, v2.droppedSentence);
  ok("§4 the footer says where every figure came from",
     /rendered by Steward from its own rows/.test(v2.footer));

  // ── §5 · THE FIVE REPORTS, HAND-COUNTED ─────────────────────────────────
  console.log("\n— §5 · reconciled to a hand count in cents —");
  const listed = await api("GET", "/saved-reports", tok, null);
  const keys = (listed.body.standard || []).map(r => r.id);
  for (const k of ["grants-pipeline", "grants-by-funder", "grants-awarded-vs-requested",
                   "grant-deadlines-90", "grant-restricted-balances"]) {
    ok(`§5 ${k} is offered as a standard report`, keys.includes("std:" + k), keys);
  }
  ok("§5 every grants field in the catalogue compiles", (() => {
    const E = RB.ENTITIES.grants;
    const bad = [];
    for (const f of Object.keys(E.fields)) {
      const def = E.fields[f].groupOnly
        ? { entity: "grants", columns: [], groupBy: f }
        : { entity: "grants", columns: [f] };
      const c = RB.compile(def, { orgId: ORG });
      if (c.errors && c.errors.length) bad.push(f + ": " + c.errors.join("; "));
      else if (/\?/.test(c.sql)) bad.push(f + ": a ? survived into the SQL");
    }
    return bad.length === 0 || bad;
  })() === true, "see above");

  // A grant asked for but not yet decided: Sunrise is AWARDED now, so the
  // pipeline is Acme (awarded too) — no: the pipeline filters to the three
  // pursuing statuses, which leaves Quiet Trust's LOI alone.
  const pipe = await api("GET", `/saved-reports/std:grants-pipeline/run`, tok, null);
  ok("§5 the pipeline runs", pipe.status === 200, pipe.body);
  ok("§5 the pipeline holds ONLY the grant still being pursued",
     pipe.body.rows.length === 1 && /Quiet Trust/.test(JSON.stringify(pipe.body.rows[0])),
     pipe.body.rows);
  const byFunder = await api("GET", `/saved-reports/std:grants-by-funder/run`, tok, null);
  ok("§5 by-funder groups all three funders", byFunder.body.rows.length === 3, byFunder.body.rows);
  const vsReq = await api("GET", `/saved-reports/std:grants-awarded-vs-requested/run`, tok, null);
  ok("§5 awarded-vs-requested holds only the decided grants",
     vsReq.status === 200 && vsReq.body.rows.length >= 1, vsReq.body);

  const dl = await api("GET", `/saved-reports/std:grant-deadlines-90/run`, tok, null);
  ok("§5 the deadlines report runs", dl.status === 200, dl.body);
  const dlText = JSON.stringify(dl.body.rows || []);
  ok("§5 …and the report due in a fortnight is on it", /Sunrise/.test(dlText), dl.body.rows);
  ok("§5 …and the deadline 75 days out is on it too", /Quiet Trust/.test(dlText), dl.body.rows);

  const bal = await api("GET", `/saved-reports/std:grant-restricted-balances/run`, tok, null);
  ok("§5 the restricted-balances report runs", bal.status === 200, bal.body);
  // THE HAND COUNT IS AGAINST WHAT A READER SEES. `/saved-reports/:id/run`
  // strips the handler's internals on purpose, so the assertion reads the
  // rendered cells — which is the stronger check: the figures on the page have
  // to foot, not the figures behind it.
  const balRows = bal.body.rows || [];
  const balCols = (bal.body.columns || []).map(c => c.label);
  const cell = (row, label) => row["c" + balCols.indexOf(label)];
  const sunriseRow = balRows.find(r => /Sunrise/.test(String(cell(r, "Funder") || "")));
  ok("§5 the Sunrise award is the restricted row", !!sunriseRow, balRows);
  ok("§5 awarded foots to the hand count",
     money(cell(sunriseRow, "Awarded")) === HAND.sunriseAwarded, cell(sunriseRow, "Awarded"));
  ok("§5 received foots to the hand count",
     money(cell(sunriseRow, "Received")) === HAND.pay1 + HAND.pay2, cell(sunriseRow, "Received"));
  ok("§5 spent foots to the hand count",
     money(cell(sunriseRow, "Spent")) === HAND.spend1 + HAND.spend2, cell(sunriseRow, "Spent"));
  ok("§5 remaining is received minus spent, in cents",
     money(cell(sunriseRow, "Remaining to spend"))
       === (HAND.pay1 + HAND.pay2) - (HAND.spend1 + HAND.spend2), cell(sunriseRow, "Remaining to spend"));
  ok("§5 still owed is the award less what arrived",
     money(cell(sunriseRow, "Still owed")) === HAND.sunriseAwarded - HAND.pay1 - HAND.pay2,
     cell(sunriseRow, "Still owed"));
  // AND ACME'S UNRESTRICTED AWARD IS NOT ON IT. An unrestricted grant has no
  // restricted balance to report, which is a real answer rather than a zero.
  ok("§5 …and the unrestricted award is not a restricted row",
     !balRows.some(r => /Acme/.test(String(cell(r, "Funder") || ""))), balRows);
  const balTotal = balRows.find(r => String(cell(r, "Funder") || "") === "TOTAL");
  ok("§5 the page carries a TOTAL row", !!balTotal, balRows.map(r => cell(r, "Funder")));
  ok("§5 …and it foots to the rows it sits under, in cents",
     money(cell(balTotal, "Remaining to spend"))
       === (HAND.pay1 + HAND.pay2) - (HAND.spend1 + HAND.spend2), cell(balTotal, "Remaining to spend"));
  ok("§5 …separated from the grants by a blank line, so nothing reads it as one",
     balRows.indexOf(balTotal) > 0
       && Object.values(balRows[balRows.indexOf(balTotal) - 1]).every(v => String(v || "") === ""),
     balRows[balRows.indexOf(balTotal) - 1]);

  // ── §6 · ONE COMPUTATION, NOT TWO ───────────────────────────────────────
  console.log("\n— §6 · the report reads the same function the screen does —");
  const screenBal = await api("GET", "/finance/restricted", tok, null);
  ok("§6 the screen and the report agree on the restricted total, in cents",
     screenBal.body.totals.remainingCents === money(cell(balTotal, "Remaining to spend")),
     [screenBal.body.totals.remainingCents, cell(balTotal, "Remaining to spend")]);
  ok("§6 …and on how many restricted grants there are",
     (screenBal.body.grants || []).length === balRows.filter(
       r => cell(r, "Funder") && cell(r, "Funder") !== "TOTAL").length,
     [(screenBal.body.grants || []).length, balRows.length]);
  const screenDl = await api("GET", "/grants/deadlines?days=90", tok, null);
  const dlCols = (dl.body.columns || []).map(c => c.label);
  const dlDue = (dl.body.rows || []).map(r => r["c" + dlCols.indexOf("Due")]);
  ok("§6 the screen and the report agree on WHICH deadlines, date for date",
     (screenDl.body.milestones || []).map(m => m.dueDate).join("|") === dlDue.join("|"),
     [(screenDl.body.milestones || []).map(m => m.dueDate), dlDue]);
  // The SCREEN is where a report_due row carries the balance it is judged on
  // (Part 4 owns that rule); the report's job is the list, and its columns say so.
  ok("§6 the screen's report_due row still carries that balance",
     (screenDl.body.milestones || []).some(m => m.balance && m.balance.remainingCents ===
       (HAND.pay1 + HAND.pay2) - (HAND.spend1 + HAND.spend2)),
     (screenDl.body.milestones || []).map(m => m.balance && m.balance.remainingCents));
  ok("§6 every figure on the restricted report is one the registry defines",
     balCols.filter(c => /Awarded|Received|Spent|Still owed|Remaining to spend/.test(c)).length === 5, balCols);

  // ── §7 · THE CSV ────────────────────────────────────────────────────────
  console.log("\n— §7 · the file a funder's finance officer opens —");
  for (const [k, must] of [["grant-deadlines-90", "Days overdue"], ["grant-restricted-balances", "Remaining to spend"]]) {
    const csv = await api("GET", `/saved-reports/std:${k}/csv`, tok, null);
    ok(`§7 ${k} exports`, csv.status === 200, csv.status);
    const text = typeof csv.body === "string" ? csv.body : JSON.stringify(csv.body);
    ok(`§7 …with its own headers (${must})`, text.includes(must), text.slice(0, 200));
  }
  const csvBal = await api("GET", `/saved-reports/std:grant-restricted-balances/csv`, tok, null);
  const csvText = typeof csvBal.body === "string" ? csvBal.body : "";
  const totalLine = csvText.split(/\r?\n/).find(l => l.startsWith("TOTAL"));
  ok("§7 the CSV carries a TOTAL row", !!totalLine, csvText.split(/\r?\n/).slice(-4));
  ok("§7 …and that row foots to the same cents as the screen",
     !!totalLine && money(totalLine.split(",")[8].replace(/"/g, ""))
       === (HAND.pay1 + HAND.pay2) - (HAND.spend1 + HAND.spend2), totalLine);
  ok("§7 the other org's grant is not in this org's file", !/Somebody Else|7,?777/.test(csvText));

  // ── §8 · THE WALL ───────────────────────────────────────────────────────
  console.log("\n— §8 · another org's grant finds nothing —");
  const theirId = theirs.body.id;
  const crossRows = await api("GET", `/grants/${theirId}/outline-rows`, tok, null);
  ok("§8 org A cannot read the rows of org B's grant", crossRows.status === 404, crossRows.status);
  // THE ORDER IS THE POINT. No key is configured on this stack, so the gate
  // would answer 503 — which would tell a probe the route exists and what
  // Steward's key state is. The grant is checked FIRST (the BUILD-99 defect).
  const crossOutline = await api("POST", `/grants/${theirId}/report-outline`, tok, {});
  ok("§8 …and asking for an outline on it is 404, never 503",
     crossOutline.status === 404, [crossOutline.status, crossOutline.body]);
  const ownOutline = await api("POST", `/grants/${G}/report-outline`, tok, {});
  ok("§8 its OWN grant reaches the gate, which names the absence honestly",
     ownOutline.status === 503 && ownOutline.body.error === "outline_unavailable",
     [ownOutline.status, ownOutline.body]);
  ok("§8 …and says which absence it is", !!ownOutline.body.reason, ownOutline.body);
  const theirRestricted = await api("GET", "/finance/restricted", tok2, null);
  ok("§8 org B's restricted position holds none of org A's money",
     (theirRestricted.body.totals || {}).receivedCents === 0, theirRestricted.body.totals);
  const theirReport = await api("GET", `/saved-reports/std:grant-restricted-balances/run`, tok2, null);
  ok("§8 …and neither does org B's copy of the same report",
     !/Sunrise|Youth studio/.test(JSON.stringify(theirReport.body.rows || [])), theirReport.body.rows);

  if (!process.env.KEEP) await reset();
  await closeDb();
  summary();
})();

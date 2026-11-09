// tests/lib/truth4Fixture.js · TRUTH-4. AN ORG SHAPED LIKE THE FLEET'S FINDINGS.
//
// Made-up people only. One org with:
//   · Marlowe Fenwick: gave last fiscal year, and a $0 row on the 5th of this
//     month (W-1107-Donors-21X), in a household with Louisa Fenwick
//   · Louisa Fenwick: gave last fiscal year on her own (W-1108-Fundraising-07)
//   · Sable Ingram: one $500 gift split $300 Food Pantry / $200 General (W-1108-Finance-38)
//   · three lapsed donors with several years of giving (W-1108-Fundraising-15)
//   · Pell Varga: a gift and a full refund in one year (W-1107-Donors-21X)
//   · Trina Vale: a donor with an email, in the trash (W-1108-Fundraising-25X)
//   · two volunteers who never gave, one volunteer who gave (W-1108-Volunteers-31X)
//   · open tasks: overdue, due today, due tomorrow, someone else's (W-1107-Volunteers-14)
// Returns { org, owner, password, ids, today, cur, prior }.
"use strict";
const bcrypt = require("bcryptjs");
const { login, api, q, mailTypesOn } = require("../helpers");
const orgTime = require("../../orgTime");
const { testNow } = require("../clock");

const PW = "loadtest1234";

async function buildTruth4Org(run = require("crypto").randomBytes(4).toString("hex")) {
  const ORG = `org_truth4_${run}`;
  const OWNER = `owner-${run}@truth4.local`;
  const OTHER = `u_truth4b_${run}`;
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,emails_enabled,timezone,onboarded_at,legal_name,ein,receipt_address)
           VALUES ($1,'Truth Four Collective',$1,1,'active','team',true,'America/New_York',NOW(),'Truth Four Collective Inc','12-3456784','4 Fixture Way')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($3,$1,$4,$2,'Rhea Ward','admin')`,
    [ORG, bcrypt.hashSync(PW, 10), `u_truth4_${run}`, OWNER]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($3,$1,$4,$2,'Ollie Strand','staff')`,
    [ORG, bcrypt.hashSync(PW, 10), OTHER, `other-${run}@truth4.local`]);
  await mailTypesOn(ORG);
  const tok = await login(OWNER, PW);
  const today = orgTime.orgToday({ timezone: "America/New_York" }, new Date(testNow()));
  const span = (await api("GET", "/reports/lybunt", tok)).body || {};
  const cur = span.currentPeriod, prior = span.priorPeriod;
  const ids = {};
  const person = async (key, name, extra = {}) => {
    const r = await api("POST", "/donors", tok, { name, email: `${name.split(" ")[0].toLowerCase()}-${run}@truth4.invalid`, ...extra });
    if (!r.body || !r.body.id) throw new Error(`fixture: ${name} ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    ids[key] = r.body.id;
    return r.body.id;
  };
  const gift = async (id, amount, date, extra = {}) => {
    const r = await api("POST", `/donors/${id}/gifts`, tok, { amount, date, payment_method: "check", ...extra });
    if (!(r.status === 200 || r.status === 201)) throw new Error(`fixture gift ${amount} ${date}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return (r.body && (r.body.id || (r.body.gift && r.body.gift.id)));
  };
  const day = (base, n) => orgTime.addDays(base, n);
  // A row the gift form refuses (a $0 gift) arrives by an import or a webhook. Fixture only.
  const rawGift = async (id, amount, date) => {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'gift','system:test','test fixture')`,
      [`g_t4_${run}_${id.slice(-6)}_${date}`, ORG, id, amount, date]);
    await api("PUT", `/donors/${id}`, tok, { notes: `touched ${run}` });
  };

  // Marlowe and Louisa: one household, each gave last fiscal year, nothing this one (Marlowe: a $0 row).
  const marlowe = await person("marlowe", "Marlowe Fenwick");
  const louisa = await person("louisa", "Louisa Fenwick");
  await gift(marlowe, 1200, day(prior.from, 40));
  await gift(marlowe, 800, day(prior.from, 200));
  await gift(louisa, 650, day(prior.from, 90));
  const fifth = `${today.slice(0, 8)}05` <= today ? `${today.slice(0, 8)}05` : day(today, -1);
  ids.zeroDay = fifth;
  await rawGift(marlowe, 0, fifth);
  const hh = await api("POST", "/households", tok, { memberIds: [marlowe, louisa], primaryDonorId: marlowe });
  ids.household = hh.body && hh.body.id;

  // Current-year donors (so "this year" is not empty), one with a split gift.
  let funds = ((await api("GET", "/finance/funds", tok)).body || []);
  const sable = await person("sable", "Sable Ingram");
  await gift(sable, 25, day(cur.from, 3));   // makes the ledger and its default fund
  funds = ((await api("GET", "/finance/funds", tok)).body || []);
  const general = funds.find(f => f.isOrgDefault) || funds[0];
  const pantry = (await api("POST", "/finance/funds", tok, { name: "Food Pantry", restricted: true })).body;
  ids.generalFund = general && general.id;
  ids.pantryFund = pantry && (pantry.id || (pantry.fund && pantry.fund.id));
  ids.splitGift = await gift(sable, 500, day(cur.from, 10), { fundLines: [{ fundId: ids.pantryFund, amount: 300 }, { fundId: ids.generalFund, amount: 200 }] });
  const corin = await person("corin", "Corin Ashdown");
  await gift(corin, 300, day(cur.from, 20));
  await gift(corin, 450, day(prior.from, 60));

  // Three lapsed donors: years of giving, nothing in the last 12 months.
  const lapsed = [["hollis", "Hollis Marchetti", [[-900, 1000], [-700, 2500], [-460, 400], [-420, 600]]],
                  ["perpetua", "Perpetua Lindqvist", [[-1200, 5000], [-800, 300]]],
                  ["oswin", "Oswin Thackeray", [[-500, 75], [-480, 125], [-1100, 9000]]]];
  for (const [key, name, gs] of lapsed) {
    const id = await person(key, name);
    for (const [n, amt] of gs) await gift(id, amt, day(today, n));
  }

  // Pell Varga: a gift and its refund in one year (By year: 1 gift, net $0, never "no gifts").
  const pell = await person("pell", "Pell Varga");
  await gift(pell, 200, day(today, -1300));
  await rawGift(pell, -200, day(today, -1290));

  // Trina Vale: a donor with an email, in the trash.
  const trina = await person("trina", "Trina Vale");
  await gift(trina, 90, day(prior.from, 30));
  await api("DELETE", `/donors/${trina}`, tok);
  // Basil Crane: a person with no email (in Everyone, not in "with email").
  const r = await api("POST", "/donors", tok, { name: "Basil Crane" });
  ids.basil = r.body && r.body.id;

  // Volunteers: two never gave, one gave.
  await person("vwren", "Wren Halloway", { personTypes: ["volunteer"] });
  await person("vjude", "Jude Penrose", { personTypes: ["volunteer"] });
  const vgave = await person("vtess", "Tess Alder", { personTypes: ["volunteer", "donor"] });
  await gift(vgave, 40, day(cur.from, 5));

  // A volunteer who asked to be erased: their shift stays, they are counted nowhere.
  const ivo = await person("vivo", "Ivo Brandt", { personTypes: ["volunteer"] });
  for (const [k, id] of [["w", ids.vwren], ["j", ids.vjude], ["t", vgave], ["i", ivo]]) {
    await q(`INSERT INTO volunteer_shifts (id,org_id,person_id,date,hours,via,created_by,created_by_name) VALUES ($1,$2,$3,$4,3,'staff','system:test','test fixture')`,
      [`vs_t4_${run}_${k}`, ORG, id, day(today, -30)]);
  }
  const er = await api("POST", `/donors/${ivo}/erase`, tok, { confirm: "ERASE" });
  if (er.status !== 200) throw new Error(`fixture erase: ${er.status} ${JSON.stringify(er.body).slice(0, 200)}`);

  // Quill Ambrose gave, then asked to be erased: his gifts stay in the money as
  // anonymous gifts; he is on no list (Top donors' rows, nor its header).
  const quill = await person("quill", "Quill Ambrose");
  await gift(quill, 700, day(prior.from, 120));
  const eq = await api("POST", `/donors/${quill}/erase`, tok, { confirm: "ERASE" });
  if (eq.status !== 200) throw new Error(`fixture erase quill: ${eq.status}`);

  // Tasks: mine overdue, mine today, mine tomorrow, someone else's today.
  const me = `u_truth4_${run}`;
  const task = (title, due, who, whoName) => api("POST", "/tasks", tok, { title, due, priority: "medium", type: "admin", assignedTo: who, assignedToName: whoName });
  await task("Call the printer", day(today, -2), me, "Rhea Ward");
  await task("Thank Sable", today, me, "Rhea Ward");
  await task("Book the hall", day(today, 1), me, "Rhea Ward");
  await task("Order chairs", today, OTHER, "Ollie Strand");

  return { org: ORG, owner: OWNER, password: PW, token: tok, ids, today, cur, prior, run };
}

module.exports = { buildTruth4Org };

// tests/lib/truth6Fixture.js · TRUTH-6. AN ORG SHAPED LIKE THE FLEET'S FINDINGS.
//
// Made-up people only. One org with:
//   · Marlowe Quill: a $926 gift, and a $200 gift that was receipted and then
//     changed to $0 (W-1107-Donors-21X: a $0 gift still carrying a receipt)
//   · Odile Varga: one $500 gift split $300 / $200 across two funds
//   · Tobias Fenn: a $300 gift refunded in full, and a $75 gift
//   · Ines Calder: a $1,000 gift entered by hand, dated 35 days from today
//     (W-1110-Finance-25), and a $150 gift last month
//   · Petra Lund: three gifts ($100 two fiscal years back, $2,500 last fiscal
//     year, $40 this one), for the merge fields (W-1110-Fundraising-19)
//   · Quentin Hale: a donor with no email (the audience's explained gap)
//   · a group "All donors" (W-1110-Fundraising-16), a goal this FY, and an
//     open pledge (W-1110-Fundraising-06X)
// Returns { org, owner, password, token, ids, today, fy }.
"use strict";
const bcrypt = require("bcryptjs");
const { login, api, q, mailTypesOn } = require("../helpers");
const orgTime = require("../../orgTime");
const { testNow } = require("../clock");

const PW = "loadtest1234";

async function buildTruth6Org(run = require("crypto").randomBytes(4).toString("hex")) {
  const ORG = `org_truth6_${run}`;
  const OWNER = `owner-${run}@truth6.local`;
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,emails_enabled,timezone,onboarded_at,legal_name,ein,receipt_address,receipts_enabled)
           VALUES ($1,'Truth Six Collective',$1,1,'active','team',true,'America/New_York',NOW(),'Truth Six Collective Inc','12-3456786','6 Fixture Way',true)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($3,$1,$4,$2,'Rhea Ward','admin')`,
    [ORG, bcrypt.hashSync(PW, 10), `u_truth6_${run}`, OWNER]);
  await mailTypesOn(ORG);
  const tok = await login(OWNER, PW);
  const today = orgTime.orgToday({ timezone: "America/New_York" }, new Date(testNow()));
  const ids = { gifts: {} };
  const person = async (key, name, extra = {}) => {
    const email = extra.email === null ? undefined : `${name.split(" ")[0].toLowerCase()}-${key}-${run}@truth6.invalid`;
    const { email: _e, ...rest } = extra;
    const r = await api("POST", "/donors", tok, { name, ...(email ? { email } : {}), ...rest });
    if (!r.body || !r.body.id) throw new Error(`fixture: ${name} ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    ids[key] = r.body.id;
    return r.body.id;
  };
  const gift = async (id, amount, date, extra = {}) => {
    const r = await api("POST", `/donors/${id}/gifts`, tok, { amount, date, payment_method: "check", ...extra });
    if (!(r.status === 200 || r.status === 201)) throw new Error(`fixture gift ${amount} ${date}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return (r.body && (r.body.id || (r.body.gift && r.body.gift.id)));
  };
  const day = n => orgTime.addDays(today, n);
  // The fiscal years (July start): this one and the one before it.
  await q("UPDATE orgs SET fiscal_year_start_month = 7 WHERE id = $1", [ORG]).catch(() => {});
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const fyStartYear = m >= 7 ? y : y - 1;
  const fy = { from: `${fyStartYear}-07-01`, to: `${fyStartYear + 1}-06-30`, lastFrom: `${fyStartYear - 1}-07-01`, lastTo: `${fyStartYear}-06-30` };
  const inThisFy = day(-3) >= fy.from ? day(-3) : fy.from;
  const lastFy = `${fyStartYear}-02-11`;

  // ── 21X: the $0 gift that carried a receipt ───────────────────────────────
  const marlowe = await person("marlowe", "Marlowe Quill");
  ids.gifts.marlowe926 = await gift(marlowe, 926, inThisFy);
  const z = await gift(marlowe, 200, inThisFy);
  ids.gifts.marloweZero = z;
  const rc = await api("POST", `/gifts/${z}/receipt`, tok, {});
  ids.receiptOnZero = rc.body && (rc.body.id || (rc.body.receipt && rc.body.receipt.id)) || null;
  const ed = await api("PUT", `/gifts/${z}`, tok, { amount: 0 });
  if (ed.status >= 400) throw new Error(`fixture: $0 edit ${ed.status} ${JSON.stringify(ed.body).slice(0, 200)}`);

  // ── a split gift: one gift, two lines ────────────────────────────────────
  const funds = (await api("GET", "/finance/funds", tok)).body;
  const fundList = Array.isArray(funds) ? funds : (funds && (funds.funds || funds.rows)) || [];
  let f2 = fundList.find(f => /pantry/i.test(f.name));
  if (!f2) { const r = await api("POST", "/finance/funds", tok, { name: "Food Pantry", restricted: true }); f2 = r.body && (r.body.fund || r.body); }
  const f1 = fundList.find(f => f.id !== (f2 && f2.id)) || (await api("POST", "/finance/funds", tok, { name: "General Operating" })).body;
  const odile = await person("odile", "Odile Varga");
  ids.gifts.split = await gift(odile, 500, inThisFy, { fundLines: [{ fundId: f2.id, amount: 300 }, { fundId: (f1.fund || f1).id, amount: 200 }] });

  // ── a refund in full ─────────────────────────────────────────────────────
  const tobias = await person("tobias", "Tobias Fenn");
  ids.gifts.refunded = await gift(tobias, 300, inThisFy);
  const rf = await api("POST", `/gifts/${ids.gifts.refunded}/refund`, tok, { amount: 300, date: inThisFy, reason: "Given twice by mistake" });
  if (rf.status >= 400) throw new Error(`fixture refund ${rf.status} ${JSON.stringify(rf.body).slice(0, 200)}`);
  await gift(tobias, 75, inThisFy);

  // ── W-1110-Finance-25: a future-dated gift by hand ───────────────────────
  const ines = await person("ines", "Ines Calder");
  await gift(ines, 150, day(-20));
  ids.futureDate = day(35);
  ids.gifts.future = await gift(ines, 1000, ids.futureDate);

  // ── W-1110-Fundraising-19: several gifts for the merge fields ────────────
  const petra = await person("petra", "Petra Lund");
  ids.gifts.petraFirst = await gift(petra, 100, `${fyStartYear - 2}-09-14`);
  ids.gifts.petraLargest = await gift(petra, 2500, lastFy);
  ids.gifts.petraLast = await gift(petra, 40, inThisFy);

  // ── an audience gap with a reason, and the group ─────────────────────────
  const quentin = await person("quentin", "Quentin Hale", { email: null });
  await gift(quentin, 60, inThisFy);
  const grp = await api("POST", "/groups", tok, { name: "All donors", kind: "dynamic", rules: { given: "ever" } });
  ids.group = grp.body && grp.body.id;
  if (!ids.group) throw new Error(`fixture group ${grp.status} ${JSON.stringify(grp.body).slice(0, 200)}`);

  // ── W-1110-Fundraising-06X: a goal and a pledge this FY ──────────────────
  const goal = await api("POST", "/goals", tok, { label: "Annual fund", goalAmount: 50000, goalType: "total_raised", periodStart: fy.from, periodEnd: fy.to });
  ids.goal = goal.body && (goal.body.id || (goal.body.goal && goal.body.goal.id));
  const pl = await api("POST", `/donors/${petra}/pledges`, tok, { amount: 1200, date: inThisFy, note: "Over the year" });
  ids.pledge = pl.body && (pl.body.id || (pl.body.pledge && pl.body.pledge.id));

  return { org: ORG, owner: OWNER, password: PW, token: tok, ids, today, fy, inThisFy, lastFy, run };
}

module.exports = { buildTruth6Org };

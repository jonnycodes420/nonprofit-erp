// tests/lib/truth5Fixture.js · TRUTH-5. AN ORG SHAPED LIKE THE FLEET'S FINDINGS.
//
// Made-up people only. One org with:
//   · Sterling Nakamura: $2,144 last December, nothing since 1 Jan, $8,929 in
//     all (W-1109-Atlas-01); Wynne Okafor the same shape; Ida Brennan gave last
//     December AND this year (not on the list)
//   · Marlowe Charitable Trust (an organization) and Louisa Eastbrook, who
//     gives through it (an `owner` link); each gave last fiscal year on their
//     own, nothing this one (W-1108-Fundraising-07). The trust's gifts carry
//     soft credits to three people (W-1109-Finance-37X)
//   · Henry and Prudence Ashford (one record for the couple) and Prudence
//     Ashford, linked as one household (W-1107-Fundraising-06X)
//   · Robert and Lisa Atkinson: an import stated 6 gifts, the file carried 5
//     (W-1109-Finance-35X)
//   · Marlowe Quill: a $926 gift in March and a $0 row on the 5th of this
//     month (W-1107-Donors-21X)
//   · Lavinia Ostrander: a $1,200 pledge made before installments existed,
//     two $300 payments (W-1107-Finance-20)
//   · an event with one guest, for a gift given at the event (21X, the count)
// Returns { org, owner, password, token, ids, today, cur, prior, run }.
"use strict";
const bcrypt = require("bcryptjs");
const { login, api, q, mailTypesOn } = require("../helpers");
const orgTime = require("../../orgTime");
const { testNow } = require("../clock");

const PW = "loadtest1234";

async function buildTruth5Org(run = require("crypto").randomBytes(4).toString("hex")) {
  const ORG = `org_truth5_${run}`;
  const OWNER = `owner-${run}@truth5.local`;
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,emails_enabled,timezone,onboarded_at,legal_name,ein,receipt_address)
           VALUES ($1,'Truth Five Collective',$1,1,'active','team',true,'America/New_York',NOW(),'Truth Five Collective Inc','12-3456785','5 Fixture Way')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($3,$1,$4,$2,'Rhea Ward','admin')`,
    [ORG, bcrypt.hashSync(PW, 10), `u_truth5_${run}`, OWNER]);
  await mailTypesOn(ORG);
  const tok = await login(OWNER, PW);
  const today = orgTime.orgToday({ timezone: "America/New_York" }, new Date(testNow()));
  const span = (await api("GET", "/reports/lybunt", tok)).body || {};
  const cur = span.currentPeriod, prior = span.priorPeriod;
  const ids = {};
  const person = async (key, name, extra = {}) => {
    const r = await api("POST", "/donors", tok, { name, email: `${name.split(" ")[0].toLowerCase()}-${key}-${run}@truth5.invalid`, ...extra });
    if (!r.body || !r.body.id) throw new Error(`fixture: ${name} ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    ids[key] = r.body.id;
    return r.body.id;
  };
  const gift = async (id, amount, date, extra = {}) => {
    const r = await api("POST", `/donors/${id}/gifts`, tok, { amount, date, payment_method: "check", ...extra });
    if (!(r.status === 200 || r.status === 201)) throw new Error(`fixture gift ${amount} ${date}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return (r.body && (r.body.id || (r.body.gift && r.body.gift.id)));
  };
  const link = async (a, b, relationshipType) => {
    const r = await api("POST", `/donors/${a}/relationships`, tok, { relatedDonorId: b, relationshipType });
    if (r.status !== 201) throw new Error(`fixture link ${relationshipType}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  };
  const day = (base, n) => orgTime.addDays(base, n);
  const y = Number(today.slice(0, 4));
  // "Last December": the December before this calendar year.
  const dec = n => `${y - 1}-12-${String(n).padStart(2, "0")}`;
  ids.december = { from: `${y - 1}-12-01`, to: `${y - 1}-12-31` };
  // This calendar year, after 1 Jan and before today.
  const thisYear = `${y}-03-14` < today ? `${y}-03-14` : day(today, -1);

  // ── W-1109-Atlas-01: who gave last December but not this year ─────────────
  const sterling = await person("sterling", "Sterling Nakamura");
  await gift(sterling, 2144, dec(12));
  await gift(sterling, 3000, `${y - 2}-06-02`);
  await gift(sterling, 3785, `${y - 3}-03-09`);            // $8,929 in all
  const wynne = await person("wynne", "Wynne Okafor");
  await gift(wynne, 400, dec(20));
  await gift(wynne, 1500, `${y - 4}-05-11`);
  const ida = await person("ida", "Ida Brennan");
  await gift(ida, 250, dec(5));
  await gift(ida, 100, thisYear);

  // ── W-1108-Fundraising-07 / W-1109-Finance-37X: a trust and who gives through it
  const trust = await person("trust", "Marlowe Charitable Trust", { kind: "organization", personTypes: ["organization"] });
  const louisa = await person("louisa", "Louisa Eastbrook");
  const ansel = await person("ansel", "Ansel Whitcombe");
  const greer = await person("greer", "Greer Holloway");
  await link(louisa, trust, "owner");                      // Louisa gives through the trust
  await link(ansel, trust, "works_at");
  await gift(louisa, 2659, day(prior.from, 70));           // her own, last fiscal year
  await gift(louisa, 40000, `${y - 5}-02-02`);             // her lifetime is large
  await gift(ansel, 30000, `${y - 6}-04-04`);
  await gift(greer, 28162, `${y - 6}-08-08`);
  // The trust's own $4,682, last fiscal year, soft-credited to three people.
  await gift(trust, 1500, day(prior.from, 20), { softCredits: [{ donorId: louisa, amount: 1500 }] });
  await gift(trust, 1682, day(prior.from, 120), { softCredits: [{ donorId: ansel, amount: 1682 }] });
  await gift(trust, 1500, day(prior.from, 200), { softCredits: [{ donorId: greer, amount: 1000 }, { donorId: louisa, amount: 500 }] });

  // ── W-1107-Fundraising-06X: a couple's record and one of them, one household
  const couple = await person("couple", "Henry and Prudence Ashford");
  const prudence = await person("prudence", "Prudence Ashford");
  await gift(couple, 814, day(prior.from, 33));
  await gift(prudence, 491, day(prior.from, 150));
  await link(couple, prudence, "household");

  // ── W-1109-Finance-35X: an import that said 6 gifts, a file of 5 ───────────
  const atk = await person("atkinson", "Robert and Lisa Atkinson");
  const through = day(today, -400);
  for (const [n, amt] of [[-1400, 100], [-1100, 150], [-800, 200], [-600, 250], [-450, 300]]) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,import_id,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'gift',$6,'system:test','test fixture')`,
      [`g_t5_${run}_atk${-n}`, ORG, atk, amt, day(today, n), `imp_t5_${run}`]);
  }
  await q(`UPDATE donors SET imported_total = 1000, imported_gift_count = 6, imported_through = $1, imported_import_id = $2,
              imported_last_gift_date = $3, imported_last_gift_amount = 300 WHERE id = $4 AND org_id = $5`,
    [through, `imp_t5_${run}`, day(today, -450), atk, ORG]);
  // The import's own recompute (donorSummary.js): the stored rollup says 6, the import's count.
  await require("../../donorSummary").recomputeSummaries((sql, args) => q(sql, args), ORG, [atk]);

  // ── W-1107-Donors-21X: a $926 gift in March, a $0 row on the 5th ─────────
  const quill = await person("quill", "Marlowe Quill");
  await gift(quill, 926, thisYear);
  const fifth = `${today.slice(0, 8)}05` <= today ? `${today.slice(0, 8)}05` : day(today, -1);
  ids.zeroDay = fifth;
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,0,$4,'gift','system:test','test fixture')`,
    [`g_t5_${run}_zero`, ORG, quill, fifth]);
  await api("PUT", `/donors/${quill}`, tok, { notes: `touched ${run}` });

  // ── W-1107-Finance-20: a pledge from before installments, two payments ───
  const lavinia = await person("lavinia", "Lavinia Ostrander");
  ids.pledge = `pl_t5_${run}`;
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,created_at,created_by,created_by_name)
           VALUES ($1,$2,$3,1200,$4,'open',$5,'system:test','test fixture')`, [ids.pledge, ORG, lavinia, day(today, 120), `${day(today, -300)}T12:00:00Z`]);
  await gift(lavinia, 300, day(today, -200), { pledgeId: ids.pledge });
  await gift(lavinia, 300, day(today, -90), { pledgeId: ids.pledge });

  // ── an event with one guest who has not given yet ─────────────────────────
  const guest = await person("guest", "Corwin Bellamy");
  const ev = await api("POST", "/events", tok, { name: "Autumn Supper", eventType: "gala", date: today, location: "The Hall" });
  ids.event = ev.body && (ev.body.id || (ev.body.event && ev.body.event.id));
  const att = await api("POST", `/events/${ids.event}/attendees`, tok, { donorIds: [guest] });
  ids.attendee = ((await q(`SELECT id FROM event_attendees WHERE org_id=$1 AND donor_id=$2`, [ORG, guest]))[0] || {}).id;
  ids.attendeeStatus = att.status;

  return { org: ORG, owner: OWNER, password: PW, token: tok, ids, today, cur, prior, run };
}

module.exports = { buildTruth5Org };

// scripts/seed/prospect1-prospects.js · PROSPECT-1 Part 7. Believable prospects.
//
// Ten people whose own files give Room to give something to say (three Strong,
// four Some, three Not yet known), and two foundations with made-up EINs. Their
// public filing rows are in tests/fixtures/irs-bmf/eo_fixture.csv, made-up
// rows in the IRS EO BMF's own columns; production reads the real IRS file
// that scripts/load-irs-bmf.js loads, where these two EINs are not.
// The sample screening file a provider might return is
// tests/fixtures/prospect1/harborlight-screening-return.csv: it matches six of
// the ten (by the Steward ID sent out, or by email) and has one row that
// matches nobody, which the import lists rather than guesses.
//
// Called by scripts/seed-demo.js only, before the scores are computed, so the
// generosity and engagement reasons read the seed's own numbers. It checks
// itself through prospect.js, the same rule the profile reads, and stops if
// the words are not what this header says.
"use strict";

const P = "d_pr1_";   // the demo's ids; a fixture org passes its own prefix
const DAY = 86400000;
const ago = (today, days) => new Date(Date.parse(today + "T00:00:00Z") - days * DAY).toISOString().slice(0, 10);

// [key, name, email, city, expected word, gifts: [daysAgo, amount, fund, method?, matched?]]
const GEN = "fund_b72demo_gen", SCH = "fund_b72demo_sch";
const PEOPLE = [
  ["whitcombe", "Eleanora Whitcombe", "eleanor.whitcombe@lindenmail.example", "Cape Elizabeth", "strong",
    [[1000, 250, GEN], [800, 250, GEN], [600, 2500, SCH], [500, 250, GEN], [300, 400, GEN], [120, 450, GEN], [40, 300, GEN]], { event: true }],
  ["okonkwohale", "Marcus Okonkwo-Hale", "marcus.oh@quaymail.example", "Portland", "strong",
    [[900, 300, GEN], [700, 300, GEN], [500, 300, GEN], [400, 3000, SCH], [200, 500, GEN], [60, 500, GEN]], { hours: 12 }],
  ["vance", "Theodora Vance", "theo.vance@harbourpost.example", "Falmouth", "strong",
    [[800, 200, GEN], [500, 200, GEN, ["daf", "DAF"]], [300, 1500, SCH, ["daf", "DAF"]], [100, 250, GEN, null, true]], {}],
  ["ashdown", "Gabriel Ashdown", "g.ashdown@seawall.example", "Yarmouth", "some",
    [[700, 150, GEN], [400, 150, SCH], [90, 150, GEN]], {}],
  ["solvang", "Ingrid Solvang", "ingrid.solvang@tidewater.example", "Portland", "some",
    [[200, 300, GEN], [30, 400, GEN]], { monthly: 40 }],
  ["quinterobyrne", "Rafael Quintero-Byrne", "rafael.qb@lindenmail.example", "South Portland", "some",
    [[500, 100, GEN], [150, 100, GEN]], { event: true, hours: 20 }],
  ["pemberton", "Hollis Pemberton", "hollis.pemberton@quaymail.example", "Freeport", "some",
    [[365 * 2, 500, GEN, ["daf", "DAF"]]], {}],
  ["faraday", "Wendell Faraday", "wendell.faraday@harbourpost.example", "Westbrook", "unknown",
    [[1500, 50, GEN], [1200, 50, GEN]], {}],
  ["ostrowski", "Clementine Ostrowski", "c.ostrowski@seawall.example", "Scarborough", "unknown", [], {}],
  ["keene", "Bartholomew Keene", "bart.keene@tidewater.example", "Gorham", "unknown", [[45, 75, GEN]], {}],
];
const FOUNDATIONS = [
  ["halvorsen", "Halvorsen Family Foundation", "271000101", [[400, 5000, SCH], [30, 7500, SCH]]],
  ["northshore", "North Shore Harbor Trust", "271000102", [[200, 2500, GEN]]],
];

async function seedProspect1(q, ORG, { TODAY, gen = GEN, sch = SCH, who = ["u_b72demo", "Dana Reyes"], pre = P }) {
  const fundOf = f => (f === SCH ? sch : f === GEN ? gen : f);
  let g = 0;
  const gift = async (donorId, daysAgo, amount, fund, method, matched) => {
    const m = method || ["check", "Check"];
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,fund_id,match_employer_id,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [`g_pr1_${ORG}_${++g}`, ORG, donorId, amount, ago(TODAY, daysAgo), m[0], m[1], fundOf(fund), matched ? `${pre}employer` : null, ...who]);
  };
  // The employer a matched gift points at: an organisation on the file.
  await q(`INSERT INTO donors (id,org_id,name,kind,status,stage,person_types,created_by,created_by_name)
           VALUES ($1,$2,'Casco Bay Marine Supply','organisation','active','prospect','["donor"]'::jsonb,$3,$4)`, [`${pre}employer`, ORG, ...who]);
  for (const [key, name, email, city, , gifts, extra] of PEOPLE) {
    const id = pre + key;
    await q(`INSERT INTO donors (id,org_id,name,email,city,state,zip,address,status,stage,person_types,assigned_to,assigned_to_name,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,'ME','04101',$6,'active','prospect','["donor"]'::jsonb,$7,$8,$7,$8)`,
      [id, ORG, name, email, city, `${10 + key.length} Harbor View Rd`, ...who]);
    for (const [d, a, f, m, matched] of gifts) await gift(id, d, a, f, m, matched);
    if (extra.monthly) {
      await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status)
               VALUES ($1,$2,$3,$4,$5,'month','active')`, [`rs_pr1_${ORG}_${key}`, ORG, id, `sub_demo_pr1_${ORG}_${key}`, extra.monthly]);
      for (const d of [90, 60, 30]) {
        await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,fund_id,recurring_subscription_id,created_by,created_by_name)
                 VALUES ($1,$2,$3,$4,$5,'cash','Card',$6,$7,'system:stripe-webhook','Stripe (online)')`,
          [`g_pr1_${ORG}_${++g}`, ORG, id, extra.monthly, ago(TODAY, d), gen, `rs_pr1_${ORG}_${key}`]);
      }
    }
    if (extra.event) {
      const [ev] = await q(`SELECT id FROM events WHERE org_id=$1 ORDER BY date DESC NULLS LAST LIMIT 1`, [ORG]);
      if (ev) await q(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,email) VALUES ($1,$2,$3,$4,$5,$6)`,
        [`ea_pr1_${ORG}_${key}`, ev.id, ORG, id, name, email]);
    }
    if (extra.hours) {
      await q(`INSERT INTO volunteer_shifts (id,org_id,person_id,date,hours,role,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'After-school tutoring',$6,$7)`,
        [`vsh_pr1_${ORG}_${key}`, ORG, id, ago(TODAY, 50), extra.hours, ...who]);
      // WIRE-1: hours make a volunteer, as insertShift does (markVolunteer).
      await q(`UPDATE donors SET person_types = person_types || '["volunteer"]'::jsonb WHERE id=$1 AND org_id=$2`, [id, ORG]);
    }
  }
  for (const [key, name, ein, gifts] of FOUNDATIONS) {
    const id = pre + key;
    await q(`INSERT INTO donors (id,org_id,name,kind,funder_ein,city,state,status,stage,person_types,assigned_to,assigned_to_name,created_by,created_by_name)
             VALUES ($1,$2,$3,'organisation',$4,'Portland','ME','active','prospect','["donor"]'::jsonb,$5,$6,$5,$6)`,
      [id, ORG, name, ein, ...who]);
    for (const [d, a, f] of gifts) await gift(id, d, a, f);
  }
  console.log(`[seed] PROSPECT-1: ten prospects and two foundations with EINs`);
}

// After the scores exist: the words must be the ones this file promises.
async function checkProspect1(q, ORG) {
  const PR = require("../../prospect");
  const ids = PEOPLE.map(p => P + p[0]);
  const qq = (sql, args = []) => { let n = 0; return q(sql.replace(/\?/g, () => `$${++n}`), args); };
  const room = await PR.roomToGive(ORG, ids, qq);
  const wrong = PEOPLE.filter(p => room.get(P + p[0]).word !== p[4]).map(p => `${p[1]}: ${room.get(P + p[0]).word}, expected ${p[4]}`);
  if (wrong.length) throw new Error(`[seed] PROSPECT-1 words are not what the seed promises: ${wrong.join("; ")}`);
  console.log(`[seed] PROSPECT-1: Room to give checked (3 Strong, 4 Some, 3 Not yet known)`);
}

// FIX-22 · "Who could give more?" names who knows each person best (why.js
// knowsBest: who logged most of their conversations, else their owner). The
// demo stops if fewer than nine in ten of the people it lists have a name.
async function checkKnowsBest(q, ORG) {
  const PR = require("../../prospect"), WHY = require("../../why");
  const qq = (sql, args = []) => { let n = 0; return q(sql.replace(/\?/g, () => `$${++n}`), args); };
  const room = await PR.roomToGive(ORG, null, qq);
  const listed = [...room].filter(([, a]) => a.word !== "unknown").map(([id]) => id);
  const people = listed.length ? await q(`SELECT id, assigned_to FROM donors WHERE org_id = $1 AND id = ANY($2) AND deleted_at IS NULL`, [ORG, listed]) : [];
  const knows = await WHY.knowsBest(ORG, people, qq);
  const named = people.filter(p => knows.has(p.id)).length;
  if (!people.length || named * 10 < people.length * 9)
    throw new Error(`[seed] FIX-22: who knows them best names somebody for only ${named} of the ${people.length} people Who could give more lists`);
  console.log(`[seed] FIX-22: who knows them best has a name for ${named} of the ${people.length} people with room to give`);
  return { named, listed: people.length };
}

module.exports = { seedProspect1, checkProspect1, checkKnowsBest, PEOPLE, FOUNDATIONS, P };

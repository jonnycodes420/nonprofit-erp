// FIX — smart initial stage on import (infer from giving history via inferStage).
// Local scratch server + Postgres (tests/README.md recipe).
//
// A spreadsheet won't have a "stage" column, so each imported donor is placed
// in a sensible pipeline stage from their giving history — reusing the ONE
// inferStage definition (shared with the Lapsed column + BUILD-22 auto-lapse,
// LAPSE_DAYS = 365). Covers:
//  - combined import (donor + year-column history): the SERVER re-infers stage
//    from the recalculated gift rows AFTER they load — recent gift → steward,
//    >365d → lapsed, $1000+ @ 90-180d → solicit, small/old gift → cultivate,
//    no gift + no contact → prospect, exactly matching inferStage's bands
//  - a non-explicit client stage guess is OVERRIDDEN by the authoritative
//    server inference (proves the server infers, not passes through)
//  - an EXPLICIT stage column (_stageExplicit) is RESPECTED over inference
//  - a no-gift donor keeps the client's inferred stage (server has no gift data)
//  - re-inference fires when history is added AFTER a donor-only import
//    (gift-history advances a prospect → steward) but never clobbers a
//    human/explicit non-prospect stage
//  - org isolation (a cross-org gift-history is rejected, no stage bleed)

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_is_a", B = "org_is_b";
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
    [o, `IS ${tag}`, `is-${tag}`]);
}
async function seedUser(o, tag) {
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
    ["u_" + o, o, `${tag}@is.local`, bcrypt.hashSync("loadtest1234", 10), `User ${tag}`]);
}
// Map of donor name → stage for one org.
async function stagesByName(o) {
  const rows = await q(`SELECT name, stage FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [o]);
  return Object.fromEntries(rows.map(r => [r.name, r.stage]));
}
const donorId = async (o, name) => (await q(`SELECT id FROM donors WHERE org_id=$1 AND name=$2`, [o, name]))[0]?.id;

(async () => {
  await reset();
  await seedOrg(A, "a"); await seedUser(A, "a-admin");
  await seedOrg(B, "b"); await seedUser(B, "b-admin");
  const tA = await login("a-admin@is.local");
  const tB = await login("b-admin@is.local");

  // ── Test 1+2: combined import — server infers stage from the year-column
  // gifts after they load. Gift donors are sent with a deliberately WRONG,
  // non-explicit stage ("prospect"/"lapsed") to prove the server overrides it.
  const donors = [
    { name: "Margaret Chen",       email: "mchen@is.local", stage: "prospect" },  // 0 recent gift  → steward
    { name: "Robert Atkinson",     email: "ratk@is.local",  stage: "prospect" },  // 1 >365d gift   → lapsed
    { name: "Solicit Ready",       email: "sr@is.local",    stage: "prospect" },  // 2 $1500 @120d  → solicit
    { name: "Cultivate Mid",       email: "cm@is.local",    stage: "prospect" },  // 3 $100 @200d   → cultivate
    { name: "No Gift Prospect" },                                                 // 4 no gift/contact → prospect
    { name: "Contactable Prospect",email: "cp@is.local",    stage: "qualify" },   // 5 no gift, client says qualify → qualify
    { name: "Explicit Cultivate",  email: "ex@is.local",    stage: "cultivate", _stageExplicit: true }, // 6 recent gift BUT explicit → cultivate
    { name: "Guess Lapsed",        email: "gl@is.local",    stage: "lapsed" },    // 7 recent gift, NON-explicit guess → overridden to steward
  ];
  const gifts = [
    { donorIndex: 0, amount: 500,  date: daysAgo(30)  },
    { donorIndex: 1, amount: 3000, date: daysAgo(400) },
    { donorIndex: 2, amount: 1500, date: daysAgo(120) },
    { donorIndex: 3, amount: 100,  date: daysAgo(200) },
    { donorIndex: 6, amount: 800,  date: daysAgo(20)  },
    { donorIndex: 7, amount: 600,  date: daysAgo(15)  },
  ];
  const imp = await api("POST", "/donors/import-combined", tA, { donors, gifts });
  ok("combined import 200", imp.status === 200, imp.body);
  ok("combined import created 8 donors", imp.body.created === 8, imp.body);

  const st = await stagesByName(A);
  ok("recent gift → steward",              st["Margaret Chen"] === "steward", st);
  ok("gift >365 days → lapsed",            st["Robert Atkinson"] === "lapsed", st);
  ok("$1500 @ 120 days → solicit",         st["Solicit Ready"] === "solicit", st);
  ok("small/old gift → cultivate",         st["Cultivate Mid"] === "cultivate", st);
  ok("no gift + no contact → prospect",    st["No Gift Prospect"] === "prospect", st);
  ok("no gift + contact keeps qualify",    st["Contactable Prospect"] === "qualify", st);
  ok("explicit stage column wins over inference", st["Explicit Cultivate"] === "cultivate", st);
  ok("non-explicit client guess overridden by server inference", st["Guess Lapsed"] === "steward", st);

  // Hard credit invariant sanity: the explicit-cultivate donor really did get
  // its recent gift (so 'cultivate' is genuinely the explicit override, not a
  // missing-gift artifact that would infer prospect anyway).
  const exTotal = (await q(`SELECT total_giving FROM donors WHERE org_id=$1 AND name=$2`, [A, "Explicit Cultivate"]))[0]?.total_giving;
  ok("explicit-cultivate donor has its recent gift", Number(exTotal) === 800, exTotal);

  // ── Test 3: re-inference when history is added AFTER a donor-only import ──
  const imp2 = await api("POST", "/donors/import", tA, {
    donors: [
      { name: "Later History",  email: "lh@is.local" },                    // no stage → prospect
      { name: "Human Cultivate", email: "hc@is.local", stage: "cultivate", _stageExplicit: true }, // human-set
    ],
  });
  ok("donor-only import 200", imp2.status === 200, imp2.body);
  const stAfterDonorOnly = await stagesByName(A);
  ok("donor-only, no gifts → prospect",       stAfterDonorOnly["Later History"] === "prospect", stAfterDonorOnly);
  ok("human-set stage stored as cultivate",   stAfterDonorOnly["Human Cultivate"] === "cultivate", stAfterDonorOnly);

  const lhId = await donorId(A, "Later History");
  const hcId = await donorId(A, "Human Cultivate");
  const gh = await api("POST", "/gifts/import-history", tA, {
    gifts: [
      { donorId: lhId, amount: 400, date: daysAgo(20) },  // recent → should re-infer prospect to steward
      { donorId: hcId, amount: 900, date: daysAgo(20) },  // recent, but donor is cultivate → NOT re-inferred
    ],
  });
  ok("gift-history import 200", gh.status === 200, gh.body);
  ok("gift-history inserted 2 gifts", gh.body.inserted === 2, gh.body);

  const stAfterHistory = await stagesByName(A);
  ok("history added later re-infers prospect → steward", stAfterHistory["Later History"] === "steward", stAfterHistory);
  ok("history never clobbers a non-prospect (human) stage", stAfterHistory["Human Cultivate"] === "cultivate", stAfterHistory);

  // ── Test 4: org isolation — a cross-org gift-history is rejected, no bleed ──
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ($1,$2,$3,$4,'new','prospect',0,0)`,
    ["d_b_pros", B, "B Prospect", "bp@is.local"]);
  const cross = await api("POST", "/gifts/import-history", tA, {
    gifts: [{ donorId: "d_b_pros", amount: 999, date: daysAgo(10) }],
  });
  ok("cross-org gift-history 200 (soft-rejects rows)", cross.status === 200, cross.body);
  ok("cross-org gift not inserted", (cross.body.inserted || 0) === 0 && (cross.body.invalid || 0) >= 1, cross.body);
  const bStage = (await q(`SELECT stage FROM donors WHERE id=$1`, ["d_b_pros"]))[0]?.stage;
  ok("org B donor stage untouched by org A import", bStage === "prospect", bStage);
  const bCount = (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [B]))[0]?.n;
  ok("org A import created nothing in org B", bCount === 1, bCount);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

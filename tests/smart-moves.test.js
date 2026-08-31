// BUILD-22 — Smart pipeline moves (auto-lapse + un-lapse + suggestions).
// Local scratch server + Postgres (tests/README.md recipe).
//
// Jonathan's rule: the officer owns stage; the software SUGGESTS every judgment
// move and never auto-advances one — except LAPSED, which is a fact about
// giving recency and is set automatically (still editable). Covers:
//  - auto-lapse fires only for prior-donors past the shared 365-day window
//  - guards: no-gift prospect, active solicitation, open ask, officer override
//  - auto un-lapse on a new gift (→ Steward), logged as a move + timeline entry
//  - every auto-move writes a move row with a clear "Auto:" description
//  - suggestions are surfaced but NEVER auto-applied
//  - officer manual override always wins (no re-lapse after a human forward move)
//  - lapse definition matches inferStage's 365-day boundary
//  - org isolation (sweep + suggestions)

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_sm_a", B = "org_sm_b";
const iso = d => new Date(d).toISOString().slice(0, 10);
const daysAgo = n => iso(Date.now() - n * 86400000);

async function reset() {
  for (const org of [A, B]) {
    for (const t of ["moves", "opportunities", "interactions", "gifts", "fin_transactions", "budgets", "accounts", "fin_funds", "tasks", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, tag) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','growth')`,
    [o, `SM ${tag}`, `sm-${tag}`]);
}
async function seedUser(o, id, tag) {
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
    [id, o, `${tag}@sm.local`, bcrypt.hashSync("loadtest1234", 10), `User ${tag}`]);
}
// stage/gift_count/last_gift_date set explicitly so we control lapse-eligibility.
async function seedDonor(o, id, name, stage, giftCount, lastGiftDate) {
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,last_gift_date,assigned_to,assigned_to_name)
           VALUES ($1,$2,$3,$4,'mid',$5,1000,$6,$7,$8,$9)`,
    [id, o, name, `${id}@sm.local`, stage, giftCount, lastGiftDate, `u_${o}`, "User admin"]);
}
async function seedOpp(o, donorId) {
  await q(`INSERT INTO opportunities (id,org_id,donor_id,name,target_amount,status,officer_id,officer_name) VALUES ($1,$2,$3,'Ask',5000,'open',$4,'User admin')`,
    ["opp_" + Math.random().toString(36).slice(2, 8), o, donorId, `u_${o}`]);
}
const stageOf = async id => (await q(`SELECT stage FROM donors WHERE id=$1`, [id]))[0]?.stage;
const movesOf = async id => q(`SELECT from_stage,to_stage,description,officer_id,officer_name FROM moves WHERE donor_id=$1 ORDER BY created_at`, [id]);

(async () => {
  await reset();
  await seedOrg(A, "a"); await seedUser(A, "u_" + A, "admin");
  await seedOrg(B, "b"); await seedUser(B, "u_" + B, "adminb");

  // ── Org A donors covering every auto-lapse case ──
  await seedDonor(A, "sm_lapse",   "Lapse Eligible",   "cultivate", 3, daysAgo(400)); // → should lapse
  await seedDonor(A, "sm_recent",  "Recent Giver",     "cultivate", 3, daysAgo(30));  // within window → no
  await seedDonor(A, "sm_noprior", "No-Gift Prospect", "prospect",  0, null);         // no prior giving → no
  await seedDonor(A, "sm_solicit", "Being Solicited",  "solicit",   3, daysAgo(400)); // active solicitation → no
  await seedDonor(A, "sm_openask", "Has Open Ask",     "cultivate", 3, daysAgo(400)); // open opportunity → no
  await seedOpp(A, "sm_openask");
  await seedDonor(A, "sm_364",     "Just Inside 364",  "cultivate", 3, daysAgo(364)); // 364d → no (365 boundary)
  await seedDonor(A, "sm_366",     "Just Past 366",    "cultivate", 3, daysAgo(366)); // 366d → yes
  // Org B isolation control — lapse-eligible but a DIFFERENT org.
  await seedDonor(B, "sm_b1", "Other Org Donor", "cultivate", 3, daysAgo(400));

  const tA = await login("admin@sm.local");
  const tB = await login("adminb@sm.local").catch(() => null);

  // ── Run the auto-lapse sweep for org A ──
  const run1 = await api("POST", "/pipeline/run-auto-lapse", tA);
  ok("run-auto-lapse 200", run1.status === 200, run1.body);
  ok("auto-lapsed exactly the 2 eligible (sm_lapse + sm_366)", run1.body.moved === 2, run1.body);

  ok("lapse-eligible cultivate donor → lapsed", (await stageOf("sm_lapse")) === "lapsed");
  ok("366-day donor → lapsed (past 365 boundary)", (await stageOf("sm_366")) === "lapsed");
  ok("recent giver → NOT lapsed", (await stageOf("sm_recent")) === "cultivate");
  ok("no-prior-gift prospect → NOT lapsed", (await stageOf("sm_noprior")) === "prospect");
  ok("actively solicited donor → NOT lapsed", (await stageOf("sm_solicit")) === "solicit");
  ok("donor with open ask → NOT lapsed", (await stageOf("sm_openask")) === "cultivate");
  ok("364-day donor → NOT lapsed (inside window)", (await stageOf("sm_364")) === "cultivate");

  // Every auto-lapse writes a move row with a clear "Auto:" description + null officer.
  const mv = await movesOf("sm_lapse");
  ok("auto-lapse logged a move", mv.length === 1, mv);
  ok("move is cultivate → lapsed", mv[0]?.from_stage === "cultivate" && mv[0]?.to_stage === "lapsed");
  ok("move description names it Auto: lapsed", /^Auto: lapsed — no gift in \d+ months$/.test(mv[0]?.description || ""), mv[0]);
  ok("auto move has null officer_id (system move)", mv[0]?.officer_id === null);
  // Timeline transparency: a stage_change interaction was logged too.
  const ints = await q(`SELECT type,note FROM interactions WHERE donor_id=$1 AND type='stage_change'`, ["sm_lapse"]);
  ok("auto-lapse logged a stage_change interaction", ints.length === 1 && /Auto: lapsed/.test(ints[0].note), ints);

  // Idempotent: running again doesn't re-lapse anyone (they're already lapsed).
  const run2 = await api("POST", "/pipeline/run-auto-lapse", tA);
  ok("second sweep moves 0 (idempotent)", run2.body.moved === 0, run2.body);

  // ── Auto un-lapse on a new gift ──
  const g = await api("POST", "/donors/sm_lapse/gifts", tA, { amount: 250, date: iso(Date.now()) });
  ok("gift logged on lapsed donor 201", g.status === 201, g.body);
  ok("lapsed donor who gave → auto-moved to steward", (await stageOf("sm_lapse")) === "steward");
  const mv2 = await movesOf("sm_lapse");
  ok("un-lapse logged a second move", mv2.length === 2, mv2);
  ok("un-lapse move is lapsed → steward", mv2[1]?.from_stage === "lapsed" && mv2[1]?.to_stage === "steward");
  // BUILD-73 Part 3 — was "Auto: re-engaged". The outcome-claim family is banned
  // on every user-facing surface, and a move description is one: it renders in
  // the donor's move history. The move itself is unchanged; only the words are.
  ok("un-lapse description states the FACT, not an outcome claim",
     /Auto: new gift after a year-long gap/.test(mv2[1]?.description || "")
     && !/re-?engaged/i.test(mv2[1]?.description || ""), mv2[1]);
  ok("un-lapse move has null officer_id", mv2[1]?.officer_id === null);

  // ── Suggestions surfaced but NEVER auto-applied ──
  // A prospect with a gift → suggest Qualify. Reading does not change stage.
  await seedDonor(A, "sm_sugg", "First-Gift Prospect", "prospect", 1, daysAgo(10));
  const sug = await api("GET", "/donors/sm_sugg/move-suggestions", tA);
  ok("suggestions 200", sug.status === 200, sug.body);
  ok("first-gift prospect gets a qualify suggestion", (sug.body.suggestions || []).some(s => s.signal === "first_gift" && s.toStage === "qualify"), sug.body);
  ok("reading suggestions did NOT change stage", (await stageOf("sm_sugg")) === "prospect");
  ok("no move row was written by reading suggestions", (await movesOf("sm_sugg")).length === 0);

  // going-quiet advisory (cultivate, 200 days, not lapsed) → advisory, no stage.
  await seedDonor(A, "sm_quiet", "Going Quiet", "cultivate", 2, daysAgo(200));
  const sugQ = await api("GET", "/donors/sm_quiet/move-suggestions", tA);
  ok("going-quiet donor gets an advisory suggestion (toStage null)",
    (sugQ.body.suggestions || []).some(s => s.signal === "going_quiet" && s.toStage === null), sugQ.body);

  // ── Officer manual override always wins ──
  // Officer deliberately moves a lapse-eligible donor forward (a human move
  // AFTER their last gift). The next sweep must NOT re-lapse them.
  await seedDonor(A, "sm_override", "Deliberately Cultivated", "cultivate", 3, daysAgo(400));
  const mvR = await api("POST", "/pipeline/sm_override/move", tA, { toStage: "solicit", description: "Working a year-end ask despite the gap." });
  ok("officer move 201", mvR.status === 201, mvR.body);
  // Move them back to cultivate (still a human move after last gift) so the
  // 'solicit' guard isn't the only thing protecting them.
  await api("POST", "/pipeline/sm_override/move", tA, { toStage: "cultivate", description: "Cultivating toward a spring ask." });
  const run3 = await api("POST", "/pipeline/run-auto-lapse", tA);
  ok("override donor NOT re-lapsed (human move wins)", (await stageOf("sm_override")) === "cultivate");

  // ── Org isolation ──
  ok("org B lapse-eligible donor untouched by org A sweep", (await stageOf("sm_b1")) === "cultivate");
  if (tB) {
    const sugForeign = await api("GET", "/donors/sm_lapse/move-suggestions", tB);
    ok("suggestions on a foreign donor → 404", sugForeign.status === 404, sugForeign.body);
    const runB = await api("POST", "/pipeline/run-auto-lapse", tB);
    ok("org B sweep lapses its own eligible donor", runB.body.moved === 1 && (await stageOf("sm_b1")) === "lapsed", runB.body);
  } else {
    ok("org B login (isolation leg)", false, "could not log in as org B admin");
  }

  await closeDb();
  summary();
})();

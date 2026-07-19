// BUILD-17 — Development reporting cadence: digests.
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// Proves:
//   - Week-in-Review composition: each section (gifts / asks / moves w/
//     descriptions / past-due tasks) pulls exactly the target week's data
//   - IDEMPOTENT weekly send: run the same period twice → one email, one
//     digest_sends row (the trust-critical guarantee)
//   - per-recipient scoping: on Team, an ED (admin) sees org-wide; an officer
//     sees only their portfolio + a team roll-up
//   - Core plan grace: monthly per-officer report is [Team]-only; a Core org's
//     weekly still goes org-wide to everyone (single-user gets the whole thing)
//   - monthly per-officer composition (asks/moves/gifts-closed/portfolio)
//   - org isolation: a run only ever reflects the caller's org

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const TEAM = "org_dg_team", CORE = "org_dg_core", OTHER = "org_dg_other";

// A fixed past Monday-week so composition is deterministic regardless of when
// the suite runs. Mirrors the server's Monday-based weekBounds.
function mondayOf(dateStr) { const d = new Date(dateStr + "T12:00:00"); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d.toISOString().slice(0, 10); }
function plusDays(iso, n) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
const WK = mondayOf("2026-05-06");            // the digest week (Mon..Sun)
const WK_MID = plusDays(WK, 3);               // a day inside the week
const OUT_OF_WEEK = plusDays(WK, -2);         // before the week (still in May, not April)
const MO = "2026-04-01";                      // the digest month (April)
const MO_MID = "2026-04-15";
const OUT_OF_MONTH = "2026-03-15";

async function reset() {
  for (const org of [TEAM, CORE, OTHER]) {
    for (const t of ["digest_sends", "moves", "opportunities", "gifts", "tasks", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, plan, sub, tag) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,$4,$5)`, [o, `DG ${tag}`, `dg-${tag}`, sub, plan]);
}
async function seedUser(o, id, tag, role = "admin") {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`, [id, o, `${tag}@dg.local`, hash, `User ${tag}`, role]);
}
async function seedDonor(o, id, name, owner, ownerName, total = 0) {
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,assigned_to,assigned_to_name) VALUES ($1,$2,$3,$4,'mid','cultivate',$5,1,$6,$7)`,
    [id, o, name, `${id}@dg.local`, total, owner, ownerName]);
}
async function seedGift(o, donorId, amount, date) {
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date) VALUES ($1,$2,$3,$4,$5)`, ["g_" + Math.random().toString(36).slice(2, 9), o, donorId, amount, date]);
}
async function seedMove(o, donorId, officerId, officerName, from, to, desc, createdAt) {
  await q(`INSERT INTO moves (id,org_id,donor_id,officer_id,officer_name,from_stage,to_stage,description,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    ["mv_" + Math.random().toString(36).slice(2, 9), o, donorId, officerId, officerName, from, to, desc, createdAt + " 10:00:00"]);
}
async function seedOpp(o, donorId, officerId, name, target, createdAt, status = "open", giftAmount = null, closedAt = null) {
  await q(`INSERT INTO opportunities (id,org_id,donor_id,officer_id,officer_name,name,target_amount,status,gift_amount,created_at,closed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    ["op_" + Math.random().toString(36).slice(2, 9), o, donorId, officerId, "off", name, target, status, giftAmount, createdAt + " 10:00:00", closedAt ? closedAt + " 10:00:00" : null]);
}
async function seedTask(o, title, donorId, due, assignedTo = null, assignedName = null) {
  await q(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name) VALUES ($1,$2,$3,$4,'medium','donor',0,$5,$6,$7)`,
    ["t_" + Math.random().toString(36).slice(2, 9), o, title, due, donorId, assignedTo, assignedName]);
}

(async () => {
  await reset();

  // ── TEAM org: growth/active, ED (admin) + one officer ─────────────────────
  await seedOrg(TEAM, "growth", "active", "team");
  await seedUser(TEAM, "u_dg_ed", "ed", "admin");
  await seedUser(TEAM, "u_dg_off", "off", "staff");
  // donors: two owned by the officer, one owned by the ED
  await seedDonor(TEAM, "dg_d1", "Officer Donor A", "u_dg_off", "User off", 1000);
  await seedDonor(TEAM, "dg_d2", "Officer Donor B", "u_dg_off", "User off", 2000);
  await seedDonor(TEAM, "dg_d3", "ED Donor", "u_dg_ed", "User ed", 5000);
  // gifts in the week: 500 + 250 on officer donors, 900 on ED donor; plus one OUT of week
  await seedGift(TEAM, "dg_d1", 500, WK_MID);
  await seedGift(TEAM, "dg_d2", 250, WK_MID);
  await seedGift(TEAM, "dg_d3", 900, WK_MID);
  await seedGift(TEAM, "dg_d1", 9999, OUT_OF_WEEK);          // must NOT appear
  // moves in the week (officer donor + ED donor), each with a description
  await seedMove(TEAM, "dg_d1", "u_dg_off", "User off", "cultivate", "solicit", "Made the ask over lunch", WK_MID);
  await seedMove(TEAM, "dg_d3", "u_dg_ed", "User ed", "prospect", "qualify", "Qualified at gala", WK_MID);
  await seedMove(TEAM, "dg_d1", "u_dg_off", "User off", "prospect", "cultivate", "Should not appear", OUT_OF_WEEK);
  // asks made in the week
  await seedOpp(TEAM, "dg_d1", "u_dg_off", "Spring ask", 10000, WK_MID);
  await seedOpp(TEAM, "dg_d3", "u_dg_ed", "Capital ask", 50000, WK_MID);
  // past-due tasks (due far in the past): one officer, one ED
  await seedTask(TEAM, "Call Officer Donor A", "dg_d1", "2020-01-01", "u_dg_off", "User off");
  await seedTask(TEAM, "Send ED Donor proposal", "dg_d3", "2020-01-02", "u_dg_ed", "User ed");

  const edTok = await login("ed@dg.local");

  // ── 1) Composition (dry run) — org-wide (admin scope) ─────────────────────
  const dry = (await api("POST", "/digests/run", edTok, { type: "weekly", weekStart: WK, dryRun: true })).body;
  ok("dry run reserves nothing (window key = week Monday)", dry.windows.weekly.key === "wk:" + WK, dry.windows.weekly);
  const edPayload = dry.weekly.sent.find(p => p.recipientUserId === "u_dg_ed");
  const offPayload = dry.weekly.sent.find(p => p.recipientUserId === "u_dg_off");
  ok("both recipients composed", !!edPayload && !!offPayload);
  ok("ED scope = org", edPayload.scope === "org");
  ok("officer scope = officer", offPayload.scope === "officer");
  // ED (org-wide): all 3 in-week gifts = 1650, the out-of-week 9999 excluded
  ok("ED gifts = 3 in-week gifts", edPayload.sections.gifts.length === 3, edPayload.sections.gifts.length);
  ok("ED gift total = 1650 (out-of-week excluded)", edPayload.sections.totals.giftTotal === 1650, edPayload.sections.totals.giftTotal);
  ok("ED moves = 2 in-week moves", edPayload.sections.moves.length === 2, edPayload.sections.moves.length);
  ok("moves carry their description", edPayload.sections.moves.some(m => m.description === "Made the ask over lunch"));
  ok("ED asks = 2 in-week asks", edPayload.sections.asks.length === 2, edPayload.sections.asks.length);
  ok("ED past-due tasks = 2", edPayload.sections.pastDueTasks.length === 2, edPayload.sections.pastDueTasks.length);
  // Officer (portfolio scope): only their 2 donors' gifts (500+250), 1 move, 1 ask, 1 task
  ok("officer gifts = only their 2 donors' in-week gifts", offPayload.sections.gifts.length === 2, offPayload.sections.gifts.length);
  ok("officer gift total = 750", offPayload.sections.totals.giftTotal === 750, offPayload.sections.totals.giftTotal);
  ok("officer moves = 1 (their donor only)", offPayload.sections.moves.length === 1, offPayload.sections.moves.length);
  ok("officer asks = 1 (their donor only)", offPayload.sections.asks.length === 1, offPayload.sections.asks.length);
  ok("officer past-due tasks = 1 (assigned to them)", offPayload.sections.pastDueTasks.length === 1, offPayload.sections.pastDueTasks.length);
  ok("officer gets a team roll-up", offPayload.teamRollup && offPayload.teamRollup.giftTotal === 1650, offPayload.teamRollup);
  ok("ED gets no team roll-up (already org-wide)", edPayload.teamRollup === null);

  // ── 2) Idempotent send ────────────────────────────────────────────────────
  const first = (await api("POST", "/digests/run", edTok, { type: "weekly", weekStart: WK })).body;
  ok("first real run sends both recipients", first.weekly.sent.length === 2 && first.weekly.skipped.length === 0, first.weekly);
  const second = (await api("POST", "/digests/run", edTok, { type: "weekly", weekStart: WK })).body;
  ok("second run sends nothing (idempotent)", second.weekly.sent.length === 0 && second.weekly.skipped.length === 2, second.weekly);
  const rows = await q(`SELECT digest_type,period_key,recipient_user_id FROM digest_sends WHERE org_id=$1 AND digest_type='weekly'`, [TEAM]);
  ok("exactly 2 weekly digest_sends rows (one per recipient, no dupes)", rows.length === 2, rows.length);

  // ── 3) Monthly per-officer report [Team] ──────────────────────────────────
  // officer: 2 asks made in April (one won w/ 4000 gift), 1 move made
  await seedOpp(TEAM, "dg_d1", "u_dg_off", "April ask 1", 8000, MO_MID);
  await seedOpp(TEAM, "dg_d2", "u_dg_off", "April ask 2", 3000, MO_MID, "won", 4000, MO_MID);
  await seedOpp(TEAM, "dg_d1", "u_dg_off", "March ask", 5000, OUT_OF_MONTH);   // excluded
  await seedMove(TEAM, "dg_d2", "u_dg_off", "User off", "cultivate", "solicit", "April move", MO_MID);
  const mdry = (await api("POST", "/digests/run", edTok, { type: "monthly", monthStart: MO, dryRun: true })).body;
  const offRep = mdry.monthly.sent.find(p => p.recipientUserId === "u_dg_off");
  ok("monthly window = the April month key", mdry.windows.monthly.key === "mo:2026-04", mdry.windows.monthly);
  ok("officer monthly asksMade = 2 (March excluded)", offRep.report.asksMade === 2, offRep.report.asksMade);
  ok("officer monthly asksMade amount = 11000", offRep.report.asksMadeAmount === 11000, offRep.report.asksMadeAmount);
  ok("officer monthly giftsClosed = 1 · 4000", offRep.report.giftsClosed === 1 && offRep.report.giftsClosedAmount === 4000, offRep.report);
  ok("officer monthly movesMade = 1 (only the April move)", offRep.report.movesMade === 1, offRep.report.movesMade);
  ok("officer monthly portfolio = 2 donors · $3000", offRep.report.portfolioCount === 2 && offRep.report.portfolioValue === 3000, offRep.report);
  const mfirst = (await api("POST", "/digests/run", edTok, { type: "monthly", monthStart: MO })).body;
  ok("monthly first run sends per officer", mfirst.monthly.sent.length === 2, mfirst.monthly.sent.length);
  const msecond = (await api("POST", "/digests/run", edTok, { type: "monthly", monthStart: MO })).body;
  ok("monthly idempotent (second run 0 sent)", msecond.monthly.sent.length === 0 && msecond.monthly.skipped.length === 2, msecond.monthly);

  // ── 4) Core plan grace ────────────────────────────────────────────────────
  await seedOrg(CORE, "seed", "active", "core");
  await seedUser(CORE, "u_dg_core", "core", "admin");
  await seedDonor(CORE, "dg_c1", "Core Donor", "u_dg_core", "User core", 100);
  await seedGift(CORE, "dg_c1", 300, WK_MID);
  const coreTok = await login("core@dg.local");
  const coreRun = (await api("POST", "/digests/run", coreTok, { weekStart: WK, monthStart: MO, dryRun: true })).body;
  ok("Core weekly still goes org-wide to the (single) user", coreRun.weekly.sent.length === 1 && coreRun.weekly.sent[0].scope === "org", coreRun.weekly.sent);
  ok("Core weekly composes its own gift", coreRun.weekly.sent[0].sections.totals.giftTotal === 300, coreRun.weekly.sent[0].sections.totals);
  ok("Core monthly per-officer report is suppressed ([Team] only)", coreRun.monthly.sent.length === 0, coreRun.monthly.sent);
  const corePrev = await api("GET", "/digests/preview?type=monthly", coreTok);
  ok("Core monthly preview → 403 plan_required", corePrev.status === 403 && corePrev.body.error === "plan_required", corePrev.status);
  const coreWkPrev = await api("GET", "/digests/preview?type=weekly", coreTok);
  ok("Core weekly preview → 200 (org scope)", coreWkPrev.status === 200 && coreWkPrev.body.scope === "org", coreWkPrev.status);

  // ── 5) Org isolation ──────────────────────────────────────────────────────
  await seedOrg(OTHER, "growth", "active", "other");
  await seedUser(OTHER, "u_dg_other", "other", "admin");
  await seedDonor(OTHER, "dg_o1", "Other Org Donor", "u_dg_other", "User other", 1);
  await seedGift(OTHER, "dg_o1", 7777, WK_MID);
  const teamPrev = await api("GET", "/digests/preview?type=weekly", edTok);
  ok("caller's preview never includes another org's donor", !JSON.stringify(teamPrev.body).includes("Other Org Donor"), "leak");
  const teamRunAgain = (await api("POST", "/digests/run", edTok, { type: "weekly", weekStart: WK, dryRun: true })).body;
  ok("caller's run never includes another org's 7777 gift", !teamRunAgain.weekly.sent.some(p => p.sections.gifts.some(g => g.amount === 7777)), "leak");
  const otherRows = await q(`SELECT COUNT(*)::int AS n FROM digest_sends WHERE org_id=$1`, [OTHER]);
  ok("no digest_sends rows planted for the other org by our runs", otherRows[0].n === 0, otherRows[0].n);

  // ── 6) requireAdmin gate ──────────────────────────────────────────────────
  const offTok = await login("off@dg.local");
  const staffRun = await api("POST", "/digests/run", offTok, { type: "weekly", weekStart: WK, dryRun: true });
  ok("non-admin cannot trigger a digest run (403)", staffRun.status === 403, staffRun.status);
  const noTok = await api("POST", "/digests/run", null, { type: "weekly" });
  ok("no token → 401", noTok.status === 401, noTok.status);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

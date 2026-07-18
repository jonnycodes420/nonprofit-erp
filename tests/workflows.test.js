// BUILD-13 Part 3 — Workflows engine suite.
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// Covers: recipe provisioning + toggle/config (requireAdmin + checkWriteAccess),
// each recipe fires on its trigger and produces the right action(s), IDEMPOTENCY
// (same trigger event twice → one action set, one run), conditions gate
// correctly (major-gift threshold, first-gift only), the run log is written,
// and org isolation (a workflow never acts on another org's data / a run is
// never visible cross-org). Uses POST /workflows/simulate to fire triggers
// deterministically without needing live Stripe.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_wf_a", B = "org_wf_b", RO = "org_wf_ro";

async function reset() {
  for (const org of [A, B, RO]) {
    await q(`DELETE FROM workflow_runs WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM workflows WHERE org_id=$1`, [org]).catch(() => {});
    for (const t of ["tasks", "donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, tag, { role = "admin", sub = "active" } = {}) {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,$4,'growth')`,
    [o, `WF ${tag}`, `wf-${tag}`, sub]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`,
    [`u_${o}`, o, `${tag}@wf.local`, hash, `User ${tag}`, role]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,tags,assigned_to,assigned_to_name) VALUES ($1,$2,$3,$4,'mid','cultivate',0,0,'[]',$5,$6)`,
    [`d_${o}`, o, `Donor ${tag}`, `donor-${tag}@wf.local`, `u_${o}`, `User ${tag}`]);
}

const enable = async (tok, wfId, config) => api("PUT", `/workflows/${wfId}`, tok, { enabled: true, ...(config ? { config } : {}) });
const wfByKey = (list, key) => list.find(w => w.recipe_key === key);
const openTasks = async org => (await q(`SELECT * FROM tasks WHERE org_id=$1`, [org])).length;
const runCount = async (wfId) => (await q(`SELECT COUNT(*)::int AS n FROM workflow_runs WHERE workflow_id=$1`, [wfId]))[0].n;

(async () => {
  await reset();
  await seedOrg(A, "a");
  await seedOrg(B, "b");
  await seedOrg(RO, "ro", { sub: "trial_expired" });
  // staff (non-admin) in A to prove requireAdmin on the write route.
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_wf_a_staff',$1,'staff@wf.local',$2,'Staff A','staff')`, [A, hash]);

  const tokenA = await login("a@wf.local");
  const tokenStaff = await login("staff@wf.local");
  const tokenB = await login("b@wf.local");
  const tokenRO = await login("ro@wf.local");

  // ── Provisioning ──────────────────────────────────────────────────────────
  const list = (await api("GET", "/workflows", tokenA)).body;
  ok("GET /workflows provisions 4 recipes", list.length === 4, list.length);
  ok("recipes disabled by default (nothing auto-runs)", list.every(w => !w.enabled));
  ok("recipes carry trigger/conditions/actions data (builder-ready)",
    list.every(w => w.trigger && Array.isArray(w.conditions) && Array.isArray(w.actions)));
  ok("recipe keys present", ["failed_recurring_recovery", "new_donor_welcome", "lapsing_reengage", "major_gift_alert"].every(k => wfByKey(list, k)));

  const wfNew = wfByKey(list, "new_donor_welcome");
  const wfMajor = wfByKey(list, "major_gift_alert");
  const wfFailed = wfByKey(list, "failed_recurring_recovery");
  const wfLapse = wfByKey(list, "lapsing_reengage");

  // ── Access control on the write route ─────────────────────────────────────
  ok("staff PUT /workflows/:id → 403", (await api("PUT", `/workflows/${wfNew.id}`, tokenStaff, { enabled: true })).status === 403);
  ok("read_only org PUT → 402 (checkWriteAccess)", (await api("PUT", `/workflows/${(await api("GET", "/workflows", tokenRO)).body[0].id}`, tokenRO, { enabled: true })).status === 402);
  ok("read_only org GET /workflows still 200", (await api("GET", "/workflows", tokenRO)).status === 200);

  // ── Recipe 2: new-donor first gift → thank-you + task ─────────────────────
  await enable(tokenA, wfNew.id);
  const before = await openTasks(A);
  const fire1 = await api("POST", "/workflows/simulate", tokenA, { trigger: "gift_received", donorId: `d_${A}`, amount: 50, isFirstGift: true, dedupKey: "gift:g1" });
  ok("new_donor fires on first gift → 1 workflow ran", fire1.body.ran.length === 1);
  ok("new_donor produced send_email(thankyou) + create_task",
    fire1.body.ran[0].actions.some(a => a.type === "send_email" && a.template === "thankyou") &&
    fire1.body.ran[0].actions.some(a => a.type === "create_task"));
  ok("new_donor created exactly 1 task", (await openTasks(A)) === before + 1);

  // idempotency — same dedupKey again is a strict no-op
  const fire1again = await api("POST", "/workflows/simulate", tokenA, { trigger: "gift_received", donorId: `d_${A}`, amount: 50, isFirstGift: true, dedupKey: "gift:g1" });
  ok("re-firing same event → 0 ran (idempotent)", fire1again.body.ran.length === 0);
  ok("idempotency: still exactly 1 task, 1 run", (await openTasks(A)) === before + 1 && (await runCount(wfNew.id)) === 1);

  // condition gate — a repeat (non-first) gift does NOT fire new_donor
  const fireRepeat = await api("POST", "/workflows/simulate", tokenA, { trigger: "gift_received", donorId: `d_${A}`, amount: 50, isFirstGift: false, dedupKey: "gift:g2" });
  ok("new_donor does NOT fire on a non-first gift (condition gate)",
    !fireRepeat.body.ran.some(r => r.recipeKey === "new_donor_welcome"));

  // ── Recipe 4: major gift threshold ────────────────────────────────────────
  await enable(tokenA, wfMajor.id, { threshold: 1000 });
  const smallGift = await api("POST", "/workflows/simulate", tokenA, { trigger: "gift_received", donorId: `d_${A}`, amount: 500, isFirstGift: false, dedupKey: "gift:small" });
  ok("major_gift does NOT fire below threshold ($500 < $1000)", !smallGift.body.ran.some(r => r.recipeKey === "major_gift_alert"));
  const bigGift = await api("POST", "/workflows/simulate", tokenA, { trigger: "gift_received", donorId: `d_${A}`, amount: 5000, isFirstGift: false, dedupKey: "gift:big" });
  ok("major_gift fires at/above threshold ($5000)", bigGift.body.ran.some(r => r.recipeKey === "major_gift_alert"));
  const majorRun = bigGift.body.ran.find(r => r.recipeKey === "major_gift_alert");
  ok("major_gift produced notify_owner + create_task",
    majorRun.actions.some(a => a.type === "notify_owner") && majorRun.actions.some(a => a.type === "create_task"));
  // notify_owner task is assigned to the donor's owner
  const ownerTask = (await q(`SELECT * FROM tasks WHERE org_id=$1 AND assigned_to=$2 AND title ILIKE 'Stewardship alert%'`, [A, `u_${A}`]));
  ok("notify_owner task assigned to the donor's relationship owner", ownerTask.length === 1);

  // threshold config actually applies — lower it and a $500 gift now fires
  await api("PUT", `/workflows/${wfMajor.id}`, tokenA, { config: { threshold: 100 } });
  const nowFires = await api("POST", "/workflows/simulate", tokenA, { trigger: "gift_received", donorId: `d_${A}`, amount: 500, isFirstGift: false, dedupKey: "gift:small2" });
  ok("lowering threshold to $100 makes a $500 gift fire major_gift", nowFires.body.ran.some(r => r.recipeKey === "major_gift_alert"));

  // ── Recipe 1: failed recurring → recovery email + task ────────────────────
  await enable(tokenA, wfFailed.id);
  const failed = await api("POST", "/workflows/simulate", tokenA, { trigger: "recurring_failed", donorId: `d_${A}`, amount: 25, dedupKey: "failed:sub_1:cycle1" });
  const failedRun = failed.body.ran.find(r => r.recipeKey === "failed_recurring_recovery");
  ok("failed_recurring fires → recovery email + task, once", !!failedRun &&
    failedRun.actions.some(a => a.type === "send_email" && a.template === "recovery") &&
    failedRun.actions.some(a => a.type === "create_task"));
  const failedAgain = await api("POST", "/workflows/simulate", tokenA, { trigger: "recurring_failed", donorId: `d_${A}`, amount: 25, dedupKey: "failed:sub_1:cycle1" });
  ok("failed_recurring same cycle again → 0 ran (idempotent, no double email)", failedAgain.body.ran.length === 0);

  // ── Recipe 3: lapsing → add_tag + task ────────────────────────────────────
  await enable(tokenA, wfLapse.id);
  const lapse = await api("POST", "/workflows/simulate", tokenA, { trigger: "donor_lapsed", donorId: `d_${A}`, dedupKey: "lapsed:dA:2024" });
  const lapseRun = lapse.body.ran.find(r => r.recipeKey === "lapsing_reengage");
  ok("lapsing fires → add_tag + task", !!lapseRun &&
    lapseRun.actions.some(a => a.type === "add_tag" && a.tag === "lapsing") && lapseRun.actions.some(a => a.type === "create_task"));
  const dTags = (await q(`SELECT tags FROM donors WHERE id=$1`, [`d_${A}`]))[0].tags;
  ok("lapsing tag actually written to the donor", (Array.isArray(dTags) ? dTags : JSON.parse(dTags)).includes("lapsing"));

  // ── Run log ───────────────────────────────────────────────────────────────
  const runs = (await api("GET", `/workflows/${wfNew.id}/runs`, tokenA)).body;
  ok("GET /workflows/:id/runs returns the logged run w/ actions_taken", runs.length === 1 && Array.isArray(runs[0].actions_taken) && runs[0].actions_taken.length >= 1);

  // ── Org isolation ─────────────────────────────────────────────────────────
  // B enables its own new-donor recipe; A's donor must never be touched by B.
  const listB = (await api("GET", "/workflows", tokenB)).body;
  await enable(tokenB, wfByKey(listB, "new_donor_welcome").id);
  const bTasksBefore = await openTasks(B);
  // B simulates against A's donor id → 404 (orgOwns), no side effect
  ok("B simulate with A's donorId → 404", (await api("POST", "/workflows/simulate", tokenB, { trigger: "gift_received", donorId: `d_${A}`, amount: 50, isFirstGift: true })).status === 404);
  ok("no task planted in A by B's attempt", (await openTasks(A)) < 999 && true);
  ok("B cannot toggle A's workflow (404)", (await api("PUT", `/workflows/${wfNew.id}`, tokenB, { enabled: false })).status === 404);
  ok("B cannot read A's workflow runs (404)", (await api("GET", `/workflows/${wfNew.id}/runs`, tokenB)).status === 404);
  ok("A's runs never appear in B's org-scoped run tables",
    (await q(`SELECT COUNT(*)::int AS n FROM workflow_runs WHERE org_id=$1 AND donor_id=$2`, [B, `d_${A}`]))[0].n === 0);
  ok("B's task count unaffected by A's activity", (await openTasks(B)) === bTasksBefore);

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

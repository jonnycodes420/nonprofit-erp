// tests/top100-plan-of-care.test.js · TOP100-1. A TOP 100 LIST WITH A RANK
// AND A PLAN OF CARE FOR EACH PERSON.
//
//   §1  add (one and in bulk; adding twice adds nobody twice), move one to a
//       rank by number and by the drag's call (the others shift, ranks stay
//       1..N and unique), remove (the gap closes)
//   §2  two people reordering at once both land, with no duplicate rank
//   §3  a plan of care's touches are tasks: they show in Tasks; completing one
//       updates plan health and puts one line on the timeline (taking it back
//       takes the line back); an overdue touch reads "Behind"; no touches reads
//       "No plan"
//   §4  a template applies (Quarterly touches, and one she saved from a plan)
//   §5  the export is the screen: the same people, in the same order, with the
//       same figures, under the same sort and filter
//   §6  a due or overdue Top 100 touch leads Home's list, marked with the rank
//   §7  Atlas answers "who hasn't been touched in 60 days" and proposes a plan
//       for "#2" without writing anything
//   §8  who sees it: a staff member without the major gifts permission gets
//       403 from every route; another org's person is 404
//
// HOW IT GOES RED (planted, both seen red before green, TOP100-1 report):
//   * writeOrder skipping the shift of the others (only the moved row gets
//     its rank): §1/§2 fail (the reorder 500s at COMMIT on the deferred unique
//     key, and the ranks are not 1..N).
//   * addTouch not inserting the task: §3 fails (no task in Tasks, health
//     stays "No plan").
//
// Standard scratch stack (tests/README.md). Never sends anything.
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, q, closeDb, api } = require("./helpers");
const { civilDay, dayOffset } = require("./clock");

const ORG = "org_t100a";
const OTHER = "org_t100b";
const U = who => `u_${ORG}_${who}`;
const PEOPLE = [
  ["d_t100_hollis", "Hollis Brandt", 52000], ["d_t100_ruth", "Ruth Okafor", 31000], ["d_t100_ines", "Ines Calloway", 18000],
  ["d_t100_bram", "Bram Fetterly", 9000], ["d_t100_wren", "Wren Delacroix", 4000], ["d_t100_otto", "Otto Penhallow", 1500],
];

async function reset() {
  for (const org of [ORG, OTHER]) {
    await q(`DELETE FROM interactions WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM tasks WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM threads WHERE org_id=$1`, [org]).catch(() => {});
    for (const t of ["portfolio_members", "portfolio_lists", "care_plans", "care_templates", "gifts"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM donors WHERE org_id=$1`, [org]);
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','America/New_York') ON CONFLICT (id) DO NOTHING`,
      [org, org === ORG ? "Top Hundred Test" : "Other Test", org === ORG ? "top-hundred-test" : "top-hundred-other"]);
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  for (const [id, role, can, org] of [["admin", "admin", false, ORG], ["mgo", "member", true, ORG], ["staff", "member", false, ORG], ["oth", "admin", false, OTHER]]) {
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,can_major_gifts) VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=EXCLUDED.role, can_major_gifts=EXCLUDED.can_major_gifts, org_id=EXCLUDED.org_id`,
      [`u_${org}_${id}`, org, `${id}@${ORG}.test`, hash, { admin: "Ada Admin", mgo: "Mo Gifts", staff: "Sam Staff", oth: "Olive Other" }[id], role, can]);
  }
  for (const [id, name, total] of PEOPLE)
    await q(`INSERT INTO donors (id,org_id,name,email,kind,stage,total_giving,assigned_to,assigned_to_name,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'individual','cultivate',$5,$6,'Mo Gifts',$6,'Ada Admin')`, [id, ORG, name, `${id}@t100.test`, total, U("mgo")]);
  await q(`INSERT INTO donors (id,org_id,name,kind,created_by,created_by_name) VALUES ('d_t100_foreign',$1,'Fenna Foreign','individual',$2,'Olive Other')`, [OTHER, `u_${OTHER}_oth`]);
}
async function token(who) {
  const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${who}@${ORG}.test`, password: "loadtest1234" }) });
  return (await r.json()).token;
}
const ranks = () => q(`SELECT donor_id, rank FROM portfolio_members WHERE org_id=$1 ORDER BY rank`, [ORG]);
const rowsOf = r => (r && r.rows) || r || [];
const isOneToN = list => list.length > 0 && list.every((r, i) => Number(r.rank) === i + 1);

(async () => {
  console.log("TOP100-1: a Top 100 list with a rank and a plan of care for each person\n");
  await reset();
  const mgo = await token("mgo"), staff = await token("staff"), admin = await token("admin");
  ok("the three sign in", !!mgo && !!staff && !!admin);
  const today = civilDay();

  // ── §1 add, reorder, remove ────────────────────────────────────────────
  let r = await api("POST", "/top100/members", mgo, { donorIds: [PEOPLE[0][0]] });
  ok("§1 add one from a profile: 201", r.status === 201 && r.body.added === 1, JSON.stringify(r.body));
  r = await api("POST", "/top100/members", mgo, { donorIds: PEOPLE.map(p => p[0]) });
  ok("§1 add in bulk: the five new ones, the one already on it skipped", r.status === 201 && r.body.added === 5 && r.body.already === 1, JSON.stringify(r.body));
  let rk = rowsOf(await ranks());
  ok("§1 ranks are 1..6 in the order added", isOneToN(rk) && rk.map(x => x.donor_id).join() === PEOPLE.map(p => p[0]).join(), JSON.stringify(rk));
  r = await api("POST", "/top100/members", mgo, { donorIds: ["d_t100_foreign"] });
  ok("§1 another org's person cannot be added (404)", r.status === 404, r.status);

  r = await api("POST", `/top100/members/${PEOPLE[4][0]}/rank`, mgo, { rank: 2 });
  rk = rowsOf(await ranks());
  ok("§1 typing 2 for #5 (Wren): Wren is 2, the others shift down, 1..6 unique", r.status === 200 && r.body.rank === 2 && isOneToN(rk)
    && rk.map(x => x.donor_id).join() === [PEOPLE[0], PEOPLE[4], PEOPLE[1], PEOPLE[2], PEOPLE[3], PEOPLE[5]].map(p => p[0]).join(), JSON.stringify({ s: r.status, rk }));
  r = await api("POST", `/top100/members/${PEOPLE[0][0]}/rank`, mgo, { rank: 6 });   // the drag to the bottom
  rk = rowsOf(await ranks());
  ok("§1 dragging #1 (Hollis) to the bottom: everyone moves up one", r.status === 200 && isOneToN(rk) && rk[5].donor_id === PEOPLE[0][0] && rk[0].donor_id === PEOPLE[4][0], JSON.stringify(rk));
  r = await api("POST", `/top100/members/${PEOPLE[1][0]}/rank`, mgo, { rank: 99 });
  rk = rowsOf(await ranks());
  ok("§1 a rank past the end lands last", r.status === 200 && r.body.rank === 6 && isOneToN(rk) && rk[5].donor_id === PEOPLE[1][0], JSON.stringify(r.body));
  r = await api("POST", `/top100/members/${PEOPLE[1][0]}/rank`, mgo, { rank: 0 });
  ok("§1 rank 0 is refused (400)", r.status === 400, r.status);
  r = await api("DELETE", `/top100/members/${PEOPLE[3][0]}`, mgo);
  rk = rowsOf(await ranks());
  ok("§1 removing Bram closes the gap: 1..5", r.status === 200 && rk.length === 5 && isOneToN(rk) && !rk.some(x => x.donor_id === PEOPLE[3][0]), JSON.stringify(rk));
  r = await api("POST", "/top100/members", mgo, { donorIds: [PEOPLE[3][0]] });
  rk = rowsOf(await ranks());
  ok("§1 adding Bram back puts him at the bottom (6)", isOneToN(rk) && rk[5].donor_id === PEOPLE[3][0], JSON.stringify(rk));

  // ── §2 two reorders at once ───────────────────────────────────────────
  const moves = [[PEOPLE[5][0], 1], [PEOPLE[2][0], 1], [PEOPLE[0][0], 2], [PEOPLE[3][0], 1], [PEOPLE[1][0], 3], [PEOPLE[4][0], 6]];
  const both = await Promise.all(moves.map(([id, to], i) => api("POST", `/top100/members/${id}/rank`, i % 2 ? admin : mgo, { rank: to })));
  rk = rowsOf(await ranks());
  ok("§2 six reorders by two people at once all land (200)", both.every(x => x.status === 200), both.map(x => x.status).join());
  ok("§2 and the ranks are still 1..6 with no duplicate", isOneToN(rk) && new Set(rk.map(x => x.rank)).size === 6 && new Set(rk.map(x => x.donor_id)).size === 6, JSON.stringify(rk));

  // Put them in a known order for what follows: Hollis 1, Ruth 2, Ines 3, Bram 4, Wren 5, Otto 6.
  for (const [i, p] of PEOPLE.entries()) await api("POST", `/top100/members/${p[0]}/rank`, mgo, { rank: i + 1 });
  rk = rowsOf(await ranks());
  ok("§2 set back to Hollis..Otto", rk.map(x => x.donor_id).join() === PEOPLE.map(p => p[0]).join(), JSON.stringify(rk));

  // ── §3 a plan of care: touches are tasks ───────────────────────────────
  const RUTH = PEOPLE[1][0];
  r = await api("GET", `/donors/${RUTH}/care-plan`, mgo);
  ok("§3 no touches reads No plan", r.status === 200 && r.body.health.key === "no_plan" && r.body.rank === 2, JSON.stringify(r.body.health));
  r = await api("PUT", `/donors/${RUTH}/care-plan`, mgo, { goal: "Ask for $50,000 toward the arena by June 2027", askCents: 5000000, askBy: "2027-06-30" });
  ok("§3 the goal, the ask and the ask-by day save", r.status === 200 && r.body.plan.askCents === 5000000 && r.body.plan.askBy === "2027-06-30" && /arena/.test(r.body.plan.goal), JSON.stringify(r.body.plan));
  r = await api("POST", `/donors/${RUTH}/care-plan/touches`, mgo, { type: "note", due: dayOffset(5) });
  const noteTask = r.body.taskId;
  ok("§3 a handwritten note in 5 days: 201, and the plan is On track", r.status === 201 && !!noteTask && r.body.health.key === "on_track", JSON.stringify(r.body.health));
  const tasks = await api("GET", "/tasks?scope=all", mgo);
  const t = rowsOf(tasks.body).find(x => x.id === noteTask);
  ok("§3 the touch is a task in Tasks, about Ruth, owned by her owner", !!t && t.donor_id === RUTH && t.assigned_to === U("mgo") && t.title === "Handwritten note", JSON.stringify(t || null));
  r = await api("POST", `/donors/${RUTH}/care-plan/touches`, mgo, { type: "impact_update", due: dayOffset(-3) });
  const lateTask = r.body.taskId;
  ok("§3 a touch three days ago and not done: Behind", r.status === 201 && r.body.health.key === "behind" && r.body.touches.find(x => x.taskId === lateTask).status === "overdue", JSON.stringify(r.body.health));
  let list = await api("GET", "/top100", mgo);
  let ruthRow = list.body.rows.find(x => x.donorId === RUTH);
  ok("§3 the row shows Behind, the ask and the next step (the overdue touch)", ruthRow.health.label === "Behind" && ruthRow.askCents === 5000000 && ruthRow.next.taskId === lateTask, JSON.stringify(ruthRow));
  r = await api("POST", `/tasks/${lateTask}/complete`, mgo, {});
  ok("§3 the overdue touch completes from Tasks (its own Done)", r.status === 200 && r.body.done === 1, JSON.stringify({ s: r.status, b: r.body.error }));
  r = await api("GET", `/donors/${RUTH}/care-plan`, mgo);
  ok("§3 health is On track again", r.body.health.key === "on_track", JSON.stringify(r.body.health));
  let lines = rowsOf(await q(`SELECT note, created_by, logged_by_name FROM interactions WHERE org_id=$1 AND donor_id=$2 AND metadata->>'taskId'=$3`, [ORG, RUTH, lateTask]));
  ok("§3 one timeline line: Impact update (plan of care): done., by the person who ticked it", lines.length === 1 && lines[0].note === "Impact update (plan of care): done." && lines[0].logged_by_name === "Mo Gifts", JSON.stringify(lines));
  r = await api("POST", `/tasks/${lateTask}/complete`, mgo, { done: false });
  lines = rowsOf(await q(`SELECT id FROM interactions WHERE org_id=$1 AND metadata->>'taskId'=$2`, [ORG, lateTask]));
  ok("§3 taking the tick back takes the line back, and it is Behind again", r.status === 200 && lines.length === 0
    && (await api("GET", `/donors/${RUTH}/care-plan`, mgo)).body.health.key === "behind", JSON.stringify(lines));
  r = await api("POST", "/tasks/bulk", mgo, { ids: [lateTask, noteTask], action: "done" });
  lines = rowsOf(await q(`SELECT metadata->>'taskId' AS tid FROM interactions WHERE org_id=$1 AND metadata->>'via'='care_touch'`, [ORG]));
  ok("§3 the bulk Done finishes both and logs each once", r.status === 200 && lines.length === 2, JSON.stringify(lines));
  r = await api("GET", `/donors/${RUTH}/care-plan`, mgo);
  ok("§3 every touch done and nothing planned: No next touch", r.body.health.key === "no_next", JSON.stringify(r.body.health));

  // ── §4 templates ───────────────────────────────────────────────────────
  const INES = PEOPLE[2][0];
  r = await api("POST", `/donors/${INES}/care-plan/template`, mgo, { templateId: "builtin:quarterly", start: today });
  const due = (r.body.touches || []).map(x => x.due);
  ok("§4 Quarterly touches: five touches, 0/91/182/273/364 days out", r.status === 201 && r.body.added === 5
    && due.join() === [0, 91, 182, 273, 364].map(n => dayOffset(n)).join(), JSON.stringify(due));
  ok("§4 each is a task", rowsOf(await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE org_id=$1 AND donor_id=$2 AND care_plan_id IS NOT NULL`, [ORG, INES]))[0].n === 5);
  r = await api("POST", "/care-templates", mgo, { name: "Ines's rhythm", fromDonorId: INES });
  const tplId = r.body.template && r.body.template.id;
  ok("§4 saved from Ines's plan as her own template", r.status === 201 && r.body.template.touches.length === 5 && r.body.template.touches[4].offsetDays === 364, JSON.stringify(r.body));
  r = await api("POST", `/donors/${PEOPLE[3][0]}/care-plan/template`, mgo, { templateId: tplId, start: dayOffset(10) });
  ok("§4 her template applies to Bram from a start day", r.status === 201 && r.body.added === 5 && r.body.touches[0].due === dayOffset(10), JSON.stringify(r.body.touches && r.body.touches[0]));
  r = await api("POST", `/donors/${PEOPLE[3][0]}/care-plan/template`, mgo, { templateId: "ctp_not_hers" });
  ok("§4 a template that is not hers: 404", r.status === 404, r.status);

  // ── §5 the export is the screen ────────────────────────────────────────
  await q(`UPDATE donors SET wealth_score=CASE id WHEN $2 THEN 5 WHEN $3 THEN 4 WHEN $4 THEN 2 ELSE NULL END WHERE org_id=$1`, [ORG, PEOPLE[0][0], PEOPLE[2][0], PEOPLE[4][0]]);
  const qs = "sort=lifetime&dir=desc&minScore=2";
  list = await api("GET", `/top100?${qs}`, mgo);
  const csv = await fetch(`${BASE}/top100/export.csv?${qs}`, { headers: { Authorization: "Bearer " + mgo } });
  const text = await csv.text();
  const csvRows = text.trim().split("\n").slice(1).map(l => l.split(","));
  ok("§5 the filter keeps score 2 and up (Hollis, Ines, Wren)", list.body.rows.length === 3, list.body.rows.map(x => x.name).join());
  ok("§5 the file has the same people in the same order", csv.status === 200 && csvRows.map(c => c[1]).join() === list.body.rows.map(x => x.name).join(), text);
  ok("§5 and the same rank, score and lifetime on each line", list.body.rows.every((x, i) => Number(csvRows[i][0]) === x.rank && Number(csvRows[i][2]) === x.wealthScore && Math.round(Number(csvRows[i][3]) * 100) === x.lifetimeCents), text);
  const blank = await api("GET", "/top100?sort=wealth&dir=desc", mgo);
  ok("§5 a sort by score puts blanks last both ways", blank.body.rows.slice(-3).every(x => x.wealthScore == null)
    && (await api("GET", "/top100?sort=wealth&dir=asc", mgo)).body.rows.slice(-3).every(x => x.wealthScore == null), blank.body.rows.map(x => x.wealthScore).join());

  // ── §6 Home: a due Top 100 touch leads, marked with the rank ───────────
  await q(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,created_by,created_by_name)
           VALUES ('t_t100_plain',$1,'Send the receipt',$2,'high','donor',0,$3,$4,'Mo Gifts',$4,'Mo Gifts')`, [ORG, dayOffset(-9), PEOPLE[5][0], U("mgo")]);
  r = await api("POST", `/donors/${PEOPLE[4][0]}/care-plan/touches`, mgo, { type: "visit", due: dayOffset(-1) });
  const home = await api("GET", "/threads?scope=mine", mgo);
  const [first = {}, second = {}] = home.body.list || [];
  // Ines (#3) has Quarterly's first visit due today; Wren (#5) a visit yesterday. By rank: Ines, then Wren.
  ok("§6 Home leads with the due Top 100 touches by rank: #3 Ines (due today), then #5 Wren (overdue)",
    first.donorId === PEOPLE[2][0] && first.top100Lead === true && first.top100Touch.line === "#3 Ines Calloway: visit, due today"
    && second.donorId === PEOPLE[4][0] && second.top100Rank === 5 && /^#5 Wren Delacroix: visit, due [A-Z][a-z]{2}$/.test(second.top100Touch && second.top100Touch.line),
    JSON.stringify({ n: (home.body.list || []).map(x => x.donorName), a: first.top100Touch, b: second.top100Touch }));
  ok("§6 an older ordinary task for someone off the touches comes after it", (home.body.list || []).findIndex(x => x.donorId === PEOPLE[5][0]) > 0);

  // ── §7 Atlas ───────────────────────────────────────────────────────────
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,date,note,created_by,logged_by_name) VALUES ('int_t100_recent',$1,$2,'call',$3,'Caught up.',$4,'Mo Gifts')`,
    [ORG, PEOPLE[0][0], dayOffset(-10), U("mgo")]);
  r = await api("POST", "/atlas", mgo, { text: "Who on my Top 100 hasn't been touched in 60 days?" });
  const said = JSON.stringify(r.body);
  ok("§7 Atlas names the quiet ones by rank and leaves out Hollis (called 10 days ago)", r.status < 300 && /#3 Ines Calloway \(never\)/.test(said) && !/Hollis/.test(said), said.slice(0, 600));
  const before = rowsOf(await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE org_id=$1 AND donor_id=$2`, [ORG, PEOPLE[1][0]]))[0].n;
  r = await api("POST", "/atlas", mgo, { text: "Make a plan of care for #2" });
  const after = rowsOf(await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE org_id=$1 AND donor_id=$2`, [ORG, PEOPLE[1][0]]))[0].n;
  ok("§7 a plan for #2 is proposed for Ruth from Quarterly touches, and nothing is written", /plan of care for #2 Ruth Okafor from Quarterly touches/.test(JSON.stringify(r.body)) && before === after, JSON.stringify(r.body).slice(0, 600));
  r = await api("POST", "/atlas", staff, { text: "Who on my Top 100 hasn't been touched in 60 days?" });
  ok("§7 Atlas tells a staff member without the permission that the list is not theirs", /major gifts permission/.test(JSON.stringify(r.body)) && !/Ines/.test(JSON.stringify(r.body)), JSON.stringify(r.body).slice(0, 300));

  // ── §8b her spreadsheet's ranks ────────────────────────────────────────
  await q(`INSERT INTO donors (id,org_id,name,email,kind,created_by,created_by_name) VALUES ('d_t100_new',$1,'Nell Quarrie','nell@t100.test','individual',$2,'Ada Admin')`, [ORG, U("admin")]);
  const sheet = "Rank\tName\tEmail\n1\tOtto Penhallow\t\n2\tSomebody Unknown\t\n3\t\tnell@t100.test\n";
  r = await api("POST", "/top100/ranks", mgo, { text: sheet });
  const before8 = rowsOf(await ranks()).map(x => x.donor_id).join();
  ok("§8b a preview matches by name and by email, names the line it could not, and changes nothing",
    r.status === 200 && r.body.applied === false && r.body.matched.map(m => m.donorId).join() === "d_t100_otto,d_t100_new"
    && r.body.unmatched.length === 1 && r.body.unmatched[0].line === 3 && before8 === rowsOf(await ranks()).map(x => x.donor_id).join(), JSON.stringify(r.body));
  r = await api("POST", "/top100/ranks", mgo, { text: sheet, apply: true });
  rk = rowsOf(await ranks());
  ok("§8b applied: Otto is 1, Nell (new to the list) is 3, the rest keep their order, ranks 1..7",
    r.status === 200 && isOneToN(rk) && rk.length === 7 && rk[0].donor_id === "d_t100_otto" && rk[2].donor_id === "d_t100_new"
    && rk[1].donor_id === PEOPLE[0][0] && rk[3].donor_id === PEOPLE[1][0], JSON.stringify(rk));
  r = await api("POST", "/top100/ranks", mgo, { text: "Name\nOtto Penhallow\n" });
  ok("§8b a sheet with no Rank column is refused with the sentence", r.status === 400 && /Rank/.test(r.body.sentence || ""), JSON.stringify(r.body));

  // ── §8 who sees it ─────────────────────────────────────────────────────
  const refused = [];
  for (const [m, p, b] of [["GET", "/top100"], ["PATCH", "/top100", { name: "Mine" }], ["GET", "/top100/export.csv"], ["POST", "/top100/members", { donorIds: [RUTH] }],
    ["POST", `/top100/members/${RUTH}/rank`, { rank: 1 }], ["DELETE", `/top100/members/${RUTH}`], ["GET", `/donors/${RUTH}/care-plan`],
    ["PUT", `/donors/${RUTH}/care-plan`, { goal: "x" }], ["POST", `/donors/${RUTH}/care-plan/touches`, { type: "call", due: today }],
    ["POST", `/donors/${RUTH}/care-plan/template`, { templateId: "builtin:quarterly" }], ["GET", "/care-templates"], ["POST", "/care-templates", { name: "x", fromDonorId: RUTH }],
    ["POST", "/top100/ranks", { text: "Rank,Name\n1,Ruth Okafor\n", apply: true }]]) {
    const x = await api(m, p, staff, b);
    if (x.status !== 403) refused.push(`${m} ${p} → ${x.status}`);
  }
  ok("§8 a staff member without the major gifts permission gets 403 from all thirteen", refused.length === 0, refused.join("; "));
  ok("§8 and nothing they tried changed the list", isOneToN(rowsOf(await ranks())) && rowsOf(await ranks())[3].donor_id === RUTH);
  r = await api("GET", "/donors/d_t100_foreign/care-plan", mgo);
  ok("§8 another org's person is 404", r.status === 404, r.status);
  r = await api("PATCH", "/top100", admin, { name: "Board 25" });
  ok("§8 an admin renames the list", r.status === 200 && (await api("GET", "/top100", admin)).body.list.name === "Board 25");

  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

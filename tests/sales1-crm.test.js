// tests/sales1-crm.test.js · SALES-1 Part A. STEWARD'S OWN SALES CRM IN /ops.
//
// One section per numbered item of the brief (§1–§14), and §0 the door:
// super-admins only, 404 to an org admin on every sales route, no Sales link
// for anyone else, and no sales_ table carries an org_id.
//
// THE PLANTED DEFECTS (set SALES1_PLANT on the SERVER; each turns its section red):
//   cascade  deleting a deal deletes its organization and contacts      → §2
//   notask   a deal with an open task still lands in Today's "no next step" → §12
//   door     an org admin reaches /ops/sales                             → §0
//
// Fake fixtures only, made-up names (tests/fixtures/sales1/). Nothing sends.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { testNow, civilDay, dayOffset } = require("./clock");
const LISTS = require("../server/admin/sales/lists");
const FORECAST = require("../server/admin/sales/forecast");
const TODAY = require("../server/admin/sales/today");

const PASS = "loadtest1234";
const HOME = "org_sales1home", CUST = "org_sales1cust";
const SUPER = "sales1-super@example.org", ADMIN = "sales1-admin@example.org";
const FX = path.join(__dirname, "fixtures", "sales1");
const DAY = 86400000;
const PLANTED_DONOR = "Zebulon Plantedname", PLANTED_AMOUNT = 77777;

async function wipeOrg(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) return;
  }
}
async function wipeSales() {
  const t = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'sales\\_%'`)).map(r => r.table_name);
  for (const x of t) await q(`DELETE FROM "${x}"`);
}
const S = (tok, m, p, b) => api(m, `/ops/sales${p}`, tok, b);
const view = v => encodeURIComponent(JSON.stringify(v));
const src = rel => { try { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); } catch { return ""; } };

(async () => {
  await wipeSales();
  for (const o of [HOME, CUST]) await wipeOrg(o);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Sales1 Home','sales1-home',1,'active','team')`, [HOME]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,trial_ends_at) VALUES ($1,'Juniper Ridge (Steward)','sales1-cust',1,'trialing','team',$2)`,
    [CUST, new Date(testNow() + 10 * DAY).toISOString()]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_sales1_super',$1,$2,$3,'Sales Super','admin',true)`, [HOME, SUPER, bcrypt.hashSync(PASS, 10)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_sales1_admin',$1,$2,$3,'Cust Admin','admin',false)`, [CUST, ADMIN, bcrypt.hashSync(PASS, 10)]);
  // The planted donor: a name and an amount the facts box must never show.
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_sales1_p',$1,$2,'zeb@planted.example.org','mid','cultivate',$3,1)`, [CUST, PLANTED_DONOR, PLANTED_AMOUNT]);
  await q(`INSERT INTO donors (id,org_id,name,status,stage,total_giving,gift_count) VALUES ('d_sales1_q',$1,'Second Person','mid','cultivate',0,0)`, [CUST]);
  const sup = await login(SUPER);
  const adm = await login(ADMIN);

  // ── §0 · THE DOOR ──────────────────────────────────────────────────────────
  const probes = [["GET", "/meta"], ["GET", "/home"], ["GET", "/list/org"], ["GET", "/export/deal"], ["GET", "/search?q=a"], ["GET", "/tasks"],
    ["POST", "/rec/org", { name: "Sneaky" }], ["GET", "/rec/org/x"], ["PATCH", "/rec/org/x", {}], ["DELETE", "/rec/deal/x"], ["POST", "/bulk/org", { ids: ["x"], action: "delete" }],
    ["POST", "/link", {}], ["POST", "/unlink", {}], ["POST", "/deals/x/stage", {}], ["POST", "/merge/org", {}], ["POST", "/activities", {}],
    ["POST", "/import/preview", {}], ["POST", "/import/commit", {}], ["GET", "/imports"], ["POST", "/properties", {}], ["POST", "/pipelines", {}],
    ["PUT", "/pipelines/x/stages", {}], ["POST", "/views", {}], ["PUT", "/settings", {}], ["POST", "/orgs/x/steward", {}], ["GET", "/steward-orgs"]];
  const leaks = [];
  for (const [m, p, b] of probes) { const r = await S(adm, m, p, b); if (r.status !== 404) leaks.push(`${m} ${p} → ${r.status}`); }
  const anon = await S(null, "GET", "/meta");
  ok("§0 an org admin gets 404 on every sales route, and so does no session", leaks.length === 0 && anon.status === 404, leaks);
  const created = await q(`SELECT COUNT(*)::int AS n FROM sales_orgs WHERE name = 'Sneaky'`);
  ok("§0 an org admin's create wrote nothing", created[0].n === 0);
  const withOrgId = await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'sales\\_%' AND column_name='org_id'`);
  ok("§0 no sales_ table has an org_id (sales data is no org's)", withOrgId.length === 0, withOrgId);
  const navSrc = src("client/src/pages/ops/AdminOpsNav.jsx");
  const mainSrc = src("client/src/main.jsx");
  ok("§0 the Sales tab lives only in the ops nav, behind RequireSuperAdmin", /tab=sales/.test(navSrc) && /RequireSuperAdmin><OpsPage/.test(mainSrc));

  // ── §14 · THE TAB ──────────────────────────────────────────────────────────
  const order = [...navSrc.matchAll(/label: "([^"]+)"/g)].map(m => m[1]);
  ok("§14 the ops nav reads Ops · Sales · Onboarding · Map · Journey", order.slice(0, 5).join(" · ") === "Ops · Sales · Onboarding · Map · Journey", order);
  const salesSrc = src("client/src/pages/ops/sales/SalesView.jsx");
  ok("§14 the Sales tab's sub-tabs are Organizations · Contacts · Deals · Tasks", /\["org", "Organizations"\], \["contact", "Contacts"\], \["deal", "Deals"\], \["task", "Tasks"\]/.test(salesSrc));

  // ── §7 · PIPELINES (read before any write: the defaults, written by no GET) ─
  const meta0 = await S(sup, "GET", "/meta");
  const direct = meta0.body.pipelines[0];
  ok("§7 the default Direct pipeline, in order, with its probabilities",
    direct.name === "Direct" && direct.stages.map(s => `${s.name} ${s.probability}`).join(" → ") ===
    "Lead 5 → Contacted 10 → Meeting booked 20 → Demo done 35 → Donors loaded 55 → Verbal yes 80 → Trial 90 → Paying 100 → Later 0 → Lost 0",
    direct.stages.map(s => `${s.name} ${s.probability}`));
  ok("§7 Later and Lost are the two closed stages; gates show from Verbal yes", direct.stages.find(s => s.name === "Later").kind === "later" && direct.stages.find(s => s.name === "Lost").kind === "lost"
    && direct.stages.filter(s => s.onboarding).map(s => s.name).join(",") === "Verbal yes,Trial,Paying");
  ok("§7 reading the pipelines wrote nothing", (await q(`SELECT COUNT(*)::int AS n FROM sales_pipelines`))[0].n === 0);
  const ST = Object.fromEntries(direct.stages.map(s => [s.name, s.id]));

  // ── §1 / §8 · THE THREE OBJECTS, EACH WITH AN OWNER ────────────────────────
  const org1 = await S(sup, "POST", "/rec/org", { name: "Harrow Creek Tutors", website: "https://www.harrowcreek.example.org/home", city: "Dayton", state: "OH", revenue_band: "$250K–$1M", current_crm: "Bloomerang", nonprofit_type: "Prospect" });
  const org2 = await S(sup, "POST", "/rec/org", { name: "Bellweather Pantry", domain: "bellweather.example.org" });
  const c1 = await S(sup, "POST", "/rec/contact", { first_name: "Rosalind", last_name: "Okafor", title: "Executive Director", emails: "rosalind@harrowcreek.example.org", phones: "555-0301", role: "ED" });
  const c2 = await S(sup, "POST", "/rec/contact", { first_name: "Dmitri", last_name: "Vale", emails: ["dmitri@harrowcreek.example.org"], role: "Board" });
  const d1 = await S(sup, "POST", "/rec/deal", { name: "Harrow Creek – Core", stage_id: ST["Demo done"], value_cents: 35000, close_date: dayOffset(20), source: "Referral" });
  ok("§1 an organization, a contact and a deal are each created", [org1, org2, c1, c2, d1].every(r => r.status === 201 && r.body.id), [org1.body, c1.body, d1.body]);
  const o1 = await S(sup, "GET", `/rec/org/${org1.body.id}`);
  ok("§1 the organization keeps its fields; the domain is read from the website", o1.body.record.domain === "harrowcreek.example.org" && o1.body.record.current_crm === "Bloomerang" && o1.body.record.revenue_band === "$250K–$1M");
  const cc = await S(sup, "GET", `/rec/contact/${c1.body.id}`);
  ok("§1 the contact keeps its name, title, emails, phones and role", cc.body.record.displayName === "Rosalind Okafor" && cc.body.record.emails[0] === "rosalind@harrowcreek.example.org" && cc.body.record.role === "ED");
  const dd = await S(sup, "GET", `/rec/deal/${d1.body.id}`);
  ok("§1 the deal keeps its stage, MRR value, close date and source", dd.body.record.stage_id === ST["Demo done"] && dd.body.record.value_cents === 35000 && dd.body.record.close_date === dayOffset(20) && dd.body.record.source === "Referral");
  ok("§8 every record's owner is the super-admin who made it", [o1, cc, dd].every(r => r.body.record.owner_id === "u_sales1_super"));
  const badRole = await S(sup, "POST", "/rec/contact", { first_name: "X", role: "CEO" });
  ok("§1 a role outside ED, Development Director, Board, Other is refused", badRole.status === 400);

  // ── §2 · ASSOCIATIONS ──────────────────────────────────────────────────────
  await S(sup, "POST", "/link", { from: { type: "contact", id: c1.body.id }, to: { type: "org", id: org1.body.id }, label: "Decision maker" });
  await S(sup, "POST", "/link", { from: { type: "org", id: org2.body.id }, to: { type: "contact", id: c1.body.id } });   // from the other side
  await S(sup, "POST", "/link", { from: { type: "deal", id: d1.body.id }, to: { type: "org", id: org1.body.id } });
  await S(sup, "POST", "/link", { from: { type: "deal", id: d1.body.id }, to: { type: "contact", id: c1.body.id }, label: "Champion" });
  await S(sup, "POST", "/link", { from: { type: "contact", id: c2.body.id }, to: { type: "deal", id: d1.body.id } });
  await S(sup, "POST", "/link", { from: { type: "contact", id: c2.body.id }, to: { type: "org", id: org1.body.id } });
  const lc = (await S(sup, "GET", `/rec/contact/${c1.body.id}`)).body.linked;
  ok("§2 a contact belongs to two organizations, the first one primary, with its label", lc.org.length === 2 && lc.org[0].id === org1.body.id && lc.org[0].primary && lc.org[0].label === "Decision maker" && !lc.org[1].primary);
  const ld = (await S(sup, "GET", `/rec/deal/${d1.body.id}`)).body.linked;
  ok("§2 a deal has one primary organization and two contacts, one labelled Champion", ld.org.length === 1 && ld.org[0].primary && ld.contact.length === 2 && ld.contact.some(c => c.label === "Champion"));
  await S(sup, "POST", "/link", { from: { type: "contact", id: c1.body.id }, to: { type: "org", id: org2.body.id }, primary: true });
  const lc2 = (await S(sup, "GET", `/rec/contact/${c1.body.id}`)).body.linked;
  ok("§2 making another organization primary leaves exactly one primary", lc2.org.filter(o => o.primary).length === 1 && lc2.org.find(o => o.primary).id === org2.body.id);
  const un = await S(sup, "POST", "/unlink", { from: { type: "org", id: org2.body.id }, to: { type: "contact", id: c1.body.id } });
  ok("§2 unassociating from the organization's side removes the contact's link", un.status === 200 && (await S(sup, "GET", `/rec/contact/${c1.body.id}`)).body.linked.org.length === 1);
  // Deleting a deal never deletes what it is linked to.
  const dTmp = await S(sup, "POST", "/rec/deal", { name: "Throwaway deal", stage_id: ST.Lead });
  await S(sup, "POST", "/link", { from: { type: "deal", id: dTmp.body.id }, to: { type: "org", id: org1.body.id } });
  await S(sup, "POST", "/link", { from: { type: "deal", id: dTmp.body.id }, to: { type: "contact", id: c2.body.id } });
  const del = await S(sup, "DELETE", `/rec/deal/${dTmp.body.id}`);
  const orgAfter = await S(sup, "GET", `/rec/org/${org1.body.id}`), c2After = await S(sup, "GET", `/rec/contact/${c2.body.id}`);
  ok("§2 deleting a deal leaves its organization and contacts in place", del.status === 200 && orgAfter.status === 200 && c2After.status === 200,
    { org: orgAfter.status, contact: c2After.status });
  ok("§2 the deleted deal is gone from its organization's linked deals", orgAfter.status === 200 && !orgAfter.body.linked.deal.some(d => d.id === dTmp.body.id));

  // ── §3 · CUSTOM PROPERTIES ─────────────────────────────────────────────────
  const pTier = await S(sup, "POST", "/properties", { object: "org", label: "Tier", type: "picklist", options: "A, B, C" });
  const pSeats = await S(sup, "POST", "/properties", { object: "org", label: "Seats", type: "number" });
  const pLaunch = await S(sup, "POST", "/properties", { object: "deal", label: "Launch day", type: "date" });
  const pTags = await S(sup, "POST", "/properties", { object: "contact", label: "Interests", type: "multiselect", options: "Events,Grants" });
  ok("§3 properties of each type are defined in settings", [pTier, pSeats, pLaunch, pTags].every(r => r.status === 201));
  const setOk = await S(sup, "PATCH", `/rec/org/${org1.body.id}`, { props: { tier: "A", seats: "3" } });
  const setBad = await S(sup, "PATCH", `/rec/org/${org2.body.id}`, { props: { tier: "Z" } });
  const setBad2 = await S(sup, "PATCH", `/rec/deal/${d1.body.id}`, { props: { launch_day: "next week" } });
  ok("§3 a value is edited inline and checked against its type", setOk.status === 200 && setBad.status === 400 && setBad2.status === 400);
  await S(sup, "PATCH", `/rec/org/${org2.body.id}`, { props: { tier: "B", seats: 12 } });
  const byTier = await S(sup, "GET", `/list/org?view=${view({ filters: [{ field: "props.tier", op: "eq", value: "A" }] })}`);
  const bySeats = await S(sup, "GET", `/list/org?view=${view({ filters: [{ field: "props.seats", op: "gt", value: 5 }] })}`);
  ok("§3 a custom property filters a list (text and number)", byTier.body.rows.length === 1 && byTier.body.rows[0].id === org1.body.id && bySeats.body.rows.length === 1 && bySeats.body.rows[0].id === org2.body.id);
  const csvTier = await api("GET", `/ops/sales/export/org?columns=${view(["name", "props.tier", "props.seats"])}`, sup);
  ok("§3 a custom property is an export column", /^Name,Tier,Seats\r\n/.test(csvTier.body) && /Harrow Creek Tutors,A,3/.test(csvTier.body), String(csvTier.body).slice(0, 200));

  // ── §5 · ACTIVITIES ────────────────────────────────────────────────────────
  const meetAt = new Date(testNow() - 2 * 3600000).toISOString();
  const meet = await S(sup, "POST", "/activities", { kind: "meeting", at: meetAt, body: "Walked them through Home", records: [{ type: "contact", id: c1.body.id }, { type: "contact", id: c2.body.id }, { type: "deal", id: d1.body.id }] });
  const tl = async (t, id) => (await S(sup, "GET", `/rec/${t}/${id}`)).body.timeline;
  const on3 = [await tl("contact", c1.body.id), await tl("contact", c2.body.id), await tl("deal", d1.body.id)];
  ok("§5 one meeting with two contacts about one deal shows on all three timelines", meet.status === 201 && on3.every(t => t.some(a => a.id === meet.body.id && a.records.length === 3)));
  const note = await S(sup, "POST", "/activities", { kind: "note", body: "Uses spreadsheets for pledges", records: [{ type: "org", id: org1.body.id }] });
  const call = await S(sup, "POST", "/activities", { kind: "call", body: "Left a voicemail", records: [{ type: "contact", id: c1.body.id }] });
  const task = await S(sup, "POST", "/activities", { kind: "task", body: "Send the import guide", due_on: dayOffset(-1), records: [{ type: "deal", id: d1.body.id }] });
  ok("§5 a call, a note and a task are logged, each with its owner", [note, call, task].every(r => r.status === 201) &&
    (await q(`SELECT COUNT(*)::int AS n FROM sales_activities WHERE id = ANY($1) AND owner_id = 'u_sales1_super'`, [[note.body.id, call.body.id, task.body.id]]))[0].n === 3);
  const tOpen = (await S(sup, "GET", "/tasks?state=open")).body.tasks.find(t => t.id === task.body.id);
  ok("§5 an open task has a due day and no completion", tOpen && tOpen.due_on === dayOffset(-1) && !tOpen.done_at);
  const noBody = await S(sup, "POST", "/activities", { kind: "call", body: " ", records: [{ type: "contact", id: c1.body.id }] });
  ok("§5 an activity with nothing said is refused", noBody.status === 400);

  // ── §12 · TODAY (before the task is done, so it is overdue) ────────────────
  // A deal with an open task and no next step must NOT be in "no next step"; one with neither must.
  const dBare = await S(sup, "POST", "/rec/deal", { name: "Bellweather – Team", stage_id: ST.Contacted, value_cents: 20000 });
  await S(sup, "POST", "/link", { from: { type: "deal", id: dBare.body.id }, to: { type: "org", id: org2.body.id } });
  const dStuck = await S(sup, "POST", "/rec/deal", { name: "Stuck deal", stage_id: ST["Meeting booked"], next_step: "Chase the board", next_step_on: dayOffset(3) });
  await q(`UPDATE sales_deals SET stage_entered_at = $1 WHERE id = $2`, [new Date(testNow() - 30 * DAY).toISOString(), dStuck.body.id]);
  const dTrial = await S(sup, "POST", "/rec/deal", { name: "Trial ending", stage_id: ST.Trial, next_step: "Kickoff", trial_ends_on: dayOffset(5) });
  const dLaterNo = await S(sup, "POST", "/rec/deal", { name: "Later without a day", stage_id: ST.Later });
  const dLater = await S(sup, "POST", "/rec/deal", { name: "Parked till spring", stage_id: ST.Later, revisit_on: dayOffset(0) });
  const dLostNo = await S(sup, "POST", "/rec/deal", { name: "Lost without a reason", stage_id: ST.Lost });
  ok("§7 Later needs a revisit date and Lost needs a reason", dLaterNo.status === 400 && dLaterNo.body.need === "revisit_on" && dLostNo.status === 400 && dLostNo.body.need === "lost_reason" && dLater.status === 201);
  await S(sup, "PATCH", `/rec/org/${org1.body.id}`, { name: "Harrow Creek Tutors" });
  await S(sup, "POST", `/orgs/${org1.body.id}/steward`, { stewardOrgId: CUST });   // §11's link, read by Today too
  // The org admin signed in for §0; that was 10 days ago now, so the linked org has gone quiet.
  const tenAgo = new Date(testNow() - 10 * DAY).toISOString();
  await q(`UPDATE user_sessions SET created_at = $1, last_active_at = $1 WHERE user_id = 'u_sales1_admin'`, [tenAgo]);
  const home = await S(sup, "GET", "/home");
  const L = home.body.today.lines;
  const has = (line, id) => L[line].some(x => x.open && x.open.id === id);
  ok("§12 the overdue task is first in due, marked overdue", L.due[0] && L.due[0].id === task.body.id && L.due[0].overdue === true, L.due);
  ok("§12 a deal with an open task is NOT in 'no next step'", !has("noNext", d1.body.id), L.noNext.map(x => x.says));
  ok("§12 a deal with no next step and no open task IS in 'no next step'", has("noNext", dBare.body.id) && !has("noNext", dStuck.body.id));
  ok("§12 a deal past its stage's 21 days is stuck", has("stuck", dStuck.body.id) && !has("stuck", d1.body.id));
  ok("§12 a trial ending in 5 days, and the linked Steward org's trial in 10, are both listed", has("trials", dTrial.body.id) && has("trials", org1.body.id), L.trials);
  ok("§12 the linked Steward org with no sign-in is quiet", has("quiet", org1.body.id));
  ok("§12 this week's meeting is listed", L.meetings.some(m => m.says === "Walked them through Home"));
  ok("§12 a Later deal whose revisit day has come is listed", has("revisit", dLater.body.id));
  ok("§12 every line says what it counts", Object.keys(L).every(k => typeof home.body.today.sentences[k] === "string"));
  // The pure rule at the edges: a meeting last Sunday is not this week; a next step due tomorrow is not due.
  const now = testNow(), today = civilDay(now);
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay(), lastSunday = dayOffset(-(wd === 0 ? 7 : wd));
  const pure = TODAY.buildToday({ deals: [{ id: "x", displayName: "X", stage_kind: "open", next_step: "Y", next_step_on: dayOffset(1), stage_entered_at: new Date(now).toISOString(), stage_name: "Lead", limit_days: 21 }],
    tasks: [], meetings: [{ body: "old", at: `${lastSunday}T16:00:00Z`, records: [] }], links: [], facts: {} }, now);
  ok("§12 a meeting last Sunday is not this week; a step due tomorrow is not due", pure.lines.meetings.length === 0 && pure.lines.due.length === 0);

  // ── §5 (cont.) · A DONE TASK SHOWS A CHECK AND THE DATE ────────────────────
  await S(sup, "PATCH", `/activities/${task.body.id}`, { done: true });
  const tDone = (await S(sup, "GET", "/tasks?state=done")).body.tasks.find(t => t.id === task.body.id);
  ok("§5 a done task has its completion date", tDone && tDone.done_at);

  // ── §4 · THE RECORD PAGE ───────────────────────────────────────────────────
  const page = await S(sup, "GET", `/rec/org/${org1.body.id}`);
  ok("§4 an organization page has its properties, its timeline and its contacts and deals", page.body.record.name && page.body.timeline.some(a => a.id === note.body.id)
    && page.body.linked.contact.length === 2 && page.body.linked.deal.some(d => d.id === d1.body.id));
  const dp = await S(sup, "GET", `/rec/deal/${d1.body.id}`);
  ok("§4 a deal page has its organization and contacts", dp.body.linked.org.length === 1 && dp.body.linked.contact.length === 2);
  ok("§4 the record page uses the editor's rails (RailSection)", /RailSection/.test(src("client/src/pages/ops/sales/RecordPage.jsx")));

  // ── §6 · LISTS ─────────────────────────────────────────────────────────────
  const inDemo = await S(sup, "GET", `/list/org?view=${view({ filters: [{ field: "open_deal_stage", op: "in", value: [ST["Demo done"]] }] })}`);
  ok("§6 Organizations with an open deal in Demo done", inDemo.body.rows.map(r => r.id).join() === org1.body.id, inDemo.body.rows.map(r => r.name));
  const c3 = await S(sup, "POST", "/rec/contact", { first_name: "Quiet", last_name: "Person", emails: "quiet@bellweather.example.org" });
  const noAct = await S(sup, "GET", `/list/contact?view=${view({ filters: [{ field: "last_activity", op: "none_since", value: dayOffset(-30) }] })}`);
  ok("§6 Contacts with no activity since 30 days ago", noAct.body.rows.some(r => r.id === c3.body.id) && !noAct.body.rows.some(r => r.id === c1.body.id));
  const sorted = await S(sup, "GET", `/list/deal?view=${view({ sort: { key: "value_cents", dir: "desc" } })}`);
  ok("§6 a list sorts by any column", sorted.body.rows[0].id === d1.body.id && sorted.body.rows.every((r, i, a) => i === 0 || (a[i - 1].value_cents || 0) >= (r.value_cents || 0) || !r.value_cents));
  const sv = await S(sup, "POST", "/views", { object: "org", name: "In Demo done", config: { filters: [{ field: "open_deal_stage", op: "in", value: [ST["Demo done"]] }], columns: ["name", "props.tier"] } });
  ok("§6 a filter is saved as a named view", sv.status === 201 && (await S(sup, "GET", "/meta")).body.views.some(v => v.name === "In Demo done"));
  const s1 = await S(sup, "GET", "/search?q=harrow");
  ok("§6 one search finds organizations, contacts (by email) and deals", ["org", "contact", "deal"].every(t => s1.body.results.some(r => r.type === t)), s1.body.results.map(r => r.type));
  const bOwner = await S(sup, "POST", "/bulk/org", { ids: [org1.body.id, org2.body.id], action: "owner", value: "u_sales1_super" });
  const bSet = await S(sup, "POST", "/bulk/org", { ids: [org1.body.id, org2.body.id], action: "set", field: "current_crm", value: "DonorPerfect" });
  const bStage = await S(sup, "POST", "/bulk/deal", { ids: [dBare.body.id, dStuck.body.id], action: "stage", value: ST["Donors loaded"] });
  const crm = await q(`SELECT current_crm FROM sales_orgs WHERE id = ANY($1)`, [[org1.body.id, org2.body.id]]);
  const stg = await q(`SELECT stage_id FROM sales_deals WHERE id = ANY($1)`, [[dBare.body.id, dStuck.body.id]]);
  ok("§6 bulk: owner, a property and the stage", bOwner.body.done === 2 && bSet.body.done === 2 && bStage.body.done === 2 && crm.every(r => r.current_crm === "DonorPerfect") && stg.every(r => r.stage_id === ST["Donors loaded"]));
  const bDel = await S(sup, "POST", "/bulk/contact", { ids: [c3.body.id], action: "delete" });
  ok("§6 bulk delete", bDel.body.done === 1 && (await S(sup, "GET", `/rec/contact/${c3.body.id}`)).status === 404);
  // The pure filter at its edges.
  const rows = [{ id: "a", displayName: "A", last_activity: null }, { id: "b", displayName: "B", last_activity: "2026-10-01T10:00:00.000Z" }, { id: "c", displayName: "C", last_activity: "2026-11-01T10:00:00.000Z" }];
  ok("§6 'no activity since' keeps none-at-all and older, drops the day itself and later",
    LISTS.applyView(rows, { filters: [{ field: "last_activity", op: "none_since", value: "2026-11-01" }] }).map(r => r.id).join() === "a,b");

  // ── §7 · PIPELINES: EDIT, A SECOND PIPELINE, THE BOARD'S MOVE AND ITS HISTORY ─
  const moved = await S(sup, "POST", `/deals/${d1.body.id}/stage`, { stage_id: ST["Verbal yes"] });
  const hist = (await S(sup, "GET", `/rec/deal/${d1.body.id}`)).body.history;
  ok("§7 a stage move is kept: who, when, from and to", moved.status === 200 && hist[0].from_name === "Demo done" && hist[0].to_name === "Verbal yes" && hist[0].created_by_name === "Sales Super" && hist[0].at);
  const toLost = await S(sup, "POST", `/deals/${dBare.body.id}/stage`, { stage_id: ST.Lost });
  ok("§7 a drag to Lost without a reason is refused", toLost.status === 400 && toLost.body.need === "lost_reason");
  const meta1 = (await S(sup, "GET", "/meta")).body.pipelines[0];
  const edited = meta1.stages.map(s => ({ ...s })).reverse();
  edited.forEach(s => { if (s.name === "Lead") { s.name = "New lead"; s.probability = 7; } });
  edited.push({ name: "Board review", probability: 60, kind: "open", limit_days: 10 });
  const saveSt = await S(sup, "PUT", `/pipelines/${meta1.id}/stages`, { stages: edited });
  const after = (await S(sup, "GET", "/meta")).body.pipelines[0].stages;
  ok("§7 stages rename, reorder, add, and take a probability and a days limit", saveSt.status === 200 && after[0].name === "Lost" && after.some(s => s.name === "New lead" && s.probability === 7) && after.at(-1).name === "Board review" && after.at(-1).limit_days === 10);
  const dropUsed = await S(sup, "PUT", `/pipelines/${meta1.id}/stages`, { stages: after.filter(s => s.name !== "Verbal yes") });
  ok("§7 a stage that holds a deal can't be removed", dropUsed.status === 400);
  const pp = await S(sup, "POST", "/pipelines", { name: "Partner" });
  const pl = (await S(sup, "GET", "/meta")).body.pipelines;
  ok("§7 a second pipeline, with its own stages", pp.status === 201 && pl.length === 2 && pl[1].name === "Partner" && pl[1].stages.length === 10 && pl[1].stages[0].id !== pl[0].stages[0].id);

  // ── §9 · DUPLICATES AND MERGE ──────────────────────────────────────────────
  const dupOrg = await S(sup, "POST", "/rec/org", { name: "Harrow Creek (again)", website: "harrowcreek.example.org" });
  const dupC = await S(sup, "POST", "/rec/contact", { first_name: "Roz", emails: "ROSALIND@harrowcreek.example.org" });
  ok("§9 creating an organization with a known domain, or a contact with a known email, warns", dupOrg.status === 409 && dupOrg.body.duplicates[0].id === org1.body.id && dupC.status === 409);
  const forced = await S(sup, "POST", "/rec/contact", { first_name: "Roz", last_name: "Okafor", emails: "roz@elsewhere.example.org", title: "ED (home email)", force: true });
  await S(sup, "POST", "/link", { from: { type: "contact", id: forced.body.id }, to: { type: "org", id: org2.body.id } });
  const callRoz = await S(sup, "POST", "/activities", { kind: "call", body: "Called her at home", records: [{ type: "contact", id: forced.body.id }] });
  const mg = await S(sup, "POST", "/merge/contact", { keep: c1.body.id, merge: forced.body.id });
  const kept = await S(sup, "GET", `/rec/contact/${c1.body.id}`);
  ok("§9 a merge moves associations and activities to the kept contact", mg.status === 200 && kept.body.linked.org.some(o => o.id === org2.body.id) && kept.body.timeline.some(a => a.id === callRoz.body.id));
  ok("§9 the kept contact keeps both emails and its own title", kept.body.record.emails.includes("roz@elsewhere.example.org") && kept.body.record.title === "Executive Director");
  const mrec = await q(`SELECT gone_id, created_by FROM sales_merges WHERE kept_id = $1`, [c1.body.id]);
  ok("§9 the merge is recorded and the merged contact is gone from lists", mrec.length === 1 && mrec[0].gone_id === forced.body.id && mrec[0].created_by === "u_sales1_super"
    && (await S(sup, "GET", `/rec/contact/${forced.body.id}`)).status === 404);

  // ── §10 · IMPORT AND EXPORT ────────────────────────────────────────────────
  const read = f => fs.readFileSync(path.join(FX, f), "utf8");
  const pv = await S(sup, "POST", "/import/preview", { object: "org", csv: read("hubspot-companies.csv") });
  ok("§10 HubSpot's company columns map themselves", pv.body.mapping["Company name"] === "name" && pv.body.mapping["Company Domain Name"] === "domain" && pv.body.mapping["State/Region"] === "state" && pv.body.rows === 4);
  ok("§10 the preview shows the rows as they'd be written (a quoted comma survives)", pv.body.sample[2].body.name === "Saltmarsh Food Share, Inc." && pv.body.sample[0].body.revenue_band === "$250K–$1M");
  const iOrgs = await S(sup, "POST", "/import/commit", { object: "org", csv: read("hubspot-companies.csv"), fileName: "hubspot-companies.csv" });
  const iCont = await S(sup, "POST", "/import/commit", { object: "contact", csv: read("hubspot-contacts.csv") });
  const iDeal = await S(sup, "POST", "/import/commit", { object: "deal", csv: read("hubspot-deals.csv") });
  ok("§10 companies, contacts and deals import", iOrgs.body.counts.created === 4 && iCont.body.counts.created === 4 && iDeal.body.counts.created === 3, [iOrgs.body, iCont.body, iDeal.body]);
  const jr = (await q(`SELECT id FROM sales_orgs WHERE domain = 'juniperridge.example.org' AND deleted_at IS NULL`))[0];
  const jrPage = await S(sup, "GET", `/rec/org/${jr.id}`);
  ok("§10 contacts link to their organization by domain or name; deals to their org and contacts", jrPage.body.linked.contact.length === 2 && jrPage.body.linked.deal.length === 1);
  const jrDeal = await S(sup, "GET", `/rec/deal/${jrPage.body.linked.deal[0].id}`);
  ok("§10 a deal's HubSpot stage and amount read onto ours", jrDeal.body.record.stage_id === ST.Contacted && jrDeal.body.record.value_cents === 35000 && jrDeal.body.linked.contact.length === 2);
  const lostImp = (await q(`SELECT lost_reason, lost_at FROM sales_deals WHERE name = 'Saltmarsh - pilot'`))[0];
  ok("§10 a Closed Lost deal with no reason says so", lostImp.lost_reason === "Not given in the import" && lostImp.lost_at);
  const again = await S(sup, "POST", "/import/preview", { object: "org", csv: read("hubspot-companies.csv") });
  ok("§10 importing the same file again warns of 4 duplicates", again.body.duplicates === 4);
  const skip = await S(sup, "POST", "/import/commit", { object: "org", csv: read("hubspot-companies.csv"), mode: "skip" });
  const changed = read("hubspot-companies.csv").replace("Asheville,NC", "Hendersonville,NC");
  const upd = await S(sup, "POST", "/import/commit", { object: "org", csv: changed, mode: "update" });
  const cityNow = (await q(`SELECT city FROM sales_orgs WHERE id = $1`, [jr.id]))[0].city;
  ok("§10 duplicate handling: skip leaves them, update changes them", skip.body.counts.skipped === 4 && skip.body.counts.created === 0 && upd.body.counts.updated === 4 && cityNow === "Hendersonville");
  const undoUpd = await S(sup, "POST", `/import/${upd.body.importId}/undo`, {});
  const undoCont = await S(sup, "POST", `/import/${iCont.body.importId}/undo`, {});
  const cityBack = (await q(`SELECT city FROM sales_orgs WHERE id = $1`, [jr.id]))[0].city;
  const contLeft = (await q(`SELECT COUNT(*)::int AS n FROM sales_contacts WHERE import_id = $1 AND deleted_at IS NULL`, [iCont.body.importId]))[0].n;
  ok("§10 undo of a batch: updated rows get their old values, created rows go, their links go", undoUpd.status === 200 && cityBack === "Asheville" && undoCont.body.removed === 4 && contLeft === 0
    && (await S(sup, "GET", `/rec/org/${jr.id}`)).body.linked.contact.length === 0);
  const twice = await S(sup, "POST", `/import/${iCont.body.importId}/undo`, {});
  ok("§10 a batch is undone once", twice.status === 400);
  const ex = await api("GET", `/ops/sales/export/deal?view=${view({ filters: [{ field: "stage_kind", op: "eq", value: "open" }], sort: { key: "name", dir: "asc" } })}`, sup);
  ok("§10 any list view exports to CSV, with its filter", /^Name,Stage,Value \(MRR\)/.test(ex.body) && /Copperline - Steward Team,Meeting booked,600\.00/.test(ex.body) && !/Saltmarsh - pilot/.test(ex.body), String(ex.body).slice(0, 300));

  // ── §11 · THE LINK TO A STEWARD ACCOUNT ────────────────────────────────────
  const op = await S(sup, "GET", `/rec/org/${org1.body.id}`);
  const st = op.body.steward;
  ok("§11 the linked org's facts box: last sign-in, people imported (a count), trial end, MRR once paying",
    st && st.stewardOrgId === CUST && st.peopleImported === 2 && st.trialEndsOn === dayOffset(10) && st.mrrNowCents === null && st.lastSignInAt === tenAgo, st);
  const wire = JSON.stringify(op.body) + JSON.stringify((await S(sup, "GET", `/rec/deal/${d1.body.id}`)).body);
  ok("§11 no donor data: the planted donor's name, email and amount are nowhere", !wire.includes(PLANTED_DONOR) && !/zeb@planted\.example\.org/.test(wire) && !wire.includes(String(PLANTED_AMOUNT)));
  const dv = await S(sup, "GET", `/rec/deal/${d1.body.id}`);
  ok("§11 at Verbal yes the deal shows ONBOARD-2's five gates, read-only", dv.body.onboarding && ["paper", "data", "connections", "kickoff", "first_month"].every(g => dv.body.onboarding.gates[g]), dv.body.onboarding);
  const dEarly = (await S(sup, "GET", `/rec/deal/${jrDeal.body.record.id}`)).body;
  ok("§11 before Verbal yes no gates show", !dEarly.onboarding);
  const onbRows = await q(`SELECT COUNT(*)::int AS n FROM org_onboarding WHERE org_id = $1`, [CUST]);
  ok("§11 reading the gates wrote no onboarding row", onbRows[0].n === 0);

  // ── §13 · THE FORECAST ─────────────────────────────────────────────────────
  // By hand: two open deals in a Partner-free book, a won and a lost and a Later in the window.
  const fdeals = [
    { id: "f1", stage_kind: "open", value_cents: 50000, probability: 80, close_date: "2027-01-15", created_at: "2026-09-01T12:00:00Z", source: "Referral" },
    { id: "f2", stage_kind: "open", value_cents: 20000, probability: 35, close_date: null, created_at: "2026-09-01T12:00:00Z", source: "Conference" },
    { id: "f3", stage_kind: "won", value_cents: 30000, probability: 100, created_at: "2026-09-01T12:00:00Z", won_at: "2026-10-31T12:00:00Z", source: "Referral" },
    { id: "f4", stage_kind: "lost", value_cents: 10000, probability: 0, created_at: "2026-09-01T12:00:00Z", lost_at: "2026-10-15T12:00:00Z", source: "Referral" },
    { id: "f5", stage_kind: "later", value_cents: 90000, probability: 0, created_at: "2026-09-01T12:00:00Z", source: "Referral" },
  ];
  const stages = new Map([["s1", { id: "s1", name: "Demo done", kind: "open", position: 3 }]]);
  const history = [{ deal_id: "f3", to_stage_id: "s1", at: "2026-10-21T12:00:00Z" }, { deal_id: "f4", to_stage_id: "s1", at: "2026-10-01T12:00:00Z" }];
  const fNow = Date.parse("2026-11-04T19:00:00Z");
  const fc = FORECAST.forecast({ deals: fdeals, history, stages, mrrNowCents: 30000, goal: { cents: 1000000, by: "2027-06-30", says: "x" } }, fNow);
  ok("§13 weighted pipeline = $500×80% + $200×35% = $470; Later counts nothing", fc.weightedCents === 47000);
  ok("§13 month by month to Jun 2027; January carries $400 and the projection climbs to $700", fc.months.length === 8 && fc.months[0].label === "Nov 2026" && fc.months.at(-1).label === "Jun 2027"
    && fc.months[2].weightedClosingCents === 40000 && fc.months.at(-1).projectedCents === 70000 && fc.undatedWeightedCents === 7000);
  const ref = fc.bySource.find(r => r.key === "Referral");
  ok("§13 win rate by source over 90 days: Referral 1 won, 1 lost = 50%, 60 days to close; Later isn't a loss", ref.winRate === 50 && ref.won === 1 && ref.lost === 1 && ref.avgDaysToClose === 60);
  ok("§13 by stage: Demo done 50%, 10 days from entering it to the win", fc.byStage[0].key === "Demo done" && fc.byStage[0].winRate === 50 && fc.byStage[0].avgDaysToClose === 10);
  const goal = await S(sup, "PUT", "/settings", { goal: { cents: 1500000, by: "2027-09-30" } });
  const fh = (await S(sup, "GET", "/home")).body.forecast;
  ok("§13 the goal is Jonathan's to set, and the card reads it", goal.status === 200 && fh.goal.says === "$15,000 MRR by Sep 30 2027" && fh.months.at(-1).label === "Sep 2027" && typeof fh.sentences.weighted === "string");

  await wipeSales();
  for (const o of [HOME, CUST]) await wipeOrg(o);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* */ } process.exit(1); });

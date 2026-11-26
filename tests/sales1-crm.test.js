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
const { testNow, civilDay, dayOffset, nyNoon } = require("./clock");
const LISTS = require("../server/admin/sales/lists");
const FORECAST = require("../server/admin/sales/forecast");
const TODAY = require("../server/admin/sales/today");
const PRICE = require("../server/admin/sales/customerPrice");   // SALES-5

const PASS = "loadtest1234";
const HOME = "org_sales1home", CUST = "org_sales1cust", PRICED = "org_sales5price";
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
// SALES-6: "January 1, 2027" (the quote's words) or "Jan 1, 2027" (the order's).
const MONTHS6 = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayWords6 = (d, short) => { const [y, m, dd] = d.split("-").map(Number); return `${short ? MONTHS6[m - 1].slice(0, 3) : MONTHS6[m - 1]} ${dd}, ${y}`; };
// The words in a pdfkit PDF (hex strings inside TJ arrays), as order1.test.js reads them.
function pdfText6(buf) {
  const raw = buf.toString("latin1").replace(/stream\r?\n([\s\S]*?)\r?\nendstream/g, (m, body) => {
    try { return "stream\n" + require("zlib").inflateSync(Buffer.from(body, "latin1")).toString("latin1") + "\nendstream"; } catch { return m; }
  });
  const lines = [];
  for (const t of raw.match(/BT[\s\S]*?ET/g) || []) {
    lines.push((t.match(/\[([^\]]*)\]\s*TJ/g) || []).map(arr => (arr.match(/<([0-9a-fA-F]*)>/g) || []).map(h => Buffer.from(h.slice(1, -1), "hex").toString("latin1")).join("")).join(""));
  }
  return lines.join("\n").replace(/\u0092/g, "'");
}

(async () => {
  await wipeSales();
  for (const o of [HOME, CUST, PRICED]) await wipeOrg(o);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Sales1 Home','sales1-home',1,'active','team')`, [HOME]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,trial_ends_at) VALUES ($1,'Juniper Ridge (Steward)','sales1-cust',1,'trialing','team',$2)`,
    // FLAKE-5 (W-DAY-ops-trial): the trial ends at 9 PM New York on the run's day + 10, which is the
    // NEXT UTC day. The facts box must say the org's day (dayOffset(10), §11), whatever the hour the
    // suite runs; read as a UTC day it says a day late. (CONNECT-1 had pinned it to noon, which hid that.)
    [CUST, new Date(nyNoon(dayOffset(10)) + 9 * 3600 * 1000).toISOString()]);
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

  // ── §15 · SALES-5: ONE PRICE PER CUSTOMER, AND THE FORECAST COUNTS WON-NOT-BILLING ──
  // (a) The rule: Stripe if billing, then the signed order or quote (the newer), then the agreed price, then the deal's value.
  const base = { dealValueCents: 50000, closeDate: "2027-02-01" };
  const pStripe = PRICE.pick({ ...base, stripeCents: 31000, order: { priceCents: 29900, startOn: "2027-01-01", at: 2 }, agreedCents: 28000 });
  const pOrder = PRICE.pick({ ...base, order: { priceCents: 29900, startOn: "2027-01-01", at: 2 }, quote: { priceCents: 25000, startOn: "2026-12-15", at: 1 }, agreedCents: 28000 });
  const pQuote = PRICE.pick({ ...base, order: { priceCents: 29900, startOn: "2027-01-01", at: 1 }, quote: { priceCents: 25000, startOn: "2026-12-15", at: 2 }, agreedCents: 28000 });
  const pAgreed = PRICE.pick({ ...base, agreedCents: 28000, firstChargeOn: "2027-01-10" });
  const pDeal = PRICE.pick({ ...base });
  ok("§15 the four-price rule picks Stripe, then the order (or the newer quote), then agreed, then the deal's value",
    pStripe.source === "stripe" && pStripe.cents === 31000 && pStripe.billing && pStripe.startsOn === null
    && pOrder.source === "order" && pOrder.cents === 29900 && pOrder.startsOn === "2027-01-01" && pOrder.says === "$299/mo, from the signed order; Stripe starts billing Jan 1, 2027"
    && pQuote.source === "quote" && pQuote.cents === 25000 && pAgreed.source === "agreed" && pAgreed.startsOn === "2027-01-10"
    && pDeal.source === "deal" && pDeal.cents === 50000 && pDeal.startsOn === "2027-02-01" && pOrder.arrCents === 358800 && PRICE.arrOf(29900) === 358800,
    { pStripe: pStripe.source, pOrder: pOrder.says, pQuote: pQuote.source, pAgreed: pAgreed.source, pDeal: pDeal.source });
  ok("§15 the record page's MRR row says not billing yet, with the agreed price and the first charge",
    PRICE.mrrRow(pOrder) === "Not billing yet · $299/mo agreed, first charge Jan 1, 2027" && PRICE.mrrRow(pStripe) === "$310/mo");

  // (b) Jonathan's January, 25 Nov: CKRH won at $299 from Jan 1, and three open deals closing in January at 90%, 80% and 35%.
  const ckNow = Date.parse("2026-11-26T01:10:00Z");   // 25 Nov, 8:10 PM New York
  const ck = (billing, mrr) => FORECAST.forecast({ deals: [
    { id: "ckrh", stage_kind: "won", value_cents: 29900, price_cents: 29900, price_billing: billing, price_signed: !billing, billing_starts_on: "2027-01-01", close_date: "2027-01-01", probability: 100 },
    { id: "o90", stage_kind: "open", value_cents: 29900, probability: 90, close_date: "2027-01-12" },
    { id: "o80", stage_kind: "open", value_cents: 29900, probability: 80, close_date: "2027-01-20" },
    { id: "o35", stage_kind: "open", value_cents: 29900, probability: 35, close_date: "2027-01-28" },
  ], history: [], stages: new Map(), mrrNowCents: mrr, goal: { cents: 1000000, by: "2027-06-30", says: "x" } }, ckNow);
  const ckBefore = ck(false, 120000), jan = ckBefore.months.find(m => m.month === "2027-01");
  ok("§15 January reads MRR now + $299 won + $612.95 weighted", jan.wonStartingCents === 29900 && jan.weightedClosingCents === 61295
    && jan.projectedCents === 120000 + 29900 + 61295 && ckBefore.wonStartingCents === 29900 && ckBefore.months.find(m => m.month === "2026-12").wonStartingCents === 0,
    { jan, won: ckBefore.wonStartingCents });
  const ckAfter = ck(true, 120000 + 29900), jan2 = ckAfter.months.find(m => m.month === "2027-01");
  ok("§15 once Stripe bills it, it is in MRR now and not counted twice (the hand-off month)", ckAfter.wonStartingCents === 0 && jan2.wonStartingCents === 0
    && jan2.projectedCents === jan.projectedCents && ckAfter.billingDeals === 1 && ckAfter.mrrNowArrCents === (120000 + 29900) * 12, { jan2 });

  // (c) The screens: a won deal with a signed order reads the order's price on the board and the header, from one read;
  // a value edit asks first, and a deal with no order shows its saved value at once on both.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,trial_ends_at,timezone) VALUES ($1,'Kestrel Ridge (Steward)','sales5-price',1,'trialing','team',$2,'America/New_York')`,
    [PRICED, new Date(nyNoon(dayOffset(40))).toISOString()]);
  const pOrg = await S(sup, "POST", "/rec/org", { name: "Kestrel Ridge Hall" });
  await S(sup, "POST", `/orgs/${pOrg.body.id}/steward`, { stewardOrgId: PRICED });
  const pDealR = await S(sup, "POST", "/rec/deal", { name: "Kestrel Ridge – Paying", stage_id: ST.Paying, value_cents: 50000, close_date: dayOffset(40), links: [{ type: "org", id: pOrg.body.id, primary: true }] });
  await q(`INSERT INTO start_links (id, org_id, token_hash, contact_name, contact_email, price_cents, price_basis, charge_mode, status, expires_at, signed_at, first_charge_at, deal_id, order_json, created_by, created_by_name)
           VALUES ('sl_sales5', $1, 'h_sales5', 'Made Up', 'made.up@example.org', 29900, 'custom', 'fixed', 'signed', NOW() + interval '30 days', NOW(), $2, $3, '{"interval":"month"}'::jsonb, 'u_sales1_super', 'Sales Super')`,
    [PRICED, new Date(nyNoon(dayOffset(40))).toISOString(), pDealR.body.id]);
  const rowOf = async id => (await S(sup, "GET", `/list/deal?view=${view({})}`)).body.rows.find(r => r.id === id);
  const headOf = async id => (await S(sup, "GET", `/deals/${id}/header`)).body.header;
  const pr = await rowOf(pDealR.body.id), ph = await headOf(pDealR.body.id);
  ok("§15 the board's card and the deal header read one price: the signed order's $299, not the deal's $500",
    pr.price_cents === 29900 && pr.price_source === "order" && ph.valueCents === 29900 && ph.arrCents === 358800 && ph.dealValueCents === 50000 && /from the signed order/.test(ph.priceSays), { pr: pr && pr.price_cents, ph });
  const warn = await S(sup, "PATCH", `/rec/deal/${pDealR.body.id}`, { value_cents: 40000 });
  const keptVal = (await q(`SELECT value_cents FROM sales_deals WHERE id = $1`, [pDealR.body.id]))[0];
  ok("§15 editing the value on a deal with a signed order asks first, and saves nothing until told", warn.status === 409 && warn.body.error === "price_differs"
    && /This changes the pipeline value only\. The signed order says \$299\/mo/.test(warn.body.says) && Number(keptVal.value_cents) === 50000, warn.body);
  const only = await S(sup, "PATCH", `/rec/deal/${pDealR.body.id}`, { value_cents: 40000, valueOnly: true });
  ok("§15 \"Change the pipeline value only\" saves the value; every screen still shows the order's price", only.status === 200
    && (await rowOf(pDealR.body.id)).price_cents === 29900 && (await headOf(pDealR.body.id)).valueCents === 29900);
  const fMonth = dayOffset(40).slice(0, 7);
  const wonBefore = (await S(sup, "GET", "/home")).body.forecast.months.find(m => m.month === fMonth);
  await q(`UPDATE orgs SET subscription_status = 'active', stripe_subscription_id = 'sub_sales5_madeup', billing_mrr_cents = 31000 WHERE id = $1`, [PRICED]);
  const billed = await rowOf(pDealR.body.id);
  const wonAfter = (await S(sup, "GET", "/home")).body.forecast.months.find(m => m.month === fMonth);
  ok("§15 the forecast counts the won deal from its first charge month, and drops it there once Stripe bills it", wonBefore && wonBefore.wonStartingCents >= 29900
    && billed.price_billing === true && billed.price_cents === 31000 && wonAfter.wonStartingCents === wonBefore.wonStartingCents - 29900, { wonBefore, wonAfter, billed: billed.price_cents });
  const plain = await S(sup, "POST", "/rec/deal", { name: "Kestrel Ridge – Add-on", stage_id: ST["Demo done"], value_cents: 10000 });
  const saved = await S(sup, "PATCH", `/rec/deal/${plain.body.id}`, { value_cents: 12300 });
  const [plainRow, plainHead, board] = await Promise.all([rowOf(plain.body.id), headOf(plain.body.id), S(sup, "GET", `/list/deal?view=${view({})}`)]);
  const colTotal = board.body.rows.filter(r => r.stage_id === ST["Demo done"]).reduce((n, r) => n + r.price_cents, 0);
  ok("§15 a deal with no order: the saved value is the board card, the column total and the header, from one read", saved.status === 200
    && plainRow.price_cents === 12300 && plainRow.price_source === "deal" && plainHead.valueCents === 12300 && colTotal >= 12300, { plainRow: plainRow.price_cents, head: plainHead.valueCents });
  const qq = (sql, p) => { let i = 0; return q(sql.replace(/\?/g, () => `$${++i}`), p); };   // the server's ? placeholders
  const disagree = await require("../scripts/ops/sales5-price-check").find(qq);
  ok("§15 the price check lists the won deal whose prices disagree, by id (dry run, no names)", disagree.some(x => x.id === pDealR.body.id && x.p.cents === 31000 && x.p.prices.deal === 40000),
    disagree.map(x => ({ id: x.id, cents: x.p.cents, deal: x.p.prices.deal })));

  // ── §16 · SALES-6: ONE LINK TO SEND, THE PAPER BLOCK, THE PRICE TILE, TOUCHES ─────────────
  // Shaped like the deal Jonathan walked on 25 Nov: a $299 deal, its quote v1 at $149 (list $299)
  // starting on a fixed day, the quote link made and not signed, no mailbox connected.
  // HOW IT GOES RED (on main before SALES-6): the quote page has no orderReady and /public/quote/:t/order
  // is a 404; the agreement on the page ends in the blank "For Steward Software LLC: ____"; the header
  // has no priceTile and no use-quote-price route; Last touch says nothing about the mailbox.
  const billingMock = await new Promise(resolve => {
    const http = require("http");
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => { b += c; });
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        const u = req.url.split("?")[0];
        if (req.method === "POST" && u === "/v1/checkout/sessions") return res.end(JSON.stringify({ id: "cs_test_sales6", object: "checkout.session", url: "https://checkout.stripe.test/sales6" }));
        if (req.method === "GET" && /^\/v1\/prices\//.test(u)) return res.end(JSON.stringify({ id: u.split("/")[3], object: "price", product: "prod_test_steward", unit_amount: 29900, currency: "usd", recurring: { interval: "month" } }));
        if (req.method === "POST" && u === "/v1/customers") return res.end(JSON.stringify({ id: "cus_sales6", object: "customer" }));
        res.statusCode = 404; res.end(JSON.stringify({ error: { message: "mock: " + req.url } }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(require("./helpers").BILLING_MOCK_PORT, () => resolve(srv));
  });
  const SIX_A = "org_sales6_alder", SIX_B = "org_sales6_birch";
  for (const [id, name] of [[SIX_A, "Wrenfield Commons (Steward)"], [SIX_B, "Oakhollow Pantry (Steward)"]]) {
    await wipeOrg(id);
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'trialing','team','America/New_York')`, [id, name, id.replace(/_/g, "-")]);
  }
  const start6 = dayOffset(40);
  const sixDeal = async (orgName, stewardId, first, email) => {
    const o = await S(sup, "POST", "/rec/org", { name: orgName });
    await S(sup, "POST", `/orgs/${o.body.id}/steward`, { stewardOrgId: stewardId });
    const c = await S(sup, "POST", "/rec/contact", { first_name: first, last_name: "Testperson", title: "Executive Director", emails: email });
    const d = await S(sup, "POST", "/rec/deal", { name: `${orgName} – Core`, stage_id: ST["Demo done"], value_cents: 29900,
      links: [{ type: "org", id: o.body.id, primary: true }, { type: "contact", id: c.body.id }] });
    const qv = await S(sup, "POST", `/deals/${d.body.id}/quotes`, { plan: "bundle", price: "149", reason: "beta", start_on: start6, setup_fee: "250" });
    return { dealId: d.body.id, quoteId: qv.body.id };
  };
  const A6 = await sixDeal("Wrenfield Commons", SIX_A, "Ottilie", "ottilie@wrenfield.example.org");
  const tok6 = (await S(sup, "POST", `/quotes/${A6.quoteId}/link`, {})).body.token;   // the old quote link, made before SALES-6
  const pub6 = (m, p, b) => api(m, p, null, b);

  // (3) The Price tile names the open quote that differs, and the button puts its price on the deal everywhere.
  const head6 = (await S(sup, "GET", `/deals/${A6.dealId}/header`)).body.header;
  const sentOn = new Date(testNow()).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  ok("§16 the Price tile reads \"$299/mo deal value · $149/mo quote sent <day>, not signed\", and ARR follows the $299", head6 && head6.priceTile
    && head6.priceTile.main === "$299/mo deal value" && head6.priceTile.sub === `$149/mo quote sent ${sentOn}, not signed` && head6.arrCents === 358800 && head6.openQuote && head6.openQuote.cents === 14900,
    head6 && { tile: head6.priceTile, arr: head6.arrCents });
  const row6 = async () => (await S(sup, "GET", `/list/deal?view=${view({})}`)).body.rows.find(r => r.id === A6.dealId);
  ok("§16 the pipeline card's subline says the same", (await row6()).price_line === `$149/mo quote sent ${sentOn}, not signed`);
  const use6 = await S(sup, "POST", `/deals/${A6.dealId}/use-quote-price`, {});
  const [h6b, r6b, p6b, stamp6] = await Promise.all([S(sup, "GET", `/deals/${A6.dealId}/header`), row6(), PRICE.forDealIds((sql, p) => { let i = 0; return q(sql.replace(/\?/g, () => `$${++i}`), p); }, [A6.dealId]),
    q(`SELECT value_cents, updated_by FROM sales_deals WHERE id = $1`, [A6.dealId])]);
  ok("§16 \"Use $149 as the deal value\": one click, and the header, the board, the price function and ARR all read $149, stamped by her",
    use6.status === 200 && use6.body.undo && h6b.body.header.valueCents === 14900 && h6b.body.header.arrCents === 178800 && !h6b.body.header.openQuote && r6b.price_cents === 14900
    && p6b.get(A6.dealId).cents === 14900 && Number(stamp6[0].value_cents) === 14900 && stamp6[0].updated_by === "u_sales1_super" && use6.body.undo.value_cents === 29900,
    { use: use6.body, head: h6b.body.header && h6b.body.header.valueCents, row: r6b.price_cents });
  const undo6 = await S(sup, "PATCH", `/rec/deal/${A6.dealId}`, use6.body.undo || { value_cents: 29900, valueOnly: true });
  ok("§16 Undo puts $299 back, and the tile names the quote again", undo6.status === 200 && ((await S(sup, "GET", `/deals/${A6.dealId}/header`)).body.header.priceTile || {}).main === "$299/mo deal value");
  await S(sup, "POST", `/deals/${A6.dealId}/use-quote-price`, {});

  // (4) No mailbox: Last touch says why email can't count, and where to fix it.
  const NO_BOX = "Your mailbox isn't connected, so emails don't count as touches. Connect it in Sales settings.";
  const now6 = (await S(sup, "GET", "/now")).body;
  ok("§16 with no mailbox, Last touch and Now say email isn't counted, with the Sales settings link", !!head6.mailbox && head6.mailbox.connected === false && head6.sentences.lastTouch === NO_BOX
    && now6.mailbox && now6.mailbox.connected === false && now6.mailbox.says === NO_BOX && /panel=settings/.test(now6.mailbox.settings), { mb: head6.mailbox, now: now6.mailbox });

  // (2) The web agreement has no blank signature block.
  const page6 = await pub6("GET", `/public/quote/${tok6}`);
  ok("§16 the quote page's agreement leaves out the paper block (\"For Steward Software LLC: ____\")", page6.status === 200 && /this document\s+governs/.test(page6.body.agreement.text)
    && !/For Steward Software LLC|\*\*Organization\*\*|_{6,}/.test(page6.body.agreement.text), page6.body.agreement && page6.body.agreement.text.slice(-200));

  // (1) The unsigned quote link opens the order flow with the quote's terms.
  ok("§16 her unsigned quote link offers the order: read, sign, card, book", page6.body.orderReady === true
    && page6.body.orderSays === `She reads the order, signs, adds a card (nothing charged until ${dayWords6(start6, true)}), and books setup.`, { ready: page6.body.orderReady, says: page6.body.orderSays });
  const open6 = await pub6("POST", `/public/quote/${tok6}/order`, {});
  const ord6 = await pub6("GET", `/public/start/${tok6}`);
  const snap6 = ord6.body && ord6.body.order && ord6.body.order.snapshot;
  ok("§16 \"Open your order\" opens ORDER-1's order under the same link, with the quote's price, list price, start day and setup fee",
    open6.status === 200 && open6.body.path === `/start/${tok6}` && ord6.status === 200 && snap6 && snap6.figures.priceCents === 14900 && snap6.figures.setupCents === 25000
    && snap6.figures.firstChargeOn === dayWords6(start6, true) && /List price \$299 \/ month/.test(snap6.lines[0].detail) && snap6.lines[2].label === `Until ${dayWords6(start6, true)}`
    && snap6.signer.email === "ottilie@wrenfield.example.org", { open: open6.body, figures: snap6 && snap6.figures, plan: snap6 && snap6.lines[0] });
  ok("§16 the order carries the agreement without its blank block; a second press opens the same order",
    snap6 && snap6.agreement && /this document\s+governs/.test(snap6.agreement.text) && !/For Steward Software LLC|_{6,}/.test(snap6.agreement.text)
    && (await pub6("POST", `/public/quote/${tok6}/order`, {})).body.path === `/start/${tok6}` && (await q(`SELECT COUNT(*)::int AS n FROM start_links WHERE org_id = $1`, [SIX_A]))[0].n === 1);
  const sign6 = await pub6("POST", `/public/start/${tok6}/sign`, { name: "Ottilie Testperson", title: "Executive Director", agree: true, sha256: ord6.body.order && ord6.body.order.sha256 });
  const [qrow6] = await q(`SELECT status, signer_name FROM sales_quotes WHERE id = $1`, [A6.quoteId]);
  const [link6] = await q(`SELECT id, first_charge_at FROM start_links WHERE org_id = $1`, [SIX_A]).then(r => (r.length ? r : [{ id: "none", first_charge_at: 0 }]));
  ok("§16 she signs the order; the quote reads signed as an order, and billing waits for the quote's day", sign6.status === 200 && qrow6.status === "ordered"
    && qrow6.signer_name === "Ottilie Testperson" && !!link6.first_charge_at && civilDay(new Date(link6.first_charge_at).getTime()) === start6, { sign: sign6.status, body: sign6.body, q: qrow6 });
  const pdf6 = await fetch(`${require("./helpers").BASE}/admin/start-links/${link6.id}/pdf`, { headers: { Authorization: "Bearer " + sup } });
  const pdfWords = pdfText6(Buffer.from(await pdf6.arrayBuffer()));
  ok("§16 the signed PDF fills the block: organization, her name and title, the date and time, and Steward's line",
    pdf6.status === 200 && /Organization:\s*Wrenfield Commons \(Steward\)/.test(pdfWords) && /Name and title:\s*Ottilie Testperson, Executive Director/.test(pdfWords)
    && /Date:\s*\w{3} \d{1,2}, \d{4} at \d{1,2}:\d{2} [AP]M ET/.test(pdfWords) && /For Steward Software LLC:\s*Jonathan Atkinson, signed on issue/.test(pdfWords) && !/_{6,}/.test(pdfWords),
    pdfWords.slice(-600));
  const head6s = (await S(sup, "GET", `/deals/${A6.dealId}/header`)).body.header;
  ok("§16 once signed, the tile reads \"$149/mo, signed <day>\" and the button is gone", !!head6s.priceTile && head6s.priceTile.main === `$149/mo, signed ${sentOn}` && !head6s.openQuote && head6s.arrCents === 178800, head6s.priceTile);

  // (1) Send to sign on the deal: the order from the newest quote, its link shown once.
  const B6 = await sixDeal("Oakhollow Pantry", SIX_B, "Bram", "bram@oakhollow.example.org");
  const send6 = await S(sup, "POST", `/deals/${B6.dealId}/send-to-sign`, {});
  const sent6 = send6.body.token ? await pub6("GET", `/public/start/${send6.body.token}`) : { body: {} };
  ok("§16 Send to sign makes the order from the quote's terms and hands back its link", send6.status === 201 && send6.body.path === `/start/${send6.body.token}`
    && sent6.body.order && sent6.body.order.snapshot.figures.priceCents === 14900 && sent6.body.order.snapshot.figures.firstChargeOn === dayWords6(start6, true)
    && (await q(`SELECT status FROM sales_quotes WHERE id = $1`, [B6.quoteId]))[0].status === "sent", send6.body);
  if (billingMock) billingMock.close();
  for (const o of [SIX_A, SIX_B]) await wipeOrg(o);

  await wipeSales();
  for (const o of [HOME, CUST, PRICED]) await wipeOrg(o);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* */ } process.exit(1); });

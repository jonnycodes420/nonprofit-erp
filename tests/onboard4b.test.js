// tests/onboard4b.test.js · ONBOARD-4 Part B. THE GUIDED SETUP, "SEND IT TO US" AND STUCK.
//
// §1 A file sent with "Send it to us" loads NOTHING until a person on /ops
//    presses Load; Load is the normal spreadsheet import (in her Imports, with
//    its Undo), and her step reads Received → Being mapped → Ready for you to check.
// §2 The guided setup: five steps in order, a skipped step comes back, the
//    current step resumes from what is stored, a booking's file waits for her.
// §3 Each Stuck rule picks its own fixture and no other fixture.
// §4 ONBOARD-5, the ten-step setup page: progress saves and resumes on the same
//    step; Skip leaves a connection unconnected and Home says so; ten steps and
//    no Mailchimp anywhere; a campaign merged on the Funds page shows its gifts on
//    the one kept; the major-gift amount moves the Major count on the Donors
//    list; nothing sends until Send invites is pressed.
//
// THE PLANTED DEFECTS (ONBOARD4B_PLANT on the SERVER, one at a time; each red):
//   autoload   the job loads the moment it arrives               → §1
//   nowindow   every Stuck window is zero                        → §3
//   noclose    a booking stays stuck after its close link        → §3
//
// Fake fixtures only, made-up names. Nothing sends.
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { testNow } = require("./clock");
const STUCK = require("../server/onboard/stuck");

const PASS = "loadtest1234";
const DAY = 86400000, HOUR = 3600000;
const at = ms => new Date(ms).toISOString();
const NOW = testNow();
const SUPER = "onb4b-super@example.org";
const O = { sup: "org_onb4b_sup", send: "org_onb4b_send", plain: "org_onb4b_plain", np: "org_onb4b_np", npEarly: "org_onb4b_np2",
  nc: "org_onb4b_nc", ncEarly: "org_onb4b_nc2", call: "org_onb4b_call", callDone: "org_onb4b_call2", callEarly: "org_onb4b_call3",
  conc: "org_onb4b_conc", concEarly: "org_onb4b_conc2", cl: "org_onb4b_cl", five: "org_onb5_setup" };
const ADMIN = "onb4b-send@example.org";
const CSV = "First Name,Last Name,Email,Gift Amount,Gift Date\nAlder,Quince,alder@onb4b.example.org,40,2025-03-02\nBirch,Marrow,birch@onb4b.example.org,65.5,2025-06-11\n";

async function wipe(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns
                            WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) return;
  }
}
async function mkOrg(id, name, extra = {}) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind,paper_done_at,data_in_at)
           VALUES ($1,$2,$3,1,'trialing','trial','customer',$4,$5)`, [id, name, id.replace(/_/g, "-"), extra.paper || null, extra.dataIn || null]);
}
async function mkUser(id, org, email, role, superAdmin = false, created = NOW - 30 * DAY) {
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, org, email, bcrypt.hashSync(PASS, 10), email.split("@")[0].replace("onb4b-", "Onb4b "), role, superAdmin, at(created)]);
}
const donor = (id, org, created) => q(`INSERT INTO donors (id,org_id,name,created_at,created_by,created_by_name) VALUES ($1,$2,$3,$4,'system:test','ONBOARD-4 fixture')`,
  [id, org, "Fixture " + id.slice(-4), at(created)]);
const closeLink = (id, org, email, completed) => q(`INSERT INTO close_links (id,org_name,contact_email,plan,status,org_id,completed_at,created_at,created_by,created_by_name)
  VALUES ($1,$2,$3,'r500_monthly',$4,$5,$6,$7,'system:test','ONBOARD-4 fixture')`, [id, "Fixture", email, completed ? "completed" : "open", org, completed ? at(completed) : null, at(completed || NOW - DAY)]);
const booking = (id, email, created, file) => q(`INSERT INTO sales_bookings (id,name,org_name,email,file_name,file_type,file_size,file_data,created_at,created_by,created_by_name)
  VALUES ($1,'Rowan Fixture','Fixture Booking Org',$2,$3,$4,$5,$6,$7,'system:test','ONBOARD-4 fixture')`,
  [id, email, file ? file.name : null, file ? "text/csv" : null, file ? file.bytes.length : null, file ? file.bytes : null, at(created)]);
const count = async (sql, p) => Number((await q(sql, p))[0].n);

// ── §4 · ONBOARD-5: the ten-step setup page ──
async function section4() {
  const fs = require("fs");
  const path = require("path");
  const ORG = O.five;
  await mkOrg(ORG, "Thornbury Riding Fellowship", { paper: at(NOW - 2 * DAY) });
  await mkUser("u_onb5_admin", ORG, "onb4b-five@example.org", "admin", false, NOW - 3 * DAY);
  const me = await login("onb4b-five@example.org");
  const guided = async (page = true) => (await api("GET", `/onboarding/guided${page ? "?page=1" : ""}`, me)).body;

  // progress saves and resumes on the same step
  const at1 = await api("POST", "/onboarding/guided/at", me, { step: "funds" });
  ok("§4 the page she is on is saved", at1.status === 200);
  ok("§4 and she resumes on that same step (a fresh read, as another device would)", (await guided()).current === "funds", (await guided()).current);
  ok("§4 a step that does not exist is refused", (await api("POST", "/onboarding/guided/at", me, { step: "mailchimp" })).status === 400);

  // Skip leaves the connection unconnected and shows it on Home
  const sk = await api("POST", "/onboarding/guided/skip", me, { step: "quickbooks", skip: true });
  const home = await guided(false);
  const qbStep = (home.steps || []).find(x => x.id === "quickbooks") || {};
  const qbRows = await count(`SELECT COUNT(*)::int AS n FROM bookkeeping_connections WHERE org_id = $1`, [ORG]);
  ok("§4 Skip on QuickBooks leaves it unconnected (no books link, not done)", sk.status === 200 && qbStep.done === false && qbStep.skipped === true && qbRows === 0, qbStep);
  ok("§4 and Home's card names it as not connected yet", home.show === true && (home.notConnected || []).some(c => c.id === "quickbooks"), home.notConnected);

  // the step count is 10 and Mailchimp appears nowhere
  const g = await guided();
  ok("§4 the setup is ten steps", (g.steps || []).length === 10 && g.total === 10, (g.steps || []).length);
  const clientDir = path.join(__dirname, "..", "client", "src", "pages", "setup");
  const src = fs.readdirSync(clientDir).map(f => fs.readFileSync(path.join(clientDir, f), "utf8")).join("\n")
    + fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", "onboarding", "GuidedSetup.jsx"), "utf8");
  ok("§4 Mailchimp appears nowhere: not in the steps, not on the page, not on Home's card", !/mailchimp/i.test(JSON.stringify(g)) && !/mailchimp/i.test(src));

  // a campaign merged on the Funds page shows its gifts on the one kept
  for (const [id, name] of [["d_onb5_a", "Ivy Bellwether"], ["d_onb5_b", "Oren Bellwether"], ["d_onb5_c", "Pell Ainsworth"]])
    await q(`INSERT INTO donors (id,org_id,name,created_at,created_by,created_by_name) VALUES ($1,$2,$3,$4,'system:test','ONBOARD-5 fixture')`, [id, ORG, name, at(NOW - 2 * DAY)]);
  await q(`INSERT INTO campaigns (id,org_id,name,type,subject,body,status,segment,goal_amount,created_at) VALUES ('cmp_onb5_keep',$1,'Annual Fund 2026','appeal','','','active','{}',5000,$2)`, [ORG, at(NOW - 2 * DAY)]);
  await q(`INSERT INTO campaigns (id,org_id,name,type,subject,body,status,segment,created_at) VALUES ('cmp_onb5_dup',$1,'Annual Fund 2026','appeal','','','draft','{}',$2)`, [ORG, at(NOW - DAY)]);
  const gift = (id, donorId, dollars, daysAgo, campaign) => q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign_id,created_by,created_by_name)
    VALUES ($1,$2,$3,$4,$5,'donation',$6,'system:test','ONBOARD-5 fixture')`, [id, ORG, donorId, dollars, at(NOW - daysAgo * DAY).slice(0, 10), campaign]);
  await gift("g_onb5_1", "d_onb5_a", 12000, 30, "cmp_onb5_keep");
  await gift("g_onb5_2", "d_onb5_b", 3000, 40, "cmp_onb5_keep");
  await gift("g_onb5_3", "d_onb5_c", 50, 50, "cmp_onb5_dup");
  const f1 = (await api("GET", "/onboarding/setup/funds", me)).body;
  const dup = (f1.campaigns || []).find(c => c.id === "cmp_onb5_dup") || {};
  ok("§4 the Funds page offers the second Annual Fund 2026 to merge into the first, each with its gift count",
    dup.duplicateOf === "cmp_onb5_keep" && dup.gifts === 1 && ((f1.campaigns || []).find(c => c.id === "cmp_onb5_keep") || {}).gifts === 2, f1.campaigns);
  const mg = await api("POST", "/campaign-tidy/merge", me, { keepId: dup.duplicateOf, mergeIds: [dup.id] });
  const f2 = (await api("GET", "/onboarding/setup/funds", me)).body;
  const kept = (f2.campaigns || []).find(c => c.id === "cmp_onb5_keep") || {};
  ok("§4 merged there, the kept campaign shows all three gifts and the second is gone", mg.status === 200 && kept.gifts === 3 && !(f2.campaigns || []).some(c => c.id === "cmp_onb5_dup"), f2.campaigns);

  // the major-gift amount chosen changes the Major count on the Donors list
  const majors = async () => { const b = (await api("GET", "/donors?level=major&limit=500", me)).body || {}; return (Array.isArray(b) ? b : b.donors || b.rows || []).map(d => d.id).sort().join(","); };
  const before = await majors();
  const v = await api("POST", "/onboarding/setup/voice", me, { majorCents: 250000, giverSingular: "partner", giverPlural: "partners", addresseePattern: "The {last}s" });
  const after = await majors();
  ok("§4 at the default $10,000 one person is Major; choosing $2,500 on How you talk makes it two on the Donors list",
    before === "d_onb5_a" && v.status === 200 && after === "d_onb5_a,d_onb5_b", { before, after, status: v.status, body: v.body && v.body.message });
  const [orgRow] = await q(`SELECT giving_level_mid_cents, giving_level_major_cents, vocabulary_json, addressee_pattern FROM orgs WHERE id = $1`, [ORG]);
  const vj = typeof orgRow.vocabulary_json === "string" ? JSON.parse(orgRow.vocabulary_json) : orgRow.vocabulary_json;
  ok("§4 the same press keeps Mid under Major and saves her word and her addressee", Number(orgRow.giving_level_mid_cents) < 250000 && (vj || {}).giver_plural === "partners" && orgRow.addressee_pattern === "The {last}s", orgRow);
  const badWord = await api("POST", "/onboarding/setup/voice", me, { majorCents: 250000, giverSingular: "x", giverPlural: "partners" });
  const badAddr = await api("POST", "/onboarding/setup/voice", me, { majorCents: 250000, giverSingular: "partner", giverPlural: "partners", addresseePattern: "Dear {nickname}" });
  ok("§4 a custom word or addressee is validated before it is saved", badWord.status === 400 && badAddr.status === 400 && /nickname/.test(badAddr.body.message || ""), [badWord.body, badAddr.body]);

  // nothing sends until Send invites is pressed
  const invites = () => count(`SELECT COUNT(*)::int AS n FROM invites WHERE org_id = $1`, [ORG]);
  await api("GET", "/onboarding/setup/team", me);
  const own = await api("POST", "/onboarding/setup/owners", me, { to: "u_onb5_admin", which: "unowned" });
  ok("§4 reading the team page and giving her the unowned donors sends no invitation", own.status === 200 && own.body.updated === 3 && (await invites()) === 0, own.body);
  const teamSrc = fs.readFileSync(path.join(clientDir, "StepsTeam.jsx"), "utf8");
  const inviteCalls = (teamSrc.match(/"\/auth\/invite"/g) || []).length;
  const sendFn = teamSrc.slice(teamSrc.indexOf("const send = async"), teamSrc.indexOf("const row = {"));
  ok("§4 the page calls /auth/invite in one place, inside Send invites, and from no other step", inviteCalls === 1 && /"\/auth\/invite"/.test(sendFn)
    && !fs.readdirSync(clientDir).filter(f => f !== "StepsTeam.jsx").some(f => /\/auth\/invite/.test(fs.readFileSync(path.join(clientDir, f), "utf8"))));
  const sent = await api("POST", "/auth/invite", me, { email: "onb4b-treasurer@example.org", role: "viewer" });
  ok("§4 Send invites is the press that makes the invitation", sent.status === 200 && (await invites()) === 1, sent.body);

  // "Go to Home" finishes setup: Home stops showing the card
  await api("POST", "/onboarding/guided/finish", me, {});
  const fin = await guided(false);
  ok("§4 Go to Home finishes setup and Home's card goes", fin.show === false && fin.finished === true, fin.show);
  const board = (await api("GET", "/ops/onboarding", await login(SUPER))).body;
  const row = (board.rows || []).find(r => r.orgId === ORG) || {};
  ok("§4 the /ops board shows which step each org is on and what it skipped", row.setup && !!row.setup.finishedAt && row.setup.skipped.includes("QuickBooks"), row.setup);
}

(async () => {
  console.log("ONBOARD-4 Part B: the guided setup, Send it to us, and Stuck\n");
  for (const o of Object.values(O)) await wipe(o);
  await q(`DELETE FROM users WHERE email LIKE 'onb4b-%@example.org'`);
  await q(`DELETE FROM sales_bookings WHERE id LIKE 'sbk_onb4b_%'`);
  await q(`DELETE FROM close_links WHERE id LIKE 'cl_onb4b_%'`);

  // ── §0 · pure: one business day in New York skips the weekend ──
  const fri = Date.parse("2026-11-20T15:00:00Z");   // a Friday, 10 AM in New York
  ok("§0 one business day after Friday is Monday, not Saturday", new Date(STUCK.oneBusinessDayAfter(fri)).toISOString().slice(0, 10) === "2026-11-23");

  await mkOrg(O.sup, "Onb4b Steward Staff");
  await mkUser("u_onb4b_sup", O.sup, SUPER, "admin", true);
  const sup = await login(SUPER);

  // ── §1 · Send it to us: nothing loads until Load is pressed ──
  await mkOrg(O.send, "Larchmere Pantry", { paper: at(NOW - HOUR) });
  await mkUser("u_onb4b_send", O.send, ADMIN, "admin", false, NOW - 2 * DAY);
  const her = await login(ADMIN);
  const sent = await api("POST", "/onboarding/concierge", her, { fileName: "larchmere-donors.csv", fileType: "text/csv", data: Buffer.from(CSV).toString("base64") });
  ok("§1 the file is received (201)", sent.status === 201 && !!sent.body.id, sent.body);
  const jobId = sent.body.id;
  const people = () => count(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [O.send]);
  const gifts = () => count(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [O.send]);
  ok("§1 receiving the file and the mapper's first pass load nobody and no gift", (await people()) === 0 && (await gifts()) === 0, { people: await people(), gifts: await gifts() });
  const g1 = await api("GET", "/onboarding/guided", her);
  const job1 = (((g1.body.steps || []).find(s => s.id === "people") || {}).ways || { send: { jobs: [] } }).send.jobs[0] || {};
  ok("§1 her step reads Being mapped, with Received and Being mapped dated and the rest not yet",
    job1.key === "mapping" && job1.steps[0].at && job1.steps[1].at && !job1.steps[2].at && !job1.steps[3].at, job1);
  const ops1 = await api("GET", "/ops/onboarding/concierge", sup);
  const oj = (ops1.body.jobs || []).find(j => j.id === jobId) || {};
  ok("§1 /ops shows what the mapper understood: 2 people, 2 gifts, $105.50", oj.mapping && oj.mapping.people === 2 && oj.mapping.gifts === 2 && oj.mapping.giftCents === 10550, oj.mapping);
  const notHers = await api("POST", `/ops/onboarding/concierge/${jobId}/load`, her);
  ok("§1 she cannot press Load herself (404: /ops is not there for her)", notHers.status === 404 && (await people()) === 0, notHers.status);
  const xl = await api("POST", "/onboarding/concierge", her, { fileName: "larchmere.xlsx", data: Buffer.from("PK not really a workbook").toString("base64") });
  const early = await api("POST", `/ops/onboarding/concierge/${xl.body.id}/load`, sup);
  ok("§1 a workbook nobody has read yet refuses Load and loads nothing", early.status === 409 && early.body.error === "not_mapped" && (await people()) === 0, early.body);
  const loaded = await api("POST", `/ops/onboarding/concierge/${jobId}/load`, sup);
  ok("§1 Load runs the import: 2 people and 2 gifts, tagged with its run", loaded.status === 200 && (await people()) === 2
    && (await count(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND import_id=$2`, [O.send, loaded.body.importId])) === 2, loaded.body);
  const imp = (await q(`SELECT shape, actor_user_id FROM imports WHERE id=$1 AND org_id=$2`, [loaded.body.importId, O.send]))[0] || {};
  ok("§1 the run is a normal spreadsheet import in her Imports, stamped with the person who pressed Load", imp.shape === "sheet" && imp.actor_user_id === "u_onb4b_sup", imp);
  const again = await api("POST", `/ops/onboarding/concierge/${jobId}/load`, sup);
  ok("§1 a second Load is refused and writes nothing more", again.status === 409 && (await people()) === 2, again.body);
  const g2 = await api("GET", "/onboarding/guided", her);
  const job2 = g2.body.steps.find(s => s.id === "people").ways.send.jobs.find(j => j.id === jobId);
  ok("§1 her step now reads Ready for you to check, dated", job2.key === "ready" && !!job2.steps[2].at, job2);
  const undo = await api("POST", `/imports/${loaded.body.importId}/reverse`, her, {});
  ok("§1 her Undo is the import's own and takes it all away", undo.status < 300 && (await people()) === 0, { status: undo.status, body: undo.body });
  const g3 = await api("GET", "/onboarding/guided", her);
  const job3 = g3.body.steps.find(s => s.id === "people").ways.send.jobs.find(j => j.id === jobId);
  ok("§1 after Undo her step is back to Being mapped and says so", job3.key === "mapping" && job3.undone === true, job3);

  // §1b · an org made by a close link (how every org now signs): Load makes the totals check due.
  await mkOrg(O.cl, "Ossory Book Bank");
  await closeLink("cl_onb4b_cl", O.cl, "onb4b-cl@example.org", NOW - HOUR);
  await mkUser("u_onb4b_cl", O.cl, "onb4b-cl@example.org", "admin");
  const clTok = await login("onb4b-cl@example.org");
  const clSent = await api("POST", "/onboarding/concierge", clTok, { fileName: "ossory.csv", data: Buffer.from(CSV).toString("base64") });
  const clLoad = await api("POST", `/ops/onboarding/concierge/${clSent.body.id}/load`, sup);
  const due = (await q(`SELECT totals_due_at FROM orgs WHERE id=$1`, [O.cl]))[0];
  ok("§1b a close-link org's first file, once loaded, makes \"Does this match your old system?\" due", clLoad.status === 200 && !!(due && due.totals_due_at), { load: clLoad.status, due });
  const clHome = await api("GET", "/org/setup-status", clTok);
  ok("§1b and her Home opens on the totals check", clHome.body && clHome.body.firstWin === "totals", clHome.body && clHome.body.firstWin);

  // ── §2 · the guided setup ──
  ok("§2 ten steps in order (ONBOARD-5)", (g1.body.steps || []).map(s => s.id).join(",") === "yours,people,letters,funds,voice,gifts,quickbooks,email,team,call" && g1.body.total === 10, (g1.body.steps || []).map(s => s.id));
  ok("§2 the first step not done is current: Make it yours", g1.body.current === "yours", g1.body.current);
  const sk = await api("POST", "/onboarding/guided/skip", her, { step: "yours", skip: true });
  const reread = await api("GET", "/onboarding/guided", her);
  ok("§2 a skipped step stays skipped on the next read (resumable), and the next step is current",
    sk.status === 200 && reread.body.current === "people" && reread.body.steps[0].skipped === true && reread.body.skippedCount === 1, reread.body.current);
  await api("POST", "/onboarding/guided/skip", her, { step: "yours", skip: false });
  ok("§2 Bring it back makes it current again", (await api("GET", "/onboarding/guided", her)).body.current === "yours");
  await mkOrg(O.plain, "Quillfield Choir");
  await mkUser("u_onb4b_plain", O.plain, "onb4b-plain@example.org", "admin");
  ok("§2 an org not in onboarding gets no guided setup", (await api("GET", "/onboarding/guided", await login("onb4b-plain@example.org"))).body.show === false);
  await booking("sbk_onb4b_file", ADMIN, NOW - DAY, { name: "from-the-call.csv", bytes: Buffer.from(CSV) });
  const w1 = (await api("GET", "/onboarding/guided", her)).body.steps.find(s => s.id === "people").ways.send.waiting;
  ok("§2 the file she attached at booking is already waiting for her", w1.length === 1 && w1[0].fileName === "from-the-call.csv", w1);
  const claim = await api("POST", "/onboarding/concierge/booking/sbk_onb4b_file", her, {});
  const after = (await api("GET", "/onboarding/guided", her)).body.steps.find(s => s.id === "people").ways.send;
  ok("§2 sending it makes one job from the booking and it is no longer offered", claim.status === 201 && after.waiting.length === 0 && after.jobs.some(j => j.source === "booking"), after);
  ok("§2 and it still loads nobody", (await people()) === 0);

  // ── §3 · Stuck: each rule picks its fixture and no other ──
  await mkOrg(O.np, "Fenwick Riding Club");          // signed 3 days ago (close link), no people → no_people
  await closeLink("cl_onb4b_np", O.np, "onb4b-np@example.org", NOW - 3 * DAY);
  await mkUser("u_onb4b_np", O.np, "onb4b-np@example.org", "admin");
  await mkOrg(O.npEarly, "Ashby Youth Choir");       // signed 20 hours ago, no people → not yet
  await closeLink("cl_onb4b_np2", O.npEarly, "onb4b-np2@example.org", NOW - 20 * HOUR);
  await mkOrg(O.nc, "Harrowgate Shelter", { paper: at(NOW - 6 * DAY) });        // people in 4 days, no Looks right → no_check
  await donor("d_onb4b_nc1", O.nc, NOW - 4 * DAY);
  await mkOrg(O.ncEarly, "Merriwell Arts", { paper: at(NOW - 6 * DAY) });       // people in 1 day → not yet
  await donor("d_onb4b_nc2", O.ncEarly, NOW - DAY);
  await mkOrg(O.call, "Tolland Food Bank", { paper: at(NOW - 9 * DAY), dataIn: at(NOW - 6 * DAY) });   // day 9, no call → no_call
  await donor("d_onb4b_c1", O.call, NOW - 7 * DAY);
  await mkOrg(O.callDone, "Pembry Rescue", { paper: at(NOW - 9 * DAY), dataIn: at(NOW - 6 * DAY) });  // day 9, a call logged → not stuck
  await donor("d_onb4b_c2", O.callDone, NOW - 7 * DAY);
  await mkUser("u_onb4b_cd", O.callDone, "onb4b-cd@example.org", "admin");
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,created_by,logged_by_name,created_at) VALUES ('int_onb4b_1',$1,'d_onb4b_c2','call','Fixture call','u_onb4b_cd','Onb4b cd',$2)`, [O.callDone, at(NOW - 2 * DAY)]);
  await mkOrg(O.callEarly, "Brindle Arts", { paper: at(NOW - 5 * DAY), dataIn: at(NOW - 2 * DAY) });   // day 5, no call → not yet
  await donor("d_onb4b_c3", O.callEarly, NOW - 3 * DAY);
  await booking("sbk_onb4b_stuck", "onb4b-booked@example.org", NOW - 3 * DAY);       // 3 days, no close link → booked
  await booking("sbk_onb4b_sent", "onb4b-closed@example.org", NOW - 3 * DAY);        // 3 days, a close link sent → not stuck
  await closeLink("cl_onb4b_sent", null, "onb4b-closed@example.org", null);
  await booking("sbk_onb4b_new", "onb4b-new@example.org", NOW - DAY);                // 1 day → not yet
  await mkOrg(O.conc, "Caldwell Hospice", { paper: at(NOW - HOUR) });
  await donor("d_onb4b_k1", O.conc, NOW - HOUR);
  await q(`INSERT INTO onboard_concierge_jobs (id,org_id,file_name,file_size,created_at,created_by,created_by_name) VALUES ('ocj_onb4b_old',$1,'caldwell.xlsx',10,$2,'system:test','fixture')`, [O.conc, at(NOW - 4 * DAY)]);
  await mkOrg(O.concEarly, "Dunmore Pantry", { paper: at(NOW - HOUR) });
  await donor("d_onb4b_k2", O.concEarly, NOW - HOUR);
  await q(`INSERT INTO onboard_concierge_jobs (id,org_id,file_name,file_size,created_at,created_by,created_by_name) VALUES ('ocj_onb4b_new',$1,'dunmore.xlsx',10,$2,'system:test','fixture')`, [O.concEarly, at(NOW - HOUR)]);

  const st = await api("GET", "/ops/onboarding/stuck", sup);
  const mine = (st.body.rows || []).filter(r => /onb4b/.test(r.key));
  const keysOf = rule => mine.filter(r => r.rule === rule).map(r => r.key).sort().join(",");
  ok("§3 booked 2 days with no close link: only the booking with none, not the one sent a link or the new one", keysOf("booked") === "booked:sbk_onb4b_stuck", keysOf("booked"));
  ok("§3 signed with no people after 48 hours: only the org signed 3 days ago", keysOf("no_people") === `no_people:${O.np}`, keysOf("no_people"));
  ok("§3 people in with no Looks right after 3 days: only the org whose people came 4 days ago", keysOf("no_check") === `no_check:${O.nc}`, keysOf("no_check"));
  ok("§3 no call logged by day 7: only the org on day 9 with no call", keysOf("no_call") === `no_call:${O.call}`, keysOf("no_call"));
  ok("§3 a sent file waiting more than one business day: only the 4-day-old job", keysOf("concierge") === "concierge:ocj_onb4b_old", keysOf("concierge"));
  const np = mine.find(r => r.rule === "no_people") || { draft: {} };
  ok("§3 each row carries a drafted note to the org's own admin, for Jonathan to send himself", np.draft.to === "onb4b-np@example.org" && /Jonathan$/.test(np.draft.body) && !!np.draft.subject, np.draft);
  ok("§3 a non-super-admin gets 404 for the Stuck column", (await api("GET", "/ops/onboarding/stuck", her)).status === 404);

  await section4();
  for (const o of Object.values(O)) await wipe(o);
  await q(`DELETE FROM users WHERE email LIKE 'onb4b-%@example.org'`);
  await q(`DELETE FROM sales_bookings WHERE id LIKE 'sbk_onb4b_%'`);
  await q(`DELETE FROM close_links WHERE id LIKE 'cl_onb4b_%'`);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

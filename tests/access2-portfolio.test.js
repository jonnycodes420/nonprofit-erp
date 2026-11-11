// ACCESS-2 · staff who see only the people assigned to them. Boots server.js
// in-process (like tenant-matrix and access1-roles), so every route list is
// the LIVE router's: a route added tomorrow is probed tomorrow.
//
//   §1  DECLARED: every route behind sign-in has a portfolio declaration
//       (server/auth/portfolioRoutes.js), and every path parameter of an open
//       one says what it names. A new person-linked route can't ship
//       undeclared. Proven able to fail on a made-up route.
//   §2  THE MATRIX: every open route that names a person (or a gift, a note,
//       a task, a pledge, a household, a relationship) in its path, asked by a
//       portfolio user about someone outside the portfolio, answers exactly as
//       it does about nobody at all (the route's own 404, or the body or role
//       refusal that comes first), for every method. Never a success, never
//       the data, and nothing that tells "hidden" from "not there".
//   §3  BODIES: every open write, on her own person's paths, with someone
//       outside her portfolio in its body (every spelling at once, then each
//       id-shaped body field the route reads, one at a time), answers 404, and
//       afterwards nothing of hers points at them and their rows are as they were.
//   §4  LISTS: every open read, with no person or with her own, scanned for
//       the hidden person's markers. Home's bundle too.
//   §5  EXACT: her Everyone count, the list, search, ⌘K and export are her
//       portfolio, exactly (the household's member included); the cabinet
//       preset's export is a 403 (ACCESS-3); a new person is hers; her writes inside
//       land; an admin and a staff member who sees everyone are unaffected.
//   §6  ATLAS: asked about someone outside, it can't find them; asked about
//       her own, it answers. The control: an admin's Atlas finds the other.
//   §7  THE APP'S LIST (ACCESS-2B): GET /me/portfolio-routes, which the app
//       reads so it asks nothing closed, agrees with the live gate on every
//       param-less read, first match deciding as in Express; a bundle answers
//       a closed part 404 without running it; the Thread is hers only; her
//       sign-in answer carries the flag the app's first reads go by.
//
// Planted defects this suite was watched go red on (ACCESS-2 report):
//   - the gifts route's scope dropped (POST /donors/:id/gifts declared with no
//     person parameter) → §2 red, naming it.
//   - visibleSql left out of the Donors list filter → §4 and §5 red.

const PORT = Number(process.env.MATRIX_PORT || 5698);
process.env.PORT = String(PORT);
process.env.BASE = `http://localhost:${PORT}`;
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) process.env.DB_SSL = "disable";
process.env.DISABLE_BACKGROUND_TICKS = "1";
process.env.DISABLE_RATE_LIMIT = "1";
process.env.SESSION_CACHE_TTL_MS = "0";
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-test-secret";
process.env.RESEND_API_KEY = "re_dummy_local";
process.env.RESEND_BASE_URL = `http://localhost:${process.env.SINK_PORT || 5617}`;
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";
delete process.env.ANTHROPIC_API_KEY;   // Atlas reads without a model; nothing leaves the machine

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { buildInventory } = require("../scripts/lib/routeInventory");
const { civilDay } = require("./clock");
const R = require("../server/auth/portfolioRoutes");

const ORG = "org_acc2p";
const PW = "loadtest1234";
const U = {
  admin: ["u_acc2_admin", "acc2-admin@example.org", "admin", "everyone", true],
  staff: ["u_acc2_staff", "acc2-staff@example.org", "staff", "everyone", true],
  port:  ["u_acc2_port", "acc2-port@example.org", "staff", "assigned", true],
  cab:   ["u_acc2_cab", "acc2-cab@example.org", "staff", "assigned", false],
};
// Her people: two she owns, a household whose primary she owns, and its other
// member (owned by nobody, hers through the household).
const MINE = { a: "d_acc2_mine_a", b: "d_acc2_mine_b", head: "d_acc2_head", member: "d_acc2_member" };
// Outside: owned by the admin, and owned by nobody.
const HID = "d_acc2_hid", HID2 = "d_acc2_hid2";
const HIDDEN_MARKS = ["zzquillon", "zzhiddennote", "zzhiddentask", "zzhiddenthread", "7319.47", "731947", "d_acc2_hid", "zzhidden2"];
const IDS = {
  own:    { donor: MINE.a, gift: "g_acc2_mine", interaction: "i_acc2_mine", pledge: "p_acc2_mine", task: "t_acc2_mine", household: "h_acc2_mine", relationship: "r_acc2_mine", thread: "th_acc2_mine" },
  nobody: { donor: "acc2_nobody_donor", gift: "acc2_nobody_gift", interaction: "acc2_nobody_note", pledge: "acc2_nobody_pledge", task: "acc2_nobody_task", household: "acc2_nobody_house", relationship: "acc2_nobody_rel", thread: "acc2_nobody_thread" },
  hidden: { donor: HID, gift: "g_acc2_hid", interaction: "i_acc2_hid", pledge: "p_acc2_hid", task: "t_acc2_hid", household: "h_acc2_hid", relationship: "r_acc2_cross", thread: "th_acc2_hid" },
};

async function wipe() {
  const ids = Object.values(U).map(u => u[0]);
  await q(`DELETE FROM user_sessions WHERE user_id = ANY($1)`, [ids]).catch(() => {});
  for (const t of ["atlas_actions", "voice_memos", "agent_actions", "donor_relationships", "pledge_installments", "pledges", "interactions", "tasks", "gifts", "threads"])
    await q(`DELETE FROM ${t} WHERE org_id = $1`, [ORG]).catch(() => {});
  await q(`UPDATE donors SET household_id = NULL WHERE org_id = $1`, [ORG]).catch(() => {});
  await q(`DELETE FROM households WHERE org_id = $1`, [ORG]).catch(() => {});
  await q(`DELETE FROM donors WHERE org_id = $1`, [ORG]).catch(() => {});
  await q(`DELETE FROM users WHERE id = ANY($1)`, [ids]).catch(() => {});
}

async function seed() {
  await wipe();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status) VALUES ($1,'Zzacc Two Trust','acc2-portfolio',1,'team','active')
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`, [ORG]);
  await q(`UPDATE orgs SET org_kind='fixture', wealth_scores_team=true WHERE id=$1`, [ORG]).catch(() => {});
  const hash = bcrypt.hashSync(PW, 10);
  for (const [id, email, role, sees, canExport] of Object.values(U)) {
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`, [id, ORG, email, hash, "Acc2 " + id.slice(8), role]);
    await q(`UPDATE users SET sees=$2, can_export=$3, can_wealth=$3 WHERE id=$1`, [id, sees, canExport]);
  }
  const person = (id, name, owner, extra = "") => q(
    `INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,assigned_to,assigned_to_name,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,'active','cultivate',0,0,$5,$6,'system:test','test')`,
    [id, ORG, name, `${id}${extra}@example.org`, owner, owner ? "Acc2 " + owner.slice(8) : null]);
  await person(MINE.a, "Marisol Zzmine", U.port[0]);
  await person(MINE.b, "Teodor Zzmine", U.port[0]);
  await person(MINE.head, "Ines Zzhouse", U.port[0]);
  await person(MINE.member, "Paulo Zzhouse", null);
  await person(HID, "Quillon Zzquillon", U.admin[0]);
  await person(HID2, "Wren Zzhidden2", null);
  await q(`INSERT INTO households (id,org_id,name,primary_donor_id) VALUES ('h_acc2_mine',$1,'The Zzhouse household',$2), ('h_acc2_hid',$1,'The Zzquillon household',$3)`, [ORG, MINE.head, HID]);
  await q(`UPDATE donors SET household_id='h_acc2_mine' WHERE id = ANY($1)`, [[MINE.head, MINE.member]]);
  await q(`UPDATE donors SET household_id='h_acc2_hid' WHERE id = ANY($1)`, [[HID, HID2]]);
  const day = civilDay();
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ('g_acc2_mine',$1,$2,125,$4,'cash'), ('g_acc2_hid',$1,$3,7319.47,$4,'cash')`, [ORG, MINE.a, HID, day]);
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,date,note) VALUES ('i_acc2_mine',$1,$2,'note',$4,'a note on mine'), ('i_acc2_hid',$1,$3,'note',$4,'zzhiddennote about them')`, [ORG, MINE.a, HID, day]);
  await q(`INSERT INTO tasks (id,org_id,donor_id,title,due,assigned_to) VALUES ('t_acc2_mine',$1,$2,'call mine',$5,$4), ('t_acc2_hid',$1,$3,'zzhiddentask call',$5,$4)`, [ORG, MINE.a, HID, U.port[0], day]);
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status) VALUES ('p_acc2_mine',$1,$2,500,$4,'open'), ('p_acc2_hid',$1,$3,9000,$4,'open')`, [ORG, MINE.a, HID, day]);
  // ACCESS-2B: the Thread. One follow-up on her own person, and one she owns on
  // someone outside her portfolio (an owner can change after a thread opens).
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,owner_id,owner_name) VALUES
    ('th_acc2_mine',$1,$2,'call','call mine about spring',$4,$4,$5,'Acc2 port'), ('th_acc2_hid',$1,$3,'call','zzhiddenthread call',$4,$4,$5,'Acc2 port')`, [ORG, MINE.a, HID, day, U.port[0]]);
  await q(`INSERT INTO donor_relationships (id,org_id,donor_id_a,donor_id_b,relationship_type) VALUES ('r_acc2_mine',$1,$2,$3,'friend'), ('r_acc2_cross',$1,$2,$4,'friend')`, [ORG, MINE.a, MINE.b, HID]);
}

// The hidden people's rows, so a refused write can be shown to have changed nothing.
async function hiddenPrint() {
  const [r] = await q(`SELECT
      (SELECT md5(string_agg(row_to_json(d)::text, '|' ORDER BY d.id)) FROM (SELECT id,name,email,stage,status,assigned_to,household_id,deleted_at,archived_at,tags,notes FROM donors WHERE id = ANY($1)) d) AS people,
      (SELECT COUNT(*) FROM gifts WHERE donor_id = ANY($1))::int AS gifts,
      (SELECT COUNT(*) FROM interactions WHERE donor_id = ANY($1))::int AS notes,
      (SELECT COUNT(*) FROM tasks WHERE donor_id = ANY($1))::int AS tasks,
      (SELECT COUNT(*) FROM pledges WHERE donor_id = ANY($1))::int AS pledges,
      (SELECT COUNT(*) FROM donor_relationships WHERE donor_id_a = ANY($1) OR donor_id_b = ANY($1))::int AS rels,
      (SELECT md5(string_agg(row_to_json(h)::text, '|' ORDER BY h.id)) FROM households h WHERE h.org_id = $2) AS households`, [[HID, HID2], ORG]);
  return r;
}

// THE INDEPENDENT KEY: what a path parameter names, read by this suite from
// the path's own words, never from the declarations it is checking. A route
// declared as naming no person when its path says it does is still probed.
const SEG = { donors: "donor", people: "donor", gifts: "gift", interactions: "interaction", pledges: "pledge", tasks: "task",
  households: "household", "donor-relationships": "relationship", threads: "thread", drift: "donor" };
function kindOf(path, name) {
  if (/donor|person/i.test(name)) return "donor";
  if (/^gift/i.test(name)) return "gift";
  if (/^household/i.test(name)) return "household";
  const segs = String(path).split("/"), i = segs.indexOf(":" + name);
  return name === "id" && i > 0 ? SEG[segs[i - 1]] || null : null;
}
// An Express path with its params filled from one side's ids.
function fill(route, side) {
  return String(route.path).replace(/:(\w+)(\([^)]*\))?\??/g, (m, name) => {
    const kind = kindOf(route.path, name);
    return kind ? encodeURIComponent(IDS[side][kind] || "x") : "x";
  }).replace(/\*/g, "x");
}
const personParams = route => (String(route.path).match(/:(\w+)/g) || []).map(s => s.slice(1)).filter(n => kindOf(route.path, n));
// What a body field names, read from its own words (this suite's key, not the
// gate's list): a person, a household, or a record hanging off a person.
const bodyKind = k => /household/i.test(k) ? "household" : /gift/i.test(k) ? "gift" : /pledge/i.test(k) ? "pledge"
  : /interaction/i.test(k) ? "interaction" : /^task/i.test(k) ? "task"
  : /donor|person|people|member|related|attendee|recipient|^ids$|primary|secondary|kept|merged/i.test(k) ? "donor" : null;
const leaked = text => HIDDEN_MARKS.filter(m => String(text || "").toLowerCase().includes(m));
const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Routes that end a session, or run far too long to probe in a loop; each named with its reason.
const SKIP = new Set([
  "POST /auth/logout",            // signs her out; probed last in §5 instead
  "POST /me/sessions/sign-out-others",
  "POST /auth/switch-org",
]);

(async () => {
  console.log("access2-portfolio (ACCESS-2)");
  const app = require("../server.js");
  await require("./helpers").untilReady();
  await seed();
  const inv = buildInventory(app);
  ok(`live router walked: ${inv.length} routes`, inv.length > 300, inv.length);
  const signed = inv.filter(r => r.auth.some(a => /requireAuth/.test(a)) && !r.auth.includes("requireSuperAdmin"));
  const tok = {};
  for (const k of Object.keys(U)) tok[k] = await login(U[k][1], PW);
  ok("every fixture signed in", Object.values(tok).every(Boolean));

  // ── §1 DECLARED ───────────────────────────────────────────────────────────
  const undeclared = signed.filter(r => !R.declarationFor(r.method, r.path)).map(r => `${r.method} ${r.path}`);
  ok(`§1 every one of ${signed.length} signed-in routes has a portfolio declaration`, !undeclared.length, undeclared.slice(0, 40));
  const open = signed.filter(r => R.declarationFor(r.method, r.path).cls !== "closed");
  const unnamed = [];
  for (const r of open) for (const n of (String(r.path).match(/:(\w+)/g) || []).map(s => s.slice(1)))
    if (R.paramKind(r.path, n, R.declarationFor(r.method, r.path)) === undefined) unnamed.push(`${r.method} ${r.path} :${n}`);
  ok(`§1 every parameter of the ${open.length} open routes says what it names`, !unnamed.length, unnamed.slice(0, 40));
  // Proven able to fail: a route nobody declared, and an open one with an unnamed parameter.
  ok("§1 the check fails on a made-up route nobody declared", R.declarationFor("GET", "/zz-new-surface/:personRef") === null);
  ok("§1 and on an open route whose parameter says nothing", R.paramKind("/donors/:id/zz/:thing", "thing", R.declarationFor("GET", "/donors/:id/zz/:thing")) === undefined);

  // ── §2 THE MATRIX ─────────────────────────────────────────────────────────
  const before = await hiddenPrint();
  const paramRoutes = open.filter(r => personParams(r).length && !SKIP.has(`${r.method} ${r.path}`));
  // The same request about nobody at all: the answer a hidden person must get,
  // byte for byte (ids aside). A write carries a plausible body, so a route
  // whose scope was dropped WRITES, and the answers differ.
  const SINK = { amount: 25, date: civilDay(), due: civilDay(), type: "note", note: "acc2 probe", title: "acc2 probe", name: "Acc2 Probe",
    stage: "cultivate", status: "active", text: "acc2 probe", kind: "note", tag: "acc2", relationshipType: "friend", interval: "month" };
  const norm = t => String(t || "").replace(/d_acc2_hid|g_acc2_hid|i_acc2_hid|p_acc2_hid|t_acc2_hid|h_acc2_hid|r_acc2_cross|acc2_nobody_[a-z]+/g, "<id>")
    .replace(/"(at|now|created_at|updated_at|ms|took)":"?[^",}]*"?/g, "");
  const notHidden = [];
  let as404 = 0;
  for (const r of paramRoutes) {
    const body = WRITE.has(r.method) ? SINK : undefined;
    const res = await api(r.method, fill(r, "hidden"), tok.port, body);
    const nob = await api(r.method, fill(r, "nobody"), tok.port, body);
    if (res.status === 404) as404++;
    if (res.status !== nob.status || norm(res.text) !== norm(nob.text) || res.status < 300 || leaked(res.text).length)
      notHidden.push(`${r.method} ${r.path} → ${res.status} (nobody: ${nob.status}) ${leaked(res.text).join(",")}`);
  }
  ok(`§2 all ${paramRoutes.length} open person-linked routes answer about someone outside her portfolio exactly as about nobody, never a success`, !notHidden.length, notHidden.slice(0, 40));
  ok(`§2 and most are the route's own 404 (${as404} of ${paramRoutes.length}; the rest refuse the body or the role first, as for nobody)`, as404 > paramRoutes.length / 2, as404);
  const after2 = await hiddenPrint();
  ok("§2 and nothing of theirs changed", JSON.stringify(before) === JSON.stringify(after2), { before, after: after2 });

  // ── §3 BODIES ─────────────────────────────────────────────────────────────
  const writes = open.filter(r => WRITE.has(r.method) && !SKIP.has(`${r.method} ${r.path}`));
  const EVERY = { donor_id: HID, donorId: HID, donor_ids: [HID], donorIds: [HID], ids: [HID], personId: HID, person_id: HID,
    household_id: "h_acc2_hid", householdId: "h_acc2_hid", relatedDonorId: HID, primaryDonorId: HID, memberIds: [HID2],
    giftId: "g_acc2_hid", gift_id: "g_acc2_hid", pledgeId: "p_acc2_hid", interactionId: "i_acc2_hid", taskId: "t_acc2_hid" };
  const allAtOnce = [], oneAtATime = [];
  for (const r of writes) {
    const path = fill(r, "own");
    const res = await api(r.method, path, tok.port, EVERY);
    if (res.status !== 404) allAtOnce.push(`${r.method} ${r.path} → ${res.status}`);
    const fields = [...new Set([...((r.params && r.params.body) || []).filter(k => /(^|_)(id|ids)$|Id[s]?$/i.test(k)), "donorId"])];
    for (const k of fields) {
      const kind = bodyKind(k);
      const id = kind ? IDS.hidden[kind] : HID;
      const one = await api(r.method, path, tok.port, { [k]: /ids$/i.test(k) ? [id] : id });
      if (kind && one.status !== 404) oneAtATime.push(`${r.method} ${r.path} {${k}} → ${one.status}`);
    }
  }
  ok(`§3 all ${writes.length} open writes answer 404 with someone outside her portfolio in the body (every spelling at once)`, !allAtOnce.length, allAtOnce.slice(0, 40));
  ok("§3 and with each person-shaped body field the route reads, one at a time (the others are judged by the rows below)", !oneAtATime.length, oneAtATime.slice(0, 40));
  const after3 = await hiddenPrint();
  ok("§3 their rows are as they were", JSON.stringify(before) === JSON.stringify(after3), { before, after: after3 });
  const pointing = await q(`SELECT 'gift' AS t, id FROM gifts WHERE org_id=$1 AND (donor_id = ANY($2) OR soft_credit_donor_id = ANY($2)) AND id NOT LIKE 'g_acc2_%'
                            UNION ALL SELECT 'rel', id FROM donor_relationships WHERE org_id=$1 AND id <> 'r_acc2_cross' AND (donor_id_a = ANY($2) OR donor_id_b = ANY($2))
                            UNION ALL SELECT 'task', id FROM tasks WHERE org_id=$1 AND donor_id = ANY($2) AND id <> 't_acc2_hid'
                            UNION ALL SELECT 'member', id FROM donors WHERE org_id=$1 AND household_id = 'h_acc2_hid' AND NOT (id = ANY($2))`, [ORG, [HID, HID2]])
    .catch(async () => q(`SELECT 'gift' AS t, id FROM gifts WHERE org_id=$1 AND donor_id = ANY($2) AND id NOT LIKE 'g_acc2_%'`, [ORG, [HID, HID2]]));
  ok("§3 nothing of hers points at them afterwards", !pointing.length, pointing);

  // ── §4 LISTS ──────────────────────────────────────────────────────────────
  const reads = open.filter(r => r.method === "GET" && !SKIP.has(`GET ${r.path}`));
  const leaks4 = [];
  for (const r of reads) {
    const res = await api("GET", fill(r, "own"), tok.port);
    const l = leaked(res.text);
    if (l.length) leaks4.push(`GET ${r.path} → ${res.status} ${l.join(",")}`);
  }
  // Home's bundle: each part is its own route, run as her.
  const homeReads = ["/donors/counts", "/tasks", "/tasks/counts", "/donors/stage-counts", "/drift", "/threads", "/dashboard/home", "/fundraising/overview", "/insights", "/me", "/org/team", "/donors/birthdays-near", "/home/owners", "/home/lead"];
  const hb = await api("GET", "/home/bundle?" + homeReads.map(p => "p=" + encodeURIComponent(p)).join("&"), tok.port);
  if (leaked(hb.text).length) leaks4.push(`GET /home/bundle → ${leaked(hb.text).join(",")}`);
  const pb = await api("GET", `/donors/${MINE.a}/bundle`, tok.port);
  if (leaked(pb.text).length) leaks4.push(`GET /donors/:id/bundle (her own) → ${leaked(pb.text).join(",")}`);
  ok(`§4 none of ${reads.length} open reads (her own person where one is named), nor Home's bundle, shows anyone outside her portfolio`, !leaks4.length, leaks4.slice(0, 40));
  ok("§4 Home's bundle answers (its parts are each gated)", hb.status === 200, hb.status);

  // ── §5 EXACT ──────────────────────────────────────────────────────────────
  const mineSet = Object.values(MINE).sort();
  const list = await api("GET", "/donors?limit=500&roleCounts=1", tok.port);
  const listIds = ((list.body && list.body.donors) || []).map(d => d.id).sort();
  ok("§5 her Donors list is her portfolio exactly (the household's member included)", JSON.stringify(listIds) === JSON.stringify(mineSet), listIds);
  ok("§5 its total and Everyone count are hers", list.body && list.body.total === 4 && list.body.roleCounts && list.body.roleCounts.everyone === 4, list.body && { total: list.body.total, rc: list.body.roleCounts });
  const sums = await fetch(`${process.env.BASE}/donors/summaries`, { headers: { Authorization: "Bearer " + tok.port } });
  ok("§5 the shell's Everyone (X-Total-Count) is hers", sums.headers.get("x-total-count") === "4", sums.headers.get("x-total-count"));
  const cnt = await api("GET", "/donors/counts", tok.port);
  ok("§5 /donors/counts counts her people", cnt.body && cnt.body.total === 4, cnt.body);
  const s1 = await api("GET", "/search?q=zz", tok.port);
  const found = ((s1.body && s1.body.results) || []).filter(x => x.kind === "person").map(x => x.id).sort();
  ok("§5 search (⌘K) finds her people and nobody else", JSON.stringify(found) === JSON.stringify(mineSet) && !leaked(s1.text).length, { found, leak: leaked(s1.text) });
  const s2 = await api("GET", "/search?q=Quillon", tok.port);
  ok("§5 search for someone outside finds nothing", ((s2.body && s2.body.results) || []).length === 0, s2.body);
  const ex = await api("GET", "/donors/export/csv", tok.port);
  const rows = String(ex.text || "").trim().split("\n").slice(1);
  ok("§5 her export is her portfolio exactly", ex.status === 200 && rows.length === 4 && !leaked(ex.text).length, { status: ex.status, rows: rows.length });
  const exCab = await api("GET", "/donors/export/csv", tok.cab);
  ok("§5 the Campaign cabinet's export is off (403: a capability, not a person; ACCESS-3)", exCab.status === 403 && !leaked(exCab.text).length, exCab.status);
  const wsCab = await api("GET", `/donors/${MINE.a}`, tok.cab);
  ok("§5 the Campaign cabinet sees no Wealth Score", wsCab.status === 404 || !/"wealth_rating":\s*\d/.test(wsCab.text || ""), wsCab.status);
  const touch = await api("POST", `/donors/${MINE.a}/interactions`, tok.port, { type: "call", note: "acc2 call inside", date: civilDay() });
  ok("§5 logging a touch on her own person works", touch.status < 300, touch.status);
  const gift = await api("POST", `/donors/${MINE.a}/gifts`, tok.port, { amount: 40, date: civilDay(), type: "cash" });
  ok("§5 adding a gift to her own person works", gift.status < 300, [gift.status, gift.body]);
  const made = await api("POST", "/donors", tok.port, { name: "Odalys Zznewone", assignedTo: U.admin[0] });
  const [owner] = made.body && made.body.id ? await q(`SELECT assigned_to FROM donors WHERE id=$1`, [made.body.id]) : [null];
  ok("§5 a person she creates is hers, whoever the form named", made.status < 300 && owner && owner.assigned_to === U.port[0], [made.status, owner]);
  const adm = await api("GET", "/donors?limit=500&roleCounts=1", tok.admin);
  ok("§5 an admin is unaffected: everyone, theirs included", adm.body && adm.body.total >= 7 && (adm.body.donors || []).some(d => d.id === HID), adm.body && adm.body.total);
  const admOne = await api("GET", `/donors/${HID}`, tok.admin);
  ok("§5 and opens someone outside her portfolio", admOne.status === 200, admOne.status);
  const st = await api("GET", "/donors?limit=500", tok.staff);
  ok("§5 a staff member who sees everyone is unaffected", st.body && st.body.total >= 7, st.body && st.body.total);
  const team = await api("GET", "/org/team", tok.admin);
  const portRow = (team.body || []).find(u => u.id === U.port[0]);
  ok("§5 Team says who she sees", portRow && portRow.sees === "assigned", portRow);
  const flip = await api("PUT", `/org/users/${U.staff[0]}/access`, tok.admin, { preset: "cabinet" });
  const stNow = await api("GET", "/donors?limit=500", tok.staff);
  ok("§5 an admin's change in Team takes effect on the next request", flip.status === 200 && stNow.body && stNow.body.total === 0, [flip.status, stNow.body && stNow.body.total]);
  const self = await api("PUT", `/org/users/${U.port[0]}/access`, tok.port, { sees: "everyone" });
  ok("§5 she can't widen her own scope", self.status === 403 || self.status === 404, self.status);

  // ── §7 THE APP'S LIST (ACCESS-2B) ─────────────────────────────────────────
  // GET /me/portfolio-routes is what the app reads to ask nothing closed. Its
  // verdict for each param-less read must be the live gate's own answer.
  const pr = await api("GET", "/me/portfolio-routes", tok.port);
  const pats = ((pr.body && pr.body.open) || []).map(([m, re, on]) => [m, new RegExp(re), on]);
  const says = (m, p) => { const h = pats.find(([mm, re]) => mm === m && re.test(p)); return !!(h && h[2]); };
  const disagree = [];
  for (const r of signed.filter(x => x.method === "GET" && !/[:*]/.test(x.path))) {
    const res = await api("GET", r.path, tok.port);
    const gateClosed = res.status === 404 && res.body && res.body.scope === "portfolio";
    if (says("GET", r.path) === gateClosed) disagree.push(`${r.path}: list ${says("GET", r.path) ? "open" : "closed"}, gate ${gateClosed ? "closed" : "open"}`);
  }
  ok(`§7 the app's list of open routes agrees with the gate on every param-less read`, pats.length > 300 && !disagree.length, disagree.slice(0, 20));
  ok("§7 the first matching route decides, as in Express (birthdays is its own route, not /donors/:id)", says("GET", "/donors/birthdays-near") && !says("GET", "/donors/duplicates") && says("GET", `/donors/${MINE.a}`));
  const adminList = await api("GET", "/me/portfolio-routes", tok.admin);
  ok("§7 someone who sees everyone gets no list (the app asks as it always has)", adminList.body && adminList.body.open === null && adminList.body.portfolio === false, adminList.body);
  const hb2 = await api("GET", "/home/bundle?p=" + encodeURIComponent("/grants") + "&p=" + encodeURIComponent("/threads"), tok.port);
  ok("§7 a bundle answers a closed part 404 and runs the open one", hb2.status === 200 && hb2.body["/grants"].status === 404 && hb2.body["/threads"].status === 200, hb2.body && Object.fromEntries(Object.entries(hb2.body).map(([k, v]) => [k, v.status])));
  const th = await api("GET", "/threads", tok.port);
  const thNames = ((th.body && th.body.list) || []).map(x => x.donor_id || x.donorId);
  ok("§7 the Thread is hers: her person's follow-up, not the one on someone outside", th.status === 200 && thNames.includes(MINE.a) && !leaked(th.text).length, { status: th.status, thNames, leak: leaked(th.text) });
  const login2 = await fetch(`${process.env.BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: U.port[1], password: PW }) }).then(r => r.json()).catch(() => null);
  ok("§7 her sign-in answer says she sees only her people (the app's first reads keep to her routes)", login2 && login2.user && login2.user.portfolio === true, login2 && login2.user);

  // ── §6 ATLAS ──────────────────────────────────────────────────────────────
  const at = await api("POST", "/atlas", tok.port, { text: "Tell me about Quillon Zzquillon" });
  const lines = ((at.body && at.body.request && at.body.request.lines) || []).map(x => `${x.kind}: ${x.line}`);
  ok("§6 Atlas asked about someone outside her portfolio can't find them", at.status < 300 && lines.length > 0 && lines.every(l => !/^(found|answer):/.test(l))
    && !lines.join(" ").includes("7,319") && !(at.text || "").includes(HID), { status: at.status, lines });
  const atMine = await api("POST", "/atlas", tok.port, { text: "Tell me about Marisol Zzmine" });
  const mineLines = ((atMine.body && atMine.body.request && atMine.body.request.lines) || []).map(x => `${x.kind}: ${x.line}`);
  ok("§6 and about her own, it answers", atMine.status < 300 && mineLines.some(l => /^answer:|^found:/.test(l)), mineLines);
  const atAdm = await api("POST", "/atlas", tok.admin, { text: "Tell me about Quillon Zzquillon" });
  const admLines = ((atAdm.body && atAdm.body.request && atAdm.body.request.lines) || []).map(x => `${x.kind}: ${x.line}`);
  ok("§6 the control: an admin's Atlas finds them", admLines.some(l => /^answer:|^found:/.test(l)), admLines);

  await wipe();
  await closeDb();
  summary();
  process.exit(process.exitCode || 0);
})().catch(async e => { console.error(e); process.exitCode = 1; try { await closeDb(); } catch {} process.exit(1); });

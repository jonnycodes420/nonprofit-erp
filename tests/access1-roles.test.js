// ACCESS-1 · the viewer role and the org switcher. Boots server.js in-process
// (like tenant-matrix) so the write-route list is generated from the LIVE
// router: a write route added tomorrow is probed tomorrow.
//
//   §1  VIEWER WRITES: every non-GET route in the router answers a viewer with
//       403 view_only, except the few named in shared/viewOnly.js (her own
//       account, Ask, Atlas's question) and public routes (no session at all).
//       Reads answer 200. Exports follow the org's switch.
//   §2  VIEWER'S ATLAS: a request that would log or note something writes
//       nothing and says why; a question still answers.
//   §3  TEAM AND BILLING: a viewer can't open Team, invites, billing or
//       connections; she can read the plan line the app's chrome needs.
//   §4  TWO ORGS: a person at home in A and a member of B switches. Every
//       param-less read in the router is scanned before (no B marker) and after
//       (no A marker); the old session stops; writes land in B; her role in B
//       is B's.
//   §5  SUPER-ADMIN: into a customer org needs a reason; the audit row is in
//       THAT org's Activity with the reason; a demo org needs none.
//
// Planted defects this suite was watched go red on (ACCESS-1 report):
//   - one write route forgets the viewer check (a write path added to the
//     viewer's allowed list in shared/viewOnly.js) → §1 red, naming the route.
//   - the switch keeps the old org_id in one read (GET /me answering from
//     users.org_id) → §4 red, naming /me.

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

const A = "org_acc1a", B = "org_acc1b", DEMO = "org_acc1demo", HOME = "org_acc1int";
const ORG_NAME = { [A]: "Zzorga Alder Trust", [B]: "Zzorgb Birch Fund", [DEMO]: "Acc1 Demo Org", [HOME]: "Acc1 Internal" };
const KIND = { [A]: "customer", [B]: "customer", [DEMO]: "demo", [HOME]: "internal_test" };
const MARK = { [A]: ["zzmarka", "4411.07"], [B]: ["zzmarkb", "5522.09"] };
const PW = "loadtest1234";
const U = {
  adminA: ["u_acc1_admina", A, "acc1-admin-a@example.org", "admin"],
  adminB: ["u_acc1_adminb", B, "acc1-admin-b@example.org", "admin"],
  viewer: ["u_acc1_viewer", A, "acc1-viewer@example.org", "viewer"],
  two:    ["u_acc1_two", A, "acc1-two@example.org", "staff"],
  sa:     ["u_acc1_sa", HOME, "acc1-sa@example.org", "admin"],
};
const ORGS = [A, B, DEMO, HOME];

async function wipe() {
  const ids = Object.values(U).map(u => u[0]);
  await q(`DELETE FROM org_memberships WHERE user_id = ANY($1) OR org_id = ANY($2)`, [ids, ORGS]).catch(() => {});
  await q(`DELETE FROM user_sessions WHERE user_id = ANY($1)`, [ids]).catch(() => {});
  await q(`DELETE FROM support_sessions WHERE org_id = ANY($1)`, [ORGS]).catch(() => {});
  for (const t of ["atlas_actions", "voice_memos", "agent_instructions", "agent_actions", "interactions", "tasks", "gifts", "donors", "invites"])
    await q(`DELETE FROM ${t} WHERE org_id = ANY($1)`, [ORGS]).catch(() => {});
  await q(`DELETE FROM users WHERE id = ANY($1)`, [ids]).catch(() => {});
}

async function seed() {
  await wipe();
  for (const o of ORGS) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status) VALUES ($1,$2,$3,1,'team','active')
             ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, support_access_off=false`, [o, ORG_NAME[o], "acc1-" + o.slice(-4)]);
    await q(`UPDATE orgs SET viewer_exports_off=false WHERE id=$1`, [o]).catch(() => {});   // (absent on main: the suite then fails item by item)
    await q(`UPDATE orgs SET org_kind=$2, is_demo_org=$3 WHERE id=$1`, [o, KIND[o], KIND[o] === "demo"]).catch(() => {});
  }
  const hash = bcrypt.hashSync(PW, 10);
  for (const [id, org, email, role] of Object.values(U))
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`, [id, org, email, hash, "Acc1 " + id.slice(8), role]);
  await q(`UPDATE users SET is_super_admin=true WHERE id=$1`, [U.sa[0]]);
  await q(`INSERT INTO org_memberships (id,user_id,org_id,role,created_by,created_by_name) VALUES ('mem_acc1_two',$1,$2,'staff','system:test','test')`, [U.two[0], B]).catch(() => {});
  const day = civilDay();
  for (const o of [A, B]) {
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ($1,$2,$3,$4,'active','cultivate',0,0)`,
      ["d_acc1_" + o.slice(-1), o, `${MARK[o][0]} Person`, `${MARK[o][0]}@example.org`]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ($1,$2,$3,$4,$5,'cash')`,
      ["g_acc1_" + o.slice(-1), o, "d_acc1_" + o.slice(-1), Math.round(Number(MARK[o][1]) * 100), day]);
  }
}

// THE INDEPENDENT KEY: the write routes a viewer may still call, written out
// here by hand, not read from shared/viewOnly.js. Her own account and session,
// and the questions asked with a POST. A route added to the app's allowed list
// and not here fails §1 by name: widening what a viewer can do is a review
// question, never a quiet edit.
const VIEWER_MAY = new Set([
  "POST /auth/logout", "POST /auth/switch-org", "POST /auth/invite/accept",
  "POST /me/mfa/setup", "POST /me/mfa/enable", "POST /me/mfa/email-code", "POST /me/mfa/disable", "POST /me/mfa/recovery-codes",
  "POST /me/sessions/:id/sign-out", "POST /me/sessions/sign-out-others", "POST /me/password",
  "PUT /me/notification-prefs", "PUT /me/profile", "PUT /me/home-layout", "DELETE /me/home-layout", "PUT /me/nav-layout", "DELETE /me/nav-layout", "PUT /donors/list-layout", "DELETE /donors/list-layout",
  "POST /report-builder/run", "POST /why/ask", "POST /ask", "POST /ask/preview", "POST /help/ask", "POST /atlas", "POST /atlas/:id/answer",
]);

// An Express path with its params filled. Parameters and wildcards become "x".
const fill = p => String(p).replace(/:\w+(\([^)]*\))?\??/g, "x").replace(/\*/g, "x");

(async () => {
  console.log("access1-roles (ACCESS-1)");
  const app = require("../server.js");
  await require("./helpers").untilReady();
  await seed();
  const VO = await import("../shared/viewOnly.js");
  const inv = buildInventory(app);
  ok(`live router walked: ${inv.length} routes`, inv.length > 300, inv.length);
  const tok = {};
  for (const k of Object.keys(U)) tok[k] = await login(U[k][2], PW);
  ok("every fixture signed in", Object.values(tok).every(Boolean));

  // ── §1 VIEWER WRITES ────────────────────────────────────────────────────
  const writes = inv.filter(r => !["GET", "HEAD", "OPTIONS"].includes(r.method));
  const leaked = [], unsure = [];
  let refused = 0, allowed = 0, publicRoutes = 0, otherDoor = 0;
  for (const r of writes) {
    const path = fill(r.path);
    if (VIEWER_MAY.has(`${r.method} ${r.path}`)) { allowed++; continue; }   // never probed with junk (logout would end her session)
    if (VO.viewerMayWrite(path)) { leaked.push(`${r.method} ${r.path} → allowed for a viewer, and not in this suite's list`); continue; }
    const v = await api(r.method, path, tok.viewer, {});
    if (v.status === 403 && v.body && v.body.error === "view_only") { refused++; continue; }
    // A staff session doesn't open it at all (a donor's portal cookie, an API key, a provider's push).
    if (v.status === 401) { otherDoor++; continue; }
    // Otherwise it must be a route with no session at all.
    const anon = await api(r.method, path, null, {});
    if (anon.status === 401 || anon.status === 403) leaked.push(`${r.method} ${r.path} → ${v.status}`);
    else { publicRoutes++; if (v.status < 300) unsure.push(`${r.method} ${r.path}`); }
  }
  ok(`§1 every signed-in write route refuses a viewer with 403 view_only (${refused} refused, ${allowed} her own account or a question, ${publicRoutes} public, ${otherDoor} not a staff door)`,
    leaked.length === 0 && refused > 400, leaked.slice(0, 20));
  const one = await api("POST", "/donors", tok.viewer, { name: "Viewer Made This" });
  ok("§1 the refusal is one sentence", one.status === 403 && /view-only access/.test(one.body.message || ""), one.body);
  const [{ n: viewerRows }] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND name='Viewer Made This'`, [A]);
  ok("§1 and nothing was written", viewerRows === 0, viewerRows);
  for (const p of ["/donors", "/tasks", "/grants", "/me", "/org", "/billing/status", `/donors/d_acc1_a`]) {
    const r = await api("GET", p, tok.viewer);
    ok(`§1 a viewer reads ${p} (200)`, r.status === 200, r.status);
  }
  const ex1 = await api("GET", "/donors/export/csv", tok.viewer);
  ok("§1 exports are allowed by default", ex1.status === 200, ex1.status);
  const off = await api("PUT", "/org/viewer-exports", tok.adminA, { on: false });
  ok("§1 an admin turns viewer exports off", off.status === 200 && off.body.on === false, off.body);
  const ex2 = await api("GET", "/donors/export/csv", tok.viewer);
  ok("§1 then a viewer's export is refused", ex2.status === 403 && ex2.body.scope === "export", ex2.status);
  const ex3 = await api("GET", "/donors/export/csv", tok.adminA);
  ok("§1 and an admin's still works", ex3.status === 200, ex3.status);
  await api("PUT", "/org/viewer-exports", tok.adminA, { on: true });
  const sw = await api("PUT", "/org/viewer-exports", tok.viewer, { on: false });
  ok("§1 a viewer can't change that switch", sw.status === 403, sw.status);

  // ── §2 VIEWER'S ATLAS ───────────────────────────────────────────────────
  const ATLAS_WORDS = "Had lunch with Zzmarka Person today, it went well. Zzmarka Person gave $50 today.";
  const before = await q(`SELECT (SELECT COUNT(*) FROM interactions WHERE org_id=$1)::int AS i, (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int AS t`, [A]);
  const at = await api("POST", "/atlas", tok.viewer, { text: ATLAS_WORDS });
  const after = await q(`SELECT (SELECT COUNT(*) FROM interactions WHERE org_id=$1)::int AS i, (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int AS t`, [A]);
  const acts = (at.body && at.body.request && at.body.request.lines) || [];
  ok("§2 a viewer's Atlas logged no conversation and recorded no gift", before[0].i === after[0].i && before[0].t === after[0].t, { before: before[0], after: after[0] });
  ok("§2 and says why, in one line", acts.some(x => x.line === VO.VIEWER_ATLAS_SENTENCE), acts.map(x => x.line));
  // The control: the same words from an admin DO write, so §2 is not passing on a parse that found nothing.
  const atA = await api("POST", "/atlas", tok.adminA, { text: ATLAS_WORDS });
  const afterA = await q(`SELECT (SELECT COUNT(*) FROM interactions WHERE org_id=$1)::int AS i, (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int AS t`, [A]);
  ok("§2 control: the same words from an admin do write", atA.status < 300 && (afterA[0].i > after[0].i || afterA[0].t > after[0].t), { status: atA.status, after: afterA[0] });
  for (const p of ["/atlas/actions/x/yes", "/atlas/x/undo", "/atlas/x/all"]) {
    const r = await api("POST", p, tok.viewer, {});
    ok(`§2 a viewer can't approve or undo through Atlas (${p})`, r.status === 403 && r.body.error === "view_only", r.status);
  }

  // ── §3 TEAM AND BILLING ─────────────────────────────────────────────────
  for (const p of ["/org/team", "/org/invites", "/billing/donor-band", "/connections", "/api-keys", "/giving-sources"]) {
    const r = await api("GET", p, tok.viewer);
    ok(`§3 a viewer can't open ${p}`, r.status === 403 && r.body.error === "view_only", r.status);
  }
  const inv1 = await api("POST", "/auth/invite", tok.viewer, { email: "acc1-new@example.org", role: "admin" });
  ok("§3 a viewer can't invite", inv1.status === 403, inv1.status);
  const team = await api("GET", "/org/team", tok.adminA);
  ok("§3 an admin's Team lists the viewer as a viewer", team.status === 200 && team.body.some(m => m.id === U.viewer[0] && m.role === "viewer"), team.status);
  const teamB = await api("GET", "/org/team", tok.adminB);
  ok("§3 B's Team lists the member from A, with her role in B", teamB.status === 200 && teamB.body.some(m => m.id === U.two[0] && m.role === "staff" && m.member === true), teamB.body);

  // ── §4 TWO ORGS ─────────────────────────────────────────────────────────
  const mine = await api("GET", "/me/orgs", tok.two);
  ok("§4 she sees both her orgs", mine.status === 200 && mine.body.orgs.length === 2 && mine.body.current === A, mine.body);
  const reads = inv.filter(r => r.method === "GET" && !/[:*]/.test(r.path) && !/^\/(admin|ops|internal|me\/orgs|auth|health|ready)\b/.test(r.path) && r.path !== "/org/public-list");   // the public directory names every listed org by design
  const scan = async (token, forbidden) => {
    const hits = [];
    for (const r of reads) {
      const x = await api("GET", r.path, token);
      const text = String(x.text || "").toLowerCase();
      for (const m of forbidden) if (text.includes(m.toLowerCase())) { hits.push(`${r.path} (${m})`); break; }
    }
    return hits;
  };
  const beforeHits = await scan(tok.two, [...MARK[B], ORG_NAME[B]]);
  ok(`§4 before the switch: no read of ${reads.length} carries B's data`, beforeHits.length === 0, beforeHits.slice(0, 10));
  const notMine = await api("POST", "/auth/switch-org", tok.two, { orgId: DEMO });
  ok("§4 she can't switch into an org she isn't in (404)", notMine.status === 404, notMine.status);
  const s = await api("POST", "/auth/switch-org", tok.two, { orgId: B });
  ok("§4 the switch re-issues the session for B", s.status === 200 && s.body.token && s.body.org.id === B, s.status);
  const tB = s.body.token;
  const old = await api("GET", "/me", tok.two);
  ok("§4 the old session stops", old.status === 401, old.status);
  const me = await api("GET", "/me", tB);
  ok("§4 /me is B, with her role in B", me.status === 200 && me.body.org.id === B && me.body.user.role === "staff", me.body.org && me.body.org.id);
  const afterHits = await scan(tB, [...MARK[A], ORG_NAME[A]]);
  ok(`§4 after the switch: no read of ${reads.length} carries A's data`, afterHits.length === 0, afterHits.slice(0, 10));
  const sees = await api("GET", "/donors?search=zzmarkb", tB);
  ok("§4 and B's own rows are what she reads", JSON.stringify(sees.body).includes("zzmarkb"), sees.status);
  const made = await api("POST", "/donors", tB, { name: "Acc1 Made In B" });
  const [row] = await q(`SELECT org_id, created_by FROM donors WHERE name='Acc1 Made In B'`);
  ok("§4 a write after the switch lands in B, signed by her", made.status < 300 && row && row.org_id === B && row.created_by === U.two[0], row);
  const adm = await api("GET", "/org/team", tB);
  const admA = await api("GET", "/audit/log", tB);
  ok("§4 her role in B is B's (staff): admin pages refuse", adm.status === 200 && admA.status === 403, [adm.status, admA.status]);
  await q(`UPDATE org_memberships SET revoked_at=NOW() WHERE user_id=$1 AND org_id=$2`, [U.two[0], B]).catch(() => {});
  const gone = await api("GET", "/donors", tB);
  ok("§4 ending the membership ends B's session on its next request", gone.status === 401, gone.status);
  await q(`UPDATE org_memberships SET revoked_at=NULL WHERE user_id=$1 AND org_id=$2`, [U.two[0], B]).catch(() => {});

  // ── §5 SUPER-ADMIN ──────────────────────────────────────────────────────
  const noWhy = await api("POST", "/auth/switch-org", tok.sa, { orgId: B });
  ok("§5 a super-admin into a customer org without a reason is refused", noWhy.status === 400 && noWhy.body.error === "reason_required", noWhy.body);
  const REASON = "Ticket 4471: their deposit report total looks off";
  const why = await api("POST", "/auth/switch-org", tok.sa, { orgId: B, reason: REASON });
  ok("§5 with a reason she opens it read-only (a support session)", why.status === 200 && why.body.user && why.body.user.support && why.body.user.support.writable === false, why.status);
  const rowsB = await q(`SELECT summary, org_id FROM fin_audit_log WHERE org_id=$1 AND request_path='/auth/switch-org' ORDER BY created_at DESC LIMIT 1`, [B]);
  ok("§5 the audit row is in B's own log, with the reason", rowsB.length === 1 && String(rowsB[0].summary).includes(REASON), rowsB);
  const log = await api("GET", "/audit/log", tok.adminB);
  ok("§5 and B's admin sees it in their Activity", log.status === 200 && JSON.stringify(log.body).includes(REASON), log.status);
  const demo = await api("POST", "/auth/switch-org", tok.sa, { orgId: DEMO });
  ok("§5 a demo org needs no reason", demo.status === 200 && demo.body.token, demo.body);

  // ── §6 JOINING A SECOND ORG ─────────────────────────────────────────────
  // An address that already has an account accepts SIGNED IN as it, never with
  // a password typed on the public invite page (that would be a guessing door
  // around sign-in and its two-step code).
  const inv6 = await api("POST", "/auth/invite", tok.adminB, { email: U.viewer[2], role: "viewer" });
  ok("§6 B's admin can invite an address that has an account in A", inv6.status === 200, inv6.body);
  const [it] = await q(`SELECT token FROM invites WHERE org_id=$1 AND lower(email)=$2 ORDER BY created_at DESC LIMIT 1`, [B, U.viewer[2]]);
  const info = await api("GET", "/auth/invite/" + (it && it.token), null);
  ok("§6 the invite page knows the account exists", info.status === 200 && info.body.existingAccount === true, info.body);
  const noSession = await api("POST", "/auth/invite/accept", null, { token: it && it.token, password: PW });
  ok("§6 her password alone does not accept it", noSession.status === 401 && noSession.body.error === "sign_in_first", noSession.body);
  const wrongOne = await api("POST", "/auth/invite/accept", tok.adminA, { token: it && it.token });
  ok("§6 someone else's session does not accept it", wrongOne.status === 401 && wrongOne.body.error === "sign_in_first", wrongOne.body);
  const [none] = await q(`SELECT COUNT(*)::int AS n FROM org_memberships WHERE user_id=$1 AND org_id=$2`, [U.viewer[0], B]).catch(() => [{ n: -1 }]);
  ok("§6 and nothing joined", none.n === 0, none.n);
  const joined = await api("POST", "/auth/invite/accept", tok.viewer, { token: it && it.token });
  const [m6] = await q(`SELECT role, created_by FROM org_memberships WHERE user_id=$1 AND org_id=$2 AND revoked_at IS NULL`, [U.viewer[0], B]).catch(() => []);
  ok("§6 signed in as herself, she joins B with the invite's role", joined.status === 201 && joined.body.org.id === B && m6 && m6.role === "viewer" && m6.created_by === U.adminB[0], { status: joined.status, m6 });
  const b6 = await api("POST", "/donors", joined.body.token, { name: "Acc1 Viewer In B" });
  ok("§6 and in B she is a viewer too", b6.status === 403 && b6.body.error === "view_only", b6.status);

  await wipe();
  await closeDb().catch(() => {});
  summary();
  process.exit(process.exitCode || 0);
})().catch(e => { console.error(e); process.exit(1); });

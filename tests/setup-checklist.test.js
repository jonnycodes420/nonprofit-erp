// BUILD-35 — "Set up Steward" activation checklist.
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// What it proves:
//   - GET /org/setup-status COMPUTES each item live from real org data —
//     nothing stored per-step — so an item flips done the moment the
//     underlying thing becomes true, however it happened (any entry path)
//   - donors item: sample + soft-deleted donors never count; >5 real donors = done
//   - plan grace: the `team` item exists on Team tier only (hidden on Core,
//     not shown-and-locked)
//   - an established org (everything already true) reads complete — the card
//     has nothing to nag about
//   - PUT /org/setup-card: admin-only, org-wide (a second admin sees it),
//     validated values, resets to null; org-scoped both ways
//   - client-source guard: setup section in HOME_SECTIONS, exact deep links
//     in SETUP_ITEM_META, the openImport intent threads App → Donors

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG_T = "org_su_team", ORG_C = "org_su_core";

async function reset() {
  for (const o of [ORG_T, ORG_C]) {
    await q(`DELETE FROM giving_pages WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM workflows WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM invites WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM gifts WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM donors WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM users WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]);
  }
}
async function seedOrg(o, tag, plan) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active',$4)`, [o, `SU ${tag}`, `su-${tag}`, plan]);
}
async function seedUser(o, id, tag, role = "admin") {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`, [id, o, `${tag}@su.local`, hash, `User ${tag}`, role]);
}
const item = (body, key) => (body.items || []).find(i => i.key === key);

(async () => {
  await reset();
  await seedOrg(ORG_T, "t", "team");
  await seedOrg(ORG_C, "c", "seed");
  await seedUser(ORG_T, "u_su_t1", "t1");
  await seedUser(ORG_T, "u_su_t2adm", "t2adm");        // second ADMIN — proves org-wide card state
  await seedUser(ORG_T, "u_su_staff", "tstaff", "staff");
  await seedUser(ORG_C, "u_su_c1", "c1");

  const tokT = await login("t1@su.local");
  const tokT2 = await login("t2adm@su.local");
  const tokStaff = await login("tstaff@su.local");
  const tokC = await login("c1@su.local");

  // ── Fresh orgs: everything false, plan-graceful item set ─────────────────
  let r = await api("GET", "/org/setup-status", tokT);
  // The Team org seeds 3 users, so its `team` item is legitimately done from
  // the start (members exist) — exactly the computed-not-stored behavior.
  ok("fresh Team org → 200, six items, only `team` done (3 seeded users)", r.status === 200 && r.body.totalCount === 6 && r.body.doneCount === 1 && !r.body.complete, r.body);
  ok("fresh org cardState is null (show the card)", r.body.cardState === null);
  ok("every non-team item computed false on a fresh org", (r.body.items || []).filter(i => i.key !== "team").every(i => i.done === false), r.body.items);
  r = await api("GET", "/org/setup-status", tokC);
  ok("Core org → five items (team item HIDDEN, not shown-and-locked)", r.status === 200 && r.body.totalCount === 5 && !item(r.body, "team"), r.body.items);
  r = await api("GET", "/org/setup-status", null);
  ok("no token → 401", r.status === 401, r.status);

  // ── Donors item: sample + trashed never count; >5 real = done ────────────
  for (let i = 0; i < 10; i++) await q(`INSERT INTO donors (id,org_id,name,is_sample) VALUES ($1,$2,$3,TRUE)`, [`d_su_s${i}`, ORG_C, `Sample ${i}`]);
  await q(`INSERT INTO donors (id,org_id,name,deleted_at) VALUES ('d_su_del',$1,'Trashed',NOW())`, [ORG_C]);
  r = await api("GET", "/org/setup-status", tokC);
  ok("10 sample + 1 trashed donor → donors item still NOT done", item(r.body, "donors").done === false && item(r.body, "donors").count === 0, item(r.body, "donors"));
  for (let i = 0; i < 6; i++) await q(`INSERT INTO donors (id,org_id,name) VALUES ($1,$2,$3)`, [`d_su_r${i}`, ORG_C, `Real ${i}`]);
  r = await api("GET", "/org/setup-status", tokC);
  // BUILD-79 Part 6 — donors alone do not tick the box: an import that
  // dropped every dollar is not "done". 1,111 donors at $0 once ticked it.
  ok("6 real donors with ZERO gifts → donors item NOT done, needsGiftConfirm flagged",
     item(r.body, "donors").done === false && item(r.body, "donors").count === 6 && item(r.body, "donors").needsGiftConfirm === true, item(r.body, "donors"));
  // the explicit human confirmation path ticks it at $0
  r = await api("POST", "/org/setup-confirm-no-gifts", tokC, {});
  ok("admin confirms the file genuinely had no gifts → 200", r.status === 200, r.status);
  r = await api("GET", "/org/setup-status", tokC);
  ok("after confirmation → donors item done at $0", item(r.body, "donors").done === true, item(r.body, "donors"));
  // reset the confirmation and tick it the honest way instead: one real gift
  await q(`UPDATE orgs SET setup_no_gifts_confirmed=FALSE WHERE id=$1`, [ORG_C]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date) VALUES ('g_su_1',$1,'d_su_r0',250,'2026-01-15')`, [ORG_C]);
  r = await api("GET", "/org/setup-status", tokC);
  ok("one real gift → donors item done (count 6 > 5, gifts > 0)", item(r.body, "donors").done === true && item(r.body, "donors").count === 6, item(r.body, "donors"));

  // ── Stripe / address / giving page / workflow flip from the real change ──
  ok("stripe not done before connect", item(r.body, "stripe").done === false);
  await q(`UPDATE orgs SET stripe_account_id='acct_su_test' WHERE id=$1`, [ORG_C]);
  r = await api("GET", "/org/setup-status", tokC);
  ok("stripe_account_id set → stripe item done (regardless of entry path)", item(r.body, "stripe").done === true);

  await q(`UPDATE orgs SET receipt_address='12 Main St, Fairhope, AL' WHERE id=$1`, [ORG_C]);
  r = await api("GET", "/org/setup-status", tokC);
  ok("receipt_address set → address item done", item(r.body, "address").done === true);

  await q(`INSERT INTO giving_pages (id,org_id,slug,title,status) VALUES ('gp_su_arch',$1,'arch','Archived','archived')`, [ORG_C]);
  r = await api("GET", "/org/setup-status", tokC);
  ok("an ARCHIVED giving page does not count as published", item(r.body, "givingPage").done === false);
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,status) VALUES ('gp_su_live',$1,'live','Live','active')`, [ORG_C]);
  r = await api("GET", "/org/setup-status", tokC);
  ok("a LIVE giving page → item done", item(r.body, "givingPage").done === true);

  await q(`INSERT INTO workflows (id,org_id,recipe_key,name,trigger,enabled) VALUES ('wf_su_off',$1,'new_donor_welcome','Welcome','gift_received',FALSE)`, [ORG_C]);
  r = await api("GET", "/org/setup-status", tokC);
  ok("a provisioned-but-DISABLED workflow does not count", item(r.body, "workflow").done === false);
  await q(`UPDATE workflows SET enabled=TRUE WHERE id='wf_su_off'`);
  r = await api("GET", "/org/setup-status", tokC);
  ok("first enabled workflow → item done", item(r.body, "workflow").done === true);
  ok("Core org is now COMPLETE (5 of 5) — an established org has nothing to be nagged about", r.body.complete === true && r.body.doneCount === 5, r.body);

  // ── Team item: 2+ users OR a live pending invite ─────────────────────────
  r = await api("GET", "/org/setup-status", tokT);
  ok("Team org with 3 seeded users → team item done (members exist)", item(r.body, "team").done === true);
  // A single-user Team org with only an EXPIRED invite is not done; a live one is.
  await q(`DELETE FROM users WHERE org_id=$1 AND id<>'u_su_t1'`, [ORG_T]);
  await q(`INSERT INTO invites (id,org_id,email,token,expires_at) VALUES ('inv_su_exp',$1,'x@su.local','tok_su_exp',NOW() - INTERVAL '1 day')`, [ORG_T]);
  r = await api("GET", "/org/setup-status", tokT);
  ok("single user + expired invite → team item NOT done", item(r.body, "team").done === false);
  await q(`INSERT INTO invites (id,org_id,email,token,expires_at) VALUES ('inv_su_live',$1,'y@su.local','tok_su_live',NOW() + INTERVAL '7 days')`, [ORG_T]);
  r = await api("GET", "/org/setup-status", tokT);
  ok("a live pending invite → team item done (inviting counts, before accept)", item(r.body, "team").done === true);

  // ── Card state: admin-only, org-wide, validated, org-scoped ──────────────
  // Re-seed a LIVE staff user: the team-item step above deleted every ORG_T
  // user but u_su_t1, and requireAdmin now revalidates the caller against the
  // DB (BUILD-37 §A5) — a deleted user's stale token is 401, not a staff 403.
  // Re-seeding keeps this assertion about the staff ROLE being denied.
  // The team-item step deleted every ORG_T user but u_su_t1, and requireAuth now
  // revalidates the caller against the DB (BUILD-38 §Part1) — a deleted user's
  // token is 401, not a stale pass-through. Re-seed the live staff AND second
  // admin these assertions need.
  await seedUser(ORG_T, "u_su_staff2", "tstaff2", "staff");
  await seedUser(ORG_T, "u_su_t2adm2", "tadm2b", "admin");
  const tokStaff2 = await login("tstaff2@su.local");
  const tokT2b = await login("tadm2b@su.local");
  r = await api("PUT", "/org/setup-card", tokStaff2, { state: "collapsed" });
  ok("staff cannot set the org card state → 403", r.status === 403, r.status);
  r = await api("PUT", "/org/setup-card", tokT, { state: "bogus" });
  ok("invalid state → 400", r.status === 400, r.body);
  r = await api("PUT", "/org/setup-card", tokT, { state: "collapsed" });
  ok("admin collapses the card", r.status === 200 && r.body.cardState === "collapsed", r.body);
  r = await api("GET", "/org/setup-status", tokT2b);
  ok("a SECOND admin of the same org sees the shared collapsed state", r.body.cardState === "collapsed", r.body.cardState);
  r = await api("GET", "/org/setup-status", tokC);
  ok("org B's card state is untouched (org-scoped)", r.body.cardState === null, r.body.cardState);
  r = await api("PUT", "/org/setup-card", tokT, { state: "hidden" });
  ok("admin can hide it for good", r.status === 200 && r.body.cardState === "hidden");
  r = await api("PUT", "/org/setup-card", tokT, { state: null });
  ok("null resets to visible", r.status === 200 && r.body.cardState === null);

  // ── Isolation: org A's seeded data never counts for org B ────────────────
  // (ORG_T has no donors/pages/workflows; ORG_C's completions must not leak.)
  r = await api("GET", "/org/setup-status", tokT);
  ok("org B's donors/pages/workflows don't count for org A", item(r.body, "donors").done === false && item(r.body, "givingPage").done === false && item(r.body, "workflow").done === false);

  // ── Client-source guard: exact deep links + layout integration ───────────
  const root = path.join(__dirname, "..");
  const read = p => fs.readFileSync(path.join(root, p), "utf8");
  const layoutSrc = read("client/src/lib/homeLayout.js");
  ok("setup is a HOME_SECTIONS entry (hideable — normal layout rules)", /id:\s*"setup",\s*label:\s*"Set up Steward",\s*hideable:\s*true/.test(layoutSrc));
  const dash = read("client/src/components/Dashboard.jsx");
  ok("Dashboard has the SETUP_ITEM_META deep-link map", dash.includes("SETUP_ITEM_META"));
  ok("donors item deep-links with the openImport intent (exact spot, not tab root)", /donors:.*openImport:\s*true/.test(dash));
  ok("stripe + giving page land on Settings › Giving", (dash.match(/section:\s*"giving"/g) || []).length >= 2);
  ok("address lands on Settings › Tax Receipts", /address:.*section:\s*"receipts"/.test(dash));
  ok("team lands on Settings › Team", /team:.*section:\s*"team"/.test(dash));
  ok("completion renders the GoldMoment once (setup_complete key)", dash.includes('moment="setup_complete"'));
  ok("progress bar is a SOLID fill (no gradient)", !/linear-gradient\(90deg/.test(dash));
  const appSrc = read("client/src/App.jsx");
  ok("App threads the openImport intent into Donors", appSrc.includes("initialOpenImport={donorsIntent?.openImport}"));
  const donorsSrc = read("client/src/components/Donors.jsx");
  ok("Donors opens the one-file magical import on the intent", /initialOpenImport&&!isReadOnly.*setShowCombinedImport\(true\)/.test(donorsSrc));

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

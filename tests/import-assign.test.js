// FIX — Team onboarding: assign donors to officers on import.
// Two layers in one suite (like import-both.test.js):
//   1. PURE lib (client/src/lib/importShape.js, dynamic-imported): owner-column
//      detection + owner→user matching (email → name, fuzzy-tolerant) +
//      applyOwnerAssignment.
//   2. SERVER contract (local scratch server + Postgres): a Team import that
//      carries per-donor assignedTo routes each donor to the right officer's
//      portfolio (assigned_to + in_pipeline=true); unknown/foreign ids never
//      mis-assign; a CORE import ignores assignment (lands unassigned); plan
//      gating; plus team-invite coverage (create/seat-limit/accept).
//
// Run: node tests/import-assign.test.js  (server booted per tests/README.md)

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const TEAM = "org_ia_team", CORE = "org_ia_core", OTHER = "org_ia_other";

async function reset() {
  for (const org of [TEAM, CORE, OTHER]) {
    for (const t of ["gifts", "interactions", "fin_transactions", "invites", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, plan, subStatus, tag) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,$4,$5)`,
    [o, `IA ${tag}`, `ia-${tag}`, subStatus, plan]);
}
async function seedUser(o, id, email, name, role = "staff") {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, o, email, hash, name, role]);
}

(async () => {
  // ══════════════════════════════════════════════════════════════════════════
  // 1 — PURE LIB: owner detection + matching
  // ══════════════════════════════════════════════════════════════════════════
  const { detectOwnerColumn, matchOwnersToUsers, applyOwnerAssignment, groupOwnerMatches } =
    await import("../client/src/lib/importShape.js");

  ok("detectOwnerColumn — 'Assigned Officer'", detectOwnerColumn(["Name", "Email", "Assigned Officer"]) === "Assigned Officer");
  ok("detectOwnerColumn — 'Owner'", detectOwnerColumn(["Owner", "Name"]) === "Owner");
  ok("detectOwnerColumn — 'Solicitor'", detectOwnerColumn(["Name", "Solicitor"]) === "Solicitor");
  ok("detectOwnerColumn — 'Portfolio'", detectOwnerColumn(["Portfolio", "Name"]) === "Portfolio");
  ok("detectOwnerColumn — 'Gift Officer'", detectOwnerColumn(["Gift Officer"]) === "Gift Officer");
  ok("detectOwnerColumn — none (no false positive on Email/Employer)", detectOwnerColumn(["Name", "Email", "Employer"]) === "");

  const users = [
    { id: "u1", name: "Sarah Lee", email: "sarah@org.org" },
    { id: "u2", name: "Marcus Chen", email: "marcus@org.org" },
    { id: "u3", name: "Dana Ruiz", email: "dana@org.org" },
  ];
  const m = matchOwnersToUsers(
    ["sarah@org.org", "Marcus Chen", "chen, marcus", "Sara Lee", "Unknown Person", "Marcus Chen", ""],
    users
  );
  const byVal = Object.fromEntries(m.map(x => [x.value, x]));
  ok("match by EMAIL", byVal["sarah@org.org"].userId === "u1" && byVal["sarah@org.org"].matchType === "email");
  ok("match by NAME exact", byVal["Marcus Chen"].userId === "u2" && byVal["Marcus Chen"].matchType === "name");
  ok("match by NAME 'Last, First' flip", byVal["chen, marcus"].userId === "u2" && byVal["chen, marcus"].matchType === "name");
  ok("match by NAME fuzzy (typo 'Sara Lee'→Sarah Lee)", byVal["Sara Lee"].userId === "u1" && byVal["Sara Lee"].matchType === "name");
  ok("unmatched value → none (never mis-assign)", byVal["Unknown Person"].userId === null && byVal["Unknown Person"].matchType === "none");
  ok("count aggregated per distinct value", byVal["Marcus Chen"].count === 2);
  ok("blank owner value excluded", byVal[""] === undefined);

  // Ambiguity → none (two users named "Sam Jones").
  const ambig = matchOwnersToUsers(["Sam Jones"], [
    { id: "a", name: "Sam Jones", email: "sam1@o.org" },
    { id: "b", name: "Sam Jones", email: "sam2@o.org" },
  ]);
  ok("ambiguous name → none", ambig[0].userId === null && ambig[0].matchType === "none");

  // applyOwnerAssignment: stamps assignedTo, strips owner, leaves unresolved unassigned.
  const applied = applyOwnerAssignment(
    [{ name: "Jane", owner: "Sarah Lee" }, { name: "Bob", owner: "Ghost" }, { name: "Amy", owner: "" }],
    { "sarah lee": { userId: "u1", userName: "Sarah Lee" } }
  );
  ok("applyOwnerAssignment — matched donor stamped", applied[0].assignedTo === "u1" && applied[0].assignedToName === "Sarah Lee");
  ok("applyOwnerAssignment — owner field stripped", !("owner" in applied[0]));
  ok("applyOwnerAssignment — unresolved donor unassigned", applied[1].assignedTo === undefined && !("owner" in applied[1]));
  ok("applyOwnerAssignment — blank owner unassigned", applied[2].assignedTo === undefined);

  // ── Pending invitees are first-class in matching (FIX 2026-07-28) ──
  // A pseudo-user with id "invite:<id>" (a pending invitee) matches by exact
  // email AND by name/first-name, so the exact address never reads "no match".
  const withPending = [
    { id: "u1", name: "Sarah Lee", email: "sarah@org.org" },
    { id: "invite:inv_j", name: "Jonathan", email: "jonathan@creo.org", pending: true },
    { id: "invite:inv_b", name: "Benjamin", email: "benjamin@creo.org", pending: true },
  ];
  const pm = matchOwnersToUsers(
    ["jonathan@creo.org", "JONATHAN@CREO.ORG", "Jonathan Atkinson", "jonathan", "benjamin@creo.org", "Benjamin Reed", "sarah@unknown.org"],
    withPending
  );
  const pv = Object.fromEntries(pm.map(x => [x.value, x]));
  ok("pending invite matched by EXACT email (never 'no match')", pv["jonathan@creo.org"].userId === "invite:inv_j" && pv["jonathan@creo.org"].matchType === "email");
  ok("pending invite matched by UPPERCASE email", pv["JONATHAN@CREO.ORG"].userId === "invite:inv_j");
  ok("pending invite matched by full-name variant", pv["Jonathan Atkinson"].userId === "invite:inv_j" && pv["Jonathan Atkinson"].matchType === "name");
  ok("pending invite matched by first-name/local-part", pv["jonathan"].userId === "invite:inv_j");
  ok("second pending invite matched (Benjamin variants)", pv["benjamin@creo.org"].userId === "invite:inv_b" && pv["Benjamin Reed"].userId === "invite:inv_b");
  ok("genuinely unknown value still → none (Invite / Leave)", pv["sarah@unknown.org"].userId === null && pv["sarah@unknown.org"].matchType === "none");

  // groupOwnerMatches collapses the 4 Jonathan spellings + 2 Benjamin onto 2 people.
  const grouped = groupOwnerMatches(pm);
  const gj = grouped.groups.find(g => g.userId === "invite:inv_j");
  const gb = grouped.groups.find(g => g.userId === "invite:inv_b");
  ok("group: Jonathan collapses 4 spellings into one person", gj && gj.spellingCount === 4 && gj.totalCount === 4);
  ok("group: email is the headline matchType when any spelling matched by email", gj.matchType === "email");
  ok("group: Benjamin collapses 2 spellings", gb && gb.spellingCount === 2);
  ok("group: unknown value stays in unmatched (keeps Invite/Leave)", grouped.unmatched.length === 1 && grouped.unmatched[0].value === "sarah@unknown.org");
  ok("group: no user is double-listed", new Set(grouped.groups.map(g => g.userId)).size === grouped.groups.length);

  // ══════════════════════════════════════════════════════════════════════════
  // 2 — SERVER contract
  // ══════════════════════════════════════════════════════════════════════════
  await reset();
  await seedOrg(TEAM, "team", "active", "team");
  await seedUser(TEAM, "ia_admin", "iaadmin@ia.local", "Ada Admin", "admin");
  await seedUser(TEAM, "ia_sarah", "sarah@ia.local", "Sarah Lee", "staff");
  await seedUser(TEAM, "ia_marcus", "marcus@ia.local", "Marcus Chen", "staff");
  await seedOrg(CORE, "core", "active", "core");
  await seedUser(CORE, "core_admin", "coreadmin@ia.local", "Cora Admin", "admin");
  await seedOrg(OTHER, "team", "active", "other");
  await seedUser(OTHER, "other_admin", "otheradmin@ia.local", "Otto Other", "admin");
  await seedUser(OTHER, "other_staff", "otherstaff@ia.local", "Olive Other", "staff");

  const teamAdmin = await login("iaadmin@ia.local");
  const coreAdmin = await login("coreadmin@ia.local");
  const otherAdmin = await login("otheradmin@ia.local");

  // ── Team import with per-donor assignment (owner column already mapped) ──
  const teamPayload = {
    donors: [
      { name: "Jane Prospect", email: "jane@d.org", total: 5000, lastGift: "2024-11-01", assignedTo: "ia_sarah", assignedToName: "Sarah Lee" },
      { name: "Bob Donor",     email: "bob@d.org",  total: 1200, lastGift: "2024-06-01", assignedTo: "ia_marcus", assignedToName: "Marcus Chen" },
      { name: "Amy Nobody",    email: "amy@d.org",  total: 300,  lastGift: "2024-05-01" },                        // unassigned
      { name: "Ed Ghost",      email: "ed@d.org",   total: 100,  lastGift: "2024-04-01", assignedTo: "ia_ghost" }, // unknown id
      { name: "Ivy Foreign",   email: "ivy@d.org",  total: 900,  lastGift: "2024-03-01", assignedTo: "other_staff" }, // foreign-org user
    ],
    gifts: [],
  };
  const teamImp = await api("POST", "/donors/import-combined", teamAdmin, teamPayload);
  ok("team import-combined → 200", teamImp.status === 200, teamImp.body);
  ok("team import created 5 donors", teamImp.body.created === 5, teamImp.body);

  const jane = (await q("SELECT assigned_to, assigned_to_name, in_pipeline FROM donors WHERE org_id=$1 AND email='jane@d.org'", [TEAM]))[0];
  ok("Jane → assigned to Sarah + on board", jane.assigned_to === "ia_sarah" && jane.assigned_to_name === "Sarah Lee" && jane.in_pipeline === true, jane);
  const bob = (await q("SELECT assigned_to, in_pipeline FROM donors WHERE org_id=$1 AND email='bob@d.org'", [TEAM]))[0];
  ok("Bob → assigned to Marcus + on board", bob.assigned_to === "ia_marcus" && bob.in_pipeline === true, bob);
  const amy = (await q("SELECT assigned_to, in_pipeline FROM donors WHERE org_id=$1 AND email='amy@d.org'", [TEAM]))[0];
  ok("Amy → unassigned, not on board", amy.assigned_to === null && amy.in_pipeline === false, amy);
  const ed = (await q("SELECT assigned_to, in_pipeline FROM donors WHERE org_id=$1 AND email='ed@d.org'", [TEAM]))[0];
  ok("Ed (unknown officer id) → unassigned, not on board (never mis-assign)", ed.assigned_to === null && ed.in_pipeline === false, ed);
  const ivy = (await q("SELECT assigned_to, in_pipeline FROM donors WHERE org_id=$1 AND email='ivy@d.org'", [TEAM]))[0];
  ok("Ivy (foreign-org officer id) → unassigned (org-scoped, never cross-org)", ivy.assigned_to === null && ivy.in_pipeline === false, ivy);

  // Assigned donors populate the officer's portfolio (GET /donors?assignedTo=)
  const sarahPortfolio = (await api("GET", "/donors?assignedTo=ia_sarah", teamAdmin)).body;
  ok("Sarah's portfolio = her 1 assigned donor", sarahPortfolio.length === 1 && sarahPortfolio[0].email === "jane@d.org", sarahPortfolio.map(d => d.email));
  // …and the pipeline board (in_pipeline members only)
  const board = (await api("GET", "/pipeline?scope=all", teamAdmin)).body;
  const boardNames = Object.values(board.columns || {}).flat().map(c => c.name).sort();
  ok("board holds exactly the 2 assigned donors", board.tier === "team" && boardNames.join() === ["Bob Donor", "Jane Prospect"].join(), boardNames);

  // ── Core import IGNORES assignment (lands unassigned) ──
  const coreImp = await api("POST", "/donors/import-combined", coreAdmin, {
    donors: [{ name: "Cy Core", email: "cy@core.org", total: 500, lastGift: "2024-10-01", assignedTo: "core_admin", assignedToName: "Cora Admin" }],
    gifts: [],
  });
  ok("core import-combined → 200", coreImp.status === 200, coreImp.body);
  const cy = (await q("SELECT assigned_to, in_pipeline FROM donors WHERE org_id=$1 AND email='cy@core.org'", [CORE]))[0];
  ok("Core import → donor unassigned + not on board (assignment is Team-only)", cy.assigned_to === null && cy.in_pipeline === false, cy);

  // ── /donors/import (aggregate, no history) honors assignment on Team too ──
  const aggImp = await api("POST", "/donors/import", teamAdmin, {
    donors: [{ name: "Agg Donor", email: "agg@d.org", total: 700, assignedTo: "ia_marcus", assignedToName: "Marcus Chen" }],
  });
  ok("team /donors/import → 200", aggImp.status === 200, aggImp.body);
  const agg = (await q("SELECT assigned_to, in_pipeline FROM donors WHERE org_id=$1 AND email='agg@d.org'", [TEAM]))[0];
  ok("aggregate import → assigned + on board", agg.assigned_to === "ia_marcus" && agg.in_pipeline === true, agg);

  // ── Org isolation: the other team's import can't touch TEAM's donors/users ──
  const otherImp = await api("POST", "/donors/import-combined", otherAdmin, {
    donors: [{ name: "Ottos Donor", email: "otto-d@d.org", total: 100, assignedTo: "ia_sarah" }], // TEAM's user id
    gifts: [],
  });
  ok("other-org import → 200", otherImp.status === 200);
  const ottoD = (await q("SELECT assigned_to FROM donors WHERE org_id=$1 AND email='otto-d@d.org'", [OTHER]))[0];
  ok("cross-org officer id → unassigned in the other org", ottoD.assigned_to === null, ottoD);

  // ══════════════════════════════════════════════════════════════════════════
  // 3 — TEAM INVITE coverage (the onboarding invite reuses this exact path)
  // ══════════════════════════════════════════════════════════════════════════
  const inv = await api("POST", "/auth/invite", teamAdmin, { email: "newofficer@ia.local", role: "staff" });
  ok("admin invite → success + invite link", inv.status === 200 && inv.body.success === true && !!inv.body.inviteLink, inv.body);
  const invRow = (await q("SELECT email, role FROM invites WHERE org_id=$1 AND email='newofficer@ia.local'", [TEAM]))[0];
  ok("invite row persisted (email + role)", invRow && invRow.email === "newofficer@ia.local" && invRow.role === "staff", invRow);

  // Non-admin (staff) cannot invite
  const sarahTok = await login("sarah@ia.local");
  const staffInv = await api("POST", "/auth/invite", sarahTok, { email: "x@ia.local", role: "staff" });
  ok("staff invite → 403 (admin only)", staffInv.status === 403, staffInv.status);

  // Duplicate existing-user email → 409
  const dupInv = await api("POST", "/auth/invite", teamAdmin, { email: "marcus@ia.local", role: "staff" });
  ok("invite existing user email → 409", dupInv.status === 409, dupInv.status);

  // Accept flow creates a real org user
  const token = (await q("SELECT token FROM invites WHERE org_id=$1 AND email='newofficer@ia.local'", [TEAM]))[0].token;
  const accept = await api("POST", "/auth/invite/accept", null, { token, name: "New Officer", password: "password12" });
  ok("accept invite → 201 + token", accept.status === 201 && !!accept.body.token, accept.body);
  const newU = (await q("SELECT role FROM users WHERE org_id=$1 AND email='newofficer@ia.local'", [TEAM]))[0];
  ok("accepted invite → user created in org", newU && newU.role === "staff", newU);

  // Seat limit respected (Team = 10). TEAM already has admin+sarah+marcus+newofficer = 4 users
  // + 0 pending. Fill to the cap with users, then the next invite must 403 seat_limit.
  for (let i = 5; i <= 10; i++) await seedUser(TEAM, `ia_fill_${i}`, `fill${i}@ia.local`, `Fill ${i}`, "staff"); // → 10 users
  const overInv = await api("POST", "/auth/invite", teamAdmin, { email: "eleven@ia.local", role: "staff" });
  ok("invite past 10-seat Team limit → 403 seat_limit", overInv.status === 403 && overInv.body.error === "seat_limit", overInv.body);

  // ══════════════════════════════════════════════════════════════════════════
  // 4 — PENDING INVITEE assignment on import + resolution on accept (FIX)
  // ══════════════════════════════════════════════════════════════════════════
  await reset();
  await seedOrg(TEAM, "team", "active", "team");
  await seedUser(TEAM, "ia_admin", "iaadmin@ia.local", "Ada Admin", "admin");
  await seedOrg(OTHER, "team", "active", "other");
  await seedUser(OTHER, "other_admin", "otheradmin@ia.local", "Otto Other", "admin");
  const admin2 = await login("iaadmin@ia.local");
  const otherAdmin2 = await login("otheradmin@ia.local");

  // Invite two officers (unaccepted) — they are PENDING.
  const invJ = await api("POST", "/auth/invite", admin2, { email: "jonathan@creo.org", role: "staff" });
  const invB = await api("POST", "/auth/invite", admin2, { email: "benjamin@creo.org", role: "staff" });
  ok("invite response carries id + derived display name (for mapping)", !!invJ.body.id && invJ.body.name === "Jonathan", invJ.body);

  // /portfolio/officers surfaces pending invitees (with derived names) so the
  // mapping screen can match + assign to them before they accept.
  const officers = (await api("GET", "/portfolio/officers", admin2)).body;
  ok("officers payload lists both pending invites with derived names",
    (officers.invites || []).length === 2 && officers.invites.some(i => i.email === "jonathan@creo.org" && i.name === "Jonathan"), officers.invites);

  // Import donors routed to the pending invites (client sends assignedTo="invite:<id>").
  const pendImp = await api("POST", "/donors/import-combined", admin2, {
    donors: [
      { name: "Alice A", email: "alice@d.org", total: 1000, assignedTo: "invite:" + invJ.body.id, assignedToName: "Jonathan" },
      { name: "Aaron A", email: "aaron@d.org", total: 800,  assignedTo: "invite:" + invJ.body.id, assignedToName: "Jonathan" },
      { name: "Bella B", email: "bella@d.org", total: 600,  assignedTo: "invite:" + invB.body.id, assignedToName: "Benjamin" },
      { name: "Ghost G", email: "ghost@d.org", total: 100,  assignedTo: "invite:inv_nonexistent" },
    ],
    gifts: [],
  });
  ok("pending-assignment import → 200 / 4 created", pendImp.status === 200 && pendImp.body.created === 4, pendImp.body);

  const alice = (await q("SELECT assigned_to, in_pipeline, pending_assignee_invite_id, pending_assignee_name FROM donors WHERE org_id=$1 AND email='alice@d.org'", [TEAM]))[0];
  ok("Alice → held PENDING for Jonathan (assigned_to null, NOT on board, pending set)",
    alice.assigned_to === null && alice.in_pipeline === false && alice.pending_assignee_invite_id === invJ.body.id && alice.pending_assignee_name === "Jonathan", alice);
  const ghost = (await q("SELECT assigned_to, pending_assignee_invite_id FROM donors WHERE org_id=$1 AND email='ghost@d.org'", [TEAM]))[0];
  ok("unknown invite id → unassigned, no pending (never mis-route)", ghost.assigned_to === null && ghost.pending_assignee_invite_id === null, ghost);

  // Officer accepts → their portfolio is populated, nothing lost in the transition.
  const jToken = (await q("SELECT token FROM invites WHERE id=$1", [invJ.body.id]))[0].token;
  const acc = await api("POST", "/auth/invite/accept", null, { token: jToken, name: "Jonathan Atkinson", password: "password12" });
  ok("Jonathan accepts → 201", acc.status === 201, acc.body);
  const jUser = (await q("SELECT id FROM users WHERE org_id=$1 AND email='jonathan@creo.org'", [TEAM]))[0];
  const aliceAfter = (await q("SELECT assigned_to, in_pipeline, pending_assignee_invite_id FROM donors WHERE org_id=$1 AND email='alice@d.org'", [TEAM]))[0];
  ok("on accept → Alice assigned to the new user + on board + pending cleared",
    aliceAfter.assigned_to === jUser.id && aliceAfter.in_pipeline === true && aliceAfter.pending_assignee_invite_id === null, aliceAfter);
  const aaronAfter = (await q("SELECT assigned_to FROM donors WHERE org_id=$1 AND email='aaron@d.org'", [TEAM]))[0];
  ok("both of Jonathan's donors resolved (nothing lost)", aaronAfter.assigned_to === jUser.id, aaronAfter);
  const jPortfolio = (await api("GET", "/donors?assignedTo=" + jUser.id, admin2)).body;
  ok("Jonathan logs in to a populated portfolio (2 donors)", jPortfolio.length === 2, jPortfolio.map(d => d.email));

  // Benjamin's assignment is independent — still pending until HE accepts.
  const bellaStill = (await q("SELECT assigned_to, pending_assignee_invite_id FROM donors WHERE org_id=$1 AND email='bella@d.org'", [TEAM]))[0];
  ok("Benjamin still pending until he accepts (independent)", bellaStill.assigned_to === null && bellaStill.pending_assignee_invite_id === invB.body.id, bellaStill);

  // Org isolation: another org can't assign to TEAM's (still-pending) invite id.
  await api("POST", "/donors/import-combined", otherAdmin2, {
    donors: [{ name: "Cross C", email: "cross@d.org", total: 100, assignedTo: "invite:" + invB.body.id }],
    gifts: [],
  });
  const cross = (await q("SELECT assigned_to, pending_assignee_invite_id FROM donors WHERE org_id=$1 AND email='cross@d.org'", [OTHER]))[0];
  ok("cross-org invite id → unassigned/no pending in the other org", cross.assigned_to === null && cross.pending_assignee_invite_id === null, cross);

  // Re-invite resilience: Bella is held on invB. Expire it, re-invite the same
  // email, and accept the NEW invite — Bella (pending on the expired invite) is
  // still claimed by email match, nothing orphans.
  await q("UPDATE invites SET expires_at = NOW() - INTERVAL '1 day' WHERE id=$1", [invB.body.id]);
  const invB2 = await api("POST", "/auth/invite", admin2, { email: "benjamin@creo.org", role: "staff" });
  ok("re-invite same email after expiry → a fresh invite", !!invB2.body.id && invB2.body.id !== invB.body.id, invB2.body);
  const bToken = (await q("SELECT token FROM invites WHERE id=$1", [invB2.body.id]))[0].token;
  const accB = await api("POST", "/auth/invite/accept", null, { token: bToken, name: "Benjamin Reed", password: "password12" });
  ok("Benjamin accepts the re-invite → 201", accB.status === 201, accB.body);
  const bUser = (await q("SELECT id FROM users WHERE org_id=$1 AND email='benjamin@creo.org'", [TEAM]))[0];
  const bellaAfter = (await q("SELECT assigned_to, in_pipeline, pending_assignee_invite_id FROM donors WHERE org_id=$1 AND email='bella@d.org'", [TEAM]))[0];
  ok("donor pending on the EXPIRED invite is still claimed by email (no orphan)",
    bellaAfter.assigned_to === bUser.id && bellaAfter.in_pipeline === true && bellaAfter.pending_assignee_invite_id === null, bellaAfter);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

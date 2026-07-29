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
  const { detectOwnerColumn, matchOwnersToUsers, applyOwnerAssignment } =
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

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

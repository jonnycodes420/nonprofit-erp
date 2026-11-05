// tests/grants-fix.test.js · GRANTS-FIX's one test. AWARDED MEANS MONEY IS PROMISED,
// AND EVERY GRANT CAN BE LINKED TO ITS FUNDER.
//
// §1 the drag never awards: a linked grant moved to Awarded on the board is
//    refused with award_required (on main it moved and wrote no pledge); the
//    award writes the pledge on the funder, on the funder's own pledges and in
//    Fundraising's, to the cent; Closed from Awarded plans the renewal.
// §2 an unlinked grant: the drag and the award both ask for the link (with the
//    action), the picker offers "Add <name> as a new funder", the link keeps
//    the typed name, then the award completes.
// §3 the general PUT refuses Awarded without the award.
// §4 POST /grants resolves its funder through the one resolver: an exact-name
//    organization is linked (no second record), a new name creates one
//    (organisation, funder type unset); a grant is never born Awarded. The
//    picker never renames the record it links.
// §5 scripts/ops/grants-link-funders.js on 10 unlinked grants (one ambiguous
//    name) and 2 awarded-without-pledge: the dry run lists 9 + 1 left + 2 to
//    record and writes nothing; --apply links 9 with one audit row each; a
//    second run changes nothing.
//
// Money and donor data: an award that writes no pledge is money promised that
// no total, no funder and no reminder knows about.
//
// HOW IT WOULD GO RED: let PATCH /grants/:id/stage move into Awarded without
// the award again (§1 "the drag is refused" goes red, and no pledge exists);
// let POST /grants skip the shared resolver (§4 "linked to the organization on
// file" goes red). Both planted and seen red before the fix was trusted.

const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_grantsfix_a", SORG = "org_grantsfix_s";
const TABLES = ["thank_you_drafts", "pledge_installments", "fin_transactions", "gifts", "pledges", "grant_milestones", "grants",
  "interactions", "donor_relationships", "tasks", "budgets", "accounts", "fin_funds", "donors", "user_sessions", "users"];
async function reset() {
  for (const o of [ORG, SORG]) {
    await q(`UPDATE pledges SET fulfilled_gift_id=NULL WHERE org_id=$1`, [o]).catch(() => {});
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const cents = v => Math.round((Number(v) || 0) * 100);

(async () => {
  await reset();
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
           VALUES ($1,'Grants fix fixture','grantsfix-a',1,'active','team','America/New_York',NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Ashdown','admin')`, [`u_${ORG}`, ORG, `wren@${ORG}.local`, pw]);
  const tok = await login(`wren@${ORG}.local`);
  await api("POST", "/onboarding/complete", tok, {});

  // ── §1 · the drag never awards; the award writes the pledge ─────────────
  console.log("\n§1 a linked grant dragged to Awarded");
  const fdn = await api("POST", "/grant-funders", tok, { name: "Larkspur Fixture Foundation", funderType: "private_foundation" });
  const F = fdn.body && fdn.body.id;
  ok("§1 the funder is on file", fdn.status === 201 && F, fdn.body);
  await api("PUT", `/grant-funders/${F}`, tok, { cycle: "annual", dueMonths: [3] });
  await q(`INSERT INTO grants (id,org_id,funder,funder_donor_id,program,status,amount,amount_requested,created_by,created_by_name)
           VALUES ('gr_gf_linked',$1,'Larkspur Fixture Foundation',$2,'River studio','submitted',15000,15000,'system:test','test')`, [ORG, F]);
  const drag = await api("PATCH", "/grants/gr_gf_linked/stage", tok, { status: "awarded" });
  const [still] = await q(`SELECT status, award_pledge_id FROM grants WHERE id='gr_gf_linked' AND org_id=$1`, [ORG]);
  ok("§1 the drag is refused and asks for the award", drag.status === 409 && drag.body.code === "award_required" && drag.body.target === "awarded" && drag.body.funderLinked === true, { status: drag.status, body: drag.body });
  ok("§1 the grant stays where it was, with no pledge", still.status === "submitted" && !still.award_pledge_id, still);
  const aw = await api("PUT", "/grants/gr_gf_linked/award", tok, { amountAwarded: "15000.00", firstDue: "2026-12-01" });
  ok("§1 the award is recorded", aw.status === 200 && aw.body.pledgeId, aw.body);
  const [pl] = await q(`SELECT id, donor_id, amount FROM pledges WHERE org_id=$1 AND donor_id=$2`, [ORG, F]);
  ok("§1 the pledge is on the funder, to the cent", pl && pl.id === aw.body.pledgeId && cents(pl.amount) === 1500000, pl);
  const prof = (await api("GET", `/donors/${F}/pledges`, tok)).body;
  const profList = Array.isArray(prof) ? prof : (prof.pledges || []);
  const onProf = profList.find(p => p.id === aw.body.pledgeId);
  ok("§1 the pledge shows on the funder's profile", onProf && cents(onProf.balance) === 1500000, prof);
  const fr = (await api("GET", "/fundraising/pledges", tok)).body;
  const onFr = (fr.pledges || []).find(p => p.id === aw.body.pledgeId);
  ok("§1 the pledge shows in Fundraising's pledges, the same balance", onFr && onFr.donorId === F && cents(onFr.balance) === 1500000, fr.pledges);
  const close = await api("PATCH", "/grants/gr_gf_linked/stage", tok, { status: "closed" });
  ok("§1 Closed from Awarded moves, and plans the renewal", close.status === 200 && close.body.renewal && close.body.renewal.renewalGrantId, close.body);

  // ── §2 · an unlinked grant: link, then award, then it completes ─────────
  console.log("\n§2 an unlinked grant dragged to Awarded");
  await q(`INSERT INTO grants (id,org_id,funder,program,status,amount,amount_requested,created_by,created_by_name)
           VALUES ('gr_gf_unlinked',$1,'Quillback Fixture Trust','Night sailing','submitted',10000,10000,'system:test','test')`, [ORG]);
  const d2 = await api("PATCH", "/grants/gr_gf_unlinked/stage", tok, { status: "awarded" });
  ok("§2 the drag asks for the award, and says there is no funder record", d2.status === 409 && d2.body.code === "award_required" && d2.body.funderLinked === false, d2.body);
  const a2 = await api("PUT", "/grants/gr_gf_unlinked/award", tok, { amountAwarded: "10000.00" });
  ok("§2 the award asks for the link, with the action", a2.status === 400 && a2.body.code === "funder_not_linked" && a2.body.action === "link_funder", a2.body);
  const srch = (await api("GET", "/grants/gr_gf_unlinked/funder-search", tok)).body;
  ok("§2 the picker offers to add the typed name as a new funder", srch.canCreate === true && srch.createName === "Quillback Fixture Trust", srch);
  const ln = await api("POST", "/grants/gr_gf_unlinked/funder-link", tok, { createName: srch.createName });
  const [nf] = await q(`SELECT name, kind, funder_type, created_by FROM donors WHERE id=$1 AND org_id=$2`, [ln.body.funderId, ORG]);
  ok("§2 the new funder is an organization, type unset, stamped", ln.status === 200 && ln.body.created && nf && nf.kind === "organisation" && nf.funder_type === null && nf.created_by === `u_${ORG}`, { body: ln.body, nf });
  const a2b = await api("PUT", "/grants/gr_gf_unlinked/award", tok, { amountAwarded: "10000.00", installmentCount: 2, frequency: "semiannual", firstDue: "2026-12-01" });
  const [g2] = await q(`SELECT status, funder, award_pledge_id FROM grants WHERE id='gr_gf_unlinked' AND org_id=$1`, [ORG]);
  ok("§2 then the award completes: Awarded, a pledge on the new funder, two installments", a2b.status === 200 && g2.status === "awarded" && g2.award_pledge_id && a2b.body.installments === 2 && g2.funder === "Quillback Fixture Trust", { a2b: a2b.body, g2 });

  // ── §3 · the general PUT refuses Awarded without the award ──────────────
  console.log("\n§3 the general PUT");
  await q(`INSERT INTO grants (id,org_id,funder,funder_donor_id,program,status,amount,created_by,created_by_name)
           VALUES ('gr_gf_put',$1,'Larkspur Fixture Foundation',$2,'Boathouse','submitted',5000,'system:test','test')`, [ORG, F]);
  for (const st of ["awarded", "reporting", "closed", "active"]) {
    const p = await api("PUT", "/grants/gr_gf_put", tok, { funder: "Larkspur Fixture Foundation", program: "Boathouse", amount: 5000, status: st });
    ok(`§3 PUT to ${st} without the award is refused`, p.status === 409 && p.body.code === "award_required", { status: p.status, body: p.body });
  }
  const [g3] = await q(`SELECT status FROM grants WHERE id='gr_gf_put' AND org_id=$1`, [ORG]);
  ok("§3 the grant is still Submitted", g3.status === "submitted", g3);

  // ── §4 · POST /grants resolves its funder ───────────────────────────────
  console.log("\n§4 POST /grants");
  const before = (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1`, [ORG]))[0].n;
  const p1 = await api("POST", "/grants", tok, { funder: "  larkspur   fixture FOUNDATION ", program: "Ropes", amount: 2000, status: "researching" });
  const after1 = (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1`, [ORG]))[0].n;
  ok("§4 a name that matches an organization is linked to the organization on file", p1.status === 201 && p1.body.funder_donor_id === F && after1 === before, { body: p1.body, before, after1 });
  const p2 = await api("POST", "/grants", tok, { funder: "Brightwater Fixture Fund", program: "Oars", amount: 3000, status: "submitted" });
  const [nd] = p2.body && p2.body.funder_donor_id ? await q(`SELECT name, kind, funder_type FROM donors WHERE id=$1 AND org_id=$2`, [p2.body.funder_donor_id, ORG]) : [];
  ok("§4 a new name creates the funder as an organization", p2.status === 201 && nd && nd.name === "Brightwater Fixture Fund" && nd.kind === "organisation" && nd.funder_type === null, { body: p2.body, nd });
  const p3 = await api("POST", "/grants", tok, { funder: "Larkspur Fixture Foundation", program: "Born awarded", amount: 1, status: "awarded" });
  ok("§4 a grant is never born Awarded", p3.status === 400 && p3.body.code === "award_required", p3.body);
  await q(`INSERT INTO grants (id,org_id,funder,program,status,amount,created_by,created_by_name)
           VALUES ('gr_gf_typed',$1,'Larkspur Fdn','Sails','researching',100,'system:test','test')`, [ORG]);
  const pick = await api("POST", "/grants/gr_gf_typed/funder-link", tok, { donorId: F });
  const [fd] = await q(`SELECT name FROM donors WHERE id=$1`, [F]);
  const [gt] = await q(`SELECT funder, funder_donor_id FROM grants WHERE id='gr_gf_typed'`);
  ok("§4 picking a record links it, keeps the typed name, renames nothing", pick.status === 200 && gt.funder_donor_id === F && gt.funder === "Larkspur Fdn" && fd.name === "Larkspur Fixture Foundation", { pick: pick.body, gt, fd });

  // ── §5 · the script ─────────────────────────────────────────────────────
  console.log("\n§5 scripts/ops/grants-link-funders.js");
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Grants fix script fixture','grantsfix-s',1,'active','team')`, [SORG]);
  const org = (id, name) => q(`INSERT INTO donors (id,org_id,name,kind,person_types,stage,status,tags,created_by,created_by_name)
                                VALUES ($1,$2,$3,'organisation','["other"]'::jsonb,'prospect','active','[]','system:test','test')`, [id, SORG, name]);
  await org("d_gfs_alder", "Alder Fixture Foundation");
  await org("d_gfs_twin1", "Twin Fixture Fund");
  await org("d_gfs_twin2", "Twin Fixture Fund");
  const names = ["Alder Fixture Foundation", "alder fixture foundation", "Alder  Fixture Foundation", "Twin Fixture Fund",
    "Birch Fixture Trust", "Birch Fixture Trust", "Cedar Fixture Trust", "Dogwood Fixture Fund", "Elm Fixture Fund", "Fir Fixture Fund"];
  for (const [i, n] of names.entries()) {
    await q(`INSERT INTO grants (id,org_id,funder,program,status,amount,created_by,created_by_name) VALUES ($1,$2,$3,'P','submitted',100,'system:test','test')`, [`gr_gfs_${i}`, SORG, n]);
  }
  for (const i of [1, 2]) {
    await q(`INSERT INTO grants (id,org_id,funder,funder_donor_id,program,status,amount,awarded_at,created_by,created_by_name)
             VALUES ($1,$2,'Alder Fixture Foundation','d_gfs_alder','Old award','awarded',500,NOW(),'system:test','test')`, [`gr_gfs_aw${i}`, SORG]);
  }
  const S = require("../scripts/ops/grants-link-funders");
  const pg = new Client({ connectionString: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest", ssl: false });
  await pg.connect();
  const [{ t0 }] = (await pg.query(`SELECT NOW() AS t0`)).rows;
  const lines = [];
  const snap = async () => JSON.stringify((await q(`SELECT id, funder_donor_id FROM grants WHERE org_id=$1 ORDER BY id`, [SORG])).concat(
    await q(`SELECT id, name FROM donors WHERE org_id=$1 ORDER BY id`, [SORG])));
  const s0 = await snap();
  const dry = await S.run({ client: pg, apply: false, orgId: SORG, log: l => lines.push(l) });
  ok("§5 the dry run lists 9 to link, 1 left, 2 to record", dry.linked === 9 && dry.left === 1 && dry.needsAward === 2, { dry, lines });
  ok("§5 the dry run says what each would do", lines.some(l => /gr_gfs_0 .*link to existing Alder Fixture Foundation/.test(l)) && lines.some(l => /create funder Cedar Fixture Trust/.test(l))
    && lines.some(l => /gr_gfs_3 .*2 organizations match: left for a person/.test(l)) && lines.filter(l => /needs its award recorded: left for a person/.test(l)).length === 2, lines);
  ok("§5 the dry run writes nothing", (await snap()) === s0);
  const app = await S.run({ client: pg, apply: true, orgId: SORG, log: () => {} });
  const linkedNow = await q(`SELECT id, funder_donor_id FROM grants WHERE org_id=$1 AND id LIKE 'gr_gfs_%' AND id NOT LIKE 'gr_gfs_aw%' ORDER BY id`, [SORG]);
  const byId = Object.fromEntries(linkedNow.map(r => [r.id, r.funder_donor_id]));
  ok("§5 apply links 9, the ambiguous one left", app.linked === 9 && linkedNow.filter(r => r.funder_donor_id).length === 9 && !byId.gr_gfs_3
    && byId.gr_gfs_0 === "d_gfs_alder" && byId.gr_gfs_2 === "d_gfs_alder" && byId.gr_gfs_4 && byId.gr_gfs_4 === byId.gr_gfs_5, byId);
  const newOrgs = await q(`SELECT name, kind, funder_type FROM donors WHERE org_id=$1 AND id NOT LIKE 'd_gfs_%' ORDER BY name`, [SORG]);
  ok("§5 one new organization per new name, never a person, nothing renamed", newOrgs.length === 5 && newOrgs.every(d => d.kind === "organisation" && d.funder_type === null)
    && (await q(`SELECT name FROM donors WHERE id IN ('d_gfs_twin1','d_gfs_twin2','d_gfs_alder') ORDER BY id`)).map(r => r.name).join("|") === "Alder Fixture Foundation|Twin Fixture Fund|Twin Fixture Fund", newOrgs);
  const audits = (await pg.query(`SELECT COUNT(*)::int n FROM fin_audit_log WHERE org_id=$1 AND request_path='scripts/ops/grants-link-funders.js' AND created_at >= $2`, [SORG, t0])).rows[0].n;
  ok("§5 one audit row per link", audits === 9, audits);
  const [{ n: pledges }] = await q(`SELECT COUNT(*)::int n FROM pledges WHERE org_id=$1`, [SORG]);
  ok("§5 no money written", pledges === 0, pledges);
  const s1 = await snap();
  const again = await S.run({ client: pg, apply: true, orgId: SORG, log: () => {} });
  ok("§5 a second run changes nothing", again.linked === 0 && again.left === 1 && again.needsAward === 2 && (await snap()) === s1, again);
  await pg.end();

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* closing */ } process.exit(1); });

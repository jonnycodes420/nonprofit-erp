// FIX-1 WORKSTREAM C — VOLUNTEERS, ITS OWN HUB.
//
// Volunteers lived under Donors with a paragraph explaining why. The data
// model was right (one person, one record, BUILD-94's person_types) and stays;
// what changes is that the person who coordinates volunteers gets a place of
// their own, built for them rather than for the person who asks for money.
//
//   §1  THE ROSTER IS EVERYONE WITH THE VOLUNTEER ROLE, and nobody else — with
//       hours this year, last shift and whether they also give.
//   §2  A VOLUNTEER IS NOT A DONOR UNTIL THEY GIVE. The Donors list (role=donor)
//       carries a volunteer only once a gift has made them one.
//   §3  ROSTER HOURS ARE THE PERSON'S HOURS, in hundredths, summed as integers:
//       the roster and the person's own record are one number.
//   §4  INTERNAL NOTES STAY INTERNAL. Training, background-check date and
//       availability are about volunteering, not about giving: they never reach
//       the donor record's timeline, Drift, or the interactions table.
//   §5  VOLUNTEERS WHO GIVE is the conversion list, and every row opens a record.
//   §6  TENANT WALL. Another org's roster, notes and givers are nobody's.
//   §7  THE HUB IS IN THE NAV, desktop and mobile, and is not the old
//       hidden Volunteers.jsx.

const fs = require("fs"), path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, leaks } = require("./helpers");
const { readSource } = require("../scripts/lib/readSource");

const ORG = "org_fx1c", OTHER = "org_fx1c2";
const PW = "loadtest1234";
const root = path.join(__dirname, "..");
const MARK = "Zephyrine background check cleared";

async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of ["volunteer_notes", "volunteer_shifts", "thank_you_drafts", "threads", "tasks", "workflow_runs",
                     "fin_transactions", "interactions", "gifts", "donors", "users", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

(async () => {
  console.log("fix1-volunteers");
  await reset();
  for (const [id, name] of [[ORG, "Hayloft Riding"], [OTHER, "Elsewhere Trust"]])
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,receipt_address)
             VALUES ($1,$2,$3,1,'team','active','1 Main St, Lexington, KY 40507')`, [id, name, id.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx1c',$1,'fx1c@example.org',$2,'Cora Coordinator','admin')`,
    [ORG, bcrypt.hashSync(PW, 4)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx1c2',$1,'fx1c-o@example.org',$2,'Other','admin')`,
    [OTHER, bcrypt.hashSync(PW, 4)]);
  const people = [
    ["c_vol", "Vera Volunteer", '["volunteer"]'],
    ["c_both", "Bea Both", '["volunteer"]'],
    ["c_don", "Dan Donor", '["donor"]'],
    ["c_staff", "Sam Staff", '["staff"]'],
  ];
  for (const [id, name, types] of people)
    await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,total_giving,gift_count)
             VALUES ($1,$2,$3,$4,'prospect',$5::jsonb,0,0)`, [id, ORG, name, id + "@example.org", types]);
  await q(`INSERT INTO donors (id,org_id,name,stage,person_types) VALUES ('c_x',$1,'Xander Elsewhere','prospect','["volunteer"]'::jsonb)`, [OTHER]);
  const tok = await login("fx1c@example.org"), tok2 = await login("fx1c-o@example.org");

  const year = new Date().getFullYear();
  const shifts = [["c_vol", `${year}-01-10`, 3.25], ["c_vol", `${year}-02-11`, 2.5], ["c_vol", `${year - 1}-11-02`, 4],
                  ["c_both", `${year}-03-01`, 1.75]];
  for (const [id, date, hours] of shifts) {
    const r = await api("POST", `/donors/${id}/volunteer-hours`, tok, { date, hours, role: "Barn crew" });
    if (r.status !== 201) console.log("  seed shift failed", r.status, r.body);
  }
  await api("POST", "/donors/c_both/gifts", tok, { amount: 60, date: `${year}-03-02`, idempotencyKey: "fx1c-both" });

  // ── §1 THE ROSTER ────────────────────────────────────────────────────────
  const roster = await api("GET", "/volunteer-hub/roster", tok);
  ok("§1 the roster answers", roster.status === 200, roster.status);
  const rows = (roster.body && roster.body.people) || [];
  const ids = rows.map(r => r.id).sort();
  ok("§1 the roster is exactly the people with the volunteer role", ids.join() === "c_both,c_vol", ids.join());
  const vera = rows.find(r => r.id === "c_vol") || {};
  ok("§1 hours this year are this year's shifts only (5.75)", vera.hundredthsThisYear === 575, vera.hundredthsThisYear);
  ok("§1 the last shift is the latest one", vera.lastShift === `${year}-02-11`, vera.lastShift);
  ok("§1 Vera does not give", vera.alsoGives === false);
  ok("§1 Bea gives, and the roster says so", (rows.find(r => r.id === "c_both") || {}).alsoGives === true);
  ok("§1 the roster carries its sentence", typeof roster.body?.sentence === "string" && roster.body.sentence.length > 10);

  // ── §2 NOT A DONOR UNTIL THEY GIVE ───────────────────────────────────────
  const list = await api("GET", "/donors?role=donor&limit=200", tok);
  const listIds = ((list.body && list.body.donors) || []).map(d => d.id);
  ok("§2 a volunteer who has not given is not in the Donors list", !listIds.includes("c_vol"), listIds.join());
  ok("§2 a volunteer who gave is", listIds.includes("c_both"));
  ok("§2 a donor is", listIds.includes("c_don"));
  ok("§2 staff are not", !listIds.includes("c_staff"));
  ok("§2 the count is people with the donor role", list.body && list.body.total === 2, list.body && list.body.total);

  // ── §3 ROSTER HOURS == THE PERSON'S RECORD ───────────────────────────────
  for (const id of ["c_vol", "c_both"]) {
    const rec = await api("GET", `/donors/${id}/volunteer-hours`, tok);
    const r = rows.find(x => x.id === id) || {};
    ok(`§3 ${id}: roster hundredths equal the record's, as integers`,
      Number.isInteger(r.hundredths) && r.hundredths === rec.body.hundredths, `${r.hundredths} vs ${rec.body.hundredths}`);
  }
  ok("§3 Vera's lifetime is exactly 9.75 hours", vera.hundredths === 975, vera.hundredths);

  // ── §4 INTERNAL NOTES STAY INTERNAL ──────────────────────────────────────
  const [{ n: intBefore }] = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1`, [ORG]);
  const add = await api("POST", "/volunteer-hub/notes", tok, { personId: "c_both", kind: "background_check", body: MARK, noteDate: `${year}-03-05` });
  ok("§4 a note is written", add.status === 201 && add.body && add.body.id, add.status);
  const bad = await api("POST", "/volunteer-hub/notes", tok, { personId: "c_both", kind: "gossip", body: "x" });
  ok("§4 an unknown kind is refused", bad.status === 400);
  const notDonorVol = await api("POST", "/volunteer-hub/notes", tok, { personId: "c_don", kind: "training", body: "x" });
  ok("§4 a note on somebody who is not a volunteer is refused", notDonorVol.status === 400, notDonorVol.status);
  const notes = await api("GET", "/volunteer-hub/notes?personId=c_both", tok);
  ok("§4 the note is on the hub", ((notes.body && notes.body.notes) || []).some(n => n.body === MARK));
  ok("§4 the note carries who wrote it", ((notes.body && notes.body.notes) || []).some(n => n.created_by_name === "Cora Coordinator"));
  const [{ n: intAfter }] = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1`, [ORG]);
  ok("§4 the interactions table did not move", intBefore === intAfter, `${intBefore} → ${intAfter}`);
  const [{ n: inInt }] = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND note ILIKE '%Zephyrine%'`, [ORG]);
  ok("§4 no interaction row carries the note", inInt === 0);
  const rec = await api("GET", "/donors/c_both", tok);
  ok("§4 the donor record (and its timeline) never carries it", (await leaks(rec.body, [{ raw: "Zephyrine" }])).length === 0);
  const drift = await api("GET", "/drift?includeMedium=1", tok);
  ok("§4 Drift never carries it", drift.status === 200 && (await leaks(drift.body, [{ raw: "Zephyrine" }])).length === 0);
  const del = await api("POST", "/volunteer-hub/notes/delete", tok, { id: add.body && add.body.id });
  ok("§4 a note can be removed", del.status === 200);

  // ── §5 VOLUNTEERS WHO GIVE ───────────────────────────────────────────────
  const givers = await api("GET", "/volunteer-hub/givers", tok);
  const gids = ((givers.body && givers.body.people) || []).map(p => p.id);
  ok("§5 the conversion list is exactly the volunteers who give", gids.join() === "c_both", gids.join());
  ok("§5 each row carries lifetime giving", ((givers.body && givers.body.people) || [])[0]?.lifetimeGiving === 60);

  // ── §6 TENANT WALL ───────────────────────────────────────────────────────
  const r2 = await api("GET", "/volunteer-hub/roster", tok2);
  ok("§6 org B's roster is org B's only", ((r2.body && r2.body.people) || []).map(p => p.id).join() === "c_x");
  const cross = await api("POST", "/volunteer-hub/notes", tok2, { personId: "c_vol", kind: "training", body: "x" });
  ok("§6 org B cannot note org A's volunteer", cross.status === 404, cross.status);
  const crossRead = await api("GET", "/volunteer-hub/notes?personId=c_both", tok2);
  ok("§6 org B cannot read org A's notes", crossRead.status === 404, crossRead.status);

  // ── §7 THE HUB IS IN THE NAV ─────────────────────────────────────────────
  const app = readSource("client/src/App.jsx");
  ok("§7 the hub component exists", fs.existsSync(path.join(root, "client/src/components/VolunteersHub.jsx")));
  ok("§7 Volunteers is a live tab", /\{id:"volunteers",label:"Volunteers"/.test(app.split("const BOTTOM_TABS")[0].split("// DEPRIORITIZED")[0]));
  ok("§7 ...on the desktop rail", /const PRIMARY_NAV=\[[^\]]*"volunteers"/.test(app) || /const MORE_NAV=\[[^\]]*"volunteers"/.test(app));
  const moreTabs = (app.split("const MORE_TABS")[1] || "").split("// DEPRIORITIZED")[0];
  ok("§7 ...and in the mobile More drawer", /\{id:"volunteers"/.test(moreTabs));
  ok("§7 the tab renders the new hub, not the old Volunteers.jsx", /tab==="volunteers"&&<VolunteersHub/.test(app));

  // ── §8 THE SIGN-UP LINK ──────────────────────────────────────────────────
  // One signed link per org. A GET renders and writes nothing; a POST puts the
  // person on the roster — on the record their email already has, if any.
  const BASE = process.env.BASE || "http://localhost:5601";
  const count = async () => (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG]))[0].n;
  const link = await api("GET", "/volunteer-hub/signup-link", tok);
  const token = link.body && link.body.url ? new URL(link.body.url).searchParams.get("token") : "";
  ok("§8 staff get the org's sign-up link, with its sentence", link.status === 200 && /\/volunteer\/join\?token=/.test(link.body.url) && /does not send/.test(link.body.sentence || ""), link.body);
  const before = await count();
  const page = await fetch(`${BASE}/volunteer/join?token=${encodeURIComponent(token)}`);
  const html = await page.text();
  ok("§8 the page renders with the org's name", page.status === 200 && /Hayloft Riding/.test(html));
  ok("§8 ...and a GET wrote nothing", (await count()) === before);
  const forged = Buffer.from(OTHER).toString("base64url") + "." + token.split(".")[1];
  ok("§8 the link cannot be pointed at another org", (await fetch(`${BASE}/volunteer/join?token=${encodeURIComponent(forged)}`)).status === 404);
  const post = body => fetch(`${BASE}/volunteer/join`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token, ...body }).toString() });
  const [{ n: intBefore8 }] = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1`, [ORG]);
  const joined = await post({ name: "Nell Newcomer", email: "nell@example.org", availability: "Quillfeather Saturdays only" });
  const [nell] = await q(`SELECT id, person_types, created_by FROM donors WHERE org_id=$1 AND email='nell@example.org'`, [ORG]);
  ok("§8 a new person joins as a Volunteer, stamped with the link as the actor",
    joined.status === 200 && nell && JSON.stringify(nell.person_types) === '["volunteer"]' && nell.created_by === "system:volunteer-signup", nell);
  const roster8 = await api("GET", "/volunteer-hub/roster", tok);
  ok("§8 ...and is on the roster that moment", ((roster8.body && roster8.body.people) || []).some(p => p.email === "nell@example.org"));
  const [{ n: availNotes }] = await q(`SELECT COUNT(*)::int AS n FROM volunteer_notes WHERE org_id=$1 AND kind='availability' AND body ILIKE '%Quillfeather%'`, [ORG]);
  const [{ n: intAfter8 }] = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1`, [ORG]);
  ok("§8 what they said about availability is an internal note, not an interaction", availNotes === 1 && intAfter8 === intBefore8, `${availNotes} ${intBefore8}→${intAfter8}`);
  const n0 = await count();
  await post({ name: "Daniel D.", email: "C_DON@example.org" });
  const [dan] = await q(`SELECT name, person_types FROM donors WHERE id='c_don'`);
  ok("§8 an email already on a record adds the role to THAT record — no second person",
    (await count()) === n0 && dan.person_types.includes("volunteer") && dan.person_types.includes("donor") && dan.name === "Dan Donor", dan);
  const n1 = await count();
  await post({ name: "Bot", email: "bot@example.org", website: "http://spam.example" });
  ok("§8 the honeypot writes nothing", (await count()) === n1);

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });

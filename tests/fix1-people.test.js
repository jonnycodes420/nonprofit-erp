// FIX-1 D — PEOPLE, WITHOUT THE LECTURE.
//
// The data model does not move: one person, one record, even when they are two
// things. What changes is the screen, and the rules the screen now leans on:
//
//   §1  DONORS SHOWS DONORS. The Directory asks for `role=donor`, and its count
//       equals the people who carry the donor role — a volunteer who has never
//       given is not on it, a volunteer who gives is.
//   §2  ROLES ARE CHIPS, AND A CHIP IS ONE WRITE. PUT /people/:id/roles turns a
//       role on or off. Tagging a donor as a Volunteer puts them on the
//       volunteer roster (GET /people?role=volunteer) that moment, with no
//       second record.
//   §3  DONOR IS SET BY GIVING. Removing it from somebody with gifts is REFUSED
//       server-side with the reason — from the chip route AND from the older
//       PUT /donors/:id personTypes path, because a guard with a side door is
//       not a guard.
//   §4  STAFF AND BOARD are a list (GET /people?role=staff_board) for Settings.
//   §5  SEARCH FINDS ANYONE, whatever their role, and says what they are.
//   §6  NO LECTURE: the "Everyone is on one list" paragraph is in no client file.
//   §7  ANOTHER ORG TOUCHES NONE OF IT.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const fs = require("fs"), path = require("path");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_fx1d", OTHER = "org_fx1d2";
const PW = "loadtest1234";
const root = path.join(__dirname, "..");

async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of ["volunteer_shifts", "thank_you_drafts", "threads", "tasks", "workflow_runs", "fin_transactions",
                     "interactions", "gifts", "sequence_enrollments", "donors", "fin_audit_log", "users", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const donor = (id, org, name, types, gifts = 0) => q(
  `INSERT INTO donors (id,org_id,name,email,stage,person_types,total_giving,gift_count)
   VALUES ($1,$2,$3,$4,'prospect',$5::jsonb,$6,$7)`,
  [id, org, name, id + "@fx1d.example.org", types === null ? null : JSON.stringify(types), gifts * 50, gifts]);

(async () => {
  console.log("fix1-people");
  await reset();
  for (const [id, name] of [[ORG, "Barn Helpers"], [OTHER, "Somebody Else"]])
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,receipt_address) VALUES ($1,$2,$3,1,'team','active','1 Main St, Lexington, KY 40507')`,
      [id, name, id.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx1d',$1,'fx1d@example.org',$2,'Allie Barnett','admin')`, [ORG, bcrypt.hashSync(PW, 4)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx1d2',$1,'fx1d-o@example.org',$2,'Other','admin')`, [OTHER, bcrypt.hashSync(PW, 4)]);

  await donor("fd_dee", ORG, "Dee Donor", ["donor"]);
  await donor("fd_leg", ORG, "Lee Legacy", null);                  // NULL = a legacy row = a donor
  await donor("fd_vol", ORG, "Val Volunteer", ["volunteer"]);
  await donor("fd_both", ORG, "Bo Both", ["donor", "volunteer"]);
  await donor("fd_brd", ORG, "Bea Board", ["staff_board"]);
  await donor("fd_oth", ORG, "Ollie Other", ["other"]);
  await donor("fd_x", OTHER, "Xavier Elsewhere", ["staff_board"]);
  const tok = await login("fx1d@example.org"), tok2 = await login("fx1d-o@example.org");

  // A real gift on Dee, through the one gift path.
  const g = await api("POST", "/donors/fd_dee/gifts", tok, { amount: 75, date: "2026-03-01", idempotencyKey: "fx1d-dee" });
  ok("setup: Dee's gift recorded", g.status === 200 || g.status === 201, g.status);

  // ── §1 DONORS SHOWS DONORS ───────────────────────────────────────────────
  const list = await api("GET", "/donors?limit=200&role=donor", tok);
  const ids = (list.body.donors || []).map(d => d.id).sort();
  ok("§1 role=donor lists the donors, the legacy row, and the volunteer who gives",
    ids.join() === ["fd_both", "fd_dee", "fd_leg"].join(), ids);
  const [truth] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL
                            AND (person_types IS NULL OR person_types @> '["donor"]'::jsonb)`, [ORG]);
  ok("§1 the list's count equals the people carrying the donor role", list.body.total === truth.n, [list.body.total, truth.n]);
  const all = await api("GET", "/donors?limit=200", tok);
  ok("§1 without role, the list is everyone (search and older callers unchanged)", all.body.total === 6, all.body.total);
  const bad = await api("GET", "/donors?limit=200&role=wizard", tok);
  ok("§1 an unknown role is refused, never ignored", bad.status === 400, bad.status);
  const donorsJsx = fs.readFileSync(path.join(root, "client/src/components/Donors.jsx"), "utf8");
  ok("§1 the Directory asks the server for donors only", /qs\.set\("role","donor"\)/.test(donorsJsx));

  // ── §2 ROLES ARE CHIPS ───────────────────────────────────────────────────
  const r1 = await api("PUT", "/people/fd_dee/roles", tok, { role: "volunteer", on: true });
  ok("§2 tagging a donor as Volunteer succeeds", r1.status === 200, r1.body);
  ok("§2 …and the answer carries both roles", JSON.stringify(r1.body.person_types) === JSON.stringify(["donor", "volunteer"]), r1.body.person_types);
  const roster = await api("GET", "/people?role=volunteer", tok);
  const rIds = (roster.body.people || []).map(p => p.id).sort();
  ok("§2 Dee is on the volunteer roster that moment", rIds.includes("fd_dee"), rIds);
  ok("§2 the roster is exactly the volunteers", rIds.join() === ["fd_both", "fd_dee", "fd_vol"].join(), rIds);
  const [cnt] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND LOWER(name)='dee donor'`, [ORG]);
  ok("§2 …on ONE record, never a second row", cnt.n === 1);
  const again = await api("PUT", "/people/fd_dee/roles", tok, { role: "volunteer", on: true });
  ok("§2 turning a role on twice is a no-op", again.status === 200 && again.body.person_types.length === 2);
  const off = await api("PUT", "/people/fd_dee/roles", tok, { role: "volunteer", on: false });
  ok("§2 a role turns off", off.status === 200 && JSON.stringify(off.body.person_types) === '["donor"]', off.body);
  const other = await api("PUT", "/people/fd_dee/roles", tok, { role: "other", on: true });
  ok("§2 'other' is not a role a chip can set", other.status === 400, other.status);
  const volOff = await api("PUT", "/people/fd_vol/roles", tok, { role: "volunteer", on: false });
  ok("§2 a person with nothing left is Other, never nothing", volOff.status === 200 && JSON.stringify(volOff.body.person_types) === '["other"]', volOff.body);
  await api("PUT", "/people/fd_vol/roles", tok, { role: "volunteer", on: true });
  const [valRow] = await q(`SELECT person_types FROM donors WHERE id='fd_vol'`);
  ok("§2 …and turning volunteer back on replaces Other", JSON.stringify(valRow.person_types) === '["volunteer"]', valRow.person_types);

  // ── §3 DONOR IS SET BY GIVING ────────────────────────────────────────────
  const refuse = await api("PUT", "/people/fd_dee/roles", tok, { role: "donor", on: false });
  ok("§3 removing Donor from somebody with gifts is refused", refuse.status === 409 && refuse.body.error === "donor_has_gifts", refuse.body);
  ok("§3 …with the reason, in a sentence", /gift/.test(refuse.body.sentence || "") && /Dee/.test(refuse.body.sentence || ""), refuse.body.sentence);
  const [deeRow] = await q(`SELECT person_types FROM donors WHERE id='fd_dee'`);
  ok("§3 …and nothing changed", (deeRow.person_types || []).includes("donor"));
  const side = await api("PUT", "/donors/fd_dee", tok, { name: "Dee Donor", status: "new", stage: "prospect", personTypes: ["volunteer"] });
  ok("§3 the older PUT /donors/:id path refuses it too", side.status === 409 && side.body.error === "donor_has_gifts", side.status);
  const [deeRow2] = await q(`SELECT person_types, name FROM donors WHERE id='fd_dee'`);
  ok("§3 …before it writes anything", (deeRow2.person_types || []).includes("donor"));
  const noGifts = await api("PUT", "/people/fd_both/roles", tok, { role: "donor", on: false });
  ok("§3 a donor with no gifts on file may stop being one", noGifts.status === 200 && JSON.stringify(noGifts.body.person_types) === '["volunteer"]', noGifts.body);
  const people = await api("GET", "/people?role=volunteer", tok);
  const dee = (people.body.people || []).find(p => p.id === "fd_both");
  ok("§3 the roster says who also gives", dee && dee.gives === false);
  const addD = await api("PUT", "/people/fd_vol/roles", tok, { role: "donor", on: true });
  ok("§3 adding Donor to a prospect is allowed", addD.status === 200 && addD.body.person_types.includes("donor"));
  const peopleWithGiftFlag = await api("GET", "/people/fd_dee", tok);
  ok("§3 a person read says whether Donor can be removed, and why not",
    peopleWithGiftFlag.status === 200 && peopleWithGiftFlag.body.donorLocked === true && /gift/.test(peopleWithGiftFlag.body.donorLockedReason || ""),
    peopleWithGiftFlag.body);

  // ── §4 STAFF AND BOARD ───────────────────────────────────────────────────
  const sb = await api("GET", "/people?role=staff_board", tok);
  ok("§4 the staff and board list", (sb.body.people || []).map(p => p.id).join() === "fd_brd", sb.body);
  const settings = fs.readFileSync(path.join(root, "client/src/components/Settings.jsx"), "utf8");
  ok("§4 Settings → Organization reads it", /\/people\?role=staff_board/.test(settings));

  // ── §5 SEARCH FINDS ANYONE ───────────────────────────────────────────────
  const s = await api("GET", "/donors?search=board&limit=5", tok);
  ok("§5 search finds a board member", (s.body.donors || []).some(d => d.id === "fd_brd"));
  const s2 = await api("GET", "/donors?search=other&limit=5", tok);
  const ollie = (s2.body.donors || []).find(d => d.id === "fd_oth");
  ok("§5 …and anyone else, carrying what they are", ollie && JSON.stringify(ollie.person_types) === '["other"]', ollie);
  const topbar = fs.readFileSync(path.join(root, "client/src/components/TopBar.jsx"), "utf8");
  ok("§5 the search row says what they are", /typeLabels\(/.test(topbar));

  // ── §6 NO LECTURE ────────────────────────────────────────────────────────
  const hit = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.jsx?$/.test(f.name) && fs.readFileSync(p, "utf8").includes("Everyone is on one list")) hit.push(p);
    }
  })(path.join(root, "client", "src"));
  ok("§6 the paragraph appears nowhere in the client", hit.length === 0, hit);

  // ── §7 ANOTHER ORG TOUCHES NONE OF IT ────────────────────────────────────
  const x1 = await api("PUT", "/people/fd_dee/roles", tok2, { role: "staff_board", on: true });
  ok("§7 another org cannot change a role", x1.status === 404, x1.status);
  const x2 = await api("GET", "/people/fd_dee", tok2);
  ok("§7 …or read the person", x2.status === 404);
  const x3 = await api("GET", "/people?role=staff_board", tok2);
  ok("§7 …and its lists hold only its own people", (x3.body.people || []).map(p => p.id).join() === "fd_x", x3.body);
  const [still] = await q(`SELECT person_types FROM donors WHERE id='fd_dee'`);
  ok("§7 …and Dee is untouched", !(still.person_types || []).includes("staff_board"));

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

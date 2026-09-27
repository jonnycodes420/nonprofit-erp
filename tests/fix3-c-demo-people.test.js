// FIX-3 C, finding 8 — NO REAL PERSON IN THE DEMO.
//
// The walk on 27 September found "Jonathan Atkinson $1" in the Harborlight
// demo's thank-you list on prod. Nothing in the repo writes that row (the seed
// invents every name; `git log -S Atkinson` finds only docs and the org_creo
// fixture's "Robert & Lisa Atkinson"). The Reports line on the same org read
// "Online $2 (2)", and the report's online rule is `stripe_payment_id IS NOT
// NULL`, which the seed never set: the row is a real $1 Stripe charge made
// through the demo org's give page after the demo was seeded. So the guard is
// on the DATA, not only on the source:
//
//   "Real", concretely and testably (scripts/lib/demoRealPeople.js):
//     · the founder's identity in the repo: the name Jonathan Atkinson, any
//       xjca2006(+tag)@ address, any @stewardapp.dev address, FOUNDER_EMAIL,
//       and jonathan.atkinson@asbury.edu (NEEDS-JONATHAN.md's duplicate user);
//     · every address on the mail block (mailBlock.js);
//     · every `users` row on the instance, by email, or by full name (two or
//       more words) — this includes the demo org's own users;
//     · a gift carrying a Stripe payment id the seed did not mint (not
//       `pi_demo_…`) — real money, so a real person.
//   A donor, a guest-list row, or a non-seeded user in the demo org that
//   matches any of these fails.
//
//   §1  the rule, pure (and proven able to fail: each real identity is caught)
//   §2  the seed's output on this database holds no such row
//   §3  the seed's remover, run on a FIXTURE org (never the demo), removes the
//       matching rows and only those, and says what it removed
//   §4  the read-only prod check prints the offending rows and exits 1, exits
//       0 on a clean org, and changes nothing
//   §5  the seed calls the remover before it tears down and re-asserts after
//
// No suite logs in to or writes the demo org (tests/fix1-walk.test.js §11):
// §2 is SELECTs only, and §3/§4 run on their own fixture org.

const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const { ok, summary, q, closeDb } = require("./helpers");

const root = path.join(__dirname, "..");
const FX = "org_fx3c_people";

(async () => {
  let lib = null, seed = null;
  try { lib = require("../scripts/lib/demoRealPeople.js"); } catch (e) { lib = { __err: e.message }; }
  try { seed = require("../scripts/seed-demo.js"); } catch (e) { seed = { __err: e.message }; }

  // ── §1 · the rule ─────────────────────────────────────────────────────────
  console.log("— §1 · what counts as a real person —");
  ok("§1 scripts/lib/demoRealPeople.js exports realReason + findRealPeople",
     typeof lib.realReason === "function" && typeof lib.findRealPeople === "function", lib.__err);
  const reason = (row, users = []) => (typeof lib.realReason === "function" ? lib.realReason(row, users) : "no-lib");
  const users = [{ email: "Priya.Staff@SomeOrg.example", name: "Priya  Staffmember" }, { email: "admin@x.example", name: "Admin" }];
  // Each of these is a planted defect the guard must catch.
  const REAL = [
    [{ name: "Jonathan Atkinson", email: "" }, "the founder's name"],
    [{ name: "jonathan  ATKINSON", email: null }, "the founder's name, any case and spacing"],
    [{ name: "J. Donor", email: "xjca2006@gmail.com" }, "the founder's address"],
    [{ name: "J. Donor", email: "XJCA2006+demo@gmail.com" }, "a plus-tagged founder address"],
    [{ name: "J. Donor", email: "jonathan@stewardapp.dev" }, "FOUNDER_EMAIL"],
    [{ name: "J. Donor", email: "support@stewardapp.dev" }, "any stewardapp.dev address"],
    [{ name: "J. Donor", email: "jonathan.atkinson@asbury.edu" }, "the duplicate staff user's address"],
    [{ name: "Allie", email: "Hello@JustinsPlaceKY.com" }, "a mail-blocked address"],
    [{ name: "Someone", email: "priya.staff@someorg.example" }, "a users row, by email"],
    [{ name: "priya staffmember", email: "p@elsewhere.example" }, "a users row, by full name"],
  ];
  for (const [row, why] of REAL) ok(`§1 caught: ${why} (${row.name} <${row.email}>)`, !!reason(row, users), reason(row, users));
  // ...and the invented file is left alone.
  const FICTION = [
    [{ name: "Margaret Chen", email: "margaret.chen@example.demo" }, "the canonical drifted donor"],
    [{ name: "Ondine Cinderhalt", email: "ondine.cinderhalt@example.demo" }, "the failed-card donor"],
    [{ name: "Admin", email: "someone@example.demo" }, "a one-word users name is not a full-name match"],
    [{ name: "Jonathan Ashgrove", email: "jonathan.ashgrove@example.demo" }, "a first name alone is not the founder"],
  ];
  for (const [row, why] of FICTION) ok(`§1 not flagged: ${why}`, reason(row, users) === null, reason(row, users));
  ok("§1 a real Stripe charge marks its donor real; a seed-minted one does not",
     typeof lib.realStripeCharge === "function" && lib.realStripeCharge("pi_3U5UgzAbc") && !lib.realStripeCharge("pi_demo_g_b72_0001") && !lib.realStripeCharge(null));

  // ── §2 · the seed's output ────────────────────────────────────────────────
  console.log("\n— §2 · the seeded demo org holds no real person —");
  const ORG = seed.ORG;
  const [present] = ORG ? await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG]) : [{ n: 0 }];
  ok("§2 the demo is seeded on this database (run-all seeds it before the battery)", present && present.n > 0, seed.__err);
  if (typeof lib.findRealPeople === "function" && ORG) {
    const found = await lib.findRealPeople(q, ORG, { seededUserEmails: seed.SEEDED_USER_EMAILS || [] });
    ok(`§2 no donor, guest or extra user in the demo org matches a real identity (${found.length})`, found.length === 0,
       found.slice(0, 5).map(r => `${r.table} ${r.id} ${r.name} <${r.email}>: ${r.reason}`));
  } else ok("§2 finder available", false);
  // The finder is the same code the prod check runs; prove it sees a row the
  // way it will on prod by pointing it at the fixture below (§3).

  // ── §3 · the seed's remover, on a fixture org ─────────────────────────────
  console.log("\n— §3 · the remover takes the matching rows and only those —");
  const plant = async () => {
    await q(`DELETE FROM thank_you_drafts WHERE org_id=$1`, [FX]).catch(() => {});
    for (const t of ["fin_transactions", "event_attendees", "gifts", "donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [FX]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [FX]).catch(() => {});
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,emails_enabled,is_demo_org)
             VALUES ($1,'Fixture People Org','fx3c-people',1,'active','team',false,true)`, [FX]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx3c_seeded',$1,'seeded@fx3c.example','x','Seeded Person','admin')`, [FX]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx3c_extra',$1,'xjca2006+fx3c@gmail.com','x','Extra Founder','admin')`, [FX]);
    const donors = [
      ["d_fx3c_real", "Jonathan Atkinson", "xjca2006@gmail.com"],     // the finding itself
      ["d_fx3c_card", "Pat Cardholder", "pat.cardholder@fx3c.example"], // a real Stripe charge
      ["d_fx3c_keep", "Marguerite Ashgrove", "m.ashgrove@example.demo"], // fiction: stays
    ];
    for (const [id, name, email] of donors)
      await q(`INSERT INTO donors (id,org_id,name,email,status,stage,created_by,created_by_name) VALUES ($1,$2,$3,$4,'new','steward','system:fx3c','fixture')`, [id, FX, name, email]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,stripe_payment_id,payment_method) VALUES ('g_fx3c_real',$1,'d_fx3c_real',1,'2026-09-20','cash','pi_fx3cRealOne','Card')`, [FX]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,stripe_payment_id,payment_method) VALUES ('g_fx3c_card',$1,'d_fx3c_card',1,'2026-09-21','cash','pi_fx3cRealTwo','Card')`, [FX]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,stripe_payment_id,payment_method) VALUES ('g_fx3c_keep',$1,'d_fx3c_keep',250,'2026-09-22','cash','pi_demo_g_fx3c_keep','Card')`, [FX]);
    await q(`INSERT INTO thank_you_drafts (id,org_id,donor_id,gift_id,body) VALUES ('ty_fx3c_real',$1,'d_fx3c_real','g_fx3c_real','Dear Jonathan, thank you.')`, [FX]);
    await q(`INSERT INTO fin_transactions (id,org_id,date,description,amount,type,donor_id,source,gift_id) VALUES ('ft_fx3c_real',$1,'2026-09-20','Online gift',1,'income','d_fx3c_real','online','g_fx3c_real')`, [FX]);
  };
  await plant();
  const opts = { seededUserEmails: ["seeded@fx3c.example"] };
  if (typeof lib.findRealPeople === "function") {
    const found = await lib.findRealPeople(q, FX, opts);
    const ids = found.map(r => r.id).sort();
    ok("§3 the finder sees the founder donor, the real-card donor and the extra user — and not the fiction",
       JSON.stringify(ids) === JSON.stringify(["d_fx3c_card", "d_fx3c_real", "u_fx3c_extra"]), found.map(r => [r.id, r.reason]));
  } else ok("§3 finder available", false);

  ok("§3 scripts/seed-demo.js exports removeRealPeople", typeof seed.removeRealPeople === "function", seed.__err);
  if (typeof seed.removeRealPeople === "function") {
    const lines = [];
    const removed = await seed.removeRealPeople(q, FX, { ...opts, log: s => lines.push(s) });
    const left = await q(`SELECT id FROM donors WHERE org_id=$1 ORDER BY id`, [FX]);
    ok("§3 the matching donors are gone, the invented donor stays", JSON.stringify(left.map(r => r.id)) === JSON.stringify(["d_fx3c_keep"]), left);
    const gifts = await q(`SELECT id FROM gifts WHERE org_id=$1 ORDER BY id`, [FX]);
    ok("§3 ...with their gifts (the invented donor's gift stays)", JSON.stringify(gifts.map(r => r.id)) === JSON.stringify(["g_fx3c_keep"]), gifts);
    const [ty] = await q(`SELECT COUNT(*)::int n FROM thank_you_drafts WHERE org_id=$1`, [FX]);
    const [ft] = await q(`SELECT COUNT(*)::int n FROM fin_transactions WHERE org_id=$1`, [FX]);
    ok("§3 ...and their thank-you draft and ledger line", ty.n === 0 && ft.n === 0, { ty: ty.n, ft: ft.n });
    const us = await q(`SELECT id FROM users WHERE org_id=$1 ORDER BY id`, [FX]);
    ok("§3 the extra real user is removed; the seeded user stays", JSON.stringify(us.map(r => r.id)) === JSON.stringify(["u_fx3c_seeded"]), us);
    ok("§3 the remover returns what it removed", Array.isArray(removed) && removed.length === 3, removed);
    const printed = lines.join("\n");
    ok("§3 ...and PRINTS each removed row by name, address and reason",
       /Jonathan Atkinson/.test(printed) && /xjca2006@gmail\.com/.test(printed) && /Pat Cardholder/.test(printed) && /xjca2006\+fx3c@gmail\.com/.test(printed), printed);
    const again = [];
    const none = await seed.removeRealPeople(q, FX, { ...opts, log: s => again.push(s) });
    ok("§3 a second run finds nothing and says so", Array.isArray(none) && none.length === 0 && /no real/i.test(again.join(" ")), again);
  }

  // ── §4 · the read-only prod check ────────────────────────────────────────
  console.log("\n— §4 · the prod check prints the rows, exits 1, and writes nothing —");
  const script = path.join(root, "scripts", "demo-real-people-check.js");
  ok("§4 scripts/demo-real-people-check.js exists", fs.existsSync(script));
  if (fs.existsSync(script)) {
    await plant();
    const before = await q(`SELECT (SELECT COUNT(*) FROM donors WHERE org_id=$1)::int d, (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int g, (SELECT COUNT(*) FROM users WHERE org_id=$1)::int u`, [FX]);
    const run = env => { try { return { code: 0, out: execFileSync("node", [script], { env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
                         catch (e) { return { code: e.status, out: String(e.stdout || "") + String(e.stderr || "") }; } };
    const dirty = run({ DEMO_ORG: FX, DEMO_SEEDED_USERS: "seeded@fx3c.example" });
    ok("§4 on a dirty org it exits 1", dirty.code === 1, dirty.code);
    ok("§4 ...printing each offending row with its reason", /Jonathan Atkinson/.test(dirty.out) && /xjca2006@gmail\.com/.test(dirty.out) && /Pat Cardholder/.test(dirty.out) && /Extra Founder/.test(dirty.out), dirty.out.slice(-1500));
    ok("§4 ...and the real charge behind it (the Stripe id and the date)", /pi_fx3cRealOne/.test(dirty.out) && /2026-09-20/.test(dirty.out), dirty.out.slice(-1500));
    const after = await q(`SELECT (SELECT COUNT(*) FROM donors WHERE org_id=$1)::int d, (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int g, (SELECT COUNT(*) FROM users WHERE org_id=$1)::int u`, [FX]);
    ok("§4 it wrote nothing (row counts unchanged)", JSON.stringify(before) === JSON.stringify(after), { before, after });
    await seed.removeRealPeople?.(q, FX, { ...opts, log: () => {} });
    const clean = run({ DEMO_ORG: FX, DEMO_SEEDED_USERS: "seeded@fx3c.example" });
    ok("§4 on a clean org it exits 0 and says so", clean.code === 0 && /no real/i.test(clean.out), clean.out.slice(-600));
    const src = fs.readFileSync(script, "utf8");
    ok("§4 it opens a READ ONLY transaction", /BEGIN READ ONLY/.test(src));
    ok("§4 a remote DATABASE_URL needs --i-know-this-is-prod", /--i-know-this-is-prod/.test(src) && /assertServerIdentity/.test(src));
    const guards = fs.readFileSync(path.join(root, "tests", "script-guards.test.js"), "utf8");
    const ro = guards.slice(guards.indexOf("const PROD_READONLY"), guards.indexOf("const LOOPBACK_CAPTURES"));
    ok("§4 it is classified PROD_READONLY in tests/script-guards.test.js", /"demo-real-people-check"/.test(ro));
  }

  // ── §5 · the seed uses both ───────────────────────────────────────────────
  console.log("\n— §5 · the seed removes before it tears down, and re-asserts after —");
  const seedSrc = fs.readFileSync(path.join(root, "scripts", "seed-demo.js"), "utf8");
  const iRemove = seedSrc.indexOf("await removeRealPeople(q, ORG");
  const iTeardown = seedSrc.indexOf("[teardown]");
  ok("§5 main() calls removeRealPeople on the demo org before the teardown", iRemove > 0 && iRemove < iTeardown, { iRemove, iTeardown });
  ok("§5 ...and fails the seed if the finished org still holds a real person",
     /findRealPeople\(q, ORG[^)]*\)[\s\S]{0,400}process\.exit\(1\)/.test(seedSrc));

  // cleanup
  await q(`DELETE FROM thank_you_drafts WHERE org_id=$1`, [FX]).catch(() => {});
  for (const t of ["fin_transactions", "event_attendees", "gifts", "donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [FX]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [FX]).catch(() => {});
  await closeDb();
  summary();
})().catch(async e => { console.error("SUITE ERROR:", e); await closeDb().catch(() => {}); process.exit(1); });

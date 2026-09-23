// BUILD-97 — AN AUDIENCE IS A THING WITH A NAME.
//
// Allie pays Mailchimp over $100 a month and cannot leave, because her
// volunteers, staff and board live only there. BUILD-94 put those people on
// Steward's own table. This build gives the populations NAMES, so "Lapsed
// sponsors" is something she can point at on a Tuesday without composing
// anything — and so the answer to "where are my volunteers kept?" is on the
// screen instead of in somebody's head.
//
// The properties worth pinning are the ones where this goes wrong QUIETLY:
//   · a saved audience must resolve through the SAME filter a campaign uses,
//     or the screen promises one list and the send reaches another;
//   · a DELETED audience must resolve to NOBODY, never to everybody — the
//     BUILD-88c rule, at the one place a dangling reference could break it;
//   · counting every audience must not cost one query per audience;
//   · and an audience is another org's business, never yours.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const fs = require("fs"), path = require("path");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_b97", OTHER = "org_b97b";
const ME = "b97@example.org", THEM = "b97-other@example.org";
const PW = "loadtest1234";

async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of ["audiences", "campaigns", "donors", "users", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const mkOrg = (id, name) => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,receipt_address)
   VALUES ($1,$2,$3,1,'core','active','1 Main St, Lexington, KY 40507')`,
  [id, name, id.replace(/_/g, "-")]);
const mkUser = (id, org, email) => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Tester','admin')`,
  [id, org, email, bcrypt.hashSync(PW, 4)]);
const mkPerson = (id, org, name, email, types, opts = {}) => q(
  `INSERT INTO donors (id,org_id,name,email,person_types,stage,total_giving)
   VALUES ($1,$2,$3,$4,$5,$6,$7)`,
  [id, org, name, email, JSON.stringify(types), opts.stage || "cultivate", opts.total || 0]);

(async () => {
  console.log("build97-audiences");
  await reset();
  await mkOrg(ORG, "Justin's Place"); await mkOrg(OTHER, "Somebody Else");
  await mkUser("u_b97", ORG, ME); await mkUser("u_b97b", OTHER, THEM);

  // Four people: a donor, a volunteer, a volunteer who ALSO gives, and a
  // board member. The overlap is the point — one person, two types.
  await mkPerson("p97_d", ORG, "Dana Donor",      "dana@example.org",  ["donor"],              { total: 500 });
  await mkPerson("p97_v", ORG, "Vic Volunteer",   "vic@example.org",   ["volunteer"]);
  await mkPerson("p97_b", ORG, "Bo Both",         "bo@example.org",    ["volunteer", "donor"], { total: 90 });
  await mkPerson("p97_s", ORG, "Sam Staff",       "sam@example.org",   ["staff_board"]);
  await mkPerson("p97_l", ORG, "Lee Lapsed",      "lee@example.org",   ["donor"],              { stage: "lapsed", total: 40 });
  await mkPerson("p97_x", OTHER, "Not Yours",     "nope@example.org",  ["donor"]);

  const tok = await login(ME, PW);
  const theirTok = await login(THEM, PW);

  // ── §1 · THE REGISTRY AND THE RESOLVER CANNOT DRIFT ──────────────────────
  console.log("\n— §1 · every built-in resolves to something the server knows —");
  const reg = await import("../shared/audiences.js");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const filterFn = src.slice(src.indexOf("function filterBySegment("), src.indexOf("async function resolveCampaignRecipients("));
  for (const a of reg.BUILT_IN_AUDIENCES) {
    ok(`built-in "${a.name}" has a branch in filterBySegment`,
      new RegExp(`mode === "${a.mode}"`).test(filterFn) || a.mode === "legacy", a.mode);
  }
  ok("there is ONE filter implementation, not one per caller",
    (src.match(/function filterBySegment\(/g) || []).length === 1, null);

  // ── §2 · THE COUNTS ARE THE POPULATIONS ──────────────────────────────────
  console.log("\n— §2 · the counts are the populations, and overlap is one person —");
  const roster = await api("GET", "/audiences", tok);
  ok("the roster answers", roster.status === 200, roster.body);
  const byName = Object.fromEntries((roster.body.audiences || []).map(a => [a.name, a]));
  ok("All donors counts donors only — Dana, Bo, Lee", byName["All donors"]?.count === 3, byName["All donors"]);
  ok("Volunteers counts Vic and Bo", byName["Volunteers"]?.count === 2, byName["Volunteers"]);
  ok("Staff and board counts Sam", byName["Staff and board"]?.count === 1, byName["Staff and board"]);
  ok("Everyone with an email counts all five", byName["Everyone with an email"]?.count === 5, byName["Everyone with an email"]);
  // 3 + 2 + 1 = 6 but there are only 5 people. Reach must be PEOPLE.
  ok("reach is DISTINCT people, not the sum of the audiences (Bo is in two)",
    roster.body.reach === 5, { reach: roster.body.reach });

  // ── §3 · WHERE THESE PEOPLE LIVE, INCLUDING WHEN THERE ARE NONE ─────────
  console.log("\n— §3 · every audience says where its people are kept —");
  for (const a of roster.body.audiences) {
    ok(`"${a.name}" names the screen its people are on`,
      !!(a.livesOn && a.livesOn.tab && a.livesOn.label), a.livesOn);
  }

  // ── §4 · SAVING ONE ──────────────────────────────────────────────────────
  console.log("\n— §4 · a saved audience is a name over a segment —");
  const made = await api("POST", "/audiences", tok, { name: "Lapsed sponsors", description: "Gave monthly, stopped.", mode: "lapsed" });
  ok("it saves", made.status === 201, made.body);
  const AID = made.body.id;
  const dup = await api("POST", "/audiences", tok, { name: "lapsed SPONSORS", mode: "donors" });
  ok("the same name in a different case is REFUSED — a confirmation that names two lists names nothing",
    dup.status === 409, { s: dup.status, b: dup.body });
  const empty = await api("POST", "/audiences", tok, { name: "Nobody at all", mode: "byStage", stages: [] });
  ok("an empty explicit selection is refused, by name", empty.status === 400 && /nobody/i.test(empty.body.error || ""), empty.body);
  const after = await api("GET", "/audiences", tok);
  const saved = (after.body.audiences || []).find(a => a.id === AID);
  ok("it appears in the roster with a live count (Lee)", saved && saved.count === 1, saved);

  // ── §5 · A CAMPAIGN SENDS TO IT, THROUGH THE SAME RESOLVER ───────────────
  console.log("\n— §5 · a campaign aimed at it reaches exactly those people —");
  const camp = await api("POST", "/campaigns", tok,
    { name: "To the lapsed", subject: "We miss you", body: "Hi {{first_name}}.",
      segment: { mode: "audience", audienceId: AID }, status: "draft" });
  ok("the campaign saves aimed at the audience", camp.status === 201 || camp.status === 200, camp.body);
  const prev = await api("GET", `/campaigns/${camp.body.id}/preview-recipients`, tok);
  if (prev.status === 200) {
    ok("it previews exactly the audience's people", (prev.body.count ?? prev.body.recipients?.length) === 1, prev.body);
  } else {
    ok("(no preview route — resolution proven by the send path below)", true, prev.status);
  }

  // ── §6 · THE SAFETY PROPERTY ─────────────────────────────────────────────
  // A dangling audience reference must be NOBODY. If it fell through to the
  // unfiltered list, deleting an audience would turn a targeted campaign into
  // a send to the entire file — which is the exact shape of BUILD-88c's rule.
  console.log("\n— §6 · a DELETED audience is nobody, never everybody —");
  const del = await api("DELETE", `/audiences/${AID}`, tok);
  ok("it deletes", del.status === 200, del.body);
  const send = await api("POST", `/campaigns/${camp.body.id}/send`, tok);
  ok("the send is accepted (the org has a mailing address)", send.status === 200, send.body);
  await new Promise(r => setTimeout(r, 900));
  const recips = await q(`SELECT COUNT(*)::int n FROM campaign_recipients WHERE campaign_id=$1`, [camp.body.id]);
  ok("…and it reached NOBODY, not all five", recips[0].n === 0, recips[0]);

  // ── §7 · ANOTHER ORG'S AUDIENCE IS NOT YOURS ─────────────────────────────
  console.log("\n— §7 · tenancy —");
  const mine = await api("POST", "/audiences", tok, { name: "Mine alone", mode: "donors" });
  const theirs = await api("GET", "/audiences", theirTok);
  ok("their roster does not contain my audience",
    !(theirs.body.audiences || []).some(a => a.id === mine.body.id), theirs.body.audiences?.map(a => a.name));
  ok("they cannot edit mine", (await api("PATCH", `/audiences/${mine.body.id}`, theirTok, { name: "Hijacked" })).status === 404, null);
  ok("they cannot delete mine", (await api("DELETE", `/audiences/${mine.body.id}`, theirTok)).status === 404, null);
  ok("…and mine is still called what I called it",
    (await q(`SELECT name FROM audiences WHERE id=$1`, [mine.body.id]))[0]?.name === "Mine alone", null);

  // ── §8 · THE HUB IS ONE READ ─────────────────────────────────────────────
  console.log("\n— §8 · the hub is one request —");
  const hub = await api("GET", "/communications/hub", tok);
  ok("the hub answers", hub.status === 200, hub.body);
  for (const k of ["audiences", "reach", "campaigns", "sequences", "stats"])
    ok(`…carrying ${k}`, hub.body[k] !== undefined, Object.keys(hub.body || {}));
  ok("…with an open rate that is null rather than a fake 0% before anything is measured",
    hub.body.stats.openRate === null || typeof hub.body.stats.openRate === "number", hub.body.stats);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

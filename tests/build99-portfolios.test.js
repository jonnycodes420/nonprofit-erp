// BUILD-99 (major gifts) Part 2 — PORTFOLIOS.
//
// A portfolio is not a new membership concept — BUILD-30 settled that and it
// cost a build. So the assertions below are about the three things that WERE
// missing, plus one that makes sure nothing was forked:
//   §1  the pure rules: the order, the phrases, and the two numbers that stay
//       ABSENT when she has not typed them;
//   §2  assigning writes the owner WITH AN ACTOR — and the name comes off the
//       users row, not off the payload;
//   §3  the portfolio row count IS the assignment count, by the shared
//       definition, on every surface that reads it;
//   §4  at equal proposal size, ninety days of silence sorts above yesterday;
//   §5  the target and the cap are hers, and the sentence says so when unset;
//   §6  unassigned major prospects are the ORG's threshold, never Steward's;
//   §7  org A can read none of org B's portfolio, and a staff member is
//       DOWNGRADED to their own rather than shown somebody else's.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "b99_pf", OTHER = "b99_pf2";
const ADMIN = "b99pf@example.org", STAFF = "b99pf-staff@example.org", THEM = "b99pf-other@example.org";
const PW = "loadtest1234";

const CHILD = ["portfolio_targets", "pledge_installments", "fin_transactions", "interactions", "threads",
  "tasks", "opportunities", "moves", "gifts", "pledges", "donors", "households", "users",
  "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const mkOrg = id => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at)
   VALUES ($1,$1,$2,1,'team','active','America/New_York',NOW())
   ON CONFLICT (id) DO UPDATE SET plan='team', subscription_status='active'`, [id, id.replace(/_/g, "-")]);
const mkUser = (id, org, email, name, role = "admin") => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`,
  [id, org, email, bcrypt.hashSync(PW, 4), name, role]);
const mkDonor = (id, org, name, x = {}) => q(
  `INSERT INTO donors (id,org_id,name,email,kind,stage,total_giving,gift_count,assigned_to,assigned_to_name)
   VALUES ($1,$2,$3,$4,'person',$5,$6,$7,$8,$9)`,
  [id, org, name, id + "@example.org", x.stage || "cultivate", x.lifetime || 0, x.giftCount || 0,
   x.officerId || null, x.officerName || null]);
const cents = v => Math.round(Number(v) * 100);
// A civil date N days before today, on the org's own calendar (the suite's
// fixture org is America/New_York and the server reads the same seam).
const daysAgo = n => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const logConv = (id, org, donorId, dayOffset) => q(
  `INSERT INTO interactions (id,org_id,donor_id,type,date,note,logged_by_name)
   VALUES ($1,$2,$3,'meeting',$4,'Sat down about the campaign','Allie Barnett')`,
  [id, org, donorId, daysAgo(dayOffset)]);

(async () => {
  console.log("build99-portfolios");
  await reset();
  await mkOrg(ORG); await mkOrg(OTHER);
  await mkUser("u_b99pf_a", ORG, ADMIN, "Allie Barnett", "admin");
  await mkUser("u_b99pf_s", ORG, STAFF, "Dana Officer", "staff");
  await mkUser("u_b99pf_o", OTHER, THEM, "Not Allie", "admin");
  await q(`INSERT INTO fin_funds (id,org_id,name) VALUES ('f_b99pf',$1,'Capital campaign')`, [ORG]);

  // Two people on Allie's list with the SAME open ask, and very different
  // silences — §4's whole point.
  await mkDonor("dp_quiet", ORG, "Quiet Quentin", { lifetime: 9000, giftCount: 5, officerId: "u_b99pf_a", officerName: "Allie Barnett" });
  await mkDonor("dp_recent", ORG, "Recent Rita", { lifetime: 9000, giftCount: 5, officerId: "u_b99pf_a", officerName: "Allie Barnett" });
  await mkDonor("dp_never", ORG, "Never Spoken Nell", { lifetime: 500, giftCount: 1, officerId: "u_b99pf_a", officerName: "Allie Barnett" });
  await mkDonor("dp_big", ORG, "Big Ask Bea", { lifetime: 40000, giftCount: 8, officerId: "u_b99pf_a", officerName: "Allie Barnett" });
  // Unassigned, one over the threshold and one under it.
  await mkDonor("dp_rich", ORG, "Unowned Ulysses", { lifetime: 25000, giftCount: 6 });
  await mkDonor("dp_small", ORG, "Small Sam", { lifetime: 200, giftCount: 2 });
  await mkDonor("dp_dana", ORG, "Dana's Person", { lifetime: 3000, giftCount: 3, officerId: "u_b99pf_s", officerName: "Dana Officer" });
  await mkDonor("dp_other", OTHER, "Not Yours", { lifetime: 99999, giftCount: 9 });
  await logConv("ip_q", ORG, "dp_quiet", 120);
  await logConv("ip_r", ORG, "dp_recent", 1);
  await logConv("ip_b", ORG, "dp_big", 40);
  const tok = await login(ADMIN), stok = await login(STAFF), tok2 = await login(THEM);

  const PF = await import("../shared/portfolioShape.js");

  // ── §1 · THE PURE RULES ─────────────────────────────────────────────────
  console.log("\n— §1 · the order, the phrases, and the numbers that stay absent —");
  const ranked = PF.rankPortfolio([
    { donorId: "a", name: "A", openAskCents: 500000, daysSinceContact: 1 },
    { donorId: "b", name: "B", openAskCents: 500000, daysSinceContact: 90 },
    { donorId: "c", name: "C", openAskCents: 900000, daysSinceContact: 300 },
    { donorId: "d", name: "D", openAskCents: 500000, daysSinceContact: null },
  ]);
  ok("§1 the biggest open ask leads", ranked[0].donorId === "c");
  ok("§1 at equal ask, NEVER SPOKEN comes before ninety days of silence", ranked[1].donorId === "d", ranked.map(r => r.donorId));
  ok("§1 …then the long silence, then yesterday", ranked[2].donorId === "b" && ranked[3].donorId === "a", ranked.map(r => r.donorId));
  ok("§1 'never' is not treated as zero days", PF.rankPortfolio([
    { donorId: "x", name: "X", openAskCents: 0, daysSinceContact: 0 },
    { donorId: "y", name: "Y", openAskCents: 0, daysSinceContact: null },
  ])[0].donorId === "y");
  ok("§1 no conversation says so out loud", PF.contactPhrase(null) === "No conversation logged yet");
  ok("§1 today and yesterday read as words", PF.contactPhrase(0) === "Spoke today" && PF.contactPhrase(1) === "Spoke yesterday");
  ok("§1 a long gap reads in months, not a day count", /months ago/.test(PF.contactPhrase(120)), PF.contactPhrase(120));
  ok("§1 ninety days is quiet, and so is never", PF.isQuiet(90) && PF.isQuiet(null) && !PF.isQuiet(89));
  const fm = c => "$" + Math.round(c / 100).toLocaleString("en-US");
  const noTarget = PF.targetProgress({ targetCents: null, committedCents: 500000, fiscalLabel: "FY 2026–27" });
  ok("§1 an unset target is ABSENT, never a percentage of nothing", noTarget.set === false && noTarget.percent === null);
  ok("§1 …and the sentence says she has not typed one",
     /No target set for FY 2026–27/.test(PF.targetSentence(noTarget, fm)), PF.targetSentence(noTarget, fm));
  const met = PF.targetProgress({ targetCents: 1000000, committedCents: 1200000, fiscalLabel: "FY 2026–27" });
  ok("§1 a beaten target reads as a win, not a capped 100%", met.rawPercent === 120 && met.percent === 100 && met.overCents === 200000);
  ok("§1 …and the sentence names the overage", /\$2,000 over/.test(PF.targetSentence(met, fm)), PF.targetSentence(met, fm));
  ok("§1 the target sentence says the target is HERS",
     /the one you typed/.test(PF.targetSentence(PF.targetProgress({ targetCents: 1000000, committedCents: 400000, fiscalLabel: "FY 2026–27" }), fm)));
  const cap = PF.capState({ capCount: 3, actualCount: 5 });
  ok("§1 a cap that has been passed says so and blocks nothing",
     cap.over === 2 && /Nothing is blocked/.test(PF.capSentence(cap)), PF.capSentence(cap));
  ok("§1 no cap set says that rather than inventing one",
     /No cap set/.test(PF.capSentence(PF.capState({ capCount: null, actualCount: 5 }))));
  ok("§1 the unassigned sentence QUOTES the org's own threshold",
     /\$1,000 is the figure this organisation set/.test(PF.unassignedSentence({ count: 3, thresholdCents: 100000 }, fm)),
     PF.unassignedSentence({ count: 3, thresholdCents: 100000 }, fm));

  // ── §2 · ASSIGNING WRITES THE OWNER WITH AN ACTOR ───────────────────────
  console.log("\n— §2 · the owner, the actor, and a name nobody can forge —");
  const as1 = await api("PATCH", "/donors/dp_rich/assign", tok, { assignedTo: "u_b99pf_s" });
  ok("§2 assigning succeeds", as1.status === 200, JSON.stringify(as1.body).slice(0, 200));
  const [rich] = await q("SELECT assigned_to, assigned_to_name, assigned_by, assigned_by_name, assigned_at FROM donors WHERE id='dp_rich'");
  ok("§2 the owner is written", rich.assigned_to === "u_b99pf_s");
  ok("§2 the NAME comes off the users row", rich.assigned_to_name === "Dana Officer", rich.assigned_to_name);
  ok("§2 the ACTOR is stamped", !!rich.assigned_by && rich.assigned_by_name === "Allie Barnett", { by: rich.assigned_by, name: rich.assigned_by_name });
  ok("§2 …and so is when", !!rich.assigned_at);
  // A forged name must not land. The route no longer reads one.
  const forged = await api("PATCH", "/donors/dp_rich/assign", tok, { assignedTo: "u_b99pf_s", assignedToName: "The Executive Director" });
  const [again] = await q("SELECT assigned_to_name FROM donors WHERE id='dp_rich'");
  ok("§2 a name sent in the payload is IGNORED, not asserted on the row",
     forged.status === 200 && again.assigned_to_name === "Dana Officer", again.assigned_to_name);
  const foreignOfficer = await api("PATCH", "/donors/dp_rich/assign", tok, { assignedTo: "u_b99pf_o" });
  ok("§2 an officer id from ANOTHER ORG is refused, never written",
     foreignOfficer.status === 404 && (await q("SELECT assigned_to FROM donors WHERE id='dp_rich'"))[0].assigned_to === "u_b99pf_s",
     JSON.stringify(foreignOfficer.body).slice(0, 160));
  const unassign = await api("PATCH", "/donors/dp_rich/assign", tok, { assignedTo: null });
  const [cleared] = await q("SELECT assigned_to, assigned_by, assigned_at FROM donors WHERE id='dp_rich'");
  ok("§2 unassigning clears the owner AND the stamp — there is no assignment to attribute",
     unassign.status === 200 && cleared.assigned_to === null && cleared.assigned_by === null && cleared.assigned_at === null, cleared);
  const bulk = await api("PATCH", "/donors/bulk-assign", tok, { ids: ["dp_rich", "dp_small"], assignedTo: "u_b99pf_a" });
  const bulkRows = await q("SELECT id, assigned_by_name FROM donors WHERE id = ANY(ARRAY['dp_rich','dp_small'])");
  ok("§2 bulk assignment stamps the actor on every row",
     bulk.status === 200 && bulkRows.every(r => r.assigned_by_name === "Allie Barnett"), bulkRows);
  // Put them back unassigned for §6.
  await q("UPDATE donors SET assigned_to=NULL, assigned_to_name=NULL, assigned_by=NULL, assigned_by_name=NULL, assigned_at=NULL WHERE id = ANY(ARRAY['dp_rich','dp_small'])");

  // ── §3 + §4 · THE SCREEN ────────────────────────────────────────────────
  console.log("\n— §3 · the row count IS the assignment count, on every surface —");
  const pf = await api("GET", "/portfolio/u_b99pf_a", tok);
  ok("§3 the portfolio loads", pf.status === 200, JSON.stringify(pf.body).slice(0, 200));
  const [handCount] = await q(
    `SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND assigned_to='u_b99pf_a' AND deleted_at IS NULL
      AND COALESCE(stage, suggested_stage) = ANY(ARRAY['prospect','qualify','cultivate','solicit','steward','lapsed'])`, [ORG]);
  ok("§3 the row count matches a hand count of the assignments",
     pf.body.people.length === handCount.n && pf.body.count.value === handCount.n,
     { rows: pf.body.people.length, stated: pf.body.count.value, db: handCount.n });
  // THE SHARED DEFINITION: Home's portfolio card and the board read the same
  // helper, so this number cannot differ from them. That is what BUILD-30 bought.
  const home = await api("GET", "/dashboard/home?scope=mine", tok);
  ok("§3 Home's portfolio card is the same number",
     home.body.portfolio && home.body.portfolio.count === handCount.n,
     { home: home.body.portfolio && home.body.portfolio.count, db: handCount.n });
  const board = await api("GET", "/pipeline?scope=mine", tok);
  const onBoard = Object.values(board.body.columns || {}).flat().length;
  ok("§3 …and so is the board", onBoard === handCount.n, { board: onBoard, db: handCount.n });
  ok("§3 the count carries its sentence", /assigned to Allie Barnett/.test(pf.body.count.sentence), pf.body.count.sentence);

  console.log("\n— §4 · at equal ask, silence sorts above yesterday —");
  // Equal open asks on Quentin (120 days quiet) and Rita (spoke yesterday).
  await api("POST", "/donors/dp_quiet/proposals", tok, { purpose: "Quiet ask", askAmount: 5000, expectedClose: "2026-12-01", stage: "asked", fundId: "f_b99pf" });
  await api("POST", "/donors/dp_recent/proposals", tok, { purpose: "Recent ask", askAmount: 5000, expectedClose: "2026-12-01", stage: "asked", fundId: "f_b99pf" });
  await api("POST", "/donors/dp_big/proposals", tok, { purpose: "Big ask", askAmount: 60000, expectedClose: "2027-01-01", stage: "cultivating", fundId: "f_b99pf" });
  const pf2 = await api("GET", "/portfolio/u_b99pf_a", tok);
  const order = pf2.body.people.map(p => p.donorId);
  ok("§4 the biggest open ask leads the list", order[0] === "dp_big", order);
  ok("§4 at equal ask, 120 days of silence sorts ABOVE spoke-yesterday",
     order.indexOf("dp_quiet") < order.indexOf("dp_recent"), order);
  const quiet = pf2.body.people.find(p => p.donorId === "dp_quiet");
  ok("§4 the row carries the last logged conversation", quiet.lastConversation && /Sat down about the campaign/.test(quiet.lastConversation.note), quiet.lastConversation);
  ok("§4 …and says how long ago in words", /months ago/.test(quiet.contactPhrase), quiet.contactPhrase);
  ok("§4 …and is marked quiet", quiet.quiet === true);
  const nell = pf2.body.people.find(p => p.donorId === "dp_never");
  ok("§4 somebody never spoken to says so rather than showing a zero",
     nell.daysSinceContact === null && /No conversation logged yet/.test(nell.contactPhrase), nell.contactPhrase);
  // The next step comes from the Thread, not from a second table.
  const conv = await api("POST", "/donors/dp_big/conversations", tok, {
    touch: "meeting", line: "She asked for the annual report",
    nextStep: { type: "send", due: "2026-10-15", label: "Send the annual report" } });
  ok("§4 logging a conversation opens a thread", conv.status === 200 || conv.status === 201, JSON.stringify(conv.body).slice(0, 220));
  const pf3 = await api("GET", "/portfolio/u_b99pf_a", tok);
  const bea = pf3.body.people.find(p => p.donorId === "dp_big");
  ok("§4 the row's next step IS the Thread's", bea.nextStep && /annual report/i.test(bea.nextStep.label), bea.nextStep);

  // ── §5 · THE TARGET AND THE CAP ─────────────────────────────────────────
  console.log("\n— §5 · both numbers are hers, and absent until she types them —");
  ok("§5 before she types one, there is no target and the sentence says so",
     pf3.body.target.set === false && /No target set/.test(pf3.body.target.sentence), pf3.body.target.sentence);
  const setT = await api("PUT", "/portfolio/u_b99pf_a/target", tok, { target: "150,000", countCap: 3 });
  ok("§5 the target saves through the money seam ('150,000' is not NaN)",
     setT.status === 200 && setT.body.target === 150000, JSON.stringify(setT.body).slice(0, 200));
  const pf4 = await api("GET", "/portfolio/u_b99pf_a", tok);
  ok("§5 the screen reads it back", pf4.body.target.set === true && cents(pf4.body.target.amount) === 15000000);
  ok("§5 the sentence names the fiscal year she set it for", pf4.body.target.sentence.includes(pf4.body.fiscalLabel), pf4.body.target.sentence);
  ok("§5 the cap says how far over she is, and that nothing is blocked",
     pf4.body.cap.over === pf4.body.people.length - 3 && /Nothing is blocked/.test(pf4.body.cap.sentence), pf4.body.cap);
  ok("§5 a target of zero is refused rather than stored as 'no target'",
     (await api("PUT", "/portfolio/u_b99pf_a/target", tok, { target: 0 })).status === 400);
  ok("§5 a fractional cap is refused", (await api("PUT", "/portfolio/u_b99pf_a/target", tok, { countCap: 2.5 })).status === 400);
  const clearT = await api("PUT", "/portfolio/u_b99pf_a/target", tok, { target: "", countCap: "" });
  ok("§5 sending blanks CLEARS them — 'I have not decided' is an answer",
     clearT.status === 200 && clearT.body.target === null && clearT.body.countCap === null, clearT.body);
  await api("PUT", "/portfolio/u_b99pf_a/target", tok, { target: 150000, countCap: 3 });
  // A staff member may set her OWN and nobody else's — refused, not downgraded,
  // because a WRITE landing quietly on another row is worse than an error.
  ok("§5 a staff member cannot set another officer's target",
     (await api("PUT", "/portfolio/u_b99pf_a/target", stok, { target: 1 })).status === 403);
  ok("§5 …but can set her own", (await api("PUT", "/portfolio/u_b99pf_s/target", stok, { target: 20000 })).status === 200);

  // ── §6 · UNASSIGNED MAJOR PROSPECTS ─────────────────────────────────────
  console.log("\n— §6 · 'major' is the org's own number —");
  const un = await api("GET", "/portfolio/unassigned-prospects", tok);
  ok("§6 the list loads", un.status === 200, JSON.stringify(un.body).slice(0, 200));
  ok("§6 the default threshold is $1,000", un.body.thresholdCents === 100000, un.body.thresholdCents);
  ok("§6 the $25,000 donor with no owner is on it", un.body.prospects.some(p => p.donorId === "dp_rich"));
  ok("§6 the $200 donor is NOT", !un.body.prospects.some(p => p.donorId === "dp_small"));
  ok("§6 somebody who already has an owner is NOT", !un.body.prospects.some(p => p.donorId === "dp_quiet"));
  ok("§6 the sentence quotes the threshold and says the org set it",
     /\$1,000/.test(un.body.sentence) && /this organisation set/.test(un.body.sentence), un.body.sentence);
  const raise = await api("PUT", "/orgs/major-prospect-threshold", tok, { threshold: "50,000" });
  ok("§6 the org can change it", raise.status === 200 && raise.body.thresholdCents === 5000000, raise.body);
  const un2 = await api("GET", "/portfolio/unassigned-prospects", tok);
  ok("§6 …and the list follows the org's number, not Steward's",
     un2.body.thresholdCents === 5000000 && !un2.body.prospects.some(p => p.donorId === "dp_rich"), un2.body.prospects.map(p => p.donorId));
  ok("§6 the empty state is honest rather than blank",
     /Everybody who has given/.test(un2.body.sentence), un2.body.sentence);
  ok("§6 a staff member cannot change the org's threshold",
     (await api("PUT", "/orgs/major-prospect-threshold", stok, { threshold: 1 })).status === 403);
  await api("PUT", "/orgs/major-prospect-threshold", tok, { threshold: 1000 });

  // ── §7 · THE WALL ───────────────────────────────────────────────────────
  console.log("\n— §7 · another org's portfolio, and a staff member's own —");
  ok("§7 an officer id from another org is 404", (await api("GET", "/portfolio/u_b99pf_a", tok2)).status === 404);
  const theirs = await api("GET", "/portfolio/u_b99pf_o", tok2);
  ok("§7 their own portfolio is their own people", theirs.status === 200 && theirs.body.people.every(p => p.donorId !== "dp_quiet"));
  ok("§7 a foreign officer's target cannot be written",
     (await api("PUT", "/portfolio/u_b99pf_a/target", tok2, { target: 1 })).status === 404 ||
     (await api("PUT", "/portfolio/u_b99pf_a/target", tok2, { target: 1 })).status === 403);
  ok("§7 …and none was planted",
     (await q("SELECT COUNT(*)::int c FROM portfolio_targets WHERE org_id=$1", [OTHER]))[0].c === 0);
  // BUILD-31's rule: cross-officer visibility is admin-only, and a staff member
  // asking for somebody else's is DOWNGRADED to their own, not refused.
  const downgraded = await api("GET", "/portfolio/u_b99pf_a", stok);
  ok("§7 a staff member asking for another officer's list is DOWNGRADED to her own",
     downgraded.status === 200 && downgraded.body.officer.id === "u_b99pf_s" && downgraded.body.downgraded === true,
     { officer: downgraded.body.officer, downgraded: downgraded.body.downgraded });
  ok("§7 …and sees only her own person", downgraded.body.people.every(p => p.donorId === "dp_dana"), downgraded.body.people.map(p => p.donorId));
  ok("§7 org B's unassigned list holds none of org A's people",
     (await api("GET", "/portfolio/unassigned-prospects", tok2)).body.prospects.every(p => p.donorId !== "dp_rich"));

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

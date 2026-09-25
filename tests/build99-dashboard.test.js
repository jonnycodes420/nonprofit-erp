// BUILD-99 (major gifts) Part 5 — THE MAJOR-GIFTS DASHBOARD.
//
//   §1  the registry: nothing reaches this screen without a one-sentence
//       definition, and no definition may claim anything from outside the org's
//       own records;
//   §2  every figure reconciles to a HAND COUNT on the fixture — the numbers are
//       computed here from the fixture's own arithmetic, never read back off the
//       API and compared to itself;
//   §3  the pipeline-by-stage rows and the weighted total agree with the
//       Proposals screen, because both read the same rows;
//   §4  an org with ZERO proposals gets an honest sentence, not a wall of $0;
//   §5  no goal is invented — the only target on this surface is Part 2's;
//   §6  org A sees none of org B's figures.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "b99_dash", OTHER = "b99_dash2", EMPTYORG = "b99_dash3";
const ME = "b99dash@example.org", THEM = "b99dash-other@example.org", NOBODY = "b99dash-empty@example.org";
const PW = "loadtest1234";

const CHILD = ["portfolio_targets", "cultivation_plan_steps", "cultivation_plans", "cultivation_templates",
  "pledge_installments", "fin_transactions", "interactions", "threads", "tasks",
  "opportunities", "moves", "gifts", "pledges", "donors", "users", "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const o of [ORG, OTHER, EMPTYORG]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const mkOrg = id => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at)
   VALUES ($1,$1,$2,1,'team','active','America/New_York',NOW())
   ON CONFLICT (id) DO UPDATE SET plan='team', subscription_status='active'`, [id, id.replace(/_/g, "-")]);
const mkUser = (id, org, email, name) => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
  [id, org, email, bcrypt.hashSync(PW, 4), name]);
const mkDonor = (id, org, name, officer) => q(
  `INSERT INTO donors (id,org_id,name,email,kind,stage,total_giving,gift_count,assigned_to,assigned_to_name)
   VALUES ($1,$2,$3,$4,'person','cultivate',5000,3,$5,$6)`,
  [id, org, name, id + "@example.org", officer ? officer[0] : null, officer ? officer[1] : null]);
const cents = v => Math.round(Number(v) * 100);
const civil = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return civil(d); };

(async () => {
  console.log("build99-dashboard");
  await reset();
  await mkOrg(ORG); await mkOrg(OTHER); await mkOrg(EMPTYORG);
  await mkUser("u_dash_a", ORG, ME, "Allie Barnett");
  await mkUser("u_dash_d", ORG, "dana@b99dash.example.org", "Dana Officer");
  await mkUser("u_dash_o", OTHER, THEM, "Not Allie");
  await mkUser("u_dash_e", EMPTYORG, NOBODY, "Empty Org Admin");
  await q(`INSERT INTO fin_funds (id,org_id,name) VALUES ('f_dash',$1,'Capital campaign'),('f_dash2',$1,'Annual fund')`, [ORG]);
  await mkDonor("dd_1", ORG, "Alice Ask", ["u_dash_a", "Allie Barnett"]);
  await mkDonor("dd_2", ORG, "Bob Cultivate", ["u_dash_a", "Allie Barnett"]);
  await mkDonor("dd_3", ORG, "Cara Committed", ["u_dash_d", "Dana Officer"]);
  await mkDonor("dd_4", ORG, "Dev Declined", ["u_dash_d", "Dana Officer"]);
  await mkDonor("dd_other", OTHER, "Not Yours", null);
  const tok = await login(ME), tok2 = await login(THEM), tokE = await login(NOBODY);

  const MG = await import("../shared/majorGiftsDash.js");
  const P = await import("../shared/proposalShape.js");

  // ── §1 · THE REGISTRY ───────────────────────────────────────────────────
  console.log("\n— §1 · nothing reaches this screen without a definition —");
  const bad = [];
  for (const m of MG.METRICS) {
    const problems = MG.definitionProblems(m);
    if (problems.length) bad.push(`${m.id}: ${problems.join("; ")}`);
  }
  ok("§1 every metric carries a label, a kind and a real sentence", bad.length === 0, bad);
  ok("§1 ids are unique", new Set(MG.METRIC_IDS).size === MG.METRIC_IDS.length);
  // PROVEN ABLE TO FAIL on each rule it enforces.
  ok("§1 the checker catches a missing definition", MG.definitionProblems({ id: "x", label: "X", kind: "money" }).length > 0);
  ok("§1 …one that does not end as a sentence",
     MG.definitionProblems({ id: "x", label: "X", kind: "money", definition: "The total of every open ask across the whole organisation" })
       .includes("does not end as a sentence"));
  ok("§1 …and one that reaches outside the org's own records",
     MG.definitionProblems({ id: "x", label: "X", kind: "money", definition: "How this compares with the industry benchmark for similar organisations." })
       .some(p => /outside the org/.test(p)));
  ok("§1 no definition mentions a benchmark, a peer or an average nonprofit",
     MG.METRICS.every(m => MG.definitionProblems(m).every(p => !/outside the org/.test(p))));
  // §5's property, checkable on the module: nothing here invents a target.
  const allDefs = MG.METRICS.map(m => m.definition).join(" ");
  ok("§5 NO GOAL IS INVENTED — no definition names a target, a goal or a ratio to hit",
     !/\b(goal|target|should be|ought to|aim for|coverage ratio)\b/i.test(allDefs), allDefs.slice(0, 200));
  ok("§5 the asked-vs-committed line states a fraction, never a 'close rate'",
     !/close rate/i.test(MG.askedVsCommitted({ askedCents: 100000, committedCents: 50000 }, c => "$" + c / 100)),
     MG.askedVsCommitted({ askedCents: 100000, committedCents: 50000 }, c => "$" + c / 100));
  ok("§5 …and offers no fraction at all when there is nothing to divide",
     /Nothing asked for and nothing committed/.test(MG.askedVsCommitted({ askedCents: 0, committedCents: 0 }, c => String(c))));

  // ── §2 · THE FIXTURE, AND THE HAND COUNT ────────────────────────────────
  // Three open proposals: $25,000 at 75%, $10,000 at 50%, $8,000 with NO
  // probability. One committed at $30,000, one declined at $4,000.
  console.log("\n— §2 · every figure against arithmetic done here —");
  const p1 = await api("POST", "/donors/dd_1/proposals", tok, {
    purpose: "Lead gift", askAmount: 25000, expectedClose: plus(20), stage: "asked", probability: 75, fundId: "f_dash" });
  const p2 = await api("POST", "/donors/dd_2/proposals", tok, {
    purpose: "Annual leadership", askAmount: 10000, expectedClose: plus(200), stage: "cultivating", probability: 50, fundId: "f_dash2" });
  const p3 = await api("POST", "/donors/dd_3/proposals", tok, {
    purpose: "Naming gift", askAmount: 8000, expectedClose: plus(25), stage: "identified", fundId: "f_dash" });
  ok("§2 three open proposals exist", [p1, p2, p3].every(r => r.status === 201),
     [p1.status, p2.status, p3.status]);
  const p4 = await api("POST", "/donors/dd_4/proposals", tok, {
    purpose: "Table sponsorship", askAmount: 4000, expectedClose: plus(10), stage: "asked", fundId: "f_dash2" });
  await api("PUT", `/proposals/${p4.body.id}`, tok, { stage: "declined", declineReason: "not_now" });
  const p5 = await api("POST", "/donors/dd_3/proposals", tok, {
    purpose: "Capital commitment", askAmount: 30000, expectedClose: plus(15), stage: "asked", probability: 90, fundId: "f_dash2" });
  await api("PUT", `/proposals/${p5.body.id}`, tok, { stage: "committed", commitKind: "pledge" });

  // Conversations this month, two officers.
  await api("POST", "/donors/dd_1/conversations", tok, { touch: "visit", line: "Walked the arena", nextStep: { skipped: true } });
  await api("POST", "/donors/dd_2/conversations", tok, { touch: "call_reached", line: "Caught her at home", nextStep: { type: "follow_up", due: plus(5), label: "Follow up" } });

  const d = await api("GET", "/major-gifts/dashboard", tok);
  ok("§2 the dashboard loads", d.status === 200, JSON.stringify(d.body).slice(0, 220));

  // HAND COUNTS, computed here from the fixture rather than read back.
  const HAND_OPEN = cents(25000) + cents(10000) + cents(8000);            // $43,000
  const HAND_WEIGHTED = Math.round(cents(25000) * 75 / 100) + Math.round(cents(10000) * 50 / 100);  // $18,750 + $5,000
  ok("§2 open pipeline is the three open asks: $43,000", d.body.tiles.pipeline.value === HAND_OPEN,
     { api: d.body.tiles.pipeline.value, hand: HAND_OPEN });
  ok("§2 weighted counts ONLY the two with a probability set: $23,750",
     d.body.tiles.weighted.value === HAND_WEIGHTED, { api: d.body.tiles.weighted.value, hand: HAND_WEIGHTED });
  ok("§2 …and says how many it left out", d.body.tiles.weighted.unset === 1 && d.body.tiles.weighted.counted === 2, d.body.tiles.weighted);
  ok("§2 …in its sentence", /1 more/.test(d.body.tiles.weighted.sentence) && /not in this figure/.test(d.body.tiles.weighted.sentence),
     d.body.tiles.weighted.sentence);
  // Due this quarter: only the open ones whose expected close falls inside it.
  const [handQ] = await q(
    `SELECT COUNT(*)::int n FROM opportunities o JOIN donors dn ON dn.id=o.donor_id AND dn.org_id=o.org_id
      WHERE o.org_id=$1 AND dn.deleted_at IS NULL AND o.proposal_stage = ANY($2)
        AND o.expected_close >= $3::date AND o.expected_close <= $4::date`,
    [ORG, P.OPEN_STAGE_KEYS, d.body.quarter.start, d.body.quarter.end]);
  ok("§2 due this quarter reconciles to a hand count", d.body.tiles.dueThisQuarter.value === handQ.n,
     { api: d.body.tiles.dueThisQuarter.value, hand: handQ.n });
  ok("§2 committed this year is the one $30,000 commitment",
     d.body.tiles.committedThisYear.value === cents(30000) && d.body.tiles.committedThisYear.count === 1,
     d.body.tiles.committedThisYear);
  // Asked this year: the ones that REACHED asked/committed/declined/stewarding.
  const [handA] = await q(
    `SELECT COUNT(DISTINCT o.id)::int n, COALESCE(SUM(o.target_amount),0) amt
       FROM opportunities o JOIN donors dn ON dn.id=o.donor_id AND dn.org_id=o.org_id
      WHERE o.org_id=$1 AND dn.deleted_at IS NULL
        AND o.proposal_stage IN ('asked','committed','declined','stewarding')`, [ORG]);
  ok("§2 asked this year reconciles to a hand count",
     d.body.tiles.askedThisYear.value === cents(handA.amt) && d.body.tiles.askedThisYear.count === handA.n,
     { api: d.body.tiles.askedThisYear, hand: handA });
  ok("§2 the asked-vs-committed line names both figures and the fraction",
     /\$30,000 committed against \$59,000 asked for this year/.test(d.body.askedVsCommitted)
     && /51% of what you asked for/.test(d.body.askedVsCommitted),
     d.body.askedVsCommitted);
  // ONE AMOUNT, ONE SHAPE. The screen renders a tile with `fmtFull`, which drops
  // a trailing `.00`; the sentence under it used `formatCents`, which never does
  // — so the Major gifts screen read "$50,000" in the tile and "$50,000.00" in
  // the line beneath it, and two shapes of one number read as two numbers. Found
  // by LOOKING at a screenshot, not by an assertion, which is why there is one
  // now. (A receipt still says $50,000.00, and should — `formatCents` is
  // unchanged and `formatCentsPlain` is its sibling.)
  const moneySentences = [
    d.body.askedVsCommitted,
    d.body.tiles.pipeline.definition && d.body.tiles.weighted.sentence,
    ...d.body.byStage.map(r => r.sentence),
  ].filter(x => typeof x === "string");
  const trailing = moneySentences.filter(x => /\$[\d,]+\.00\b/.test(x));
  ok("§2 no sentence on this screen prints a whole amount with a trailing .00",
     trailing.length === 0, trailing.slice(0, 3));
  ok("§2 …and a figure WITH real cents still shows them",
     /\$1,234\.56/.test(require("../money").formatCentsPlain(123456)), require("../money").formatCentsPlain(123456));

  console.log("\n— §2b · officer activity and the follow-up backlog —");
  const [handConv] = await q(
    `SELECT COUNT(*)::int n FROM interactions i JOIN donors dn ON dn.id=i.donor_id AND dn.org_id=i.org_id
      WHERE i.org_id=$1 AND dn.deleted_at IS NULL AND i.is_sample IS NOT TRUE
        AND i.type = ANY(ARRAY['call','meeting','email','ask','stewardship'])
        AND i.date >= $2 AND i.date <= $3`, [ORG, d.body.month.start, d.body.month.end]);
  const apiConv = d.body.officerActivity.rows.reduce((s, r) => s + r.conversations, 0);
  ok("§2b conversations this month sum to a hand count", apiConv === handConv.n, { api: apiConv, hand: handConv.n });
  ok("§2b …and are broken out by who logged them", d.body.officerActivity.rows.some(r => r.officerName === "Allie Barnett"),
     d.body.officerActivity.rows);
  ok("§2b the activity block carries its definition", /counted per officer/.test(d.body.officerActivity.definition));
  const [handTh] = await q(
    `SELECT COUNT(*)::int n FROM threads t JOIN donors dn ON dn.id=t.donor_id AND dn.org_id=t.org_id
      WHERE t.org_id=$1 AND t.closed_at IS NULL AND dn.deleted_at IS NULL`, [ORG]);
  const apiTh = d.body.threadBacklog.rows.reduce((s, r) => s + r.open, 0);
  ok("§2b the follow-up backlog sums to a hand count", apiTh === handTh.n, { api: apiTh, hand: handTh.n });
  ok("§2b overdue is counted SEPARATELY, not folded into open",
     d.body.threadBacklog.rows.every(r => r.overdue <= r.open), d.body.threadBacklog.rows);
  ok("§2b the backlog carries its definition", /snoozed follow-up is not counted/.test(d.body.threadBacklog.definition));

  console.log("\n— §2c · every tile carries its sentence —");
  const tileProblems = [];
  for (const [id, t] of Object.entries(d.body.tiles)) {
    if (!t.definition || t.definition.length < 40) tileProblems.push(`${id}: no definition`);
    if (!t.sentence || t.sentence.length < 40) tileProblems.push(`${id}: no sentence`);
    if (t.definition !== MG.definitionFor(id)) tileProblems.push(`${id}: definition is not the registry's string`);
  }
  ok("§2c every tile's definition IS the registry's own string, not a copy", tileProblems.length === 0, tileProblems);

  // ── §3 · THE SAME ROWS AS THE PROPOSALS SCREEN ──────────────────────────
  console.log("\n— §3 · the dashboard and the Proposals screen are one set of rows —");
  const scr = await api("GET", "/proposals", tok);
  ok("§3 open pipeline equals the Proposals screen's open ask", d.body.tiles.pipeline.value === scr.body.openAsk.cents,
     { dash: d.body.tiles.pipeline.value, screen: scr.body.openAsk.cents });
  ok("§3 weighted equals the Proposals screen's weighted", d.body.tiles.weighted.value === scr.body.weighted.cents,
     { dash: d.body.tiles.weighted.value, screen: scr.body.weighted.cents });
  const stageMismatch = [];
  for (const r of d.body.byStage) {
    const s = scr.body.byStage.find(x => x.stage === r.stage);
    if (!s || s.count !== r.count || s.askCents !== r.askCents) stageMismatch.push(r.stage);
  }
  ok("§3 every stage row matches the Proposals screen's", stageMismatch.length === 0, stageMismatch);
  ok("§3 all six stages are present, so an empty column is visibly empty", d.body.byStage.length === 6);
  ok("§3 every stage row carries its sentence", d.body.byStage.every(r => r.sentence && r.sentence.length > 20));

  // ── §4 · THE HONEST EMPTY STATE ─────────────────────────────────────────
  console.log("\n— §4 · an org with no proposals is told so —");
  const e = await api("GET", "/major-gifts/dashboard", tokE);
  ok("§4 the screen still loads", e.status === 200, JSON.stringify(e.body).slice(0, 200));
  ok("§4 …and says there is nothing yet, rather than showing a wall of $0",
     typeof e.body.empty === "string" && /No proposals on file yet/.test(e.body.empty), e.body.empty);
  ok("§4 every figure really is zero", e.body.tiles.pipeline.value === 0 && e.body.tiles.weighted.value === 0
     && e.body.tiles.committedThisYear.value === 0, e.body.tiles);
  ok("§4 the weighted sentence is the honest one, not a figure", /No open proposals yet/.test(e.body.tiles.weighted.sentence), e.body.tiles.weighted.sentence);
  ok("§4 all six stage rows are still there, each empty and each explained",
     e.body.byStage.length === 6 && e.body.byStage.every(r => r.count === 0 && /^No proposals at /.test(r.sentence)),
     e.body.byStage.map(r => r.sentence).slice(0, 2));
  ok("§4 the tiles still carry their definitions on an empty org",
     Object.values(e.body.tiles).every(t => t.definition && t.definition.length > 40));
  ok("§4 an org WITH proposals gets no empty sentence", d.body.empty === null, d.body.empty);

  // ── §5 · THE ONLY TARGET IS PART 2'S ────────────────────────────────────
  console.log("\n— §5 · no goal is invented here —");
  const keys = JSON.stringify(d.body);
  ok("§5 the payload carries no target, benchmark or industry figure",
     !/\bbenchmark\b/i.test(keys) && !/\bindustry\b/i.test(keys) && !/"target"/.test(keys), true);
  // The target lives on the portfolio, where she typed it, and nowhere else.
  await api("PUT", "/portfolio/u_dash_a/target", tok, { target: 100000 });
  const d2 = await api("GET", "/major-gifts/dashboard", tok);
  ok("§5 setting a portfolio target does not put one on this screen",
     !/"target"/.test(JSON.stringify(d2.body)) && d2.body.tiles.committedThisYear.value === cents(30000));
  ok("§5 …and the portfolio still has it", (await api("GET", "/portfolio/u_dash_a", tok)).body.target.set === true);

  // ── §6 · THE WALL ───────────────────────────────────────────────────────
  console.log("\n— §6 · another org sees none of it —");
  const theirs = await api("GET", "/major-gifts/dashboard", tok2);
  ok("§6 their dashboard loads", theirs.status === 200);
  ok("§6 …with none of org A's money", theirs.body.tiles.pipeline.value === 0 && theirs.body.tiles.committedThisYear.value === 0, theirs.body.tiles);
  ok("§6 …and none of org A's officers", !JSON.stringify(theirs.body).includes("Allie Barnett"));
  ok("§6 …and none of org A's conversations", theirs.body.officerActivity.rows.length === 0, theirs.body.officerActivity.rows);
  ok("§6 …and an honest empty sentence rather than somebody else's figures",
     /No proposals on file yet/.test(theirs.body.empty || ""), theirs.body.empty);

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

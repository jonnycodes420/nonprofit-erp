// FIX-1 PART 0 — WHAT THE WALK FOUND, AS ASSERTIONS BEFORE FIXES.
//
// On 25 September Jonathan walked the product as a customer would. Each thing
// he found is a failing assertion here first, committed red, then fixed by the
// workstream that owns it. The suite is PURE (no server, no database) so every
// workstream can run it in a second, and it fixes the contract names each
// workstream builds to:
//
//   §1  THE PLAN SAYS EXACTLY WHAT THE RUN DOES.  (A)  shared/agentShape.js
//       compilePlan(steps) builds the headline FROM the steps; the model never
//       writes the summary ahead of them. The Sunrise instruction ("Just got a
//       gift from the Sunrise Foundation, 5,000 dollars") becomes a PREPARED
//       gift for a human to confirm — never silently dropped, never recorded.
//   §2  READS ARE SCOPED TO WHAT THE INSTRUCTION NAMES.  (A)
//   §3  THE RUN STATE IS THE SERVER'S.  (A)  a run that has ended is never
//       "Running...", whatever the client last believed.
//   §4  A SUGGESTION MAY ONLY SAY WHAT THE RECORD SAYS.  (A)
//       shared/suggestionGuard.js — the walk's own invented text is refused,
//       and no raw markdown survives to a screen.
//   §5  AN ORGANISATION IS NEVER A "SPONSOR".  (A)  shared/vocabulary.js
//   §6  FUNDRAISING IS FOUR QUESTIONS.  (B)  client/src/lib/fundraisingSections.js
//       and every old tab id still lands somewhere.
//   §7  NO LECTURE.  (D)  the "Everyone is on one list" paragraph is gone.
//   §8  A NEGATIVE AMOUNT IS SIGN-FIRST.  (E)  fmtFull(-1.33) === "-$1.33".
//
// Added 26 September (Jonathan, findings 9-13; the lead fixes 9, 10, 11 and 13
// before the workstreams start, 12 is checked at the end of FIX-1):
//   §9  EVERY THREAD FIGURE IS ONE COMPUTATION.  shared/threadFigures.js
//       threadFigures(rows) gives each row's badge and the oldest row; the
//       header, the sentence and the badges all read it.
//   §10 A COUNT ON HOME HAS A SENTENCE, OR IS NOT THERE.  The Home note never
//       counts the capped list ("12") beside the header's 24.
//   §11 THE DEMO IS ITS OWN ORG.  scripts/seed-demo.js (exports ORG and
//       ADMIN_EMAIL), no suite touches it, demo-shape never skips, CI seeds it.
//   §12 THE SIDEBAR.  client/src/lib/tabRegistry.js PRIMARY_NAV is Home,
//       Donors, Fundraising, Volunteers, Agent, Reports, Finance.
//   §13 ON HOME TOO, NOT A "SPONSOR".  vocabulary giverCountWord(rows, words):
//       people get the org's word, organisations are organisations, mixed is
//       givers.
//
// A section that fails because its module does not exist yet is RED on
// purpose. Nothing here may be loosened to go green; a workstream that needs a
// different contract changes this file in a reviewed commit, with the reason.

const fs = require("fs"), path = require("path");
const { ok, summary } = require("./helpers");
const root = path.join(__dirname, "..");

async function tryImport(rel) {
  try { return await import(path.join(root, rel)); }
  catch (e) { return { __missing: String(e && e.message || e).slice(0, 160) }; }
}
const has = (m, name) => m && typeof m[name] === "function";

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(f.name)) out.push(p);
  }
  return out;
}
// Comments explaining a rule are not the rule broken.
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

(async () => {
  const SUNRISE = "Just got a gift from the Sunrise Foundation, 5,000 dollars";
  const PEOPLE = [
    { id: "d_sun", name: "Sunrise Foundation", kind: "organisation" },
    { id: "d_mar", name: "Margaret Chen", kind: "person" },
    { id: "d_bob", name: "Bob Harmon", kind: "person" },
    ...Array.from({ length: 397 }, (_, i) => ({ id: "d_" + i, name: "Person " + i, kind: "person" })),
  ];

  // ── §1 THE PLAN SAYS EXACTLY WHAT THE RUN DOES ───────────────────────────
  const A = await tryImport("shared/agentShape.js");
  ok("§1 agentShape exports compilePlan", has(A, "compilePlan"));
  ok("§1 agentShape exports preparedGiftFromInstruction", has(A, "preparedGiftFromInstruction"));

  const prepared = has(A, "preparedGiftFromInstruction") ? A.preparedGiftFromInstruction(SUNRISE, PEOPLE) : null;
  ok("§1 the Sunrise instruction is a prepared gift of 500000 cents",
    !!prepared && prepared.amountCents === 500000, JSON.stringify(prepared));
  ok("§1 ...on the Sunrise Foundation's record", !!prepared && prepared.donorId === "d_sun");
  ok("§1 the Sunrise instruction is NOT refused outright (it is prepared, not refused)",
    has(A, "moneyRefusal") && A.moneyRefusal(SUNRISE) === null);

  if (has(A, "compilePlan")) {
    const steps = [
      { tool: "record_gift", donorId: "d_sun", amountCents: 500000 },
      { tool: "open_thread", donorId: "d_sun", label: "Thank the Sunrise Foundation" },
    ];
    const plan = A.compilePlan(steps, { people: PEOPLE });
    const words = String(plan && plan.summary || "").toLowerCase();
    ok("§1 compiled plan keeps exactly the steps it was given",
      Array.isArray(plan.steps) && plan.steps.length === 2 && plan.steps.map(s => s.tool).join() === "record_gift,open_thread");
    ok("§1 the money step is marked prepared-for-you-to-confirm, never run alone",
      plan.steps[0] && plan.steps[0].state === "confirm");
    ok("§1 the headline names the gift and the follow-up", /gift/.test(words) && /follow/.test(words), words);
    const lying = A.compilePlan([{ tool: "draft_note", donorId: "d_sun" }, { tool: "create_task", donorId: "d_sun" }], { people: PEOPLE });
    const lw = String(lying.summary || "").toLowerCase();
    ok("§1 a plan with no gift step never says it will record a gift", !/record|gift of \$/.test(lw), lw);
    ok("§1 ...nor that it will open a follow-up it does not open", !/follow-up thread|open a follow/.test(lw), lw);
  } else {
    ["§1 compiled plan keeps exactly the steps", "§1 money step prepared", "§1 headline names gift+follow-up",
     "§1 no gift step never says gift", "§1 no thread step never says follow-up"].forEach(n => ok(n, false, "compilePlan missing"));
  }
  // The model may not write the headline: the plan schema the model fills has no summary.
  ok("§1 the model's plan schema carries no free-text summary",
    A && A.PLAN_SCHEMA && !("summary" in (A.PLAN_SCHEMA.properties || {})));

  // ── §2 READS ARE SCOPED ──────────────────────────────────────────────────
  ok("§2 agentShape exports scopeFromInstruction", has(A, "scopeFromInstruction"));
  const scope = has(A, "scopeFromInstruction") ? A.scopeFromInstruction(SUNRISE, PEOPLE) : null;
  ok("§2 an instruction about one organisation reads that organisation",
    Array.isArray(scope) && scope.length === 1 && scope[0] === "d_sun", JSON.stringify(scope));
  const broad = has(A, "scopeFromInstruction")
    ? A.scopeFromInstruction("Draft a note to everyone who gave last year", PEOPLE) : "missing";
  ok("§2 an instruction naming nobody is whole-org (null), not a guess", broad === null, JSON.stringify(broad));
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  ok("§2 the run no longer reads the whole org unconditionally",
    !/const people = await agentReadPeople\(orgId\);/.test(server));

  // ── §3 THE RUN STATE IS THE SERVER'S ─────────────────────────────────────
  ok("§3 agentShape exports runIsLive", has(A, "runIsLive"));
  if (has(A, "runIsLive")) {
    ok("§3 a finished run is not live", A.runIsLive({ status: "done", finished_at: "2026-09-25T10:00:00Z" }) === false);
    ok("§3 a failed run is not live", A.runIsLive({ status: "failed" }) === false);
    ok("§3 a running run with a finish time is not live (the server's word wins)",
      A.runIsLive({ status: "running", finished_at: "2026-09-25T10:00:00Z" }) === false);
    ok("§3 a running run is live", A.runIsLive({ status: "running", finished_at: null }) === true);
  }
  ok("§3 the server answers a run's state by id", /app\.get\("\/agent\/runs\/:id"/.test(server));

  // ── §4 A SUGGESTION MAY ONLY SAY WHAT THE RECORD SAYS ────────────────────
  const G = await tryImport("shared/suggestionGuard.js");
  ok("§4 shared/suggestionGuard.js exists with guardSuggestion + plainText",
    has(G, "guardSuggestion") && has(G, "plainText"), G.__missing);
  if (has(G, "guardSuggestion")) {
    const record = {
      donor: { id: "d_sun", name: "Sunrise Foundation", total_giving: 1500, gift_count: 1, last_gift_amount: 1500, last_gift_date: "2026-03-02" },
      rows: [{ id: "g1", kind: "gift", amount: 1500, date: "2026-03-02", fund: "Youth Arts" }],
    };
    const walked = [
      "**Reach out to Angela Wu**, their program officer, before the renewal.",
      "Mention the 68% participant retention in the youth program.",
      "Share that three youth are advancing to paid apprenticeships.",
      "Their last gift was $1,500 on 2 March to Youth Arts.",
    ].join(" ");
    const r = G.guardSuggestion(walked, record);
    const kept = (r.kept || []).map(k => k.text || k).join(" ");
    ok("§4 an invented person (Angela Wu) is refused", !/Angela Wu/.test(kept), kept);
    ok("§4 an invented statistic (68%) is refused", !/68%/.test(kept), kept);
    ok("§4 an invented claim (three youth / apprenticeships) is refused", !/apprentice/i.test(kept), kept);
    ok("§4 the true sentence, citing a real row, survives", /\$1,500/.test(kept), kept);
    ok("§4 every kept sentence cites a row", (r.kept || []).every(k => Array.isArray(k.cites) && k.cites.length > 0));
    ok("§4 the refusals are counted, never silent", r.dropped === 3, String(r.dropped));
    ok("§4 no raw markdown survives", !/\*\*|__|^#+\s/m.test(kept));
    ok("§4 plainText strips markdown to text", G.plainText("**Call** her _soon_\n# Now") === "Call her soon\nNow",
      JSON.stringify(G.plainText("**Call** her _soon_\n# Now")));
  }

  // ── §5 AN ORGANISATION IS NEVER A "SPONSOR" ──────────────────────────────
  const V = await tryImport("shared/vocabulary.js");
  ok("§5 vocabulary exports giverWordFor", has(V, "giverWordFor"));
  if (has(V, "giverWordFor")) {
    const words = { giver_singular: "sponsor", giver_plural: "sponsors" };
    ok("§5 a foundation is a foundation",
      V.giverWordFor({ kind: "organisation", funder_type: "foundation" }, words) === "foundation");
    ok("§5 a church is a church", V.giverWordFor({ kind: "organisation", funder_type: "church" }, words) === "church");
    ok("§5 an organisation with no funder type is an organisation, not a sponsor",
      V.giverWordFor({ kind: "organisation" }, words) === "organisation");
    ok("§5 a person keeps the org's own word", V.giverWordFor({ kind: "person" }, words) === "sponsor");
    ok("§5 a legacy row (kind NULL) is a person", V.giverWordFor({ kind: null }, words) === "sponsor");
  }

  // ── §6 FUNDRAISING IS FOUR QUESTIONS ─────────────────────────────────────
  const F = await tryImport("client/src/lib/fundraisingSections.js");
  ok("§6 fundraisingSections exists", !F.__missing, F.__missing);
  if (!F.__missing) {
    ok("§6 exactly four sections", Array.isArray(F.FR_SECTIONS) && F.FR_SECTIONS.map(s => s.id).join() === "overview,campaigns,majorgifts,moneyin",
      JSON.stringify(F.FR_SECTIONS && F.FR_SECTIONS.map(s => s.id)));
    const OLD = ["overview", "deposits", "acknowledgments", "events", "majorgifts", "proposals", "portfolios",
                 "plans", "campaigns", "pages", "recurring", "members", "funds", "pipeline"];
    for (const id of OLD) {
      const to = F.FR_LEGACY && F.FR_LEGACY[id];
      ok(`§6 old tab "${id}" lands on a section`, !!to && F.FR_SECTIONS.some(s => s.id === to.section), JSON.stringify(to));
    }
  }

  // ── §7 NO LECTURE ────────────────────────────────────────────────────────
  const lecture = walk(path.join(root, "client", "src"))
    .filter(f => stripComments(fs.readFileSync(f, "utf8")).includes("Everyone is on one list"));
  ok("§7 the 'Everyone is on one list' paragraph appears nowhere in the client", lecture.length === 0,
    lecture.map(f => path.relative(root, f)).join(", "));

  // ── §8 A NEGATIVE AMOUNT IS SIGN-FIRST ───────────────────────────────────
  const M = await import(path.join(root, "client/src/lib/money.js"));
  ok("§8 fmtFull(-1.33) is -$1.33", M.fmtFull(-1.33) === "-$1.33", M.fmtFull(-1.33));
  ok("§8 fmtFull(-4200) is -$4,200", M.fmtFull(-4200) === "-$4,200", M.fmtFull(-4200));
  ok("§8 fmtFull(1.5) is still $1.50", M.fmtFull(1.5) === "$1.50");
  const signAfter = walk(path.join(root, "client", "src"))
    .filter(f => /"\$-"|'\$-'|`\$-/.test(stripComments(fs.readFileSync(f, "utf8"))));
  ok("§8 no client source writes a literal \"$-\"", signAfter.length === 0,
    signAfter.map(f => path.relative(root, f)).join(", "));

  // ── §9 EVERY THREAD FIGURE IS ONE COMPUTATION ────────────────────────────
  // The walk: the header said "oldest 17 days" (the max of daysOpen) while
  // Ada Petrossian's row said 23 days overdue and the sentence said "three
  // weeks" (the max of overdueDays). One fact, two numbers, one screen.
  const TF = await tryImport("shared/threadFigures.js");
  ok("§9 shared/threadFigures.js exports threadFigures", has(TF, "threadFigures"), TF.__missing);
  const ROWS = [
    { id: "th_ada", donorName: "Ada Petrossian", overdue: true, overdueDays: 23, daysOpen: 17 },
    { id: "th_bo", donorName: "Bo Lindqvist", overdue: true, overdueDays: 4, daysOpen: 9 },
    { id: "th_cy", donorName: "Cy Mbeki", overdue: false, overdueDays: 0, daysOpen: 3 },
  ];
  if (has(TF, "threadFigures")) {
    const f = TF.threadFigures(ROWS);
    const badges = f && f.rowDays || {};
    ok("§9 every row gets its badge figure from it", ROWS.every(r => Number.isFinite(badges[r.id])), JSON.stringify(badges));
    ok("§9 Ada's badge is her 23 days overdue", badges.th_ada === 23, JSON.stringify(badges));
    ok("§9 'oldest' means the oldest row: Ada, 23 days",
      !!f.oldest && f.oldest.id === "th_ada" && f.oldest.days === 23, JSON.stringify(f && f.oldest));
    ok("§9 oldest is the largest badge, never a second measure",
      !!f.oldest && f.oldest.days === Math.max(...Object.values(badges)), JSON.stringify(f));
  }
  ok("§9 the server's Thread header reads threadFigures", /threadFigures\(/.test(server));
  ok("§9 ...and no longer takes 'oldest' from daysOpen on its own",
    !/const oldestDays = list\.reduce\(\(m, t\) => Math\.max\(m, t\.daysOpen\), 0\);/.test(server));
  const homeNoteSrc = fs.readFileSync(path.join(root, "shared/homeNote.js"), "utf8");
  ok("§9 the Home sentence reads the same computation", /threadFigures/.test(stripComments(homeNoteSrc)));

  // ── §10 A COUNT ON HOME HAS A SENTENCE, OR IS NOT THERE ──────────────────
  // The walk: "12 people are waiting on you" beside "27 open · 24 overdue".
  // 12 was the overdue rows in the CAPPED ranked list; nothing said so.
  const HN = await import(path.join(root, "shared/homeNote.js"));
  const late12 = Array.from({ length: 12 }, (_, i) => ({
    id: "th_" + i, donorName: i === 0 ? "Ada Petrossian" : "Person " + i, overdue: true, overdueDays: 23 - i, daysOpen: 5,
    nextStep: { label: "Call" },
  }));
  const note10 = HN.homeNote({ threads: { list: late12, stat: { open: 27, overdue: 24, oldestDays: 23 } } });
  ok("§10 the sentence never says 12 when the header says 24 overdue", !/\btwelve\b|\b12\b/i.test(note10), note10);
  const counted = note10.match(/^(\S+) people are waiting on you/i);
  ok("§10 ...and if it counts people, the count is the header's 24",
    !counted || /^(twenty-four|24)$/i.test(counted[1]), note10);

  // ── §11 THE DEMO IS ITS OWN ORG, NEVER A TEST FIXTURE ────────────────────
  // The walk: the demo read "She asked for the import report" — a line the
  // walk scripts and suites write, landing in the org the pitch is given on.
  const demoSeedPath = path.join(root, "scripts/seed-demo.js");
  const demoSeedExists = fs.existsSync(demoSeedPath);
  ok("§11 the demo org has its own seed, scripts/seed-demo.js", demoSeedExists);
  const demoSeedSrc = demoSeedExists ? fs.readFileSync(demoSeedPath, "utf8") : "";
  ok("§11 the demo seed says nothing the test fixtures say", demoSeedExists && !/import report/i.test(demoSeedSrc));
  let demoIds = ["admin@creoarts.org"];
  if (demoSeedExists) {
    try { const S = require(demoSeedPath); demoIds = [S.ORG, S.ADMIN_EMAIL].filter(Boolean); } catch (e) { demoIds = ["<seed-demo.js did not load: " + e.message + ">"]; }
  }
  const sharing = fs.readdirSync(path.join(root, "tests")).filter(f => f.endsWith(".js") && f !== "demo-shape.test.js" && f !== "fix1-walk.test.js")
    .filter(f => { const s = fs.readFileSync(path.join(root, "tests", f), "utf8"); return demoIds.some(id => s.includes(id)); });
  ok("§11 no suite logs in to or writes the demo org", demoIds.length > 0 && sharing.length === 0, sharing.slice(0, 12).join(", "));
  const demoShapeSrc = fs.readFileSync(path.join(root, "tests/demo-shape.test.js"), "utf8");
  ok("§11 demo-shape has no skip path (the demo is always seeded where it runs)", !/suite skipped/.test(demoShapeSrc));
  const ciSrc = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  ok("§11 CI seeds the demo before the battery", /seed-demo\.js/.test(ciSrc));

  // ── §12 THE SIDEBAR AFTER FIX-1 ──────────────────────────────────────────
  // Checked at the end of FIX-1; red until B, C and A land their tabs.
  const TR = await tryImport("client/src/lib/tabRegistry.js");
  ok("§12 the sidebar is Home, Donors, Fundraising, Volunteers, Agent, Reports, Finance",
    Array.isArray(TR.PRIMARY_NAV) && TR.PRIMARY_NAV.join() === "dashboard,donors,fundraising,volunteers,agent,reports,finance",
    TR.__missing || JSON.stringify(TR.PRIMARY_NAV));
  ok("§12 ...and everything else is under More",
    Array.isArray(TR.MORE_NAV) && Array.isArray(TR.PRIMARY_NAV) && TR.MORE_NAV.every(id => !TR.PRIMARY_NAV.includes(id)),
    TR.__missing || JSON.stringify(TR.MORE_NAV));

  // ── §13 ON HOME TOO, AN ORGANISATION IS NOT A "SPONSOR" ──────────────────
  // The walk: "11 sponsors have gone quiet", "Sponsors whose card failed".
  ok("§13 vocabulary exports giverCountWord", has(V, "giverCountWord"));
  if (has(V, "giverCountWord")) {
    const words = { giver_singular: "sponsor", giver_plural: "sponsors" };
    const ppl = [{ kind: "person" }, { kind: null }];
    const orgs = [{ kind: "organisation", funder_type: "foundation" }, { kind: "organisation", funder_type: "church" }];
    ok("§13 a count of people is the org's word", V.giverCountWord(ppl, words) === "sponsors");
    ok("§13 a count of organisations is organisations", V.giverCountWord(orgs, words) === "organisations");
    ok("§13 a mixed count says givers", V.giverCountWord([...ppl, ...orgs], words) === "givers");
  }
  const quiet = [...Array.from({ length: 8 }, (_, i) => ({ donorName: "Person " + i, kind: "person" })),
    ...["Sunrise Foundation", "Grace Chapel", "Hale Trust"].map(n => ({ donorName: n, kind: "organisation" }))];
  const note13 = HN.homeNote({ drift: { list: quiet }, vocabulary: { giver_singular: "sponsor", giver_plural: "sponsors" } });
  ok("§13 eleven quiet givers, three of them organisations, are not 'sponsors'", !/sponsors? have gone quiet/i.test(note13), note13);
  const dashSrc = fs.readFileSync(path.join(root, "client/src/components/Dashboard.jsx"), "utf8");
  ok("§13 the failed-card tile names its rows by what they are, not by the bare word",
    !/t\("monthly_giver",2\)\)\} whose card failed/.test(dashSrc));

  summary();
})().catch(e => { console.error(e); process.exit(1); });

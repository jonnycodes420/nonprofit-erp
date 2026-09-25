// BUILD-97 Part 2 — EVERY NUMBER ON SCREEN HAS A SENTENCE UNDER IT.
//
// BUILD-86 C.3 made this true of the four dashboards and stopped there. A
// metric could not reach a board screen without a one-sentence definition, and
// everywhere else a figure could appear with nothing under it — which is how
// "Score 77/99" sat beside somebody's name for months, and how "Weighted
// forecast · by stage" reached a screen where "by stage" was the whole
// explanation of a number built from six invented probabilities.
//
//   §1  THE CENSUS CANNOT DRIFT. The scanner counts numeric render sites per
//       file and this suite asserts the counts EXACTLY — not as a ceiling.
//       Add a number to a screen and it fails until audit/BUILD-97-NUMBER-
//       CENSUS.md says what the number is. Take one off and it fails the same
//       way. There is no direction in which a numeric surface changes silently.
//
//   §2  EVERY SURVIVOR'S SENTENCE IS ONE STRING. The registry is the only
//       place a surviving number is defined; a second copy in a component is
//       two truths about what a figure means.
//
//   §3  THE SCORE TILE IS OFF THE PROFILE — asserted in a real browser,
//       because that is the only place the question "what does this screen
//       show" is actually answered.
//
//   §4  AN INVENTED RULE CANNOT REACH A SCREEN. "momentum fades after 75 days"
//       fails; "$2,000 every March since 2019" does not. The difference is a
//       rule versus a fact, and the guard is proven on both sides.
//
//   §5  AN ORGANISATION IS NOT A PERSON — no household, no planned gift,
//       refused server-side with the sentence, not hidden in the UI.
//
// Standard scratch stack + the :4173 preview for §3.

const fs = require("fs"), path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const DIST = path.join(__dirname, "..", "client", "dist", "index.html");
const haveBrowser = () => { try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; } return fs.existsSync(DIST); };

const root = path.join(__dirname, "..");

const ORG = "org_b97num";
const PASS = "loadtest1234";
const ME = "numbers@b97.example.org";

// Every child this suite's fixture creates, in FK-safe order. `interactions` is
// the one that bit: logging a planned gift writes one, and it holds a donor_id.
// ORG is declared ABOVE this on purpose - a const read above its own
// declaration is the shape that has cost this repo three separate builds.
const CHILD_TABLES = ["gift_soft_credits", "interactions", "threads", "tasks", "planned_gifts", "households",
  "gifts", "donors", "users", "fin_transactions", "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const t of CHILD_TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

// ── THE COUNTS, AS OF THIS COMMIT ─────────────────────────────────────────
// An EQUALITY, deliberately, and not the ratchet the palette census uses. A
// colour literal being removed is progress; a NUMBER being removed from a
// screen is a change to what the product tells somebody, and it has to be
// written down either way.
const EXPECTED = {
  "components/Donors.jsx": 117,   // BUILD-98 Part 1: +2, the soft-credit pair (profile.creditHard / creditWithSoft)
  "components/Dashboard.jsx": 62,
  "components/Finance.jsx": 43,
  "components/Reports.jsx": 41,
  "components/Fundraising.jsx": 31,   // BUILD-98 Part 2: +1, a gift amount in the acknowledgment backlog row (a cell, not a claim)
  "components/Communications.jsx": 20,
  "components/Grants.jsx": 13,
  "components/AnnualFund.jsx": 12,
  "components/shared.jsx": 9,
  "components/RecurringGiving.jsx": 8,
  "components/Settings.jsx": 8,
  "components/FunnelChart.jsx": 4,
  "components/Programs.jsx": 4,
  "components/PortalWidgets.jsx": 4,
  "components/PortalBanner.jsx": 4,
  "components/Pipeline.jsx": 3,
  "components/DonorMap.jsx": 3,
  "components/Dashboards.jsx": 2,
  "components/Workflows.jsx": 1,
  "components/MetricBreakdownPanel.jsx": 1,
  "components/Uploader.jsx": 1,
  "components/EventsDesk.jsx": 3,   // BUILD-98 Part 4: price, value received and deductible per level — cells, not claims
  // BUILD-99 Part 1: the two headline tiles (asked-for-still-open, weighted),
  // the per-stage tile's figure, and the ask + probability cells on a row.
  // THEIR SENTENCES COME FROM shared/proposalShape.js, on the server — one
  // string, one source, the registry's own rule, living server-side because the
  // sentence has to name counts only the server knows ("from 9 proposals at the
  // probabilities you set"). The screen renders what the server sends and holds
  // no copy, which is the property that matters.
  "components/MajorGifts.jsx": 5,
};
const EXPECTED_TOTAL = 399;
const EXPECTED_CLAIMS = 111;

(async () => {
  console.log("build97-numbers");

  const CENSUS = await import("../shared/numberCensus.js");
  const TH = await import("../shared/thresholds.js");
  const scanner = require("../scripts/build97-number-census.js");

  // ── §1 · THE CENSUS CANNOT DRIFT ─────────────────────────────────────────
  console.log("\n— §1 · the count is exact, in both directions —");
  const r = scanner.census();
  ok("the census document is committed",
     fs.existsSync(path.join(root, "audit", "BUILD-97-NUMBER-CENSUS.md")));
  ok("total numeric render sites is exactly what the census says",
     r.total === EXPECTED_TOTAL, { found: r.total, census: EXPECTED_TOTAL });
  ok("claim-shaped sites likewise", r.claims === EXPECTED_CLAIMS,
     { found: r.claims, census: EXPECTED_CLAIMS });
  const drifted = [];
  for (const [file, n] of Object.entries(EXPECTED)) {
    if (r.byFile[file] !== n) drifted.push(`${file}: census ${n}, found ${r.byFile[file]}`);
  }
  ok("no file's count has moved", drifted.length === 0, drifted);
  // A file in the scan that the census never listed is the same defect wearing
  // different clothes, so it is checked from the other side too.
  const unlisted = Object.entries(r.byFile)
    .filter(([f, n]) => n !== null && n > 0 && EXPECTED[f] === undefined).map(([f]) => f);
  ok("no scanned file carries numbers the census does not list", unlisted.length === 0, unlisted);
  // BUILD-98 (switch) Part 3 — THE SCOPE ITSELF CANNOT DRIFT. The scan list is
  // explicit, so a NEW screen file was invisible to the census: neither counted
  // nor excluded. Every component and page must be in one list or the other.
  const scopeSrc = fs.readFileSync(path.join(root, "scripts", "build97-number-census.js"), "utf8");
  const named = new Set([...scopeSrc.matchAll(/"((?:components|pages)\/[A-Za-z0-9]+\.jsx)"/g)].map(m => m[1]));
  const onDisk = [
    ...fs.readdirSync(path.join(root, "client", "src", "components")).filter(f => f.endsWith(".jsx")).map(f => "components/" + f),
    ...fs.readdirSync(path.join(root, "client", "src", "pages")).filter(f => f.endsWith(".jsx")).map(f => "pages/" + f),
  ];
  const nowhere = onDisk.filter(f => !named.has(f) && !f.includes("_censusprobe"));
  ok("every screen file is either scanned or named out of scope with a reason", nowhere.length === 0, nowhere);
  ok("every out-of-scope surface names its reason",
     Object.values(r.outOfScope).every(v => typeof v === "string" && v.length > 15),
     r.outOfScope);

  // PROVEN ABLE TO FAIL: the scanner must actually see a planted number.
  const planted = "<div style={{fontSize:28}}>{fmtFull(x)}</div>";
  const probe = path.join(root, "client", "src", "components", "_censusprobe.jsx");
  fs.writeFileSync(probe, planted);
  const before = scanner.census().total;
  fs.unlinkSync(probe);
  ok("a file the census does not list is not silently swept in",
     before === EXPECTED_TOTAL, { before });
  // …and the pattern itself bites on the shape it hunts.
  ok("the money pattern matches a money formatter in JSX",
     scanner.PATTERNS.find(p => p.key === "money").re.test(planted));

  // ── §2 · ONE STRING PER SENTENCE ─────────────────────────────────────────
  console.log("\n— §2 · the registry is the only place a number is defined —");
  ok("the registry has entries", CENSUS.NUMBER_CENSUS.length >= 11, CENSUS.NUMBER_CENSUS.length);
  const bad = [];
  for (const e of CENSUS.NUMBER_CENSUS) {
    const problems = CENSUS.sentenceProblems(e);
    if (problems.length) bad.push(`${e.id}: ${problems.join("; ")}`);
    if (!e.computation || e.computation.length < 15) bad.push(`${e.id}: no computation recorded`);
    if (!e.testid) bad.push(`${e.id}: nothing for the suite to find on screen`);
  }
  ok("every entry carries a sentence, a computation and a hook", bad.length === 0, bad);
  const ids = CENSUS.NUMBER_CENSUS.map(e => e.id);
  ok("ids are unique", new Set(ids).size === ids.length, ids);
  const testids = CENSUS.NUMBER_CENSUS.map(e => e.testid);
  ok("…and so are the screen hooks", new Set(testids).size === testids.length, testids);

  // PROVEN ABLE TO FAIL on each rule it enforces.
  ok("sentenceProblems catches a missing sentence",
     CENSUS.sentenceProblems({ sentence: "" }).length > 0);
  ok("…a sentence that does not end as one",
     CENSUS.sentenceProblems({ sentence: "The number of donors who gave something" }).includes("does not end as a sentence"));
  ok("…and one that claims something outside the org's own records",
     CENSUS.sentenceProblems({ sentence: "An estimate of this donor's wealth and what they could give." })
       .some(p => /outside the org/.test(p)));

  // The component must READ the registry, never hold a second copy. A grep for
  // the sentence text in the components would pass on a copy; a grep for the
  // registry CALL is what proves there is only one.
  const donorsSrc = fs.readFileSync(path.join(root, "client", "src", "components", "Donors.jsx"), "utf8");
  const pipeSrc = fs.readFileSync(path.join(root, "client", "src", "components", "Pipeline.jsx"), "utf8");
  const recSrc = fs.readFileSync(path.join(root, "client", "src", "components", "RecurringGiving.jsx"), "utf8");
  ok("the donor profile reads its sentences from the registry",
     /censusById\("profile\.lifetime"\)/.test(donorsSrc) && /censusById\("profile\.contact"\)/.test(donorsSrc));
  ok("the pipeline tiles read theirs from the registry",
     /censusById\("pipeline\.weighted"\)/.test(pipeSrc));
  ok("the recurring MRR tile reads its own",
     /censusById\("recurring\.mrr"\)/.test(recSrc));
  // The one that would be a second truth: the old local constant must now BE
  // the registry's string, not a copy of it.
  ok("the giving-strength definition is the registry's string, not a copy",
     /GIVING_STRENGTH_DEF = censusById\("list\.givingStrength"\)\.sentence/.test(donorsSrc));

  // The weighted forecast's sentence has to name the percentages, because
  // naming them is the entire reason it survived.
  const weighted = CENSUS.censusById("pipeline.weighted");
  ok("the weighted forecast's sentence states the actual percentages",
     /10%/.test(weighted.sentence) && /70%/.test(weighted.sentence) && /90%/.test(weighted.sentence),
     weighted.sentence);
  ok("…and admits they are not measured",
     /working assumption|not anything measured/i.test(weighted.sentence), weighted.sentence);

  // ── §4 · AN INVENTED RULE CANNOT REACH A SCREEN ──────────────────────────
  // (Before §3, because §3 needs a browser and this does not.)
  console.log("\n— §4 · a rule from nowhere is refused; a fact is not —");
  const refused = (text, grounded) => TH.ungroundedClaims(text, { groundedValues: grounded || [] }).length > 0;

  ok("THE ONE THIS PART EXISTS FOR: 'momentum fades after 75 days' is refused",
     refused("Day 66 is critical, momentum fades after 75 days."));
  ok("…and the refusal names the claim",
     TH.ungroundedSentence(TH.ungroundedClaims("momentum fades after 75 days")).includes("75 days"));
  ok("…and is still refused even when 66 IS in her rows (75 is the invention, not 66)",
     refused("Day 66 is critical, momentum fades after 75 days.", [66]));
  ok("a sector claim from nowhere is refused", refused("Most donors lapse after 18 months."));
  ok("an invented percentage is refused", refused("Only 24% of donors give again."));

  ok("DRIFT'S OWN SENTENCE SURVIVES: money and dates are facts, not rules",
     !refused("$2,000 every March since 2019. Nothing for 14 months.", [14]));
  ok("a day count from her own record survives", !refused("It has been 66 days.", [66]));
  ok("a threshold the product actually holds survives (LAPSE_DAYS)",
     !refused("She has not given in 365 days."));
  ok("…and the same threshold said in words resolves to the same constant",
     !refused("Follow up within two weeks."), TH.ungroundedClaims("Follow up within two weeks."));
  ok("the two cited sector figures survive, because they are cited",
     !refused("Sector retention is 43% (Fundraising Effectiveness Project).")
     && !refused("Sustainer retention is 71% at twelve months (M+R Benchmarks 2026)."));
  ok("a dollar amount is never read as a threshold",
     TH.thresholdClaims("Her last gift was $1,750 on 4 March 2026.").length === 0,
     TH.thresholdClaims("Her last gift was $1,750 on 4 March 2026."));
  ok("…nor is a year", TH.thresholdClaims("since 2019").length === 0);

  // THE MIRROR CANNOT GO STALE. Each entry names the constant it copies; if the
  // real one moves and this table does not, the check starts refusing the
  // product's own sentences.
  const driftEngine = require("../drift.js");
  const serverSrc = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const val = (name) => (TH.THRESHOLDS.find(t => t.name === name) || {}).value;
  ok("MIN_OVERDUE_DAYS still matches drift.js", val("MIN_OVERDUE_DAYS") === driftEngine.DRIFT.MIN_OVERDUE_DAYS,
     { table: val("MIN_OVERDUE_DAYS"), live: driftEngine.DRIFT.MIN_OVERDUE_DAYS });
  ok("LAPSE_MAX_DAYS still matches drift.js", val("LAPSE_MAX_DAYS") === driftEngine.DRIFT.LAPSE_MAX_DAYS);
  ok("HANDLED_SNOOZE_DAYS still matches drift.js", val("HANDLED_SNOOZE_DAYS") === driftEngine.DRIFT.HANDLED_SNOOZE_DAYS);
  ok("MAX_CADENCE_FOR_HIGH still matches drift.js", val("MAX_CADENCE_FOR_HIGH") === driftEngine.DRIFT.MAX_CADENCE_FOR_HIGH);
  ok("LAPSE_DAYS still matches server.js", new RegExp(`const LAPSE_DAYS = ${val("LAPSE_DAYS")};`).test(serverSrc));
  ok("the dunning cadence still matches server.js",
     /const DUNNING_SCHEDULE_DAYS = \[0, 3, 7, 14\];/.test(serverSrc));
  ok("every threshold names where it comes from",
     TH.THRESHOLDS.every(t => t.source && t.means && t.name), TH.THRESHOLDS.filter(t => !t.source));

  // ── §5 · AN ORGANISATION IS NOT A PERSON ─────────────────────────────────
  console.log("\n— §5 · organisations are off the person surfaces —");
  // CLAUDE.md (BUILD-94): a fixture that DELETEs an org row behind
  // `.catch(() => {})` turns a swallowed FK failure into a duplicate key on the
  // NEXT run. This suite walked into exactly that — a planned gift writes an
  // `interactions` row, the org delete failed on that FK, the catch ate it, and
  // the second run died on orgs_pkey. So: clear every child this suite creates,
  // and UPSERT the org rather than relying on the delete having worked.
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,receipt_address)
           VALUES ($1,'Numbers Org','numbers-org',1,'team','active','1 Main St, Lexington, KY 40507')
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, plan=EXCLUDED.plan,
             subscription_status=EXCLUDED.subscription_status`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Numbers','admin')`, ["u_" + ORG, ORG, ME, bcrypt.hashSync(PASS, 4)]);
  const mk = (id, name, kind) => q(
    `INSERT INTO donors (id,org_id,name,email,kind,total_giving,gift_count) VALUES ($1,$2,$3,$4,$5,1000,2)`,
    [id, ORG, name, `${id}@example.org`, kind]);
  await mk("d_sun", "Sunrise Foundation", "organisation");
  await mk("d_p1", "Allie Barnett", "person");
  await mk("d_p2", "Marcus Reyes", "person");
  await mk("d_legacy", "Legacy Row", null);           // predates the column
  const tok = await login(ME, PASS);

  const hhOrg = await api("POST", "/households", tok, { memberIds: ["d_sun", "d_p1"] });
  ok("a household containing an organisation is refused", hhOrg.status === 400, hhOrg.status);
  ok("…and the refusal NAMES the organisation and says why",
     /Sunrise Foundation/.test(hhOrg.body.error || "") && /not a person/.test(hhOrg.body.error || ""),
     hhOrg.body.error);
  ok("…and points at where organisations do live",
     /grant-cycle/.test(hhOrg.body.error || ""), hhOrg.body.error);

  const hhPeople = await api("POST", "/households", tok, { memberIds: ["d_p1", "d_p2"] });
  ok("a household of two people is unaffected", hhPeople.status === 201, hhPeople.body);

  const pgOrg = await api("POST", "/donors/d_sun/planned-gifts", tok, { type: "bequest" });
  ok("a planned gift on an organisation is refused", pgOrg.status === 400, pgOrg.status);
  ok("…with the same sentence, from the same helper",
     /not a person/.test(pgOrg.body.error || ""), pgOrg.body.error);
  const pgPerson = await api("POST", "/donors/d_p2/planned-gifts", tok, { type: "bequest" });
  ok("a planned gift on a person is unaffected", pgPerson.status === 200 || pgPerson.status === 201, pgPerson.status);

  // A LEGACY ROW IS A PERSON. The column arrived after the rows did, and a
  // migration that has not run yet must not start refusing a customer's work.
  const pgLegacy = await api("POST", "/donors/d_legacy/planned-gifts", tok, { type: "bequest" });
  ok("a row with no kind at all is treated as a person, never refused",
     pgLegacy.status === 200 || pgLegacy.status === 201, pgLegacy.status);

  // ── §3 · THE BROWSER ─────────────────────────────────────────────────────
  console.log("\n— §3 · the browser: the score tile is gone, the sentences are there —");
  if (!haveBrowser()) {
    console.log("  SKIP — no Playwright or client/dist (browser leg)");
  } else {
    const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    const lr = await page.request.post(require("./helpers").BASE + "/auth/login", { data: { email: ME, password: PASS } });
    const lj = await lr.json();
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await page.evaluate(d => {
      localStorage.setItem("npe_token", d.token);
      localStorage.setItem("npe_user", JSON.stringify(d.user));
      localStorage.setItem("npe_org", JSON.stringify(d.org));
    }, lj);
    await page.goto(APP + "/donors/d_p1", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);

    // THE ASSERTION THE WHOLE PART TURNS ON.
    const scoreTile = page.locator('[data-testid="dp-tile-def-Giving strength"]');
    ok("the SCORE TILE no longer renders on the donor profile",
       await scoreTile.count() === 0, await scoreTile.count());
    const body = await page.innerText("body");
    ok("…and no /99 figure appears on this screen at all",
       !/\b\d{1,2}\s*\/\s*99\b/.test(body), (body.match(/\b\d{1,2}\s*\/\s*99\b/) || [])[0]);

    // The three that stay, each with the registry's exact sentence.
    for (const id of ["profile.lifetime", "profile.lastGift", "profile.contact"]) {
      const e = CENSUS.censusById(id);
      const el = page.locator(`[data-testid="${e.testid}"]`);
      const n = await el.count();
      ok(`${e.label} still renders`, n === 1, { testid: e.testid, count: n });
      if (n === 1) {
        const title = await el.getAttribute("title");
        const aria = await el.getAttribute("aria-label");
        ok(`…with the registry's exact sentence on it`, title === e.sentence, { title, expected: e.sentence });
        // A tooltip nobody can tab to is a definition that does not exist for
        // half the people who need it — BUILD-100's rule, held here too.
        ok(`…reachable by keyboard and exposed to a reader`,
           aria === e.sentence && (await el.getAttribute("tabindex")) === "0", { aria });
      }
    }
    // BUILD-98 Part 1 — the soft-credit pair renders only on a record another
    // gift credits, so give Allie one and look again.
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ('g_b98num',$1,'d_p2',400,'2026-09-01','cash') ON CONFLICT DO NOTHING`, [ORG]);
    await q(`INSERT INTO gift_soft_credits (id,org_id,gift_id,donor_id,amount,role) VALUES ('gsc_b98num',$1,'g_b98num','d_p1',400,'spouse') ON CONFLICT DO NOTHING`, [ORG]);
    await page.goto(APP + "/donors/d_p1", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    for (const id of ["profile.creditHard", "profile.creditWithSoft"]) {
      const e = CENSUS.censusById(id);
      const el = page.locator(`[data-testid="${e.testid}"]`);
      const n = await el.count();
      ok(`${e.label} renders on a soft-credited record`, n === 1, { testid: e.testid, count: n });
      if (n === 1) ok(`…with the registry's exact sentence, reachable by keyboard`,
        (await el.getAttribute("title")) === e.sentence && (await el.getAttribute("aria-label")) === e.sentence
        && (await el.getAttribute("tabindex")) === "0");
    }
    await browser.close();
  }

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

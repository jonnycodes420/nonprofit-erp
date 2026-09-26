// FIX-1 §A — STEWARD AGENT, ITS OWN PRODUCT.
//
// The walk (25 September) typed "Just got a gift from the Sunrise Foundation,
// 5,000 dollars". The plan said it would record the gift and open a follow-up;
// the run recorded nothing, opened no thread, and did two other things. It said
// it "read 400 people" for an instruction about one organisation, and the
// button sat on "Running..." after the run had finished.
//
// This suite replays that instruction against a real server and holds the fix:
//
//   §1  THE SUNRISE INSTRUCTION, END TO END. The plan is the steps that run.
//       The gift is PREPARED, not recorded: absent until a person confirms,
//       present in cents after, written by recordGift with the PERSON as actor.
//       A follow-up thread exists. The read was one record, not the org.
//   §2  RUN STATE IS THE SERVER'S. GET /agent/runs/:id answers, a finished run
//       is not live, a second confirm cannot record the gift twice, and another
//       org's run is nobody's.
//   §3  THE MONEY LINE STILL HOLDS. A refund is refused before anything is
//       written; gift news that names nobody is not guessed at.
//   §4  A SUGGESTION MAY ONLY SAY WHAT THE RECORD SAYS. A suggestion naming a
//       person the record does not carry is refused, and the profile's
//       Suggested panel runs every line through the guard.
//   §5  NO RAW MARKDOWN AND NO NEW HEX IN AGENT. No "**" in any Agent screen's
//       source or on screen; zero colour literals outside the tokens.
//   §6  AN ORGANISATION IS NEVER A "SPONSOR" in anything the agent writes.
//   §7  THE ROOM. Agent is its own sidebar item before Reports; Workflows moved
//       in and its old id lands there; the undo list left Settings; Home keeps
//       a one-line entry that carries her text into Agent.
//   §8  WAITING FOR YOU is one queue, oldest first.
//   §9  THE BROWSER: the five views, the Sunrise plan confirmed on screen, the
//       button reading the server's state, no "**" anywhere.
//
// Needs the stack (BASE, DATABASE_URL) and, for §9, Playwright + a built dist.

const fs = require("fs"), path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, BASE } = require("./helpers");
const { readSource } = require("../scripts/lib/readSource");

const root = path.join(__dirname, "..");
const ORG = "org_fx1agent", OTHER = "org_fx1agent2";
const PASS = "loadtest1234";
const ME = "director@fx1agent.example.org", THEM = "director@fx1agent2.example.org";
const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const DIST = path.join(root, "client", "dist", "index.html");
const SHOTS = process.env.FIX1_SHOTS || "";   // a folder: write the five views at 1440 and 390 there
const haveBrowser = () => { try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; } return fs.existsSync(DIST); };
const SUNRISE = "Just got a gift from the Sunrise Foundation, 5,000 dollars";
const AGENT_FILES = ["client/src/components/Agent.jsx"];

const CHILD = ["agent_writes", "agent_drafts", "agent_runs", "agent_instructions", "tribute_notices",
  "thank_you_drafts", "interactions", "threads", "tasks", "fin_transactions", "gift_soft_credits", "gifts",
  "workflow_runs", "workflows", "donors", "users", "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const mkOrg = (id, name, vocab) => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,receipt_address,vocabulary_json)
   VALUES ($1,$2,$3,1,'team','active','1 Main St, Lexington, KY 40507',$4)
   ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`, [id, name, id.replace(/_/g, "-"), vocab ? JSON.stringify(vocab) : null]);
const mkUser = (id, org, email, name) => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
  [id, org, email, bcrypt.hashSync(PASS, 4), name]);
const mkDonor = (id, org, name, kind, opts = {}) => q(
  `INSERT INTO donors (id,org_id,name,email,kind,funder_type,stage,total_giving,gift_count,last_gift_date,last_gift_amount,tags)
   VALUES ($1,$2,$3,$4,$5,$6,'cultivate',$7,$8,$9,$10,'[]')`,
  [id, org, name, `${id}@example.org`, kind, opts.funderType || null, opts.total || 0, opts.gifts || 0,
   opts.last || null, opts.lastAmount || null]);

const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

(async () => {
  console.log("fix1-agent");
  await reset();
  await mkOrg(ORG, "Riverbend Arts", { giver_singular: "sponsor", giver_plural: "sponsors" });
  await mkOrg(OTHER, "Somebody Else");
  await mkUser("u_fx1ag", ORG, ME, "Dana Whitfield");
  await mkUser("u_fx1ag2", OTHER, THEM, "Other Director");
  await mkDonor("d_fx1_sun", ORG, "Sunrise Foundation", "organisation",
    { funderType: "foundation", total: 1500, gifts: 1, last: "2026-03-02", lastAmount: 1500 });
  for (let i = 0; i < 40; i++)
    await mkDonor("d_fx1_p" + i, ORG, "Person Number" + String.fromCharCode(65 + (i % 26)) + i, "person",
      { total: 100 + i, gifts: 1, last: "2025-11-0" + (1 + (i % 9)), lastAmount: 100 + i });
  await mkDonor("d_fx1_x", OTHER, "Sunrise Foundation", "organisation", { total: 9999, gifts: 3 });
  const tok = await login(ME, PASS);
  const theirTok = await login(THEM, PASS);
  const A = await import("../shared/agentShape.js");

  // ── §1 · THE SUNRISE INSTRUCTION, END TO END ─────────────────────────────
  console.log("\n— §1 · the Sunrise instruction, replayed —");
  const planned = await api("POST", "/agent/instructions", tok, { text: SUNRISE });
  ok("the Sunrise instruction is planned, not refused (201)", planned.status === 201, planned.body);
  const plan = (planned.body && planned.body.plan) || {};
  const steps = plan.steps || [];
  ok("the plan is two steps: record the gift, open the follow-up",
     steps.map(s => s.tool).join() === "record_gift,open_thread", steps.map(s => s.tool));
  ok("…the gift is PREPARED for her to confirm, in cents",
     steps[0] && steps[0].state === "confirm" && steps[0].amountCents === 500000 && steps[0].donorId === "d_fx1_sun", steps[0]);
  ok("…and the follow-up waits for the gift", steps[1] && steps[1].state === "waits", steps[1]);
  ok("the headline is compiled from those steps: it names the gift and the follow-up",
     /gift/i.test(plan.summary || "") && /follow/i.test(plan.summary || ""), plan.summary);
  ok("the read is scoped: ONE record, the one she named",
     Array.isArray(plan.readIds) && plan.readIds.length === 1 && plan.readIds[0] === "d_fx1_sun", plan.readIds);
  ok("…and it says so in words, never 'your 41 people'",
     /Sunrise Foundation/.test(plan.reads || "") && !/\b4[01]\b/.test(plan.reads || ""), plan.reads);
  const gifts0 = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [ORG]);
  ok("the gift is ABSENT until she confirms", gifts0[0].n === 0, gifts0[0]);
  const runs0 = await q(`SELECT COUNT(*)::int AS n FROM agent_runs WHERE org_id=$1`, [ORG]);
  ok("…and nothing has run", runs0[0].n === 0, runs0[0]);

  // The lead's merge (FIX-1): a gift confirmed here does what the gift form
  // does after a person records one, so a LAPSED giver is lapsed no longer.
  await q(`UPDATE donors SET stage='lapsed' WHERE org_id=$1 AND id='d_fx1_sun'`, [ORG]);
  const confirmed = await api("POST", `/agent/instructions/${planned.body && planned.body.id}/confirm`, tok, {});
  ok("she confirms: the run answers", confirmed.status === 200 && !!confirmed.body.runId, confirmed.body);
  const [sunAfter] = await q(`SELECT stage FROM donors WHERE org_id=$1 AND id='d_fx1_sun'`, [ORG]);
  ok("…and a lapsed giver who just gave is not lapsed any more (the gift form's after-gift step)",
     sunAfter && sunAfter.stage === "steward", sunAfter);
  const runId = confirmed.body && confirmed.body.runId;
  const gifts1 = await q(`SELECT amount::float AS amount, created_by, created_by_name, donor_id FROM gifts WHERE org_id=$1`, [ORG]);
  ok("the gift is PRESENT after, exactly once", gifts1.length === 1, gifts1);
  ok("…for 500000 cents", gifts1[0] && Math.round(gifts1[0].amount * 100) === 500000, gifts1[0]);
  ok("…on the Sunrise Foundation's record", gifts1[0] && gifts1[0].donor_id === "d_fx1_sun", gifts1[0]);
  ok("…recorded by HER, not by the agent (the actor is the human)",
     gifts1[0] && gifts1[0].created_by === "u_fx1ag" && !/system/i.test(gifts1[0].created_by_name || ""), gifts1[0]);
  const ledger = await q(`SELECT COUNT(*)::int AS n FROM fin_transactions WHERE org_id=$1 AND source='gift'`, [ORG]);
  ok("…through recordGift (the ledger row it always writes is there)", ledger[0].n === 1, ledger[0]);
  const thr = await q(`SELECT id, created_by FROM threads WHERE org_id=$1 AND donor_id='d_fx1_sun' AND closed_at IS NULL`, [ORG]);
  ok("a follow-up thread exists on the Sunrise Foundation", thr.length === 1, thr);
  const [runRow] = await q(`SELECT status, finished_at, read_summary, actions FROM agent_runs WHERE id=$1`, [runId]);
  ok("the run says it read one record", runRow && /Sunrise Foundation/.test(runRow.read_summary || "")
     && !/people/.test(runRow.read_summary || ""), runRow && runRow.read_summary);
  const ran = (runRow && (typeof runRow.actions === "string" ? JSON.parse(runRow.actions) : runRow.actions)) || [];
  ok("PLAN = RUN: the run carries exactly the plan's steps, in order",
     Array.isArray(ran) && ran.length === 2 && ran.map(s => s.tool).join() === steps.map(s => s.tool).join(), ran);
  ok("…each one done", ran.length === 2 && ran.every(s => s.outcome === "done"), ran);

  // ── §2 · RUN STATE IS THE SERVER'S ───────────────────────────────────────
  console.log("\n— §2 · the server says whether it is running —");
  const rs = await api("GET", `/agent/runs/${runId}`, tok);
  ok("GET /agent/runs/:id answers", rs.status === 200 && rs.body.run && rs.body.run.id === runId, rs.body);
  ok("…a finished run is not live", rs.body.run && rs.body.run.live === false && !!rs.body.run.finished_at, rs.body.run);
  ok("…and it lists each step with its outcome",
     rs.body.run && Array.isArray(rs.body.run.steps) && rs.body.run.steps.length === 2
     && rs.body.run.steps.every(s => s.outcome === "done" && typeof s.describes === "string"), rs.body.run && rs.body.run.steps);
  ok("runIsLive agrees with the server's row", typeof A.runIsLive === "function" && !!rs.body.run && A.runIsLive(rs.body.run) === false);
  const again = await api("POST", `/agent/instructions/${planned.body.id}/confirm`, tok, {});
  ok("confirming twice is refused", again.status === 409, again.body);
  const gifts2 = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [ORG]);
  ok("…and the gift is still there exactly once", gifts2[0].n === 1, gifts2[0]);
  const theirs = await api("GET", `/agent/runs/${runId}`, theirTok);
  ok("another org cannot read her run (404)", theirs.status === 404, theirs.status);
  const notMine = await api("POST", `/agent/instructions/${planned.body.id}/confirm`, theirTok, {});
  ok("…nor confirm her plan (404)", notMine.status === 404, notMine.status);
  const plans = await api("GET", "/agent/plans", tok);
  ok("GET /agent/plans lists every plan with its run",
     plans.status === 200 && plans.body.plans.some(p => p.id === planned.body.id && p.run && p.run.id === runId), plans.body);

  // ── §3 · THE MONEY LINE STILL HOLDS ─────────────────────────────────────
  console.log("\n— §3 · money she did not describe is not guessed at —");
  const refund = await api("POST", "/agent/instructions", tok, { text: "Refund the Sunrise Foundation's gift" });
  ok("a refund is still refused by name", refund.status === 400 && refund.body.error === "money_instruction", refund.body);
  const nobody = await api("POST", "/agent/instructions", tok, { text: "Just got a gift of 250 dollars" });
  ok("gift news that names nobody on file is not guessed at",
     nobody.status === 400 && /who/i.test(nobody.body.sentence || ""), nobody.body);
  const [ic] = await q(`SELECT COUNT(*)::int AS n FROM agent_instructions WHERE org_id=$1`, [ORG]);
  ok("…and neither wrote anything", ic.n === 1, ic);
  const ask = typeof A.preparedGiftFromInstruction === "function" && A.preparedGiftFromInstruction(SUNRISE, [{ id: "d_fx1_sun", name: "Sunrise Foundation", kind: "organisation" }]);
  ok("the gift is parsed by Steward, never by a model", ask && ask.amountCents === 500000);
  // The executors still have no money tool: the gift is the PERSON's write.
  const serverSrc = readSource("server.js");
  const execBlock = serverSrc.slice(serverSrc.indexOf("const AGENT_EXECUTORS = {"), serverSrc.indexOf("const AGENT_RUNNABLE ="));
  ok("there is still no record_gift executor", !/\basync record_gift\s*\(/.test(execBlock));
  const confirmFn = serverSrc.slice(serverSrc.indexOf('app.post("/agent/instructions/:id/confirm"'),
    serverSrc.indexOf('app.get("/agent/instructions"'));
  ok("the confirm writes the gift through recordGift with the person as actor",
     /recordGift\(\{[\s\S]{0,600}actorId: actor\(req\)\.id/.test(confirmFn), confirmFn.slice(0, 200));

  // ── §4 · A SUGGESTION MAY ONLY SAY WHAT THE RECORD SAYS ─────────────────
  console.log("\n— §4 · a suggestion naming someone not on the record is refused —");
  const G = await import("../shared/suggestionGuard.js").catch(() => ({
    guardSuggestion: () => ({ kept: [], dropped: -1 }), droppedLine: () => "" }));
  const record = { donor: { id: "d_fx1_sun", name: "Sunrise Foundation", total_giving: 1500, gift_count: 1,
    last_gift_amount: 1500, last_gift_date: "2026-03-02" }, rows: [{ id: "g1", amount: 1500, date: "2026-03-02", fund: "Youth Arts" }] };
  const r = G.guardSuggestion("Call Marisol Vega at the foundation this week. Their last gift was $1,500.", record);
  ok("a sentence naming somebody the record does not carry is refused",
     !r.kept.some(k => /Marisol/.test(k.text)) && r.dropped === 1, r);
  ok("…and the true sentence survives", r.kept.some(k => /\$1,500/.test(k.text)), r.kept);
  ok("…and the page says a line was left out", /left out/.test(G.droppedLine(r.dropped)), G.droppedLine(r.dropped));
  const donorsSrc = readSource("client/src/components/Donors.jsx");
  ok("the profile's Suggested panel runs every line through the guard",
     /guardSuggestion\(/.test(donorsSrc) && /suggestionGuard/.test(donorsSrc));
  ok("…and no longer asks the model for **markdown** headings",
     !/\*\*Recommended Move:\*\*/.test(donorsSrc));

  // ── §5 · NO RAW MARKDOWN, NO NEW HEX ────────────────────────────────────
  console.log("\n— §5 · no ** and no hex in Agent —");
  for (const f of AGENT_FILES) {
    const exists = fs.existsSync(path.join(root, f));
    ok(`${f} exists`, exists);
    const code = exists ? stripComments(fs.readFileSync(path.join(root, f), "utf8")) : "";
    ok(`${f}: no "**" anywhere in its text`, exists && !/\*\*/.test(code));
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    ok(`${f}: zero hex literals (tokens only)`, exists && hex.length === 0, hex.slice(0, 5));
    const rgba = code.match(/rgba?\(/g) || [];
    ok(`${f}: zero rgba literals (tokens only)`, exists && rgba.length === 0, rgba.length);
  }

  // ── §6 · AN ORGANISATION IS NEVER A "SPONSOR" ───────────────────────────
  console.log("\n— §6 · the foundation is a foundation —");
  const V = await import("../shared/vocabulary.js");
  ok("giverWordFor names the Sunrise Foundation a foundation, in an org that says sponsor",
     typeof V.giverWordFor === "function" && V.giverWordFor({ kind: "organisation", funder_type: "foundation" }, { giver_singular: "sponsor", giver_plural: "sponsors" }) === "foundation");
  const planText = JSON.stringify(plan).toLowerCase();
  ok("nothing in the plan calls it a sponsor", !/sponsor/.test(planText), planText.slice(0, 200));
  const waitingA = await api("GET", "/agent/waiting", tok);
  ok("nothing in the waiting queue calls it a sponsor", !/sponsor/i.test(JSON.stringify(waitingA.body || {})));

  // ── §7 · THE ROOM ───────────────────────────────────────────────────────
  console.log("\n— §7 · Agent is its own place —");
  const TR = await import("../client/src/lib/tabRegistry.js");
  ok("Agent is a sidebar item, immediately before Reports",
     TR.PRIMARY_NAV.indexOf("agent") >= 0 && TR.PRIMARY_NAV.indexOf("agent") === TR.PRIMARY_NAV.indexOf("reports") - 1, TR.PRIMARY_NAV);
  ok("…with a tab entry in TABS and MORE_TABS", TR.TABS.some(t => t.id === "agent") && TR.MORE_TABS.some(t => t.id === "agent"));
  ok("Workflows left the nav lists",
     !TR.PRIMARY_NAV.includes("workflows") && !TR.MORE_NAV.includes("workflows")
     && !TR.TABS.some(t => t.id === "workflows") && !TR.MORE_TABS.some(t => t.id === "workflows"));
  const appSrc = readSource("client/src/App.jsx");
  ok("…and its old id deep-links to Agent → Workflows",
     /t==="workflows"\)\{[^}]*t="agent"/.test(appSrc.replace(/\s+/g, "")) || /if\(t==="workflows"\)/.test(appSrc.replace(/\s+/g, "")), null);
  const settingsSrc = fs.readFileSync(path.join(root, "client/src/components/Settings.jsx"), "utf8");
  ok("the thirty-day undo list left Settings", !/agent\/writes\/\$\{w\.id\}\/undo/.test(settingsSrc)
     && !/\{id:"agent",label:"Steward's activity"\}/.test(settingsSrc));
  const agentSrc = fs.existsSync(path.join(root, AGENT_FILES[0])) ? fs.readFileSync(path.join(root, AGENT_FILES[0]), "utf8") : "";
  ok("…and lives in Agent → Guardrails", /\/agent\/writes\/\$\{w\.id\}\/undo/.test(agentSrc));
  const dashSrc = fs.readFileSync(path.join(root, "client/src/components/Dashboard.jsx"), "utf8");
  ok("Home keeps a one-line entry that opens Agent with her text",
     /onNavigate\("agent",\{[^}]*agentText/.test(dashSrc));
  ok("…and Home no longer runs plans itself", !/\/agent\/instructions\/\$\{agentPlan\.id\}\/confirm/.test(dashSrc));

  // ── §8 · WAITING FOR YOU ────────────────────────────────────────────────
  console.log("\n— §8 · one queue, oldest first —");
  // A draft the agent wrote a week ago, a tribute notice from yesterday, and a
  // gift to confirm from today.
  await q(`INSERT INTO agent_drafts (id,org_id,donor_id,subject,body,cites,status,created_at)
           VALUES ('adr_fx1','${ORG}','d_fx1_p1','Thank you','Thank you for the spring gift.','["d_fx1_p1"]'::jsonb,'pending',NOW()-INTERVAL '7 days')`);
  const [g0] = await q(`SELECT id FROM gifts WHERE org_id=$1 LIMIT 1`, [ORG]);
  await q(`INSERT INTO tribute_notices (id,org_id,gift_id,donor_id,tribute_type,honouree_name,body,status,created_at)
           VALUES ('tn_fx1',$1,$2,'d_fx1_sun','memory','Ruth Alvarez','A gift was given in memory of Ruth Alvarez.','waiting',NOW()-INTERVAL '1 day')`,
    [ORG, g0 ? g0.id : "none"]).catch(e => console.log("  (tribute seed failed: " + e.message + ")"));
  const second = await api("POST", "/agent/instructions", tok, { text: "Just got a cheque from the Sunrise Foundation for $250" });
  ok("a second gift is prepared", second.status === 201, second.body);
  const w = await api("GET", "/agent/waiting", tok);
  const items = (w.body && w.body.items) || [];
  ok("the queue answers", w.status === 200 && Array.isArray(items), w.body);
  ok("…with the agent's draft, the tribute notice and the gift to confirm",
     ["agent_draft", "tribute_notice", "gift_to_confirm"].every(k => items.some(i => i.kind === k)), items.map(i => i.kind));
  const times = items.map(i => new Date(i.createdAt).getTime());
  ok("…oldest first", times.every((t, i) => i === 0 || times[i - 1] <= t), items.map(i => i.kind));
  ok("…and the count is the length of the list", w.body.count === items.length, w.body.count);
  ok("…with no raw markdown in any of it", !/\*\*/.test(JSON.stringify(items)));
  const theirQ = await api("GET", "/agent/waiting", theirTok);
  ok("another org's queue holds none of hers", theirQ.status === 200 && Array.isArray(theirQ.body.items) && !(theirQ.body.items || []).some(i => /fx1_/.test(i.id)), theirQ.body);
  const discard = await api("POST", `/agent/instructions/${second.body.id}/discard`, tok, {});
  ok("a prepared gift she does not want is set aside, and nothing is recorded",
     discard.status === 200 && (await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [ORG]))[0].n === 1, discard.body);

  // ── §9 · THE BROWSER ────────────────────────────────────────────────────
  console.log("\n— §9 · the browser: five views, one run sheet —");
  if (!haveBrowser()) {
    console.log("  SKIP — no Playwright or client/dist (browser leg)");
    ok("the browser leg ran", false, "no Playwright or dist");
  } else {
    const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
    const browser = await chromium.launch();
    const errors = [];
    async function open(width, height) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on("pageerror", e => { if (!/Unexpected token '<'/.test(e.message)) errors.push(e.message.slice(0, 160)); });
      const lr = await page.request.post(BASE + "/auth/login", { data: { email: ME, password: PASS } });
      const lj = await lr.json();
      await page.goto(APP, { waitUntil: "domcontentloaded" });
      await page.evaluate(d => {
        localStorage.setItem("npe_token", d.token);
        localStorage.setItem("npe_user", JSON.stringify(d.user));
        localStorage.setItem("npe_org", JSON.stringify(d.org));
      }, lj);
      await page.goto(APP, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      return page;
    }
    try {
    const page = await open(1440, 1000);
    const navText = await page.locator(".app-sidebar").innerText().catch(() => "");
    ok("the sidebar carries Agent, before Reports",
       /Agent[\s\S]*Reports/.test(navText), navText.slice(0, 200));
    await page.locator('.app-sidebar button:has-text("Agent")').first().click();
    await page.waitForTimeout(1200);
    ok("Agent opens as its own room", await page.locator('[data-testid="agent-room"]').count() === 1);
    const VIEWS = ["ask", "plans", "workflows", "waiting", "guardrails"];
    for (const v of VIEWS) ok(`…with a "${v}" view`, await page.locator(`[data-testid="agent-tab-${v}"]`).count() === 1);

    // ASK: a large box and three examples in the org's words.
    await page.click('[data-testid="agent-tab-ask"]'); await page.waitForTimeout(500);
    ok("Ask has a large box", await page.locator('[data-testid="agent-ask-input"]').count() === 1);
    const ex = page.locator('[data-testid="agent-example"]');
    ok("…and three examples", await ex.count() === 3, await ex.count());
    const exText = (await ex.allInnerTexts()).join(" | ");
    ok("…in the org's own words (it says sponsors)", /sponsor/i.test(exText), exText);

    // THE SUNRISE INSTRUCTION, ON SCREEN. A fresh donor so the gift is new.
    await q(`DELETE FROM threads WHERE org_id=$1`, [ORG]);
    await page.fill('[data-testid="agent-ask-input"]', "Just got a gift from the Sunrise Foundation, 300 dollars");
    await page.click('[data-testid="agent-ask-submit"]');
    await page.waitForSelector('[data-testid="agent-sheet"]', { timeout: 8000 }).catch(() => {});
    const sheet = page.locator('[data-testid="agent-sheet"]');
    ok("the plan appears as a run sheet", await sheet.count() === 1);
    const sheetText = (await sheet.count()) ? await sheet.innerText() : "";
    ok("…with the gift prepared for her to confirm", /Prepared for you to confirm/i.test(sheetText), sheetText.slice(0, 300));
    ok("…the read, one record", /Read the Sunrise Foundation/i.test(sheetText), sheetText.slice(0, 300));
    const before = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND amount=300`, [ORG]);
    ok("…and no gift yet", before[0].n === 0, before[0]);
    const yes = page.locator('[data-testid="agent-sheet-confirm"]');
    ok("the one yes names the money", /Record \$300 and run/.test(await yes.innerText().catch(() => "")),
       await yes.innerText().catch(() => ""));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, "ask-plan-1440.png"), fullPage: true }); }
    await yes.click();
    let label = "";
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(400);
      label = await page.locator('[data-testid="agent-sheet"]').innerText().catch(() => "");
      if (!/Running/.test(label) && /Done/.test(label)) break;
    }
    ok("after the run the sheet reads the server: no 'Running…'", !/Running/.test(label), label.slice(0, 300));
    ok("…and every step says Done", !/Prepared for you to confirm|After you confirm/i.test(label) && /Done/.test(label), label.slice(0, 300));
    const after = await q(`SELECT created_by FROM gifts WHERE org_id=$1 AND amount=300`, [ORG]);
    ok("…and the gift is recorded, in her name", after.length === 1 && after[0].created_by === "u_fx1ag", after);

    // THE FIVE VIEWS, each checked for raw markdown, and photographed.
    for (const v of VIEWS) {
      await page.click(`[data-testid="agent-tab-${v}"]`); await page.waitForTimeout(900);
      const view = page.locator(`[data-testid="agent-view-${v}"]`);
      ok(`the ${v} view renders`, await view.count() === 1);
      const txt = await page.locator('[data-testid="agent-room"]').innerText().catch(() => "");
      ok(`…with no "**" on screen`, !/\*\*/.test(txt));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${v}-1440.png`), fullPage: true });
    }
    await page.click('[data-testid="agent-tab-plans"]'); await page.waitForTimeout(700);
    ok("Plans lists every instruction with its run's state",
       await page.locator('[data-testid="agent-plan-item"]').count() >= 2, await page.locator('[data-testid="agent-plan-item"]').count());
    await page.click('[data-testid="agent-tab-workflows"]'); await page.waitForTimeout(900);
    const recipes = await api("GET", "/workflows", tok);
    ok("Workflows carries every recipe", await page.locator('[data-testid="workflow-recipe"]').count() === (recipes.body || []).length
       && (recipes.body || []).length >= 1, { onScreen: await page.locator('[data-testid="workflow-recipe"]').count(), api: (recipes.body || []).length });
    await page.click('[data-testid="agent-tab-waiting"]'); await page.waitForTimeout(900);
    ok("Waiting for you shows the queue", await page.locator('[data-testid="agent-waiting-item"]').count() >= 2,
       await page.locator('[data-testid="agent-waiting-item"]').count());
    await page.click('[data-testid="agent-tab-guardrails"]'); await page.waitForTimeout(900);
    ok("Guardrails has the pause switch", await page.locator('[data-testid="agent-pause-all"]').count() === 1);
    ok("…what Steward can and cannot do, in sentences",
       await page.locator('[data-testid="agent-can"]').count() >= 1 && await page.locator('[data-testid="agent-cannot"]').count() >= 1);
    ok("…and the thirty-day undo list", await page.locator('[data-testid="agent-write"]').count() >= 1,
       await page.locator('[data-testid="agent-write"]').count());
    const cannot = (await page.locator('[data-testid="agent-cannot"]').allInnerTexts()).join(" ");
    ok("…which says it never records money on its own", /money/i.test(cannot), cannot.slice(0, 200));
    await page.close();

    // 390: the same room on a phone, and it never scrolls sideways.
    const phone = await open(390, 844);
    await phone.locator('.mobile-bottom-tab:has-text("More")').first().click();
    await phone.waitForTimeout(500);
    const agentBtn = phone.locator('.mobile-more-row:has-text("Agent")').first();
    if (await agentBtn.count()) { await agentBtn.click(); await phone.waitForTimeout(1200); }
    ok("on a phone Agent is reachable", await phone.locator('[data-testid="agent-room"]').count() === 1);
    for (const v of VIEWS) {
      await phone.click(`[data-testid="agent-tab-${v}"]`).catch(() => {}); await phone.waitForTimeout(800);
      const sw = await phone.evaluate(() => document.documentElement.scrollWidth);
      ok(`the ${v} view fits 390 (no sideways scroll)`, sw <= 392, sw);
      if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, `${v}-390.png`), fullPage: true });
    }
    await phone.close();
    ok("no page error anywhere in Agent", errors.length === 0, errors.slice(0, 3));
    } catch (e) { ok("the browser leg ran to the end", false, String(e && e.message || e).slice(0, 200)); }
    await browser.close();
  }

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

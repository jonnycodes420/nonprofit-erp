// FIX-2 D — THE AGENT ROOM, AND THE AGENT YOU CAN TURN ON.
//
// The 27 September walk (claude/FIX-2.md Part 0) found three things in Agent:
//
//   6. THE ROOM IS NOT DIRECTION 2. Jonathan picked the run sheet: a cream
//      sheet laid on ink, instructions down the left with each run's state,
//      the open plan as a checklist on the sheet with its confirm at the foot.
//      What shipped was a dark green room with a small cream card in it.
//   7. THE AGENT DEAD-ENDS. "build a report for my donors that gave last year
//      but not this year" answered "Planning anything else needs drafting,
//      which is not enabled for this organization yet": no way to turn it on,
//      no link to where it lives, nothing about who may. And on a server with
//      no ANTHROPIC_API_KEY it blamed the organisation for Steward's missing key.
//   8. THE AGENT REFUSES A READ. Opening a report touches no donor and moves no
//      money, so it needs no drafting: that instruction opens LYBUNT and writes
//      nothing.
//
//   §6  the room, in source and in the browser (sheet ≥ 70% of 1440, the list)
//   §7  drafting off says what it can do, who can turn it on, and where; the
//       key-missing line names the key; the switch writes through the one
//       endpoint with an actor in the audit log
//   §8  reads work without drafting, deterministically, and write nothing
//   §9  the browser: admin sees Turn on drafting, a non-admin sees who, the
//       LYBUNT instruction opens LYBUNT, 1440 and 390 without sideways scroll
//
// Needs the stack (BASE, DATABASE_URL); §6b/§9 need Playwright + a built dist
// and SKIP (exit 0) without them. The stack runs WITHOUT an ANTHROPIC_API_KEY,
// which is the key-missing case; the key-present cases are proven on the pure
// state function the route uses (agentShape.draftingState).

const fs = require("fs"), path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, BASE } = require("./helpers");

const root = path.join(__dirname, "..");
const ORG = "org_fx2dagent";
const PASS = "loadtest1234";
const ADMIN = "director@fx2dagent.example.org", STAFF = "staff@fx2dagent.example.org";
const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const DIST = path.join(root, "client", "dist", "index.html");
const SHOTS = process.env.FIX2D_SHOTS || "";
const haveBrowser = () => { try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; } return fs.existsSync(DIST); };
const LYBUNT_1 = "build a report for my donors that gave last year but not this year";
const LYBUNT_2 = "donors who gave last year but not this year";
const HAVE_KEY = !!process.env.ANTHROPIC_API_KEY;

// Every table a person or the agent writes with an actor, plus the audit log.
// "Writes nothing" is counted here, before and after.
const WRITES = ["agent_instructions", "agent_runs", "agent_writes", "agent_drafts", "saved_reports", "fin_audit_log",
  "gifts", "interactions", "threads", "tasks", "thank_you_drafts", "donors", "ai_log"];
const CHILD = ["agent_writes", "agent_drafts", "agent_runs", "agent_instructions", "saved_reports", "fin_audit_log",
  "thank_you_drafts", "interactions", "threads", "tasks", "fin_transactions", "gift_soft_credits", "gifts", "ai_log",
  "workflow_runs", "workflows", "donors", "users", "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}
async function counts() {
  const out = {};
  for (const t of WRITES) {
    const r = await q(`SELECT COUNT(*)::int AS n FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => [{ n: -1 }]);
    out[t] = r[0].n;
  }
  const [o] = await q(`SELECT ai_enabled, agent_paused_at FROM orgs WHERE id=$1`, [ORG]);
  out.org = JSON.stringify(o);
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

(async () => {
  console.log("fix2-d-agent");
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,receipt_address,ai_enabled)
           VALUES ($1,'Lantern Street Pantry','fx2dagent',1,'team','active','1 Main St, Lexington, KY 40507',false)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx2d_a',$1,$2,$3,'Rosa Delgado','admin')`,
    [ORG, ADMIN, bcrypt.hashSync(PASS, 4)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx2d_s',$1,$2,$3,'Sam Okafor','staff')`,
    [ORG, STAFF, bcrypt.hashSync(PASS, 4)]);
  // Six people: three gave last year only (LYBUNT), two gave both years, one only this year.
  const yr = new Date().getFullYear();
  const people = [["d_fx2d_1", "Maria Chen", [yr - 1]], ["d_fx2d_2", "Alan Brooks", [yr - 1]], ["d_fx2d_3", "June Park", [yr - 1]],
    ["d_fx2d_4", "Tom Reyes", [yr - 1, yr]], ["d_fx2d_5", "Ivy Moss", [yr - 1, yr]], ["d_fx2d_6", "Noor Haddad", [yr]]];
  for (const [id, name] of people)
    await q(`INSERT INTO donors (id,org_id,name,email,kind,stage,tags,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'person','cultivate','[]','u_fx2d_a','Rosa Delgado')`, [id, ORG, name, id + "@example.org"]);
  const tokA = await login(ADMIN, PASS);
  const tokS = await login(STAFF, PASS);
  // Gifts through the API (recordGift): "this year" is yesterday, "last year"
  // is a year and a day before that, so fiscal and calendar agree except on
  // the day after a year boundary.
  const ymd = d => d.toISOString().slice(0, 10);
  const thisYear = ymd(new Date(Date.now() - 86400000));
  const lastYear = ymd(new Date(Date.now() - 367 * 86400000));
  for (const [id, , years] of people)
    for (const y of years) {
      const g = await api("POST", `/donors/${id}/gifts`, tokA, { amount: 100, date: y === yr ? thisYear : lastYear, type: "cash" });
      if (g.status >= 300) console.log("  (gift fixture)", g.status, JSON.stringify(g.body).slice(0, 120));
    }
  const A = await import("../shared/agentShape.js");
  const agentSrc = fs.readFileSync(path.join(root, "client/src/components/Agent.jsx"), "utf8");
  const agentCode = stripComments(agentSrc);

  // ── §6 · THE ROOM IS DIRECTION 2 (source) ─────────────────────────────────
  console.log("\n— §6 · the room is the run sheet —");
  ok("the room lays the cream sheet over the whole room (agent-desk on T.bg)",
     /data-testid="agent-desk"/.test(agentCode) && /agent-desk[\s\S]{0,300}background: *T\.bg\b/.test(agentCode));
  ok("…the instructions list down the left (agent-instruction-list)", /data-testid="agent-instruction-list"/.test(agentCode));
  ok("…and no dark-green panel is left inside the room (no T.green900 / T.green650 / T.green800)",
     !/T\.green(900|650|800)\b/.test(agentCode), (agentCode.match(/T\.green(900|650|800)\b/g) || []).length);
  ok("…and no hex literal in Agent", !/#[0-9a-fA-F]{3,8}\b/.test(agentCode), (agentCode.match(/#[0-9a-fA-F]{3,8}\b/g) || []).slice(0, 3));

  // ── §7 · DRAFTING OFF IS NOT A DEAD END ──────────────────────────────────
  console.log("\n— §7 · drafting off says what, who and where —");
  ok("the dead-end sentence is gone from Agent", !/not enabled for this organization yet/.test(agentCode));
  ok("agentShape has one function that states the drafting state", typeof A.draftingState === "function");
  if (typeof A.draftingState === "function") {
    const admins = ["Rosa Delgado"];
    const off = A.draftingState({ configured: true, enabled: false, paused: false, isAdmin: true, admins });
    ok("key set, org switch off → reason ai_disabled", off.reason === "ai_disabled" && off.on === false, off);
    ok("…says what Steward can do NOW (reports, find, count, explain)",
       /report/i.test(off.canNow || "") && /find/i.test(off.canNow || "") && /count/i.test(off.canNow || ""), off.canNow);
    ok("…and what drafting would add", /draft/i.test(off.adds || ""), off.adds);
    ok("…an admin may turn it on, in Guardrails", off.canTurnOn === true && /Guardrails/.test(off.where || ""), off);
    const offStaff = A.draftingState({ configured: true, enabled: false, paused: false, isAdmin: false, admins });
    ok("…a non-admin may not, and is told WHO can, by name",
       offStaff.canTurnOn === false && /Rosa Delgado/.test(offStaff.whoCan || ""), offStaff);
    const noKey = A.draftingState({ configured: false, enabled: true, paused: false, isAdmin: true, admins });
    ok("no key → reason ai_no_key, and the sentence NAMES the key",
       noKey.reason === "ai_no_key" && /ANTHROPIC_API_KEY/.test(noKey.sentence || ""), noKey);
    ok("…and does not blame the organisation or offer the org switch",
       !/organi[sz]ation/i.test(noKey.sentence || "") && noKey.canTurnOn === false, noKey);
    const noKeyOff = A.draftingState({ configured: false, enabled: false, paused: false, isAdmin: true, admins });
    ok("…even when the org switch is ALSO off, the missing key is the reason", noKeyOff.reason === "ai_no_key", noKeyOff);
    const on = A.draftingState({ configured: true, enabled: true, paused: false, isAdmin: false, admins });
    ok("key set and switch on → drafting on", on.on === true && on.reason === null, on);
    const paused = A.draftingState({ configured: true, enabled: true, paused: true, isAdmin: true, admins });
    ok("paused → reason agent_paused", paused.reason === "agent_paused", paused);
  }

  const c0 = await counts();
  const stA = await api("GET", "/agent/status", tokA);
  ok("GET /agent/status answers the admin", stA.status === 200, stA.status);
  const sA = stA.body || {};
  ok("…this server has no key, so the reason is the key", HAVE_KEY || (sA.reason === "ai_no_key" && /ANTHROPIC_API_KEY/.test(sA.sentence || "")), sA);
  ok("…it reports the org's own switch separately (enabled:false)", sA.enabled === false && sA.configured === HAVE_KEY, sA);
  ok("…it names who can turn drafting on", Array.isArray(sA.admins) && sA.admins.includes("Rosa Delgado") && !sA.admins.includes("Sam Okafor"), sA.admins);
  ok("…and the admin may", sA.isAdmin === true, sA.isAdmin);
  const stS = await api("GET", "/agent/status", tokS);
  ok("a non-admin gets the same facts and isAdmin:false", stS.status === 200 && stS.body.isAdmin === false
     && (stS.body.admins || []).includes("Rosa Delgado"), stS.body);
  await api("GET", "/agent/plans", tokA);
  await api("GET", "/agent/status", tokS);
  ok("a GET writes nothing (status and plans, every actor table and the audit log)", same(c0, await counts()), { before: c0, after: await counts() });

  // An instruction that needs the model, with no key: the answer names the key.
  const needsModel = await api("POST", "/agent/instructions", tokA, { text: "Draft a thank-you to everyone who gave this month" });
  ok("a drafting instruction with no key is 503 agent_unavailable (unchanged contract)",
     HAVE_KEY || (needsModel.status === 503 && needsModel.body.error === "agent_unavailable"), needsModel.body);
  ok("…with reason ai_no_key and a sentence naming ANTHROPIC_API_KEY, not the permission",
     HAVE_KEY || (needsModel.body.reason === "ai_no_key" && /ANTHROPIC_API_KEY/.test(needsModel.body.sentence || "")
       && !/not enabled for this organi[sz]ation/i.test(needsModel.body.sentence || "")), needsModel.body);

  // The switch: one endpoint, admin only, with the actor in the audit log.
  const al0 = (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1`, [ORG]))[0].n;
  const staffFlip = await api("PATCH", "/org/ai-settings", tokS, { enabled: true });
  ok("a non-admin cannot flip the switch (403)", staffFlip.status === 403, staffFlip.status);
  const flip = await api("PATCH", "/org/ai-settings", tokA, { enabled: true });
  ok("the admin can (200)", flip.status === 200 && flip.body.enabled === true, flip.body);
  const al = await q(`SELECT user_id, user_name, action, entity_type FROM fin_audit_log WHERE org_id=$1 ORDER BY created_at DESC`, [ORG]);
  ok("…and the audit log says who turned drafting on", al.length === al0 + 1 && al[0].user_id === "u_fx2d_a"
     && al[0].user_name === "Rosa Delgado" && al[0].entity_type === "ai_drafting" && al[0].action === "turned_on", al[0]);
  await api("PATCH", "/org/ai-settings", tokA, { enabled: false });
  const al2 = await q(`SELECT action FROM fin_audit_log WHERE org_id=$1 AND entity_type='ai_drafting' ORDER BY created_at DESC`, [ORG]);
  ok("…and who turned it off", al2[0] && al2[0].action === "turned_off", al2[0]);
  const settingsSrc = fs.readFileSync(path.join(root, "client/src/components/Settings.jsx"), "utf8");
  ok("Settings and Guardrails write the SAME endpoint (/org/ai-settings)",
     /\/org\/ai-settings/.test(settingsSrc) && /\/org\/ai-settings/.test(agentCode));

  // ── §8 · A READ NEEDS NO DRAFTING ─────────────────────────────────────────
  console.log("\n— §8 · reads work without drafting —");
  ok("agentShape recognises a read without a model", typeof A.readIntent === "function");
  if (typeof A.readIntent === "function") {
    for (const t of [LYBUNT_1, LYBUNT_2, "Who gave last year and not yet this year?", "open LYBUNT"])
      ok(`"${t}" → LYBUNT`, (A.readIntent(t) || {}).report === "lybunt", A.readIntent(t));
    ok(`"show me SYBUNT" → SYBUNT`, (A.readIntent("show me SYBUNT") || {}).report === "sybunt");
    ok(`"who are our top donors" → Top Donors`, (A.readIntent("who are our top donors") || {}).report === "top-donors");
    ok(`"how many donors gave last year but not this year" → a COUNT of LYBUNT`,
       (A.readIntent("how many donors gave last year but not this year") || {}).kind === "count"
       && (A.readIntent("how many donors gave last year but not this year") || {}).report === "lybunt");
    ok(`"what does retention mean" → explain`, (A.readIntent("what does retention mean") || {}).kind === "explain");
    ok(`"find Maria Chen" → find`, (A.readIntent("find Maria Chen") || {}).kind === "find");
    // A drafting instruction ABOUT the LYBUNT people is not a read.
    for (const t of ["Find the donors who gave last year and not this year, and draft each a note",
      "Draft a thank-you to everyone who gave last year but not this year", "Email the donors who gave last year but not this year"])
      ok(`"${t.slice(0, 48)}…" is NOT a read`, A.readIntent(t) === null, A.readIntent(t));
    ok("gift news is not a read", A.readIntent("Just got a gift from Maria Chen, 50 dollars") === null);
  }

  const lyb = await api("GET", "/reports/lybunt?yearMode=fiscal", tokA);
  const lybCount = (lyb.body && lyb.body.rows || []).length;
  for (const text of [LYBUNT_1, LYBUNT_2]) {
    const before = await counts();
    const r = await api("POST", "/agent/instructions", tokA, { text });
    ok(`"${text}" with drafting OFF is answered, not refused (200)`, r.status === 200, { status: r.status, body: r.body });
    const read = (r.body && r.body.read) || {};
    ok("…it opens LYBUNT (the report's own id)", read.kind === "report" && read.report === "lybunt", read);
    ok("…its count is the LYBUNT report's own count", read.count === lybCount && lybCount === 3, { read: read.count, report: lybCount });
    ok("…it offers to keep it in Your reports (std:lybunt)", read.savedReport === "std:lybunt", read);
    ok("…it says it wrote nothing", /nothing/i.test(read.sentence || "") || /wrote nothing|changes nothing/i.test(read.note || ""), read);
    ok("…and it WROTE NOTHING: every actor table and the audit log unchanged", same(before, await counts()), { before, after: await counts() });
  }
  const staffRead = await api("POST", "/agent/instructions", tokS, { text: LYBUNT_2 });
  ok("a non-admin can read too", staffRead.status === 200 && staffRead.body.read && staffRead.body.read.report === "lybunt", staffRead.body);
  const find = await api("POST", "/agent/instructions", tokA, { text: "find Maria Chen" });
  ok("\"find Maria Chen\" opens her record, drafting off",
     find.status === 200 && find.body.read && find.body.read.kind === "person" && find.body.read.donorId === "d_fx2d_1", find.body);
  const cnt = await api("POST", "/agent/instructions", tokA, { text: "how many donors gave last year but not this year" });
  ok("a count is answered with the report's count", cnt.status === 200 && cnt.body.read && cnt.body.read.count === lybCount, cnt.body);
  const ex = await api("POST", "/agent/instructions", tokA, { text: "what does LYBUNT mean" });
  ok("explain a number: the definition sentence", ex.status === 200 && ex.body.read && /last year/i.test(ex.body.read.sentence || ""), ex.body);
  const fuzzy = await api("POST", "/agent/instructions", tokA, { text: "which donors live near the river and like jazz" });
  ok("a read Steward cannot route without a model says so, naming the key when it is missing",
     HAVE_KEY || (fuzzy.status === 503 && /ANTHROPIC_API_KEY/.test(fuzzy.body.sentence || "")), fuzzy.body);
  await q(`UPDATE orgs SET agent_paused_at=NOW() WHERE id=$1`, [ORG]);
  const pausedRead = await api("POST", "/agent/instructions", tokA, { text: LYBUNT_2 });
  ok("pause still stops everything, reads included (503 agent_paused)", pausedRead.status === 503 && pausedRead.body.error === "agent_paused", pausedRead.body);
  await q(`UPDATE orgs SET agent_paused_at=NULL WHERE id=$1`, [ORG]);
  const refund = await api("POST", "/agent/instructions", tokA, { text: "refund Maria Chen's gift from last year" });
  ok("the money refusal still comes first", refund.status === 400 && refund.body.error === "money_instruction", refund.body);

  // ── §9 · THE BROWSER ─────────────────────────────────────────────────────
  console.log("\n— §9 · the browser —");
  if (!haveBrowser()) {
    console.log("  SKIP — no Playwright or client/dist (browser leg)");
  } else {
    const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
    const browser = await chromium.launch();
    const errors = [];
    async function open(email, width, height, statusOverride) {
      const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: "block" });
      page.on("pageerror", e => { if (!/Unexpected token '<'/.test(e.message)) errors.push(e.message.slice(0, 160)); });
      if (statusOverride) {
        await page.route("**/agent/status", async route => {
          const res = await route.fetch();
          const body = await res.json();
          await route.fulfill({ response: res, json: statusOverride(body) });
        });
      }
      const lr = await page.request.post(BASE + "/auth/login", { data: { email, password: PASS } });
      const lj = await lr.json();
      await page.goto(APP, { waitUntil: "domcontentloaded" });
      await page.evaluate(d => {
        localStorage.setItem("npe_token", d.token);
        localStorage.setItem("npe_user", JSON.stringify(d.user));
        localStorage.setItem("npe_org", JSON.stringify(d.org));
      }, lj);
      await page.goto(APP, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      if (width > 760) await page.locator('.app-sidebar button:has-text("Agent")').first().click();
      else {
        await page.locator('.mobile-bottom-tab:has-text("More")').first().click();
        await page.waitForTimeout(400);
        await page.locator('.mobile-more-row:has-text("Agent")').first().click();
      }
      await page.waitForSelector('[data-testid="agent-room"]', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(900);
      return page;
    }
    const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name) }); } };
    // As the server would answer with a key set and the org's switch off.
    const keySetOff = b => ({ ...b, ...A.draftingState({ configured: true, enabled: false, paused: false, isAdmin: b.isAdmin, admins: b.admins }), configured: true, enabled: false });
    try {
      // THE KEY IS MISSING (this stack): one line that names it.
      const p0 = await open(ADMIN, 1440, 900);
      const keyLine = p0.locator('[data-testid="agent-key-missing"]');
      ok("key missing: the room says so in one line", await keyLine.count() === 1);
      const keyText = await keyLine.innerText().catch(() => "");
      ok("…that names ANTHROPIC_API_KEY, not the permission", /ANTHROPIC_API_KEY/.test(keyText) && !/organi[sz]ation/i.test(keyText), keyText);
      ok("…with no Turn on drafting button (the org switch is not the cause)", await p0.locator('[data-testid="agent-turn-on-drafting"]').count() === 0);
      // §6b — the layout.
      const desk = await p0.locator('[data-testid="agent-desk"]').boundingBox().catch(() => null);
      ok("§6 the sheet takes the room: ≥ 70% of the 1440 viewport", !!desk && desk.width >= 0.7 * 1440, desk);
      await shot(p0, "key-missing-1440.png");

      // THE LYBUNT INSTRUCTION, DRAFTING OFF, ON SCREEN.
      const before = await counts();
      await p0.fill('[data-testid="agent-ask-bar"]', LYBUNT_1);
      await p0.keyboard.press("Enter");
      await p0.waitForSelector('[data-testid="agent-read"]', { timeout: 8000 }).catch(() => {});
      const readText = await p0.locator('[data-testid="agent-read"]').innerText().catch(() => "");
      ok("the LYBUNT instruction answers on the sheet", /LYBUNT/.test(readText) && /\b3\b/.test(readText), readText.slice(0, 300));
      ok("…offers to keep it in Your reports", await p0.locator('[data-testid="agent-read-save"]').count() === 1);
      ok("…and no refusal", await p0.locator('[data-testid="agent-refusal"]').count() === 0);
      const layout = await p0.evaluate(() => {
        const d = document.querySelector('[data-testid="agent-desk"]');
        const l = document.querySelector('[data-testid="agent-instruction-list"]');
        return { list: !!l, listInDesk: !!(d && l && d.contains(l)) };
      });
      ok("§6 the instruction list is present, on the sheet", layout.list && layout.listInDesk, layout);
      await shot(p0, "lybunt-read-1440.png");
      const reportReq = p0.waitForRequest(r => /\/reports\/lybunt/.test(r.url()), { timeout: 8000 }).catch(() => null);
      await p0.click('[data-testid="agent-read-open"]');
      ok("Open LYBUNT lands on Reports and runs LYBUNT", !!(await reportReq));
      await p0.waitForTimeout(800);
      ok("…and the whole walk wrote nothing", same(before, await counts()), { before, after: await counts() });
      await p0.close();

      // A PLAN OPEN, on the sheet, with its confirm at the foot (gift news needs no key).
      const pp = await open(ADMIN, 1440, 900);
      await pp.fill('[data-testid="agent-ask-bar"]', "Just got a cheque from Maria Chen, 75 dollars");
      await pp.keyboard.press("Enter");
      await pp.waitForSelector('[data-testid="agent-sheet-confirm"]', { timeout: 8000 }).catch(() => {});
      const foot = await pp.evaluate(() => {
        const s = document.querySelector('[data-testid="agent-sheet"]');
        const b = document.querySelector('[data-testid="agent-sheet-confirm"]');
        const steps = [...document.querySelectorAll('[data-testid="agent-step"]')];
        if (!s || !b || !steps.length) return null;
        return { inSheet: s.contains(b), below: b.getBoundingClientRect().top >= steps[steps.length - 1].getBoundingClientRect().bottom };
      });
      ok("§6 the open plan is a checklist with its confirm at the foot", !!foot && foot.inSheet && foot.below, foot);
      await shot(pp, "plan-open-1440.png");
      await pp.close();

      // ADMIN, KEY SET, SWITCH OFF: Turn on drafting links to the setting in Guardrails.
      const pa = await open(ADMIN, 1440, 900, keySetOff);
      const turnOn = pa.locator('[data-testid="agent-turn-on-drafting"]');
      ok("drafting off, admin: Turn on drafting is offered", await turnOn.count() === 1);
      const offText = await pa.locator('[data-testid="agent-drafting"]').innerText().catch(() => "");
      ok("…with what Steward can do now and what drafting adds", /report/i.test(offText) && /draft/i.test(offText), offText.slice(0, 300));
      await shot(pa, "drafting-off-admin-1440.png");
      await turnOn.click(); await pa.waitForTimeout(900);
      ok("…it opens Guardrails at the exact setting",
         await pa.locator('[data-testid="agent-view-guardrails"]').count() === 1
         && await pa.locator('[data-testid="agent-drafting-setting"]').count() === 1);
      const tog = pa.locator('[data-testid="agent-drafting-toggle"]');
      ok("…where the switch is", await tog.count() === 1);
      const al0b = (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1 AND entity_type='ai_drafting'`, [ORG]))[0].n;
      await tog.click(); await pa.waitForTimeout(900);
      const [o1] = await q(`SELECT ai_enabled FROM orgs WHERE id=$1`, [ORG]);
      const al1b = (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1 AND entity_type='ai_drafting'`, [ORG]))[0].n;
      ok("…and pressing it turns drafting on for the org, with an audit row", o1.ai_enabled === true && al1b === al0b + 1, { o1, al0b, al1b });
      await shot(pa, "guardrails-setting-1440.png");
      await q(`UPDATE orgs SET ai_enabled=false WHERE id=$1`, [ORG]);
      await pa.close();

      // NON-ADMIN: who can, and no toggle anywhere.
      const ps = await open(STAFF, 1440, 900, keySetOff);
      const who = await ps.locator('[data-testid="agent-drafting-who"]').innerText().catch(() => "");
      ok("drafting off, non-admin: sees who can turn it on, by name", /Rosa Delgado/.test(who), who);
      ok("…and no Turn on drafting button", await ps.locator('[data-testid="agent-turn-on-drafting"]').count() === 0);
      await shot(ps, "drafting-off-staff-1440.png");
      await ps.click('[data-testid="agent-tab-guardrails"]'); await ps.waitForTimeout(800);
      ok("…and no toggle in Guardrails either", await ps.locator('[data-testid="agent-drafting-toggle"]').count() === 0
         && /Rosa Delgado/.test(await ps.locator('[data-testid="agent-drafting-setting"]').innerText().catch(() => "")));
      await ps.close();

      // 390: stacks, no sideways scroll, in every state.
      for (const [label, email, ov] of [["key-missing", ADMIN, null], ["drafting-off-admin", ADMIN, keySetOff], ["drafting-off-staff", STAFF, keySetOff]]) {
        const m = await open(email, 390, 844, ov);
        ok(`390 (${label}): the room is there`, await m.locator('[data-testid="agent-room"]').count() === 1);
        const sw = await m.evaluate(() => document.documentElement.scrollWidth);
        ok(`390 (${label}): no sideways scroll`, sw <= 392, sw);
        await shot(m, `${label}-390.png`);
        if (label === "key-missing") {
          await m.fill('[data-testid="agent-ask-bar"]', "Just got a cheque from Alan Brooks, 40 dollars");
          await m.keyboard.press("Enter");
          await m.waitForSelector('[data-testid="agent-sheet-confirm"]', { timeout: 8000 }).catch(() => {});
          const sw2 = await m.evaluate(() => document.documentElement.scrollWidth);
          ok("390 with a plan open: no sideways scroll", sw2 <= 392, sw2);
          await shot(m, "plan-open-390.png");
          for (const v of ["ask", "workflows", "waiting", "guardrails"]) {
            await m.click(`[data-testid="agent-tab-${v}"]`).catch(() => {}); await m.waitForTimeout(700);
            const sw3 = await m.evaluate(() => document.documentElement.scrollWidth);
            ok(`390 ${v}: no sideways scroll`, sw3 <= 392, sw3);
          }
        }
        await m.close();
      }
      ok("no page error anywhere", errors.length === 0, errors.slice(0, 3));
    } catch (e) { ok("the browser leg ran to the end", false, String(e && e.message || e).slice(0, 200)); }
    await browser.close();
  }

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

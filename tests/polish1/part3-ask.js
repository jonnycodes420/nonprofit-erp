// tests/polish1/part3-ask.js · POLISH-1 Part 3. ASK HAS ONE RULE FOR CONVERSATIONS.
//
// Muse asked about Emily Jackson's call twice. One pass quoted it, the next
// said "I can't pull up what was said with Emily Jackson". The cause: a
// conversation question typed without a question mark ("Summarize my call
// with Emily") went from Home to the Agent, whose model refused, while "What
// did we talk about with Emily?" went to Ask, which quoted the record.
//
//   §1 the same conversation question, asked three times in Ask and three
//      times of the Agent, gets the same kind of answer every time: the
//      conversations on the record, with quotes.
//   §2 every quote opens the line it came from: its id is an interaction on
//      that person's record, and its link anchors to that line.
//   §3 an instruction ("Log a call with Wren") is still work, not a question.
//   §4 a long refusal is cut where a word ends, never in the middle of one.
//   §5 (browser) Enter submits the Home box, the answer scrolls into view with
//      a ready line, at 1440 and at 390. Skips like every browser leg.
//
// HOW IT GOES RED ON MAIN: §1 the Agent leg plans with the model (here, with
// no key, a 503 "drafting" refusal) instead of quoting; the Ask leg returns no
// `quotes`; §4 compilePlan slices at 200 characters mid-word.
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");

const ORG = "org_polish1ask";
const NAME = "Wren Halloway";

module.exports = async function part3(h) {
  const { ok, q, api, BASE } = h;
  const wipe = async () => {
    for (const t of ["question_log", "agent_instructions", "threads", "interactions", "gifts", "donors", "user_sessions", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  };
  await wipe();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,ai_enabled)
           VALUES ($1,'Polish Ask Fixture',$2,1,'active','team','America/New_York',false)`, [ORG, "polish1-ask"]);
  const email = `staff@${ORG}.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ask Staff','admin')`,
    [`u_${ORG}`, ORG, email, bcrypt.hashSync("loadtest1234", 4)]);
  const wren = `d_${ORG}_wren`, other = `d_${ORG}_other`;
  for (const [id, name] of [[wren, NAME], [other, "Otto Quill"]])
    await q(`INSERT INTO donors (id,org_id,name,city,stage,created_by,created_by_name) VALUES ($1,$2,$3,'Salem','active','system:test','test')`, [id, ORG, name]);
  const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const INTS = [
    [`i_${ORG}_call`, wren, "call", day(3), "She asked for the impact report and wants a tour of the studio in the spring, after the gala."],
    [`i_${ORG}_note`, wren, "note", day(9), "Prefers email to phone. Her daughter joined the youth choir this fall."],
    [`i_${ORG}_meet`, wren, "meeting", day(20), "Coffee at the studio. Talked through the capital campaign and her giving plans for next year."],
    [`i_${ORG}_otto`, other, "call", day(2), "Otto's call, which must never appear in Wren's answer."],
  ];
  for (const [id, d, type, date, note] of INTS)
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,date,note,logged_by_name,created_by) VALUES ($1,$2,$3,$4,$5,$6,'Ask Staff','system:test')`,
      [id, ORG, d, type, date, note]);
  const wrenIds = INTS.filter(x => x[1] === wren).map(x => x[0]);

  const li = await api("POST", "/auth/login", null, { email, password: "loadtest1234" });
  const tok = li.body && li.body.token;
  try {
    // §1 + §2 — the same question, six times, two doors.
    const QUESTION = `Summarize my call with ${NAME}`;
    const shapes = [];
    const checkQuotes = (label, quotes) => {
      const ids = (quotes || []).map(x => x.id);
      ok(`§2 ${label}: three quotes, each one of ${NAME}'s own lines`, ids.length === 3 && ids.every(id => wrenIds.includes(id)), ids);
      ok(`§2 ${label}: each quote opens its line on her record`,
        (quotes || []).length === 3 && quotes.every(x => x.donorId === wren && x.open && x.open.selectDonorId === wren && x.open.anchor === `item-${x.id}`), quotes);
      return ids.join(",");
    };
    for (let n = 1; n <= 3; n++) {
      const a = await api("POST", "/ask", tok, { text: QUESTION });
      ok(`§1 Ask, pass ${n}: answered from her conversations`, a.status === 200 && a.body.answered === true && a.body.person && a.body.person.intent === "talked"
        && /conversations? with Wren Halloway/.test(a.body.sentence || ""), { status: a.status, body: a.body && (a.body.sentence || a.body.error) });
      shapes.push("ask:" + checkQuotes(`Ask pass ${n}`, a.body.quotes));
    }
    for (let n = 1; n <= 3; n++) {
      const a = await api("POST", "/agent/instructions", tok, { text: QUESTION });
      ok(`§1 Agent, pass ${n}: the same answer, not a refusal`, a.status === 200 && a.body.read && a.body.read.kind === "talked"
        && a.body.read.donorId === wren && /conversations? with Wren Halloway/.test(a.body.read.sentence || ""), { status: a.status, body: a.body });
      shapes.push("agent:" + checkQuotes(`Agent pass ${n}`, a.body.read && a.body.read.quotes));
    }
    const kinds = new Set(shapes.map(s => s.split(":")[1]));
    ok("§1 all six answers quote the same three lines", kinds.size === 1 && shapes.length === 6 && [...kinds][0].split(",").length === 3, shapes);
    // The quote's line is on the record it opens.
    const rec = await api("GET", `/donors/${wren}`, tok);
    const onRecord = new Set(((rec.body && rec.body.interactions) || []).map(i => i.id));
    ok("§2 every quoted line is on the record the link opens", wrenIds.every(id => onRecord.has(id)), [...onRecord]);
    const ask2 = await api("POST", "/ask", tok, { text: `What did we talk about with ${NAME}?` });
    ok("§1 the question in other words takes the same path", ask2.body && ask2.body.person && ask2.body.person.intent === "talked"
      && (ask2.body.quotes || []).length === 3 && ask2.body.quotes.map(x => x.id).join(",") === shapes[0].split(":")[1], ask2.body && ask2.body.quotes);

    // §3
    const G = await import(path.join(__dirname, "..", "..", "shared", "askGuide.js"));
    ok("§3 an instruction is work, not a question about what was said", G.personIntent(`Log a call with ${NAME}, she wants a tour`) !== "talked"
      && G.personIntent(`Plan a meeting with ${NAME}`) !== "talked", null);

    // §4
    const A = await import(path.join(__dirname, "..", "..", "shared", "agentShape.js"));
    const long = "That is a question rather than work and Steward answers it in Reports, so try asking it to open the retention report and the board pack together, and the LYBUNT list as well, before anything is planned here at all today";
    const cut = A.compilePlan([], { cannot: long }).cannot;
    const lastWord = cut.replace(/[….]+$/, "").split(" ").pop();
    ok("§4 a long refusal is cut where a word ends", cut.length <= 202 && long.split(/[ ,]+/).includes(lastWord) && /…$/.test(cut), cut);
    const clip = typeof G.clipAtWord === "function" ? G.clipAtWord("open the retention report today", 22) : null;
    ok("§4 a quote is cut where a word ends", clip === "open the retention…", clip);

    // §5 — the browser leg.
    await browserLeg(h, tok, li.body, QUESTION);
  } finally {
    await wipe();
  }
};

async function browserLeg(h, tok, login, QUESTION) {
  const { ok, BASE, browserLegOrSkip } = h;
  const ROOT = path.join(__dirname, "..", "..");
  const DIST = path.join(ROOT, "client", "dist");
  const APP = process.env.APP_URL || "http://localhost:4173";
  const assetDir = path.join(DIST, "assets");
  const distJs = fs.existsSync(assetDir) ? fs.readdirSync(assetDir).filter(f => f.endsWith(".js")) : [];
  if (!distJs.some(f => fs.readFileSync(path.join(assetDir, f), "utf8").includes(BASE.replace(/^https?:\/\//, ""))))
    return browserLegOrSkip("client/dist not built against the local API", "§5");
  let chromium;
  try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); }
  catch { return browserLegOrSkip("Playwright not found (set PLAYWRIGHT_DIR)", "§5"); }
  const browser = await chromium.launch();
  const shots = process.env.POLISH1_SHOTS || null;
  try {
    for (const [w, hgt, label] of [[1440, 900, "1440"], [390, 844, "390"]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, serviceWorkers: "block" });
      await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
        [tok, JSON.stringify(login.user || {}), JSON.stringify(login.org || {})]);
      const page = await ctx.newPage();
      await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
      const box = page.locator('[data-testid="ask-hero-input"]');
      await box.waitFor({ timeout: 20000 });
      await box.fill(QUESTION);
      await box.press("Enter");
      const ready = await page.locator('[data-testid="ask-ready"]').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
      ok(`§5 ${label}: Enter submits the Home box and the answer says it is ready`, ready, page.url());
      await page.waitForTimeout(900);   // the smooth scroll settles
      const inView = await page.locator('[data-testid="ask-quote"]').first().evaluate(el => {
        const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight;
      }).catch(() => false);
      ok(`§5 ${label}: the answer's first quote is on screen without scrolling`, inView, null);
      if (shots) await page.screenshot({ path: path.join(shots, `part3-ask-home-${label}.png`) });
      // AGENT-5: the Agent's Ask tab is gone with the Agent page; its old
      // address lands on Home with Atlas open over it.
      await page.goto(`${APP}/app/agent?view=ask`, { waitUntil: "domcontentloaded", timeout: 45000 });
      const atlasOpen = await page.locator('[data-atlas="panel"]').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
      ok(`§5 ${label}: the old Agent address lands on Home with Atlas open`, atlasOpen && /\/dashboard$/.test(new URL(page.url()).pathname), page.url());
      await ctx.close();
    }
  } finally { await browser.close(); }
}

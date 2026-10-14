// tests/polish2-voice.test.js · POLISH-2. EVERY WORD SOUNDS LIKE US.
//
// The copy and craft sweep from Muse's PREMIUM-1 audit (docs/polish-1/
// PREMIUM-1.pdf). Five guards, each of which failed on main (1f7937b):
//   §spell    no en-GB spelling in a sentence a person reads (tests/polish2/enGb.js)
//   §iso      no raw ISO date put into on-screen text (tests/polish2/isoDates.js)
//   §glued    no word glued to an expression across a JSX line break (tests/polish2/glued.js)
//   §log      "Log a call" is the only label for logging a conversation
//   §tags     no machine tag reaches Journeys or Ask (has-refused-rows, shares-id,
//             "Tagged recaptured", "not deceased"), by API and as rendered
// The browser leg renders Home, Journeys, Imports and Reports and reads the
// text the way she does: no ISO date, no glued word, no internal tag, no
// unexplained LYBUNT/SYBUNT.
//
// HOW IT GOES RED: put "organisation" or "cheque" back in any label; render
// `{j.started_at}` raw on Journeys; split "this {x}" across a line again; put
// "Log a conversation" back on the profile button; drop the internal-tag filter
// from GET /journeys. Each was red on main; the PR says how.
//
// Standard scratch stack (tests/README.md); the browser leg (playwright) needs client/dist
// built against $BASE and PLAYWRIGHT_DIR, as every browser leg does.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const h = require("./helpers");
const { ok, api, q } = h;
const { scanEnGb } = require("./polish2/enGb");
const { scanIsoDates, ISO_IN_TEXT, NUMERIC_DATE_IN_TEXT } = require("./polish2/isoDates");
const { scanGlued, GLUED_RENDERED } = require("./polish2/glued");
const B = require("./polish1/browser-p567");

const ROOT = path.join(__dirname, "..");
const ORG = "org_polish2_voice";
const ADMIN = "admin@polish2-voice.test";
const MACHINE = /has-refused-rows|shares-id:|\bTagged\b|not deceased/i;

const show = list => list.slice(0, 8).map(x => typeof x === "string" ? x : `${x.file}:${x.line} ${String(x.text || x.word || "").slice(0, 90)}`);

async function wipe() {
  const tables = (await q(`SELECT table_name FROM information_schema.columns
                            WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) return;
  }
}

// Every visible string in client/src and the help articles that names the
// action of logging a conversation. Comments are skipped.
function logLabels() {
  const hits = [];
  const files = [path.join(ROOT, "shared", "helpArticles.js")];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "marketing") walk(p); } else if (/\.(jsx?|mjs)$/.test(e.name)) files.push(p);
  } };
  walk(path.join(ROOT, "client", "src"));
  for (const f of files) {
    // Block comments (including ones that span lines) become blank lines of
    // the same count, so line numbers still point at the source.
    const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "));
    src.split("\n").forEach((line, i) => {
      const code = line.replace(/(^|[^:\\])\/\/.*$/, "$1");
      if (/Log a conversation/i.test(code)) hits.push({ file: path.relative(ROOT, f), line: i + 1, text: line.trim() });
    });
  }
  return hits;
}

(async () => {
  console.log("POLISH-2: every word sounds like us\n");

  // §spell, §iso, §glued, §log — the source, read once.
  const gb = scanEnGb(ROOT);
  ok("§spell no en-GB spelling in a sentence a person reads", gb.length === 0, show(gb));
  const iso = scanIsoDates(ROOT);
  ok("§iso no raw ISO date put into on-screen text", iso.length === 0, show(iso));
  const glued = scanGlued(ROOT);
  ok("§glued no word glued to an expression across a JSX line break", glued.length === 0, show(glued));
  const logs = logLabels();
  ok("§log \"Log a call\" is the only label (no \"Log a conversation\" left)", logs.length === 0, show(logs));

  // §tags — a person carrying both machine flags and one real tag.
  await wipe();
  try {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
             VALUES ($1,'Polish Two Voice Fixture','polish2-voice',1,'active','team','America/New_York')`, [ORG]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_polish2_voice',$1,$2,$3,'Dana Voice','admin')`,
      [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 4)]);
    // FIX-39: one sent and one scheduled campaign, so Communications has dates
    // for the numeric-date check to read. Not sent anywhere: rows only.
    await q(`INSERT INTO campaigns (id,org_id,name,type,subject,body,status,segment,sent_at,scheduled_at,recipient_count,open_count,created_by,created_by_name) VALUES
             ('cmp_p2v_sent',$1,'Spring note','appeal','Hello {{first_name}}','<p>Hi</p>','sent','{}',NOW() - INTERVAL '30 days',NULL,2,1,'system:test','test'),
             ('cmp_p2v_sched',$1,'Year-end note','appeal','Before the year ends','<p>Hi</p>','scheduled','{}',NULL,NOW() + INTERVAL '30 days',0,0,'system:test','test')`, [ORG]);
    await q(`INSERT INTO donors (id,org_id,name,email,stage,tags,created_by,created_by_name) VALUES
             ('d_p2v_1',$1,'Susan ANDERSON','susan@polish2-voice.test','steward','["Board","has-refused-rows:2","shares-id:D10003"]','system:test','test'),
             ('d_p2v_2',$1,'Heather Parker','heather@polish2-voice.test','steward','["Gala 2025"]','system:test','test')`, [ORG]);
    // Heather went quiet for two years and gave again this month: the walk's
    // "Tagged recaptured" case, asked of Ask.
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,payment_method,created_by,created_by_name) VALUES
             ('g_p2v_1',$1,'d_p2v_2',100,to_char(CURRENT_DATE - 900,'YYYY-MM-DD'),'Card','system:test','test'),
             ('g_p2v_2',$1,'d_p2v_2',50,to_char(CURRENT_DATE - 1,'YYYY-MM-DD'),'Card','system:test','test'),
             ('g_p2v_3',$1,'d_p2v_1',75,to_char(CURRENT_DATE - 30,'YYYY-MM-DD'),'Card','system:test','test')`, [ORG]);
    const tok = await h.login(ADMIN);

    const j = await api("GET", "/journeys", tok);
    const tags = (j.body && j.body.tags) || [];
    ok("§tags Journeys offers the real tags", j.status === 200 && tags.includes("Board") && tags.includes("Gala 2025"), tags);
    ok("§tags …and never a machine flag", !tags.some(t => MACHINE.test(t)), tags);

    const ask = await api("POST", "/ask", tok, { text: "who gave again this month after going quiet" });
    const askText = JSON.stringify(ask.body || {});
    ok("§tags Ask answers the comeback question", ask.status === 200, ask.status);
    ok("§tags …in words, with no machine tag or blunt filter word", !MACHINE.test(askText.replace(/"(rules|plan|filters?|lifecycle|key|kind)":("[^"]*"|\{[^}]*\})/g, "")), askText.slice(0, 600));

    // The browser leg: the screens as she reads them.
    const b = await B.open(h, "§render");
    if (b) {
      try {
        const { ctx, page } = await b.signedIn(ADMIN);
        const screens = [["Home", "/dashboard"], ["Journeys", "/app/journeys"], ["Imports", "/app/settings?section=imports"],
          ["Reports", "/app/reports?report=giving-summary"], ["Gave last year, not this year", "/app/reports?report=lybunt"],
          ["Communications", "/app/communications?subtab=campaigns"], ["Donors", "/donors"], ["Calendar", "/app/calendar"]];
        for (const [name, p] of screens) {
          await page.goto(b.APP + p, { waitUntil: "domcontentloaded", timeout: 45000 });
          await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(1200);
          const text = await page.evaluate(() => document.body.innerText);
          ok(`§render ${name} drew`, text.length > 150, text.length);
          const isoHits = [...text.matchAll(new RegExp(ISO_IN_TEXT.source, "g"))].map(m => text.slice(Math.max(0, m.index - 30), m.index + 14));
          ok(`§render ${name}: no ISO date on screen`, isoHits.length === 0, isoHits.slice(0, 5));
          // FIX-39: the numeric style too. "4/27/2026" beside "Oct 8, 2026" is two styles.
          const numHits = [...text.matchAll(new RegExp(NUMERIC_DATE_IN_TEXT.source, "g"))].map(m => text.slice(Math.max(0, m.index - 30), m.index + 14));
          ok(`§render ${name}: no numeric date on screen`, numHits.length === 0, numHits.slice(0, 5));
          const g = GLUED_RENDERED(text);
          ok(`§render ${name}: no glued words`, g.length === 0, g.slice(0, 5));
          ok(`§render ${name}: no machine tag`, !MACHINE.test(text), (text.match(MACHINE) || [])[0]);
          ok(`§render ${name}: no "Log a conversation"`, !/Log a conversation/i.test(text));
          const bunt = (text.match(/[^\n]*\b(LYBUNT|SYBUNT)\b[^\n]*/g) || []).filter(l => !/gave|given/i.test(l));
          ok(`§render ${name}: LYBUNT/SYBUNT never stand alone`, bunt.length === 0, bunt.slice(0, 3));
        }
        await ctx.close();
      } finally { await b.browser.close(); }
    }
  } catch (e) {
    ok("§tags ran to the end", false, String(e && e.stack || e).slice(0, 600));
  } finally { await wipe(); }

  await h.closeDb();
  h.summary();
})();

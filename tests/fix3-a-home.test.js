// FIX-3 A — HOME'S BOTTOM HALF. Run: node tests/fix3-a-home.test.js
//
// Jonathan walked prod after FIX-2 (27 September). The top of Home looked
// right; the bottom looked unfinished:
//
//   finding 1  beside Drift's institutional list, the thank-you queue and
//              "Tell Steward what to do", the right column was a tall blank
//              panel. The lower sections now run full width below the
//              two-column top (the Thread beside the Today rail).
//   finding 2  "One thank-you ready" read as broken: an indented grey
//              explainer with a rule that did not line up, a name, "$1", an
//              underlined "Read the draft" link and a large gap. Each draft is
//              now a row (person, amount, date, a BUTTON), the explainer is one
//              quiet line under the heading, and nothing sits under the rows.
//   finding 3  "Tell Steward what to do" was a second full ask (its own title,
//              its own sentence, a pale button) duplicating the Agent. Home
//              keeps a ONE-LINE entry that carries the text into Agent
//              (FIX-1's hand-off, onNavigate("agent",{agentText,autoAsk})).
//              The daily line says only what is true and useful: zero clauses
//              are dropped, singular and plural are right, and all zeros say
//              nothing ("1 draft is waiting for you.").
//   finding 4  (Home half) the entry's Go button is emerald, beside the input
//              at all times, disabled until there is text (never hidden), and
//              Enter submits.
//
//   §1 the daily line, pure (shared/agentShape.js dailyLine)
//   §2 the source (runs in CI, where there is no Playwright)
//   §3 the browser at 1440 and 390 on a fixture org with an institutional
//      list, one drafted thank-you and the one-line entry. SKIPs (exit 0)
//      where Playwright, the dist or the preview is missing.
//
// SHOTS_DIR=<dir> also writes the four viewport screenshots there.

const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + String(JSON.stringify(extra)).slice(0, 900) : "")); }
};

const ORG = "org_fx3ahome", EMAIL = "fx3ahome@example.org", PW = "loadtest1234";
const EMERALD = new Set(["rgb(13,92,58)", "rgba(13,92,58,1)"]);

(async () => {
  console.log("fix3-a-home");

  // ── §1 THE DAILY LINE ────────────────────────────────────────────────────
  console.log("\n— §1 · the daily line says only what is true and useful —");
  const A = await import(path.join(root, "shared/agentShape.js"));
  const L = o => A.dailyLine(o);
  ok("§1 every count zero says nothing", L({ did: 0, sent: 0, waiting: 0 }) === "", L({ did: 0, sent: 0, waiting: 0 }));
  ok("§1 no arguments says nothing", L() === "", L());
  ok("§1 one draft and nothing else: \"1 draft is waiting for you.\"",
     L({ did: 0, sent: 0, waiting: 1 }) === "1 draft is waiting for you.", L({ did: 0, sent: 0, waiting: 1 }));
  ok("§1 three drafts: \"3 drafts are waiting for you.\"",
     L({ did: 0, sent: 0, waiting: 3 }) === "3 drafts are waiting for you.", L({ did: 0, sent: 0, waiting: 3 }));
  ok("§1 one thing done: singular, and no waiting clause",
     L({ did: 1, sent: 0, waiting: 0 }) === "Steward did 1 thing for you yesterday.", L({ did: 1, sent: 0, waiting: 0 }));
  ok("§1 things done and drafts waiting: one sentence, no zero clause",
     L({ did: 14, sent: 0, waiting: 6 }) === "Steward did 14 things for you yesterday, and 6 drafts are waiting for you.",
     L({ did: 14, sent: 0, waiting: 6 }));
  ok("§1 something sent is said with its noun",
     L({ did: 2, sent: 1, waiting: 0 }) === "Steward did 2 things for you yesterday and sent 1 message.",
     L({ did: 2, sent: 1, waiting: 0 }));
  // Every combination 0..3: never a zero clause, always one sentence, and the
  // verb agrees with its count.
  const bad = [];
  for (let d = 0; d <= 3; d++) for (let s = 0; s <= 3; s++) for (let w = 0; w <= 3; w++) {
    const t = L({ did: d, sent: s, waiting: w });
    if (!d && !s && !w) { if (t !== "") bad.push([d, s, w, t]); continue; }
    if (/\b0\b/.test(t) || /sent 0|did 0/.test(t)) bad.push([d, s, w, t, "zero clause"]);
    if (!/\.$/.test(t) || (t.match(/\./g) || []).length !== 1) bad.push([d, s, w, t, "not one sentence"]);
    if (/\b1 (things|drafts|messages)\b|\b[2-9] (thing|draft|message)\b(?!s)/.test(t)) bad.push([d, s, w, t, "plural"]);
    if (/\b1 drafts? are\b|\b[2-9] drafts? is\b/.test(t)) bad.push([d, s, w, t, "agreement"]);
    if (w && !new RegExp(`${w} drafts? (is|are) waiting for you`).test(t)) bad.push([d, s, w, t, "waiting clause"]);
    if (!w && /waiting/.test(t)) bad.push([d, s, w, t, "waiting with none"]);
  }
  ok("§1 every combination 0..3 drops zero clauses and agrees in number", bad.length === 0, bad.slice(0, 6));

  // ── §2 THE SOURCE ────────────────────────────────────────────────────────
  console.log("\n— §2 · the source —");
  const dash = fs.readFileSync(path.join(root, "client/src/components/Dashboard.jsx"), "utf8");
  const between = (a, b) => { const i = dash.indexOf(a), j = dash.indexOf(b, i + 1); return i >= 0 && j > i ? dash.slice(i, j) : ""; };
  const tySrc = between("const thankYouSection=", "const driftHomeSection=");
  const agentSrc = between("const agentSection=", "const sequencesSection=");
  ok("§2 the thank-you section and the agent entry are where this suite reads them", tySrc.length > 200 && agentSrc.length > 200,
     [tySrc.length, agentSrc.length]);
  ok("§2 finding 2: no underlined control in the thank-you queue", !/textDecoration\s*:\s*["']underline/.test(tySrc),
     (tySrc.match(/.{60}textDecoration\s*:\s*["']underline.{20}/) || [])[0]);
  ok("§2 finding 2: each draft row names its gift's date", /giftDate/.test(tySrc) && /displayDate/.test(tySrc));
  ok("§2 finding 3: the entry is not a second ask (no title, no sentence of its own)",
     !/Tell Steward what to do<\/span>/.test(agentSrc) && !/Nothing happens until you say so/.test(agentSrc));
  ok("§2 finding 3: the entry hands the text to Agent the FIX-1 way",
     /onNavigate\("agent",\{agentText:text,autoAsk:true\}\)/.test(dash));
  ok("§2 finding 4: the Go button is never hidden (no conditional render on the text)",
     /data-testid="agent-ask"/.test(agentSrc) && !/agentText(\.trim\(\))?&&\s*\(?\s*<button/.test(agentSrc));
  const shared = fs.readFileSync(path.join(root, "client/src/components/shared.jsx"), "utf8");
  ok("§2 finding 1: the shell has a two-column top and a full-width lower half",
     /\.home-shell-top\{/.test(shared) && /\.home-shell-lower\{/.test(shared) && /home-shell-lower/.test(dash));

  // ── §3 THE BROWSER ───────────────────────────────────────────────────────
  console.log("\n— §3 · Home's bottom half, in a browser —");
  const APP = process.env.APP_URL || "http://localhost:4173";
  const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
  const DIST = path.join(root, "client", "dist");
  const skip = why => console.log("  SKIP  browser checks: " + why);
  let chromium = null;
  try { chromium = require(path.join(PW_DIR, "node_modules", "playwright")).chromium; } catch {}
  if (!chromium) { try { chromium = require("playwright").chromium; } catch {} }
  const h = process.env.DATABASE_URL ? require("./helpers") : null;
  let appUp = false;
  try { appUp = (await fetch(APP + "/", { signal: AbortSignal.timeout(2000) })).ok; } catch {}
  if (!chromium) skip("Playwright not found");
  else if (!fs.existsSync(path.join(DIST, "index.html"))) skip("client/dist not built");
  else if (!h) skip("no DATABASE_URL");
  else if (!appUp) skip(`nothing serving ${APP}`);
  else {
    await seed(h);
    const lr = await fetch(h.BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PW }) });
    const auth = await lr.json();
    ok("§3 the fixture signs in", !!auth.token, auth);
    const browser = await chromium.launch();
    try {
      for (const [W, H] of [[1440, 1000], [390, 844]]) await atWidth(browser, APP, auth, W, H);
    } finally { await browser.close(); }
    await h.closeDb();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// A fixture org rebuilt from nothing: four organisations (the institutional
// list), three people with open next steps (the Thread), one person with a
// gift and one drafted thank-you (the queue).
async function seed(h) {
  const bcrypt = require("bcryptjs");
  const { q } = h;
  const tabs = (await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public'`)).map(r => r.table_name);
  for (let i = 0; i < 3; i++) for (const t of tabs) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status) VALUES ($1,'Bottom Half Fixture','fx3a-home',1,'team','active')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx3ahome',$1,$2,$3,'Hana Home','admin')`, [ORG, EMAIL, bcrypt.hashSync(PW, 4)]);
  const orgs = [
    ["fx3a_fdn", "Ridgeline Family Foundation", "family_foundation", 5000, "2026-01-14"],
    ["fx3a_daf", "Schwab Charitable", null, 2500, "2025-12-31"],
    ["fx3a_chu", "Grace Chapel", "church", 1200, "2026-03-02"],
    ["fx3a_biz", "Saltbox Printing", "corporate", 750, "2026-02-09"],
  ];
  for (const [id, name, ft, amt, date] of orgs)
    await q(`INSERT INTO donors (id,org_id,name,kind,funder_type,stage,total_giving,gift_count,last_gift_date)
             VALUES ($1,$2,$3,'organisation',$4,'steward',$5,1,$6)`, [id, ORG, name, ft, amt, date]);
  const people = [["fx3a_p1", "Ada Okafor"], ["fx3a_p2", "Ben Castillo"], ["fx3a_p3", "Cora Lindqvist"], ["fx3a_p4", "Maya Brooks"]];
  for (const [id, name] of people)
    await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,gift_count,last_gift_date)
             VALUES ($1,$2,$3,$4,'steward',250,1,'2026-09-20')`, [id, ORG, name, id + "@example.org"]);
  const today = h.civilToday();
  const threeAgo = h.civilPlusDays(-3);
  for (const [i, [id]] of people.slice(0, 3).entries())
    await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,owner_id,owner_name,created_by,created_by_name)
             VALUES ($1,$2,$3,'call','Call to say thank you',$4,$5,'u_fx3ahome','Hana Home','u_fx3ahome','Hana Home')`,
      ["fx3a_th" + i, ORG, id, i === 0 ? threeAgo : today, threeAgo]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name)
           VALUES ('fx3a_g1',$1,'fx3a_p4',250,'2026-09-20','cash','u_fx3ahome','Hana Home')`, [ORG]);
  await q(`INSERT INTO thank_you_drafts (id,org_id,donor_id,gift_id,body)
           VALUES ('fx3a_ty1',$1,'fx3a_p4','fx3a_g1','Dear Maya, thank you for your gift of $250.')`, [ORG]);
}

async function atWidth(browser, APP, auth, W, H) {
  const tag = `@${W}`;
  const page = await browser.newPage({ viewport: { width: W, height: H }, serviceWorkers: "block" });
  const errs = [];
  page.on("pageerror", e => errs.push(e.message.slice(0, 160)));
  // No ANTHROPIC_API_KEY locally, so the server answers the daily line with
  // "not enabled". The entry is what is under test here, so the one GET is
  // answered as an org with the model would be answered (the sentence itself
  // is §1's, from the same dailyLine the route calls).
  const A = await import(path.join(root, "shared/agentShape.js"));
  await page.route(/\/agent\/daily-line/, r => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ available: true, line: A.dailyLine({ did: 0, sent: 0, waiting: 1 }), did: 0, sent: 0, waiting: 1 }) }));
  const posted = [];
  page.on("request", r => { if (r.method() === "POST" && /\/agent\/instructions/.test(r.url())) posted.push(r.postData() || ""); });
  await page.goto(APP + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(a => {
    localStorage.setItem("npe_token", a.token);
    localStorage.setItem("npe_user", JSON.stringify(a.user));
    localStorage.setItem("npe_org", JSON.stringify(a.org));
  }, auth);
  await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForSelector(".home-shell", { timeout: 15000 }).catch(() => {});
  await page.waitForSelector('[data-testid="thank-you-queue"]', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);

  const m = await page.evaluate(() => {
    const box = el => { if (!el) return null; const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height),
               r: Math.round(r.right), b: Math.round(r.bottom + window.scrollY) }; };
    const q = s => document.querySelector(s);
    const rail = q(".home-rail");
    const railContentBottom = rail ? Math.max(...[...rail.querySelectorAll("*")].map(e => e.getBoundingClientRect().bottom + window.scrollY)) : 0;
    const queue = q('[data-testid="thank-you-queue"]');
    const rows = queue ? [...queue.querySelectorAll("[data-thank-you]")] : [];
    const lowerEl = q(".home-shell-lower");
    const lowerUnderlined = lowerEl ? [...lowerEl.querySelectorAll("*")].filter(e => getComputedStyle(e).textDecorationLine.includes("underline")).map(e => e.innerText.slice(0, 40)) : null;
    const underlined = queue ? [...queue.querySelectorAll("*")].filter(e => getComputedStyle(e).textDecorationLine.includes("underline")).map(e => e.innerText.slice(0, 40)) : null;
    const tyBtn = rows[0] ? rows[0].querySelector('[data-testid="ty-open"]') : null;
    const agent = q('[data-testid="agent-box"]');
    const input = q('[data-testid="agent-input"]'), go = q('[data-testid="agent-ask"]');
    const cs = el => el ? getComputedStyle(el) : null;
    const explainer = q('[data-testid="ty-voice-line"]');
    return {
      boundary: /Something went wrong|Try reloading/i.test(document.body.innerText),
      shell: box(q(".home-shell")), main: box(q(".home-shell-main")), rail: box(rail), railContentBottom: Math.round(railContentBottom),
      drift: box(q("#dash-drifting")), institutional: /Institutional giving/i.test((q("#dash-drifting") || {}).textContent || ""),
      queue: box(queue), queueText: queue ? queue.innerText : "", rows: rows.map(box), rowText: rows.map(r => r.innerText.replace(/\s+/g, " ")),
      lastRowBottom: rows.length ? Math.round(rows[rows.length - 1].getBoundingClientRect().bottom + window.scrollY) : 0,
      underlined, lowerUnderlined,
      tyBtn: tyBtn ? { tag: tyBtn.tagName, text: tyBtn.innerText, box: box(tyBtn), deco: cs(tyBtn).textDecorationLine,
                       border: parseFloat(cs(tyBtn).borderTopWidth), bg: cs(tyBtn).backgroundColor.replace(/\s/g, "") } : null,
      explainer: explainer ? { box: box(explainer), lh: parseFloat(cs(explainer).lineHeight), border: cs(explainer).borderBottomWidth, text: explainer.innerText } : null,
      heading: box(queue && queue.querySelector("span")),
      agent: box(agent), agentText: agent ? agent.innerText : "",
      input: box(input), go: go ? { box: box(go), bg: cs(go).backgroundColor.replace(/\s/g, ""), disabled: go.disabled,
        opacity: parseFloat(cs(go).opacity), display: cs(go).display, visibility: cs(go).visibility, text: go.innerText } : null,
      docWidth: document.documentElement.scrollWidth,
    };
  });

  ok(`§3 ${tag} Home renders without an error boundary or page error`, !m.boundary && errs.length === 0, errs.slice(0, 3));
  ok(`§3 ${tag} the fixture draws the institutional list, the queue and the entry`,
     m.institutional && !!m.queue && !!m.agent, { inst: m.institutional, queue: !!m.queue, agent: !!m.agent });
  if (!m.queue || !m.agent || !m.drift || !m.shell || !m.rail) { await page.close(); return; }

  // FINDING 1 — the lower sections run full width, below the rail.
  const inner = m.shell.w - (W >= 1100 ? 80 : 40) - 4;
  for (const [name, b] of [["Drift (with the institutional list)", m.drift], ["the thank-you queue", m.queue], ["the one-line entry", m.agent]]) {
    ok(`§3 ${tag} finding 1: ${name} runs the full width of the panel`, b.w >= inner, { w: b.w, inner, shell: m.shell.w });
    ok(`§3 ${tag} finding 1: ${name} sits below the Today rail, not beside an empty column`, b.y >= m.rail.b - 1, { y: b.y, railBottom: m.rail.b });
  }
  if (W >= 1100) ok(`§3 ${tag} the rail is still beside the work at the top`, m.rail.x >= m.main.r - 2 && Math.abs(m.rail.y - m.main.y) < 40, { rail: m.rail, main: m.main });

  // FINDING 2 — one row per draft, a button, nothing under it.
  ok(`§3 ${tag} finding 2: the draft is one row naming the person, the amount and the date`,
     m.rowText.length === 1 && /Maya Brooks/.test(m.rowText[0]) && /\$250/.test(m.rowText[0]) && /Sep 20/.test(m.rowText[0]), m.rowText);
  ok(`§3 ${tag} finding 2: the row's action is a BUTTON that looks like one (bordered or filled, never underlined)`,
     m.tyBtn && m.tyBtn.tag === "BUTTON" && !m.tyBtn.deco.includes("underline") && (m.tyBtn.border >= 1 || !/rgba\(0,0,0,0\)|transparent/.test(m.tyBtn.bg)), m.tyBtn);
  ok(`§3 ${tag} finding 2: nothing in the queue is underlined`, Array.isArray(m.underlined) && m.underlined.length === 0, m.underlined);
  if (W >= 1100) ok(`§3 ${tag} finding 2: the button sits ON the row (one line, not under the name)`,
     m.tyBtn && m.rows[0] && m.rows[0].h <= 64 && m.tyBtn.box.y < m.rows[0].b && m.tyBtn.box.b > m.rows[0].y, { row: m.rows[0], btn: m.tyBtn && m.tyBtn.box });
  ok(`§3 ${tag} finding 2: no dead space under a single row`, m.queue.b - m.lastRowBottom <= 14, { queueBottom: m.queue.b, lastRow: m.lastRowBottom });
  ok(`§3 ${tag} finding 2: the explainer is one quiet line that lines up with the heading, with no rule`,
     m.explainer && m.heading && (W < 1100 || m.explainer.box.h <= m.explainer.lh * 1.6) && Math.abs(m.explainer.box.x - m.heading.x) <= 2 && parseFloat(m.explainer.border) === 0,
     { explainer: m.explainer, heading: m.heading });

  ok(`§3 ${tag} finding 2: the heading, the explainer and the row share one left edge`,
     m.heading && m.rows[0] && Math.abs(m.heading.x - m.rows[0].x) <= 2, { heading: m.heading, row: m.rows[0] });
  ok(`§3 ${tag} nothing in the lower half is an underlined link (the CRM's standing rule)`,
     Array.isArray(m.lowerUnderlined) && m.lowerUnderlined.length === 0, m.lowerUnderlined);

  // FINDINGS 3 and 4 — one line, carried into Agent.
  ok(`§3 ${tag} finding 3: the entry is not a second ask (no title, no promise sentence)`,
     !/Tell Steward what to do\n|Nothing happens until you say so/i.test(m.agentText), m.agentText.slice(0, 200));
  ok(`§3 ${tag} finding 3: the daily line says only what is true ("1 draft is waiting for you.")`,
     /1 draft is waiting for you\./.test(m.agentText) && !/Steward did 0|sent 0/.test(m.agentText), m.agentText.slice(0, 200));
  ok(`§3 ${tag} finding 4: the input and the Go button share one line`,
     m.input && m.go && Math.abs((m.input.y + m.input.h / 2) - (m.go.box.y + m.go.box.h / 2)) <= 4 && m.go.box.x > m.input.x, { input: m.input, go: m.go && m.go.box });
  ok(`§3 ${tag} finding 4: the Go button is emerald and clearly visible while empty`,
     m.go && EMERALD.has(m.go.bg) && m.go.opacity >= 0.75 && m.go.display !== "none" && m.go.visibility !== "hidden" && m.go.box.w > 30, m.go);
  ok(`§3 ${tag} finding 4: …and disabled until there is text`, m.go && m.go.disabled === true, m.go);
  ok(`§3 ${tag} nothing pushes the page sideways`, m.docWidth <= W, m.docWidth);

  if (process.env.SHOTS_DIR) {
    fs.mkdirSync(process.env.SHOTS_DIR, { recursive: true });
    const y = Math.max(0, m.drift.y - 40);
    await page.evaluate(y => window.scrollTo(0, y), y);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(process.env.SHOTS_DIR, `home-bottom-${W}.png`) });
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  // Enter submits, and the words arrive in Agent.
  const said = "ada just became a volunteer";
  if (!m.input) { ok(`§3 ${tag} finding 4: there is an input to type into`, false); await page.close(); return; }
  await page.fill('[data-testid="agent-input"]', said);
  ok(`§3 ${tag} finding 4: text enables the Go button`, await page.locator('[data-testid="agent-ask"]').isEnabled());
  await page.press('[data-testid="agent-input"]', "Enter");
  await page.waitForTimeout(1500);
  ok(`§3 ${tag} finding 3: Enter carries the words into Agent, which asks with them`,
     posted.some(p => p.includes(said)) && await page.locator('[data-testid="agent-box"]').count() === 0, { url: page.url(), posted });
  await page.close();
}

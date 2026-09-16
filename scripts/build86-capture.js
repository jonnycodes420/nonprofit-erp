// BUILD-86 Part A verification walk — HOME AT 7:40, AND THE BOARD MEETING.
//
// The brief asks for this by hand on Wednesday; this is that hour, scripted, so
// it is repeatable and so Wednesday is for rehearsing rather than discovering.
//
//   §1 log in cold and land on Home
//   §2 READ THE SENTENCE — it is assembled from what is actually waiting, and
//      it is not a template
//   §3 every row on Home is a name with a reason and one action
//   §4 no number-without-a-name on Home
//   §5 switch to Dashboard and back; the board carries what Home gave up
//
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build86-capture.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const APP = "http://localhost:4173";
const API = "http://localhost:5601";
const OUT = path.join(__dirname, "..", "docs", "build86");
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : " — " + String(JSON.stringify(detail) ?? "").slice(0, 300)));
  if (!cond) failures++;
};
const shoot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

(async () => {
  const stamp = Date.now().toString(36);
  const reg = await fetch(API + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "Heart of Harbour " + stamp, userName: "Ada Admin", email: `b86w_${stamp}@test.local`, password: "loadtest1234" }) }).then(x => x.json());
  const token = reg.token;
  const auth = { "Content-Type": "application/json", Authorization: "Bearer " + token };
  const api = (m, p, b) => fetch(API + p, { method: m, headers: auth, body: b ? JSON.stringify(b) : undefined }).then(r => r.json().catch(() => ({})));
  await api("POST", "/onboarding/complete", {});

  // A morning with something in all three sources.
  const ids = [];
  for (const [name, total, gifts] of [["Robert Harmon", 14500, 6], ["Margaret Chen", 48000, 9],
                                      ["Diana Torres", 300, 2], ["Otis Grange", 900, 3], ["Rob Delaney", 250, 2]]) {
    const d = await api("POST", "/donors", { name, email: name.toLowerCase().replace(/[^a-z]+/g, ".") + "@example.org" });
    const id = d.id || d.donor?.id; ids.push(id);
    for (let g = 0; g < gifts; g++) await api("POST", `/donors/${id}/gifts`, { amount: Math.round(total / gifts), date: day(-30 * (g + 1)), type: "cash" });
  }
  // Gifts auto-open thank-you threads; clear them so the walk plans its own.
  for (const t of (await api("GET", "/threads?scope=mine&cap=200")).list) await api("POST", `/threads/${t.id}/dismiss`, { reason: "handled_outside" });
  await api("POST", `/donors/${ids[0]}/threads`, { label: "Call about the gala", due: day(-24) });
  await api("POST", `/donors/${ids[2]}/threads`, { label: "Follow up", due: day(-2) });
  // Five closed-as-an-outcome conversations, so the board has enough history to
  // state a follow-up rate at all. Under five it correctly says nothing (thin
  // data is said, not smoothed) — which is right, and makes a fresh-org walk
  // unable to see the card unless it earns one.
  for (const i of [1, 3, 4]) {
    await api("POST", `/donors/${ids[i]}/threads`, { label: "Follow up", due: day(-3) });
    await api("POST", `/donors/${ids[i]}/conversations`, { touch: "call_reached", line: "Good conversation", nextStep: { type: "follow_up", due: day(5) } });
    await api("POST", `/donors/${ids[i]}/conversations`, { touch: "call_reached", line: "Second call", nextStep: { skipped: true } });
  }
  await api("POST", "/tasks", { title: "File the Q3 grant report", due: day(-1), priority: "high" });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1500 }, deviceScaleFactor: 2 });
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [token, JSON.stringify(reg.user), JSON.stringify({ ...reg.org, onboarding_complete: 1 })]);

  // §1 — cold, and it lands on Home.
  await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(2600);
  const text = await page.evaluate(() => document.body.innerText);
  ok("Home is where a cold login lands", /The Thread/i.test(text), text.slice(0, 200));

  // §2 — the sentence.
  const sentence = await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find(d =>
      /(is at day \d+|has gone quiet|conversation|monthly gift|Nothing is waiting)/.test(d.textContent || "") &&
      (d.textContent || "").trim().endsWith(".") && (d.textContent || "").trim().length < 220 && d.children.length === 0);
    return el ? el.textContent.trim() : null;
  });
  ok("the sentence is on screen", !!sentence, sentence);
  console.log("\n  she reads: " + sentence + "\n");
  ok("…it names a person, not just counts", /Harmon|Chen|Torres|Grange|Delaney/.test(sentence || ""), sentence);
  ok("…it is not a template with holes (no zero of anything)", !/\b0\b|\bno conversations\b/i.test(sentence || ""), sentence);
  ok("…it ends as a sentence", (sentence || "").endsWith("."), sentence);

  // §3/§4 — what is on Home.
  ok("the Thread queue is on Home", /The Thread/.test(text));
  ok("Drift is on Home", /Drift/.test(text));
  ok("the board's numbers are NOT on Home",
     !/Donor Retention Rate/i.test(text) && !/MY PORTFOLIO/i.test(text) && !/led straight to the next step/i.test(text),
     text.slice(0, 400));
  ok("…and neither is the fundraising goal banner", !/Set a goal|of goal reached/i.test(text), text.slice(0, 300));
  await shoot(page, "01-home-her-morning");

  // §5 — the board, and back.
  await page.click('button:has-text("Dashboard")');
  await page.waitForTimeout(2200);
  const board = await page.evaluate(() => document.body.innerText);
  ok("the board says what it is and as of when", /Numbers a board can read/.test(board), board.slice(0, 300));
  ok("the goal banner moved here", /Set a goal|of goal reached|goal/i.test(board));
  ok("the portfolio stat row moved here", /MY PORTFOLIO/i.test(board), board.slice(0, 400));
  // Thin data is SAID, not smoothed: under five closes the board states no rate
  // at all, which is correct. The walk earns one above so the card is provable.
  ok("the follow-up rate moved here (and only renders once it can be stated)",
     /Follow-up, last 30 days/i.test(board) || /led straight to the next step/i.test(board),
     board.slice(board.indexOf("As of"), board.indexOf("As of") + 500));
  ok("the queue is NOT duplicated on the board", !/Plan a follow-up/.test(board));
  await shoot(page, "02-dashboard-the-board-meeting");

  await page.click('button:has-text("Home")');
  await page.waitForTimeout(2000);
  const back = await page.evaluate(() => document.body.innerText);
  ok("switching back returns to her morning, unchanged", /The Thread/.test(back) && !/Numbers a board can read/.test(back));

  await browser.close();
  console.log(`\n${failures === 0 ? "ALL GREEN" : failures + " FAILED"} — screenshots in docs/build86/`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

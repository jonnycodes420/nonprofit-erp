// BUILD-85 verification walk — THE FOLLOW-UP ENGINE, on screen.
//
// The suite proves the contracts; this proves the thing a person actually
// sees. It seeds a shop with a realistic spread (a failing monthly gift, a
// large open ask, a first gift, a late thank-you, and a pile of ordinary
// overdue follow-ups) and then walks:
//
//   §1 the queue is BANDED, RANKED and CAPPED, and every row says why
//   §2 the cap states its remainder rather than hiding it
//   §3 an admin can see across officers; the toggle exists only because
//      this shop has more than one
//   §4 planning forward, with nothing having happened first
//   §5 the morning brief: ONE email, threads and tasks, reasons on the rows
//
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build85-capture.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const APP = "http://localhost:4173";
const API = "http://localhost:5601";
const OUT = path.join(__dirname, "..", "docs", "build85");
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : " — " + String(JSON.stringify(detail) ?? "").slice(0, 320)));
  if (!cond) failures++;
};
const shoot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const day = n => iso(Date.now() + n * 86400000);

(async () => {
  const stamp = Date.now().toString(36);
  const reg = await fetch(API + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "Harbourlight Arts " + stamp, userName: "Ada Admin", email: `b85w_${stamp}@test.local`, password: "loadtest1234" }) }).then(x => x.json());
  const token = reg.token;
  const auth = { "Content-Type": "application/json", Authorization: "Bearer " + token };
  await fetch(API + "/onboarding/complete", { method: "POST", headers: auth, body: "{}" });
  const api = (m, p, b) => fetch(API + p, { method: m, headers: auth, body: b ? JSON.stringify(b) : undefined }).then(r => r.json().catch(() => ({})));

  // A shop with a real spread — the ranking has nothing to say about a flat one.
  const PEOPLE = [
    ["Margaret Chen",      48000, 9],
    ["Rob Delaney",          250, 3],
    ["Sunrise Foundation", 120000, 4],
    ["Diana Torres",         150, 1],
    ["William Park",        3200, 6],
    ["Priya Raman",          900, 4],
    ["Desmond Cole",         600, 2],
    ["Ana Villanueva",      1800, 5],
    ["Tom Fairweather",      400, 2],
    ["Ruth Alderman",       7500, 7],
    ["Nate Brooks",          320, 2],
    ["Ivy Marchetti",        480, 3],
    ["Caleb Osei",           260, 2],
    ["Lena Whitfield",      2100, 4],
    ["Otis Grange",          380, 2],
  ];
  // Giving is seeded through the REAL gift route, not by writing the column:
  // `total_giving` is derived, and a ranking demo built on a column nobody
  // fills the same way in life would be a demo of nothing.
  const ids = [];
  for (const [name, total, gifts] of PEOPLE) {
    const d = await api("POST", "/donors", { name, email: name.toLowerCase().replace(/[^a-z]+/g, ".") + "@example.org" });
    const id = d.id || d.donor?.id;
    ids.push(id);
    const each = Math.round(total / gifts);
    for (let g = 0; g < gifts; g++)
      await api("POST", `/donors/${id}/gifts`, { amount: each, date: day(-30 * (g + 1)), type: "cash" });
  }
  // A real open ask on the foundation, so the money signal has something to say.
  await api("POST", `/donors/${ids[2]}/opportunities`, { name: "Capital campaign ask", targetAmount: 75000 });

  // LOGGING A GIFT ALREADY OPENS A THREAD (BUILD-81's one non-human opener:
  // a live gift opens "Send thank-you note" +2). So the seeding above has
  // already filled the queue, and every plan below would 409 against it. That
  // is the product working; it is just not the spread this walk wants to show.
  // Dismiss them first, then plan deliberately — and CHECK EVERY WRITE, because
  // a silently-ignored 409 is exactly how this walk lied to itself once.
  const existing = await api("GET", "/threads?scope=mine&cap=200");
  for (const t of existing.list) await api("POST", `/threads/${t.id}/dismiss`, { reason: "handled_outside" });

  const planned = [];
  const plan = async (i, label, d) => {
    const r = await api("POST", `/donors/${ids[i]}/threads`, { label, due: day(d) });
    planned.push({ donor: PEOPLE[i][0], ok: !!r.thread, err: r.error || null });
    return r;
  };
  await plan(0, "Send thank-you note", -6);      // a late thank-you: decay
  await plan(2, "Check in on the ask", -9);      // the foundation: an open ask
  await plan(1, "Call about the spring appeal", -4);
  await plan(3, "Call and welcome her", -2);     // her first gift
  await plan(4, "Follow up on the studio tour", -1);
  for (let i = 5; i < 15; i++) await plan(i, "Follow up", -(i % 4));
  ok("every planned step actually landed (a silent 409 is how a walk lies to itself)",
     planned.every(p => p.ok), planned.filter(p => !p.ok));

  const q = await api("GET", "/threads?scope=mine");
  ok("the queue is capped at twelve with the remainder stated", q.list.length === 12 && q.more === 3, { shown: q.list.length, more: q.more, open: q.stat.open });
  ok("every row carries the reason its order was built from", q.list.every(t => t.rank && (t.rank.why || t.rank.score === 0)), q.list[0]?.rank);
  ok("the bands are reported as facts off the due date", q.bands.some(b => b.key === "overdue"), q.bands);
  const whys = q.list.map(t => t.rank.why).filter(Boolean);
  ok("the ranking speaks with MORE than one voice (a queue ordered only by lateness is a sorted list, not an engine)",
     new Set(whys).size >= 3, whys);
  ok("a late thank-you is recognised by its LABEL, not only its stored type",
     whys.some(w => /^Thank-you \d+ day/.test(w)), whys);
  ok("the open ask outranks the ordinary overdue follow-ups",
     /ask open/.test(q.list[0].rank.why || ""), q.list[0]?.rank);
  console.log("\n  the queue, in order:");
  for (const t of q.list.slice(0, 8)) console.log(`    ${String(t.rank.score).padStart(3)}  ${t.donorName.padEnd(20)} ${t.band.padEnd(8)} ${t.rank.why || ""}`);

  const health = await api("GET", "/threads/health");
  ok("the engine reports whether it runs", typeof health.open === "number", health);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1700 }, deviceScaleFactor: 2 });
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [token, JSON.stringify(reg.user), JSON.stringify({ ...reg.org, onboarding_complete: 1 })]);
  await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const text = await page.evaluate(() => document.body.innerText);
  ok("the Thread card renders the queue", /open · .*overdue/.test(text), text.slice(0, 300));
  ok("band headers are on screen", /OVERDUE/i.test(text), text.slice(0, 400));
  ok("a reason is printed on a row", /(Overdue \d+ day|ask open|Top tenth|Thank-you \d+ day|first gift)/.test(text), text.slice(0, 600));
  ok("the remainder is stated, not hidden", /more open/.test(text), text.slice(0, 800));
  ok("Plan a follow-up is offered from the queue itself", text.includes("Plan a follow-up"));
  await shoot(page, "01-queue-banded-ranked");

  // §4 — planning forward, through the UI.
  await page.click('button:has-text("Plan a follow-up")');
  await page.waitForTimeout(700);
  ok("the plan modal explains that nothing has to have happened yet",
     (await page.evaluate(() => document.body.innerText)).includes("Nothing has to have happened yet"));
  await shoot(page, "02-plan-a-follow-up");
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.click(10, 10);
  await page.waitForTimeout(400);

  // §5 — the morning brief, rendered from the real composer.
  await api("POST", "/tasks", { title: "File the Q3 grant report", due: day(-1), priority: "high" });
  const brief = await api("POST", "/nudges/run", { today: day(0), force: true, dryRun: true });
  ok("the brief is ONE email carrying both threads and tasks",
     brief.sent.length >= 1 && brief.sent[0].threads > 0 && brief.sent[0].tasks > 0, brief.sent[0]);
  ok("…and its subject counts everything waiting and names the escalation",
     /waiting on you · .+, day \d+/.test(brief.sent[0]?.subject || ""), brief.sent[0]?.subject);
  console.log("\n  brief subject: " + brief.sent[0]?.subject);

  await browser.close();
  console.log(`\n${failures === 0 ? "ALL GREEN" : failures + " FAILED"} — screenshots in docs/build85/`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

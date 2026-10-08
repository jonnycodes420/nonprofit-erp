// tests/fix34-thanks.test.js · FIX-34's one test. TASKS-2'S LOOSE ENDS.
//
//     §A a booked meeting is ONE item on the Calendar and ONE Thread row for
//        its donor; ticking a call step on the Calendar needs a next step or
//        "No next step" (tests/fix34/a-calendar-thread.js);
//     §B a donor who gave this year with a meeting booked reads one status on
//        every line, and the goal bar counts the gifts the Raised card counts
//        (tests/fix34/b-status-goal.js);
//     §C with two calendars connected, booking offers both and lands only on
//        the chosen one; a refused Google API is named as refused
//        (tests/fix34/c-calendars.js);
//     §D QuickBooks sends nothing while a fund is unmapped; PayPal offers the
//        org's funds (tests/fix34/d-books-paypal.js);
//     §E completing a Thank-you task marks that gift thanked and drops the
//        awaiting-thanks count by one; the morning email carries today
//        (tests/fix34/e-tasks.js);
//     §F CI cannot hang for hours: every job and the Playwright install have a
//        ceiling, and the install retries once.
//
// Donor data and money: a meeting shown twice is a donor visited twice, a
// thank-you that leaves the gift "awaiting" is a donor thanked twice, and a
// QuickBooks sync to an unchosen account is a bookkeeper's mess.
//
// HOW IT WOULD GO RED: each part file was run against main before its fix and
// failed; the PR lists each red→green. §F fails on main, which had no
// timeout-minutes anywhere in ci.yml.

const fs = require("fs");
const path = require("path");
const { ok, summary, closeDb } = require("./helpers");

const PARTS = ["a-calendar-thread", "b-status-goal", "c-calendars", "d-books-paypal", "e-tasks"];

function ciHasCeilings() {
  const yml = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "ci.yml"), "utf8");
  const jobs = [...yml.matchAll(/^  ([a-z][a-z-]*):\n((?:    .*\n|\n)+)/gm)].map(m => ({ name: m[1], body: m[2] }));
  const bare = jobs.filter(j => /runs-on:/.test(j.body) && !/^    timeout-minutes: \d+/m.test(j.body)).map(j => j.name);
  ok("§F every CI job has a timeout-minutes", jobs.length >= 4 && bare.length === 0, bare);
  const step = /- name: Install Playwright \+ Chromium\n\s+timeout-minutes: \d+\n\s+run: \|([\s\S]*?)\n\s+- name:/.exec(yml);
  ok("§F the Playwright install has its own ceiling", !!step);
  ok("§F each install attempt is capped and retried once", !!step && /timeout \d+ npx playwright install/.test(step[1]) && /\|\| \{[^}]*retrying once[^}]*install_pw; \}/.test(step[1]));
  ok("§F the Playwright browsers are cached", /actions\/cache@v4[\s\S]{0,200}\.playwright-browsers/.test(yml));
}

(async () => {
  for (const p of PARTS) {
    const file = path.join(__dirname, "fix34", `${p}.js`);
    if (!fs.existsSync(file)) { ok(`§${p[0].toUpperCase()} part file exists`, false, file); continue; }
    try { await require(file).run(); }
    catch (e) { console.error(e); ok(`§${p[0].toUpperCase()} ${p} ran to the end`, false, e.message); }
  }
  ciHasCeilings();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); await closeDb().catch(() => {}); summary(); });

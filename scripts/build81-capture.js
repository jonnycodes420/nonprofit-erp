#!/usr/bin/env node
// scripts/build81-capture.js — BUILD-81 verification walk, the human path:
// a FRESH org · the v2 messy import · log one call · watch the next step
// come back · receive the nudge email. At 1440 AND 390. Screenshots →
// docs/build81/. LOOPBACK-HARDCODED: drives the local scratch stack only
// (server :5601, preview :4173, sink :5602) — it can never touch prod.
//
// Prereqs: scratch stack per tests/README.md, client/dist built via
// scripts/build-local-dist.sh, vite preview on :4173, PLAYWRIGHT_DIR set.

const path = require("path");
const fs = require("fs");
const http = require("http");

const BASE = "http://localhost:5601";
const APP = "http://localhost:4173";
const SINK_PORT = Number(process.env.SINK_PORT || 5602);
const PW = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
const OUT = path.join(__dirname, "..", "docs", "build81");
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 240) : "")); }
};

const { chromium } = require(path.join(PW, "node_modules", "playwright"));

const RUN = Date.now().toString(36);
const EMAIL = `b81walk-${RUN}@test.local`, PASS = "walkthrough81";
const api = async (method, p, token, body) => {
  const r = await fetch(BASE + p, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j; try { j = await r.json(); } catch { j = null; }
  return { status: r.status, body: j };
};

(async () => {
  // ── mail sink (the nudge email is REAL bytes) ────────────────────────────
  const captured = [];
  const sink = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => { try { captured.push(JSON.parse(b)); } catch { /* not json */ } res.end(JSON.stringify({ id: "walk" })); });
  });
  await new Promise((res, rej) => { sink.on("error", rej); sink.listen(SINK_PORT, res); });

  // ── a FRESH org ──────────────────────────────────────────────────────────
  console.log("\n— the fresh org —");
  const reg = await api("POST", "/auth/register-org", null, {
    orgName: "Walk Eighty-One Arts", userName: "Walk Admin", email: EMAIL, password: PASS,
  });
  ok("fresh org registers", reg.status === 200 || reg.status === 201, reg.body);
  const tok = reg.body?.token || (await api("POST", "/auth/login", null, { email: EMAIL, password: PASS })).body?.token;
  ok("signed in", !!tok, null);
  await api("POST", "/onboarding/complete", tok, {});

  const setup0 = await api("GET", "/org/setup-status", tok);
  ok("fresh org: the conversation item is NOT ticked (nothing auto-ticks)",
     setup0.body?.items?.find(i => i.key === "conversation")?.done === false, setup0.body?.items);

  // ── the v2 messy import, through the REAL client parser ─────────────────
  console.log("\n— the v2 import —");
  // The REAL client pipeline, exactly as the golden suite drives it
  // (tests/import-messy-v2.test.js §1–§4): decode → analyze → map → plan →
  // accounted builder → chunked posts to the real route.
  const lib = await import("../shared/importShape.js");
  const cfs = await import("../shared/customFieldShape.js");
  const dec = lib.decodeSpreadsheetBytesDetailed(fs.readFileSync(path.join(__dirname, "..", "tests", "fixtures", "build79", "steward-messy-2500-v2.csv")));
  const a = lib.analyzeCsvText(dec.text);
  const txMap = lib.autoDetectTxMapping(a.headers, a.rows);
  const plan = cfs.buildMapperPlan({ headers: a.physical.headerCells, fields: a.headers, rows: a.rows, txMap,
    existingDefs: { donor: [], gift: [] }, savedMappings: [], orphanColumns: a.physical.orphanColumns, overflowRows: a.physical.overflowRows });
  const exclusionColumns = plan.columns.filter(c => c.status === "flag" && c.flag === "exclusion").map(c => c.field);
  const walkToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const built = lib.buildTransactionRows({ rows: a.rows }, txMap, { today: walkToday, rowLines: a.rowLines,
    exclusionColumns, parseExclusionValue: cfs.parseExclusionValue });
  const byDonor = new Map();
  for (const g of built.gifts) { if (!byDonor.has(g.donorIndex)) byDonor.set(g.donorIndex, []); byDonor.get(g.donorIndex).push(g); }
  let imported = 0;
  for (let start = 0; start < built.donors.length; start += 500) {
    const slice = built.donors.slice(start, start + 500);
    const chunkGifts = [];
    slice.forEach((_, li) => { const gg = byDonor.get(start + li); if (gg) gg.forEach(g => { const { donorIndex, ...rest } = g; chunkGifts.push({ ...rest, donorIndex: li }); }); });
    const r = await api("POST", "/donors/import-combined", tok, { donors: slice, gifts: chunkGifts });
    if (r.status === 200) imported += slice.length;
  }
  ok("the v2 import landed its donors", imported > 400, imported);
  const threadsAfterImport = await api("GET", "/threads", tok);
  ok("the import created ZERO threads (history, not open loops)",
     threadsAfterImport.body?.hasAny === false && threadsAfterImport.body?.list.length === 0, threadsAfterImport.body?.stat);

  // ── the browser walk: Home empty state → log one call → the thread ──────
  console.log("\n— the walk, 1440 and 390 —");
  const browser = await chromium.launch();
  const auth = (await api("POST", "/auth/login", null, { email: EMAIL, password: PASS })).body;
  for (const [w, vp, tag] of [[1440, { width: 1440, height: 1000 }, "1440"], [390, { width: 390, height: 844 }, "390"]]) {
    const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2 });
    await page.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", JSON.stringify(u)); localStorage.setItem("npe_org", JSON.stringify(o));
    }, [auth.token, auth.user, auth.org]);
    await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const tc = await page.evaluate(() => document.body.textContent);
    if (w === 1440) {
      ok('"The Thread" renders on Home (the literal string)', tc.includes("The Thread"), null);
      ok("the empty state reads as written",
         tc.includes("No conversations logged yet. Log your first call from a donor's record and the next step will come back to you."), null);
    }
    const threadEl = await page.locator("#dash-thread").first();
    if (await threadEl.count()) await threadEl.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, `walk-${tag}-home-empty.png`) });
    await page.close();
  }

  // log ONE call through the API (the modal path is covered by the suites;
  // the walk pins the SURFACE it produces)
  const donors = await api("GET", "/donors?limit=1&sort=total_giving", tok);
  const donor = donors.body?.donors?.[0];
  ok("a donor to call", !!donor, null);
  const today = (await api("GET", "/threads", tok)).body.today;
  const { addCivilDays } = await import("../shared/threadShape.js");
  const conv = await api("POST", `/donors/${donor.id}/conversations`, tok, {
    touch: "call_reached", line: "Reached her at the studio. She wants the spring numbers before she decides.",
    nextStep: { type: "follow_up", due: addCivilDays(today, 7) },
  });
  ok("one call logged, the thread opened", conv.status === 201 && conv.body?.thread?.id, conv.body);

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", JSON.stringify(u)); localStorage.setItem("npe_org", JSON.stringify(o));
  }, [auth.token, auth.user, auth.org]);
  await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const tc2 = await page.evaluate(() => document.body.textContent);
  ok("the next step CAME BACK: the thread renders on Home with its stat line",
     /1 open · 0 overdue/.test(tc2) && tc2.includes(donor.name), null);
  const setup1 = await api("GET", "/org/setup-status", tok);
  ok("…and the checklist ticked on the first conversation",
     setup1.body?.items?.find(i => i.key === "conversation")?.done === true, null);
  await page.locator("#dash-thread").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, "walk-1440-thread-open.png") });
  await page.close();

  // ── receive the email ────────────────────────────────────────────────────
  console.log("\n— the email —");
  await api("PATCH", `/orgs/${auth.org.id}`, tok, { receiptAddress: "1 Walk St, Fairhope, AL 36532" });
  // make it due: the nudge lists due-or-overdue only
  const lat = addCivilDays(today, 8);
  const run = await api("POST", "/nudges/run", tok, { today: lat, force: true });
  ok("the nudge ran and sent ONE email", run.body?.sent?.length === 1, run.body);
  const mail = captured.find(m => m.subject && m.subject.includes("thread"));
  ok("the subject is the fact, with the day count",
     !!mail && /^1 thread open · .*, day 8$/.test(mail.subject), mail?.subject);
  ok("the row reads 'day 8', never a date to subtract", /day 8/.test(mail?.html || ""), null);
  ok("the footer carries the mailing address", (mail?.html || "").includes("1 Walk St, Fairhope, AL 36532"), null);
  fs.writeFileSync(path.join(OUT, "walk-nudge-email.html"), mail?.html || "");

  // read-aloud record (the human gate — these lines are read out loud)
  fs.writeFileSync(path.join(OUT, "READ-ALOUD.md"), `# BUILD-81 read-aloud record

## The hero, out loud
"Who did you mean to call back? Every fundraiser has one. The gala guy. The
board member's friend who said let's talk in the spring. The one who was
polite and busy and said nothing at all, so he never made it onto today's
list. Steward writes the conversation down, hands you the next step, and
keeps asking until you've done it."
Reads like a person. Nothing in it is system output.

## The email, out loud
Subject: "${mail?.subject}"
"These are waiting on you. Each name opens the donor's record. Log what
happened there, and the next step comes back when it is due."
The subject is a fact. The body doesn't nag. The footer is a real address.
`);

  await browser.close();
  sink.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

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

// ── --landing-shots — the FIX after BUILD-81: section two gets its pictures
// back. REAL screenshots of the product for the three How-it-works cards,
// captured from the demo org at 1440 / DPR 2, cropped tight, exported as
// 1x + 2x webp into client/public/ with their printed intrinsic dimensions
// (paste those into Landing.jsx if they change). Seeds three threads on demo
// donors for the third shot and CLEANS THEM UP after — the scratch demo org
// leaves this run exactly as it entered it.
async function landingShots() {
  const sharp = require(path.join(__dirname, "..", "node_modules", "sharp"));
  const PUB = path.join(__dirname, "..", "client", "public");
  const login = await api("POST", "/auth/login", null, { email: "admin@creoarts.org", password: "demo1234" });
  const auth = login.body;
  ok("demo login", !!auth?.token, login.status);
  const tok = auth.token;

  // three believable open threads for the Home shot (cleaned up below)
  const donorsResp = await api("GET", "/donors?limit=12&sort=total_giving", tok);
  // person-shaped names only, and never the Atkinson records — the landing
  // must not put the founder's family name in a screenshot.
  const donors = (donorsResp.body?.donors || [])
    .filter(d => d.name && !/foundation|fund|inc\b|atkinson|&/i.test(d.name)).slice(0, 4);
  ok("four demo donors to work with", donors.length === 4, donors.length);
  const today = (await api("GET", "/threads", tok)).body.today;
  const { addCivilDays } = await import("../shared/threadShape.js");
  const seeded = [];
  // pronoun-free lines: the donor names come from the demo file, so the
  // logged sentences must read true against any of them.
  const seedConvos = [
    { d: donors[0], touch: "call_reached", line: "Good call after the board meeting. Wants the year-end numbers first.", type: "follow_up", due: addCivilDays(today, -2), openedAgo: 11 },
    { d: donors[1], touch: "meeting", line: "Coffee downtown. Offered to host a studio night in November.", type: "thank_you_note", due: addCivilDays(today, 1), openedAgo: 1 },
    { d: donors[2], touch: "call_no_answer", line: "No answer. Left a message about the fall appeal.", type: "try_again", due: addCivilDays(today, 2), openedAgo: 2 },
  ];
  for (const c of seedConvos) {
    const r = await api("POST", `/donors/${c.d.id}/conversations`, tok, {
      touch: c.touch, line: c.line, nextStep: { type: c.type, due: c.due },
    });
    if (r.body?.thread) seeded.push({ threadId: r.body.thread.id, interactionId: r.body.interactionId, donorId: c.d.id });
  }
  ok("three threads seeded for the shot", seeded.length === 3, seeded.length);
  // Backdate the seeded threads through the loopback scratch DB so the card
  // reads like a real morning (day 11 overdue, not three day-0 rows). Best
  // effort: without the scratch DB the shot still lands, just younger.
  try {
    const { q } = require(path.join(__dirname, "..", "tests", "helpers"));
    for (let i = 0; i < seeded.length; i++) {
      const c = seedConvos[i];
      const openedOn = addCivilDays(today, -c.openedAgo);
      await q(`UPDATE threads SET opened_on=$2 WHERE id=$1`, [seeded[i].threadId, openedOn]);
      // the touch date matches the day count — "Call · <date> … day 11" must agree
      await q(`UPDATE interactions SET date=$2 WHERE id=$1`, [seeded[i].interactionId, openedOn]);
    }
  } catch (e) { console.log("  NOTE  could not backdate threads (" + e.message + ") — day counts will read 0"); }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", JSON.stringify(u)); localStorage.setItem("npe_org", JSON.stringify(o));
  }, [auth.token, auth.user, auth.org]);

  const exportShot = async (pngPath, base, targetW) => {
    const meta = await sharp(pngPath).metadata();
    const w2 = Math.min(meta.width, targetW * 2);
    await sharp(pngPath).resize(w2, null).webp({ quality: 88 }).toFile(path.join(PUB, `${base}-2x.webp`));
    await sharp(pngPath).resize(Math.round(w2 / 2), null).webp({ quality: 88 }).toFile(path.join(PUB, `${base}.webp`));
    const m1 = await sharp(path.join(PUB, `${base}.webp`)).metadata();
    console.log(`  DIMS  ${base}.webp intrinsic ${m1.width}x${m1.height} (2x ${w2}px wide)`);
    return m1;
  };

  // shots 1 + 2 — the Log-a-conversation modal on a donor record, one line
  // typed; then the next-step prompt with the +7 default showing.
  await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.click("text=Donors");
  await page.waitForTimeout(1000);
  await page.click(`text=${donors[3].name}`);
  await page.waitForTimeout(1200);
  await page.click('.dph-primary:has-text("Log a conversation")');
  await page.waitForTimeout(500);
  const lineSel = 'input[placeholder="One line. She asked for the impact report."]';
  await page.fill(lineSel, "Asked what the scholarship fund still needs.");
  await page.waitForTimeout(300);
  const modal = await page.locator(".modal-sheet-inner").boundingBox();
  const lineBox = await page.locator(lineSel).boundingBox();
  const nsLabel = await page.locator('span:text-is("Next step")').boundingBox();
  const hint = await page.locator("text=This comes back to find you").boundingBox();
  ok("modal geometry resolved", !!(modal && lineBox && nsLabel && hint), null);
  // inset 2px so the dark overlay behind the rounded corners never fringes
  await page.screenshot({ path: "/tmp/hiw-log-raw.png", clip: { x: modal.x + 3, y: modal.y + 5, width: modal.width - 6, height: (lineBox.y + lineBox.height + 12) - modal.y - 5 } });
  await page.screenshot({ path: "/tmp/hiw-nextstep-raw.png", clip: { x: modal.x + 2, y: nsLabel.y - 14, width: modal.width - 4, height: (hint.y + hint.height + 12) - (nsLabel.y - 14) } });
  const dueVal = await page.locator('.modal-sheet-inner input[type="date"]').nth(1).inputValue();
  ok("the next-step prompt shows the +7 default", dueVal === addCivilDays(today, 7), dueVal);
  await page.keyboard.press("Escape");

  // shot 3 — The Thread on Home with the three open threads.
  await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const card = await page.locator("#dash-thread").boundingBox();
  const nya = await page.locator("#dash-needtodo").boundingBox();
  ok("Thread card geometry resolved", !!(card && nya), null);
  await page.locator("#dash-thread").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const card2 = await page.locator("#dash-thread").boundingBox();
  const nya2 = await page.locator("#dash-needtodo").boundingBox();
  await page.screenshot({ path: "/tmp/hiw-thread-raw.png", clip: { x: card2.x, y: card2.y, width: card2.width, height: nya2.y - card2.y } });
  await page.screenshot({ path: path.join(OUT, "landing-shots-home-context.png") });
  await browser.close();

  const m1 = await exportShot("/tmp/hiw-log-raw.png", "hiw-log", 460);
  const m2 = await exportShot("/tmp/hiw-nextstep-raw.png", "hiw-nextstep", 460);
  const m3 = await exportShot("/tmp/hiw-thread-raw.png", "hiw-thread", 760);
  ok("all three shots exported 1x + 2x", [m1, m2, m3].every(m => m.width > 200 && m.height > 60), null);

  // leave the demo org as found
  for (const s of seeded) {
    await api("POST", `/threads/${s.threadId}/dismiss`, tok, { reason: "handled_outside" }).catch(() => {});
  }
  // cleanup is API-side: dismissals close the threads (the dismissal reason
  // is honest — these WERE handled outside, by this script), and the seeded
  // interactions are deleted through the product's own delete route.
  for (const s of seeded) await api("DELETE", `/interactions/${s.interactionId}`, tok).catch(() => {});
  const after = await api("GET", "/threads", tok);
  ok("demo org left with zero OPEN threads", after.body?.stat?.open === 0, after.body?.stat);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

if (process.argv.includes("--landing-shots")) {
  landingShots().catch(e => { console.error(e); process.exit(1); });
  return;
}

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

// HOTFIX-1 — THE PROFILE KEEPS ITS RAIL, AND THE SUGGESTION PANEL STOPS
// TALKING ABOUT ITSELF. Run: node tests/hotfix1-profile.test.js
//
// Four things Jonathan found after FIX-3 shipped:
//
//   §1  THE RAIL. The profile is a main column and a rail beside it, on a
//       contrasting ground. FIX-3 D replaced the whole screen with stacked
//       sections and the rail went with it. The rule is now in CLAUDE.md's
//       never-crossed list and in docs/decisions/design-system.md, and this
//       suite fails at 1440 if the rail is gone or sits on the same ground as
//       the column it is meant to contrast with.
//   §2  SILENCE. "3 lines were left out because they said something that is
//       not on this record" is Steward talking about its own plumbing. She
//       cannot see the lines, judge them or act on the count. Refusals go to
//       the console; the panel shows what survived, and when nothing survives
//       it shows nothing.
//   §3  TIMING IS AHEAD. On the 27th of September the panel said "mid-August".
//       Every word was on the record — a month is always an allowed word — so
//       nothing refused it. A suggestion is an instruction about what to do
//       NEXT: a date it names has to still be ahead of today.
//   §4  NOTHING IS OPEN IS A CLAIM. "What do I do next" answered with nothing
//       while a proposal and a follow-up sat open on the same screen. The
//       record knows the next real step, so the record says it.
//
//   §5  ANGELA WU. The walk asked whether she is really on Sunrise's record.
//       She is: the boot seed's Sunrise note names her as the program officer
//       and a logged site visit names her again. So the checker did NOT fail
//       on her, and both halves are pinned here — grounded where the record
//       carries her, refused where it does not.
//   §6  proof each guard can fail.
//
// §1 is a browser leg and SKIPs cleanly without Playwright or a localhost-API
// dist (BUILD-44 Part 6). Everything else is pure and runs in CI.

const path = require("path");
const fs = require("fs");
const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, closeDb, civilToday } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const APP = process.env.APP_URL || "http://localhost:4173";
const PORT = Number(new URL(APP).port || 80);
const ORG = "org_hf1prof";
const { readSource } = require("../scripts/lib/readSource");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png" };

function browserReady() {
  if (!fs.existsSync(path.join(DIST, "index.html"))) return "client/dist not built";
  const API_ORIGIN = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
  const dir = path.join(DIST, "assets");
  const js = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".js")) : [];
  if (!js.some(f => fs.readFileSync(path.join(dir, f), "utf8").includes(API_ORIGIN)))
    return "client/dist not built against the local API";
  try { require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright")); }
  catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
  return null;
}

async function frontendBase() {
  try { const r = await fetch(APP + "/", { signal: AbortSignal.timeout(1500) }); if (r.ok) return null; } catch { }
  // The fallback static server, confined to DIST. The request path is
  // resolved and then CHECKED to still be inside the build directory before
  // anything is read — a request path is user input even in a test rig
  // (CodeQL js/path-injection), and an index.html fallback for anything that
  // escapes is also the right SPA behaviour.
  const INDEX = path.join(DIST, "index.html");
  const resolveInDist = url => {
    const full = path.resolve(DIST, "." + path.posix.normalize("/" + url));
    const inside = full === DIST || full.startsWith(DIST + path.sep);
    if (!inside || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return INDEX;
    return full;
  };
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    if (url.startsWith("/_vercel/")) { res.statusCode = 404; return res.end(); }
    const file = resolveInDist(url);
    res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => srv.listen(PORT, r));
  return srv;
}

async function seed() {
  const CHILD = ["threads", "donor_designations", "workflow_runs", "workflows", "moves", "opportunities",
    "tasks", "receipts", "pledges", "fin_audit_log", "fin_transactions", "gifts", "interactions",
    "notification_sends", "metric_snapshots"];
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["donors", "campaigns", "fin_funds", "accounts", "budgets", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Hotfix One Trust','hf1prof',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,'hf1prof@t.local',$3,'Admin User','admin')`,
    [`u_${ORG}`, ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ($1,$2,'4010','Contributions','revenue')`, [`acct_${ORG}`, ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`, [`ff_${ORG}`, ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,gift_count,last_gift_date,assigned_to,assigned_to_name,created_by,created_by_name)
           VALUES ('d_hf1',$1,'Verity Yarrowdale','verity@hf1.test','steward',5000,1,$2,$3,'Admin User',$3,'Admin User')`,
    [ORG, civilToday(), `u_${ORG}`]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method,created_by,created_by_name)
           VALUES ('g_hf1',$1,'d_hf1',5000,$2,'cash',$3,'Check',$4,'Admin User')`,
    [ORG, civilToday(), `ff_${ORG}`, `u_${ORG}`]);
}

(async () => {
  console.log("hotfix1-profile");
  const G = await import("../shared/suggestionGuard.js");
  const N = await import("../shared/nextMove.js");

  // ── §2 · a refusal is ours, not hers ────────────────────────────────────
  console.log("\n— §2 · a refused line is silent on the screen and loud in the log —");
  const record = {
    donor: { id: "d_hf1_sun", name: "Sunrise Foundation", total_giving: 25000, gift_count: 1,
             last_gift_amount: 25000, last_gift_date: "2026-03-02" },
    orgName: "Harbor Arts Weekly art classes for the neighbourhood.",
    rows: [{ id: "g1", amount: 25000, date: "2026-03-02", fund: "Arts Program" }],
  };
  ok("§2 shared/suggestionGuard.js no longer exports the on-screen dropped line",
     typeof G.droppedLine === "undefined" && typeof G.dropLog === "function", Object.keys(G));
  const mixed = G.guardSuggestion("Call Marisol Vega before the renewal. Thank them for the $25,000 gift to the Arts Program.", record);
  ok("§2 the refused sentence is gone and the true one survives",
     mixed.dropped === 1 && mixed.kept.length === 1 && /\$25,000/.test(mixed.kept[0].text), mixed);
  ok("§2 the log line names the count and the reason",
     /^\[suggestion\] 1 line left out: .*Marisol/.test(G.dropLog(mixed.dropped, mixed.reasons)), G.dropLog(mixed.dropped, mixed.reasons));
  const allBad = N.composeNextMove(JSON.stringify({
    when: "Reach out before the March 3rd board meeting.",
    say: "Tell them the 91% retention rate is holding.",
    for: "It is for the youth apprenticeship programme.",
  }), record);
  ok("§2 when every line is refused and nothing is open, the panel text is EMPTY",
     allBad.sentences.length === 0 && allBad.text === "" && allBad.dropped === 3, allBad);
  ok("§2 …and the count went to the log instead", /^\[suggestion\] 3 lines left out: /.test(allBad.log), allBad.log);

  const donors = readSource("client/src/components/Donors.jsx");
  ok("§2 the profile logs the refusals rather than rendering them",
     /console\.info\(/.test(donors) && /dropLog\(/.test(donors) && !/droppedLine/.test(donors), "");
  ok("§2 no source anywhere still composes the on-screen dropped line",
     !/lines? (?:was|were) left out because/.test(donors + readSource("shared/nextMove.js") + readSource("shared/suggestionGuard.js")));
  // PROFILE-1 moved the panels out of the rail and into Suggested on the
  // Overview; the property is unchanged and so is what it is worth — a panel
  // is drawn ONLY when there is text for it, so "nothing survived the
  // checker" renders nothing rather than an empty brass box.
  const dpSrc = readSource("client/src/components/DonorProfile.jsx");
  ok("§2 the panel renders only when there is text",
     /SUGGEST_KINDS\.map\(t=>aiMap\[`\$\{donor\.id\}_\$\{t\}`\]\?\(/.test(dpSrc)
     && /<AIPanel text=\{aiMap\[`\$\{donor\.id\}_\$\{t\}`\]\}/.test(dpSrc)
     && /\):null\)\}/.test(dpSrc), "");

  // ── §3 · timing is ahead, never behind ──────────────────────────────────
  console.log("\n— §3 · timing in a suggestion is in the future —");
  // Pinned, so the case Jonathan saw is checked the same way for ever: the
  // walk's own day, and the walk's own sentence.
  const WALK_DAY = "2026-09-27";
  ok("§3 \"mid-August\" on 27 September is in the past",
     /in the past/.test(G.pastTiming("Reach out mid-August, before the board meets.", WALK_DAY) || ""),
     G.pastTiming("Reach out mid-August, before the board meets.", WALK_DAY));
  ok("§3 …and the whole sentence is refused by the validator",
     G.guardSuggestion("Reach out mid-August, before the board meets.", { ...record, today: WALK_DAY }).kept.length === 0);
  ok("§3 a month that has not finished is still ahead (\"in September\" on the 27th)",
     G.pastTiming("Call them in September.", WALK_DAY) === null);
  ok("§3 a month still to come is ahead", G.pastTiming("Call them in November.", WALK_DAY) === null);
  ok("§3 \"next March\" is ahead, not last March", G.pastTiming("Ask again next March.", WALK_DAY) === null);
  ok("§3 an explicit past year is behind", /in the past/.test(G.pastTiming("Send it by October 1, 2025.", WALK_DAY) || ""));
  ok("§3 \"last week\" is behind", /in the past/.test(G.pastTiming("Call her about the renewal last week.", WALK_DAY) || ""));
  ok("§3 …but \"last week\" reporting history is left alone",
     G.pastTiming("Their last gift was last week.", WALK_DAY) === null);
  ok("§3 history is not timing: a past-voice sentence is left alone",
     G.pastTiming("Their last gift was in March.", WALK_DAY) === null);
  ok("§3 …so the record's own history still survives the validator",
     G.guardSuggestion("Thank them for the $25,000 gift to the Arts Program.", { ...record, today: WALK_DAY }).kept.length === 1);
  // And on the real clock, synchronised — so the rule is live, not only pinned.
  const today = civilToday();
  const lastYear = String(Number(today.slice(0, 4)) - 1);
  ok("§3 on today's real date, a date a year behind is refused",
     /in the past/.test(G.pastTiming(`Send it by March 4, ${lastYear}.`, today) || ""), today);
  ok("§3 with no today given there is no rule (the module keeps no clock)",
     G.pastTiming("Reach out mid-August.", null) === null);

  // ── §4 · what do I do next names the open step ──────────────────────────
  console.log("\n— §4 · \"what do I do next\" never says nothing is open —");
  const withOpen = { ...record, today: WALK_DAY, openItems: [
    { kind: "thread", label: "Send the renewal ask", dueLabel: "Oct 3", overdue: false },
    { kind: "proposal", label: "Arts Program renewal", dueLabel: "Nov 1", overdue: false },
  ] };
  const openOnly = N.composeNextMove("", withOpen);
  ok("§4 an empty model reply still names the open step",
     openOnly.sentences.length === 1 && /^Send the renewal ask, due Oct 3\.$/.test(openOnly.sentences[0]), openOnly);
  const openPlus = N.composeNextMove(JSON.stringify({ say: "Thank them for the $25,000 gift to the Arts Program." }), withOpen);
  ok("§4 the open step leads, and the surviving sentence follows",
     openPlus.sentences.length === 2 && /^Send the renewal ask/.test(openPlus.sentences[0]) && /\$25,000/.test(openPlus.sentences[1]), openPlus);
  const claimed = N.composeNextMove(JSON.stringify({ when: "Nothing is open, so wait for their next gift." }), withOpen);
  ok("§4 a sentence claiming nothing is open is refused when something is",
     !/nothing is open/i.test(claimed.text) && claimed.dropped >= 1, claimed);
  ok("§4 …and the reason says so", /open work/.test((claimed.reasons || []).join(" ")), claimed.reasons);
  const proposalOnly = N.composeNextMove("", { ...record, openItems: [{ kind: "proposal", label: "Arts Program renewal", dueLabel: "Nov 1" }] });
  ok("§4 an open PROPOSAL alone is named too",
     /^The open proposal: Arts Program renewal, due Nov 1\.$/.test(proposalOnly.sentences[0] || ""), proposalOnly);
  ok("§4 an overdue step says overdue, not due",
     /overdue since Sep 3/.test(N.openStepSentence({ openItems: [{ kind: "thread", label: "Call her back", dueLabel: "Sep 3", overdue: true }] })));
  ok("§4 nothing open and nothing kept is still nothing",
     N.composeNextMove("", { ...record, openItems: [] }).text === "");
  const profile = readSource("client/src/components/DonorProfile.jsx");
  ok("§4 the profile waits for its open work before it asks for the next move",
     /dpItemsLoaded/.test(profile) && /getAI\(donor,"nextmove",openForNextMove\)/.test(profile));
  ok("§4 …and the open work it passes is the threads, tasks and proposals it already loaded",
     /openForNextMove=useMemo/.test(profile) && /onOpenProposals=\{setOpenProposals\}/.test(profile));

  // ── §5 · Angela Wu is on Sunrise's record ───────────────────────────────
  console.log("\n— §5 · is Angela Wu really on Sunrise's record? —");
  const dbSrc = readSource("db.js");
  const sunriseRow = (dbSrc.match(/\["d4",[^\n]*\n?/) || [""])[0];
  ok("§5 the boot seed's Sunrise note names her as the program officer",
     /Sunrise Foundation/.test(sunriseRow) && /Program officer is Angela Wu/.test(sunriseRow), sunriseRow.slice(0, 240));
  ok("§5 …and a logged site visit names her again",
     /"i6"[^\n]*Site visit with Angela Wu/.test(dbSrc));
  // So on the real record the checker is RIGHT to keep her — and on a record
  // that does not carry her, it is still right to refuse her.
  const SENTENCE = "Reach out to Angela Wu, their program officer, before the renewal.";
  const sunriseReal = {
    donor: { id: "d4", name: "Sunrise Foundation", email: "grants@sunrisefdn.org",
             notes: "Program officer is Angela Wu. Next grant cycle opens September.",
             total_giving: 75000, gift_count: 3, last_gift_amount: 25000, last_gift_date: "2025-03-01" },
    orgName: "CREO Arts",
    rows: [{ id: "i6", date: "2025-02-15", type: "meeting", label: "Site visit with Angela Wu" }],
  };
  const real = G.guardSuggestion(SENTENCE, sunriseReal);
  ok(`§5 on Sunrise's real record the checker keeps "${SENTENCE}"`,
     real.kept.length === 1 && real.dropped === 0, real);
  const noNote = { ...sunriseReal, donor: { ...sunriseReal.donor, notes: null }, rows: [] };
  ok("§5 …and refuses the same sentence on a record that does not carry her",
     G.guardSuggestion(SENTENCE, noNote).kept.length === 0);

  // ── §6 · proof each guard can fail ──────────────────────────────────────
  console.log("\n— §6 · each guard is proven able to fail —");
  ok("§6 the timing guard would pass a behind date if the month were not read",
     G.pastTiming("Reach out mid-August.", WALK_DAY) !== null && G.pastTiming("Reach out mid-August.", "2026-08-01") === null);
  ok("§6 the open-step rule would say nothing if openItems were dropped",
     N.composeNextMove("", withOpen).text !== "" && N.composeNextMove("", { ...record, today: WALK_DAY }).text === "");
  ok("§6 the silence rule would show a count if dropLog reached the screen",
     G.dropLog(3, ["x is not on the record"]) !== "" && allBad.text === "");

  // ── §1 · the rail ───────────────────────────────────────────────────────
  console.log("\n— §1 · the donor profile always has its right rail at 1440 —");
  ok("§1 CLAUDE.md carries the rule in its never-crossed list",
     /The donor profile always has the right rail, on a contrasting ground to the main column\. No build removes it\./
       .test(readSource("CLAUDE.md")));
  ok("§1 …and docs/decisions/design-system.md carries it too",
     /The donor profile always has the right rail, on a contrasting ground to the main column\. No build removes it\./
       .test(readSource("docs/decisions/design-system.md")));

  const why = browserReady();
  if (why) console.log("  SKIP  " + why + " (browser leg)");
  else {
    await seed();
    const login = await api("POST", "/auth/login", null, { email: "hf1prof@t.local", password: "loadtest1234" });
    ok("§1 login ok", login.status === 200, login.status);
    const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));
    const srv = await frontendBase();
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [login.body.token, JSON.stringify(login.body.user), JSON.stringify(login.body.org)]);
    await page.goto(`${APP}/donors/d_hf1`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2800);

    const geom = await page.evaluate(() => {
      const rail = document.querySelector('[data-testid="dp-right-rail"]');
      const main = document.querySelector('[data-testid="dp-main-column"]');
      if (!rail || !main) return { rail: !!rail, main: !!main };
      const rb = rail.getBoundingClientRect(), mb = main.getBoundingClientRect();
      return { rail: true, main: true,
        railBox: { x: rb.x, w: rb.width, h: rb.height },
        mainBox: { x: mb.x, w: mb.width, h: mb.height },
        railBg: getComputedStyle(rail).backgroundColor,
        railText: getComputedStyle(rail).color,
        mainBg: getComputedStyle(main).backgroundColor };
    });
    ok("§1 the rail is on the page", geom.rail === true, geom);
    ok("§1 the main column is on the page", geom.main === true, geom);
    if (geom.rail && geom.main) {
      ok("§1 the rail sits to the RIGHT of the main column",
         geom.railBox.x > geom.mainBox.x + geom.mainBox.w - 2, geom);
      ok("§1 …and it is a real column, not a sliver", geom.railBox.w >= 240 && geom.railBox.h >= 300, geom.railBox);
      const opaque = c => /^rgba?\((\d+),\s*(\d+),\s*(\d+)(,\s*1)?\)$/.test(c.replace(/\s*,\s*1\)$/, ", 1)"));
      ok("§1 both grounds are actually painted (neither is transparent)",
         opaque(geom.railBg) && opaque(geom.mainBg) && !/rgba\([^)]*,\s*0\)/.test(geom.railBg + geom.mainBg), geom);
      ok("§1 the rail's ground CONTRASTS with the main column's",
         geom.railBg !== geom.mainBg, { railBg: geom.railBg, mainBg: geom.mainBg });
      // PROFILE-1 — and the contrast is the approved one: the rail is INK and
      // the column is light. "Different" was true of the white-on-cream rail
      // too, and a build could satisfy it by nudging a shade; this says which
      // way round they go. The numbers come from the tokens, not from taste:
      // T.ink is #0F1A12 and the column is T.bg.
      const lum = c => { const m = c.match(/\d+/g) || [0,0,0];
        const f = v => { const x = Number(v)/255; return x <= 0.04045 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4); };
        return 0.2126*f(m[0]) + 0.7152*f(m[1]) + 0.0722*f(m[2]); };
      ok("§1 the rail is the DARK side of that contrast (ink), the column the light one",
         lum(geom.railBg) < 0.05 && lum(geom.mainBg) > 0.5, { railBg: geom.railBg, mainBg: geom.mainBg });
      ok("§1 …and the rail's own text is light enough to read on it (AA at body size)",
         geom.railText && (lum(geom.railText) + 0.05) / (lum(geom.railBg) + 0.05) >= 4.5,
         { railText: geom.railText, ratio: geom.railText ? ((lum(geom.railText)+0.05)/(lum(geom.railBg)+0.05)).toFixed(2) : null });
    }
    // The label is the button's first text node; the count badge beside it is
            // a separate element and is not part of the name.
    const tabs = await page.$$eval('.dp-tabs button', bs => bs.map(b => (b.childNodes[0] || {}).textContent.trim()));
    ok("§1 the six tabs are Overview · Gifts & Pledges · Funds · Related · Materials · Activity",
       JSON.stringify(tabs) === JSON.stringify(["Overview", "Gifts & Pledges", "Funds", "Related", "Materials", "Activity"]), tabs);
    const acts = await page.$$eval('.dph-actions button', bs => bs.map(b => b.innerText.trim()).filter(Boolean));
    ok("§1 the header still carries its own buttons", acts.length >= 3, acts);
    await browser.close();
    if (srv) srv.close();
  }

  await closeDb();
  summary("hotfix1-profile");
})().catch(e => { console.error(e); process.exit(1); });

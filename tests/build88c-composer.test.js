// BUILD-88c C.2 — NEVER A BLANK BOX. Run: node tests/build88c-composer.test.js
//
// THE TEST THE BRIEF ASKED FOR, in one sentence: opening Communications never
// renders an empty editor; a campaign send writes exactly one email conversation
// per recipient and none for the test send.
//
//   §1  THE SIX are real emails — the org's own name and vocabulary, copy that
//       could go out today, and no shouted placeholder anywhere. A shop that calls
//       its monthly givers "monthly donors" is not offered a sponsor update.
//   §2  THE SEGMENT IS PEOPLE. "17 sponsors, including Margaret Chen and Bob
//       Harmon" — nobody notices that 17 is too many; everybody notices a name
//       that should not be on the list.
//   §3  SEND ME A TEST goes to HER, is refused for anybody else, and counts
//       against nothing.
//   §4  ONE EMAIL CONVERSATION PER RECIPIENT on a send, so the timeline and
//       Drift can see what she sent — and NONE for the test.
//   §5  THE BROWSER: "New Campaign" opens on the six, not on a cursor; the
//       preview is the real email with the first recipient's own first name in
//       it; the merge fields are chips; and there is ONE emerald action.
//
// Local scratch server + Postgres + the :5602 sink (tests/README.md). §5 skips
// cleanly without Playwright or a localhost-API dist.

const http = require("http");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, SINK_PORT } = require("./helpers");

const ORG = "org_b88c2", ORG_PLAIN = "org_b88c2p";
const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const PORT = 4173;
const APP = `http://localhost:${PORT}`;

let captured = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", x => (b += x));
  req.on("end", () => {
    let json = null; try { json = b ? JSON.parse(b) : null; } catch { /* not json */ }
    captured.push({ path: req.url, method: req.method, body: json });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});
const mails = () => captured.filter(e => e.path === "/emails");

const CHILD = ["thank_you_drafts", "pledge_installments", "threads", "campaign_recipients", "campaigns",
  "digest_sends", "notification_sends", "email_suppressions", "receipts", "pledges", "fin_audit_log",
  "fin_transactions", "gifts", "interactions", "donors", "budgets", "accounts", "fin_funds", "imports", "users"];

const PEOPLE = [
  ["Margaret Chen", "margaret@b88c2.test"],
  ["Bob Harmon", "bob@b88c2.test"],
  ["Ruth Okafor", "ruth@b88c2.test"],
];

async function seed(org, slug, orgName, vocab) {
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,receipt_address,vocabulary_json)
           VALUES ($1,$2,$3,1,'active','team','America/New_York','1 Main St, Lexington KY',$4)`,
    [org, orgName, slug, vocab ? JSON.stringify(vocab) : null]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Ada Trelawney','admin')`,
    [`u_${org}`, org, `${slug}@t.local`, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype,active) VALUES ($1,$2,'4010','Contributions','revenue','contributions',true)`, [`acct_${org}`, org]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`, [`ff_${org}`, org]);
  let i = 0;
  for (const [name, email] of PEOPLE) {
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage) VALUES ($1,$2,$3,$4,'new','steward')`,
      [`d${i}_${org}`, org, name, email.replace("b88c2", slug)]);
    i++;
  }
}

const emailInteractions = org =>
  q(`SELECT donor_id, note, metadata FROM interactions WHERE org_id=$1 AND type='email' ORDER BY donor_id`, [org]);

(async () => {
  console.log("build88c-composer (C.2)");
  await new Promise((r, j) => { sink.on("error", j); sink.listen(SINK_PORT, r); });
  await seed(ORG, "b88c2", "Sparrow Missions",
    { monthly_giver_singular: "sponsor", monthly_giver_plural: "sponsors" });
  await seed(ORG_PLAIN, "b88c2p", "Heart of Africa", null);
  const tok = await login("b88c2@t.local");
  const tokPlain = await login("b88c2p@t.local");

  // ── §1 · the six are real emails ─────────────────────────────────────────
  console.log("\n— §1 · six real emails, in the org's own words —");
  const g = await api("GET", "/campaigns/templates", tok);
  ok("the gallery answers", g.status === 200, g.status);
  const six = g.body?.templates || [];
  ok("SIX templates for a shop that has sponsors", six.length === 6, six.map(t => t.key));
  ok("…Appeal, Thank-you, Year-end, Event invitation, Sponsor update, Newsletter",
    ["appeal", "thank_you", "year_end", "event_invitation", "sponsor_update", "newsletter"]
      .every(k => six.some(t => t.key === k)), six.map(t => t.key));
  const plain = (await api("GET", "/campaigns/templates", tokPlain)).body?.templates || [];
  ok("an org with no sponsors is not offered a sponsor update — FIVE",
    plain.length === 5 && !plain.some(t => t.key === "sponsor_update"), plain.map(t => t.key));

  const paras = t => (String(t.body || "").match(/<p>/g) || []).length;
  ok("every one is a written email — a subject and four or more paragraphs",
    six.every(t => (t.subject || "").length > 8 && paras(t) >= 4),
    six.map(t => [t.key, (t.subject || "").length, paras(t)]));

  // THE ONLY BLANKS ARE FACTS STEWARD CANNOT KNOW, and they are named. An event
  // has a date and Steward does not know it; a newsletter has news and Steward
  // does not have it. Writing a guess there would be worse than a blank. What is
  // forbidden is the OTHER kind: a template that is mostly brackets, or one that
  // leaves a blank where the copy could simply have been written.
  const blanks = t => (String(t.body || "").match(/\[[^\]]+\]/g) || []);
  const BLANK_BUDGET = { event_invitation: 3, newsletter: 3, sponsor_update: 1 };
  ok("only the three that need a fact Steward cannot know have blanks at all",
    six.every(t => blanks(t).length <= (BLANK_BUDGET[t.key] || 0)),
    six.map(t => [t.key, blanks(t)]).filter(([k, b]) => b.length > (BLANK_BUDGET[k] || 0)));
  ok("…every blank names what goes in it, in words, rather than shouting at her in capitals",
    six.every(t => blanks(t).every(b => b.length > 6 && /[a-z]{3}/.test(b) && !/YOUR|INSERT|TEXT HERE|LOREM|XXX/i.test(b))),
    six.flatMap(t => blanks(t)));
  ok("…and no template is mostly blanks — the copy is the email, the blank is a line of it",
    six.every(t => blanks(t).join("").length < String(t.body).length * 0.25),
    six.map(t => [t.key, blanks(t).join("").length, String(t.body).length]));

  ok("the org's own name is in the copy, not \"your organisation\"",
    six.every(t => /Sparrow Missions/.test(t.subject + t.body)) &&
    !six.some(t => /your organisation/i.test(`${t.label} ${t.blurb} ${t.subject} ${t.body}`)),
    six.filter(t => !/Sparrow Missions/.test(t.subject + t.body)).map(t => t.key));
  const sponsorTpl = six.find(t => t.key === "sponsor_update") || {};
  ok("the sponsor template speaks the org's word for a monthly giver",
    /sponsor/i.test(`${sponsorTpl.label} ${sponsorTpl.subject} ${sponsorTpl.body}`), sponsorTpl.subject);
  ok("the merge fields the gallery offers are the ones the renderer replaces",
    (g.body?.mergeFields || []).length >= 5 && !(g.body?.mergeFields || []).some(f => /last_name/.test(f.token)),
    (g.body?.mergeFields || []).map(f => f.token));
  // THE VOICE. Six emails is six chances to sound like software.
  ok("no em dash, no exclamation mark and no \"Dear Friend\" in any of the six",
    !six.some(t => /—|!|Dear Friend/i.test(t.subject + t.body)),
    six.filter(t => /—|!|Dear Friend/i.test(t.subject + t.body)).map(t => [t.key, t.subject]));

  // ── §2 · the segment is people ───────────────────────────────────────────
  console.log("\n— §2 · the segment reads as people —");
  const seg = await api("POST", "/campaigns/segment-preview", tok, { segment: { mode: "all" } });
  ok("the preview answers with a count and the names", seg.status === 200 && seg.body.count === 3, seg.body);
  ok("…as a sentence with two of them in it",
    /^3 donors, including .+ and .+\.$/.test(seg.body.sentence || ""), seg.body.sentence);
  ok("…and it names the FIRST recipient, so the preview can use her name",
    !!seg.body.first?.firstName && PEOPLE.some(p => p[0].startsWith(seg.body.first.firstName)), seg.body.first);
  const segNone = await api("POST", "/campaigns/segment-preview", tok, { segment: { mode: "manual", donorIds: [] } });
  ok("an empty segment says so in words, and does not say \"0\"",
    /^Nobody yet\./.test(segNone.body.sentence || "") && !/\b0\b/.test(segNone.body.sentence || ""), segNone.body.sentence);
  // THE ONE THAT MATTERS. An empty explicit segment used to fall through to
  // EVERY donor with an email address, in the preview and in the send — she
  // deselects everybody, presses send, and the whole list gets it.
  ok("…and an empty segment is NOBODY, not everybody", segNone.body.count === 0, segNone.body.count);
  const segNoStage = await api("POST", "/campaigns/segment-preview", tok, { segment: { mode: "byStage", stages: [] } });
  ok("…the same for a stage segment that names no stage", segNoStage.body.count === 0, segNoStage.body.count);
  const emptyCamp = await api("POST", "/campaigns", tok, {
    name: "Nobody", subject: "x", body: "<p>Hello {{first_name}}.</p>",
    segment: { mode: "manual", donorIds: [] }, status: "draft" });
  captured = [];
  const emptySend = await api("POST", `/campaigns/${emptyCamp.body.id}/send`, tok);
  await new Promise(r => setTimeout(r, 1200));
  ok("…and SENDING it sends to nobody", mails().length === 0,
    { status: emptySend.status, sent: mails().map(m => m.body?.to) });

  // ── §3 + §4 · the test, the send, and what each one logs ─────────────────
  console.log("\n— §3 · send me a test —");
  const camp = await api("POST", "/campaigns", tok, {
    name: "Spring appeal", subject: "A short ask from Sparrow Missions",
    body: "<p>Dear {{first_name}},</p><p>Thank you. {{org_name}}</p>",
    segment: { mode: "all" }, status: "draft" });
  ok("a campaign is drafted", camp.status === 200 || camp.status === 201, camp.status);
  const cid = camp.body.id;

  captured = [];
  const test = await api("POST", `/campaigns/${cid}/test`, tok, {});
  ok("the test is sent", test.status === 200, test.body);
  ok("…to HER, not to a donor", test.body.to === "b88c2@t.local", test.body.to);
  ok("…and it says, in the payload, that it is not counted", test.body.counted === false, test.body);
  for (let i = 0; i < 40 && mails().length === 0; i++) await new Promise(r => setTimeout(r, 100));
  const testMail = mails()[0];
  ok("…one email left, addressed to her", mails().length === 1 && String(testMail?.body?.to) === "b88c2@t.local",
    { n: mails().length, to: testMail?.body?.to });
  ok("…with her own first name merged in, not a brace",
    /Ada/.test(testMail?.body?.html || "") && !/{{/.test(testMail?.body?.html || ""),
    (testMail?.body?.html || "").slice(0, 200));
  ok("…and it says on its face that nobody else got it",
    /Nobody else received it, and it is not counted/.test(testMail?.body?.html || ""), null);

  const other = await api("POST", `/campaigns/${cid}/test`, tok, { to: "margaret@b88c2.test" });
  ok("a \"test\" to a donor is REFUSED — that is a send, and it belongs on the campaign",
    other.status === 403 && other.body.error === "test_to_self", { status: other.status, body: other.body });

  const afterTestRows = await emailInteractions(ORG);
  ok("THE TEST WROTE NO CONVERSATION ON ANYBODY'S RECORD", afterTestRows.length === 0, afterTestRows);
  const [recipAfterTest] = await q("SELECT COUNT(*)::int AS n FROM campaign_recipients WHERE campaign_id=$1", [cid]);
  ok("…and it created no recipient row, so the campaign's count did not move", recipAfterTest.n === 0, recipAfterTest);

  console.log("\n— §4 · one email conversation per recipient, and one only —");
  captured = [];
  const sent = await api("POST", `/campaigns/${cid}/send`, tok);
  ok("the campaign sends", sent.status === 200, sent.body);
  for (let i = 0; i < 80 && mails().length < 3; i++) await new Promise(r => setTimeout(r, 100));
  ok("three emails left", mails().length === 3, mails().map(m => m.body?.to));

  // The interaction is written after the send, on the same tick — poll rather
  // than sleep, the way BUILD-87 learned to.
  let rows = [];
  for (let i = 0; i < 60; i++) { rows = await emailInteractions(ORG); if (rows.length >= 3) break; await new Promise(r => setTimeout(r, 100)); }
  ok("EXACTLY ONE email conversation per recipient — three donors, three rows", rows.length === 3, rows.length);
  ok("…one per donor, none twice", new Set(rows.map(r => r.donor_id)).size === 3, rows.map(r => r.donor_id));
  ok("…each one names the campaign, so the timeline says what she sent",
    rows.every(r => /Sent "Spring appeal"\./.test(r.note || "")), rows.map(r => r.note));
  ok("…and each one is marked as a campaign send, so Drift can tell it from a typed email",
    rows.every(r => {
      const m = typeof r.metadata === "string" ? JSON.parse(r.metadata || "{}") : (r.metadata || {});
      return m.via === "campaign" && m.campaignId === cid;
    }), rows.map(r => r.metadata));

  // Sending is not re-runnable, but a second test after the send must still
  // leave the count alone — this is the assertion that keeps "not counted"
  // true forever and not just on the first press.
  captured = [];
  await api("POST", `/campaigns/${cid}/test`, tok, {});
  const rowsAfter = await emailInteractions(ORG);
  ok("a test AFTER the send still writes nothing on anybody's record", rowsAfter.length === 3, rowsAfter.length);

  // ── §5 · the browser ─────────────────────────────────────────────────────
  console.log("\n— §5 · the browser: never a blank box —");
  const browserSkip = why => { console.log("  SKIP  §5 — " + why); return null; };
  let chromium = null, srv = null;
  if (!fs.existsSync(path.join(DIST, "index.html"))) browserSkip("client/dist not built");
  else {
    const API_ORIGIN = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
    const distJs = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
    if (!distJs.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(API_ORIGIN)))
      browserSkip("client/dist not built against the local API");
    else {
      try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); }
      catch { browserSkip("Playwright not found (set PLAYWRIGHT_DIR)"); }
    }
  }

  if (chromium) {
    const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png" };
    let serving = false;
    try { const r = await fetch(APP + "/", { signal: AbortSignal.timeout(1500) }); serving = r.ok; } catch { /* not up */ }
    if (!serving) {
      srv = http.createServer((req, res) => {
        const url = decodeURIComponent(req.url.split("?")[0]);
        if (url.startsWith("/_vercel/")) { res.statusCode = 404; return res.end(); }
        let file = path.join(DIST, url);
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
        res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
        res.end(fs.readFileSync(file));
      });
      await new Promise(r => srv.listen(PORT, r));
    }
    const auth = (await api("POST", "/auth/login", null, { email: "b88c2@t.local", password: "loadtest1234" })).body;
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", e => { if (!/Unexpected token '<'/.test(e.message)) console.log("  [pageerror]", e.message.slice(0, 300)); });
    await page.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org)]);
    // The app does not sync tab to URL — Communications is reached the way she
    // reaches it, through the rail's "More" group.
    await page.addInitScript(() => { try { localStorage.setItem("steward_nav_more", "1"); } catch { /* private mode */ } });
    await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2800);
    await page.click('button:has-text("Communications")');
    await page.waitForTimeout(2000);

    await page.click('button:has-text("New Campaign")');
    await page.waitForTimeout(1200);
    ok("\"New Campaign\" opens on the six, not on a cursor",
      await page.$('[data-testid="campaign-gallery"]') !== null);
    ok("THE EDITOR IS NOT ON THE SCREEN YET — there is no empty box to stare at",
      await page.$('[data-testid="campaign-editor"]') === null);
    const cards = await page.$$('[data-testid^="template-"]');
    ok("six of them", cards.length === 6, cards.length);
    const galleryText = await page.innerText('[data-testid="campaign-gallery"]');
    ok("…each one showing real copy in the org's name", /Sparrow Missions/.test(galleryText) && galleryText.length > 800, galleryText.length);
    ok("…with no merge braces left showing", !/{{/.test(galleryText), (galleryText.match(/.{0,30}{{.{0,30}/) || [])[0]);

    await page.click('[data-testid="template-appeal"]');
    await page.waitForTimeout(1500);
    const bodyHtml = await page.$eval('[data-testid="campaign-editor"]', el => el.innerHTML);
    ok("picking one opens the builder with the words ALREADY IN IT", bodyHtml.length > 400, bodyHtml.length);

    const preview = await page.$eval('[data-testid="campaign-preview"]', el => el.innerText);
    ok("the preview beside it is the real email", /Sparrow Missions/.test(preview) && preview.length > 300, preview.length);
    ok("…with the FIRST RECIPIENT's own first name in it, not a brace",
      /Margaret/.test(preview) && !/{{/.test(preview), preview.slice(0, 200));
    const previewWidth = await page.$eval('[data-testid="campaign-preview"]', el => el.getBoundingClientRect().width);
    ok("…at a phone's width", previewWidth <= 390 && previewWidth >= 260, previewWidth);

    const chipTokens = await page.$$eval("button[title^='{{']", els => els.map(e => e.getAttribute("title")));
    ok("the merge fields are CHIPS in the editor", chipTokens.length >= 5, chipTokens);
    ok("…and every chip is a field the renderer actually replaces",
      chipTokens.every(t => ["{{first_name}}", "{{donor_name}}", "{{org_name}}", "{{gift_amount}}", "{{total_giving}}", "{{year}}"].includes(t)), chipTokens);

    const segText = await page.innerText('[data-testid="segment-sentence"]');
    ok("the segment reads as people on the screen too", /^3 donors, including .+ and .+\.$/.test(segText.trim()), segText);

    const buttons = await page.$$eval("button", els => els.map(b => ({
      text: (b.innerText || "").trim(), bg: getComputedStyle(b).backgroundColor,
    })));
    const emerald = buttons.filter(b => b.bg === "rgb(13, 92, 58)");
    ok("ONE emerald action on the screen", emerald.length === 1, emerald);
    ok("…and it is the send, and it says who it is going to",
      emerald[0] && /Send to 3/.test(emerald[0].text), emerald[0]);
    ok("…with scheduling as a secondary link, not a second button",
      buttons.some(b => /Schedule it instead/.test(b.text) && b.bg === "rgba(0, 0, 0, 0)"),
      buttons.filter(b => /Schedule/.test(b.text)));
    ok("\"Send me a test\" is on the screen, beside the email it would send",
      await page.$('[data-testid="send-me-a-test"]') !== null);

    await browser.close();
    if (srv) srv.close();
    void cards;
  }

  summary("build88c-composer");
  sink.close();
  await closeDb();
})();

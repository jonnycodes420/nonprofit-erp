// tests/flows18.test.js · FLOWS-18 (lead-2026-11-17). The build's one new suite: it guards money
// (who is counted a donor, what a giving page says about its end) and donor email (what a starter
// and a draft say to a donor).
//
// §1 Days left (W-1117-Atlas-01X). One function, shared/numbers/endsOn.js, in the org's day: Dec 31
//    read on Nov 17 is 44 days, on Dec 31 itself "Last day" (never "Ended"), on Jan 1 "Ended"; a
//    leap day; an evening in the org's zone that is already tomorrow in UTC. The campaign list
//    reads it (a campaign ending today is Active, "Last day"), and no surface keeps its own count.
// §2 Starters (W-1116-Fundraising-15X). Every starter and template names only fields its engine
//    fills; the Thank-you starter, previewed for a person whose newest row is a refund, shows their
//    last real gift and no "{{".
// §3 Givers are donors (W-1117-Fundraising-01). A giver typed organisation only (Meridian's shape) is
//    on the Donors tab, found by a Donors search, Donor on their profile, in the portfolio file, and
//    assertSurfacesAgree's giversAreDonors check holds.
// §4 Peer-to-peer teams (W-1117-Volunteers-30). A row's team is the team card's own: a row never
//    names a team its card does not count, in the payload or on the first paint.
// §5 The morning email (W-1117-Volunteers-19). Every sentence reads shared/morningEmailState.js; Tasks
//    says it is off (with the link) when it is, and when the org's staff mail is off, and the hour
//    when it is on.
// §6 Draft an email (W-1113-Donors-26). The template opens with the About note's detail; the model is
//    told to use it, not "for tone only"; a model draft without it is not used.
//
// PROVEN ABLE TO FAIL (each planted, each red, then put back):
//   · endsOn reading a Dec 31 end as the end of the year before (`end.slice(5) === "12-31"` → ended)
//     → §1 Dec 31 in November red.
//   · the Thank-you starter back on {{gift_amount}} → §2 "every starter" and the refund preview red.
//   · groups.js role=donor back on PT.typeSql("donor") → §3 Donors search, counts and truth check red.
//   · the row's team read from the row before it in PeerToPeer.jsx → §4 first paint red.
//   · Tasks' line hard-coded "Your morning email lists these…" → §5 off/org_off red.
//   · draftTemplate without the About line → §6 template red.
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary, api, q, closeDb, browserLegOrSkip, civilToday, waitFor } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const BASE = process.env.BASE || "http://localhost:5601";
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const { DIST } = require("./lib/dist");
const PASSWORD = "loadtest1234";
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const addDays = require("../orgTime").addDays;

(async () => {
  console.log("flows18 (FLOWS-18)");
  const run = require("crypto").randomBytes(4).toString("hex");
  const EMAIL = `owner-${run}@flows18.local`;
  const reg = await fetch(BASE + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: `Flows Eighteen Wrenfield Trust ${run}`, userName: "Ottoline Brasher", email: EMAIL, password: PASSWORD, provisioned: true, demoData: false }) });
  const rb = await reg.json();
  if (reg.status !== 201 || !rb.token) throw new Error(`register-org: ${reg.status} ${JSON.stringify(rb).slice(0, 200)}`);
  const tok = rb.token, ORG = rb.org.id, USER = rb.user.id, today = civilToday();
  await q(`UPDATE orgs SET onboarding_complete=1, onboarded_at=NOW() WHERE id=$1`, [ORG]);
  await q(`UPDATE users SET welcomed_at=NOW() WHERE org_id=$1`, [ORG]);
  const person = async (name, extra = {}) => {
    const r = await api("POST", "/donors", tok, { name, email: `${name.split(" ")[0].toLowerCase()}-${run}@flows18.invalid`, ...extra });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return r.body.id;
  };
  const give = async (id, amount, date) => {
    const g = await api("POST", `/donors/${id}/gifts`, tok, { amount, date, type: "cash", paymentMethod: "Check" });
    const gid = g.body && (g.body.gift ? g.body.gift.id : g.body.id);
    if (!gid) throw new Error(`gift: ${g.status} ${JSON.stringify(g.body).slice(0, 160)}`);
    return gid;
  };

  // ── §1 days left ─────────────────────────────────────────────────────────
  const E = require("../shared/numbers/endsOn");
  const y = Number(today.slice(0, 4));
  const st = (end, t) => { const r = E.endsOn(end, { today: t }); return `${r.state}|${r.daysLeft}|${r.words}`; };
  ok("§1 Dec 31 read on Nov 17 is 44 days left, open (staging: \"0 days left\", \"Ended\")", st("2026-12-31", "2026-11-17") === "open|44|44 days left", st("2026-12-31", "2026-11-17"));
  ok("§1 Dec 31 read on Dec 31 is the last day: \"Last day\", never \"Ended\" or \"0 days left\"", st("2026-12-31", "2026-12-31") === "last_day|0|Last day", st("2026-12-31", "2026-12-31"));
  ok("§1 Dec 31 read on Jan 1 has ended", st("2026-12-31", "2027-01-01") === "ended|0|Ended", st("2026-12-31", "2027-01-01"));
  ok("§1 a leap day: Feb 29, 2028 is 1 day left on Feb 28, the last day on Feb 29, ended on Mar 1",
    st("2028-02-29", "2028-02-28") === "open|1|1 day left" && st("2028-02-29", "2028-02-29") === "last_day|0|Last day" && st("2028-02-29", "2028-03-01").startsWith("ended"),
    [st("2028-02-29", "2028-02-28"), st("2028-02-29", "2028-02-29"), st("2028-02-29", "2028-03-01")]);
  const eve = E.endsOn("2026-12-31", { tz: "America/New_York", at: new Date("2026-12-31T21:00:00-05:00") });
  ok("§1 9pm Eastern on Dec 31 (Jan 1 in UTC) is still the last day, in the org's zone", eve.state === "last_day", eve);
  const evePrev = E.endsOn("2026-12-31", { tz: "America/New_York", at: new Date("2026-12-30T20:00:00-05:00") });
  ok("§1 8pm Eastern on Dec 30 is 1 day left (the old count said Ended from 7pm, by UTC midnight)", evePrev.state === "open" && evePrev.daysLeft === 1, evePrev);
  ok("§1 \"Not open yet\" is never a days-left state: the rule has none", !Object.values(E.endsOn("2026-12-31", { today: "2026-11-17" })).some(v => /not open/i.test(String(v))), null);

  const camp = async (name, endDate, startDate) => {
    const r = await api("POST", "/fundraising/campaigns", tok, { name, goalAmount: 60000, startDate, endDate });
    if (!r.body || !(r.body.id || (r.body.campaign && r.body.campaign.id))) throw new Error(`campaign ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return r.body.id || r.body.campaign.id;
  };
  const cYear = await camp("Year-end Wrenfield", addDays(today, 44), addDays(today, -24));
  const cLast = await camp("Last Light Appeal", today, addDays(today, -30));
  const cGone = await camp("Spring Lanterns", addDays(today, -1), addDays(today, -60));
  const list = await api("GET", "/fundraising/campaigns", tok);
  const goals = (list.body && (list.body.goals || list.body.campaigns)) || (Array.isArray(list.body) ? list.body : []);
  const g = id => goals.find(x => x.id === id) || {};
  ok("§1 the campaign list: a goal 44 days out is Active with 44 days left", g(cYear).lifecycle === "active" && g(cYear).daysLeft === 44 && g(cYear).endsWords === "44 days left", g(cYear));
  ok("§1 the campaign list: a goal ending today is Active, \"Last day\" (main: Ended from 7pm the night before)",
    g(cLast).lifecycle === "active" && g(cLast).endsWords === "Last day", { lifecycle: g(cLast).lifecycle, words: g(cLast).endsWords });
  ok("§1 the campaign list: a goal that ended yesterday is Ended", g(cGone).lifecycle === "ended", g(cGone).lifecycle);
  const src = ["server/reports/helpers.js", "server/shared/givingPagePayload.js", "server/boot/helpers-8.js", "shared/campaignPage.js"];
  const own = src.filter(f => /Math\.(ceil|round)\(\(\s*(new Date|Date\.parse)\([^)]*(end|campaign_end_date)/i.test(read(f)) || !/endsOn/.test(read(f)));
  ok("§1 every days-left surface reads endsOn and keeps no count of its own", own.length === 0, own);
  ok("§1 the client's words come from the server's rule (0 days on an active goal is \"last day\")",
    /daysLeftText\(dl, words = null\)/.test(read("client/src/components/CampaignsList.jsx")) && /if \(dl === 0\) return "last day"/.test(read("client/src/components/CampaignsList.jsx"))
    && /givingPage\.ends\.words/.test(read("client/src/pages/Donate.jsx")), null);

  // ── §2 starters ──────────────────────────────────────────────────────────
  const EB = await import("../shared/emailBlocks.js");
  const ET = await import("../shared/emailTemplates.js");
  const LIB = await import("../shared/emailTemplateLibrary.js");
  const BK = await import("../shared/brandKit.js");
  const tags = s => [...String(s || "").matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(m => m[1]);
  const blockKeys = new Set([...EB.EMAIL_MERGE_FIELDS.map(f => f.key), "first", "org"]);
  const bad = [];
  for (const t of ET.templatesFor({ orgName: "Wrenfield Trust" })) for (const k of tags(t.subject + t.body)) if (!blockKeys.has(k)) bad.push(`campaign starter "${t.key}": {{${k}}}`);
  for (const t of LIB.EMAIL_STARTERS) for (const k of tags(JSON.stringify(t))) if (!blockKeys.has(k) && k !== "tax_language") bad.push(`email template "${t.key}": {{${k}}}`);
  const personKeys = new Set(BK.MERGE_FIELDS.map(f => f.key));
  for (const t of BK.TEMPLATE_KINDS) for (const k of tags(t.subject + t.body)) if (!personKeys.has(k)) bad.push(`letter "${t.kind}": {{${k}}}`);
  ok("§2 every starter, template and letter names only fields its engine fills (staging: {{gift_amount}} in the block editor)", bad.length === 0, bad);
  for (const t of ET.templatesFor({ orgName: "Wrenfield Trust" })) {
    const blocks = LIB.campaignBlocksFromHtml(t.key, t.body);
    const r = EB.renderEmail({ blocks, brand: {}, fields: { first_name: "Silas", last_gift_amount: "$5,801", org_name: "Wrenfield Trust" }, subject: t.subject, mode: "preview" });
    if ((r.problems || []).some(p => /not a field/.test(p)) || /\{\{/.test(r.html || "")) bad.push(`${t.key}: ${(r.problems || []).join(" ")}`);
  }
  ok("§2 each campaign starter, opened as blocks the way New campaign opens it, renders with no unknown field and no \"{{\"", bad.length === 0, bad);
  const old = EB.renderEmail({ blocks: [{ id: "b1", type: "richtext", blocks: [{ type: "p", text: "Thank you for your gift of {{gift_amount}}." }] }], brand: {},
    fields: { first_name: "Silas", last_gift_amount: "$5,801", org_name: "Wrenfield Trust" }, subject: "Thanks", mode: "preview" });
  ok("§2 a draft already saved from the old starter ({{gift_amount}}) reads the last real gift, not the tag",
    /\$5,801/.test(old.html || "") && !/\{\{/.test(old.html || "") && !(old.problems || []).length, old.problems);
  const silas = await person("Silas Wexford-Pryce");
  const g1 = await give(silas, 5801, addDays(today, -40));
  const rf = await api("POST", `/gifts/${g1}/refund`, tok, { amount: 25, date: addDays(today, -2), reason: "Card charged twice for the parking add-on" });
  ok("§2 fixture: a $25 refund is Silas's newest row", rf.status < 300, rf.body);
  const tpls = await api("GET", "/campaigns/templates", tok);
  const ty = ((tpls.body && tpls.body.templates) || []).find(t => t.key === "thank_you");
  const pv = ty ? await api("POST", "/email-preview", tok, { blocks: LIB.campaignBlocksFromHtml("thank_you", ty.body), subject: ty.subject, as: silas, campaign: true }) : { body: {} };
  const pvText = String((pv.body && pv.body.html) || "").replace(/<[^>]+>/g, " ");
  ok("§2 the Thank-you starter previewed for Silas (newest row a refund) names his last real gift, $5,801, and no \"{{\"",
    /\$5,801/.test(pvText) && !/\{\{/.test(pv.body && pv.body.html || "") && !/-\$?25|\$-25/.test(pvText) && !((pv.body.problems || []).length),
    { status: pv.status, problems: pv.body && pv.body.problems, text: pvText.replace(/\s+/g, " ").slice(0, 300) });

  // ── §3 givers are donors ─────────────────────────────────────────────────
  const mer = await person("Meridian Halyard Foundation", { kind: "organization" });
  await give(mer, 55000, addDays(today, -90));
  // The staging shape: roles written by an older path, organisation only, with the gift on file.
  await q(`UPDATE donors SET person_types='["organization"]'::jsonb WHERE id=$1`, [mer]);
  const search = await api("GET", `/donors?role=donor&search=${encodeURIComponent("Meridian Halyard")}&roleCounts=1&limit=25`, tok);
  ok("§3 a Donors search finds a $55,000 giver typed organisation only (staging: \"Donors 0\")",
    (search.body.donors || []).some(d => d.id === mer) && search.body.roleCounts && search.body.roleCounts.donors >= 1, { total: search.body.total, rc: search.body.roleCounts });
  const prof = await api("GET", `/donors/${mer}`, tok);
  const types = (prof.body && (prof.body.person_types || (prof.body.donor && prof.body.donor.person_types))) || [];
  // "organization" is not a person type; it reads as Other (shared/personType.js), and Donor is added beside it.
  ok("§3 their profile reads Donor beside their own role, on read", types[0] === "donor" && types.length === 2, types);
  const [stored] = await q(`SELECT person_types FROM donors WHERE id=$1`, [mer]);
  ok("§3 ...and nothing stored changed", JSON.stringify(stored.person_types) === '["organization"]', stored.person_types);
  const po = await api("GET", "/portfolio/officers", tok);
  ok("§3 the portfolio file counts their $55,000, and its sentence says every giver is on the Donors tab",
    po.body && po.body.file && Math.round(po.body.file.allGiving * 100) === Math.round(po.body.file.file.giving * 100) && /everyone who has given is on the Donors tab/.test(po.body.file.sentence || ""),
    po.body && po.body.file && { all: po.body.file.allGiving, file: po.body.file.file, sentence: po.body.file.sentence });
  const { assertSurfacesAgree } = require("./lib/surfacesAgree");
  const sa = await assertSurfacesAgree(ORG, { token: tok, only: ["giversAreDonors"], soft: true, label: "§3" });
  ok("§3 assertSurfacesAgree: the Donors and Contacts counts are the rule's, and no giver's money is off the Donors tab",
    sa.ok && sa.facts && Object.keys(sa.facts).some(k => /marked Donor or has given/.test(k)), sa.diffs);

  // ── §4 peer-to-peer teams ────────────────────────────────────────────────
  const p1 = await api("POST", "/giving-pages", tok, { title: "Spring Oar Relay", goalAmount: 15000, p2pEnabled: true });
  const p2 = await api("POST", "/giving-pages", tok, { title: "Autumn Lantern Walk", goalAmount: 5000 });
  const P1 = p1.body.id || (p1.body.page && p1.body.page.id), P2 = p2.body.id || (p2.body.page && p2.body.page.id);
  const tA = (await api("POST", `/giving-pages/${P1}/teams`, tok, { name: "Quayside Rowers" })).body.id;
  const tB = (await api("POST", `/giving-pages/${P2}/teams`, tok, { name: "Lamplighters" })).body.id;
  const fr = async (name, teamId) => (await api("POST", `/giving-pages/${P1}/fundraisers`, tok, { name, email: `${name.split(" ")[0].toLowerCase()}-${run}@flows18.invalid`, personalGoalAmount: 600, teamId })).body;
  const fa = await fr("Gideon Marlowe-Tate", tA);
  const fb = await fr("Noor Delafield", null);
  const fbId = fb.id || (fb.fundraiser && fb.fundraiser.id);
  // A row whose team is not this campaign's team (moved, or read a moment apart): staging's Noor.
  await q(`UPDATE peer_fundraisers SET team_id=$1 WHERE id=$2`, [tB, fbId]);
  const p2p = (await api("GET", `/giving-pages/${P1}/p2p`, tok)).body;
  const cardOf = id => (p2p.teams || []).find(t => t.id === id);
  const stray = (p2p.fundraisers || []).filter(f => f.teamName && (!cardOf(f.teamId) || cardOf(f.teamId).name !== f.teamName));
  ok("§4 no row names a team its campaign's team cards don't hold (staging: Noor read \"Dockside Paddlers\")", stray.length === 0, stray.map(f => `${f.name}: ${f.teamName}`));
  const unfooted = (p2p.teams || []).filter(t => t.members !== (p2p.fundraisers || []).filter(f => f.teamId === t.id && f.status === "active").length);
  ok("§4 each team card counts exactly the rows that carry its name", unfooted.length === 0 && cardOf(tA) && cardOf(tA).members === 1, (p2p.teams || []).map(t => `${t.name} ${t.members}`));
  void fa;

  // ── §5 the morning email ─────────────────────────────────────────────────
  const MS = await import("../shared/morningEmailState.js");
  const onOrg = { onboarded_at: "2026-01-01", staff_mail_enabled: true, timezone: "America/New_York" };
  const sOn = MS.morningEmailState({ morningEmail: true, brief: { hour: 7, days: "weekdays" } }, onOrg);
  const sOff = MS.morningEmailState({ morningEmail: false, brief: { hour: 8 } }, onOrg);
  const sOrg = MS.morningEmailState({ morningEmail: true, brief: { hour: 8 } }, { ...onOrg, staff_mail_enabled: false });
  ok("§5 on: Tasks names her own hour and days", sOn.state === "on" && /7:00 AM/.test(MS.morningEmailSentence(sOn)) && /weekday/.test(MS.morningEmailSentence(sOn)), MS.morningEmailSentence(sOn));
  ok("§5 off: Tasks says it is off, and promises no email", sOff.state === "off" && /is off/.test(MS.morningEmailSentence(sOff)) && !/lists these/.test(MS.morningEmailSentence(sOff)), MS.morningEmailSentence(sOff));
  ok("§5 the org's staff mail off: Tasks says Steward is not sending staff email, whatever her switch says (staging)", sOrg.state === "org_off" && /not sending staff email/.test(MS.morningEmailSentence(sOrg)), MS.morningEmailSentence(sOrg));
  ok("§5 a next step promises the morning email only when it is on",
    /morning email/.test(MS.morningEmailSentence(sOn, "step")) && !/morning email/.test(MS.morningEmailSentence(sOff, "step")), null);
  const hard = [];
  const walk = d => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, n.name);
    if (n.isDirectory()) { if (!/marketing|node_modules/.test(n.name)) walk(p); continue; }
    if (!/\.(jsx|js)$/.test(n.name)) continue;
    const lines = fs.readFileSync(p, "utf8").split("\n");
    // The code on the line, without a trailing // comment (a comment may say "morning email").
    lines.forEach((l, i) => { const code = l.replace(/\s\/\/ .*$/, "");
      if (/morning email/i.test(code) && !/^\s*(\/\/|\*|\{\/\*)/.test(code) && !/^\s*import /.test(code) && /["'`>]/.test(code)) hard.push(`${path.relative(ROOT, p)}:${i + 1}`); }); } };
  walk(path.join(ROOT, "client/src"));
  // Settings → Your email describes the email itself; everything else must ask the state.
  const allowed = /MyEmail\.jsx|MorningEmailPreview\.jsx|lib\/morningEmail\.js|settingsTabs\.js/;
  const loose = hard.filter(h => !allowed.test(h) && !/morningEmailSentence|mail && mail\.on|mail\.on/.test(fs.readFileSync(path.join(ROOT, h.split(":")[0]), "utf8").split("\n")[Number(h.split(":")[1]) - 1]));
  ok("§5 no screen outside Settings → Your email writes a morning-email sentence of its own", loose.length === 0, loose);

  // ── §6 Draft an email ────────────────────────────────────────────────────
  const DA = await import("../shared/draftAbout.js");
  const AT = await import("../shared/atlas.js");
  const NOTE = "Margaret funds the Harbor Skills Boat because her granddaughter Lily learned to sail on it. She also gave the pottery wheel for the art room.";
  const tpl = DA.draftTemplate({ firstName: "Margaret", opening: "Dear Margaret,", thanks: false,
    fact: "Thank you for your gift of $15,000 on September 14, 2026. It made a real difference here.", aboutThem: NOTE });
  const opening = tpl.body.split(/\n+/).filter(Boolean).slice(1, 4).join(" ");
  ok("§6 the template (AI off) opens with the About note's detail: the Harbor Skills Boat and Lily (staging: a form letter)",
    /Harbor Skills Boat/.test(opening) && /Lily/.test(opening) && DA.opensWithAbout(tpl.body, NOTE, { name: "Margaret Chen" }), tpl.body);
  ok("§6 a form-letter draft with none of it is caught (the model's draft is then not used)",
    !DA.opensWithAbout("Dear Margaret,\nThank you for your gift of $15,000 on September 14, 2026. It made a real difference here.\nWith gratitude,", NOTE, { name: "Margaret Chen" }), null);
  const pr = AT.buildDraftPrompt({ firstName: "Margaret", words: "Draft an email to Margaret Chen", aboutThem: NOTE, facts: ["Giving on record: $15,000 across 1 gifts."] });
  const said = pr.messages[0].content;
  ok("§6 the model is told to open with the note's detail, not \"for tone only\" (why FLOWS-10's draft stayed generic)",
    /Harbor Skills Boat/.test(said) && /first two sentences/.test(said) && !/for tone only|do not quote it/i.test(said), said.slice(0, 400));
  const atl = read("routes/atlas.js");
  ok("§6 Atlas's draft uses draftTemplate and refuses a model draft without the note (routes/atlas.js writeDraft)",
    /DA\.draftTemplate\(/.test(atl) && /DA\.opensWithAbout\(out\.body, aboutThem/.test(atl), null);

  // ── browser legs: §4 first paint, §5 Tasks ───────────────────────────────
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = BASE.replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(x => x.endsWith(".js"));
    if (!js.some(x => fs.readFileSync(path.join(DIST, "assets", x), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser legs)")) {
    const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
    const step = async (name, fn) => { try { await fn(); } catch (e) { ok(`${name} ran to the end on the screen`, false, String(e.message || e).split("\n").slice(0, 3).join(" | ")); } };

    await step("§4 Peer-to-peer", async () => {
      await page.goto(`${APP}/app/fundraising?fr=p2p`, { waitUntil: "networkidle", timeout: 60000 });
      await page.locator('[data-testid="p2p-fundraiser-row"]').first().waitFor({ timeout: 20000 });
      const rows = await page.$$eval('[data-testid="p2p-fundraiser-row"]', rs => rs.map(r => ({
        name: (r.querySelector('[data-testid="p2p-fundraiser-open"]') || {}).innerText || "",
        team: (r.querySelector('[data-testid="p2p-fundraiser-team"]') || {}).innerText || "" })));
      const cards = await page.$$eval('[data-testid="p2p-team-row"]', rs => rs.map(r => r.innerText));
      const noor = rows.find(r => /Noor Delafield/.test(r.name)) || {};
      const quay = rows.filter(r => r.team === "Quayside Rowers").length;
      const quayCard = cards.find(c => /Quayside Rowers/.test(c)) || "";
      ok("§4 first paint: Noor's row names no team its cards don't count, and Quayside's card and its rows agree (staging: 4 rows, card 3)",
        !noor.team && quay === 1 && /\b1 fundraiser\b/.test(quayCard), { rows, cards });
    });

    await step("§5 Tasks", async () => {
      const prefs = on => api("PUT", "/me/notification-prefs", tok, { morningEmail: on });
      const line = async () => { await page.goto(`${APP}/app/tasks`, { waitUntil: "networkidle", timeout: 60000 });
        const el = page.locator('[data-testid="tasks-morning-email"]');
        await el.waitFor({ timeout: 20000 });
        return { state: await el.getAttribute("data-state"), text: await el.innerText(), link: await page.locator('[data-testid="tasks-morning-turn-on"]').count() }; };
      await q(`UPDATE orgs SET staff_mail_enabled=true WHERE id=$1`, [ORG]);
      await prefs(false);
      const off = await line();
      ok("§5 Tasks, her morning email off: says so, with Turn it on (staging: \"each morning at 8am\")", off.state === "off" && /is off/.test(off.text) && off.link === 1, off);
      await prefs(true);
      await q(`UPDATE users SET brief_hour=7 WHERE id=$1`, [USER]);
      const on = await line();
      ok("§5 Tasks, on: names her hour (7:00 AM), no link", on.state === "on" && /7:00 AM/.test(on.text) && on.link === 0, on);
      await q(`UPDATE orgs SET staff_mail_enabled=false WHERE id=$1`, [ORG]);
      const orgOff = await line();
      ok("§5 Tasks, the org's staff mail off: says Steward is not sending staff email (her switch on)", orgOff.state === "org_off" && /not sending staff email/.test(orgOff.text), orgOff);
    });
    await browser.close();
  }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });

// tests/flows3.test.js: FLOWS-3. JOURNEYS, THE GIVING RHYTHM, THE NEXT MOVE'S
// FUND AND THE CAMPAIGN PREVIEW BEHAVE THE WAY STAFF EXPECT.
// Guards donor data and email: the QA fleet (7–8 Nov 2026) put people into
// Paused journeys, saw a Dec 1 journey's first step on Nov 10, read "Next gift
// expected" eleven months out for a twice-a-year giver, read "for Endowment"
// about a gift to General Operating, and got "given before" in mail to a
// person who never gave.
//
// API leg:
//   §1 a Paused or Draft journey refuses every by-hand door (apply, batch
//      preview, batch start) and writes no plan; the batch rows say why and
//      break the count down ("2 can start, 1 is already in it")
//      (W-1107-Fundraising-28)
//   §4 the campaign test reads as the person previewed: a never-giving
//      contact's test has no gift sentence in its body or its subject
//      (W-1107-Fundraising-17)
// Browser leg (real clicks on the built client):
//   §1 the profile's journey picker greys out Draft and Paused with the
//      reason; a dated journey's preview says "First step <its date>" and the
//      step lands on that date; the Donors list's dialog shows the breakdown
//   §2 the rail's "Next gift expected" is the last gift plus the median gap,
//      and "Due now" once that day has passed (W-1108-Donors-24X)
//   §3 the profile's next move names the newest gift's own fund
//      (W-1108-Volunteers-03X)
//   §4 the campaign editor previews a contact who never gave, with the
//      no-gift sentence (W-1107-Fundraising-17)
//
// The volunteer half (tests/lib/flows3Volunteers.js) is run at the end.
//
// Planted defects (FLOWS-3 report): Paused journeys allowed to start
// (journeyStart.js's refusal removed) turns §1 red; the rhythm computed from
// the max gap (rhythm.js median → max) turns §2 red.
"use strict";
const path = require("path");
const fs = require("fs");
const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday, civilPlusDays, browserLegOrSkip, SINK_PORT } = require("./helpers");
const { DIST } = require("./lib/dist");

const PASSWORD = "loadtest1234";
const ORG = "org_flows3";
const EMAIL = `${ORG}@test.local`;
const ME = "u_" + ORG;
const P = s => `${ORG}_${s}`;
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const optional = f => { try { return require(f); } catch { return null; } };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = d => `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;
const dated = d => `${day(d)}, ${d.slice(0, 4)}`;

const MAIL = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", d => { b += d; });
  req.on("end", () => { let x = {}; try { x = JSON.parse(b); } catch { /* empty */ } MAIL.push(x);
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "re_sink_" + MAIL.length })); });
});

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Flows Three Kestrel Fund',$2,1,'active','team','America/New_York')`, [ORG, ORG.replace(/_/g, "-")]);
  await q(`UPDATE orgs SET staff_mail_enabled=true, onboarded_at=NOW() WHERE id=$1`, [ORG]);   // a test to herself is staff mail
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Odile Marsh','admin')`, [ME, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
const person = (id, name, types = "donor") => q(
  `INSERT INTO donors (id,org_id,name,email,stage,status,person_types,assigned_to,assigned_to_name,created_by,created_by_name)
   VALUES ($1,$2,$3,$4,'cultivate','active',$5::jsonb,$6,'Odile Marsh','system:test/flows3','FLOWS-3 test')`,
  [P(id), ORG, name, `${id}@flows3.example.org`, JSON.stringify([types]), ME]);

// The volunteer, event, group and meeting half (W-1107-Volunteers-24,
// W-1108-Volunteers-20/34X/10X/26X/23X/19X): tests/lib/flows3Volunteers.js, its
// own org, its own API and browser legs.
const runVolunteers = () => require("./lib/flows3Volunteers")().catch(e => ok("volunteer half ran to its end", false, String((e && e.message) || e)));

(async () => {
  await new Promise(r => sink.listen(SINK_PORT, r));
  const tok = await freshOrg();
  const today = civilToday();
  for (const [id, name] of [["ada", "Ada Quill"], ["bram", "Bram Oduya"], ["cleo", "Cleo Varga"], ["rhea", "Rhea Tamsin"], ["rob", "Rob Ellery"], ["gwen", "Gwen Halloway"], ["tom", "Tom Brackett"]]) await person(id, name);
  await person("juno", "Juno Fairweather", "contact");

  // ── §1 · ONLY AN ACTIVE JOURNEY STARTS PEOPLE ──────────────────────────────
  const step = (label, offsetDays) => ({ type: "follow_up", label, offsetDays });
  const mk = (name, extra = {}) => api("POST", "/journeys", tok, { name, trigger: "by_hand", steps: [step(`${name}: first call`, 2), step(`${name}: second call`, 9)], ...extra });
  const jOn = await mk("Kestrel welcome", { enabled: true });
  const jDraft = await mk("Kestrel draft");
  const jPaused = await mk("Kestrel paused", { enabled: true });
  await q(`UPDATE cultivation_templates SET journey_enabled=false WHERE id=$1 AND org_id=$2`, [jPaused.body.id, ORG]);   // on once, now off: Paused
  const anchor = civilPlusDays(23);
  const jDate = await api("POST", "/journeys", tok, { name: "Kestrel letter day", trigger: "yearly_date", enabled: true,
    triggerFilters: { month: +anchor.slice(5, 7), day: +anchor.slice(8, 10), who: "everyone" }, steps: [step("Letter day: call", 0), step("Letter day: follow up", 7)] });
  const inCleo = await api("POST", `/journeys/${jOn.body.id}/apply`, tok, { donorIds: [P("cleo")] });
  ok("§1 fixture: an Active, a Draft, a Paused and a dated journey; Cleo is in the Active one",
    [jOn, jDraft, jPaused, jDate].every(r => r.status < 300 && r.body.id) && inCleo.status === 200 && inCleo.body.started === 1,
    { on: jOn.status, draft: jDraft.status, paused: jPaused.status, date: [jDate.status, jDate.body && (jDate.body.message || jDate.body.error)], cleo: inCleo.body });

  const plansOf = async (tid) => Number((await q(`SELECT COUNT(*)::int AS n FROM cultivation_plans WHERE org_id=$1 AND template_id=$2`, [ORG, tid]))[0].n);
  const apPaused = await api("POST", `/journeys/${jPaused.body.id}/apply`, tok, { donorIds: [P("ada")] });
  const apDraft = await api("POST", `/journeys/${jDraft.body.id}/apply`, tok, { donorIds: [P("ada")] });
  const bpPaused = await api("POST", `/journeys/${jPaused.body.id}/batch/preview`, tok, { donorIds: [P("ada"), P("bram")] });
  const bsDraft = await api("POST", `/journeys/${jDraft.body.id}/batch`, tok, { donorIds: [P("ada"), P("bram")] });
  ok("§1 a Paused or Draft journey refuses apply, batch preview and batch start, and nobody is put in it",
    apPaused.status === 409 && apDraft.status === 409 && bpPaused.status === 409 && bsDraft.status === 409
      && (await plansOf(jPaused.body.id)) === 0 && (await plansOf(jDraft.body.id)) === 0,
    { apPaused: [apPaused.status, apPaused.body && apPaused.body.started], apDraft: apDraft.status, bp: bpPaused.status, bs: bsDraft.status,
      paused: await plansOf(jPaused.body.id), draft: await plansOf(jDraft.body.id) });
  ok("§1 the refusal says why", /Paused/.test((apPaused.body && apPaused.body.sentence) || "") && /Draft/.test((apDraft.body && apDraft.body.sentence) || ""),
    { paused: apPaused.body && apPaused.body.sentence, draft: apDraft.body && apDraft.body.sentence });
  const three = [P("ada"), P("bram"), P("cleo")];
  const opts = await api("POST", "/journeys/batch-options", tok, { donorIds: three });
  const row = id => ((opts.body && opts.body.journeys) || []).find(j => j.id === id) || {};
  ok("§1 the dialog's rows: Paused and Draft can't be picked, with why; the Active one breaks the count down per person",
    row(jPaused.body.id).canPick === false && /^Paused/.test(row(jPaused.body.id).why || "") && row(jDraft.body.id).canPick === false && /^Draft/.test(row(jDraft.body.id).why || "")
      && row(jOn.body.id).canPick === true && row(jOn.body.id).why === "2 can start, 1 is already in it.",
    { paused: row(jPaused.body.id), draft: row(jDraft.body.id), on: row(jOn.body.id) });

  // ── §2 · THE RHYTHM'S NEXT GIFT ────────────────────────────────────────────
  // Rhea gives about twice a year (gaps 184, 348, 31 days: median 184), last on
  // T-54: next gift T+130. FIX-33's "usual year" would read T-85 + 365 = T+280.
  for (const [who, back, amt] of [["rhea", 617, 100], ["rhea", 433, 100], ["rhea", 85, 100], ["rhea", 54, 100], ["rob", 500, 80], ["rob", 300, 80], ["tom", 3, 60]]) {
    const g = await api("POST", `/donors/${P(who)}/gifts`, tok, { amount: amt, date: civilPlusDays(-back), type: "cash" });
    if (g.status >= 300) ok(`§2 fixture gift for ${who} -${back}`, false, g.body);
  }
  const rheaNext = civilPlusDays(130);

  // ── §3 · THE NEXT MOVE NAMES THE GIFT'S OWN FUND ───────────────────────────
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'Endowment',true),($3,$2,'General Operating',false)`, [P("f_endow"), ORG, P("f_genop")]);
  for (const [back, amt, fund] of [[500, 50, null], [120, 500, "f_endow"], [2, 100, "f_genop"]]) {
    const g = await api("POST", `/donors/${P("gwen")}/gifts`, tok, { amount: amt, date: civilPlusDays(-back), type: "cash", ...(fund ? { fundId: P(fund) } : {}) });
    if (g.status >= 300) ok(`§3 fixture gift ${amt}`, false, g.body);
  }

  // ── §4 · THE CAMPAIGN TEST READS AS THE PERSON PREVIEWED ───────────────────
  const tpl = await api("POST", "/email-templates", tok, { starterKey: "campaign_appeal" });
  const T = tpl.body && tpl.body.template;
  const camp = await api("POST", "/campaigns", tok, { name: "Kestrel appeal", subject: "Thanks for your gift of {{last_gift_amount}}", templateId: T && T.id,
    emailBlocks: T && T.blocks, segment: { type: "all" } });
  const CID = camp.body && (camp.body.id || (camp.body.campaign && camp.body.campaign.id));
  if (CID && T) await q(`UPDATE campaigns SET email_blocks=$1::jsonb, subject='Thanks for your gift of {{last_gift_amount}}' WHERE id=$2 AND org_id=$3`, [JSON.stringify(T.blocks), CID, ORG]);
  MAIL.length = 0;
  const test = CID ? await api("POST", `/campaigns/${CID}/test`, tok, { as: P("juno") }) : { status: 0, body: camp.body };
  const sent = MAIL.find(m => /Kestrel|Thank/i.test(String(m.subject || ""))) || MAIL[0] || {};
  const text = String(sent.html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  ok("§4 the test of a never-giver's copy: the subject names no gift, the body says no \"given before\"",
    test.status === 200 && !!sent.html && !/given before/i.test(text) && !/\$250|gift of/i.test(String(sent.subject || "")) && /being part of this/i.test(String(sent.subject || "")),
    { status: test.status, body: test.body, subject: sent.subject, mails: MAIL.length, snippet: (text.match(/.{60}given before.{20}/i) || [""])[0] });

  const why = (() => {
    if (!optional(PW)) return "(playwright is not installed at " + PW + ")";
    if (!fs.existsSync(path.join(DIST, "index.html")) && !fs.existsSync(path.join(DIST, "app.html"))) return "(no client dist at " + DIST + ")";
    return null;
  })();
  if (browserLegOrSkip(why, "(browser leg)")) { await runVolunteers(); sink.close(); await closeDb(); summary(); return; }

  const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
  const open = async url => { await page.goto(`${APP}${url}`, { waitUntil: "networkidle", timeout: 60000 }); };
  const text1 = async sel => ((await page.locator(sel).first().textContent({ timeout: 8000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
  const shot = async name => { if (process.env.FLOWS3_SHOTS) await page.screenshot({ path: path.join(process.env.FLOWS3_SHOTS, name + ".png") }).catch(() => {}); };

  try {
    // §1 · the profile's picker
    await open(`/donors/${P("ada")}`);
    await page.locator('[data-testid="dp-journey-pick"]').first().waitFor({ timeout: 30000 });
    const options = await page.locator('[data-testid="dp-journey-option"]').evaluateAll(os => os.map(o => ({ v: o.value, t: o.textContent, d: o.disabled })));
    const opt = id => options.find(o => o.v === id) || {};
    ok("§1 browser: the profile lists Draft and Paused greyed out, with the reason; the Active ones can be picked",
      opt(jPaused.body.id).d === true && /Paused: turn it back on/.test(opt(jPaused.body.id).t || "") && opt(jDraft.body.id).d === true && /Draft: turn it on/.test(opt(jDraft.body.id).t || "")
        && opt(jOn.body.id).d === false && opt(jDate.body.id).d === false, options);
    await page.selectOption('[data-testid="dp-journey-pick"]', jDate.body.id);
    await page.locator('[data-testid="dp-journey-preview"]').waitFor({ timeout: 15000 });
    const first = await text1('[data-testid="dp-journey-preview-first"]');
    const due = await text1('[data-testid="dp-journey-preview-due"]');
    await shot("s1-dated-preview");
    ok(`§1 browser: the dated journey's preview says "First step ${day(anchor)}"`, first === `First step ${day(anchor)}` && due === `due ${dated(anchor)}`, { first, due, anchor });
    await page.locator('[data-testid="dp-journey-add-confirm"]').click();
    let stepDue = null;
    for (let i = 0; i < 40 && !stepDue; i++) {
      stepDue = ((await q(`SELECT s.due_date FROM cultivation_plan_steps s JOIN cultivation_plans p ON p.id=s.plan_id WHERE p.org_id=$1 AND p.donor_id=$2 AND p.template_id=$3 AND s.seq=1`, [ORG, P("ada"), jDate.body.id]))[0] || {}).due_date || null;
      if (!stepDue) await page.waitForTimeout(250);
    }
    ok("§1 browser: after the click, the first step is on the journey's date, not today plus its offset", String(stepDue || "").slice(0, 10) === anchor, { stepDue, anchor });

    // §1 · the Donors list's dialog
    await open(`/donors`);
    await page.locator(".dir-donor-row").first().waitFor({ timeout: 30000 });
    for (const nm of ["Ada Quill", "Bram Oduya", "Cleo Varga"]) await page.locator(`.dir-donor-row:has-text("${nm}") input[type=checkbox]`).first().check();
    await page.locator('[data-testid="bulk-add-to-journey"]').first().click();
    await page.locator('[data-testid="bulk-journey-row"]').first().waitFor({ timeout: 15000 });
    const rows = await page.locator('[data-testid="bulk-journey-row"]').evaluateAll(rs => rs.map(r => ({ id: r.getAttribute("data-journey"), can: r.getAttribute("data-can-pick"), text: r.innerText })));
    const brow = id => rows.find(r => r.id === id) || {};
    ok("§1 browser: the dialog greys out Paused and Draft with why, and the Active row reads \"2 can start, 1 is already in it.\"",
      brow(jPaused.body.id).can === "0" && /Paused/.test(brow(jPaused.body.id).text || "") && brow(jDraft.body.id).can === "0"
        && /2 can start, 1 is already in it\./.test(brow(jOn.body.id).text || ""), rows);
    await page.locator(`[data-testid="bulk-journey-row"][data-journey="${jOn.body.id}"]`).click();
    await page.locator('[data-testid="bulk-journey-sentence"]').waitFor({ timeout: 15000 });
    const people = await page.locator('[data-testid="bulk-journey-person"]').allInnerTexts();
    await shot("s1-bulk-preview");
    ok("§1 browser: the preview lists each person, Cleo with why", people.some(t => /Cleo Varga · Already in it/.test(t)) && people.filter(t => /Can start/.test(t)).length === 2, people);
    await page.keyboard.press("Escape");

    // §2 · the rail's next gift
    await open(`/donors/${P("rhea")}`);
    const rheaSaid = await text1('[data-testid="dp-rail-rhythm-next"]');
    const rheaRhythm = await text1('[data-testid="dp-rail-rhythm-open"]');
    await shot("s2-rhythm");
    ok(`§2 browser: "${rheaRhythm}", next gift expected ${dated(rheaNext)} (the last gift plus the median gap)`,
      rheaSaid === dated(rheaNext) && /twice a year/.test(rheaRhythm), { rheaSaid, rheaRhythm, expected: dated(rheaNext) });
    await open(`/donors/${P("rob")}`);
    const robSaid = await text1('[data-testid="dp-rail-rhythm-next"]');
    ok("§2 browser: a next gift whose day has passed reads \"Due now\"", /^Due now/.test(robSaid), { robSaid });

    // §3 · the next move's fund
    await open(`/donors/${P("gwen")}`);
    await page.locator('[data-testid="dp-next-move-draft"], [data-testid="dp-next-move-none"]').first().waitFor({ timeout: 30000 }).catch(() => {});
    const say = await text1('[data-testid="dp-next-move-draft"]');
    await shot("s3-next-move");
    ok("§3 browser: the next move names the $100 gift's own fund (General Operating), never Endowment",
      /\$100/.test(say) && /for General Operating/.test(say) && !/Endowment/.test(say), { say });

    // §4 · the campaign editor previews a contact who never gave
    await open(`/app/communications`);
    await page.getByRole("button", { name: "New campaign" }).first().click();
    await page.locator('[data-testid="campaign-gallery"]').waitFor({ timeout: 15000 });
    await page.locator('[data-testid="campaign-gallery"] :text("General appeal")').first().click();
    await page.locator('[data-testid="preview-as"]').first().click();
    await page.fill('input[aria-label="Find a person to preview as"]', "Juno");
    await page.locator('[data-testid="preview-as-person"]:has-text("Juno Fairweather")').first().waitFor({ timeout: 10000 }).catch(() => {});
    const found = await page.locator('[data-testid="preview-as-person"]').allInnerTexts();
    if (found.some(t => /Juno/.test(t))) await page.locator('[data-testid="preview-as-person"]:has-text("Juno Fairweather")').first().click();
    await page.locator('[data-testid="preview-as"]:has-text("Juno")').first().waitFor({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    let seen = "";
    for (const f of page.frames()) seen += " " + await f.evaluate(() => (document.body ? document.body.innerText : "")).catch(() => "");
    await shot("s4-preview-juno");
    ok("§4 browser: Preview as finds Juno, a contact who never gave, and her preview has the no-gift sentence",
      found.some(t => /Juno Fairweather/.test(t)) && /asking friends of Flows Three Kestrel Fund to join us/i.test(seen) && !/who have given before/i.test(seen),
      { found, snippet: (seen.match(/.{50}(given before|friends of).{30}/i) || [""])[0] });
  } finally {
    await browser.close();
  }
  await runVolunteers();
  sink.close();
  await closeDb();
  summary();
})().catch(async e => { console.error("SUITE ERROR:", e); sink.close(); await closeDb().catch(() => {}); process.exit(1); });

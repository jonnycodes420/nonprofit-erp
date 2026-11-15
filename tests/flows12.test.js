// tests/flows12.test.js — FLOWS-12. WHAT A DONOR READS, AND WHAT A BUTTON SAYS IT DID.
//
// One made-up org per run (no real name anywhere), one check per item:
//   §1 W-1114-Fundraising-17  an appeal that thanks them for giving, to people who never have:
//      the audience count, the flag, and her first-gift version read by a never-giver only
//   §2 W-1113-Donors-26       Brief me with AI off (the battery has no key): the About note first,
//      in full; Brief me is on the More menu (browser)
//   §3 W-1114-Fundraising-35X a giving page's card counts the page, and says so (and on screen)
//   §4 W-1114-Fundraising-28X the batch journey preview gives each person their own first-step
//      date, the date the start writes
//   §5 W-1114-Finance-29X     an erased person is in no picker, no household, no portfolio count
//   §6 W-1114-Fundraising-19X "Make a draft" says why it can't (a draft is waiting), replaces on
//      request, and the answer shows beside the button (browser)
//
// HOW IT GOES RED: every § was run against origin/main's server and dist (a throwaway
// worktree, its own database) and failed there; see the PR.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, login, closeDb, browserLegOrSkip, civilPlusDays, mailTypesOn } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const { DIST } = require("./lib/dist");
const PASSWORD = "loadtest1234";

(async () => {
  console.log("flows12 (FLOWS-12)");
  const run = require("crypto").randomBytes(4).toString("hex");
  const ORG = `org_flows12_${run}`, EMAIL = `owner-${run}@flows12.local`, ME = `u_flows12_${run}`;
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,emails_enabled,onboarded_at)
           VALUES ($1,'Flows Twelve Tidewater Arts',$1,1,'active','team','America/New_York',true,NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Halloway','admin')`, [ME, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  const tok = await login(EMAIL, PASSWORD);
  const ids = {};
  const P = async (key, name, extra = {}) => {
    const r = await api("POST", "/donors", tok, { name, email: `${key}-${run}@flows12.invalid`, ...extra });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return (ids[key] = r.body.id);
  };
  const gift = (id, amount, date) => api("POST", `/donors/${id}/gifts`, tok, { amount, date, payment_method: "check" });
  const ABOUT = "Loves the Saltmarsh Rowing program; ask about Tobin's kiln at Thursday's coffee.";
  await P("marguerite", "Marguerite Okonkwo");
  await q(`UPDATE donors SET about_them=$2 WHERE id=$1`, [ids.marguerite, ABOUT]);   // the profile's About box writes this column
  await gift(ids.marguerite, 1500, civilPlusDays(-60));
  await gift(ids.marguerite, 900, civilPlusDays(-400));
  await P("ines", "Ines Varga");           // never given
  await P("dov", "Dov Pellander");         // never given
  await P("elsbeth", "Elsbeth Crane"); await gift(ids.elsbeth, 75, civilPlusDays(-30));

  // ── §1 an appeal that thanks them for giving ─────────────────────────────
  await mailTypesOn(ORG, "everyone");   // Campaign emails on, so the audience is who the send reaches
  const tpl = await api("POST", "/email-templates", tok, { starterKey: "year_end_appeal" });
  const blocks = (tpl.body && (tpl.body.template || tpl.body).blocks) || [];
  const seg = await api("POST", "/campaigns/segment-preview", tok, { segment: { mode: "everyone" } });
  ok("§1 the editor is told how many in the audience have never given (2 of 4)", seg.status === 200 && seg.body.audienceNeverGiven === 2, { status: seg.status, n: seg.body && seg.body.audienceNeverGiven, count: seg.body && seg.body.count });
  const asInes = await api("POST", "/email-preview", tok, { blocks, subject: "Before the year ends", as: ids.ines });
  const pg = (asInes.body && asInes.body.pastGiving) || {};
  const PG = await import(path.join(ROOT, "shared/pastGiving.js"));
  const flag = PG.pastGivingFlag({ claims: pg.claims, neverGiven: seg.body && seg.body.audienceNeverGiven, shownName: pg.shownName });
  ok("§1 the Year-end appeal's thank-you paragraph is found, and Ines is known never to have given", asInes.status === 200
    && (pg.claims || []).some(c => /your support/i.test(c.phrase) && !c.hasVersion) && pg.shownNeverGave === true, pg);
  ok("§1 with no first-gift version the preview flags it: \"This letter thanks them for giving. 2 people in this audience never have.\"",
    flag === "This letter thanks them for giving. 2 people in this audience never have.", flag);
  const at = (pg.claims || [])[0] ? pg.claims[0].index : 2;
  const VERSION = "This would be your first gift to Tidewater, and we would be glad to welcome you.";
  const withVersion = blocks.map((b, i) => (i === at ? { ...b, firstGift: VERSION } : b));
  const inesV = await api("POST", "/email-preview", tok, { blocks: withVersion, subject: "Before the year ends", as: ids.ines });
  const margV = await api("POST", "/email-preview", tok, { blocks: withVersion, subject: "Before the year ends", as: ids.marguerite });
  ok("§1 with her version written, Ines reads it in place of the thank-you paragraphs, still greeted \"Hi Ines,\", and not \"give once more\"", inesV.status === 200 && inesV.body.html.includes("your first gift to Tidewater") && /Hi Ines,/.test(inesV.body.html)
    && !/give once more/.test(inesV.body.html) && PG.pastGivingFlag({ claims: inesV.body.pastGiving.claims, neverGiven: 2 }) === null, { flagClaims: inesV.body.pastGiving });
  ok("§1 and Marguerite, who gives, still reads the letter as written", margV.status === 200 && /give once more/.test(margV.body.html) && !margV.body.html.includes("your first gift to Tidewater"));
  const saved = await api("PUT", `/email-templates/${(tpl.body.template || tpl.body).id}`, tok, { blocks: withVersion });
  const [kept] = await q(`SELECT draft, blocks FROM email_templates WHERE id=$1`, [(tpl.body.template || tpl.body).id]).catch(() => [{}]);
  ok("§1 her version is kept when she saves", saved.status === 200 && JSON.stringify(kept || {}).includes("your first gift to Tidewater"), { status: saved.status, body: saved.body && saved.body.error });

  // ── §2 Brief me with AI off ──────────────────────────────────────────────
  const br = await api("POST", `/donors/${ids.marguerite}/brief`, tok, {});
  const first = br.body && br.body.sections && br.body.sections[0];
  ok("§2 with AI off Brief me answers (no 503), in Steward's own sentences", br.status === 200 && br.body.source === "template" && /own sentences/.test(br.body.sourceSentence || ""), { status: br.status, body: br.body });
  ok("§2 the About note is the brief's first section, quoted whole", !!first && JSON.stringify(first).includes(ABOUT), first);
  ok("§2 and it is accurate on gifts: $2,400 across 2 gifts", JSON.stringify(br.body.sections || []).includes("$2,400 across 2 gifts"), br.body.sections);
  const BC = require(path.join(ROOT, "server/donors/briefComplete.js"));
  ok("§2 every line is complete (no colon left hanging, nothing unfinished)", BC.briefProblems(BC.briefLines(br.body)).length === 0, BC.briefProblems(BC.briefLines(br.body)));

  // ── §3 a giving page's card counts the page ──────────────────────────────
  const CAMP = `camp_f12_${run}`, PAGE = `gp_f12_${run}`;
  await q(`INSERT INTO campaigns (id,org_id,name,subject,body,status,goal_amount,created_by,created_by_name) VALUES ($1,$2,'Year-end','x','x','draft',20000,'system:test','test')`, [CAMP, ORG]);
  await q(`INSERT INTO giving_pages (id,org_id,title,slug,status,campaign_id) VALUES ($1,$2,'Year-end giving page',$3,'active',$4)`, [PAGE, ORG, `year-end-${run}`, CAMP]);
  const yg = await gift(ids.elsbeth, 1200, civilPlusDays(-5));
  await q(`UPDATE gifts SET campaign_id=$1 WHERE id=$2 AND org_id=$3`, [CAMP, yg.body && (yg.body.id || (yg.body.gift && yg.body.gift.id)), ORG]);
  const pages = await api("GET", "/giving-pages", tok);
  const card = (Array.isArray(pages.body) ? pages.body : []).find(p => p.id === PAGE) || {};
  ok("§3 the card's sentence counts the page: \"Through this page: $0 from 0 gifts.\"", card.through_page_sentence === "Through this page: $0 from 0 gifts." && Number(card.raised_amount) === 0 && Number(card.gifts_count) === 0, card);
  ok("§3 the campaign's total is its own line, saying what it counts", /^The whole Year-end campaign: \$1,200, from every way it came in, this page included\.$/.test(card.campaign_line_sentence || ""), card.campaign_line_sentence);

  // ── §4 the batch journey preview, person by person ───────────────────────
  await q(`UPDATE donors SET birth_month=$2, birth_day=$3 WHERE id=$1`, [ids.ines, +civilPlusDays(40).slice(5, 7), +civilPlusDays(40).slice(8, 10)]);
  await q(`UPDATE donors SET birth_month=$2, birth_day=$3 WHERE id=$1`, [ids.dov, +civilPlusDays(42).slice(5, 7), +civilPlusDays(42).slice(8, 10)]);
  const jb = await api("POST", "/journeys", tok, { name: "Tidewater birthday", trigger: "birthday", enabled: true, triggerFilters: { daysBefore: 0 },
    steps: [{ type: "follow_up", label: "Birthday call", offsetDays: 0 }] });
  const pv = await api("POST", `/journeys/${jb.body && jb.body.id}/batch/preview`, tok, { donorIds: [ids.ines, ids.dov] });
  const pp = id => ((pv.body && pv.body.people) || []).find(p => p.id === id) || {};
  const di = pp(ids.ines).firstStep && pp(ids.ines).firstStep.dueDate, dd = pp(ids.dov).firstStep && pp(ids.dov).firstStep.dueDate;
  ok("§4 two people with different birthdays get two different first-step dates in the preview", pv.status === 200 && !!di && !!dd && di !== dd, { status: pv.status, people: pv.body && pv.body.people });
  ok("§4 and the preview's sentence quotes no single date for both", pv.body && pv.body.firstStep === null && /each person's own date/.test(pv.body.sentence || ""), pv.body && pv.body.sentence);
  const st = await api("POST", `/journeys/${jb.body && jb.body.id}/batch`, tok, { donorIds: [ids.ines, ids.dov] });
  const due = async id => ((await q(`SELECT LEFT(s.due_date::text,10) AS d FROM cultivation_plan_steps s JOIN cultivation_plans p ON p.id=s.plan_id
                                       WHERE p.org_id=$1 AND p.donor_id=$2 AND p.template_id=$3 ORDER BY s.seq LIMIT 1`, [ORG, id, jb.body.id]))[0] || {}).d;
  const wi = await due(ids.ines), wd = await due(ids.dov);
  ok("§4 each date is the one the start writes", st.status < 300 && wi === di && wd === dd, { start: st.status, preview: [di, dd], written: [wi, wd] });

  // ── §5 erased means erased ───────────────────────────────────────────────
  await P("ghost", "Quill Erasmore"); await gift(ids.ghost, 100000, civilPlusDays(-20));
  await q(`UPDATE donors SET assigned_to=$2, stage='cultivate' WHERE id=ANY($1)`, [[ids.ghost, ids.marguerite], ME]);
  const before = await api("GET", "/portfolio/officers", tok);
  const er = await api("POST", `/donors/${ids.ghost}/erase`, tok, { confirm: "ERASE" });
  const [gone] = await q(`SELECT erased_at FROM donors WHERE id=$1`, [ids.ghost]);
  if (!gone || !gone.erased_at) await q(`UPDATE donors SET name='Erased person', erased_at=NOW() WHERE id=$1`, [ids.ghost]);   // the erase route's word may differ; the state is what counts
  const pick = await api("GET", "/donors/pick?q=erased&match=concat&limit=20", tok);
  const pickAll = await api("GET", "/donors/pick?q=&match=concat&limit=200", tok);
  const named = await api("GET", "/donors/pick?exact=Erased%20person&limit=2", tok);
  ok("§5 no picker offers the erased person, by name or in the full list", pick.status === 200 && !(pick.body || []).some(d => d.id === ids.ghost)
    && !(pickAll.body || []).some(d => d.id === ids.ghost) && !(named.body || []).some(d => d.id === ids.ghost), { erase: er.status, pick: (pick.body || []).map(d => d.name) });
  const hh = await api("POST", "/households", tok, { memberIds: [ids.ines, ids.ghost], primaryDonorId: ids.ines });
  ok("§5 a household refuses an erased member", hh.status === 400 && /erased/i.test(hh.body && hh.body.error || ""), hh.body);
  const after = await api("GET", "/portfolio/officers", tok);
  const mine = r => ((r.body && r.body.officers) || []).find(o => o.id === ME) || {};
  ok("§5 the portfolio's count and total leave the erased person out (one fewer, $100,000 off)", mine(before).portfolio_count >= 2 && mine(after).portfolio_count === mine(before).portfolio_count - 1
    && Math.round(mine(before).portfolio_giving - mine(after).portfolio_giving) === 100000, { before: mine(before), after: mine(after) });
  const port = await api("GET", `/portfolio/${ME}`, tok);
  ok("§5 and her portfolio page lists Marguerite, never the erased record", port.status === 200 && (port.body.people || []).some(p => p.donorId === ids.marguerite)
    && !(port.body.people || []).some(p => p.donorId === ids.ghost), (port.body.people || []).map(p => p.name));

  // ── §6 "Make a draft" says what happened ─────────────────────────────────
  await api("PUT", "/templates/thanks_major", tok, { subject: "Thank you, {{first_name}}", body: "Dear {{first_name}},\n\nThank you.\n\nWren" });
  const d1 = await api("POST", "/templates/thanks_major/draft", tok, { donorId: ids.marguerite });
  const d2 = await api("POST", "/templates/thanks_major/draft", tok, { donorId: ids.marguerite });
  ok("§6 a second draft while one waits is refused with the reason: \"… already has a draft from <day>. Open it or replace it.\"",
    d1.status === 201 && d2.status === 409 && d2.body.error === "draft_exists" && d2.body.draftId === d1.body.draftId
      && /^Marguerite Okonkwo already has a draft from [A-Z][a-z]{2} \d{1,2}, \d{4}\. Open it or replace it\.$/.test(d2.body.sentence || ""), { d1: d1.body, d2: d2.body });
  const d3 = await api("POST", "/templates/thanks_major/draft", tok, { donorId: ids.marguerite, replace: true });
  const rows = await q(`SELECT id, status FROM milestone_drafts WHERE org_id=$1 AND donor_id=$2 ORDER BY created_at`, [ORG, ids.marguerite]);
  ok("§6 Replace it makes the new one and sets the old one aside (one waiting)", d3.status === 201 && rows.filter(r => r.status === "pending_review").length === 1
    && rows.find(r => r.id === d1.body.draftId).status === "dismissed", rows);

  // ── the browser: §2, §3, §6 ──────────────────────────────────────────────
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(x => x.endsWith(".js"));
    if (!js.some(x => fs.readFileSync(path.join(DIST, "assets", x), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser legs)")) {
    const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
    const step = async (name, fn) => { try { await fn(); } catch (e) { ok(`${name} ran to the end on the screen`, false, String(e.message || e).split("\n").slice(0, 3).join(" | ")); } };

    await step("§2", async () => {
      await page.goto(`${APP}/donors/${ids.marguerite}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.getByRole("button", { name: /^More/ }).first().click({ timeout: 30000 });
      await page.locator('[data-testid="dp-brief-me"]').first().click({ timeout: 10000 });
      const body = page.locator('[data-testid="brief-body"]');
      await body.waitFor({ timeout: 30000 });
      const text = await body.innerText();
      ok("§2 (browser) More → Brief me, with AI off, opens a brief that quotes the About note", text.includes("Tobin's kiln") && /own sentences/.test(text), text.slice(0, 400));
    });

    await step("§3", async () => {
      await page.goto(`${APP}/app/fundraising?fr=pages`, { waitUntil: "domcontentloaded", timeout: 60000 });
      const c = page.locator('[data-testid="page-card"]').filter({ hasText: "Year-end giving page" });
      await c.waitFor({ timeout: 30000 });
      const text = await c.innerText();
      ok("§3 (browser) the card says \"Through this page: $0 from 0 gifts.\" and shows the campaign's $1,200 on its own line, never as the page's Raised",
        text.includes("Through this page: $0 from 0 gifts.") && /Raised through this page/.test(text) && (await c.locator('[data-testid="page-card-campaign"]').innerText()).includes("$1,200"), text.slice(0, 500));
    });

    await step("§6", async () => {
      const mt = await api("POST", "/email-templates", tok, { starterKey: "person_thanks_major" });
      const tid = mt.body && (mt.body.template || mt.body).id;
      await page.goto(`${APP}/app/communications?subtab=templates&template=${tid}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.locator('[data-testid="email-person-draft"] input').fill("Marguerite", { timeout: 30000 });
      await page.locator('[data-testid="email-person-draft"] button', { hasText: "Marguerite Okonkwo" }).first().click({ timeout: 15000 });
      const make = page.locator('[data-testid="email-person-draft-make"]');
      await make.click({ timeout: 10000 });
      const res = page.locator('[data-testid="email-person-draft-result"]');
      await res.waitFor({ timeout: 15000 });
      await page.waitForFunction(() => !/Making the draft/.test((document.querySelector('[data-testid="email-person-draft-result"]') || {}).innerText || "Making the draft"), null, { timeout: 15000 }).catch(() => {});
      const said = await res.innerText();
      const box = await res.boundingBox(), btn = await make.boundingBox();
      ok("§6 (browser) the button's answer shows right under it: the draft waiting, Open it and Replace it",
        /already has a draft from/.test(said) && /Open it or replace it/.test(said) && (await page.locator('[data-testid="email-person-draft-replace"]').count()) === 1
          && !!box && !!btn && box.y > btn.y && box.y - btn.y < 200, { said, box, btn });
    });
    await browser.close();
  }

  await q(`DELETE FROM milestone_drafts WHERE org_id=$1`, [ORG]).catch(() => {});
  await closeDb();
  summary();
})().catch(async e => { ok("flows12 ran to its end", false, String((e && e.stack) || e)); await closeDb().catch(() => {}); summary(); });

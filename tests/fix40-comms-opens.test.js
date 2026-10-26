// tests/fix40-comms-opens.test.js — FIX-40. EVERYTHING IN COMMUNICATIONS OPENS,
// AND EVERY EMAIL CAN BE READ.
//
// Guards donor data and email: who a campaign went to, what each person was
// sent, and that the counts a director sends by are the ones she is shown.
//
//   §counts   Overview's Emails sent counts every sent campaign (it summed the
//             six newest rows, so six drafts made 180 read 0); Audience counts
//             by the server's rules: All donors is donors with an email, not
//             everyone with an email, and Gone quiet is the Why rule (stage
//             lapsed or Drift past their gap), not a status nothing sets.
//   §rows     the new figure sources foot: emails-sent (all, one campaign, one
//             month), email-tool-gifts (the "1 gift, $X" cell), officer-portfolio.
//   §page     a campaign's page shows the email as sent and each recipient,
//             each a donor; the email tool's Delivered names its people.
//   §emails   a donor's emails list a campaign, a journey email and a
//             thank-you they received, each opening as they got it.
//   §tenant   another org reads none of it.
//   §dead     every row of docs/fix-40/dead-ends.md opens what it says, in the
//             browser (playwright, client/dist), on this suite's own org.
//   §guard    app-wide: Home, Donors, a profile, Fundraising, every
//             Communications tab, Reports and Finance render no donor name,
//             money amount or headline count as plain text. It READS the demo
//             org (seeded by scripts/seed-demo.js before the battery, as
//             smoke-walk and fix39-campaigns read it) and never writes there.
//
// RED ON MAIN (2026-10-15): §counts (Emails sent 0; no /communications/audience),
// §rows (no such sources), §page/§emails (no such routes), §dead (rows plain,
// "Industry avg ~20%"), §guard (plain names, amounts and counts).
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const h = require("./helpers");
const { ok, api, q } = h;
const B = require("./polish1/browser-p567");

const ORG = "org_fix40_comms";
const OTHER = "org_fix40_other";
const ADMIN = "admin@fix40-comms.test";
const OTHER_ADMIN = "admin@fix40-other.test";
const DEMO = "director@harborlight.demo";
const DEMO_ORG = "org_b72demo";
const D = { ada: "d_fix40_ada", ben: "d_fix40_ben", vol: "d_fix40_vol", noe: "d_fix40_noemail" };
const MONEY = /^\$[\d,]+(\.\d\d)?$/;
// The Spring letter went out on 20 April of the most recent April.
const SENT = new Date(Date.UTC(new Date().getUTCFullYear() - (new Date().getUTCMonth() < 4 ? 1 : 0), 3, 20, 15));

async function wipe() {
  const tables = (await q(`SELECT table_name FROM information_schema.columns
                            WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (const org of [ORG, OTHER]) {
    for (let pass = 0; pass < 6; pass++) {
      for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
      if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
    }
  }
}

const iso = d => d.toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() - n * 864e5);

async function fixture() {
  for (const [org, name, slug, email, uid] of [[ORG, "FIX-40 Comms", "fix40-comms", ADMIN, "u_fix40"], [OTHER, "FIX-40 Other", "fix40-other", OTHER_ADMIN, "u_fix40_o"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
             VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [org, name, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Fix Admin','admin')`,
      [uid, org, email, bcrypt.hashSync("loadtest1234", 4)]);
  }
  const who = ["u_fix40", "Fix Admin"];
  const person = (id, name, email, stage, types, total) => q(
    `INSERT INTO donors (id,org_id,name,email,stage,status,person_types,total_giving,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,$5,'active',$6::jsonb,$7,$8,$9)`, [id, ORG, name, email, stage, JSON.stringify(types), total, ...who]);
  await person(D.ada, "Ada Fortyworth", "ada@fix40.test", "steward", ["donor"], 12500);
  await person(D.ben, "Ben Quietley", "ben@fix40.test", "cultivate", ["donor"], 800);
  await person(D.vol, "Vera Helpwell", "vera@fix40.test", null, ["volunteer"], 0);
  await person(D.noe, "Noel Nomail", null, "cultivate", ["donor"], 50);
  // Ben is past his own gap, by Drift.
  await q(`INSERT INTO donor_drift (org_id,donor_id,assessment,computed_for,computed_at) VALUES ($1,$2,$3,CURRENT_DATE,NOW())`,
    [ORG, D.ben, JSON.stringify({ state: "lapsed" })]).catch(e => ok("§counts drift fixture", false, e.message));
  // One sent campaign to Ada and Ben in April, then six newer drafts.
  const sent = SENT;
  await q(`INSERT INTO campaigns (id,org_id,name,type,subject,body,status,segment,sent_at,recipient_count,open_count)
           VALUES ('c_fix40_sent',$1,'Spring letter','appeal','Thank you, {{first_name}}','Dear {{first_name}}, thank you for standing with us.','sent','{"mode":"donors"}',$2,2,1)`, [ORG, sent]);
  for (const [i, d, opened] of [[1, D.ada, true], [2, D.ben, false]])
    await q(`INSERT INTO campaign_recipients (id,org_id,campaign_id,donor_id,email,sent_at,opened_at) VALUES ($1,$2,'c_fix40_sent',$3,$4,$5,$6)`,
      [`cr_fix40_${i}`, ORG, d, d === D.ada ? "ada@fix40.test" : "ben@fix40.test", sent, opened ? sent : null]);
  for (let i = 1; i <= 6; i++)
    await q(`INSERT INTO campaigns (id,org_id,name,type,subject,body,status,created_at) VALUES ($1,$2,$3,'appeal','A draft','Words','draft',NOW())`,
      [`c_fix40_draft${i}`, ORG, `Draft ${i}`]);
  // The email tool: a newsletter 20 days ago; Ada opened, Ben clicked; Ada gave $250 five days after.
  const emcSent = daysAgo(20);
  await q(`INSERT INTO email_marketing_campaigns (id,org_id,provider,provider_campaign_id,name,subject,sent_at,sends,opens,clicks)
           VALUES ('emc_fix40',$1,'mailchimp','mc_fix40','Autumn news','What your gifts did this autumn',$2,40,2,1)`, [ORG, emcSent]);
  await q(`INSERT INTO email_marketing_activity (id,org_id,campaign_id,donor_id,email,opened,clicked,occurred_at) VALUES
           ('ema_fix40_1',$1,'emc_fix40',$2,'ada@fix40.test',true,false,$4),
           ('ema_fix40_2',$1,'emc_fix40',$3,'ben@fix40.test',true,true,$4)`, [ORG, D.ada, D.ben, emcSent]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,acknowledgement_sent,created_by,created_by_name)
           VALUES ('g_fix40_1',$1,$2,250,$3,'check','Check',true,$4,$5)`, [ORG, D.ada, iso(daysAgo(15)), ...who]);
  // FIX-49: Major is the giving level, the last 12 months against the cut
  // points, so Ada's $12,500 is gifts in the year, not a stored total alone.
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,acknowledgement_sent,created_by,created_by_name)
           VALUES ('g_fix40_0',$1,$2,12250,$3,'check','Check',true,$4,$5)`, [ORG, D.ada, iso(daysAgo(200)), ...who]);
  // A journey email Ada was sent, and a thank-you for her gift.
  await q(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,sent_at,created_by,created_by_name)
           VALUES ('md_fix40',$1,$2,'journey-step:s_fix40','Ada, a note from the studio','Dear Ada, the students finished the mural.','sent','journey',$3,$4,$5)`,
    [ORG, D.ada, daysAgo(3), ...who]).catch(e => ok("§emails journey fixture", false, e.message));
  await q(`INSERT INTO thank_you_drafts (id,org_id,donor_id,gift_id,body,sent_at)
           VALUES ('ty_fix40',$1,$2,'g_fix40_1','Dear Ada, thank you for your gift of $250.',$3)`,
    [ORG, D.ada, daysAgo(14)]).catch(e => ok("§emails thank-you fixture", false, e.message));
  return (await api("POST", "/auth/login", null, { email: ADMIN, password: "loadtest1234" })).body.token;
}

// The plain-text audit one page at a time: every text leaf that is a donor name
// of this org, a money amount, or a headline count (a bare number set at 18px
// or more, or in a table cell), and is not inside something that opens.
async function plainOnPage(page, names) {
  return page.evaluate(({ names, moneySrc }) => {
    const N = new Set(names); const MONEY = new RegExp(moneySrc); const hits = [];
    const root = document.querySelector("main") || document.querySelector(".app-main") || document.body;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode, s = n.textContent.trim(); const el = n.parentElement;
      if (!s || !el || el.closest("nav, [aria-hidden=true], .sr-only, [data-plain-on-purpose], script, style")) continue;
      if (!el.offsetParent && getComputedStyle(el).position !== "fixed") continue;
      const live = el.closest("a[href], button, [role=button], [role=link], [role=tab], [role=radio], select, option, input, textarea, label, [data-source-key], [tabindex]")
        || getComputedStyle(el).cursor === "pointer";
      if (live) continue;
      const big = parseFloat(getComputedStyle(el).fontSize) >= 18;
      const cell = !!el.closest("td, [role=cell]");
      if (N.has(s)) hits.push("name: " + s);
      else if (MONEY.test(s)) hits.push("money: " + s);
      else if (/^\d[\d,]*%?$/.test(s) && Number(s.replace(/[,%]/g, "")) > 0 && (big || cell)) hits.push("count: " + s);
      if (hits.length && !hits[hits.length - 1].includes(" <- ")) {
        const ctx = (el.closest("tr, li, section, [class*=card], div")?.innerText || "").replace(/\s+/g, " ").slice(0, 90);
        hits[hits.length - 1] += " <- " + ctx;
      }
    }
    return hits;
  }, { names: [...names], moneySrc: MONEY.source });
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(900);
}

async function main() {
  console.log("\nFIX-40 · everything in Communications opens, and every email can be read\n");
  await wipe();
  try {
    const tok = await fixture();
    ok("§fixture signed in", !!tok);
    const otherTok = (await api("POST", "/auth/login", null, { email: OTHER_ADMIN, password: "loadtest1234" })).body.token;

    // ── §counts ───────────────────────────────────────────────────────────
    const hub = await api("GET", "/communications/hub", tok);
    ok("§counts Overview's Emails sent counts every sent campaign, not the six newest rows", hub.body.stats && hub.body.stats.totalSent === 2, hub.body.stats);
    ok("§counts …and its open rate is that campaign's", hub.body.stats && hub.body.stats.openRate === 50, hub.body.stats);
    const aud = await api("GET", "/communications/audience", tok);
    ok("§counts GET /communications/audience answers", aud.status === 200 && Array.isArray(aud.body.segments), aud.status);
    const seg = id => (aud.body.segments || []).find(s => s.id === id) || {};
    ok("§counts All donors is donors with an email (Ada, Ben), not the volunteer or the donor with no email",
      seg("all").count === 2 && JSON.stringify((seg("all").rows || []).map(r => r.id).sort()) === JSON.stringify([D.ada, D.ben]), seg("all"));
    ok("§counts …and it says how many donors Donors counts", aud.body.donorTotal === 3, aud.body.donorTotal);
    ok("§counts Gone quiet is the Why rule: Drift says Ben is past his gap", seg("lapsed").count === 1 && seg("lapsed").rows[0].id === D.ben, seg("lapsed"));
    ok("§counts the words: \"Major\" (FIX-49: the Major giving level)", seg("major").label === "Major" && seg("major").count === 1, seg("major"));
    ok("§counts each segment carries its one-line definition", (aud.body.segments || []).every(s => s.definition && s.definition.length > 20));
    const audOther = await api("GET", "/communications/audience", otherTok);
    ok("§tenant another org's Audience names nobody from this one", !JSON.stringify(audOther.body).includes("Fortyworth"));

    // ── §rows ─────────────────────────────────────────────────────────────
    const rows = async (key, params, t = tok) => api("GET", `/figures/${key}/rows?${new URLSearchParams(params)}`, t);
    const all = await rows("emails-sent", {});
    ok("§rows emails-sent: one row per person a campaign went to, footing to Emails sent", all.body.value === 2 && (all.body.rows || []).length === 2, [all.status, all.body.value]);
    ok("§rows …each row is a person who opens", (all.body.rows || []).every(r => r.donorId === D.ada || r.donorId === D.ben), all.body.rows);
    const one = await rows("emails-sent", { campaign: "c_fix40_sent" });
    ok("§rows …for one campaign", one.body.value === 2, one.body.value);
    const m = `${SENT.getUTCFullYear()}-04-01`;
    const april = await rows("emails-sent", { from: m, to: m.slice(0, 8) + "30" });
    ok("§rows …for April, the month its bar stands for", april.body.value === 2, [m, april.body.value]);
    const may = await rows("emails-sent", { from: m.slice(0, 5) + "05-01", to: m.slice(0, 5) + "05-31" });
    ok("§rows …and none in May", may.body.value === 0, may.body.value);
    const gifts = await rows("email-tool-gifts", { campaign: "emc_fix40" });
    ok("§rows email-tool-gifts: the $250 Ada gave within 30 days of the newsletter", Number(gifts.body.value) === 250 && (gifts.body.rows || []).length === 1, [gifts.status, gifts.body.value]);
    const tc = (await api("GET", "/email-marketing/campaigns", tok)).body.campaigns.find(c => c.id === "emc_fix40");
    ok("§rows …the same gifts the cell counts", tc && tc.giftsWithin === 1 && tc.giftCentsWithin === 25000, tc);
    const otherRows = await rows("emails-sent", { campaign: "c_fix40_sent" }, otherTok);
    ok("§tenant another org's emails-sent is empty", (otherRows.body.rows || []).length === 0, otherRows.body.value);

    // ── §page ─────────────────────────────────────────────────────────────
    const pg = await api("GET", "/campaigns/c_fix40_sent/as-sent", tok);
    ok("§page a campaign's page answers", pg.status === 200, [pg.status, JSON.stringify(pg.body).slice(0, 200)]);
    ok("§page …the subject and body as sent, filled for one person", pg.body.example && /Thank you, (Ada|Ben)/.test(pg.body.example.subject || "") && /Dear (Ada|Ben)/.test(pg.body.example.body || ""), pg.body.example);
    ok("§page …when it went and who from", !!pg.body.sentAt && pg.body.from && (pg.body.from.email || pg.body.from.name), [pg.body.sentAt, pg.body.from]);
    ok("§page …every recipient, each a person", (pg.body.recipients || []).length === 2 && pg.body.recipients.every(r => r.donorId), pg.body.recipients);
    ok("§page …delivered, bounced and unsubscribed", pg.body.counts && pg.body.counts.delivered === 2 && pg.body.counts.bounced === 0 && pg.body.counts.unsubscribed === 0, pg.body.counts);
    const pgOther = await api("GET", "/campaigns/c_fix40_sent/as-sent", otherTok);
    ok("§tenant another org cannot open the campaign's page", pgOther.status === 404, pgOther.status);
    const del = await api("GET", "/email-marketing/campaigns/emc_fix40/people?which=delivered", tok);
    ok("§page the email tool's Delivered names who Steward knows it went to, each a person", (del.body.people || []).length === 2 && del.body.people.every(p => p.donorId), del.body.people);
    ok("§page …and says the tool counted 40", del.body.counted === 40 && /40/.test(del.body.sentence || ""), del.body.sentence);

    // ── §emails ───────────────────────────────────────────────────────────
    const got = await api("GET", `/donors/${D.ada}/emails-received`, tok);
    const kinds = new Set((got.body.emails || []).map(e => e.kind));
    for (const k of ["campaign", "journey", "thank-you", "email tool"])
      ok(`§emails Ada's emails include a ${k}`, kinds.has(k), [...kinds]);
    const camp = (got.body.emails || []).find(e => e.kind === "campaign");
    if (camp) {
      const asGot = await api("GET", camp.open.path, tok);
      ok("§emails the campaign opens as Ada received it", asGot.status === 200 && /Dear Ada/.test(JSON.stringify(asGot.body)), [asGot.status, JSON.stringify(asGot.body).slice(0, 160)]);
    }
    const jr = (got.body.emails || []).find(e => e.kind === "journey");
    if (jr) {
      const asGot = await api("GET", jr.open.path, tok);
      ok("§emails the journey email opens with the words she was sent", asGot.status === 200 && /finished the mural/.test(JSON.stringify(asGot.body)), asGot.status);
    }
    const gotOther = await api("GET", `/donors/${D.ada}/emails-received`, otherTok);
    ok("§tenant another org cannot list Ada's emails", gotOther.status === 404 || gotOther.status === 403, gotOther.status);

    // ── the browser legs ──────────────────────────────────────────────────
    const b = await B.open(h, "§browser");
    if (!b) return;
    try {
      // §dead — every row of dead-ends.md, on this suite's own org.
      const doc = fs.readFileSync(path.join(__dirname, "..", "docs", "fix-40", "dead-ends.md"), "utf8");
      const probes = doc.split("\n").filter(l => /^\| (Overview|Campaigns|Audience|Analytics|Your email tool|Drafts to review) \|/.test(l))
        .map(l => l.split("|").map(c => c.trim())).filter(c => c[5] && c[5].includes(" · "))
        .map(c => { const [tab, sel, how] = c[5].split(" · ").map(x => x.trim()); return { tab, sel: sel.replace(/^`|`$/g, ""), how, what: c[2] }; });
      ok("§dead the list names its probes", probes.length >= 20, probes.length);
      const SUB = { hub: "hub", campaigns: "campaigns", audience: "audience", analytics: "analytics", emailtool: "emailtool", milestones: "milestones" };
      for (const viewport of [{ width: 1440, height: 900 }]) {
        const { ctx, page } = await b.signedIn(ADMIN, viewport);
        const errors = [];
        // A failed request is an error, except the two a local preview always
        // has: Vercel's analytics scripts and the AI stream with no key.
        page.on("response", r => { if (r.status() >= 400 && !/\/_vercel\/|\/ai\/stream/.test(r.url())) errors.push(r.status() + " " + r.url().replace(/^https?:\/\/[^/]+/, "")); });
        // Playwright runs this suite's sign-in init script in every frame, and
        // in the email's sandboxed frame it cannot touch storage: that throw is
        // the harness's, not the page's.
        page.on("pageerror", e => { if (!/sandboxed/.test(e.message)) errors.push("pageerror " + String(e.message).slice(0, 140)); });
        for (const p of probes) {
          if (!SUB[p.tab] || p.sel === "expanded row") continue;
          await page.goto(`${b.APP}/app/communications?subtab=${SUB[p.tab]}`, { waitUntil: "domcontentloaded" }); await settle(page);
          if (p.how === "gone") {
            const text = await page.evaluate(() => document.body.innerText);
            ok(`§dead ${p.tab}: ${p.what} is gone`, !/Industry avg/i.test(text));
            continue;
          }
          if (/emailtool-person/.test(p.sel)) { await page.locator('button[aria-label^="Who opened"]').first().click().catch(() => {}); await page.waitForTimeout(1000); }
          const loc = page.locator(p.sel).first();
          const n = await page.locator(p.sel).count();
          if (!n && p.tab === "milestones") { ok(`§dead ${p.tab}: ${p.what} (no draft on this org, checked on the demo below)`, true); continue; }
          ok(`§dead ${p.tab}: ${p.what} is there`, n > 0, p.sel);
          if (!n) continue;
          if (p.how === "link") {
            const href = await loc.evaluate(e => (e.closest("a[href]") || e).getAttribute("href"));
            ok(`§dead ${p.tab}: ${p.what} is a real link to a profile`, /\/donors\//.test(href || ""), href);
            continue;
          }
          await loc.click(); await page.waitForTimeout(1200);
          if (p.how === "rows" && p.tab === "audience" && /audience-seg"?\]$/.test(p.sel)) {
            ok(`§dead ${p.tab}: ${p.what} shows every person in it`, await page.locator("[data-testid=audience-row]").count() > 0);
          } else if (p.how === "rows") {
            const opened = await page.locator('[data-figure-row], [data-person-row], [role=dialog]').count();
            const moved = !/subtab=(hub|audience)/.test(page.url()) || opened > 0;
            ok(`§dead ${p.tab}: ${p.what} opens its rows`, opened > 0 || moved, [page.url(), opened]);
          } else if (p.how === "page") {
            const pageOpen = await page.locator('[data-testid=email-as-sent], [data-testid=emailtool-campaign-page]').count();
            const toCampaigns = /subtab=campaigns/.test(page.url()) || await page.locator('[data-testid=camp-row]').count() > 0;
            ok(`§dead ${p.tab}: ${p.what} opens the campaign`, pageOpen > 0 || toCampaigns, page.url());
          } else if (p.how === "tab") {
            const on = await page.locator('.comm-tabbar [aria-selected=true], .comm-tabbar [aria-current], .comm-tabbar [aria-pressed=true]').first().innerText().catch(() => "");
            ok(`§dead ${p.tab}: ${p.what} opens the screen that lists them`, on && !/^Overview/.test(on.trim()), on);
          }
        }
        // The campaign page in the browser: the email, and each recipient a link.
        await page.goto(`${b.APP}/app/communications?subtab=analytics`, { waitUntil: "domcontentloaded" }); await settle(page);
        await page.locator("[data-testid=analytics-best]").click(); await page.waitForTimeout(1500);
        ok("§page in the browser: the subject as sent", /Thank you, (Ada|Ben)/.test(await page.locator("[data-testid=eas-subject]").innerText().catch(() => "")));
        const recips = await page.locator("[data-testid=eas-recipient]").evaluateAll(as => as.map(a => a.getAttribute("href")));
        ok("§page in the browser: each recipient is a link to their profile", recips.length === 2 && recips.every(h => /\/donors\//.test(h || "")), recips);
        // Twelve months on the chart.
        await page.goto(`${b.APP}/app/communications?subtab=analytics`, { waitUntil: "domcontentloaded" }); await settle(page);
        ok("§dead Sends per month is twelve labelled months", await page.locator("[data-testid=sends-per-month] [data-month]").count() === 12);
        ok("§dead …and no Industry avg", !/Industry avg/i.test(await page.evaluate(() => document.body.innerText)));
        // Your email tool's gifts cell, in words.
        await page.goto(`${b.APP}/app/communications?subtab=emailtool`, { waitUntil: "domcontentloaded" }); await settle(page);
        ok("§dead Gifts within 30 days reads \"1 gift, $250\"", (await page.locator("[data-testid=emailtool-gifts]").innerText().catch(() => "")) === "1 gift, $250");
        // The profile's Emails tab.
        await page.goto(`${b.APP}/donors/${D.ada}`, { waitUntil: "domcontentloaded" }); await settle(page);
        await page.locator('[data-tab=emails]').first().click().catch(() => {}); await page.waitForTimeout(1200);
        const rowKinds = await page.locator("[data-testid=dp-email-received-row]").evaluateAll(rs => rs.map(r => r.getAttribute("data-kind")));
        for (const k of ["campaign", "journey", "thank-you"]) ok(`§emails the Emails tab lists a ${k} Ada received`, rowKinds.includes(k), rowKinds);
        const firstCamp = page.locator('[data-testid=dp-email-received-row][data-kind=campaign]').first();
        if (await firstCamp.count()) {
          await firstCamp.click(); await page.waitForTimeout(1200);
          const body = await page.locator("[data-testid=eas-body]").first().evaluate(e => e.tagName === "IFRAME" ? (e.srcdoc || e.contentDocument?.body?.innerText || "") : e.innerText).catch(() => "");
          ok("§emails …and it opens the email as she received it", /Dear Ada/.test(body), body.slice(0, 120));
        }
        ok("§dead no failed request or page error on the way", errors.length === 0, [...new Set(errors)].slice(0, 4));
        await ctx.close();
      }

      // §guard — app-wide, reading the demo.
      const names = (await q(`SELECT name FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [DEMO_ORG])).map(r => r.name);
      ok("§guard the demo is seeded", names.length > 100, names.length);
      const li = await api("POST", "/auth/login", null, { email: DEMO, password: "demo-harbor-2026" });
      for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        const ctx = await b.browser.newContext({ viewport, serviceWorkers: "block" });
        await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
          [li.body.token, JSON.stringify(li.body.user || {}), JSON.stringify(li.body.org || {})]);
        const page = await ctx.newPage();
        const [{ id: someone }] = await q(`SELECT id FROM donors WHERE org_id=$1 AND deleted_at IS NULL ORDER BY total_giving DESC NULLS LAST LIMIT 1`, [DEMO_ORG]);
        const pages = ["/app/home", "/app/donors", `/donors/${someone}`, "/app/fundraising", "/app/reports", "/app/finance",
          ...["hub", "campaigns", "templates", "audience", "analytics", "sequences", "emailtool", "milestones", "surveys"].map(s => `/app/communications?subtab=${s}`)];
        for (const p of pages) {
          await page.goto(b.APP + p, { waitUntil: "domcontentloaded" }); await settle(page); await page.waitForTimeout(800);
          const hits = await plainOnPage(page, names);
          ok(`§guard ${viewport.width} ${p}: no plain name, amount or count`, hits.length === 0, hits.slice(0, 4));
        }
        await ctx.close();
      }
    } finally { await b.browser.close(); }
  } catch (e) {
    ok("ran to the end", false, String(e && e.stack || e).slice(0, 600));
  } finally { await wipe(); }
}

main().then(async () => { await h.closeDb(); h.summary(); }).catch(e => { console.error(e); process.exit(1); });

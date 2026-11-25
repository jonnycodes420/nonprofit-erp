// tests/campaign2/sections.js · CAMPAIGN-2. WHO A CAMPAIGN REACHES IS RIGHT, AND EVERY BUTTON IN
// THE EDITORS SAYS WHAT IT DID. Run by tests/fix39-campaigns.test.js (the campaign suite), on that
// suite's own org; never the demo. Nothing sends: Campaign emails stay off and no Send is pressed.
//
//   §c2-all     By stage > Lapsed, then All donors, is everyone (the API, and the real clicks
//               three times); a draft already saved with a stale stage under All donors is all donors.
//   §c2-tiers   the three giving levels together are everyone with a gift in the last 12 months
//               (counted here from the gifts, not by Steward's rule), and Major is the Donors
//               list's Major (GET /donors?level=major).
//   §c2-recv    the audience leads with "N of M can't receive this yet: Campaign emails are off
//               for your organization.", the switch's place, and the others as figures.
//   §c2-start   "Start a campaign from this" opens the new draft in the campaign editor with a
//               toast; pressed again it opens the same draft, never a second.
//   §c2-ai      each AI button drafts or says why not on the first click (no key here: "not
//               available on this server"; AI off: where the switch is; unsaved: save first).
//   §c2-census  every button in the template, campaign and sequence editors changes something a
//               person can see (tests/lib/deadClickCensus.js).
//
// RED ON MAIN (edd466f): see docs/history/CAMPAIGN-2.md.
"use strict";
const { census, dead } = require("../lib/deadClickCensus");

const DAY = 86400000;
const iso = ms => new Date(ms).toISOString().slice(0, 10);

module.exports = async function campaign2({ h, B, ORG, ADMIN, tok }) {
  const { ok, api, q } = h;
  const now = Date.now();
  // ── the fixture: made-up people, each with an address ───────────────────
  // name, stage, [ [daysAgo, amount], … ]
  const PEOPLE = [
    ["Ada Major", "steward", [[20, 12000]]], ["Ben Major", "cultivate", [[100, 6000], [40, 5000]]],
    ["Cy Mid", "steward", [[60, 2500]]], ["Di Mid", null, [[300, 1000]]],
    ["Ed General", null, [[10, 50]]], ["Flo General", null, [[200, 25], [500, 900]]], ["Gus General", null, [[350, 5]]],
    ["Hal Lapsed", "lapsed", [[700, 300]]], ["Ivy Lapsed", "lapsed", [[900, 40000]]],
  ];
  const ids = [];
  for (const [i, [name, stage, gifts]] of PEOPLE.entries()) {
    const id = `d_c2_${i}`; ids.push(id);
    const total = gifts.reduce((n, g) => n + g[1], 0);
    await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,gift_count,person_types,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'["donor"]','system:test','CAMPAIGN-2 fixture')`,
      [id, ORG, name, `c2.${i}@example.org`, stage, total, gifts.length]);
    for (const [k, [days, amt]] of gifts.entries())
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'cash','system:test','CAMPAIGN-2 fixture')`,
        [`g_c2_${i}_${k}`, ORG, id, amt, iso(now - days * DAY)]);
  }
  // A contact who never gave is not a donor, and not in any level.
  await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ('d_c2_contact',$1,'Jo Contact','c2.contact@example.org','system:test','CAMPAIGN-2 fixture')`, [ORG]);
  const preview = seg => api("POST", "/campaigns/segment-preview", tok, { segment: seg });
  const total = r => r.body && r.body.audience ? r.body.audience.total : null;

  // ── §c2-all ────────────────────────────────────────────────────────────
  const all = total(await preview({ mode: "all" }));
  const lapsedStage = total(await preview({ mode: "byStage", stages: ["lapsed"] }));
  ok("§c2-all All donors is every donor (9)", all === PEOPLE.length, all);
  ok("§c2-all By stage > Lapsed is the two", lapsedStage === 2, lapsedStage);
  const stale = total(await preview({ mode: "all", stages: ["lapsed"], tiers: ["major"] }));
  ok("§c2-all a draft saved with a stale stage under All donors is all donors", stale === all, [stale, all]);

  // ── §c2-tiers ──────────────────────────────────────────────────────────
  // Everyone with a gift in the last 12 months, counted here from the fixture, not by Steward.
  const inWindow = PEOPLE.filter(p => p[2].some(g => g[0] < 365)).length;
  const three = await preview({ mode: "byTier", tiers: ["major", "mid", "general"] });
  ok("§c2-tiers the three levels together are everyone with a gift in 12 months (7)", total(three) === inWindow && inWindow === 7, [total(three), inWindow]);
  ok("§c2-tiers …and say what a level is", /Major is \$10,000 and up/.test(three.body.tierSentence || "") && /last 12 months/.test(three.body.tierSentence || ""), three.body.tierSentence);
  const major = total(await preview({ mode: "byTier", tiers: ["major"] }));
  const listMajor = await api("GET", "/donors?level=major&limit=100", tok);
  const listN = listMajor.body && (listMajor.body.total != null ? listMajor.body.total : (listMajor.body.donors || listMajor.body.rows || []).length);
  ok("§c2-tiers Major here is Major on the Donors list (Ada, Ben)", major === 2 && listN === 2, [major, listN, listMajor.status]);
  const old = total(await preview({ mode: "byTier", tiers: ["transformational", "small", "micro"] }));
  ok("§c2-tiers an old capacity tier selects nobody, never everybody", old === 0, old);

  // ── §c2-recv ───────────────────────────────────────────────────────────
  const recv = (await preview({ mode: "all" })).body.audience || {};
  const cr = recv.canReceive;
  ok("§c2-recv the audience leads with who can't receive it yet",
    !!cr && /^\d[\d,]* of \d[\d,]* can't receive this yet: /.test(cr.sentence) && cr.of === recv.total, cr);
  ok("§c2-recv …and the switch's place, for an admin", !!(recv.turnOn && recv.turnOn.link && /Settings/.test(recv.turnOn.link.label)), recv.turnOn);

  // ── §c2-start (API) ────────────────────────────────────────────────────
  const tpl = await api("POST", "/email-templates", tok, { starterKey: "thank_you" });
  const tplId = tpl.body.template.id;
  const s1 = await api("POST", "/campaigns/from-template", tok, { templateId: tplId, reuse: true });
  const s2 = await api("POST", "/campaigns/from-template", tok, { templateId: tplId, reuse: true });
  const n = (await q(`SELECT COUNT(*)::int AS n FROM campaigns WHERE org_id=$1 AND template_id=$2`, [ORG, tplId]))[0].n;
  ok("§c2-start a second press opens the same draft, never a second", s1.status === 201 && s2.status === 200 && s2.body.id === s1.body.id && s2.body.reused === true && n === 1, [s1.status, s2.status, n]);
  await q(`DELETE FROM campaigns WHERE org_id=$1 AND template_id=$2`, [ORG, tplId]);

  // ── §c2-ai (API) ───────────────────────────────────────────────────────
  const noKey = !process.env.ANTHROPIC_API_KEY;
  const d1 = await api("POST", `/email-templates/${tplId}/draft-ai`, tok, {});
  ok("§c2-ai Draft with AI says why it did not draft", d1.status === 200 && (noKey ? d1.body.whyNot && d1.body.whyNot.reason === "ai_no_key" && /not available on this server/.test(d1.body.whyNot.sentence) : true), d1.body.whyNot);
  const s3 = await api("POST", "/ai/draft-email", tok, { purpose: "sequence", step: 1, steps: 1 });
  ok("§c2-ai Write with AI says why it did not draft", s3.status === 200 && (noKey ? !!(s3.body.whyNot && s3.body.whyNot.sentence) : true), s3.body);
  await q(`UPDATE orgs SET ai_enabled=false WHERE id=$1`, [ORG]);
  if (!noKey) {
    const off = await api("POST", `/email-templates/${tplId}/draft-ai`, tok, {});
    ok("§c2-ai AI off says where the switch is", off.body.whyNot && off.body.whyNot.reason === "ai_disabled" && /section=data/.test((off.body.whyNot.link || {}).href || ""), off.body.whyNot);
  }
  await q(`UPDATE orgs SET ai_enabled=NULL WHERE id=$1`, [ORG]).catch(() => q(`UPDATE orgs SET ai_enabled=true WHERE id=$1`, [ORG]));
  await api("POST", "/sequences", tok, { name: "CAMPAIGN-2 sequence", trigger: "manual", steps: [{ delayDays: 0, subject: "Hello", body: "Dear {{donor_name}}, thank you." }] });

  // ── the browser ────────────────────────────────────────────────────────
  const b = await B.open(h, "§c2-browser");
  if (!b) return;
  try {
    const { ctx, page } = await b.signedIn(ADMIN, { width: 1440, height: 900 });
    const settle = async () => { await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(700); };
    const lineTotal = async () => { await page.waitForTimeout(400); await settle(); return Number(await page.locator('[data-testid="audience-line"]').first().getAttribute("data-total")); };
    const openCampaign = async () => {
      await page.goto(b.APP + "/app/communications?subtab=campaigns", { waitUntil: "domcontentloaded" }); await settle();
      await page.getByRole("button", { name: "New campaign" }).first().click();
      await page.locator('[data-testid="campaign-gallery"] :text("Use this")').first().click();
      await page.locator('[data-testid="campaign-builder"]').waitFor({ timeout: 15000 }); await settle();
    };
    await openCampaign();
    const rail = page.locator('[data-testid="rail-audience"]').last();
    // By name, as a person finds them (and so the leg runs on main, to show it red there).
    const press = (loc) => loc.click({ timeout: 5000 }).catch(() => {});
    await press(rail.getByRole("button", { name: "By stage", exact: true }));
    await press(rail.getByRole("button", { name: "Lapsed", exact: true }));
    const afterLapsed = await lineTotal();
    const clicks = [];
    for (let i = 0; i < 3; i++) { await press(rail.getByRole("button", { name: "All donors", exact: true })); clicks.push(await lineTotal()); }
    ok("§c2-all real clicks: Lapsed (2), then All donors gives every donor, three times", afterLapsed === 2 && clicks.every(x => x === all), [afterLapsed, clicks]);
    await press(rail.getByRole("button", { name: "By tier", exact: true }));
    for (const t of ["Major", "Mid", "General"]) await press(rail.locator("button").filter({ hasText: new RegExp("^" + t + "$", "i") }).last());
    ok("§c2-tiers real clicks: the three levels together give 7", (await lineTotal()) === inWindow);
    ok("§c2-recv real clicks: the sentence leads the audience", /can't receive this yet: Campaign emails are off for your organization\./.test(await page.locator('[data-testid="can-receive"]').innerText().catch(() => "")));

    // §c2-census · the campaign editor
    const SKIP = "^(← )?(Back|Send to|Send me a test|Schedule|Save draft|Ask an admin|Duplicate|Clear the time)|Remove|Delete|campaign-send|send-me-a-test";
    const cRes = await census(page, { root: '[data-testid="campaign-builder"]', open: openCampaign, skip: SKIP });
    ok("§c2-census the campaign editor: every button changes something a person sees", cRes.length >= 8 && dead(cRes).length === 0, { clicked: cRes.length, dead: dead(cRes) });

    // §c2-start and §c2-ai · the template editor
    const openTemplate = async () => {
      await page.goto(b.APP + `/app/communications?subtab=templates&template=${tplId}`, { waitUntil: "domcontentloaded" }); await settle();
      if (!(await page.locator('[data-testid="email-editor"]').count())) {
        await page.getByText("Thank", { exact: false }).first().click().catch(() => {});
        await settle();
      }
      await page.locator('[data-testid="email-editor"]').waitFor({ timeout: 15000 }); await settle();
    };
    await openTemplate();
    await press(page.locator('[data-testid="email-draft-ai"]')); await settle();
    const aiSay = await page.locator('[data-testid="email-more-result"]').innerText().catch(() => "");
    ok("§c2-ai Draft with AI, first click: says why not, beside the button", noKey ? /not available on this server/.test(aiSay) : aiSay.length > 0 || (await page.locator('[data-testid="ai-proposals"]').count()) > 0, aiSay);
    const tRes = await census(page, { root: '[data-testid="email-editor"]', open: openTemplate, skip: SKIP + "|Start a campaign|Publish|Discard|Make a draft|Save$|Save and" });
    ok("§c2-census the template editor: every button changes something a person sees", tRes.length >= 8 && dead(tRes).length === 0, { clicked: tRes.length, dead: dead(tRes) });
    await openTemplate();
    const nBefore = (await q(`SELECT COUNT(*)::int AS n FROM campaigns WHERE org_id=$1`, [ORG]))[0].n;
    await press(page.locator('[data-testid="email-start-campaign"]'));
    const opened = await page.locator('[data-testid="campaign-builder"]').waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    const toast = await page.locator("[data-undo-host]").innerText().catch(() => "");
    ok("§c2-start Start a campaign from this opens the draft, with a toast", opened && /is a draft/.test(toast), [opened, toast]);
    await openTemplate();
    await press(page.locator('[data-testid="email-start-campaign"]'));
    await page.locator('[data-testid="campaign-builder"]').waitFor({ timeout: 10000 }).catch(() => {});
    const nAfter = (await q(`SELECT COUNT(*)::int AS n FROM campaigns WHERE org_id=$1`, [ORG]))[0].n;
    ok("§c2-start …and pressed again, no second draft", nAfter === nBefore + 1, [nBefore, nAfter]);

    // §c2-shell · Jonathan (staging edd466f): "can not see the top of the screen" after clicking an
    // image block. A long email whose last block is a photo; the last block clicked at 1440x900 and at
    // 390, under a staging strip; Save stays fully on screen, under the header, and is what is there.
    const long = [{ type: "header" }, ...Array.from({ length: 24 }, (_, k) => ({ type: "richtext", blocks: [{ type: "h2", text: `Part ${k + 1}` }, { type: "p", text: "A paragraph of made-up words, long enough to take a line or two." }] })),
      { type: "image", image: "https://cdn.example/photo.jpg", alt: "A made-up photo" }, { type: "footer" }];
    const longTpl = (await api("POST", "/email-templates", tok, { starterKey: "thank_you" })).body.template.id;
    const put = await api("PUT", `/email-templates/${longTpl}`, tok, { blocks: long });
    ok("§c2-shell a long email to click through", put.status === 200, put.status);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const s2 = await b.signedIn(ADMIN, viewport);
      // The staging strip, as stagingStrip.js draws it on staging (24px, pinned above everything).
      await s2.ctx.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.style.setProperty("--steward-strip-h", "24px");
        const st = document.createElement("div"); st.id = "steward-staging-strip";
        Object.assign(st.style, { position: "sticky", top: "0", zIndex: "2147483647", height: "24px", background: "#0F1A12" });
        document.body.insertBefore(st, document.body.firstChild);
      }));
      const p2 = s2.page;
      await p2.goto(b.APP + `/app/communications?subtab=templates&template=${longTpl}`, { waitUntil: "domcontentloaded" });
      await p2.locator('[data-testid="email-editor"]').waitFor({ timeout: 15000 }).catch(() => {});
      await p2.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      const frame = p2.frameLocator('[data-testid="email-preview-frame"]');
      const last = frame.locator("[data-st-block]").filter({ has: frame.locator("img") }).last();
      await last.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});   // a person scrolls the email to it
      await last.click({ timeout: 10000 }).catch(() => {});
      await p2.waitForTimeout(1500);
      const where = await p2.evaluate(() => {
        const save = document.querySelector('[data-testid="email-save"]');
        if (!save) return { missing: true };
        const r = save.getBoundingClientRect();
        const strip = document.getElementById("steward-staging-strip").getBoundingClientRect().bottom;
        const bar = document.querySelector(".app-topbar"); const barR = bar && bar.getBoundingClientRect();
        const above = Math.max(strip, barR && barR.height ? barR.bottom : 0);
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, above, h: innerHeight, w: innerWidth, isSave: !!(hit && save.contains(hit)),
          shell: document.querySelector('[data-testid="steward-editor"]').scrollTop, pageY: scrollY };
      });
      ok(`§c2-shell ${viewport.width}: after the last block is clicked, Save is fully visible under the header`,
        !where.missing && where.top >= where.above - 0.5 && where.bottom <= where.h && where.left >= 0 && where.right <= where.w && where.isSave && where.shell === 0, where);
      await s2.ctx.close();
    }

    // §c2-ai and §c2-census · the sequence editor (Earlier sequences, Edit)
    const openSequence = async () => {
      await page.goto(b.APP + "/app/communications?subtab=sequences", { waitUntil: "domcontentloaded" }); await settle();
      await page.getByRole("button", { name: "Edit", exact: true }).last().click(); await settle();
      await page.getByRole("button", { name: /Write with AI/ }).first().waitFor({ timeout: 10000 });
      // The builder is the box around "Write with AI" that holds its heading (the same on main, to show it red there).
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find(x => /Write with AI/.test(x.innerText));
        let el = btn; while (el && !(el.querySelector("h2") && /sequence/i.test(el.querySelector("h2").innerText))) el = el.parentElement;
        if (el) el.setAttribute("data-census-root", "seq");
      });
    };
    await openSequence();
    await press(page.getByRole("button", { name: /Write with AI/ }).first()); await settle();
    const seqSay = await page.locator('[data-testid="seq-step-ai-note-0"]').innerText().catch(() => "");
    ok("§c2-ai Write with AI, first click: says why not, and her words stay", (noKey ? /not available on this server/.test(seqSay) : seqSay.length > 0)
      && (await page.locator("textarea").first().inputValue()) === "Dear {{donor_name}}, thank you.", seqSay);
    const seqRoot = '[data-census-root="seq"]';
    const sRes = await census(page, { root: seqRoot, open: openSequence, skip: SKIP + "|Save|Remove" });
    ok("§c2-census the sequence editor: every button changes something a person sees", sRes.length >= 3 && dead(sRes).length === 0, { clicked: sRes.length, dead: dead(sRes) });
    await ctx.close();
  } finally { await b.browser.close(); }
};

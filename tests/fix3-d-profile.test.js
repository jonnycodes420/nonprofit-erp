// FIX-3 finding 10 — THE DONOR PROFILE, ORGANISED AROUND FOUR QUESTIONS.
//
// Jonathan picked Direction 1 (docs/fix-3/profile/): a white band that says
// who this is and where we stand, then "what do I do next", then "what has
// happened", then "how we manage them" in groups that are closed until opened.
// The brief's rule: keep every feature; change the order and the grouping.
//
// The CONTRACT is the inventory table in docs/fix-3/D-NOTES.md. This suite
// walks it: every element on the old profile is reachable on the new one, at
// 1440 and at 390, in the place the table gives it — in the band, in a
// section, behind More, on a history filter, or inside a group once opened.
//
//   §1 source (runs anywhere): the four questions in order; the groups closed
//      by default; the header's one primary and its More menu; each element
//      that only renders on some records (a flag, a matching-gift employer,
//      soft credit, recurring, events) sits in its question's part of the page.
//   §2 browser (the stack): a Team fixture org with a major-gift prospect
//      (an open step, a proposal, a plan, gifts, conversations, a sequence,
//      custom fields) and an organisation; every element reached, both widths.
//      SKIPs without Playwright.

const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const { readSource } = require("../scripts/lib/readSource");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + String(JSON.stringify(extra)).slice(0, 600) : "")); }
};
const ORG = "org_fx3dinv", EMAIL = "fx3dinv@example.org", PW = "loadtest1234", U = "u_fx3dinv";
const P = "d_fx3dinv_p", FUNDER = "d_fx3dinv_f";

// ── THE INVENTORY (docs/fix-3/D-NOTES.md), as the browser reaches it ───────
// where: "band" · "next" · "history:<filter label>" · "more" · "group:<id>"
// find:  a CSS selector, or { text } to find in that place's visible text.
const INVENTORY = [
  ["Back button", "band", ".dph-back"],
  ["Photo / face", "band", "[data-testid=donor-photo-drop]"],
  ["Name", "band", { text: "Eleanor Whitcombe" }],
  ["Stage pill", "band", { text: "Cultivate" }],
  ["Email", "band", { text: "eleanor.whitcombe@example.org" }],
  ["Role chips", "band", "[data-testid=role-chips]"],
  ["Lifetime figure (with its definition)", "band", "[data-testid='dp-tile-def-Lifetime']"],
  ["Last gift figure (with its definition)", "band", "[data-testid='dp-tile-def-Last Gift']"],
  ["Last contact figure (with its definition)", "band", "[data-testid='dp-tile-def-Contact']"],
  ["Gift count under lifetime", "band", { text: "6 gifts" }],
  ["Log a conversation (the primary)", "band", "[data-testid=dp-primary]"],
  ["More menu", "band", "[data-testid=dp-more]"],
  ["Request Gift", "more", { text: "Request Gift" }],
  ["Impact Summary", "more", { text: "Impact Summary" }],
  ["Edit", "more", { text: "Edit" }],
  ["Export gifts (CSV)", "more", { text: "Export gifts (CSV)" }],
  ["Suggest the next move", "more", { text: "Suggest the next move again" }],
  ["Suggest outreach", "more", { text: "Suggest outreach" }],
  ["Draft an email", "more", { text: "Draft an email" }],
  ["Call script", "more", { text: "Call script" }],
  ["Open items (the next step, Done)", "next", "[data-testid=dp-open-items]"],
  ["The suggestion", "next", "[data-testid=dp-suggestion]"],
  ["Proposals", "next", "[data-testid=donor-proposals-panel]"],
  ["Cultivation plan", "next", "[data-testid=plan-steps]"],
  ["Before you go / Brief me", "next", { text: "Brief me" }],
  ["Giving history chart", "history:Everything", { text: "Giving History" }],
  ["Tags", "history:Everything", { text: "BOARD PROSPECT" }],
  ["Notes", "history:Everything", { text: "Prefers a call to email" }],
  ["Touchpoint timeline", "history:Everything", { text: "Touchpoint Timeline" }],
  ["Gifts & Pledges: gift history", "history:Gifts & Pledges", { text: "Gift History" }],
  ["Gifts & Pledges: pledges", "history:Gifts & Pledges", { text: "Pledges" }],
  ["Gifts & Pledges: planned giving", "history:Gifts & Pledges", { text: "Planned Giving" }],
  ["Funds", "history:Funds", { re: "What they support|No giving data" }],
  ["Activity: stewardship log", "history:Activity", { text: "Log Stewardship" }],
  ["Relationship owner", "group:owner", { text: "Relationship Owner" }],
  ["Reassign (Team)", "group:owner", { text: "Reassign" }],
  ["Move stage (Team)", "group:owner", "[data-testid=dp-move-stage]"],
  ["Pipeline — moves & asks", "group:pipeline", { text: "Pipeline — moves & asks" }],
  ["Sequences (enroll)", "group:sequences", "[data-testid=dp-sequences]"],
  ["Custom fields", "group:fields", { text: "Spouse" }],
  ["Household", "group:household", { text: "Group into household" }],
  ["Planned giving & designations", "group:household", "[data-designation]"],
  ["Linked donors (Related)", "group:household", { text: "Linked Donors" }],
  ["Volunteering (hours, log a shift)", "group:people", "[data-testid=volunteer-total]"],
  ["Materials", "group:files", { text: "Donor Materials" }],
  ["Follow-up tasks", "group:files", { text: "Follow-up Tasks" }],
  ["Edit details", "group:record", { text: "Edit details" }],
  ["Delete donor", "group:record", { text: "Delete donor" }],
];
// Elements a record only has sometimes: the source must put each in its place.
// [name, the code that draws it, the part of the page it must sit in]
const CONDITIONAL = [
  ["Drift badge + reason", "donor.drift.reason", "band"],
  ["Deceased flag", "No mail of any kind is sent to this donor", "band"],
  ["Do-not-contact flag", "Excluded from campaigns, sequences, and workflow emails", "band"],
  ["Do-not-solicit flag", "No asks — excluded from the drift list", "band"],
  ["Imported-sustainer flag", "Sustainer history from import", "band"],
  ["Source-recurring sentence", "donor-source-recurring", "band"],
  ["Pinned next step (desktop)", "dp-pinned-next", "band"],
  ["Plan a follow-up (when nothing is open)", ">Plan a follow-up<", "band"],
  ["Funder panel (organisations)", "<FunderPanel", "stand"],
  ["Unitemized-total note", "dp-unitemized-note", "stand"],
  ["Household total banner", "household total", "stand"],
  ["Matching-gift employer", "matches employee gifts", "next"],
  ["Nothing-open line", "dp-nothing-open", "next"],
  ["Copy the draft", "dp-copy-draft", "next"],
  ["Soft credit", "soft-credit-panel", "history"],
  ["Recurring gift health", "Recurring gift health", "history"],
  ["Recurring donor", "Recurring Donor", "manage"],
  ["Suggested move", "Suggested Move", "manage"],
  ["Wealth score (hidden until defined)", "dp-wealth-score", "manage"],
  ["Events", ">Events<", "manage"],
  ["Membership (when the org has levels)", "<MembershipPanel", "manage"],
];

(async () => {
  console.log("fix3-d-profile");
  console.log("\n— §1 · the source —");
  const src = readSource("client/src/components/Donors.jsx");
  const dp = src.slice(src.indexOf("function DonorProfile({"));
  const at = s => dp.indexOf(s);
  const band = [at('className="donor-profile-header"'), at('className="donor-profile-body"')];
  const stand = [band[1], at('id="dp-next"')];
  const next = [at('id="dp-next"'), at('id="dp-history"')];
  const hist = [at('id="dp-history"'), at('id="dp-manage"')];
  const manage = [at('id="dp-manage"'), at("</section>", at('id="dp-manage"')) >= 0 ? dp.indexOf("</section>", at('id="dp-manage"')) : -1];
  ok("§1 the four parts are in the order of the questions: band, next, history, manage",
     band[0] > 0 && band[0] < band[1] && next[0] > band[1] && hist[0] > next[0] && manage[0] > hist[0], [band, next, hist, manage]);
  const PARTS = { band, stand, next, history: hist, manage };
  for (const [name, code, part] of CONDITIONAL) {
    const i = dp.indexOf(code, PARTS[part][0]);
    ok(`§1 ${name} sits in the ${part}`, i > PARTS[part][0] && i < PARTS[part][1], { code, i, part: PARTS[part] });
  }
  const groupFn = (src.match(/function DpGroup\([\s\S]*?\n\}/) || [""])[0];
  ok("§1 a management group is a <details> with no open attribute (closed until opened)",
     /<details /.test(groupFn) && !/\bopen[=\s{]/.test(groupFn.replace(/\[open\]/g, "")), groupFn.slice(0, 300));
  const groups = [...dp.slice(manage[0], manage[1]).matchAll(/<DpGroup id="([a-z]+)"/g)].map(m => m[1]);
  ok("§1 how we manage them: owner, pipeline, sequences, fields, household, people, files, record",
     JSON.stringify(groups) === JSON.stringify(["owner", "pipeline", "sequences", "fields", "household", "people", "files", "record"]), groups);
  const header = dp.slice(band[0], band[1]);
  ok("§1 the band carries ONE filled emerald control (Log a conversation)",
     (header.match(/background:T\.greenDk/g) || []).length === 1 && /dp-primary[\s\S]{0,400}Log a conversation/.test(header));
  ok("§1 the old tab row is gone: Related and Materials live in groups now",
     !/\["related","Related"\]|\["materials","Materials"\]/.test(dp));

  console.log("\n— §2 · every element reached, as drawn —");
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { console.log("  SKIP  §2 browser: Playwright is not installed here (CI has none)"); return done(); }
  if (!process.env.APP_URL) { console.log("  SKIP  §2 browser: APP_URL is not set"); return done(); }
  const h = require("./helpers");
  const bcrypt = require("bcryptjs");
  const reset = async () => {
    for (const t of ["sequence_enrollments", "opportunities", "plan_steps", "cultivation_plans", "cultivation_templates", "threads",
                     "interactions", "gifts", "tasks", "donors", "custom_field_defs", "custom_field_events", "fin_audit_log", "users"])
      await h.q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
    await h.q(`DELETE FROM sequence_steps WHERE sequence_id IN (SELECT id FROM sequences WHERE org_id=$1)`, [ORG]).catch(() => {});
    await h.q(`DELETE FROM sequences WHERE org_id=$1`, [ORG]).catch(() => {});
    await h.q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  };
  await reset();
  await h.q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status) VALUES ($1,'Profile Inventory','fx3d-inv',1,'team','active')`, [ORG]);
  await h.q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Maya Okafor','admin')`, [U, ORG, EMAIL, bcrypt.hashSync(PW, 4)]);
  const d = n => h.civilPlusDays(-n);
  await h.q(`INSERT INTO donors (id,org_id,name,email,stage,status,total_giving,gift_count,last_gift_date,first_gift_date,assigned_to,assigned_to_name,tags,notes,person_types)
             VALUES ($1,$2,'Eleanor Whitcombe','eleanor.whitcombe@example.org','cultivate','active',41500,6,$3,$4,$5,'Maya Okafor','["board prospect","piano"]',
                     'Retired surgeon. Prefers a call to email.','["donor","volunteer"]')`, [P, ORG, d(70), d(1400), U]);
  for (const [i, [ago, amt]] of [[1400, 2500], [1050, 5000], [700, 7500], [400, 10000], [160, 1500], [70, 15000]].entries())
    await h.q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'check',$6,'Maya Okafor')`,
      [`g_fx3dinv_${i}`, ORG, P, amt, d(ago), U]);
  await h.q(`INSERT INTO donors (id,org_id,name,email,kind,stage,status,total_giving,gift_count) VALUES ($1,$2,'Juniper Foundation','grants@juniper.example.org','organisation','cultivate','active',0,0)`, [FUNDER, ORG]);
  const tok = await h.login(EMAIL, PW);
  const must = async (label, r) => { ok(`§2 fixture: ${label}`, r.status >= 200 && r.status < 300, r.body); return r; };
  await must("a conversation with a next step", await h.api("POST", `/donors/${P}/conversations`, tok,
    { touch: "call_reached", line: "Said she would like to see a proposal before the spring recital.", nextStep: { type: "follow_up", label: "Send the scholarship proposal", due: h.civilPlusDays(5) } }));
  await must("an open proposal", await h.api("POST", `/donors/${P}/proposals`, tok, { purpose: "Named scholarship fund", askAmount: "50000", stage: "cultivating", expectedClose: h.civilPlusDays(75), probability: 75 }));
  const tpl = await must("a plan template", await h.api("POST", "/cultivation-templates", tok, { name: "Major gift, first ask", steps: [
    { type: "follow_up", label: "Invite her to a studio lesson", offsetDays: 7 }, { type: "check_in_ask", label: "Ask for the named scholarship", offsetDays: 60 }] }));
  await must("a cultivation plan", await h.api("POST", `/donors/${P}/plan`, tok, { templateId: tpl.body.id }));
  await must("a sequence", await h.api("POST", "/sequences", tok, { name: "Major donor stewardship", steps: [{ delayDays: 0, subject: "Thank you", body: "Thank you." }] }));
  const cf = await must("a custom field", await h.api("POST", "/custom-fields", tok, { entity: "donor", label: "Spouse", type: "text" }));
  await must("its value", await h.api("PUT", `/donors/${P}/custom-fields`, tok, { values: { [cf.body.key]: "Harold Whitcombe" } }));

  const lr = await h.api("POST", "/auth/login", null, { email: EMAIL, password: PW });
  const browser = await chromium.launch();
  for (const [W, H] of [[1440, 900], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, serviceWorkers: "block" });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", e => errs.push(String(e).slice(0, 200)));
    await page.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lr.body.token, JSON.stringify(lr.body.user), JSON.stringify(lr.body.org)]);
    await page.goto(`${process.env.APP_URL}/donors/${P}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-testid=dp-move-stage]", { state: "attached", timeout: 15000 }).catch(() => {});
    await page.waitForSelector("[data-testid=plan-steps]", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);

    const closed = await page.evaluate(() => [...document.querySelectorAll("details.dp-group")].map(g => [g.id, g.open]));
    ok(`§2 @${W} every management group opens closed`, closed.length >= 8 && closed.every(([, o]) => o === false), closed);

    // Is the element there AND visible, inside the given root?
    const seen = (rootSel, find) => page.evaluate(([rootSel, find]) => {
      const root = document.querySelector(rootSel);
      if (!root) return { ok: false, why: "no " + rootSel };
      const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
      if (typeof find === "string") { const el = root.querySelector(find); return { ok: !!el && vis(el), why: el ? "hidden" : "absent" }; }
      // innerText carries CSS text-transform (an eyebrow reads "GIVING
      // HISTORY"), so the words are compared without case.
      const t = (root.innerText || "").toLowerCase();
      return { ok: find.re ? new RegExp(find.re, "i").test(t) : t.includes(find.text.toLowerCase()), why: "text" };
    }, [rootSel, find]);

    for (const [name, where, find] of INVENTORY) {
      let r;
      if (where === "band") r = await seen(".donor-profile-header", find);
      else if (where === "next") r = await seen("#dp-next", find);
      else if (where === "more") {
        await page.click("[data-testid=dp-more]");
        r = await seen("[data-testid=dp-more-menu]", find);
        await page.click("[data-testid=dp-more]");
      } else if (where.startsWith("history:")) {
        const label = where.slice(8);
        await page.locator("#dp-history [role=tab]", { hasText: label }).first().click();
        await page.waitForTimeout(500);
        r = await seen("#dp-history", find);
      } else {
        const id = where.slice(6);
        await page.evaluate(id => { const g = document.getElementById("dp-group-" + id); if (g) g.querySelector("summary").click(); }, id);
        await page.waitForTimeout(250);
        r = await seen("#dp-group-" + id, find);
        await page.evaluate(id => { const g = document.getElementById("dp-group-" + id); if (g && g.open) g.querySelector("summary").click(); }, id);
      }
      ok(`§2 @${W} ${name} — ${where}`, r.ok, r);
    }

    // A figure opens its rows: the contact figure opens the conversations.
    await page.locator("#dp-history [role=tab]", { hasText: "Everything" }).first().click();
    await page.locator(".donor-stat-grid > div", { hasText: "Contact" }).first().click();
    await page.waitForTimeout(500);
    ok(`§2 @${W} the contact figure opens the conversations (Activity)`,
       await page.locator("#dp-history [role=tab][aria-selected=true]", { hasText: "Activity" }).count() === 1);
    await page.locator(".donor-stat-grid > div", { hasText: "Lifetime" }).first().click();
    await page.waitForTimeout(500);
    ok(`§2 @${W} the lifetime figure opens the gifts`,
       await page.locator("#dp-history [role=tab][aria-selected=true]", { hasText: "Gifts" }).count() === 1);
    // The borrowing from Direction 2: the next step pinned in the band, at
    // desktop only.
    const pinned = await seen(".donor-profile-header", "[data-testid=dp-pinned-next]");
    ok(`§2 @${W} the next step is pinned in the band ${W >= 1100 ? "at desktop" : "— not on a phone"}`, W >= 1100 ? pinned.ok : !pinned.ok, pinned);
    if (W >= 1100) {
      await page.evaluate(() => document.querySelector(".donor-profile-body").scrollTo(0, 99999));
      await page.waitForTimeout(400);
      const box = await page.locator("[data-testid=dp-pinned-next]").boundingBox();
      ok(`§2 @${W} …and it stays on screen when the page scrolls to the bottom`, !!box && box.y >= 0 && box.y < H, box);
    }
    ok(`§2 @${W} the page never scrolls sideways`, !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));

    // An organisation's record carries the funder panel above the questions.
    await page.goto(`${process.env.APP_URL}/donors/${FUNDER}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const fp = await page.evaluate(() => {
      const f = document.querySelector("[data-testid=funder-panel]"), n = document.getElementById("dp-next");
      return { f: !!f, above: !!f && !!n && f.getBoundingClientRect().top < n.getBoundingClientRect().top };
    });
    ok(`§2 @${W} an organisation's funder panel is on its record, above "what do I do next"`, fp.f && fp.above, fp);
    ok(`§2 @${W} no page errors`, errs.length === 0, errs);
    await ctx.close();
  }
  await browser.close();
  await reset();
  await h.closeDb();
  done();
})().catch(e => { console.error(e); process.exit(1); });

function done() { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }

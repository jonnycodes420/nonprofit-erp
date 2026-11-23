// tests/gifts2-split-goal.test.js: GIFTS-2. A GIFT SPLIT ACROSS FUNDS, RECURRING
// GIVING YOU CAN FIND, A GOAL THAT CAN COUNT PLEDGES, TWO NAMES THAT MISLED.
// Guards money and donor data. One fresh org (made-up names), then:
//   §1 a $500 gift split $300 Food Pantry (restricted) / $200 General Operating
//      is one gift, one ledger row, one receipt; each fund's balance, its rows,
//      the person's restricted/unrestricted split and Reports' by-fund total
//      read the lines; lines that do not add up are refused (new and edit), and
//      an amount edit on a split gift must carry its lines; TRUTH-1's key line
//      "fund lines sum to gift" finds nothing to say.
//   §2 Recurring giving is a part of Fundraising's Money in and of Finance, global
//      search finds it by "recurring" and "monthly", and a profile with a plan
//      links to it.
//   §3 the org goal counts pledges only when it says so (off by default): off,
//      the card still says what is pledged; on, "Raised $2,000 + $1,000 pledged
//      = $3,000 committed" and pace reads committed. A campaign counts them by
//      default.
//   §4 the More menu says "Send a payment link" (and offers "Record a pledge");
//      "Preview as yourself" asks for "me", and the preview it draws changes.
// HOW IT GOES RED ON MAIN: no fundLines (the gift saves on one fund, §1); no
// Recurring part in Money in or Finance, no search entry (§2); no commitment on
// the goal (§3); "Request a gift" and no lib/previewAs.js (§4).
// PLANTED: linesRefusal accepting lines that do not add up (§1 red).
// Tests set their own clock (tests/clock.js). Sends nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { civilDay, dayOffset } = require("./clock");

const ORG = "org_gifts2split";
const PASSWORD = "loadtest1234";
const TODAY = civilDay(undefined, "America/New_York");
const C = v => Math.round(Number(v || 0) * 100);
const src = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,receipts_enabled,legal_name,ein)
           VALUES ($1,$2,$3,1,'active','team','America/New_York',true,$4,'12-3456789')`, [id, name, id.replace(/_/g, "-"), name + " Inc"]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Okafor','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
async function person(name) {
  const id = "d_gf2_" + Math.random().toString(16).slice(2, 12);
  await q(`INSERT INTO donors (id,org_id,name,kind,created_by,created_by_name) VALUES ($1,$2,$3,'individual','system:test','Test')`, [id, ORG, name]);
  return id;
}

(async () => {
  const tok = await freshOrg(ORG, "Gifts Two Test Collective");
  // Two funds: the org's default (General Operating, made by the ledger) and a restricted one.
  const funds0 = (await api("GET", "/finance/funds", tok)).body || [];
  let general = funds0.find(f => f.isOrgDefault);
  if (!general) {
    // The ledger (and its General Operating fund) is made by the first gift; this one is taken back.
    const seed = await api("POST", `/donors/${await person("Seed Person")}/gifts`, tok, { amount: 1, date: TODAY, payment_method: "check" });
    await api("DELETE", `/gifts/${seed.body.gift.id}`, tok);
    general = ((await api("GET", "/finance/funds", tok)).body || []).find(f => f.isOrgDefault);
  }
  const pantry = (await api("POST", "/finance/funds", tok, { name: "Food Pantry", restricted: true })).body;
  const pantryId = pantry && (pantry.id || (pantry.fund && pantry.fund.id));
  ok("setup: a default fund and a restricted fund", !!general && !!pantryId, { general, pantry });
  const balances = async () => {
    const r = (await api("GET", "/finance/funds-detail", tok)).body;
    return Object.fromEntries(((r && r.funds) || []).map(f => [f.id, f.balanceCents]));
  };
  const before = await balances();

  // ── §1 THE SPLIT ───────────────────────────────────────────────────────────
  const ada = await person("Ada Quillfeather");
  const bad = await api("POST", `/donors/${ada}/gifts`, tok, { amount: 500, date: TODAY, payment_method: "check",
    fundLines: [{ fundId: pantryId, amount: 300 }, { fundId: general.id, amount: 150 }] });
  ok("§1 lines that add up to $450 on a $500 gift are refused", bad.status === 400 && /must match/.test(bad.body.error || ""), bad.body);
  ok("§1 the refused split wrote no gift", Number((await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, ada]))[0].n) === 0);

  const made = await api("POST", `/donors/${ada}/gifts`, tok, { amount: 500, date: TODAY, payment_method: "check",
    fundLines: [{ fundId: pantryId, amount: 300 }, { fundId: general.id, amount: 200 }] });
  ok("§1 a $500 gift split $300/$200 saves", made.status === 201 && made.body.gift, made.body);
  const giftId = made.body.gift && made.body.gift.id;
  const gifts = await q(`SELECT id, amount, fund_id FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, ada]);
  const lines = await q(`SELECT fund_id, amount FROM gift_fund_lines WHERE org_id=$1 AND gift_id=$2 ORDER BY amount DESC`, [ORG, giftId]).catch(() => []);
  const ledger = await q(`SELECT amount, fund_id FROM fin_transactions WHERE org_id=$1 AND gift_id=$2`, [ORG, giftId]);
  ok("§1 one gift, two fund lines, one ledger row for $500", gifts.length === 1 && C(gifts[0].amount) === 50000 && lines.length === 2
    && C(lines[0].amount) === 30000 && C(lines[1].amount) === 20000 && ledger.length === 1 && C(ledger[0].amount) === 50000, { gifts, lines, ledger });
  ok("§1 the gift's own fund is its largest line", gifts[0] && gifts[0].fund_id === pantryId, gifts[0]);

  const after = await balances();
  ok("§1 Food Pantry's balance grew by $300, General Operating's by $200",
    after[pantryId] - (before[pantryId] || 0) === 30000 && after[general.id] - (before[general.id] || 0) === 20000, { before, after });
  const pRows = (await api("GET", `/finance/funds-detail/rows?fund=${pantryId}`, tok)).body;
  ok("§1 Food Pantry's balance opens one $300 row", pRows && pRows.count === 1 && pRows.netCents === 30000, pRows);
  const aff = (await api("GET", `/donors/${ada}/fund-affinity`, tok)).body;
  ok("§1 the person's split: $300 restricted + $200 unrestricted = $500", aff && C(aff.restrictedTotal) === 30000 && C(aff.unrestrictedTotal) === 20000, aff);
  const sum = (await api("GET", `/reports/annual?year=${TODAY.slice(0, 4)}&yearMode=calendar`, tok)).body;
  const byName = Object.fromEntries(((sum && sum.byFund) || []).map(f => [f.name, C(f.total)]));
  ok("§1 Reports by fund: Food Pantry $300, General Operating $200", byName["Food Pantry"] === 30000 && byName[general.name] === 20000, sum && sum.byFund);

  const rc = await api("POST", `/gifts/${giftId}/receipt`, tok, { send: false });
  const receipts = await q(`SELECT receipt_number FROM receipts WHERE org_id=$1 AND gift_id=$2 AND voided_at IS NULL`, [ORG, giftId]);
  ok("§1 one receipt for the split gift", (rc.status === 200 || rc.status === 201) && receipts.length === 1, { status: rc.status, receipts });

  const amtOnly = await api("PUT", `/gifts/${giftId}`, tok, { amount: 600 });
  ok("§1 an amount edit that leaves the lines at $500 is refused", amtOnly.status === 400 && amtOnly.body.code === "fund_lines", amtOnly.body);
  const editBad = await api("PUT", `/gifts/${giftId}`, tok, { amount: 600, fundLines: [{ fundId: pantryId, amount: 300 }, { fundId: general.id, amount: 200 }] });
  ok("§1 an edit whose lines do not add up is refused", editBad.status === 400, editBad.body);
  const edited = await api("PUT", `/gifts/${giftId}`, tok, { amount: 600, fundLines: [{ fundId: pantryId, amount: 450 }, { fundId: general.id, amount: 150 }] });
  const after2 = await balances();
  ok("§1 the edit moves both funds: Pantry +$450, General +$150 in all",
    edited.status === 200 && after2[pantryId] - (before[pantryId] || 0) === 45000 && after2[general.id] - (before[general.id] || 0) === 15000, { status: edited.status, after2 });
  const keyOff = await q(`SELECT g.id FROM gift_fund_lines l JOIN gifts g ON g.id=l.gift_id WHERE l.org_id=$1
                           GROUP BY g.id, g.amount HAVING SUM(ROUND(l.amount*100)) <> ROUND(g.amount*100)`, [ORG]);
  ok("§1 TRUTH-1's key: every gift's fund lines sum to the gift", keyOff.length === 0, keyOff);
  ok("§1 the key line is in the truth check", /GIFTS-2: a gift split across funds/.test(src("tests/lib/surfacesAgree.js")));

  // ── §2 RECURRING GIVING, FINDABLE ──────────────────────────────────────────
  const FR = await import("../client/src/lib/fundraisingSections.js");
  const moneyIn = FR.FR_SECTIONS.find(s => s.id === "moneyin");
  ok("§2 Fundraising → Money in has Recurring giving", !!moneyIn && moneyIn.parts.some(p => p.id === "recurring"), moneyIn && moneyIn.parts);
  ok("§2 an old link to recurring lands on it", FR.resolveFr("recurring").part === "recurring");
  const fin = src("client/src/components/Finance.jsx");
  ok("§2 Finance's nav has Recurring giving, and it draws the recurring view",
    /\{ id: "recurring", label: "Recurring giving" \}/.test(fin) && /subtab === "recurring" && <RecurringView/.test(fin));
  const top = src("client/src/components/TopBar.jsx");
  const nav = (top.match(/\{ id:"nav_recurring"[\s\S]*?go:nav=>nav\("fundraising",\{frSection:"recurring"\}\) \}/) || [""])[0];
  ok("§2 search finds Recurring giving by \"recurring\" and \"monthly\"", /keywords:"[^"]*\brecurring\b[^"]*\bmonthly\b/.test(nav), nav.slice(0, 200));
  ok("§2 a profile with a plan links to Recurring giving", /data-testid="dp-plan-recurring-link"/.test(src("client/src/components/profile/GivingTab.jsx"))
    && /tabHref\("fundraising",\{frSection:"recurring"\}\)/.test(src("client/src/components/profile/GivingTab.jsx")));

  // ── §3 THE GOAL CAN COUNT PLEDGES ──────────────────────────────────────────
  const from = dayOffset(-30), to = dayOffset(60);
  const bo = await person("Bo Thistlewood");
  await api("POST", `/donors/${bo}/gifts`, tok, { amount: 2000 - 600, date: TODAY, payment_method: "check" });   // $600 is Ada's, $2,000 in all
  const pl = await api("POST", `/donors/${bo}/pledges`, tok, { amount: 1000, dueDate: dayOffset(30), notes: "Spring pledge" });
  ok("§3 setup: a $1,000 pledge due inside the goal", pl.status === 201 || pl.status === 200, pl.body);
  const goal = await api("POST", "/goals", tok, { label: "Annual fund", goalAmount: 10000, goalType: "total_raised", periodStart: from, periodEnd: to });
  const goalId = goal.body && goal.body.id;
  const ov = async () => (await api("GET", "/fundraising/overview", tok)).body;
  let o = await ov();
  let cm = o && o.goal && o.goal.commitment;
  ok("§3 an annual goal does not count pledges by default, and still says what is pledged",
    cm && cm.countPledges === false && C(cm.raised) === 200000 && C(cm.pledged) === 100000 && /\$1,000 more is pledged, not counted/.test(cm.sentence), cm);
  const offPct = o && o.goal && o.goal.paceRaisedPct;
  const sw = await api("PUT", `/goals/goal/${goalId}/count-pledges`, tok, { on: true });
  ok("§3 an admin turns on Count pledges toward this goal", sw.status === 200, sw.body);
  o = await ov(); cm = o && o.goal && o.goal.commitment;
  ok("§3 on: Raised $2,000 + $1,000 pledged = $3,000 committed",
    cm && cm.countPledges === true && C(cm.committed) === 300000 && cm.sentence === "Raised $2,000 + $1,000 pledged = $3,000 committed", cm);
  ok("§3 on: pace reads committed (30% of the goal, not 20%), the bar stays raised",
    o.goal.paceRaisedPct === 30 && offPct === 20 && o.goal.percent === 20 && /% committed/.test(o.goal.paceSentence || ""), { offPct, on: o.goal.paceRaisedPct, percent: o.goal.percent, s: o.goal.paceSentence });
  const camp = await api("POST", "/fundraising/campaigns", tok, { name: "New Roof", goalAmount: 5000, startDate: from, endDate: to, type: "capital" });
  const campId = camp.body && (camp.body.id || (camp.body.campaign && camp.body.campaign.id));
  await api("POST", `/donors/${bo}/pledges`, tok, { amount: 700, dueDate: dayOffset(20), campaignId: campId });
  const rows = (await api("GET", "/fundraising/campaigns", tok)).body;
  const roof = (Array.isArray(rows) ? rows : (rows && rows.campaigns) || []).find(c => c.id === campId);
  ok("§3 a campaign counts its pledges by default", roof && roof.commitment && roof.commitment.countPledges === true && C(roof.commitment.pledged) === 70000, roof && roof.commitment);

  // ── §4 TWO NAMES THAT MISLED ───────────────────────────────────────────────
  const hdr = src("client/src/components/profile/ProfileHeader.jsx");
  ok("§4 the More menu says Send a payment link, and offers Record a pledge",
    /\["Send a payment link",/.test(hdr) && /\["Record a pledge",/.test(hdr) && !/\["Request a gift",/.test(hdr));
  const PA = await import("../client/src/lib/previewAs.js");
  ok("§4 Preview as yourself asks for \"me\"; nobody picked is the first recipient; a person is that person",
    PA.previewAsParam(null, "d_first") === "me" && PA.previewAsParam(undefined, "d_first") === "d_first" && PA.previewAsParam({ id: "d_x" }, "d_first") === "d_x");
  const blocks = [{ type: "header" }, { type: "richtext", blocks: [{ type: "p", text: "Dear {{first_name}}, thank you." }] }, { type: "footer" }];
  const asFirst = await api("POST", "/email-preview", tok, { blocks, subject: "Hello {{first_name}}", as: PA.previewAsParam(undefined, ada) });
  const asMe = await api("POST", "/email-preview", tok, { blocks, subject: "Hello {{first_name}}", as: PA.previewAsParam(null, ada) });
  ok("§4 Preview as yourself changes the preview",
    asFirst.status === 200 && asMe.status === 200 && asFirst.body.subject === "Hello Ada" && asMe.body.subject === "Hello Wren" && asFirst.body.html !== asMe.body.html,
    { first: asFirst.body && asFirst.body.as, me: asMe.body && asMe.body.as, s1: asFirst.status, s2: asMe.status, e: asFirst.body && asFirst.body.sentence });

  // ── §5 GIFTS-3: one gift form, pickers that pick, money in cents, the preview's form, Anonymous ──
  // RED ON MAIN: the edit route ignores an appeal; a typed campaign is stored as loose text
  // (no campaign_id) instead of refused; a blank method is stored as "Needs you"; a form set to
  // Steward's defaults previews as the page's old form; there is no Anonymous.
  // PLANTED (seen red, then reverted): resolveTypedCampaign answering { campaignId: null } for a
  // name with no match (the typed campaign dropped silently) turns "is refused, not dropped" red.
  const gp3 = await person("Odile Brannagh");
  const giftOf = async id => ((await api("GET", `/donors/${gp3}`, tok)).body.gifts || []).find(g => g.id === id);
  const g1 = await api("POST", `/donors/${gp3}/gifts`, tok, { amount: "123.45", date: TODAY, type: "cash", payment_method: "", notes: "" });
  const g1id = g1.body && g1.body.gift && g1.body.gift.id;
  const r1 = await giftOf(g1id);
  ok("§5 $123.45 is stored and read back as 123.45, to the cent", g1.status === 201 && r1 && C(r1.amount) === 12345 && String(r1.amount) === "123.45", { s: g1.status, a: r1 && r1.amount });
  ok("§5 a method left blank stores nothing (it reads Not set), never \"Needs you\"", r1 && r1.payment_method == null, r1 && r1.payment_method);
  const camp3 = await api("POST", "/gift-attribution/campaign", tok, { name: "Lantern Walk 2026" });
  const appeal = await api("POST", "/gift-attribution/appeal", tok, { name: "Lantern letter", campaignId: camp3.body.id });
  const e1 = await api("PUT", `/gifts/${g1id}`, tok, { amount: "123.45", campaignId: camp3.body.id, appealId: appeal.body.id, payment_method: "ach", anonymous: true });
  const r2 = await giftOf(g1id);
  ok("§5 an edit sets the gift's campaign and appeal, and they read back", e1.status === 200 && r2.campaign_id === camp3.body.id && r2.appeal_id === appeal.body.id && r2.campaign_name === "Lantern Walk 2026" && r2.appeal_name === "Lantern letter",
    { s: e1.status, e: e1.body && e1.body.error, c: r2 && r2.campaign_id, a: r2 && r2.appeal_id });
  ok("§5 the edit keeps $123.45 to the cent and the ledger row agrees", C(r2.amount) === 12345 &&
    C(((await q(`SELECT amount FROM fin_transactions WHERE gift_id=$1`, [g1id]))[0] || {}).amount) === 12345, r2.amount);
  ok("§5 ACH typed any way is the one method \"Bank transfer (ACH)\"", r2.payment_method === "Bank transfer (ACH)", r2.payment_method);
  ok("§5 the gift is Anonymous and still theirs", r2.anonymous === true && r2.donor_id === gp3, { an: r2.anonymous });
  const CPm = await import("../shared/campaignPage.js");
  ok("§5 an Anonymous gift is never named on a public list, whatever the donor ticked",
    CPm.publicGiftLine({ donorName: "Odile Brannagh", amountCents: 12345, showName: true, anonymous: true, date: TODAY }).who === "Anonymous"
    && CPm.publicGiftLine({ donorName: "Odile Brannagh", amountCents: 12345, showName: true, date: TODAY }).who === "Odile");
  const beforeG3 = (await q(`SELECT COUNT(*)::int n FROM gifts WHERE donor_id=$1`, [gp3]))[0].n;
  const typed = await api("POST", `/donors/${gp3}/gifts`, tok, { amount: "40", date: TODAY, type: "cash", campaign: "Spring" });
  const afterG3 = (await q(`SELECT COUNT(*)::int n FROM gifts WHERE donor_id=$1`, [gp3]))[0].n;
  ok("§5 a typed-not-picked campaign is refused, not dropped: \"No campaign called 'Spring'. Create it?\"",
    typed.status === 400 && typed.body.code === "campaign_not_found" && typed.body.error === "No campaign called 'Spring'. Create it?" && afterG3 === beforeG3,
    { s: typed.status, b: typed.body, beforeG3, afterG3 });
  const typedEdit = await api("PUT", `/gifts/${g1id}`, tok, { campaign: "Spring" });
  ok("§5 the edit refuses a typed campaign too, and the gift keeps its own", typedEdit.status === 400 && (await giftOf(g1id)).campaign_id === camp3.body.id, typedEdit.status);
  const named = await api("POST", `/donors/${gp3}/gifts`, tok, { amount: "40.50", date: TODAY, type: "cash", campaign: "lantern walk 2026" });
  ok("§5 a typed name that IS a campaign is that campaign, by id", named.status === 201 && named.body.gift.campaign_id === camp3.body.id, named.body && named.body.gift);
  // The preview draws the form she set, even when it equals the defaults.
  const page3 = await api("POST", "/giving-pages", tok, { title: "Lantern Walk page" });
  const pid = page3.body && (page3.body.id || (page3.body.page && page3.body.page.id));
  const setForm = await api("PUT", `/giving-pages/${pid}/page/settings`, tok, { settings: { formSet: true,
    form: { defaultFrequency: "once", offerMonthly: true, offerAnnual: false, amountsCents: [2500, 5000, 10000, 25000] } } });
  const pv = await api("GET", `/giving-pages/${pid}/page/preview`, tok);
  const pf = pv.body && pv.body.givingPage && pv.body.givingPage.form;
  ok("§5 the preview draws the drafted form: one-time first, no yearly, $25/$50/$100/$250",
    setForm.status === 200 && pf && pf.configured === true && pf.amount.defaultFrequency === "once" && !pf.amount.frequencies.includes("annual")
    && JSON.stringify(pf.amount.amountsCents) === JSON.stringify([2500, 5000, 10000, 25000]),
    { s: setForm.status, e: setForm.body && setForm.body.error, f: pf && { c: pf.configured, a: pf.amount } });

  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

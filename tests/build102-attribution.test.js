// BUILD-102 (Steward Give) Part 5 — THANK-YOU, RECEIPT AND ATTRIBUTION.
//
// The brief's own test: a gift made with UTM tags stores all three on the gift; the
// receipt is the same PDF a non-form gift gets; the campaign thermometer moves by
// exactly the gift's intended amount (net of any covered fee, the existing rule).
//
//   §1  the three tags, cleaned through ONE function, and the two deliberately
//       not stored;
//   §2  a tagged gift stores all three ON THE GIFT, and an untagged one stores
//       NULL — the difference a report has to be able to tell;
//   §3  the receipt is the SAME receipt, through the untouched issueGiftReceipt;
//   §4  the thermometer moves by the INTENDED amount, net of a covered fee, while
//       Reports keeps the CHARGED total — two honest numbers;
//   §5  the thank-you is the org's own words when they wrote any, and a redirect
//       is refused unless it is a real https address;
//   §6  a report answers "which email brought this in", and its groups SUM to the
//       gifts — including the ones that arrived untagged;
//   §7  the wall.
//
// Standard scratch stack; ports per WORKTREE-NOTES.md.

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const http = require("http");
const { ok, summary, login, api, q, closeDb, STRIPE_MOCK_PORT } = require("./helpers");

const ORG = "b102_utm", OTHER = "b102_utm2";
const ME = "b102utm@example.org", THEM = "b102utm-other@example.org";
const PW = "loadtest1234";

const CHILD = ["receipts", "custom_field_defs", "saved_reports", "fin_transactions", "interactions",
  "threads", "tasks", "thank_you_drafts", "workflow_runs", "gifts", "pledges", "giving_pages",
  "campaigns", "donors", "users", "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
// The EIN is assembled, never written down: the repo-wide rule forbids a
// tax-ID-shaped literal in source, and it is right to.
const einFor = id => `${20 + (id.length % 70)}-${String(4100000 + id.length * 911)}`;
const mkOrg = (id, slug, name) => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at,
                     stripe_account_id,stripe_connected,cover_fees_enabled,
                     legal_name,ein,receipt_address,receipts_enabled)
   VALUES ($1,$2,$3,1,'team','active','America/New_York',NOW(),$4,TRUE,TRUE,$5,$6,$7,TRUE)
   ON CONFLICT (id) DO UPDATE SET stripe_account_id=$4, stripe_connected=TRUE, receipts_enabled=TRUE`,
  [id, name, slug, "acct_" + id, name + ", Inc.", einFor(id), "1 Harbour Road, Portland, ME 04101"]);
const mkUser = (id, org, email, name) => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
  [id, org, email, bcrypt.hashSync(PW, 4), name]);
const cents = v => Math.round(Number(v) * 100);
const grossUp = base => Math.ceil((base + 30) / (1 - 0.029));
const settle = (ms = 500) => new Promise(r => setTimeout(r, ms));

function sig(payload) {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest")
    .update(`${t}.${payload}`).digest("hex")}`;
}
const fire = async ev => {
  const p = JSON.stringify(ev);
  return fetch(`${process.env.BASE || "http://localhost:5601"}/stripe/webhook`,
    { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": sig(p) }, body: p });
};
let seq = 0;
const pi = (acct, meta, amountCents) => ({
  id: "evt_utm_" + (++seq), type: "payment_intent.succeeded", account: acct,
  data: { object: { id: "pi_utm_" + seq, amount_received: amountCents, currency: "usd",
                    receipt_email: meta.donor_email, metadata: meta } },
});
const stripeCalls = [];
function startStripeMock(port = STRIPE_MOCK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        stripeCalls.push({ path: req.url, body: b });
        res.setHeader("Content-Type", "application/json");
        if (/^\/v1\/checkout\/sessions/.test(req.url)) {
          res.end(JSON.stringify({ id: "cs_utm", object: "checkout.session", url: "https://checkout.stripe.test/c/utm" }));
        } else res.end(JSON.stringify({ ok: true, id: "mock", data: [] }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
const lastCheckoutMeta = () => {
  for (let i = stripeCalls.length - 1; i >= 0; i--) {
    if (!/^\/v1\/checkout\/sessions/.test(stripeCalls[i].path)) continue;
    const out = {};
    for (const m of stripeCalls[i].body.matchAll(/metadata\[([^\]]+)\]=([^&]*)/g)) {
      out[m[1]] = decodeURIComponent(m[2].replace(/\+/g, " "));
    }
    return out;
  }
  return null;
};

(async () => {
  console.log("build102-attribution");
  await reset();
  await mkOrg(ORG, "b102-utm", "Harbor Music School");
  await mkOrg(OTHER, "b102-utm2", "Open Door Pantry");
  await mkUser("u_b102u", ORG, ME, "Allie Barnett");
  await mkUser("u_b102u2", OTHER, THEM, "Not Allie");
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_gen_u','${ORG}','General fund',false)
           ON CONFLICT (id) DO NOTHING`);
  const tok = await login(ME), tok2 = await login(THEM);
  const F = await import("../shared/formConfig.js");
  const smock = await startStripeMock();
  if (!smock) ok("fixture the Stripe mock bound (environment)", false, `port ${STRIPE_MOCK_PORT} busy`);

  const camp = await api("POST", "/fundraising/campaigns", tok, { name: "Spring Appeal 2026", goalAmount: 10000 });
  ok("fixture a goal'd campaign exists", camp.status === 200 || camp.status === 201, camp.body);
  const CAMP = camp.body.id || (camp.body.campaign && camp.body.campaign.id);
  const page = await api("POST", "/giving-pages", tok, { title: "Spring form", slug: "spring", campaignId: CAMP });
  const PAGE = page.body.id;
  const cfg = await api("PUT", `/giving-pages/${PAGE}/form`, tok, { config: {
    amountsCents: [cents(50), cents(100)], allowOther: true,
    thankYou: { message: "Thank you. Twelve children will have lessons this term because of you.",
                redirectUrl: "https://harbor.example.org/thank-you" },
  } });
  ok("fixture the form carries the org's own thank-you", cfg.status === 200, cfg.body);

  // ── §1 · THE THREE TAGS, ONE CLEANER ────────────────────────────────────
  console.log("\n— §1 · three, because three are what a report groups by —");
  ok("§1 three keys, named", F.UTM_KEYS.join(",") === "utm_source,utm_medium,utm_campaign", F.UTM_KEYS);
  ok("§1 utm_term and utm_content are deliberately NOT kept",
     !F.UTM_KEYS.includes("utm_term") && !F.UTM_KEYS.includes("utm_content"));
  ok("§1 a tag is kept as the sender wrote it, case and all",
     F.cleanUtm("Spring Appeal") === "Spring Appeal" && F.cleanUtm("Spring") !== F.cleanUtm("spring"));
  // A control character in a URL somebody else composed is stripped, not stored.
  const withCtl = "mail" + String.fromCharCode(7) + "chimp";
  ok("§1 control characters are stripped", F.cleanUtm(withCtl) === "mailchimp", JSON.stringify(F.cleanUtm(withCtl)));
  ok("§1 …and it is capped", F.cleanUtm("x".repeat(400)).length === F.UTM_MAX);
  ok("§1 nothing present means nothing stored, not an empty string",
     JSON.stringify(F.utmFrom({})) === "{}" && JSON.stringify(F.utmFrom({ utm_source: "  " })) === "{}");
  ok("§1 a term that was sent is ignored rather than stored",
     F.utmFrom({ utm_source: "x", utm_term: "y" }).utm_term === undefined);

  // ── §2 · STORED ON THE GIFT ─────────────────────────────────────────────
  console.log("\n— §2 · which email brought this gift in —");
  const tagged = await api("POST", `/donate/b102-utm`, null, {
    amount: 100, frequency: "once", givingPageId: PAGE,
    firstName: "Mabel", lastName: "Fenwick", email: "mabel.utm@example.org",
    utm: { utm_source: "mailchimp", utm_medium: "email", utm_campaign: "Spring Appeal 2026", utm_term: "ignored" },
  });
  ok("§2 the donation goes through", tagged.status === 200, tagged.body);
  const meta = lastCheckoutMeta();
  ok("§2 the three tags ride the Checkout metadata",
     meta.utm_source === "mailchimp" && meta.utm_medium === "email" && meta.utm_campaign === "Spring Appeal 2026",
     meta && { s: meta.utm_source, m: meta.utm_medium, c: meta.utm_campaign });
  ok("§2 …and the term does not", meta.utm_term === undefined,
     Object.keys(meta).filter(k => k.startsWith("utm")));
  await fire(pi("acct_" + ORG, { ...meta, donor_email: "mabel.utm@example.org", donor_name: "Mabel Fenwick",
                                 org_id: ORG, giving_page_id: PAGE }, cents(100)));
  await settle();
  const g1 = await q(`SELECT id, utm_source, utm_medium, utm_campaign FROM gifts WHERE org_id=$1`, [ORG]);
  ok("§2 one gift", g1.length === 1, g1.length);
  ok("§2 ALL THREE TAGS ARE ON THE GIFT",
     g1[0].utm_source === "mailchimp" && g1[0].utm_medium === "email"
     && g1[0].utm_campaign === "Spring Appeal 2026", g1[0]);
  // AN UNTAGGED GIFT STORES NULL, not "". A report has to tell "arrived with no
  // tags" from "arrived tagged as nothing", and a blank string cannot.
  await fire(pi("acct_" + ORG, { donor_email: "plain.utm@example.org", donor_name: "Plain Giver",
                                 org_id: ORG, giving_page_id: PAGE, campaign_id: CAMP,
                                 frequency: "once", fund_id: "" }, cents(40)));
  await settle();
  const plain = await q(`SELECT utm_source, utm_medium, utm_campaign FROM gifts WHERE org_id=$1 AND amount=40`, [ORG]);
  ok("§2 an untagged gift stores NULL on all three",
     plain.length === 1 && plain[0].utm_source === null && plain[0].utm_medium === null
     && plain[0].utm_campaign === null, plain[0]);

  // ── §3 · THE SAME RECEIPT ───────────────────────────────────────────────
  console.log("\n— §3 · a form gift's receipt is a gift's receipt —");
  const receipts = await q(
    `SELECT r.id, r.type, r.receipt_number, r.pdf_data IS NOT NULL AS haspdf, r.gift_id
       FROM receipts r WHERE r.org_id=$1 ORDER BY r.created_at`, [ORG]);
  ok("§3 the form gift got a receipt", receipts.length >= 1, receipts.length);
  const formReceipt = receipts.find(r => r.gift_id === g1[0].id);
  ok("§3 …for the right gift", !!formReceipt, receipts.map(r => r.gift_id));
  ok("§3 …of type gift, with a real PDF",
     !!formReceipt && formReceipt.type === "gift" && formReceipt.haspdf === true, formReceipt);
  ok("§3 …numbered from the org's own counter",
     /^\d{4}-\d{5}$/.test(String(formReceipt && formReceipt.receipt_number)),
     formReceipt && formReceipt.receipt_number);
  // ONE PATH, NOT TWO: a hand-logged gift receipts through the same route and
  // produces a receipt of the same shape.
  const donorRow = await q(`SELECT id FROM donors WHERE org_id=$1 AND email=$2`, [ORG, "mabel.utm@example.org"]);
  const manual = await api("POST", `/donors/${donorRow[0].id}/gifts`, tok,
    { amount: 60, date: new Date().toISOString().slice(0, 10), fundId: "f_gen_u" });
  ok("§3 a hand-logged gift is accepted", manual.status === 201 || manual.status === 200, manual.body);
  const manualReceipt = await api("POST", `/gifts/${manual.body.gift.id}/receipt`, tok, {});
  ok("§3 …and receipts through the SAME route",
     manualReceipt.status === 200 || manualReceipt.status === 201, manualReceipt.body);
  const both = await q(`SELECT type, pdf_data IS NOT NULL AS haspdf, gift_id FROM receipts WHERE org_id=$1`, [ORG]);
  ok("§3 every receipt is the same KIND, whichever door its gift came in",
     both.length >= 2 && both.every(r => r.type === "gift" && r.haspdf === true), both);
  ok("§3 …and the hand-logged gift's receipt is among them",
     both.some(r => r.gift_id === manual.body.gift.id), both.map(r => r.gift_id));
  // ONE NUMBERING SEQUENCE, so a form gift and a cheque cannot be issued the same
  // receipt number — which is the thing a numbering guarantee is actually for.
  const nums = await q(`SELECT receipt_number FROM receipts WHERE org_id=$1`, [ORG]);
  ok("§3 …and every receipt number is distinct",
     new Set(nums.map(r => r.receipt_number)).size === nums.length, nums.map(r => r.receipt_number));

  // ── §4 · THE THERMOMETER ────────────────────────────────────────────────
  console.log("\n— §4 · the goal moves by what the donor intended —");
  const covered = cents(200);
  const charged = grossUp(covered);
  await fire(pi("acct_" + ORG, { donor_email: "cover.utm@example.org", donor_name: "Cover Giver",
                                 org_id: ORG, giving_page_id: PAGE, frequency: "once", fund_id: "",
                                 campaign_id: CAMP,
                                 cover_fees: "true", base_amount_cents: String(covered),
                                 utm_source: "newsletter", utm_medium: "email",
                                 utm_campaign: "Spring Appeal 2026" }, charged));
  await settle();
  const cg = await q(`SELECT amount, cover_fee_amount FROM gifts WHERE org_id=$1 AND cover_fee_amount > 0`, [ORG]);
  ok("§4 the CHARGED amount is what the gift records",
     cg.length === 1 && Math.round(Number(cg[0].amount) * 100) === charged, [cg[0], charged]);
  ok("§4 …and the fee the donor added sits beside it",
     Math.round(Number(cg[0].cover_fee_amount) * 100) === charged - covered, cg[0]);
  // THE EXISTING RULE, ASSERTED: goal progress counts what the donor intended for
  // the mission, so the thermometer sees amount − cover_fee_amount.
  const overview = await api("GET", "/fundraising/overview", tok, null);
  const thisCamp = (overview.body.goals || []).find(x => x.id === CAMP) || {};
  const intendedTotal = cents(100) + cents(40) + covered;
  ok("§4 the thermometer moved by the INTENDED amounts, net of the covered fee",
     Math.round(Number(thisCamp.raised || 0) * 100) === intendedTotal,
     [Math.round(Number(thisCamp.raised || 0) * 100), intendedTotal]);
  const summaryR = await api("GET",
    "/reports/giving-summary?year=" + new Date().getFullYear() + "&yearMode=calendar", tok, null);
  const chargedTotal = cents(100) + cents(40) + charged + cents(60);
  ok("§4 Reports shows the CHARGED total, which is a different honest number",
     Math.round(Number(summaryR.body.total || 0) * 100) === chargedTotal,
     [Math.round(Number(summaryR.body.total || 0) * 100), chargedTotal]);

  // ── §5 · THE THANK-YOU ──────────────────────────────────────────────────
  console.log("\n— §5 · the org's own words, and a redirect that has to be real —");
  const t1 = F.thankYouText({ thankYou: { message: "Twelve children will have lessons." } }, { orgName: "Harbor" });
  ok("§5 the org's words are used as written",
     t1.message === "Twelve children will have lessons." && t1.fromTheOrg === true, t1);
  const t2 = F.thankYouText({}, { orgName: "Harbor Music School" });
  ok("§5 with nothing written, the fallback says a receipt is coming",
     t2.fromTheOrg === false && /receipt is on its way/.test(t2.message), t2);
  for (const [url, why] of [["http://x.example.org", "plain http"],
                            ["javascript:alert(1)", "a javascript: URL"],
                            ["//evil.test", "a protocol-relative URL"],
                            ["https://user:pw@x.example.org", "credentials in it"]]) {
    const v = await api("PUT", `/giving-pages/${PAGE}/form`, tok,
      { config: { thankYou: { message: "", redirectUrl: url } } });
    ok(`§5 a redirect that is ${why} is refused`, v.status === 400, [url, v.status, v.body && v.body.error]);
  }
  const good = await api("PUT", `/giving-pages/${PAGE}/form`, tok, { config: {
    amountsCents: [cents(50), cents(100)], allowOther: true,
    thankYou: { message: "Thank you. Twelve children will have lessons this term because of you.",
                redirectUrl: "https://harbor.example.org/thank-you" } } });
  ok("§5 a real https address is kept", good.status === 200
     && good.body.config.thankYou.redirectUrl === "https://harbor.example.org/thank-you",
     good.body.config && good.body.config.thankYou);
  const pub = await api("GET", `/org/b102-utm/giving-page/spring/public`, null, null);
  ok("§5 the public page carries it, so the screen reads the org's words",
     /Twelve children/.test(pub.body.givingPage.form.thankYou.message), pub.body.givingPage.form.thankYou);

  // ── §6 · THE REPORT THAT ANSWERS THE QUESTION ───────────────────────────
  console.log("\n— §6 · which email brought this in, and the groups have to foot —");
  const RB = await import("../shared/reportBuilder.js");
  ok("§6 the gifts entity offers the three tags",
     ["utm_source", "utm_medium", "utm_campaign"].every(k => !!RB.ENTITIES.gifts.fields[k]),
     Object.keys(RB.ENTITIES.gifts.fields));
  ok("§6 …and every gifts field still compiles with no ? in the SQL", (() => {
    const bad = [];
    for (const f of Object.keys(RB.ENTITIES.gifts.fields)) {
      const def = RB.ENTITIES.gifts.fields[f].groupOnly
        ? { entity: "gifts", columns: [], groupBy: f } : { entity: "gifts", columns: [f] };
      const c = RB.compile(def, { orgId: ORG });
      if (c.errors && c.errors.length) bad.push(f + ": " + c.errors.join(";"));
      else if (/\?/.test(c.sql)) bad.push(f + ": a ? survived");
    }
    return bad.length ? bad : true;
  })() === true, "see above");
  const bySource = await api("POST", "/report-builder/run", tok,
    { definition: { entity: "gifts", columns: [], groupBy: "utm_source" } });
  ok("§6 a report groups the gifts by link source", bySource.status === 200, bySource.body);
  const rows = bySource.body.rows || [];
  // A grouped row is { group, count, s0 } — `s0` being the first summed column.
  // Read off the returned COLUMNS rather than guessed at, so a change to the
  // builder's shape fails here loudly instead of silently summing zero (which is
  // exactly what my first version did).
  const moneyKey = ((bySource.body.columns || []).find(c => c.type === "money") || {}).key;
  ok("§6 the grouped report has a money column", !!moneyKey, bySource.body.columns);
  const groupTotal = rows.reduce((s, r) => s + Math.round(Number(r[moneyKey] || 0) * 100), 0);
  ok("§6 mailchimp and newsletter each have a row",
     rows.some(r => r.group === "mailchimp") && rows.some(r => r.group === "newsletter"),
     rows.map(r => r.group));
  // THE UNTAGGED GIFTS NEED A ROW, or the groups quietly total less than the gifts.
  ok("§6 …and the untagged gifts have their own row rather than vanishing",
     rows.some(r => r.group === "(not tagged)"), rows.map(r => r.group));
  const allGifts = await q(`SELECT COALESCE(SUM(amount),0) AS t FROM gifts WHERE org_id=$1`, [ORG]);
  ok("§6 THE GROUPS SUM TO EVERY GIFT, in cents",
     groupTotal === Math.round(Number(allGifts[0].t) * 100),
     [groupTotal, Math.round(Number(allGifts[0].t) * 100)]);
  const std = await api("GET", "/saved-reports", tok, null);
  ok("§6 the question ships as a standard report nobody has to build",
     (std.body.standard || []).some(r => r.id === "std:gifts-by-link-source"),
     (std.body.standard || []).map(r => r.id));

  // ── §7 · THE WALL ───────────────────────────────────────────────────────
  console.log("\n— §7 · a tag is org data —");
  const bGifts = await q(`SELECT COUNT(*)::int AS c FROM gifts WHERE org_id=$1`, [OTHER]);
  ok("§7 org B has no gifts from org A's form", bGifts[0].c === 0, bGifts[0]);
  const crossRun = await api("POST", "/report-builder/run", tok2,
    { definition: { entity: "gifts", columns: ["donor", "amount", "utm_source"] } });
  ok("§7 org B's own report sees none of org A's tags",
     crossRun.status === 200 && !/mailchimp|newsletter/.test(JSON.stringify(crossRun.body.rows || [])),
     crossRun.body.rows);

  if (smock) smock.close();
  if (!process.env.KEEP) await reset();
  await closeDb();
  summary();
})();

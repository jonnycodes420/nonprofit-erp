// server/admin/sales/quotes.js · SALES-3 Part A. A PRICE IN WRITING, SIGNED, AND BILLING ON A DATE.
//
// A quote is a version on a deal: the plan (from Sales settings' plans, editable), add-ons, a
// monthly price (a reason is required below list), the day billing starts (Jan 1 2027 by
// default), an optional setup fee and the term. "Copy link" makes a private page for it: a long
// random token of which only the hash is kept (the link is shown once). The page shows that
// quote and nothing else, and it stops working after acceptance or 30 days.
//
// Accepting it (typed name, title, a tick, the time and the IP) is the one place a quote
// writes outside sales_: on the linked Steward org it adds the signature ONBOARD-1 keeps
// (start_signatures, so Settings → Billing shows what she signed), asks ONBOARD-2's paper gate
// (signature AND card, startComplete.stampPaperDone; the rule is not loosened here), and
// schedules the Stripe subscription with trial_end at the start day, so no charge happens
// before it. The setup fee waits for that same first invoice. Nothing is emailed by Steward.
//
// THE PLANTED DEFECTS (SALES3_PLANT on the server, TEST_MODE=1, tests only):
//   noreason    a quote below list saves without a reason                       → §1
//   otherquote  a link opens the newest sent quote, whatever its token          → §2
//   chargeearly the subscription is made without trial_end (it bills today)     → §3
"use strict";
const crypto = require("crypto");
const { newId } = require("../../shared/newId");
const PRICING = require("../../../pricing");

const PLANT = process.env.TEST_MODE === "1" ? process.env.SALES3_PLANT || "" : "";
const DAY = 86400000;
const LINK_DAYS = 30;
const MIN_LEAD_DAYS = 3;   // Stripe refuses a trial_end under 48 hours out; a start that close can't be kept
const DEFAULT_START = "2027-01-01";
const TERMS = { month_to_month: "Month to month", twelve_months: "Twelve months, then month to month" };
const ACTOR = { id: "system:sales/quote-link", name: "Quote link" };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const hash = t => crypto.createHash("sha256").update("quote:" + String(t)).digest("hex");
const sha256 = s => crypto.createHash("sha256").update(String(s), "utf8").digest("hex");
const usd = c => "$" + (Number(c) / 100).toLocaleString("en-US", { minimumFractionDigits: Number(c) % 100 ? 2 : 0, maximumFractionDigits: 2 });
const dayWords = d => (d && DATE_RE.test(String(d).slice(0, 10)) ? `${MONTHS[Number(String(d).slice(5, 7)) - 1]} ${Number(String(d).slice(8, 10))}, ${String(d).slice(0, 4)}` : "");
const civil = (t, tz = "America/New_York") => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
const toCents = v => { if (v === "" || v == null) return null; const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };

// ── The plans a quote can name (Sales settings → Plans) ─────────────────────
function tierOr(id) { return PRICING.TIERS.find(t => t.id === id) || PRICING.TIERS.find(t => t.featured) || PRICING.TIERS[0]; }
function defaultPlans() {
  const bundle = tierOr("r2500"), small = tierOr("r500");
  return {
    plans: [
      { key: "bundle", name: "Steward, everything included", tier: bundle.id, listCents: bundle.monthlyUsd * 100,
        includes: ["The CRM: every donor, gift and household, with the next move for each", "Fundraising: giving pages, appeals, receipts and year-end statements",
          "Volunteers", "Atlas, the helper that drafts the next step for you to review", "Unlimited users, and no fee on any gift"] },
      { key: "crm", name: "CRM alone", tier: small.id, listCents: small.monthlyUsd * 100,
        includes: ["The CRM: every donor, gift and household, with the next move for each", "Atlas, the helper that drafts the next step for you to review", "Unlimited users"] },
    ],
    addons: [],
  };
}
const keyOf = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
function cleanPlans(v) {
  if (!v || typeof v !== "object") return defaultPlans();
  const tiers = new Set(PRICING.TIERS.map(t => t.id));
  const one = p => {
    const name = String(p && p.name || "").trim().slice(0, 120);
    const cents = Math.round(Number(p && p.listCents));
    if (!name || !Number.isFinite(cents) || cents < 0) return null;
    return { key: keyOf(p.key || name) || "plan", name, listCents: cents, ...(p.tier !== undefined ? { tier: tiers.has(p.tier) ? p.tier : tierOr().id } : {}),
      includes: (Array.isArray(p.includes) ? p.includes : String(p.includes || "").split("\n")).map(x => String(x).trim()).filter(Boolean).slice(0, 20) };
  };
  const plans = (Array.isArray(v.plans) ? v.plans : []).map(p => one({ tier: tierOr().id, ...p })).filter(Boolean).slice(0, 12);
  const addons = (Array.isArray(v.addons) ? v.addons : []).map(p => { const a = one(p); if (a) delete a.tier; return a; }).filter(Boolean).slice(0, 20);
  return plans.length ? { plans, addons } : defaultPlans();
}
async function plansOf(query) {
  const [r] = await query(`SELECT value FROM sales_settings WHERE key = 'plans'`);
  return cleanPlans(r ? r.value : null);
}

// ── Validate what Jonathan typed ────────────────────────────────────────────
// b: { plan, addons: [key], price (dollars) | price_cents, reason, start_on, setup_fee, term }
function validate(b, catalog, today) {
  const plan = catalog.plans.find(p => p.key === String(b.plan || ""));
  if (!plan) return { error: "invalid", field: "plan", message: `Pick a plan: ${catalog.plans.map(p => p.name).join(", ")}.` };
  const keys = [...new Set((Array.isArray(b.addons) ? b.addons : []).map(String))];
  const addons = keys.map(k => catalog.addons.find(a => a.key === k));
  if (addons.some(a => !a)) return { error: "invalid", field: "addons", message: "An add-on it names isn't in Sales settings." };
  const listCents = plan.listCents + addons.reduce((n, a) => n + a.listCents, 0);
  const price = b.price_cents != null ? Math.round(Number(b.price_cents)) : toCents(b.price);
  const priceCents = price == null ? listCents : price;
  if (!Number.isFinite(priceCents) || priceCents < 0) return { error: "invalid", field: "price", message: "The monthly price is an amount, like 250." };
  const reason = String(b.reason || "").replace(/\s+/g, " ").trim().slice(0, 300) || null;
  if (priceCents < listCents && !reason && PLANT !== "noreason")
    return { error: "invalid", field: "reason", message: `${usd(priceCents)} is below the list price of ${usd(listCents)}. Say why (for example "family pricing" or "beta").` };
  const startOn = String(b.start_on || DEFAULT_START).slice(0, 10);
  if (!DATE_RE.test(startOn) || Number.isNaN(Date.parse(startOn + "T12:00:00Z"))) return { error: "invalid", field: "start_on", message: "Billing starts on a day, like 2027-01-01." };
  if (daysBetween(today, startOn) < MIN_LEAD_DAYS) return { error: "invalid", field: "start_on", message: `Billing must start at least ${MIN_LEAD_DAYS} days from today, so Stripe can hold the date.` };
  const setup = toCents(b.setup_fee);
  const setupCents = setup == null ? 0 : setup;
  if (!Number.isFinite(setupCents) || setupCents < 0) return { error: "invalid", field: "setup_fee", message: "The setup fee is an amount, or leave it empty." };
  const term = TERMS[b.term] ? b.term : "month_to_month";
  return { ok: true, plan, addons, listCents, priceCents, reason: priceCents < listCents ? reason : null, startOn, setupCents, term };
}

// ── What the page shows and the signer agrees to ────────────────────────────
// Rendered once, when the link is made, and kept: the hash she signs is of these bytes.
function renderText(q, orgName, agreement) {
  const lines = [
    `# Steward quote for ${orgName}`,
    `Quote version ${q.version}. This page is for ${orgName} only.`,
    `## What you get`,
    `**${q.plan_name}**`,
    ...(q.includes || []).map(x => `- ${x}`),
    ...((q.addons || []).length ? [`Add-ons: ${q.addons.map(a => a.name).join(", ")}.`] : []),
    `## Price and dates`,
    `**${usd(q.price_cents)} a month.** ${q.price_cents < q.list_cents ? `This is the price agreed with Steward for ${orgName} (the list price is ${usd(q.list_cents)}).` : "This is the list price."}`,
    `**Billing starts ${dayWords(q.start_on)}.** Nothing is charged before that day, whether or not you add a card today.`,
    q.setup_fee_cents > 0 ? `**Setup fee: ${usd(q.setup_fee_cents)}, once,** charged with the first monthly charge on ${dayWords(q.start_on)}, not before.` : "There is no setup fee.",
    `**Term: ${TERMS[q.term] || TERMS.month_to_month}.** Cancel before ${dayWords(q.start_on)} in Settings → Billing and you pay nothing.`,
    `Where this quote and the agreement below differ on the price, the day billing starts or when the setup fee is charged, this quote governs.`,
    `---`,
    agreement.text,
  ];
  return lines.join("\n\n");
}

// Where a quote stands for its link. Expired is read from the clock, never stored.
function linkState(q, now) {
  if (!q) return "missing";
  if (q.status === "superseded") return "superseded";
  if (q.status === "accepted") return "accepted";
  if (q.status === "draft") return "draft";
  if (q.status !== "sent" || !q.expires_at || new Date(q.expires_at).getTime() <= now) return "expired";
  return "open";
}

const COLS = `id, deal_id, version, plan_key, plan_name, tier_id, addons, includes, list_cents, price_cents, below_list_reason, start_on::text AS start_on,
  setup_fee_cents, term, status, link_made_at, expires_at, steward_org_id, org_name, accepted_at, signer_name, signer_title, signer_email,
  agreement_version, text_sha256, card_saved_at, card_brand, card_last4, stripe_subscription_id, billing_scheduled_at, billing_starts_at, billing_error,
  created_at, created_by_name`;

async function forDeal(query, dealId) {
  return query(`SELECT ${COLS} FROM sales_quotes WHERE deal_id = ? ORDER BY version DESC`, [dealId]);
}

// The deal's primary organization, and the Steward org it is linked to (if any).
async function dealOrg(query, dealId) {
  const [o] = await query(`SELECT o.id, o.name, o.steward_org_id FROM sales_links l JOIN sales_orgs o ON o.id = l.b_id AND o.deleted_at IS NULL
                            WHERE l.a_type = 'deal' AND l.a_id = ? AND l.b_type = 'org' ORDER BY l.is_primary DESC, l.created_at LIMIT 1`, [dealId]);
  return o || null;
}
async function dealContactEmail(query, dealId) {
  const [c] = await query(`SELECT c.emails FROM sales_links l JOIN sales_contacts c ON c.id = l.b_id AND c.deleted_at IS NULL
                            WHERE l.a_type = 'deal' AND l.a_id = ? AND l.b_type = 'contact' ORDER BY l.is_primary DESC, l.created_at LIMIT 1`, [dealId]);
  return (c && (c.emails || [])[0]) || null;
}

// ── Save a version ──────────────────────────────────────────────────────────
async function save(ctx, dealId, b, who, now = Date.now()) {
  const [deal] = await ctx.query(`SELECT id, name FROM sales_deals WHERE id = ? AND deleted_at IS NULL`, [dealId]);
  if (!deal) return { error: "not_found" };
  const done = await ctx.query(`SELECT version FROM sales_quotes WHERE deal_id = ? AND status = 'accepted' LIMIT 1`, [dealId]);
  if (done.length) return { error: "invalid", message: `Version ${done[0].version} is accepted and billing is set from it. Change the price in the Steward org's Billing instead.` };
  const v = validate(b, await plansOf(ctx.query), civil(now));
  if (v.error) return v;
  const [{ n }] = await ctx.query(`SELECT COALESCE(MAX(version), 0) + 1 AS n FROM sales_quotes WHERE deal_id = ?`, [dealId]);
  // A new version retires the open ones: their links stop working.
  await ctx.run(`UPDATE sales_quotes SET status = 'superseded', updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE deal_id = ? AND status IN ('draft', 'sent')`, [who.id, who.name, dealId]);
  const id = newId("squ");
  await ctx.run(`INSERT INTO sales_quotes (id, deal_id, version, plan_key, plan_name, tier_id, addons, includes, list_cents, price_cents, below_list_reason,
                   start_on, setup_fee_cents, term, status, created_by, created_by_name, updated_by, updated_by_name)
                 VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    [id, dealId, Number(n), v.plan.key, v.plan.name, v.plan.tier || null, JSON.stringify(v.addons.map(a => ({ key: a.key, name: a.name, listCents: a.listCents }))),
     JSON.stringify([...v.plan.includes, ...v.addons.flatMap(a => a.includes)]), v.listCents, v.priceCents, v.reason, v.startOn, v.setupCents, v.term,
     who.id, who.name, who.id, who.name]);
  return { ok: true, id, version: Number(n) };
}

// ── Copy link: make (or remake) the private link for the newest open version ─
async function makeLink(ctx, quoteId, who, now = Date.now()) {
  const [q] = await ctx.query(`SELECT ${COLS} FROM sales_quotes WHERE id = ?`, [quoteId]);
  if (!q) return { error: "not_found" };
  if (q.status === "accepted") return { error: "invalid", message: "This quote is accepted; its link has done its job." };
  if (q.status === "superseded") return { error: "invalid", message: "A newer version of this quote exists. Copy that one's link." };
  if (daysBetween(civil(now), q.start_on) < MIN_LEAD_DAYS) return { error: "invalid", message: "Billing would start too soon to hold the date. Save a new version with a later start." };
  const org = await dealOrg(ctx.query, q.deal_id);
  const [deal] = await ctx.query(`SELECT name FROM sales_deals WHERE id = ?`, [q.deal_id]);
  const orgName = (org && org.name) || (deal && deal.name) || "your organization";
  const agreement = require("../../../customerAgreement").agreement();
  if (!agreement.ok) return { error: "invalid", message: agreement.message };
  const text = renderText({ ...q, addons: q.addons || [], includes: q.includes || [] }, orgName, agreement);
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(now + LINK_DAYS * DAY).toISOString();
  await ctx.run(`UPDATE sales_quotes SET status = 'sent', token_hash = ?, link_made_at = ?, expires_at = ?, org_name = ?, rendered_text = ?, text_sha256 = ?,
                   agreement_version = ?, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ? AND status IN ('draft', 'sent')`,
    [hash(token), new Date(now).toISOString(), expires, orgName, text, sha256(text), agreement.version, who.id, who.name, q.id]);
  return { ok: true, id: q.id, token, path: `/quote/${token}`, expiresAt: expires,
    says: `Copy it now: Steward keeps only a fingerprint, so this link can't be shown again. It works for ${LINK_DAYS} days or until it is accepted. Making a new link turns this one off. Steward sends nothing; you send it.` };
}

async function byToken(query, token) {
  if (!TOKEN_RE.test(String(token || ""))) return null;
  if (PLANT === "otherquote") return (await query(`SELECT ${COLS}, rendered_text FROM sales_quotes WHERE status = 'sent' ORDER BY link_made_at DESC LIMIT 1`))[0] || null;
  const [q] = await query(`SELECT ${COLS}, rendered_text FROM sales_quotes WHERE token_hash = ?`, [hash(token)]);
  return q || null;
}

const GONE = {
  missing: "This quote link doesn't exist. Ask Jonathan for a new one.",
  expired: "This quote has expired. Quotes last 30 days; ask Jonathan for a new one.",
  superseded: "This quote was replaced by a newer one. Use the latest link Jonathan sent.",
};

// The page's read: this quote and nothing else. After acceptance, only the confirmation and the card step.
async function publicRead(query, token, now = Date.now()) {
  const q = await byToken(query, token);
  const state = linkState(q, now);
  if (GONE[state]) return { state, gone: true, message: GONE[state] };
  const out = { ok: true, state, orgName: q.org_name, version: q.version };
  if (state === "accepted") {
    return { ...out, confirmation: confirmation(q), cardSaved: !!q.card_saved_at, card: q.card_last4 ? `${q.card_brand || "Card"} ending ${q.card_last4}` : null,
      canAddCard: !!q.steward_org_id && !q.card_saved_at && !!q.stripe_subscription_id };
  }
  return { ...out, plan: q.plan_name, includes: q.includes || [], addons: (q.addons || []).map(a => a.name), priceCents: q.price_cents, listCents: q.list_cents,
    startOn: q.start_on, startWords: dayWords(q.start_on), setupFeeCents: q.setup_fee_cents, term: TERMS[q.term] || TERMS.month_to_month,
    expiresAt: q.expires_at, agreement: { text: q.rendered_text, sha256: q.text_sha256, version: q.agreement_version } };
}
function confirmation(q) {
  return `Signed by ${q.signer_name}${q.signer_title ? `, ${q.signer_title}` : ""}. Nothing is charged today. Billing starts ${dayWords(q.start_on)} at ${usd(q.price_cents)} a month${q.setup_fee_cents > 0 ? `, with the ${usd(q.setup_fee_cents)} setup fee on that first charge` : ""}.`;
}

// ── Accept and sign ─────────────────────────────────────────────────────────
// b: { name, title, agree: true, sha256 }. `req` gives the IP and the browser.
async function accept(ctx, token, b, reqInfo, billing, now = Date.now()) {
  const q = await byToken(ctx.query, token);
  const state = linkState(q, now);
  if (GONE[state]) return { error: "gone", state, message: GONE[state] };
  if (state === "accepted") return { error: "gone", state, message: "This quote is already signed." };
  const name = String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const title = String(b.title || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (name.length < 2) return { error: "invalid", field: "name", message: "Type your full name to sign." };
  if (!title) return { error: "invalid", field: "title", message: "Type your title." };
  if (b.agree !== true) return { error: "invalid", field: "agree", message: "Tick the box to agree." };
  if (String(b.sha256 || "") !== q.text_sha256) return { error: "changed", message: "This quote changed since you opened it. Reload the page, read it again and sign." };
  const email = (await dealContactEmail(ctx.query, q.deal_id)) || "";
  const org = await dealOrg(ctx.query, q.deal_id);
  const stewardOrgId = (org && org.steward_org_id) || null;
  // Single use: the UPDATE claims the quote, so two tabs can't both sign.
  const claimed = await ctx.query(`UPDATE sales_quotes SET status = 'accepted', accepted_at = ?, signer_name = ?, signer_title = ?, signer_email = ?, signer_ip = ?, signer_ua = ?,
                                     steward_org_id = ?, updated_at = NOW(), updated_by = ?, updated_by_name = ?
                                   WHERE id = ? AND status = 'sent' AND expires_at > ? RETURNING id`,
    [new Date(now).toISOString(), name, title, email, reqInfo.ip || null, reqInfo.ua || null, stewardOrgId, ACTOR.id, name, q.id, new Date(now).toISOString()]);
  if (!claimed.length) return { error: "gone", state: "accepted", message: "This quote is already signed." };
  const signed = { ...q, status: "accepted", accepted_at: new Date(now).toISOString(), signer_name: name, signer_title: title, signer_email: email, steward_org_id: stewardOrgId };
  const who = { id: ACTOR.id, name: `${name} (quote link)` };

  // The signed agreement as a PDF, kept on the quote (the deal's) and, below, as the org's signature.
  const pdf = await require("../../onboard/agreementPdf").render({ rendered_text: q.rendered_text, signed_at: signed.accepted_at, signer_name: name, signer_title: title,
    signer_email: email || "no email on the deal", agreement_version: q.agreement_version, text_sha256: q.text_sha256 });
  await ctx.run(`UPDATE sales_quotes SET pdf = ? WHERE id = ?`, [pdf, q.id]);

  // The deal: its value follows the accepted quote, and it moves to Verbal yes (Trial with a linked org).
  await ctx.run(`UPDATE sales_deals SET value_cents = ?, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ?`, [q.price_cents, who.id, who.name, q.deal_id]);
  await moveDeal(ctx, q.deal_id, stewardOrgId ? "trial" : "verbal", who);
  await require("./activities").create(ctx, { kind: "note", at: signed.accepted_at, records: [{ type: "deal", id: q.deal_id }],
    body: `Quote version ${q.version} accepted: ${name} (${title}) signed. ${usd(q.price_cents)} a month from ${dayWords(q.start_on)}${q.setup_fee_cents > 0 ? `, setup fee ${usd(q.setup_fee_cents)} on the first charge` : ""}.` }, who);

  let billingResult = { skipped: "No Steward org is linked to this deal's organization, so nothing is scheduled. Link it, then schedule billing from the deal." };
  if (stewardOrgId) {
    await signOnOrg(ctx, signed, stewardOrgId);
    billingResult = await scheduleBilling(ctx, signed, billing);
  } else {
    await ctx.run(`UPDATE sales_quotes SET billing_error = ? WHERE id = ?`, [billingResult.skipped, q.id]);
  }
  return { ok: true, id: q.id, confirmation: confirmation(signed), canAddCard: !!(stewardOrgId && billingResult.ok), billing: billingResult };
}

// Verbal yes, or Trial when a Steward org is linked; never backwards.
async function moveDeal(ctx, dealId, target, who) {
  const [d] = await ctx.query(`SELECT d.pipeline_id, s.position, s.kind FROM sales_deals d LEFT JOIN sales_stages s ON s.id = d.stage_id WHERE d.id = ?`, [dealId]);
  if (!d) return;
  const stages = await ctx.query(`SELECT id, name, position, kind, onboarding FROM sales_stages WHERE pipeline_id = ? ORDER BY position`, [d.pipeline_id]);
  const want = target === "trial" ? /^trial$/i : /^verbal yes$/i;
  const onboard = stages.filter(s => s.onboarding && s.kind === "open");
  const st = stages.find(s => want.test(String(s.name).trim())) || (target === "trial" ? onboard[1] || onboard[0] : onboard[0]);
  if (!st) return;
  if (d.kind === "won" || (d.kind === "open" && d.position != null && Number(d.position) >= Number(st.position))) return;
  await require("./records").setStage(ctx, dealId, st.id, who);
}

// The signature on the Steward org (ONBOARD-1's table, append-only), then the paper gate.
async function signOnOrg(ctx, q, orgId) {
  const [o] = await ctx.query(`SELECT id, timezone FROM orgs WHERE id = ?`, [orgId]);
  if (!o) return;
  const startAt = startInstant(q.start_on, o.timezone);
  await ctx.run(`INSERT INTO start_signatures (id, org_id, start_link_id, signer_name, signer_title, signer_email, signed_at, ip, user_agent,
                   agreement_version, text_sha256, rendered_text, price_cents, first_charge_at, created_by, created_by_name)
                 SELECT ?, ?, ?, ?, ?, ?, accepted_at, signer_ip, signer_ua, ?, ?, rendered_text, ?, ?, ?, ? FROM sales_quotes WHERE id = ?
                 ON CONFLICT DO NOTHING`,
    [newId("sig"), orgId, q.id, q.signer_name, q.signer_title, q.signer_email || "", q.agreement_version, q.text_sha256, q.price_cents, startAt.toISOString(),
     ACTOR.id, q.signer_name, q.id]);
  await stampPaper(orgId);
}
async function stampPaper(orgId) {
  try { await require("../../onboard/startComplete").stampPaperDone(orgId); }
  catch (e) { console.error("[sales-quote] paper gate not asked:", e.message); }
}

// Noon on the start day in the org's own zone (Jan 1 must read as Jan 1 in Kentucky).
function startInstant(day, tz) {
  return require("../../onboard/startLink").firstChargeAt({ charge_mode: "fixed", first_charge_on: day }, 0, tz || "America/New_York");
}

// ── Billing: a subscription that starts on the start day, and not before ────
async function scheduleBilling(ctx, q, billing) {
  const fail = async message => { await ctx.run(`UPDATE sales_quotes SET billing_error = ? WHERE id = ?`, [message, q.id]); return { error: "billing", message }; };
  const b = (billing && billing()) || {};
  const stripe = b.billingStripe;
  if (!stripe) return fail("Signed, but billing could not be scheduled: platform billing isn't configured here.");
  const col = b.billingCustomerColumn ? b.billingCustomerColumn() : "stripe_customer_id";
  const [o] = await ctx.query(`SELECT id, name, plan, timezone, stripe_subscription_id, subscription_status, ${col} AS customer FROM orgs WHERE id = ?`, [q.steward_org_id]);
  if (!o) return fail("Signed, but the linked Steward org no longer exists.");
  if (o.stripe_subscription_id && !["canceled", "cancelled", "incomplete_expired"].includes(o.subscription_status || ""))
    return fail(`Signed, but ${o.name} already has a Stripe subscription (${o.subscription_status || "unknown"}). Change its price in Billing; nothing new was scheduled.`);
  const tier = PRICING.tierById(q.tier_id || "") || tierOr();
  const priceId = process.env[tier.envMonthly];
  if (!priceId) return fail(`Signed, but no Stripe price is configured for ${tier.name} (${tier.envMonthly}), so billing isn't scheduled yet.`);
  const startAt = startInstant(q.start_on, o.timezone);
  if (startAt.getTime() < Date.now() + 2 * DAY) return fail("Signed, but the start day is under 48 hours away; Stripe can't hold it. Schedule it by hand in Billing.");
  try {
    let customer = o.customer;
    if (!customer) {
      const c = await stripe.customers.create({ name: o.name, ...(q.signer_email ? { email: q.signer_email } : {}), metadata: { orgId: o.id } });
      customer = c.id;
      await ctx.run(`UPDATE orgs SET ${col} = ? WHERE id = ? AND ${col} IS NULL`, [customer, o.id]);
    }
    const p = await stripe.prices.retrieve(priceId);
    const product = typeof p.product === "string" ? p.product : p.product.id;
    const plan = `${tier.id}_monthly`;
    const metadata = { salesQuoteId: q.id, orgId: o.id, plan };
    const params = {
      customer, metadata, proration_behavior: "none",
      items: [{ price_data: { currency: "usd", product, unit_amount: q.price_cents, recurring: { interval: "month" } } }],
      // THE RULE: the first charge is the start day. Stripe makes a $0 invoice today and the first real one then.
      trial_end: Math.floor(startAt.getTime() / 1000),
      trial_settings: { end_behavior: { missing_payment_method: "create_invoice" } },
    };
    if (PLANT === "chargeearly") { delete params.trial_end; delete params.trial_settings; }
    const sub = await stripe.subscriptions.create(params, { idempotencyKey: `sales-quote-sub-${q.id}` });
    // The setup fee rides the subscription's NEXT invoice, the one on the start day: an item made
    // after the subscription, tied to it, so the $0 trial invoice can't sweep it up today.
    if (q.setup_fee_cents > 0) {
      await stripe.invoiceItems.create({ customer, subscription: sub.id, currency: "usd", amount: q.setup_fee_cents, description: "Steward setup fee",
        metadata: { salesQuoteId: q.id, orgId: o.id } }, { idempotencyKey: `sales-quote-setup-${q.id}` });
    }
    const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : startAt.toISOString();
    await ctx.run(`UPDATE orgs SET plan = ?, subscription_status = ?, trial_ends_at = ?, stripe_subscription_id = ?, grace_until = NULL,
                     custom_price_cents = ?, signed_at = COALESCE(signed_at, NOW()) WHERE id = ?`,
      [plan, sub.status || "trialing", trialEnd, sub.id, q.price_cents !== tier.monthlyUsd * 100 ? q.price_cents : null, o.id]);
    await ctx.run(`UPDATE sales_quotes SET stripe_subscription_id = ?, billing_scheduled_at = NOW(), billing_starts_at = ?, billing_error = NULL WHERE id = ?`, [sub.id, trialEnd, q.id]);
    return { ok: true, subscriptionId: sub.id, startsAt: trialEnd };
  } catch (e) {
    return fail(`Signed, but Stripe refused the subscription: ${String(e && e.message || e).slice(0, 300)}`);
  }
}

// ── The card step: Stripe Checkout in setup mode (a SetupIntent; nothing is charged) ──
async function cardStart(ctx, token, billing, now = Date.now()) {
  const q = await byToken(ctx.query, token);
  if (linkState(q, now) !== "accepted") return { error: "gone", message: "Sign the quote first." };
  if (q.card_saved_at) return { error: "invalid", message: "A card is already saved." };
  if (!q.steward_org_id || !q.stripe_subscription_id) return { error: "invalid", message: "Jonathan will set up the card step with you." };
  const b = (billing && billing()) || {};
  if (!b.billingStripe) return { error: "unavailable", message: "The card step isn't available right now. Jonathan will help you add one." };
  const col = b.billingCustomerColumn ? b.billingCustomerColumn() : "stripe_customer_id";
  const [o] = await ctx.query(`SELECT ${col} AS customer FROM orgs WHERE id = ?`, [q.steward_org_id]);
  if (!o || !o.customer) return { error: "invalid", message: "Jonathan will set up the card step with you." };
  const back = `${b.publicAppUrl ? b.publicAppUrl() : ""}/quote/${token}`;
  const metadata = { salesQuoteId: q.id, orgId: q.steward_org_id };
  const session = await b.billingStripe.checkout.sessions.create({
    mode: "setup", customer: o.customer, payment_method_types: ["card"], metadata, setup_intent_data: { metadata },
    success_url: `${back}?card=done&session_id={CHECKOUT_SESSION_ID}`, cancel_url: back,
  });
  await ctx.run(`UPDATE sales_quotes SET stripe_session_id = ? WHERE id = ?`, [session.id, q.id]);
  return { ok: true, url: session.url };
}

// Stripe says the card went in (the webhook, or the page's own POST on return). Idempotent.
async function cardSaved(ctx, session, billing) {
  const quoteId = session && session.metadata && session.metadata.salesQuoteId;
  if (!quoteId || session.mode !== "setup") return null;
  const [q] = await ctx.query(`SELECT id, steward_org_id, stripe_subscription_id, card_saved_at FROM sales_quotes WHERE id = ?`, [quoteId]);
  if (!q || !q.steward_org_id || (session.metadata.orgId && session.metadata.orgId !== q.steward_org_id)) return null;
  if (q.card_saved_at) return q.steward_org_id;
  const stripe = ((billing && billing()) || {}).billingStripe;
  let card = null, pmId = null;
  if (stripe && session.setup_intent) {
    try {
      const si = await stripe.setupIntents.retrieve(typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent.id, { expand: ["payment_method"] });
      const pm = si.payment_method;
      pmId = pm && (typeof pm === "string" ? pm : pm.id);
      if (pm && pm.card) card = { brand: pm.card.brand || null, last4: pm.card.last4 || null };
      const customer = typeof session.customer === "string" ? session.customer : session.customer && session.customer.id;
      if (pmId && customer) await stripe.customers.update(customer, { invoice_settings: { default_payment_method: pmId } });
      if (pmId && q.stripe_subscription_id) await stripe.subscriptions.update(q.stripe_subscription_id, { default_payment_method: pmId });
    } catch (e) { console.error("[sales-quote] card read failed:", e.message); }
  }
  await ctx.run(`UPDATE orgs SET billing_card_saved_at = COALESCE(billing_card_saved_at, NOW()), billing_card_brand = COALESCE(?, billing_card_brand),
                   billing_card_last4 = COALESCE(?, billing_card_last4) WHERE id = ?`, [card && card.brand, card && card.last4, q.steward_org_id]);
  await ctx.run(`UPDATE sales_quotes SET card_saved_at = NOW(), card_brand = ?, card_last4 = ? WHERE id = ? AND card_saved_at IS NULL`, [card && card.brand, card && card.last4, q.id]);
  await stampPaper(q.steward_org_id);
  return q.steward_org_id;
}

// ── Today and the forecast ──────────────────────────────────────────────────
const BILLING_SOON_DAYS = 14, UNSIGNED_DAYS = 5;
async function todayFacts(query) {
  return query(`SELECT q.id, q.deal_id, q.version, q.status, q.price_cents, q.start_on::text AS start_on, q.link_made_at, q.expires_at, q.accepted_at, d.name AS deal_name
                  FROM sales_quotes q JOIN sales_deals d ON d.id = q.deal_id AND d.deleted_at IS NULL
                 WHERE q.status IN ('sent', 'accepted')`);
}
function todayLines(rows, now, tz = "America/New_York") {
  const today = civil(now, tz);
  const open = r => ({ type: "deal", id: r.deal_id, name: r.deal_name });
  const billingStarts = rows.filter(r => r.status === "accepted" && r.start_on >= today && daysBetween(today, r.start_on) <= BILLING_SOON_DAYS)
    .map(r => { const n = daysBetween(today, r.start_on); return { on: r.start_on, days: n, says: `${r.deal_name}: billing starts ${n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`} (${usd(r.price_cents)} a month)`, open: open(r) }; })
    .sort((a, b) => a.on.localeCompare(b.on));
  const quoteUnsigned = rows.filter(r => r.status === "sent" && r.link_made_at && new Date(r.expires_at).getTime() > now && daysBetween(civil(r.link_made_at, tz), today) >= UNSIGNED_DAYS)
    .map(r => { const n = daysBetween(civil(r.link_made_at, tz), today); return { on: civil(r.link_made_at, tz), days: n, says: `${r.deal_name}: quote sent ${n} days ago, not signed`, open: open(r) }; })
    .sort((a, b) => b.days - a.days);
  return { billingStarts, quoteUnsigned, sentences: {
    billingStarts: `Signed quotes whose billing starts in the next ${BILLING_SOON_DAYS} days. Nothing is charged before that day.`,
    quoteUnsigned: `Quote links made ${UNSIGNED_DAYS} days ago or more, still open and not signed.`,
  } };
}
// The forecast's input: each deal's accepted quote (price and start day).
async function acceptedByDeal(query) {
  const rows = await query(`SELECT deal_id, price_cents, start_on::text AS start_on FROM sales_quotes WHERE status = 'accepted'`);
  return new Map(rows.map(r => [r.deal_id, { priceCents: Number(r.price_cents), startOn: r.start_on }]));
}

module.exports = { PLANT, TERMS, DEFAULT_START, LINK_DAYS, defaultPlans, cleanPlans, plansOf, validate, renderText, linkState, forDeal, save, makeLink,
  publicRead, accept, cardStart, cardSaved, scheduleBilling, todayFacts, todayLines, acceptedByDeal, usd, dayWords, hash };

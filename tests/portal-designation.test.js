// BUILD-55 Part 3 — the portal funds widget's designation + order contract.
// Run: node tests/portal-designation.test.js  (local scratch stack — see tests/README.md)
//
// Pins three fixes:
//   • Fix 10 — each Programs & funds card's Give link carries ITS OWN fund
//     (?fund=<id>), the giving page preselects it, and a completed online
//     gift lands with gifts.fund_id = that fund (the webhook previously
//     DROPPED metadata.fund_id — every online gift landed undesignated and
//     the ledger stamp routed to the org's first unrestricted fund).
//   • Fix 11 — the funds widget renders in the WIDGET's fundIds order (the
//     org's manual sort), never alphabetical/DB order.
//   • Fix 12 — the editor's impact widget shows the org's REAL published
//     updates; the public page resolution stays org-wide-published-only.

const fs = require("fs");
const path = require("path");
const stripe = require("stripe")("sk_test_dummy");
const { BASE, ok, summary, q, closeDb } = require("./helpers");

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const A = "org_b55d_a", B = "org_b55d_b";
const ACCT_A = "acct_b55d_a";
const bcrypt = require("bcryptjs");

const CHILD_TABLES = [
  "portal_pages", "portal_settings", "impact_updates", "workflow_runs", "workflows",
  "digest_sends", "tasks", "fin_transactions", "gifts", "interactions", "donors",
  "accounts", "fin_funds", "receipts", "notification_sends",
];
async function wipe(org) {
  for (const t of CHILD_TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM users WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
}
async function seedOrg(org, slug, acct) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id,receipts_enabled)
           VALUES ($1,$2,$3,1,'active','growth',$4,false)`, [org, "B55D " + slug, slug, acct]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Admin','admin')`,
    [`u_${org}`, org, `${slug}@b55d.local`, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ($1,$2,'4010','Contributions','revenue',true)`, [`acc_${org}`, org]);
}
async function login(slug) {
  const r = await fetch(BASE + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${slug}@b55d.local`, password: "loadtest1234" }),
  });
  const j = await r.json();
  if (!j.token) throw new Error("login failed: " + JSON.stringify(j));
  return j.token;
}
const api = async (method, p, token, body) => {
  const r = await fetch(BASE + p, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
async function fireWebhook(evtId, piId, amountCents, email, name, extraMeta = {}) {
  const payload = JSON.stringify({
    id: evtId, type: "payment_intent.succeeded", account: ACCT_A,
    data: { object: { id: piId, amount_received: amountCents, receipt_email: email, metadata: { donor_name: name, ...extraMeta } } },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

(async () => {
  await wipe(A); await wipe(B);
  await seedOrg(A, "b55d-a", ACCT_A);
  await seedOrg(B, "b55d-b", null);
  // Funds named so ALPHABETICAL order (Gala first) differs from the manual
  // order we publish (General Operating leads) — the exact reported bug.
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES
           ('ff_b55d_gala',$1,'Gala Reserve',true),
           ('ff_b55d_gen',$1,'General Operating',false),
           ('ff_b55d_youth',$1,'Youth Fund',true)`, [A]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_b55d_foreign',$1,'Foreign Fund',false)`, [B]);
  const tok = await login("b55d-a");

  console.log("— fix 11: manual fund order, editor draft → published resolution —");
  const MANUAL_ORDER = ["ff_b55d_gen", "ff_b55d_youth", "ff_b55d_gala"];
  const draft = await api("PUT", "/portal-page/draft", tok, {
    widgets: [{ type: "funds", heading: "Where you can give", fundIds: MANUAL_ORDER }],
  });
  ok("draft saved", draft.status === 200, draft.body);
  const pub = await api("POST", "/portal-page/publish", tok, {});
  ok("published", pub.status === 200, pub.body);
  await api("PUT", "/portal-settings", tok, { enabled: true });
  const cfg = await api("GET", `/portal/b55d-a/config`, null);
  ok("public config carries the page", cfg.status === 200 && Array.isArray(cfg.body?.page?.widgets), cfg.body);
  const fw = (cfg.body.page.widgets || []).find(w => w.type === "funds");
  ok("funds widget resolved", !!fw && Array.isArray(fw.funds), fw);
  ok("cards render in the MANUAL order — General Operating leads, not alphabetical Gala",
    JSON.stringify((fw?.funds || []).map(f => f.id)) === JSON.stringify(MANUAL_ORDER), fw?.funds);
  ok("every card carries a DISTINCT fund id (the per-card designation)",
    new Set((fw?.funds || []).map(f => f.id)).size === 3, fw?.funds);

  console.log("\n— fix 10: an online gift from a fund link lands DESIGNATED —");
  const w1 = await fireWebhook("evt_b55d_1", "pi_b55d_1", 5000, "donor1@b55d.local", "Designated Donor", { fund_id: "ff_b55d_youth" });
  ok("webhook accepted", w1.status === 200, w1.body);
  const [g1] = await q(`SELECT id, fund_id, amount FROM gifts WHERE org_id=$1 AND stripe_payment_id='pi_b55d_1'`, [A]);
  ok("gift row carries the designated fund", g1?.fund_id === "ff_b55d_youth", g1);
  const [t1] = await q(`SELECT fund_id FROM fin_transactions WHERE gift_id=$1`, [g1?.id || "none"]);
  ok("ledger stamp routes to the SAME fund (not first-unrestricted)", t1?.fund_id === "ff_b55d_youth", t1);

  // No designation → unchanged legacy behavior (first unrestricted fund on the stamp, NULL on the gift).
  const w2 = await fireWebhook("evt_b55d_2", "pi_b55d_2", 3000, "donor2@b55d.local", "Plain Donor");
  ok("undesignated webhook accepted", w2.status === 200, w2.body);
  const [g2] = await q(`SELECT id, fund_id FROM gifts WHERE org_id=$1 AND stripe_payment_id='pi_b55d_2'`, [A]);
  ok("undesignated gift stays fund-less", g2 && g2.fund_id == null, g2);
  const [t2] = await q(`SELECT fund_id FROM fin_transactions WHERE gift_id=$1`, [g2?.id || "none"]);
  ok("undesignated stamp keeps the legacy first-unrestricted routing", t2?.fund_id === "ff_b55d_gen", t2);

  // A fund id the org doesn't own (or garbage) never lands — validated, not trusted.
  const w3 = await fireWebhook("evt_b55d_3", "pi_b55d_3", 2000, "donor3@b55d.local", "Foreign Fund Donor", { fund_id: "ff_b55d_foreign" });
  ok("foreign-fund webhook accepted", w3.status === 200, w3.body);
  const [g3] = await q(`SELECT fund_id FROM gifts WHERE org_id=$1 AND stripe_payment_id='pi_b55d_3'`, [A]);
  ok("another org's fund id is rejected → undesignated, never cross-org", g3 && g3.fund_id == null, g3);

  console.log("\n— fix 10: the client chain (source contract) —");
  const widgetsSrc = fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", "PortalWidgets.jsx"), "utf8");
  ok("funds card Give href carries its own fund (?fund=<id>)",
    /\/give\/\$\{ctx\.giveSlug\}\?fund=\$\{encodeURIComponent\(f\.id\)\}/.test(widgetsSrc));
  const donateSrc = fs.readFileSync(path.join(__dirname, "..", "client", "src", "pages", "Donate.jsx"), "utf8");
  ok("giving page preselects ?fund= (validated against the org's exposed funds)",
    /params\.get\("fund"\)/.test(donateSrc) && /d\.funds \|\| \[\]\)\.some\(f => f\.id === qFund\)/.test(donateSrc));
  ok("a page-level fund still wins over ?fund=", /!d\.givingPage\?\.fundId/.test(donateSrc));

  console.log("\n— fix 11: editor mirrors the manual order (source contract) —");
  const editorSrc = fs.readFileSync(path.join(__dirname, "..", "client", "src", "pages", "PortalEditor.jsx"), "utf8");
  ok("editor resolves funds in fundIds order",
    /\(w\.fundIds \|\| \[\]\)\.map\(id => funds\.find\(f => f\.id === id\)\)\.filter\(Boolean\)/.test(editorSrc));
  ok("options panel has the reorder controls", /moveFund/.test(editorSrc) && /Funds — in display order/.test(editorSrc));

  console.log("\n— fix 12: real published updates in the editor; org-wide-only in public —");
  await api("POST", "/impact-updates", tok, { title: "Org-wide update", body: "Real update", photos: [], targets: [], orgWide: true, status: "published" });
  await api("POST", "/impact-updates", tok, { title: "Draft update", body: "Not yet", photos: [], targets: [], orgWide: true, status: "draft" });
  const cfg2 = await api("GET", `/portal/b55d-a/config`, null);
  const iw = (cfg2.body?.page?.widgets || []).find(w => w.type === "impact");
  // The published page has no impact widget in this fixture; assert via a fresh draft+publish.
  await api("PUT", "/portal-page/draft", tok, {
    widgets: [{ type: "funds", heading: "Where you can give", fundIds: MANUAL_ORDER }, { type: "impact", heading: "What your giving made possible" }],
  });
  await api("POST", "/portal-page/publish", tok, {});
  const cfg3 = await api("GET", `/portal/b55d-a/config`, null);
  const iw3 = (cfg3.body?.page?.widgets || []).find(w => w.type === "impact");
  ok("public impact resolution: published org-wide only (no draft)",
    Array.isArray(iw3?.updates) && iw3.updates.length === 1 && iw3.updates[0].title === "Org-wide update", iw3?.updates);
  void iw;
  ok("editor fetches the org's real updates (/impact-updates, published only)",
    /apiFetch\("\/impact-updates"\)/.test(editorSrc) && /status === "published"/.test(editorSrc));
  ok("editor's sample impact entry is a FALLBACK, not the default",
    /impactUpdates\.length \? impactUpdates : SAMPLE_IMPACT/.test(editorSrc));
  ok("widget precedence: donor matches first, resolved org-wide otherwise",
    /ctx\.me\?\.impact\?\.length\) \? ctx\.me\.impact : \(w\.updates \|\| \[\]\)/.test(widgetsSrc));

  await wipe(A); await wipe(B);
  await closeDb?.();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

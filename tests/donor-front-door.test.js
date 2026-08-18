// BUILD-49 — the donor front door: /giving as a real landing page + the
// network_listed-gated entry points on every donor-touching surface.
//
// The invariants under test:
//   1. GATING — every entry point (receipt cover email, year-end statement
//      email + PDF snapshot, public donate payload) appears for a LISTED org
//      (portal enabled + network_listed) and NEVER for an unlisted org.
//   2. LINKS — entry links carry from=<the correct org slug> and, where the
//      donor's email is verified-in-context (it received the email), the
//      fragment email-prefill convention. NO PII ever rides a query string —
//      donor identifiers live in the URL FRAGMENT only.
//   3. SIGN-IN LINK — the /giving password-free alternate: request → one
//      emailed 15-min single-use token → session; replay 400s; re-request
//      supersedes; unknown email gets the identical response and no email;
//      an unverified account gets its verification email, never a sign-in
//      bypass.
//   4. CLIENT WIRING (source guards) — signed-out /giving renders the landing
//      (signed-in renders the dashboard), the signin route + link-verify are
//      wired, the thank-you screen + Settings snippet are gated, and the SEO
//      entry (giving.html + vercel rewrite before the SPA catch-all) exists.
//
// Standard scratch stack (DONOR_ACCOUNTS_ENABLED=1). Own mail sink on :5602.

const fs = require("fs");
const http = require("http");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const YEAR = new Date().getFullYear();
const L = { id: "org_dfd_l", slug: "dfd-listed", name: "Front Door Listed" };
const U = { id: "org_dfd_u", slug: "dfd-unlisted", name: "Front Door Unlisted" };
const DONOR_L = { id: "d_dfd_l", email: "dfd.listed.donor@dfd49.test" };
const DONOR_U = { id: "d_dfd_u", email: "dfd.unlisted.donor@dfd49.test" };
const ACCT_EMAIL = "dfd.account@dfd49.test";
const ACCT_UNVERIFIED = "dfd.unverified@dfd49.test";

let mail = [];
function startSink(port = 5602) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => { try { mail.push(JSON.parse(b)); } catch { } res.setHeader("Content-Type", "application/json"); res.end('{"id":"sunk"}'); });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
const mailTo = (to) => mail.filter(m => m.to === to || (Array.isArray(m.to) && m.to.includes(to)));
const settle = (ms = 600) => new Promise(r => setTimeout(r, ms));

async function raw(method, path, { cookie, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { Cookie: `steward_portal=${encodeURIComponent(cookie)}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch { }
  return { status: r.status, text, body: parsed, headers: r.headers };
}
const cookieOf = (res) => {
  const m = (res.headers?.get("set-cookie") || "").match(/steward_portal=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

async function fixture() {
  await q(`DELETE FROM donor_accounts WHERE email LIKE '%@dfd49.test'`);
  await q(`DELETE FROM donor_account_audit WHERE email LIKE '%@dfd49.test'`).catch(() => {});
  for (const o of [L, U]) {
    for (const t of ["receipts", "fin_transactions", "gifts", "interactions", "tasks", "notification_sends",
      "portal_audit_log", "portal_sessions", "giving_pages"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o.id]).catch(() => {});
    await q(`DELETE FROM portal_settings WHERE org_id=$1`, [o.id]).catch(() => {});
    for (const t of ["donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o.id]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o.id]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  for (const o of [L, U]) {
    await q(
      `INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,
         receipts_enabled,legal_name,ein,receipt_address)
       VALUES ($1,$2,$3,1,'active','team',true,$2,'11-1114949','1 Front Door Way, Fairhope, AL 36532')`,
      [o.id, o.name, o.slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'DFD Admin','admin')`,
      [`u_${o.id}`, o.id, `admin@${o.slug}.test.local`, hash]);
  }
  // The gate under test: L is listed, U has a live portal but is NOT listed.
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed) VALUES ($1,true,true)`, [L.id]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed) VALUES ($1,true,false)`, [U.id]);
  for (const [o, d] of [[L, DONOR_L], [U, DONOR_U]]) {
    await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,last_gift_date,status,stage)
             VALUES ($1,$2,'Front Door Donor',$3,300,2,'${YEAR}-03-15','mid','steward')`, [d.id, o.id, d.email]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ($1,$2,$3,120,'${YEAR}-02-01','cash','')`, [`g_${d.id}_1`, o.id, d.id]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ($1,$2,$3,180,'${YEAR}-03-15','cash','')`, [`g_${d.id}_2`, o.id, d.id]);
  }
  // A giving page on the listed org for the page-level public payload check.
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,status) VALUES ('gp_dfd_l',$1,'spring','Spring Page','active')`, [L.id]);
  // Donor accounts: one verified (sign-in link), one unverified (bypass check).
  await q(`INSERT INTO donor_accounts (id,email,password_hash,email_verified_at) VALUES ('da_dfd_1',$1,$2,NOW())`,
    [ACCT_EMAIL, bcrypt.hashSync("frontdoor1234", 12)]);
  await q(`INSERT INTO donor_accounts (id,email,password_hash) VALUES ('da_dfd_2',$1,$2)`,
    [ACCT_UNVERIFIED, bcrypt.hashSync("frontdoor1234", 12)]);
}

(async () => {
  const sink = await startSink();
  await fixture();

  const tokL = await login(`admin@${L.slug}.test.local`);
  const tokU = await login(`admin@${U.slug}.test.local`);

  // ── 1. Receipt cover email — present for listed, absent for unlisted ──────
  console.log("\n— entry point (a): receipt confirmation email —");
  mail = [];
  const rcL = await api("POST", `/gifts/g_${DONOR_L.id}_2/receipt`, tokL);
  ok("listed org: receipt issued + emailed", rcL.status === 201 && rcL.body?.sent_to === DONOR_L.email, { status: rcL.status, sent_to: rcL.body?.sent_to });
  await settle();
  const covL = mailTo(DONOR_L.email).find(m => /receipt/i.test(m.subject || ""));
  ok("listed cover email captured", !!covL);
  const linkMatch = /(https?:\/\/[^"']+\/giving#[^"']+)/.exec(covL?.html || "");
  ok("footer carries a /giving entry link", !!linkMatch, (covL?.html || "").slice(-400));
  const entryUrl = linkMatch ? linkMatch[1] : "";
  ok("link opens signup mode", /#signup&/.test(entryUrl), entryUrl);
  ok("link carries the CORRECT org slug (from=dfd-listed)", entryUrl.includes(`from=${L.slug}`), entryUrl);
  ok("link prefills the verified-in-context email (fragment convention)",
    entryUrl.includes(`email=${encodeURIComponent(DONOR_L.email)}`), entryUrl);
  ok("NO PII in the query string — no '?' before the fragment", !entryUrl.split("#")[0].includes("?"), entryUrl);

  mail = [];
  const rcU = await api("POST", `/gifts/g_${DONOR_U.id}_2/receipt`, tokU);
  ok("unlisted org: receipt still issues + emails normally", rcU.status === 201 && rcU.body?.sent_to === DONOR_U.email, { status: rcU.status, sent_to: rcU.body?.sent_to });
  await settle();
  const covU = mailTo(DONOR_U.email).find(m => /receipt/i.test(m.subject || ""));
  ok("unlisted cover email captured", !!covU);
  ok("unlisted cover email has NO /giving entry link", !/\/giving#/.test(covU?.html || ""), (covU?.html || "").slice(-300));

  // ── 2. Year-end statement — email footer + PDF snapshot stamp ─────────────
  console.log("\n— entry point (b): year-end statement email + PDF —");
  mail = [];
  const yeL = await api("POST", `/donors/${DONOR_L.id}/year-end-statement`, tokL, { year: YEAR, send: true });
  ok("listed year-end issued + emailed", yeL.status === 201 && yeL.body?.sent_to === DONOR_L.email, { status: yeL.status, sent_to: yeL.body?.sent_to });
  await settle();
  const stL = mailTo(DONOR_L.email).find(m => /statement/i.test(m.subject || ""));
  ok("listed statement email carries the /giving entry link with the slug",
    !!stL && stL.html.includes(`from=${L.slug}`) && /\/giving#signup&/.test(stL.html));
  const [snapL] = await q(`SELECT snapshot FROM receipts WHERE org_id=$1 AND type='year_end' AND voided_at IS NULL`, [L.id]);
  const sL = typeof snapL.snapshot === "string" ? JSON.parse(snapL.snapshot) : snapL.snapshot;
  // BUILD-65 Part 5: the account CTA LEFT the PDF (a document handed to an
  // accountant should not carry a marketing link). It stays in the cover EMAIL
  // above. The snapshot no longer stamps givingAccountUrl at all.
  ok("listed PDF snapshot carries NO giving-account CTA (left the PDF)",
    sL.givingAccountUrl == null && sL.givingAccountDisplay == null, { url: sL.givingAccountUrl, display: sL.givingAccountDisplay });

  mail = [];
  const yeU = await api("POST", `/donors/${DONOR_U.id}/year-end-statement`, tokU, { year: YEAR, send: true });
  ok("unlisted year-end issued + emailed", yeU.status === 201 && yeU.body?.sent_to === DONOR_U.email, { status: yeU.status, sent_to: yeU.body?.sent_to });
  await settle();
  const stU = mailTo(DONOR_U.email).find(m => /statement/i.test(m.subject || ""));
  ok("unlisted statement email has NO /giving link", !!stU && !/\/giving#/.test(stU.html));
  const [snapU] = await q(`SELECT snapshot FROM receipts WHERE org_id=$1 AND type='year_end' AND voided_at IS NULL`, [U.id]);
  const sU = typeof snapU.snapshot === "string" ? JSON.parse(snapU.snapshot) : snapU.snapshot;
  ok("unlisted PDF snapshot NOT stamped", !sU.givingAccountUrl && !sU.givingAccountDisplay);

  // BUILD-65 Part 5: the renderer no longer prints an account CTA in the PDF
  // footer — the footer is the legal tax line only (source guard, since PDF
  // text streams are compressed).
  const serverSrc = fs.readFileSync("server.js", "utf8");
  // pdfkit's `link:` option is the PDF-footer-specific marker (the EMAIL CTA,
  // which we keep, uses an <a href> — a different mechanism).
  ok("renderReceiptPdf footer no longer renders an account CTA link",
    !/link:\s*snapshot\.givingAccountUrl/.test(serverSrc));

  // ── 3. Public donate payloads (thank-you screen gate) ─────────────────────
  console.log("\n— entry point (c): public donate payload gate —");
  const pubL = await api("GET", `/org/${L.slug}/public`);
  const pubU = await api("GET", `/org/${U.slug}/public`);
  ok("listed org public payload: givingAccount true", pubL.body?.org?.givingAccount === true, pubL.body?.org);
  ok("unlisted org public payload: givingAccount false", pubU.body?.org?.givingAccount === false, pubU.body?.org);
  const pubPage = await api("GET", `/org/${L.slug}/giving-page/spring/public`);
  ok("giving-page public payload carries the same gate", pubPage.body?.org?.givingAccount === true, pubPage.body?.org);

  // ── 4. The emailed sign-in link (password-free alternate) ─────────────────
  console.log("\n— /giving sign-in link —");
  mail = [];
  const rq1 = await raw("POST", "/account/request-link", { body: { email: ACCT_EMAIL } });
  ok("request-link responds received", rq1.status === 200 && rq1.body?.received === true, rq1.body);
  await settle();
  let linkMail = mailTo(ACCT_EMAIL).find(m => /sign-in link/i.test(m.subject || ""));
  ok("sign-in link email captured", !!linkMail);
  const tok1 = (/signin#token=([A-Za-z0-9_-]+)/.exec(linkMail?.html || "") || [])[1];
  ok("email carries /giving/signin#token=… (fragment)", !!tok1);

  // Re-request supersedes the first token.
  mail = [];
  await raw("POST", "/account/request-link", { body: { email: ACCT_EMAIL } });
  await settle();
  linkMail = mailTo(ACCT_EMAIL).find(m => /sign-in link/i.test(m.subject || ""));
  const tok2 = (/signin#token=([A-Za-z0-9_-]+)/.exec(linkMail?.html || "") || [])[1];
  ok("re-request mints a fresh token", !!tok2 && tok2 !== tok1);
  const useOld = await raw("POST", "/account/link-verify", { body: { token: tok1 } });
  ok("superseded token rejected (400)", useOld.status === 400, useOld.body);
  const useNew = await raw("POST", "/account/link-verify", { body: { token: tok2 } });
  const cookie = cookieOf(useNew);
  ok("live token mints a session", useNew.status === 200 && !!cookie, useNew.body);
  const me = await raw("GET", "/account/me", { cookie });
  ok("session opens the account (GET /account/me)", me.status === 200 && me.body?.email === ACCT_EMAIL, me.body);
  const replay = await raw("POST", "/account/link-verify", { body: { token: tok2 } });
  ok("replay of a used token rejected (single-use)", replay.status === 400, replay.body);

  // No enumeration: unknown email → identical response, no email sent.
  mail = [];
  const rqUnknown = await raw("POST", "/account/request-link", { body: { email: "nobody@dfd49.test" } });
  ok("unknown email: identical received response", rqUnknown.status === 200 && rqUnknown.body?.received === true, rqUnknown.body);
  await settle();
  ok("unknown email: nothing sent", mailTo("nobody@dfd49.test").length === 0);

  // An unverified account never gets a sign-in link (no verification bypass) —
  // it gets its verification email instead, exactly like login.
  mail = [];
  await raw("POST", "/account/request-link", { body: { email: ACCT_UNVERIFIED } });
  await settle();
  const unvMail = mailTo(ACCT_UNVERIFIED);
  ok("unverified account: verification email, not a sign-in link",
    unvMail.length === 1 && /verify/i.test(unvMail[0].subject || "") && !/signin#token=/.test(unvMail[0].html || ""),
    unvMail.map(m => m.subject));

  // ── 5. PII hygiene sweep over every captured email of this run ────────────
  console.log("\n— URL hygiene —");
  // The strongest global rule, asserted on the two entry emails kept above:
  // no giving URL anywhere carries an email address in its QUERY portion.
  const allGivingUrls = [];
  for (const m of [covL, stL].filter(Boolean)) {
    const urls = (m.html.match(/https?:\/\/[^"']+/g) || []).filter(u => u.includes("/giving"));
    for (const u of urls) allGivingUrls.push(u);
  }
  ok("no giving URL carries an email/@ in its query portion (fragment only)",
    allGivingUrls.length > 0 && allGivingUrls.every(u => {
      const beforeHash = u.split("#")[0];
      return !beforeHash.includes("@") && !/%40/i.test(beforeHash) && !beforeHash.includes("?");
    }), allGivingUrls);

  // ── 6. Client wiring + SEO (source guards) ────────────────────────────────
  console.log("\n— client wiring + SEO —");
  const gd = fs.readFileSync("client/src/pages/GivingDashboard.jsx", "utf8");
  ok("signed-out /giving renders the landing; signed-in skips to the dashboard",
    /me\s*\n?\s*\?\s*<Home[\s\S]{0,200}<GivingLanding onSignedIn/.test(gd.replace(/\s+/g, " ")) ||
    (gd.includes("<GivingLanding onSignedIn") && /\? <Home me=/.test(gd)));
  ok("landing states the org-blindness promise plainly",
    gd.includes("never share") && gd.includes("your giving at one organization with another"));
  ok("AuthCard offers the sign-in link as the alternate (password primary)",
    gd.includes("Email me a sign-in link") && gd.includes('"/request-link"'));
  ok("TokenLanding wires the signin kind to /link-verify", gd.includes('"/link-verify"'));
  const mainSrc = fs.readFileSync("client/src/main.jsx", "utf8");
  ok("/giving/signin route exists", mainSrc.includes('path="/giving/signin"') && mainSrc.includes('landing="signin"'));
  const donate = fs.readFileSync("client/src/pages/Donate.jsx", "utf8");
  ok("thank-you screen offer gated on org.givingAccount with from=<slug>",
    donate.includes("org.givingAccount &&") && donate.includes("/giving#signup&from=${org.slug}"));
  const settings = fs.readFileSync("client/src/components/Settings.jsx", "utf8");
  ok("Settings website snippet gated on network_listed",
    settings.includes("PortalWebsiteSnippet") && /network_listed===true&&ps\.org_slug&&<PortalWebsiteSnippet/.test(settings));
  ok("snippet builds the from=<slug> link + button HTML with a preview",
    settings.includes("giving#from=${ps.org_slug}") && settings.includes("Put it on your website"));
  const givingHtml = fs.readFileSync("client/giving.html", "utf8");
  ok("giving.html carries title, description, canonical, and OG tags",
    /<title>[^<]*Giving[^<]*<\/title>/.test(givingHtml) && givingHtml.includes('name="description"')
    && givingHtml.includes('rel="canonical"') && givingHtml.includes('property="og:title"')
    && !/noindex/i.test(givingHtml));
  const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  const rw = vercel.rewrites.map(r => r.source);
  ok("vercel.json rewrites /giving → giving.html BEFORE the SPA catch-all",
    rw.indexOf("/giving") > -1 && rw.indexOf("/giving") < rw.indexOf("/(.*)")
    && vercel.rewrites[rw.indexOf("/giving")].destination === "/giving.html");
  const viteCfg = fs.readFileSync("client/vite.config.js", "utf8");
  ok("vite build emits the giving.html entry", viteCfg.includes("giving.html"));

  if (sink) sink.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

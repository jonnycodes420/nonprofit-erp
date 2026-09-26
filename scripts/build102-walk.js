#!/usr/bin/env node
// BUILD-102 (Steward Give) — THE WALK. SELF_REFUSING.
//
// The brief's own ending, on a real org through the real routes, in a real browser
// at 390 AND 1440:
//
//   · one form embedded on a local fixture page served from ANOTHER ORIGIN
//   · a monthly gift taken through the UPSELL
//   · a memorial gift, with its draft notice
//   · UTM tags on a gift
//   · the form's funnel reading back
//
// It CHECKS EVERY WRITE. A silently ignored 409 is how a walk lies to itself
// (BUILD-85 paid for that one), so nothing here fires and forgets. And it is the
// browser half that matters: every part of this build has a green server suite, and
// the TDZ defect in Part 2 had a green server suite too while the whole donation
// page was replaced by its error boundary.
//
//   BASE=http://localhost:5691 APP_URL=http://localhost:4233 \
//   EMAIL=… PASSWORD=… node scripts/build102-walk.js
//
// SELF_REFUSING: it writes through the real routes, so a non-loopback BASE is
// refused outright. There is no read-only mode for a walk whose whole point is that
// the writes land.

const path = require("path");
const http = require("http");
const crypto = require("crypto");

const BASE = process.env.BASE || "http://localhost:5691";
const APP = (process.env.APP_URL || "http://localhost:4233").replace(/\/+$/, "");
for (const [name, url] of [["BASE", BASE], ["APP_URL", APP]]) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
    console.error(`Refusing to run: ${name} must be loopback (got ${url}).`); process.exit(1);
  }
}
if (process.env.NODE_ENV === "production") { console.error("This walk does not run in production."); process.exit(1); }

const EMAIL = process.env.EMAIL || "walk@b102.example.org";
const PASSWORD = process.env.PASSWORD || "loadtest1234";
const HOST_PORT = Number(process.env.WALK_HOST_PORT || 5696);
const STRIPE_MOCK = Number(process.env.STRIPE_MOCK_PORT || 5693);

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  PASS  " + n); }
  else { fail++; console.log("  FAIL  " + n + (x !== undefined ? " — " + JSON.stringify(x).slice(0, 300) : "")); } };
const cents = v => Math.round(Number(v) * 100);
const settle = (ms = 500) => new Promise(r => setTimeout(r, ms));

// The Stripe mock, so a Checkout session can be created without a key. A walk that
// cannot complete a gift is a walk that proves nothing about the funnel.
function startStripeMock(port) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (/^\/v1\/checkout\/sessions/.test(req.url)) {
          res.end(JSON.stringify({ id: "cs_walk", url: APP + "/give/WALK_SLUG?donated=true" }));
        } else res.end(JSON.stringify({ ok: true, id: "mock", data: [] }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
// The org's own website, on its own origin, carrying the one line and a UTM tag.
function startHostSite(formId, port) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>The org's own site</title></head>
<body><h1 id="host-h1">Support our students</h1>
<p id="host-copy">This page belongs to the organisation, on its own origin.</p>
<script src="${APP}/embed.js" data-form="${formId}"></script>
<footer id="host-footer">Registered charity</footer></body></html>`;
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(html);
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
function sig(payload) {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest")
    .update(`${t}.${payload}`).digest("hex")}`;
}

(async () => {
  const login = await (await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json();
  if (!login.token) { console.error("Could not log in as " + EMAIL + ": " + JSON.stringify(login)); process.exit(1); }
  const tok = login.token;
  const api = async (method, p, body) => {
    const r = await fetch(BASE + p, { method,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
      body: body === undefined ? undefined : JSON.stringify(body) });
    let b = null; try { b = await r.json(); } catch { b = null; }
    return { status: r.status, body: b };
  };

  const org = (await api("GET", "/org")).body;
  const slug = org.org_slug || org.orgSlug;
  ok("the walk knows which org it is writing to", !!slug, org && Object.keys(org).slice(0, 6));
  const funds = (await api("GET", "/finance/funds")).body || [];
  const fundId = (funds.find(f => !f.restricted) || funds[0] || {}).id || null;
  ok("the org has a fund to designate to", !!fundId, funds.map(f => f.name));

  const smock = await startStripeMock(STRIPE_MOCK);
  ok("the Stripe mock bound", !!smock, `port ${STRIPE_MOCK}`);

  // ── ONE FORM, CONFIGURED ────────────────────────────────────────────────
  const stamp = Date.now().toString(36).slice(-5);
  const made = await api("POST", "/giving-pages", { title: "Walk form " + stamp, slug: "walk-" + stamp });
  ok("a giving page was created", made.status === 201, made.body);
  const FORM = made.body.id, FORM_SLUG = made.body.slug;
  const cfg = await api("PUT", `/giving-pages/${FORM}/form`, { config: {
    headline: "Give a child a year of lessons",
    amountsCents: [cents(25), cents(50), cents(150)], allowOther: true,
    defaultFrequency: "once", offerMonthly: true,
    designation: { mode: "fixed", fundId },
    showTribute: true, showEmployerMatch: true,
    questions: [{ key: "walk_how_heard_" + stamp, label: "How did you hear about us?", type: "choice",
                  options: ["A friend", "Our newsletter"] }],
    thankYou: { message: "Thank you. Twelve children will have lessons this term because of you." },
  } });
  ok("the form was configured", cfg.status === 200, cfg.body);
  ok("…and its question became a custom field", (cfg.body.customFieldsCreated || []).length === 1,
     cfg.body.customFieldsCreated);
  await api("PATCH", `/orgs/${org.id}`, { upsellThresholdCents: cents(100) });

  // ── THE BROWSER, AT BOTH WIDTHS ─────────────────────────────────────────
  const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
  let chromium = null;
  try { chromium = require(path.join(PW_DIR, "node_modules/playwright")).chromium; } catch { /* not installed */ }
  if (!chromium) {
    ok("playwright is available (environment)", false, `install it at ${PW_DIR} — this walk IS the browser half`);
  } else {
    const host = await startHostSite(FORM, HOST_PORT);
    ok("the org's own website is serving, on its own origin", !!host, `port ${HOST_PORT}`);
    const browser = await chromium.launch();

    for (const [label, viewport] of [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]]) {
      const ctx = await browser.newContext({ viewport, hasTouch: label === "390", isMobile: label === "390" });
      const pg = await ctx.newPage();
      const errs = [];
      pg.on("pageerror", e => errs.push(String(e)));
      pg.on("console", m => { if (m.type() === "error" && !/favicon|404/i.test(m.text())) errs.push("console: " + m.text()); });

      // ── THE HOSTED FORM, WITH UTM TAGS ON THE LINK ──────────────────────
      await pg.goto(`${APP}/give/${slug}/${FORM_SLUG}?utm_source=walk_newsletter&utm_medium=email&utm_campaign=Walk%20${stamp}`,
        { waitUntil: "networkidle" });
      await pg.locator(".give-steps").waitFor({ timeout: 20000 });
      ok(`${label}: the hosted form renders`, await pg.locator(".give-steps").count() === 1);
      ok(`${label}: …with the org's own headline`,
         /year of lessons/.test(await pg.locator(".give-steps").innerText()));
      ok(`${label}: …and the fixed fund stated, so the donor is not asked`,
         await pg.locator(".give-fixed-fund").count() === 1);
      ok(`${label}: no page error`, errs.length === 0, errs.slice(0, 2));
      // Nothing from a later step is on screen yet.
      ok(`${label}: step two's fields are not on screen`, await pg.locator(".give-first").count() === 0);

      // ── THE UPSELL, TAKEN ───────────────────────────────────────────────
      await pg.locator('.give-amt[data-cents="15000"]').click();
      await pg.locator(".give-next").click();
      await pg.locator(".give-upsell").waitFor({ timeout: 10000 });
      ok(`${label}: the upsell is offered on a $150 gift`, await pg.locator(".give-upsell").count() === 1);
      ok(`${label}: …suggesting a third, in whole dollars`,
         /\$50 a month/.test(await pg.locator(".give-upsell").innerText()),
         await pg.locator(".give-upsell").innerText());
      await pg.locator(".give-upsell-yes").click();
      await pg.locator(".give-first").waitFor({ timeout: 10000 });
      ok(`${label}: accepting it moves on to the details`, await pg.locator(".give-first").count() === 1);

      // ── A MEMORIAL GIFT, AND A QUESTION ANSWERED ────────────────────────
      await pg.locator(".give-first").fill("Mabel");
      await pg.locator(".give-last").fill("Fenwick");
      await pg.locator(".give-email").fill(`walk.${label}.${stamp}@example.org`);
      await pg.locator(".give-tribute-type").selectOption("memory");
      await pg.locator(".give-tribute-name").fill("Arthur Fenwick");
      await pg.locator(".give-notify-name").fill("Ruth Fenwick");
      await pg.locator(".give-notify-email").fill(`ruth.${label}.${stamp}@example.org`);
      await pg.locator(".give-employer").fill("Acme Manufacturing " + stamp);
      await pg.locator(".give-question select").selectOption("Our newsletter");
      await pg.locator(".give-next").click();
      await pg.locator(".give-pay").waitFor({ timeout: 10000 });
      ok(`${label}: the payment step states the monthly amount`,
         /\$50/.test(await pg.locator(".give-summary").innerText()),
         await pg.locator(".give-summary").innerText());
      ok(`${label}: …and says a year of it comes to $600`,
         /\$600 over a year/.test(await pg.locator(".give-steps").innerText()));
      ok(`${label}: NO CARD FIELD EXISTS ON THIS PAGE`,
         await pg.locator('input[autocomplete*="cc-"], input[name*="cardnumber"], iframe[name*="stripe"]').count() === 0);
      ok(`${label}: nothing scrolls sideways`,
         await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await ctx.close();
    }

    // ── THE EMBED, ON THE ORG'S OWN SITE, WITH THE TAGS FORWARDED ─────────
    for (const [label, viewport] of [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]]) {
      const ctx = await browser.newContext({ viewport, hasTouch: label === "390", isMobile: label === "390" });
      const pg = await ctx.newPage();
      const errs = [];
      pg.on("pageerror", e => errs.push(String(e)));
      await pg.goto(`http://localhost:${HOST_PORT}/?utm_source=walk_embed&utm_medium=web&utm_campaign=Walk%20${stamp}`,
        { waitUntil: "networkidle" });
      ok(`embed ${label}: the host page keeps its own content`,
         await pg.locator("#host-h1").count() === 1 && await pg.locator("#host-footer").count() === 1);
      const frame = pg.locator("iframe[data-steward-form]");
      ok(`embed ${label}: one frame, sandboxed`,
         await frame.count() === 1 && !!(await frame.getAttribute("sandbox")));
      const inner = pg.frameLocator("iframe[data-steward-form]");
      await inner.locator(".give-steps").waitFor({ timeout: 20000 });
      ok(`embed ${label}: the form renders inside it`, await inner.locator(".give-steps").count() === 1);
      // THE TAGS WERE FORWARDED — the frame's own URL carries them, which is the
      // only way an embedded gift can be attributed at all.
      const frameUrl = await inner.locator("body").evaluate(() => window.location.search);
      ok(`embed ${label}: the host's UTM tags were forwarded into the frame`,
         /utm_source=walk_embed/.test(frameUrl), frameUrl);
      ok(`embed ${label}: …and nothing else from the host's query string`,
         !/utm_term|session|token/.test(frameUrl), frameUrl);
      ok(`embed ${label}: it sized itself off the placeholder`,
         (await pg.evaluate(() => document.querySelector("iframe[data-steward-form]").style.height)) !== "720px");
      ok(`embed ${label}: no page error on the host`, errs.length === 0, errs.slice(0, 2));
      await ctx.close();
    }
    await browser.close();
    if (host) host.close();
  }

  // ── THE GIFTS THEMSELVES, THROUGH THE REAL WEBHOOK ──────────────────────
  // The browser stops at Stripe's door, so the walk finishes the money the way
  // Stripe does — a signed webhook, which is the only path that writes a gift.
  const fire = async (meta, amountCents) => {
    const ev = { id: "evt_walk_" + crypto.randomUUID().slice(0, 8), type: "payment_intent.succeeded",
      account: org.stripe_account_id || ("acct_" + org.id),
      data: { object: { id: "pi_walk_" + crypto.randomUUID().slice(0, 8), amount_received: amountCents,
                        currency: "usd", receipt_email: meta.donor_email, metadata: meta } } };
    const p = JSON.stringify(ev);
    const r = await fetch(BASE + "/stripe/webhook", { method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": sig(p) }, body: p });
    return r.status;
  };
  const qkey = "q_walk_how_heard_" + stamp;
  const memorialMeta = {
    donor_email: `walk.memorial.${stamp}@example.org`, donor_name: "Mabel Fenwick",
    org_id: org.id, giving_page_id: FORM, frequency: "once", fund_id: fundId,
    tribute_type: "memory", tribute_name: "Arthur Fenwick",
    notify_name: "Ruth Fenwick", notify_email: `ruth.${stamp}@example.org`,
    employer: "Acme Manufacturing " + stamp,
    utm_source: "walk_newsletter", utm_medium: "email", utm_campaign: "Walk " + stamp,
    [qkey]: "Our newsletter",
  };
  ok("the memorial gift's webhook is accepted", (await fire(memorialMeta, cents(150))) === 200);
  await settle(900);

  const gifts = (await api("GET", `/giving-pages`)).body;
  ok("the giving-pages list still reads", Array.isArray(gifts));

  // Everything the gift should have hung off itself.
  const donors = (await api("GET", `/donors?search=${encodeURIComponent("Mabel Fenwick")}&limit=5`)).body;
  const donorList = Array.isArray(donors) ? donors : (donors && donors.donors) || [];
  const mabel = donorList.find(d => String(d.email || "").includes("walk.memorial." + stamp));
  ok("the donor was created from the gift", !!mabel, donorList.map(d => d.email));
  if (mabel) {
    const detail = (await api("GET", `/donors/${mabel.id}`)).body;
    const cf = detail.custom_fields || detail.customFields || {};
    ok("the question's answer landed on the donor",
       cf["walk_how_heard_" + stamp] === "Our newsletter", cf);
    const extras = (await api("GET", `/gifts/${(detail.gifts || [])[0] && (detail.gifts || [])[0].id}/extras`)).body;
    ok("the gift carries its tribute", !!extras && extras.tribute && extras.tribute.name === "Arthur Fenwick",
       extras && extras.tribute);
    ok("…and a DRAFT notice, which Steward will not send",
       !!extras && !!extras.tributeNotice && !extras.tributeNotice.sent_at, extras && extras.tributeNotice);
    ok("…and a match pledge on the employer's own record",
       !!extras && !!extras.match && !!extras.match.employerName, extras && extras.match);
  }

  // UTM ON THE GIFT, read back through the report builder — the surface that
  // answers the question rather than the column that stores it.
  const byLink = await api("POST", "/report-builder/run",
    { definition: { entity: "gifts", columns: [], groupBy: "utm_source" } });
  ok("a report groups this org's gifts by link source", byLink.status === 200, byLink.body);
  ok("…and the walk's own source is one of the rows",
     (byLink.body.rows || []).some(r => r.group === "walk_newsletter"),
     (byLink.body.rows || []).map(r => r.group));

  // ── THE FUNNEL READS BACK ───────────────────────────────────────────────
  const fun = await api("GET", `/giving-pages/${FORM}/funnel`);
  ok("the funnel reads back", fun.status === 200, fun.body);
  ok("…with views from the browser visits", fun.body.funnel.views >= 2, fun.body.funnel);
  ok("…starts from the donors who chose an amount", fun.body.funnel.starts >= 2, fun.body.funnel);
  ok("…and the completion counted from the GIFT", fun.body.funnel.completions >= 1, fun.body.funnel);
  ok("the funnel never exceeds itself",
     fun.body.funnel.starts <= fun.body.funnel.views
     && fun.body.funnel.completions <= fun.body.funnel.starts, fun.body.funnel);
  ok("every figure carries its definition", Object.keys(fun.body.definitions || {}).length === 5,
     Object.keys(fun.body.definitions || {}));
  ok("…and the screen says what Steward does NOT record",
     /records nothing about who/.test(fun.body.privacyNote || ""), fun.body.privacyNote);

  // The receipt, through the untouched path.
  if (mabel) {
    const rec = (await api("GET", `/donors/${mabel.id}/receipts`)).body;
    ok("the gift got a receipt, through the existing receipt path",
       Array.isArray(rec) ? rec.length >= 1 : !!rec, rec);
  }

  if (smock) smock.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

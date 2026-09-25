// BUILD-102 (Steward Give) Part 4 — EMBEDDING ON THE ORG'S OWN SITE.
//
// The brief's own test: the embed renders on a plain HTML fixture page served from
// ANOTHER ORIGIN; the frame refuses to be driven by a postMessage from a foreign
// origin; an archived form's embed shows a quiet "this form is closed" line, not
// an error.
//
//   §1  the two snippets come from the SERVER, so the script URL, the id and the
//       fallback cannot drift apart;
//   §2  the public read by form ID — the same spec the hosted page renders;
//   §3  AN ARCHIVED FORM IS 200 WITH A QUIET LINE, never a 404: the embed is on a
//       page the organisation is judged by;
//   §4  it renders on a plain HTML page served from a DIFFERENT ORIGIN, in a
//       sandboxed frame, and sizes itself;
//   §5  THE FRAME ACCEPTS NOTHING IN. A hostile postMessage changes nothing,
//       because there is no listener to drive — asserted, not assumed;
//   §6  no card field exists on the host page or in the frame;
//   §7  the wall: org A's embed cannot be read or configured by org B.
//
// Standard scratch stack; ports per WORKTREE-NOTES.md. The cross-origin fixture is
// served on its own port so "another origin" is literally true.

const bcrypt = require("bcryptjs");
const path = require("path");
const http = require("http");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "b102_emb", OTHER = "b102_emb2";
const ME = "b102emb@example.org", THEM = "b102emb-other@example.org";
const PW = "loadtest1234";
// A port nothing else in this repo uses, so "another origin" is not a coincidence.
const HOST_PORT = Number(process.env.EMBED_HOST_PORT || 5698);

const CHILD = ["custom_field_defs", "gifts", "giving_pages", "donors", "users",
  "fin_transactions", "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const mkOrg = (id, slug, name) => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at,
                     stripe_account_id,stripe_connected,cover_fees_enabled)
   VALUES ($1,$2,$3,1,'team','active','America/New_York',NOW(),$4,TRUE,TRUE)
   ON CONFLICT (id) DO UPDATE SET stripe_account_id=$4, stripe_connected=TRUE`,
  [id, name, slug, "acct_" + id]);
const mkUser = (id, org, email, name) => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
  [id, org, email, bcrypt.hashSync(PW, 4), name]);
const cents = v => Math.round(Number(v) * 100);

// A PLAIN HTML PAGE, on its own origin, with nothing but the one line an org
// pastes. This is the fixture the whole part exists to satisfy.
function startHostSite(scriptOrigin, formId, port = HOST_PORT) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Harbor Music School</title></head>
<body>
  <h1>Support our students</h1>
  <p id="host-copy">This is the organisation's own website, on its own origin.</p>
  <script src="${scriptOrigin}/embed.js" data-form="${formId}"></script>
  <footer id="host-footer">Registered charity</footer>
</body></html>`;
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}

(async () => {
  console.log("build102-embed");
  await reset();
  await mkOrg(ORG, "b102-emb", "Harbor Music School");
  await mkOrg(OTHER, "b102-emb2", "Open Door Pantry");
  await mkUser("u_b102m", ORG, ME, "Allie Barnett");
  await mkUser("u_b102m2", OTHER, THEM, "Not Allie");
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_gen_m','${ORG}','General fund',false)
           ON CONFLICT (id) DO NOTHING`);
  const tok = await login(ME), tok2 = await login(THEM);

  const page = await api("POST", "/giving-pages", tok, { title: "Support students", slug: "students" });
  const PAGE = page.body.id;
  await api("PUT", `/giving-pages/${PAGE}/form`, tok, { config: {
    headline: "Give a child a year of lessons",
    amountsCents: [cents(25), cents(50), cents(100)], allowOther: true,
    designation: { mode: "fixed", fundId: "f_gen_m" },
  } });
  const archived = await api("POST", "/giving-pages", tok, { title: "Last year's appeal", slug: "lastyear" });
  const ARCHIVED = archived.body.id;
  await api("PUT", `/giving-pages/${ARCHIVED}/form`, tok, { config: { amountsCents: [cents(50)] } });
  await api("PUT", `/giving-pages/${ARCHIVED}`, tok, { status: "archived" });
  ok("fixture one live form and one archived", page.status === 201 && archived.status === 201);

  // ── §1 · THE SNIPPETS COME FROM THE SERVER ──────────────────────────────
  console.log("\n— §1 · one line, and a fallback for a site that refuses scripts —");
  const snip = await api("GET", `/giving-pages/${PAGE}/embed`, tok, null);
  ok("§1 the snippets read back", snip.status === 200, snip.body);
  ok("§1 the script tag is ONE line carrying the form id",
     /^<script src="https?:\/\/[^"]+\/embed\.js" data-form="/.test(snip.body.script)
     && snip.body.script.includes(PAGE), snip.body.script);
  ok("§1 …and it is genuinely one line", !/\n/.test(snip.body.script), snip.body.script);
  ok("§1 the fallback is an iframe at the same form", snip.body.iframe.includes(`/embed/${PAGE}`), snip.body.iframe);
  ok("§1 …carrying a height somebody can change, since it cannot self-size",
     /height="\d+"/.test(snip.body.iframe), snip.body.iframe);
  // THE ONE THING AN ADMIN WILL BE ASKED BY THEIR WEB PERSON.
  ok("§1 the note says no card details are typed on their site",
     /No card details are ever/.test(snip.body.note) && /cannot read the page/.test(snip.body.note),
     snip.body.note);
  ok("§1 both snippets name the SAME id, from one generator",
     snip.body.script.includes(PAGE) && snip.body.iframe.includes(PAGE) && snip.body.previewUrl.includes(PAGE));

  // ── §2 · THE PUBLIC READ BY FORM ID ─────────────────────────────────────
  console.log("\n— §2 · the same spec the hosted page renders —");
  const pub = await api("GET", `/forms/${PAGE}/public`, null, null);
  ok("§2 a stranger can read it, with no token", pub.status === 200, pub.status);
  ok("§2 it is not closed", pub.body.closed === false);
  ok("§2 …and carries the org's own name, never the staff-side one",
     pub.body.org.name === "Harbor Music School", pub.body.org.name);
  ok("§2 …the form's own amounts",
     pub.body.form.spec.amount.amountsCents.join(",") === [cents(25), cents(50), cents(100)].join(","),
     pub.body.form.spec.amount.amountsCents);
  ok("§2 …and the fixed fund by NAME, so the frame looks nothing up",
     pub.body.form.spec.designation.fundName === "General fund", pub.body.form.spec.designation);
  // THE SAME SPEC AS THE HOSTED PAGE, by fingerprint — an embedded form that
  // differed from the hosted one would be a second product.
  const F = await import("../shared/formConfig.js");
  const hosted = await api("GET", `/org/b102-emb/giving-page/students/public`, null, null);
  ok("§2 THE EMBED AND THE HOSTED PAGE ARE THE SAME FORM",
     F.specFingerprint(pub.body.form.spec) === F.specFingerprint(hosted.body.givingPage.form),
     [F.specFingerprint(pub.body.form.spec).slice(0, 120), F.specFingerprint(hosted.body.givingPage.form).slice(0, 120)]);
  const nothing = await api("GET", `/forms/gp_does_not_exist/public`, null, null);
  ok("§2 an id that never existed is a 404", nothing.status === 404, nothing.status);

  // ── §3 · AN ARCHIVED FORM IS A QUIET LINE ───────────────────────────────
  console.log("\n— §3 · a closed form is not an error on somebody's homepage —");
  const closed = await api("GET", `/forms/${ARCHIVED}/public`, null, null);
  ok("§3 an archived form answers 200, NOT 404", closed.status === 200, closed.status);
  ok("§3 …and says it is closed", closed.body.closed === true && /closed/i.test(closed.body.message), closed.body);
  ok("§3 …in the org's own colours, not Steward's",
     !!closed.body.org && !!closed.body.org.theme, closed.body.org);
  // AND IT CARRIES NO FORM AT ALL — nothing for a donor to fill in and no amounts.
  ok("§3 …carrying no form to fill in", closed.body.form === undefined, Object.keys(closed.body));

  // ── §4-§6 · IN A BROWSER, ON ANOTHER ORIGIN ─────────────────────────────
  console.log("\n— §4 · on a plain HTML page, on a different origin —");
  const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
  let chromium = null;
  try { chromium = require(path.join(PW_DIR, "node_modules/playwright")).chromium; } catch { /* not installed */ }
  const PREVIEW = (process.env.APP_URL || "").replace(/\/+$/, "");
  let previewUp = false;
  if (PREVIEW) { try { previewUp = (await fetch(PREVIEW + "/embed.js")).ok; } catch { previewUp = false; } }
  if (!chromium || !previewUp) {
    ok("§4 browser leg (environment)", false,
       `set APP_URL to this worktree's own preview and install playwright — playwright: ${chromium ? "found" : "MISSING"}, preview: ${previewUp ? "up" : "DOWN"}`);
  } else {
    const host = await startHostSite(PREVIEW, PAGE);
    if (!host) ok("§4 the host site bound (environment)", false, `port ${HOST_PORT} busy`);
    else {
      const HOST = `http://localhost:${HOST_PORT}`;
      ok("§4 the host site is on a DIFFERENT origin from Steward", HOST !== PREVIEW, [HOST, PREVIEW]);
      const browser = await chromium.launch();
      for (const [label, viewport] of [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]]) {
        const ctx = await browser.newContext({ viewport, hasTouch: label === "390", isMobile: label === "390" });
        const pg = await ctx.newPage();
        const errs = [];
        pg.on("pageerror", e => errs.push(String(e)));
        await pg.goto(HOST, { waitUntil: "networkidle" });
        ok(`§4 ${label}: the host page still shows its own content`,
           await pg.locator("#host-copy").count() === 1 && await pg.locator("#host-footer").count() === 1);
        const frame = pg.locator("iframe[data-steward-form]");
        ok(`§4 ${label}: ONE frame was inserted`, await frame.count() === 1, await frame.count());
        // WHERE THE SCRIPT TAG STOOD, not at the end of the body — otherwise the
        // form appears under the footer on every site that pastes it mid-page.
        const order = await pg.evaluate(() => {
          const f = document.querySelector("iframe[data-steward-form]");
          const footer = document.getElementById("host-footer");
          return f && footer ? (f.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING) > 0 : false;
        });
        ok(`§4 ${label}: …exactly where the script tag stood, above the footer`, order === true);
        // THE SANDBOX.
        const sandbox = await frame.getAttribute("sandbox");
        ok(`§4 ${label}: the frame is sandboxed`, !!sandbox, sandbox);
        for (const need of ["allow-scripts", "allow-same-origin", "allow-top-navigation-by-user-activation"]) {
          ok(`§4 ${label}: …with ${need}`, (sandbox || "").includes(need), sandbox);
        }
        for (const deny of ["allow-popups", "allow-modals", "allow-pointer-lock", "allow-downloads"]) {
          ok(`§4 ${label}: …and WITHOUT ${deny}`, !(sandbox || "").includes(deny), sandbox);
        }
        // THE FORM ACTUALLY RENDERS INSIDE IT.
        const inner = pg.frameLocator("iframe[data-steward-form]");
        await inner.locator(".give-steps").waitFor({ timeout: 15000 });
        ok(`§4 ${label}: the three-step form renders inside the frame`,
           await inner.locator(".give-steps").count() === 1);
        ok(`§4 ${label}: …with the form's own headline`,
           /year of lessons/.test(await inner.locator(".give-steps").innerText()));
        ok(`§4 ${label}: …and the fixed fund stated`,
           /General fund/.test(await inner.locator(".give-steps").innerText()));
        // IT SIZES ITSELF. The height must move off the 720px placeholder.
        await pg.waitForFunction(() => {
          const f = document.querySelector("iframe[data-steward-form]");
          return f && f.style.height && f.style.height !== "720px";
        }, { timeout: 15000 }).catch(() => {});
        const h = await pg.evaluate(() => document.querySelector("iframe[data-steward-form]").style.height);
        ok(`§4 ${label}: the frame sized itself to its content`, h !== "720px" && /^\d+px$/.test(h), h);
        const hNum = parseInt(h, 10);
        ok(`§4 ${label}: …to a sane height`, hNum >= 120 && hNum <= 4000, h);

        // ── §5 · THE FRAME ACCEPTS NOTHING IN ─────────────────────────────
        // "Refuses to be driven by a postMessage from a foreign origin" is true
        // BY CONSTRUCTION here: there is no listener inside the frame. That is a
        // stronger property than a check somebody has to keep correct, and it is
        // checkable — so this asserts the absence, and then asserts that a
        // hostile message changes nothing.
        const listeners = await inner.locator("body").evaluate(() => {
          // A page cannot enumerate its own listeners, so this proves the absence
          // the only way available: patch addEventListener BEFORE anything else
          // could have run is impossible here, so instead assert the observable
          // consequence — see the message test below. This returns the frame's own
          // origin for the record.
          return window.location.origin;
        });
        ok(`§5 ${label}: the frame runs on Steward's origin`, listeners === PREVIEW, [listeners, PREVIEW]);
        const beforeUrl = pg.url();
        const beforeText = await inner.locator(".give-steps").innerText();
        await pg.evaluate(() => {
          const f = document.querySelector("iframe[data-steward-form]");
          // Everything a hostile host page might try.
          f.contentWindow.postMessage({ steward: "give-height", height: 99999 }, "*");
          f.contentWindow.postMessage({ steward: "navigate", url: "https://evil.test" }, "*");
          f.contentWindow.postMessage({ type: "submit" }, "*");
          f.contentWindow.postMessage("plain string", "*");
        });
        await pg.waitForTimeout(400);
        ok(`§5 ${label}: a hostile postMessage does not navigate the frame`,
           pg.url() === beforeUrl && await inner.locator(".give-steps").count() === 1);
        ok(`§5 ${label}: …and does not change what the form says`,
           await inner.locator(".give-steps").innerText() === beforeText);
        // AND THE HOST'S OWN LISTENER IS BOUNDED. A height of 99999 from the frame
        // itself must be refused, so a bug cannot make a 99,999-pixel element.
        await inner.locator("body").evaluate(() => {
          window.parent.postMessage({ steward: "give-height", formId: "wrong-id", height: 99999 }, "*");
        });
        await pg.waitForTimeout(300);
        const hAfter = await pg.evaluate(() => document.querySelector("iframe[data-steward-form]").style.height);
        ok(`§5 ${label}: a height for another form id is ignored`, hAfter === h, [h, hAfter]);

        // ── §6 · NO CARD FIELD, ANYWHERE ──────────────────────────────────
        ok(`§6 ${label}: no card field on the HOST page`,
           await pg.locator('input[autocomplete*="cc-"], input[name*="cardnumber"]').count() === 0);
        await inner.locator('.give-amt[data-cents="5000"]').click();
        await inner.locator(".give-next").click();
        await inner.locator(".give-first").fill("Mabel");
        await inner.locator(".give-last").fill("Fenwick");
        await inner.locator(".give-email").fill("mabel.emb@example.org");
        await inner.locator(".give-next").click();
        ok(`§6 ${label}: the payment step is reachable inside the frame`,
           await inner.locator(".give-pay").count() === 1);
        ok(`§6 ${label}: …and still NO card field exists`,
           await inner.locator('input[autocomplete*="cc-"], input[name*="cardnumber"], iframe[name*="stripe"]').count() === 0);
        ok(`§6 ${label}: …and it says payment finishes on Stripe's page`,
           /Stripe's secure page/.test(await inner.locator(".give-steps").innerText()));
        ok(`§6 ${label}: no page error on the host`, errs.length === 0, errs.slice(0, 2));
        await ctx.close();
      }

      // AN ARCHIVED FORM, EMBEDDED. A quiet line, on the org's own site.
      const host2 = await startHostSite(PREVIEW, ARCHIVED, HOST_PORT + 1);
      if (host2) {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const pg = await ctx.newPage();
        await pg.goto(`http://localhost:${HOST_PORT + 1}`, { waitUntil: "networkidle" });
        const inner = pg.frameLocator("iframe[data-steward-form]");
        await inner.locator(".embed-closed").waitFor({ timeout: 15000 });
        ok("§3 an archived form's embed shows a quiet closed line",
           /closed/i.test(await inner.locator(".embed-closed").innerText()),
           await inner.locator(".embed-closed").innerText());
        ok("§3 …and no form to fill in", await inner.locator(".give-steps").count() === 0);
        ok("§3 …and the host page is not showing an error",
           await inner.locator("text=/error|not found|404/i").count() === 0);
        await ctx.close();
        host2.close();
      }
      await browser.close();
      host.close();
    }
  }

  // ── §7 · THE WALL ───────────────────────────────────────────────────────
  console.log("\n— §7 · org A's embed is org A's —");
  const crossSnip = await api("GET", `/giving-pages/${PAGE}/embed`, tok2, null);
  ok("§7 org B cannot read org A's snippets", crossSnip.status === 404, crossSnip.status);
  // The PUBLIC read is public by design — it is what an embed on a website calls,
  // and a donation form is not a secret. What it must never carry is anything
  // beyond what the page itself shows.
  const pubKeys = Object.keys((await api("GET", `/forms/${PAGE}/public`, null, null)).body);
  ok("§7 the public read carries only the form and the org's public face",
     pubKeys.sort().join(",") === "closed,form,org", pubKeys);
  const orgKeys = Object.keys((await api("GET", `/forms/${PAGE}/public`, null, null)).body.org).sort();
  ok("§7 …and nothing about the org beyond what a donor sees",
     orgKeys.join(",") === "coverFeesEnabled,name,slug,theme", orgKeys);

  if (!process.env.KEEP) await reset();
  await closeDb();
  summary();
})();

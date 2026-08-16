#!/usr/bin/env node
// BUILD-50 — consumer-surface design polish: DSF2 screenshots + DOM
// assertions for BOTH polished surfaces at 390 / 1440 / 2560:
//
//   • the signed-out /giving LANDING — ink hero fills the first viewport
//     (fluid-clamp headline, compact auth card: sign-in + two quiet links,
//     account creation owned by the hero), value trio, and the org-blindness
//     promise as a FULL-BLEED ink band;
//   • the single-org TAKEOVER — org header image as a full-width banner with
//     an identity plaque set against it (solid primary-color band + monogram
//     fallback for orgs with no image — never bare cream), follow-only state
//     with NO identity redundancy, impact updates WITH photos in a
//     two-column grid, giving-summary presence, org-site footer band;
//   • the MULTI-ORG neutral shell — re-run to confirm no org theme bleeds
//     outside that org's own sections (the BUILD-48 containment sweep).
//
// Verified in BOTH follow-only and linked states; the linked fixture carries
// five years of gifts, receipts, a recurring gift, and a fund-TARGETED
// impact update with photos (the worst case for layout is a rich account,
// not an empty follow).
//
// Local stack recipe (the BUILD-45/46/47/48 capture conventions):
//   client built with VITE_API_URL=http://localhost:5601
//     VITE_PORTAL_API=http://localhost:5601/portal
//     VITE_ACCOUNT_API=http://localhost:5601/account
//     VITE_NETWORK_API=http://localhost:5601/network
//   `npx vite preview --port 4173` + server booted with
//   CORS_ORIGIN=http://localhost:4173 and both BUILD-46 flags on.
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build50-capture.js
const fs = require("fs");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const { chromium } = require(process.env.PLAYWRIGHT_DIR + "/node_modules/playwright");

const API = require("./lib/prodGuard").writerBase("http://localhost:5601"); // loopback default + --i-know-this-is-prod for remote (BUILD-55)
const APP = process.env.APP || "http://localhost:4173";
const OUT = process.env.OUT || (__dirname + "/../docs/build50-consumer-polish");
const DB = process.env.DATABASE_URL || "postgres://steward:steward@localhost:5544/steward_loadtest";
if (!/localhost|127\.0\.0\.1/.test(DB)) { console.error("refusing a non-scratch DATABASE_URL"); process.exit(1); }

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n, d ?? ""); } };

const j = async (method, path, body, headers = {}) => {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  let parsed = null; try { parsed = await r.json(); } catch { /* non-json */ }
  return { status: r.status, body: parsed, headers: r.headers };
};
const cookieHeader = (r) => decodeURIComponent(((r.headers.get("set-cookie") || "").match(/steward_portal=([^;]+)/) || [])[1] || "");
const svgBand = (bg, fg) => "data:image/svg+xml;base64," + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300"><rect width="1200" height="300" fill="${bg}"/>` +
  `<circle cx="220" cy="150" r="90" fill="${fg}" opacity="0.35"/><circle cx="520" cy="90" r="55" fill="${fg}" opacity="0.25"/>` +
  `<circle cx="880" cy="200" r="120" fill="${fg}" opacity="0.3"/><circle cx="1120" cy="70" r="40" fill="${fg}" opacity="0.2"/></svg>`
).toString("base64");
const svgLogo = (bg, letter) => "data:image/svg+xml;base64," + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="18" fill="${bg}"/>` +
  `<text x="48" y="64" font-family="Georgia,serif" font-size="52" fill="#ffffff" text-anchor="middle">${letter}</text></svg>`
).toString("base64");
const svgPhoto = (bg, fg, label) => "data:image/svg+xml;base64," + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="${bg}"/>` +
  `<circle cx="240" cy="260" r="130" fill="${fg}" opacity="0.4"/><rect x="440" y="120" width="260" height="260" rx="20" fill="${fg}" opacity="0.3"/>` +
  `<text x="60" y="460" font-family="Georgia,serif" font-size="34" fill="${fg}">${label}</text></svg>`
).toString("base64");
const hexToRgbStr = (hex) => {
  const h = hex.replace("#", "");
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
};

const PANTRY = "org_b48p", PANTRY_SLUG = "b48-pantry";
const SHELTER = "org_b50s", SHELTER_SLUG = "b50-harbor-shelter";
const RICH = "b50.rich@b50.test", FOL = "b50.follow@b50.test", SHL = "b50.shelter@b50.test";
const PW = "b50capture999";
const THIS_YEAR = new Date().getFullYear();

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const db = new Client({ connectionString: DB });
  await db.connect();

  // ── seed ──────────────────────────────────────────────────────────────────
  // CREO's theme goes through the REAL guarded write route; the pantry (multi-
  // org transition) and the header-image-less shelter (fallback band) are
  // fixture orgs.
  const creoLogin = await j("POST", "/auth/login", { email: "admin@creoarts.org", password: "demo1234" });
  ok("creo admin login (scratch demo seed)", !!creoLogin.body?.token);
  const creoTok = creoLogin.body.token;
  const creoTheme = await j("PUT", "/portal-settings", {
    enabled: true, networkListed: true, displayName: "CREO Arts",
    primaryColor: "#8a4a2c", accentColor: "#c9a84c", buttonColor: "#8a4a2c",
    backgroundTint: "#faf5ec", typePairing: "editorial", cardStyle: "soft-shadow",
    headerImageData: svgBand("#8a4a2c", "#e7cf91"), logoData: svgLogo("#8a4a2c", "C"),
    footerText: "CREO Arts — community art education on the Gulf Coast.",
    einLine: "Tax ID (EIN): 12-3456789", contactEmail: "hello@creoarts.org",
    directoryDescription: "Community art education", directoryCity: "Fairhope", directoryState: "AL",
  }, { Authorization: "Bearer " + creoTok });
  ok("creo theme saved through the guarded route", creoTheme.status === 200, creoTheme.body);

  for (const [id, slug, name] of [[PANTRY, PANTRY_SLUG, "Open Door Pantry"], [SHELTER, SHELTER_SLUG, "Harbor Night Shelter"]]) {
    await db.query(`DELETE FROM donor_org_follows WHERE org_id=$1`, [id]).catch(() => {});
    await db.query(`DELETE FROM donor_account_links WHERE org_id=$1`, [id]).catch(() => {});
    await db.query(`DELETE FROM portal_settings WHERE org_id=$1`, [id]);
    await db.query(`DELETE FROM donors WHERE org_id=$1`, [id]);
    await db.query(`DELETE FROM orgs WHERE id=$1`, [id]);
    await db.query(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','core')`, [id, name, slug]);
  }
  await db.query(
    `INSERT INTO portal_settings (org_id,enabled,network_listed,display_name,primary_color,accent_color,type_pairing,card_style,header_image_data,logo_data,directory_description,directory_city,directory_state)
     VALUES ($1,true,true,'Open Door Pantry','#3f5c8a','#3f5c8a','classic','square',$2,$3,'Groceries and warm meals, no questions asked','Fairhope','AL')`,
    [PANTRY, svgBand("#3f5c8a", "#dfe8e2"), svgLogo("#3f5c8a", "O")]);
  // The shelter deliberately has NO header image and NO logo — the fallback
  // band (solid primary + monogram) is what BUILD-50 asserts here.
  await db.query(
    `INSERT INTO portal_settings (org_id,enabled,network_listed,display_name,primary_color,footer_text,directory_description)
     VALUES ($1,true,true,'Harbor Night Shelter','#33538a','Harbor Night Shelter — safe beds, every night.','Safe overnight shelter')`, [SHELTER]);

  // Donor accounts: RICH links to CREO with five years of history, receipts,
  // a recurring gift, and a fund-designated gift matching a targeted impact
  // update; FOL follows CREO (follow-only takeover); SHL follows the shelter
  // (fallback-band takeover).
  for (const [id, email] of [["da_b50rich", RICH], ["da_b50fol", FOL], ["da_b50shl", SHL]]) {
    await db.query(`DELETE FROM donor_org_follows WHERE account_id=$1`, [id]).catch(() => {});
    await db.query(`DELETE FROM donor_account_links WHERE account_id=$1`, [id]).catch(() => {});
    await db.query(`DELETE FROM donor_accounts WHERE email=$1 OR id=$2`, [email, id]);
    await db.query(`INSERT INTO donor_accounts (id,email,password_hash,email_verified_at) VALUES ($1,$2,$3,NOW())`,
      [id, email, bcrypt.hashSync(PW, 10)]);
  }
  await db.query(`DELETE FROM receipts WHERE donor_id='d_b50rich'`);
  await db.query(`DELETE FROM recurring_subscriptions WHERE donor_id='d_b50rich'`);
  await db.query(`DELETE FROM gifts WHERE donor_id='d_b50rich'`);
  await db.query(`DELETE FROM donors WHERE id='d_b50rich'`);
  await db.query(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_b50rich','org_creo','Harper Quinn',$1,2450,6,'mid','steward')`, [RICH]);
  const giftRows = [
    ["g_b50r1", 250, `${THIS_YEAR - 4}-11-05`, null],
    ["g_b50r2", 300, `${THIS_YEAR - 3}-12-12`, null],
    ["g_b50r3", 400, `${THIS_YEAR - 2}-06-18`, null],
    ["g_b50r4", 500, `${THIS_YEAR - 1}-12-02`, "fund_b50scholar"],
    ["g_b50r5", 600, `${THIS_YEAR}-02-09`, "fund_b50scholar"],
    ["g_b50r6", 400, `${THIS_YEAR}-05-21`, null],
  ];
  for (const [id, amt, date, fund] of giftRows) {
    await db.query(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,fund_id) VALUES ($1,'org_creo','d_b50rich',$2,$3,'cash','',$4)`, [id, amt, date, fund]);
  }
  await db.query(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status) VALUES ('rs_b50rich','org_creo','d_b50rich','sub_b50rich',50,'month','active')`);
  await db.query(`INSERT INTO receipts (id,org_id,donor_id,gift_id,type,receipt_number,amount,deductible_amount,snapshot) VALUES
    ('rcpt_b50a','org_creo','d_b50rich','g_b50r5','gift','${THIS_YEAR}-00101',600,600,'{}'),
    ('rcpt_b50b','org_creo','d_b50rich','g_b50r4','gift','${THIS_YEAR - 1}-00087',500,500,'{}')`);
  await db.query(`DELETE FROM impact_updates WHERE id IN ('imp_b50a','imp_b50b')`);
  await db.query(`INSERT INTO impact_updates (id,org_id,title,body,photos,targets,org_wide,status) VALUES
    ('imp_b50a','org_creo','Summer studio scholarships — 22 students','Your giving covered a full summer of studio time, materials included, for twenty-two students who could not otherwise afford it.',$1,$2,false,'published'),
    ('imp_b50b','org_creo','The mural on Fairhope Ave is finished','Forty volunteers, three weekends, one block-long mural. Thank you for making the supplies possible.',$3,'[]',true,'published')`,
    [JSON.stringify([svgPhoto("#8a4a2c", "#e7cf91", "Studio"), svgPhoto("#6b8f7a", "#f0ede6", "Students")]),
     JSON.stringify([{ kind: "fund", id: "fund_b50scholar" }]),
     JSON.stringify([svgPhoto("#c9a84c", "#0f1a12", "Mural")])]);
  await db.query(`INSERT INTO donor_org_follows (id,account_id,org_id) VALUES ('dof_b50fol','da_b50fol','org_creo')`);
  await db.query(`INSERT INTO donor_org_follows (id,account_id,org_id) VALUES ('dof_b50shl','da_b50shl',$1)`, [SHELTER]);

  const richLogin = await j("POST", "/account/login", { email: RICH, password: PW });
  const folLogin = await j("POST", "/account/login", { email: FOL, password: PW });
  const shlLogin = await j("POST", "/account/login", { email: SHL, password: PW });
  ok("all three capture accounts log in", richLogin.status === 200 && folLogin.status === 200 && shlLogin.status === 200);

  // The dashboard payload is the assertion oracle for rendered values/colors.
  const dashR = await fetch(API + "/account/dashboard", { headers: { cookie: "steward_portal=" + encodeURIComponent(cookieHeader(richLogin)) } });
  const dash = await dashR.json();
  ok("rich account linked to exactly CREO with 6 gifts of history", dash.orgs?.length === 1 && dash.orgs[0].lifetime === 2450, dash.orgs?.map(o => o.orgSlug));
  const CREO = dash.orgs[0];
  ok("targeted impact update matched via the fund-designated gift", (dash.impact || []).some(u => u.id === "imp_b50a" && u.matched), dash.impact?.map(u => u.id));
  ok("impact updates carry their photos in the payload", (dash.impact || []).every(u => Array.isArray(u.photos)) && dash.impact.some(u => u.photos.length > 0));

  const browser = await chromium.launch();
  const newPage = async (login, vp) => {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
    if (login) await ctx.addCookies([{ name: "steward_portal", value: cookieHeader(login), url: APP }]);
    const page = await ctx.newPage();
    await page.goto(APP + "/giving", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    return { ctx, page };
  };
  const VPS = [["390", { width: 390, height: 844 }], ["1440", { width: 1440, height: 950 }], ["2560", { width: 2560, height: 1300 }]];
  const trustLine = "Each nonprofit sees only its own relationship";

  // ── PART A — the signed-out landing at all three widths ───────────────────
  for (const [w, vp] of VPS) {
    const { ctx, page } = await newPage(null, vp);
    const heroBg = await page.evaluate(() => {
      const h1 = document.querySelector(".gd-landtitle");
      let el = h1; while (el && getComputedStyle(el).backgroundColor === "rgba(0, 0, 0, 0)") el = el.parentElement;
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    ok(`landing hero sits on the ink field (${w})`, heroBg === "rgb(15, 26, 18)", heroBg);
    const h1Size = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".gd-landtitle")).fontSize));
    if (w === "390") ok("landing headline fluid floor holds at 390", h1Size >= 38 && h1Size <= 48, h1Size);
    if (w === "1440") ok("landing headline is display-scale at 1440", h1Size >= 64, h1Size);
    if (w === "2560") ok("landing headline reaches the wide cap at 2560", h1Size >= 84, h1Size);
    if (w !== "390") {
      const heroH = await page.evaluate(() => document.querySelector(".gd-hero").getBoundingClientRect().height);
      ok(`hero occupies close to the full first viewport (${w})`, heroH >= vp.height * 0.75, heroH);
    }
    if (w === "2560") {
      const wrapW = await page.evaluate(() => document.querySelector(".gd-hero").getBoundingClientRect().width);
      ok("wide breakpoint engages at 2560 (composition not stranded)", wrapW >= 1560, wrapW);
    }
    ok(`auth card is compact: quiet sign-in-link + reset links, no Create-account tab (${w})`,
      await page.locator('button:text-is("Email me a sign-in link")').count() === 1
      && await page.locator('button:text-is("Reset password")').count() === 1
      && await page.locator('button:text-is("Create an account")').count() === 0);
    ok(`hero owns account creation (${w})`, await page.locator('button:text-is("Create your free account")').count() === 1);
    const promise = await page.evaluate(() => {
      const els = [...document.querySelectorAll("section")];
      const band = els.find(s => s.innerText.includes("Your giving is yours."));
      if (!band) return null;
      const r = band.getBoundingClientRect();
      return { w: r.width, bg: getComputedStyle(band).backgroundColor };
    });
    ok(`promise band is FULL-BLEED ink, edge to edge (${w})`,
      promise && promise.bg === "rgb(15, 26, 18)" && Math.abs(promise.w - vp.width) < 2, promise);
    ok(`org-blindness promise stated plainly (${w})`, (await page.innerText("body")).includes("We never share"));
    await page.screenshot({ path: `${OUT}/landing-${w}.png`, fullPage: true });
    await ctx.close();
  }

  // ── PART B — linked takeover at all three widths ─────────────────────────
  for (const [w, vp] of VPS) {
    const { ctx, page } = await newPage(richLogin, vp);
    const banner = await page.evaluate(() => {
      const b = document.querySelector(".gd-tkbanner img");
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { w: r.width, top: r.top };
    });
    ok(`takeover opens with the org header image as a FULL-WIDTH banner (${w})`,
      banner && Math.abs(banner.w - vp.width) < 2, banner);
    ok(`identity plaque carries the org name against the banner (${w})`,
      await page.locator(".gd-tkplaque:has-text('CREO Arts')").count() === 1);
    const stripBg = await page.evaluate(() => {
      const el = document.querySelector(".gd-stats");
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    ok(`giving summary strip wears the ORG primary (${w})`, stripBg === hexToRgbStr(CREO.theme.primary), stripBg);
    ok(`summary shows the real figures (${w})`,
      (await page.innerText(".gd-stats")).includes("$" + Math.round(CREO.ytd).toLocaleString())
      && (await page.innerText(".gd-stats")).includes("$" + Math.round(CREO.lifetime).toLocaleString()));
    const gridCols = await page.evaluate(() => {
      const g = document.querySelector(".gd-imgrid");
      return g ? getComputedStyle(g).gridTemplateColumns.split(" ").length : 0;
    });
    // 2026-08-15 wide-width pass: 1 column at 390, 2 at 1440, 3 at 2560
    // (the >=1600px rule in GivingStyles adds the third track).
    const wantCols = w === "390" ? 1 : w === "1440" ? 2 : 3;
    ok(`impact updates: ${wantCols}-column grid (${w})`, gridCols === wantCols, gridCols);
    ok(`impact updates render their PHOTOS (${w})`,
      await page.locator(".gd-imgrid img").count() >= 2);
    ok(`targeted update renders (${w})`, (await page.innerText("body")).includes("Summer studio scholarships"));
    const stewardMentions = await page.evaluate(() => (document.body.innerText.match(/Steward/g) || []).length);
    ok(`takeover keeps ONE quiet Steward line (${w})`,
      stewardMentions === 1 && await page.getByTestId("steward-quiet-line").count() === 1, stewardMentions);
    ok(`org-site footer band: identity + EIN on the primary color (${w})`, await page.evaluate((prim) => {
      const p = [...document.querySelectorAll("p")].find(x => x.innerText.includes("Tax ID (EIN): 12-3456789"));
      if (!p) return false;
      let el = p; while (el && getComputedStyle(el).backgroundColor === "rgba(0, 0, 0, 0)") el = el.parentElement;
      return el && getComputedStyle(el).backgroundColor === prim;
    }, hexToRgbStr(CREO.theme.primary)));
    ok(`no FOLLOWING card in the linked state (${w})`, !(await page.innerText("body")).includes("You follow this organization"));
    ok(`trust line renders (${w})`, (await page.innerText("body")).includes(trustLine));
    await page.screenshot({ path: `${OUT}/takeover-linked-${w}.png`, fullPage: true });
    if (w === "1440") {
      const tabColor = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find(x => x.innerText === "Home");
        return b ? getComputedStyle(b).borderBottomColor : null;
      });
      ok("active tab underline is the ORG accent, not Steward brass-on-neutral", tabColor === hexToRgbStr(CREO.theme.accent), tabColor);
      await page.click('button:text-is("Receipts & tax")');
      await page.waitForTimeout(700);
      ok("receipts list renders in the takeover (5-year linked fixture)", (await page.innerText("body")).includes(`#${THIS_YEAR}-00101`));
      await page.screenshot({ path: `${OUT}/takeover-tax-1440.png`, fullPage: true });
    }
    await ctx.close();
  }

  // ── PART B — follow-only takeover (the header owns identity; the state bar
  //             carries only affordances) ──────────────────────────────────
  for (const [w, vp] of [["390", { width: 390, height: 844 }], ["1440", { width: 1440, height: 950 }]]) {
    const { ctx, page } = await newPage(folLogin, vp);
    const body = await page.innerText("body");
    ok(`follow-only: FOLLOWING state + affordances at page level (${w})`,
      body.includes("You follow this organization")
      && await page.locator('button:text-is("Connect your history")').count() === 1
      && await page.locator('button:text-is("Unfollow")').count() === 1
      && await page.locator('a:text-is("Give")').count() === 1);
    ok(`follow-only: NO history figures pretending (${w})`, !body.includes("This year") && !body.includes("Lifetime"));
    // NB innerText returns the CSS-TRANSFORMED text ("FOLLOWING" — uppercase
    // eyebrow), so match case-insensitively and take the smallest container.
    ok(`follow-only: the state bar does NOT restate the identity the header owns (${w})`, await page.evaluate(() => {
      const bar = [...document.querySelectorAll("div")]
        .filter(d => /following/i.test(d.innerText) && d.innerText.includes("You follow this organization"))
        .sort((a, b) => a.innerText.length - b.innerText.length)[0];
      return bar ? !bar.innerText.includes("CREO Arts") && !bar.querySelector("img") : false;
    }));
    ok(`follow-only: banner still opens the page (${w})`, await page.locator(".gd-tkbanner img").count() === 1);
    await page.screenshot({ path: `${OUT}/takeover-follow-${w}.png`, fullPage: true });
    await ctx.close();
  }

  // ── PART B — the no-header-image FALLBACK: solid primary band, monogram,
  //             never bare cream ────────────────────────────────────────────
  {
    const { ctx, page } = await newPage(shlLogin, { width: 1440, height: 950 });
    const band = await page.evaluate(() => {
      const name = [...document.querySelectorAll(".gd-tkname")].find(d => d.innerText.includes("Harbor Night Shelter"));
      if (!name) return null;
      let el = name; while (el && getComputedStyle(el).backgroundColor === "rgba(0, 0, 0, 0)") el = el.parentElement;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { bg: getComputedStyle(el).backgroundColor, w: r.width };
    });
    const shDash = await fetch(API + "/account/dashboard", { headers: { cookie: "steward_portal=" + encodeURIComponent(cookieHeader(shlLogin)) } }).then(r => r.json());
    const shPrimary = shDash.followed[0].theme.primary;
    ok("fallback header: full-bleed solid band in the org PRIMARY (never cream)",
      band && band.bg === hexToRgbStr(shPrimary) && Math.abs(band.w - 1440) < 2, { band, shPrimary });
    ok("fallback header carries a monogram (no logo set)", await page.evaluate(() =>
      [...document.querySelectorAll("div")].some(d => d.innerText === "H" && getComputedStyle(d).borderRadius === "10px")));
    ok("no banner img in the fallback state", await page.locator(".gd-tkbanner img").count() === 0);
    await page.screenshot({ path: `${OUT}/takeover-fallback-band-1440.png`, fullPage: true });
    await ctx.close();
  }

  // ── MULTI-ORG neutral shell — add org #2 in-page, then containment sweep ──
  {
    const { ctx, page } = await newPage(richLogin, { width: 1440, height: 950 });
    await page.click("text=+ Add another organization");
    await page.fill('input[aria-label="Search organizations"]', "pantry");
    await page.waitForTimeout(900);
    await page.click('button:has-text("Add")');
    await page.waitForTimeout(1200);
    ok("transition 1→2: neutral shell returns IN-PAGE after adding org #2",
      await page.locator('span:text-is("Your Giving")').count() === 1);
    ok("transition 1→2: both org identities render",
      (await page.innerText("body")).includes("CREO Arts") && (await page.innerText("body")).includes("Open Door Pantry"));
    const leak = await page.evaluate((accentRgb) => {
      const offenders = [];
      for (const el of document.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (cs.borderLeftColor === accentRgb && parseFloat(cs.borderLeftWidth) > 0) {
          const inCreoCard = !!el.closest(".gd-orgcard") && el.closest(".gd-orgcard").innerText.includes("CREO Arts");
          const isImpact = el.innerText.includes("CREO") || (el.closest("div")?.innerText || "").includes("CREO");
          if (!inCreoCard && !isImpact) offenders.push(el.className + "|" + el.tagName);
        }
      }
      return offenders;
    }, hexToRgbStr(CREO.theme.accent));
    ok("multi-org shell: CREO's theme appears only on CREO's own sections", leak.length === 0, leak);
    const headerBg = await page.evaluate(() => {
      const el = [...document.querySelectorAll("div")].find(d => d.innerText.startsWith("Steward") && getComputedStyle(d).borderBottomWidth === "3px");
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    ok("multi-org shell header band is Steward ink, no org color above the fold", headerBg === "rgb(15, 26, 18)", headerBg);
    ok("multi-org: impact photos render inside the org's own cards", await page.locator(".gd-imgrid img").count() >= 2);
    // 2026-08-15 wide-width pass: at 1440 the org + followed cards sit in a
    // 2-track grid (.gd-cardgrid) and — when the fixture renders 2+ cards
    // (here: CREO OrgCard + pantry FollowedCard) — the first two share a row.
    const cardGrid = await page.evaluate(() => {
      const g = document.querySelector(".gd-cardgrid");
      if (!g) return null;
      const tracks = getComputedStyle(g).gridTemplateColumns.split(" ").filter(Boolean).length;
      const kids = [...g.children].map(c => c.getBoundingClientRect());
      const sameRow = kids.length >= 2
        ? kids[0].top < kids[1].bottom && kids[1].top < kids[0].bottom && Math.abs(kids[0].left - kids[1].left) > 10
        : null;
      return { tracks, count: kids.length, sameRow };
    });
    ok("org + followed cards go 2-up on the wide shell (1440)",
      cardGrid && cardGrid.tracks === 2 && (cardGrid.count < 2 || cardGrid.sameRow === true), cardGrid);
    await ctx.close();
  }
  for (const [w, vp] of VPS) {
    const { ctx, page } = await newPage(richLogin, vp);
    ok(`multi-org shell renders neutrally (${w})`, await page.locator('span:text-is("Your Giving")').count() === 1);
    ok(`multi-org trust line (${w})`, (await page.innerText("body")).includes(trustLine));
    await page.screenshot({ path: `${OUT}/shell-multiorg-${w}.png`, fullPage: true });
    await ctx.close();
  }
  // Unfollow the pantry → the takeover returns (the BUILD-48 rule, unchanged).
  {
    const { ctx, page } = await newPage(richLogin, { width: 1440, height: 950 });
    await page.click('button:has-text("Unfollow")');
    await page.waitForTimeout(1200);
    ok("transition 2→1: takeover returns IN-PAGE after removing org #2",
      await page.locator('span:text-is("Your Giving")').count() === 0 && await page.getByTestId("steward-quiet-line").count() === 1);
    await ctx.close();
  }

  // cleanup follows so reruns are stable (the rich donor + theme stay — they
  // make org_creo's scratch dashboard a standing rich demo)
  await db.query(`DELETE FROM donor_org_follows WHERE account_id IN ('da_b50rich','da_b50fol','da_b50shl')`);
  await db.end();
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed — shots in ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

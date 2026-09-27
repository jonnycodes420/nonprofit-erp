// FIX-2 C — LESS GREEN, MORE CREAM (claude/FIX-2.md Part 0 finding 5, Part C).
//
// The 27 September walk: "The sidebar, top bar, Agent room and active states
// are all dark green, and the green reads as the whole app. Cream and white
// are the ground." This suite holds the rule that answers it:
//
//   §1  ONE ACTIVE TREATMENT (source). shared.jsx exports activeMark(on, edge):
//       a selected rail item or tab is cream's shade or white, ink text,
//       weight 700 and a 3px emerald rule on its leading edge — never a solid
//       green or ink block. The rail, the mobile nav and SectionTabs all read
//       it, so there is one place the treatment lives.
//   §2  THE BROWSER, at 1440 and 390, on a fixture org this suite creates:
//       every rail screen (Home, Donors, Fundraising and its four sections,
//       Volunteers, Agent, Reports, Finance, Settings, Dashboards) is visited,
//       and a donor's record, the page those screens open most.
//       (a) The page's content root has a cream or white ground, and none of
//           its large children (a band, a hero card, a panel) is painted ink
//           or a dark green. Ink belongs to the sidebar and the top bar only.
//       (b) The active rail item (1440) or mobile nav tab (390), and every
//           selected tab / segmented control in the content, wears the light
//           treatment: a light ground, ink text, weight ≥ 700 and a 3px
//           emerald rule on one edge.
//
//   (c) At most ONE filled emerald control shows in the content: emerald is
//       the one primary action, never a tab, a band or a second button.
//
// PENDING AT MERGE. Workstream D rebuilds the Agent room (Agent.jsx) to the
// Direction 2 run sheet, where ink is ONLY the margin around a cream sheet,
// and workstream A rebuilds Dashboards.jsx. Until they merge, the checks on
// their files are PRINTED here and not counted; the lead empties PENDING when
// they land. D marks its ink margin with `data-agent-margin` — the one element
// on any screen allowed an ink ground.
//
// A browser leg SKIPs (exit 0) where Playwright or the client dist is missing:
// CI has no Playwright. Screenshots: FIX2_C_SHOTS=docs/fix-2/C writes every
// screen at both widths.

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { readSource } = require("../scripts/lib/readSource");

const BASE = process.env.BASE || "http://localhost:5601";
const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const SHOTS = process.env.FIX2_C_SHOTS || "";
const root = path.join(__dirname, "..");
const haveBrowser = () => {
  try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; }
  return fs.existsSync(path.join(root, "client", "dist", "index.html"));
};

// Checks whose findings are printed but not counted until another
// workstream's branch lands: screen → the checks that wait. EMPTY THIS AT
// MERGE (see the header). The rail/mobile-nav check is this branch's and is
// counted on every screen.
//   agent      — D rebuilds Agent.jsx (the room's ground, its tabs, its buttons)
//   dashboards — A rebuilds Dashboards.jsx (its left list draws the selected
//                dashboard as a solid emerald block)
const PENDING = {
  agent: new Set(["2a-root", "2a-dark", "2b-sel", "2b-unmarked", "2c"]),
  dashboards: new Set(["2b-sel", "2b-unmarked"]),
  //   reports    — B rebuilds Reports.jsx (its period row draws "This FY" as a
  //                solid emerald pill)
  reports: new Set(["2b-sel", "2b-unmarked"]),
};

const RUN = Date.now().toString(36).slice(-6);
const ORG = "org_fx2c_" + RUN;
const ME = `fx2c-${RUN}@example.org`;
const PW = "loadtest1234";

(async () => {
  // ── §1 ONE ACTIVE TREATMENT (source) ────────────────────────────────────
  console.log("\n— §1 one active treatment —");
  const shared = readSource(path.join(root, "client/src/components/shared.jsx"));
  const app = readSource(path.join(root, "client/src/App.jsx"));
  const def = /export function activeMark\(on,\s*edge[^)]*\)\s*\{[\s\S]*?\n\}/.exec(shared);
  ok("§1 shared.jsx exports activeMark(on, edge)", !!def);
  const body = def ? def[0] : "";
  ok("§1 …its text is ink and its weight 700", /color:\s*T\.ink\b/.test(body) && /fontWeight:\s*700/.test(body), body.slice(0, 400));
  ok("§1 …its rule is 3px emerald (T.greenDk)", /3px/.test(body) && /T\.greenDk/.test(body));
  ok("§1 …its ground is cream's shade or white, never emerald or ink",
    /background:\s*(T\.bg2|T\.white|T\.bgCard)/.test(body) && !/background:\s*(T\.ink|T\.greenDk|T\.green\b|T\.bgDark)/.test(body));
  const tabsFn = /export function SectionTabs\([\s\S]*?\n\}/.exec(shared);
  ok("§1 SectionTabs reads activeMark", !!tabsFn && /activeMark\(on/.test(tabsFn[0]));
  ok("§1 …and no longer paints the gold wash (.section-tab-on)", !/\.section-tab-on\{background/.test(shared));
  ok("§1 the rail's sideBtn reads activeMark", /const sideBtn=\([^)]*\)=>\(\{[\s\S]{0,700}activeMark\(active/.test(app));
  ok("§1 the mobile nav's active tab is the light treatment (no brass-on-ink text)",
    !/\.mobile-bottom-tab\.active\{color:/.test(shared) && !/\.mobile-more-row\.active\{color:/.test(shared));

  // ── §2 THE BROWSER ──────────────────────────────────────────────────────
  console.log("\n— §2 the browser —");
  if (!haveBrowser()) {
    console.log("  SKIP  §2 browser leg — no Playwright at " + PW_DIR + " or no client/dist");
    return;
  }

  // Fixture org: a Team org (Finance is behind the Team flag) with a few
  // donors and gifts so the screens draw their real furniture, not empties.
  for (const r of await q(`SELECT id FROM orgs WHERE id LIKE 'org_fx2c_%'`)) {
    for (const t of ["gift_soft_credits", "receipts", "thank_you_drafts", "threads", "tasks", "interactions", "fin_transactions", "gifts", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [r.id]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [r.id]).catch(() => {});
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
           VALUES ($1,'Harbour Lights Choir',$1,1,'active','team','America/New_York',NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Maren Holt','admin')`,
    ["u_" + ORG, ORG, ME, bcrypt.hashSync(PW, 4)]);
  const tok = await login(ME);
  await api("POST", "/org/welcome/seen", tok, {});
  const PEOPLE = [["Ada Park", 1200], ["Bo Lind", 250], ["Cy Moreno", 75], ["Hope Presbyterian Church", 5000], ["Dee Ortiz", 40]];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  let gifts = 0;
  for (const [i, [name, amount]] of PEOPLE.entries()) {
    const id = `d_fx2c_${i}_${RUN}`;
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ($1,$2,$3,$4,'active','steward',0,0)`,
      [id, ORG, name, `fx2c-${i}-${RUN}@example.org`]);
    const r = await api("POST", `/donors/${id}/gifts`, tok, { amount, date: today, type: "cash", idempotencyKey: `fx2c-${RUN}-${i}` });
    if (r.status < 300) gifts++;
  }
  ok("§2 the fixture gifts were recorded through the gift route", gifts === PEOPLE.length, gifts);
  const PROFILE_ID = `d_fx2c_3_${RUN}`;   // Hope Presbyterian Church
  // A goal and a campaign with a goal: Home's and Fundraising's goal cards were
  // the dark pine heroes, and without a goal they do not draw at all.
  const yr = today.slice(0, 4);
  const goal = await api("POST", "/goals", tok, { label: "This year", goalAmount: 20000, goalType: "total_raised", periodStart: `${yr}-01-01`, periodEnd: `${yr}-12-31` });
  const camp = await api("POST", "/fundraising/campaigns", tok, { name: "Spring concert", goalAmount: 8000, startDate: `${yr}-01-01`, endDate: `${yr}-12-31` });
  ok("§2 the fixture goal and campaign were created", goal.status < 300 && camp.status < 300, [goal.status, camp.status]);

  const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
  const browser = await chromium.launch();
  if (SHOTS) fs.mkdirSync(path.join(root, SHOTS), { recursive: true });

  // [name, rail label, fundraising section id or null]
  const SCREENS = [
    ["home", "Home"], ["donors", "Donors"],
    ["fundraising-overview", "Fundraising", "overview"], ["fundraising-campaigns", "Fundraising", "campaigns"],
    ["fundraising-majorgifts", "Fundraising", "majorgifts"], ["fundraising-moneyin", "Fundraising", "moneyin"],
    ["volunteers", "Volunteers"], ["agent", "Agent"], ["reports", "Reports"], ["finance", "Finance"],
    ["settings", "Settings"], ["dashboards", "Dashboards"],
    // Not a rail screen, but the page a rail screen opens most: a donor's
    // record (its right-hand panel was the other ink room in the app).
    ["donor-profile", "@profile"],
  ];

  // Runs in the page. A colour is DARK when it is mostly opaque and its
  // relative luminance is under 0.2: ink (0.01), every pine/evergreen step and
  // emerald (0.08) are; brass (0.42), cream (0.84) and white are not.
  const PAGE_FNS = () => {
    const parse = s => { const m = /rgba?\(([^)]+)\)/.exec(s || ""); if (!m) return null;
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const isDark = c => !!c && c.a >= 0.5 && lum(c) < 0.2;
    const darkImage = s => (String(s).match(/rgba?\([^)]+\)/g) || []).map(parse).some(isDark);
    const ownDark = el => { const cs = getComputedStyle(el); return isDark(parse(cs.backgroundColor)) || (cs.backgroundImage !== "none" && darkImage(cs.backgroundImage)); };
    const effective = el => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
    const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05; };
    const name = el => (el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "")
      + (el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : "") + " “" + (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40) + "”");
    const EMERALD = "rgb(13, 92, 58)";
    // The light active treatment, measured.
    const activeOk = el => {
      const cs = getComputedStyle(el);
      const ground = effective(el);
      const ink = parse(cs.color);
      const rule = ["Left", "Bottom", "Top", "Right"].some(s => parseFloat(cs["border" + s + "Width"]) >= 3 && cs["border" + s + "Color"] === EMERALD && cs["border" + s + "Style"] !== "none")
        || new RegExp(EMERALD.replace(/[()]/g, "\\$&") + "[^,]*inset|inset[^,]*" + EMERALD.replace(/[()]/g, "\\$&")).test(cs.boxShadow) && /(^|\s)-?3px/.test(cs.boxShadow);
      const why = [];
      if (lum(ground) < 0.6) why.push("ground " + cs.backgroundColor);
      if (!ink || lum(ink) > 0.03) why.push("text " + cs.color);
      if (Number(cs.fontWeight) < 700) why.push("weight " + cs.fontWeight);
      if (!rule) why.push("no 3px emerald rule (" + cs.borderLeft + " / " + cs.borderBottom + " / " + cs.boxShadow + ")");
      return why;
    };
    return { isDark, ownDark, effective, visible, name, activeOk, lum };
  };

  for (const [W, H] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const errs = [];
    page.on("pageerror", e => errs.push(String(e).slice(0, 160)));
    const lj = await (await page.request.post(BASE + "/auth/login", { data: { email: ME, password: PW } })).json();
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await page.evaluate(x => { localStorage.setItem("npe_token", x.token); localStorage.setItem("npe_user", JSON.stringify(x.user)); localStorage.setItem("npe_org", JSON.stringify(x.org)); }, lj);
    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    const goRail = async label => {
      const clickIn = sel => page.evaluate(([sel, label]) => {
        // The label is the button's text less its icon glyph and any badge.
        const words = e => e.innerText.toLowerCase().replace(/[^a-z& ]+/g, " ").replace(/\s+/g, " ").trim();
        const b = [...document.querySelectorAll(sel)].filter(e => e.offsetParent && words(e).startsWith(label.toLowerCase()));
        if (!b.length) return false; b[0].click(); return true;
      }, [sel, label]);
      const openMore = sel => page.evaluate(sel => { const b = [...document.querySelectorAll(sel)].find(e => e.offsetParent && /\bmore\b/i.test(e.innerText)); if (b) b.click(); }, sel);
      if (W > 768) {
        if (await clickIn(".app-sidebar button")) return true;
        await openMore(".app-sidebar button[aria-expanded=false]");
        await page.waitForTimeout(300);
        return clickIn(".app-sidebar button");
      }
      if (await clickIn(".mobile-bottom-tab")) return true;
      await openMore(".mobile-bottom-tab");
      await page.waitForTimeout(400);
      return clickIn(".mobile-more-row");
    };

    for (const [scr, label, fr] of SCREENS) {
      const check = (id, n, cond, extra) => {
        if (PENDING[scr] && PENDING[scr].has(id)) console.log(`  ${cond ? "pass" : "fail"}  (PENDING, not counted) ${n}` + (cond ? "" : " — " + JSON.stringify(extra).slice(0, 400)));
        else ok(n, cond, extra);
      };
      const went = label === "@profile"
        ? await page.goto(`${APP}/donors/${PROFILE_ID}`, { waitUntil: "networkidle" }).then(() => true, () => false)
        : await goRail(label);
      await page.waitForTimeout(1300);
      if (fr) { await page.locator(`[data-fr-section="${fr}"]:visible`).first().click().catch(() => {}); await page.waitForTimeout(1000); }
      ok(`§2 ${scr} (${W}) — reached ${label === "@profile" ? "by its URL" : "from the " + (W > 768 ? "rail" : "mobile nav")}`, went);
      if (SHOTS) await page.screenshot({ path: path.join(root, SHOTS, `${W}-${scr}.png`), fullPage: false });

      const found = await page.evaluate(src => {
        const F = eval("(" + src + ")")();
        const content = document.querySelector(".app-content");
        if (!content) return { missing: true };
        const cr = content.getBoundingClientRect();
        const rootGround = F.effective(content);
        const dark = [];
        for (const el of content.querySelectorAll("*")) {
          if (el.closest("[data-agent-margin]")) continue;
          if (el.closest("[role=dialog]")) continue;
          const r = el.getBoundingClientRect();
          if (r.width < Math.min(280, cr.width * 0.6) || r.height < 120) continue;
          if (!F.visible(el)) continue;
          if (F.ownDark(el)) dark.push(F.name(el) + ` ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
        // Selected tabs and segmented controls in the content.
        const sel = [...content.querySelectorAll('[role=tab][aria-selected=true],[aria-current]:not(a),[aria-pressed=true]')]
          .filter(F.visible).map(el => ({ el: F.name(el), why: F.activeOk(el) })).filter(x => x.why.length);
        // The nav item for this screen.
        const navSel = window.innerWidth > 768 ? ".app-sidebar .side-nav-btn[aria-current]" : ".mobile-bottom-tab.active";
        const nav = document.querySelector(navSel);
        // A selection nobody marked: a row of three or more sibling controls
        // where exactly one is filled dark (ink or a green) and every other is
        // unfilled. That is a tab row or a segmented control drawing its
        // selected item as a solid block, whatever attributes it carries.
        const unmarked = [];
        const alpha = el => { const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor); if (!m) return 0; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; };
        for (const parent of new Set([...content.querySelectorAll("button,[role=tab]")].map(b => b.parentElement))) {
          const kids = [...parent.children].filter(k => (k.matches("button,[role=tab],a")) && F.visible(k));
          if (kids.length < 3) continue;
          const filled = kids.filter(F.ownDark);
          if (filled.length !== 1) continue;
          // The rest are the unselected options: unfilled, or all dressed
          // exactly alike (a row of white pills) and the same shape as the
          // filled one. An action toolbar (a gold button beside a white one)
          // is not a set of options, so it is not a finding.
          // The options are the siblings with the filled one's tag and shape
          // (a Download button at the end of a pill row is not an option).
          const shape = k => k.tagName + "|" + getComputedStyle(k).borderTopLeftRadius;
          const rest = kids.filter(k => k !== filled[0] && shape(k) === shape(filled[0]));
          const sig = k => { const c = getComputedStyle(k); return [c.backgroundColor, c.color, c.borderTopColor, c.fontWeight].join("|"); };
          if (rest.length >= 2 && (rest.every(k => alpha(k) < 0.1) || new Set(rest.map(sig)).size === 1)) unmarked.push(F.name(filled[0]));
        }
        // Emerald fill is the ONE primary action: count the filled emerald
        // controls the content shows.
        const EM = "rgb(13, 92, 58)";
        // A colour SWATCH (Settings › Branding's presets, its accent preview) is the
        // org's data drawn as a colour, not a control dressed in emerald.
        const emerald = [...content.querySelectorAll("button,a,[role=button],[role=tab]")].filter(F.visible).filter(b => !b.closest("[data-swatch]"))
          .filter(b => getComputedStyle(b).backgroundColor === EM || /rgb\(13, 92, 58\)/.test(getComputedStyle(b).backgroundImage)).map(F.name);
        return { rootDark: F.isDark(rootGround), rootGround, dark, sel, unmarked, emerald, nav: nav ? { el: F.name(nav), why: F.activeOk(nav) } : null };
      }, PAGE_FNS.toString());

      check("2a-root", `§2a ${scr} (${W}) — the content root's ground is cream or white`, !found.missing && !found.rootDark, found.rootGround);
      check("2a-dark", `§2a ${scr} (${W}) — no large child of the content is ink or dark green`, !found.missing && found.dark.length === 0, found.dark.slice(0, 6));
      check("2b-nav", `§2b ${scr} (${W}) — the active ${W > 768 ? "rail item" : "mobile nav tab"} is the light treatment`,
        !!found.nav && found.nav.why.length === 0, found.nav || "no active nav item marked");
      check("2b-sel", `§2b ${scr} (${W}) — every selected tab / segmented control in the content is the light treatment`,
        !found.missing && found.sel.length === 0, found.sel.slice(0, 4));
      check("2b-unmarked", `§2b ${scr} (${W}) — no tab row or segmented control draws its selection as a solid dark block`,
        !found.missing && found.unmarked.length === 0, found.unmarked.slice(0, 4));
      check("2c", `§2c ${scr} (${W}) — at most ONE filled emerald control (the one primary action)`,
        !found.missing && found.emerald.length <= 1, found.emerald.slice(0, 8));
    }
    ok(`§2 no page errors while walking (${W})`, errs.length === 0, errs.slice(0, 3));
    await page.close();
  }
  await browser.close();
})()
  .catch(e => ok("the suite ran to the end", false, String(e && e.stack || e).slice(0, 400)))
  .finally(async () => { await closeDb().catch(() => {}); summary(); });

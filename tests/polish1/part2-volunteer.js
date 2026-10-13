// POLISH-1 Part 2 · THE VOLUNTEER SIGN-UP LINK WORKS.
//
// The walk: Reach handed out a link that opened "This sign-up link is not
// valid", and the recruitment page (/volunteer-with/<org>, the page whose form
// feeds Pending applications) had no Vercel rewrite, so on the live site it
// fell through to the app shell. This section follows the link Reach hands out
// exactly as a volunteer would:
//   §2a with no recruitment page, the standing link opens a form, accepts a
//       sign-up and says "You're in. <Org> will be in touch this week."
//   §2b with the page published, Reach hands out THE PAGE; it opens, its
//       short form (name, email, phone, availability) accepts an application,
//       the volunteer sees "You're in", and it lands in Pending applications
//   §2c Reach says whether the link expires, before she copies it
//   §2d every path Reach hands out is proxied to the API by vercel.json (the
//       live site), not swallowed by the app shell
//   §2e one volunteer who gives reads "who also gives", never "one of them"
//   §2f (browser leg) the handed-out page opens on the app host and a
//       submit shows "You're in", at 1440 and 390
//
// WHAT WOULD MAKE THIS FAIL (planted before trusted): Reach handing out the
// standing link while a page is published (§2b red); the /volunteer-with
// rewrite removed from vercel.json (§2d red); the old "Thank you" pages
// (§2a/§2b red); no expiry sentence (§2c red); "one of them" (§2e red).
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");

const ORG = "org_pol1vol";
const SLUG = "pol1-vol";
const ADMIN = "admin@pol1vol.local";
const ORG_NAME = "Polish Volunteers Fixture";

async function wipe(h) {
  const tables = (await h.q(`SELECT table_name FROM information_schema.columns
                              WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await h.q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await h.q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
}

const words = html => String(html).replace(/<[^>]+>/g, " ").replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
const pathOf = url => { const u = new URL(url); return u.pathname + u.search; };

module.exports = async function part2(h) {
  const { ok, api, q, BASE } = h;
  await wipe(h);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [ORG, ORG_NAME, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_pol1vol',$1,$2,$3,'Polish Admin','admin')`,
    [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 4)]);
  const tok = await h.login(ADMIN);
  // The recruitment page is per org; make sure ours starts unpublished.
  await q(`DELETE FROM volunteer_recruitment WHERE org_id=$1`, [ORG]).catch(() => {});

  try {
    // ── §2a the standing link, with no page ─────────────────────────────────
    let link = (await api("GET", "/volunteer-hub/signup-link", tok)).body;
    ok("§2a with no page, Reach hands out the standing link", link && link.kind === "link" && /\/volunteer\/join\?token=/.test(link.url || ""), link);
    const g = await fetch(BASE + pathOf(link.url));
    const gt = await g.text();
    ok("§2a the standing link opens a form, not 'not valid'", g.status === 200 && /name="email"/.test(gt) && !/not valid/i.test(gt), { status: g.status, body: words(gt).slice(0, 160) });
    const token = new URL(link.url).searchParams.get("token");
    const p = await fetch(BASE + "/volunteer/join", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, name: "Rosa Standing", email: "rosa.standing@pol1vol.local", phone: "555-0101", availability: "Saturdays" }).toString() });
    const pt = words(await p.text());
    ok("§2a a sign-up from it reads \"You're in. <Org> will be in touch this week.\"",
      p.status === 200 && pt.includes("You're in.") && pt.includes(`${ORG_NAME} will be in touch this week.`), pt.slice(0, 200));
    // GIVE-EDIT-1: the standing link waits for a person, like the published
    // page. It is an application in Pending applications, not a roster row;
    // approving it is what makes the person a volunteer.
    const [onRoster] = await q(`SELECT id FROM donors WHERE org_id=$1 AND email='rosa.standing@pol1vol.local'`, [ORG]);
    ok("§2a the sign-up is not put straight on the roster", !onRoster, onRoster);
    const pend = (await api("GET", "/volunteer-hub/applications", tok)).body;
    const rosaApp = (pend.applications || []).find(a => a.email === "rosa.standing@pol1vol.local");
    ok("§2a the sign-up waits in Pending applications", rosaApp && rosaApp.status === "pending", pend.applications);
    const appr = await api("POST", `/volunteer-hub/applications/${rosaApp && rosaApp.id}/approve`, tok, {});
    const [rosa] = await q(`SELECT id, person_types FROM donors WHERE org_id=$1 AND email='rosa.standing@pol1vol.local'`, [ORG]);
    ok("§2a approving it puts them on the record as a Volunteer", appr.status === 200 && !!rosa && JSON.stringify(rosa.person_types).includes("volunteer"), { status: appr.status, rosa });

    // ── §2c the expiry sentence ─────────────────────────────────────────────
    ok("§2c Reach says whether the link expires, before she copies it",
      link.expires === false && /does not expire/.test(link.expirySentence || ""), link);

    // ── §2b the published page ──────────────────────────────────────────────
    const pub = await api("PUT", "/volunteer-hub/recruitment", tok, { title: "Volunteer with the fixture", bodyHtml: "<p>Saturdays at the pantry.</p>", questions: [], published: true });
    ok("§2b the recruitment page is published", pub.status === 200 && pub.body.published === true, pub.body);
    link = (await api("GET", "/volunteer-hub/signup-link", tok)).body;
    ok("§2b with the page published, Reach hands out the page itself",
      link && link.kind === "page" && new URL(link.url).pathname === `/volunteer-with/${SLUG}`, link);
    ok("§2b ...and says the page link does not expire either", link.expires === false && /does not expire/.test(link.expirySentence || ""), link);
    const page = await fetch(BASE + pathOf(link.url));
    const pageT = await page.text();
    ok("§2b the page opens with an Apply button", page.status === 200 && pageT.includes(`/volunteer-with/${SLUG}/apply`), { status: page.status });
    const form = await fetch(`${BASE}/volunteer-with/${SLUG}/apply`);
    const formT = await form.text();
    ok("§2b its form is short: name, email, phone, availability",
      form.status === 200 && ["name=\"name\"", "name=\"email\"", "name=\"phone\"", "name=\"availability\""].every(s => formT.includes(s)), { status: form.status });
    const body = new URLSearchParams({ name: "Theo Applicant", email: "theo.applicant@pol1vol.local", phone: "555-0102" });
    body.append("availability", "Weekends");
    const ap = await fetch(`${BASE}/volunteer-with/${SLUG}/apply`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
    const apT = words(await ap.text());
    ok("§2b applying reads \"You're in. <Org> will be in touch this week.\"",
      ap.status === 200 && apT.includes("You're in.") && apT.includes(`${ORG_NAME} will be in touch this week.`), apT.slice(0, 200));
    const apps = (await api("GET", "/volunteer-hub/applications", tok)).body;
    ok("§2b the application waits in Pending applications",
      apps && (apps.applications || []).some(a => a.email === "theo.applicant@pol1vol.local" && a.status === "pending"), apps && apps.applications);

    // ── §2d the live site proxies every path Reach hands out ────────────────
    const { loadRewrites } = require(path.join(__dirname, "..", "..", "scripts", "local-preview.js"));
    const rules = loadRewrites();
    const proxied = p0 => rules.some(([re]) => re.test(p0));
    for (const p0 of ["/volunteer/join", `/volunteer-with/${SLUG}`, `/volunteer-with/${SLUG}/apply`])
      ok(`§2d vercel.json sends ${p0} to the API, not the app shell`, proxied(p0));

    // ── §2e one volunteer who gives ─────────────────────────────────────────
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name)
             VALUES ('g_pol1vol_1',$1,$2,25,$3,'cash','system:test','POLISH-1 fixture')`, [ORG, rosa.id, h.civilToday()]);
    const roster = (await api("GET", "/volunteer-hub/roster", tok)).body;
    ok("§2e one volunteer who gives reads \"who also gives\"",
      roster.people.length === 1 && /One volunteer on the roster, who also gives\./.test(roster.sentence || ""), roster.sentence);

    // ── §2f the browser leg ─────────────────────────────────────────────────
    await browserLeg(h, link.url);
  } finally {
    await wipe(h);
  }
};

async function browserLeg(h, handedUrl) {
  const ROOT = path.join(__dirname, "..", "..");
  const DIST = path.join(ROOT, "client", "dist");
  const APP = process.env.APP_URL || "http://localhost:4173";
  const skip = why => h.browserLegOrSkip(why, "§2f");
  if (!fs.existsSync(path.join(DIST, "index.html"))) return skip("client/dist not built");
  let chromium;
  try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); }
  catch { return skip("Playwright not found (set PLAYWRIGHT_DIR)"); }
  const up = await fetch(APP + "/").then(r => r.ok).catch(() => false);
  if (!up) return skip(`no preview answering at ${APP}`);
  const shots = process.env.POLISH1_SHOTS || "";
  const browser = await chromium.launch();
  try {
    for (const [w, hgt] of [[1440, 900], [390, 844]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, serviceWorkers: "block" });
      const page = await ctx.newPage();
      // The link exactly as copied, on the app's host: the path Vercel serves.
      const u = new URL(handedUrl);
      await page.goto(APP + u.pathname + u.search, { waitUntil: "domcontentloaded", timeout: 30000 });
      const apply = page.locator(`a[href$="/apply"]`).first();
      const hasApply = await apply.isVisible({ timeout: 8000 }).catch(() => false);
      h.ok(`§2f at ${w}, the copied link opens the recruitment page on the app host`, hasApply, await page.title());
      if (shots) await page.screenshot({ path: path.join(shots, `part2-page-${w}.png`), fullPage: true });
      if (!hasApply) { await ctx.close(); continue; }
      await apply.click();
      await page.fill('input[name="name"]', `Walker ${w}`);
      await page.fill('input[name="email"]', `walker${w}@pol1vol.local`);
      await page.fill('input[name="phone"]', "555-0199");
      if (shots) await page.screenshot({ path: path.join(shots, `part2-form-${w}.png`), fullPage: true });
      await Promise.all([page.waitForLoadState("domcontentloaded"), page.locator('button[type="submit"]').click()]);
      const txt = await page.locator("body").innerText().catch(() => "");
      h.ok(`§2f at ${w}, a submit shows "You're in" and when they will hear`, /You're in\./.test(txt) && /will be in touch this week/.test(txt), txt.slice(0, 160));
      if (shots) await page.screenshot({ path: path.join(shots, `part2-done-${w}.png`), fullPage: true });
      await ctx.close();
    }
  } finally { await browser.close(); }
}

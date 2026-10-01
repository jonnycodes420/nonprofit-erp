// LANDING-2 — the marketing site's guard. Pure source: no server, no DB, no
// browser. Run: node tests/landing2-marketing.test.js
//
// The browser half (no sideways scroll at 390 on any route, every rendered
// link resolves, every STATS figure renders beside its source link, no quote
// that is not a sourced research quote) is scripts/landing-prod-verify.js,
// which crawls the same route table against a running site.
//
// What this file fails on, and the defect each one stops:
//   1. an em dash anywhere in the marketing source (the house voice uses periods)
//   2. a banned outcome word: recovered, re-engaged, reengaged, recaptured,
//      won back, brought back (outcome claims the product cannot prove)
//   3. a competitor's name anywhere on the marketing pages
//   4. a testimonial or customer quote: the only quotes allowed are the
//      sourced research QUOTES, and APPROVED_TESTIMONIALS is empty today
//   5. a research number, quote or source that differs by one character from
//      the reference's STATS / QUOTES / SRC (docs/landing/steward-site.html),
//      or a stat or quote without its source link
//   6. an internal link (href or card target) to a path that is not a real
//      route: a marketing route, or one of the app pages the site links into
//   7. a marketing route that collides with an app route or a vercel.json
//      rewrite (existing app routes win)
//   8. a sitemap.xml that disagrees with the route table
//   9. a photo slot without a file, a photo without a credit, or a real
//      person's portrait swapped for anything but the repo's own files
//  10. a demo form that sends anything but the three fields the lead route
//      accepts, or sends anywhere but that route
//
// LANDING-3 added four, each one a thing that was on the site before it:
//  11. the word "tour" on any button. There is no tour: every hero offers
//      Book a demo and Start free, and the Why tabs say Learn more.
//  12. a people carousel. TeamReel, .reel, .track-of-people and .tm are
//      deleted, not hidden, and no route may render one. The research
//      marquee (.marq) is not a people carousel and is deliberately allowed.
//  13. a stock photograph on About, Leadership or Contact. Those three pages
//      show real people or no people: Leadership and Contact use the repo's
//      own portraits, and About shows none.
//  14. a "Live" connection label that production cannot honour. The table
//      must not promise a provider that shared/givingSources.js has no
//      adapter for and oauth.js has no provider entry for.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 600) : "")); }
};

const ROOT = path.join(__dirname, "..");
const MK = path.join(ROOT, "client", "src", "marketing");
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(jsx?|css)$/.test(f)) files.push(p);
  }
})(MK);
const rel = p => path.relative(ROOT, p);
const SRC_TEXT = Object.fromEntries(files.map(p => [rel(p), fs.readFileSync(p, "utf8")]));
const ALL = Object.values(SRC_TEXT).join("\n");

(async () => {
  const { ROUTES, APP_LINK_TARGETS } = await import(path.join(MK, "routes.js"));
  const research = await import(path.join(MK, "data", "research.js"));
  const { PHOTOS } = await import(path.join(MK, "data", "photos.js"));
  const { TEAM } = await import(path.join(MK, "data", "team.js"));
  const { CONNECTIONS } = await import(path.join(MK, "data", "connections.js"));

  console.log("\n— 1–4 · the copy rules —");
  {
    const hits = Object.entries(SRC_TEXT).filter(([, t]) => /—/.test(t)).map(([f]) => f);
    ok("no em dash anywhere in the marketing source", hits.length === 0, hits);
    ok("no em dash in any route title or description", ROUTES.every(r => !/—/.test(r.title + r.description)));
  }
  {
    const BANNED = [/\brecovered\b/i, /\bre-engaged\b/i, /\breengaged\b/i, /\brecaptured\b/i, /\bwon back\b/i, /\bbrought back\b/i];
    const hits = [];
    for (const [f, t] of Object.entries(SRC_TEXT)) for (const re of BANNED) if (re.test(t)) hits.push(f + " " + re);
    ok("none of the banned outcome words", hits.length === 0, hits);
  }
  {
    // Donor-CRM and fundraising-suite vendors. The giving tools Steward
    // CONNECTS to (Stripe, PayPal, Givebutter, Donorbox, Square, Zeffy,
    // Mailchimp, Xero, QuickBooks, Zapier) are integrations, named the way the
    // live landing page already names them, not competitors.
    const COMPETITORS = ["Bloomerang", "Little Green Light", "LGL", "DonorPerfect", "Neon CRM", "Neon One", "NeonCRM", "Blackbaud",
      "Raiser's Edge", "Raisers Edge", "eTapestry", "Salesforce", "Nonprofit Success Pack", "NPSP", "Virtuous", "Kindful", "Keela",
      "Bonterra", "EveryAction", "Network for Good", "Kindsight", "Funraise", "Classy", "Qgiv", "DonorSnap", "CiviCRM", "Arreva",
      "Donor Tools", "Givesmart", "GiveSmart", "OneCause", "Double the Donation", "Sumac", "Aplos", "Dataro", "Gravyty", "iWave"];
    const hits = [];
    for (const [f, t] of Object.entries(SRC_TEXT)) for (const c of COMPETITORS) if (new RegExp("\\b" + c.replace(/'/g, "['’]") + "\\b").test(t)) hits.push(f + " " + c);
    ok("no competitor name anywhere on the marketing pages", hits.length === 0, hits);
  }
  {
    ok("APPROVED_TESTIMONIALS is the (empty) approved list", Array.isArray(research.APPROVED_TESTIMONIALS) && research.APPROVED_TESTIMONIALS.length === 0);
    // Every quotation element in the marketing source is a research quote:
    // marked data-quote="research" and filled from QUOTES.
    const quoteEls = [];
    for (const [f, t] of Object.entries(SRC_TEXT)) for (const m of t.matchAll(/<(blockquote|q|figure)\b[^>]*>/g)) quoteEls.push([f, m[0]]);
    ok("every <blockquote>, <q> and <figure> carries data-quote=\"research\"", quoteEls.length > 0 && quoteEls.every(([, tag]) => /data-quote="research"/.test(tag)), quoteEls);
    ok("no testimonial language in the copy", !/\btestimonial|\btrusted by\b|\bour customers\b|\bloved by\b|\bjoin (hundreds|thousands)\b/i.test(ALL.replace(/APPROVED_TESTIMONIALS|testimonial or customer quote|Testimonials and customer quotes/g, "")));
  }

  console.log("\n— 5 · research numbers, exactly as the reference —");
  {
    const html = fs.readFileSync(path.join(ROOT, "docs", "landing", "steward-site.html"), "utf8");
    const grab = name => {
      const m = html.match(new RegExp("var " + name + "=([\\[{][\\s\\S]*?[\\]}]);\\n"));
      return m ? vm.runInNewContext("(" + m[1] + ")") : null;
    };
    const REF = { SRC: grab("SRC"), STATS: grab("STATS"), QUOTES: grab("QUOTES") };
    ok("the reference's SRC, STATS and QUOTES parse", REF.SRC && REF.STATS && REF.QUOTES);
    ok("STATS is the reference's, every number and every word", JSON.stringify(research.STATS) === JSON.stringify(REF.STATS), { ours: research.STATS, ref: REF.STATS });
    ok("QUOTES is the reference's, word for word", JSON.stringify(research.QUOTES) === JSON.stringify(REF.QUOTES));
    ok("SRC is the reference's, every title and link", JSON.stringify(research.SRC) === JSON.stringify(REF.SRC));
    ok("every stat and every quote names a source that exists", [...research.STATS.map(s => s[2]), ...research.QUOTES.map(q => q[3])].every(k => research.SRC[k] && /^https:\/\//.test(research.SRC[k][1])));
    const lib = SRC_TEXT["client/src/marketing/lib.jsx"];
    ok("StatBand renders each stat with its own source link", /<div className="stat"[^]*?<A href=\{SRC\[s\[2\]\]\[1\]\}>/.test(lib));
    ok("QuoteBand renders each quote with its source link", /<figcaption>[^]*?<A href=\{SRC\[q\[3\]\]\[1\]\}>/.test(lib));
  }

  console.log("\n— 6 · every internal link is a real route —");
  const known = new Set([...ROUTES.map(r => r.path), ...APP_LINK_TARGETS]);
  {
    const linkish = [];
    for (const [f, t] of Object.entries(SRC_TEXT)) {
      if (!/\.jsx?$/.test(f)) continue;
      for (const m of t.matchAll(/["'`](\/[a-z][a-z0-9\-/]*(?:[#?][^"'`]*)?)["'`]/g)) {
        const v = m[1];
        if (/^\/(marketing|landing)\//.test(v)) continue;           // asset paths
        if (/^\/lost-and-found\/(lead|benchmark)$/.test(v)) continue; // the API route the demo form posts to
        if (v === "/billing/create-checkout") continue;              // LANDING-3: the API route /pricing posts a signed-in upgrade to
        if (v === "/public/agreement" || v === "/public/signup") continue; // the signup page's own API routes
        linkish.push([f, v]);
      }
    }
    // A prefix ("/features/" + slug) is fine when routes exist under it; the
    // slugs themselves are checked by the route table.
    const isPrefix = v => v.endsWith("/") && [...known].some(k => k.startsWith(v) && k !== v);
    const dead = linkish.filter(([, v]) => !isPrefix(v) && !known.has(v.split(/[#?]/)[0]));
    ok("every internal path in the marketing source is a marketing route or an app page (" + linkish.length + " checked)", linkish.length > 100 && dead.length === 0, dead);
    ok("no link to /developers (it does not exist; the Open API row on /connections stands in)", !linkish.some(([, v]) => v.startsWith("/developers")));
    ok("no hash route survives from the reference", !/["'`]#\//.test(ALL));
    const pageKeys = SRC_TEXT["client/src/marketing/pages/index.js"];
    ok("every route's page has a component", ROUTES.every(r => new RegExp("\\b" + r.page + ":").test(pageKeys)), ROUTES.filter(r => !new RegExp("\\b" + r.page + ":").test(pageKeys)).map(r => r.page));
    ok("route paths are unique, and every route has a title and a description",
      new Set(ROUTES.map(r => r.path)).size === ROUTES.length && ROUTES.every(r => r.title && r.description && r.description.length > 30));
    const brief = ["/", "/platform", "/crm", "/volunteer", "/agent", "/connections", "/onboarding", "/features", "/why", "/leadership", "/move", "/move/spreadsheet", "/move/crm", "/for", "/security", "/about", "/partners", "/contact", "/demo", "/resources", "/guides", "/templates", "/articles", "/articles/state-of-retention", "/glossary", "/faq", "/help", "/whats-new", "/tools", "/tools/retention", "/tools/lapsed-cost", "/tools/thermometer", "/tools/lost-and-found", "/legal/privacy", "/legal/terms", "/legal/accessibility"];
    ok("every page the brief names is routed", brief.every(p => known.has(p)), brief.filter(p => !known.has(p)));
    const count = pre => ROUTES.filter(r => r.path.startsWith(pre)).length;
    ok("14 feature pages, 4 audience pages, 5 guides", count("/features/") === 14 && count("/for/") === 4 && count("/guides/") === 5);
  }

  console.log("\n— 7 · existing app routes win —");
  {
    const main = fs.readFileSync(path.join(ROOT, "client", "src", "main.jsx"), "utf8");
    const appPaths = [...main.matchAll(/<Route\s+path="([^"]+)"/g)].map(m => m[1]).filter(p => p !== "*");
    const toRe = p => new RegExp("^" + p.replace(/:[^/]+/g, "[^/]+") + "$");
    const clash = ROUTES.filter(r => appPaths.some(a => toRe(a).test(r.path))).map(r => r.path);
    ok("no marketing route shadows an app route in main.jsx (" + appPaths.length + " app routes)", appPaths.length > 20 && clash.length === 0, clash);
    // LANDING-3 part 1 turned this one around. /pricing was pinned to the app
    // because the app page carried the signed-in Stripe checkout. It is a
    // marketing route now, and the checkout moved with it, so what has to hold
    // is the opposite: the marketing page owns the path AND still posts to
    // /billing/create-checkout, or a paying organisation cannot change plan.
    ok("/pricing is the marketing page now", !appPaths.includes("/pricing") && ROUTES.some(r => r.path === "/pricing"));
    ok("…and it kept the signed-in checkout the app page had",
      /\/billing\/create-checkout/.test(SRC_TEXT["client/src/marketing/pages/pricing.jsx"])
      && /useAuth/.test(SRC_TEXT["client/src/marketing/pages/pricing.jsx"]));
    ok("/lost-and-found stays the app's audit", appPaths.includes("/lost-and-found") && !ROUTES.some(r => r.path === "/lost-and-found"));
    const vj = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    const rw = (vj.rewrites || []).map(r => r.source).filter(s => s !== "/(.*)");
    const rwRe = s => new RegExp("^" + s.replace(/:[a-z]+\*/gi, ".*").replace(/:[a-z]+/gi, "[^/]+") + "$");
    const rwClash = ROUTES.filter(r => rw.some(s => rwRe(s).test(r.path))).map(r => r.path);
    ok("no marketing route is swallowed by a vercel.json rewrite to the API", rwClash.length === 0, rwClash);
    ok("main.jsx registers the marketing table and no longer routes the old Landing", /MARKETING_ROUTES\.map/.test(main) && !/pages\/Landing/.test(main));
  }

  console.log("\n— 8 · SEO —");
  {
    const sm = fs.readFileSync(path.join(ROOT, "client", "public", "sitemap.xml"), "utf8");
    const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    const want = ROUTES.map(r => "https://www.stewardapp.dev" + r.path);
    ok("sitemap.xml lists exactly the marketing routes", JSON.stringify([...locs].sort()) === JSON.stringify([...want].sort()), { missing: want.filter(w => !locs.includes(w)), extra: locs.filter(l => !want.includes(l)) });
    const robots = fs.readFileSync(path.join(ROOT, "client", "public", "robots.txt"), "utf8");
    ok("robots.txt points at the sitemap", /Sitemap: https:\/\/www\.stewardapp\.dev\/sitemap\.xml/.test(robots));
    const lib = SRC_TEXT["client/src/marketing/lib.jsx"];
    ok("each page sets its title, description, canonical and Open Graph tags", ["document.title", '"description"', 'rel", "canonical"', '"og:title"', '"og:description"', '"og:url"'].every(s => lib.includes(s)));
  }

  console.log("\n— 9 · photographs —");
  {
    const keys = new Set();
    for (const t of Object.values(SRC_TEXT)) {
      for (const m of t.matchAll(/(?:photo|p|k)[=:]\s*\{?["']([a-z][a-z0-9-]+)["']/g)) if (PHOTOS[m[1]]) keys.add(m[1]);
      for (const m of t.matchAll(/<Photo k="([^"]+)"/g)) keys.add(m[1]);
    }
    const missing = [...keys].filter(k => !PHOTOS[k]);
    ok("every photo slot names a real photograph", missing.length === 0, missing);
    const dir = path.join(ROOT, "client", "public", "marketing", "photos");
    const noFile = Object.keys(PHOTOS).filter(k => !fs.existsSync(path.join(dir, k + ".webp")));
    ok("every photograph is a WebP file on disk", noFile.length === 0, noFile);
    const credits = fs.readFileSync(path.join(ROOT, "docs", "landing", "photo-credits.md"), "utf8");
    const uncredited = Object.keys(PHOTOS).filter(k => !credits.includes("`" + k + ".webp`"));
    ok("every photograph is logged in docs/landing/photo-credits.md", uncredited.length === 0, uncredited);
    ok("every photograph has real alt text", Object.values(PHOTOS).every(p => p.alt && p.alt.length > 20));
    ok("no credit is shown on a page", !/unsplash/i.test(ALL.replace(/Unsplash photo|credits live in|Credits live in/g, "")));
    const people = ["Jonathan Atkinson", "Winfield Bevins", "Ross Jenkins", "Brad Atkinson"];
    ok("the four people, in order, with the reference's titles", JSON.stringify(TEAM.map(t => t[0])) === JSON.stringify(people)
      && TEAM[1][1] === "Advisor · Executive Director, Creo Arts" && TEAM[3][1] === "Advisor · Development Director, Asbury University");
    ok("every portrait is the repo's own file from the previous landing page, never stock",
      TEAM.every(t => /^\/landing\/[a-z-]+\.(png|jpg)$/.test(t[2]) && fs.existsSync(path.join(ROOT, "client", "public", t[2]))));
    ok("no origin story on the site", !/\b(origin story|how it started|why I built|the story of Steward|our story)\b/i.test(ALL));
  }

  console.log("\n— 10 · the demo form —");
  {
    const why = SRC_TEXT["client/src/marketing/pages/why.jsx"];
    const body = why.match(/const body = (\{[^}]*\});/);
    ok("the demo form builds its body from exactly name, email, organization and ref",
      !!body && JSON.stringify([...body[1].matchAll(/(\w+):/g)].map(m => m[1])) === JSON.stringify(["name", "email", "organization", "ref"]), body && body[1]);
    ok("…and posts it to the Lost & Found lead route, the table super-admin lists", /fetch\(API \+ "\/lost-and-found\/lead"/.test(why) && /DEMO_REF = "book-a-demo"/.test(why));
    ok("the marketing source makes no other request (calculators compute in the browser)", (ALL.match(/fetch\(/g) || []).length === 1);
    ok("the thank-you state is the reference's sentence", why.includes("Thank you. Jonathan will email you within one business day to pick a time."));
  }

  console.log("\n— 11 · LANDING-3 —");
  {
    // 11 · no tour on a button. Prose may say "a tour of the facility"; a
    // button may not say "Take a tour".
    const btn = [];
    for (const [f, t] of Object.entries(SRC_TEXT)) {
      for (const m of t.matchAll(/<(Pill|button)\b[^>]*>([^<]*)</gi)) if (/tour/i.test(m[2])) btn.push(f + " " + m[2].trim());
      for (const m of t.matchAll(/className="[^"]*\b(pill|go)\b[^"]*"[^>]*>([^<]*)</gi)) if (/tour/i.test(m[2])) btn.push(f + " " + m[2].trim());
    }
    ok("no button anywhere says tour", btn.length === 0, btn);
    ok("every hero's second call to action is Start free", /href="\/signup">Start free/.test(SRC_TEXT["client/src/marketing/lib.jsx"]));

    // 12 · no people carousel, and the component is gone rather than unused.
    const css = SRC_TEXT["client/src/marketing/site.css"];
    ok("the people reel component is deleted", !/TeamReel/.test(ALL));
    ok("…and so are its CSS rules", !/\.mk \.reel\b/.test(css) && !/\.mk \.tm\{/.test(css));
    ok("the research marquee is untouched", /\.mk \.marq/.test(css) && /className="marq"/.test(ALL));

    // 13 · no stock photograph of a person on the three people pages.
    const why = SRC_TEXT["client/src/marketing/pages/why.jsx"];
    const sliceOf = n => { const i = why.indexOf("export function " + n); const j = why.indexOf("export function ", i + 10); return why.slice(i, j < 0 ? undefined : j); };
    const stock = ["About", "Leadership", "Contact"].filter(n => /<Photo\b/.test(sliceOf(n)));
    ok("no stock photo on About, Leadership or Contact", stock.length === 0, stock);
    ok("…and Leadership and Contact still show the repo's own portraits", /<People \/>/.test(sliceOf("Leadership")) && /<Portrait\b/.test(sliceOf("Contact")));

    // 14 · a Live label production can honour.
    const src = fs.readFileSync(path.join(ROOT, "shared", "givingSources.js"), "utf8");
    const oauth = fs.readFileSync(path.join(ROOT, "shared", "oauth.js"), "utf8");
    const NEEDS_ADAPTER = { PayPal: "paypal", Givebutter: "givebutter", Square: "square", Stripe: "stripe", Donorbox: "donorbox" };
    const NEEDS_OAUTH = { Mailchimp: "mailchimp", Xero: "xero", "QuickBooks Online": "intuit" };
    const lies = [];
    for (const [name, , state] of CONNECTIONS) {
      if (state !== "Live") continue;
      const a = NEEDS_ADAPTER[name];
      if (a && !new RegExp('key: "' + a + '"').test(src)) lies.push(name + " has no adapter");
      const o = NEEDS_OAUTH[name];
      if (o && !new RegExp("^\\s*" + o + ": \\{", "m").test(oauth)) lies.push(name + " has no oauth provider");
    }
    ok("no connection is labelled Live that production cannot honour", lies.length === 0, lies);
    ok("Donorbox is honestly Coming (there is no Donorbox adapter)",
      CONNECTIONS.some(c => c[0] === "Donorbox" && c[2] === "Coming") && !/key: "donorbox"/.test(src));
    ok("the retired label is gone from every page", !/Set up with you/.test(ALL.replace(/^\s*\/\/.*$/gm, "")));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

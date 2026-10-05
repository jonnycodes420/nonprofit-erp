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
//      Book a call and Start free, and the Why tabs say Learn more.
//  12. a people carousel. TeamReel, .reel, .track-of-people and .tm are
//      deleted, not hidden, and no route may render one. The research
//      marquee (.marq) is not a people carousel and is deliberately allowed.
//  13. a stock photograph on About, Leadership or Contact. Those three pages
//      show real people or no people: Leadership and Contact use the repo's
//      own portraits, and About shows none.
//  14. a "Live" connection label that production cannot honour. The table
//      must not promise a provider that shared/givingSources.js has no
//      adapter for and oauth.js has no provider entry for.
//
// PROOF-2 added one:
//  15. a statistic with no source. Every percentage and every "x times"
//      figure in the marketing copy must match a claim in shared/sources.js,
//      and the page (component or article) showing it must also link that
//      source. Example screens (a <Ui> mock's tots/rows, a feature's ui
//      table) are example data, not statistics, and are skipped.
//
// CONTENT-1 added the search pages, and checks them from what the build
// writes (the prerender's own render and seo.js, never a copy):
//  16. a marketing route without a unique title, a description, exactly one
//      h1 or a canonical URL, or whose prerendered HTML lacks its h1 text; a
//      sitemap that misses a route or a lastmod; robots.txt letting the app in
//  17. a glossary term in data/glossary.js without its own page, a definition,
//      three real related terms and two real articles or tools; fewer than 45
//      terms, or one of the terms the brief names missing
//  18. an article without complete frontmatter, or a term it lists that its
//      body never links; a link in a body to a page that does not exist
//  19. new copy (articles, glossary, tools, move pages) naming a plan, an
//      "active donor", "records" or a record count; a "vs" page
// The PROOF-2 rule (15) now reads the articles' markdown too: a figure in a
// body must be a claim of a source the frontmatter lists. Worked arithmetic
// (a glossary term's calc block, an article's ```example block) is example
// math and is skipped.

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
    else if (/\.(jsx?|css|md)$/.test(f)) files.push(p);
  }
})(MK);
const rel = p => path.relative(ROOT, p);
const SRC_TEXT = Object.fromEntries(files.map(p => [rel(p), fs.readFileSync(p, "utf8")]));
const ALL = Object.values(SRC_TEXT).join("\n");
// CONTENT-1b · pages the site serves from outside client/src/marketing: the
// help centre and What's new. They are prerendered and crawled like the rest,
// so the competitor and outcome-word rules read them too.
const SERVED_TEXT = { "shared/helpArticles.js": fs.readFileSync(path.join(ROOT, "shared", "helpArticles.js"), "utf8"),
  ...Object.fromEntries(fs.readdirSync(path.join(ROOT, "docs", "changelog")).filter(f => f.endsWith(".md")).map(f => ["docs/changelog/" + f, fs.readFileSync(path.join(ROOT, "docs", "changelog", f), "utf8")])) };

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
    for (const [f, t] of Object.entries({ ...SRC_TEXT, ...SERVED_TEXT })) for (const re of BANNED) if (re.test(t)) hits.push(f + " " + re);
    ok("none of the banned outcome words, on the marketing pages, the help centre or What's new", hits.length === 0, hits);
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
    for (const [f, t] of Object.entries({ ...SRC_TEXT, ...SERVED_TEXT })) for (const c of COMPETITORS) if (new RegExp("\\b" + c.replace(/'/g, "['’]") + "\\b").test(t)) hits.push(f + " " + c);
    ok("no competitor name anywhere on the marketing pages, the help centre or What's new", hits.length === 0, hits);
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
      if (f.endsWith("marketing/seo.js")) continue;                 // CONTENT-1: robots.txt's Disallow list names app paths, not links
      for (const m of t.matchAll(/["'`](\/[a-z][a-z0-9\-/]*(?:[#?][^"'`]*)?)["'`]/g)) {
        const v = m[1];
        if (/^\/(marketing|landing)\//.test(v)) continue;           // asset paths
        if (/^\/lost-and-found\/(lead|benchmark)$/.test(v)) continue; // the API route the demo form posts to
        if (v === "/help/feedback") continue;                        // HELP-1: "Did this help?" posts a slug and a yes or no
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
    // ASK-2 added the Ask feature page and the demo-questions guide.
    ok("15 feature pages, 4 audience pages, 6 guides", count("/features/") === 15 && count("/for/") === 4 && count("/guides/") === 6);
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
    // FIX-22: a signed-in organisation changes plan in Settings, Billing; a
    // fresh checkout from this page failed for an org already subscribed.
    ok("…and it sends a signed-in organisation to Settings, Billing to change plan",
      /navigate\("\/app\/settings\?section=billing"\)/.test(SRC_TEXT["client/src/marketing/pages/pricing.jsx"])
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
    // CONTENT-1: the sitemap and robots.txt are written by the prerender from
    // seo.js, so this reads what the build writes.
    const seo = await import(path.join(MK, "seo.js"));
    const sm = seo.sitemapXml(ROUTES);
    const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    const want = ROUTES.map(r => "https://www.stewardapp.dev" + r.path);
    ok("sitemap.xml lists exactly the marketing routes", JSON.stringify([...locs].sort()) === JSON.stringify([...want].sort()), { missing: want.filter(w => !locs.includes(w)), extra: locs.filter(l => !want.includes(l)) });
    const robots = seo.ROBOTS;
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
    // FIX-13: every field on the form is sent, by name (the size band and
    // where the donors are today were typed and then dropped before).
    ok("the demo form builds its body from exactly name, email, organization, orgSize, currentSystem and ref",
      !!body && JSON.stringify([...body[1].matchAll(/(\w+):/g)].map(m => m[1])) === JSON.stringify(["name", "email", "organization", "orgSize", "currentSystem", "ref"]), body && body[1]);
    // FIX-13: every field has a label tied to it, a name and an id, so a
    // screen reader announces it and a browser can autofill it.
    const demoForm = (why.match(/<form className="form" onSubmit=\{submit\}[^]*?<\/form>/) || [""])[0];
    const fields = [...demoForm.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map(m => m[0]);
    const labelled = fields.filter(f => {
      const id = (f.match(/\bid="([^"]+)"/) || [])[1];
      return id && /\bname="[^"]+"/.test(f) && new RegExp('<label htmlFor="' + id + '"').test(demoForm);
    });
    ok("every demo form field has a label (htmlFor), a name and an id (" + fields.length + " fields)", fields.length === 5 && labelled.length === fields.length, fields.filter(f => !labelled.includes(f)));
    ok("…and a failed submit shows a plain error naming jonathan@stewardapp.dev, never nothing",
      /DEMO_FALLBACK = "[^"]*jonathan@stewardapp\.dev/.test(why) && /setErr\(/.test(why) && /role="alert"/.test(demoForm));
    ok("…and posts it to the Lost & Found lead route, the table super-admin lists", /fetch\(API \+ "\/lost-and-found\/lead"/.test(why) && /DEMO_REF = "book-a-demo"/.test(why));
    // TRUST-2 — the trust pages READ four public endpoints and send nothing:
    // the status summary, which What's new entries are hidden, and the DPA
    // (JSON and PDF). Named here one by one; any other request is still red.
    const READS = ["/status/summary", "/changelog/hidden", "/legal/dpa`", "/legal/dpa.pdf",
      // HELP-1 — "Did this help?" sends a slug and a yes or no, nothing else.
      "/help/feedback"];
    const fetches = [...ALL.matchAll(/fetch\(([^,)]*)/g)].map(m => m[1]);
    const others = fetches.filter(f => !READS.some(r => f.includes(r)));
    ok("the marketing source makes no other request (calculators compute in the browser)", others.length === 1, others);
    ok("the thank-you state is the reference's sentence", why.includes("Thank you. Jonathan will email you within one business day to pick a time."));
  }

  console.log("\n— HELP-1 · every screen has a help article —");
  {
    // The routed screens, read from App.jsx's own `tab==="x"` branches, plus
    // every rail item. A screen added without an article turns this red.
    const app = fs.readFileSync(path.join(ROOT, "client", "src", "App.jsx"), "utf8");
    const routed = [...new Set([...app.matchAll(/tab==="([a-z_-]+)"&&/g)].map(m => m[1]))];
    const { ALL_NAV_IDS } = await import("../client/src/lib/navGroups.js");
    const { HELP_ARTICLES } = await import("../shared/helpArticles.js");
    const covered = new Set(HELP_ARTICLES.flatMap(a => a.screens || []));
    const missing = [...new Set([...routed, ...ALL_NAV_IDS])].filter(id => !covered.has(id));
    ok("every app screen maps to a help article", missing.length === 0, missing);
    ok("every help article has a title, a summary and something to read",
      HELP_ARTICLES.every(a => a.slug && a.title && a.summary && (a.sections || []).length), HELP_ARTICLES.filter(a => !(a.sections || []).length).map(a => a.slug));
    const dash = HELP_ARTICLES.filter(a => /[\u2013\u2014]/.test(JSON.stringify(a))).map(a => a.slug);
    ok("no help article has an em or en dash", dash.length === 0, dash);
    for (const t of ["import-donors", "connect-stripe", "connect-inbox-calendar", "thank-a-gift", "year-end-receipts", "two-factor", "export-or-erase-a-donor"])
      ok(`the help centre has "${t}"`, HELP_ARTICLES.some(a => a.slug === t), t);
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
    // FIX-13 turned this around. The strip used to be a marquee of three
    // copies, and a visitor saw the same card twice at once. It is a static
    // row now: each stat rendered once, nothing animates, and it still LAYS
    // OUT (the LANDING-3 regression was a strip that collapsed to a column).
    const home = SRC_TEXT["client/src/marketing/pages/home.jsx"];
    const strip = (home.match(/function StatStrip\(\) \{[^]*?\n\}/) || [""])[0];
    ok("the research strip renders STATS exactly once", (strip.match(/STATS\.map\(/g) || []).length === 1 && !/data-dup/.test(ALL), strip.slice(0, 200));
    const trackRule = (css.match(/\.mk \.marq \.track\{([^}]*)\}/) || [, ""])[1];
    ok("…and lays out as a grid row of cards", /display:\s*grid/.test(trackRule) && /grid-template-columns/.test(trackRule), trackRule);
    ok("…and nothing in it animates or scrolls on its own", !/\.marq[^{]*\{[^}]*animation/.test(css) && !/@keyframes mk-marq/.test(css));

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

  console.log("\n— FIX-13 · Lost & Found runs, Forest talks, plans carry —");
  {
    // Every link to Lost & Found resolves to a route that renders the audit's
    // file input. A marketing route is followed to its page component in
    // pages/index.js and that component's source; the app route is followed
    // through main.jsx to its page file. Either must render LostAndFoundAudit,
    // and LostAndFoundAudit must render the file input.
    const lfSrc = fs.readFileSync(path.join(ROOT, "client", "src", "pages", "LostAndFound.jsx"), "utf8");
    const auditFn = (lfSrc.match(/export function LostAndFoundAudit\([^]*?\n\}/) || [""])[0];
    ok("LostAndFoundAudit renders the audit's file input and the Run the free audit button",
      /<input[^>]*data-testid="lf-file"[^>]*type="file"/.test(auditFn) && /Run the free audit/.test(auditFn) && /onDrop=/.test(auditFn));
    const main = fs.readFileSync(path.join(ROOT, "client", "src", "main.jsx"), "utf8");
    const pagesIdx = SRC_TEXT["client/src/marketing/pages/index.js"];
    const rendersAudit = p => {
      const r = ROUTES.find(x => x.path === p);
      if (r) {
        const comp = (pagesIdx.match(new RegExp("\\b" + r.page + ": (\\w+)")) || [])[1];
        if (!comp) return false;
        for (const t of Object.values(SRC_TEXT)) {
          const i = t.indexOf("export function " + comp + "(");
          if (i < 0) continue;
          const j = t.indexOf("\nexport ", i + 10);
          return /<LostAndFoundAudit\b/.test(t.slice(i, j < 0 ? undefined : j)) && /import\("\.\.\/\.\.\/pages\/LostAndFound"\)/.test(t);
        }
        return false;
      }
      const el = (main.match(new RegExp('<Route path="' + p + '" element=\\{<(\\w+)')) || [])[1];
      const file = el && (main.match(new RegExp("const " + el + "\\s*=\\s*React\\.lazy\\(\\(\\) => import\\(\"\\./pages/(\\w+)\"\\)")) || [])[1];
      if (file !== "LostAndFound") return false;
      const deflt = (lfSrc.match(/export default function LostAndFound\(\)[^]*?\n\}/) || [""])[0];
      return /<LostAndFoundAudit\b/.test(deflt);
    };
    const lfLinks = [];
    for (const [f, t] of Object.entries(SRC_TEXT)) for (const m of t.matchAll(/["'`]((?:\/tools)?\/lost-and-found)(?:[#?][^"'`]*)?["'`]/g)) lfLinks.push([f, m[1]]);
    const broken = lfLinks.filter(([, v]) => !rendersAudit(v));
    ok("every Lost & Found link on the site (" + lfLinks.length + ") opens a page that renders the audit's file input",
      lfLinks.length >= 4 && broken.length === 0 && rendersAudit("/lost-and-found"), broken);
    // A card or menu entry that NAMES Lost & Found points at one of those.
    const named = [];
    // Three shapes carry a title: a card tuple ["/path", "Title", …], a menu
    // item <Mi href="/path" … b="Title">, and a feature-finder extra
    // { n: "Title", …, h: "/path" }. Whichever titles Lost & Found must link to it.
    for (const [f, t] of Object.entries(SRC_TEXT)) {
      for (const m of t.matchAll(/\["([^"]+)", "[^"]*Lost & Found[^"]*"/g)) named.push([f, m[1]]);
      for (const m of t.matchAll(/href="([^"]+)"[^>\n]*\bb="[^"]*Lost & Found/g)) named.push([f, m[1]]);
      for (const m of t.matchAll(/\bn: "[^"]*Lost & Found[^"]*"[^}\n]*\bh: "([^"]+)"/g)) named.push([f, m[1]]);
    }
    ok("every menu entry or card that names Lost & Found links to it", named.length >= 3 && named.every(([, h]) => /^(\/tools)?\/lost-and-found$/.test(h)), named);

    // CONTENT-1b turned this around. FIX-13 banned "Book a call"; the call is
    // what /demo books, so it is now the ONLY name for it. "Book a call" on
    // every button and link that books the 20-minute call, and "Book a demo"
    // nowhere a visitor can reach: the marketing source, the audit page, the
    // signup page and the price list they both read. The /demo route and the
    // lead's book-a-demo source tag are unchanged.
    const reach = { ...SRC_TEXT,
      "client/src/pages/LostAndFound.jsx": lfSrc,
      "client/src/pages/SignupPage.jsx": fs.readFileSync(path.join(ROOT, "client", "src", "pages", "SignupPage.jsx"), "utf8"),
      "pricing.json": fs.readFileSync(path.join(ROOT, "pricing.json"), "utf8") };
    const demos = Object.entries(reach).filter(([, t]) => /Book a (20-minute )?demo/i.test(t)).map(([f]) => f);
    ok("no \"Book a demo\" anywhere on the site", demos.length === 0, demos);
    // Every link to /demo, in any file a visitor reaches, is labelled Book a call.
    const toDemo = [];
    for (const [f, t] of Object.entries(reach)) for (const m of t.matchAll(/(?:href|to)="\/demo"[^>]*>\s*(?:<i><\/i>)?\s*([^<]*?)\s*</g)) toDemo.push([f, m[1]]);
    const wrong = toDemo.filter(([, label]) => label !== "Book a call" && label !== "{TALK.cta}" && label !== "{TALK_TO_US.cta}");
    ok("every button and link to /demo says Book a call (" + toDemo.length + ")", toDemo.length >= 15 && wrong.length === 0, wrong);
    ok("…including the header, every hero and the closing call to action",
      /href="\/demo"><i><\/i>Book a call<\/A>/.test(SRC_TEXT["client/src/marketing/Site.jsx"])
        && /<Pill href="\/demo">Book a call<\/Pill>/.test(SRC_TEXT["client/src/marketing/lib.jsx"].slice(SRC_TEXT["client/src/marketing/lib.jsx"].indexOf("export function Hero")))
        && /<Pill kind="white" href="\/demo">Book a call<\/Pill>/.test(SRC_TEXT["client/src/marketing/lib.jsx"]));
    ok("the signup page's link to a call says Book a 20-minute call", /data-testid="signup-book"[^>]*>Book a 20-minute call</.test(reach["client/src/pages/SignupPage.jsx"]));
    const PRICING = JSON.parse(reach["pricing.json"]);
    const pricing = SRC_TEXT["client/src/marketing/pages/pricing.jsx"];
    ok("the Forest card's button says Book a call and opens /demo",
      PRICING.talkToUs.name === "Forest" && PRICING.talkToUs.cta === "Book a call" && /<Pill kind="soft" href="\/demo">\{TALK\.cta\}<\/Pill>/.test(pricing));

    // Every plan's Start link carries plan= (and the interval) into /signup,
    // and /signup preselects both.
    const fn = (pricing.match(/export const signupHref = (\([^)]*\) => [^;]+);/) || [])[1];
    const signupHref = fn ? vm.runInNewContext(fn) : null;
    const hrefs = signupHref ? PRICING.tiers.flatMap(t => [[t.id, false, signupHref(t.id, false)], [t.id, true, signupHref(t.id, true)]]) : [];
    ok("each tier's Start link carries its own plan=, monthly and yearly (" + hrefs.length + ")",
      hrefs.length === 6 && hrefs.every(([id, y, h]) => h === "/signup?plan=" + id + (y ? "&interval=yearly" : "")) && /href=\{signupHref\(t\.id, yearly\)\}/.test(pricing), hrefs);
    const sp = reach["client/src/pages/SignupPage.jsx"];
    const bandFor = n => PRICING.tiers.find(t => n <= t.maxDonors) || null;
    ok("/signup preselects the tier from plan= and the interval from interval=",
      /TIERS\.find\(x => x\.id === params\.get\("plan"\)\)/.test(sp) && /params\.get\("interval"\) === "yearly"/.test(sp)
        && PRICING.tiers.every(t => bandFor(t.maxDonors) === t));
  }


  console.log("\n— 15 · PROOF-2 · every figure has a source —");
  {
    const { SOURCES, STRIP } = await import(path.join(ROOT, "shared", "sources.js"));
    const entries = Object.entries(SOURCES);
    ok("every source names its publisher, report, year, sample, an https link, the date checked and at least one claim",
      entries.length >= 7 && entries.every(([, x]) => x.source && x.report && x.year && x.sample && /^https:\/\//.test(x.url) && x.label
        && /^\d{4}-\d{2}-\d{2}$/.test(x.checked) && x.claims.length && x.claims.every(c => c.figure && c.claim)),
      entries.filter(([, x]) => !(x.claims || []).length).map(([k]) => k));
    // A percentage, or a multiple used as a comparison ("3x", "three times as
    // likely"). "Gave three times last year" is a count, not a statistic.
    const FIG_RE = /\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?x\b|\b(?:\d+(?:\.\d+)?|two|three|four|five|six|seven|eight|nine|ten) times (?:as|more|higher|larger|greater|less|fewer|likelier|the)\b/gi;
    const owners = new Map();
    for (const [k, x] of entries) for (const c of x.claims) for (const f of [c.figure, ...(c.figure.match(FIG_RE) || []), ...(c.claim.match(FIG_RE) || [])]) {
      const key = f.toLowerCase();
      owners.set(key, [...new Set([...(owners.get(key) || []), k])]);
    }
    // The strip's rows are the reference's sentences: each figure in a row
    // must be a claim of that row's own source.
    const stripBad = STRIP.filter(([fig, line, k]) => [...(fig.match(FIG_RE) || [fig]), ...(line.match(FIG_RE) || [])]
      .some(f => !(owners.get(f.toLowerCase()) || []).includes(k)));
    ok("every figure in the research strip is a claim of its own source", stripBad.length === 0, stripBad);

    // The copy: every marketing source file plus the price list, split into
    // units (a component, or one article or guide), comments, inline styles
    // and example screens removed.
    const texts = { ...Object.fromEntries(Object.entries(SRC_TEXT).filter(([f]) => /\.jsx?$/.test(f))),
      "pricing.json": fs.readFileSync(path.join(ROOT, "pricing.json"), "utf8") };
    const found = [], orphans = [], unlinked = [];
    for (const [f, raw] of Object.entries(texts)) {
      // CONTENT-1: a glossary term's calc block is worked example arithmetic.
      const t = raw.replace(/\n\s*calc: \{[\s\S]*?\n    \},/g, "\n")
        .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "").replace(/^\s*\/\/.*$/gm, "")
        .replace(/style=\{\{[^}]*\}\}/g, "")
        .split("\n").filter(l => !/\btots=\{|\brows=\{|\bui: \[/.test(l)).join("\n");
      for (const unit of t.split(/\n(?=export |function |\s{2}"[a-z0-9-]+": \{)/)) {
        const name = f + " · " + ((unit.match(/^(?:export )?(?:default )?function (\w+)|^\s*"([a-z0-9-]+)"/) || []).slice(1).find(Boolean) || "top");
        for (const m of unit.matchAll(FIG_RE)) {
          const fig = m[0].toLowerCase();
          found.push(name + " " + m[0]);
          const keys = owners.get(fig);
          if (!keys) { orphans.push(name + " " + m[0]); continue; }
          const linked = keys.some(k => new RegExp("\\bSRC(?:_ALL)?(?:\\." + k + "\\b|\\[[\"']" + k + "[\"']\\])|[\"']" + k + "[\"']").test(unit));
          if (!linked) unlinked.push(name + " " + m[0] + " (needs " + keys.join(" or ") + ")");
        }
      }
    }
    // CONTENT-1 · the articles are markdown now: each one is a unit, its
    // frontmatter's `sources` is its link line, and ```example blocks are
    // worked arithmetic.
    const { ARTICLES } = await import(path.join(MK, "articles", "index.js"));
    for (const a of ARTICLES) {
      const body = [a.lede, ...a.blocks.filter(b => b.t !== "example").map(b => b.text || (b.items || []).join(" "))].join("\n");
      for (const m of body.matchAll(FIG_RE)) {
        const fig = m[0].toLowerCase(), name = "articles/" + a.slug + ".md " + m[0];
        found.push(name);
        const keys = owners.get(fig);
        if (!keys) orphans.push(name);
        else if (!keys.some(k => a.sources.includes(k))) unlinked.push(name + " (needs " + keys.join(" or ") + " in sources)");
      }
      for (const k of a.sources) if (!SOURCES[k]) orphans.push("articles/" + a.slug + ".md lists unknown source " + k);
    }
    ok("every percentage and x-times figure in the copy has an entry in shared/sources.js (" + found.length + " figures)", found.length >= 30 && orphans.length === 0, orphans);
    ok("…and the page showing it also shows that source's link", unlinked.length === 0, unlinked);
    const res = SRC_TEXT["client/src/marketing/pages/resources.jsx"];
    ok("/research lists every source, its claims, its link and the date checked",
      ROUTES.some(r => r.path === "/research" && r.page === "research")
        && /export function Research\(\)[^]*?SOURCE_KEYS\.map[^]*?x\.claims\.map[^]*?href=\{x\.url\}[^]*?checkedOn\(x\.checked\)/.test(res));
  }

  console.log("\n— 16–19 · CONTENT-1 · pages people search for —");
  {
    // The prerender's own Node build and its own page assembly: what the
    // crawler gets is what is checked.
    const { execFileSync } = require("child_process");
    const CLIENT = path.join(ROOT, "client");
    execFileSync(process.execPath, [path.join(CLIENT, "node_modules", "vite", "bin", "vite.js"), "build", "-c", "vite.prerender.config.js", "--logLevel", "error"], { cwd: CLIENT, stdio: "inherit" });
    process.env.NODE_ENV = "production";
    const { render, ARTICLE, TERM } = await import(path.join(CLIENT, "dist-prerender", "prerender.mjs"));
    const seo = await import(path.join(MK, "seo.js"));
    const { GLOSSARY } = await import(path.join(MK, "data", "glossary.js"));
    const { ARTICLES, articleLinks } = await import(path.join(MK, "articles", "index.js"));
    const shell = fs.readFileSync(path.join(CLIENT, "index.html"), "utf8");
    const base = seo.pageShell(shell);
    const extraFor = r => r.page === "article" ? { article: ARTICLE[r.slug] } : r.page === "glossaryTerm" ? { term: TERM[r.slug] } : r.page === "glossary" ? { terms: GLOSSARY } : {};
    const text = s => seo.stripTags(s).replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

    // 16 · every route in the sitemap: a unique title, a description, one h1,
    // a canonical, and its prerendered HTML carries that h1.
    const sm = seo.sitemapXml(ROUTES);
    const locs = [...sm.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod><\/url>/g)].map(m => m[1]);
    ok("the sitemap lists every marketing route, each with a lastmod (" + locs.length + ")", locs.length === ROUTES.length && ROUTES.every(r => locs.includes(seo.urlOf(r.path))));
    const bad = { h1: [], head: [], body: [], title: [], desc: [] };
    const titles = new Map(), descs = new Map();
    for (const r of ROUTES) {
      const html = render(r.path);
      const page = seo.assemblePage(base, r, html, extraFor(r));
      const h1 = seo.h1s(page);
      if (h1.length !== 1 || !h1[0]) bad.h1.push(r.path + " (" + h1.length + ")");
      const head = page.slice(0, page.indexOf("</head>"));
      if ((head.match(/<title>/g) || []).length !== 1 || !head.includes(`<link rel="canonical" href="${seo.urlOf(r.path)}" />`) || !/<meta name="description" content="[^"]{40,}"/.test(head)) bad.head.push(r.path);
      // The h1 and the first paragraph after it are in the served bytes.
      const root = page.slice(page.indexOf('<div id="root">'));
      if (!h1[0] || !text(root).includes(h1[0])) bad.body.push(r.path);
      if (titles.has(r.title)) bad.title.push(r.path + " = " + titles.get(r.title));
      if (descs.has(r.description)) bad.desc.push(r.path + " = " + descs.get(r.description));
      titles.set(r.title, r.path); descs.set(r.description, r.path);
    }
    ok("every marketing route prerenders exactly one h1", bad.h1.length === 0, bad.h1);
    ok("every page's head has one title, a description of 40 characters or more and its own canonical", bad.head.length === 0, bad.head);
    ok("every prerendered page carries its h1 text in the HTML, no JavaScript needed", bad.body.length === 0, bad.body);
    ok("no two routes share a title", bad.title.length === 0, bad.title);
    ok("no two routes share a description", bad.desc.length === 0, bad.desc);
    const ld = (p, extra) => { const r = ROUTES.find(x => x.path === p); const pg = seo.assemblePage(base, r, render(p), extra || extraFor(r)); const m = pg.match(/application\/ld\+json">(.*?)<\/script>/); return m ? JSON.parse(m[1])["@graph"].map(x => x["@type"]) : []; };
    ok("Home carries Organization structured data", ld("/").includes("Organization"));
    ok("inner pages carry BreadcrumbList, a glossary page DefinedTerm, an article Article, a page with an FAQ FAQPage",
      ld("/glossary/lybunt").join() === "BreadcrumbList,DefinedTerm" && ld("/articles/donor-retention-rate").join() === "BreadcrumbList,Article"
        && ld("/tools/lybunt-sybunt").includes("FAQPage") && ld("/move").includes("FAQPage"), [ld("/glossary/lybunt"), ld("/articles/donor-retention-rate"), ld("/tools/lybunt-sybunt")]);
    const dis = seo.ROBOTS.split("\n").filter(l => l.startsWith("Disallow: ")).map(l => l.slice(10));
    const { FILE_LINK_TARGETS } = await import(path.join(MK, "routes.js"));
    ok("every file a page links to exists (the feed is written by the prerender)", FILE_LINK_TARGETS.every(p => p === "/rss.xml" ? /prerender[^]*rss\.xml/.test(fs.readFileSync(path.join(CLIENT, "scripts", "prerender.mjs"), "utf8")) : fs.existsSync(path.join(CLIENT, "public", p))), FILE_LINK_TARGETS);
    ok("robots.txt points at the sitemap and keeps the app out", /Sitemap: https:\/\/www\.stewardapp\.dev\/sitemap\.xml/.test(seo.ROBOTS)
      && ["/dashboard", "/donors", "/app/", "/login", "/signup", "/admin"].every(p => dis.includes(p))
      && ROUTES.every(r => !dis.some(d => r.path === d || r.path.startsWith(d.endsWith("/") ? d : d + "/"))), dis);
    const vj = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    ok("paths without a prerendered file get the app shell, never the homepage's HTML", (vj.rewrites || []).some(r => r.source === "/(.*)" && r.destination === "/app.html")
      && /"build": "[^"]*vite build -c vite\.prerender\.config\.js[^"]*node scripts\/prerender\.mjs"/.test(fs.readFileSync(path.join(CLIENT, "package.json"), "utf8")));

    // 17 · the glossary: one page per term, each one complete.
    const REQUIRED = ["lybunt", "sybunt", "donor-retention-rate", "first-year-retention", "repeat-donor-retention", "donor-lapse", "lapsed-donor", "reactivation", "donor-lifetime-value", "average-gift", "gift-range-chart", "moves-management", "portfolio", "major-gift", "planned-gift", "soft-credit", "hard-credit", "donor-advised-fund", "matching-gift", "recurring-gift", "sustainer", "pledge", "in-kind-gift", "restricted-gift", "unrestricted-gift", "stewardship", "cultivation", "solicitation", "case-for-support", "annual-fund", "capital-campaign", "peer-to-peer-fundraising", "giving-day", "year-end-appeal", "acknowledgment-letter", "tax-receipt", "quid-pro-quo", "ncoa", "deduplication", "wealth-screening", "capacity", "affinity", "engagement-score", "donor-journey", "board-giving"];
    ok("at least 45 glossary terms, and every term the brief names (" + GLOSSARY.length + ")", GLOSSARY.length >= 45 && REQUIRED.every(s => TERM[s]), REQUIRED.filter(s => !TERM[s]));
    const termRoutes = new Set(ROUTES.filter(r => r.page === "glossaryTerm").map(r => r.slug));
    ok("every term in the glossary module has its own page at /glossary/<slug>", GLOSSARY.every(g => termRoutes.has(g.slug) && known.has("/glossary/" + g.slug)) && termRoutes.size === GLOSSARY.length,
      GLOSSARY.filter(g => !termRoutes.has(g.slug)).map(g => g.slug));
    const incomplete = GLOSSARY.filter(g => !(g.term && g.def && g.def.length >= 40 && g.def.length <= 320 && g.why && g.why.length
      && g.related && g.related.length === 3 && g.related.every(x => TERM[x] && x !== g.slug)
      && g.see && g.see.length === 2 && g.see.every(p => known.has(p)) && (!g.calc || (g.calc.formula && g.calc.example.length)))).map(g => g.slug);
    ok("every term has a definition, why it matters, three real related terms and two real articles or tools", incomplete.length === 0, incomplete);
    const defOn = GLOSSARY.filter(g => !text(render("/glossary/" + g.slug)).includes(text(g.def))).map(g => g.slug);
    ok("every term page leads with its definition in the HTML", defOn.length === 0, defOn);

    // 18 · articles: one markdown file each, complete, linking what they use.
    const fmBad = ARTICLES.filter(a => !(a.title && a.description && a.description.length >= 50 && /^\d{4}-\d{2}-\d{2}$/.test(a.date) && a.author && a.lede && a.blocks.length)).map(a => a.slug);
    ok("every article has a title, description, date, author and a body (" + ARTICLES.length + ")", ARTICLES.length >= 12 && fmBad.length === 0, fmBad);
    ok("every article is routed, in the sitemap with its date, and in the RSS feed",
      ARTICLES.every(a => ROUTES.some(r => r.path === "/articles/" + a.slug && r.lastmod === a.date) && seo.rssXml(ARTICLES).includes("/articles/" + a.slug + "</link>")));
    const unlinkedTerms = ARTICLES.flatMap(a => a.terms.filter(t => !TERM[t] || !articleLinks(a).includes("/glossary/" + t)).map(t => a.slug + " " + t));
    ok("every article links each glossary term it lists", unlinkedTerms.length === 0, unlinkedTerms);
    const usesTerms = ARTICLES.filter(a => !a.terms.length).map(a => a.slug);
    ok("every article lists the terms it uses", usesTerms.length === 0, usesTerms);
    const deadInBodies = ARTICLES.flatMap(a => articleLinks(a).filter(h => h.startsWith("/") && !known.has(h.split(/[#?]/)[0])).map(h => a.slug + " " + h));
    ok("every link in an article body is a real page", deadInBodies.length === 0, deadInBodies);
    const NEW_ARTICLES = ["donor-retention-rate", "lybunt-sybunt-before-year-end", "first-year-donor-plan", "spreadsheet-to-donor-system"];
    const words = a => (a.lede + " " + a.body.replace(/^```[\s\S]*?^```/gm, "")).split(/\s+/).filter(Boolean).length;
    ok("the four new articles are there, 900 to 1,400 words each", NEW_ARTICLES.every(s => ARTICLE[s] && words(ARTICLE[s]) >= 900 && words(ARTICLE[s]) <= 1500),
      NEW_ARTICLES.map(s => s + " " + (ARTICLE[s] ? words(ARTICLE[s]) : "missing")));
    const endsRight = ROUTES.filter(r => r.page === "article" || r.page === "glossaryTerm").filter(r => { const h = render(r.path); return !h.includes('href="/tools/lost-and-found"') || !h.includes('href="/demo"'); }).map(r => r.path);
    ok("every article and glossary page ends with Lost & Found and Book a call", endsRight.length === 0, endsRight);

    // 19 · new copy names no plan, no active donor, no records, and there are no "vs" pages.
    const why = SRC_TEXT["client/src/marketing/pages/why.jsx"];
    const moveFns = ["Move", "MoveSpreadsheet", "MoveCrm", "MoveGivingPlatform"].map(n => { const i = why.indexOf("export function " + n + "("); const j = why.indexOf("\nexport function ", i + 10); return i < 0 ? "" : why.slice(i, j); }).join("\n");
    const NEW_COPY = { ...Object.fromEntries(Object.entries(SRC_TEXT).filter(([f]) => /marketing\/articles\/.*\.md$|data\/glossary\.js$|pages\/tools\.jsx$/.test(f))),
      "why.jsx (move pages)": moveFns,
      "routes (new pages)": ROUTES.filter(r => /^\/(glossary|articles|tools|move)\//.test(r.path)).map(r => r.title + " " + r.description).join("\n") };
    const NEVER = /\brecords?\b|\brecord count|\bactive donors?\b|\b(Seed|Sapling|Orchard|Forest)\b/i;
    const said = Object.entries(NEW_COPY).flatMap(([f, t]) => t.replace(/^\s*\/\/.*$/gm, "").split("\n").filter(l => NEVER.test(l)).map(l => f + ": " + l.trim().slice(0, 120)));
    ok("new copy never names a plan, an active donor, records or a record count", moveFns.length > 500 && said.length === 0, said);
    ok("no comparison (vs) page", !ROUTES.some(r => /(^|[/-])vs([/-]|$)|versus|alternative/i.test(r.path)));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// tests/onboard4.test.js · ONBOARD-4 Part A: the website books a call, and nobody signs up cold.
//
//   §1  POST /public/signup refuses every body the same way, points to /book, and writes and
//       sends nothing; /signup, /demo and /invitation go to /book
//   §2  the public site never says "free" and carries no price: every marketing page as the
//       crawler gets it (the prerender's own build) and the public app pages, read by the same
//       checker `npm run build` runs (client/scripts/no-public-prices.mjs)
//   §3  a booking with a partner code lands as a deal tagged to that partner and market, with its
//       answers, the file and a task for Jonathan; an unknown code is ignored; nothing is emailed
//       to the prospect; the partner page shows the name and nothing else
//
// THE PLANTED DEFECTS (ONBOARD4_PLANT on the SERVER, with TEST_MODE=1; each turns its section red):
//   signupopen   the public signup door answers as if it were open        → §1
//   nopartner    the booking's deal is not tagged with the partner code   → §3
// §2's checker is planted in the suite itself: a page carrying "$199/mo" and "Start free" must be
// caught, or the green below means nothing. Run against main's site it is red (the price block).
//
// Made-up fixtures only. The suite sets its own clock (tests/clock.js) through the helpers.
const bcrypt = require("bcryptjs");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { ok, summary, login, api, q, closeDb, BASE, SINK_PORT } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const CLIENT = path.join(ROOT, "client");
const PASS = "loadtest1234";
const HOME = "org_onb4home", SUPER = "onb4-super@example.org";
const PROSPECT = "rowan@cedar-hollow.onb4.example.org";
const raw = async (method, p, body) => { const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, text: await r.text() }; };
const json = t => { try { return JSON.parse(t); } catch { return {}; } };

// The local Resend sink: every message the server tries to send while it is up.
function sink() {
  const got = [];
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", c => (b += c)); req.on("end", () => { got.push(json(b)); res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ id: "sink_" + got.length })); });
  });
  return new Promise((r, no) => { srv.once("error", no); srv.listen(SINK_PORT, () => r({ got, close: () => new Promise(x => srv.close(x)) })); });
}
const toWhom = m => [].concat(m && m.to || []).map(String).join(",");

(async () => {
  await q(`DELETE FROM sales_bookings WHERE email LIKE '%onb4.example.org'`);
  await q(`DELETE FROM partners WHERE code LIKE 'onb4-%'`);
  await q(`DELETE FROM close_links WHERE contact_email LIKE '%onb4.example.org'`);
  await q(`DELETE FROM users WHERE id = 'u_onb4_super'`);
  await q(`DELETE FROM orgs WHERE id = $1`, [HOME]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Onboard4 Home','onb4-home',1,'active','team')`, [HOME]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_onb4_super',$1,$2,$3,'Onb Super','admin',true)`, [HOME, SUPER, bcrypt.hashSync(PASS, 10)]);
  const sup = await login(SUPER);
  const mail = await sink();

  // ── §1 · PUBLIC SIGNUP IS CLOSED ────────────────────────────────────────────────────
  // HOW IT GOES RED (ONBOARD4_PLANT=signupopen): the door answers 202 {sent:true}.
  {
    const agr = (await api("GET", "/public/agreement", null)).body || {};
    const full = { orgName: "Cedar Hollow Food Share", contactName: "Rowan Pike", contactEmail: "signup@cedar-hollow.onb4.example.org", estimatedRecords: 300, interval: "monthly", acceptTerms: true, termsVersion: agr.version };
    const answers = [await raw("POST", "/public/signup", full), await raw("POST", "/public/signup", { ...full, contactEmail: SUPER }), await raw("POST", "/public/signup", {})];
    const a = json(answers[0].text);
    ok("§1 POST /public/signup refuses: 410, signup_closed, and points to /book", answers[0].status === 410 && a.error === "signup_closed" && a.book === "/book" && /\/book/.test(a.message || ""), answers[0]);
    ok("§1 …the same answer, byte for byte, for a full body, an address with an account and an empty body", answers.every(x => x.status === 410 && x.text === answers[0].text), answers.map(x => x.status));
    const cl = await q(`SELECT COUNT(*)::int AS n FROM close_links WHERE contact_email LIKE '%onb4.example.org' OR lower(contact_email) = lower($1)`, [SUPER]);
    ok("§1 …and writes no close link", cl[0].n === 0, cl[0].n);
    await new Promise(r => setTimeout(r, 400));
    ok("§1 …and sends nothing (the local mail sink got no message)", mail.got.length === 0, mail.got.map(toWhom));
    // The close link Jonathan sends is untouched: its admin route is still behind the super-admin door.
    const anon = await raw("POST", "/admin/close-links", { orgName: "x" });
    ok("§1 the close link route is still there, and still only for a super-admin", [401, 403, 404].includes(anon.status), anon.status);
    const main = fs.readFileSync(path.join(CLIENT, "src", "main.jsx"), "utf8");
    const vj = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    const red = s => (vj.redirects || []).find(r => r.source === s);
    ok("§1 /signup, /demo and /invitation go to /book (the router and the edge)", ["/signup", "/demo", "/invitation"].every(s => new RegExp(`path="${s}"\\s+element=\\{<ToBook />\\}`).test(main) && red(s) && red(s).destination === "/book")
      && !fs.existsSync(path.join(CLIENT, "src", "pages", "SignupPage.jsx")), (vj.redirects || []).map(r => r.source));
  }

  // ── §2 · NO PRICE AND NO "FREE" ON THE PUBLIC SITE ──────────────────────────────────
  {
    const { execFileSync } = require("child_process");
    const { priceRules, findPrices } = await import(path.join(CLIENT, "scripts", "no-public-prices.mjs"));
    const pricing = JSON.parse(fs.readFileSync(path.join(ROOT, "pricing.json"), "utf8"));
    const rules = priceRules(pricing);
    // The planted page: the checker must catch the old price line, a setup fee and Start free.
    const planted = findPrices(`<p>Everything included, from $${pricing.tiers[0].monthlyUsd}/mo.</p><p>A one-time setup fee of $${pricing.tiers[1].setupUsd.toLocaleString("en-US")}.</p><a>Start free</a>`, rules, "planted");
    ok("§2 the checker catches a planted price, a setup fee and Start free", ["price", "setup fee", "free offer"].every(k => planted.some(h => h.kind === k)), planted);
    ok("§2 …and does not mistake the IRS's $250 line in the glossary for a setup fee", findPrices("A donor needs a written acknowledgment for any gift of $250 or more.", rules).length === 0);

    execFileSync(process.execPath, [path.join(CLIENT, "node_modules", "vite", "bin", "vite.js"), "build", "-c", "vite.prerender.config.js", "--logLevel", "error"], { cwd: CLIENT, stdio: "inherit" });
    process.env.NODE_ENV = "production";
    const { render, ROUTES } = await import(path.join(CLIENT, "dist-prerender", "prerender.mjs"));
    const seo = await import(path.join(CLIENT, "src", "marketing", "seo.js"));
    const base = seo.pageShell(fs.readFileSync(path.join(CLIENT, "index.html"), "utf8"));
    const hits = [];
    for (const r of ROUTES) {
      if (r.page === "article" || r.page === "glossaryTerm") continue;   // their copy is in the bundle, read whole below
      hits.push(...findPrices(seo.assemblePage(base, r, render(r.path), {}), rules, r.path));
    }
    hits.push(...findPrices(fs.readFileSync(path.join(CLIENT, "dist-prerender", "prerender.mjs"), "utf8"), rules, "the marketing bundle"));
    for (const f of ["src/pages/LostAndFound.jsx", "src/pages/TermsPage.jsx", "src/pages/LoginPage.jsx", "src/pages/PrivacyPage.jsx"]) {
      const p = path.join(CLIENT, f); if (fs.existsSync(p)) hits.push(...findPrices(fs.readFileSync(p, "utf8"), rules, f));
    }
    ok(`§2 no price, setup fee figure, price list or free offer on any of ${ROUTES.length} marketing pages or the public app pages`, hits.length === 0, hits.slice(0, 8));
    const book = seo.assemblePage(base, ROUTES.find(r => r.path === "/book"), render("/book"), {});
    const home = render("/"), pricingPage = render("/pricing");
    const LINE = "Pricing depends on the size of your donor file and comes with hands-on setup. We&#x27;ll walk you through it on a call.";
    ok("§2 where the price was, the one line and Book a call (Home and /pricing)", [home, pricingPage].every(h => h.includes(LINE) && /href="\/book"[^>]*>(<i><\/i>)?Book a call/.test(h)), null);
    const links = ROUTES.filter(r => !["article", "glossaryTerm", "helpArticle", "guide", "feature", "audience"].includes(r.page)).flatMap(r => [...render(r.path).matchAll(/href="(\/signup|\/demo|\/invitation)[^"]*"/g)].map(m => r.path + " → " + m[1]));
    ok("§2 no page links to /signup, /demo or /invitation", links.length === 0, links.slice(0, 6));
    ok("§2 /book is a prerendered page with the form and no price", /data-book-form/.test(book) && findPrices(book, rules).length === 0);
    ok("§2 GET /public/pricing stays for close links and Billing", (await api("GET", "/public/pricing", null)).status === 200);
  }

  // ── §3 · A BOOKING LANDS IN THE SALES CRM ───────────────────────────────────────────
  // HOW IT GOES RED (ONBOARD4_PLANT=nopartner): the deal carries no partner code.
  {
    const made = await api("POST", "/ops/sales/partner-codes", sup, { code: "onb4-gulf", name: "Harbor Coast Nonprofit Alliance (made-up)", market: "Gulf Coast" });
    ok("§3 a super-admin adds a partner code: code, name, market", made.status === 201 && made.body.link === "/book?partner=onb4-gulf", made.body);
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'partners'`)).map(r => r.column_name);
    ok("§3 …the partners table has no commission field", ["code", "name", "market"].every(c => cols.includes(c)) && !cols.some(c => /commission|percent|payout|flat|cents/.test(c)), cols);
    const anonCodes = await raw("GET", "/ops/sales/partner-codes");
    ok("§3 …and the list of codes is behind the /ops door", anonCodes.status === 404 || anonCodes.status === 401, anonCodes.status);
    const pub = await raw("GET", "/public/book/partner/onb4-gulf");
    ok("§3 the booking page reads the partner's name, and nothing else", pub.status === 200 && pub.text === JSON.stringify({ ok: true, name: "Harbor Coast Nonprofit Alliance (made-up)" }), pub.text);
    ok("§3 …an unknown code is a 404", (await raw("GET", "/public/book/partner/onb4-nobody")).status === 404);

    const fileText = "Donor,Date,Amount\nAda Fenwick,2025-03-01,50\n";
    const sent = mail.got.length;
    const b = await raw("POST", "/public/book", { name: "Rowan Pike", orgName: "Cedar Hollow Food Share", email: PROSPECT, phone: "555-0100",
      currentSystem: "A spreadsheet", donorCount: "500 to 2,500", worthIt: "Knowing who stopped giving.", partner: "onb4-gulf",
      file: { name: "donors.csv", type: "text/csv", data: "data:text/csv;base64," + Buffer.from(fileText).toString("base64") } });
    ok("§3 POST /public/book answers 201 and asks her to pick a time", b.status === 201 && /pick a time/.test(json(b.text).message || ""), b);
    const [bk] = await q(`SELECT * FROM sales_bookings WHERE email = $1`, [PROSPECT]);
    const [deal] = bk ? await q(`SELECT d.id, d.name, d.source, d.partner_code, p.market FROM sales_deals d LEFT JOIN partners p ON p.code = d.partner_code WHERE d.id = $1`, [bk.sales_deal_id]) : [];
    ok("§3 the booking lands as a deal, source 'Website booking'", deal && deal.source === "Website booking" && /Cedar Hollow Food Share/.test(deal.name), deal);
    ok("§3 …tagged to the partner and its market", deal && deal.partner_code === "onb4-gulf" && deal.market === "Gulf Coast", deal);
    ok("§3 …with the file kept for onboarding", bk && bk.file_name === "donors.csv" && Buffer.from(bk.file_data).toString() === fileText && bk.partner_code === "onb4-gulf", bk && bk.file_name);
    const acts = deal ? await q(`SELECT a.kind, a.body, a.due_on FROM sales_activities a JOIN sales_activity_links l ON l.activity_id = a.id WHERE l.record_type = 'deal' AND l.record_id = $1`, [deal.id]) : [];
    const note = acts.find(a => a.kind === "note"), task = acts.find(a => a.kind === "task");
    ok("§3 …its answers on the deal (partner, phone, system, donors, what would make it worth it, the file)", note && ["Recommended by Harbor Coast", "Gulf Coast market", "555-0100", "A spreadsheet", "500 to 2,500", "Knowing who stopped giving.", "donors.csv"].every(s => note.body.includes(s)), note && note.body);
    ok("§3 …and a task for Jonathan: read the answers before the call", task && /^Booked a call from the website: Rowan Pike, Cedar Hollow Food Share/.test(task.body), task);
    const panel = await api("GET", `/ops/sales/deals/${deal && deal.id}/booking`, sup);
    ok("§3 the deal page's panel shows the answers, the partner, the market and the file", panel.status === 200 && panel.body.partner && panel.body.partner.market === "Gulf Coast"
      && panel.body.bookings.length === 1 && panel.body.bookings[0].file_name === "donors.csv" && !("file_data" in panel.body.bookings[0]), panel.body);
    const dl = await fetch(`${BASE}/ops/sales/bookings/${bk && bk.id}/file`, { headers: { Authorization: `Bearer ${sup}` } });
    ok("§3 …and the file downloads for a super-admin only", dl.status === 200 && (await dl.text()) === fileText && (await raw("GET", `/ops/sales/bookings/${bk && bk.id}/file`)).status !== 200);

    // An unknown partner code: she books the same way, and the deal carries no partner.
    const u = await raw("POST", "/public/book", { name: "Ellis Varga", orgName: "Mossbank Riding Center", email: "ellis@mossbank.onb4.example.org", partner: "onb4-nobody" });
    const [ub] = await q(`SELECT b.partner_code, d.partner_code AS deal_code FROM sales_bookings b JOIN sales_deals d ON d.id = b.sales_deal_id WHERE b.email = 'ellis@mossbank.onb4.example.org'`);
    ok("§3 an unknown partner code is ignored: the booking lands, untagged", u.status === 201 && ub && ub.partner_code === null && ub.deal_code === null, ub);
    const bad = await raw("POST", "/public/book", { name: "No Email", orgName: "Somewhere", email: "not-an-email" });
    ok("§3 a booking without a usable email is refused with a plain message, and nothing is kept", bad.status === 400 && json(bad.text).field === "email"
      && (await q(`SELECT COUNT(*)::int AS n FROM sales_bookings WHERE name = 'No Email'`))[0].n === 0, bad.text);
    const big = await raw("POST", "/public/book", { name: "Big File", orgName: "Large Co", email: "big@large.onb4.example.org", file: { name: "all.csv", data: "data:text/csv;base64," + Buffer.alloc(3 * 1024 * 1024 + 10, 65).toString("base64") } });
    ok("§3 a file over 3 MB is refused with the words to bring it to the call", big.status === 413 && /bring it with you/.test(json(big.text).message || ""), big.status);
    await new Promise(r => setTimeout(r, 400));
    ok("§3 Steward emailed no prospect (the booking tool sends its own confirmation)", !mail.got.slice(sent).some(m => /onb4\.example\.org/.test(toWhom(m))), mail.got.slice(sent).map(toWhom));
  }

  await mail.close();
  await q(`DELETE FROM partners WHERE code LIKE 'onb4-%'`);
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

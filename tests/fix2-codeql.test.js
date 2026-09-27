// FIX-2 F — THE CODEQL FOUR.
//
// FIX-1's handoff §8 left four CodeQL warnings on code the split moved. Two
// were real and are fixed in code, one is resolved by giving the route the
// limit CodeQL could not see, one is a false positive dismissed in CodeQL
// with its reason (hashApiKey: a 192-bit random key, not a password).
//
//   §1 the email header's escaper escapes quotes: an org name inside alt="…"
//      cannot close the attribute (js/incomplete-html-attribute-sanitization)
//   §2 the campaign sender no longer builds a text body with a one-pass tag
//      strip nobody read (js/incomplete-multi-character-sanitization)
//   §3 /resend/webhook carries its own rate limit on its route, with a ceiling
//      a delivery burst cannot reach, and no longer shares the browser budget;
//      the Stripe and billing webhooks stay unlimited (js/missing-rate-limiting)

const fs = require("fs"), path = require("path");
const { ok, summary } = require("./helpers");
const root = path.join(__dirname, "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

(async () => {
  console.log("fix2-codeql");

  // §1 — lift the escaper out of brandEmailHeaderHtml and run it.
  const email = read("routes/email.js");
  const fn = email.slice(email.indexOf("async function brandEmailHeaderHtml"));
  const m = /const esc = (s => [\s\S]*?);\n/.exec(fn);
  ok("§1 brandEmailHeaderHtml has its escaper", !!m);
  const esc = m ? eval(m[1]) : (s => s);
  const out = esc(`Smith "Friends" & O'Hara <b>`);
  ok("§1 a double quote cannot close alt=\"…\"", !out.includes('"'), out);
  ok("§1 a single quote is escaped too", !out.includes("'"), out);
  ok("§1 &, < and > still escape", out.includes("&amp;") && out.includes("&lt;b&gt;"), out);
  ok("§1 the logo URL goes through the same escaper", /const src = esc\(theme\.logoDataUri \|\| theme\.logoAbsUrl\)/.test(fn));

  // §2 — the dead text body is gone.
  const server = read("server.js");
  ok("§2 no one-pass tag strip builds an unused text body", !/const textBody = bodyHtml\.replace/.test(server));

  // §3 — the limiter is ON the route, before the body parser and the handler.
  const wh = read("routes/webhooks.js");
  ok("§3 webhooks.js builds its limiter from express-rate-limit", /require\("express-rate-limit"\)/.test(wh));
  ok("§3 /resend/webhook takes the limiter first",
    /app\.post\("\/resend\/webhook", resendWebhookLimiter, express\.raw\(/.test(wh));
  const lim = /const resendWebhookLimiter = rateLimit\(\{([\s\S]*?)\}\);/.exec(wh);
  const win = lim && /windowMs:\s*([\d\s*]+),/.exec(lim[1]);
  const cap = lim && /limit:\s*(\d+)/.exec(lim[1]);
  const perMinute = win && cap ? Number(cap[1]) / (eval(win[1]) / 60000) : 0;
  ok("§3 the ceiling is at least 3000 a minute per IP", perMinute >= 3000, perMinute);
  ok("§3 the limiter answers with the shared 429 and is off in TEST_MODE",
    !!lim && /handler: rateLimitHandler/.test(lim[1]) && /skip: rateLimitDisabled/.test(lim[1]));
  ok("§3 the Stripe webhook takes no limiter", /app\.post\("\/stripe\/webhook", express\.raw\(/.test(wh));
  ok("§3 the billing webhook takes no limiter", /app\.post\("\/billing\/webhook", express\.raw\(/.test(wh));
  const skip = /const generalLimiter = rateLimit\(\{[\s\S]*?skip: \(req\) => ([^\n]*),\n/.exec(server);
  ok("§3 the browser budget skips all three webhooks",
    !!skip && ["/stripe/webhook", "/billing/webhook", "/resend/webhook"].every(p => skip[1].includes(`"${p}"`)), skip && skip[1]);

  summary();
})().catch(e => { console.error(e); process.exit(1); });

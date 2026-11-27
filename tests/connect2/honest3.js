// tests/connect2/honest3.js: HONEST-3. A CONNECTION, A PUBLIC PAGE OR A LINK ONLY SAYS WHAT IS TRUE.
// A part of connect2-sources (the integrations suite): the build's one new test, guarding what a
// person is told about their donors' money coming in, and what a donor is shown on a public page.
//
//   §1  ONE BADGE. GET /connections gives every card a `badge` from server/connections/checks.js
//       (badgeOf), and the Settings card, the panel under it, the "Connects directly" tile (FlowWord)
//       and the inbox card draw it, never a word of their own. Connected needs a sign-in held,
//       connecting on and a check in the last 24 hours that passed: a check 25 hours old, a source
//       holding no sign-in, and a failed check each read "Needs attention" with the reason.
//   §2  THE DAILY CHECK keeps its counts: one row per connection per run, and the panel's last three.
//   §3  NOBODY HEARS: with the org's staff email off, the reach sentence says so (Home and the task).
//   §4  PUBLIC PAGES: a demo org's giving page is whole (mission, amounts, EIN) and marked an example;
//       a real org's closed page says "This page isn't published yet", never "Opens soon"; the public
//       connections list has no "Not available yet" group and files are "Import from a file".
//   §5  SHORT LINKS: /volunteer/<org> opens the org's volunteer page, /event/<org>/<event> the event,
//       and an unknown slug says "We couldn't find that organization".
//
// HOW IT GOES RED (planted and seen red on main and on a planted defect): on main there is no badge
// (§1, §2); badgeOf that ignores the check's age shows Connected over a 25-hour-old check (§1);
// /volunteer/<org> was a 404 (§5); the demo giving page was "Opens soon" (§4).
"use strict";
const path = require("path");
const bcrypt = require("bcryptjs");
const { testNow } = require("../clock");

const ORG = "org_c2hon3", DEMO = "org_c2hon3demo";
const ADMIN = "admin@c2hon3-fixture.org";
const ROOT = path.join(__dirname, "..", "..");
const read = p => { try { return require("fs").readFileSync(path.join(ROOT, p), "utf8"); } catch { return ""; } };
const TABLES = ["connection_checks", "gifts", "giving_sources", "giving_pages", "donors", "tasks", "portal_settings", "users"];
const HOUR = 3600000;

async function reset(q) {
  for (const o of [ORG, DEMO]) for (let i = 0; i < 6; i++) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [o]).then(() => true).catch(() => false)) break;
    await new Promise(r => setTimeout(r, 300));
  }
}

async function run({ ok, login, api, q, BASE }) {
  const now = testNow();
  await reset(q);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,mission,staff_mail_enabled)
           VALUES ($1,'Honest Three Rowing','honest-three-rowing',1,'active','team','UTC','We row on the river with teenagers.',false)`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind,timezone,mission,ein)
           VALUES ($1,'Honest Three Demo','honest-three-demo',1,'active','team','demo','UTC','We teach knots to kids on the dock. Every summer.','86-3917452')`, [DEMO]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_c2hon3',$1,$2,$3,'Hon Three','admin')`,
    [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  // Two sources: PayPal holds a (made-up) sealed sign-in and was read an hour ago; Givebutter holds none.
  await q(`INSERT INTO giving_sources (id,org_id,provider,display_name,status,credentials_sealed,last_synced_at,created_by,created_by_name)
           VALUES ('gs_hon3_pp',$1,'paypal','PayPal','active','v1.sealed-fixture',$2,'system:test','honest3 suite'),
                  ('gs_hon3_gb',$1,'givebutter','Givebutter','active',NULL,$2,'system:test','honest3 suite')`, [ORG, new Date(now - HOUR)]);
  const tok = await login(ADMIN);
  const card = async id => ((await api("GET", "/connections", tok)).body.cards || []).find(c => c.id === id);
  const check = (id, ageH, okd, reasons = []) => q(
    `INSERT INTO connection_checks (org_id,card_key,checked_at,ok,reasons,counts,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,$5::jsonb,'{"seen":3,"week":1}'::jsonb,'system:test','honest3 suite')`,
    [ORG, id, new Date(now - ageH * HOUR), okd, JSON.stringify(reasons)]);

  // ── §1 · one badge, and Connected only when it works today ────────────────
  let pp = await card("gs_hon3_pp");
  ok("§1 every card carries the one badge", !!pp && !!pp.badge && typeof pp.badge.label === "string", pp && pp.badge);
  ok("§1 a sign-in held but never checked is Needs attention · not checked yet",
    pp && pp.badge.state === "attention" && pp.badge.reason === "not checked yet", pp && pp.badge);
  await check("gs_hon3_pp", 25, true);
  pp = await card("gs_hon3_pp");
  ok("§1 a passing check 25 hours old can't show Connected: Needs attention · not checked since …",
    pp && pp.badge.state === "attention" && /^not checked since /.test(pp.badge.reason || ""), pp && pp.badge);
  await check("gs_hon3_pp", 2, false, ["last check failed"]);
  pp = await card("gs_hon3_pp");
  ok("§1 a failed check today is Needs attention with its reason", pp && pp.badge.state === "attention" && pp.badge.reason === "last check failed", pp && pp.badge);
  await check("gs_hon3_pp", 1, true);
  pp = await card("gs_hon3_pp");
  ok("§1 a sign-in held, connecting on and a passing check an hour ago: Connected", pp && pp.badge.state === "connected" && pp.badge.label === "Connected", pp && pp.badge);
  const gb = await card("gs_hon3_gb");
  ok("§1 a source holding no sign-in is Needs attention · no sign-in held, whatever the stamp says",
    gb && gb.badge.state === "attention" && /no sign-in held/.test(gb.badge.reason || ""), gb && gb.badge);
  const C = read("client/src/components/Connections.jsx"), F = read("client/src/components/connections/flowParts.jsx");
  ok("§1 the card, the panel, FlowWord (the tiles, Finance, setup) and the inbox card all draw the server's badge",
    /const badge = card\.badge \|\| null;/.test(C) && /c\.badge \? c\.badge\.words/.test(C) && /card\.badge \? card\.badge\.words/.test(F)
    && /p\.badge = require\("\.\.\/server\/connections\/checks"\)\.mailboxBadge\(/.test(read("routes/finance.js"))
    && /p\.badge \? <span data-testid="inbox-badge"/.test(read("client/src/components/InboxConnect.jsx")), null);

  // ── §2 · the daily check keeps counts, and the panel shows the last three ─
  ok("§2 the panel's last three checks come back newest first, each with its counts",
    pp && pp.checks.length === 3 && pp.checks[0].ok === true && pp.checks[0].counts.seen === 3 && /^\w{3} \d+ · 3 seen in 30 days, 1 this week · passed$/.test(pp.checks[0].sentence), pp && pp.checks);
  const CK = require(path.join(ROOT, "server", "connections", "checks.js"));
  ok("§2 the badge function is pure about time: a check exactly 24h + 1 min old is never Connected",
    CK.badgeOf({ connected: true, kind: "source" }, { reasons: [], checks: [{ at: new Date(now - 24 * HOUR - 60000).toISOString(), ok: true }], now }).state === "attention"
    && CK.badgeOf({ connected: true, kind: "source" }, { reasons: [], checks: [{ at: new Date(now - 23 * HOUR).toISOString(), ok: true }], now }).state === "connected");
  ok("§2 the daily check is scheduled for every org holding a connection",
    /every\("runConnectionChecks", 60 \* 60 \* 1000/.test(read("routes/jobs.js")) && /runConnectionChecks:/.test(read("jobAudit.js")));

  // ── §3 · nobody hears, and the screen says so ──────────────────────────────
  const AR = require(path.join(ROOT, "server", "connections", "alertReach.js"));
  const qq = (sql, args = []) => { let i = 0; return q(sql.replace(/\?/g, () => "$" + (++i)), args); };
  ok("§3 with staff email off org-wide, the reach sentence says nobody is being emailed and where to turn it on",
    (await AR.alertReach(qq, ORG)) === AR.STAFF_OFF && /Settings → Notifications/.test(AR.STAFF_OFF));
  ok("§3 the quiet sweep emails (pref- and switch-gated) and writes the sentence on its task; new orgs start with alerts on",
    /sweepQuietConnections\(\{ live: true, notify: true \}\)/.test(read("routes/jobs.js")) && /notes: reach/.test(read("server/boot/helpers-1.js"))
    && (read("routes/billing.js").match(/newOrgAlertDefaults\(run, userId\)/g) || []).length === 2 && /newOrgAlertDefaults\(run, userId\)/.test(read("routes/webhooks.js")));

  // ── §4 · public pages say what is true ────────────────────────────────────
  const demoPub = await api("GET", "/org/honest-three-demo/public", null);
  ok("§4 a demo org's giving page is whole: mission, amounts and the made-up EIN, marked an example",
    demoPub.status === 200 && /^This is an example page in the Steward demo\./.test(demoPub.body.example || "")
    && /knots/.test(demoPub.body.org.mission || "") && demoPub.body.org.facts.ein && (demoPub.body.org.theme.onetimeAmounts || []).length > 0, demoPub.body);
  const realPub = await api("GET", "/org/honest-three-rowing/public", null);
  ok("§4 a real org's closed page says it isn't published yet, never Opens soon",
    realPub.status === 404 && realPub.body.notOpen === true && realPub.body.brand.heading === "This page isn't published yet" && !/Opens soon/.test(JSON.stringify(realPub.body)), realPub.body);
  const list = await api("GET", "/public/connections", null);
  ok("§4 the public connections list shows what connects and Import from a file, and nothing unavailable",
    list.status === 200 && !("notYet" in list.body.groups) && list.body.words.files.title === "Import from a file"
    && (list.body.groups.files || []).some(x => x.name === "Venmo") && !(list.body.groups.connects || []).some(x => x.name === "Venmo"), list.body);

  // ── §5 · short links ───────────────────────────────────────────────────────
  const raw = async p => { const r = await fetch(BASE + p, { redirect: "manual" }); return { status: r.status, to: r.headers.get("location"), html: await r.text() }; };
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,status,page_kind,published,published_at)
           VALUES ('gp_hon3_vol',$1,'help-out','Help out','active','volunteer','[{"type":"text"}]'::jsonb,NOW())`, [ORG]);
  const v = await raw("/volunteer/honest-three-rowing");
  ok("§5 /volunteer/<org> opens the org's published volunteer page", v.status === 302 && v.to === "/volunteer-page/honest-three-rowing/help-out", v);
  const nope = await raw("/volunteer/no-such-org-hon3");
  ok("§5 an unknown slug says We couldn't find that organization", nope.status === 404 && /We couldn(&#39;|')t find that organization/.test(nope.html), nope.status);
  const ev = await raw("/event/no-such-org-hon3/harbor-run");
  ok("§5 /event/<unknown org>/<event> says We couldn't find that organization", ev.status === 404 && /We couldn(&#39;|')t find that organization/.test(ev.html), ev.status);
  const pages = await api("GET", "/giving-pages", tok);
  const vp = ((pages.body && (pages.body.pages || pages.body)) || []).find(p => p.id === "gp_hon3_vol");
  ok("§5 the Share menu offers the short link", vp && vp.short_url === "/volunteer/honest-three-rowing", vp);
  await reset(q);
}

module.exports = { run };

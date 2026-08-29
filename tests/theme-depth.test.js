// BUILD-48 — theme depth + adaptive takeover, the SERVER side of the contract:
//   • every new theme value is validated at the write route — colors through
//     the contrast guards (accent family DEEPENED, background tint LIGHTENED,
//     admin told either way), type pairing + card style as strict ENUMS
//     (never free CSS, fonts, or URLs);
//   • the portal /config theme and the donor dashboard's per-org card themes
//     carry the new fields with designed fallbacks (an org that sets nothing
//     renders byte-identically to pre-BUILD-48);
//   • one org's theme never rides another org's card (scoped by construction);
//   • the client's enum maps (client/src/lib/portalTheme.js) stay in key
//     parity with the server's enums.
//
// Standard scratch stack + DONOR_ACCOUNTS_ENABLED=1. Starts its own mail sink
// on :5602 (the donor-account verify email carries the token).

const bcrypt = require("bcryptjs");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { BASE, ok, summary, login, api, q, closeDb, SINK_PORT } = require("./helpers");
const { normalizeTint, tintPasses, normalizeAccent, contrast, INK, MUTED_TEXT } = require("../branding");

const ORG_A = "org_td_a", SLUG_A = "themedepth-a";
const ORG_B = "org_td_b", SLUG_B = "themedepth-b";
const ORG_C = "org_td_c", SLUG_C = "themedepth-c";
const EMAIL = "rowan@td48.test";
const THIS_YEAR = String(new Date().getFullYear());

let mail = [];
function startSink(port = SINK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => { try { mail.push(JSON.parse(b)); } catch { /* ignore */ } res.setHeader("Content-Type", "application/json"); res.end('{"id":"sunk"}'); });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
const mailTo = (to) => mail.filter(m => m.to === to || (Array.isArray(m.to) && m.to.includes(to)));
const settle = (ms = 600) => new Promise(r => setTimeout(r, ms));
const tokenFrom = (m, kind) => (new RegExp(`${kind}#token=([A-Za-z0-9_-]+)`).exec(m?.html || "") || [])[1] || null;
function cookieOf(res) {
  const m = (res.headers?.get("set-cookie") || "").match(/steward_portal=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
async function raw(method, p, { cookie, body } = {}) {
  const r = await fetch(BASE + p, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { Cookie: `steward_portal=${encodeURIComponent(cookie)}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null; try { parsed = await r.json(); } catch { /* non-json */ }
  return { status: r.status, body: parsed, headers: r.headers };
}

async function fixture() {
  await q(`DELETE FROM donor_accounts WHERE email LIKE '%@td48.test'`);
  await q(`DELETE FROM donor_account_audit WHERE email LIKE '%@td48.test'`).catch(() => {});
  for (const org of [ORG_A, ORG_B, ORG_C]) {
    for (const t of ["portal_audit_log", "portal_sessions", "portal_magic_links", "impact_updates", "gifts", "interactions", "tasks", "donor_org_follows"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM portal_settings WHERE org_id=$1`, [org]).catch(() => {});
    for (const t of ["donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Harbor Arts','${SLUG_A}',1,'active','core')`, [ORG_A]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'River Food Project','${SLUG_B}',1,'active','core')`, [ORG_B]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Cedar Shelter','${SLUG_C}',1,'active','core')`, [ORG_C]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed,display_name,primary_color) VALUES ($1,true,true,'Harbor Arts','#0d5c3a')`, [ORG_A]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed,display_name) VALUES ($1,true,true,'River Food Project')`, [ORG_B]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed,display_name) VALUES ($1,true,true,'Cedar Shelter')`, [ORG_C]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_td_a',$1,'td-a@test.local',$2,'A Admin','admin')`, [ORG_A, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_td_b',$1,'td-b@test.local',$2,'B Admin','admin')`, [ORG_B, hash]);
  // Donor records in A and B only — Cedar Shelter stays a FOLLOW (no match).
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_tdA',$1,'Rowan Reed',$2,300,1,'mid','steward')`, [ORG_A, EMAIL]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_tdB',$1,'Rowan Reed',$2,120,1,'mid','steward')`, [ORG_B, EMAIL]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('g_tdA',$1,'d_tdA',300,'${THIS_YEAR}-02-01','cash','')`, [ORG_A]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('g_tdB',$1,'d_tdB',120,'${THIS_YEAR}-03-05','cash','')`, [ORG_B]);
}

(async () => {
  const sink = await startSink();
  await fixture();

  // ── 1) the tint guard itself (branding.js) ─────────────────────────────────
  const dark = normalizeTint("#333333");
  ok("a dark tint is LIGHTENED to a passing value and flagged adjusted",
    dark && dark.adjusted === true && tintPasses(dark.tint), dark);
  ok("the lightened tint keeps ink text comfortably legible (>=7:1)", contrast(INK, dark.tint) >= 7, contrast(INK, dark.tint));
  ok("the lightened tint keeps the weakest (muted) text AA (>=4.5:1)", contrast(MUTED_TEXT, dark.tint) >= 4.5, contrast(MUTED_TEXT, dark.tint));
  ok("white passes untouched", (() => { const t = normalizeTint("#ffffff"); return t.tint === "#ffffff" && t.adjusted === false; })());
  ok("malformed tint input returns null (route 400s)", normalizeTint("url(javascript:x)") === null && normalizeTint("#12") === null);
  ok("the accent guard is unchanged for the new button color (light → deepened)",
    (() => { const a = normalizeAccent("#ffff99"); return a.adjusted === true && a.accent !== "#ffff99"; })());

  // ── 2) write-route validation + round-trip ────────────────────────────────
  const tokA = await login("td-a@test.local");
  const put = (body) => api("PUT", "/portal-settings", tokA, body);

  const r1 = await put({ backgroundTint: "#fdfbf7", buttonColor: "#0d5c3a", typePairing: "editorial", cardStyle: "soft-shadow" });
  ok("PUT accepts all four new fields (already-legible values, no adjustment)",
    r1.status === 200 && r1.body.background_tint === "#fdfbf7" && r1.body.button_color === "#0d5c3a"
    && r1.body.type_pairing === "editorial" && r1.body.card_style === "soft-shadow" && r1.body.adjusted === false, r1.body);

  const g1 = await api("GET", "/portal-settings", tokA);
  ok("GET /portal-settings round-trips the new columns",
    g1.body.background_tint === "#fdfbf7" && g1.body.button_color === "#0d5c3a"
    && g1.body.type_pairing === "editorial" && g1.body.card_style === "soft-shadow", g1.body);

  const cfgA = (await raw("GET", `/portal/${SLUG_A}/config`)).body;
  ok("portal /config theme carries the depth fields",
    cfgA.theme.backgroundTint === "#fdfbf7" && cfgA.theme.buttonColor === "#0d5c3a"
    && cfgA.theme.typePairing === "editorial" && cfgA.theme.cardStyle === "soft-shadow", cfgA.theme);
  ok("buttonFg is the guard-derived readable foreground", ["#ffffff", "#0f1a12"].includes(cfgA.theme.buttonFg)
    && contrast(cfgA.theme.buttonFg, cfgA.theme.buttonColor) >= 4.5, cfgA.theme);

  const r2 = await put({ backgroundTint: "#222222" });
  ok("a dark background tint is lightened on save + admin told why",
    r2.status === 200 && r2.body.adjusted === true && r2.body.background_tint !== "#222222"
    && tintPasses(r2.body.background_tint) && /readable/i.test(r2.body.message || ""), r2.body);

  const r3 = await put({ buttonColor: "#ffff99" });
  ok("an illegibly light button color is deepened on save (accent guard)",
    r3.status === 200 && r3.body.adjusted === true && r3.body.button_color !== "#ffff99", r3.body);

  // sanitization: colors must be hex; enums must be enum — hostile values 400.
  const bads = [
    ["backgroundTint", "javascript:alert(1)"], ["backgroundTint", "url(#x)"],
    ["buttonColor", "<script>x</script>"], ["buttonColor", "expression(evil)"],
    ["typePairing", "<script>alert(1)</script>"], ["typePairing", "comic-sans;inject"],
    ["cardStyle", "blink"], ["cardStyle", "'); DROP TABLE portal_settings;--"],
  ];
  let all400 = true, detail = [];
  for (const [k, v] of bads) {
    const r = await put({ [k]: v });
    if (r.status !== 400) { all400 = false; detail.push([k, v, r.status]); }
  }
  ok("every hostile value for every new field is 400-rejected (no free CSS/fonts)", all400, detail);
  const g2 = await api("GET", "/portal-settings", tokA);
  ok("rejected values never landed in the row", g2.body.card_style === "soft-shadow" && g2.body.type_pairing === "editorial", g2.body);

  const r4 = await put({ typePairing: "", cardStyle: "", backgroundTint: "", buttonColor: "" });
  ok("empty string clears each field back to NULL (designed fallbacks return)",
    r4.status === 200 && r4.body.type_pairing === null && r4.body.card_style === null
    && r4.body.background_tint === null && r4.body.button_color === null, r4.body);
  const cfgA2 = (await raw("GET", `/portal/${SLUG_A}/config`)).body;
  ok("cleared org falls back to the designed defaults (dm / rounded / primary buttons / no tint)",
    cfgA2.theme.typePairing === "dm" && cfgA2.theme.cardStyle === "rounded"
    && cfgA2.theme.buttonColor === cfgA2.theme.primary && cfgA2.theme.backgroundTint === null, cfgA2.theme);

  // restore org A's theme for the dashboard leg
  await put({ backgroundTint: "#fdfbf7", buttonColor: "#0d5c3a", typePairing: "editorial", cardStyle: "soft-shadow" });

  // ── 3) back-compat: an untouched org renders pre-BUILD-48 ────────────────
  const cfgB = (await raw("GET", `/portal/${SLUG_B}/config`)).body;
  ok("an org that set nothing gets exactly the pre-BUILD-48 designed theme",
    cfgB.theme.typePairing === "dm" && cfgB.theme.cardStyle === "rounded"
    && cfgB.theme.backgroundTint === null
    && cfgB.theme.buttonColor === cfgB.theme.primary && cfgB.theme.buttonFg === cfgB.theme.primaryFg, cfgB.theme);

  // ── 4) donor dashboard: per-org card themes, scoped by construction ──────
  mail = [];
  await raw("POST", "/account/signup", { body: { email: EMAIL, password: "rowanpw999", consent: true } });
  await settle();
  const v = await raw("POST", "/account/verify", { body: { token: tokenFrom(mailTo(EMAIL)[0], "verify") } });
  const cookie = cookieOf(v);
  ok("account links the two donor-record orgs on verify", v.body.linkedOrgs === 2, v.body);
  await raw("POST", "/account/orgs/add", { body: { orgSlug: SLUG_C }, cookie }); // no donor match → follow

  const dash = (await raw("GET", "/account/dashboard", { cookie })).body;
  const cardA = dash.orgs.find(o => o.orgSlug === SLUG_A);
  const cardB = dash.orgs.find(o => o.orgSlug === SLUG_B);
  ok("linked card carries its org's FULL theme (depth fields + identity)",
    cardA.theme && cardA.theme.backgroundTint === "#fdfbf7" && cardA.theme.buttonColor === "#0d5c3a"
    && cardA.theme.typePairing === "editorial" && cardA.theme.cardStyle === "soft-shadow"
    && cardA.theme.displayName === "Harbor Arts", cardA && cardA.theme);
  ok("card theme colors arrive normalized with readable foregrounds",
    contrast(cardA.theme.primaryFg, cardA.theme.primary) >= 4.5 && contrast(cardA.theme.buttonFg, cardA.theme.buttonColor) >= 4.5);
  ok("a themed org's values never bleed onto another org's card",
    cardB.theme && cardB.theme.typePairing === "dm" && cardB.theme.cardStyle === "rounded"
    && cardB.theme.backgroundTint === null && cardB.theme.buttonColor !== "#0d5c3a", cardB && cardB.theme);
  const followC = (dash.followed || []).find(f => f.orgSlug === SLUG_C);
  ok("a FOLLOWED card carries identity theming but still ZERO history figures",
    followC && followC.theme && followC.theme.typePairing === "dm"
    && followC.ytd === undefined && followC.lifetime === undefined && followC.lastGiftDate === undefined, followC);

  // ── 5) client/server enum parity (the injection-surface seam) ────────────
  const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const clientSrc = fs.readFileSync(path.join(__dirname, "..", "client", "src", "lib", "portalTheme.js"), "utf8");
  const sPair = (serverSrc.match(/PORTAL_TYPE_PAIRINGS = \[([^\]]+)\]/) || [])[1];
  const sCard = (serverSrc.match(/PORTAL_CARD_STYLES = \[([^\]]+)\]/) || [])[1];
  const serverPairings = (sPair || "").match(/"[a-z-]+"/g).map(s => s.slice(1, -1));
  const serverCards = (sCard || "").match(/"[a-z-]+"/g).map(s => s.slice(1, -1));
  const clientPairings = [...clientSrc.matchAll(/^  "?([a-z-]+)"?: \{\n    label/gm)].map(m => m[1]);
  ok("server type-pairing enum has the curated 4–5 pairs", serverPairings.length >= 4 && serverPairings.length <= 5, serverPairings);
  ok("client pairing map covers every server pairing key", serverPairings.every(k => clientSrc.includes(`${k.includes("-") ? `"${k}"` : k}: {`)), { serverPairings, clientPairings });
  ok("client card-style map covers every server card-style key", serverCards.every(k => clientSrc.includes(k.includes("-") ? `"${k}":` : `${k}:`)), serverCards);
  ok("no external font URL and no @font-face anywhere in the pairing map",
    !/https?:\/\//.test(clientSrc) && !/@font-face/i.test(clientSrc) && !/url\(/i.test(clientSrc));

  // ── 6) org isolation on the write route ──────────────────────────────────
  const tokB = await login("td-b@test.local");
  await api("PUT", "/portal-settings", tokB, { cardStyle: "square" });
  const gA = await api("GET", "/portal-settings", tokA);
  const gB = await api("GET", "/portal-settings", tokB);
  ok("org B's theme write never touches org A's row", gA.body.card_style === "soft-shadow" && gB.body.card_style === "square",
    { a: gA.body.card_style, b: gB.body.card_style });

  if (sink) sink.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

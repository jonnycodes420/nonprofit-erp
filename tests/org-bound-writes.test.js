// tests/org-bound-writes.test.js: HARDEN-1 item 1. A WRITE LANDS IN THE ORG THE
// PAGE WAS SHOWING, OR NOWHERE. The build's one new test (it guards donor data
// and money: a gift, a deletion and an import landing in the wrong org).
//
// 27 Oct, prod: Jonathan had several Steward tabs open. He previewed an import
// in his own org (Steward LLC) and it committed into CREO Arts (Demo). The
// session token is one value in localStorage, shared by every tab, so a
// sign-in to another org in any tab moved every tab with it, silently.
//
// The simulation: "tab A" was rendered for org X and still says so on every
// write (X-Steward-Org: X), while the browser's token is now org Y's (another
// tab signed in there). The writes use Y's own ids, the worst case: before the
// fix every one of them landed in Y.
//
//   §1 from tab A, add a gift, delete a person, commit an import: each is
//      refused 409 org_changed with the sentence naming both orgs, and nothing
//      is written in either org (rows counted).
//   §2 an import previewed in X, the session moved to Y, the commit (even from
//      a client that sends no header) is refused with the same sentence.
//   §3 what still passes: a write whose header matches, a write with no header
//      (API keys, webhooks, an old client), and signing out from a stale tab.
//
// HOW IT GOES RED ON MAIN: there is no header check and no preview binding, so
// §1's three writes and §2's commit all land in Y with 2xx.
//
// Standard scratch stack (tests/README.md). Sends nothing.
"use strict";
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const PASSWORD = "loadtest1234";
const X = "org_hs1bound_x", Y = "org_hs1bound_y";
const X_NAME = "Steward LLC (bound test)", Y_NAME = "CREO Arts (bound test)";
const TABLES = ["audit_log", "deleted_records", "interactions", "gifts", "imports", "sheet_import_jobs", "donor_scores", "thank_you_drafts",
  "tasks", "fin_transactions", "donors", "households", "fin_funds", "accounts", "budgets", "user_sessions", "users"];
const sentence = (a, b) => `This page was for ${a}, but you're now in ${b}. Reload to continue.`;

async function freshOrg(id, name) {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [id]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [id]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
// helpers.api with one more header: the org the page was rendered for
async function call(method, path, token, body, pageOrg) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...(pageOrg ? { "X-Steward-Org": pageOrg } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed = text; try { parsed = JSON.parse(text); } catch {}
  return { status: r.status, body: parsed };
}
const counts = async () => {
  const out = {};
  for (const org of [X, Y]) {
    const [r] = await q(`SELECT
        (SELECT COUNT(*)::int FROM donors WHERE org_id=$1 AND deleted_at IS NULL) AS people,
        (SELECT COUNT(*)::int FROM gifts WHERE org_id=$1) AS gifts,
        (SELECT COUNT(*)::int FROM imports WHERE org_id=$1) AS imports,
        (SELECT COUNT(*)::int FROM sheet_import_jobs WHERE org_id=$1) AS jobs`, [org]);
    out[org] = r;
  }
  return JSON.stringify(out);
};
const refused = (r, a, b) => r.status === 409 && r.body && r.body.code === "org_changed" && r.body.message === sentence(a, b);
const sheet = { fileName: "night.csv", sheets: [{ name: "Sheet1", grid: [["Name", "Email", "Amount", "Date"],
  ["Ana Lima", "ana@hs1bound.local", "50", "2026-10-01"], ["Ben Okafor", "ben@hs1bound.local", "75", "2026-10-02"]] }] };
async function waitJob(tok, r) {
  for (let i = 0; i < 200 && r.status === 202 && r.body && r.body.importId; i++) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok);
    if (j.body.status !== "running") return j.body;
    await new Promise(res => setTimeout(res, 150));
  }
  return r.body;
}

async function main() {
  const tokX = await freshOrg(X, X_NAME);
  const tokY = await freshOrg(Y, Y_NAME);
  // a person in each org, written by its own tab (the header matches: allowed)
  const px = await call("POST", "/donors", tokX, { name: "Xena Person", email: "xena@hs1bound.local" }, X);
  const py = await call("POST", "/donors", tokY, { name: "Yusuf Person", email: "yusuf@hs1bound.local" }, Y);
  const yId = py.body && (py.body.id || (py.body.donor && py.body.donor.id));
  ok("setup: a person in each org, each written with its own org's header", px.status < 300 && py.status < 300 && !!yId,
     [px.status, py.status, JSON.stringify(py.body).slice(0, 200)]);
  await new Promise(r => setTimeout(r, 300));   // the after-change step settles
  const before = await counts();

  // §1 tab A was rendered for X; the browser's token is now Y's
  const gift = await call("POST", `/donors/${yId}/gifts`, tokY, { amount: 125, date: "2026-10-20", type: "cash" }, X);
  ok("§1 a gift from tab A is refused 409 with the sentence", refused(gift, X_NAME, Y_NAME), [gift.status, gift.body]);
  const del = await call("DELETE", `/donors/${yId}`, tokY, null, X);
  ok("§1 a deletion from tab A is refused 409 with the sentence", refused(del, X_NAME, Y_NAME), [del.status, del.body]);
  const imp = await call("POST", "/sheet-import/commit", tokY, { ...sheet, background: true, importId: "imp_sheet_hs1bound1" }, X);
  await waitJob(tokY, imp);
  ok("§1 an import commit from tab A is refused 409 with the sentence", refused(imp, X_NAME, Y_NAME), [imp.status, imp.body]);
  const after1 = await counts();
  ok("§1 nothing was written in either org", after1 === before, { before, after: after1 });

  // §2 the preview is read in X; the session moves to Y before Import is pressed
  const pre = await call("POST", "/sheet-import/understand", tokX, sheet, X);
  ok("§2 the preview names the org it was read for", pre.status === 200 && pre.body.org && pre.body.org.id === X && pre.body.org.name === X_NAME,
     [pre.status, pre.body && pre.body.org]);
  const bound = await call("POST", "/sheet-import/commit", tokY,
    { ...sheet, background: true, importId: "imp_sheet_hs1bound2", previewOrgId: pre.body.org && pre.body.org.id });
  await waitJob(tokY, bound);
  ok("§2 its commit, with no header at all, is refused 409 with the same sentence", refused(bound, X_NAME, Y_NAME), [bound.status, bound.body]);
  const after2 = await counts();
  ok("§2 nothing was written in either org", after2 === before, { before, after: after2 });

  // §3 what still passes
  const same = await call("POST", `/donors/${yId}/gifts`, tokY, { amount: 10, date: "2026-10-21", type: "cash" }, Y);
  ok("§3 a write whose header matches the session lands", same.status < 300, [same.status, same.body]);
  const bare = await call("POST", `/donors/${yId}/gifts`, tokY, { amount: 11, date: "2026-10-21", type: "cash" });
  ok("§3 a write with no header (API key, webhook, old client) lands", bare.status < 300, [bare.status, bare.body]);
  const [{ n }] = await q("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1", [Y]);
  ok("§3 exactly those two gifts are in Y", n === JSON.parse(before)[Y].gifts + 2, n);
  const out = await call("POST", "/auth/logout", tokY, {}, X);
  ok("§3 a stale tab can still sign out", out.status < 300, [out.status, out.body]);

  await cookieSection(yId);

  for (const org of [X, Y]) for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  for (const org of [X, Y]) await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
}

// §4 SECURE-3 item 1 (Release A): the session also lives in an httpOnly cookie.
// A sign-in from a browser sets it beside the token; a request with only the
// cookie is signed in; a write made with the cookie needs X-Steward-Org AND the
// session's CSRF token, and the org binding still refuses another tab's org.
// HOW IT GOES RED ON MAIN: no cookie is set, and a cookie-only request is 401.
async function browserLogin(email) {
  const r = await fetch(BASE + "/auth/login", { method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:4173" },
    body: JSON.stringify({ email, password: PASSWORD }) });
  const set = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [r.headers.get("set-cookie") || ""];
  const line = set.find(c => c.startsWith("steward_session=")) || "";
  const cookie = line.split(";")[0];
  return { status: r.status, body: await r.json().catch(() => ({})), line, cookie };
}
async function viaCookie(method, path, cookie, body, headers = {}) {
  const r = await fetch(BASE + path, { method,
    headers: { "Content-Type": "application/json", Origin: "http://localhost:4173", Cookie: cookie, ...headers },
    body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let parsed = text; try { parsed = JSON.parse(text); } catch {}
  return { status: r.status, body: parsed, csrf: r.headers.get("x-steward-csrf"), setCookie: r.headers.get("set-cookie") || "" };
}
async function cookieSection(yId) {
  const a = await browserLogin(`${Y}@test.local`);
  ok("§4 a browser sign-in sets steward_session: HttpOnly, Secure, SameSite=Lax, Path=/",
     a.status === 200 && /HttpOnly/.test(a.line) && /Secure/.test(a.line) && /SameSite=Lax/.test(a.line) && /Path=\//.test(a.line), [a.status, a.line.replace(/=[^;]+/, "=<jwt>")]);
  ok("§4 Release A: the answer still carries the token, and the CSRF token", typeof a.body.token === "string" && typeof a.body.csrfToken === "string",
     Object.keys(a.body || {}));
  const me = await viaCookie("GET", "/me", a.cookie);
  ok("§4 a request with only the cookie is signed in, and hands back the CSRF token", me.status === 200 && me.csrf === a.body.csrfToken, [me.status, !!me.csrf]);
  const [{ n: g0 }] = await q("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1", [Y]);
  const noHeader = await viaCookie("POST", `/donors/${yId}/gifts`, a.cookie, { amount: 12, date: "2026-10-22", type: "cash" });
  ok("§4 a cookie write with no X-Steward-Org is refused 403", noHeader.status === 403 && noHeader.body.error === "csrf_header_missing", [noHeader.status, noHeader.body]);
  const noToken = await viaCookie("POST", `/donors/${yId}/gifts`, a.cookie, { amount: 12, date: "2026-10-22", type: "cash" }, { "X-Steward-Org": Y });
  ok("§4 a cookie write with the org header but no CSRF token is refused 403", noToken.status === 403 && noToken.body.error === "csrf_token_invalid", [noToken.status, noToken.body]);
  const wrongToken = await viaCookie("POST", `/donors/${yId}/gifts`, a.cookie, { amount: 12, date: "2026-10-22", type: "cash" },
    { "X-Steward-Org": Y, "X-Steward-CSRF": "x".repeat(43) });
  ok("§4 a cookie write with a wrong CSRF token is refused 403", wrongToken.status === 403 && wrongToken.body.error === "csrf_token_invalid", [wrongToken.status, wrongToken.body]);
  const otherOrg = await viaCookie("POST", `/donors/${yId}/gifts`, a.cookie, { amount: 12, date: "2026-10-22", type: "cash" },
    { "X-Steward-Org": X, "X-Steward-CSRF": a.body.csrfToken });
  ok("§4 a cookie write from a tab bound to another org is refused 409 with the sentence", refused(otherOrg, X_NAME, Y_NAME), [otherOrg.status, otherOrg.body]);
  const [{ n: g1 }] = await q("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1", [Y]);
  ok("§4 none of the refused writes wrote a gift", g1 === g0, { g0, g1 });
  const good = await viaCookie("POST", `/donors/${yId}/gifts`, a.cookie, { amount: 13, date: "2026-10-22", type: "cash" },
    { "X-Steward-Org": Y, "X-Steward-CSRF": a.body.csrfToken });
  ok("§4 a cookie write with both headers lands", good.status < 300, [good.status, good.body]);
  // two tabs, one browser: a sign-in to X replaces the cookie; tab Y's next write is refused
  const b = await browserLogin(`${X}@test.local`);
  const stale = await viaCookie("POST", `/donors/${yId}/gifts`, b.cookie, { amount: 14, date: "2026-10-22", type: "cash" },
    { "X-Steward-Org": Y, "X-Steward-CSRF": a.body.csrfToken });
  ok("§4 after a sign-in to another org in another tab, the old tab's write is refused 409", refused(stale, Y_NAME, X_NAME), [stale.status, stale.body]);
  const bearer = await call("GET", "/me", a.body.token);
  ok("§4 the Bearer token keeps working beside the cookie", bearer.status === 200, bearer.status);
  const out = await viaCookie("POST", "/auth/logout", a.cookie, {});
  ok("§4 signing out with the cookie ends it and clears the cookie", out.status < 300 && /steward_session=;/.test(out.setCookie) && /Max-Age=0/.test(out.setCookie), [out.status, out.setCookie.replace(/=[^;]{20,}/g, "=<jwt>")]);
  const after = await viaCookie("GET", "/me", a.cookie);
  ok("§4 the signed-out cookie no longer opens anything, and is cleared again", after.status === 401 && /steward_session=;/.test(after.setCookie), [after.status, after.setCookie.slice(0, 40)]);
}

main().then(async () => { await closeDb(); summary(); }).catch(async e => { console.error(e); await closeDb(); process.exit(1); });

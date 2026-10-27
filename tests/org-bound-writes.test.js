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

  for (const org of [X, Y]) for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  for (const org of [X, Y]) await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
}

main().then(async () => { await closeDb(); summary(); }).catch(async e => { console.error(e); await closeDb(); process.exit(1); });

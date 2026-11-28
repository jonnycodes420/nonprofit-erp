#!/usr/bin/env node
// scripts/ci/raw-write-scan.js · FRESH-5 item 2. EVERY WRITE IN THE APP GOES THROUGH api.js.
//
// A write through apiFetch announces what it changed (lib/changes.js) and every screen on view re-reads.
// A write sent with a bare fetch() announces nothing, so what it changed stays stale until a reload:
// Printed letters' "mark these as printed" was one (FRESH-5, 28 Nov). This fails on a fetch() whose
// method is not GET (a literal POST/PUT/PATCH/DELETE, a method from a variable, or options spread in)
// anywhere in client/src but api.js, unless the file is on ALLOWED below with the reason no screen
// of the app could show what it wrote. A write whose answer is a file uses apiWriteFile.
//
//   node scripts/ci/raw-write-scan.js              # exit 1 on a raw write outside the list
//   node scripts/ci/raw-write-scan.js --self-test  # plants one, and one allowed file going stale
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "client/src");

// file (relative to client/src) -> why a raw write there re-reads nothing in the app. Keep it short.
const ALLOWED = {
  "main.jsx": "the page-ready timing beacon (keepalive, before api.js is loaded); writes a metric no screen shows",
  "components/IdleGuard.jsx": "signing out on the idle timer: keepalive while the page goes, and the app is leaving",
  "pages/LoginPage.jsx": "sign-in and its second step, before there is a session or an app on screen",
  "pages/ForgotPasswordPage.jsx": "signed out: asks for a reset link",
  "pages/ResetPasswordPage.jsx": "signed out: sets a new password",
  "pages/SignedUpPage.jsx": "signed out: the checkout's first sign-in",
  "pages/AdminDashboard.jsx": "Steward's own admin console (super admin), not an org's screens; it re-reads itself",
  "pages/Donate.jsx": "a public giving page: the donor's browser, no session and no app screen",
  "pages/EmbeddedForm.jsx": "a public embedded form: the donor's browser, no session",
  "pages/MembershipsPage.jsx": "a public membership page: the donor's browser, no session",
  "pages/GiveSteps.jsx": "a public giving form's view and started events: the donor's browser",
  "pages/VolunteerPage.jsx": "a public volunteer page's view event: the visitor's browser",
  "pages/ManageFundraiser.jsx": "a peer fundraiser's own page, by its link: no staff session",
  "pages/QuotePage.jsx": "a customer's quote, by its link: no staff session",
  "pages/ReferralPage.jsx": "a referral, by its link: no staff session",
  "pages/ReviewPage.jsx": "an email review link's comments: no staff session",
  "pages/JoinNetwork.jsx": "the donor network's sign-up: the donor's browser",
  "pages/Portal.jsx": "the donor portal: the donor's browser, no staff session",
  "marketing/pages/book.jsx": "the public site's booking form: no session",
  "marketing/pages/resources.jsx": "the public site's help feedback and support forms: no session",
  "pages/InvitePage.jsx": "accepting an invite: the session is made by this answer, before any app screen",
  "pages/LostAndFound.jsx": "the public Lost & Found tool: no session",
  "lib/briefStream.js": "the meeting brief streams its text (apiFetch reads JSON); it stores only the brief, which only its own card shows",
  "components/VolunteerBlocks.jsx": "a public volunteer page's sign-up block: the visitor's browser",
};

const CALL = /(?<![\w$.])(?:window\.)?fetch\(/g;
const WRITE = /method\s*:\s*(?:["'`](?:POST|PUT|PATCH|DELETE)["'`]|(?!["'`]GET)[A-Za-z_$])|\.\.\.\s*(?:opts|options|init|o)\b/i;

function argsOf(src, at) {
  let depth = 0;
  for (let i = at; i < Math.min(src.length, at + 2000); i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return src.slice(at, at + 2000);
}

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "__tests__") walk(p, out); }
    else if (/\.(jsx?|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

// [{ file, line, text }] for every raw write; `src` replaces a file's text (relative path -> text).
function rawWrites(src = {}) {
  const out = [];
  const files = walk(SRC).map(f => path.relative(SRC, f).split(path.sep).join("/"));
  for (const extra of Object.keys(src)) if (!files.includes(extra)) files.push(extra);
  for (const rel of files) {
    if (rel === "api.js") continue;
    const text = rel in src ? src[rel] : fs.readFileSync(path.join(SRC, rel), "utf8");
    for (const m of text.matchAll(CALL)) {
      const call = argsOf(text, m.index + m[0].length - 1);
      if (!WRITE.test(call)) continue;
      out.push({ file: rel, line: text.slice(0, m.index).split("\n").length, text: call.replace(/\s+/g, " ").slice(0, 110) });
    }
  }
  return out;
}

function problems(src = {}) {
  const found = rawWrites(src);
  const bad = found.filter(f => !ALLOWED[f.file]).map(f => `${f.file}:${f.line} writes with a bare fetch(), so no screen re-reads what it changed: use apiFetch (or apiWriteFile for a file answer). ${f.text}`);
  const files = new Set(found.map(f => f.file));
  for (const f of Object.keys(ALLOWED)) if (!files.has(f) && !(f in src)) bad.push(`${f} is allowed a raw write but has none: take it off ALLOWED (the list only shrinks)`);
  return bad;
}

module.exports = { rawWrites, problems, ALLOWED };

if (require.main === module) {
  if (process.argv.includes("--self-test")) {
    const planted = problems({ "components/PlantedRawWrite.jsx": 'export async function save(id){ await fetch(API + "/tasks/" + id, { method: "PUT", body: "{}" }); }' });
    const viaVar = problems({ "components/PlantedRawWrite.jsx": "export const go = (m) => fetch(API + '/notes', { headers: {}, method: m });" });
    const getOk = problems({ "components/PlantedRawRead.jsx": 'export const read = () => fetch(API + "/x", { method: "GET" });' });
    const okSelf = planted.some(p => /PlantedRawWrite/.test(p)) && viaVar.some(p => /PlantedRawWrite/.test(p)) && !getOk.some(p => /PlantedRawRead/.test(p));
    console.log(okSelf ? "raw-write-scan self-test: a planted PUT and a method from a variable are caught; a GET is not" : "raw-write-scan self-test FAILED");
    process.exit(okSelf ? 0 : 1);
  }
  const bad = problems();
  if (process.argv.includes("--list")) for (const f of rawWrites()) console.log(`${ALLOWED[f.file] ? "allowed" : "RAW    "} ${f.file}:${f.line} ${f.text}`);
  if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
  console.log(`raw-write-scan: every write in client/src goes through api.js (${Object.keys(ALLOWED).length} files allowed, each with its reason)`);
}

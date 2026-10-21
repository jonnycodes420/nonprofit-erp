// support/buildIndex.mjs · SUPPORT-1. THE PASSAGES THE SUPPORT AGENT MAY ANSWER FROM.
//
// The support agent is grounded, not trained: every answer is built from
// passages in support/index.json, and each passage keeps the link it came
// from, so an answer can cite it. This file builds that index from Steward's
// own sources and nothing else:
//
//   1. help articles: shared/helpArticles.js (HELP-1) and docs/help/*.md (SUPPORT-1)
//   2. the marketing site: the FAQ lists, the feature pages, the connections
//      table, and the messaging the site is written from (docs/MESSAGING.md)
//   3. what is true right now: every connection and its status, read from
//      the code that runs it (shared/givingSources.js, shared/oauth.js) and
//      the site's checked-against-production table
//
// WHY A COMMITTED FILE. The backend deploys with docs/ and client/ left out
// (.railwayignore), so the server cannot read those sources at boot. The
// index is built here, committed, and support1-answers fails when the
// committed file differs from a fresh build, so it cannot go stale.
//
//   node support/buildIndex.mjs          write support/index.json
//   node support/buildIndex.mjs --check  exit 1 if it is out of date
//
// Pure apart from reading those files: no network, no clock, no database.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = p => path.join(ROOT, p);
const plain = s => String(s || "").replace(/<\/?(?:b|em|br|strong|i)\s*\/?>/g, "").replace(/\s+/g, " ").trim();

// Where a screen lives in the app (client/src/lib/appUrls.js: Home is
// /dashboard, Donors /donors, a Settings section /app/settings?section=<id>,
// every other tab /app/<tab>). "profile" opens the donor list, where a record is.
export function screenRoute(screen) {
  const s = String(screen || "");
  if (!s) return null;
  if (s === "dashboard") return "/dashboard";
  if (s === "donors" || s === "profile") return "/donors";
  if (s.startsWith("settings:")) return "/app/settings?section=" + encodeURIComponent(s.slice(9));
  if (s === "setup") return "/setup";
  if (s === "tell" || s === "search") return "/dashboard";
  if (/^[a-z0-9]+$/.test(s)) return "/app/" + s;
  return null;
}

// The small fixed frontmatter docs/help/*.md uses (key: value, one per line).
export function parseHelpDoc(raw, file) {
  const m = String(raw).replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`docs/help/${file}: no frontmatter`);
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!meta.slug || !meta.title) throw new Error(`docs/help/${file}: slug and title are required`);
  const sections = [];
  let cur = null;
  for (const line of m[2].split("\n")) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) { cur = { h: h[1].trim(), p: [], steps: [] }; sections.push(cur); continue; }
    if (!cur) { if (line.trim()) { cur = { h: "", p: [], steps: [] }; sections.push(cur); } else continue; }
    const step = line.match(/^\s*\d+\.\s+(.*)$/), bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (step) cur.steps.push(step[1].trim());
    else if (bullet) cur.p.push(bullet[1].trim());
    else if (line.trim()) {
      // A wrapped paragraph line joins the paragraph above it.
      if (cur.p.length && !cur._brk) cur.p[cur.p.length - 1] += " " + line.trim();
      else cur.p.push(line.trim());
      cur._brk = false;
      continue;
    }
    cur._brk = !line.trim();
  }
  for (const s of sections) delete s._brk;
  const screens = String(meta.screens || "").split(",").map(s => s.trim()).filter(Boolean);
  return {
    slug: meta.slug, title: meta.title, summary: meta.summary || "", screens,
    route: meta.route || screenRoute(screens[0]) || null, sections,
  };
}

export function readHelpDocs() {
  const dir = rel("docs/help");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(".md")).sort()
    .map(f => parseHelpDoc(fs.readFileSync(path.join(dir, f), "utf8"), f));
}

const md = s => String(s || "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

// One passage per section of an article: small enough that the passage which
// answers the question is the one that ranks, and each one cites the article.
function articlePassages(a, source) {
  const route = a.route || screenRoute((a.screens || [])[0]);
  const out = [{
    id: `${source}:${a.slug}:0`, source, title: a.title, heading: "", link: "/help/" + a.slug, route,
    screen: (a.screens || [])[0] || null, text: md(a.summary),
  }];
  (a.sections || []).forEach((s, i) => {
    const lines = [...(s.p || []).map(md), ...(s.steps || []).map((st, k) => `${k + 1}. ${md(st)}`)];
    if (!lines.length) return;
    out.push({
      id: `${source}:${a.slug}:${i + 1}`, source, title: a.title, heading: s.h || "", link: "/help/" + a.slug, route,
      screen: (a.screens || [])[0] || null, text: lines.join("\n"),
      // A section that says what the screen does not do is how the agent can
      // say plainly that Steward does not do something.
      ...(/does not do|doesn.t do|not do here/i.test(s.h || "") ? { kind: "limits" } : {}),
    });
  });
  return out.filter(p => p.text);
}

// What is true right now about each connection, from the code that runs it.
// `works`: a person can connect it from Settings today. `waiting`: built, but
// waiting on a provider's approval, keys or a first check. `not built`: no code
// reads it. The site's own table (client/src/marketing/data/connections.js)
// is checked against production; the provider registry adds the file-only
// sources it does not list.
const WAITING_WHY = {
  "Xero": "It is built and being checked with a first organization before it is offered to everyone.",
  "QuickBooks Online": "It is built and waiting on Intuit's approval before customers can connect it.",
  "Zapier": "The Zapier app is built and waiting on Zapier's review before it is listed.",
  "Constant Contact": "The sign-in is built, and it is waiting on Constant Contact's keys.",
  "Forward-to-log email": "It is built and waiting on a final check that a forwarded email lands on the right person.",
};
export async function connectionTruth() {
  const { CONNECTIONS } = await import(rel("client/src/marketing/data/connections.js"));
  const { PROVIDERS } = await import(rel("shared/givingSources.js"));
  const O = await import(rel("shared/oauth.js"));
  const built = name => {
    const n = name.toLowerCase();
    return Object.values(PROVIDERS).some(p => n.includes(p.label.toLowerCase()))
      || O.PROVIDER_KEYS.some(k => n.replace(/\s+/g, "").includes(k) || (k === "intuit" && n.includes("quickbooks")));
  };
  const rows = CONNECTIONS.map(([name, what, label]) => {
    const status = label === "Live" ? "works" : (WAITING_WHY[name] || built(name)) ? "waiting" : "not built";
    return { name, what: plain(what), status, why: status === "waiting" ? (WAITING_WHY[name] || "It is built and not yet offered to customers.") : null };
  });
  for (const p of Object.values(PROVIDERS)) {
    if (rows.some(r => r.name.toLowerCase().includes(p.label.toLowerCase()))) continue;
    rows.push({ name: p.label, what: plain(p.help), status: "works", why: null, file: p.mode === "file" });
  }
  return rows;
}
const STATUS_WORD = { works: "works today", waiting: "is not available yet", "not built": "is not built" };
// FIX-47: what a not-built connection's card in Settings, Connections really
// offers. A row's own line ("Gifts and recurring plans pulled in") says what it
// WOULD do once built; printed beside "is not built" it read as a working card.
const NOT_BUILT_CARD = {
  "Donorbox": "Settings, Connections has a Donorbox card in the Giving section, but it does not connect to Donorbox: its only button is \"Import a file\", for Donorbox's gift export as a statement file. Nothing comes in from Donorbox on its own.",
};

export async function buildPassages() {
  const passages = [];
  const { HELP_ARTICLES } = await import(rel("shared/helpArticles.js"));
  for (const a of HELP_ARTICLES) passages.push(...articlePassages(a, "help"));
  for (const a of readHelpDocs()) passages.push(...articlePassages(a, "helpdoc"));

  const { HOME_FAQ, FAQ_PAGE } = await import(rel("client/src/marketing/data/faqs.js"));
  const seen = new Set();
  [...FAQ_PAGE, ...HOME_FAQ].forEach(([q, a]) => {
    if (seen.has(q)) return; seen.add(q);
    passages.push({ id: `faq:${seen.size}`, source: "faq", title: "FAQ", heading: plain(q), link: "/faq", route: null, screen: null, text: plain(a) });
  });

  const { FEAT, FEATURE_SLUGS } = await import(rel("client/src/marketing/data/features.js"));
  for (const s of FEATURE_SLUGS) {
    const f = FEAT[s];
    passages.push({ id: `feature:${s}:0`, source: "feature", title: f.name, heading: "", link: "/features/" + s, route: null, screen: null,
      text: [plain(f.short), plain(f.lede), ...(f.steps || []).map(([h, t]) => `${plain(h)}: ${plain(t)}`), (f.incl || []).length ? "Included: " + f.incl.map(plain).join(", ") + "." : ""].filter(Boolean).join("\n") });
    (f.faq || []).forEach(([q, a], i) => passages.push({ id: `feature:${s}:${i + 1}`, source: "feature", title: f.name, heading: plain(q), link: "/features/" + s, route: null, screen: null, text: plain(a) }));
  }

  // MESSAGING.md: the vision, the pillars and "Keep it true", one passage per
  // section. The public page that carries this language is /why.
  const msg = fs.readFileSync(rel("docs/MESSAGING.md"), "utf8").split(/\n## /).slice(1);
  msg.forEach((block, i) => {
    const [head, ...body] = block.split("\n");
    const text = body.join("\n").replace(/\*\(drafted[^)]*\)\*/g, "").replace(/\*\*/g, "").trim();
    if (/^Words to use|^When they ask|^For the careful|^The headline/.test(head)) return;   // sales coaching, not answers
    if (text) passages.push({ id: `messaging:${i}`, source: "messaging", title: "Why Steward", heading: head.trim(), link: "/why", route: null, screen: null, text });
  });

  const truth = await connectionTruth();
  for (const c of truth) {
    // A not-built row's line is what it would do one day, so it is said as that.
    const lines = [`${c.name} ${STATUS_WORD[c.status]}.`, c.status === "not built" ? (c.what ? `Once built: ${c.what.replace(/^./, x => x.toLowerCase())}` : "") : c.what, c.why].filter(Boolean);
    if (c.status === "works") lines.push(c.file ? "There is no live connection to read: you drop in its export or statement in Settings, Connections." : "Connect it in Settings, Connections.");
    if (c.status === "not built") lines.push(NOT_BUILT_CARD[c.name] || "Nobody can connect it from Settings today, and it has no card there. Its gifts can come in as a file you import.");
    passages.push({ id: `connection:${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, source: "connection", title: "Connections", heading: c.name,
      link: "/connections", route: c.status === "works" ? "/app/settings?section=connections" : null, screen: null, status: c.status, text: lines.join(" ") });
  }
  return passages;
}

export async function buildIndex() {
  const passages = await buildPassages();
  const counts = {};
  for (const p of passages) counts[p.source] = (counts[p.source] || 0) + 1;
  return { about: "SUPPORT-1 · built by support/buildIndex.mjs from Steward's own sources. Do not edit by hand.", counts, passages };
}

// The docs/help articles in the shape shared/helpArticles.js uses, as a JS
// module the help center and the "?" panel import (Vite and Node alike), so
// an article written as Markdown has a page and a place in the panel.
export function helpDocsModule() {
  const docs = readHelpDocs().map(({ slug, title, summary, screens, route, sections }) =>
    ({ slug, title, summary, screens, route, sections: sections.map(s => ({ h: s.h, ...(s.p.length ? { p: s.p.map(md) } : {}), ...(s.steps.length ? { steps: s.steps.map(md) } : {}) })) }));
  return "// shared/helpDocs.js · SUPPORT-1. Built from docs/help/*.md by support/buildIndex.mjs. Do not edit by hand.\n"
    + "export const HELP_DOCS = " + JSON.stringify(docs, null, 1) + ";\nexport default HELP_DOCS;\n";
}

export async function outputs() {
  return {
    "support/index.json": JSON.stringify(await buildIndex(), null, 1) + "\n",
    "shared/helpDocs.js": helpDocsModule(),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = await outputs();
  if (process.argv.includes("--check")) {
    const stale = Object.entries(files).filter(([f, next]) => (fs.existsSync(rel(f)) ? fs.readFileSync(rel(f), "utf8") : "") !== next).map(([f]) => f);
    if (stale.length) { console.error(stale.join(", ") + " out of date: run node support/buildIndex.mjs"); process.exit(1); }
    console.log("support/index.json and shared/helpDocs.js are current");
  } else {
    for (const [f, next] of Object.entries(files)) fs.writeFileSync(rel(f), next);
    const idx = JSON.parse(files["support/index.json"]);
    console.log(`support/index.json: ${idx.passages.length} passages`, idx.counts);
  }
}

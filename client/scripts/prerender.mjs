#!/usr/bin/env node
// CONTENT-1 · prerender every marketing route to static HTML.
//
// `npm run build` runs the browser build (dist/), then the Node build of the
// marketing site (vite.prerender.config.js → dist-prerender/), then this.
// For each route in marketing/routes.js it renders the page with
// ReactDOMServer, puts that HTML inside #root of the built index.html, writes
// the page's own head (title, description, canonical, Open Graph, structured
// data) and saves it as dist/<path>/index.html. Vercel serves a file before
// any rewrite, so a crawler's first response is the finished page. In the
// browser main.jsx renders the same route over it as it always has.
//
// The untouched shell is kept as dist/app.html, and vercel.json sends every
// path without a file (the app, /login, an org's giving page) there, so the
// app never opens on top of the homepage's HTML.
//
// It also writes sitemap.xml, rss.xml and robots.txt, and fails the build if a
// page has no h1, two h1s, or a title or description another page has.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const t0 = Date.now();
// React's production server renderer: faster, and what the browser build matches.
process.env.NODE_ENV = "production";
const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(CLIENT, "dist");
const homeReads = await import(pathToFileURL(path.join(CLIENT, "src", "lib", "homeReads.js")).href);   // PERF-2
const { render, ROUTES, ARTICLE, TERM } = await import(pathToFileURL(path.join(CLIENT, "dist-prerender", "prerender.mjs")).href);
const seo = await import(pathToFileURL(path.join(CLIENT, "src", "marketing", "seo.js")).href);
const { ARTICLES } = await import(pathToFileURL(path.join(CLIENT, "src", "marketing", "articles", "index.js")).href);
const { GLOSSARY } = await import(pathToFileURL(path.join(CLIENT, "src", "marketing", "data", "glossary.js")).href);

// A rerun reads the shell it saved the first time (vite build empties dist/,
// so a saved app.html is always from this build).
// SECURE-2 item 5: the preloader stays inline (a file cost a round trip, and
// perf-app's "usable under 1 s" with it), and the app's script CSP allows it
// by hash. Its text is fixed (PRELOAD_JS); what changes per build (the chunks,
// the font) rides in data attributes, so the hash in vercel.json never moves.
// Change a byte of PRELOAD_JS and change that hash with it.
// PERF-2: it also starts the boot's reads itself (the entry used to, once it
// had downloaded), and api.js prefetch takes those answers. It sits ahead of
// the entry's scripts and stylesheet (below), and adds its links on the next
// turn, once the parser has asked for the entry's scripts and stylesheet:
// added at once, they sometimes took the connections first and the entry waited.
// PERF-3: on Home it also preloads the lazy parts Home's first look draws
// (data-home-need), so the deck's code is in before Home draws.
// PERF-4: and on any other main page, that page's own chunk and the chunks it
// imports (data-page-need: [address pattern, files] pairs, PAGE_CHUNKS below),
// so they download beside App's instead of after App has run. Preloaded, not
// imported: importing them from main.jsx split App's shared code into a dozen
// small chunks and grew Home's first look by 21 KB.
// ACCESS-2B: not for someone who sees only their own people: their reads go
// through api.js, which asks only their open routes (lib/portfolioRoutes.js).
const PRELOAD_JS = `(function(){try{var s=document.currentScript;if(!s||!/^\\/(app|dashboard|donors)(\\/|$)/.test(location.pathname)||!localStorage.getItem("npe_token")||/"portfolio":true/.test(localStorage.getItem("npe_user")||""))return;` +
  `var t=localStorage.getItem("npe_token"),api=s.getAttribute("data-api"),here=location.pathname.replace(/(.)\\/+$/,"$1"),e=window.__stewardEarly={at:Date.now(),reads:{}};` +
  `JSON.parse(s.getAttribute(here==="/dashboard"?"data-home-reads":"data-reads")||"[]").forEach(function(u){e.reads[u]=fetch(api+u,{headers:{"Content-Type":"application/json",Authorization:"Bearer "+t}}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;});});` +
  `var add=function(rel,h){var l=document.createElement("link");l.rel=rel;l.href=h;document.head.appendChild(l);};` +
  `setTimeout(function(){try{var pn=JSON.parse(s.getAttribute("data-page-need")||"[]"),pg=[];pn.forEach(function(x){if(!pg.length&&new RegExp(x[0]).test(here))pg=x[1];});` +
  `JSON.parse(s.getAttribute("data-need")||"[]").concat(here==="/dashboard"?JSON.parse(s.getAttribute("data-home-need")||"[]"):[],pg).forEach(function(h){add("modulepreload",h);});` +
  `(s.getAttribute("data-font-files")||"").split(" ").forEach(function(h){if(!h)return;var l=document.createElement("link");l.rel="preload";l.as="font";l.type="font/woff2";l.crossOrigin="anonymous";l.href=h;document.head.appendChild(l);});}catch(e){}},0);}catch(e){}})();`;
const attr = v => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const SHELL = path.join(DIST, "app.html");
const PRELOAD = /<!-- app-preload -->[\s\S]*?<!-- \/app-preload -->\n?/;
const shell = fs.readFileSync(fs.existsSync(SHELL) ? SHELL : path.join(DIST, "index.html"), "utf8").replace(PRELOAD, "");
// PERF-2: ahead of the entry's scripts and stylesheet, not at the end of the
// head. An inline script waits for every stylesheet above it, so after the
// app's CSS it ran only once that had downloaded: 750 ms of a slow phone's
// time with nothing of the app's code asked for.
const FIRST_ENTRY = /\n?(\s*)<script type="module"/;
fs.writeFileSync(SHELL, FIRST_ENTRY.test(shell)
  ? shell.replace(FIRST_ENTRY, (m, ind) => "\n" + ind + appPreload().trimEnd() + m)
  : shell.replace("</head>", appPreload() + "</head>"));

// HARDEN-2 item 2: the app's own code (App.jsx's chunk and what it imports)
// is asked for by the shell itself, on an app path with a session, instead of
// after main.js has downloaded and run. Read from Vite's manifest, which is
// then deleted: dist/ ships no map of its chunks.
function appPreload() {
  const MAN = path.join(DIST, ".vite", "manifest.json");
  if (!fs.existsSync(MAN)) return "";
  const man = JSON.parse(fs.readFileSync(MAN, "utf8"));
  fs.rmSync(path.join(DIST, ".vite"), { recursive: true, force: true });
  // Chunks are found by file, not by key: the manifest keys main.jsx's chunk
  // as an import ("_main-….js"), since components import it too.
  const keyOf = file => Object.keys(man).find(k => man[k].file === file);
  const appKey = Object.keys(man).find(k => /^assets\/App-[^/]+\.js$/.test(man[k].file));
  if (!appKey) return "";
  const have = new Set(), need = [];
  const walk = (key, into) => { const c = man[key]; if (!c || into.has(c.file)) return; into.add(c.file); (c.imports || []).forEach(k => walk(k, into)); };
  const index = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
  for (const m of index.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)) walk(keyOf(m[1]), have);
  const want = new Set(); walk(appKey, want);
  for (const f of want) if (!have.has(f)) need.push("/" + f);
  // PERF-3: and on Home, the lazy parts its first look draws, each marked where
  // it is imported (`import(/* first-look */ "../Insights")`, today the moves
  // deck), with the chunks they import that the app has not already asked for.
  // Read from the manifest; a mark that names no chunk fails the build.
  const homeNeed = [];
  const srcFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? srcFiles(path.join(dir, e.name)) : /\.jsx?$/.test(e.name) ? [path.join(dir, e.name)] : []);
  for (const file of srcFiles(path.join(CLIENT, "src")))
    for (const m of fs.readFileSync(file, "utf8").matchAll(/import\(\s*\/\*\s*first-look\s*\*\/\s*["']([^"']+)["']\s*\)/g)) {
      const target = path.relative(CLIENT, path.resolve(path.dirname(file), m[1])).split(path.sep).join("/");
      const key = Object.keys(man).find(k => k === target || k.replace(/\.jsx?$/, "") === target);
      if (!key) throw new Error(`prerender: ${path.relative(CLIENT, file)} marks ${m[1]} first-look, and the manifest has no chunk for it`);
      const into = new Set(); walk(key, into);
      for (const f of into) if (!have.has(f) && !want.has(f) && !homeNeed.includes("/" + f)) homeNeed.push("/" + f);
    }
  // PERF-4: each main page's chunk with what it imports that App has not.
  const PAGE_CHUNKS = [
    ["^/donors(/|$)", "src/components/Donors.jsx"], ["^/app/fundraising/?$", "src/components/Fundraising.jsx"],
    ["^/app/reports/?$", "src/components/Reports.jsx"], ["^/app/settings/?$", "src/components/Settings.jsx"],
    ["^/app/journeys/?$", "src/components/JourneyBuilder.jsx"], ["^/app/tasks/?$", "src/components/Tasks.jsx"],
    ["^/app/communications/?$", "src/components/Communications.jsx"], ["^/app/grants/?$", "src/components/Grants.jsx"],
    ["^/app/finance/?$", "src/components/Finance.jsx"],
  ];
  const pageNeed = PAGE_CHUNKS.map(([re, key]) => {
    if (!man[key]) throw new Error(`prerender: PAGE_CHUNKS names ${key}, and the manifest has no chunk for it`);
    const into = new Set(); walk(key, into);
    return [re, [...into].filter(f => !have.has(f) && !want.has(f)).map(f => "/" + f)];
  });
  // And the app's fonts (App.jsx's own stylesheet URL, so it is fetched once):
  // asked for now, they are in before Home draws, instead of arriving after it
  // and making a slow phone lay the whole page out again. Added by script, so
  // nothing waits on it.
  // PERF-2: the stylesheet alone did not do it. A browser fetches a font file
  // only when text first uses it, so the files still left after Home's first
  // render, from a second host. They are now Steward's own (public/fonts/) and
  // the latin files (every word Home draws) are preloaded here with the rest.
  const app = fs.readFileSync(path.join(CLIENT, "src", "App.jsx"), "utf8");
  const font = (app.match(/\/fonts\/app-fonts\.css/) || [])[0];
  // PERF-3: each font file is copied under /assets/ with a hash in its name,
  // so vercel.json's year-long immutable cache holds it and a second morning
  // asks for no font at all (at /fonts/ every visit asked again, a round trip
  // each on a phone). Only the body face's latin file is preloaded: the serif
  // draws headlines, and in the fallback sized to it until it is in.
  const hashed = new Map();
  const css = (font ? fs.readFileSync(path.join(DIST, font.slice(1)), "utf8") : "").replace(/url\((\/fonts\/[^)]+\.woff2)\)/g, (m, u) => {
    if (!hashed.has(u)) {
      const buf = fs.readFileSync(path.join(DIST, u.slice(1)));
      const out = `/assets/${path.basename(u, ".woff2")}-${createHash("sha256").update(buf).digest("base64url").slice(0, 8)}.woff2`;
      fs.writeFileSync(path.join(DIST, out.slice(1)), buf);
      hashed.set(u, out);
    }
    return `url(${hashed.get(u)})`;
  });
  const files = [...hashed].filter(([u]) => /\/dm-sans-latin\.woff2$/.test(u)).map(([, h]) => h);
  // PERF-2: the boot's bundles (lib/homeReads.js bootBundles, the lists and the
  // order main.jsx asks in), started by the preloader itself, and the API they
  // go to (api.js's own: VITE_API_URL, else its default).
  const R = homeReads;
  const reads = home => JSON.stringify(R.bootBundles(home).map(R.bundlePath));
  const apiSrc = fs.readFileSync(path.join(CLIENT, "src", "api.js"), "utf8");
  const apiBase = process.env.VITE_API_URL || (/export const API = import\.meta\.env\.VITE_API_URL \|\| "([^"]+)"/.exec(apiSrc) || [])[1] || "";
  // The faces themselves are written into the shell, not asked for: on a phone
  // every request waits for a connection. (A face downloads nothing until text
  // uses it, so a page that draws in other fonts pays nothing for these.)
  const faces = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*\n\s*/g, " ").trim();
  // PERF-3: the boot's reads leave as the preloader runs; a preconnect first in
  // the block opens their connection while the parser is still in the head.
  const pre = apiBase ? `<link rel="preconnect" href="${attr(new URL(apiBase).origin)}" crossorigin>` : "";
  return `<!-- app-preload -->${pre}${faces ? `<style data-app-fonts>${faces}</style>` : ""}<script data-need="${attr(JSON.stringify(need))}"${homeNeed.length ? ` data-home-need="${attr(JSON.stringify(homeNeed))}"` : ""} data-page-need="${attr(JSON.stringify(pageNeed))}"${apiBase ? ` data-api="${attr(apiBase)}" data-reads="${attr(reads(false))}" data-home-reads="${attr(reads(true))}"` : ""}${files.length ? ` data-font-files="${attr(files.join(" "))}"` : ""}>${PRELOAD_JS}</script><!-- /app-preload -->\n`;
}

const base = seo.pageShell(shell);

const problems = [];
const seenTitle = new Map(), seenDesc = new Map();
for (const r of ROUTES) {
  const html = render(r.path);
  const h = seo.h1s(html);
  if (h.length !== 1) problems.push(`${r.path}: ${h.length} h1 elements`);
  if (seenTitle.has(r.title)) problems.push(`${r.path}: title also on ${seenTitle.get(r.title)}`);
  if (seenDesc.has(r.description)) problems.push(`${r.path}: description also on ${seenDesc.get(r.description)}`);
  seenTitle.set(r.title, r.path); seenDesc.set(r.description, r.path);
  const extra = r.page === "article" ? { article: ARTICLE[r.slug] } : r.page === "glossaryTerm" ? { term: TERM[r.slug] } : r.page === "glossary" ? { terms: GLOSSARY } : {};
  const page = seo.assemblePage(base, r, html, extra);
  const out = r.path === "/" ? path.join(DIST, "index.html") : path.join(DIST, r.path, "index.html");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, page);
}
fs.writeFileSync(path.join(DIST, "sitemap.xml"), seo.sitemapXml(ROUTES));
fs.writeFileSync(path.join(DIST, "rss.xml"), seo.rssXml(ARTICLES));
fs.writeFileSync(path.join(DIST, "robots.txt"), seo.ROBOTS);

if (problems.length) { console.error("prerender FAILED:\n  " + problems.join("\n  ")); process.exit(1); }
console.log(`prerender: ${ROUTES.length} marketing pages, sitemap.xml, rss.xml and robots.txt written in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

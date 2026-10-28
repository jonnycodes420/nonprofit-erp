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

const t0 = Date.now();
// React's production server renderer: faster, and what the browser build matches.
process.env.NODE_ENV = "production";
const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(CLIENT, "dist");
const { render, ROUTES, ARTICLE, TERM } = await import(pathToFileURL(path.join(CLIENT, "dist-prerender", "prerender.mjs")).href);
const seo = await import(pathToFileURL(path.join(CLIENT, "src", "marketing", "seo.js")).href);
const { ARTICLES } = await import(pathToFileURL(path.join(CLIENT, "src", "marketing", "articles", "index.js")).href);
const { GLOSSARY } = await import(pathToFileURL(path.join(CLIENT, "src", "marketing", "data", "glossary.js")).href);

// A rerun reads the shell it saved the first time (vite build empties dist/,
// so a saved app.html is always from this build).
const SHELL = path.join(DIST, "app.html");
const PRELOAD = /<!-- app-preload -->[\s\S]*?<!-- \/app-preload -->\n?/;
const shell = fs.readFileSync(fs.existsSync(SHELL) ? SHELL : path.join(DIST, "index.html"), "utf8").replace(PRELOAD, "");
fs.writeFileSync(SHELL, shell.replace("</head>", appPreload() + "</head>"));

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
  // And the app's fonts (App.jsx's own stylesheet URL, so it is fetched once):
  // asked for now, they are in before Home draws, instead of arriving after it
  // and making a slow phone lay the whole page out again. Added by script, so
  // nothing waits on it.
  const app = fs.readFileSync(path.join(CLIENT, "src", "App.jsx"), "utf8");
  const font = (app.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"]+/) || [])[0];
  return `<!-- app-preload --><script>(function(){try{if(!/^\\/(app|dashboard|donors)(\\/|$)/.test(location.pathname)||!localStorage.getItem("npe_token"))return;` +
    `var add=function(rel,h){var l=document.createElement("link");l.rel=rel;l.href=h;document.head.appendChild(l);};` +
    `${JSON.stringify(need)}.forEach(function(h){add("modulepreload",h);});` +
    (font ? `add("stylesheet",${JSON.stringify(font.replace(/&amp;/g, "&"))});` : "") +
    `}catch(e){}})();</script><!-- /app-preload -->\n`;
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

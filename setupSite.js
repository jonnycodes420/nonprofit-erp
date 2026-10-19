// setupSite.js · ONBOARD-1. READ THEIR WEBSITE, AND SAY WHAT IT DID NOT FIND.
//
// The person gives Steward their website address. This module fetches a few
// public pages (the address they gave, then at most three more from the same
// host that their own navigation links to: about, team, programs, donate),
// respects robots.txt, and reads facts out of the HTML in code: the mission
// line, the logo, the brand colours, the program names, staff names with
// titles, the mailing address, an EIN when one is printed, and the giving page
// link. It also keeps a short sample of how they write, for the thank-you
// drafts to sound like them.
//
// WHAT IT NEVER DOES. It never guesses. A fact it found once, in one place,
// with the pattern that found it, is a FACT with a `from` (the page and the
// words). A fact it could not settle (two EINs, no mission sentence, a colour
// it is not sure is the brand's) is a QUESTION, never a value. AI is not used
// here at all: these are facts, and AI writes sentences, never facts.
//
// THE FETCH IS CAREFUL. http(s) only; no private, loopback or link-local
// address (an address the person types must not become a way to read
// Steward's own network); four pages at most; 600KB a page; eight seconds a
// page; robots.txt Disallow honoured for our user agent and for *. The test
// seam SETUP_SITE_ALLOW_LOCAL=1 lets a suite serve a saved page on localhost;
// it is refused in production.
"use strict";

const dns = require("dns").promises;
const net = require("net");

const UA = "StewardSetup/1.0 (+https://www.stewardapp.dev)";
const MAX_PAGES = 4;
const MAX_BYTES = 600 * 1024;
const TIMEOUT_MS = 8000;
const FOLLOW_WORDS = /\b(about|who we are|our story|team|staff|leadership|people|programs?|what we do|services|donate|give|giving|support us)\b/i;

function allowLocal() {
  return process.env.SETUP_SITE_ALLOW_LOCAL === "1" && process.env.NODE_ENV !== "production";
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.")
    || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}

// The address she typed, as a URL we are willing to fetch, or a reason.
function normaliseSiteUrl(raw) {
  let s = String(raw || "").trim();
  if (!s) return { ok: false, reason: "no address given" };
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { return { ok: false, reason: "that is not a web address" }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, reason: "only http and https addresses are read" };
  if (u.username || u.password) return { ok: false, reason: "an address with a password in it is not read" };
  u.hash = "";
  return { ok: true, url: u };
}

async function hostIsSafe(u) {
  if (allowLocal()) return true;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (net.isIP(host)) return !isPrivateIp(host);
  try {
    const addrs = await dns.lookup(host, { all: true });
    return addrs.length > 0 && addrs.every(a => !isPrivateIp(a.address));
  } catch { return false; }
}

async function fetchText(u, fetchImpl) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    // redirect: manual, so a redirect cannot carry the fetch to a host we did
    // not check. One same-host redirect is followed by hand.
    let r = await fetchImpl(u.href, { headers: { "user-agent": UA, accept: "text/html,text/plain" }, redirect: "manual", signal: ctl.signal });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      const next = new URL(r.headers.get("location"), u);
      if (next.hostname !== u.hostname || !(await hostIsSafe(next))) return { ok: false, status: r.status, reason: "it redirects to another site" };
      r = await fetchImpl(next.href, { headers: { "user-agent": UA }, redirect: "manual", signal: ctl.signal });
    }
    if (!r.ok) return { ok: false, status: r.status, reason: `the page answered ${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: true, text: buf.slice(0, MAX_BYTES).toString("utf8"), contentType: r.headers.get("content-type") || "" };
  } catch (e) {
    return { ok: false, reason: e && e.name === "AbortError" ? "the page took too long" : "the page could not be reached" };
  } finally { clearTimeout(t); }
}

// robots.txt: the Disallow lines that apply to us or to everybody.
function robotsDisallows(text) {
  const out = [];
  let applies = false;
  for (const line of String(text || "").split(/\r?\n/)) {
    const l = line.replace(/#.*/, "").trim();
    const m = l.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") applies = v === "*" || /stewardsetup/i.test(v);
    else if (k === "disallow" && applies && v) out.push(v);
  }
  return out;
}
const robotsAllows = (dis, pathname) => !dis.some(p => pathname.startsWith(p));

// ── THE READERS (pure: HTML in, facts out) ─────────────────────────────────
// One pass over every entity, so "&amp;lt;" reads as the text "&lt;" and is
// never decoded twice. The result is plain text: it is only ever shown as text.
const ENTITIES = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
const decode = s => String(s || "").replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
});
const stripTags = h => decode(String(h || "").replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, " ").replace(/<style\b[\s\S]*?<\/style\b[^>]*>/gi, " ")
  .replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")); return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : ""; };
const tags = (html, name) => String(html || "").match(new RegExp(`<${name}\\b[^>]*>`, "gi")) || [];
const blocks = (html, name) => [...String(html || "").matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "gi"))].map(m => m[1]);

function meta(html, key) {
  for (const t of tags(html, "meta")) {
    const n = (attr(t, "name") || attr(t, "property")).toLowerCase();
    if (n === key) return attr(t, "content");
  }
  return "";
}

// A US EIN: two digits, a dash, seven digits, near the words EIN / Tax ID.
const EIN_RE = /\b(?:EIN|E\.I\.N\.|Tax\s*ID|Federal\s+Tax\s+ID(?:\s+Number)?|Tax\s+Identification\s+Number)\s*(?:#|No\.?|number)?\s*[:.]?\s*(\d{2}-\d{7})\b/gi;
// A US street address ending in a state and ZIP.
const ADDR_RE = /(\d{1,6}\s+[A-Za-z0-9.' ]{2,40}?\s(?:Road|Rd|Street|St|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Place|Pl|Pike|Highway|Hwy|Parkway|Pkwy)\.?(?:,?\s*(?:Suite|Ste|Unit|#)\s*[A-Za-z0-9-]+)?),\s*([A-Za-z .'-]{2,40}),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?/;
const COLOR_RE = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const TITLE_WORDS = /\b(Executive Director|Director|President|CEO|Chief Executive|Founder|Co-Founder|Manager|Coordinator|Officer|Chair|Treasurer|Secretary|Pastor|Minister|Development|Program|Operations)\b/;

function expandHex(h) {
  const x = h.replace("#", "").toLowerCase();
  return "#" + (x.length === 3 ? x.split("").map(c => c + c).join("") : x).toUpperCase();
}
// Very light and very dark greys are page chrome, not a brand.
function isChromeColour(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max - min < 18 || max < 30 || min > 235;
}

// One page's facts. `page` is { url, html }.
function readPage(page) {
  const html = String(page.html || "");
  const text = stripTags(html);
  const url = page.url;
  const f = { url, title: stripTags((blocks(html, "title")[0] || "")), text };

  // Mission: the meta description when it reads as a sentence, else the
  // first paragraph of the main content that does.
  const desc = meta(html, "description") || meta(html, "og:description");
  const paras = blocks(html, "p").map(stripTags).filter(s => s.length >= 40 && s.length <= 320 && /[.!]$/.test(s));
  f.missionCandidates = [...new Set([desc, ...paras.slice(0, 1)].map(s => String(s || "").trim()).filter(s => s.length >= 30 && /[a-z]/.test(s)))];

  // Logo: an <img> whose alt, src or class says logo, then og:image, then the icon.
  let logo = "";
  for (const t of tags(html, "img")) {
    const s = attr(t, "src"), a = attr(t, "alt"), c = attr(t, "class");
    if (s && /logo/i.test(a + " " + s + " " + c)) { logo = s; break; }
  }
  if (!logo) logo = meta(html, "og:image");
  if (!logo) for (const t of tags(html, "link")) if (/icon/i.test(attr(t, "rel")) && attr(t, "href")) { logo = attr(t, "href"); break; }
  f.logo = logo ? safeAbs(logo, url) : "";

  // Colours: theme-color first (the site says so), then the colours its own
  // styles use most, chrome greys left out.
  const theme = meta(html, "theme-color");
  const styles = blocks(html, "style").join("\n") + " " + tags(html, "[a-z]+").map(t => attr(t, "style")).join(" ");
  const counts = new Map();
  for (const m of styles.matchAll(COLOR_RE)) { const h = expandHex(m[0]); if (!isChromeColour(h)) counts.set(h, (counts.get(h) || 0) + 1); }
  f.themeColour = theme && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(theme) ? expandHex(theme) : "";
  f.colours = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);

  // EINs, every one printed (two different ones is a question).
  f.eins = [...new Set([...text.matchAll(EIN_RE)].map(m => m[1]))];
  const am = text.match(ADDR_RE);
  f.address = am ? { line1: am[1].trim(), city: am[2].trim(), state: am[3], zip: am[4], words: am[0] } : null;

  // Legal name: "<Name>, Inc." or a copyright line, when the page prints it.
  // Read one paragraph at a time from its start, so a button's words on the
  // same page never run into the name.
  f.legalName = "";
  for (const p of [...blocks(html, "footer"), ...blocks(html, "p")].flatMap(b => blocks(b, "p").length ? blocks(b, "p") : [b]).map(stripTags)) {
    const lm = p.match(/^(?:©\s*(?:\d{4}\s*)?)?([A-Z][A-Za-z&'. -]{3,80}?,?\s(?:Inc|Incorporated|Foundation|Corporation|Corp)\.?)(?=\s|·|,|$)/);
    if (lm) { f.legalName = lm[1].replace(/\s+/g, " ").trim(); break; }
  }

  // Staff: list items and paragraphs that pair a capitalised name with a title.
  f.staff = [];
  for (const raw of [...blocks(html, "li"), ...blocks(html, "p"), ...blocks(html, "h3")]) {
    const s = stripTags(raw);
    if (s.length > 120) continue;
    // A name part may be hyphenated (Okafor-Marsh); the separator is a comma,
    // a bar, a colon or a SPACED dash, so a hyphen inside a name never splits it.
    const m = s.match(/^([A-Z][a-z']+(?:-[A-Z][a-z']+)?(?:\s[A-Z][a-z']+(?:-[A-Z][a-z']+)?){1,2})\s*(?:,|\||:|\s[-–]\s)\s*(.{3,60})$/);
    if (m && TITLE_WORDS.test(m[2])) f.staff.push({ name: m[1], title: m[2].trim().replace(/[.]$/, "") });
  }

  // Programs: h2/h3 headings on a page about programs or services.
  f.programs = [];
  if (/program|service|what we do/i.test(f.title + " " + url)) {
    for (const h of [...blocks(html, "h2"), ...blocks(html, "h3")].map(stripTags)) {
      if (h.length >= 3 && h.length <= 48 && !/program|about|contact|team|donate/i.test(h)) f.programs.push(h);
    }
  }

  // The giving page: a link whose words say give or donate.
  f.givingLinks = [];
  f.links = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr("<a " + m[1] + ">", "href");
    const words = stripTags(m[2]);
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    const abs = safeAbs(href, url);
    if (!abs) continue;
    f.links.push({ href: abs, words });
    if (/\b(donate|give|giving)\b/i.test(words + " " + href)) f.givingLinks.push(abs);
  }

  // How they write to a donor: the sentences that thank somebody.
  f.voice = (text.match(/[^.!?]*\b(thank you|grateful|thanks to you|because of you)\b[^.!?]*[.!?]/gi) || [])
    .map(s => s.trim()).filter(s => s.length >= 20 && s.length <= 260);
  return f;
}

function safeAbs(href, base) {
  try { const u = new URL(href, base); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch { return ""; }
}

// Several pages' facts, merged. A FACT has a value and where it came from; a
// QUESTION has what was found and why it is not settled. Never both.
function mergeSite(pages, siteUrl) {
  const facts = {}, questions = [];
  const fact = (key, value, from) => { facts[key] = { value, from }; };
  const home = pages[0] || null;

  const missions = pages.flatMap(p => p.missionCandidates.map(m => ({ m, url: p.url })));
  if (missions.length) fact("mission", missions[0].m, { url: missions[0].url, words: missions[0].m });
  else questions.push({ key: "mission", text: "We did not find a mission sentence on your site. What is it, in one line?" });

  const logo = pages.map(p => p.logo && { logo: p.logo, url: p.url }).find(Boolean);
  if (logo) fact("logoUrl", logo.logo, { url: logo.url, words: "the image marked as your logo" });
  else questions.push({ key: "logoUrl", text: "We did not find a logo on your site. You can add one in Settings." });

  const theme = pages.map(p => p.themeColour).find(Boolean);
  const cols = [...new Set(pages.flatMap(p => p.colours))];
  const primary = theme || cols[0] || "";
  if (primary) {
    fact("brandPrimary", primary, { url: home && home.url, words: theme ? "your site's theme color" : "the color your site's styles use most" });
    const accent = cols.find(c => c !== primary);
    if (accent) fact("brandAccent", accent, { url: home && home.url, words: "the next color your site's styles use most" });
  } else questions.push({ key: "brandPrimary", text: "We could not tell your brand color from your site." });

  const eins = [...new Set(pages.flatMap(p => p.eins))];
  if (eins.length === 1) fact("ein", eins[0], { url: pages.find(p => p.eins.includes(eins[0])).url, words: "EIN " + eins[0] });
  else if (eins.length > 1) questions.push({ key: "ein", text: `Your site prints more than one EIN (${eins.join(", ")}). Which is yours?`, options: eins });
  else questions.push({ key: "ein", text: "Your receipts need your EIN, and your site does not print it. What is it?" });

  const addr = pages.map(p => p.address && { a: p.address, url: p.url }).find(Boolean);
  if (addr) fact("address", addr.a, { url: addr.url, words: addr.a.words });
  else questions.push({ key: "address", text: "Your receipts need a mailing address. What is it?" });

  const legal = pages.map(p => p.legalName && { n: p.legalName, url: p.url }).find(Boolean);
  if (legal) fact("legalName", legal.n, { url: legal.url, words: legal.n });
  else questions.push({ key: "legalName", text: "What is your legal name, as the IRS has it? It goes on every receipt." });

  const seen = new Set(), staff = [];
  for (const p of pages) for (const s of p.staff) { const k = s.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); staff.push({ ...s, url: p.url }); } }
  if (staff.length) fact("staff", staff, { url: staff[0].url, words: `${staff.length} names with titles` });

  const programs = [...new Set(pages.flatMap(p => p.programs))];
  if (programs.length) fact("programs", programs, { url: (pages.find(p => p.programs.length) || {}).url, words: programs.join(", ") });

  const give = [...new Set(pages.flatMap(p => p.givingLinks))];
  if (give.length) fact("givingUrl", give[0], { url: home && home.url, words: "the link that says give or donate" });

  const voice = [...new Set(pages.flatMap(p => p.voice))].slice(0, 3);
  if (voice.length) fact("voiceSample", voice.join(" "), { url: home && home.url, words: voice[0] });

  const name = home && home.title ? home.title.split(/\s[|·–-]\s/)[0].trim() : "";
  if (name) fact("displayName", name, { url: home.url, words: home.title });

  return { siteUrl, pagesRead: pages.map(p => p.url), facts, questions };
}

// Fetch and read. `fetchImpl` is injectable; the default is the global fetch.
async function readSite(rawUrl, { fetchImpl = globalThis.fetch } = {}) {
  const n = normaliseSiteUrl(rawUrl);
  if (!n.ok) return { ok: false, reason: n.reason, pagesRead: [], facts: {}, questions: [] };
  const start = n.url;
  if (!(await hostIsSafe(start))) return { ok: false, reason: "that address is not a public website", pagesRead: [], facts: {}, questions: [] };
  const robots = await fetchText(new URL("/robots.txt", start), fetchImpl);
  const dis = robots.ok ? robotsDisallows(robots.text) : [];
  if (!robotsAllows(dis, start.pathname)) return { ok: false, reason: "your site's robots.txt asks us not to read that page", pagesRead: [], facts: {}, questions: [] };
  const first = await fetchText(start, fetchImpl);
  if (!first.ok) return { ok: false, reason: first.reason, pagesRead: [], facts: {}, questions: [] };
  const pages = [readPage({ url: start.href, html: first.text })];
  const skipped = [];
  const next = [];
  for (const l of pages[0].links) {
    let u; try { u = new URL(l.href); } catch { continue; }
    if (u.hostname !== start.hostname || u.href === start.href || next.some(x => x.href === u.href)) continue;
    if (FOLLOW_WORDS.test(l.words + " " + u.pathname)) next.push(u);
  }
  for (const u of next) {
    if (pages.length >= MAX_PAGES) break;
    if (!robotsAllows(dis, u.pathname)) { skipped.push({ url: u.href, reason: "robots.txt" }); continue; }
    const r = await fetchText(u, fetchImpl);
    if (r.ok) pages.push(readPage({ url: u.href, html: r.text }));
    else skipped.push({ url: u.href, reason: r.reason });
  }
  return { ok: true, ...mergeSite(pages, start.href), skipped };
}

module.exports = { readSite, readPage, mergeSite, normaliseSiteUrl, robotsDisallows, isPrivateIp, hostIsSafe, MAX_PAGES };

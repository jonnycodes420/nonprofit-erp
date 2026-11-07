// PERF-4 · THE PAGE-READY MARK: when a page is ready the way a person feels it.
//
// A page is ready when, all at once:
//   · its main content is drawn (the app's content column, `.app-content`, has
//     text in it),
//   · no spinner is showing in it: no skeleton, no "Loading…" or "Reading…"
//     line, nothing marked busy or `-loading`,
//   · and no read to the API is in flight, so its numbers are in, not on the
//     way. A read (GET) counts; a write, a beacon and the AI stream do not.
// and it stays so for QUIET_MS (a panel whose read starts in the frame after
// the last one landed is still loading). The time is the moment it first
// became so, from the navigation's start (a page load), or from the click
// (a move inside the app).
//
// It is marked three ways: performance.mark("steward:page-ready"),
// window.__stewardReady (the perf check reads it), and one beacon to
// POST /perf/page-ready with the page's name, the milliseconds and whether it
// was the first page after a page load. Time only: no id, no name, no number
// from the page. /ops shows them beside the walk trend.
//
// Behaviour-neutral: it watches, it never holds anything back.
//
// SPEED-3: Settings says which section (`part`, from ?section=, "org" when
// none), and a move between sections is timed like a move between pages. The
// giving page editor (/portal-editor) is a page of its own; it draws outside
// the app's content column, so it is timed from its own root.
const QUIET_MS = 150;
const GIVE_UP_MS = 30000;
const SPINNER = '[data-testid^="skeleton"],[data-testid$="-loading"],[aria-busy="true"],[role="progressbar"]';
const SPINNER_TEXT = /^(Loading|Reading)\b[^.]{0,60}…$/;
const PAGES = [
  [/^\/portal-editor\/?$/, () => "giving-page-editor"],
  [/^\/dashboard\/?$/, () => "home"],
  [/^\/donors\/?$/, () => "donors"],
  [/^\/donors\/[^/]+$/, () => "profile"],
  [/^\/app\/reports\/?$/, s => (new URLSearchParams(s).get("report") === "giving-summary" ? "giving-report" : "reports")],
  [/^\/app\/([a-z0-9-]+)\/?$/, (s, m) => m[1]],
  // PAGES-1: the public pages a donor or volunteer opens, timed the same way
  // (marked only: a stranger's browser sends no beacon).
  [/^\/give\/[^/]+\/[^/]+\/?$/, () => "public-giving-page"],
  [/^\/volunteer-page\/[^/]+\/[^/]+\/?$/, () => "public-volunteer-page"],
  [/^\/membership-page\/[^/]+\/[^/]+\/?$/, () => "public-membership-page"],
];

let inFlight = 0;
const pending = new Map();   // what is in flight, for a check that went red to name
let seq = 0;
let watch = null;
let sink = null;
let firstOfLoad = true;

export function pageName(pathname, search = "") {
  for (const [re, name] of PAGES) { const m = re.exec(pathname); if (m) return name(search, m); }
  return null;
}

function counts(input, init) {
  try {
    const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    const url = String(typeof input === "string" ? input : (input && input.url) || "");
    return method === "GET" && !/\/ai\/stream|\/perf\/page-ready/.test(url);
  } catch { return false; }
}

// Settings' section, as the address names it; null on every other page.
export function pagePart(pathname, search = "") {
  if (!/^\/app\/settings\/?$/.test(pathname)) return null;
  return new URLSearchParams(search).get("section") || "org";
}
// The editor draws outside the content column: its own root, drawn once it has loaded.
const ROOT = { "giving-page-editor": '[data-page-root="giving-page-editor"]',
  // PAGES-1: a public page is ready when the page itself is drawn, not its loading line.
  "public-giving-page": '[data-testid="giving-page"]', "public-volunteer-page": '[data-page-root="public-page"]', "public-membership-page": '[data-page-root="public-page"]' };

function spinnerShowing(root) {
  if (root.querySelector(SPINNER)) return true;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.trim();
    if (t.length > 5 && t.length < 80 && SPINNER_TEXT.test(t) && n.parentElement && n.parentElement.offsetParent !== null) return true;
  }
  return false;
}

function readyNow(page) {
  if (inFlight > 0) return false;
  const root = document.querySelector(ROOT[page] || ".app-content");
  if (!root || !(root.textContent || "").trim()) return false;
  return !spinnerShowing(root);
}

function finish(w, ms) {
  w.stop();
  const out = { page: w.page, ms: Math.round(ms), fresh: w.fresh, ...(w.part ? { part: w.part } : {}) };
  try { performance.mark("steward:page-ready", { detail: out }); } catch { /* an old browser */ }
  window.__stewardReady = out;
  (window.__stewardReadyLog = window.__stewardReadyLog || []).push(out);
  if (sink) { try { sink(out); } catch { /* a beacon never breaks the page */ } }
}

function start(page, t0, fresh, part = null) {
  if (watch) watch.stop();
  if (!page) { watch = null; return; }
  let since = null, timer = null, frame = 0, stopped = false;
  const w = { page, fresh, t0, part };
  const check = () => {
    frame = 0;
    if (stopped) return;
    const now = performance.now();
    if (now - t0 > GIVE_UP_MS) return w.stop();
    if (!readyNow(page)) { since = null; clearTimeout(timer); timer = null; return; }
    if (since != null) return;   // already quiet: the timer is running
    since = now;
    timer = setTimeout(() => { timer = null; if (!stopped && since != null && readyNow(page)) finish(w, since - t0); else { since = null; schedule(); } }, QUIET_MS);
  };
  const schedule = () => { if (!frame && !stopped) frame = requestAnimationFrame(check); };
  const mo = new MutationObserver(schedule);
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-busy", "data-testid"] });
  const tick = setInterval(schedule, 100);   // a read landing with nothing drawn yet still re-checks
  w.stop = () => { stopped = true; mo.disconnect(); clearInterval(tick); clearTimeout(timer); if (frame) cancelAnimationFrame(frame); if (watch === w) watch = null; };
  w.schedule = schedule;
  watch = w;
  schedule();
}

// Installed once, before the app's first read. `send` is handed each mark.
export function installPageReady(send) {
  if (typeof window === "undefined" || window.__stewardPageReady) return;
  window.__stewardPageReady = true;
  window.__stewardInFlight = () => [...pending.values()];
  sink = send || null;
  const f = window.fetch;
  window.fetch = function (input, init) {
    if (!counts(input, init)) return f.apply(this, arguments);
    inFlight++;
    const id = ++seq;
    pending.set(id, String(typeof input === "string" ? input : input && input.url).replace(/^https?:\/\/[^/]+/, "").slice(0, 120));
    const p = f.apply(this, arguments);
    const done = () => { inFlight--; pending.delete(id); if (watch) watch.schedule(); };
    p.then(done, done);
    return p;
  };
  // The page load: from the navigation's start.
  start(pageName(location.pathname, location.search), 0, true, pagePart(location.pathname, location.search));
  firstOfLoad = false;
  // A move inside the app: from the moment the address changed.
  const keyNow = () => location.pathname + "|" + pageName(location.pathname, location.search) + "|" + pagePart(location.pathname, location.search);
  let last = keyNow();
  // A section clicked while the last one still loads starts a new wait, so a
  // mark is always the section it names. (An old section name in a link,
  // which Settings rewrites as it opens, is counted as a move to the section.)
  const moved = () => {
    const key = keyNow();
    if (key === last) return;
    last = key;
    start(pageName(location.pathname, location.search), performance.now(), firstOfLoad, pagePart(location.pathname, location.search));
  };
  for (const k of ["pushState", "replaceState"]) {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); moved(); return r; };
  }
  window.addEventListener("popstate", moved);
}

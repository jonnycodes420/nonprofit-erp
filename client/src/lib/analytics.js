// lib/analytics.js · ANALYTICS-1. HOW STEWARD IS USED, TO POSTHOG.
//
// The one file that imports posthog-js. Screens never import it: they call
// lib/analyticsDoor.js, a queue on every page, which fetches this file (and
// then posthog-js) only on the production site after the page has loaded, so
// Home's first look carries neither.
//
// It runs only on the production site (www.stewardapp.dev, stewardapp.dev),
// never on staging, localhost, a Vercel preview or under a test browser
// (navigator.webdriver), so the fleet and the battery never reach the data.
// It never runs on a donor's pages (giving, portal, embedded forms): those
// visitors are an org's donors, not Steward's customers.
//
// What it may carry. An event's properties are ids, counts, kinds and short
// labels; clean() drops anything else before it leaves: a key that names a
// person, a contact detail, money or free text, an email-shaped value, a
// long or sentence-like string. tests/landing2-marketing.test.js scans every
// track() call for those keys too. Autocapture keeps no element text and no
// attribute that can hold a name or an address (scrubEvent), and the address
// keeps only the query keys in KEEP_QUERY.
//
// Replay: every input and ALL text are masked, and every attribute but the
// layout ones (replayAttr), so a recording shows the screen's shape, each click
// and scroll, and never a donor. Masking only named fields (the profile header,
// gift rows, contact fields, still marked [data-ph-mask]) was tried first: the
// walk found the donor list carrying names and emails, in text and in title
// attributes. No replay at all where a card or a signature goes in (NO_REPLAY:
// the order and start link, a quote, the Checkout landing).

// The project's public, write-only browser key (PostHog's own word for it).
// It is meant to ship in client code; it is not a secret.
export const POSTHOG_KEY = "phc_nBKCZC2jUoqx2J9ybaRgCvwBvZaQw7X7ukvFiXN3C5wh";
export const POSTHOG_HOST = "https://us.i.posthog.com";
export const POSTHOG_ASSETS = "https://us-assets.i.posthog.com";
export const ON_HOSTS = ["www.stewardapp.dev", "stewardapp.dev"];
// A donor's pages, never measured.
export const DONOR_PATHS = /^\/(give|giving|embed|portal|join|volunteer-page|membership-page|fundraiser|review|unsubscribe|v|watch|survey|e|auction|ticket|you|volunteer|volunteer-with|recurring|billing)(\/|$)/;
// Where a card or a signature goes in: no replay (ORDER-1's start link, SALES-3's quote, Checkout's landing).
export const NO_REPLAY = /^\/(start|quote|signed-up|order|sign)(\/|$)/;
export const KEEP_QUERY = ["partner", "report", "section", "tab", "ref"];
export const EVENTS = ["gift_recorded", "thank_you_marked_sent", "draft_opened_in_email", "atlas_asked", "tell_steward_used",
  "campaign_sent", "import_finished", "profile_opened", "report_opened", "connection_connected",
  "book_form_started", "book_time_picked", "book_submitted"];
// A key that can only hold a person, a contact detail, money or free text.
export const FORBIDDEN_KEY = /(^|_)(name|names|first|last|full|email|emails|phone|address|street|city|zip|postcode|amount|amounts|total|sum|value|cents|dollars|note|notes|text|question|body|subject|message|comment|q|query|search)($|_)/i;
const EMAIL_SHAPE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const LABEL = /^[A-Za-z0-9_:.\-/]{1,64}$/;   // an id, a kind, a path: no spaces, so no sentence and no "First Last"

// Is PostHog allowed here at all? Pure, so the landing suite can ask it.
export function analyticsAllowed({ hostname, pathname = "/", webdriver = false } = {}) {
  if (webdriver) return false;
  if (!ON_HOSTS.includes(String(hostname || "").toLowerCase())) return false;
  return !DONOR_PATHS.test(pathname);
}

const snake = k => String(k).replace(/([a-z0-9])([A-Z])/g, "$1_$2");   // donorName -> donor_Name, so the key test sees "name"
// An event's properties, cut to what may leave: numbers, booleans and short labels.
export function clean(props) {
  const out = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (FORBIDDEN_KEY.test(snake(k))) continue;
    if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) out[k] = v;
    else if (typeof v === "string" && LABEL.test(v) && !EMAIL_SHAPE.test(v)) out[k] = v;
  }
  return out;
}

// An address with only the query keys we keep (a search box's words stay home).
export function scrubUrl(u) {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (!KEEP_QUERY.includes(k)) url.searchParams.delete(k);
    url.hash = "";
    return url.toString();
  } catch { return u; }
}

// What a replay may keep of an attribute: layout only. A stylesheet's link
// stays (or the replay has no styles); a person's photo and a mailto do not.
const REPLAY_KEEP = /^(class|style|data-testid|role|type|width|height|disabled|tabindex|rel|for|colspan|rowspan|aria-hidden|aria-expanded|aria-selected|aria-checked|aria-current|data-ph-mask)$/;
export function replayAttr(name, value, el) {
  const tag = el && el.tagName ? el.tagName.toUpperCase() : "";
  if (REPLAY_KEEP.test(name)) return value;
  if (tag === "LINK" && name === "href" && !/^(mailto|tel):/i.test(value)) return value;
  if (tag === "IMG" && name === "src" && !/person-photos|^data:|^blob:/i.test(value)) return value;
  return "";
}

const ATTR = /attr__(?!class|data-testid|id|type|role)[\w-]+="(?:[^"\\]|\\.)*"/g;
// What autocapture and pageviews send, with no text and no address-shaped attribute.
export function scrubEvent(ev) {
  if (!ev || !ev.properties) return ev;
  const p = ev.properties;
  try { if (p.$current_url && DONOR_PATHS.test(new URL(p.$current_url).pathname)) return null; } catch { /* keep scrubbing */ }
  for (const k of ["$current_url", "$referrer", "$initial_current_url", "$initial_referrer"]) if (typeof p[k] === "string") p[k] = scrubUrl(p[k]);
  delete p.title; delete p.$title; delete p.$el_text;
  if (typeof p.$elements_chain === "string") p.$elements_chain = p.$elements_chain.replace(ATTR, "").replace(/text="(?:[^"\\]|\\.)*"/g, "");
  if (Array.isArray(p.$elements)) p.$elements = p.$elements.map(e => {
    const o = { tag_name: e.tag_name, nth_child: e.nth_child, nth_of_type: e.nth_of_type, attr_class: e.attr_class, attr_id: e.attr_id };
    for (const a of ["attr__data-testid", "attr__role", "attr__type"]) if (e[a] != null) o[a] = e[a];
    return o;
  });
  return ev;
}

// ── the queue and the lazy load ──────────────────────────────────────────
let ph = null;          // posthog, once loaded
let started = false;
let off = false;        // decided not to run here
const queue = [];
const ctx = { org_id: null };

const run = fn => { if (off) return; if (ph) { try { fn(ph); } catch { /* analytics never breaks a page */ } } else if (queue.length < 200) queue.push(fn); };

function here() {
  if (typeof window === "undefined") return null;
  return { hostname: window.location.hostname, pathname: window.location.pathname, webdriver: !!(typeof navigator !== "undefined" && navigator.webdriver) };
}

// main.jsx calls this once, after the page has loaded.
export function start() {
  if (started) return; started = true;
  const h = here();
  if (!h || !analyticsAllowed(h)) { off = true; queue.length = 0; return; }
  // The whole library, about 125 KB gzipped, fetched only here and only now.
  // (The slim core plus its extension file came to more: that file is one
  // prebuilt bundle and does not tree-shake.)
  import("posthog-js").then(({ default: posthog }) => {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      ui_host: "https://us.posthog.com",
      person_profiles: "identified_only",
      autocapture: true,
      capture_pageview: "history_change",   // SPA pageviews on route change
      capture_pageleave: true,
      mask_all_text: true,                  // autocapture keeps no element text
      mask_all_element_attributes: false,   // scrubEvent keeps class, id, data-testid, role, type only
      disable_surveys: true,
      capture_exceptions: false,            // Sentry has errors
      enable_recording_console_log: false,  // a console line can carry what a screen showed
      capture_performance: false,           // network timing records request URLs, a search's words among them
      disable_session_recording: NO_REPLAY.test(h.pathname),
      session_recording: { maskAllInputs: true, maskTextSelector: "*", maskAttributeFn: replayAttr, blockSelector: "[data-ph-block]" },
      before_send: scrubEvent,
      // Before the first pageview, so a partner's visit carries its code from the first page.
      loaded: p => { const partner = partnerFrom(window.location.search); if (partner) p.register({ partner }); },
    });
    ph = posthog;
    while (queue.length) run(queue.shift());
    watchRoutes();
  }).catch(() => { off = true; queue.length = 0; });
}

export function partnerFrom(search) {
  try { const p = new URLSearchParams(search || "").get("partner"); return p && LABEL.test(p) ? p.slice(0, 40) : null; } catch { return null; }
}

// Route changes, heard from history itself (no router hook on the first look):
// replay stops where a card or a signature goes in, and the module goes quiet
// on a donor's page (scrubEvent drops any event that still names one).
function watchRoutes() {
  for (const k of ["pushState", "replaceState"]) {
    const orig = history[k];
    history[k] = function (st, t, url) {
      try { if (url != null) routeChanged(new URL(url, location.href).pathname); } catch { /* the move still happens */ }
      return orig.apply(this, arguments);
    };
  }
  window.addEventListener("popstate", () => routeChanged(location.pathname));
}
export function routeChanged(pathname) {
  if (off || !started) return;
  if (DONOR_PATHS.test(pathname)) return run(p => p.opt_out_capturing());
  run(p => {
    if (p.has_opted_out_capturing && p.has_opted_out_capturing()) p.opt_in_capturing({ captureEventName: null });
    if (NO_REPLAY.test(pathname)) p.stopSessionRecording(); else p.startSessionRecording();
  });
  const partner = partnerFrom(typeof window !== "undefined" ? window.location.search : "");
  if (partner) run(p => p.register({ partner }));
}

// Who is signed in and which org. Never the email as the id. A super admin's
// support session in a customer's org is tagged and never identified as the
// customer: it carries no person, only the org and the tag.
export function identifyFrom(user, org) {
  if (!user || !org) return;
  const orgProps = { org_id: org.id, org_kind: org.org_kind || org.kind || "customer" };
  ctx.org_id = org.id || null;
  const support = !!user.support;
  run(p => {
    p.register({ org_id: org.id, org_kind: orgProps.org_kind, support_session: support, is_super_admin: !!user.isSuperAdmin });
    if (!support) p.identify(String(user.id), { name: user.name || null, role: user.role || null, org_id: org.id, org_name: org.name || null, org_kind: orgProps.org_kind, is_super_admin: !!user.isSuperAdmin });
    p.group("organization", String(org.id), { name: org.name || null, org_kind: orgProps.org_kind, plan: org.plan || org.subscription_plan || null });
  });
}

// Signing out: the next person on this browser starts clean.
export function forget() { ctx.org_id = null; run(p => p.reset()); }

// A named moment. Only the names in EVENTS, only clean properties, always the org.
export function track(event, props) {
  if (!EVENTS.includes(event)) return;
  const body = { ...clean(props), org_id: ctx.org_id };
  run(p => p.capture(event, body));
}

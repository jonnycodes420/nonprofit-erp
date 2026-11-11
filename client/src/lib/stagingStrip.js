// STAGE-2 · STAGING SAYS IT'S STAGING.
//
// Staging and prod looked identical, so nothing told Jonathan or Muse which
// one they were on. On staging, every page (the app, the landing page and the
// public giving, events, volunteer and portal pages) carries one thin strip
// pinned above everything, above the demo banner, that can't be dismissed, and
// the tab title starts "[Staging] ".
//
// Two triggers:
//   1. the build: deploy-staging passes --build-env VITE_STEWARD_ENV=staging.
//      Prod's deploy never sets it.
//   2. the API, as a fallback when the build var is missing: if /health says
//      env "staging", the strip shows anyway. Prod's /health says
//      "production", so prod never shows it. The prod frontend hosts skip this
//      read altogether, so prod pages make no extra request.
//
// Plain DOM, outside React's root, so a prerendered page, an error boundary or
// a redraw never removes it.

export const STRIP_ID = "steward-staging-strip";
export const STRIP_TEXT = "Staging · not what customers see";
const TITLE_PREFIX = "[Staging] ";
const PROD_HOSTS = ["stewardapp.dev", "www.stewardapp.dev"];

function keepTitlePrefix() {
  const fix = () => { if (!document.title.startsWith(TITLE_PREFIX)) document.title = TITLE_PREFIX + document.title; };
  fix();
  // Pages set their own titles later (marketing, volunteer, giving); keep the prefix on each.
  const head = document.head || document.documentElement;
  new MutationObserver(fix).observe(head, { subtree: true, childList: true, characterData: true });
}

export function showStagingStrip() {
  if (typeof document === "undefined" || document.getElementById(STRIP_ID)) return;
  const strip = document.createElement("div");
  strip.id = STRIP_ID;
  strip.setAttribute("role", "status");
  strip.setAttribute("data-testid", "staging-strip");
  strip.textContent = STRIP_TEXT;
  // Set through the CSSOM, which the Content-Security-Policy allows.
  Object.assign(strip.style, {
    position: "sticky", top: "0", zIndex: "2147483647",
    background: "#0F1A12", color: "#C9A84C", borderBottom: "2px solid #C9A84C",
    font: "600 12px/22px 'DM Sans', system-ui, sans-serif", letterSpacing: "0.04em",
    textAlign: "center", height: "24px", boxSizing: "border-box", margin: "0", padding: "0 16px",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none",
  });
  // The app's top bar and rail, and the site's header, are pinned at the top of
  // the window; they add this to their offset so the strip never covers them.
  // Unset (prod) it reads as 0px and nothing moves.
  const put = () => {
    document.documentElement.style.setProperty("--steward-strip-h", "24px");
    document.body.insertBefore(strip, document.body.firstChild);
    keepTitlePrefix();
  };
  if (document.body) put(); else document.addEventListener("DOMContentLoaded", put, { once: true });
}

export function installStagingStrip({ api, buildEnv = import.meta.env.VITE_STEWARD_ENV } = {}) {
  if (typeof window === "undefined") return;
  if (String(buildEnv || "").trim().toLowerCase() === "staging") { showStagingStrip(); return; }
  if (PROD_HOSTS.includes(window.location.hostname) || !api) return;
  const ask = () => fetch(String(api).replace(/\/+$/, "") + "/health", { credentials: "omit" })
    .then(r => (r.ok ? r.json() : null))
    .then(h => { if (h && h.env === "staging") showStagingStrip(); })
    .catch(() => {});
  if (document.readyState === "complete") ask(); else window.addEventListener("load", ask, { once: true });
}

// HARDEN-2 item 1 · THE GIVING PAGE'S OWN ENTRY. A donor on a phone opening
// /give/<org> used to download the whole CRM's entry first (the marketing
// site, Sentry, the app's router and shared code: about 290 KB compressed)
// before the page could even ask for its payload, and the page took 4.5 to 5
// seconds to draw on a slow phone. give.html loads only this file, which
// draws only the giving page (pages/Donate.jsx, unchanged, the same component
// the editor's preview draws), and give.html has already asked for the page's
// payload while this file downloads (window.__givePrefetch, read by Donate).
//
// What stays the same as main.jsx: the org binding and commit guard (installed
// first), the error fallback's words, the service worker, Vercel analytics.
// Sentry still reports, but loads after the page has drawn.
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { API } from "./api";
import { installOrgBinding } from "./lib/orgBinding";
import { installCommitGuard } from "./lib/commitGuard";
import Donate from "./pages/Donate";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

installOrgBinding(API);
installCommitGuard();

// main.jsx's words, so a donor sees the same thing whichever entry drew the page.
const PAL = { cream: "#f0ede6", white: "#ffffff", cardEdge: "#e0dccf", terracotta: "#b8593f", bodyMuted: "#5b6b60", emerald: "#0d5c3a" };
function ErrorFallback() {
  return (
    <div style={{ minHeight: "100vh", background: PAL.cream, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <div style={{ maxWidth: 420, textAlign: "center", background: PAL.white, border: "1px solid "+PAL.cardEdge, borderRadius: 16, padding: "30px 26px" }}>
        <div style={{ fontSize: 22, color: PAL.terracotta, fontFamily: "'DM Serif Display',Georgia,serif", marginBottom: 8 }}>Something went wrong</div>
        <div style={{ fontSize: 13.5, color: PAL.bodyMuted, lineHeight: 1.6, marginBottom: 18 }}>The app hit an unexpected error and it's been reported. Reloading usually clears it.</div>
        <button onClick={() => window.location.reload()} style={{ background: PAL.emerald, border: "none", borderRadius: 10, padding: "10px 20px", color: PAL.white, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Reload</button>
      </div>
    </div>
  );
}

// Sentry after the page has drawn: an error before then is caught by the
// boundary below and reported once Sentry is up.
let sentry = null;
const pending = [];
function report(error) { if (sentry) sentry.captureException(error); else pending.push(error); }
if (import.meta.env.VITE_SENTRY_DSN) {
  const start = () => import("@sentry/react").then(S => {
    S.init({ dsn: import.meta.env.VITE_SENTRY_DSN, environment: import.meta.env.MODE, tracesSampleRate: 0.1, integrations: [S.browserTracingIntegration()] });
    sentry = S;
    pending.splice(0).forEach(e => S.captureException(e));
  }).catch(() => {});
  if (document.readyState === "complete") setTimeout(start, 0);
  else window.addEventListener("load", () => setTimeout(start, 0), { once: true });
}

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { report(error); }
  render() { return this.state.failed ? <ErrorFallback /> : this.props.children; }
}

// Anything that is not a giving page belongs to the main app.
function Elsewhere() { window.location.replace("/"); return null; }

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Boundary>
        <Routes>
          <Route path="/give/:orgSlug" element={<Donate />} />
          <Route path="/give/:orgSlug/:pageSlug" element={<Donate />} />
          <Route path="/give/:orgSlug/:pageSlug/:fundraiserSlug" element={<Donate />} />
          <Route path="*" element={<Elsewhere />} />
        </Routes>
      </Boundary>
      <Analytics />
      <SpeedInsights />
    </BrowserRouter>
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(err => console.error("[SW] registration failed", err));
  });
}

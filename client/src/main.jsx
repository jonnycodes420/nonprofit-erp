import React, { useState, createContext, useContext } from "react";
import * as Sentry from "@sentry/react";
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    integrations: [Sentry.browserTracingIntegration()],
  });
}
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { apiFetch } from "./api";
import { safeNext } from "./lib/appUrls";
// The marketing site (LANDING-2) stays an eager import: "/" is the public
// entry page and must not wait on a second network hop. Everything else is
// route-split (React.lazy) so visiting "/" does not download the
// authenticated app bundle (the shell + Donors/Grants/Comms/etc.).
import MarketingPage from "./marketing/Site";
import { ROUTES as MARKETING_ROUTES } from "./marketing/routes";
const LoginPage          = React.lazy(() => import("./pages/LoginPage"));
const WelcomePage        = React.lazy(() => import("./pages/WelcomePage"));
const InvitePage         = React.lazy(() => import("./pages/InvitePage"));
const App                = React.lazy(() => import("./App"));
const Donate             = React.lazy(() => import("./pages/Donate"));
// BUILD-102 Part 4 — the form inside an org's own website, addressed by form ID.
const EmbeddedForm       = React.lazy(() => import("./pages/EmbeddedForm"));
const ManageFundraiser   = React.lazy(() => import("./pages/ManageFundraiser"));
const Portal             = React.lazy(() => import("./pages/Portal")); // BUILD-45 donor portal (public, white-label)
const PortalEditor       = React.lazy(() => import("./pages/PortalEditor")); // BUILD-54 §4 — staff-session edit mode, sample data only
// BUILD-46 — the cross-org donor dashboard (Steward's consumer surface) + the
// gated nonprofit network signup. Both flag-gated server-side; the pages
// render a quiet unavailable state when the flags are off.
const GivingDashboard    = React.lazy(() => import("./pages/GivingDashboard"));
const JoinNetwork        = React.lazy(() => import("./pages/JoinNetwork"));
const GivingOrgShell     = React.lazy(() => import("./pages/GivingDashboard").then(m => ({ default: m.GivingOrgShell })));
function GivingOrgWrap() { return <GivingOrgShell><Portal /></GivingOrgShell>; }
// LOST & FOUND — the free donor audit, and Steward's best salesperson. Its
// own route because it is a page an org reaches from anywhere, including
// from somebody else's newsletter with a ?ref= on the end.
const LostAndFound       = React.lazy(() => import("./pages/LostAndFound"));
const SignupPage         = React.lazy(() => import("./pages/SignupPage"));
// NB: Invitation.jsx is also imported eagerly by Landing (the on-page form
// section), so this lazy route resolves from the already-loaded entry chunk.
const InvitationPage     = React.lazy(() => import("./pages/Invitation"));
const AdminDashboard     = React.lazy(() => import("./pages/AdminDashboard"));
// INT-OAUTH — where a provider puts the person down after consent. It is the
// app, not the API, because a redirect carries no session and a GET may not
// write; this page finishes the connection with an authenticated POST.
const OAuthCallback      = React.lazy(() => import("./pages/OAuthCallback"));
const ForgotPasswordPage = React.lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage  = React.lazy(() => import("./pages/ResetPasswordPage"));
const TermsPage          = React.lazy(() => import("./pages/TermsPage"));
const PrivacyPage        = React.lazy(() => import("./pages/PrivacyPage"));
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'

// FIX-2 C — this surface's colours, named once (it keeps its own palette;
// see tests/fix2-c-hex.test.js for why a public surface does).
const PAL = {
  cream: "#f0ede6",
  cream3: "#d4cfc6",
  emerald: "#0d5c3a",
  white: "#ffffff",
  cardEdge: "#e0dccf",
  terracotta: "#b8593f",
  bodyMuted: "#5b6b60",
};


// Matches the app shell's own loading state (cream ground, small spinner)
// so a chunk load doesn't flash a bare white page.
function RouteFallback() {
  return <div style={{ minHeight: "100vh", background: PAL.cream, display: "flex", alignItems: "center", justifyContent: "center" }}>
    <span style={{ display: "inline-block", width: 16, height: 16, border: "2px solid "+PAL.cream3, borderTopColor: PAL.emerald, borderRadius: "50%", animation: "lpsp 0.7s linear infinite" }} />
    <style>{`@keyframes lpsp{to{transform:rotate(360deg)}}`}</style>
  </div>;
}

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => {
    const token = localStorage.getItem("npe_token");
    const raw   = localStorage.getItem("npe_user");
    const org   = localStorage.getItem("npe_org");
    if (!token) return null;
    try { return { token, user: JSON.parse(raw), org: JSON.parse(org) }; }
    catch { return null; }
  });
  const login = (data) => {
    localStorage.setItem("npe_token", data.token);
    localStorage.setItem("npe_user", JSON.stringify(data.user));
    localStorage.setItem("npe_org",  JSON.stringify(data.org));
    setAuth(data);
  };
  const logout = () => {
    // SEC-1 — end this session on the server too, so the token is dead and the
    // session leaves the list. Best effort: signing out never waits on it.
    if (localStorage.getItem("npe_token")) apiFetch("/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
    localStorage.removeItem("npe_token");
    localStorage.removeItem("npe_user");
    localStorage.removeItem("npe_org");
    setAuth(null);
  };
  const refreshOrg = async () => {
    try {
      const { org } = await apiFetch("/me");
      const next = { ...auth, org };
      localStorage.setItem("npe_org", JSON.stringify(org));
      setAuth(next);
      return org;
    } catch { return null; }
  };
  return <AuthCtx.Provider value={{ auth, login, logout, refreshOrg }}>{children}</AuthCtx.Provider>;
}

// FIX-13 Part 6 — a signed-out visit to a deep link goes to sign-in and
// carries the page with it, so it lands back there afterwards.
function loginWithNext() {
  const here = window.location.pathname + window.location.search;
  return here && here !== "/" && here !== "/dashboard" ? "/login?next=" + encodeURIComponent(here) : "/login";
}

function RequireAuth({ children }) {
  const { auth } = useAuth();
  if (!auth) return <Navigate to={loginWithNext()} replace />;
  return children;
}

function RequireOnboarded({ children }) {
  const { auth } = useAuth();
  if (!auth) return <Navigate to={loginWithNext()} replace />;
  if (!auth.org?.onboarding_complete) return <Navigate to="/welcome" replace />;
  return children;
}

function PublicOnly({ children }) {
  const { auth } = useAuth();
  if (auth) {
    if (auth.user?.isSuperAdmin) return <Navigate to="/admin" replace />;
    if (!auth.org?.onboarding_complete) return <Navigate to="/welcome" replace />;
    // FIX-13 Part 6 — already signed in (another tab did it): go straight to
    // the page the sign-in was for.
    let next = null;
    try { next = safeNext(new URLSearchParams(window.location.search).get("next")); } catch { /* no query */ }
    return <Navigate to={next || "/dashboard"} replace />;
  }
  return children;
}

function RequireSuperAdmin({ children }) {
  const raw = localStorage.getItem("npe_user");
  try {
    const user = JSON.parse(raw);
    if (!user?.isSuperAdmin) return <Navigate to="/dashboard" replace />;
  } catch {
    return <Navigate to="/login" replace />;
  }
  return children;
}

// Root-level crash insurance (BUILD-21 Part 2): the last line of defense for a
// render throw the App/per-tab boundaries don't cover (a public page, a lazy
// route). Uses Sentry.ErrorBoundary (already imported) so this stays in the lean
// eager entry chunk — importing components/shared here would pull that whole
// module out of route-split. Inline fallback, no external deps.
function RootErrorFallback() {
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

function Root() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Sentry.ErrorBoundary fallback={<RootErrorFallback />}>
        <React.Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* LANDING-2 — the marketing site, one route per row of
              marketing/routes.js. "/" keeps PublicOnly (a signed-in person
              lands in the app); the rest are public to everyone. Existing app
              routes are not in that table and are untouched below. */}
          {MARKETING_ROUTES.map(r => (
            <Route key={r.path} path={r.path}
              element={r.path === "/" ? <PublicOnly><MarketingPage route={r} /></PublicOnly> : <MarketingPage route={r} />} />
          ))}
          <Route path="/login"     element={<PublicOnly><LoginPage /></PublicOnly>} />
          {/* GTM-1a 2 — SIGNUP REOPENS, AS THE PATH IT ALWAYS SHOULD HAVE BEEN.
              BUILD-87 F.2 made this a redirect and deleted the page, because
              the form sold a price that had not existed since August and a
              self-serve door BUILD-39 had shut: a signup form contradicting
              the product it signs you up for is worse than no form.
              Every one of those reasons is now answered rather than avoided.
              The page quotes shared/pricing.js, which is the same list the
              route prices against and the same list Stripe is checked
              against; and it is not a second door — it mints a BUILD-90 close
              link for the visitor and hands them the same Checkout, the same
              thirty days from signing, the same seven-day reminder and the
              same two-click cancel. Nothing exists until the card goes in.
              /invitation is still a real page for someone who wants to talk
              first, and /invite/:token is still the token-gated half. */}
          <Route path="/signup"    element={<PublicOnly><SignupPage /></PublicOnly>} />
          <Route path="/welcome"   element={<RequireAuth><WelcomePage /></RequireAuth>} />
          <Route path="/today"     element={<Navigate to="/dashboard" replace />} />
          {/* NAV-1 §2 — the dashboards folded into Reports, so an old
              /dashboards bookmark lands on the board dashboard inside it.
              `?report=` is the one mechanism App.jsx already uses for a link
              into Reports (the weekly email's link), so this is a redirect and
              not a second way in. */}
          <Route path="/dashboards" element={<Navigate to="/dashboard?report=dash:board" replace />} />
          <Route path="/dashboard" element={<RequireOnboarded><App /></RequireOnboarded>} />
          {/* D-1 (BUILD-45): a real, linkable donor URL so the Home "Needs your
              attention" rows can be genuine <a href="/donors/:id"> anchors that
              survive cmd/middle-click + open-in-new-tab. Renders the same shell;
              App reads the :donorId on mount and opens that profile. */}
          <Route path="/donors/:donorId" element={<RequireOnboarded><App /></RequireOnboarded>} />
          {/* FIX-13 Part 6 — every tab has a URL now: /donors is the list (its
              filters in the query), /app/:tab every other tab. Same shell; App
              reads the URL (lib/appUrls.js) on load and on back/forward. */}
          <Route path="/donors" element={<RequireOnboarded><App /></RequireOnboarded>} />
          <Route path="/app/:tab" element={<RequireOnboarded><App /></RequireOnboarded>} />
          <Route path="/invite/:token" element={<InvitePage />} />
          {/* LANDING-3 part 1 — /pricing is a marketing route now and lives in
              MARKETING_ROUTES above, in the marketing shell with the prices on
              the first screen. The page keeps the signed-in checkout the app's
              own Pricing.jsx had, because UpgradeModal, goToPricing() and
              Settings still send paying organisations here to change plan. */}
          <Route path="/lost-and-found" element={<LostAndFound />} />
          <Route path="/invitation" element={<InvitationPage />} />
          {/* BUILD-45 — donor portal (magic-link auth; org-themed; /verify
              consumes the fragment token). */}
          {/* BUILD-54 §4 — edit mode rides the EXISTING staff session (the
              RequireOnboarded guard + npe_token); every editor endpoint is
              requireAdmin + org-scoped server-side. */}
          <Route path="/portal-editor" element={<RequireOnboarded><PortalEditor /></RequireOnboarded>} />
          <Route path="/portal/:orgSlug" element={<Portal />} />
          <Route path="/portal/:orgSlug/verify" element={<Portal />} />
          {/* BUILD-46 — donor dashboard: home + emailed-token landings + the
              org drill-down (the UNFORKED BUILD-45 Portal under a consumer
              back bar — same :orgSlug param, same component). */}
          <Route path="/giving" element={<GivingDashboard />} />
          <Route path="/giving/verify" element={<GivingDashboard landing="verify" />} />
          <Route path="/giving/reset" element={<GivingDashboard landing="reset" />} />
          {/* BUILD-49 — the emailed one-time sign-in link (password-free alternate). */}
          <Route path="/giving/signin" element={<GivingDashboard landing="signin" />} />
          <Route path="/giving/confirm-email" element={<GivingDashboard landing="confirm-email" />} />
          <Route path="/giving/confirm-alias" element={<GivingDashboard landing="confirm-alias" />} />
          <Route path="/giving/orgs/:orgSlug" element={<GivingOrgWrap />} />
          <Route path="/join" element={<JoinNetwork />} />
          {/* BUILD-102 Part 4 — what embed.js points its iframe at. Public, and
              deliberately NOT under /give: an embed is addressed by form ID, so
              the org pastes one line and never has to know its own slugs. */}
          <Route path="/embed/:formId" element={<EmbeddedForm />} />
          <Route path="/give/:orgSlug" element={<Donate />} />
          <Route path="/give/:orgSlug/:pageSlug" element={<Donate />} />
          <Route path="/give/:orgSlug/:pageSlug/:fundraiserSlug" element={<Donate />} />
          <Route path="/fundraiser/manage/:token" element={<ManageFundraiser />} />
          <Route path="/admin"             element={<RequireSuperAdmin><AdminDashboard /></RequireSuperAdmin>} />
          <Route path="/oauth/:provider/callback" element={<OAuthCallback />} />
          <Route path="/forgot-password"  element={<ForgotPasswordPage />} />
          <Route path="/reset-password"   element={<ResetPasswordPage />} />
          <Route path="/terms"            element={<TermsPage />} />
          <Route path="/privacy"          element={<PrivacyPage />} />
          <Route path="*"                 element={<Navigate to="/" replace />} />
        </Routes>
        </React.Suspense>
        </Sentry.ErrorBoundary>
        <Analytics />
        <SpeedInsights />
      </BrowserRouter>
    </AuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><Root /></React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[SW] registered', reg.scope))
      .catch(err => console.error('[SW] registration failed', err));
  });
}
 

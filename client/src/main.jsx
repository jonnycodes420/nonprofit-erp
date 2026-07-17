import React, { useState, useEffect, createContext, useContext } from "react";
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
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { apiFetch } from "./api";
// Landing stays an eager import — it's the public entry page and must not
// wait on a second network hop. Everything else is route-split (React.lazy)
// so visiting "/" no longer downloads the entire authenticated app bundle
// (the shell + Donors/Grants/Comms/etc. was ~1.5MB minified before this).
import Landing from "./pages/Landing";
const LoginPage          = React.lazy(() => import("./pages/LoginPage"));
const SignupPage         = React.lazy(() => import("./pages/SignupPage"));
const WelcomePage        = React.lazy(() => import("./pages/WelcomePage"));
const InvitePage         = React.lazy(() => import("./pages/InvitePage"));
const App                = React.lazy(() => import("./App"));
const Donate             = React.lazy(() => import("./pages/Donate"));
const ManageFundraiser   = React.lazy(() => import("./pages/ManageFundraiser"));
const Pricing            = React.lazy(() => import("./pages/Pricing"));
const AdminDashboard     = React.lazy(() => import("./pages/AdminDashboard"));
const ForgotPasswordPage = React.lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage  = React.lazy(() => import("./pages/ResetPasswordPage"));
const TermsPage          = React.lazy(() => import("./pages/TermsPage"));
const PrivacyPage        = React.lazy(() => import("./pages/PrivacyPage"));
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'

// Matches the app shell's own loading state (cream ground, small spinner)
// so a chunk load doesn't flash a bare white page.
function RouteFallback() {
  return <div style={{ minHeight: "100vh", background: "#f0ede6", display: "flex", alignItems: "center", justifyContent: "center" }}>
    <span style={{ display: "inline-block", width: 16, height: 16, border: "2px solid #d4cfc6", borderTopColor: "#0d5c3a", borderRadius: "50%", animation: "lpsp 0.7s linear infinite" }} />
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

function RequireAuth({ children }) {
  const { auth } = useAuth();
  if (!auth) return <Navigate to="/login" replace />;
  return children;
}

function RequireOnboarded({ children }) {
  const { auth } = useAuth();
  if (!auth) return <Navigate to="/login" replace />;
  if (!auth.org?.onboarding_complete) return <Navigate to="/welcome" replace />;
  return children;
}

function PublicOnly({ children }) {
  const { auth } = useAuth();
  if (auth) {
    if (auth.user?.isSuperAdmin) return <Navigate to="/admin" replace />;
    if (!auth.org?.onboarding_complete) return <Navigate to="/welcome" replace />;
    return <Navigate to="/dashboard" replace />;
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

function Root() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <React.Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/"          element={<PublicOnly><Landing /></PublicOnly>} />
          <Route path="/login"     element={<PublicOnly><LoginPage /></PublicOnly>} />
          <Route path="/signup"    element={<PublicOnly><SignupPage /></PublicOnly>} />
          <Route path="/welcome"   element={<RequireAuth><WelcomePage /></RequireAuth>} />
          <Route path="/today"     element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<RequireOnboarded><App /></RequireOnboarded>} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/pricing"   element={<Pricing />} />
          <Route path="/give/:orgSlug" element={<Donate />} />
          <Route path="/give/:orgSlug/:pageSlug" element={<Donate />} />
          <Route path="/give/:orgSlug/:pageSlug/:fundraiserSlug" element={<Donate />} />
          <Route path="/fundraiser/manage/:token" element={<ManageFundraiser />} />
          <Route path="/admin"             element={<RequireSuperAdmin><AdminDashboard /></RequireSuperAdmin>} />
          <Route path="/forgot-password"  element={<ForgotPasswordPage />} />
          <Route path="/reset-password"   element={<ResetPasswordPage />} />
          <Route path="/terms"            element={<TermsPage />} />
          <Route path="/privacy"          element={<PrivacyPage />} />
          <Route path="*"                 element={<Navigate to="/" replace />} />
        </Routes>
        </React.Suspense>
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
 

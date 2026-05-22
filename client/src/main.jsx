import React, { useState, useEffect, createContext, useContext } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { apiFetch } from "./api";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import WelcomePage from "./pages/WelcomePage";
import App from "./App";

// ── Auth context ───────────────────────────────────────────────────────────
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

// ── Route guards ───────────────────────────────────────────────────────────
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
  if (!auth) return children;
  return <Navigate to={auth.org?.onboarding_complete ? "/" : "/welcome"} replace />;
}

// ── Root ───────────────────────────────────────────────────────────────────
function Root() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login"   element={<PublicOnly><LoginPage /></PublicOnly>} />
          <Route path="/signup"  element={<PublicOnly><SignupPage /></PublicOnly>} />
          <Route path="/welcome" element={<RequireAuth><WelcomePage /></RequireAuth>} />
          <Route path="/"        element={<RequireOnboarded><App /></RequireOnboarded>} />
          <Route path="*"        element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><Root /></React.StrictMode>
);

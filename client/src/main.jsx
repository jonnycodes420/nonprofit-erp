import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Login from "./Login";

function Root() {
  const [auth, setAuth] = useState(() => {
    const token = localStorage.getItem("npe_token");
    return token ? { token } : null;
  });

  const handleLogin = (data) => {
    localStorage.setItem("npe_token", data.token);
    setAuth(data);
  };

  const handleLogout = () => {
    localStorage.removeItem("npe_token");
    setAuth(null);
  };

  if (!auth) return <Login onLogin={handleLogin} />;
  return <App onLogout={handleLogout} />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);

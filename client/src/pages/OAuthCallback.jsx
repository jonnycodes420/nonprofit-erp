// client/src/pages/OAuthCallback.jsx — INT-OAUTH.
//
// WHERE THE PROVIDER PUTS THE PERSON DOWN.
//
// A provider's redirect is a plain browser navigation. It carries no session
// header, and it is a GET, which by the standing rule may not write. So it
// lands HERE, on the app, where there is a signed-in admin, and this page
// finishes the job with one authenticated POST.
//
// That is not a workaround: it is what makes the server's wall mean something.
// The state names the org and the admin who started the flow, and the server
// checks it against whoever is standing here. A callback URL forwarded to a
// colleague, pasted into another organisation's browser, or replayed tomorrow
// arrives with no matching admin and connects nothing.
//
// The person sees three states and no spinner without words: working, done, or
// the one sentence saying what went wrong and what is still true (nothing was
// connected). If they are not signed in, they sign in and come straight back,
// because the code is still in this URL.

import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "../api";

// This page renders OUTSIDE the app shell (a provider drops the browser here
// before any tab is mounted), so it takes the public pages' tokens rather than
// hand-copying a palette — which is the exact drift publicTheme.js exists to
// stop, and which the brand guard catches within a minute of trying.
import { T } from "./publicTheme";
const PAL = { cream: T.bg, white: T.pureWhite, ink: T.ink, ink3: T.ink3,
              emerald: T.greenDk, edge: T.bg2 };

export default function OAuthCallback() {
  const { provider } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [state, setState] = useState({ phase: "working", sentence: "Finishing the connection." });
  const [tenants, setTenants] = useState(null);

  useEffect(() => {
    const code = params.get("code"), st = params.get("state");
    // The provider refused before we ever got a code. Say what it said.
    const denied = params.get("error");
    if (denied) {
      setState({ phase: "failed",
        sentence: `The connection was not approved (${denied}). Nothing was connected, and nothing already in Steward changed.` });
      return;
    }
    if (!code || !st) {
      setState({ phase: "failed",
        sentence: "That link is missing what the provider was meant to send back, so Steward did not connect anything." });
      return;
    }
    // Signed out is the rare case: the person clicked Connect in this same
    // browser a moment ago. It is not pretended away, and it is not given a
    // resume that would have to hold a provider's code across a sign-in.
    if (!localStorage.getItem("npe_token")) {
      setState({ phase: "signin",
        sentence: "Sign in first, then open Connections and press Connect again. Nothing was connected, and this link cannot be used twice." });
      return;
    }
    apiFetch(`/oauth/${encodeURIComponent(provider)}/complete`, {
      method: "POST",
      body: JSON.stringify({ code, state: st, realmId: params.get("realmId") || undefined }),
    })
      .then(r => {
        if (r.needsTenantChoice && Array.isArray(r.tenants) && r.tenants.length > 1) {
          setTenants(r.tenants);
          setState({ phase: "choose", sentence: r.sentence });
        } else {
          setState({ phase: "done", sentence: r.sentence });
        }
      })
      .catch(e => setState({ phase: "failed",
        sentence: e?.body?.sentence || e?.message || "Steward could not finish the connection. Nothing was connected." }));
  }, [provider]);

  const chooseTenant = async id => {
    setState(s => ({ ...s, phase: "working", sentence: "Saving that choice." }));
    try {
      const r = await apiFetch("/oauth/xero/tenant", { method: "POST", body: JSON.stringify({ tenantId: id }) });
      setState({ phase: "done", sentence: r.sentence }); setTenants(null);
    } catch (e) {
      setState({ phase: "failed", sentence: e?.body?.sentence || "That organisation was not saved." });
    }
  };

  const back = () => nav("/dashboard?tab=settings&sub=integrations", { replace: true });
  useEffect(() => {
    if (state.phase !== "done") return;
    const t = setTimeout(back, 2200);
    return () => clearTimeout(t);
  }, [state.phase]);

  return (
    <div style={{ minHeight: "100vh", background: PAL.cream, display: "flex",
                  alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div data-testid="oauth-callback" data-phase={state.phase}
           style={{ background: PAL.white, border: `1px solid ${PAL.edge}`, borderRadius: 14,
                    padding: "28px 30px", maxWidth: 520, width: "100%" }}>
        <div style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase",
                      color: PAL.ink3, marginBottom: 10 }}>
          {state.phase === "done" ? "Connecting" : state.phase === "choose" ? "One more thing" : state.phase === "working" ? "Connecting" : "Not connected"}
        </div>
        <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 24, color: PAL.ink, marginBottom: 10 }}>
          {state.phase === "done" ? "Connected."
            : state.phase === "choose" ? "Which organisation?"
            : state.phase === "working" ? "One moment." : "Nothing was connected."}
        </div>
        <div style={{ fontSize: 14.5, lineHeight: 1.6, color: PAL.ink }}>{state.sentence}</div>

        {tenants && (
          <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
            {tenants.map(t => (
              <button key={t.id} data-testid="oauth-tenant" onClick={() => chooseTenant(t.id)}
                style={{ textAlign: "left", padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                         border: `1px solid ${PAL.edge}`, background: PAL.cream, color: PAL.ink, fontSize: 14 }}>
                {t.name}
              </button>
            ))}
          </div>
        )}

        {state.phase === "signin" && (
          <button onClick={() => nav("/login")} data-testid="oauth-signin"
            style={{ marginTop: 18, padding: "9px 16px", borderRadius: 999, border: "none", cursor: "pointer",
                     background: PAL.emerald, color: PAL.white, fontSize: 14, fontWeight: 600 }}>
            Sign in
          </button>)}

        {state.phase !== "working" && state.phase !== "signin" && !tenants && (
          <button onClick={back} data-testid="oauth-back"
            style={{ marginTop: 18, padding: "9px 16px", borderRadius: 999, border: "none", cursor: "pointer",
                     background: PAL.emerald, color: PAL.white, fontSize: 14, fontWeight: 600 }}>
            Back to Connections
          </button>
        )}
      </div>
    </div>
  );
}

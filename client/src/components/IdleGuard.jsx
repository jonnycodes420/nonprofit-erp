// IdleGuard.jsx — SECURE-2 item 7. SIGNED OUT AFTER THE ORG'S IDLE MINUTES.
//
// Activity is her typing, clicking, scrolling or touching, in any Steward tab
// of this browser (shared through localStorage, so a second tab does not sign
// out the one she is using). A minute before the org's limit a quiet card asks
// "Still there?" with Stay signed in; at the limit Steward keeps whatever she
// was typing (lib/idleDraft.js), signs this session out on the server and goes
// to the sign-in page, which brings her back here with the typing restored.
// The server enforces the same limit on its own (twoFactor.js sessionState),
// for a tab left closed or a token copied elsewhere.
import { useEffect, useRef, useState } from "react";
import { apiFetch, API, getToken, handleAuthFailure } from "../api";
import { T } from "./shared";
import { saveDrafts, restoreDrafts } from "../lib/idleDraft";

const SEEN = "steward_last_activity";
const WARN_MS = 60 * 1000;
const now = () => Date.now();
const readSeen = () => { try { return Number(localStorage.getItem(SEEN)) || 0; } catch { return 0; } };
const writeSeen = t => { try { localStorage.setItem(SEEN, String(t)); } catch { /* storage off: this tab alone */ } };

export default function IdleGuard() {
  const [minutes, setMinutes] = useState(null);
  const [warn, setWarn] = useState(false);
  const last = useRef(now());

  // The org's limit, and the typing kept from an idle sign-out, once.
  useEffect(() => {
    restoreDrafts();
    apiFetch("/me/mfa").then(r => setMinutes(Number(r && r.idleMinutes) || 60)).catch(() => setMinutes(60));
  }, []);

  useEffect(() => {
    if (!minutes) return undefined;
    last.current = Math.max(now(), readSeen());
    writeSeen(last.current);
    let lastWrite = 0;
    const mark = () => {
      const t = now();
      last.current = t;
      if (t - lastWrite > 5000) { lastWrite = t; writeSeen(t); }
      setWarn(false);
    };
    const evs = ["keydown", "mousedown", "pointermove", "wheel", "touchstart", "scroll"];
    for (const e of evs) window.addEventListener(e, mark, { passive: true, capture: true });
    const limit = minutes * 60 * 1000;
    const tick = setInterval(() => {
      const seen = Math.max(last.current, readSeen());
      const idle = now() - seen;
      if (idle >= limit) {
        clearInterval(tick);
        saveDrafts();
        const token = getToken();
        // Sign this session out on the server, then go to sign-in.
        fetch(`${API}/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: "{}" })
          .catch(() => {}).finally(() => handleAuthFailure("session_idle"));
      } else setWarn(idle >= limit - WARN_MS);
    }, 5000);
    return () => { clearInterval(tick); for (const e of evs) window.removeEventListener(e, mark, { capture: true }); };
  }, [minutes]);

  if (!warn) return null;
  const stay = () => {
    const t = now(); last.current = t; writeSeen(t); setWarn(false);
    apiFetch("/me/mfa").catch(() => {});   // one cheap signed-in read, so the server sees her too
  };
  return (
    <div role="alertdialog" aria-live="polite" aria-label="Still there?" data-testid="idle-warning"
      style={{ position: "fixed", right: 16, bottom: 16, left: "auto", zIndex: 1000, maxWidth: "calc(100vw - 32px)", width: 340,
               background: T.white, color: T.ink, border: "1px solid " + T.gold500, borderRadius: 14, padding: "16px 18px",
               boxShadow: "0 18px 40px -20px rgba(15,26,18,.45)", fontSize: 14, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Still there?</div>
      <div style={{ color: T.ink3, marginBottom: 12 }}>You'll be signed out in a minute to keep your donors' details safe. Anything you're typing is kept.</div>
      <button type="button" data-testid="idle-stay" onClick={stay}
        style={{ background: T.greenDk, color: T.white, border: "none", borderRadius: 999, padding: "8px 16px", fontWeight: 700, fontFamily: "inherit", fontSize: 14, cursor: "pointer" }}>
        Stay signed in
      </button>
    </div>
  );
}

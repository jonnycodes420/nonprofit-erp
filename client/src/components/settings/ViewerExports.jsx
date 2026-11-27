// settings/ViewerExports.jsx · ACCESS-1. Settings → Team, for admins: whether
// people with view-only access can download lists and reports. POLISH-14: off
// for a new org; the Role table below reads the same switch.
import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { errorMessage } from "../../lib/domainError";

export function ViewerExports() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { apiFetch("/org/viewer-exports").then(setS).catch(() => setS(null)); }, []);
  if (!s) return null;
  const flip = async () => {
    setErr("");
    try {
      const next = await apiFetch("/org/viewer-exports", { method: "PUT", body: JSON.stringify({ on: !s.on }) });
      setS(next);
      window.dispatchEvent(new CustomEvent("steward:viewer-exports", { detail: { on: !!next.on } }));
    }
    catch (e) { setErr(errorMessage(e, "That setting did not change.")); }
  };
  return <label data-testid="viewer-exports" title={s.description}
    style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: T.ink3, cursor: "pointer", marginRight: 12 }}>
    <input type="checkbox" checked={s.on} onChange={flip} style={{ accentColor: T.greenDk }} />
    {s.label}{err ? ` · ${err}` : ""}
  </label>;
}

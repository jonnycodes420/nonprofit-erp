// FLOWS-8 (W-1112-Volunteers-34X) · A GROUP FROZEN FROM A REPORT SAYS HOW FAR IT HAS DRIFTED.
// The group page's line, from GET /groups/:id's `drift` (server/groups/reportSource.js):
// "Saved from LYBUNT on Nov 12 · 23 people have changed since", and a refresh
// (POST /groups/:id/refresh-from-report) that makes the group the report's list today.
import { useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";

const quiet = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 9, padding: "5px 10px", fontSize: 12.5, color: T.ink2, cursor: "pointer" };

export function GroupReportDrift({ groupId, drift, isReadOnly, onRefreshed }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  if (!drift) return null;
  const refresh = async () => {
    setBusy(true); setMsg("");
    try { const r = await apiFetch(`/groups/${encodeURIComponent(groupId)}/refresh-from-report`, { method: "POST", body: "{}" }); setMsg(r.sentence); onRefreshed && onRefreshed(); }
    catch (e) { setMsg((e && e.sentence) || errorMessage(e, "The group was not refreshed.")); }
    setBusy(false);
  };
  return (
    <div data-testid="group-report-drift" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: T.bg, borderRadius: 10, padding: "8px 12px", margin: "0 0 12px", fontSize: 13, color: T.ink }}>
      <span title={drift.detail || undefined}>{drift.sentence}</span>
      {drift.changed > 0 && !isReadOnly && (
        <button type="button" data-testid="group-report-refresh" disabled={busy} onClick={refresh} style={quiet}>
          {busy ? "Refreshing…" : `Make it ${drift.label} as it reads today`}
        </button>
      )}
      {msg && <span role="status" style={{ fontSize: 12.5, color: T.ink2 }}>{msg}</span>}
    </div>
  );
}

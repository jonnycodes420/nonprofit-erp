// OrgSwitcher.jsx · ACCESS-1 item 2. "Switch organization", from the account menu.
//
// Shown only to someone in more than one org. Choosing one asks the server for
// a new session in that org (POST /auth/switch-org) and reloads into it, so no
// screen keeps a list from the org she left. A Steward super-admin opening a
// customer's org writes why; the customer sees the reason in their Activity.
import { useState } from "react";
import { apiFetch } from "../api";
import { T, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";
import { enterSupport } from "../lib/supportSession";
import { roleWord } from "../../../shared/viewOnly.js";

function takeSession(answer) {
  if (answer.user && answer.user.support) { enterSupport(answer); return; }
  localStorage.setItem("npe_token", answer.token);
  localStorage.setItem("npe_user", JSON.stringify(answer.user));
  localStorage.setItem("npe_org", JSON.stringify({ ...answer.org, onboarding_complete: answer.org.onboarding_complete ?? 1 }));
  window.location.href = "/dashboard";
}

export default function OrgSwitcher({ orgs, currentId, onClose }) {
  const [pick, setPick] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async (o, why) => {
    setBusy(true); setErr("");
    try {
      const r = await apiFetch("/auth/switch-org", { method: "POST", body: JSON.stringify({ orgId: o.id, ...(why ? { reason: why } : {}) }) });
      takeSession(r);
    } catch (e) { setErr(errorMessage(e, "That didn't switch. Try again.")); setBusy(false); }
  };
  const choose = o => { if (o.id === currentId) return; if (o.needsReason) { setPick(o); setReason(""); } else go(o); };
  return <Modal onClose={onClose} title="Switch organization" subtitle="You're signed in to one organization at a time." width={440} ariaLabel="Switch organization">
    <div data-viewer-ok="1" data-testid="org-switcher">
      {!pick && (orgs || []).map(o => <button key={o.id} onClick={() => choose(o)} disabled={busy} data-testid={"switch-org-" + o.id}
        style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 10, textAlign: "left", background: o.id === currentId ? T.bg2 : T.white,
          border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 14px", marginBottom: 8, cursor: o.id === currentId ? "default" : "pointer", fontFamily: "inherit" }}>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</span>
          <span style={{ display: "block", fontSize: 12, color: T.ink3 }}>{o.id === currentId ? "You're here" : "Your role: " + roleWord(o.role)}{o.needsReason ? " · a customer's organization" : ""}</span>
        </span>
        {o.id !== currentId && <span style={{ fontSize: 12.5, color: T.greenDk, fontWeight: 700, flexShrink: 0 }}>Switch</span>}
      </button>)}
      {pick && <div>
        <div style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.5, marginBottom: 10 }}>
          {pick.name} is a customer's organization. Say why you're opening it. They see this reason in their Activity.
        </div>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} autoFocus data-testid="switch-org-reason"
          placeholder="Ticket 4471: their deposit report total looks off"
          style={{ width: "100%", boxSizing: "border-box", border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px", fontSize: 14, color: T.ink, background: T.bg, fontFamily: "inherit" }} />
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button onClick={() => setPick(null)} disabled={busy} style={{ flex: 1, background: T.bg, border: "1px solid " + T.bg3, borderRadius: 10, padding: 10, color: T.ink2, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Back</button>
          <button onClick={() => go(pick, reason.trim())} disabled={busy || reason.trim().length < 8} data-testid="switch-org-go"
            style={{ flex: 2, background: T.green, border: "none", borderRadius: 10, padding: 10, color: T.white, fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: busy || reason.trim().length < 8 ? 0.6 : 1 }}>
            {busy ? "Opening…" : "Open " + pick.name}
          </button>
        </div>
      </div>}
      {err && <div role="alert" style={{ marginTop: 10, fontSize: 13, color: T.ink, background: T.cream || T.bg, border: "1px solid " + T.gold, borderRadius: 8, padding: "8px 12px" }}>{err}</div>}
    </div>
  </Modal>;
}

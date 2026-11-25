// components/admin/BackgroundWorkSwitch.jsx · BGWORK-1. "Run background work for this test org".
// SCALE-5 runs per-org sweeps (the mailbox read and its stale alarm among them) for live orgs
// only; a test org or fixture is skipped. This switch keeps one test org in that list
// (POST /admin/orgs/:id/background-work, server/admin/backgroundWork.js).
import { useState } from "react";
import { errorMessage } from "../../lib/domainError";

export default function BackgroundWorkSwitch({ org, adminFetch, A }) {
  const [on, setOn] = useState(org.run_background_work === true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const testKind = ["internal_test", "fixture"].includes(org.kind);
  if (!testKind && !on) return null;   // a live kind's work runs anyway
  const flip = async () => {
    setBusy(true); setNote("");
    try { const r = await adminFetch("/admin/orgs/" + org.id + "/background-work", { method: "POST", body: JSON.stringify({ on: !on }) }); setOn(r.on === true); setNote(r.sentence || ""); }
    catch (e) { setNote(errorMessage(e)); }
    setBusy(false);
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
      <label style={{ fontSize: 12, color: A.secondary, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
        <input type="checkbox" data-testid="admin-org-background-work" checked={on} disabled={busy} onChange={flip} />
        Run background work for this test org
      </label>
      <span style={{ fontSize: 11, color: A.muted }}>{note || (on ? "On: its mailbox is read and checked, like a customer's." : "Off: test orgs are skipped by the mail read and every sweep.")}</span>
    </div>
  );
}

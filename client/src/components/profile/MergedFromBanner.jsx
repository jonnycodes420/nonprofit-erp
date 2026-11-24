// components/profile/MergedFromBanner.jsx · HOUSEHOLD-1 item 5. A record merged
// from two people says so, on its profile. Within 30 days: "Split them back into
// a household?" runs Data health's merge Undo and makes the household in one
// step (POST /donors/:id/split-to-household). Older: it says it can't, and how.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { errorMessage } from "../../lib/domainError";

export function MergedFromBanner({ donor, isReadOnly, onDone }) {
  const [m, setM] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let live = true;
    setM(null); setMsg("");
    if (donor && donor.id) apiFetch(`/donors/${encodeURIComponent(donor.id)}/merged-from`).then(r => { if (live) setM(r && r.merge); }).catch(() => {});
    return () => { live = false; };
  }, [donor && donor.id]);
  if (!m && !msg) return null;
  const split = async () => {
    setBusy(true);
    try {
      const r = await apiFetch(`/donors/${encodeURIComponent(donor.id)}/split-to-household`, { method: "POST", body: JSON.stringify({ mergeId: m.id }) });
      setM(null); setMsg(r.sentence);
      onDone && onDone();
    } catch (e) { setMsg(errorMessage(e, "They could not be split. Nothing changed.")); }
    setBusy(false);
  };
  return (
    <div data-testid="dp-merged-from" role="status" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", background: T.white, border: "1px solid " + T.gold500, borderRadius: 10, padding: "10px 14px", margin: "12px 0 0", fontSize: 13, color: T.ink }}>
      <span style={{ flex: "1 1 320px" }}>{msg || m.sentence}</span>
      {m && m.canSplit && !isReadOnly && (
        <button type="button" data-testid="dp-split-household" onClick={split} disabled={busy}
          style={{ background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>
          {busy ? "Splitting…" : "Split them back into a household"}
        </button>
      )}
    </div>
  );
}

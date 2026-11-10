// components/majorGifts/AddToTop100.jsx · TOP100-1. The Donors list's bulk
// "Add to Top 100": the ticked people go on the list at the bottom, in the
// order they are ticked; anyone already on it keeps their rank. Drawn only for
// admins and staff with the major gifts permission (the server refuses others).
import { useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { errorMessage } from "../../lib/domainError";
import { useCanMajorGifts } from "../../lib/majorGifts";

export function AddToTop100({ ids, disabled, flash, onDone }) {
  const can = useCanMajorGifts();
  const [busy, setBusy] = useState(false);
  if (!can || !ids.length) return null;
  const go = async () => {
    setBusy(true);
    try {
      const r = await apiFetch("/top100/members", { method: "POST", body: JSON.stringify({ donorIds: ids.slice(0, 500) }) });
      flash(r.sentence + (ids.length > 500 ? " Steward adds 500 at a time; tick the rest and add again." : ""));
      if (onDone) onDone();
    } catch (e) { flash(errorMessage(e, "Nobody was added.")); }
    setBusy(false);
  };
  return (
    <button data-testid="bulk-add-top100" onClick={go} disabled={disabled || busy}
      style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 12px", color: T.ink, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", opacity: disabled || busy ? 0.6 : 1 }}>
      Add to Top 100
    </button>
  );
}

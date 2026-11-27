// components/profile/TagChip.jsx · SAFE-EDIT-1 item 5. A TAG ON A PROFILE CAN BE TAKEN OFF.
// The chip had no remove control, so the only way to drop a tag was the Edit form (which
// also rewrote the phone). The × takes this one tag off this one person through the same
// call as the Donors list's Remove tag (POST /donors/bulk-tag, remove: true), and the toast's
// Undo puts it back. Read-only users see the plain chip.
import { useState } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { told } from "../../lib/stewardTold";
import { offerUndo } from "../EditHistory";
import { Pill, T } from "../shared";

export function TagChip({ tag, donor, isReadOnly }) {
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (gone) return null;
  if (isReadOnly || !donor || !donor.id) return <Pill label={tag} />;
  const put = remove => apiFetch("/donors/bulk-tag", { method: "POST", body: JSON.stringify({ ids: [donor.id], tag, remove }) });
  const take = async e => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await put(true);
      setGone(true); told({ donors: true });
      offerUndo({ message: `Removed "${tag}" from ${donor.name || "them"}.`, undoSeconds: 30,
        undoAction: async () => { const u = await put(false); setGone(false); told({ donors: true }); return u; } }, "tag");
      return r;
    } catch (x) { setErr(errorMessage(x, `"${tag}" is still on them.`)); }
    finally { setBusy(false); }
  };
  return (
    <span data-testid="dp-tag-chip" style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      <Pill label={tag} />
      <button type="button" data-testid="dp-tag-remove" aria-label={`Remove the tag ${tag}`} title={`Remove "${tag}"`} onClick={take} disabled={busy}
        style={{ background: "none", border: "none", padding: "0 3px", color: T.ink3, fontSize: 13, lineHeight: 1, cursor: "pointer", fontFamily: "inherit" }}>×</button>
      {err && <span role="alert" style={{ fontSize: 11, color: T.ink }}>{err}</span>}
    </span>
  );
}

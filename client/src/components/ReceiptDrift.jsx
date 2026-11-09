// PLEDGES-3 (W-1108-Finance-09X) · A RECEIPT WHOSE GIFT CHANGED SAYS SO.
// An issued receipt is a snapshot and is never edited. When its gift changed
// after it was issued, the gift's receipt cell and the Issued receipts list
// both say the server's sentence (server/receipts/drift.js) with one click:
// Void and reissue (or Void it, for a $0 gift, which carries no receipt).
import { useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";
import { told } from "../lib/stewardTold";

export default function ReceiptDrift({ receipt, isReadOnly, onDone, testid = "receipt-drift" }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const d = receipt && receipt.drift;
  if (!d) return null;
  const go = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await apiFetch(`/receipts/${encodeURIComponent(receipt.id)}/reissue`, { method: "POST", body: "{}" });
      setMsg(r.sentence || "Done.");
      told({ gift: true });
      if (onDone) await onDone(r);
    } catch (e) { setMsg((e && e.sentence) || errorMessage(e, "The receipt was not reissued.")); }
    setBusy(false);
  };
  return (
    <span data-testid={testid} role="status" style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontSize: 11.5, color: T.ink,
      background: T.gold100, border: "1px solid " + T.gold300, borderRadius: 6, padding: "3px 8px", whiteSpace: "normal", maxWidth: 420 }}>
      <span>{d.sentence}</span>
      {!isReadOnly && <button type="button" data-testid={testid + "-go"} disabled={busy} onClick={go}
        style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, cursor: "pointer", fontSize: 11.5, fontFamily: "inherit", textDecoration: "underline" }}>
        {busy ? "Working…" : d.action}</button>}
      {msg && <span>{msg}</span>}
    </span>
  );
}

// SALES-6 item 1 · Send to sign: the deal's one way to a signature. It makes the order (ORDER-1: read,
// sign, card on file, book setup) from the deal's newest quote and shows its link once, to copy or open
// in Jonathan's own email. Steward sends nothing. Used by the deal header and the Quote panel.
import { useState } from "react";
import { apiFetch } from "../../../api";
import { says, btn, quiet, box, link, brassTag, failureWords } from "./salesBits";

export default function SendToSign({ dealId, label = "Send to sign", primary = true, onDone }) {
  const [made, setMade] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const go = async () => {
    setErr(null); setCopied(false); setBusy(true);
    try {
      const r = await apiFetch(`/ops/sales/deals/${encodeURIComponent(dealId)}/send-to-sign`, { method: "POST", body: "{}" });
      const url = `${window.location.origin}${r.path}`;
      setMade({ url, says: r.says, to: r.to });
      try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* the field below can be copied by hand */ }
      if (onDone) onDone();
    } catch (e) { setErr(failureWords(e, "No order made.")); }
    setBusy(false);
  };
  return <span data-send-to-sign={dealId}>
    <button type="button" style={primary ? btn : quiet} onClick={go} disabled={busy} data-send-to-sign-go="1">{busy ? "Making the order…" : label}</button>
    {made ? <div style={{ marginTop: 6 }}>
      <input readOnly value={made.url} onFocus={e => e.target.select()} style={{ ...box, width: "100%" }} aria-label="Order link" data-send-to-sign-url="1" />
      <p style={{ ...says, marginTop: 4 }} data-send-to-sign-says="1">{copied ? "Copied. " : ""}{made.says}</p>
      <a href={`mailto:${encodeURIComponent(made.to || "")}?subject=${encodeURIComponent("Your Steward order")}&body=${encodeURIComponent(`Here is the order we talked about. Read it, sign it, and add a card (nothing is charged before billing starts):\n\n${made.url}\n`)}`}
        style={{ ...link, fontSize: 12.5 }}>Open in my email</a></div> : null}
    {err ? <p style={{ ...says, opacity: 1, marginTop: 4 }} data-send-to-sign-error="1"><span style={brassTag}>Not done</span> {err}</p> : null}
  </span>;
}

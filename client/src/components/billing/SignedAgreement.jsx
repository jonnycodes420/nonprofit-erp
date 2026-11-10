// ONBOARD-1 · Settings → Billing: the order form she signed through a start
// link. Who signed, when, the first charge date, the text itself (view) and a
// PDF (download). The text shown is the stored text the SHA-256 was taken of.
import { useState, useEffect } from "react";
import { apiFetch, API } from "../../api";
import { T } from "../shared";

const link = { background: "none", border: 0, padding: 0, color: T.green600, fontWeight: 600, cursor: "pointer", fontSize: 13 };

export function SignedAgreement({ isAdmin }) {
  const [a, setA] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (isAdmin) apiFetch("/billing/agreement").then(r => setA(r.agreement)).catch(() => {}); }, [isAdmin]);
  if (!a) return null;
  async function pdf() {
    const r = await fetch(`${API}/billing/agreement/pdf`, { headers: { Authorization: "Bearer " + localStorage.getItem("npe_token") } });
    if (!r.ok) return;
    const url = URL.createObjectURL(await r.blob());
    const el = document.createElement("a");
    el.href = url; el.download = "steward-order-form.pdf"; el.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const signedOn = new Date(a.signedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return (
    <div data-testid="billing-agreement" style={{ fontSize: 13, color: T.ink, lineHeight: 1.55 }}>
      <div><strong>Signed agreement.</strong> {a.signerName}, {a.signerTitle}, signed on {signedOn}. First charge: {a.firstChargeDate}{a.priceUsd > 0 ? `, $${Number(a.priceUsd).toLocaleString("en-US")}` : ""}.</div>
      <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
        <button style={link} onClick={() => setOpen(v => !v)} data-testid="billing-agreement-view">{open ? "Hide" : "View"}</button>
        <button style={link} onClick={pdf} data-testid="billing-agreement-pdf">Download PDF</button>
      </div>
      {open ? <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", background: T.bg, border: `1px solid ${T.bg2}`, borderRadius: 10, padding: 14, marginTop: 8 }}>{a.text}</pre> : null}
    </div>
  );
}

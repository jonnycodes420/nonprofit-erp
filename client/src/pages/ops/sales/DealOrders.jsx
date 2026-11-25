// ORDER-1 item 4 · the deal's orders: the number, where it stands, who signed and when,
// and the signed order as a PDF (the same snapshot she signed, with its stamp).
import { useEffect, useState } from "react";
import { apiFetch, API, getToken } from "../../../api";
import { says, link } from "./salesBits";

async function pdf(id, number) {
  const t = getToken();
  const res = await fetch(`${API}/admin/start-links/${encodeURIComponent(id)}/pdf`, { credentials: "include", headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new Error("The PDF could not be made.");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a"); a.href = url; a.download = `steward-order-${number}.pdf`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const WORDS = { open: "open, not signed", signed: "signed, card not saved yet", completed: "signed, card on file", expired: "expired", revoked: "replaced by a newer order" };

export default function DealOrders({ dealId }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { apiFetch(`/ops/sales/deals/${encodeURIComponent(dealId)}/orders`).then(d => setRows(d.orders)).catch(() => setErr("The orders could not be read.")); }, [dealId]);
  if (err) return <p style={says}>{err}</p>;
  if (!rows) return null;
  if (!rows.length) return <p style={says}>No order yet. Make one from /ops → Organizations → Make order, on the org this deal is linked to.</p>;
  return <div data-deal-orders="1">{rows.map(o => (
    <div key={o.id} style={{ fontSize: 12.5, marginBottom: 10 }}>
      <b>{o.order_number}</b>{Number(o.order_version) > 1 ? ` v${o.order_version}` : ""}: {WORDS[o.state] || o.state}.
      {o.stamp ? <div>{o.stamp}{o.signer_title ? `, ${o.signer_title}` : ""}. {o.first_charge}: {o.first_amount}.</div> : null}
      {o.signed_at ? <button type="button" style={{ ...link, fontSize: 12.5 }} onClick={() => pdf(o.id, `${o.order_number}-signed`).catch(e => setErr(e.message))} data-order-pdf="1">Signed order (PDF)</button> : null}
    </div>))}</div>;
}

// ORDER-1 item 5 · organizations on a paid plan, or that came in through a close link,
// with no signed order. A dry run: the list reads and changes nothing. "Make order"
// opens the order panel; Jonathan presses Send there. Nothing is sent from here.
import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";

const cell = { padding: "7px 10px", borderTop: `1px solid ${T.bg3}`, fontSize: 12.5, verticalAlign: "top" };

export default function OrdersToSign({ orgs, onMake }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { apiFetch("/admin/orders/unsigned").then(setData).catch(e => setErr(e.message)); }, []);
  if (err) return <div role="alert" style={{ fontSize: 12.5 }}>The list of orders to sign could not be read: {err}</div>;
  if (!data) return null;
  const byId = new Map((orgs || []).map(o => [o.id, o]));
  return (
    <div style={{ background: T.white, border: `1px solid ${T.bg3}`, borderRadius: 10, padding: "12px 14px" }} data-testid="orders-to-sign">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <b style={{ fontSize: 13.5 }}>Orders to sign: {data.count.toLocaleString("en-US")}</b>
        <span style={{ fontSize: 12, color: T.ink3 }}>{data.sentence}</span>
        {data.count ? <button type="button" onClick={() => setOpen(x => !x)} style={{ marginLeft: "auto", background: "transparent", border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>{open ? "Hide" : "Show"}</button> : null}
      </div>
      {open ? <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}><tbody>
        {data.orgs.map(o => (
          <tr key={o.id} data-testid={`order-unsigned-${o.id}`}>
            <td style={cell}><b>{o.name}</b><div style={{ color: T.ink3, fontSize: 11 }}>{o.why}</div></td>
            <td style={cell}>{o.adminEmail || "No active admin"}</td>
            <td style={cell}>{o.openOrder ? `Order ${o.openOrder.number} ${o.openOrder.status === "signed" ? "signed, card not saved" : o.openOrder.sentAt ? "sent, not signed" : "made, not sent"}` : "No order yet"}</td>
            <td style={{ ...cell, textAlign: "right" }}>
              <button type="button" onClick={() => onMake(byId.get(o.id) || { id: o.id, name: o.name })} style={{ background: T.green600, color: T.white, border: 0, borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>
                {o.openOrder ? "Open order" : "Make order"}</button>
            </td>
          </tr>
        ))}
      </tbody></table> : null}
    </div>
  );
}

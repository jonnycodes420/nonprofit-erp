// ONBOARD-1 · the close link for an organization that already exists. ORDER-1 (24 Nov
// 2026): Jonathan types the order here, and the link shows exactly what he typed: the
// plan, the price per month or per year, the setup fee or Waived, the free days before
// the first charge (30 by default), a note line, and who signs. Prices are typed per
// deal; nothing public reads them. An open order can be edited (she is told it changed);
// a signed one never is: a new order replaces it. Send emails her the link, only when
// he presses it.
import { useState, useEffect } from "react";
import { apiFetch, API, getToken } from "../../api";
import { T } from "../shared";

const box = { background: T.white, border: `1px solid ${T.bg3}`, borderRadius: 12, padding: 18, maxWidth: 560, width: "100%", boxSizing: "border-box", maxHeight: "92vh", overflowY: "auto" };
const inp = { padding: "8px 10px", border: `1px solid ${T.bg3}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
const lab = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: T.ink2, marginBottom: 10 };
const two = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0 10px" };
const head = { fontSize: 12, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", margin: "8px 0 8px" };
const primary = { background: T.green600, color: T.white, border: 0, borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit" };
const quiet = { background: "transparent", border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit" };
const small = { ...quiet, padding: "2px 8px", fontSize: 12 };

const fromOrder = (o, d = {}) => ({
  signerName: o.signerName || "", signerTitle: o.signerTitle || "", signerEmail: o.signerEmail || "",
  planName: o.planName || d.planName || "", planDetail: o.planDetail || d.planDetail || "", interval: o.interval || "month",
  price: o.priceCents != null ? String(o.priceCents / 100) : "", setupFee: o.setupFeeCents ? String(o.setupFeeCents / 100) : "Waived",
  setupDetail: o.setupDetail || d.setupDetail || "", freeDays: String(o.freeDays || 30), note: o.note || "", band: o.tierId || "r500",
});

async function downloadPdf(id, number) {
  const t = getToken();
  const res = await fetch(`${API}/admin/start-links/${encodeURIComponent(id)}/pdf`, { credentials: "include", headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new Error("The PDF could not be made.");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a"); a.href = url; a.download = `steward-order-${number}.pdf`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export default function StartLinkPanel({ org, onClose }) {
  const [info, setInfo] = useState(null);
  const [f, setF] = useState(null);
  const [editing, setEditing] = useState(null);   // the open order being edited, if any
  const [out, setOut] = useState(null);
  const [sent, setSent] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    apiFetch(`/admin/orgs/${org.id}/start-links`).then(d => {
      setInfo(d);
      setF(fromOrder({ signerName: d.admin ? d.admin.name : "", signerEmail: d.admin ? d.admin.email : "" }, d.orderDefaults));
    }).catch(e => setErr(e.message));
  }, [org.id]);

  const openOrder = info && info.links.find(l => l.order_json && l.state === "open");
  const signedOrder = info && info.links.find(l => l.order_json && (l.state === "signed" || l.state === "completed"));
  const pdf = (id, number) => downloadPdf(id, number).catch(e => setErr(e.message));

  async function save(replace = false) {
    setBusy(true); setErr(null);
    try {
      if (editing) {
        const r = await apiFetch(`/admin/start-links/${editing.id}/order`, { method: "PATCH", body: JSON.stringify({ order: f }) });
        setOut({ edited: true, sentence: r.sentence });
      } else {
        setOut(await apiFetch(`/admin/orgs/${org.id}/start-links`, { method: "POST", body: JSON.stringify({ order: f, replace }) }));
      }
    } catch (e) { setErr(e.message); if (e.error === "start_link_open") setOut({ askReplace: true }); }
    setBusy(false);
  }
  async function send() {
    setBusy(true); setErr(null);
    try { setSent(await apiFetch(`/admin/start-links/${out.id}/send`, { method: "POST", body: JSON.stringify({ token: out.token }) })); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const form = f ? (
    <>
      <div style={{ ...head, marginTop: 4 }}>Who signs</div>
      <div style={two}>
        <label style={lab}>Full name<input data-testid="sl-name" style={inp} value={f.signerName} onChange={set("signerName")} /></label>
        <label style={lab}>Title<input data-testid="sl-title" style={inp} value={f.signerTitle} onChange={set("signerTitle")} placeholder="Executive Director" /></label>
      </div>
      <label style={lab}>Email (the billing email on the order)<input data-testid="sl-email" style={inp} type="email" value={f.signerEmail} onChange={set("signerEmail")} /></label>
      <div style={head}>The order</div>
      <label style={lab}>Plan name<input data-testid="sl-plan" style={inp} value={f.planName} onChange={set("planName")} /></label>
      <label style={lab}>What it includes (one line)<input style={inp} value={f.planDetail} onChange={set("planDetail")} /></label>
      <div style={two}>
        <label style={lab}>Price, in dollars<input data-testid="sl-price" style={inp} inputMode="decimal" value={f.price} onChange={set("price")} placeholder="149" /></label>
        <label style={lab}>Per
          <select data-testid="sl-interval" style={inp} value={f.interval} onChange={set("interval")}><option value="month">month</option><option value="year">year</option></select>
        </label>
      </div>
      <div style={two}>
        <label style={lab}>Setup fee (dollars, or Waived)<input data-testid="sl-setup" style={inp} value={f.setupFee} onChange={set("setupFee")} /></label>
        <label style={lab}>Free days before the first charge<input data-testid="sl-days" style={inp} inputMode="numeric" value={f.freeDays} onChange={set("freeDays")} /></label>
      </div>
      <label style={lab}>What setup includes (one line)<input style={inp} value={f.setupDetail} onChange={set("setupDetail")} /></label>
      <label style={lab}>Note line on the order (optional)<input data-testid="sl-note" style={inp} value={f.note} onChange={set("note")} placeholder="Founding pilot price. Your price is locked for as long as you stay with Steward." /></label>
      <label style={lab}>Size band (sets the Stripe product only; the price above is what she pays)
        <select style={inp} value={f.band} onChange={set("band")}>{(info ? info.bands : []).map(b => <option key={b.id} value={b.id}>{b.band}</option>)}</select>
      </label>
    </>
  ) : null;

  return (
    <div role="dialog" aria-label="Make an order" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,26,18,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 400, padding: 16 }}>
      <div style={box} onClick={e => e.stopPropagation()} data-testid="start-link-panel">
        <div style={{ fontSize: 17, fontWeight: 700, color: T.ink, marginBottom: 4 }}>Order for {org.name}</div>
        <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 14 }}>
          {info && info.paperDoneAt ? `Paper done ${new Date(info.paperDoneAt).toLocaleDateString()}: signed, card saved. ` : "She reads the order, signs it, then saves a card. Nothing is charged when she signs. "}
          {info ? (info.deal ? `Deal: ${info.deal.name} (moves to Signed, then Card on file).` : "No deal in Sales is linked to this org, so no deal moves.") : ""}
        </div>
        {signedOrder && !out ? <div style={{ fontSize: 12.5, marginBottom: 12, color: T.ink2 }} data-testid="sl-signed">
          Order {signedOrder.order_number} is signed. A signed order is never edited; a new order replaces it.{" "}
          <button type="button" onClick={() => pdf(signedOrder.id, signedOrder.order_number)} style={small}>Signed PDF</button></div> : null}
        {openOrder && !editing && !out ? <div style={{ fontSize: 12.5, marginBottom: 12, color: T.ink2 }} data-testid="sl-open">
          Order {openOrder.order_number} is open{Number(openOrder.order_version) > 1 ? ` (version ${openOrder.order_version})` : ""}{openOrder.sent_at ? `, sent ${new Date(openOrder.sent_at).toLocaleDateString()}` : ", not sent"}.{" "}
          <button type="button" data-testid="sl-edit" onClick={() => { setEditing(openOrder); setF(fromOrder(openOrder.order_json, info.orderDefaults)); }} style={small}>Edit it</button>{" "}
          <button type="button" onClick={() => pdf(openOrder.id, openOrder.order_number)} style={small}>PDF</button></div> : null}
        {out && out.url ? (
          <div data-testid="start-link-result">
            <div style={{ fontSize: 13, marginBottom: 6 }}>Order <b>{out.orderNumber}</b> for {out.contactName} ({out.contactEmail}):</div>
            <input readOnly value={out.url} style={inp} onFocus={e => e.target.select()} data-testid="start-link-url" />
            <div style={{ fontSize: 12, color: T.ink3, marginTop: 8 }}>{out.sentence} Copy it now: Steward keeps only its fingerprint.</div>
            {sent ? <div role="status" style={{ fontSize: 12.5, marginTop: 10, fontWeight: 600 }} data-testid="sl-sent">{sent.sentence}</div> : null}
            {err ? <div role="alert" style={{ fontSize: 12.5, color: T.ink, fontWeight: 600, marginTop: 10 }}>{err}</div> : null}
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              {!sent || !sent.sent ? <button data-testid="sl-send" disabled={busy} onClick={send} style={{ ...primary, opacity: busy ? 0.6 : 1 }}>Send "Review and sign your order" to {out.contactEmail}</button> : null}
              <button onClick={() => pdf(out.id, out.orderNumber)} style={quiet}>PDF</button>
              <button onClick={onClose} style={quiet}>Done</button>
            </div>
          </div>
        ) : out && out.edited ? (
          <div data-testid="start-link-edited"><div style={{ fontSize: 13 }}>{out.sentence}</div>
            <button onClick={onClose} style={{ ...primary, marginTop: 14 }}>Done</button></div>
        ) : (
          <>
            {form}
            {err ? <div role="alert" style={{ fontSize: 12.5, color: T.ink, fontWeight: 600, marginBottom: 10 }}>{err}</div> : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button data-testid="sl-create" disabled={busy || !info} onClick={() => save(!!(out && out.askReplace))} style={{ ...primary, opacity: busy ? 0.6 : 1 }}>
                {editing ? `Save version ${Number(editing.order_version || 1) + 1}` : out && out.askReplace ? "Replace the open order" : "Make the order"}</button>
              <button onClick={onClose} style={quiet}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

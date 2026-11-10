// ONBOARD-1 · "Create start link" for an organization that already exists.
// Contact, price (the org's custom price or a band), the first charge date
// (a fixed date, Jan 1 2027 for the betas, or 30 days from signing) and a
// note. Returns /start/<token>: single use, 14 days. Nothing is charged when
// the contact signs; the card is saved and the first charge is on that date.
import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";

const box = { background: T.white, border: `1px solid ${T.bg3}`, borderRadius: 12, padding: 18, maxWidth: 520, width: "100%", boxSizing: "border-box" };
const inp = { padding: "8px 10px", border: `1px solid ${T.bg3}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
const lab = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: T.ink2, marginBottom: 10 };

export default function StartLinkPanel({ org, onClose }) {
  const [info, setInfo] = useState(null);
  const [f, setF] = useState({ contactName: "", contactEmail: "", priceSource: "band", band: "r500", chargeMode: "fixed", firstChargeOn: "2027-01-01", note: "" });
  const [out, setOut] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    apiFetch(`/admin/orgs/${org.id}/start-links`).then(d => {
      setInfo(d);
      if (d.customPriceUsd != null) setF(x => ({ ...x, priceSource: "custom" }));
    }).catch(e => setErr(e.message));
  }, [org.id]);

  async function create(replace = false) {
    setBusy(true); setErr(null);
    try { setOut(await apiFetch(`/admin/orgs/${org.id}/start-links`, { method: "POST", body: JSON.stringify({ ...f, replace }) })); }
    catch (e) { setErr(e.message); if (e.error === "start_link_open") setOut({ askReplace: true }); }
    setBusy(false);
  }

  return (
    <div role="dialog" aria-label="Create start link" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,26,18,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 400, padding: 16 }}>
      <div style={box} onClick={e => e.stopPropagation()} data-testid="start-link-panel">
        <div style={{ fontSize: 17, fontWeight: 700, color: T.ink, marginBottom: 4 }}>Start link for {org.name}</div>
        <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 14 }}>
          {info && info.paperDoneAt ? `Paper done ${new Date(info.paperDoneAt).toLocaleDateString()}: signed, card saved.` : "Paper: not done. The link collects the signature and the card together."}
        </div>
        {out && out.url ? (
          <div data-testid="start-link-result">
            <div style={{ fontSize: 13, marginBottom: 6 }}>Send this to {out.contactName} ({out.contactEmail}):</div>
            <input readOnly value={out.url} style={inp} onFocus={e => e.target.select()} data-testid="start-link-url" />
            <div style={{ fontSize: 12, color: T.ink3, marginTop: 8 }}>{out.sentence}</div>
            <button onClick={onClose} style={{ marginTop: 14, background: T.green600, color: T.white, border: 0, borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>Done</button>
          </div>
        ) : (
          <>
            <label style={lab}>Contact name<input data-testid="sl-name" style={inp} value={f.contactName} onChange={set("contactName")} /></label>
            <label style={lab}>Contact email<input data-testid="sl-email" style={inp} type="email" value={f.contactEmail} onChange={set("contactEmail")} /></label>
            <label style={lab}>Price
              <select data-testid="sl-price" style={inp} value={f.priceSource === "custom" ? "custom" : f.band}
                onChange={e => setF(x => e.target.value === "custom" ? { ...x, priceSource: "custom" } : { ...x, priceSource: "band", band: e.target.value })}>
                {info && info.customPriceUsd != null ? <option value="custom">Their custom price: ${info.customPriceUsd.toLocaleString("en-US")}/month</option> : null}
                {(info ? info.bands : []).map(b => <option key={b.id} value={b.id}>{b.band}: ${b.monthlyUsd}/month</option>)}
              </select>
            </label>
            <label style={lab}>First charge
              <select data-testid="sl-mode" style={inp} value={f.chargeMode} onChange={set("chargeMode")}>
                <option value="fixed">On a fixed date</option>
                <option value="thirty">30 days from signing</option>
              </select>
            </label>
            {f.chargeMode === "fixed" ? <label style={lab}>Date<input data-testid="sl-date" style={inp} type="date" value={f.firstChargeOn} onChange={set("firstChargeOn")} /></label> : null}
            <label style={lab}>Note (only you see it)<input style={inp} value={f.note} onChange={set("note")} /></label>
            {err ? <div role="alert" style={{ fontSize: 12.5, color: T.ink, fontWeight: 600, marginBottom: 10 }}>{err}</div> : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button data-testid="sl-create" disabled={busy || !info} onClick={() => create(!!(out && out.askReplace))}
                style={{ background: T.green600, color: T.white, border: 0, borderRadius: 8, padding: "8px 14px", cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
                {out && out.askReplace ? "Replace the open link" : "Create start link"}</button>
              <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

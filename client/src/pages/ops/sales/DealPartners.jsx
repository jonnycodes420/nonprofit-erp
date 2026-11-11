// SALES-1 Part B · a deal's partners: which partner, which of its terms, and
// any override on this deal (percent, flat, months, cap). When the partner's
// terms don't stack, the server refuses a second term of theirs on one deal.
import { useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { INK, CREAM, says, btn, box, link, brassTag, usd } from "./salesBits";

export default function DealPartners({ dealId, lines, reload }) {
  const [partners, setPartners] = useState(null);
  const [f, setF] = useState({ partner: "", term_id: "", override_percent: "", override_months: "", override_cap: "" });
  const [msg, setMsg] = useState(null);
  useEffect(() => { apiFetch("/ops/sales/partners").then(d => setPartners(d.partners)).catch(() => setPartners([])); }, []);
  const p = (partners || []).find(x => x.id === f.partner);
  const add = async () => {
    setMsg(null);
    try {
      await apiFetch(`/ops/sales/deals/${encodeURIComponent(dealId)}/partners`, { method: "POST", body: JSON.stringify({ term_id: f.term_id,
        override_percent: f.override_percent, override_months: f.override_months, override_cap_cents: f.override_cap === "" ? "" : Math.round(Number(f.override_cap) * 100) }) });
      setF({ partner: "", term_id: "", override_percent: "", override_months: "", override_cap: "" }); reload();
    } catch (e) { setMsg(e.message); }
  };
  const remove = async id => { setMsg(null); try { await apiFetch(`/ops/sales/deal-partners/${id}`, { method: "DELETE" }); reload(); } catch (e) { setMsg(e.message); } };
  return <div data-deal-partners={dealId}>
    {lines.length === 0 ? <p style={says}>No partner on this deal.</p> : lines.map(l => <div key={l.id} style={{ fontSize: 13, padding: "5px 0", borderTop: `1px solid ${CREAM}` }} data-deal-partner={l.id}>
      <b>{l.partner}</b><div style={{ fontSize: 12, opacity: 0.8 }}>{l.term}</div>
      {[l.override.percent != null ? `${Number(l.override.percent)}% on this deal` : null, l.override.months != null ? `${l.override.months} months on this deal` : null,
        l.override.cap_cents != null ? `cap ${usd(l.override.cap_cents)} on this deal` : null].filter(Boolean).map(s => <div key={s} style={{ fontSize: 12 }}>{s}</div>)}
      <div style={{ fontSize: 12 }}>Owed so far: {usd(l.owedCents)} <button type="button" style={{ ...link, fontSize: 12, color: INK, opacity: 0.6 }} onClick={() => remove(l.id)}>Remove</button></div>
    </div>)}
    {partners && partners.length ? <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <select value={f.partner} onChange={e => setF(x => ({ ...x, partner: e.target.value, term_id: "" }))} style={box} aria-label="Partner" data-deal-partner-pick="1">
        <option value="">Add a partner…</option>{partners.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      {p ? <select value={f.term_id} onChange={e => setF(x => ({ ...x, term_id: e.target.value }))} style={box} aria-label="Term" data-deal-term-pick="1">
        <option value="">Which term?</option>{p.terms.map(t => <option key={t.id} value={t.id}>{t.name}: {t.says}</option>)}</select> : null}
      {f.term_id ? <>
        <div style={{ fontSize: 12, opacity: 0.75 }}>Override on this deal (optional)</div>
        <div style={{ display: "flex", gap: 6 }}>
          <input value={f.override_percent} onChange={e => setF(x => ({ ...x, override_percent: e.target.value }))} placeholder="%" style={{ ...box, width: 60 }} aria-label="Override percent" />
          <input value={f.override_months} onChange={e => setF(x => ({ ...x, override_months: e.target.value }))} placeholder="months" style={{ ...box, width: 70 }} aria-label="Override months" />
          <input value={f.override_cap} onChange={e => setF(x => ({ ...x, override_cap: e.target.value }))} placeholder="cap $" style={{ ...box, width: 70 }} aria-label="Override cap" />
        </div>
        <button type="button" style={btn} onClick={add} data-deal-partner-add="1">Put on this deal</button></> : null}
    </div> : partners ? <p style={says}>Add partners on the Partners tab first.</p> : null}
    {msg ? <p style={{ ...says, opacity: 1, marginTop: 6 }}><span style={brassTag}>Not done</span> {msg}</p> : null}
  </div>;
}

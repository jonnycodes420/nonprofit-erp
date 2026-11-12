// SALES-3 item 1 · Sales settings → Plans: what a quote can name. The public bundle and CRM
// alone to start, each with its list price and what's included; add-ons beside them. Saved
// whole. A plan's Stripe band decides which Steward product billing rides on.
import { useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { CREAM, card, h2, says, btn, quiet, box, link, brassTag } from "./salesBits";

const blank = addon => ({ key: "", name: "", listCents: 0, includes: [], ...(addon ? {} : { tier: "r2500" }) });

function Row({ p, onChange, onRemove, addon }) {
  return <div style={{ background: CREAM, borderRadius: 8, padding: 10, marginBottom: 8 }} data-plan-row={p.key || "new"}>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <input value={p.name} onChange={e => onChange({ ...p, name: e.target.value })} placeholder={addon ? "Add-on name" : "Plan name"} aria-label="Name" style={{ ...box, flex: "1 1 200px" }} />
      <label style={{ fontSize: 12.5 }}>$ / month <input value={p.listCents / 100} onChange={e => onChange({ ...p, listCents: Math.round(Number(e.target.value || 0) * 100) })} inputMode="decimal" aria-label="List price" style={{ ...box, width: 90 }} /></label>
      <button type="button" style={{ ...link, fontSize: 12 }} onClick={onRemove}>Remove</button>
    </div>
    <textarea value={(p.includes || []).join("\n")} onChange={e => onChange({ ...p, includes: e.target.value.split("\n") })} rows={3} placeholder="What's included, one line each (shown on the quote)" aria-label="Included" style={{ ...box, width: "100%", marginTop: 6 }} />
  </div>;
}

export default function PlanSettings() {
  const [v, setV] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { apiFetch("/ops/sales/plans").then(setV).catch(() => setV({ failed: true })); }, []);
  if (!v) return null;
  if (v.failed) return <section style={card}><p style={says}>The plans could not be read.</p></section>;
  const put = (list, i, x) => setV(s => ({ ...s, [list]: s[list].map((p, j) => (j === i ? x : p)) }));
  const save = async () => {
    setMsg(null);
    const clean = list => list.map(p => ({ ...p, includes: (p.includes || []).map(x => x.trim()).filter(Boolean) }));
    try { const r = await apiFetch("/ops/sales/plans", { method: "PUT", body: JSON.stringify({ plans: clean(v.plans), addons: clean(v.addons) }) }); setV(s => ({ ...s, plans: r.plans, addons: r.addons })); setMsg("Saved."); }
    catch (e) { setMsg(e.message || "Not saved."); }
  };
  return <section style={card} data-sales-plans="1">
    <h2 style={h2}>Plans for quotes</h2>
    <p style={says}>A quote names one plan and any add-ons; their list prices add up to the list price the quote compares against. A price below it needs a reason on the quote.</p>
    {v.plans.map((p, i) => <Row key={i} p={p} onChange={x => put("plans", i, x)} onRemove={() => setV(s => ({ ...s, plans: s.plans.filter((_, j) => j !== i) }))} />)}
    <button type="button" style={quiet} onClick={() => setV(s => ({ ...s, plans: [...s.plans, blank(false)] }))}>Add a plan</button>
    <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Add-ons</h3>
    {v.addons.length === 0 ? <p style={says}>None yet.</p> : v.addons.map((p, i) => <Row key={i} addon p={p} onChange={x => put("addons", i, x)} onRemove={() => setV(s => ({ ...s, addons: s.addons.filter((_, j) => j !== i) }))} />)}
    <button type="button" style={quiet} onClick={() => setV(s => ({ ...s, addons: [...s.addons, blank(true)] }))} data-plan-addon-add="1">Add an add-on</button>
    <div style={{ marginTop: 10 }}><button type="button" style={btn} onClick={save} data-plans-save="1">Save plans</button>
      {msg ? <span style={{ fontSize: 13, marginLeft: 8 }}>{msg === "Saved." ? msg : <><span style={brassTag}>Not saved</span> {msg}</>}</span> : null}</div>
  </section>;
}

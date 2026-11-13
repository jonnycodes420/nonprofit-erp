// SALES-3 item 5 · Sales settings → Customer health: the rule the Customers board reads. Each
// line is a fact, a comparison and the words it shows ("no sign-in in 10 days" = Needs a call).
// Words, never a score.
import { useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { card, h2, says, btn, quiet, box, link, brassTag } from "./salesBits";

const OPS = [">=", ">", "<=", "<", "="];
const OP_WORDS = { ">=": "is at least", ">": "is more than", "<=": "is at most", "<": "is under", "=": "is" };

export default function HealthSettings() {
  const [v, setV] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { apiFetch("/ops/sales/health").then(setV).catch(() => setV({ failed: true })); }, []);
  if (!v) return null;
  if (v.failed) return <section style={card}><p style={says}>The health rule could not be read.</p></section>;
  const set = (i, x) => setV(s => ({ ...s, rules: s.rules.map((r, j) => (j === i ? { ...r, ...x } : r)) }));
  const save = async () => {
    setMsg(null);
    try { const r = await apiFetch("/ops/sales/health", { method: "PUT", body: JSON.stringify({ rules: v.rules }) }); setV(s => ({ ...s, rules: r.rules })); setMsg("Saved."); }
    catch (e) { setMsg(e.message || "Not saved."); }
  };
  const facts = Object.entries(v.facts);
  return <section style={card} data-sales-health="1">
    <h2 style={h2}>Customer health</h2>
    <p style={says}>The Customers board shows a customer's health as words: every line below that holds is shown, in this order; when none holds, it reads On track. Counts and dates only.</p>
    {v.rules.map((r, i) => <div key={i} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }} data-health-rule={i}>
      <span style={{ fontSize: 13 }}>When</span>
      <select value={r.fact} onChange={e => set(i, { fact: e.target.value })} style={box} aria-label="Fact">{facts.map(([k, f]) => <option key={k} value={k}>{f.label.toLowerCase()}</option>)}</select>
      <select value={r.op} onChange={e => set(i, { op: e.target.value })} style={box} aria-label="Comparison">{OPS.map(o => <option key={o} value={o}>{OP_WORDS[o]}</option>)}</select>
      <input value={r.value} onChange={e => set(i, { value: e.target.value })} inputMode="numeric" style={{ ...box, width: 60 }} aria-label="Number" data-health-value={i} />
      <span style={{ fontSize: 13 }}>say</span>
      <input value={r.says} onChange={e => set(i, { says: e.target.value })} style={{ ...box, minWidth: 180 }} aria-label="Words" />
      <button type="button" style={{ ...link, fontSize: 12 }} onClick={() => setV(s => ({ ...s, rules: s.rules.filter((_, j) => j !== i) }))}>Remove</button>
    </div>)}
    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
      <button type="button" style={quiet} onClick={() => setV(s => ({ ...s, rules: [...s.rules, { fact: "daysSinceSignIn", op: ">=", value: 10, says: "Needs a call" }] }))}>Add a line</button>
      <button type="button" style={btn} onClick={save} data-health-save="1">Save the rule</button>
      {msg ? <span style={{ fontSize: 13 }}>{msg === "Saved." ? msg : <><span style={brassTag}>Not saved</span> {msg}</>}</span> : null}
    </div>
  </section>;
}

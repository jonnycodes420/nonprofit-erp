// SALES-1 · Sales settings: custom properties per object, pipelines and their
// stages (rename, reorder, add, probability, days limit, kind), and the goal
// the forecast reads.
import { useState } from "react";
import { apiFetch } from "../../../api";
import DateInput from "../../../components/inputs/LazyDateInput";
import { INK, CREAM, card, h2, says, btn, quiet, box, link, brassTag } from "./salesBits";

const TYPE_WORDS = { text: "Text", long_text: "Long text", number: "Number", currency: "Currency", date: "Date", picklist: "Pick-list", multiselect: "Multi-select", checkbox: "Checkbox", url: "URL" };
const KIND_WORDS = { open: "Open", won: "Won", later: "Later (closed, needs a revisit date)", lost: "Lost (closed, needs a reason)" };

function Properties({ meta, onChanged }) {
  const [p, setP] = useState({ object: "org", label: "", type: "text", options: "" });
  const [msg, setMsg] = useState(null);
  const add = async () => {
    setMsg(null);
    try { await apiFetch("/ops/sales/properties", { method: "POST", body: JSON.stringify(p) }); setP(x => ({ ...x, label: "", options: "" })); onChanged(); }
    catch (e) { setMsg(e.message); }
  };
  const remove = async id => { await apiFetch(`/ops/sales/properties/${id}`, { method: "DELETE" }); onChanged(); };
  return <section style={card} data-sales-props="1">
    <h2 style={h2}>Custom properties</h2>
    <p style={says}>Each one is edited on the record page, can be a list column and a filter, and is read by import and written by export.</p>
    {["org", "contact", "deal"].map(o => { const list = meta.properties.filter(x => x.object === o); return <div key={o} style={{ marginBottom: 8 }}>
      <b style={{ fontSize: 13 }}>{meta.objects[o].plural}</b>
      {list.length === 0 ? <span style={{ fontSize: 12.5, opacity: 0.6 }}> · none</span> : list.map(x => <div key={x.id} style={{ fontSize: 13, padding: "3px 0", display: "flex", gap: 8 }}>
        <span>{x.label}</span><span style={{ opacity: 0.6 }}>{TYPE_WORDS[x.type]}{x.options && x.options.length ? `: ${x.options.join(", ")}` : ""}</span>
        <button type="button" style={{ ...link, fontSize: 12, color: INK, opacity: 0.7 }} onClick={() => remove(x.id)}>Remove</button></div>)}
    </div>; })}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", background: CREAM, padding: 10, borderRadius: 8 }}>
      <select value={p.object} onChange={e => setP(x => ({ ...x, object: e.target.value }))} style={box} aria-label="On"><option value="org">Organizations</option><option value="contact">Contacts</option><option value="deal">Deals</option></select>
      <input value={p.label} onChange={e => setP(x => ({ ...x, label: e.target.value }))} placeholder="Property name" style={box} aria-label="Property name" data-prop-label="1" />
      <select value={p.type} onChange={e => setP(x => ({ ...x, type: e.target.value }))} style={box} aria-label="Type">{meta.propTypes.map(t => <option key={t} value={t}>{TYPE_WORDS[t]}</option>)}</select>
      {p.type === "picklist" || p.type === "multiselect" ? <input value={p.options} onChange={e => setP(x => ({ ...x, options: e.target.value }))} placeholder="Choices, comma between each" style={{ ...box, minWidth: 220 }} aria-label="Choices" /> : null}
      <button type="button" style={btn} onClick={add} disabled={!p.label.trim()} data-prop-add="1">Add property</button>
    </div>
    {msg ? <p style={{ ...says, opacity: 1, marginTop: 6 }}><span style={brassTag}>Not added</span> {msg}</p> : null}
    <p style={{ ...says, marginTop: 6 }}>Removing a property hides it; the values stay on each record and come back if you add it again with the same name.</p>
  </section>;
}

function Pipeline({ p, onChanged }) {
  const [stages, setStages] = useState(p.stages.map(s => ({ ...s })));
  const [name, setName] = useState(p.name);
  const [msg, setMsg] = useState(null);
  const set = (i, k, v) => setStages(ss => ss.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const moveIt = (i, d) => setStages(ss => { const n = ss.slice(); const [x] = n.splice(i, 1); n.splice(i + d, 0, x); return n; });
  const save = async () => {
    setMsg(null);
    try {
      if (name !== p.name) await apiFetch(`/ops/sales/pipelines/${p.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      await apiFetch(`/ops/sales/pipelines/${p.id}/stages`, { method: "PUT", body: JSON.stringify({ stages }) });
      setMsg("Saved."); onChanged();
    } catch (e) { setMsg(e.message); }
  };
  return <div style={{ marginBottom: 16 }} data-sales-pipeline={p.id}>
    <input value={name} onChange={e => setName(e.target.value)} style={{ ...box, fontWeight: 700, marginBottom: 6 }} aria-label="Pipeline name" />
    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
      <thead><tr>{["", "Stage", "Probability %", "Days limit", "Kind", "Gates", ""].map((h, i) => <th key={i} style={{ textAlign: "left", fontSize: 12, fontWeight: 600, opacity: 0.65, padding: "0 8px 6px 0" }}>{h}</th>)}</tr></thead>
      <tbody>{stages.map((s, i) => <tr key={s.id || `new${i}`} data-stage-row={s.name}>
        <td style={{ whiteSpace: "nowrap" }}><button type="button" style={{ ...link, color: INK }} disabled={i === 0} onClick={() => moveIt(i, -1)} aria-label="Move up">↑</button>{" "}
          <button type="button" style={{ ...link, color: INK }} disabled={i === stages.length - 1} onClick={() => moveIt(i, 1)} aria-label="Move down">↓</button></td>
        <td><input value={s.name} onChange={e => set(i, "name", e.target.value)} style={{ ...box, width: 150 }} aria-label="Stage name" /></td>
        <td><input type="number" min={0} max={100} value={s.probability} onChange={e => set(i, "probability", e.target.value)} style={{ ...box, width: 70 }} aria-label="Probability" /></td>
        <td><input type="number" min={1} value={s.limit_days} onChange={e => set(i, "limit_days", e.target.value)} style={{ ...box, width: 70 }} aria-label="Days limit" /></td>
        <td><select value={s.kind} onChange={e => set(i, "kind", e.target.value)} style={box} aria-label="Kind">{Object.entries(KIND_WORDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
        <td><input type="checkbox" checked={!!s.onboarding} onChange={e => set(i, "onboarding", e.target.checked)} aria-label="Show onboarding gates" /></td>
        <td><button type="button" style={{ ...link, fontSize: 12, color: INK, opacity: 0.7 }} onClick={() => setStages(ss => ss.filter((_, j) => j !== i))}>Remove</button></td>
      </tr>)}</tbody>
    </table>
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
      <button type="button" style={quiet} onClick={() => setStages(ss => [...ss, { name: "New stage", probability: 0, limit_days: 21, kind: "open" }])}>Add stage</button>
      <button type="button" style={btn} onClick={save} data-pipeline-save={p.id}>Save {name}</button>
      {msg ? <span style={{ fontSize: 13, alignSelf: "center" }}>{msg}</span> : null}
    </div>
  </div>;
}

function Goal({ goal, onChanged }) {
  const [dollars, setDollars] = useState(String(goal.cents / 100));
  const [by, setBy] = useState(goal.by);
  const [msg, setMsg] = useState(null);
  const save = async () => {
    setMsg(null);
    try { await apiFetch("/ops/sales/settings", { method: "PUT", body: JSON.stringify({ goal: { cents: Math.round(Number(dollars.replace(/[$,\s]/g, "")) * 100), by } }) }); setMsg("Saved."); onChanged(); }
    catch (e) { setMsg(e.message); }
  };
  return <section style={card} data-sales-goal="1">
    <h2 style={h2}>Goal</h2>
    <p style={says}>The forecast measures MRR now, and MRR now plus the weighted pipeline, against this. Now: {goal.says}.</p>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <label style={{ fontSize: 12, fontWeight: 600 }}>MRR ($) <input value={dollars} onChange={e => setDollars(e.target.value)} style={{ ...box, width: 110 }} aria-label="Goal MRR" /></label>
      <label style={{ fontSize: 12, fontWeight: 600 }}>by <DateInput value={by} onChange={e => setBy(e.target.value)} style={box} aria-label="Goal by" /></label>
      <button type="button" style={btn} onClick={save}>Save goal</button>{msg ? <span style={{ fontSize: 13 }}>{msg}</span> : null}
    </div>
  </section>;
}

export default function SettingsPanel({ meta, onChanged, onClose }) {
  const [newName, setNewName] = useState("");
  const addPipe = async () => { await apiFetch("/ops/sales/pipelines", { method: "POST", body: JSON.stringify({ name: newName }) }); setNewName(""); onChanged(); };
  return <div data-sales-settings="1">
    <button type="button" style={{ ...link, marginBottom: 10 }} onClick={onClose}>← Back to Sales</button>
    <Goal goal={meta.settings.goal} onChanged={onChanged} />
    <section style={card}>
      <h2 style={h2}>Pipelines and stages</h2>
      <p style={says}>Each stage has a probability (the forecast weights a deal's value by it) and a days limit (a deal in it longer shows in Today as stuck). Later and Lost are closed: Later needs a revisit date and is never a loss; Lost needs a reason. Tick Gates where ONBOARD-2's five gates should show on the deal. A stage that still holds a deal can't be removed.</p>
      {meta.pipelines.map(p => <Pipeline key={`${p.id}:${p.stages.map(s => s.id).join()}`} p={p} onChanged={onChanged} />)}
      <div style={{ display: "flex", gap: 6 }}><input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New pipeline, e.g. Partner" style={box} aria-label="New pipeline" />
        <button type="button" style={quiet} onClick={addPipe} disabled={!newName.trim()}>Add pipeline</button></div>
    </section>
    <Properties meta={meta} onChanged={onChanged} />
  </div>;
}

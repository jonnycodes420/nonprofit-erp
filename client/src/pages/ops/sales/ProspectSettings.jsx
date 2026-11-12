// SALES-2 · the prospecting half of Sales settings: the fit rule (item 2), call mode's
// outcome rules (item 3) and the email templates (item 5). Each saves whole, and every
// organization's fit line changes on its next read.
import { useState } from "react";
import { apiFetch } from "../../../api";
import { CREAM, card, h2, says, btn, quiet, box, link, brassTag, failureWords } from "./salesBits";
import { CadenceSettings } from "./Cadences";

const FIELD_CHOICES = [["state", "State"], ["revenue", "Revenue ($ a year)"], ["current_crm", "Current CRM"], ["city", "City"], ["nonprofit_type", "Type"],
  ["has_ed", "Has an executive director"], ["has_dd", "Has a development director"], ["has_phone", "Has a phone"], ["has_email", "Has an email"]];
const FLAG = new Set(["has_ed", "has_dd", "has_phone", "has_email"]);
const opFor = f => (FLAG.has(f) ? "yes" : f === "revenue" ? "between" : "in");

function useSave(onChanged) {
  const [msg, setMsg] = useState(null);
  const save = async body => {
    setMsg(null);
    try { await apiFetch("/ops/sales/settings", { method: "PUT", body: JSON.stringify(body) }); setMsg("Saved."); onChanged(); }
    catch (e) { setMsg(failureWords(e, "Not saved.")); }
  };
  return [msg, save];
}

function FitRule({ fit, onChanged }) {
  const [checks, setChecks] = useState(fit.checks.map(c => ({ ...c, values: (c.values || []).join(", ") })));
  const [msg, save] = useSave(onChanged);
  const set = (i, patch) => setChecks(cs => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return <section style={card} data-sales-fit-rule="1">
    <h2 style={h2}>Fit</h2>
    <p style={says}>A checklist of properties. Each organization shows "Fits 4 of 5" with the misses named, and lists sort and filter by it. It's arithmetic on the organization's fields, never a score from a model. A value the organization doesn't have counts as a miss, named as not known.</p>
    {checks.map((c, i) => <div key={i} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "5px 0", borderTop: `1px solid ${CREAM}` }} data-fit-check={c.field}>
      <select value={c.field} onChange={e => set(i, { field: e.target.value, op: opFor(e.target.value) })} style={box} aria-label="Property">
        {FIELD_CHOICES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {c.op === "in" ? <input value={c.values} onChange={e => set(i, { values: e.target.value })} placeholder="any of, comma between each" style={{ ...box, flex: "1 1 200px" }} aria-label="Any of" />
        : c.op === "between" ? <><input value={c.min ?? ""} onChange={e => set(i, { min: e.target.value })} placeholder="from $" style={{ ...box, width: 110 }} aria-label="From" />
          <input value={c.max ?? ""} onChange={e => set(i, { max: e.target.value })} placeholder="to $" style={{ ...box, width: 110 }} aria-label="To" /></>
        : <span style={{ fontSize: 12.5, opacity: 0.7 }}>yes</span>}
      <button type="button" style={{ ...link, fontSize: 12 }} onClick={() => setChecks(cs => cs.filter((_, j) => j !== i))} aria-label="Remove this line">Remove</button>
    </div>)}
    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
      <button type="button" style={quiet} onClick={() => setChecks(cs => [...cs, { field: "state", op: "in", values: "" }])}>Add a line</button>
      <button type="button" style={btn} onClick={() => save({ fit: { checks: checks.map(c => ({ ...c, values: String(c.values || "").split(",").map(x => x.trim()).filter(Boolean) })) } })} data-fit-save="1">Save the fit rule</button>
      {msg ? <span style={{ fontSize: 13 }}>{msg}</span> : null}
    </div>
  </section>;
}

function CallRules({ meta, onChanged }) {
  const [rules, setRules] = useState(meta.settings.callRules);
  const [msg, save] = useSave(onChanged);
  const stages = [...new Set(meta.pipelines.flatMap(p => p.stages.map(s => s.name)))];
  const set = (k, patch) => setRules(r => ({ ...r, [k]: { ...r[k], ...patch } }));
  return <section style={card} data-sales-call-rules="1">
    <h2 style={h2}>Call outcomes</h2>
    <p style={says}>What each outcome in call mode does next. "Call again" makes a task that many business days on (Saturday and Sunday don't count); call mode skips the person until that day. Meeting booked always asks for the meeting and makes a "send the invite" task; Not a fit always closes the organization's deals as Lost; Bad number marks the number and tries the other contact.</p>
    <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
      <thead><tr>{["Outcome", "Call again in (business days)", "Email task today", "Deal moves to"].map(h => <th key={h} style={{ textAlign: "left", fontSize: 12, opacity: 0.65, padding: "0 10px 6px 0" }}>{h}</th>)}</tr></thead>
      <tbody>{meta.outcomes.map(o => { const r = rules[o.key] || {}; return <tr key={o.key} style={{ borderTop: `1px solid ${CREAM}` }} data-call-rule={o.key}>
        <td style={{ padding: "5px 10px 5px 0" }}>{o.label}</td>
        <td><input value={r.callAgainDays ?? ""} onChange={e => set(o.key, { callAgainDays: e.target.value === "" ? null : e.target.value })} placeholder="none" style={{ ...box, width: 70 }} aria-label={`${o.label}: call again in`} /></td>
        <td><input type="checkbox" checked={!!r.emailToday} onChange={e => set(o.key, { emailToday: e.target.checked })} aria-label={`${o.label}: email task today`} /></td>
        <td>{o.key === "not_a_fit" ? "Lost" : <select value={r.stage || ""} onChange={e => set(o.key, { stage: e.target.value || null })} style={box} aria-label={`${o.label}: deal moves to`}>
          {o.key === "meeting_booked" ? null : <option value="">stays where it is</option>}{stages.filter(s => s !== "Lost" && s !== "Later").map(s => <option key={s} value={s}>{s}</option>)}</select>}</td>
      </tr>; })}</tbody></table></div>
    <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
      <button type="button" style={btn} onClick={() => save({ callRules: rules })} data-call-rules-save="1">Save the outcomes</button>{msg ? <span style={{ fontSize: 13 }}>{msg}</span> : null}
    </div>
  </section>;
}

function Templates({ meta, onChanged }) {
  const [list, setList] = useState(meta.settings.templates);
  const [msg, save] = useSave(onChanged);
  const set = (i, patch) => setList(l => l.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return <section style={card} data-sales-templates="1">
    <h2 style={h2}>Email templates</h2>
    <p style={says}>"Email" on a contact, a deal or in call mode fills one of these, then offers Copy and Open in Mail. Steward never sends it. Merge fields: {meta.mergeFields.map(f => `{{${f}}}`).join(" ")}.</p>
    {list.map((t, i) => <div key={t.id} style={{ background: CREAM, borderRadius: 8, padding: 10, marginBottom: 8 }} data-template={t.id}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input value={t.name} onChange={e => set(i, { name: e.target.value })} placeholder="Name" style={{ ...box, flex: "1 1 160px" }} aria-label="Template name" />
        <input value={t.subject} onChange={e => set(i, { subject: e.target.value })} placeholder="Subject" style={{ ...box, flex: "2 1 240px" }} aria-label="Template subject" />
        <button type="button" style={{ ...link, fontSize: 12 }} onClick={() => setList(l => l.filter((_, j) => j !== i))}>Remove</button>
      </div>
      <textarea value={t.body} onChange={e => set(i, { body: e.target.value })} rows={6} style={{ ...box, width: "100%", marginTop: 6 }} aria-label="Template body" />
    </div>)}
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" style={quiet} onClick={() => setList(l => [...l, { id: `stp_${Date.now().toString(36)}`, name: "New template", subject: "", body: "Hi {{first_name}},\n\n" }])}>Add a template</button>
      <button type="button" style={btn} onClick={() => save({ templates: list })} data-templates-save="1">Save the templates</button>
      {msg ? <span style={{ fontSize: 13 }}>{msg === "Saved." ? msg : <><span style={brassTag}>Not saved</span> {msg}</>}</span> : null}
    </div>
  </section>;
}

export default function ProspectSettings({ meta, onChanged }) {
  return <>
    <FitRule fit={meta.settings.fit} onChanged={onChanged} />
    <CallRules meta={meta} onChanged={onChanged} />
    <Templates meta={meta} onChanged={onChanged} />
    <CadenceSettings meta={meta} />
  </>;
}

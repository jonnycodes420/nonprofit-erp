// SALES-1 · a new organization, contact or deal. A known domain or email comes
// back as a warning naming the record that has it: open that one, or make this
// one anyway. A new deal can be put on an organization at once.
import { useState } from "react";
import { apiFetch } from "../../../api";
import DateInput from "../../../components/inputs/LazyDateInput";
import { CREAM, says, btn, quiet, box, link, brassTag } from "./salesBits";

const FIELDS = {
  org: [["name", "Name"], ["website", "Website or domain"], ["city", "City"], ["state", "State"], ["current_crm", "Current CRM"]],
  contact: [["first_name", "First name"], ["last_name", "Last name"], ["emails", "Email"], ["title", "Title"], ["phones", "Phone"]],
  deal: [["name", "Name"], ["value", "Value (MRR, $)"], ["close_date", "Close date"], ["source", "Source"], ["next_step", "Next step"]],
};

export default function NewRecord({ type, meta, onDone, onCancel, links = [] }) {
  const [v, setV] = useState({});
  const [dupes, setDupes] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const pipe = meta.pipelines[0];
  const save = async (force = false) => {
    setBusy(true); setErr(null);
    const body = { ...v, force, links };
    if (type === "org" && v.website && !/[/:]/.test(v.website) && !/^www\./.test(v.website)) body.domain = v.website;
    if (type === "deal") { body.value_cents = Math.round(Number(String(v.value || 0).replace(/[$,\s]/g, "")) * 100); delete body.value; body.pipeline_id = v.pipeline_id || pipe.id; }
    try { const r = await apiFetch(`/ops/sales/rec/${type}`, { method: "POST", body: JSON.stringify(body) }); onDone(r.id); }
    catch (e) { if (e.status === 409) setDupes(e.duplicates || []); else setErr(e.message); }
    setBusy(false);
  };
  return <div style={{ background: CREAM, borderRadius: 10, padding: 12, marginBottom: 12 }} data-sales-newform={type}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      {FIELDS[type].map(([k, l]) => <label key={k} style={{ fontSize: 12, fontWeight: 600, display: "flex", flexDirection: "column", gap: 3 }}>{l}
        {k === "close_date" ? <DateInput value={v[k] || ""} onChange={e => setV(x => ({ ...x, [k]: e.target.value }))} style={box} aria-label={l} />
          : <input value={v[k] || ""} onChange={e => setV(x => ({ ...x, [k]: e.target.value }))} style={box} aria-label={l} data-new-field={k} />}</label>)}
      {type === "contact" ? <label style={{ fontSize: 12, fontWeight: 600, display: "flex", flexDirection: "column", gap: 3 }}>Role
        <select value={v.role || ""} onChange={e => setV(x => ({ ...x, role: e.target.value }))} style={box}><option value="">–</option>{meta.roles.map(r => <option key={r}>{r}</option>)}</select></label> : null}
      {type === "deal" ? <label style={{ fontSize: 12, fontWeight: 600, display: "flex", flexDirection: "column", gap: 3 }}>Stage
        <select value={v.stage_id || ""} onChange={e => setV(x => ({ ...x, stage_id: e.target.value }))} style={box}>
          {pipe.stages.filter(s => s.kind === "open").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label> : null}
      <button type="button" style={btn} onClick={() => save(false)} disabled={busy} data-new-save="1">{busy ? "Saving…" : "Create"}</button>
      <button type="button" style={quiet} onClick={onCancel}>Cancel</button>
    </div>
    {err ? <p style={{ ...says, opacity: 1, marginTop: 8 }}><span style={brassTag}>Not saved</span> {err}</p> : null}
    {dupes ? <div style={{ fontSize: 13, marginTop: 8 }} data-new-dupe="1"><span style={brassTag}>Already here</span>{" "}
      {type === "org" ? "An organization has this domain:" : "A contact has this email:"}{" "}
      {dupes.map(d => <button key={d.id} type="button" style={link} onClick={() => onDone(d.id)}>{d.name}</button>)}.{" "}
      <button type="button" style={link} onClick={() => save(true)} data-new-force="1">Create another anyway</button></div> : null}
  </div>;
}

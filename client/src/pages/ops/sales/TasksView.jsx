// SALES-1 · the Tasks sub-tab: every task, open first by due day (overdue in
// brass), then done ones with their date. Each opens the records it is on.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { card, says, box } from "./salesBits";
import { ActivityRow } from "./Timeline";

export default function TasksView({ meta, open, onChanged }) {
  const [state, setState] = useState("open");
  const [owner, setOwner] = useState("");
  const [tasks, setTasks] = useState(null);
  const load = useCallback(() => apiFetch(`/ops/sales/tasks?state=${state}${owner ? `&owner=${encodeURIComponent(owner)}` : ""}`).then(d => setTasks(d.tasks)).catch(() => setTasks(false)), [state, owner]);
  useEffect(() => { load(); }, [load]);
  return <section style={card} data-sales-tasks="1">
    <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
      <select value={state} onChange={e => setState(e.target.value)} style={box} aria-label="Which tasks">
        <option value="open">Open</option><option value="done">Done</option><option value="all">All</option></select>
      <select value={owner} onChange={e => setOwner(e.target.value)} style={box} aria-label="Owner">
        <option value="">Every owner</option>{meta.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
    </div>
    <p style={says}>Log a task on any organization, contact or deal. An open task is an empty box; a done one is a check and the day it was done.</p>
    {tasks === null ? <p style={says}>Loading…</p> : tasks === false ? <p style={says}>The tasks could not be read.</p>
      : tasks.length === 0 ? <p style={says}>No {state === "all" ? "" : `${state} `}task.</p>
      : tasks.map(t => <ActivityRow key={t.id} a={t} here={null} open={open} reload={() => { load(); onChanged(); }} />)}
  </section>;
}

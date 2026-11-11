// SALES-1 · a record's activity timeline, and the box that logs a call, a
// meeting, a note or a task. One activity can sit on several records: the
// record's own linked people, organizations and deals are offered as ticks, so
// a meeting with two contacts about one deal shows on all three timelines.
// A task is an empty box while open and a check with its date once done.
import { useState } from "react";
import { apiFetch } from "../../../api";
import DateInput from "../../../components/inputs/LazyDateInput";
import { INK, WHITE, CREAM, EMERALD, BRASS, card, h2, says, btn, box, link, brassTag, dayWords, whenWords, TYPE_WORDS } from "./salesBits";

const KIND_WORDS = { call: "Call", meeting: "Meeting", note: "Note", task: "Task" };
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export function TaskBox({ a, onToggle }) {
  const done = !!a.done_at;
  return <button type="button" role="checkbox" aria-checked={done} aria-label={done ? "Done; mark open" : "Open; mark done"} onClick={onToggle} data-task-box={a.id}
    style={{ width: 20, height: 20, borderRadius: 4, border: `1.5px solid ${done ? EMERALD : INK}`, background: done ? EMERALD : WHITE, color: WHITE,
      cursor: "pointer", fontSize: 13, lineHeight: "16px", padding: 0, flexShrink: 0 }}>{done ? "✓" : ""}</button>;
}

export function ActivityRow({ a, here, open, reload }) {
  const today = new Date().toLocaleDateString("en-CA");   // the viewer's own day
  const overdue = a.kind === "task" && !a.done_at && a.due_on && a.due_on < today;
  const toggle = async () => { await apiFetch(`/ops/sales/activities/${a.id}`, { method: "PATCH", body: JSON.stringify({ done: !a.done_at }) }); reload(); };
  return <div style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: `1px solid ${CREAM}` }} data-activity={a.id} data-kind={a.kind}>
    {a.kind === "task" ? <TaskBox a={a} onToggle={toggle} /> : <span style={{ width: 20, fontSize: 11, fontWeight: 700, opacity: 0.55, paddingTop: 2 }}>{KIND_WORDS[a.kind].slice(0, 4)}</span>}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, opacity: 0.75, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline" }}>
        <b>{KIND_WORDS[a.kind]}</b>
        {a.kind === "task" ? (a.done_at ? <span>done {whenWords(a.done_at)}</span> : a.due_on ? <span>due {dayWords(a.due_on)}</span> : <span>no due date</span>) : <span>{whenWords(a.at)}</span>}
        {overdue ? <span style={brassTag}>overdue</span> : null}
        <span>· {a.created_by_name}</span>
      </div>
      <div style={{ fontSize: 13.5, whiteSpace: "pre-wrap", marginTop: 2}}>{a.body}</div>
      {a.records && a.records.length > (here ? 1 : 0) ? <div style={{ fontSize: 12, marginTop: 3, opacity: 0.8 }}>On: {a.records.map((r, i) => <span key={`${r.type}:${r.id}`}>{i ? ", " : ""}
        {here && r.type === here.type && r.id === here.id ? r.name : <button type="button" style={{ ...link, fontSize: 12 }} onClick={() => open(r.type, r.id)}>{r.name}</button>}</span>)}</div> : null}
    </div>
  </div>;
}

// Part B: one captured email on the timeline: subject, date, direction; the body on click.
function EmailRow({ e }) {
  const [body, setBody] = useState(null);
  const show = async () => { if (body != null) { setBody(null); return; } try { const r = await apiFetch(`/ops/sales/emails/${e.id}`); setBody(r.email.body || "(no text)"); } catch { setBody("The message could not be read."); } };
  return <div style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: `1px solid ${CREAM}` }} data-email={e.id} data-direction={e.direction}>
    <span style={{ width: 20, fontSize: 11, fontWeight: 700, opacity: 0.55, paddingTop: 2 }}>{e.direction === "out" ? "Sent" : "In"}</span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, opacity: 0.75 }}><b>Email {e.direction === "out" ? "sent" : "received"}</b> · {whenWords(e.sent_at)} · {e.direction === "out" ? `to ${(e.to_addrs || []).join(", ")}` : `from ${e.from_addr}`}</div>
      <button type="button" style={{ ...link, fontSize: 13.5, marginTop: 2 }} onClick={show} aria-expanded={body != null}>{e.subject || "(no subject)"}</button>
      {body != null ? <div style={{ fontSize: 13, whiteSpace: "pre-wrap", marginTop: 6, background: CREAM, padding: 8, borderRadius: 6, maxHeight: 360, overflowY: "auto" }}>{body}</div> : null}
    </div>
  </div>;
}

export default function Timeline({ type, id, items, emails = [], linked, open, reload }) {
  const [kind, setKind] = useState("note");
  const [body, setBody] = useState("");
  const [at, setAt] = useState(localNow());
  const [due, setDue] = useState("");
  const [also, setAlso] = useState(new Set());
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const others = ["org", "contact", "deal"].flatMap(t => (linked[t] || []).map(r => ({ type: t, id: r.id, name: r.displayName })));
  const log = async () => {
    setBusy(true); setErr(null);
    try {
      await apiFetch("/ops/sales/activities", { method: "POST", body: JSON.stringify({ kind, body, at: kind === "task" ? undefined : new Date(at).toISOString(), due_on: kind === "task" ? due || null : undefined,
        records: [{ type, id }, ...others.filter(o => also.has(`${o.type}:${o.id}`)).map(o => ({ type: o.type, id: o.id }))] }) });
      setBody(""); setDue(""); setAlso(new Set()); reload();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return <section style={card} data-sales-timeline="1">
    <h2 style={h2}>Activity</h2>
    <div style={{ display: "flex", gap: 6, marginBottom: 8 }} role="tablist" aria-label="Log">
      {Object.entries(KIND_WORDS).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} data-log-kind={k}
        style={{ fontSize: 12.5, fontWeight: 600, padding: "4px 10px", borderRadius: 14, border: `1px solid ${kind === k ? EMERALD : `${INK}33`}`, background: kind === k ? EMERALD : WHITE, color: kind === k ? WHITE : INK, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>)}
    </div>
    <textarea value={body} onChange={e => setBody(e.target.value)} rows={3} placeholder={kind === "task" ? "What needs doing" : `What the ${kind} was about`} style={{ ...box, width: "100%" }} aria-label="What happened" data-log-body="1" />
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
      {kind === "task" ? <label style={{ fontSize: 12, fontWeight: 600 }}>Due <DateInput value={due} onChange={e => setDue(e.target.value)} style={box} aria-label="Due" /></label>
        : <label style={{ fontSize: 12, fontWeight: 600 }}>When <input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} style={box} aria-label="When" /></label>}
      <button type="button" style={btn} onClick={log} disabled={busy || !body.trim()} data-log-save="1">{busy ? "Logging…" : `Log ${KIND_WORDS[kind].toLowerCase()}`}</button>
    </div>
    {others.length ? <div style={{ fontSize: 12.5, marginTop: 8, display: "flex", gap: "4px 12px", flexWrap: "wrap" }}><span style={{ opacity: 0.7 }}>Also on:</span>
      {others.map(o => { const k = `${o.type}:${o.id}`; return <label key={k} style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input type="checkbox" checked={also.has(k)} onChange={e => setAlso(s => { const n = new Set(s); e.target.checked ? n.add(k) : n.delete(k); return n; })} data-log-also={o.id} />
        {o.name} <span style={{ opacity: 0.55 }}>{TYPE_WORDS[o.type]}</span></label>; })}</div> : null}
    {err ? <p style={{ ...says, opacity: 1, marginTop: 6 }}><span style={brassTag}>Not logged</span> {err}</p> : null}
    <div style={{ marginTop: 12 }}>
      {items.length === 0 && emails.length === 0 ? <p style={says}>Nothing logged yet.</p>
        : [...items.map(a => ({ k: "a", t: a.kind === "task" && !a.done_at ? a.due_on || a.at : a.at, a })), ...emails.map(e => ({ k: "e", t: e.sent_at, e }))]
          .sort((x, y) => new Date(y.t) - new Date(x.t))
          .map(x => (x.k === "a" ? <ActivityRow key={x.a.id} a={x.a} here={{ type, id }} open={open} reload={reload} /> : <EmailRow key={x.e.id} e={x.e} />))}
    </div>
    <p style={{ ...says, marginTop: 8, color: INK }}><span style={{ color: BRASS }}>■</span> Overdue tasks are marked in brass.</p>
  </section>;
}

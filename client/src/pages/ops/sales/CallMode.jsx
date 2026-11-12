// SALES-2 item 3 · CALL MODE. One screen, one person at a time, for a laptop and a phone.
// The organization and who to call (their number as a tap-to-call tel: link), the fit line,
// the last three activities and any open task; eight one-click outcomes, each logging the
// call and setting the next step by its rule in Sales settings; a notes box that saves with
// the outcome; a timer; and End session with the dials, connects and meetings.
// The server builds the queue (callMode.js); this screen only walks it.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../api";
import { INK, WHITE, CREAM, EMERALD, card, h2, says, btn, quiet, box, link, brassTag, dayWords, whenWords, Failure, failureWords } from "./salesBits";
import EmailDraft from "./EmailDraft";
import MeetingForm from "./MeetingForm";

const clock = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export default function CallMode({ meta, listId = null, view = null, onClose, open }) {
  const [q, setQ] = useState(null);
  const [fail, setFail] = useState(null);
  const [done, setDone] = useState([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [booking, setBooking] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [counts, setCounts] = useState({ dials: 0, connects: 0, meetings: 0 });
  const [ended, setEnded] = useState(false);
  const started = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (ended) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [ended]);
  const list = (meta.lists || []).find(l => l.id === listId);

  const load = useCallback((doneIds) => {
    const qs = new URLSearchParams({ ...(listId ? { list: listId } : {}), ...(view ? { view: JSON.stringify(view) } : {}), done: doneIds.join(",") });
    return apiFetch(`/ops/sales/call/queue?${qs}`).then(d => { setQ(d); setFail(null); }).catch(setFail);
  }, [listId, view]);
  useEffect(() => { load([]); }, [load]);

  const cur = q && q.current;
  const outcome = async (key, meeting = null) => {
    if (!cur) return;
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch("/ops/sales/call/outcome", { method: "POST", body: JSON.stringify({ orgId: cur.orgId, contactId: cur.contactId, outcome: key, notes, phone: cur.phone, listId, meeting }) });
      setCounts(c => ({ dials: c.dials + 1, connects: c.connects + (r.connect ? 1 : 0), meetings: c.meetings + (r.meeting ? 1 : 0) }));
      setMsg(`${cur.contact ? cur.contact.name : cur.org.name}: ${r.says}`);
      // A bad number leaves the organization in the queue, so its other contact comes up.
      const next = key === "bad_number" ? done : [...done, cur.orgId];
      setDone(next); setNotes(""); setBooking(false); setEmailing(false);
      await load(next);
      return r;
    } catch (e) { setMsg(failureWords(e, "That outcome was not logged.")); throw e; }
    finally { setBusy(false); }
  };

  if (ended) return <section style={card} data-sales-call-summary="1">
    <h2 style={h2}>Session ended</h2>
    <p style={{ fontSize: 15 }}><b data-call-dials="1">{counts.dials}</b> dials · <b data-call-connects="1">{counts.connects}</b> connects · <b data-call-meetings="1">{counts.meetings}</b> meetings booked · {clock(now - started.current)} on the phone</p>
    <p style={says}>A dial is any outcome logged here. A connect is Connected – not now, Connected – interested, or Meeting booked.</p>
    <button type="button" style={btn} onClick={onClose}>Back to Sales</button>
  </section>;

  return <div data-sales-call-mode="1">
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
      <button type="button" style={link} onClick={onClose}>← Back</button>
      <b style={{ fontSize: 15, flex: "1 1 auto" }}>Calling{list ? `: ${list.name}` : ""}</b>
      <span style={{ fontSize: 13 }} data-call-timer="1">{clock(now - started.current)}</span>
      <span style={{ fontSize: 13, opacity: 0.8 }}>{counts.dials} dials · {counts.connects} connects · {counts.meetings} meetings</span>
      <button type="button" style={quiet} onClick={() => setEnded(true)} data-call-end="1">End session</button>
    </div>
    {msg ? <p style={{ ...says, opacity: 1 }} data-call-msg="1">{msg}</p> : null}
    {fail ? <section style={card}><Failure e={fail} fallback={failureWords(fail, "The call queue could not be read.")} /></section>
      : !q ? <section style={card}><p style={says}>Loading…</p></section>
      : !cur ? <section style={card} data-call-empty="1"><h2 style={h2}>Nobody left to call</h2>
          <p style={says}>{q.says} {done.length ? `You worked ${done.length} organizations this session.` : ""}</p>
          <button type="button" style={btn} onClick={() => setEnded(true)}>End session</button></section>
      : <section style={{ ...card, padding: 0, overflow: "hidden" }} data-call-entry={cur.orgId} data-call-contact={cur.contactId || ""}>
        <div style={{ background: INK, color: WHITE, padding: "14px 18px" }}>
          <button type="button" style={{ ...link, color: WHITE, fontSize: 18, fontWeight: 700 }} onClick={() => open("org", cur.org.id)}>{cur.org.name}</button>
          <div style={{ fontSize: 13, opacity: 0.85 }}>{[cur.org.city, cur.org.state].filter(Boolean).join(", ")}</div>
          <div style={{ fontSize: 13, marginTop: 4 }} data-call-fit="1">{cur.org.fit.line}{cur.org.fit.misses.length ? <span style={{ opacity: 0.75 }}> · {cur.org.fit.misses.join("; ")}</span> : null}</div>
        </div>
        <div style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 13, opacity: 0.75 }}>{cur.line === "main" ? `Main line${cur.contact ? `: ask for ${cur.contact.name}` : ""}` : "Call"}</div>
          {cur.contact ? <div style={{ fontSize: 17, fontWeight: 700 }} data-call-person="1">
            <button type="button" style={{ ...link, fontSize: 17, color: INK }} onClick={() => open("contact", cur.contact.id)}>{cur.contact.name}</button>
            <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.75 }}> · {cur.contact.title || cur.contact.role || ""}</span></div> : null}
          <a href={`tel:${String(cur.phone).replace(/[^\d+]/g, "")}`} style={{ display: "inline-block", marginTop: 8, fontSize: 22, fontWeight: 700, color: EMERALD, textDecoration: "none", padding: "8px 14px", border: `2px solid ${EMERALD}`, borderRadius: 10 }} data-call-tel="1">{cur.phone}</a>
          {cur.deal ? <div style={{ fontSize: 13, marginTop: 8 }}>Deal: <button type="button" style={link} onClick={() => open("deal", cur.deal.id)}>{cur.deal.name}</button> · {cur.deal.stage_name}</div> : null}
          {cur.openTasks.length ? <div style={{ marginTop: 8 }}>{cur.openTasks.map(t => <div key={t.id} style={{ fontSize: 13 }}><span style={brassTag}>open task</span> {t.body}{t.due_on ? ` · due ${dayWords(t.due_on)}` : ""}</div>)}</div> : null}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.65 }}>Last three</div>
            {cur.recent.length ? cur.recent.map(a => <div key={a.id} style={{ fontSize: 13, padding: "3px 0", borderTop: `1px solid ${CREAM}` }}><span style={{ opacity: 0.7 }}>{whenWords(a.at)} · {a.kind}</span> {a.body}</div>)
              : <div style={{ fontSize: 13, opacity: 0.6 }}>Nothing logged yet.</div>}
          </div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Notes (saved with the outcome)" aria-label="Call notes" style={{ ...box, width: "100%", marginTop: 10 }} data-call-notes="1" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginTop: 10 }}>
            {meta.outcomes.map(o => <button key={o.key} type="button" disabled={busy} data-call-outcome={o.key}
              style={o.meeting ? { ...btn, minHeight: 44 } : { ...quiet, minHeight: 44 }}
              onClick={() => (o.meeting ? setBooking(b => !b) : outcome(o.key))}>{o.label}</button>)}
          </div>
          {booking ? <MeetingForm attendeesHint={cur.contact ? cur.contact.name : ""} onSubmit={m => outcome("meeting_booked", m)} onDone={() => {}} onCancel={() => setBooking(false)} /> : null}
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {cur.contact ? <button type="button" style={quiet} onClick={() => setEmailing(e => !e)} data-call-email="1">Email</button> : null}
            <button type="button" style={quiet} disabled={busy} onClick={() => { setDone(d => [...d, cur.orgId]); load([...done, cur.orgId]); }} data-call-skip="1">Skip for now</button>
          </div>
          {emailing && cur.contact ? <EmailDraft contactId={cur.contact.id} orgId={cur.orgId} dealId={cur.deal ? cur.deal.id : null} onClose={() => setEmailing(false)} /> : null}
        </div>
      </section>}
    {q && q.next && q.next.length ? <section style={card}><div style={{ fontSize: 12, fontWeight: 700, opacity: 0.65 }}>Up next · {q.total} in the queue</div>
      {q.next.map(e => <div key={e.orgId} style={{ fontSize: 13, padding: "3px 0" }}>{e.org.name}{e.contact ? ` · ${e.contact.name}` : ""} <span style={{ opacity: 0.6 }}>{e.org.fit.line}</span></div>)}</section> : null}
  </div>;
}

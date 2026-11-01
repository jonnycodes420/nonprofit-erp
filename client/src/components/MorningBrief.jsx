// client/src/components/MorningBrief.jsx · PERF-2. Home's meetings card, out of
// MeetingPanels.jsx so Home no longer downloads the meeting forms, the
// timeline and the rail to draw it. The form for writing a meeting down
// (AfterMeetingForm) loads when she presses "Write it down". The small pieces
// both files draw (the day words, the meeting's noun, Add to a donor's record
// and the button styles) live here, and MeetingPanels imports them.
//
// No pronoun is ever guessed from a name: the copy says the person's first
// name, or "they".
import { useState, useEffect, lazy, Suspense } from "react";
import { apiFetch } from "../api";
import { T, firstNameOf } from "./shared";
import { errorMessage } from "../lib/domainError";
import { civilDaysAgo } from "../lib/orgToday";
import { retryImport } from "../lib/lazyRetry";

export const DARK_BRASS = T.gold700;      // the artboards' #8A6D1F
export const LABEL = { fontSize: 12, color: T.ink3 };
export const SERIF = "'DM Serif Display',Georgia,serif";
export const btnPrimary = { padding: "12px 18px", minHeight: 44, border: 0, borderRadius: 10, background: T.greenDk, color: T.white,
  font: "600 15px 'DM Sans',sans-serif", cursor: "pointer" };
export const btnOutline = { padding: "12px 18px", minHeight: 44, border: "1.5px solid " + T.ink, borderRadius: 10, background: T.white, color: T.ink,
  font: "600 15px 'DM Sans',sans-serif", cursor: "pointer" };
export const input = { font: "16px 'DM Sans',sans-serif", color: T.ink, border: "1px solid " + T.bg2, borderRadius: 12, padding: 12,
  minHeight: 44, boxSizing: "border-box", width: "100%", background: T.white };
export const MEAL_WORDS = ["coffee", "lunch", "breakfast", "dinner", "tea", "drinks", "call", "visit", "tour"];
export const dayKey = d => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
const AfterMeetingForm = lazy(() => retryImport(() => import("./MeetingPanels")).then(m => ({ default: m.AfterMeetingForm })));

export function relDay(dateLike) {
  if (!dateLike) return "";
  const s = String(dateLike);
  const civil = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = civil ? new Date(s + "T12:00:00") : new Date(s);
  // FIX-14 Part 1 — a civil date is compared with the ORG's today, as civil
  // dates; only an instant is placed on the browser's clock.
  const days = civil ? -civilDaysAgo(s) : Math.round((dayKey(d) - dayKey(Date.now())) / 864e5);
  if (days === 0) return "Today";
  if (days === -1) return "Yesterday";
  if (days === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}
// "How did coffee with Margaret go?" — the meeting's own word when its title
// starts with one, otherwise "your meeting".
export function meetingNoun(title) {
  const w = String(title || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
  if (["call", "visit", "tour"].includes(w)) return "the " + w;
  return MEAL_WORDS.includes(w) ? w : "your meeting";
}

export function AddToRecord({ eventId, candidates = [], onDone, compact = true }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!open || q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => apiFetch(`/search?q=${encodeURIComponent(q.trim())}`)
      .then(r => setFound((r.results || []).filter(x => x.kind === "person").slice(0, 6))).catch(() => setFound([])), 250);
    return () => clearTimeout(t);
  }, [q, open]);
  const pick = async p => {
    setMsg("");
    try { const r = await apiFetch(`/calendar/events/${eventId}/people`, { method: "POST", body: JSON.stringify({ donorId: p.id }) });
      setOpen(false); onDone && onDone(r.sentence || `On ${p.name || p.title}'s record now.`); }
    catch (e) { setMsg(e?.sentence || errorMessage(e, "That did not link.")); }
  };
  const small = { background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, cursor: "pointer", font: "inherit", textDecoration: "underline" };
  if (!open) return <button type="button" data-testid="add-to-record" onClick={() => setOpen(true)} style={compact ? small : btnOutline}>Add to a donor's record</button>;
  return (
    <div data-testid="add-to-record-picker" style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 220 }}>
      {candidates.length > 0 && <div style={{ fontSize: 13, color: T.ink3 }}>The title could be about more than one person. Which one?</div>}
      {candidates.map(c => <button key={c.id} type="button" onClick={() => pick(c)} style={{ ...btnOutline, padding: "8px 12px", minHeight: 36, fontSize: 14, textAlign: "left" }}>{c.name}</button>)}
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Find a person" aria-label="Find a person" style={{ ...input, padding: 8, minHeight: 36 }}/>
      {found.map(f => <button key={f.id} type="button" onClick={() => pick(f)} style={{ ...btnOutline, padding: "8px 12px", minHeight: 36, fontSize: 14, textAlign: "left", border: "1px solid " + T.bg2 }}>{f.title}{f.email ? <span style={{ color: T.ink3 }}> · {f.email}</span> : null}</button>)}
      <button type="button" onClick={() => setOpen(false)} style={{ ...small, color: T.ink3 }}>Not now</button>
      {msg && <div style={{ fontSize: 13, color: T.ink }}>{msg}</div>}
    </div>
  );
}

// ── HOME: TODAY'S MEETINGS, AND THE ONES WAITING FOR A NOTE ────────────────
// HOME-2: `skipMeetingId` is the meeting Home's lead slot already shows in
// full; here it is one line under Today, not a second brief.
export function MorningBrief({ userName, onOpenPerson, compact = false, skipMeetingId = null }) {
  const [today, setToday] = useState(null);
  const [toLog, setToLog] = useState(null);
  const [done, setDone] = useState("");
  const [logging, setLogging] = useState(null);
  const load = () => {
    apiFetch("/calendar/today").then(setToday).catch(() => setToday({ meetings: [] }));
    apiFetch("/calendar/to-log").then(r => setToLog(r.meetings || [])).catch(() => setToLog([]));
  };
  useEffect(() => { load(); }, []);
  if (!today || !toLog) return null;
  const upcoming = today.meetings.filter(m => new Date(m.endsAt).getTime() > Date.now());
  const lead = upcoming.find(m => m.brief && m.id !== skipMeetingId) || null;
  const rest = today.meetings.filter(m => m !== lead && new Date(m.endsAt).getTime() > Date.now());
  if (!lead && !rest.length && !toLog.length && !done) return null;
  const inLabel = iso => {
    const mins = Math.round((new Date(iso) - Date.now()) / 60000);
    if (mins <= 0) return "Now";
    const h = Math.floor(mins / 60), m = mins % 60;
    return `In ${h ? `${h} hr ` : ""}${m ? `${m} min` : ""}`.trim();
  };
  const b = lead?.brief;
  const first = firstNameOf(lead?.people?.[0]?.name) || "them";
  return (
    <div data-testid="morning-brief" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {done && <div role="status" style={{ background: T.white, borderRadius: 14, padding: "12px 16px", fontSize: 14 }}>{done}</div>}
      {toLog.slice(0, 1).map(m => logging === m.id
        ? <Suspense key={m.id} fallback={null}><AfterMeetingForm meeting={m} onDone={s => { setDone(s); setLogging(null); load(); }}/></Suspense>
        : <div key={m.id} data-testid="after-prompt" style={compact
            ? { background: T.ground, border: "1px solid " + T.bg2, borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }
            : { background: T.white, borderRadius: 20, padding: "18px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: compact ? 10.5 : 12, color: DARK_BRASS, fontWeight: 600 }}>{relDay(m.startsAt)} · {m.title}</div>
              <div style={{ fontFamily: SERIF, fontSize: compact ? 19 : 24, lineHeight: 1.2, marginTop: 4 }}>How did {meetingNoun(m.title)} with {firstNameOf(m.people?.[0]?.name) || "them"} go?</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setLogging(m.id)} style={compact ? { ...btnPrimary, padding: "8px 14px", fontSize: 13.5 } : btnPrimary}>Write it down</button>
              <button type="button" onClick={() => apiFetch(`/calendar/events/${m.id}/dismiss`, { method: "POST", body: "{}" }).then(load)} style={{ ...btnOutline, border: "1px solid " + T.bg2 }}>Not now</button>
            </div>
          </div>)}
      {lead && (
        <section data-testid="today-meeting" style={{ background: T.ink, color: T.inkInverse, borderRadius: 20, padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 12, color: T.gold }}>{inLabel(lead.startsAt)}{lead.location ? ` · ${lead.location}` : ""}</div>
          <div style={{ fontFamily: SERIF, fontSize: 28, lineHeight: 1.15 }}>{lead.title}{lead.people?.[0] && !lead.title.includes(lead.people[0].name) ? ` with ${lead.people[0].name}` : ""}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 15, lineHeight: 1.45 }}>
            {b?.giving && <div><span style={{ opacity: 0.6 }}>Gave</span> {b.giving.text}</div>}
            {b?.openAsk && <div><span style={{ opacity: 0.6 }}>Ask open</span> {b.openAsk.text}</div>}
            {b?.lastTime && <div><span style={{ opacity: 0.6 }}>Bring up</span> {b.lastTime.text}</div>}
            {b?.unthanked && <div><span style={{ opacity: 0.6 }}>Owe {first}</span> a thank-you for the {relDay(b.unthanked.date)} gift</div>}
          </div>
          {lead.people?.[0] && onOpenPerson && <button type="button" onClick={() => onOpenPerson(lead.people[0].id)}
            style={{ marginTop: 4, padding: 14, minHeight: 48, border: 0, borderRadius: 12, background: T.inkInverse, color: T.ink, font: "600 15px 'DM Sans',sans-serif", cursor: "pointer" }}>Open {first}'s full profile</button>}
        </section>
      )}
      {rest.length > 0 && (
        <section style={{ background: T.white, borderRadius: 20, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={LABEL}>{lead ? "Also today" : "Today"}</div>
          {rest.map((m, i) => <div key={m.id}>
            {i > 0 && <div style={{ height: 1, background: T.bg2, marginBottom: 12 }}/>}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 15 }}>
              <span><b style={{ fontWeight: 600 }}>{new Date(m.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/ [AP]M$/, "")}</b> {m.title}</span>
              {!m.people?.length
                ? <AddToRecord eventId={m.id} candidates={m.candidates || []} onDone={s => { setDone(s); load(); }}/>
                : m.people?.length === 1 && onOpenPerson
                ? <button type="button" onClick={() => onOpenPerson(m.people[0].id)} style={{ background: "none", border: "none", color: T.ink3, cursor: "pointer", font: "inherit" }}>Brief</button>
                : <span style={{ color: T.ink3 }}>{m.people?.length || 0} {m.people?.length === 1 ? "person" : "people"}</span>}
            </div>
          </div>)}
        </section>
      )}
      {(lead || rest.length > 0) && <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.5, padding: "0 4px" }}>{today.sentence}</div>}
    </div>
  );
}

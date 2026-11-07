// client/src/components/ThreadMenus.jsx · PERF-2. The Thread's two small row
// controls, out of LogConversation.jsx so Home draws its rows without
// downloading the log-a-conversation form: the dismiss menu ("…", "Not
// today") and Put it on my calendar. Moved verbatim (BUILD-81, BUILD-94).
import { useEffect, useRef, useState } from "react";
import { apiFetch, API, getToken } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";
import { DISMISS_REASONS, addCivilDays } from "../../../shared/threadShape";
import { displayDate } from "../../../shared/displayDate";
import { NavIcon } from "./NavIcon";
import { orgTodayCivil } from "../lib/orgToday";
import DateInput from "./inputs/DateInput";   // POLISH-6: the one date box

// FIX-14 Part 1 — the ORG's today (as in LogConversation.jsx).
const todayLocal = () => orgTodayCivil();

// The dismiss control for an open thread — the short fixed list, nothing
// else. "Revisit" asks for the date; it is a snooze, and the thread comes
// back on that day.
// FIX-8 Part E — `label` draws the trigger as a named button ("Not today")
// rather than the quiet "…", for the one place on Home where this menu IS the
// third action rather than a row's overflow. What it opens is unchanged.
// POLISH-3 · `extra` puts the record's own verbs (Edit, Delete) at the top of
// the same menu, and `footer` its "Edited by" line, so a row carries one "…"
// rather than a menu plus a row of underlined words.
export function ThreadDismissMenu({ thread, onDone, label, extra, footer }) {
  const [open, setOpen] = useState(false);
  const [revisitOpen, setRevisitOpen] = useState(false);
  const [revisitOn, setRevisitOn] = useState(addCivilDays(todayLocal(), 30));
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setRevisitOpen(false); } };
    const esc = e => { if (e.key === "Escape") { setOpen(false); setRevisitOpen(false); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const dismiss = async (reason, on) => {
    if (busy) return; setBusy(true);
    try {
      await apiFetch(`/threads/${thread.id}/dismiss`, { method: "POST", body: JSON.stringify(reason === "revisit" ? { reason, revisitOn: on } : { reason }) });
      setOpen(false); setRevisitOpen(false);
      onDone && onDone();
    } catch { /* leave the menu; nothing changed */ }
    setBusy(false);
  };

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      {/* BUILD-88d — ONE ACTION PER ROW. Dismiss was a second bordered button
          beside the emerald verb, so every row offered two things at equal
          weight and the eye had to choose before it had read the name. It is a
          quiet overflow menu now; what it opens is unchanged. */}
      <button onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
        aria-label={label ? label + " for " + (thread?.donorName || "this follow-up")
                          : "More actions for " + (thread?.donorName || "this follow-up")}
        title={label || "More"}
        style={label
          ? { background: T.white, border: "1.5px solid " + T.bg3, borderRadius: 9, padding: "8px 14px", color: T.ink2, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }
          : { background: "transparent", border: "none", borderRadius: 7, padding: "6px 8px", color: T.ink3, fontSize: 16, lineHeight: 1, fontWeight: 700, cursor: "pointer", minWidth: 32 }}>
        {label ? label : <span aria-hidden>{"\u2026"}</span>}
      </button>
      {open && (
        <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, boxShadow: "0 8px 28px rgba(15,26,18,0.14)", padding: 6, zIndex: 50, minWidth: 220 }}>
          {extra && extra.length > 0 && <>
            {extra.map(x => (
              <button key={x.label} type="button" role="menuitem" data-testid={x.testid} onClick={() => { setOpen(false); x.onClick(); }}
                style={{ background: "transparent", border: "none", padding: "8px 12px", width: "100%", textAlign: "left", color: T.ink, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                {x.label}
              </button>
            ))}
            <div style={{ borderTop: "1px solid " + T.bg2, margin: "4px 6px" }} />
          </>}
          {DISMISS_REASONS.map(r => r.key === "revisit" ? (
            <div key={r.key} style={{ padding: "4px 6px" }}>
              {!revisitOpen ? (
                <button onClick={() => setRevisitOpen(true)} style={{ background: "transparent", border: "none", padding: "6px 6px", width: "100%", textAlign: "left", color: T.ink, fontSize: 12.5, cursor: "pointer" }}>
                  Not now, revisit on a date…
                </button>
              ) : (
                <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "2px 6px" }}>
                  <DateInput value={revisitOn} onChange={e => setRevisitOn(e.target.value)}
                    style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 7, padding: "6px 8px", color: T.ink, fontSize: 12 }} />
                  <button onClick={() => dismiss("revisit", revisitOn)} disabled={busy}
                    style={{ background: T.greenDk, border: "none", borderRadius: 7, padding: "7px 10px", color: T.white, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Snooze</button>
                </div>
              )}
            </div>
          ) : (
            <button key={r.key} onClick={() => dismiss(r.key)} disabled={busy}
              style={{ background: "transparent", border: "none", padding: "8px 12px", width: "100%", textAlign: "left", color: T.ink, fontSize: 12.5, cursor: "pointer" }}>
              {r.label}
            </button>
          ))}
          {footer && <div style={{ borderTop: "1px solid " + T.bg2, margin: "4px 6px 0", padding: "6px 6px 2px" }}>{footer}</div>}
        </div>
      )}
    </span>
  );
}

// ── BUILD-94 Part 5 — PUT IT ON MY CALENDAR ────────────────────────────────
// Three outputs for one next step: Outlook, Google, or a .ics file. Nothing is
// written to anybody's calendar by Steward and nothing comes back — the
// sentence saying so ships inside the menu, because a button reading "put it
// on my calendar" is otherwise read as sync and the disappointment arrives
// three weeks later when a moved meeting did not move here.
export function PutItOnMyCalendar({ threadId, compact = false }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (!open || data) return;
    apiFetch(`/threads/${threadId}/calendar`)
      .then(setData)
      .catch(e => setErr(errorMessage(e, "Could not build a calendar entry for this")));
  }, [open, threadId, data]);

  useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // The .ics is fetched with the auth header and handed over as a blob — a
  // bare <a href> would hit the API without a token and download a 401.
  const downloadIcs = async () => {
    try {
      const r = await fetch(`${API}/threads/${threadId}/calendar.ics`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!r.ok) throw new Error("Could not build the file");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = ((data && data.subject) || "task").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase() + ".ics";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setOpen(false);
    } catch (e) { setErr(errorMessage(e, "Could not build the file")); }
  };

  const item = {
    display: "block", width: "100%", textAlign: "left", background: "none", border: "none",
    padding: "9px 14px", fontSize: 13, color: T.ink, cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap",
  };

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button type="button" onClick={() => setOpen(v => !v)} data-testid="put-on-calendar"
        title="Open your calendar with this filled in" aria-label={compact ? "Calendar" : undefined}
        style={compact
          ? { background: "none", border: "none", padding: "4px 6px", fontSize: 12, color: T.ink3, cursor: "pointer", display: "inline-flex", alignItems: "center" }
          : { background: T.bg, border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "8px 12px",
              fontSize: 12, fontWeight: 600, color: T.ink2, cursor: "pointer", whiteSpace: "nowrap",
              display: "inline-flex", alignItems: "center", gap: 6 }}>
        {/* FIX-13 Part 5 — the NAV-1 calendar, not the ◫ text glyph. */}
        <NavIcon id="events" size={compact ? 16 : 15} />{compact ? null : "Calendar"}
      </button>
      {open && (
        <div data-testid="calendar-menu" style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 60, minWidth: 250,
          background: T.white, border: `1px solid ${T.bg3}`, borderRadius: 12, boxShadow: T.shadowMd,
          padding: "6px 0", overflow: "hidden",
        }}>
          {err && <div role="alert" style={{ padding: "9px 14px", fontSize: 12, color: T.gold700 }}>{err}</div>}
          {!data && !err && <div style={{ padding: "9px 14px", fontSize: 12.5, color: T.ink3 }}>Building it…</div>}
          {data && (
            <>
              <div style={{ padding: "6px 14px 8px", fontSize: 12, color: T.ink3, lineHeight: 1.5, whiteSpace: "normal", maxWidth: 260 }}>
                <strong style={{ color: T.ink }}>{data.subject}</strong>
                <div style={{ marginTop: 2 }}>
                  {data.allDay
                    ? `${displayDate(data.dueDate)} · all day`
                    : new Date(data.startsAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </div>
              </div>
              <a href={data.outlook} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} style={item}>Outlook</a>
              <a href={data.google} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} style={item}>Google Calendar</a>
              <button type="button" onClick={downloadIcs} style={item} data-testid="calendar-ics">Download a .ics file</button>
              {/* THE SENTENCE. It is not fine print — it is the difference
                  between a useful shortcut and a broken promise of sync. */}
              <div style={{ padding: "8px 14px 6px", marginTop: 4, borderTop: `1px solid ${T.bg2}`,
                            fontSize: 11, color: T.ink3, lineHeight: 1.5, whiteSpace: "normal", maxWidth: 260 }}>
                {data.note}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

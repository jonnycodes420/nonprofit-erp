// BUILD-81 — the Thread's write surface: log a conversation, and the next
// step comes back in the SAME flow. One line, a default date by touch type
// (shared/threadShape.js — the ONE defaults table both sides read), and a
// Skip that is recorded as skipped, never as nothing. Nothing here asks the
// user to create a task; logging the conversation IS creating the follow-up.
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import {
  TOUCH_TYPES, DISMISS_REASONS, NEXT_STEP_LABEL_MAX,
  nextStepSuggestion, addCivilDays, nextStepTypeForLabel, sanitizeStepLabel,
} from "../../../shared/threadShape";

const touchTypeLabel = k => (TOUCH_TYPES.find(t => t.key === k)?.label || "touch type");

const todayLocal = () => new Date().toISOString().split("T")[0];

export function LogConversationModal({ donor, thread = null, onSaved, onClose }) {
  const [touch, setTouch] = useState("call_reached");
  const [line, setLine] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [nsLabel, setNsLabel] = useState("Follow up");
  const [nsDue, setNsDue] = useState(addCivilDays(todayLocal(), 7));
  const [nsDirty, setNsDirty] = useState(false);
  const [nsSource, setNsSource] = useState(null);   // which rule proposed this
  const [ignoreNote, setIgnoreNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const lineRef = useRef(null);
  useEffect(() => { lineRef.current?.focus(); }, []);

  // The prompt is a decision, not a guess: it prefills from the note when the
  // note names an ask or a promise, and from the defaults table for the chosen
  // touch otherwise — or, when this conversation closes a thread that carries a
  // follow-on (the meeting/visit chain), from that follow-on. A user's own edit
  // sticks until they change the touch type again.
  useEffect(() => {
    if (nsDirty) return;
    if (thread?.followon) {
      setNsLabel(thread.followon.label); setNsDue(thread.followon.due);
      setNsSource({ from: "touch", why: "From the plan you set" });
      return;
    }
    const s = nextStepSuggestion(touch, todayLocal(), ignoreNote ? "" : line);
    if (s) { setNsLabel(s.label); setNsDue(s.due); setNsSource(s.source || null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touch, thread, line, ignoreNote]);

  const save = async (skipped) => {
    if (busy) return;
    if (!line.trim()) { setErr("Write the one line first. What happened?"); return; }
    if (!skipped && !sanitizeStepLabel(nsLabel)) { setErr("Say what the next step is, or skip it."); return; }
    setBusy(true); setErr("");
    try {
      const r = await apiFetch(`/donors/${donor.id}/conversations`, {
        method: "POST",
        body: JSON.stringify({
          touch, line: line.trim(), date,
          nextStep: skipped ? { skipped: true }
            : { type: nextStepTypeForLabel(nsLabel), label: sanitizeStepLabel(nsLabel), due: nsDue,
                source: nsSource?.from || null },
        }),
      });
      onSaved && onSaved({ ...r, touch, line: line.trim(), date });
      onClose && onClose();
    } catch (e) {
      setErr(e?.message || "That didn't save. Try again.");
      setBusy(false);
    }
  };

  const inp = { width: "100%", background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "10px 12px", color: T.ink, fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box" };
  const lbl = { fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5, display: "block" };

  return (
    <div className="modal-sheet-overlay" style={{ position: "fixed", inset: 0, background: "#0f1a12cc", backdropFilter: "blur(4px)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onKeyDown={e => { if (e.key === "Escape") onClose && onClose(); }}>
      <div className="fade-in modal-sheet-inner" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 18, width: "100%", maxWidth: 460, maxHeight: "92vh", overflowY: "auto", padding: 24, boxShadow: "0 4px 32px rgba(15,15,15,0.12)" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: T.ink, marginBottom: 2 }}>Log a conversation</div>
        <div style={{ fontSize: 12, color: T.ink3, marginBottom: 14 }}>{donor.name}</div>

        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
          {TOUCH_TYPES.map(t => (
            <button key={t.key} onClick={() => { setTouch(t.key); }}
              style={{ background: touch === t.key ? T.greenDk : T.bg2, border: "1px solid " + (touch === t.key ? T.greenDk : T.bg3), borderRadius: 7, padding: "5px 12px", color: touch === t.key ? T.white : T.ink3, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 12 }}>
          <span style={lbl}>What happened?</span>
          <input ref={lineRef} value={line} onChange={e => setLine(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && line.trim()) save(false); }}
            placeholder="One line. She asked for the impact report." style={inp} />
        </div>
        <div style={{ marginBottom: 16, maxWidth: 180 }}>
          <span style={lbl}>When</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
        </div>

        <div style={{ borderTop: "1px solid " + T.bg3, paddingTop: 14, marginBottom: 16 }}>
          <span style={lbl}>Next step</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={nsLabel} maxLength={NEXT_STEP_LABEL_MAX}
              onChange={e => { setNsLabel(e.target.value); setNsDirty(true); }}
              placeholder="What happens next?" aria-label="Next step"
              style={{ ...inp, width: "auto", flex: "1 1 200px" }} />
            <input type="date" value={nsDue} onChange={e => { setNsDue(e.target.value); setNsDirty(true); }}
              aria-label="Next step due date" style={{ ...inp, width: "auto", flex: "0 1 150px" }} />
          </div>
          {/* Which rule proposed this. A wrong guess has to be visible before
              it can be corrected — and switching back is one click. */}
          {nsSource && !nsDirty && (
            <div style={{ fontSize: 11, color: T.ink3, marginTop: 6, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="ns-source">
                {nsSource.why}{nsSource.matched ? <span style={{ fontStyle: "italic" }}>{" — \u201c" + nsSource.matched + "\u201d"}</span> : null}
              </span>
              {nsSource.from === "note" && (
                <button type="button" onClick={() => setIgnoreNote(true)}
                  style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 11, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>
                  Use the {touchTypeLabel(touch)} default instead
                </button>
              )}
              {nsSource.from === "touch" && ignoreNote && (
                <button type="button" onClick={() => setIgnoreNote(false)}
                  style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 11, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>
                  Read my note again
                </button>
              )}
            </div>
          )}
          <div style={{ fontSize: 11, color: T.ink3, marginTop: 6, lineHeight: 1.5 }}>
            This comes back to find you when it is due. Skipping is recorded as skipped.
          </div>
        </div>

        {err && <div style={{ fontSize: 12, color: T.terracotta, marginBottom: 10 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => save(false)} disabled={busy}
            style={{ background: T.gold500, border: "none", borderRadius: 8, padding: "10px 18px", color: T.ink, fontSize: 13, fontWeight: 800, cursor: busy ? "wait" : "pointer" }}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button onClick={() => save(true)} disabled={busy}
            style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 8, padding: "10px 14px", color: T.ink3, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
            Skip the next step
          </button>
          <span style={{ flexGrow: 1 }} />
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: T.ink3, fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// The dismiss control for an open thread — the short fixed list, nothing
// else. "Revisit" asks for the date; it is a snooze, and the thread comes
// back on that day.
export function ThreadDismissMenu({ thread, onDone }) {
  const [open, setOpen] = useState(false);
  const [revisitOpen, setRevisitOpen] = useState(false);
  const [revisitOn, setRevisitOn] = useState(addCivilDays(todayLocal(), 30));
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setRevisitOpen(false); } };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
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
      <button onClick={() => setOpen(o => !o)}
        style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 7, padding: "6px 10px", color: T.ink3, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
        Dismiss
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, boxShadow: "0 8px 28px rgba(15,26,18,0.14)", padding: 6, zIndex: 50, minWidth: 220 }}>
          {DISMISS_REASONS.map(r => r.key === "revisit" ? (
            <div key={r.key} style={{ padding: "4px 6px" }}>
              {!revisitOpen ? (
                <button onClick={() => setRevisitOpen(true)} style={{ background: "transparent", border: "none", padding: "6px 6px", width: "100%", textAlign: "left", color: T.ink, fontSize: 12.5, cursor: "pointer" }}>
                  Not now, revisit on a date…
                </button>
              ) : (
                <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "2px 6px" }}>
                  <input type="date" value={revisitOn} onChange={e => setRevisitOn(e.target.value)}
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
        </div>
      )}
    </span>
  );
}

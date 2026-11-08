// BUILD-81 — the Thread's write surface: log a conversation, and the next
// step comes back in the SAME flow. One line, a default date by touch type
// (shared/threadShape.js — the ONE defaults table both sides read), and a
// Skip that is recorded as skipped, never as nothing. Nothing here asks the
// user to create a task; logging the conversation IS creating the follow-up.
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import { T, activeMark, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";
import {
  TOUCH_TYPES, NEXT_STEP_LABEL_MAX,
  nextStepSuggestion, addCivilDays, nextStepTypeForLabel, sanitizeStepLabel, NOTE_ONLY_PLUS_DAYS,
  sanitizeStepTime, formatStepTime,
} from "../../../shared/threadShape";
import { TASK_OUTCOMES } from "../../../shared/taskShape.js";
import { orgTodayCivil } from "../lib/orgToday";
import { AttachFileField, uploadAttachment } from "./ProfileTimelineParts";
import DateInput from "./inputs/LazyDateInput";   // POLISH-6: the one date box, loaded when first shown
// PERF-2: the Thread's row menus live in ThreadMenus.jsx; still importable from here.
export { ThreadDismissMenu, PutItOnMyCalendar } from "./ThreadMenus";

const touchTypeLabel = k => (TOUCH_TYPES.find(t => t.key === k)?.label || "touch type");

// FIX-14 Part 1 — the ORG's today. This was `toISOString()`, the UTC day, so a
// conversation logged after 8pm in New York defaulted to tomorrow.
const todayLocal = () => orgTodayCivil();

export function LogConversationModal({ donor, thread = null, onSaved, onClose, org = null, onNavigate = null, editing = null, initialTouch = null }) {
  // FIX-14 Part 2 — editing opens this same form, filled in: the touch, the
  // line and the day. The next step and any gift are their own records and
  // are changed where they live, so editing shows neither.
  const editTouch = editing ? (() => { try { const m = typeof editing.metadata === "string" ? JSON.parse(editing.metadata || "{}") : (editing.metadata || {}); return m.touch || null; } catch { return null; } })() : null;
  const [touch, setTouch] = useState(editTouch || (editing ? (TOUCH_TYPES.find(t => t.interactionType === editing.type)?.key || "note_only") : (initialTouch || "call_reached")));   // PROFILE-2: the header's Note opens it as a note
  const [line, setLine] = useState(editing ? String(editing.note || "") : "");
  // FIX-14 Part 1: where, for a meeting or a visit (filled in when editing)
  const [place, setPlace] = useState(editing ? (() => { try { const m = typeof editing.metadata === "string" ? JSON.parse(editing.metadata || "{}") : (editing.metadata || {}); return m.location || ""; } catch { return ""; } })() : "");
  const [date, setDate] = useState(editing ? String(editing.date || "").slice(0, 10) : todayLocal());
  const [wasTalk, setWasTalk] = useState(false);   // COUNTS-1: a note marked as a conversation is a contact
  const [nsLabel, setNsLabel] = useState("Follow up");
  const [nsDue, setNsDue] = useState(addCivilDays(todayLocal(), 5));
  // BUILD-84 — the OPTIONAL time. Empty is the whole existing behaviour:
  // the step stays date-only, rides the morning digest, and sends nothing of
  // its own. Setting one swaps the reminder from "in the morning list" to "at
  // that moment", and the sentence below says exactly that.
  const [nsTime, setNsTime] = useState("");
  const [nsDirty, setNsDirty] = useState(false);
  const [nsSource, setNsSource] = useState(null);   // which rule proposed this
  const [ignoreNote, setIgnoreNote] = useState(false);
  // BUILD-88a A.1 — the optional amount. A gift mentioned in a conversation is
  // a GIFT: it is written as a gift row through the one server function, with
  // its fund and method inline rather than left for a second screen. Blank is
  // the whole existing behaviour.
  const [amount, setAmount] = useState("");
  const [fundId, setFundId] = useState("");
  const [method, setMethod] = useState("");
  const [funds, setFunds] = useState([]);
  const [outcome, setOutcome] = useState("");   // JOURNEYS-4: how a call or meeting ended, optional
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // PARITY-1 Part B — an optional file, attached once the entry has an id.
  const [file, setFile] = useState(null);
  const lineRef = useRef(null);
  useEffect(() => { lineRef.current?.focus(); }, []);
  useEffect(() => {
    let alive = true;
    apiFetch("/finance/funds")
      .then(r => { if (alive) setFunds(Array.isArray(r) ? r : []); })
      .catch(() => { if (alive) setFunds([]); });
    return () => { alive = false; };
  }, []);
  // The org's unrestricted fund is the default, and it is NAMED rather than
  // implied — "General Operating" beats an empty select every time. The SERVER
  // says which one it is (`isOrgDefault`): picking "the first unrestricted
  // fund" out of a name-sorted list offered a different fund from the one the
  // write used, which the BUILD-88a walk caught on the demo org.
  const defaultFund = funds.find(f => f.isOrgDefault) || funds.find(f => !f.restricted) || null;
  const amountTyped = String(amount).trim() !== "";

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
    if (s) { setNsLabel(s.label); setNsDue(s.due); setNsSource(s.source || null); return; }
    // No default for this touch (a note with no touch). Steward proposes
    // nothing and asks — the date is workable, the step is the user's.
    setNsLabel("");
    setNsDue(addCivilDays(todayLocal(), NOTE_ONLY_PLUS_DAYS));
    setNsSource({ from: "none", why: "A note on its own gets no automatic step. Say what happens next, or skip it." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touch, thread, line, ignoreNote]);

  const save = async (skipped) => {
    if (busy) return;
    if (!line.trim()) { setErr("Write the one line first. What happened?"); return; }
    if (editing) {
      setBusy(true); setErr("");
      try {
        const type = TOUCH_TYPES.find(t => t.key === touch)?.interactionType || editing.type;
        const row = await apiFetch(`/interactions/${editing.id}`, { method: "PUT", body: JSON.stringify({ type, note: line.trim(), date, ...((touch === "meeting" || touch === "visit") ? { metadata: { location: place.trim() } } : {}) }) });
        onSaved && onSaved(row);
        onClose && onClose();
      } catch (e) { setErr(errorMessage(e, "That edit did not save. Try again.")); setBusy(false); }
      return;
    }
    if (!skipped && !sanitizeStepLabel(nsLabel)) { setErr("Say what the next step is, or skip it."); return; }
    setBusy(true); setErr("");
    try {
      const r = await apiFetch(`/donors/${donor.id}/conversations`, {
        method: "POST",
        body: JSON.stringify({
          touch, line: line.trim(), date, ...(touch === "note_only" && wasTalk ? { conversation: true } : {}),
          ...((touch === "meeting" || touch === "visit") && place.trim() ? { place: place.trim() } : {}),
          ...(outcome && ["call_reached", "call_no_answer", "meeting", "visit"].includes(touch) ? { outcome } : {}),
          ...(amountTyped ? { gift: { amount: String(amount).trim(),
                                      fundId: fundId || (defaultFund ? defaultFund.id : null),
                                      paymentMethod: method || undefined } } : {}),
          ...(thread && thread.id ? { threadId: thread.id } : {}),   // SENDS-1: kept for the record; a skip closes nothing (server/tasks/logClose.js)
          nextStep: skipped ? { skipped: true }
            : { type: nextStepTypeForLabel(nsLabel), label: sanitizeStepLabel(nsLabel), due: nsDue,
                time: sanitizeStepTime(nsTime) || undefined,
                source: nsSource?.from || null },
        }),
      });
      if (file && r && r.interactionId) {
        try { await uploadAttachment(r.interactionId, file); }
        catch (x) { window.alert("The conversation is saved. The file did not attach: " + errorMessage(x, "try Attach a file on the entry.")); }
      }
      onSaved && onSaved({ ...r, touch, line: line.trim(), date, place: place.trim() || null });
      onClose && onClose();
    } catch (e) {
      setErr(errorMessage(e, "That didn't save. Try again."));
      setBusy(false);
    }
  };

  // Whether this org has a timezone a HUMAN chose (orgs.timezone_confirmed_at)
  // — the gate on offering a time at all.
  const tzKnown = !!(org && (org.timezone_confirmed_at || org.timezoneConfirmedAt));

  const inp = { width: "100%", background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "10px 12px", color: T.ink, fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box" };
  const lbl = { fontSize: 11, fontWeight: 700, color: T.ink3, marginBottom: 5, display: "block" };

  return (
    <Modal onClose={onClose} width={460} zIndex={300} padding={24}
      ariaLabel="Log a call" dialogStyle={{ border: "1px solid " + T.bg3 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 800, color: T.ink, marginBottom: 2 }}>{editing ? "Edit this conversation" : "Log a call"}</div>
        <div style={{ fontSize: 12, color: T.ink3, marginBottom: 14 }}>{donor.name}</div>

        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
          {TOUCH_TYPES.filter(t => !editing || t.key !== "gift").map(t => (
            <button key={t.key} aria-pressed={touch === t.key} onClick={() => { setTouch(t.key); }}
              style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 7, padding: "5px 12px", color: T.ink3, fontSize: 12, fontWeight: 600, cursor: "pointer", ...activeMark(touch === t.key, "bottom") }}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 12 }}>
          <span style={lbl}>What happened?</span>
          {/* FIX-14 Part 1 — a textarea, so a note's own lines survive: an
              <input> folded "Location:", "Next Step:" and the rest into one
              unreadable paragraph. Cmd or Ctrl and Enter still saves. */}
          <textarea ref={lineRef} value={line} onChange={e => setLine(e.target.value)} rows={3}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && line.trim()) save(false); }}
            placeholder="e.g. She asked for the impact report." data-testid="conv-line"
            style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} />
        </div>
        {!editing && ["call_reached", "meeting", "visit"].includes(touch) && (
          <div style={{ marginBottom: 12 }}>
            <span style={lbl}>How did it end? (optional)</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {TASK_OUTCOMES.filter(o => o.key !== "no_answer").map(o => (
                <button key={o.key} type="button" aria-pressed={outcome === o.key} data-testid={"conv-outcome-" + o.key}
                  onClick={() => setOutcome(outcome === o.key ? "" : o.key)}
                  style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 7, padding: "5px 12px", color: T.ink3, fontSize: 12, fontWeight: 600, cursor: "pointer", ...activeMark(outcome === o.key, "bottom") }}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {touch === "note_only" && !editing && (
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, fontSize: 13, color: T.ink }}>
            <input type="checkbox" checked={wasTalk} onChange={e => setWasTalk(e.target.checked)} data-testid="conv-note-was-talk" />
            This was a conversation (it counts as their last contact)
          </label>
        )}
        {(touch === "meeting" || touch === "visit") && (
          <div style={{ marginBottom: 12 }}>
            <span style={lbl}>Where (optional)</span>
            <input value={place} onChange={e => setPlace(e.target.value)} maxLength={200}
              aria-label="Where" data-testid="conv-place" placeholder="Starbucks on Main Street" style={inp} />
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "0 1 170px" }}>
            <span style={lbl}>When</span>
            <DateInput value={date} onChange={e => setDate(e.target.value)} style={inp} />
          </div>
          {!editing && <div style={{ flex: "0 1 150px" }}>
            <span style={lbl}>Gift (optional)</span>
            <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal"
              aria-label="Gift amount" data-testid="conv-gift-amount"
              placeholder="e.g. 250" style={inp} />
          </div>}
        </div>
        {/* Fund and method are INLINE, revealed by the amount — a gift with no
            fund and no method is the thing A.7 spent a build fixing, and the
            one screen most likely to record a gift should not create more. */}
        {amountTyped && (
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }} data-testid="conv-gift-detail">
            <div style={{ flex: "1 1 180px" }}>
              <span style={lbl}>Fund</span>
              <select value={fundId} onChange={e => setFundId(e.target.value)} aria-label="Fund" style={inp}>
                <option value="">{defaultFund ? defaultFund.name : "Unrestricted"}</option>
                {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 150px" }}>
              <span style={lbl}>How it arrived</span>
              <select value={method} onChange={e => setMethod(e.target.value)} aria-label="Payment method" style={inp}>
                <option value="">Needs you</option>
                {["Check", "Cash", "Card", "ACH", "Wire", "Stock", "DAF", "Online"].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
        )}

        {!editing && <div style={{ borderTop: "1px solid " + T.bg3, paddingTop: 14, marginBottom: 16 }}>
          <span style={lbl}>Next step</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={nsLabel} maxLength={NEXT_STEP_LABEL_MAX}
              onChange={e => { setNsLabel(e.target.value); setNsDirty(true); }}
              placeholder="What happens next?" aria-label="Next step"
              style={{ ...inp, width: "auto", flex: "1 1 200px" }} />
            <DateInput value={nsDue} onChange={e => { setNsDue(e.target.value); setNsDirty(true); }}
              aria-label="Next step due date" style={{ ...inp, width: "auto", flex: "0 1 150px" }} />
            {/* An org still on Steward's default timezone cannot set a time —
                a 2:00 reminder does not forgive being an hour off, and the
                form says why rather than firing at a guessed hour. */}
            {tzKnown
              ? <input type="time" value={nsTime} onChange={e => { setNsTime(e.target.value); setNsDirty(true); }}
                  aria-label="Next step time (optional)" style={{ ...inp, width: "auto", flex: "0 1 116px" }} />
              : null}
          </div>
          {/* Which rule proposed this. A wrong guess has to be visible before
              it can be corrected — and switching back is one click. */}
          {nsSource && !nsDirty && (
            <div style={{ fontSize: 11, color: T.ink3, marginTop: 6, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="ns-source">
                {nsSource.why}{nsSource.matched ? <span style={{ fontStyle: "italic" }}>{": \u201c" + nsSource.matched + "\u201d"}</span> : null}
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
            {!tzKnown
              ? <>We'll remind you in your morning email when it's due. To have it email you at a specific time, set your organization&rsquo;s time zone first. Steward will not fire a reminder at a guessed hour.
                  {onNavigate && <>{" "}
                    {/* FIX (2026-09-10) — refusing an action and then leaving
                        the user to hunt for the fix is half a fix. This lands
                        ON the Time Zone card, which rings itself. */}
                    <button type="button" onClick={() => { onClose && onClose(); onNavigate("settings", { section: "giving", focus: "timezone" }); }}
                      style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 11, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>
                      Set your time zone
                    </button>
                  </>}</>
              : sanitizeStepTime(nsTime)
                ? <>One email at {formatStepTime(nsTime)} that day, with this donor and a button to log what happened, instead of the morning list. It fires on a weekend too.</>
                : <>We'll remind you in your morning email when it's due. (Or sooner: add a time and it emails you at that moment.) Skipping is recorded as skipped.</>}
          </div>
        </div>}

        {!editing && <AttachFileField file={file} setFile={setFile} labelStyle={lbl}/>}
        {err && <div style={{ fontSize: 12, color: T.terracotta, marginBottom: 10 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => save(false)} disabled={busy}
            style={{ background: T.gold500, border: "none", borderRadius: 8, padding: "10px 18px", color: T.ink, fontSize: 13, fontWeight: 800, cursor: busy ? "wait" : "pointer" }}>
            {busy ? "Saving…" : "Save"}
          </button>
          {!editing && <button onClick={() => save(true)} disabled={busy}
            style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 8, padding: "10px 14px", color: T.ink3, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
            Skip the next step
          </button>}
          <span style={{ flexGrow: 1 }} />
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: T.ink3, fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

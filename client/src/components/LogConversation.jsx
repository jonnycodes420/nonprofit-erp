// TOUCH-1 — "Log a touch". She picks what she did (Call, Handwritten note,
// Email, Visit, Meeting, Gift sent, Event invite, Text, Other, or a kind her
// org added in Settings) and says exactly what it was, in her own words. The
// profile, Home's moves, the Top 100, the plan of care and Atlas all open this
// one dialog. The kinds are shared/touchKinds.js, which the server reads too.
//
// BUILD-81 still holds underneath: the next step travels in the same request,
// and a skipped one is recorded as skipped. It is optional now: "Follow up in
// 2 weeks" makes a task, and an empty box makes none. A planned touch of the
// same kind (the plan of care) is completed by logging it, early or not.
//
// The profile's Note button (initialTouch "note_only") opens it as a plain note,
// which is not a touch and never moves Last contact (COUNTS-1).
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import { T, activeMark, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";
import {
  NEXT_STEP_LABEL_MAX, nextStepSuggestion, addCivilDays, nextStepTypeForLabel, sanitizeStepLabel,
  sanitizeStepTime, formatStepTime,
} from "../../../shared/threadShape";
import { TOUCH_KINDS, CALL_RESULTS, wordsRequired, legacyKeyFor } from "../../../shared/touchKinds.js";
import { TASK_OUTCOMES } from "../../../shared/taskShape.js";
import { orgTodayCivil } from "../lib/orgToday";
import { AttachFileField, uploadAttachment } from "./ProfileTimelineParts";
import DateInput from "./inputs/LazyDateInput";   // POLISH-6: the one date box, loaded when first shown
import { TouchIcon } from "./touchIcons";
// PERF-2: the Thread's row menus live in ThreadMenus.jsx; still importable from here.
export { ThreadDismissMenu, PutItOnMyCalendar } from "./ThreadMenus";

// FIX-14 Part 1 — the ORG's today, never the UTC day.
const todayLocal = () => orgTodayCivil();
const metaOf = m => { try { return (typeof m === "string" ? JSON.parse(m || "{}") : m) || {}; } catch { return {}; } };
const me = () => { try { return JSON.parse(localStorage.getItem("npe_user") || "null") || {}; } catch { return {}; } };
// An older entry's kind, from its type (a visit is a meeting with touch "visit").
const LEGACY_KIND = { call: "call", letter: "letter", email: "email", text: "text", gift_sent: "gift_sent", event_invite: "event_invite", other: "other" };
function kindOfEntry(e) {
  const m = metaOf(e.metadata);
  if (m.touch_kind) return m.touch_kind;
  if (e.type === "meeting") return m.touch === "visit" ? "visit" : "meeting";
  return LEGACY_KIND[e.type] || null;
}
// "Follow up in 2 weeks" → the day two weeks out. Only when she said a span.
function dueFromWords(label, today) {
  const m = /\bin\s+(\d{1,2}|a|an|one|two|three|four)\s+(day|week|month)s?\b/i.exec(String(label || ""));
  if (!m) return null;
  const n = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 }[m[1].toLowerCase()] || Number(m[1]);
  return addCivilDays(today, m[2].toLowerCase() === "day" ? n : m[2].toLowerCase() === "week" ? n * 7 : n * 30);
}
const SOON = [["In 1 week", 7], ["In 2 weeks", 14], ["In 1 month", 30]];

export function LogConversationModal({ donor, thread = null, onSaved, onClose, org = null, onNavigate = null, editing = null, initialTouch = null, fromMove = false, initialKind = null, completesTaskId = null }) {
  const noteMode = !editing ? initialTouch === "note_only" : (editing.type === "note" && !metaOf(editing.metadata).touch_kind);
  const startKind = editing ? (kindOfEntry(editing) || "") : (initialKind || (initialTouch === "call_no_answer" ? "call" : TOUCH_KINDS.some(k => k.key === initialTouch) ? initialTouch : "call"));
  const [kind, setKind] = useState(noteMode ? "" : startKind);
  const [custom, setCustom] = useState([]);
  const [line, setLine] = useState(editing ? String(editing.note || "") : "");
  const [place, setPlace] = useState(editing ? (metaOf(editing.metadata).location || "") : "");
  const [date, setDate] = useState(editing ? String(editing.date || "").slice(0, 10) : todayLocal());
  const [callResult, setCallResult] = useState(editing ? (metaOf(editing.metadata).call_result || "") : (initialTouch === "call_no_answer" ? "no_answer" : ""));
  const [team, setTeam] = useState([]);
  const [byId, setById] = useState(me().id || "");
  const [planned, setPlanned] = useState([]);
  const [completes, setCompletes] = useState(completesTaskId || "");
  const [nsLabel, setNsLabel] = useState("");
  const [nsDue, setNsDue] = useState(addCivilDays(todayLocal(), 14));
  const [nsDueSet, setNsDueSet] = useState(false);
  const [nsTime, setNsTime] = useState("");
  const [nsSource, setNsSource] = useState(null);
  const [wasTalk, setWasTalk] = useState(false);   // COUNTS-1: a note marked as a conversation is a contact
  // BUILD-88a A.1 — a gift they GAVE, mentioned while logging, is a gift row through recordGift.
  const [amount, setAmount] = useState("");
  const [fundId, setFundId] = useState("");
  const [method, setMethod] = useState("");
  const [funds, setFunds] = useState([]);
  const [outcome, setOutcome] = useState("");   // JOURNEYS-4: how a call or meeting ended, optional
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [file, setFile] = useState(null);   // PARITY-1 Part B
  const lineRef = useRef(null);
  useEffect(() => { lineRef.current?.focus(); }, []);
  useEffect(() => {
    let alive = true;
    apiFetch("/touch-types").then(r => { if (alive) setCustom(Array.isArray(r && r.custom) ? r.custom : []); }).catch(() => {});
    apiFetch("/org/team").then(r => { if (alive) setTeam(Array.isArray(r) ? r.filter(u => u && u.id && !u.deactivated_at) : []); }).catch(() => {});
    if (!editing && !noteMode) apiFetch(`/donors/${donor.id}/planned-touches`).then(r => { if (alive) setPlanned(Array.isArray(r && r.planned) ? r.planned : []); }).catch(() => {});
    if (!editing) apiFetch("/finance/funds").then(r => { if (alive) setFunds(Array.isArray(r) ? r : []); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // From a Thread row, the step it closes proposes the next one as it always
  // did (so saving moves the Thread on). Anywhere else the box starts empty.
  useEffect(() => {
    if (!thread || editing || noteMode || nsSource === "typed") return;
    if (thread.followon) { setNsLabel(thread.followon.label); setNsDue(thread.followon.due); setNsDueSet(true); setNsSource("plan"); return; }
    const s = nextStepSuggestion(legacyKeyFor(kind, callResult) || "note_only", todayLocal(), line);
    if (s) { setNsLabel(s.label); setNsDue(s.due); setNsDueSet(true); setNsSource("rule"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, callResult, thread]);
  // The planned touch this kind completes: the one she came from, or the soonest.
  const plannedHere = planned.filter(p => p.kinds.includes(kind));
  useEffect(() => {
    if (completesTaskId && plannedHere.some(p => p.taskId === completesTaskId)) { setCompletes(completesTaskId); return; }
    setCompletes(plannedHere.length ? plannedHere[0].taskId : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, planned.length]);

  const kinds = [...TOUCH_KINDS.map(k => ({ key: k.key, label: k.label })), ...custom.map(c => ({ key: c.key, label: c.label }))];
  const kindLabel = (kinds.find(k => k.key === kind) || {}).label || "touch";
  const defaultFund = funds.find(f => f.isOrgDefault) || funds.find(f => !f.restricted) || null;
  const amountTyped = String(amount).trim() !== "";
  const tzKnown = !!(org && (org.timezone_confirmed_at || org.timezoneConfirmedAt));
  const needsWords = noteMode || wordsRequired(kind);
  const isMeet = kind === "meeting" || kind === "visit";
  const planPick = plannedHere.find(p => p.taskId === completes) || null;
  const shownPlan = planPick || plannedHere[0] || null;

  const save = async () => {
    if (busy) return;
    if (!noteMode && !kind) { setErr("Pick what you did."); return; }
    if (needsWords && !line.trim()) { setErr(noteMode ? "Write the note first." : "Say what you did, in your words."); return; }
    if (date > todayLocal()) { setErr("A touch is something already done: pick today or an earlier day."); return; }
    setBusy(true); setErr("");
    try {
      if (editing) {
        const k = TOUCH_KINDS.find(x => x.key === kind);
        const c = custom.find(x => x.key === kind);
        const type = noteMode ? editing.type : k ? k.interactionType : c ? "other" : editing.type;
        const label = k ? k.label : c ? c.label : null;
        const row = await apiFetch(`/interactions/${editing.id}`, { method: "PUT", body: JSON.stringify({
          type, note: line.trim() || `${kindLabel}.`, date,
          ...(noteMode || !label ? {} : { metadata: { touch_kind: kind, touch_label: label, ...(isMeet ? { location: place.trim() } : {}), ...(kind === "call" ? { call_result: callResult } : {}) } }) }) });
        onSaved && onSaved(row); onClose && onClose();
        return;
      }
      const step = sanitizeStepLabel(nsLabel);
      const body = noteMode
        ? { touch: "note_only", line: line.trim(), date, ...(wasTalk ? { conversation: true } : {}) }
        : { touchKind: kind, line: line.trim(), date, ...(kind === "call" && callResult ? { callResult } : {}),
            ...(byId && byId !== me().id ? { byUserId: byId } : {}),
            ...(isMeet && place.trim() ? { place: place.trim() } : {}),
            ...(outcome && ((kind === "call" && callResult !== "voicemail" && callResult !== "no_answer") || isMeet) ? { outcome } : {}),
            ...(planPick ? { completesTaskId: planPick.taskId } : {}) };
      const r = await apiFetch(`/donors/${donor.id}/conversations`, { method: "POST", body: JSON.stringify({
        ...body,
        ...(amountTyped ? { gift: { amount: String(amount).trim(), fundId: fundId || (defaultFund ? defaultFund.id : null), paymentMethod: method || undefined } } : {}),
        ...(thread && thread.id ? { threadId: thread.id } : {}),
        ...(fromMove ? { fromMove: true } : {}),   // ONBOARD-2: logged from one of Steward's moves
        nextStep: !step ? { skipped: true }
          : { type: nextStepTypeForLabel(step), label: step, due: nsDue, time: sanitizeStepTime(nsTime) || undefined,
              source: nsSource === "rule" ? "touch" : null },
      }) });
      if (file && r && r.interactionId) {
        try { await uploadAttachment(r.interactionId, file); }
        catch (x) { window.alert("The touch is saved. The file did not attach: " + errorMessage(x, "try Attach a file on the entry.")); }
      }
      onSaved && onSaved({ ...r, touch: kind || "note_only", line: line.trim(), date, place: place.trim() || null });
      onClose && onClose();
    } catch (e) { setErr((e && e.sentence) || errorMessage(e, "That didn't save. Try again.")); setBusy(false); }
  };

  const inp = { width: "100%", background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "10px 12px", color: T.ink, fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box" };
  const lbl = { fontSize: 11, fontWeight: 700, color: T.ink3, marginBottom: 5, display: "block" };
  const chip = on => ({ background: T.white, border: "1px solid " + T.bg3, borderRadius: 7, padding: "5px 11px", color: on ? T.ink : T.ink3, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, ...activeMark(on, "bottom") });
  const linkBtn = { background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 11, fontWeight: 700, cursor: "pointer", textDecoration: "underline" };
  const title = editing ? (noteMode ? "Edit this note" : "Edit this touch") : noteMode ? "Add a note" : "Log a touch";
  const dueWords = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <Modal onClose={onClose} width={480} zIndex={300} padding={24} ariaLabel={title} dialogStyle={{ border: "1px solid " + T.bg3 }}>
      <div data-testid="log-touch">
        <div style={{ fontSize: 16, fontWeight: 800, color: T.ink, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 12, color: T.ink3, marginBottom: 14 }}>{donor.name}</div>

        {!noteMode && <div style={{ marginBottom: 12 }}>
          <span style={lbl}>What did you do?</span>
          <div role="group" aria-label="What did you do?" style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {kinds.map(k => (
              <button key={k.key} type="button" aria-pressed={kind === k.key} data-testid={"touch-kind-" + k.key} onClick={() => setKind(k.key)} style={chip(kind === k.key)}>
                <TouchIcon kind={k.key} size={14}/>{k.label}
              </button>
            ))}
          </div>
        </div>}

        {kind === "call" && !noteMode && (
          <div style={{ marginBottom: 12 }}>
            <span style={lbl}>How did the call go? (optional)</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {CALL_RESULTS.map(o => <button key={o.key} type="button" aria-pressed={callResult === o.key} data-testid={"call-result-" + o.key}
                onClick={() => setCallResult(callResult === o.key ? "" : o.key)} style={chip(callResult === o.key)}>{o.label}</button>)}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <span style={lbl}>{noteMode ? "The note" : needsWords ? "In your words" : "In your words (optional)"}</span>
          <textarea ref={lineRef} value={line} onChange={e => setLine(e.target.value)} rows={3} aria-label="In your words"
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); }}
            placeholder={kind === "letter" ? "Sent a handwritten thank-you card with a photo of Rocket." : kind === "gift_sent" ? "Mailed a mug and a thank-you note." : "Exactly what you did, for example: Left a voicemail about the spring tour."}
            data-testid="conv-line" style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} />
        </div>

        {!editing && !noteMode && ((kind === "call" && callResult !== "voicemail" && callResult !== "no_answer") || isMeet) && (
          <div style={{ marginBottom: 12 }}>
            <span style={lbl}>What came of it? (optional)</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {TASK_OUTCOMES.filter(o => o.key !== "no_answer").map(o => (
                <button key={o.key} type="button" aria-pressed={outcome === o.key} data-testid={"conv-outcome-" + o.key}
                  onClick={() => setOutcome(outcome === o.key ? "" : o.key)} style={chip(outcome === o.key)}>{o.label}</button>
              ))}
            </div>
          </div>
        )}
        {noteMode && !editing && (
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, fontSize: 13, color: T.ink }}>
            <input type="checkbox" checked={wasTalk} onChange={e => setWasTalk(e.target.checked)} data-testid="conv-note-was-talk" />
            This was a conversation (it counts as their last contact)
          </label>
        )}
        {isMeet && (
          <div style={{ marginBottom: 12 }}>
            <span style={lbl}>Where (optional)</span>
            <input value={place} onChange={e => setPlace(e.target.value)} maxLength={200} aria-label="Where" data-testid="conv-place" placeholder="Starbucks on Main Street" style={inp} />
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "0 1 160px" }}>
            <span style={lbl}>When</span>
            <DateInput value={date} max={todayLocal()} onChange={e => setDate(e.target.value)} aria-label="When" style={inp} />
          </div>
          {!noteMode && !editing && team.length > 1 && <div style={{ flex: "1 1 160px" }}>
            <span style={lbl}>Who did it</span>
            <select value={byId} onChange={e => setById(e.target.value)} aria-label="Who did it" data-testid="touch-by" style={inp}>
              {team.map(u => <option key={u.id} value={u.id}>{u.id === me().id ? `${u.name || "Me"} (me)` : u.name || u.email}</option>)}
            </select>
          </div>}
          {!editing && <div style={{ flex: "0 1 130px" }}>
            <span style={lbl}>A gift they gave (optional)</span>
            <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" aria-label="Gift amount" data-testid="conv-gift-amount" placeholder="e.g. 250" style={inp} />
          </div>}
        </div>
        {amountTyped && (
          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }} data-testid="conv-gift-detail">
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

        {!editing && shownPlan && (
          <label data-testid="touch-completes" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 12, fontSize: 13, color: T.ink, background: T.bg, borderRadius: 8, padding: "9px 11px" }}>
            <input type="checkbox" checked={!!planPick} onChange={e => setCompletes(e.target.checked ? shownPlan.taskId : "")} style={{ marginTop: 2 }} />
            <span>This completes the planned {shownPlan.label.toLowerCase()}{shownPlan.due ? ` (due ${dueWords(shownPlan.due)})` : ""}. Done early is fine.</span>
          </label>
        )}

        {!editing && <div style={{ borderTop: "1px solid " + T.bg3, paddingTop: 12, marginBottom: 14 }}>
          <span style={lbl}>Next step (optional)</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={nsLabel} maxLength={NEXT_STEP_LABEL_MAX} data-testid="touch-next"
              onChange={e => { const v = e.target.value; setNsLabel(v); setNsSource("typed"); const d = !nsDueSet && dueFromWords(v, todayLocal()); if (d) setNsDue(d); }}
              placeholder="Follow up in 2 weeks" aria-label="Next step" style={{ ...inp, width: "auto", flex: "1 1 200px", alignSelf: "flex-start" }} />
            {/* The date box's wrapper is a column, so its size goes on this div: a flex
                basis on the box itself became its HEIGHT (a 150px-tall date and step). */}
            {sanitizeStepLabel(nsLabel) && <div style={{ flex: "0 1 150px", minWidth: 0 }}><DateInput value={nsDue} onChange={e => { setNsDue(e.target.value); setNsDueSet(true); }}
              aria-label="Next step due date" style={inp} /></div>}
            {sanitizeStepLabel(nsLabel) && tzKnown && <input type="time" value={nsTime} onChange={e => setNsTime(e.target.value)}
              aria-label="Next step time (optional)" style={{ ...inp, width: "auto", flex: "0 1 116px" }} />}
          </div>
          {sanitizeStepLabel(nsLabel) ? (
            <div style={{ fontSize: 11, color: T.ink3, marginTop: 6, lineHeight: 1.5, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
              {SOON.map(([l, n]) => <button key={n} type="button" style={linkBtn} onClick={() => { setNsDue(addCivilDays(todayLocal(), n)); setNsDueSet(true); }}>{l}</button>)}
              <span>{sanitizeStepTime(nsTime) ? `One email at ${formatStepTime(nsTime)} that day, instead of the morning list.` : "It becomes a task, in your morning email when it's due."}</span>
              {!tzKnown && onNavigate && <button type="button" style={linkBtn} onClick={() => { onClose && onClose(); onNavigate("settings", { section: "giving", focus: "timezone" }); }}>Set your time zone to add a time</button>}
            </div>
          ) : <div style={{ fontSize: 11, color: T.ink3, marginTop: 6 }}>Leave it empty and no task is made.</div>}
        </div>}

        {!editing && <AttachFileField file={file} setFile={setFile} labelStyle={lbl}/>}
        {err && <div role="alert" style={{ fontSize: 12, color: T.gold700, marginBottom: 10 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={save} disabled={busy} data-testid="touch-save"
            style={{ background: T.greenDk, border: "none", borderRadius: 8, padding: "10px 18px", color: T.white, fontSize: 13, fontWeight: 800, cursor: busy ? "wait" : "pointer" }}>
            {busy ? "Saving…" : editing ? "Save" : noteMode ? "Save the note" : `Log the ${kindLabel.toLowerCase()}`}
          </button>
          <span style={{ flexGrow: 1 }} />
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: T.ink3, fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

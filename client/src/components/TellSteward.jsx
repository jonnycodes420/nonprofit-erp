// TellSteward.jsx · VOICE-1. TALK FOR 30 SECONDS, AND THE PAPERWORK IS DONE.
//
// One sheet, opened from Home, from a donor profile (about that person by
// default) and from the main menu. Wherever the browser has its own speech
// recognition (phones, and since VOICE-2 Chrome, Edge and Safari on a
// computer) it listens (hold to talk, or tap to start and tap to stop) and
// shows the words as they come; where it has none (Firefox) it is a text box,
// and the keyboard's or computer's own dictation does the listening.
// VOICE-2 adds "Listen to this meeting" (MeetingMode.jsx).
// Either way she can edit every word before Steward reads any of it. No audio
// is recorded here: the browser hands this page text, and only the text she
// sends leaves the page (routes/voice.js).
//
// The answer is one screen at two speeds: Done for you, with one Undo, and
// Waiting for your yes (the drafted email, every amount, a contact change, a
// personal detail).
import { useEffect, useRef, useState } from "react";
import { Modal, T } from "./shared";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";
import MeetingMode, { MeetingFiled } from "./MeetingMode";
import { listenMode, errorStopsListening, NO_LISTEN_LINE, NO_LISTEN_PHONE_LINE } from "../../../shared/voiceMeeting.js";

const SR = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null;
const isPhone = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
const HOLD_MS = 350;
const btn = (primary) => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: "1px solid " + (primary ? T.greenDk : T.bg3),
  borderRadius: 10, padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 44 });
const said = e => (e && (e.sentence || (typeof e.error === "string" && e.error.length > 14 ? e.error : null))) || errorMessage(e, "That did not go through. Nothing was filed.");

// Open the sheet from anywhere: window.dispatchEvent(new CustomEvent("steward:tell", { detail: { donor } })).
export function openTellSteward(donor) {
  window.dispatchEvent(new CustomEvent("steward:tell", { detail: { donor: donor ? { id: donor.id, name: donor.name } : null } }));
}

// The large button, for Home and the profile.
export function MicGlyph({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v1a7 7 0 0 0 14 0v-1" /><line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}

export default function TellSteward({ donor, onClose, onNavigate }) {
  const phone = isPhone();
  // VOICE-2 Part 1: detection, not the device. A browser that can listen does.
  const [speech, setSpeech] = useState(() => listenMode(typeof window !== "undefined" ? window : {}).mode === "speech");
  const [meeting, setMeeting] = useState(null);   // null | { resume }
  const [openMeeting, setOpenMeeting] = useState(null);
  const picks = useRef([]);
  const [listening, setListening] = useState(false);
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [step, setStep] = useState(null);    // { which } | { pick } | { needsPeople } | { memo }
  const [recent, setRecent] = useState([]);
  const [source, setSource] = useState("typed");
  const rec = useRef(null);
  const wantOn = useRef(false);
  const downAt = useRef(0);
  const finalText = useRef("");

  useEffect(() => {
    apiFetch(`/voice/memos${donor ? `?donorId=${encodeURIComponent(donor.id)}` : ""}`).then(r => setRecent((r.memos || []).slice(0, 3))).catch(() => {});
    apiFetch("/voice/meetings/open").then(r => setOpenMeeting(r.meeting || null)).catch(() => {});
    return () => { wantOn.current = false; try { rec.current && rec.current.abort(); } catch { /* already stopped */ } };
  }, [donor]);

  // ── LISTENING ─────────────────────────────────────────────────────────────
  function start() {
    if (!SR || listening) return;
    setErr("");
    const r = new SR();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    finalText.current = text ? text.trim() + " " : "";
    r.onresult = e => {
      let fin = "", mid = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t; else mid += t;
      }
      if (fin) { finalText.current = (finalText.current + fin).replace(/\s+/g, " "); setText(finalText.current.trimStart()); }
      setInterim(mid);
    };
    r.onerror = e => {
      if (errorStopsListening(e.error)) {
        wantOn.current = false; setSpeech(false);
        setErr(phone ? "This browser would not let Steward listen. Type it, or use your keyboard's microphone."
          : "This browser would not let Steward listen. Type it, or use your computer's dictation. (On a Mac, Safari listens when Dictation is on in System Settings.)");
      }
    };
    // iOS stops after a pause; keep listening until she says stop.
    r.onend = () => { setInterim(""); if (wantOn.current) { try { r.start(); } catch { setListening(false); } } else setListening(false); };
    rec.current = r;
    wantOn.current = true;
    try { r.start(); setListening(true); setSource("speech"); } catch { setSpeech(false); }
  }
  function stop() {
    wantOn.current = false;
    try { rec.current && rec.current.stop(); } catch { /* already stopped */ }
    setListening(false);
  }
  // Hold to talk (release stops), or tap to start and tap again to stop.
  const startedNow = useRef(false);
  const onDown = e => { e.preventDefault(); downAt.current = Date.now(); startedNow.current = !listening; if (!listening) start(); };
  const onUp = () => { if (!startedNow.current || Date.now() - downAt.current > HOLD_MS) stop(); };

  // ── SENDING ───────────────────────────────────────────────────────────────
  // Every "which one?" answer so far rides along, so a memo naming two shared
  // names asks about each once (VOICE-2 Part 2: each pick used to replace the
  // last, and the list asked again forever).
  function pickOne(id) {
    picks.current = [...picks.current.filter(x => x !== id), id];
    if (step && step.meetingId) return fileMeeting({ picks: picks.current });
    return send({ picks: picks.current });
  }
  function pickPerson(id) {
    if (step && step.meetingId) return fileMeeting({ donorId: id, picks: picks.current });
    return send({ donorId: id, picks: picks.current });
  }
  async function fileMeeting(body) {
    setBusy(true); setErr("");
    try { const r = await apiFetch(`/voice/meetings/${step.meetingId}/file`, { method: "POST", body: JSON.stringify(body) }); setStep({ ...r, meetingId: step.meetingId }); }
    catch (e) { setErr(said(e)); }
    setBusy(false);
  }
  // The words asked about are the words answered: a pick re-sends exactly what
  // was sent, so a name still half-heard when she pressed Send cannot drop
  // out between the question and her click. A fresh Send starts fresh picks.
  const sentWords = useRef("");
  async function send(extra = {}) {
    if (listening) stop();
    const answering = !!(extra.picks || extra.donorId) && sentWords.current;
    const words = answering ? sentWords.current : (text + (interim ? " " + interim : "")).trim();
    if (words.length < 4) { setErr("Tell Steward what happened first."); return; }
    if (!answering) { picks.current = []; sentWords.current = words; finalText.current = words; setText(words); setInterim(""); }
    setBusy(true); setErr("");
    try {
      const r = await apiFetch("/voice/memos", { method: "POST", body: JSON.stringify({ text: words, source, donorId: donor ? donor.id : undefined, ...extra }) });
      setStep(r);
    } catch (e) { setErr(said(e)); }
    setBusy(false);
  }
  async function people(body) {
    setBusy(true); setErr("");
    try { const r = await apiFetch(`/voice/memos/${step.needsPeople.memoId}/people`, { method: "POST", body: JSON.stringify(body) }); setStep({ ...r, meetingId: step.meetingId }); }
    catch (e) { setErr(said(e)); }
    setBusy(false);
  }
  async function act(path) {
    setBusy(true); setErr("");
    try { const r = await apiFetch(path, { method: "POST", body: "{}" }); setStep(s => ({ memo: r.memo, note: r.sentence || null, meetingId: s && s.meetingId })); }
    catch (e) { setErr(said(e)); }
    setBusy(false);
  }

  const memo = step && step.memo;
  const title = memo ? (memo.status === "undone" ? "Undone" : "Filed") : meeting ? "Listen to this meeting" : "Tell Steward";
  const sub = memo || meeting ? null : donor ? `What happened with ${donor.name}? Steward files it; nothing is sent.` : "What happened? Steward files it; nothing is sent.";
  const meetingDone = step && step.meetingId && step.meeting && !step.memo && !step.which && !step.pick && !step.needsPeople ? step : null;

  return (
    <Modal onClose={onClose} title={title} subtitle={sub} width={meeting || (step && step.meetingId) ? 600 : 520} align={phone ? "top" : "center"} ariaLabel="Tell Steward">
      <div data-testid="tell-steward-sheet" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {err && <div role="alert" style={{ background: T.cream || "#F0EDE6", color: T.ink, borderRadius: 10, padding: "10px 12px", fontSize: 13.5, lineHeight: 1.45 }}>{err}</div>}

        {meeting && !step && <MeetingMode donor={donor} resume={meeting.resume || null} PickPerson={PickPerson}
          onBack={() => { setMeeting(null); apiFetch("/voice/meetings/open").then(r => setOpenMeeting(r.meeting || null)).catch(() => {}); }}
          onFiled={r => { picks.current = []; setMeeting(null); setOpenMeeting(null); setStep(r); }} />}

        {!step && !meeting && <>
          {openMeeting && <div data-testid="meeting-open-banner" style={{ border: "1px solid #C9A84C", borderRadius: 10, padding: "10px 12px", fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>
            A meeting is still open{openMeeting.people.length ? ` with ${openMeeting.people.map(p => p.name).join(" and ")}` : ""}, started {new Date(openMeeting.startedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}. Everything heard so far is saved.
            <div style={{ marginTop: 8 }}><button type="button" data-testid="meeting-reopen" onClick={() => setMeeting({ resume: openMeeting })} style={btn(true)}>Go back to it</button></div>
          </div>}
          {speech && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <button data-testid="tell-mic" aria-pressed={listening} aria-label={listening ? "Stop listening" : "Start listening"}
                onPointerDown={onDown} onPointerUp={onUp} onContextMenu={e => e.preventDefault()}
                style={{ width: 96, height: 96, borderRadius: "50%", border: "none", background: listening ? T.gold500 || "#C9A84C" : T.greenDk, color: T.white,
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", touchAction: "none", boxShadow: listening ? "0 0 0 8px rgba(201,168,76,0.25)" : "none" }}>
                <MicGlyph size={38} />
              </button>
              <div style={{ fontSize: 13, color: T.ink3 }}>{listening ? `Listening. Release, or ${phone ? "tap" : "click"} Stop, when you are done.` : phone ? "Hold to talk, or tap and talk." : "Hold to talk, or click and talk."}</div>
              {listening && <button onClick={stop} style={btn(false)}>Stop</button>}
            </div>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: T.ink2 }}>{speech ? "What Steward heard (change anything before you send)" : "Tell Steward what happened"}</span>
            <textarea data-testid="tell-text" value={text + (interim ? (text ? " " : "") + interim : "")} rows={phone ? 6 : 5}
              onChange={e => { setText(e.target.value); setInterim(""); finalText.current = e.target.value; }}
              placeholder={donor ? `Lunch with ${String(donor.name).split(/\s+/)[0]}, loved the tour, wants to hear about the spring show, circle back in March.` : "Lunch with Margaret, loved the barn tour, wants to give to the new arena, circle back in March."}
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px", fontSize: 16, lineHeight: 1.45, fontFamily: "inherit", color: T.ink, resize: "vertical" }} />
            {!speech && <span data-testid="tell-no-listen" style={{ fontSize: 12, color: T.ink3 }}>{phone ? NO_LISTEN_PHONE_LINE : NO_LISTEN_LINE}</span>}
          </label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
            {!speech && SR && <button onClick={() => setSpeech(true)} style={btn(false)}>Talk instead</button>}
            <button data-testid="tell-meeting" type="button" onClick={() => { if (listening) stop(); setMeeting({}); }} style={btn(false)}>Listen to this meeting</button>
            <button data-testid="tell-send" disabled={busy} onClick={() => send()} style={{ ...btn(true), opacity: busy ? 0.6 : 1, flex: phone ? 1 : "0 0 auto" }}>{busy ? "Filing..." : "Send to Steward"}</button>
          </div>
          <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>Steward never keeps a recording, only these words. Nothing is sent to anyone, and amounts and personal details wait for your yes.</div>
          {recent.length > 0 && <div style={{ borderTop: "1px solid " + T.bg3, paddingTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, marginBottom: 6 }}>Recent memos</div>
            {recent.map(m => (
              <button key={m.id} onClick={() => setStep({ memo: m })} style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "8px 0", cursor: "pointer", borderBottom: "1px solid " + T.bg3 }}>
                <div style={{ fontSize: 13.5, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.text}</div>
                <div style={{ fontSize: 12, color: T.ink3 }}>{new Date(m.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {m.people.map(p => p.name).join(", ") || "nobody"} · {m.status === "undone" ? "undone" : `${m.done.length} done, ${m.waiting.filter(c => c.state === "waiting").length} waiting`}</div>
              </button>))}
          </div>}
        </>}

        {step && step.which && <WhichOne which={step.which} busy={busy} onPick={pickOne} onBack={() => { picks.current = []; setStep(null); }} />}
        {step && step.pick && <PickPerson sentence={step.pick.sentence} busy={busy} onPick={pickPerson} onBack={() => { picks.current = []; setStep(null); }} />}
        {meetingDone && <><div data-testid="meeting-note" style={{ background: "#F0EDE6", borderRadius: 10, padding: "10px 12px", fontSize: 13.5, color: T.ink }}>{meetingDone.note || "The meeting is saved."}</div>
          <MeetingFiled meetingId={meetingDone.meetingId} />
          <div style={{ display: "flex", justifyContent: "flex-end" }}><button data-testid="tell-done" onClick={onClose} style={btn(true)}>Done</button></div></>}
        {memo && step.meetingId && <MeetingFiled meetingId={step.meetingId} />}
        {step && step.needsPeople && <NeedsPeople np={step.needsPeople} busy={busy} onAnswer={people} onBack={() => setStep(null)} />}
        {memo && <Results memo={memo} note={step.note} busy={busy} act={act} onClose={onClose} onNavigate={onNavigate} onAnother={() => { picks.current = []; setStep(null); setText(""); finalText.current = ""; setSource("typed"); }} />}
      </div>
    </Modal>
  );
}

function WhichOne({ which, busy, onPick, onBack }) {
  // Focus lands on the first choice, so the keyboard can pick straight away.
  const first = useRef(null);
  useEffect(() => { if (first.current) first.current.focus(); }, [which]);
  return <div data-testid="tell-which" role="group" aria-label={`Which ${which.said || "person"}?`}>
    <p style={{ margin: "0 0 10px", fontSize: 14, color: T.ink, lineHeight: 1.5 }}>{which.sentence}</p>
    {which.people.map((p, i) => (
      <button key={p.id} type="button" ref={i === 0 ? first : null} data-testid="tell-which-choice" disabled={busy} onClick={() => onPick(p.id)}
        style={{ ...btn(false), display: "block", width: "100%", textAlign: "left", marginBottom: 8, touchAction: "manipulation", position: "relative", zIndex: 1 }}>
        <div>{p.name}</div><div style={{ fontSize: 12, fontWeight: 400, color: T.ink3, marginTop: 2 }}>{p.detail}</div>
      </button>))}
    <button onClick={onBack} style={{ ...btn(false), border: "none" }}>Back to the memo</button>
  </div>;
}

function PickPerson({ sentence, busy, onPick, onBack, label = "Find the person", backLabel = "Back to the memo" }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => apiFetch(`/search?q=${encodeURIComponent(q.trim())}`).then(r => setHits((r.results || []).filter(x => x.kind === "person").slice(0, 6))).catch(() => setHits([])), 200);
    return () => clearTimeout(t);
  }, [q]);
  return <div data-testid="tell-pick">
    {sentence && <p style={{ margin: "0 0 10px", fontSize: 14, color: T.ink, lineHeight: 1.5 }}>{sentence}</p>}
    <input value={q} onChange={e => setQ(e.target.value)} placeholder={label} aria-label={label}
      style={{ width: "100%", boxSizing: "border-box", border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px", fontSize: 16 }} />
    <div style={{ marginTop: 8 }}>{hits.map(h => (
      <button key={h.id} type="button" data-testid="tell-pick-choice" disabled={busy} onClick={() => onPick(h.id, h.title)} style={{ ...btn(false), display: "block", width: "100%", textAlign: "left", marginBottom: 6 }}>
        {h.title}{h.email ? <span style={{ fontWeight: 400, color: T.ink3 }}> · {h.email}</span> : null}
      </button>))}</div>
    {onBack && <button type="button" onClick={onBack} style={{ ...btn(false), border: "none" }}>{backLabel}</button>}
  </div>;
}

function NeedsPeople({ np, busy, onAnswer, onBack }) {
  const [picking, setPicking] = useState(false);
  return <div data-testid="tell-needs-people">
    <p style={{ margin: "0 0 10px", fontSize: 14, color: T.ink, lineHeight: 1.5 }}>{np.sentence}</p>
    {(np.names || []).map(n => (
      <button key={n} disabled={busy} onClick={() => onAnswer({ add: [n] })} style={{ ...btn(true), display: "block", width: "100%", marginBottom: 8 }}>Add {n} as a new person</button>))}
    {!picking && <button onClick={() => setPicking(true)} style={{ ...btn(false), display: "block", width: "100%", marginBottom: 8 }}>{np.names && np.names.length ? "It was somebody already on file" : "Pick the person"}</button>}
    {picking && <PickPerson busy={busy} onPick={id => onAnswer({ pick: [id] })} />}
    <button onClick={onBack} style={{ ...btn(false), border: "none" }}>Back to the memo</button>
  </div>;
}

const CARD_LABEL = { draft: "Email draft", money: "Amount", contact: "Contact change", sensitive: "Personal detail" };
function Results({ memo, note, busy, act, onClose, onNavigate, onAnother }) {
  const [showMemo, setShowMemo] = useState(false);
  const waiting = memo.waiting || [];
  const open = waiting.filter(c => c.state === "waiting");
  const decided = waiting.filter(c => c.state !== "waiting");
  const undone = memo.status === "undone";
  return <div data-testid="tell-results" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    {note && <div style={{ background: "#F0EDE6", borderRadius: 10, padding: "10px 12px", fontSize: 13.5, color: T.ink }}>{note}</div>}
    {memo.people.length > 0 && <div style={{ fontSize: 13.5, color: T.ink2 }}>About {memo.people.map(p => p.name).join(" and ")}{memo.ai === "off" ? ". AI is off, so your memo was saved as a note and nothing else." : "."}</div>}
    <section>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, marginBottom: 6 }}>Done for you</div>
      {undone ? <div style={{ fontSize: 13.5, color: T.ink3 }}>Undone by {memo.undoneByName || "you"}. Everything this memo filed was taken back.</div>
        : memo.done.length === 0 ? <div style={{ fontSize: 13.5, color: T.ink3 }}>Nothing yet.</div>
        : memo.done.map((d, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", fontSize: 14, color: T.ink, lineHeight: 1.45 }}>
            <span aria-hidden style={{ color: d.outcome === "done" ? T.greenDk : T.ink3, fontWeight: 800 }}>{d.outcome === "done" ? "✓" : "·"}</span>
            <span>{d.line}{d.outcome !== "done" && d.reason ? <span style={{ color: T.ink3 }}> (not done: {d.reason})</span> : null}</span>
          </div>))}
    </section>
    {open.length > 0 && <section>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, marginBottom: 6 }}>Waiting for your yes</div>
      {open.map(c => <div key={c.id} data-testid={`tell-card-${c.kind}`} style={{ border: "1px solid " + T.bg3, borderLeft: "3px solid " + (c.kind === "sensitive" || c.kind === "money" ? "#C9A84C" : T.greenDk), borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, marginBottom: 3 }}>{CARD_LABEL[c.kind]}</div>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: T.ink, lineHeight: 1.4 }}>{c.title}</div>
        {c.kind === "draft" && <div style={{ fontSize: 13, color: T.ink2, marginTop: 4, lineHeight: 1.45 }}><b>{c.subject}</b><br />{String(c.body || "").slice(0, 180)}{String(c.body || "").length > 180 ? "..." : ""}</div>}
        {c.quote && c.kind !== "draft" && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 4 }}>You said: "{c.quote}"</div>}
        {c.kind === "sensitive" && <div style={{ fontSize: 12, color: T.ink3, marginTop: 4 }}>Steward did not file this. Save it and only the words above go on their record, as a note.</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {c.kind === "draft"
            ? <button onClick={() => { onClose(); onNavigate && onNavigate("agent", { agentView: "waiting" }); }} style={btn(true)}>Open the draft</button>
            : <button disabled={busy} onClick={() => act(`/voice/memos/${memo.id}/cards/${c.id}/yes`)} style={btn(true)}>{c.kind === "sensitive" ? "Save as a note" : "Yes"}</button>}
          <button disabled={busy} onClick={() => act(`/voice/memos/${memo.id}/cards/${c.id}/no`)} style={btn(false)}>{c.kind === "sensitive" ? "Discard" : c.kind === "draft" ? "Throw away" : "Not now"}</button>
        </div>
      </div>)}
    </section>}
    {decided.length > 0 && <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.6 }}>
      {decided.map(c => <div key={c.id}>{c.state === "saved" ? "Saved" : "Set aside"}: {c.title}</div>)}
    </div>}
    <div>
      <button onClick={() => setShowMemo(v => !v)} style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{showMemo ? "Hide" : "Show"} what you said</button>
      {showMemo && <div style={{ marginTop: 6, fontSize: 13.5, color: T.ink2, lineHeight: 1.5, background: "#F0EDE6", borderRadius: 10, padding: "10px 12px" }}>{memo.text}</div>}
    </div>
    <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap", borderTop: "1px solid " + T.bg3, paddingTop: 12 }}>
      {!undone && memo.done.length > 0 ? <button data-testid="tell-undo" disabled={busy} onClick={() => act(`/voice/memos/${memo.id}/undo`)} style={btn(false)}>Undo this memo</button> : <span />}
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onAnother} style={btn(false)}>Tell another</button>
        <button data-testid="tell-done" onClick={onClose} style={btn(true)}>Done</button>
      </div>
    </div>
  </div>;
}

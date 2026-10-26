// TellSteward.jsx · VOICE-1, AGENT-5. ATLAS, OVER THE PAGE YOU ARE ON.
//
// AGENT-5: this sheet is Atlas. Home's Ask box, the floating mic, the rail's
// Tell Steward and the profile all open it, over the page, never a
// navigation. Her words go to POST /atlas; while Atlas reads them she sees
// one spinner per thing she asked for (shared/atlas.js previewLines, drawn
// in the browser before the server answers). Then one of two screens: every
// question at once, one click each; or the checklist, each line a link, with
// Undo on what ran and one tap on what waits. Do all of this taps them all.
//
// VOICE-1, as it was:
// One sheet, opened from Home, from a donor profile (about that person by
// default) and from the main menu. Wherever the browser has its own speech
// recognition (phones, and since VOICE-2 Chrome, Edge and Safari on a
// computer) it listens (hold to talk, or tap to start and tap to stop) and
// shows the words as they come; where it has none (Firefox) it is a text box,
// and the keyboard's or computer's own dictation does the listening.
// VOICE-3: one place to talk to Steward. What happened is filed as before;
// something to do comes back as the Agent's plan, with Confirm; a question is
// answered by Ask, with its rows (routes/voice.js POST /voice/talk).
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
import { listenMode, errorStopsListening, NO_LISTEN_LINE, NO_LISTEN_PHONE_LINE, SAFARI_MIC_TIP, showMicTip } from "../../../shared/voiceTalk.js";
import { previewLines } from "../../../shared/atlas.js";
import { told } from "../lib/stewardTold";
import { atlasStatus, atlasName, linkTarget } from "../lib/atlas";
import { Camera } from "lucide-react";
import { openCheckSnap } from "./CheckSnap";   // CHECK-2

const SR = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null;
// VOICE-4: ONE recognizer for the page. A new one per press (and per opening
// of this window) made Safari ask for the microphone every time.
let pageRecognizer = null;
const recognizer = () => { if (!pageRecognizer && SR) pageRecognizer = new SR(); return pageRecognizer; };
const MIC_ASKS_KEY = "steward_mic_asks";
const micAsks = () => { try { return Number(sessionStorage.getItem(MIC_ASKS_KEY)) || 0; } catch { return 0; } };
// The browser is about to ask when the permission still reads "prompt".
async function countMicAsk() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return micAsks();
    const st = await navigator.permissions.query({ name: "microphone" });
    if (st.state !== "prompt") return micAsks();
    const n = micAsks() + 1;
    try { sessionStorage.setItem(MIC_ASKS_KEY, String(n)); } catch { /* storage blocked */ }
    return n;
  } catch { return micAsks(); }
}
const isPhone = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
const HOLD_MS = 350;
const btn = (primary) => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: "1px solid " + (primary ? T.greenDk : T.bg3),
  borderRadius: 10, padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 44 });
const said = e => (e && (e.sentence || (typeof e.error === "string" && e.error.length > 14 ? e.error : null))) || errorMessage(e, "That didn't go through. I did nothing.");

// Open Atlas from anywhere. `text` arrives typed; `send` asks at once (Home's box).
export function openTellSteward(donor, { text = "", send = false } = {}) {
  window.dispatchEvent(new CustomEvent("steward:tell", { detail: { donor: donor ? { id: donor.id, name: donor.name } : null, text, send } }));
}
export const openAtlas = openTellSteward;

// The large button, for Home and the profile.
export function MicGlyph({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v1a7 7 0 0 0 14 0v-1" /><line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}


const STATE_MARK = { done: "✓", waiting: "●", refused: "–", failed: "!", undone: "↺", discarded: "–", running: "" };
const TAP_LABEL = { gift: "Record", pledge: "Record", receipt: "Send both", held_back: "Keep as a note" };
const ALL_KINDS = new Set(["gift", "pledge", "receipt"]);

export default function TellSteward({ donor, onClose, onNavigate, initialText = "", autoSend = false }) {
  const phone = isPhone();
  // VOICE-2 Part 1: detection, not the device. A browser that can listen does.
  const [speech, setSpeech] = useState(() => listenMode(typeof window !== "undefined" ? window : {}).mode === "speech" && !initialText);
  const [listening, setListening] = useState(false);
  const [text, setText] = useState(initialText || "");
  const [interim, setInterim] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [request, setRequest] = useState(null);   // the server's request: questions, lines, spoke
  const [pending, setPending] = useState(null);   // the spinners, before the server answers
  const [answers, setAnswers] = useState({});
  const [source, setSource] = useState("typed");
  const [name, setName] = useState(atlasName());
  const rec = useRef(null);
  const wantOn = useRef(false);
  const downAt = useRef(0);
  const finalText = useRef(initialText ? initialText + " " : "");
  const [micTip, setMicTip] = useState(false);
  const sentAt = useRef(0);

  useEffect(() => {
    atlasStatus().then(s => setName(s.name)).catch(() => {});
    if (autoSend && initialText) send(initialText);
    return () => {
      wantOn.current = false;
      const r = rec.current;
      try { r && r.abort(); } catch { /* already stopped */ }
      // The recognizer outlives this window; its answers stop coming here.
      if (r) { r.onresult = null; r.onerror = null; r.onend = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── LISTENING ─────────────────────────────────────────────────────────────
  function start() {
    if (!SR || listening) return;
    setErr("");
    const r = recognizer();
    countMicAsk().then(n => setMicTip(showMicTip({ ua: navigator.userAgent, asks: n }))).catch(() => {});
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
        setErr(phone ? "This browser won't let me listen. Type it, or use your keyboard's microphone."
          : "This browser won't let me listen. Type it, or use your computer's dictation. (On a Mac, Safari listens when Dictation is on in System Settings.)");
      }
    };
    // iOS stops after a pause; keep listening until she says stop.
    r.onend = () => { setInterim(""); if (wantOn.current) { try { r.start(); } catch { setListening(false); } } else setListening(false); };
    rec.current = r;
    wantOn.current = true;
    try { r.start(); setListening(true); setSource("speech"); }
    catch (e) {
      if (e && e.name === "InvalidStateError") {
        try { r.abort(); } catch { /* already stopped */ }
        setTimeout(() => { try { r.start(); setListening(true); setSource("speech"); } catch { setSpeech(false); } }, 200);
      } else setSpeech(false);
    }
  }
  function stop() {
    wantOn.current = false;
    try { rec.current && rec.current.stop(); } catch { /* already stopped */ }
    setListening(false);
  }
  const startedNow = useRef(false);
  const onDown = e => { e.preventDefault(); downAt.current = Date.now(); startedNow.current = !listening; if (!listening) start(); };
  const onUp = () => { if (!startedNow.current || Date.now() - downAt.current > HOLD_MS) stop(); };
  const snapCheck = () => { if (listening) stop(); openCheckSnap({ donor: donor ? { id: donor.id, name: donor.name } : null, camera: true }); onClose(); };

  // ── ASKING ATLAS ──────────────────────────────────────────────────────────
  // The spinners go up before the request leaves, so the first thing she sees
  // comes in well under two seconds whatever the model takes.
  async function send(words0) {
    if (listening) stop();
    const words = String(words0 != null ? words0 : (text + (interim ? " " + interim : ""))).trim();
    if (words.length < 3) { setErr("Tell me what happened, what to do, or what you want to know."); return; }
    setText(words); setInterim(""); finalText.current = words;
    sentAt.current = performance.now();
    setPending({ text: words, lines: previewLines(words) });
    setRequest(null); setAnswers({}); setBusy(true); setErr("");
    try {
      const r = await apiFetch("/atlas", { method: "POST", body: JSON.stringify({ text: words, source, donorId: donor ? donor.id : undefined }) });
      setRequest(r.request);
      if (r.request && r.request.status === "done") told({ memoId: r.request.id });   // the page behind shows it at once
    } catch (e) { setErr(said(e)); }
    setPending(null);
    setBusy(false);
  }
  async function answer(next) {
    setBusy(true); setErr("");
    setPending({ text: request.text, lines: previewLines(request.text) });
    try {
      const r = await apiFetch(`/atlas/${request.id}/answer`, { method: "POST", body: JSON.stringify({ answers: next }) });
      setRequest(r.request);
      told({ memoId: r.request.id });
    } catch (e) { setErr(said(e)); if (e && e.request) setRequest(e.request); }
    setPending(null);
    setBusy(false);
  }
  // One click each: with one question the click is the answer; with several,
  // the last one answered sends them all.
  function pick(q, id) {
    const next = { ...answers, [q.id]: id };
    setAnswers(next);
    if ((request.questions || []).every(x => next[x.id])) answer(next);
  }
  async function act(path) {
    setBusy(true); setErr("");
    try {
      const r = await apiFetch(path, { method: "POST", body: "{}" });
      if (r.request) setRequest(r.request);
      told({ memoId: r.request && r.request.id });
    } catch (e) { setErr(said(e)); }
    setBusy(false);
  }
  const go = link => { const t = linkTarget(link); if (!t || !onNavigate) return; onClose(); onNavigate(t[0], t[1]); };
  const another = () => { setRequest(null); setPending(null); setText(""); finalText.current = ""; setSource("typed"); };

  const asking = request && request.status === "needs_answers";
  const lines = (request && request.lines) || [];
  const taps = lines.filter(l => l.waits && ALL_KINDS.has(l.kind));
  const sub = request || pending ? null : donor ? `Tell me what happened with ${donor.name}, what to do, or what you want to know.` : "Tell me what happened, what to do, or what you want to know.";

  return (
    <Modal onClose={onClose} title={name} subtitle={sub} width={560} align={phone ? "top" : "center"} ariaLabel={name}>
      <div data-testid="tell-steward-sheet" data-atlas="panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {err && <div role="alert" style={{ background: T.cream || "#F0EDE6", color: T.ink, borderRadius: 10, padding: "10px 12px", fontSize: 13.5, lineHeight: 1.45 }}>{err}</div>}
        {micTip && !request && <div data-testid="tell-mic-tip" style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.45 }}>{SAFARI_MIC_TIP}</div>}

        {(request || pending) && <div data-testid="atlas-said" style={{ fontSize: 13.5, color: T.ink2, background: "#F0EDE6", borderRadius: 10, padding: "10px 12px", lineHeight: 1.5 }}>"{(request && request.text) || pending.text}"</div>}

        {pending && <ul data-testid="atlas-pending" aria-live="polite" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {pending.lines.map(l => <li key={l} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, color: T.ink }}>
            <span aria-hidden className="atlas-spin" style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid " + T.bg3, borderTopColor: T.greenDk, animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
            {l}</li>)}
          <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
        </ul>}

        {!request && !pending && <>
          {!speech && (
            <button type="button" data-testid="tell-snap-check" onClick={snapCheck}
              style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 8, background: T.white, border: "1px solid " + T.ink, borderRadius: 10, padding: "8px 14px", color: T.ink, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              <Camera size={18} /> Snap a check
            </button>
          )}
          {speech && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <span style={{ width: 56 }} aria-hidden="true" />
              <button data-testid="tell-mic" aria-pressed={listening} aria-label={listening ? "Stop listening" : "Start listening"}
                onPointerDown={onDown} onPointerUp={onUp} onContextMenu={e => e.preventDefault()}
                style={{ width: 96, height: 96, borderRadius: "50%", border: "none", background: listening ? T.gold500 || "#C9A84C" : T.greenDk, color: T.white,
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", touchAction: "none", boxShadow: listening ? "0 0 0 8px rgba(201,168,76,0.25)" : "none" }}>
                <MicGlyph size={38} />
              </button>
              <button type="button" data-testid="tell-snap-check" onClick={snapCheck} aria-label="Snap a check" title="Snap a check"
                style={{ width: 56, height: 56, borderRadius: "50%", border: "1px solid " + T.ink, background: T.white, color: T.ink, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Camera size={24} />
              </button>
              </div>
              <div style={{ fontSize: 13, color: T.ink3 }}>{listening ? `Listening. Release, or ${phone ? "tap" : "click"} Stop, when you're done.` : phone ? "Hold to talk, or tap and talk." : "Hold to talk, or click and talk."}</div>
              {listening && <button onClick={stop} style={btn(false)}>Stop</button>}
            </div>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: T.ink2 }}>{speech ? "What I heard (change anything before you send)" : "Tell me what happened, what to do, or ask"}</span>
            <textarea data-testid="tell-text" value={text + (interim ? (text ? " " : "") + interim : "")} rows={phone ? 6 : 4}
              onChange={e => { setText(e.target.value); setInterim(""); finalText.current = e.target.value; }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={donor ? `Lunch with ${String(donor.name).split(/\s+/)[0]} went well. Put her in the major donor journey and remind me to call in March.` : "Undine came to the Harbor Run and gave $10,000. Thank her and ask to meet in January."}
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px", fontSize: 16, lineHeight: 1.45, fontFamily: "inherit", color: T.ink, resize: "vertical" }} />
            {!speech && <span data-testid="tell-no-listen" style={{ fontSize: 12, color: T.ink3 }}>{phone ? NO_LISTEN_PHONE_LINE : NO_LISTEN_LINE}</span>}
          </label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
            {!speech && SR && <button onClick={() => setSpeech(true)} style={btn(false)}>Talk instead</button>}
            <button data-testid="tell-send" disabled={busy} onClick={() => send()} style={{ ...btn(true), flex: phone ? 1 : "0 0 auto" }}>Send</button>
          </div>
          <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>I keep no recording, only these words. I send nothing without your yes, and money waits for your tap.</div>
        </>}

        {asking && <section data-testid="atlas-questions" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 14.5, color: T.ink, fontWeight: 700 }}>{request.spoke}</div>
          {request.questions.map((q, qi) => <div key={q.id} role="group" aria-label={q.sentence} data-testid="atlas-question">
            <div style={{ fontSize: 14, color: T.ink, marginBottom: 8 }}>{q.sentence}{q.nearMiss ? <span style={{ color: T.ink3 }}> I didn't find that exact name; these are close.</span> : null}</div>
            {q.options.map((o, i) => {
              const on = answers[q.id] === o.id;
              return <button key={o.id} type="button" data-testid="atlas-choice" autoFocus={qi === 0 && i === 0} disabled={busy} onClick={() => pick(q, o.id)} aria-pressed={on}
                style={{ ...btn(false), display: "block", width: "100%", textAlign: "left", marginBottom: 6, borderColor: on ? T.greenDk : T.bg3, boxShadow: on ? "inset 3px 0 0 " + T.greenDk : "none" }}>
                <div>{o.name}</div>{o.detail && <div style={{ fontSize: 12, fontWeight: 400, color: T.ink3, marginTop: 2 }}>{o.detail}</div>}
              </button>;
            })}
            {q.more > 0 && <div style={{ fontSize: 12, color: T.ink3 }}>{q.more} more have a name like that. Say the whole name to narrow it.</div>}
          </div>)}
          <div style={{ fontSize: 12, color: T.ink3 }}>Nothing is done until you answer. Then I do all of it.</div>
        </section>}

        {request && !asking && <section data-testid="atlas-reply" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div data-testid="atlas-spoke" style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{request.undoneAt ? "Undone." : request.spoke}</div>
          {taps.length > 1 && <div data-testid="atlas-do-all" style={{ border: "1px solid " + T.greenDk, borderRadius: 10, padding: "10px 12px", display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.45, flex: "1 1 220px" }}>One tap does the {taps.length} things below that wait for you.</div>
            <button data-testid="atlas-do-all-button" disabled={busy} onClick={() => act(`/atlas/${request.id}/all`)} style={btn(true)}>Do all of this</button>
          </div>}
          <ul data-testid="atlas-lines" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
            {lines.map(l => <li key={l.id} data-testid="atlas-line" data-kind={l.kind} data-state={l.state}
              style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid " + T.bg2, fontSize: 14, lineHeight: 1.45, color: T.ink }}>
              <span aria-hidden style={{ width: 16, flexShrink: 0, textAlign: "center", fontWeight: 800, color: l.state === "done" ? T.greenDk : l.state === "waiting" ? "#C9A84C" : T.ink3 }}>{STATE_MARK[l.state] || "·"}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {linkTarget(l.link) ? <button type="button" data-testid="atlas-line-link" onClick={() => go(l.link)}
                  style={{ background: "none", border: "none", padding: 0, textAlign: "left", font: "inherit", color: l.state === "undone" ? T.ink3 : T.ink, textDecoration: l.state === "undone" ? "line-through" : "underline", textDecorationColor: T.bg3, textUnderlineOffset: 3, cursor: "pointer" }}>{l.line}</button>
                  : <span style={{ color: l.state === "refused" ? T.ink2 : T.ink }}>{l.line}</span>}
              </span>
              <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {l.undoable && <button type="button" data-testid="atlas-undo" disabled={busy} onClick={() => act(`/atlas/actions/${l.id}/undo`)} style={{ ...btn(false), minHeight: 32, padding: "4px 10px", fontSize: 12.5 }}>Undo</button>}
                {l.waits && l.kind === "draft" && <button type="button" data-testid="atlas-review" onClick={() => go(l.link)} style={{ ...btn(true), minHeight: 32, padding: "4px 10px", fontSize: 12.5 }}>Review</button>}
                {l.waits && TAP_LABEL[l.kind] && <>
                  <button type="button" data-testid={`atlas-tap-${l.kind}`} disabled={busy} onClick={() => act(`/atlas/actions/${l.id}/yes`)} style={{ ...btn(true), minHeight: 32, padding: "4px 10px", fontSize: 12.5 }}>{TAP_LABEL[l.kind]}</button>
                  <button type="button" disabled={busy} onClick={() => act(`/atlas/actions/${l.id}/no`)} style={{ ...btn(false), minHeight: 32, padding: "4px 10px", fontSize: 12.5 }}>{l.kind === "held_back" ? "Discard" : "Not now"}</button>
                </>}
              </span>
            </li>)}
          </ul>
          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap", borderTop: "1px solid " + T.bg3, paddingTop: 12 }}>
            {!request.undoneAt && lines.some(l => l.undoable) ? <button data-testid="tell-undo" disabled={busy} onClick={() => act(`/atlas/${request.id}/undo`)} style={btn(false)}>Undo all of it</button> : <span />}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={another} style={btn(false)}>Tell me more</button>
              <button data-testid="tell-done" onClick={onClose} style={btn(true)}>Done</button>
            </div>
          </div>
        </section>}
      </div>
    </Modal>
  );
}

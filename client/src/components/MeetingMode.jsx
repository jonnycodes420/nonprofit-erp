// MeetingMode.jsx · VOICE-2. "LISTEN TO THIS MEETING", LIKE GRANOLA.
//
// Before: pick who it is with (or let Steward work it out from what is said),
// read the brief, see the consent line, press Start.
// During: a small bar (listening, the time, Pause, Stop), the live transcript
// to scroll, and her own notes beside it. The browser's recognizer stops on
// its own every so often; it is restarted and each session's words are
// stitched on (shared/voiceMeeting.js), so an hour comes through whole. The
// words are saved to Steward every few seconds and to this browser on every
// change, so a closed tab or a dropped connection loses nothing.
// After: Stop hands the transcript and notes to routes/voice.js, which writes
// the summary and files it through the one memo path.
// Audio never leaves the browser's recognizer: this page only ever has text.
import { useEffect, useRef, useState } from "react";
import { T } from "./shared";
import { apiFetch, API } from "../api";
import { errorMessage } from "../lib/domainError";
import { MicGlyph } from "./TellSteward";
import { listenMode, errorStopsListening, stitch, elapsedLabel, CONSENT_LINE, ROOM_ONLY_LINE, NO_LISTEN_LINE, summarySections } from "../../../shared/voiceMeeting.js";

const SR = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null;
const SAVE_EVERY_MS = 8000;
const LOCAL_KEY = id => `steward_meeting_${id}`;
const btn = (primary) => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: "1px solid " + (primary ? T.greenDk : T.bg3),
  borderRadius: 10, padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 44, fontFamily: "inherit" });
const LABEL = { fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 };
const said = (e, f) => (e && (e.sentence || (typeof e.error === "string" && e.error.length > 14 ? e.error : null))) || errorMessage(e, f);
const local = {
  get(id) { try { return JSON.parse(localStorage.getItem(LOCAL_KEY(id)) || "null"); } catch { return null; } },
  set(id, v) { try { localStorage.setItem(LOCAL_KEY(id), JSON.stringify(v)); } catch { /* private window: the server copy still saves */ } },
  clear(id) { try { localStorage.removeItem(LOCAL_KEY(id)); } catch { /* nothing kept */ } },
};

export default function MeetingMode({ donor, resume, onFiled, onBack, PickPerson }) {
  const mode = listenMode(typeof window !== "undefined" ? window : {});
  const [who, setWho] = useState(donor || (resume && resume.people && resume.people[0]) || null);
  const [choosing, setChoosing] = useState(false);
  const [brief, setBrief] = useState(null);
  const [today, setToday] = useState([]);
  const [meeting, setMeeting] = useState(resume || null);
  const [state, setState] = useState(resume ? "paused" : "setup");   // setup | listening | paused | filing
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [canListen, setCanListen] = useState(mode.mode === "speech");
  const [now, setNow] = useState(Date.now());
  const rec = useRef(null), wantOn = useRef(false), committed = useRef(""), session = useRef(""), segments = useRef(0);
  const lastSaved = useRef(0), notesRef = useRef(""), meetingRef = useRef(resume || null), scroller = useRef(null);

  // Resume: the longer of what Steward saved and what this browser kept.
  useEffect(() => {
    if (!resume) return;
    const kept = local.get(resume.id);
    const server = resume.transcript || "";
    const t = kept && String(kept.transcript || "").length > server.length ? kept.transcript : server;
    committed.current = t; setTranscript(t);
    const n = kept && String(kept.notes || "").length > String(resume.notes || "").length ? kept.notes : (resume.notes || "");
    notesRef.current = n; setNotes(n);
    segments.current = Math.max(resume.segments || 0, (kept && kept.segments) || 0);
  }, [resume]);

  // The brief, and her meetings today to pick from.
  useEffect(() => {
    apiFetch(`/voice/meetings/brief${who ? `?donorId=${encodeURIComponent(who.id)}` : ""}`).then(r => { setBrief(r.brief || null); setToday(r.today || []); }).catch(() => {});
  }, [who]);

  useEffect(() => {
    if (state !== "listening") return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state]);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [transcript, interim]);

  // ── SAVING AS IT COMES ────────────────────────────────────────────────────
  const fullText = () => stitch(committed.current, session.current);
  function keepLocal() { const m = meetingRef.current; if (m) local.set(m.id, { transcript: fullText(), notes: notesRef.current, segments: segments.current, at: Date.now() }); }
  async function save(status) {
    const m = meetingRef.current;
    if (!m) return;
    lastSaved.current = Date.now();
    try { await apiFetch(`/voice/meetings/${m.id}`, { method: "PUT", body: JSON.stringify({ transcript: fullText(), notes: notesRef.current, segments: segments.current, ...(status ? { status } : {}) }) }); }
    catch { /* the browser copy holds it until the connection is back */ }
  }
  useEffect(() => {
    if (state !== "listening" && state !== "paused") return undefined;
    const t = setInterval(() => { if (Date.now() - lastSaved.current >= SAVE_EVERY_MS) save(); }, 2000);
    // A closing tab: one last save that outlives the page.
    const bye = () => { keepLocal(); const m = meetingRef.current; if (!m) return;
      // A keepalive body is capped near 64KB; past that the last timed save and the browser copy hold it.
      const t = fullText();
      try { fetch(`${API}/voice/meetings/${m.id}`, { method: "PUT", keepalive: true,
        headers: { "content-type": "application/json", authorization: `Bearer ${localStorage.getItem("npe_token") || ""}` },
        body: JSON.stringify({ transcript: t.length > 50000 ? undefined : t, notes: notesRef.current, segments: segments.current }) }); } catch { /* kept locally */ } };
    window.addEventListener("pagehide", bye);
    return () => { clearInterval(t); window.removeEventListener("pagehide", bye); };
  }, [state]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { wantOn.current = false; try { rec.current && rec.current.abort(); } catch { /* stopped */ } }, []);

  // ── LISTENING, WITH RESTARTS ──────────────────────────────────────────────
  function listen() {
    if (!SR) return;
    const r = new SR();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    session.current = "";
    r.onresult = e => {
      let fin = "", mid = "";
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += (fin ? " " : "") + t; else mid += t;
      }
      session.current = fin.replace(/\s+/g, " ").trim();
      setTranscript(fullText()); setInterim(mid);
      keepLocal();
    };
    r.onerror = e => {
      if (errorStopsListening(e.error)) {
        wantOn.current = false; setCanListen(false);
        setErr(mode.phone ? "This browser would not let Steward listen. Type notes instead, or use your keyboard's microphone." : `${NO_LISTEN_LINE} Your notes below are still saved.`);
      }
    };
    // The recognizer stops on its own after a while, or after a silence. Fold
    // this session's words in, and start a new one.
    r.onend = () => {
      committed.current = fullText(); session.current = ""; segments.current += 1;
      setInterim(""); setTranscript(committed.current); keepLocal();
      if (wantOn.current) setTimeout(() => { if (wantOn.current) { try { listen(); } catch { setState("paused"); } } }, 250);
    };
    rec.current = r;
    try { r.start(); } catch { setCanListen(false); }
  }
  function pauseRec() { wantOn.current = false; try { rec.current && rec.current.stop(); } catch { /* stopped */ } }

  async function start() {
    setErr("");
    try {
      const r = await apiFetch("/voice/meetings", { method: "POST", body: JSON.stringify({ consent: true, donorId: who ? who.id : undefined, notes: notesRef.current }) });
      meetingRef.current = r.meeting; setMeeting(r.meeting);
      committed.current = ""; setTranscript("");
      if (canListen) { wantOn.current = true; listen(); }
      setState("listening");
    } catch (e) { setErr(said(e, "Steward could not start the meeting.")); }
  }
  function pause() { pauseRec(); setState("paused"); setTimeout(() => save("paused"), 300); }
  function goOn() { setErr(""); if (canListen) { wantOn.current = true; listen(); } setState("listening"); save("listening"); }
  async function stop() {
    pauseRec();
    setState("filing"); setErr("");
    await new Promise(r => setTimeout(r, 400));   // the recognizer's last words
    const m = meetingRef.current;
    try {
      const r = await apiFetch(`/voice/meetings/${m.id}/stop`, { method: "POST", body: JSON.stringify({ transcript: fullText(), notes: notesRef.current, segments: segments.current }) });
      local.clear(m.id);
      onFiled({ ...r, meetingId: m.id });
    } catch (e) { setErr(said(e, "Steward could not file the meeting. Your words are saved; try Stop again.")); setState("paused"); }
  }
  async function discard() {
    const m = meetingRef.current;
    pauseRec();
    if (m) { try { await apiFetch(`/voice/meetings/${m.id}/discard`, { method: "POST", body: "{}" }); } catch { /* gone anyway */ } local.clear(m.id); }
    onBack();
  }

  const started = meeting && meeting.startedAt ? new Date(meeting.startedAt).getTime() : now;
  const running = state === "listening" || state === "paused" || state === "filing";

  return <div data-testid="meeting-mode" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {err && <div role="alert" style={{ background: "#F0EDE6", color: T.ink, borderRadius: 10, padding: "10px 12px", fontSize: 13.5, lineHeight: 1.45 }}>{err}</div>}

    {!running && <>
      <section>
        <div style={LABEL}>Who it is with</div>
        {who && !choosing && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 6 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }} data-testid="meeting-who">{who.name}</div>
          <button type="button" onClick={() => setChoosing(true)} style={{ ...btn(false), minHeight: 36, padding: "6px 12px" }}>Change</button>
        </div>}
        {!who && !choosing && <div style={{ fontSize: 13.5, color: T.ink2, marginTop: 6, lineHeight: 1.5 }}>Optional. Steward can work out who from what is said.
          <button type="button" onClick={() => setChoosing(true)} style={{ background: "none", border: "none", color: T.greenDk, fontWeight: 700, cursor: "pointer", padding: "0 0 0 6px", fontSize: 13.5 }}>Pick the person</button></div>}
        {choosing && <PickPerson busy={false} label="Find the person" onPick={(id, name) => { setWho({ id, name }); setChoosing(false); }} onBack={() => setChoosing(false)} backLabel="Cancel" />}
        {!who && !choosing && today.length > 0 && <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {today.map(mt => <button key={mt.id} type="button" data-testid="meeting-today" onClick={() => setWho(mt.people[0])} style={{ ...btn(false), textAlign: "left" }}>
            {mt.title || "Meeting"} <span style={{ fontWeight: 400, color: T.ink3 }}>· {mt.people.map(p => p.name).join(", ")}{mt.startsAt ? ` · ${new Date(mt.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}</span>
          </button>)}
        </div>}
      </section>
      {brief && <Brief brief={brief} />}
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: T.ink2 }}>Your notes (optional, keep writing during the meeting)</span>
        <textarea data-testid="meeting-notes" rows={3} value={notes} onChange={e => { setNotes(e.target.value); notesRef.current = e.target.value; }}
          placeholder="What you want to remember to ask, or anything you jot down."
          style={{ width: "100%", boxSizing: "border-box", border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px", fontSize: 15, lineHeight: 1.45, fontFamily: "inherit", color: T.ink, resize: "vertical" }} />
      </label>
      <div data-testid="meeting-consent" style={{ background: "#F0EDE6", borderRadius: 10, padding: "10px 12px", fontSize: 14, color: T.ink, lineHeight: 1.5 }}>
        <b>{CONSENT_LINE}</b> Steward never records in secret and keeps no audio, only the words.</div>
      {canListen
        ? <div data-testid="meeting-room-only" style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>{mode.phone ? "Keep the phone on the table, near whoever is talking." : ROOM_ONLY_LINE}</div>
        : <div data-testid="meeting-no-listen" style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>{mode.line || NO_LISTEN_LINE} Your notes are filed the same way when you press Stop.</div>}
      <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
        <button type="button" onClick={onBack} style={{ ...btn(false), border: "none" }}>Back</button>
        <button type="button" data-testid="meeting-start" onClick={start} style={{ ...btn(true), display: "flex", alignItems: "center", gap: 8 }}><MicGlyph size={16} />Start</button>
      </div>
    </>}

    {running && <>
      <div data-testid="meeting-bar" role="status" style={{ display: "flex", alignItems: "center", gap: 10, background: T.ink, color: T.white, borderRadius: 12, padding: "8px 10px 8px 14px", flexWrap: "wrap" }}>
        <span aria-hidden style={{ width: 10, height: 10, borderRadius: "50%", background: state === "listening" ? "#C9A84C" : "rgba(255,255,255,0.4)", boxShadow: state === "listening" ? "0 0 0 4px rgba(201,168,76,0.25)" : "none" }} />
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>{state === "filing" ? "Filing..." : state === "paused" ? "Paused" : canListen ? "Listening" : "Taking notes"}</span>
        <span data-testid="meeting-elapsed" style={{ fontSize: 13.5, fontVariantNumeric: "tabular-nums", opacity: 0.85 }}>{elapsedLabel(now - started)}</span>
        {who && <span style={{ fontSize: 13, opacity: 0.85, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1 1 80px" }}>with {who.name}</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {state === "listening" && <button type="button" data-testid="meeting-pause" onClick={pause} style={{ ...btn(false), minHeight: 36, padding: "6px 12px" }}>Pause</button>}
          {state === "paused" && <button type="button" data-testid="meeting-resume" onClick={goOn} style={{ ...btn(false), minHeight: 36, padding: "6px 12px" }}>{canListen ? "Keep listening" : "Go on"}</button>}
          <button type="button" data-testid="meeting-stop" disabled={state === "filing"} onClick={stop} style={{ ...btn(true), minHeight: 36, padding: "6px 14px", border: "1px solid #fff" }}>Stop</button>
        </span>
      </div>
      <div>
        <div style={{ ...LABEL, marginBottom: 6 }}>What Steward hears</div>
        <div data-testid="meeting-transcript" ref={scroller} tabIndex={0} aria-label="Live transcript"
          style={{ maxHeight: 220, minHeight: 90, overflowY: "auto", border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px", fontSize: 14.5, lineHeight: 1.55, color: T.ink, background: T.white }}>
          {transcript || interim ? <>{transcript}{interim ? <span style={{ color: T.ink3 }}> {interim}</span> : null}</> : <span style={{ color: T.ink3 }}>{canListen ? "Nothing yet. Start talking." : "This browser can't listen. Write your notes below."}</span>}
        </div>
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: T.ink2 }}>Your notes</span>
        <textarea data-testid="meeting-notes" rows={3} value={notes} onChange={e => { setNotes(e.target.value); notesRef.current = e.target.value; keepLocal(); }}
          style={{ width: "100%", boxSizing: "border-box", border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px", fontSize: 15, lineHeight: 1.45, fontFamily: "inherit", color: T.ink, resize: "vertical" }} />
      </label>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>
        <span>Saved as it goes. Closing the tab loses nothing. No audio is kept.</span>
        <button type="button" data-testid="meeting-discard" onClick={discard} style={{ background: "none", border: "none", padding: 0, color: T.ink3, textDecoration: "underline", cursor: "pointer", fontSize: 12 }}>Throw this meeting away</button>
      </div>
    </>}
  </div>;
}

function Brief({ brief }) {
  const rows = [
    brief.giving && ["Giving", brief.giving.text],
    brief.lastTime && ["Last time", `${brief.lastTime.date}: ${brief.lastTime.text || "a meeting"}`],
    brief.openAsk && ["Open ask", brief.openAsk.text],
    brief.lastEmail && ["Their last email", `"${brief.lastEmail.quote}"`],
    brief.unthanked && ["Not thanked yet", brief.unthanked.text],
  ].filter(Boolean);
  if (!rows.length) return <div data-testid="meeting-brief" style={{ fontSize: 13, color: T.ink3 }}>Nothing on file yet about {brief.name}: no gifts and no conversations logged.</div>;
  return <section data-testid="meeting-brief" style={{ border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px" }}>
    <div style={{ ...LABEL, marginBottom: 6 }}>Before you go in</div>
    {rows.map(([k, v]) => <div key={k} style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.5, marginBottom: 4 }}><b>{k}.</b> {v}</div>)}
  </section>;
}

// After it is filed: the summary, the transcript on the conversation (deleted
// with one click), and one question at a time about this meeting.
export function MeetingFiled({ meetingId }) {
  const [m, setM] = useState(null);
  const [show, setShow] = useState(false);
  const [q, setQ] = useState("");
  const [a, setA] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { apiFetch(`/voice/meetings/${meetingId}`).then(r => setM(r.meeting)).catch(() => {}); }, [meetingId]);
  if (!m) return null;
  const sections = m.summary ? summarySections(m.summary) : [];
  async function del() {
    setBusy(true);
    try { const r = await apiFetch(`/voice/meetings/${meetingId}/transcript`, { method: "DELETE" }); setM(r.meeting); setShow(false); setA(null); }
    catch (e) { setErr(said(e, "Steward could not delete the transcript.")); }
    setBusy(false);
  }
  async function ask(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true); setErr(""); setA(null);
    try { setA(await apiFetch(`/voice/meetings/${meetingId}/ask`, { method: "POST", body: JSON.stringify({ question: q.trim() }) })); }
    catch (e2) { setErr(said(e2, "Steward could not answer just now.")); }
    setBusy(false);
  }
  return <section data-testid="meeting-filed" style={{ border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
    <div style={LABEL}>The meeting{m.minutes ? `, about ${m.minutes} minutes` : ""}</div>
    {sections.map(([k, items]) => <div key={k}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: T.ink2 }}>{k}</div>
      <ul style={{ margin: "2px 0 0", paddingLeft: 18, fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>)}
    {err && <div role="alert" style={{ fontSize: 13, color: T.ink }}>{err}</div>}
    {m.transcriptDeletedAt
      ? <div data-testid="meeting-transcript-deleted" style={{ fontSize: 13, color: T.ink3 }}>The transcript was deleted. The summary and what it filed stay.</div>
      : <>
        <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.5 }}>The transcript is saved on the conversation{m.held ? `, with ${m.held === 1 ? "one personal detail" : `${m.held} personal details`} held back` : ""}. No audio was kept.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" data-testid="meeting-show-transcript" onClick={() => setShow(v => !v)} style={{ ...btn(false), minHeight: 36, padding: "6px 12px" }}>{show ? "Hide" : "Read"} the transcript</button>
          <button type="button" data-testid="meeting-delete-transcript" disabled={busy} onClick={del} style={{ ...btn(false), minHeight: 36, padding: "6px 12px" }}>Delete the transcript</button>
        </div>
        {show && <div data-testid="meeting-transcript-text" style={{ maxHeight: 200, overflowY: "auto", fontSize: 13.5, lineHeight: 1.55, color: T.ink2, background: "#F0EDE6", borderRadius: 10, padding: "10px 12px", whiteSpace: "pre-wrap" }}>
          {m.notes ? <><b>Your notes.</b> {m.notes}{"\n\n"}</> : null}{m.transcript || "Nothing was heard."}</div>}
        {m.ai !== "off" && <form onSubmit={ask} style={{ display: "flex", gap: 8 }}>
          <input data-testid="meeting-ask" value={q} onChange={e => setQ(e.target.value)} placeholder="Ask about this meeting: what did I promise?" aria-label="Ask about this meeting"
            style={{ flex: 1, minWidth: 0, border: "1px solid " + T.bg3, borderRadius: 10, padding: "8px 12px", fontSize: 15, fontFamily: "inherit" }} />
          <button type="submit" disabled={busy || !q.trim()} style={{ ...btn(true), minHeight: 40, padding: "6px 14px", opacity: busy || !q.trim() ? 0.6 : 1 }}>Ask</button>
        </form>}
        {a && <div data-testid="meeting-answer" style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>{a.answer}
          {(a.quotes || []).map((x, i) => <div key={i} style={{ color: T.ink3, marginTop: 4 }}>"{x}"</div>)}</div>}
      </>}
  </section>;
}

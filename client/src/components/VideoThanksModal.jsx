// PARITY-1 Part F: RECORD A VIDEO THANK-YOU.
//
// The camera, up to two minutes (it stops itself at 2:00, with the time left
// on screen), watch it back, record again, save. Saving stores the file and
// writes ONE DRAFT email to the donor with the link in it; nothing is sent
// until somebody reads the draft in Communications and presses send.
//
// Recording copies VoiceMemoModal (shared.jsx): getUserMedia, MediaRecorder,
// chunks into a Blob. A browser without MediaRecorder gets the phone's own
// camera through <input type="file" accept="video/*" capture="user">.
import { useState, useRef, useEffect } from "react";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";
import { displayDateShort } from "../../../shared/displayDate";

import { T, Modal } from "./shared";

// ── Shared consts (above every reader) ─────────────────────────────────────
const MAX_SECONDS = 120;
const MAX_BYTES = 60 * 1024 * 1024;
const ALLOWED = ["video/webm", "video/mp4"];
const CANDIDATES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4;codecs=avc1,mp4a", "video/mp4"];

function pickVideoMime() {
  for (const c of CANDIDATES) { if (window.MediaRecorder?.isTypeSupported?.(c)) return c; }
  return "";
}
const baseMime = t => String(t || "").split(";")[0].trim().toLowerCase();
const clock = s => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
const canRecord = () => typeof window !== "undefined" && !!window.MediaRecorder && !!navigator.mediaDevices?.getUserMedia;

export default function VideoThanksModal({ donor, onClose, onSaved }) {
  const [phase, setPhase] = useState("idle"); // idle|recording|recorded|saving|saved
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [playUrl, setPlayUrl] = useState(null);
  const [saved, setSaved] = useState(null);
  const [past, setPast] = useState([]);
  const liveRef = useRef(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const blobRef = useRef(null);
  const durRef = useRef(0);
  const timerRef = useRef(null);
  const streamRef = useRef(null);
  const recording = canRecord();

  useEffect(() => {
    apiFetch(`/donors/${donor.id}/video-thanks`).then(r => setPast(r.videos || [])).catch(() => {});
    return () => { clearInterval(timerRef.current); streamRef.current?.getTracks()?.forEach(t => t.stop()); };
  }, [donor.id]);
  useEffect(() => () => { if (playUrl) URL.revokeObjectURL(playUrl); }, [playUrl]);

  const stopStream = () => { streamRef.current?.getTracks()?.forEach(t => t.stop()); streamRef.current = null; };

  const stop = () => {
    clearInterval(timerRef.current);
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
  };
  const start = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
      streamRef.current = stream;
      if (liveRef.current) { liveRef.current.srcObject = stream; liveRef.current.play?.().catch(() => {}); }
      const mimeType = pickVideoMime();
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const type = baseMime(mr.mimeType || mimeType) || "video/webm";
        const blob = new Blob(chunksRef.current, { type });
        blobRef.current = blob;
        setPlayUrl(URL.createObjectURL(blob));
        setPhase("recorded");
        stopStream();
      };
      recRef.current = mr;
      mr.start(1000);
      setElapsed(0); durRef.current = 0;
      timerRef.current = setInterval(() => {
        durRef.current += 1;
        setElapsed(durRef.current);
        if (durRef.current >= MAX_SECONDS) stop();
      }, 1000);
      setPhase("recording");
    } catch {
      setError("Steward could not reach the camera. Check that this browser may use the camera and microphone.");
    }
  };
  const again = () => {
    if (playUrl) URL.revokeObjectURL(playUrl);
    setPlayUrl(null); blobRef.current = null; setElapsed(0); setPhase("idle"); setError("");
  };

  // The phone's own camera, for a browser that cannot record here.
  const onFile = async e => {
    setError("");
    const picked = e.target.files && e.target.files[0];
    if (!picked) return;
    if (!ALLOWED.includes(baseMime(picked.type))) { setError("That video is not WebM or MP4. Record it again here, or choose an MP4."); return; }
    if (picked.size > MAX_BYTES) { setError(`That video is over ${MAX_BYTES / 1024 / 1024} MB. Keep it under two minutes.`); return; }
    // The bytes, under a type this page names itself, so nothing the file
    // input said about itself reaches the player (the server checks the
    // bytes again on upload).
    const f = new Blob([await picked.arrayBuffer()], { type: baseMime(picked.type) === "video/mp4" ? "video/mp4" : "video/webm" });
    const url = URL.createObjectURL(f);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      const secs = Math.round(probe.duration || 0);
      if (secs > MAX_SECONDS + 2) { URL.revokeObjectURL(url); setError("That video is longer than two minutes. Keep it to two minutes or less."); return; }
      durRef.current = secs; setElapsed(secs);
      blobRef.current = f; setPlayUrl(url); setPhase("recorded");
    };
    probe.onerror = () => { blobRef.current = f; setPlayUrl(url); setPhase("recorded"); };
    probe.src = url;
  };

  const save = async () => {
    const blob = blobRef.current;
    if (!blob) return;
    if (blob.size > MAX_BYTES) { setError(`That video is over ${MAX_BYTES / 1024 / 1024} MB. Record a shorter one.`); return; }
    setPhase("saving"); setError("");
    try {
      const r = await apiFetch(`/donors/${encodeURIComponent(donor.id)}/video-thanks?duration=${durRef.current || ""}`, {
        method: "POST", headers: { "Content-Type": baseMime(blob.type) || "video/webm" }, body: blob,
      });
      setSaved(r);
      setPhase("saved");
      onSaved?.(r);
    } catch (e) {
      setError(e.sentence || errorMessage(e, "Steward could not save the video. Try again."));
      setPhase("recorded");
    }
  };

  const close = () => { clearInterval(timerRef.current); stopStream(); onClose?.(); };
  const left = MAX_SECONDS - elapsed;
  const btn = (primary) => ({ border: primary ? "none" : "1px solid " + T.bg3, background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink,
    borderRadius: 9, padding: "11px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 44, fontFamily: "inherit" });
  const videoBox = { width: "100%", maxHeight: "50vh", borderRadius: 10, background: T.ink, display: "block" };

  return (
    <Modal onClose={close} width={520} padding={22} ariaLabel="Record a video thank-you" dialogStyle={{ border: "1px solid " + T.bg3 }}>
      <div data-testid="video-thanks-modal">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: T.ink }}>A video thank-you for {donor.name}</div>
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: T.ink3, lineHeight: 1, minWidth: 44, minHeight: 44 }}>×</button>
        </div>
        <p style={{ fontSize: 13, color: T.ink3, margin: "0 0 12px" }}>
          Up to two minutes. Saving puts a draft email with the link in Communications; nothing is sent until you send it.
        </p>

        {phase === "saved" && saved ? (
          <div role="status" style={{ background: T.green100, border: "1px solid " + T.bg3, borderRadius: 10, padding: 14, fontSize: 14, color: T.ink }}>
            <div style={{ marginBottom: 8 }}>{saved.sentence}</div>
            <a href={saved.video.previewUrl} target="_blank" rel="noreferrer" style={{ color: T.greenDk, fontWeight: 700 }}>Open the page the donor will see</a>
            <div style={{ marginTop: 12 }}><button onClick={close} style={btn(true)}>Done</button></div>
          </div>
        ) : recording ? (
          <>
            {phase === "recorded" && playUrl
              ? <video key={playUrl} src={playUrl} controls playsInline style={videoBox} data-testid="video-thanks-preview" />
              : <video ref={liveRef} muted playsInline autoPlay style={{ ...videoBox, display: phase === "recording" ? "block" : "none" }} />}
            {phase === "recording" && (
              <div aria-live="polite" style={{ marginTop: 8, fontSize: 14, fontWeight: 700, color: left <= 15 ? T.gold : T.ink }}>
                Recording · {clock(left)} left
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              {phase === "idle" && <button onClick={start} style={btn(true)}>Start recording</button>}
              {phase === "recording" && <button onClick={stop} style={btn(true)}>Stop</button>}
              {(phase === "recorded" || phase === "saving") && <>
                <button onClick={save} disabled={phase === "saving"} style={btn(true)}>{phase === "saving" ? "Saving…" : "Save and draft the email"}</button>
                <button onClick={again} disabled={phase === "saving"} style={btn(false)}>Record again</button>
              </>}
            </div>
          </>
        ) : (
          <>
            {phase === "recorded" && playUrl && <video src={playUrl} controls playsInline style={videoBox} />}
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.ink, margin: "10px 0 6px" }}>
              This browser cannot record here. Use your camera instead:
            </label>
            <input type="file" accept="video/mp4,video/webm,video/*" capture="user" onChange={onFile}
              style={{ fontSize: 16, width: "100%" }} />
            {phase !== "idle" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <button onClick={save} disabled={phase === "saving"} style={btn(true)}>{phase === "saving" ? "Saving…" : "Save and draft the email"}</button>
            </div>}
          </>
        )}
        {error && <div role="alert" style={{ marginTop: 10, fontSize: 13, color: T.ink, background: T.bg, border: "1px solid " + T.gold, borderRadius: 8, padding: "8px 10px" }}>{error}</div>}

        {past.length > 0 && phase !== "saved" && (
          <div style={{ marginTop: 16, borderTop: "1px solid " + T.bg3, paddingTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3, marginBottom: 6 }}>Recorded before</div>
            {past.slice(0, 5).map(v => (
              <div key={v.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, color: T.ink, padding: "4px 0", flexWrap: "wrap" }}>
                <span>{displayDateShort(String(v.createdAt || "").slice(0, 10))}{v.createdByName ? `, ${v.createdByName}` : ""}</span>
                <span style={{ color: T.ink3 }}>{v.firstViewedAt ? `Watched ${displayDateShort(String(v.firstViewedAt).slice(0, 10))}` : "Not watched yet"}</span>
                <a href={v.previewUrl} target="_blank" rel="noreferrer" style={{ color: T.greenDk, fontWeight: 600 }}>Open</a>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

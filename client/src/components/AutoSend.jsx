// AutoSend.jsx · AUTO-1. A JOURNEY EMAIL STEP THAT SENDS ITSELF.
//
// Shown inside a journey (JourneyBuilder), so it is on the Journeys page and in
// Settings, Journeys alike:
//   AutoSendSteps    each email step's switch, "Send this step automatically".
//                    Off by default. Turning it on opens a confirm with the
//                    step's own words and "About N people will get this in the
//                    next 7 days"; only an owner or admin sees the switch.
//   SendingTomorrow  what goes out on its own next weekday morning, each with
//                    Skip, plus Skip all.
//   PauseAllSending  one switch for the whole organization. It takes effect at
//                    once: the send reads it before anything goes.
// The server decides everything (routes/crm.js, AUTO-1); this file asks and shows.
import { useEffect, useState } from "react";
import { T, Modal } from "./shared";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";

const CAP = { fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 };
const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: "1px solid " + (primary ? T.greenDk : T.bg3),
  borderRadius: 10, padding: "8px 14px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", minHeight: 40, fontFamily: "inherit" });
const said = (e, fallback) => (e && e.sentence) || errorMessage(e, fallback);

function Switch({ on, disabled, onClick, label, testid }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick} data-testid={testid}
      style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "none", border: "none", padding: 0, cursor: disabled ? "default" : "pointer", fontFamily: "inherit", textAlign: "left" }}>
      <span aria-hidden style={{ width: 38, height: 22, borderRadius: 11, background: on ? T.greenDk : T.bg3, position: "relative", flex: "0 0 auto", opacity: disabled ? 0.5 : 1 }}>
        <span style={{ position: "absolute", top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: 8, background: T.white }} />
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{label}</span>
    </button>
  );
}

export function AutoSendSteps({ journeyId, isAdmin, onChanged }) {
  const [steps, setSteps] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = () => apiFetch(`/journeys/${journeyId}/auto`).then(r => setSteps(r.steps || [])).catch(() => setSteps([]));
  useEffect(() => { load(); }, [journeyId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const emailSteps = (steps || []).filter(s => s.email);
  if (!emailSteps.length) return null;
  const set = async (s, on) => {
    setBusy(true); setErr("");
    try {
      await apiFetch(`/journeys/${journeyId}/steps/${s.seq}/auto`, { method: "POST", body: JSON.stringify(on ? { on: true, confirm: true } : { on: false }) });
      setConfirm(null); await load(); onChanged && onChanged();
    } catch (e) { setErr(said(e, "That did not change.")); }
    setBusy(false);
  };
  return (
    <div data-testid="auto-send-steps" style={{ borderTop: "1px solid " + T.bg3, padding: "14px 16px" }}>
      <div style={{ ...CAP, marginBottom: 8 }}>Sending on its own</div>
      {err && <div role="alert" style={{ fontSize: 13, color: T.ink, marginBottom: 8 }}>{err}</div>}
      {emailSteps.map(s => (
        <div key={s.seq} data-testid="auto-send-step" style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid " + T.bg2 }}>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>Step {s.seq + 1}: {s.label}</div>
            <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>
              {s.on ? `Sends itself on weekday mornings, 9 to 11 AM. Turned on by ${s.turnedOnByName || "someone here"}.`
                : s.canTurnOn ? `Off. Each email waits as a draft for someone to send.${s.template && s.template.savedByName ? ` Words saved by ${s.template.savedByName}.` : ""}`
                : s.reason}
              {s.on && s.wordsChanged ? " Its words changed after it was turned on, so nothing sends until someone turns it on again for the new words." : ""}
            </div>
          </div>
          {isAdmin && (
            <Switch on={s.on} disabled={busy || (!s.on && !s.canTurnOn)} label="Send this step automatically" testid={"auto-send-switch-" + s.seq}
              onClick={() => (s.on ? set(s, false) : setConfirm(s))} />
          )}
        </div>
      ))}
      {confirm && (
        <Modal onClose={() => setConfirm(null)} title="Send this step automatically?" width={560} ariaLabel="Send this step automatically">
          <div data-testid="auto-send-confirm" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.5 }}>
              From now on, when someone reaches step {confirm.seq + 1}, Steward sends this email to them on the next weekday morning, between 9 and 11 AM where you are. You will see who is going the night before, and you can skip anyone.
            </div>
            <div style={{ border: "1px solid " + T.bg3, borderRadius: 10, padding: "12px 14px", background: T.white }}>
              <div style={{ ...CAP, marginBottom: 4 }}>The email, as {confirm.words.sampleName} would read it</div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: T.ink, marginBottom: 6 }}>{confirm.words.subject}</div>
              <div data-testid="auto-send-words" style={{ fontSize: 13.5, color: T.ink2, lineHeight: 1.55, whiteSpace: "pre-wrap", maxHeight: 220, overflowY: "auto" }}>{confirm.words.body}</div>
            </div>
            <div data-testid="auto-send-count" style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{confirm.sentence}</div>
            <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.55 }}>
              Never sent to a client, to anyone unsubscribed, bounced, marked do not contact or deceased, to anyone who had a journey email this week, or to anyone who gave in the last 3 days. Someone whose record is missing a field this email uses gets a task for you instead.
              {confirm.demo ? " This is a demonstration organization, so nothing is actually sent." : ""}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" onClick={() => setConfirm(null)} style={btn(false)}>Cancel</button>
              <button type="button" data-testid="auto-send-confirm-on" disabled={busy} onClick={() => set(confirm, true)} style={btn(true)}>{busy ? "Turning it on..." : "Turn it on"}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function SendingTomorrow({ journeyId, isReadOnly, refresh = 0, counts }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const load = () => apiFetch(`/journeys/${journeyId}/sending-tomorrow`).then(setD).catch(() => setD(null));
  useEffect(() => { load(); }, [journeyId, refresh]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!d || (!d.sends.length && !(counts && counts.sentAutomatically))) return null;
  const act = async (path) => {
    setBusy(true); setNote("");
    try { const r = await apiFetch(path, { method: "POST", body: "{}" }); setNote(r.sentence || ""); await load(); }
    catch (e) { setNote(said(e, "That did not go through.")); }
    setBusy(false);
  };
  const n = d.sends.length;
  return (
    <div data-testid="sending-tomorrow" style={{ borderTop: "1px solid " + T.bg3, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={CAP}>Sending {d.when}</div>
        {counts && counts.sentAutomatically > 0 && <div style={{ fontSize: 12.5, color: T.ink3 }}>{counts.sentAutomatically} sent automatically so far</div>}
      </div>
      {n === 0 ? <div style={{ fontSize: 13.5, color: T.ink3 }}>Nothing is waiting to send.</div> : <>
        <div style={{ fontSize: 13.5, color: T.ink2, marginBottom: 8 }}>
          {d.demo ? `${n} would send ${d.when} at ${d.time}, but this is a demonstration organization, so nothing is sent.`
            : d.paused ? `Automatic sending is paused, so these ${n} wait.` : `${n} ${n === 1 ? "email goes" : "emails go"} ${d.when} at ${d.time}.`}
        </div>
        {d.sends.map(s => (
          <div key={s.id} data-testid="sending-tomorrow-row" style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderTop: "1px solid " + T.bg2, fontSize: 13.5 }}>
            <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><b>{s.name}</b> <span style={{ color: T.ink3 }}>· step {s.step}{s.subject ? ` · ${s.subject}` : ""}</span></span>
            {!isReadOnly && <button type="button" data-testid="sending-tomorrow-skip" disabled={busy} onClick={() => act(`/journey-sends/${s.id}/skip`)} style={{ ...btn(false), minHeight: 32, padding: "4px 12px" }}>Skip</button>}
          </div>
        ))}
        {!isReadOnly && n > 1 && <div style={{ marginTop: 8 }}><button type="button" data-testid="sending-tomorrow-skip-all" disabled={busy} onClick={() => act(`/journeys/${journeyId}/sending-tomorrow/skip-all`)} style={btn(false)}>Skip all</button></div>}
      </>}
      {note && <div style={{ fontSize: 13, color: T.ink, marginTop: 8 }}>{note}</div>}
    </div>
  );
}

export function PauseAllSending({ isAdmin }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const load = () => apiFetch("/auto-send/settings").then(setD).catch(() => setD(null));
  useEffect(() => { load(); }, []);
  if (!d || (!d.stepsOn && !d.paused)) return null;
  const flip = async () => {
    setBusy(true); setNote("");
    try { const r = await apiFetch("/auto-send/pause", { method: "POST", body: JSON.stringify({ paused: !d.paused }) }); setNote(r.sentence || ""); await load(); }
    catch (e) { setNote(said(e, "That did not change.")); }
    setBusy(false);
  };
  return (
    <div data-testid="pause-all-sending" style={{ border: "1px solid " + (d.paused ? "#C9A84C" : T.bg3), borderRadius: 12, padding: "12px 14px", margin: "0 0 16px", background: T.white }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", fontSize: 13.5, color: T.ink2, lineHeight: 1.5 }}>
          {d.paused ? `All automatic sending is paused${d.pausedByName ? ` (by ${d.pausedByName})` : ""}. Nothing sends on its own until it is turned back on.`
            : `${d.stepsOn} journey ${d.stepsOn === 1 ? "step sends" : "steps send"} automatically on weekday mornings.`}
        </div>
        {isAdmin && <Switch on={d.paused} disabled={busy} onClick={flip} label="Pause all automatic sending" testid="pause-all-switch" />}
      </div>
      {note && <div style={{ fontSize: 13, color: T.ink, marginTop: 8 }}>{note}</div>}
    </div>
  );
}

// WHY-1 — Ask Steward why, and who to call tomorrow.
//
// ONE COMPONENT for every answer, wherever it was asked (Home, Reports, a
// campaign, a donor's More menu). The shape is the server's (routes/why.js):
//   the answer in one sentence
//   the reasons, ranked by dollars, each a <Figure> that opens its rows
//   who it is about, as real links
//   one step, which plans, opens a journey or opens Log a conversation.
//     It never sends.
//   what Steward can't see, in one honest line
//
// `AskWhy` is the line at the top of Home's Thread: two one-tap questions and
// a box to type. `WhyLink` is the small "Why?" a report number carries.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, fmtFull } from "./shared";
import { Figure } from "./Figure";
import { DonorLink } from "./RecordLink";
import { LogConversationModal } from "./LogConversation";
import { errorMessage } from "../lib/domainError";

const LABEL = { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 };
const BTN = { background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const CHIP = { background: T.white, color: T.greenDk, border: "1px solid " + T.bg3, borderRadius: 999, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textAlign: "left" };
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const spell = n => (n >= 0 && n < 10 ? WORDS[n] : String(n));

export function askWhy(payload) {
  return apiFetch("/why/ask", { method: "POST", body: JSON.stringify(payload) });
}

// Take the step. Each item is its own Thread step through the route every
// plan uses (POST /donors/:id/threads); a donor who already has an open step
// keeps it and is reported, never overwritten.
async function takePlan(step) {
  let planned = 0, already = 0;
  for (const it of step.items || []) {
    try {
      await apiFetch(`/donors/${it.donorId}/threads`, { method: "POST",
        body: JSON.stringify({ label: it.label, due: step.due, ...(it.ownerId ? { ownerId: it.ownerId } : {}) }) });
      planned++;
    } catch (e) {
      if (e && (e.status === 409 || /thread_open|already has an open/i.test(String(e.message || "")))) already++;
      else throw e;
    }
  }
  const when = step.dueIn === 1 ? "tomorrow's Thread" : "the Thread";
  return `${planned === 1 ? "One step" : `${spell(planned).replace(/^./, c => c.toUpperCase())} steps`} added to ${when}.`
    + (already ? ` ${already === 1 ? "One person already had" : `${spell(already).replace(/^./, c => c.toUpperCase())} people already had`} a step, so ${already === 1 ? "theirs was" : "theirs were"} kept.` : "")
    + " Nothing was sent.";
}
async function takeJourney(step) {
  const { journeys = [] } = await apiFetch("/journeys");
  const j = journeys.find(x => x.presetKey === step.preset && !x.archivedAt);
  if (!j) return step.fallback ? takePlan(step.fallback) : "There is no journey of that kind set up yet.";
  const r = await apiFetch(`/journeys/${j.id}/apply`, { method: "POST", body: JSON.stringify({ donorIds: step.donorIds }) });
  return `${j.name} started for ${r.started === 1 ? "one person" : `${r.started} people`}${r.skipped ? `; ${r.skipped} already had a journey running` : ""}. Each step lands on the Thread the day it is due. Nothing was sent.`;
}

export function WhyAnswerBody({ answer, isReadOnly, onStepTaken }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [err, setErr] = useState("");
  const [logFor, setLogFor] = useState(null);
  useEffect(() => { setDone(""); setErr(""); }, [answer]);
  if (!answer) return null;
  if (!answer.answered) return <div data-testid="why-cant" style={{ fontSize: 15, color: T.ink2, lineHeight: 1.55 }}>{answer.sentence}</div>;
  const step = answer.step;
  const take = async () => {
    if (step.kind === "log") { setLogFor({ id: step.donorId, name: step.name }); return; }
    setBusy(true); setErr("");
    try { setDone(step.kind === "journey" ? await takeJourney(step) : await takePlan(step)); onStepTaken && onStepTaken(); }
    catch (e) { setErr(errorMessage(e, "That step could not be planned.")); }
    finally { setBusy(false); }
  };
  const money = answer.reasons.some(r => r.measure !== "count");
  return (
    <div data-testid="why-answer" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div data-testid="why-sentence" data-sentence-source={answer.sentenceSource} style={{ fontSize: 17, lineHeight: 1.5, color: T.ink, fontFamily: "'Fraunces', Georgia, serif" }}>{answer.sentence}</div>
        {answer.aiOff && <div style={{ fontSize: 12, color: T.ink3, marginTop: 4 }}>AI is turned off for your organization, so this is Steward's own wording.</div>}
      </div>

      {answer.reasons.length > 0 && <div>
        <div style={LABEL}>{money ? "Why, largest first" : "Why, most people first"}</div>
        {answer.reasons.map((r, i) => (
          <div key={r.key} data-why-reason={r.key} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "baseline", padding: "9px 2px", borderTop: i ? "1px solid " + T.bg2 : "none" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>{r.label}</div>
              <div style={{ fontSize: 12, color: T.ink3 }}>
                <Figure value={r.count} kind="count" label={`${r.label}: people`} definition={r.definition} source={r.source} variant="inline" /> {r.count === 1 ? "person" : "people"}
              </div>
            </div>
            {r.measure === "count"
              ? <span />
              : <Figure value={r.cents / 100} kind="money" label={r.label} definition={r.definition} source={r.source} variant="inline" />}
          </div>
        ))}
      </div>}

      {answer.who.length > 0 && <div>
        <div style={LABEL}>Who</div>
        {answer.who.slice(0, 10).map(w => (
          <div key={w.donorId} data-why-who={w.donorId} style={{ padding: "8px 2px", borderTop: "1px solid " + T.bg2 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <DonorLink id={w.donorId} style={{ fontWeight: 700, color: T.ink, textDecoration: "underline dotted" }}>{w.name}</DonorLink>
              {w.cents != null && <span style={{ fontSize: 13, color: T.ink2, whiteSpace: "nowrap" }}>{fmtFull(w.cents / 100)}</span>}
            </div>
            <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.45 }}>{w.reason}{w.knows ? ` ${w.knows.name} ${w.knows.why}.` : ""}</div>
          </div>
        ))}
        {answer.who.length > 10 && <div style={{ fontSize: 12, color: T.ink3, paddingTop: 6 }}>And {answer.who.length - 10} more; each reason above opens all of them.</div>}
      </div>}

      {step && !isReadOnly && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {!done && <button type="button" data-testid="why-step" disabled={busy} onClick={take} style={{ ...BTN, alignSelf: "flex-start", opacity: busy ? 0.6 : 1 }}>{busy ? "Planning…" : step.label}</button>}
        {done && <div data-testid="why-step-done" style={{ fontSize: 13, color: T.greenDk, fontWeight: 600 }}>{done}</div>}
        {err && <div style={{ fontSize: 13, color: T.ink2 }}>{err}</div>}
        {!done && <div style={{ fontSize: 12, color: T.ink3 }}>{step.kind === "log" ? "Opens Log a conversation. Nothing is sent." : "Adds steps to the Thread for a person to take. Nothing is sent."}</div>}
      </div>}

      {answer.cantSee && <div data-testid="why-cant-see" style={{ fontSize: 12.5, color: T.ink2, borderLeft: "3px solid " + T.gold, padding: "4px 0 4px 10px", lineHeight: 1.5 }}>{answer.cantSee}</div>}

      {logFor && <LogConversationModal donor={logFor} onClose={() => setLogFor(null)}
        onSaved={() => { setLogFor(null); setDone("Logged. The next step is on their Thread."); onStepTaken && onStepTaken(); }} />}
    </div>
  );
}

// The panel an answer opens in: a sheet on the right, the whole width on a phone.
export function WhyPanel({ payload, onClose, isReadOnly, onStepTaken }) {
  const [a, setA] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true; setA(null); setErr("");
    askWhy(payload).then(r => live && setA(r)).catch(e => live && setErr(errorMessage(e, "Steward could not work that out just now.")));
    return () => { live = false; };
  }, [JSON.stringify(payload)]);
  useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const title = (a && a.question && a.question.text) || payload.text || "Ask why";
  return (
    <div role="dialog" aria-modal="true" aria-label={title} data-testid="why-panel"
      style={{ position: "fixed", inset: 0, zIndex: 1200, display: "flex", justifyContent: "flex-end", background: "rgba(15,26,18,0.35)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "min(560px, 100vw)", height: "100%", overflowY: "auto", background: T.white, boxSizing: "border-box", padding: "20px 20px 32px", boxShadow: "-8px 0 30px rgba(15,26,18,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink3 }}>{title}</div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, lineHeight: 1, cursor: "pointer", color: T.ink3 }}>×</button>
        </div>
        {err && <div style={{ fontSize: 14, color: T.ink2 }}>{err}</div>}
        {!a && !err && <div style={{ fontSize: 14, color: T.ink3 }}>Working it out from your own records…</div>}
        {a && <WhyAnswerBody answer={a} isReadOnly={isReadOnly} onStepTaken={onStepTaken} />}
      </div>
    </div>
  );
}

// The line at the top of the Thread on Home.
export function AskWhy({ isReadOnly, onStepTaken }) {
  const [taps, setTaps] = useState([]);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(null);
  useEffect(() => { apiFetch("/why/questions").then(r => setTaps(r.taps || [])).catch(() => setTaps([])); }, []);
  const submit = e => { e.preventDefault(); const t = text.trim(); if (t) { setOpen({ text: t }); setText(""); } };
  return (
    <div data-testid="ask-why" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "6px 0 2px" }}>
      <span style={{ ...LABEL, marginRight: 2 }}>Ask why</span>
      {taps.map(t => <button key={t.key + (t.campaign || "")} type="button" data-why-tap={t.key} style={CHIP}
        onClick={() => setOpen({ key: t.key, ...(t.campaign ? { campaign: t.campaign } : {}) })}>{t.text}</button>)}
      <form onSubmit={submit} style={{ flex: "1 1 220px", display: "flex", minWidth: 0 }}>
        <input aria-label="Ask Steward why" data-testid="ask-why-input" value={text} onChange={e => setText(e.target.value)} placeholder="Or ask your own question"
          style={{ flex: 1, minWidth: 0, border: "1px solid " + T.bg3, borderRadius: 999, padding: "6px 12px", fontSize: 13, fontFamily: "inherit", background: T.white, color: T.ink }} />
      </form>
      {open && <WhyPanel payload={open} isReadOnly={isReadOnly} onClose={() => setOpen(null)} onStepTaken={onStepTaken} />}
    </div>
  );
}

// "Why?" beside a number that is down against last year.
export function WhyLink({ payload, label = "Why?" }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" data-testid="why-link" data-why-q={payload.key} onClick={() => setOpen(true)}
      style={{ background: "none", border: "none", padding: 0, marginLeft: 6, color: T.greenDk, fontWeight: 700, fontSize: "inherit", cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>{label}</button>
    {open && <WhyPanel payload={payload} onClose={() => setOpen(false)} />}
  </>;
}

// ASK-2 — ASK ANYTHING ABOUT YOUR OWN FILE.
//
// The box ("Ask anything about your file") opens a panel that keeps the
// thread: each question is sent with the plan before it (POST /ask), so a
// follow-up ("and last year?", "only monthly donors", "who are they?") builds
// on the last answer. An answer is one plain sentence whose every number is a
// <Figure> that opens its rows, a small table or chart for a breakdown, a line
// saying exactly what was counted, the plan in words on request, and a step.
// A why or who question comes back in Ask why's own shape and is drawn by
// WhyAnswerBody, unchanged.
//
// Suggestions under the box are the org's own most-asked questions (from the
// question log), filled out with a few starters.
import { useState, useEffect, useRef } from "react";
import { apiFetch } from "../api";
import { T, fmtFull } from "./shared";
import { Figure } from "./Figure";
import { DonorLink, RecordLink } from "./RecordLink";
import { WhyAnswerBody } from "./WhyAnswer";
import { errorMessage } from "../lib/domainError";

const LABEL = { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 };
const CHIP = { background: T.white, color: T.greenDk, border: "1px solid " + T.bg3, borderRadius: 999, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textAlign: "left" };
const BTN = { background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const INPUT = { flex: 1, minWidth: 0, border: "1px solid " + T.bg3, borderRadius: 999, padding: "8px 14px", fontSize: 14, fontFamily: "inherit", background: T.white, color: T.ink };
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const spell = n => (n >= 0 && n < 10 ? WORDS[n] : String(n));
function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

export function ask(body) {
  return apiFetch("/ask", { method: "POST", body: JSON.stringify(body) });
}

// ── THE BOX ────────────────────────────────────────────────────────────────
// `scope` pre-scopes every question: { campaign } on a campaign's page,
// { donor } on a profile, { from, to } on the calendar. `starters` replaces
// the org's suggestions where the place has its own obvious questions.
export function AskBox({ scope, isReadOnly, starters, placeholder = "Ask anything about your file", label = "Ask", onStepTaken, testid = "ask-box" }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(null);
  const [sugg, setSugg] = useState(starters || []);
  useEffect(() => {
    if (starters) return;
    apiFetch("/ask/suggestions").then(r => setSugg(r.suggestions || [])).catch(() => setSugg([]));
  }, [starters]);
  const go = t => { const q = String(t || "").trim(); if (q) { setOpen({ first: q, n: Date.now() }); setText(""); } };
  return (
    <div data-testid={testid} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", minWidth: 0 }}>
      <span style={{ ...LABEL, marginRight: 2 }}>{label}</span>
      <form onSubmit={e => { e.preventDefault(); go(text); }} style={{ flex: "1 1 260px", display: "flex", minWidth: 0 }}>
        <input aria-label="Ask anything about your file" data-testid="ask-input" value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} style={INPUT} />
      </form>
      {sugg.length > 0 && <div data-testid="ask-suggestions" style={{ display: "flex", flexWrap: "wrap", gap: 8, flexBasis: "100%" }}>
        {sugg.slice(0, 6).map(q => <button key={q} type="button" style={{ ...CHIP, fontSize: 12.5 }} onClick={() => go(q)}>{q}</button>)}
      </div>}
      {open && <AskPanel key={open.n} first={open.first} scope={scope} isReadOnly={isReadOnly} onClose={() => setOpen(null)} onStepTaken={onStepTaken} />}
    </div>
  );
}

// ── THE PANEL: A THREAD ────────────────────────────────────────────────────
export function AskPanel({ first, scope, isReadOnly, onClose, onStepTaken }) {
  const [thread, setThread] = useState([]);   // [{ q, a, err }]
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const lastPlan = () => { for (let i = thread.length - 1; i >= 0; i--) if (thread[i].a && thread[i].a.plan) return thread[i].a.plan; return null; };
  const send = async (q, prev) => {
    setBusy(true);
    setThread(t => [...t, { q, a: null }]);
    try {
      const a = await ask({ text: q, previous: prev || null, ...(scope ? { scope } : {}) });
      setThread(t => t.map((x, i) => (i === t.length - 1 ? { q, a } : x)));
    } catch (e) {
      setThread(t => t.map((x, i) => (i === t.length - 1 ? { q, err: errorMessage(e, "Steward could not work that out just now.") } : x)));
    }
    setBusy(false);
  };
  useEffect(() => { if (first) send(first, null); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current && endRef.current.scrollIntoView && endRef.current.scrollIntoView({ block: "end", behavior: "smooth" }); }, [thread.length, busy]);
  useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const followUp = q => { if (!busy && q) send(q, lastPlan()); };
  return (
    <div role="dialog" aria-modal="true" aria-label="Ask" data-testid="ask-panel"
      style={{ position: "fixed", inset: 0, zIndex: 1200, display: "flex", justifyContent: "flex-end", background: "rgba(15,26,18,0.35)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "min(600px, 100vw)", height: "100%", display: "flex", flexDirection: "column", background: T.white, boxShadow: "-8px 0 30px rgba(15,26,18,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid " + T.bg2 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink3 }}>Ask about your file</div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, lineHeight: 1, cursor: "pointer", color: T.ink3 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px", display: "flex", flexDirection: "column", gap: 22 }}>
          {thread.map((x, i) => (
            <div key={i} data-testid="ask-turn" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div data-testid="ask-question" style={{ alignSelf: "flex-end", maxWidth: "85%", background: T.bg, borderRadius: 12, padding: "8px 12px", fontSize: 14, color: T.ink }}>{x.q}</div>
              {x.err && <div style={{ fontSize: 14, color: T.ink2 }}>{x.err}</div>}
              {!x.a && !x.err && <div style={{ fontSize: 14, color: T.ink3 }}>Working it out from your own records…</div>}
              {x.a && <AskAnswer answer={x.a} isReadOnly={isReadOnly} onAsk={followUp} onStepTaken={onStepTaken} last={i === thread.length - 1} />}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <form onSubmit={e => { e.preventDefault(); const q = text.trim(); if (q) { setText(""); followUp(q); } }}
          style={{ display: "flex", gap: 8, padding: "12px 20px 16px", borderTop: "1px solid " + T.bg2 }}>
          <input aria-label="Ask a follow-up" data-testid="ask-followup" value={text} onChange={e => setText(e.target.value)}
            placeholder={thread.length ? "And last year? Only monthly donors? Who are they?" : "Ask anything about your file"} style={INPUT} />
          <button type="submit" disabled={busy || !text.trim()} style={{ ...BTN, opacity: busy || !text.trim() ? 0.5 : 1 }}>Ask</button>
        </form>
      </div>
    </div>
  );
}

// ── ONE ANSWER ─────────────────────────────────────────────────────────────
function F({ fig, variant = "inline" }) {
  if (!fig) return null;
  return <Figure variant={variant} value={fig.value} kind={fig.kind} label={fig.label} definition={fig.definition}
    source={fig.source} blank={fig.blank} abs={!!fig.abs} suffix={fig.suffix || ""} />;
}

export function AskAnswer({ answer, isReadOnly, onAsk, onStepTaken, compact = false, onUnpin, inRail = false }) {
  const [showPlan, setShowPlan] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [dash, setDash] = useState(null);
  const [allPeople, setAllPeople] = useState(false);
  if (!answer) return null;
  if (answer.kind !== "answer") return <WhyAnswerBody answer={answer} isReadOnly={isReadOnly} onStepTaken={onStepTaken} />;
  if (!answer.answered) return <div data-testid="ask-refused" style={{ fontSize: 15, color: T.ink2, lineHeight: 1.55 }}>{answer.sentence}</div>;
  const figs = answer.figures || {};
  const plan = answer.plan;
  const pin = async () => {
    setBusy("pin"); setNote("");
    try { const r = await apiFetch("/ask/pins", { method: "POST", body: JSON.stringify({ plan, question: answer.planWords }) }); setNote(r.sentence); }
    catch (e) { setNote(errorMessage(e, "That was not pinned.")); }
    setBusy("");
  };
  const openDash = async () => {
    setNote("");
    try { const r = await apiFetch("/saved-dashboards"); setDash({ list: (r.dashboards || r || []).filter(d => d && d.id), pick: "" }); }
    catch (e) { setNote(errorMessage(e, "Your dashboards did not load.")); }
  };
  const saveDash = async () => {
    if (!dash || !dash.pick) return;
    setBusy("dash");
    try {
      await apiFetch(`/ask/save-to-dashboard`, { method: "POST", body: JSON.stringify({ dashboardId: dash.pick, plan, label: answer.planWords }) });
      setNote("Added to the dashboard. It is worked out again every time the dashboard opens."); setDash(null);
    } catch (e) { setNote(errorMessage(e, "That was not added. Only the person who made a dashboard can change it.")); }
    setBusy("");
  };
  const plan5 = async step => {
    setBusy("plan"); setNote("");
    let planned = 0, already = 0;
    for (const it of step.items || []) {
      try { await apiFetch(`/donors/${it.donorId}/threads`, { method: "POST", body: JSON.stringify({ label: it.label, due: addDays(step.dueIn || 1) }) }); planned++; }
      catch (e) { if (e && (e.status === 409 || /thread_open|already has an open/i.test(String(e.message || "")))) already++; else { setNote(errorMessage(e, "That step could not be planned.")); setBusy(""); return; } }
    }
    setNote(`${planned === 1 ? "One step" : `${spell(planned).replace(/^./, c => c.toUpperCase())} steps`} added to tomorrow's Thread.${already ? ` ${spell(already).replace(/^./, c => c.toUpperCase())} already had a step, so theirs ${already === 1 ? "was" : "were"} kept.` : ""} Nothing was sent.`);
    onStepTaken && onStepTaken();
    setBusy("");
  };
  const t = answer.table;
  const maxBar = t ? Math.max(1, ...t.rows.map(r => Math.abs(Number(r.value.value) || 0))) : 1;
  return (
    <div data-testid="ask-answer" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div data-testid="ask-sentence" style={{ fontSize: compact ? 15 : 17, lineHeight: 1.5, color: T.ink, fontFamily: "'Fraunces', Georgia, serif" }}>
        {(answer.sentenceParts || []).map((p, i) => (typeof p === "string" ? <span key={i}>{p}</span> : <F key={i} fig={figs[p.fig]} />))}
      </div>
      {answer.restatement && <div style={{ fontSize: 12.5, color: T.ink3 }}>Read as: {answer.restatement}</div>}

      {t && answer.chart === "bars" && (
        <div data-testid="ask-chart" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {t.rows.map(r => (
            <div key={r.label} style={{ display: "grid", gridTemplateColumns: "72px 1fr auto", gap: 8, alignItems: "center", fontSize: 12.5 }}>
              <span style={{ color: T.ink3 }}>{r.label}</span>
              <span style={{ height: 10, background: T.bg2, borderRadius: 99, overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: Math.max(2, Math.round((Math.abs(Number(r.value.value) || 0) / maxBar) * 100)) + "%", background: T.gold500, borderRadius: 99 }} />
              </span>
              <F fig={r.value} variant="cell" />
            </div>
          ))}
        </div>
      )}
      {t && answer.chart !== "bars" && (
        <div data-testid="ask-table" style={{ border: "1px solid " + T.bg2, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: t.compareLabel ? "minmax(0,1fr) auto auto" : "minmax(0,1fr) auto", gap: 12, padding: "8px 12px", background: T.bg, fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            <span>{t.dimension}</span><span>{answer.planWords.split(" · ")[1] || "This period"}</span>{t.compareLabel && <span>{t.compareLabel}</span>}
          </div>
          {t.rows.map(r => (
            <div key={r.label} style={{ display: "grid", gridTemplateColumns: t.compareLabel ? "minmax(0,1fr) auto auto" : "minmax(0,1fr) auto", gap: 12, padding: "7px 12px", borderTop: "1px solid " + T.bg2, fontSize: 13.5, alignItems: "center" }}>
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{r.label}</span><F fig={r.value} variant="cell" />{t.compareLabel && (r.compare ? <F fig={r.compare} variant="cell" /> : <span />)}
            </div>
          ))}
        </div>
      )}

      {answer.people && answer.people.length > 0 && (
        <div data-testid="ask-people">
          {answer.people.slice(0, compact ? 5 : allPeople ? 50 : 10).map(p => (
            <div key={p.donorId} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 2px", borderTop: "1px solid " + T.bg2, fontSize: 13.5 }}>
              <DonorLink id={p.donorId} style={{ fontWeight: 700, color: T.ink, textDecoration: "underline dotted" }}>{p.name}</DonorLink>
              <span style={{ color: T.ink2, whiteSpace: "nowrap" }}>{fmtFull(p.cents / 100)}</span>
            </div>
          ))}
          {!compact && !allPeople && answer.people.length > 10 && <button type="button" data-testid="ask-more-people" onClick={() => setAllPeople(true)}
            style={{ background: "none", border: "none", padding: "6px 0 0", color: T.greenDk, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Show {Math.min(50, answer.people.length)}</button>}
          {answer.peopleCount > answer.people.length && answer.peopleSource && (
            <div style={{ fontSize: 12.5, color: T.ink3, paddingTop: 6 }}>
              All <F fig={{ label: "The people behind this answer", value: answer.peopleCount, kind: "count", definition: "Everyone behind this answer, once each.", source: answer.peopleSource }} /> open from here.
            </div>
          )}
        </div>
      )}

      <div data-testid="ask-counted" style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>Counted: {answer.counted}</div>
      {!inRail && <div>
        <button type="button" data-testid="ask-show-plan" onClick={() => setShowPlan(v => !v)}
          style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          {showPlan ? "Hide how Steward read this" : "How Steward read this"}</button>
        {showPlan && <div data-testid="ask-plan-words" style={{ fontSize: 13, color: T.ink2, marginTop: 4 }}>{answer.planWords}</div>}
      </div>}

      {!compact && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {(answer.steps || []).filter(s => !(inRail && s.kind === "ask")).map((s, i) => s.kind === "ask"
            ? <button key={i} type="button" data-testid="ask-step-ask" style={CHIP} onClick={() => onAsk && onAsk(s.text)}>{s.label}</button>
            : s.kind === "open"
              ? <RecordLink key={i} to={s.href} data-testid="ask-step-open" style={{ ...CHIP, display: "inline-block", textDecoration: "none" }}>{s.label}</RecordLink>
              : !isReadOnly && <button key={i} type="button" data-testid="ask-step-plan" disabled={!!busy} style={BTN} onClick={() => plan5(s)}>{busy === "plan" ? "Planning…" : s.label}</button>)}
          {!isReadOnly && <button type="button" data-testid="ask-pin" disabled={!!busy} style={CHIP} onClick={pin}>{busy === "pin" ? "Pinning…" : "Pin to Home"}</button>}
          {!isReadOnly && <button type="button" data-testid="ask-save-dash" disabled={!!busy} style={CHIP} onClick={openDash}>Save to a dashboard</button>}
        </div>
      )}
      {compact && onUnpin && <div><button type="button" data-testid="ask-unpin" onClick={onUnpin} style={{ ...CHIP, padding: "3px 10px", fontSize: 12 }}>Unpin</button></div>}
      {dash && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {dash.list.length ? <>
            <select aria-label="Dashboard" value={dash.pick} onChange={e => setDash({ ...dash, pick: e.target.value })}
              style={{ border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 8px", fontSize: 13, fontFamily: "inherit" }}>
              <option value="">Choose a dashboard</option>
              {dash.list.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button type="button" style={BTN} disabled={!dash.pick || !!busy} onClick={saveDash}>Add</button>
          </> : <span style={{ fontSize: 13, color: T.ink3 }}>You have no dashboards yet. Make one in Reports, then add this to it.</span>}
          <button type="button" style={{ ...CHIP, padding: "4px 10px" }} onClick={() => setDash(null)}>Cancel</button>
        </div>
      )}
      {note && <div data-testid="ask-note" style={{ fontSize: 13, color: T.greenDk, fontWeight: 600 }}>{note}</div>}
    </div>
  );
}

// ── PINNED TO HOME ─────────────────────────────────────────────────────────
// Each pin is re-run every time Home opens, so the number is always today's.
export function PinnedAnswers({ isReadOnly }) {
  const [pins, setPins] = useState(null);
  const [answers, setAnswers] = useState({});
  const load = () => apiFetch("/ask/pins").then(r => {
    setPins(r.pins || []);
    for (const p of r.pins || []) ask({ plan: p.plan }).then(a => setAnswers(m => ({ ...m, [p.id]: a }))).catch(() => {});
  }).catch(() => setPins([]));
  useEffect(() => { load(); }, []);
  if (!pins || !pins.length) return null;
  const unpin = id => apiFetch(`/ask/pins/${id}`, { method: "DELETE" }).then(load).catch(() => {});
  return (
    <div data-testid="ask-pins" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))", gap: 12, margin: "8px 0 12px" }}>
      {pins.map(p => (
        <div key={p.id} style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 14px", minWidth: 0 }}>
          <div style={{ ...LABEL, marginBottom: 6 }}>{p.question || "Pinned answer"}</div>
          {answers[p.id] ? <AskAnswer answer={answers[p.id]} isReadOnly={isReadOnly} compact onUnpin={() => unpin(p.id)} />
            : <div style={{ fontSize: 13, color: T.ink3 }}>Working it out…</div>}
        </div>
      ))}
    </div>
  );
}

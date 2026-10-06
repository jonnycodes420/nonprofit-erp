// ASK-3 — WHY AND WHAT.
//
// Two buttons replace the Ask row on Home and on a donor's profile. Each opens
// a rail on the right with questions Steward can always answer, written from
// the org's own names (GET /ask/guided, shared/askGuide.js). Picking one shows
// its answer in the rail; under the answer are two to four follow-ups that
// belong to that answer, and under those the box for a follow-up in plain
// words. The box only ever appears inside the rail, after an answer, and only
// while AI is on: with AI off the rail says so in one line instead of showing
// a box that can only say no.
//
// The rail keeps the thread until it is closed. "Keep this thread" holds the
// questions (never the answers) so Home can open it again, worked out fresh.
// At phone width the rail is a full-screen sheet.
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../api";
import { T, fmtFull } from "./shared";
import { AskAnswer } from "./AskPanel";
import { WhyAnswerBody } from "./WhyAnswer";
import { errorMessage } from "../lib/domainError";

const LABEL = { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 };
const CHIP = { background: T.white, color: T.greenDk, border: "1px solid " + T.bg3, borderRadius: 999, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textAlign: "left", lineHeight: 1.35 };
const BTN = { background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const INPUT = { flex: 1, minWidth: 0, border: "1px solid " + T.bg3, borderRadius: 999, padding: "9px 14px", fontSize: 14, fontFamily: "inherit", background: T.white, color: T.ink };
const KEEP_KEY = "steward_ask_thread";
const MODES = { why: "Why", what: "What" };
const firstOf = n => String(n || "").trim().split(/\s+/)[0] || "them";
const BLURB = { why: "The reasons behind your numbers", what: "Results, and who to call next" };
const RAIL_CSS = `
.ask-rail { position: fixed; top: 0; right: 0; bottom: 0; width: 460px; max-width: 100vw; z-index: 1200; display: flex; flex-direction: column;
  background: ${T.white}; border-left: 1px solid ${T.bg3}; box-shadow: -10px 0 32px rgba(15,26,18,0.12); }
@media (max-width: 640px) { .ask-rail { width: 100vw; border-left: none; box-shadow: none; } }
.ask-q { display: flex; justify-content: space-between; align-items: center; gap: 12px; width: 100%; text-align: left; background: ${T.white};
  border: none; border-top: 1px solid ${T.bg2}; padding: 13px 4px; font: inherit; font-size: 15px; color: ${T.ink}; cursor: pointer; }
.ask-q:hover { background: ${T.bg}; }
.ask-q:focus-visible, .ask-btn:focus-visible { outline: 2px solid ${T.greenDk}; outline-offset: 2px; }
`;

const HERO_CSS = `
.ask-hero-box { display: flex; gap: 10px; align-items: center; background: ${T.white}; border: 1px solid ${T.bg3}; border-radius: 999px;
  padding: 6px 6px 6px 20px; box-shadow: 0 1px 2px rgba(15,26,18,0.05); }
.ask-hero-box:focus-within { border-color: ${T.greenDk}; box-shadow: 0 0 0 3px rgba(13,92,58,0.12); }
.ask-doors { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ask-door { display: flex; justify-content: space-between; align-items: center; gap: 12px; background: ${T.ground}; border: 1px solid ${T.bg2};
  border-radius: 14px; padding: 14px 18px; cursor: pointer; font: inherit; min-width: 0; transition: background .12s ease, border-color .12s ease; }
.ask-door:hover { background: ${T.white}; border-color: ${T.greenDk}; }
.ask-door:focus-visible { outline: 2px solid ${T.greenDk}; outline-offset: 2px; }
@media (max-width: 520px) { .ask-doors { grid-template-columns: 1fr; } }
`;

function readKept() {
  try { const k = JSON.parse(localStorage.getItem(KEEP_KEY) || "null"); return k && Array.isArray(k.turns) && k.turns.length ? k : null; } catch { return null; }
}
function writeKept(v) {
  try { if (v) localStorage.setItem(KEEP_KEY, JSON.stringify(v)); else localStorage.removeItem(KEEP_KEY); } catch { /* the thread still works, it just isn't kept */ }
}

// One question to the server, by the way its `go` says it is asked.
function runGo(go, { lastPlan, lastQuery, scope, context }) {
  const post = (path, body) => apiFetch(path, { method: "POST", body: JSON.stringify(body) });
  if (go.via === "why") return post("/why/ask", { key: go.key, ...(go.campaign ? { campaign: go.campaign } : {}), ...(go.donor ? { donor: go.donor } : {}), ...(go.part ? { part: go.part } : {}) });
  if (go.via === "person") return post("/ask", { person: { donor: go.donor, intent: go.intent, ...(go.campaign ? { campaign: go.campaign } : {}) } });
  if (go.plan) return post("/ask", { plan: go.plan });
  if (go.qplan) return post("/ask", { qplan: go.qplan });
  return post("/ask", { text: go.text, previous: go.thread ? lastPlan || null : null, ...(go.thread && lastQuery ? { previousQuery: lastQuery } : {}),
    ...(scope ? { scope } : {}), ...(go.thread && context ? { context } : {}) });
}

// What the thread knows, for the next question: the people the last answer
// named ("her", "them", "the top five", a first name), the person it was
// about, and the appeal it was on.
function threadContext(turns, scope) {
  const people = [], seen = new Set();
  let lastPerson = scope && scope.donor ? { id: scope.donor.id, name: scope.donor.name, intent: null } : null, campaign = null;
  let list = null;
  for (let i = turns.length - 1; i >= 0; i--) {
    const a = turns[i].a;
    if (!a || a.answered === false) continue;
    for (const p of [...(a.who || []), ...(a.people || []), ...(a.rows || [])]) {
      const id = p.donorId || p.id;
      if (id && p.name && !seen.has(id)) { seen.add(id); people.push({ id, name: p.name }); }
    }
    if (!list) list = people.slice();
  }
  for (let i = turns.length - 1; i >= 0; i--) {
    const a = turns[i].a;
    if (!a || a.answered === false) continue;
    if (!campaign) campaign = (a.campaign && a.compare && a.campaign.id) || (a.person && a.person.campaign) || null;
    if (!lastPerson || lastPerson.intent === null) {
      if (a.person) lastPerson = { id: a.person.id, name: a.person.name, intent: a.person.intent };
      else if (a.donor && a.question && a.question.key === "stopped") lastPerson = { id: a.donor.id, name: a.donor.name, intent: "stopped" };
    }
    if (campaign && lastPerson && lastPerson.intent) break;
  }
  return { people: people.slice(0, 60), list: (list || []).slice(0, 60), lastPerson, campaign };
}

// What Steward read the question as, in words, above each answer.
function readAs(a) {
  if (!a || a.answered === false) return "";
  if (a.readAs) return a.readAs;
  if (a.question && a.question.key === "stopped" && a.donor) return `${a.donor.name} · why they stopped`;
  if (a.planWords) return a.person ? `${a.person.name} · ${a.planWords.replace(/^[^·]*·\s*/, "")}` : a.planWords;
  if (a.part && a.campaign) return `${a.campaign.name} · against ${a.compare ? a.compare.name : "last year"} · one part of the change`;
  if (a.campaign) return a.compare ? `${a.campaign.name} · against ${a.compare.name}` : a.campaign.name;
  if (a.donor) return `${a.donor.name} · their record`;
  if (a.kind === "list") return (a.words || []).join(" · ");
  return "";
}

// ── THE TWO BUTTONS ────────────────────────────────────────────────────────
// `scope` is { donor: { id, name } } on a profile; nothing on Home.
export function AskButtons({ scope, isReadOnly, onStepTaken, testid = "ask-buttons", compact = false }) {
  const [open, setOpen] = useState(null);       // { mode, replay? }
  const [kept, setKept] = useState(() => (scope ? null : readKept()));
  const donor = scope && scope.donor;
  // HOME-TIDY: in Home's header the two buttons are small pills.
  const pill = mode => (
    <button key={mode} type="button" className="ask-btn" data-testid={`ask-${mode}`} onClick={() => setOpen({ mode, n: Date.now() })}
      aria-expanded={!!open && open.mode === mode} title={BLURB[mode]}
      style={{ background: T.white, border: "1px solid " + T.greenDk, color: T.greenDk, borderRadius: 999, padding: "6px 16px",
        fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Fraunces', Georgia, serif" }}>{MODES[mode]}</button>
  );
  const btn = mode => compact ? pill(mode) : (
    <button key={mode} type="button" className="ask-btn" data-testid={`ask-${mode}`} onClick={() => setOpen({ mode, n: Date.now() })}
      aria-expanded={!!open && open.mode === mode}
      style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, minWidth: 0, flex: "1 1 180px", maxWidth: 300,
        background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "10px 16px", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
      <span style={{ fontSize: 17, fontWeight: 700, color: T.greenDk, fontFamily: "'Fraunces', Georgia, serif" }}>{MODES[mode]}</span>
      <span style={{ fontSize: 12.5, color: T.ink3 }}>{donor ? (mode === "why" ? `Why ${firstOf(donor.name)}'s giving moved` : `What to do next with ${firstOf(donor.name)}`) : BLURB[mode]}</span>
    </button>
  );
  return (
    <div data-testid={testid} style={{ display: "flex", flexWrap: "wrap", gap: compact ? 8 : 10, alignItems: compact ? "center" : "stretch", minWidth: 0 }}>
      <style>{RAIL_CSS}</style>
      {btn("why")}{btn("what")}
      {kept && <button type="button" data-testid="ask-kept" onClick={() => setOpen({ mode: "thread", replay: kept.turns, n: Date.now() })}
        style={{ ...CHIP, alignSelf: "center", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        Kept thread · {kept.turns[0].text}</button>}
      {open && <AskRail key={open.n} mode={open.mode} replay={open.replay} scope={scope} isReadOnly={isReadOnly} onStepTaken={onStepTaken}
        onKept={setKept} kept={kept} onClose={() => setOpen(null)} />}
    </div>
  );
}
// ── HOME-TIDY 2 · THE ASK HERO ─────────────────────────────────────────────
// Home's call to action, under the greeting: one box to ask a question or tell
// Steward what to do, and the two doors, Why and What, each saying what it is.
// A question (ends in "?" or starts like one) opens the rail with its answer;
// anything else is an instruction and goes to Agent, where a plan is read, run
// and undone (agent.onSend). With Agent off, everything typed is a question.
const QUESTION_START = /^\s*(why|what|whats|what's|who|whom|whose|how|which|when|where|did|does|do|is|are|was|were|can|could|should|will|show me|list|tell me)\b/i;
export const isQuestion = t => /\?\s*$/.test(String(t || "")) || QUESTION_START.test(String(t || ""));
const DOORS = { why: "The reasons behind your numbers", what: "Results, and who to call next" };
export function AskHero({ isReadOnly, onStepTaken, agent }) {
  const [open, setOpen] = useState(null);
  const [text, setText] = useState("");
  const [kept, setKept] = useState(() => readKept());
  const canAgent = !!(agent && agent.available && agent.onSend);
  const narrow = typeof window !== "undefined" && window.innerWidth < 560;
  const submit = e => {
    e.preventDefault();
    const t = text.trim(); if (!t) return;
    if (canAgent && !isQuestion(t)) { agent.onSend(t); return; }
    setText("");
    setOpen({ mode: "thread", replay: [{ text: t, go: { via: "ask", text: t } }], n: Date.now() });
  };
  const door = mode => (
    <button key={mode} type="button" className="ask-door" data-testid={`ask-${mode}`} onClick={() => setOpen({ mode, n: Date.now() })}
      aria-expanded={!!open && open.mode === mode}>
      <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, textAlign: "left" }}>
        <span style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 22, lineHeight: 1.1, color: T.greenDk }}>{MODES[mode]}</span>
        <span style={{ fontSize: 13, color: T.ink3, lineHeight: 1.35 }}>{DOORS[mode]}</span>
      </span>
      <span aria-hidden="true" style={{ fontSize: 22, color: T.greenDk, lineHeight: 1 }}>›</span>
    </button>
  );
  return (
    <div data-testid="ask-hero" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <style>{RAIL_CSS + HERO_CSS}</style>
      <form onSubmit={submit} className="ask-hero-box">
        <input data-testid="ask-hero-input" value={text} onChange={e => setText(e.target.value)}
          aria-label={canAgent ? "Ask a question, or tell Steward what to do" : "Ask Steward a question"}
          placeholder={canAgent ? (narrow ? "Ask, or tell Steward…" : "Ask a question, or tell Steward what to do…") : "Ask Steward a question…"}
          style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 15.5, fontFamily: "inherit", color: T.ink, padding: "4px 2px" }} />
        <button type="submit" data-testid="ask-hero-go" disabled={!text.trim()}
          style={{ ...BTN, borderRadius: 999, padding: "9px 20px", fontSize: 14, opacity: text.trim() ? 1 : 0.45, cursor: text.trim() ? "pointer" : "not-allowed" }}>
          {text.trim() && canAgent && !isQuestion(text) ? "Go" : "Ask"}</button>
      </form>
      <div className="ask-doors">{door("why")}{door("what")}</div>
      {(agent && agent.line) || kept ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "baseline", fontSize: 12.5, color: T.ink3 }}>
          {agent && agent.line && <button type="button" data-testid="agent-daily-line" onClick={agent.onOpen}
            style={{ background: "none", border: "none", padding: 0, color: T.ink2, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>{agent.line}</button>}
          {kept && <button type="button" data-testid="ask-kept" onClick={() => setOpen({ mode: "thread", replay: kept.turns, n: Date.now() })}
            style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
            Your kept thread · {kept.turns[0].text}</button>}
        </div>
      ) : null}
      {open && <AskRail key={open.n} mode={open.mode} replay={open.replay} isReadOnly={isReadOnly} onStepTaken={onStepTaken}
        onKept={setKept} kept={kept} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ── THE RAIL ───────────────────────────────────────────────────────────────
export function AskRail({ mode: startMode, replay, scope, isReadOnly, onStepTaken, onClose, onKept, kept }) {
  const [mode, setMode] = useState(replay ? "thread" : startMode);
  const [lists, setLists] = useState(null);
  const [listErr, setListErr] = useState("");
  const [turns, setTurns] = useState([]);       // [{ text, go, a, err }]
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const donorId = scope && scope.donor ? scope.donor.id : null;

  useEffect(() => {
    apiFetch(`/ask/guided${donorId ? `?donor=${encodeURIComponent(donorId)}` : ""}`).then(setLists)
      .catch(e => setListErr(errorMessage(e, "The questions did not load.")));
  }, [donorId]);
  useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  useEffect(() => { endRef.current && endRef.current.scrollIntoView && endRef.current.scrollIntoView({ block: "end", behavior: "smooth" }); }, [turns.length, busy]);

  const lastPlan = list => { for (let i = list.length - 1; i >= 0; i--) if (list[i].a && list[i].a.plan) return list[i].a.plan; return null; };
  const lastQuery = list => { const a = list.length && list[list.length - 1].a; return a && a.qplan ? a.qplan : null; };
  const ask = async (q, base) => {
    setBusy(true); setMode("thread");
    const before = base || turns;
    setTurns([...before, { text: q.text, go: q.go }]);
    let a = null, err = "";
    try { a = await runGo(q.go, { lastPlan: lastPlan(before), lastQuery: lastQuery(before), scope: donorId ? { donor: donorId } : null, context: threadContext(before, scope) }); }
    catch (e) { err = errorMessage(e, "Steward could not work that out just now."); }
    const next = [...before, { text: q.text, go: q.go, a, err }];
    setTurns(next); setBusy(false);
    return next;
  };
  useEffect(() => {
    if (!replay) return;
    (async () => { let acc = []; for (const t of replay) acc = await ask(t, acc); })();
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const ai = !!(lists && lists.ai);
  const last = turns[turns.length - 1];
  const lastDone = last && !busy && (last.a || last.err);
  const keep = () => { const v = { turns: turns.map(t => ({ text: t.text, go: t.go })) }; writeKept(v); onKept && onKept(v); };
  const unkeep = () => { writeKept(null); onKept && onKept(null); };
  const tab = (key, label) => (
    <button key={key} type="button" role="tab" aria-selected={mode === key} data-testid={`ask-rail-tab-${key}`} onClick={() => setMode(key)}
      style={{ background: mode === key ? T.ink : "transparent", color: mode === key ? T.white : T.ink, border: "1px solid " + (mode === key ? T.ink : T.bg3),
        borderRadius: 999, padding: "5px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{label}</button>
  );
  const questions = lists && (mode === "why" || mode === "what") ? lists[mode] : null;

  // On document.body, so no stacking context on the page can sit above it.
  return createPortal(
    <aside className="ask-rail" role="dialog" aria-label={scope && scope.donor ? `Ask about ${scope.donor.name}` : "Why and What"} data-testid="ask-rail">
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 18px", borderBottom: "1px solid " + T.bg2 }}>
        <div role="tablist" style={{ display: "flex", gap: 6, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
          {tab("why", "Why")}{tab("what", "What")}{turns.length > 0 && tab("thread", `Thread · ${turns.length}`)}
        </div>
        <button type="button" aria-label="Close" data-testid="ask-rail-close" onClick={onClose}
          style={{ background: "none", border: "none", fontSize: 24, lineHeight: 1, cursor: "pointer", color: T.ink3, padding: 4 }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px 24px" }}>
        {questions !== null && mode !== "thread" && (
          <div data-testid={`ask-list-${mode}`}>
            <div style={{ ...LABEL, marginBottom: 8 }}>{scope && scope.donor ? `${MODES[mode]} · ${scope.donor.name}` : `${MODES[mode]} · ${BLURB[mode]}`}</div>
            {(questions || []).map(q => (
              <button key={q.text} type="button" className="ask-q" data-ask-q={q.text} disabled={busy} onClick={() => ask(q)}>
                <span>{q.text}</span><span aria-hidden="true" style={{ color: T.greenDk, fontWeight: 700 }}>›</span>
              </button>
            ))}
            {questions && !questions.length && <div style={{ fontSize: 14, color: T.ink2 }}>Nothing to ask here yet. Once there are gifts on file, the questions appear.</div>}
          </div>
        )}
        {!lists && !listErr && mode !== "thread" && <div style={{ fontSize: 14, color: T.ink3 }}>Finding the questions your records can answer…</div>}
        {listErr && mode !== "thread" && <div style={{ fontSize: 14, color: T.ink2 }}>{listErr}</div>}

        {mode === "thread" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {turns.map((t, i) => {
              const isLast = i === turns.length - 1;
              const a = t.a;
              const said = readAs(a);
              return (
                <div key={i} data-testid="ask-rail-turn" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div data-testid="ask-rail-question" style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{t.text}</div>
                  {said && <div data-testid="ask-rail-read-as" style={{ fontSize: 12.5, color: T.ink3 }}>{said}</div>}
                  {t.err && <div style={{ fontSize: 14, color: T.ink2 }}>{t.err}</div>}
                  {!a && !t.err && <div style={{ fontSize: 14, color: T.ink3 }}>Working it out from your own records…</div>}
                  {a && (a.kind === "answer" || a.refused
                    ? <AskAnswer answer={a} isReadOnly={isReadOnly} onAsk={x => ask({ text: x, go: { via: "ask", text: x, thread: true } })} onStepTaken={onStepTaken} inRail />
                    : a.kind === "choose"
                      ? <div data-testid="ask-choose" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <div style={{ fontSize: 15, color: T.ink, lineHeight: 1.55 }}>{a.sentence}</div>
                          {(a.candidates || []).map(c => (
                            <button key={c.donorId} type="button" data-testid="ask-candidate" disabled={busy || !isLast} onClick={() => ask({ text: c.name, go: c.go })}
                              style={{ ...CHIP, borderRadius: 10, display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontWeight: 700, color: T.ink }}>{c.name}</span>
                              <span style={{ fontSize: 12.5, fontWeight: 500, color: T.ink3 }}>
                                {[c.lastGift ? `Last gift ${fmtFull(c.lastGift.cents / 100)}, ${c.lastGift.date}` : "No gifts yet", c.city].filter(Boolean).join(" · ")}</span>
                            </button>))}
                        </div>
                    : a.answered === false
                      ? <div data-testid="ask-refused" style={{ fontSize: 15, color: T.ink2, lineHeight: 1.55 }}>{a.sentence}</div>
                      : <WhyAnswerBody answer={a} isReadOnly={isReadOnly} onStepTaken={onStepTaken} />)}
                  {isLast && a && (a.followUps || []).length > 0 && (
                    <div data-testid="ask-followups" style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 }}>
                      <div style={LABEL}>{a.answered === false ? "Steward can answer these" : "Ask next"}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {a.followUps.map(f => <button key={f.text} type="button" data-testid="ask-followup-q" disabled={busy} style={CHIP} onClick={() => ask(f)}>{f.text}</button>)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {(mode !== "thread" ? !!lists && !busy : lastDone) && (
        <div style={{ borderTop: "1px solid " + T.bg2, padding: "12px 18px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          {ai ? (
            <form data-testid="ask-chat" onSubmit={e => { e.preventDefault(); const v = text.trim(); if (v && !busy) { setText(""); ask({ text: v, go: { via: "ask", text: v, thread: true } }); } }}
              style={{ display: "flex", gap: 8 }}>
              <input aria-label="Ask a follow-up" data-testid="ask-chat-input" value={text} onChange={e => setText(e.target.value)}
                placeholder={mode === "thread" ? "Ask about this in your own words" : mode === "why" ? "Or ask why in your own words" : "Or ask your own question"} style={INPUT} />
              <button type="submit" disabled={busy || !text.trim()} style={{ ...BTN, opacity: busy || !text.trim() ? 0.5 : 1 }}>Ask</button>
            </form>
          ) : <div data-testid="ask-chat-off" style={{ fontSize: 13, color: T.ink3 }}>{turns.length ? "Follow-up questions return when AI is on." : "Questions in your own words return when AI is on."}</div>}
          {!scope && turns.length > 0 && mode === "thread" && <div style={{ display: "flex", gap: 12 }}>
            {kept && kept.turns[0].text === (turns[0] && turns[0].text)
              ? <button type="button" data-testid="ask-unkeep" onClick={unkeep} style={{ background: "none", border: "none", padding: 0, color: T.ink3, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Stop keeping this thread on Home</button>
              : <button type="button" data-testid="ask-keep" onClick={keep} style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Keep this thread on Home</button>}
          </div>}
        </div>
      )}
    </aside>,
    document.body
  );
}

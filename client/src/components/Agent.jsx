// client/src/components/Agent.jsx — FIX-1 §A. STEWARD AGENT, ITS OWN ROOM.
//
// Direction 2, the run sheet (docs/fix-1/agent-directions/): an ink desk with a
// cream sheet on it. The content lives on the sheet; the ink is the room. Brass
// is what the agent is doing, and emerald is only ever the one yes.
//
// Five views:
//   Plans      — every instruction she has given down the left with its run's
//                state; the open plan on the right as a checklist (what it read,
//                each step, its state), the confirm at the foot of the sheet.
//   Ask        — a large box and three examples in the org's own words.
//   Workflows  — the recipes, moved here from their own tab.
//   Waiting    — everything Steward prepared that waits on a person, one queue,
//                oldest first.
//   Guardrails — pause everything, what it can and cannot do in plain sentences,
//                every instruction and run, and the thirty-day undo list (moved
//                here from Settings).
//
// Two rules this screen keeps, and the suite holds it to (tests/fix1-agent):
//   · THE RUN STATE IS THE SERVER'S. The sheet reads GET /agent/runs/:id; the
//     button never believes its own guess that a run is still going.
//   · NO RAW MARKDOWN AND NO COLOUR LITERALS. Every colour is a token.
import { useState, useEffect, useMemo, useCallback } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { Workflows } from "./Workflows";
import { errorMessage } from "../lib/domainError";
import { makeT } from "../../../shared/vocabulary";
import { AGENT_TOOLS, runIsLive, stateLabel, STEP_CONFIRM, STEP_WAITS, OUTCOME_DONE, OUTCOME_WAITING } from "../../../shared/agentShape";

// ── Shared consts, above everything that reads them (the TDZ rule) ─────────
const SERIF = "'DM Serif Display',Georgia,serif";
const VIEWS = [
  { id: "plans", label: "Plans" },
  { id: "ask", label: "Ask" },
  { id: "workflows", label: "Workflows" },
  { id: "waiting", label: "Waiting for you" },
  { id: "guardrails", label: "Guardrails" },
];
const VIEW_IDS = VIEWS.map(v => v.id);
const PILL = {
  done: { background: T.ink, color: T.bg, border: "1px solid " + T.ink },
  confirm: { background: T.gold, color: T.ink, border: "1px solid " + T.gold },
  waiting: { background: "transparent", color: T.gold700, border: "1px solid " + T.gold },
  after: { background: "transparent", color: T.ink3, border: "1px solid " + T.ink3 },
};
const WAIT_KIND = {
  gift_to_confirm: "Gift to confirm",
  thank_you: "Thank-you draft",
  tribute_notice: "Tribute notice",
  renewal_note: "Note on a follow-up",
  agent_draft: "Note Steward drafted",
};
// What Steward will NOT do, in her words rather than the tool table's. Money
// is the first line because it is the line that is never crossed.
const CANNOT = {
  record_gift: "Record money on its own. When you tell it about a gift, it prepares the gift and you record it with one press, in your name.",
  refund: "Refund a gift. Moving money back to somebody is a decision a person makes, with a reason.",
  create_pledge: "Create or change a pledge. A pledge is a promise somebody made, and nobody may make one for them.",
  change_subscription: "Change, pause or cancel a monthly gift. It is the giver's money and the giver's decision.",
  issue_receipt: "Issue a tax receipt. A receipt belongs to a specific gift and comes from the path that took the money.",
};
// The tool table speaks about "her"; this screen speaks to her.
const toHer = s => String(s || "").replace(/\bSHE\b/g, "you").replace(/\bher (send )?queue\b/g, "your $1queue");
const fmtWhen = ts => {
  if (!ts) return "";
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? "today, " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
};

function useWide() {
  const [wide, setWide] = useState(() => typeof window === "undefined" || window.innerWidth > 760);
  useEffect(() => {
    const on = () => setWide(window.innerWidth > 760);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return wide;
}

// A plan's line in the list on the left: her words and where the run stands.
function planState(p) {
  const run = p.run;
  if (run && runIsLive(run)) return { word: "Running", brass: true };
  if (p.status === "set_aside") return { word: "Set aside", brass: false };
  if (p.status === "paused") return { word: "Paused", brass: false };
  if (p.status === "planned") {
    const gift = ((p.plan && p.plan.steps) || []).some(s => s.state === STEP_CONFIRM);
    return { word: gift ? "Waiting for you" : "Waiting for your yes", brass: true };
  }
  if (p.kind === "standing" && p.status === "active") return { word: "Standing · on", brass: false };
  if (run && run.status === "failed") return { word: "Did not finish", brass: false };
  if (run) {
    const done = (run.steps || []).filter(s => s.outcome === OUTCOME_DONE || s.outcome === OUTCOME_WAITING).length;
    return { word: `Done · ${done} of ${(run.steps || []).length} steps`, brass: false };
  }
  return { word: "Done", brass: false };
}

function pill(kind, children) {
  return <span style={{ display: "inline-block", fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 99,
    whiteSpace: "nowrap", ...(PILL[kind] || PILL.after) }}>{children}</span>;
}

function check(on) {
  return <span aria-hidden style={{ width: 18, height: 18, borderRadius: 4, display: "inline-block", flexShrink: 0,
    border: "1.5px solid " + (on ? T.ink : T.ink3), background: on ? T.ink : "transparent" }} />;
}

// ── THE SHEET ──────────────────────────────────────────────────────────────
// One plan, as a checklist a person could tick: what it read, each step, its
// state; the one yes at the foot.
function sheet({ item, wide, busy, isReadOnly, onConfirm, onDiscard, err }) {
  const plan = item.plan || {};
  const steps = plan.steps || [];
  const run = item.run || null;
  const live = run ? runIsLive(run) : false;
  const readCount = Array.isArray(plan.readIds) ? plan.readIds.length : null;
  const eyebrow = readCount === 1 ? "Plan · read one record"
    : readCount ? `Plan · read ${readCount} records` : "Plan · read your whole file";
  const prepared = steps.some(s => s.state === STEP_CONFIRM);
  const rows = [
    { key: "read", describes: "Read " + (plan.reads || "the records it names"), detail: plan.readDetail || "", pill: "done", label: "Done", on: true },
    ...steps.map((s, i) => {
      const r = run && run.steps ? run.steps[i] : null;
      if (r && r.outcome) {
        const kind = r.outcome === OUTCOME_DONE ? "done" : r.outcome === OUTCOME_WAITING ? "waiting" : "after";
        return { key: i, describes: s.describes, detail: s.detail || "", pill: kind, label: r.label || "Done", on: kind === "done" };
      }
      const kind = s.state === STEP_CONFIRM ? "confirm" : s.state === STEP_WAITS ? "after" : "after";
      return { key: i, describes: s.describes, detail: s.detail || "", pill: kind, label: stateLabel(s.state), on: false };
    }),
  ];
  const canRun = item.status === "planned" && !run;
  const foot = prepared
    ? "The gift is recorded in your name when you press the button. The follow-up can be undone for thirty days."
    : plan.sends > 0
      ? "Messages go out only because you signed this instruction for sending. Everything else can be undone for thirty days."
      : "Nothing is sent. Everything Steward does here can be undone for thirty days.";
  return (
    <section data-testid="agent-sheet" style={{ background: T.bg, color: T.ink, borderRadius: 14,
      padding: wide ? "28px 30px" : "20px 16px", minWidth: 0 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700, color: T.ink3 }}>{eyebrow}</div>
      <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: wide ? 26 : 22, lineHeight: 1.2, margin: "6px 0 6px" }}>{plan.summary}</h2>
      <p style={{ color: T.ink3, margin: "0 0 18px", fontSize: 15, lineHeight: 1.5 }}>“{item.text}”</p>
      <div role="table" style={{ fontSize: 14 }}>
        {wide && (
          <div role="row" style={{ display: "grid", gridTemplateColumns: "30px 1.3fr 1fr 190px", gap: 10, padding: "8px 0",
            borderBottom: "1px solid " + T.bg2, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, color: T.ink3 }}>
            <span /><span>Step</span><span>Detail</span><span>State</span>
          </div>
        )}
        {rows.map(r => (
          <div role="row" key={r.key} data-testid="agent-step" data-state={r.pill}
            style={{ display: "grid", gridTemplateColumns: wide ? "30px 1.3fr 1fr 190px" : "30px 1fr", gap: wide ? 10 : 6,
              padding: "14px 0", borderBottom: "1px solid " + T.bg2, alignItems: "start" }}>
            {check(r.on)}
            <span style={{ lineHeight: 1.45 }}>{r.describes}</span>
            {wide ? <span style={{ color: T.ink2, lineHeight: 1.45 }}>{r.detail}</span> : null}
            <span style={wide ? {} : { gridColumn: 2 }}>{pill(r.pill, r.label)}</span>
          </div>
        ))}
      </div>
      {plan.withheld > 0 && (
        <div style={{ marginTop: 12, fontSize: 13, color: T.gold700, lineHeight: 1.5 }}>
          {plan.withheld} {plan.withheld === 1 ? "step was" : "steps were"} left out because Steward could not point at the record {plan.withheld === 1 ? "it" : "they"} came from.
        </div>
      )}
      {err && <div data-testid="agent-refusal" style={{ marginTop: 14, fontSize: 13.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 10, lineHeight: 1.5 }}>{err}</div>}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 22, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, color: T.ink3, maxWidth: "44ch", lineHeight: 1.5 }}>
          {item.status === "set_aside" ? "Set aside. Nothing ran and nothing was recorded."
            : run ? (live ? "Steward is running this now." : `Ran ${fmtWhen(run.finished_at || run.started_at)}. ${run.read_summary ? "It read " + run.read_summary + "." : ""}`)
            : foot}
        </div>
        {(canRun || busy || live) && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", width: wide ? "auto" : "100%", flexDirection: wide ? "row" : "column-reverse" }}>
            {canRun && !busy && (
              <button onClick={onDiscard} disabled={isReadOnly}
                style={{ background: "transparent", border: "none", color: T.ink3, fontSize: 14, fontWeight: 700, cursor: "pointer", padding: "10px 6px" }}>
                Not this one
              </button>
            )}
            <button data-testid="agent-sheet-confirm" onClick={onConfirm} disabled={isReadOnly || busy || live || !canRun}
              style={{ background: T.greenDk, color: T.white, border: "none", borderRadius: 10, padding: "12px 20px",
                fontSize: 15, fontWeight: 700, cursor: busy || live ? "default" : "pointer", width: wide ? "auto" : "100%",
                opacity: isReadOnly ? 0.5 : 1 }}>
              {busy || live ? "Running…" : (plan.confirmLabel || "Run the plan")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

// ── THE AGENT ROOM ─────────────────────────────────────────────────────────
export function Agent({ data, isReadOnly, onNavigate, initialView, initialText = "", autoAsk = false }) {
  const wide = useWide();
  const t = useMemo(() => makeT(data?.org?.vocabulary), [data?.org?.vocabulary]);
  const [view, setView] = useState(VIEW_IDS.includes(initialView) ? initialView : (initialText ? "ask" : "plans"));
  const [plans, setPlans] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [waiting, setWaiting] = useState(null);
  const [text, setText] = useState(initialText || "");
  const [asking, setAsking] = useState(false);
  const [askErr, setAskErr] = useState("");
  const [askedId, setAskedId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [sheetErr, setSheetErr] = useState("");
  const loadPlans = useCallback(() => apiFetch("/agent/plans").then(r => {
    setPlans(r.plans || []);
    return r.plans || [];
  }).catch(() => { setPlans([]); return []; }), []);
  const loadWaiting = useCallback(() => apiFetch("/agent/waiting").then(setWaiting).catch(() => setWaiting({ count: 0, items: [] })), []);
  useEffect(() => { loadPlans(); loadWaiting(); }, [loadPlans, loadWaiting]);
  // Guardrails' state: every instruction, every run, every write with its undo.
  const [guardData, setGuardData] = useState(null);
  const [guardInstr, setGuardInstr] = useState(null);
  const [guardBusy, setGuardBusy] = useState("");
  const [guardErr, setGuardErr] = useState("");
  const loadGuard = useCallback(() => {
    apiFetch("/agent/activity").then(setGuardData).catch(() => setGuardData(null));
    apiFetch("/agent/instructions").then(setGuardInstr).catch(() => setGuardInstr(null));
  }, []);
  useEffect(() => { if (view === "guardrails") loadGuard(); }, [view, loadGuard]);
  async function guardAct(path, key) {
    if (guardBusy) return;
    setGuardBusy(key); setGuardErr("");
    try { await apiFetch(path, { method: "POST", body: "{}" }); loadGuard(); loadPlans(); }
    catch (e) { setGuardErr(errorMessage(e, "That did not work.")); }
    setGuardBusy("");
  }


  // THE SERVER SAYS WHEN A RUN IS OVER. While any run it reports is live, ask
  // again; the moment it has a finish time, stop.
  const anyLive = (plans || []).some(p => p.run && runIsLive(p.run));
  useEffect(() => {
    if (!anyLive) return undefined;
    const h = setInterval(loadPlans, 800);
    return () => clearInterval(h);
  }, [anyLive, loadPlans]);

  const ask = useCallback(async (words) => {
    const said = String(words || "").trim();
    if (!said || asking) return;
    setAsking(true); setAskErr(""); setAskedId(null);
    try {
      const r = await apiFetch("/agent/instructions", { method: "POST", body: JSON.stringify({ text: said }) });
      await loadPlans(); loadWaiting();
      setAskedId(r.id); setOpenId(r.id); setText("");
    } catch (e) {
      setAskErr(e && e.sentence ? e.sentence
        : e && e.error === "agent_unavailable" ? "Steward can prepare a gift you tell it about. Planning anything else needs drafting, which is not enabled for this organization yet."
        : e && e.error === "agent_paused" ? "Steward is paused. Turn it back on in Guardrails."
        : e && e.error === "plan_refused" ? "Steward would not plan that: it would have needed something you have not signed for."
        : errorMessage(e, "Steward could not plan that just now."));
    }
    setAsking(false);
  }, [asking, loadPlans, loadWaiting]);

  // Home's one-line entry carried her words here, and she already pressed.
  useEffect(() => { if (autoAsk && initialText) ask(initialText); /* once, on arrival */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function confirm(id) {
    if (busyId) return;
    setBusyId(id); setSheetErr("");
    try {
      const r = await apiFetch(`/agent/instructions/${id}/confirm`, { method: "POST", body: "{}" });
      // Read the run back from the server rather than trusting the answer's shape.
      if (r && r.runId) await apiFetch(`/agent/runs/${r.runId}`).catch(() => null);
    } catch (e) { setSheetErr(e && e.sentence ? e.sentence : errorMessage(e, "Steward could not run that.")); }
    await loadPlans(); loadWaiting();
    setBusyId(null);
  }
  async function discard(id) {
    try { await apiFetch(`/agent/instructions/${id}/discard`, { method: "POST", body: "{}" }); } catch { /* the list says what is true */ }
    await loadPlans(); loadWaiting();
  }

  const list = plans || [];
  const open = list.find(p => p.id === openId) || list[0] || null;
  const asked = askedId ? list.find(p => p.id === askedId) : null;
  const waitCount = waiting ? waiting.count : null;

  // Examples in HER words: her word for a giver, and a name on her own file.
  const someone = (data?.donors || []).find(d => d && d.name && d.kind === "organisation")
    || (data?.donors || []).find(d => d && d.name);
  const examples = [
    `Draft a thank-you to every ${t("giver", 1)} who gave this month`,
    someone ? `Just got a cheque from ${someone.name}, 250 dollars` : `Just got a cheque for 250 dollars from someone on file`,
    `Find the ${t("giver", 2)} who gave last year and not this year, and draft each a note`,
  ];

  const sheetFor = item => item ? (
    sheet({ item, wide, isReadOnly, busy: busyId === item.id,
      err: busyId === null && sheetErr ? sheetErr : "",
      onConfirm: () => confirm(item.id), onDiscard: () => discard(item.id) })
  ) : null;

  const askBar = (
    <form onSubmit={e => { e.preventDefault(); ask(text); }} style={{ display: "flex", gap: 10, marginBottom: 24 }}>
      <input value={text} onChange={e => setText(e.target.value)} data-testid="agent-ask-bar"
        placeholder="Tell Steward what to do, in your own words…"
        style={{ flex: 1, minWidth: 0, border: "1px solid " + T.green650, background: T.green900, color: T.bg,
          borderRadius: 12, padding: "14px 16px", fontSize: 15, fontFamily: "inherit", outline: "none" }} />
    </form>
  );

  return (
    <div data-testid="agent-room" style={{ color: T.bg, minWidth: 0, maxWidth: "100%" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap", marginBottom: 22 }}>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: wide ? 32 : 26, margin: 0, color: T.bg }}>Agent</h1>
        <div role="tablist" style={{ display: "flex", border: "1px solid " + T.green650, borderRadius: 10, overflowX: "auto", maxWidth: "100%" }}>
          {VIEWS.map((v, i) => (
            <button key={v.id} role="tab" aria-selected={view === v.id} data-testid={`agent-tab-${v.id}`}
              onClick={() => setView(v.id)}
              title={v.id === "waiting" && waiting ? waiting.definition : undefined}
              style={{ padding: "8px 14px", fontSize: 13, whiteSpace: "nowrap", cursor: "pointer", fontFamily: "inherit",
                border: "none", borderRight: i < VIEWS.length - 1 ? "1px solid " + T.green650 : "none",
                background: view === v.id ? T.gold : "transparent", color: view === v.id ? T.ink : T.sage400,
                fontWeight: view === v.id ? 700 : 500 }}>
              {v.label}{v.id === "waiting" && waitCount ? ` · ${waitCount}` : ""}
            </button>
          ))}
        </div>
      </div>

      {view === "plans" && (
        <div data-testid="agent-view-plans">
          {askBar}
          {askErr && <div data-testid="agent-refusal" style={{ margin: "-10px 0 18px", fontSize: 13.5, color: T.bg, borderLeft: "3px solid " + T.gold, paddingLeft: 10, lineHeight: 1.5 }}>{askErr}</div>}
          {plans === null ? <div style={{ color: T.sage400, fontSize: 14 }}>Loading your plans…</div>
            : !list.length ? (
              <section style={{ background: T.bg, color: T.ink, borderRadius: 14, padding: "24px 26px" }}>
                <div style={{ fontFamily: SERIF, fontSize: 22, marginBottom: 6 }}>Nothing planned yet.</div>
                <div style={{ color: T.ink3, fontSize: 14, lineHeight: 1.55 }}>Tell Steward what to do above, or open Ask for three examples. Every plan you give it will be listed here with what its run did.</div>
              </section>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: wide ? "320px minmax(0,1fr)" : "minmax(0,1fr)", gap: 24, alignItems: "start" }}>
                <div style={{ borderTop: "1px solid " + T.green650, order: wide ? 0 : 2 }}>
                  {!wide && <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: T.sage600, fontWeight: 700, padding: "12px 0 4px" }}>Everything you have asked</div>}
                  {list.map(p => {
                    const st = planState(p);
                    const on = open && open.id === p.id;
                    return (
                      <button key={p.id} data-testid="agent-plan-item" onClick={() => setOpenId(p.id)}
                        style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                          padding: "14px 4px 14px 14px", border: "none", borderBottom: "1px solid " + T.green650,
                          borderLeft: "3px solid " + (on ? T.gold : "transparent"), background: on ? T.green900 : "transparent" }}>
                        <div style={{ fontSize: 14, color: T.bg, lineHeight: 1.45 }}>{p.text}</div>
                        <div style={{ fontSize: 12, color: T.sage600, marginTop: 4 }}>
                          <span style={{ color: st.brass ? T.gold : T.sage600, fontWeight: st.brass ? 700 : 400 }}>{st.word}</span>
                          {" · "}{fmtWhen(p.created_at)}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div style={{ order: 1, minWidth: 0 }}>{sheetFor(open)}</div>
              </div>
            )}
        </div>
      )}

      {view === "ask" && (
        <div data-testid="agent-view-ask">
          <section style={{ background: T.bg, color: T.ink, borderRadius: 14, padding: wide ? "26px 30px" : "20px 16px", marginBottom: 24 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700, color: T.ink3, marginBottom: 10 }}>Ask · in your own words</div>
            <textarea data-testid="agent-ask-input" value={text} onChange={e => setText(e.target.value)} rows={wide ? 5 : 4}
              placeholder="Tell Steward what to do, in your own words…"
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid " + T.bg3, background: T.white, color: T.ink,
                borderRadius: 12, padding: "14px 16px", fontSize: 16, lineHeight: 1.5, fontFamily: "inherit", resize: "vertical" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
              <button data-testid="agent-ask-submit" onClick={() => ask(text)} disabled={asking || !text.trim() || isReadOnly}
                style={{ background: T.ink, color: T.bg, border: "none", borderRadius: 10, padding: "11px 18px", fontSize: 14,
                  fontWeight: 700, cursor: asking || !text.trim() ? "default" : "pointer", opacity: asking || !text.trim() ? 0.55 : 1 }}>
                {asking ? "Planning…" : "Show me the plan"}
              </button>
              <span style={{ fontSize: 13, color: T.ink3 }}>Nothing happens until you say so.</span>
            </div>
            <div style={{ marginTop: 20, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, color: T.ink3 }}>For example</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {examples.map(x => (
                <button key={x} data-testid="agent-example" onClick={() => setText(x)}
                  style={{ textAlign: "left", background: "transparent", border: "1px solid " + T.bg2, borderRadius: 10, padding: "10px 12px",
                    color: T.ink2, fontSize: 14, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.45 }}>
                  “{x}”
                </button>
              ))}
            </div>
            {askErr && <div data-testid="agent-refusal" style={{ marginTop: 16, fontSize: 13.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 10, lineHeight: 1.5 }}>{askErr}</div>}
          </section>
          {asked && sheetFor(asked)}
        </div>
      )}

      {view === "workflows" && (
        <div data-testid="agent-view-workflows">
          <section style={{ background: T.bg, color: T.ink, borderRadius: 14, padding: wide ? "26px 30px" : "20px 16px" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700, color: T.ink3, marginBottom: 8 }}>Workflows · the recipes</div>
            <Workflows isReadOnly={isReadOnly} onNavigate={onNavigate} embedded />
          </section>
        </div>
      )}

      {view === "waiting" && (
        waitingView({ wide, waiting, isReadOnly, busyId, onNavigate, onConfirm: confirm, onDiscard: discard })
      )}

      {view === "guardrails" && guardrails({ wide, isReadOnly, data: guardData, instr: guardInstr, busy: guardBusy, err: guardErr, act: guardAct })}
    </div>
  );
}

// ── WAITING FOR YOU ────────────────────────────────────────────────────────
function waitingView({ wide, waiting, isReadOnly, busyId, onNavigate, onConfirm, onDiscard }) {
  const items = (waiting && waiting.items) || [];
  return (
    <div data-testid="agent-view-waiting">
      <section style={{ background: T.bg, color: T.ink, borderRadius: 14, padding: wide ? "26px 30px" : "20px 16px" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700, color: T.ink3 }}>Waiting for you · oldest first</div>
        <div style={{ fontSize: 14, color: T.ink3, margin: "6px 0 14px", lineHeight: 1.5 }}>
          {waiting ? waiting.definition : "Loading…"}
        </div>
        {waiting && !items.length && <div style={{ fontFamily: SERIF, fontSize: 20 }}>Nothing is waiting on you.</div>}
        {items.map(it => (
          <div key={it.kind + it.id} data-testid="agent-waiting-item" data-kind={it.kind}
            style={{ borderTop: "1px solid " + T.bg2, padding: "14px 0", display: "grid",
              gridTemplateColumns: wide ? "180px minmax(0,1fr) auto" : "minmax(0,1fr)", gap: wide ? 16 : 8, alignItems: "start" }}>
            <div>
              {pill(it.kind === "gift_to_confirm" ? "confirm" : "waiting", WAIT_KIND[it.kind] || "Waiting")}
              <div style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>{fmtWhen(it.createdAt)}</div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.4 }}>{it.title}</div>
              {it.who && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>{it.who}</div>}
              {it.body && <div style={{ fontSize: 13.5, color: T.ink2, marginTop: 6, lineHeight: 1.5, whiteSpace: "pre-wrap",
                overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>{it.body}</div>}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: wide ? "flex-end" : "flex-start" }}>
              {it.kind === "gift_to_confirm" ? (<>
                <button onClick={() => onDiscard(it.id)} disabled={isReadOnly || !!busyId}
                  style={{ background: "transparent", border: "none", color: T.ink3, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Not this one</button>
                <button onClick={() => onConfirm(it.id)} disabled={isReadOnly || !!busyId}
                  style={{ background: T.greenDk, color: T.white, border: "none", borderRadius: 9, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  {busyId === it.id ? "Running…" : it.confirmLabel}
                </button>
              </>) : it.donorId ? (
                <button onClick={() => onNavigate && onNavigate("donors", { selectDonorId: it.donorId })}
                  style={{ background: "transparent", border: "1px solid " + T.ink3, borderRadius: 9, padding: "8px 12px", color: T.ink, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  Open the record
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

// ── GUARDRAILS ─────────────────────────────────────────────────────────────
// Pause everything; what it can and cannot do, in sentences; every instruction
// and every run; and every change it made, with an undo for thirty days. The
// undo list moved here from Settings → Steward's activity (BUILD-97 Part 3).
// A plain function over state the room holds (see guard* in Agent), so the
// view is drawn, never mounted twice with its own copy of the truth.
function guardrails({ wide, isReadOnly, data, instr, busy, err, act }) {
  const pausedAll = !!(instr && instr.pausedAll);
  const can = AGENT_TOOLS.filter(x => x.needsHuman === "never");
  const signature = AGENT_TOOLS.filter(x => x.needsHuman === "signature");
  const cannot = AGENT_TOOLS.filter(x => x.needsHuman === "always");
  const card = { background: T.bg, color: T.ink, borderRadius: 14, padding: wide ? "24px 28px" : "18px 16px", marginBottom: 18 };
  const eyebrow = { fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700, color: T.ink3, marginBottom: 10 };
  const small = { background: "transparent", border: "1px solid " + T.bg3, borderRadius: 7, padding: "4px 10px", color: T.ink2, fontSize: 12, fontWeight: 700, cursor: isReadOnly ? "not-allowed" : "pointer" };
  return (
    <div data-testid="agent-view-guardrails">
      <section style={{ ...card, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", borderLeft: "4px solid " + (pausedAll ? T.gold : T.ink) }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div data-testid="agent-pause-state" style={{ fontFamily: SERIF, fontSize: 22, marginBottom: 4 }}>
            {pausedAll ? "Steward is paused." : "Steward is running."}
          </div>
          <div style={{ fontSize: 13.5, color: T.ink3, lineHeight: 1.55 }}>
            {pausedAll ? "No instruction will run and nothing will be drafted until you turn it back on."
              : "Instructions you have turned on will run. Nothing reaches a donor without you."}
          </div>
        </div>
        <button data-testid="agent-pause-all" disabled={isReadOnly || !!busy}
          onClick={() => act(pausedAll ? "/agent/resume-all" : "/agent/pause-all", "all")}
          style={{ background: pausedAll ? T.greenDk : "transparent", color: pausedAll ? T.white : T.ink,
            border: pausedAll ? "none" : "1px solid " + T.ink, borderRadius: 9, padding: "10px 18px", fontSize: 14, fontWeight: 700,
            cursor: isReadOnly ? "not-allowed" : "pointer", opacity: isReadOnly ? 0.5 : 1 }}>
          {pausedAll ? "Turn Steward back on" : "Pause everything"}
        </button>
      </section>
      {err && <div style={{ ...card, borderLeft: "4px solid " + T.gold, fontSize: 13.5 }}>{err}</div>}

      <div style={{ display: "grid", gridTemplateColumns: wide ? "1fr 1fr" : "1fr", gap: 18 }}>
        <section style={{ ...card, marginBottom: 0 }}>
          <div style={eyebrow}>What Steward does on its own</div>
          {can.map(x => (
            <div key={x.name} data-testid="agent-can" style={{ fontSize: 14, lineHeight: 1.5, padding: "8px 0", borderTop: "1px solid " + T.bg2 }}>{toHer(x.what)}</div>
          ))}
          {signature.map(x => (
            <div key={x.name} data-testid="agent-can" style={{ fontSize: 14, lineHeight: 1.5, padding: "8px 0", borderTop: "1px solid " + T.bg2 }}>
              {toHer(x.what)} Only when you have signed that one instruction for sending.
            </div>
          ))}
        </section>
        <section style={{ ...card, marginBottom: 0 }}>
          <div style={eyebrow}>What Steward never does</div>
          {cannot.map(x => (
            <div key={x.name} data-testid="agent-cannot" style={{ fontSize: 14, lineHeight: 1.5, padding: "8px 0", borderTop: "1px solid " + T.bg2 }}>
              {CANNOT[x.name] || x.what}
            </div>
          ))}
        </section>
      </div>

      <section style={{ ...card, marginTop: 18 }}>
        <div style={eyebrow}>What you have told Steward to do</div>
        {!instr || !instr.instructions.length ? (
          <div style={{ fontSize: 13.5, color: T.ink3 }}>Nothing yet. Tell Steward what to do from Ask.</div>
        ) : instr.instructions.map(i => (
          <div key={i.id} data-testid="agent-instruction" style={{ borderTop: "1px solid " + T.bg2, padding: "10px 0" }}>
            <div style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 4 }}>“{i.text}”</div>
            <div style={{ fontSize: 12.5, color: T.ink3, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span>{i.kind === "standing" ? "Standing" : "One-off"}</span><span>·</span>
              <span data-testid="agent-instruction-status">{i.status === "set_aside" ? "set aside" : i.status}</span>
              {i.turned_on_by_name && <><span>·</span><span>turned on by {i.turned_on_by_name}</span></>}
              <span>·</span>
              <span data-testid="agent-instruction-auth" style={{ color: i.send_authorization === "send" ? T.gold700 : T.ink3 }}>
                {i.send_authorization === "send" ? "signed for sending" : "drafts only"}
              </span>
              {i.status !== "done" && i.status !== "set_aside" && i.status !== "planned" && (
                <button disabled={isReadOnly || !!busy} style={{ ...small, marginLeft: "auto" }}
                  onClick={() => act(`/agent/instructions/${i.id}/${i.status === "paused" ? "resume" : "pause"}`, i.id)}>
                  {i.status === "paused" ? "Resume" : "Pause"}
                </button>
              )}
            </div>
          </div>
        ))}
      </section>

      <section style={card}>
        <div style={eyebrow}>Every run</div>
        {!data || !data.runs.length ? <div style={{ fontSize: 13.5, color: T.ink3 }}>Steward has not run anything yet.</div>
          : data.runs.map(r => (
            <div key={r.id} data-testid="agent-run" style={{ borderTop: "1px solid " + T.bg2, padding: "10px 0" }}>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}>{r.instruction_text || "(instruction removed)"}</div>
              <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 4, lineHeight: 1.5 }}>
                {fmtWhen(r.started_at)} · read {r.read_summary || "nothing"} · drafted {r.drafted} · sent {r.sent} · declined {r.declined} · withheld {r.withheld}
              </div>
              {r.withheld_reason && <div data-testid="agent-run-withheld" style={{ fontSize: 12.5, color: T.gold700, marginTop: 4 }}>{r.withheld_reason}</div>}
              {r.error && <div style={{ fontSize: 12.5, color: T.gold700, marginTop: 4 }}>{r.error}</div>}
            </div>
          ))}
      </section>

      <section style={card}>
        <div style={eyebrow}>Everything Steward changed</div>
        <div style={{ fontSize: 13.5, color: T.ink3, marginBottom: 10, lineHeight: 1.55 }}>
          Anything here can be undone for {data ? data.undoDays : 30} days. A gift you recorded is yours, not Steward’s, and is changed on the gift itself.
        </div>
        {!data || !data.writes.length ? <div style={{ fontSize: 13.5, color: T.ink3 }}>Steward has not changed anything.</div>
          : data.writes.slice(0, 60).map(w => (
            <div key={w.id} data-testid="agent-write" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: T.ink2,
              borderTop: "1px solid " + T.bg2, padding: "8px 0", flexWrap: "wrap" }}>
              <span style={{ color: T.ink, fontWeight: 700 }}>{w.tool.replace(/_/g, " ")}</span>
              <span>·</span><span>{w.entity_table}</span>
              <span>·</span><span>{fmtWhen(w.created_at)}</span>
              {w.undone_at
                ? <span data-testid="agent-write-undone" style={{ marginLeft: "auto", color: T.ink3 }}>undone{w.undone_by_name ? ` by ${w.undone_by_name}` : ""}</span>
                : w.undoable
                  ? <button data-testid="agent-undo" disabled={isReadOnly || !!busy} style={{ ...small, marginLeft: "auto" }}
                      onClick={() => act(`/agent/writes/${w.id}/undo`, w.id)}>Undo</button>
                  : <span style={{ marginLeft: "auto", color: T.ink3 }}>past the undo window</span>}
            </div>
          ))}
      </section>
    </div>
  );
}

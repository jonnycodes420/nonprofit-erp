// client/src/components/Agent.jsx — FIX-1 §A, rebuilt to Direction 2 in FIX-2 D.
//
// Direction 2, the run sheet (docs/fix-1/agent-directions/, Jonathan's pick):
// the CREAM SHEET TAKES THE ROOM and ink is only the margin around it. The
// content lives on the sheet: the views as a tab row along its top edge, the
// instructions she has given down its left with each run's state, the open plan
// as a checklist on its right with the confirm at the foot. Brass is what the
// agent is doing; emerald is only ever the one yes.
//
// Five views:
//   Plans      — every instruction she has given down the left with its run's
//                state; the open plan on the right as a checklist (what it read,
//                each step, its state), the confirm at the foot.
//   Ask        — a large box and three examples in the org's own words.
//   Workflows  — the recipes, moved here from their own tab.
//   Waiting    — everything Steward prepared that waits on a person, one queue,
//                oldest first.
//   Guardrails — pause everything, drafting on or off (the org's switch, the
//                same control and write as Settings → Data), what it can and
//                cannot do in plain sentences, every instruction and run, and
//                the thirty-day undo list.
//
// FIX-2 D — DRAFTING OFF IS NOT A DEAD END. When drafting is off the sheet says
// what Steward can do now, what drafting would add, and either offers Turn on
// drafting (an admin: it opens the switch in Guardrails) or names who can. When
// the server has no ANTHROPIC_API_KEY it says THAT, in one line, and never
// blames the organisation. A READ (open a report, find a person, count,
// explain a number) needs no drafting: the server answers it and writes nothing.
//
// Rules this screen keeps (tests/fix1-agent, tests/fix2-d-agent):
//   · THE RUN STATE IS THE SERVER'S. The sheet reads GET /agent/runs/:id; the
//     button never believes its own guess that a run is still going.
//   · NO RAW MARKDOWN AND NO COLOUR LITERALS. Every colour is a token.
import { useState, useEffect, useMemo, useCallback } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { Workflows } from "./Workflows";
import { errorMessage } from "../lib/domainError";
import { makeT } from "../../../shared/vocabulary";
import { displayDateShort } from "../../../shared/displayDate";
import { AGENT_TOOLS, runIsLive, runProgress, stateLabel, STEP_CONFIRM, STEP_WAITS, OUTCOME_DONE, OUTCOME_WAITING, OUTCOME_FAILED } from "../../../shared/agentShape";
import { DonorLink } from "./RecordLink";
import { offerUndo } from "./EditHistory";
import { TemplateStart } from "./TemplateStart";
import { AgentDraftReview } from "./AgentDraftReview";

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
  // AGENT-2: it ran and the result is not there. Brass, never red: red is
  // only for a destructive confirm.
  failed: { background: "transparent", color: T.gold700, border: "1px dashed " + T.gold700 },
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
const EYEBROW = { fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700, color: T.ink3 };
// ── FIX-8 Part C · THE STAFF MARKS ─────────────────────────────────────────
// A monogram apiece, drawn from the four colours and nothing else: ink,
// emerald, brass on its wash, and cream on ink. No fifth hue arrives to mark
// a seventh persona; the list wraps, which is the point of keeping it short.
const MARK = [
  { bg: T.greenDk,  fg: T.white },
  { bg: T.ink,      fg: T.bg    },
  { bg: T.gold100,  fg: T.gold700 },
  { bg: T.bg2,      fg: T.ink   },
  { bg: T.greenDk,  fg: T.white },
  { bg: T.gold100,  fg: T.gold700 },
];
// "Steward Data" → "SD", "Writer" → "W". Two letters at most, so the mark
// stays a mark rather than becoming a label.
const monogram = name => String(name || "").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase();

// AGENTS-1 — the badge that says which of the six. Quiet by design: it labels
// a row, it is not a thing to click, and it is never the emerald on a screen.
const PERSONA_BADGE = { display: "inline-block", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em",
  textTransform: "uppercase", color: T.ink3, background: T.bg2, border: "1px solid " + T.bg3,
  borderRadius: 99, padding: "2px 8px", whiteSpace: "nowrap" };
const personaBadge = name => (name
  ? <span data-testid="agent-persona-badge" style={PERSONA_BADGE}>{name}</span>
  : null);
// A panel ON the sheet: white on cream, a hairline, never a second dark card.
const PANEL = { background: T.white, color: T.ink, border: "1px solid " + T.bg2, borderRadius: 12 };
const OUTLINE_BTN = { background: "transparent", color: T.ink, border: "1.5px solid " + T.ink, borderRadius: 10,
  padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const YES_BTN = { background: T.greenDk, color: T.white, border: "none", borderRadius: 10, padding: "12px 20px",
  fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const REFUSAL = { fontSize: 13.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 10, lineHeight: 1.5 };
// FIX-3 B — THE GO BUTTON. Always drawn beside the box, so there is never a
// question of how to send it: emerald (the one action colour) once there are
// words to plan, and a quiet disabled button until then.
const GO_OFF = { background: T.bg2, color: T.ink3, border: "1px solid " + T.bg3, borderRadius: 10, padding: "12px 20px",
  fontSize: 15, fontWeight: 700, cursor: "default", fontFamily: "inherit" };
// The tool table speaks about "her"; this screen speaks to her.
const toHer = s => String(s || "").replace(/\bSHE\b/g, "you").replace(/\bher (send )?queue\b/g, "your $1queue");
const localYmd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtWhen = ts => {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? "today, " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : displayDateShort(localYmd(d), localYmd(today));
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
    // The sheet lists the read first, and it is always done: count it, so the
    // list and the sheet agree (FIX-2 handoff §6: "2 of 2" beside three rows).
    // WIRE-1-ADDENDUM: one rule (agentShape.runProgress), and a draft waiting
    // for her is not done: "Waiting for you · 1 of 22 done", never "Done · 22 of 22".
    const pr = runProgress(run.steps || []);
    return { word: pr.word, brass: pr.brass };
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

// ── THE OPEN PLAN ──────────────────────────────────────────────────────────
// One plan, as a checklist a person could tick: what it read, each step, its
// state; the one yes at the foot.
function sheet({ item, wide, busy, isReadOnly, onConfirm, onDiscard, onReviewAll, err }) {
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
        const kind = r.outcome === OUTCOME_DONE ? "done" : r.outcome === OUTCOME_WAITING ? "waiting" : r.outcome === OUTCOME_FAILED ? "failed" : "after";
        return { key: i, describes: s.describes, detail: s.detail || "", pill: kind, label: r.label || "Done", on: kind === "done" };
      }
      const kind = s.state === STEP_CONFIRM ? "confirm" : s.state === STEP_WAITS ? "after" : "after";
      return { key: i, describes: s.describes, detail: s.detail || "", pill: kind, label: stateLabel(s.state), on: false };
    }),
  ];
  const canRun = item.status === "planned" && !run;
  const draftsWaiting = run && !live ? (run.steps || []).filter(x => x.tool === "draft_note" && x.outcome === OUTCOME_WAITING).length : 0;
  const foot = prepared
    ? "The gift is recorded in your name when you press the button. The follow-up can be undone for thirty days."
    : plan.sends > 0
      ? "Messages go out only because you signed this instruction for sending. Everything else can be undone for thirty days."
      : "Nothing is sent. Everything Steward does here can be undone for thirty days.";
  return (
    <section data-testid="agent-sheet" style={{ ...PANEL, padding: wide ? "26px 28px" : "18px 16px", minWidth: 0 }}>
      <div style={EYEBROW}>{eyebrow}</div>
      <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: wide ? 26 : 22, lineHeight: 1.2, margin: "6px 0 6px", overflowWrap: "anywhere" }}>{plan.summary}</h2>
      <p style={{ color: T.ink3, margin: "0 0 18px", fontSize: 15, lineHeight: 1.5, overflowWrap: "anywhere" }}>“{item.text}”</p>
      {/* AGENT-2: what Steward cannot do, said first, never a note in its place. */}
      {plan.cannot && <div data-testid="agent-cannot" style={{ ...REFUSAL, margin: "0 0 16px" }}>{plan.cannot}</div>}
      <div role="table" style={{ fontSize: 14 }}>
        {wide && (
          <div role="row" style={{ display: "grid", gridTemplateColumns: "30px 1.3fr 1fr 190px", gap: 10, padding: "8px 0",
            borderBottom: "1px solid " + T.bg2, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, color: T.ink3 }}>
            <span /><span>Step</span><span>Detail</span><span>State</span>
          </div>
        )}
        {rows.map(r => (
          <div role="row" key={r.key} data-testid="agent-step" data-state={r.pill}
            style={{ display: "grid", gridTemplateColumns: wide ? "30px 1.3fr 1fr 190px" : "30px minmax(0,1fr)", gap: wide ? 10 : 6,
              padding: "14px 0", borderBottom: "1px solid " + T.bg2, alignItems: "start" }}>
            {check(r.on)}
            <span style={{ lineHeight: 1.45, minWidth: 0, overflowWrap: "anywhere" }}>{r.describes}</span>
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
      {err && <div data-testid="agent-refusal" style={{ ...REFUSAL, marginTop: 14 }}>{err}</div>}
      {/* WIRE-1-ADDENDUM: the drafts this plan left waiting, read in a row. */}
      {draftsWaiting > 0 && onReviewAll && (
        <button data-testid="agent-review-all" onClick={onReviewAll} disabled={isReadOnly}
          style={{ ...YES_BTN, marginTop: 18, width: wide ? "auto" : "100%" }}>
          Review all {draftsWaiting}
        </button>
      )}
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
              style={{ ...YES_BTN, cursor: busy || live ? "default" : "pointer", width: wide ? "auto" : "100%", opacity: isReadOnly ? 0.5 : 1 }}>
              {busy || live ? "Running…" : (plan.confirmLabel || "Run the plan")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

// ── A READ, ANSWERED ───────────────────────────────────────────────────────
// A report opened, a person found, a count, a number explained. The server
// wrote nothing, and the panel says so.
function readPanel({ read, wide, onNavigate, onClose }) {
  const go = (tab, opts) => onNavigate && onNavigate(tab, opts);
  const eyebrow = read.kind === "explain" ? "Read · what it means" : read.kind === "person" || read.kind === "people" || read.kind === "list" ? "Read · found" : "Read · a report";
  return (
    <section data-testid="agent-read" data-kind={read.kind} style={{ ...PANEL, padding: wide ? "26px 28px" : "18px 16px", minWidth: 0 }}>
      <div style={EYEBROW}>{eyebrow}</div>
      <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: wide ? 26 : 22, lineHeight: 1.2, margin: "6px 0 8px", overflowWrap: "anywhere" }}>
        {read.kind === "person" ? read.name : read.kind === "people" ? "More than one record matches" : read.kind === "list" ? read.title : read.name}
      </h2>
      {read.answer && <p style={{ fontSize: 16, lineHeight: 1.5, margin: "0 0 8px", color: T.ink }}>{read.answer}</p>}
      <p style={{ fontSize: 14.5, lineHeight: 1.55, margin: "0 0 8px", color: T.ink2 }}>{read.sentence}</p>
      {read.kind === "list" && (read.people || []).length > 0 && (
        <div data-testid="agent-read-list" style={{ display: "flex", flexDirection: "column", gap: 6, margin: "10px 0" }}>
          {read.people.map(p => (
            <DonorLink key={p.id} id={p.id} onOpen={() => go("donors", { selectDonorId: p.id })}
              style={{ ...OUTLINE_BTN, textAlign: "left", fontWeight: 600, borderWidth: 1 }}>{p.name}</DonorLink>
          ))}
          {read.more > 0 && <div style={{ fontSize: 13, color: T.ink3 }}>and {read.more.toLocaleString("en-US")} more</div>}
        </div>
      )}
      {read.kind === "people" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "10px 0" }}>
          {(read.people || []).map(p => (
            <DonorLink key={p.id} id={p.id} onOpen={() => go("donors", { selectDonorId: p.id })}
              style={{ ...OUTLINE_BTN, textAlign: "left", fontWeight: 600, borderWidth: 1 }}>{p.name}</DonorLink>
          ))}
        </div>
      )}
      <p style={{ fontSize: 13, color: T.ink3, margin: "0 0 18px" }}>{read.note || "Steward read this and wrote nothing."}</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", flexDirection: wide ? "row" : "column", alignSelf: "stretch" }}>
        {read.report && (
          <button data-testid="agent-read-open" onClick={() => go("reports", { report: read.report })}
            style={{ ...YES_BTN, width: wide ? "auto" : "100%" }}>Open {read.name}</button>
        )}
        {read.kind === "person" && (
          <DonorLink id={read.donorId} data-testid="agent-read-open" onOpen={() => go("donors", { selectDonorId: read.donorId })}
            style={{ ...YES_BTN, width: wide ? "auto" : "100%" }}>Open the record</DonorLink>
        )}
        {read.savedReport && (
          <button data-testid="agent-read-save" onClick={() => go("reports", { savedReport: read.savedReport })}
            style={{ ...OUTLINE_BTN, width: wide ? "auto" : "100%" }}>Keep it in Your reports</button>
        )}
        <button onClick={onClose} style={{ background: "transparent", border: "none", color: T.ink3, fontSize: 14, fontWeight: 700, cursor: "pointer", padding: "10px 6px" }}>
          Close
        </button>
      </div>
      {read.savedReport && (
        <p style={{ fontSize: 12.5, color: T.ink3, margin: "12px 0 0", lineHeight: 1.5 }}>
          {read.name} is one of the everyday reports kept under Reports → Your reports, always up to date, with its CSV and PDF.
        </p>
      )}
    </section>
  );
}

// ── WHICH ONE? ─────────────────────────────────────────────────────────────
// FIX-3 B — one name, several records (two Adas). Steward asks BEFORE it plans;
// nothing has been written. Her pick plans for that record alone.
function whichPanel({ which, wide, busy, isReadOnly, onPick, onClose }) {
  return (
    <section data-testid="agent-which" style={{ ...PANEL, padding: wide ? "26px 28px" : "18px 16px", minWidth: 0 }}>
      <div style={EYEBROW}>Before Steward plans</div>
      <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: wide ? 26 : 22, lineHeight: 1.2, margin: "6px 0 8px", overflowWrap: "anywhere" }}>
        Which {which.said}?
      </h2>
      <p style={{ fontSize: 14.5, lineHeight: 1.55, margin: "0 0 12px", color: T.ink2 }}>{which.sentence}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "0 0 14px" }}>
        {(which.people || []).map(p => (
          <button key={p.id} data-testid="agent-which-person" onClick={() => onPick(p.id)} disabled={busy || isReadOnly}
            style={{ ...OUTLINE_BTN, borderWidth: 1, textAlign: "left", display: "flex", flexDirection: "column", gap: 2, cursor: busy ? "default" : "pointer" }}>
            <span style={{ fontSize: 15 }}>{p.name}</span>
            <span style={{ fontSize: 12.5, fontWeight: 400, color: T.ink3, overflowWrap: "anywhere" }}>{p.detail}</span>
          </button>
        ))}
      </div>
      <p style={{ fontSize: 13, color: T.ink3, margin: "0 0 10px" }}>Steward has not written anything yet.</p>
      <button onClick={onClose} style={{ background: "transparent", border: "none", color: T.ink3, fontSize: 14, fontWeight: 700, cursor: "pointer", padding: "10px 6px" }}>
        Never mind
      </button>
    </section>
  );
}

// ── DRAFTING OFF: WHAT, WHO, WHERE ─────────────────────────────────────────
function draftingNotice({ status, isReadOnly, onTurnOn, onGuardrails }) {
  if (!status || status.on) return null;
  if (status.reason === "ai_no_key") {
    return (
      <div data-testid="agent-drafting" data-reason="ai_no_key" style={{ ...REFUSAL, margin: "0 0 18px", fontSize: 13.5 }}>
        <span data-testid="agent-key-missing">{status.sentence}</span>
      </div>
    );
  }
  if (status.reason === "agent_paused") {
    return (
      <div data-testid="agent-drafting" data-reason="agent_paused" style={{ ...REFUSAL, margin: "0 0 18px" }}>
        Steward is paused. <button onClick={onGuardrails} style={{ background: "none", border: "none", padding: 0, color: T.ink, fontWeight: 700, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit" }}>Turn it back on in Guardrails</button>.
      </div>
    );
  }
  return (
    <section data-testid="agent-drafting" data-reason={status.reason}
      style={{ ...PANEL, borderLeft: "3px solid " + T.gold, padding: "16px 18px", margin: "0 0 18px", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        <div style={{ fontFamily: SERIF, fontSize: 20, marginBottom: 6 }}>Drafting is off.</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.55, color: T.ink2 }}>{status.canNow}</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.55, color: T.ink3, marginTop: 4 }}>{status.adds}</div>
        {!status.canTurnOn && <div data-testid="agent-drafting-who" style={{ fontSize: 13.5, lineHeight: 1.55, color: T.ink, marginTop: 8, fontWeight: 600 }}>{status.whoCan}</div>}
      </div>
      {status.canTurnOn && (
        <button data-testid="agent-turn-on-drafting" onClick={onTurnOn} disabled={isReadOnly} style={{ ...OUTLINE_BTN, opacity: isReadOnly ? 0.5 : 1 }}>
          Turn on drafting
        </button>
      )}
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
  const [read, setRead] = useState(null);
  const [which, setWhich] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [sheetErr, setSheetErr] = useState("");
  const [status, setStatus] = useState(null);
  // AGENTS-1 — the six, read from the server. The client keeps no list of its
  // own, so a seventh persona appears here without a client change.
  const [personas, setPersonas] = useState(null);
  const [persona, setPersona] = useState("");
  // FIX-8 Part C — which card's "How it works" is open, and how many items
  // each persona has waiting. The counts come from the queue Steward already
  // returns, so no screen invents a number of its own.
  const [howOpen, setHowOpen] = useState("");
  const [focusDrafting, setFocusDrafting] = useState(false);
  // FIX-6 item 1 — what the queue has decided this visit, and anything that
  // refused. Held by the room, because the view is drawn and never mounted.
  const [settled, setSettled] = useState({});
  const [reviewFor, setReviewFor] = useState(null);   // WIRE-1-ADDENDUM: the plan whose drafts are being reviewed
  const [waitErr, setWaitErr] = useState("");
  const loadPlans = useCallback(() => apiFetch("/agent/plans").then(r => {
    setPlans(r.plans || []);
    return r.plans || [];
  }).catch(() => { setPlans([]); return []; }), []);
  const loadWaiting = useCallback(() => apiFetch("/agent/waiting").then(setWaiting).catch(() => setWaiting({ count: 0, items: [] })), []);
  const loadStatus = useCallback(() => apiFetch("/agent/status").then(setStatus).catch(() => setStatus(null)), []);
  const loadPersonas = useCallback(() => apiFetch("/agent/personas").then(setPersonas).catch(() => setPersonas(null)), []);
  useEffect(() => { loadPlans(); loadWaiting(); loadStatus(); loadPersonas(); }, [loadPlans, loadWaiting, loadStatus, loadPersonas]);
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
  // "Turn on drafting" lands ON the switch, not at the top of a long view.
  useEffect(() => {
    if (view !== "guardrails" || !focusDrafting) return undefined;
    const h = setTimeout(() => {
      const el = typeof document !== "undefined" && document.getElementById("agent-drafting-setting");
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
    return () => clearTimeout(h);
  }, [view, focusDrafting]);
  async function guardAct(path, key) {
    if (guardBusy) return;
    setGuardBusy(key); setGuardErr("");
    try { await apiFetch(path, { method: "POST", body: "{}" }); loadGuard(); loadPlans(); loadStatus(); }
    catch (e) { setGuardErr(errorMessage(e, "That did not work.")); }
    setGuardBusy("");
  }
  // THE ORG'S SWITCH. The same control and the same write as Settings → Data
  // (PATCH /org/ai-settings, admin only, audited with who).
  async function setDrafting(enabled) {
    if (guardBusy) return;
    setGuardBusy("drafting"); setGuardErr("");
    try { await apiFetch("/org/ai-settings", { method: "PATCH", body: JSON.stringify({ enabled }) }); await loadStatus(); }
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

  const ask = useCallback(async (words, picks) => {
    const said = String(words || "").trim();
    if (!said || asking) return;
    setAsking(true); setAskErr(""); setAskedId(null); setRead(null); setWhich(null);
    try {
      const r = await apiFetch("/agent/instructions", { method: "POST", body: JSON.stringify({
        text: said,
        ...(picks && picks.length ? { personId: picks } : {}),
        ...(persona ? { persona } : {}),
      }) });
      if (r && r.read) { setRead({ ...r.read, text: said }); setText(""); }
      // One name, several records: ask which, and keep her words for the pick.
      // Her earlier picks ride along, one per name ("Margaret and Robert").
      else if (r && r.which) { setWhich({ ...r.which, text: said, picks: picks || [] }); setText(""); }
      // AGENT-2: nothing in it Steward can do: said plainly, and nothing planned.
      else if (r && r.cannot) { setAskErr(r.cannot.sentence); }
      else {
        await loadPlans(); loadWaiting();
        setAskedId(r.id); setOpenId(r.id); setText("");
      }
    } catch (e) {
      setAskErr(e && e.sentence ? e.sentence
        : e && e.error === "agent_paused" ? "Steward is paused. Turn it back on in Guardrails."
        : e && e.error === "plan_refused" ? "Steward would not plan that: it would have needed something you have not signed for."
        : errorMessage(e, "Steward could not plan that just now."));
      if (e && (e.error === "agent_unavailable" || e.error === "ai_disabled")) loadStatus();
    }
    setAsking(false);
  }, [asking, loadPlans, loadWaiting, loadStatus, persona]);

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

  // ── FIX-6 item 1 · APPROVE AND SKIP ─────────────────────────────────────
  // The result STAYS ON THE ROW. Reloading the queue makes the item vanish,
  // which is the one outcome that does not tell her whether the press worked:
  // a row that disappears and a row that was never there look the same. So the
  // row is settled in place with the server's own sentence, the count is
  // refreshed from the server, and the row goes on the next full load.
  async function actOnWaiting(it, action, reason) {
    const key = it.kind + it.id;
    if (busyId) return;
    setBusyId(key); setWaitErr("");
    try {
      const r = await apiFetch(`/agent/waiting/${it.kind}/${it.id}/${action}`,
        { method: "POST", body: JSON.stringify(reason ? { reason } : {}) });
      setSettled(m => ({ ...m, [key]: { item: it, sentence: (r && r.sentence) || (action === "approve" ? "Approved." : "Skipped.") } }));
      // WIRE-1-ADDENDUM: an Agent draft's review is undone by the shared toast.
      if (it.kind === "agent_draft") offerUndo({ message: (r && r.sentence) || "Done.", undoAction: async () => {
        const y = await apiFetch(`/agent/waiting/agent_draft/${it.id}/reopen`, { method: "POST", body: "{}" });
        setSettled(m => { const n = { ...m }; delete n[key]; return n; });
        loadWaiting(); loadPlans(); return y;
      } }, "draft");
      loadWaiting();
    } catch (e) {
      setWaitErr(e && e.message ? e.message : "That did not go through. Nothing was changed.");
    }
    setBusyId(null);
  }

  // EMAIL-1 — an Agent draft's words from one of the org's templates, with
  // this person's name in them. Still a draft she sends; Undo restores it.
  async function draftFromTemplate(it, tpl) {
    if (busyId) return;
    setBusyId(it.kind + it.id); setWaitErr("");
    try {
      const r = await apiFetch(`/agent/drafts/${it.id}/from-template`, { method: "POST", body: JSON.stringify({ templateId: tpl.id }) });
      offerUndo({ message: r.sentence, undoAction: async () => {
        const y = await apiFetch(`/agent/drafts/${it.id}/restore`, { method: "POST", body: JSON.stringify(r.previous) });
        loadWaiting(); return y;
      } }, "draft");
      loadWaiting();
    } catch (e) { setWaitErr(errorMessage(e, "That did not go through. Nothing was changed.")); }
    setBusyId(null);
  }

  const list = plans || [];
  const open = list.find(p => p.id === openId) || list[0] || null;
  const asked = askedId ? list.find(p => p.id === askedId) : null;
  const waitCount = waiting ? waiting.count : null;
  // FIX-8 Part C — what each of the six has waiting, counted from the one
  // queue. An item with no persona (the general agent, and everything written
  // before AGENTS-1) belongs to nobody and is counted against nobody.
  const waitingFor = useMemo(() => {
    const out = {};
    for (const it of (waiting && waiting.items) || []) {
      if (!it.persona) continue;
      out[it.persona] = (out[it.persona] || 0) + 1;
    }
    return out;
  }, [waiting]);
  const running = list.filter(p => p.run && runIsLive(p.run)).length;
  // What the agent is doing, in brass on the margin.
  const activity = running ? `Steward is running ${running === 1 ? "a plan" : running + " plans"} now.`
    : waitCount ? `${waitCount} ${waitCount === 1 ? "thing is" : "things are"} waiting for you.` : "";

  // Examples in HER words: her word for a giver, and a name on her own file.
  const someone = (data?.donors || []).find(d => d && d.name && d.kind === "organisation")
    || (data?.donors || []).find(d => d && d.name);
  const examples = [
    `Draft a thank-you to every ${t("giver", 1)} who gave this month`,
    someone ? `Just got a cheque from ${someone.name}, 250 dollars` : `Just got a cheque for 250 dollars from someone on file`,
    `Find the ${t("giver", 2)} who gave last year and not this year, and draft each a note`,
  ];

  const sheetFor = item => item ? (
    <>
      {sheet({ item, wide, isReadOnly, busy: busyId === item.id,
        err: busyId === null && sheetErr ? sheetErr : "",
        onConfirm: () => confirm(item.id), onDiscard: () => discard(item.id), onReviewAll: () => setReviewFor(item.id) })}
      {reviewFor === item.id && (
        <AgentDraftReview instructionId={item.id} onClose={() => setReviewFor(null)} onChanged={() => { loadPlans(); loadWaiting(); }} />
      )}
    </>
  ) : null;
  const readFor = () => read ? readPanel({ read, wide, onNavigate, onClose: () => setRead(null) }) : null;
  const whichFor = () => which ? whichPanel({ which, wide, busy: asking, isReadOnly,
    onPick: id => ask(which.text, [...(which.picks || []), id]), onClose: () => setWhich(null) }) : null;
  const canGo = !!text.trim() && !asking && !isReadOnly;
  const goStyle = { ...(canGo ? YES_BTN : GO_OFF), whiteSpace: "nowrap", flexShrink: 0, width: wide ? "auto" : "100%" };
  const goLabel = asking ? "Planning…" : "Show me the plan";
  const notice = draftingNotice({ status, isReadOnly,
    onTurnOn: () => { setFocusDrafting(true); setView("guardrails"); },
    onGuardrails: () => setView("guardrails") });

  // FIX-3 B — the one-line bar has its go button beside it (under it at phone
  // width), always drawn; Enter submits the form.
  const askBar = (
    <form onSubmit={e => { e.preventDefault(); ask(text); }}
      style={{ display: "flex", gap: 10, marginBottom: 18, flexDirection: wide ? "row" : "column", alignItems: wide ? "stretch" : "stretch" }}>
      <input value={text} onChange={e => setText(e.target.value)} data-testid="agent-ask-bar"
        aria-label="Tell Steward what to do" placeholder="Tell Steward what to do, in your own words…"
        style={{ flex: 1, minWidth: 0, border: "1px solid " + T.bg3, background: T.white, color: T.ink,
          borderRadius: 12, padding: "14px 16px", fontSize: 15, fontFamily: "inherit", outline: "none" }} />
      <button type="submit" data-testid="agent-ask-bar-go" disabled={!canGo} style={goStyle}>{goLabel}</button>
    </form>
  );

  // The instructions she has given, down the left, each with its run's state.
  const instructionList = (
    <div data-testid="agent-instruction-list" style={{ borderTop: "1px solid " + T.bg3, order: wide ? 0 : 2, minWidth: 0 }}>
      <div style={{ ...EYEBROW, padding: "12px 0 6px" }}>Everything you have asked</div>
      {!list.length && (
        <div style={{ fontSize: 13.5, color: T.ink3, lineHeight: 1.55, padding: "6px 0 14px" }}>
          Nothing planned yet. Every instruction you give will be listed here with what its run did. A question about your file, like a report, is answered without being kept.
        </div>
      )}
      {list.map(p => {
        const st = planState(p);
        const on = !read && open && open.id === p.id;
        return (
          <button key={p.id} data-testid="agent-plan-item" onClick={() => { setRead(null); setOpenId(p.id); }}
            style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit",
              padding: "13px 8px 13px 12px", border: "none", borderBottom: "1px solid " + T.bg3,
              borderLeft: "3px solid " + (on ? T.greenDk : "transparent"), background: on ? T.white : "transparent" }}>
            <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.45, fontWeight: on ? 700 : 400, overflowWrap: "anywhere" }}>{p.text}</div>
            <div style={{ fontSize: 12, color: T.ink3, marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {personaBadge(p.personaName)}
              <span style={{ color: st.brass ? T.gold700 : T.ink3, fontWeight: st.brass ? 700 : 400 }}>{st.word}</span>
              {/* FIX-24 2d: the date the run happened, the one the sheet says
                  ("Ran today, 4:58 PM"); the day it was asked only before it runs. */}
              <span>· {fmtWhen((p.run && (p.run.finished_at || p.run.started_at)) || p.created_at)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    // ── FIX-4 3 · THE AGENT IS A SCREEN, NOT A ROOM ────────────────────────
    // FIX-2 gave this page an ink "margin" around a cream sheet, on the
    // theory that the Agent is somewhere you go rather than something you
    // use. In the product it read as one screen painted a different colour
    // from the other eleven, and the first thing anybody asked about it was
    // why. So: the page's own cream ground, white cards, ink text and
    // emerald for the one action — the same as Fundraising, Communications
    // and Reports. Nothing else about the page changed.
    <div data-testid="agent-room" style={{ color: T.ink, minWidth: 0, background: "transparent",
      minHeight: "calc(100vh - 52px)", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: wide ? 18 : 14 }}>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: wide ? 32 : 26, margin: 0, color: T.ink }}>Agent</h1>
        {activity && <div data-testid="agent-activity" style={{ fontSize: 13.5, color: T.gold600, fontWeight: 700 }}>{activity}</div>}
      </div>

      {/* THE SHEET. White, with a hairline, like every other screen's cards. */}
      <section data-testid="agent-desk" style={{ background: T.white, color: T.ink, borderRadius: 16, minWidth: 0,
        border: "1px solid " + T.bg2,
        padding: wide ? "0 28px 28px" : "0 14px 18px", boxSizing: "border-box" }}>
        <div role="tablist" style={{ display: "flex", overflowX: "auto", borderBottom: "1px solid " + T.bg3,
          margin: wide ? "0 -28px 22px" : "0 -14px 16px", padding: wide ? "0 20px" : "0 6px" }}>
          {VIEWS.map(v => (
            <button key={v.id} role="tab" aria-selected={view === v.id} data-testid={`agent-tab-${v.id}`}
              onClick={() => { setFocusDrafting(false); setView(v.id); }}
              title={v.id === "waiting" && waiting ? waiting.definition : undefined}
              style={{ padding: wide ? "16px 14px 13px" : "14px 10px 11px", fontSize: 13.5, whiteSpace: "nowrap", cursor: "pointer", fontFamily: "inherit",
                border: "none", borderBottom: "3px solid " + (view === v.id ? T.greenDk : "transparent"),
                background: "transparent", color: view === v.id ? T.ink : T.ink3, fontWeight: view === v.id ? 700 : 500 }}>
              {v.label}{v.id === "waiting" && waitCount ? ` · ${waitCount}` : ""}
            </button>
          ))}
        </div>

        {view === "plans" && (
          <div data-testid="agent-view-plans">
            {askBar}
            {notice}
            {askErr && <div data-testid="agent-refusal" style={{ ...REFUSAL, margin: "-4px 0 18px" }}>{askErr}</div>}
            {plans === null ? <div style={{ color: T.ink3, fontSize: 14 }}>Loading your plans…</div> : (
              <div style={{ display: "grid", gridTemplateColumns: wide ? "300px minmax(0,1fr)" : "minmax(0,1fr)", gap: wide ? 28 : 18, alignItems: "start" }}>
                {instructionList}
                <div style={{ order: 1, minWidth: 0 }}>
                  {read ? readFor() : which ? whichFor() : open ? sheetFor(open) : (
                    <section style={{ ...PANEL, padding: "22px 24px" }}>
                      <div style={{ fontFamily: SERIF, fontSize: 22, marginBottom: 6 }}>Nothing planned yet.</div>
                      <div style={{ color: T.ink3, fontSize: 14, lineHeight: 1.55 }}>Tell Steward what happened, in your own words, and it shows you the plan before anything changes. Ask for a report, a person or a count and it answers at once.</div>
                    </section>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {view === "ask" && (
          <div data-testid="agent-view-ask">
            {notice}
            {/* ── FIX-8 Part C · YOUR STAFF ──────────────────────────────────
                AGENTS-1 shipped the six as six grey slabs under a small
                "WHO SHOULD DO IT" label, which is the least sellable way to
                draw the most sellable thing in the product. They are staff.
                So: a headline, a monogram in the brand's own palette, the
                one-line job, the one thing that person will never do, and
                what they have waiting right now. The long description moves
                behind "How it works" on the card, where somebody who wants it
                can open it and nobody else has to read it. */}
            {personas?.personas?.length > 0 && (
              <div data-testid="agent-personas" style={{ marginBottom: 26 }}>
                <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: wide ? 27 : 23,
                  margin: "2px 0 4px", color: T.ink }}>Your staff.</h2>
                <div style={{ fontSize: 14, color: T.ink3, lineHeight: 1.55, marginBottom: 14, maxWidth: "62ch" }}>
                  Six specialists who do the tedious work, then wait for your yes.
                </div>
                <div style={{ display: "grid", gap: 12,
                  gridTemplateColumns: wide ? "repeat(3, minmax(0, 1fr))" : "1fr" }}>
                  {personas.personas.map((p, i) => {
                    const on = persona === p.id;
                    const openHow = howOpen === p.id;
                    const n = waitingFor[p.id] || 0;
                    return (
                      <div key={p.id} data-testid="agent-persona-card" data-persona={p.id}
                        style={{ background: T.white, border: "1px solid " + (on ? T.greenDk : T.bg3),
                          borderRadius: 14, padding: "14px 16px", boxShadow: T.shadow,
                          display: "flex", flexDirection: "column", gap: 7,
                          outline: on ? "1px solid " + T.greenDk : "none" }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: 9, flex: "none",
                            display: "grid", placeItems: "center", fontSize: 13, fontWeight: 800,
                            fontFamily: SERIF, letterSpacing: ".02em",
                            background: MARK[i % MARK.length].bg, color: MARK[i % MARK.length].fg }}>
                            {monogram(p.name)}
                          </span>
                          <span style={{ fontSize: 16, fontWeight: 700, color: T.ink, fontFamily: SERIF }}>{p.name}</span>
                          {n > 0 && <span data-testid="agent-persona-waiting" style={{ marginLeft: "auto", fontSize: 11.5,
                            fontWeight: 700, color: T.gold700, background: T.gold100, border: "1px solid " + T.gold300,
                            borderRadius: 99, padding: "2px 9px", whiteSpace: "nowrap" }}>
                            {n} {n === 1 ? "draft" : "drafts"} waiting</span>}
                        </div>
                        <div style={{ fontSize: 13.5, color: T.ink2, lineHeight: 1.45 }}>{p.tagline}</div>
                        {/* The guardrail note VERBATIM. It is already a whole
                            sentence naming what this one can and cannot do
                            ("It can tag and note. It never merges two people")
                            so prefixing it with "Never:" made it read as a
                            list of things it will not do, starting with one it
                            does. The registry's words, unedited. */}
                        <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.45,
                          borderLeft: "2px solid " + T.bg3, paddingLeft: 9 }}>{p.guardrailNote}</div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: "auto", paddingTop: 4 }}>
                          <button data-testid="agent-persona-ask"
                            onClick={() => { setPersona(on ? "" : p.id); setView("ask");
                              requestAnimationFrame(() => document.querySelector('[data-testid="agent-ask-input"]')?.focus()); }}
                            style={{ background: on ? T.greenDk : "transparent", color: on ? T.white : T.greenDk,
                              border: "1.5px solid " + T.greenDk, borderRadius: 9, padding: "6px 13px",
                              fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                            {/* The FULL name. `firstWord` turned "Steward Data"
                                into "Ask Steward", which is the product's own
                                name and reads as asking the whole product. */}
                            {(on ? "Asking " : "Ask ") + p.name}
                          </button>
                          <button data-testid="agent-persona-how" aria-expanded={openHow}
                            onClick={() => setHowOpen(openHow ? "" : p.id)}
                            style={{ background: "none", border: "none", padding: 0, color: T.ink3,
                              fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                              textDecoration: "underline dotted" }}>
                            {openHow ? "Hide" : "How it works"}
                          </button>
                        </div>
                        {openHow && <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5,
                          borderTop: "1px solid " + T.bg2, paddingTop: 8 }}>{p.description}</div>}
                      </div>);
                  })}
                </div>
                <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 10, lineHeight: 1.5 }}>
                  {persona
                    ? `${personas.personas.find(p => p.id === persona)?.name} will write the plan. Press the button again to choose nobody.`
                    : "Pick one, or ask Steward and it will use everything it can do."}
                </div>
              </div>)}
            <div style={{ ...EYEBROW, marginBottom: 10 }}>Or ask in your own words</div>
            {/* FIX-3 B — the box and its go button, side by side (the button
                under the box at phone width). Enter plans; Shift+Enter is a new line. */}
            <div style={{ display: "flex", gap: 12, flexDirection: wide ? "row" : "column", alignItems: wide ? "flex-end" : "stretch" }}>
              <textarea data-testid="agent-ask-input" value={text} onChange={e => setText(e.target.value)} rows={wide ? 5 : 4}
                aria-label="Tell Steward what to do" placeholder="Tell Steward what to do, in your own words…"
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (canGo) ask(text); } }}
                style={{ flex: 1, minWidth: 0, width: wide ? "auto" : "100%", boxSizing: "border-box", border: "1px solid " + T.bg3, background: T.white, color: T.ink,
                  borderRadius: 12, padding: "14px 16px", fontSize: 16, lineHeight: 1.5, fontFamily: "inherit", resize: "vertical" }} />
              <button data-testid="agent-ask-submit" onClick={() => ask(text)} disabled={!canGo} style={goStyle}>{goLabel}</button>
            </div>
            <div style={{ fontSize: 13, color: T.ink3, marginTop: 8 }}>Enter shows you the plan; Shift+Enter starts a new line. Nothing happens until you say so.</div>
            <div style={{ ...EYEBROW, marginTop: 20 }}>For example</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8, marginBottom: 20 }}>
              {examples.map(x => (
                <button key={x} data-testid="agent-example" onClick={() => setText(x)}
                  style={{ textAlign: "left", background: T.white, border: "1px solid " + T.bg2, borderRadius: 10, padding: "10px 12px",
                    color: T.ink2, fontSize: 14, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.45 }}>
                  “{x}”
                </button>
              ))}
            </div>
            {askErr && <div data-testid="agent-refusal" style={{ ...REFUSAL, marginBottom: 16 }}>{askErr}</div>}
            {read ? readFor() : which ? whichFor() : asked ? sheetFor(asked) : null}
          </div>
        )}

        {view === "workflows" && (
          <div data-testid="agent-view-workflows">
            <div style={{ ...EYEBROW, marginBottom: 8 }}>Workflows · the recipes</div>
            <Workflows isReadOnly={isReadOnly} onNavigate={onNavigate} embedded />
          </div>
        )}

        {view === "waiting" && (
          waitingView({ wide, waiting, isReadOnly, busyId, onNavigate, onConfirm: confirm, onDiscard: discard,
                        settled, waitErr, onAct: actOnWaiting, onTemplate: draftFromTemplate })
        )}

        {view === "guardrails" && guardrails({ wide, isReadOnly, data: guardData, instr: guardInstr, busy: guardBusy, err: guardErr,
          act: guardAct, status, focusDrafting, setDrafting, personas })}
      </section>
    </div>
  );
}

// ── FIX-6 item 1 · THE CONTROLS ON ONE WAITING ITEM ───────────────────────
//
// Every item gets APPROVE and SKIP. Before this, everything except a gift to
// confirm had exactly one control, "Open the record", so the queue could be
// read and not acted on: the count never moved and the only way to clear
// anything was to go somewhere else and do it there.
//
// APPROVE IS THE PRIMARY ACTION and it is the one emerald on the row. SKIP is
// quiet and takes an optional reason, asked inline rather than in a dialog,
// because a queue that makes you justify a skip is a queue that stops being
// used. Neither is red: nothing here destroys anything.
//
// THE RESULT STAYS ON THE ROW. A row that vanishes and a row that was never
// there look the same, so the server's own sentence replaces the buttons and
// the row is visibly settled.
function WaitingActions({ it, wide, isReadOnly, busyId, settledText, onNavigate, onConfirm, onDiscard, onAct, onTemplate }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const key = it.kind + it.id;
  const busy = busyId === key || busyId === it.id;
  const box = { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: wide ? "flex-end" : "flex-start", alignItems: "center" };
  const quiet = { background: "transparent", border: "1px solid " + T.bg3, borderRadius: 9, padding: "8px 12px", color: T.ink2, fontSize: 13, fontWeight: 700, cursor: "pointer" };

  if (settledText) return (
    <div style={box}>
      <span role="status" data-testid="agent-waiting-result"
        style={{ fontSize: 13, color: T.ink3, lineHeight: 1.5, textAlign: wide ? "right" : "left" }}>{settledText}</span>
    </div>
  );

  // A gift keeps its own two controls: money is confirmed by running its plan,
  // and a general approve button is exactly the shortcut that rule exists to
  // prevent. The server refuses it too, so this is the courtesy half.
  if (it.kind === "gift_to_confirm") return (
    <div style={box}>
      <button onClick={() => onDiscard(it.id)} disabled={isReadOnly || !!busyId}
        style={{ background: "transparent", border: "none", color: T.ink3, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Not this one</button>
      <button onClick={() => onConfirm(it.id)} disabled={isReadOnly || !!busyId}
        style={{ ...YES_BTN, borderRadius: 9, padding: "9px 14px", fontSize: 13 }}>
        {busy ? "Running…" : it.confirmLabel}
      </button>
    </div>
  );

  if (asking) return (
    <div style={{ ...box, justifyContent: wide ? "flex-end" : "flex-start" }}>
      <input data-testid="agent-skip-reason" value={reason} autoFocus placeholder="Why, if you want to say"
        onChange={e => setReason(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") onAct(it, "skip", reason); if (e.key === "Escape") setAsking(false); }}
        style={{ border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, color: T.ink,
                 background: T.white, fontFamily: "inherit", width: wide ? 200 : "100%" }} />
      <button data-testid="agent-skip-confirm" onClick={() => onAct(it, "skip", reason)} disabled={isReadOnly || !!busyId} style={quiet}>
        {busy ? "Skipping…" : "Skip it"}
      </button>
      <button onClick={() => { setAsking(false); setReason(""); }}
        style={{ background: "transparent", border: "none", color: T.ink3, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Never mind</button>
    </div>
  );

  return (
    <div style={box}>
      {it.donorId && (
        <DonorLink id={it.donorId} onOpen={onNavigate ? () => onNavigate("donors", { selectDonorId: it.donorId }) : undefined}
          style={{ background: "transparent", border: "none", color: T.ink3, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          Open the record
        </DonorLink>
      )}
      {it.kind === "agent_draft" && onTemplate && !isReadOnly && (
        <TemplateStart disabled={!!busyId} onPick={tpl => onTemplate(it, tpl)} />
      )}
      <button data-testid="agent-skip" onClick={() => setAsking(true)} disabled={isReadOnly || !!busyId} style={quiet}>Skip</button>
      <button data-testid="agent-approve" onClick={() => onAct(it, "approve")} disabled={isReadOnly || !!busyId}
        style={{ ...YES_BTN, borderRadius: 9, padding: "9px 16px", fontSize: 13 }}>
        {busy ? "Working…" : "Approve"}
      </button>
    </div>
  );
}

// ── WAITING FOR YOU ────────────────────────────────────────────────────────
function waitingView({ wide, waiting, isReadOnly, busyId, onNavigate, onConfirm, onDiscard, settled = {}, waitErr = "", onAct, onTemplate }) {
  const live = (waiting && waiting.items) || [];
  // WHAT THE SERVER STILL HAS, PLUS WHAT THIS VISIT SETTLED. Approving an item
  // takes it out of the server's list, so rendering the server's list alone
  // made the row vanish the instant it was acted on, and a row that disappears
  // is indistinguishable from a press that did nothing. The settled rows stay,
  // showing the server's own sentence, until the next full load of the screen.
  const liveKeys = new Set(live.map(i => i.kind + i.id));
  const ghosts = Object.entries(settled).filter(([k]) => !liveKeys.has(k)).map(([, v]) => v.item).filter(Boolean);
  const items = [...live, ...ghosts].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return (
    <div data-testid="agent-view-waiting">
      <div style={EYEBROW}>Waiting for you · oldest first</div>
      <div style={{ fontSize: 14, color: T.ink3, margin: "6px 0 14px", lineHeight: 1.5 }}>
        {waiting ? waiting.definition : "Loading…"}
      </div>
      {waitErr && <div role="alert" data-testid="agent-waiting-error" style={{ ...REFUSAL, marginBottom: 12 }}>{waitErr}</div>}
      {waiting && !items.length && <div style={{ fontFamily: SERIF, fontSize: 20 }}>Nothing is waiting on you.</div>}
      {items.map(it => (
        <div key={it.kind + it.id} data-testid="agent-waiting-item" data-kind={it.kind}
          style={{ borderTop: "1px solid " + T.bg3, padding: "14px 0", display: "grid",
            gridTemplateColumns: wide ? "180px minmax(0,1fr) auto" : "minmax(0,1fr)", gap: wide ? 16 : 8, alignItems: "start" }}>
          <div>
            {pill(it.kind === "gift_to_confirm" ? "confirm" : "waiting", WAIT_KIND[it.kind] || "Waiting")}
            {it.personaName && <div style={{ marginTop: 6 }}>{personaBadge(it.personaName)}</div>}
            <div style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>{fmtWhen(it.createdAt)}</div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.4, overflowWrap: "anywhere" }}>{it.title}</div>
            {it.who && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>{it.who}</div>}
            {it.body && <div style={{ fontSize: 13.5, color: T.ink2, marginTop: 6, lineHeight: 1.5, whiteSpace: "pre-wrap",
              overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>{it.body}</div>}
          </div>
          <WaitingActions it={it} wide={wide} isReadOnly={isReadOnly} busyId={busyId}
            settledText={(settled[it.kind + it.id] || {}).sentence} onNavigate={onNavigate}
            onConfirm={onConfirm} onDiscard={onDiscard} onAct={onAct} onTemplate={onTemplate} />
        </div>
      ))}
    </div>
  );
}

// ── GUARDRAILS ─────────────────────────────────────────────────────────────
// Pause everything; drafting on or off; what it can and cannot do, in
// sentences; every instruction and every run; and every change it made, with an
// undo for thirty days. The undo list moved here from Settings → Steward's
// activity (BUILD-97 Part 3). A plain function over state the room holds (see
// guard* in Agent), so the view is drawn, never mounted twice with its own copy
// of the truth.
function guardrails({ wide, isReadOnly, data, instr, busy, err, act, status, focusDrafting, setDrafting, personas }) {
  const pausedAll = !!(instr && instr.pausedAll);
  const can = AGENT_TOOLS.filter(x => x.needsHuman === "never");
  const signature = AGENT_TOOLS.filter(x => x.needsHuman === "signature");
  const cannot = AGENT_TOOLS.filter(x => x.needsHuman === "always");
  const card = { ...PANEL, padding: wide ? "22px 26px" : "16px 14px", marginBottom: 16 };
  const eyebrow = { ...EYEBROW, marginBottom: 10 };
  const small = { background: "transparent", border: "1px solid " + T.bg3, borderRadius: 7, padding: "4px 10px", color: T.ink2, fontSize: 12, fontWeight: 700, cursor: isReadOnly ? "not-allowed" : "pointer" };
  const draftingOn = !!(status && status.enabled);
  return (
    <div data-testid="agent-view-guardrails">
      <section style={{ ...card, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", borderLeft: "4px solid " + (pausedAll ? T.gold : T.ink) }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div data-testid="agent-pause-state" style={{ fontFamily: SERIF, fontSize: 22, marginBottom: 4 }}>
            {pausedAll ? "Steward is paused." : "Steward is running."}
          </div>
          <div style={{ fontSize: 13.5, color: T.ink3, lineHeight: 1.55 }}>
            {pausedAll ? "No instruction will run and nothing will be drafted until you turn it back on."
              : "Steward remembers everything and assumes nothing. Only the instructions you have turned on will run, and nothing reaches a donor without your yes."}
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

      {/* DRAFTING — the organisation's switch, the same control and the same
          write as Settings → Data (PATCH /org/ai-settings, admins only). */}
      <section id="agent-drafting-setting" data-testid="agent-drafting-setting"
        style={{ ...card, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
          borderLeft: "4px solid " + (status && status.reason === "ai_disabled" ? T.gold : T.ink),
          outline: focusDrafting ? "2px solid " + T.gold : "none", outlineOffset: 2 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontFamily: SERIF, fontSize: 22, marginBottom: 4 }}>
            {!status ? "Drafting" : !status.configured ? "Drafting is not set up." : draftingOn ? "Drafting is on." : "Drafting is off."}
          </div>
          <div style={{ fontSize: 13.5, color: T.ink3, lineHeight: 1.55 }}>
            {!status ? "Loading…"
              : !status.configured ? status.sentence
              : draftingOn ? "Steward drafts plans, thank-yous and notes from your records through Anthropic. Nothing is sent or recorded until you say so."
              : status.canNow}
          </div>
          {status && status.configured && !status.isAdmin && (
            <div style={{ fontSize: 13, color: T.ink, marginTop: 6, fontWeight: 600 }}>{status.whoCan}</div>
          )}
        </div>
        {status && status.configured && status.isAdmin && (
          <button data-testid="agent-drafting-toggle" disabled={isReadOnly || !!busy} onClick={() => setDrafting(!draftingOn)}
            style={{ ...(draftingOn ? OUTLINE_BTN : YES_BTN), opacity: isReadOnly || busy ? 0.6 : 1 }}>
            {busy === "drafting" ? "Saving…" : draftingOn ? "Turn drafting off" : "Turn on drafting"}
          </button>
        )}
      </section>
      {err && <div style={{ ...card, borderLeft: "4px solid " + T.gold, fontSize: 13.5 }}>{err}</div>}

      {/* AGENTS-1 — EACH OF THE SIX, AND THE ONE LINE THAT BOUNDS IT. Under
          it, the mechanisms that are REAL: plan-then-confirm, draft by
          default, an undoable write, and the exclusion of anybody the record
          says not to contact. No thresholds, no auto-pause, no managed
          no-contact list: none of those exist, and a guardrail somebody
          believes in that is not there is worse than none. */}
      {personas?.personas?.length > 0 && (
        <section data-testid="agent-guardrail-personas" style={card}>
          <div style={eyebrow}>The six, and what each one cannot do</div>
          {personas.personas.map(p => (
            <div key={p.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline",
              fontSize: 14, lineHeight: 1.5, padding: "9px 0", borderTop: "1px solid " + T.bg2 }}>
              <strong style={{ minWidth: 120 }}>{p.name}</strong>
              <span style={{ color: T.ink2, flex: 1, minWidth: 220 }}>{p.guardrailNote}</span>
            </div>))}
          {(personas.guardrails || []).map(g => (
            <div key={g} style={{ fontSize: 13.5, color: T.ink3, lineHeight: 1.55, padding: "7px 0 0" }}>{g}</div>))}
        </section>)}

      <div style={{ display: "grid", gridTemplateColumns: wide ? "1fr 1fr" : "minmax(0,1fr)", gap: 16 }}>
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

      <section style={{ ...card, marginTop: 16 }}>
        <div style={eyebrow}>What you have told Steward to do</div>
        {!instr || !instr.instructions.length ? (
          <div style={{ fontSize: 13.5, color: T.ink3 }}>Nothing yet. Tell Steward what to do from Ask.</div>
        ) : instr.instructions.map(i => (
          <div key={i.id} data-testid="agent-instruction" style={{ borderTop: "1px solid " + T.bg2, padding: "10px 0" }}>
            <div style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 4, overflowWrap: "anywhere" }}>“{i.text}”</div>
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
              <div style={{ fontSize: 14, lineHeight: 1.5, overflowWrap: "anywhere" }}>{r.instruction_text || "(instruction removed)"}</div>
              {r.personaName && <div style={{ marginTop: 4 }}>{personaBadge(r.personaName)}</div>}
              <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 4, lineHeight: 1.5 }}>
                {fmtWhen(r.started_at)} · read {r.read_summary || "nothing"} · drafted {r.drafted} · sent {r.sent} · declined {r.declined} · withheld {r.withheld}
              </div>
              {r.withheld_reason && <div data-testid="agent-run-withheld" style={{ fontSize: 12.5, color: T.gold700, marginTop: 4 }}>{r.withheld_reason}</div>}
              {r.error && <div style={{ fontSize: 12.5, color: T.gold700, marginTop: 4 }}>{r.error}</div>}
            </div>
          ))}
      </section>

      <section style={{ ...card, marginBottom: 0 }}>
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

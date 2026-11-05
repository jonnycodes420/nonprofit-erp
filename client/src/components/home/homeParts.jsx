import { lazy, Suspense, useState, useEffect } from "react";
import { retryImport } from "../../lib/lazyRetry";
import { homeCode, startHomeCode } from "../../lib/bootReads";
import { orgTodayCivil } from "../../lib/orgToday";   // MOPUP-1: pre-filled dates are the org's day
import { T, interactive, fmt } from "../shared";
import { apiFetch } from "../../api";
import { plural, countLabel } from "../../../../shared/countWords";

// SWEEP-6 (PERF-1): what Home opens on a click loads on that click, so a
// phone's first look downloads Home and not its panels.
export const MetricBreakdownPanel = lazy(() => retryImport(() => import("../MetricBreakdownPanel")));
export const YourWords = lazy(() => retryImport(() => import("../YourWords")).then(m => ({ default: m.YourWords })));
export const PlanFollowUpModal = lazy(() => retryImport(() => import("../PlanFollowUp")).then(m => ({ default: m.PlanFollowUpModal })));
export const PinnedAnswers = lazy(() => retryImport(() => import("../AskPanel")).then(m => ({ default: m.PinnedAnswers })));
// PERF-2: the moves deck (INSIGHTS-1, HOME-3) is below the fold on a phone, so
// its code loads beside its read instead of holding Home's first look. Until it
// is in, the deck's own "Reading your donors…" card holds its place.
// PERF-3: when Home is the first screen its code is asked for with Home's
// reads and App waits for it (lib/bootReads.js homeCode), so the deck draws at
// once instead of after this card, which was shorter and pushed the Thread down.
let movesIn = null;
if (homeCode()) homeCode().then(m => { movesIn = m; });
const HomeMovesLater = lazy(() => startHomeCode().then(m => ({ default: m.HomeMoves })));
// Chosen once per mount, so the deck is never swapped for itself mid-visit.
export function HomeMoves(p) {
  const [Now] = useState(() => movesIn && movesIn.HomeMoves);
  return Now ? <Now {...p}/> : <HomeMovesLater {...p}/>;
}
export const MOVES_WAIT = <section aria-label="Your moves" data-testid="home-moves" style={{background:T.white,border:"1px solid "+T.bg2,borderRadius:14,padding:"16px 18px",marginBottom:12,color:T.ink3,fontSize:14}}>Reading your donors…</section>;
export const LogConversationModal = lazy(() => retryImport(() => import("../LogConversation")).then(m => ({ default: m.LogConversationModal })));   // PERF-2
export const Breakdown = p => p.open ? <Suspense fallback={null}><MetricBreakdownPanel {...p}/></Suspense> : null;
// Most orgs pin nothing: the pins' code loads only when there is a pin to draw.
export function PinsIfAny({ isReadOnly }) {
  const [n, setN] = useState(0);
  useEffect(() => { apiFetch("/ask/pins").then(r => setN(((r && r.pins) || []).length)).catch(() => {}); }, []);
  return n ? <Suspense fallback={null}><PinnedAnswers isReadOnly={isReadOnly}/></Suspense> : null;   // PERF-2: it drew itself, and nothing drew it
}

// The same civil "today" the log flow uses (LogConversation's todayLocal), so
// a step proposed from a drift row and one proposed in the modal never differ.
export const todayCivil=()=>orgTodayCivil();
// SCALE-2: what Home reads when it opens, and what it reads once it knows the
// scope, live in lib/homeReads.js since HARDEN-2 (main.jsx asks for them too).
// "Next: send the proposal." keeps names and acronyms (shared/stepCase.js).

// BUILD-34 — customizable Home. Sections render from a per-user ordered
// [{id,visible}] config (client/src/lib/homeLayout.js is the canonical list +
// merge rule; GET/PUT /me/home-layout is the server-side per-user store).
// Edit mode is reorder + show/hide of WHOLE sections only — deliberately not a
// widget grid. The 150ms drag lift is the only motion, off under
// prefers-reduced-motion.
export const REDUCED_MOTION = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// BUILD-87 F.3.4 — AN EMPTY STATE IS ONE LINE. Steward's empty states earned
// their length honestly (BUILD-76: a bare zero cannot be told apart from a
// silently failed import, so the zero shows its work) and then four of them
// stacked up on one morning screen and the working answer — "No donors
// drifting." — was the smallest text in its own card. The work is still there
// and still says what was checked; it is one click away instead of always on.
// NB the detail is UNMOUNTED when closed, not hidden with CSS: text that is
// present but invisible is how an empty state quietly lies to a test.
// FIX-3 A — `flush` inside Home's panel: the line starts on its section
// heading's left edge (the panel's sections carry no padding of their own), and
// "why" is a quiet emerald word, never an underlined link.
export function OneLineEmpty({line,detail,testId,flush=false}){
  const [open,setOpen]=useState(false);
  return(
    <div data-testid={testId} className={flush?undefined:"dash-cpad"} style={{padding:flush?"16px 0 8px":"24px 32px"}}>
      <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
        <span style={{fontSize:14,color:T.ink}}>{line}</span>
        {detail&&(
          <button data-testid={testId?testId+"-why":undefined} onClick={()=>setOpen(o=>!o)}
            aria-expanded={open}
            style={{background:"none",border:"none",padding:0,fontSize:12,fontWeight:700,color:T.greenDk,cursor:"pointer"}}>
            {open?"less":"why"}
          </button>
        )}
      </div>
      {open&&detail&&(
        <div style={{fontSize:12.5,color:T.ink3,marginTop:8,lineHeight:1.6,maxWidth:620}}>{detail}</div>
      )}
    </div>
  );
}
// The shared scope toggle renders above the FIRST visible section that reads
// it, wherever the user put that section.
export const SCOPED_SECTION_IDS = ["commandCenter", "retention", "work"];

// One config-driven panel serves all 5 drillable My Portfolio stats below
// (Portfolio itself isn't here — it navigates straight to the existing "My
// Pipeline" Kanban view instead, per the donor-list-not-a-breakdown request)
// rather than five near-identical state+fetch+JSX blocks.
export const PORTFOLIO_BREAKDOWNS = {
  visits: { endpoint: "/dashboard/my-stats/visits/breakdown", title: "Visits YTD", explanation: "Meetings you've logged this fiscal year, most recent first." },
  moves: { endpoint: "/dashboard/my-stats/moves/breakdown", title: "Moves Made", explanation: "Every meaningful contact you've logged this fiscal year, calls, meetings, emails, and stewardship touches (visits are the meeting subset of this list)." },
  gifts: { endpoint: "/dashboard/my-stats/gifts/breakdown", title: "Gifts YTD", explanation: "Gifts received this fiscal year from donors assigned to you, largest first." },
  pipeline: { endpoint: "/dashboard/my-stats/pipeline/breakdown", title: "Pipeline", explanation: "Your assigned donors still in an active stage, ranked by lifetime giving." },
  lapsed: { endpoint: "/dashboard/my-stats/lapsed/breakdown", title: "Lapsed", explanation: "Donors assigned to you who've lapsed, ranked by lifetime giving." },
};

// The impact line. BUILD-73 Part 3 rewrote what it LEADS with, and the reason
// is positioning, not data.
//
// It used to open "Steward has recovered $X in failed-card gifts and re-engaged
// $Y from N lapsed donors." On a demo org with a decade of history that renders
// as "$2M re-engaged from 610 lapsed donors" — and nobody reads that as a
// description of the organization's own past. It reads as money STEWARD brought
// in, on the first screen a prospect sees, which is invented social proof. If
// a prospect later works out the number is synthetic, everything else said in
// that meeting becomes suspect.
//
// THE RULE, now stated where it is easy to find: the value math describes the
// SIZE OF THE PROBLEM, never Steward's results. So the lead figure is money AT
// RISK — the lifetime giving of donors who have gone quiet — which is a fact
// about the org's own file and claims nothing. Same vocabulary as the landing
// page, on purpose: one language across the demo and the marketing.
//
// Pinned by tests/reserved-recovered.test.js, which fails the build on the
// whole outcome-claim family ("recovered", "re-engaged", "recaptured",
// "won back", "brought back"), not on one exact string.
export function ImpactLine({ impact }) {
  const [open, setOpen] = useState(false);
  if (!impact) return null;
  // BUILD-83 Part 3.1/3.3 — the footer no longer opens with a risk figure, and
  // it never staples "$38.7M at risk" to "No platform fee, no donor tip." Those
  // were two unrelated sentences, and the second one is marketing inside the
  // product. The quiet-donor cohort is gone entirely (see /impact).
  const retried = impact.recoveredAmount || 0;
  const returned = impact.reengagedAmount || 0;
  const returnedDonors = impact.reengagedDonorCount || 0;
  const watching = impact.watchingRecurringCount || 0;
  const online = impact.onlineGivingProcessed || 0;
  const hasRetried = retried > 0;
  // Nothing to say yet → stay silent rather than manufacture a line.
  if (!hasRetried && returned <= 0 && watching <= 0 && online <= 0) return null;

  const head = watching > 0
      ? <>Steward is watching <strong style={{ color: T.ink }}>{watching}</strong> recurring {plural(watching, "donor")} for failed cards, no platform fee, no donor tip, gifts settle in your own Stripe.</>
      : <>No platform fee, no donor tip. <strong style={{ color: T.green600 }}>$0</strong> to Steward on every gift, settled in your own Stripe.</>;

  const row = (label, value, note) => (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "7px 0", borderTop: "1px solid " + T.bg3 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>{label}</div>
        <div style={{ fontSize: 11.5, color: T.ink3, lineHeight: 1.45, marginTop: 1 }}>{note}</div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, whiteSpace: "nowrap", fontFamily: "'DM Serif Display',serif" }}>{value}</div>
    </div>
  );

  return (
    <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, overflow: "hidden" }}>
      <div {...interactive(() => setOpen(o => !o), { label: "Show what Steward has done for you" })}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px" }}>
        <span aria-hidden style={{ color: T.gold500, fontSize: 14, lineHeight: 1 }}>◈</span>
        <span style={{ flex: 1, fontSize: 13, color: T.ink2, lineHeight: 1.5 }}>{head}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.green600, whiteSpace: "nowrap" }}>{open ? "Hide" : "Details"}</span>
      </div>
      {open && (
        <div style={{ padding: "2px 18px 14px", background: T.green100 }}>
          {hasRetried && row(
            "Failed cards, retried automatically",
            fmt(retried),
            `${countLabel(impact.recoveredCount, "gift")} whose card failed and which the dunning workflow retried. Tracked per gift, 100% attributable to a retry Steward actually ran.`
          )}
          {returned > 0 && row(
            "Gifts after a year-long gap",
            fmt(returned),
            `${fmt(returned)} from ${countLabel(returnedDonors, "donor")} who gave again after a 365-day gap. A fact about your file's history, counted separately from the failed-card retries, never merged into them.`
          )}
          {row(
            "Platform fees you paid Steward",
            "$0",
            "You process donations on your own Stripe, no platform fee, no donor tip. (Stripe's standard card fee still applies, and goes to Stripe, not to us.)"
          )}
          {online > 0 && row(
            <>What you'd likely have paid elsewhere <span style={{ fontSize: 10, fontWeight: 700, color: T.gold600 }}>· estimate</span></>,
            "~" + fmt(impact.estimatedFeesElsewhere),
            `Estimate, assumes ~${impact.feeAssumptionPct}% in platform/processing fees a typical platform charges, on the ${fmt(online)} in online giving you processed through Steward.`
          )}
        </div>
      )}
    </div>
  );
}

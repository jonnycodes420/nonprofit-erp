import { useState, useRef, useEffect, Component, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import * as Sentry from "@sentry/react";
import { streamAI, apiFetch } from "../api";

// ── Design tokens (SINGLE SOURCE OF TRUTH — BUILD-12) ───────────────────────
// This `T` object is the one place brand color is defined for the whole
// authenticated app. New/edited UI MUST reference these tokens, never a raw
// hex literal. (Pre-BUILD-12 inline hex still exists across components — a
// documented backlog, see CLAUDE.md "Color tokens" — but nothing new adds to
// it.) Semantics are locked: green = positive/up/primary, gold =
// brand/active/highlight, terracotta = negative/attention. A treasurer needs
// terracotta to mean "look here" — never repurpose it.
//
// BUILD-12 enrichment: a real green RAMP (deep pine → mist) so dark panels get
// depth and cards get a warm hover wash, plus a small gold ramp so gold can
// carry more of the highlights (eyebrows, active tabs, key metrics) without
// getting gaudy. terracotta is unchanged.
export const T = {
  // Backgrounds
  bg:         "#f0ede6",
  // BUILD-88d — HOME'S GROUND. Cream at #f0ede6 put a card's white a long way
  // from the page behind it; at 1440 the whole morning screen read as a stack
  // of tiles on a beach. This is the page, one step off white, so the cards
  // separate by their hairline and not by their contrast.
  ground:     "#f7f5f0",
  bg2:        "#e8e4db",   // the stated hairline/tint value
  bg3:        "#d4cfc6",
  bgDeep:     "#e6dfd0",
  bgDark:     "#0f1a12",
  bgCard:     "#ffffff",
  bgElevated: "#1a2e1f",
  // Ink
  ink:        "#0f1a12",
  ink2:       "#2d2d2d",
  // BUILD-86 design rule — WARM GREY, the stated value. ink3 IS "secondary
  // text on light surfaces"; the rule's #5A554F was nowhere in the codebase.
  // 1,084 call sites repaint through this one line, and contrast improves:
  // ~5.4:1 on cream before, ~6.8:1 now.
  ink3:       "#5a554f",
  inkInverse: "#f0ede6",
  // ── BUILD-86 C.1 — ONE ACTION COLOUR ─────────────────────────────────────
  // Emerald #0d5c3a is it. `green` was the retired Tailwind emerald #10b981
  // and `greenMid` was #1a6b4a, so the authenticated app had THREE greens
  // competing for "this is the thing to click". All three names survive —
  // 358 call sites do not need touching to change what they render — and all
  // three now point at the one colour. Every literal of the other two was
  // swept in the same commit, so the brand allowlist (which derives what is
  // legal from THIS object) still permits exactly what exists.
  //
  // Contrast IMPROVES by the collapse, in both directions: #10b981 carried
  // white text at ~2.3:1 and now carries it at 8.6:1; #1a6b4a read on cream
  // at ~4.6:1 and now reads at ~7.4:1.
  green:      "#0d5c3a",
  greenDk:    "#0d5c3a",
  greenMid:   "#0d5c3a",
  // Green ramp (BUILD-12) — deep pine to mist. Use these for depth + hover.
  green950:   "#0e1a13",  // sidebar / ink — deep near-black pine
  green900:   "#102418",  // one step up from ink for layered dark panels
  green800:   "#14352a",  // deep pine — dark panels (goal card) with real depth
  green700:   "#1b5138",  // evergreen — hover-on-dark, secondary depth
  green650:   "#2d4a35",  // hairline borders + input edges on dark panels
  green600:   "#1e6b45",  // primary / positive (≈ greenMid, AA on cream)
  green500:   "#2f8f62",  // emerald — links, accents, active toggles
  green200:   "#dce7df",  // sage — card hover tint, section bands
  green100:   "#edf3ee",  // mist — subtle fills, zebra rows, hover wash
  // ── BUILD-86 C.1 — SAGE IS DELETED ───────────────────────────────────────
  // Sage was the secondary-text colour ON INK, and the four-colour rule has no
  // room for it. Its replacement cannot be warm grey: #5A554F scores about
  // 2.0:1 on ink, a clear AA failure the contrast guard would rightly refuse.
  // It is CREAM AT REDUCED OPACITY instead, which adds no colour at all —
  // cream is white's warm shade by the rule's own wording — and lands near
  // 8.5:1. Warm grey keeps secondary text on LIGHT surfaces, where it belongs.
  // The names survive so call sites did not have to move.
  sage400:    "rgba(240,237,230,0.7)",   // secondary text on ink
  sage600:    "rgba(240,237,230,0.55)",  // tertiary text on ink
  // Accents
  gold:       "#c9a84c",
  terracotta: "#b8593f",   // negative/attention — LOCKED, do not repurpose
  // Terracotta ramp (BUILD-33) — the product's ONLY red family. Errors,
  // destructive outlines, overdue states. Never bright library red.
  terra700:   "#8a3a24",  // deep terracotta — error TEXT on the wash (AA)
  terra200:   "#eac6b8",  // terracotta hairline / border on the wash
  terra100:   "#f6e3dd",  // terracotta wash — error/overdue backgrounds
  // Gold ramp (BUILD-12) — lean on gold a touch more for highlights.
  gold700:    "#8a6d1f",  // deepest gold — small gold text on cream (AA+)
  gold600:    "#a97f22",  // deep gold — gold text on cream (AA, ~4.5:1)
  gold500:    "#c9a84c",  // primary gold (= legacy `gold`)
  gold300:    "#e7cf91",  // soft gold — highlight underlines, hover accents
  gold100:    "#f6eccf",  // gold wash — active-tab tint, callout fills
  gold50:     "#fdfaf2",  // gold-tinted white — gold-moment / StartHere cards
  // Surfaces
  white:      "#ffffff",
  shadow:     "0 1px 3px rgba(10,10,10,0.08), 0 4px 16px rgba(10,10,10,0.06)",
  shadowMd:   "0 4px 24px rgba(10,10,10,0.12), 0 1px 4px rgba(10,10,10,0.08)",
  shadowLg:   "0 8px 48px rgba(10,10,10,0.18), 0 2px 8px rgba(10,10,10,0.10)",
  radius:     "12px",
  radiusSm:   "8px",
  radiusLg:   "16px",
};

// interactive(onClick, {label}) — the ONE shared treatment for a card/row/stat
// that navigates somewhere (BUILD-12 "everything clickable" rule). Returns
// props that make a plain element a real, keyboard-activatable button: role,
// tabIndex, Enter/Space handling, a `.click-card` class (cursor + hover wash +
// visible focus ring, see GlobalStyles). Spread onto the element. Pass no
// onClick (or null) and it returns {} — so a non-interactive element stays
// non-interactive and doesn't look clickable.
export function interactive(onClick, opts = {}) {
  if (!onClick) return {};
  // `dark:true` for interactive DARK panels (goal card etc.) — the light mist
  // hover wash would clobber a dark gradient, so those get a lighter-pine
  // hover instead. Same focus ring either way.
  const base = opts.dark ? "click-card-dark" : "click-card";
  return {
    onClick,
    onKeyDown: e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } },
    role: "button",
    tabIndex: 0,
    "aria-label": opts.label,
    className: base + (opts.className ? " " + opts.className : ""),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────
// Null-safe money formatters live in ../lib/money.js (JSX-free so the Node test
// suite can import them directly) — re-exported here so every existing
// `import { fmt, fmtFull } from "./shared"` keeps working. See BUILD-21 Part 2.
// NB: import (not a bare `export … from`) so fmt/fmtFull are also bound in THIS
// module's scope — shared.jsx itself calls fmt()/fmtFull() (GivingHistoryChart,
// buildContext). A re-export alone left them undefined here and crashed the
// donor profile with "Can't find variable: fmt" (the BUILD-21 fmt regression).
import { fmt, fmtFull, quietPhrase } from "../lib/money";
import { errorMessage } from "../lib/domainError";
export { fmt, fmtFull, quietPhrase };
export const daysDiff = d => Math.floor((new Date()-new Date(d))/86400000);
// BUILD-87 F.3.7 — A COLLEAGUE IS A FIRST NAME. "Admin User" on a row tells a
// prospect they are looking at a fixture; "Margaret Chen · Admin User" tells a
// real office that the software does not know who they are. Inside one org
// everybody is on first-name terms, so that is what a row prints. The stored
// full name is untouched — this is a rendering rule, not a data change.
export const firstNameOf = n => String(n || "").trim().split(/\s+/)[0] || "";
export const daysUntil = d => Math.floor((new Date(d)-new Date())/86400000);

// ── Error boundary (BUILD-21 Part 2 — crash insurance) ──────────────────────
// No component render crash should ever black-screen the app. This catches a
// throw in its subtree, reports it to Sentry (already live in prod), and shows
// a graceful "reload this view / go Home" fallback instead of a blank page — in
// front of a live demo a caught view is survivable, a black screen is not.
// Wrapped app-level (whole shell) AND per major surface/tab (App.jsx), plus at
// the router root (main.jsx). `resetKey` clears a caught error when it changes
// (e.g. the user switches tabs), so navigating away recovers automatically.
function ErrorFallback({ label, onReload, onHome, onRetry }) {
  return (
    <div style={{ minHeight: 240, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 440, textAlign: "center", background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "28px 26px", boxShadow: T.shadow }}>
        <div style={{ fontSize: 22, color: T.terracotta, fontFamily: "'DM Serif Display',serif", marginBottom: 6 }}>Something went wrong</div>
        <div style={{ fontSize: 13.5, color: T.ink3, lineHeight: 1.6, marginBottom: 18 }}>
          This view hit an unexpected error{label ? ` while loading ${label}` : ""}. Your data is safe — the issue has been reported. Try reloading, or head back Home.
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          {onRetry && <button onClick={onRetry} style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 10, padding: "9px 16px", color: T.ink, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Try again</button>}
          <button onClick={onReload} style={{ background: T.greenDk, border: "none", borderRadius: 10, padding: "9px 18px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Reload</button>
          {onHome && <button onClick={onHome} style={{ background: T.gold, border: "none", borderRadius: 10, padding: "9px 18px", color: T.ink, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Go Home</button>}
        </div>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary${this.props.label ? " · " + this.props.label : ""}]`, error, info);
    try { Sentry.captureException(error, { tags: { boundary: this.props.label || "app" }, extra: { componentStack: info?.componentStack } }); } catch (_) {}
  }
  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      const retry = () => this.setState({ error: null });
      if (this.props.fallback) return this.props.fallback(this.state.error, retry);
      return <ErrorFallback label={this.props.label} onRetry={retry} onReload={() => window.location.reload()} onHome={this.props.onHome} />;
    }
    return this.props.children;
  }
}
// Status colors — LOCKED to the five-color palette (BUILD-33 closed the
// blue/purple/amber pill backlog): green shades deliberately varied for
// adjacent statuses, gold = active attention, terracotta = needs attention,
// warm grey = closed/low. No library blue/purple/red/amber, ever.
export const SC = { major:T.greenDk,mid:T.greenMid,new:T.gold500,lapsed:T.terracotta,converted:T.greenMid,active:T.greenMid,pending:T.gold600,prospecting:T.green500,closed:T.ink3,high:T.terracotta,medium:T.gold600,low:T.ink3 };
export const askClaude = (system, user, onChunk) => streamAI(system, user, onChunk);

// ── Org Context Builder ────────────────────────────────────────────────────
export function buildContext(data) {
  const rev = data.financials.revenue; const exp = data.financials.expenses;
  const ytdRev = rev.reduce((s,r)=>s+r.individual+r.grants+r.events+r.other,0);
  const ytdExp = exp.reduce((s,e)=>s+e.programs+e.admin+e.fundraising,0);
  return `ORGANIZATION: ${data.org.name}
MISSION: ${data.org.mission}
PROGRAMS: ${data.org.programs.join(", ")}

DONORS (${data.donors.length} total, ${data.donors.filter(d=>d.status==="lapsed").length} lapsed${data.donors.length>60?"; top 60 by lifetime giving shown":""}):
${data.donors.slice(0,60).map(d=>`- ${d.name} [${d.status}]: ${fmtFull(d.total)} lifetime, last gift ${fmtFull(d.lastAmount)} ${daysDiff(d.lastGift)}d ago.${d.notes?" "+d.notes:""}`).join("\n")}

GRANTS:
${data.grants.map(g=>`- ${g.funder} / ${g.program}: ${fmtFull(g.amount)} [${g.status}] deadline ${g.deadline}. ${g.notes}`).join("\n")}

FINANCIALS: YTD Revenue ${fmtFull(ytdRev)} | YTD Expenses ${fmtFull(ytdExp)} | Net ${fmtFull(ytdRev-ytdExp)}
FUND BALANCES: ${data.financials.funds.map(f=>`${f.name}: ${fmtFull(f.balance)}${f.restricted?" (restricted)":""}`).join(", ")}

BOARD (${data.board.length} members): ${data.board.map(b=>`${b.name} (${b.role}, ${b.givingLevel})`).join(", ")}

OPEN TASKS: ${data.tasks.filter(t=>!t.done).map(t=>`[${t.priority}] ${t.title} due ${t.due}`).join("; ")}`;
}

// ── Stage config ───────────────────────────────────────────────────────────
// Stage colors are drawn only from the five approved brand colors (dark
// green shades, cream, gold, white, terracotta) — no blue/purple/amber/red.
// Deliberately alternates green shades with the two warm accents (gold,
// terracotta) rather than running all four greens in a row, so adjacent
// stages in the pipeline sequence stay visually distinct at a glance
// instead of reading as "two similar greens next to each other." lapsed
// keeps terracotta specifically to match the "needs attention" convention
// used everywhere else in the app (Dashboard queue rows, goal pace badge).
export const STAGES = [
  // Prospect deliberately isn't T.ink (#0f1a12) — that's the exact literal
  // background Donors.jsx's Kanban column headers already render on, which
  // would make Prospect's left-border accent invisible against its own
  // column. bgElevated is still a dark-green-family shade but visibly
  // lighter than that background.
  {id:"prospect",  label:"Prospect",  color:T.bgElevated, hint:"Identified, not yet engaged"},
  {id:"qualify",   label:"Qualify",   color:T.gold, hint:"Researching fit & capacity"},
  {id:"cultivate", label:"Cultivate", color:T.greenMid, hint:"Building relationship"},
  {id:"solicit",   label:"Solicit",   color:T.green, hint:"Ready for the ask"},
  {id:"steward",   label:"Steward",   color:T.greenDk, hint:"Deepen post-gift relationship"},
  {id:"lapsed",    label:"Lapsed",    color:T.terracotta, hint:"Needs re-engagement"},
];
export const STAGE_THRESH = {prospect:[60,120],qualify:[14,30],cultivate:[30,60],solicit:[7,14],steward:[30,90],lapsed:[90,180]};
// BUILD-88a A.4 — the voice guard reaches these: no em dashes in a rendered
// sentence. A dash is a pause somebody typed; Steward's own copy uses a full
// stop, which is what the sentence meant.
export const STAGE_ACTION = {
  prospect:"Research capacity. Find a warm introduction.",
  qualify: "Schedule a discovery call or coffee",
  cultivate:"Share an impact story or invite to a program visit",
  solicit: "Book a gift conversation and make the ask",
  steward: "Send personalized impact update or thank you",
  lapsed:  "Personal outreach. Acknowledge the lapse and invite them back.",
};
export const TIER_COLOR = {Micro:T.ink3,Small:T.green500,Mid:T.greenMid,Major:T.greenDk,Principal:T.gold600};

// ── Score helpers ──────────────────────────────────────────────────────────
export function donorScore(d) {
  // BUILD-79 Part 6 — score on no giving data is NO SCORE. 1,111 giftless
  // imports once all scored 35 (base 5 + a recency 30 earned by the read-side
  // today-fallback). A donor with zero gifts, no dollars and no last-gift
  // date has nothing to score; render blank with "no gifts on file".
  if (!(d.gifts > 0) && !(d.total > 0) && !d.lastGift) return null;
  let s=0;
  if(d.total>20000)s+=35; else if(d.total>5000)s+=22; else if(d.total>1000)s+=12; else s+=5;
  const days=d.lastGift?daysDiff(d.lastGift):null;
  if(days!=null){ if(days<90)s+=30; else if(days<180)s+=22; else if(days<365)s+=12; }
  s+=Math.min(d.gifts*4,20);
  if(d.status==="lapsed")s-=15;
  if(d.tags.includes("board-adjacent"))s+=10;
  if(d.tags.includes("recurring"))s+=5;
  return Math.max(5,Math.min(s,99));
}

export function retentionRisk(d) {
  const days = daysDiff(d.lastGift);
  let risk = 0;
  if (days > 365) risk += 40; else if (days > 270) risk += 25; else if (days > 180) risk += 12;
  if (d.gifts < 2) risk += 20; else if (d.gifts < 4) risk += 8;
  if (d.status === "lapsed") risk += 30;
  if (d.tags.includes("recurring")) risk -= 15;
  if (d.tags.includes("board-adjacent")) risk -= 10;
  risk = Math.max(0, Math.min(risk, 99));
  const level = risk >= 55 ? "high" : risk >= 30 ? "medium" : "low";
  const reasons = [];
  if (days > 270) reasons.push(`${days}d since last gift`);
  if (d.gifts < 2) reasons.push("one-time donor");
  if (d.status === "lapsed") reasons.push("marked lapsed");
  const actions = { high:"Call this week — personal touch required", medium:"Send a targeted update in next 2 weeks", low:"Keep on regular cadence" };
  return { risk, level, reason: reasons.join(", ") || "steady engagement", action: actions[level] };
}

export function moveUrgency(d) {
  const lastContact=d.lastTouchpoint||d.lastGift;
  const days=lastContact?daysDiff(lastContact):999;
  const [warn,crit]=STAGE_THRESH[d.stage||"cultivate"]||[30,60];
  const level=days>crit?"critical":days>warn?"due":"ok";
  const urgencyColor={critical:T.terracotta,due:T.gold600,ok:T.greenMid}[level];
  const contactTextColor=days>365?T.terracotta:days>180?T.gold600:T.ink3;
  return{days,level,urgencyColor,contactTextColor};
}

// ── Global styles ──────────────────────────────────────────────────────────
export function GlobalStyles() {
  return <style>{`
    html,body{margin:0;padding:0;overflow-x:hidden;max-width:100vw;background:#f0ede6;-webkit-font-smoothing:antialiased;overscroll-behavior:none;}
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
    body{font-family:'DM Sans',system-ui,sans-serif;color:#0f1a12;}
    h1,h2,h3{font-family:'DM Serif Display',Georgia,serif;letter-spacing:-0.02em;}
    ::-webkit-scrollbar{width:5px;height:5px;}
    ::-webkit-scrollbar-track{background:#e8e4db;}
    ::-webkit-scrollbar-thumb{background:#c9a84c;border-radius:99px;}
    ::-webkit-scrollbar-thumb:hover{background:#a97f22;}
    ::selection{background:#0d5c3a22;color:#0f1a12;}
    input,textarea,select{background:#fdfaf2;border:1.5px solid #d4cfc6;border-radius:8px;color:#0f1a12;transition:border-color 0.15s,box-shadow 0.15s;}
    input:focus,textarea:focus,select:focus{border-color:#0d5c3a!important;box-shadow:0 0 0 3px rgba(13,92,58,0.12)!important;outline:none!important;}
    button{transition:all 0.15s ease;touch-action:manipulation;}
    button:not(:disabled):active{transform:scale(0.97);}
    .app-header{padding-top:env(safe-area-inset-top,0px);user-select:none;}
    .app-sidebar{user-select:none;}
    .app-topbar{user-select:none;}
    .topbar-search::placeholder{color:rgba(240,237,230,0.7);}
    .topbar-search:focus{border-color:#c9a84c!important;box-shadow:0 0 0 3px rgba(201,168,76,0.14)!important;}
    .side-nav-btn:hover{color:#f0ede6!important;}
    .mobile-bottom-bar,.mobile-more-drawer{user-select:none;}
    @keyframes sp{to{transform:rotate(360deg)}}
    @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
    @keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
    @keyframes slideIn{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}
    @keyframes slideup{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
    @keyframes goldRise{from{opacity:0;transform:translateY(8px) scale(0.985)}to{opacity:1;transform:translateY(0) scale(1)}}
    @keyframes goldSheen{0%{background-position:-200% 0}100%{background-position:200% 0}}
    .gold-moment{animation:goldRise 0.5s cubic-bezier(0.2,0.8,0.3,1) backwards;}
    .gold-moment .gold-moment-bar{background:linear-gradient(100deg,#c9a84c 40%,#e7cf91 50%,#c9a84c 60%);background-size:200% 100%;animation:goldSheen 1.8s ease-out 0.4s 1;}
    @media (prefers-reduced-motion: reduce){.gold-moment,.gold-moment .gold-moment-bar{animation:none;}}

    /* BUILD-94 FIRST RUN — the gold moment at full-screen scale. The SAME
       gesture (a rise and one sheen), nothing new: no confetti, no second
       palette, and every movement off under prefers-reduced-motion while the
       greeting itself still reads. */
    @keyframes frIn{from{opacity:0}to{opacity:1}}
    @keyframes frOut{from{opacity:1}to{opacity:0}}
    @keyframes frRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
    /* The herd runs left to right, because the horse faces right. Each one is
       off-screen at both ends of its own travel, so nobody appears or vanishes
       mid-screen. */
    @keyframes frCross{from{transform:translateX(-340px)}to{transform:translateX(calc(100vw + 340px))}}
    .fr-welcome{animation:frIn 0.45s ease-out backwards;}
    .fr-welcome.fr-leaving{animation:frOut 0.4s ease-in forwards;}
    .fr-welcome .fr-eyebrow{animation:frRise 0.6s cubic-bezier(0.2,0.8,0.3,1) 0.15s backwards;}
    .fr-welcome .fr-title{animation:frRise 0.7s cubic-bezier(0.2,0.8,0.3,1) 0.25s backwards;}
    .fr-welcome .fr-rule{animation:frRise 0.6s cubic-bezier(0.2,0.8,0.3,1) 0.45s backwards;}
    .fr-welcome .fr-line{animation:frRise 0.7s cubic-bezier(0.2,0.8,0.3,1) 0.55s backwards;}
    .fr-welcome .fr-words{animation:frRise 0.7s cubic-bezier(0.2,0.8,0.3,1) 0.7s backwards;}
    .fr-welcome .fr-sub{animation:frRise 0.7s cubic-bezier(0.2,0.8,0.3,1) 0.85s backwards;}
    .fr-welcome .fr-card button{animation:frRise 0.7s cubic-bezier(0.2,0.8,0.3,1) 1s backwards;}
    /* LINEAR, and looping. Anything eased reads as a horse slowing down in the
       middle of the screen, which no horse does. */
    .fr-welcome .fr-horse{animation-name:frCross;animation-timing-function:linear;
      animation-iteration-count:infinite;will-change:transform;}
    @media (max-width:640px){
      .fr-welcome .fr-title{font-size:38px!important;}
      .fr-welcome .fr-line{font-size:17px!important;}
    }
    @media (prefers-reduced-motion: reduce){
      .fr-welcome,.fr-welcome.fr-leaving,.fr-welcome .fr-eyebrow,.fr-welcome .fr-title,
      .fr-welcome .fr-rule,.fr-welcome .fr-line,.fr-welcome .fr-words,.fr-welcome .fr-sub,
      .fr-welcome .fr-card button,.fr-welcome .fr-horse{animation:none;}
      /* The herd still stands there; it simply does not run. */
      .fr-welcome .fr-horse:nth-child(2){transform:translateX(12vw);}
      .fr-welcome .fr-horse:nth-child(3){transform:translateX(34vw);}
      .fr-welcome .fr-horse:nth-child(4){transform:translateX(58vw);}
      .fr-welcome .fr-horse:nth-child(5){transform:translateX(78vw);}
      .fr-welcome .fr-horse:nth-child(6){transform:translateX(22vw);}
      .fr-welcome .fr-horse:nth-child(7){transform:translateX(66vw);}
      .fr-welcome .fr-horse:nth-child(8){transform:translateX(44vw);}
    }
    }
    /* BUILD-87 F.1 — animation-fill-mode is "backwards", NOT "both". Every one
       of these animations ends on the identity transform, so "both" retained a
       transform of translateY(0) forever, and an element with any transform
       other than none is a CONTAINING BLOCK for every position:fixed
       descendant. That is how the Edit-campaign dialog ended up drawn at the
       middle of a tall page under a backdrop that covered only part of it
       (BUILD-22 found this; two components had worked around it locally).
       "backwards" holds the from-keyframe before the animation starts, which is
       the only part that was ever needed, and reverts to the element's own
       style afterwards. Visually identical; structurally inert.
       The Modal shell portals to document.body anyway — this is the belt to
       that pair of braces, so the next component to grow a transform cannot
       break dialogs for everybody. */
    .fade-in{animation:fadeIn 0.2s ease-out backwards;}
    .slide-in{animation:slideIn 0.18s ease-out backwards;}
    .slide-up{animation:slideup 0.25s ease backwards;}
    .modal-anim{animation:slideUp 0.2s ease-out backwards;}
    .card-click{transition:transform 0.15s ease,box-shadow 0.15s ease,border-color 0.15s;}
    .card-click:hover{box-shadow:0 4px 24px rgba(10,10,10,0.12)!important;transform:translateY(-1px);border-color:#0d5c3a!important;}
    /* BUILD-12 shared interactive treatment — see interactive() in shared.jsx.
       Any aggregate/entity that navigates gets this: pointer, a warm green
       hover wash + gold accent, and a visible keyboard focus ring. */
    .click-card{cursor:pointer;transition:background 0.14s ease,box-shadow 0.15s ease,border-color 0.15s ease,transform 0.14s ease;outline:none;}
    .click-card:hover{background:#edf3ee!important;border-color:#c9a84c!important;box-shadow:0 4px 20px rgba(10,10,10,0.10)!important;transform:translateY(-1px);}
    .click-card:focus-visible{box-shadow:0 0 0 3px rgba(201,168,76,0.45)!important;border-color:#c9a84c!important;}
    /* Dark interactive panels (goal card): NO background change — the inline
       pine gradient must survive — just a gold edge + lift on hover, same
       gold focus ring. Deliberately does not carry the .click-card class so
       the light mist wash can never clobber the gradient. */
    .click-card-dark{cursor:pointer;transition:box-shadow 0.15s ease,border-color 0.15s ease,transform 0.14s ease;outline:none;}
    .click-card-dark:hover{border-color:#c9a84c!important;box-shadow:0 6px 26px rgba(0,0,0,0.28)!important;transform:translateY(-1px);}
    .click-card-dark:focus-visible{box-shadow:0 0 0 3px rgba(201,168,76,0.5)!important;border-color:#c9a84c!important;}
    /* gold wash behind an active section tab (added by SectionTabs) */
    .section-tab-on{background:#f6eccf66!important;}
    .dash-row:hover{background:#f0ede6!important;box-shadow:inset 2px 0 0 #0d5c3a;}
    /* D-1 (BUILD-45): "Needs your attention" row main is a real link. Hover
       affordance so it reads as clickable, not broken — cream-alt wash + the
       donor name underlines. Colour change only, so no transition is needed
       under prefers-reduced-motion. Brass focus ring for keyboard. */
    /* BUILD-87 F.3.3 — the row's record is there when you want it and silent
       when you do not. opacity (not display) so the row never changes height;
       focus-within so a keyboard reaches it; and always-on where there is no
       hover, because a phone cannot ask for it. */
    .attn-meta{opacity:0;transition:opacity 0.12s ease;}
    .attn-row:hover .attn-meta,.attn-row:focus-within .attn-meta{opacity:1;}
    @media (hover:none),(pointer:coarse){.attn-meta{opacity:1;}}
    @media (prefers-reduced-motion:reduce){.attn-meta{transition:none;}}
    .attn-row-main{cursor:default;}
    a.attn-row-main{cursor:pointer;}
    .attn-row:hover{background:#f7f5f0;}
    .attn-row[data-railsel="1"]{background:#f7f5f0;}
    a.attn-row-main:hover .attn-donor-name{text-decoration:underline;}
    a.attn-row-main:focus-visible,
    .fr-welcome .fr-card button:focus-visible{outline:2px solid #c9a84c;outline-offset:-2px;border-radius:2px;}
    /* Touch: each of the row's two targets clears the 44px minimum, and a tap
       on one never fires the other (they're siblings, not nested). */
    .attn-row-main{min-height:44px;}
    .attn-row-action{min-height:44px;}
    /* ── BUILD-89 — HOME IS ONE PANEL ──────────────────────────────────────
       White panel on the light ground, the work on the left and the rail on
       the right with ONE hairline between them. Below 1100 it stacks and the
       rail goes FIRST (order:-1) — three numbers are the right thing to meet
       on a phone, and the work follows. minmax/min-width:0 everywhere: a long
       donor name in a flex child otherwise refuses to shrink. */
    .home-shell{background:#ffffff;border:1px solid #e8e4db;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;}
    .home-shell-main{min-width:0;padding:40px;display:flex;flex-direction:column;}
    .home-rail{min-width:0;padding:32px;border-top:1px solid #e8e4db;order:-1;}
    @media (min-width:1100px){
      .home-shell{flex-direction:row;align-items:stretch;}
      .home-shell-main{flex:1;}
      .home-rail{order:0;width:340px;flex-shrink:0;border-top:none;border-left:1px solid #e8e4db;}
    }
    /* A row in the rail is pressable and says so quietly. */
    .home-rail-row{cursor:pointer;transition:background 0.12s ease;}
    .home-rail-row+.home-rail-row{border-top:1px solid #e8e4db;}
    .home-rail-row:hover,.home-rail-row:focus-visible{background:#f7f5f0;}
    @media (prefers-reduced-motion:reduce){.home-rail-row{transition:none;}}
    /* A section inside the panel is separated by air and a rule, never by a
       second border — the panel already drew one. */
    .home-block{margin-top:28px;}
    .home-block+.home-block{border-top:1px solid #e8e4db;padding-top:28px;}
    /* FIX (2026-09-18) — the row is Drift's shape now: a face, a sentence that
       WRAPS, one fact on the right. A fixed 64px is what forced the sentence
       into one truncated line in the first place, so the height is the
       content's and the minimum is the touch target. */
    .attn-row{min-height:64px;box-sizing:border-box;}
    .rpt-row-click:hover td{background:#f0ede6;}
    .dash-action:hover{background:#f0ede6!important;border-color:#0d5c3a!important;transform:translateY(-1px);}

    /* ── Mobile bottom nav (hidden on desktop) ─────────────────────────── */
    .mobile-bottom-bar{display:none;position:fixed;bottom:0;left:0;right:0;z-index:150;background:#0f1a12;border-top:1px solid #1a2e1f;box-shadow:0 -1px 0 rgba(0,0,0,.2),0 -4px 20px rgba(0,0,0,.15);padding-bottom:env(safe-area-inset-bottom,0px);}
    .mobile-bottom-tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:transparent;border:none;cursor:pointer;padding:8px 4px;color:rgba(240,237,230,0.7);font-family:'DM Sans',system-ui,sans-serif;font-size:9px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;min-height:60px;transition:color .15s;}
    .mobile-bottom-tab .mob-icon{font-size:18px;line-height:1.2;margin-bottom:1px;display:block;}
    .mobile-bottom-tab.active{color:#c9a84c;}
    .mobile-more-overlay{display:none;position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.6);align-items:flex-end;}
    .mobile-more-drawer{background:#0f1a12;border-radius:20px 20px 0 0;width:100%;padding-bottom:env(safe-area-inset-bottom,0px);overflow:hidden;}
    .mobile-more-handle{width:36px;height:4px;border-radius:2px;background:#1a2e1f;margin:12px auto 4px;}
    .mobile-more-row{display:flex;align-items:center;gap:16px;width:100%;background:transparent;border:none;border-bottom:1px solid #1a2e1f;padding:16px 24px;color:#f0ede6;font-family:'DM Sans',system-ui,sans-serif;font-size:16px;font-weight:500;cursor:pointer;text-align:left;}
    .mobile-more-row .mob-icon{font-size:20px;width:28px;text-align:center;flex-shrink:0;}
    .mobile-more-row.active{color:#c9a84c;font-weight:700;}
    .mobile-more-signout{display:flex;align-items:center;gap:16px;width:100%;background:transparent;border:none;padding:16px 24px;color:rgba(240,237,230,0.7);font-family:'DM Sans',system-ui,sans-serif;font-size:16px;font-weight:400;cursor:pointer;text-align:left;}
    .dir-stage-mobile{display:none;}
    /* BUILD-41 mobile donor rows + Select toggle — desktop never shows them */
    .dir-row-mobile{display:none;}
    .dir-select-toggle{display:none;}

    /* Directory: Assign button reveals on row hover/focus instead of sitting
       visible on every row at all times — same click target, just quieter
       when you're not looking at that row. Keyboard/focus-within keeps it
       reachable without a mouse. */
    .dir-assign-btn{opacity:0;transition:opacity 0.12s;}
    .dir-donor-row:hover .dir-assign-btn,.dir-donor-row:focus-within .dir-assign-btn{opacity:1;}

    /* Timeline/activity delete: hover-reveal like .dir-assign-btn (always
       visible on mobile — see the media block below — since there's no hover) */
    .tp-del-btn{opacity:0;transition:opacity 0.12s;}
    .tp-row:hover .tp-del-btn,.tp-row:focus-within .tp-del-btn{opacity:1;}

    @media(max-width:768px){
      /* No hover on touch — delete icon stays visible (small target, guarded
         by the confirm dialog) */
      .tp-del-btn{opacity:1!important;}

      /* Root overflow kill — nothing bleeds past viewport */
      .app-root{overflow-x:hidden!important;max-width:100vw!important;}
      .app-content{padding:20px 16px calc(68px + env(safe-area-inset-bottom,0px)) 16px!important;max-width:100%!important;overflow-x:hidden!important;}

      /* Navigation — desktop sidebar + top bar hidden, mobile header restored */
      .app-sidebar{display:none!important;}
      .app-topbar{display:none!important;}
      .app-main{margin-left:0!important;margin-top:0!important;}
      .app-header{display:flex!important;}
      /* Full-screen takeovers cover the whole screen on mobile (no fixed bar
         to sit under) — reset the desktop top:52 offset. */
      .fullscreen-takeover{top:0!important;}
      .app-signout{display:none!important;}
      .mobile-bottom-bar{display:flex!important;}
      .mobile-more-overlay{display:flex!important;}

      /* Home screen: queue stacks full-width, funnel/grant-tile column moves
         below it (DOM order: queue+briefing first, funnel+grant-tile second) */
      .dash-main-grid{grid-template-columns:1fr!important;}
      .dash-main-grid>div{min-width:0!important;width:100%!important;}
      /* BUILD-16 command-center headers stack 2-up on phones */
      .dash-cmd-grid{grid-template-columns:1fr 1fr!important;}
      /* Dashboard mobile comprehensive */
      .dash-root{font-size:14px!important;}
      .dash-bleed{margin:-20px -16px calc(-68px - env(safe-area-inset-bottom,0px)) -16px!important;padding:16px 16px calc(84px + env(safe-area-inset-bottom,0px)) 16px!important;}
      .dash-cpad{padding:16px!important;}
      /* BUILD-89 — the panel's own padding on a phone. */
      .home-shell{border-radius:12px!important;}
      .home-shell-main{padding:20px!important;}
      .home-rail{padding:20px!important;}
      .home-rail-date{display:none!important;}
      /* BUILD-88d — a card header is a title and a link, and at 390px they run
         into each other on one line ("20 thank-yous ready.Teach Steward your
         voice"). They wrap, with a gap, on a phone. Seen in the walk's own
         capture, not in an assertion. */
      .dash-cpad{flex-wrap:wrap!important;gap:8px!important;}
      /* BUILD-87 F.3 — 32px of card padding is a desktop measure; at 390px it
         would leave a donor's name about 300px to live in. */
      /* BUILD-89 — the panel supplies the horizontal padding on a phone. */
      .attn-row{padding:12px 0!important;}
      .attn-band{padding:18px 0 6px 13px!important;}
      /* …and the row's THREE regions cannot share one line on a phone. Found
         by looking at the walk's 390px capture, not by an assertion: name,
         next step and buttons all collided and the Dismiss button ran off the
         right edge. They stack, the next step goes left-aligned under the
         name, and the buttons take the row below it. */
      .attn-row{flex-wrap:wrap!important;}
      .attn-row .attn-row-main{flex:1 1 100%!important;}
      .attn-row .attn-clause{flex-wrap:wrap!important;}
      .attn-row .attn-meta{flex-basis:100%!important;white-space:normal!important;}
      .attn-row .attn-row-next{flex:1 1 100%!important;text-align:left!important;margin-top:6px!important;}
      .attn-row .attn-row-next>div{max-width:100%!important;}
      .attn-row .attn-row-actions{flex:1 1 100%!important;margin-top:10px!important;}
      .attn-row .attn-row-action{flex:1!important;}
      /* A 40px headline at 24ch overflows a 390px screen. The measure is the
         point, not the size. */
      .home-note{font-size:26px!important;margin-bottom:20px!important;}
      /* the rail's numbers step down with everything else on a phone */
      .home-rail-n{font-size:32px!important;}
      .attn-row{min-height:0!important;}
      .dash-briefing-body{padding:12px 14px!important;}
      .dash-briefing-hdr{flex-wrap:wrap!important;align-items:flex-start!important;gap:8px!important;}
      .dash-briefing-hdr>div:last-child{align-self:flex-start!important;}
      /* Goal banner: keep full-width and prominent */
      .dash-goal-banner{padding:16px 18px!important;}
      /* Queue rows: keep avatar+name+reason on one line, force the action
         button onto its own full-width line below (flex-basis:100% forces
         a wrap point in a flex-wrap row) instead of squeezing the text. */
      .dash-queue-row{flex-wrap:wrap!important;padding:12px 14px!important;}
      .dash-queue-action{flex-basis:100%!important;margin-top:10px!important;padding:10px!important;text-align:center!important;}

      /* Donors toolbar */
      .donors-toolbar{flex-direction:column!important;align-items:stretch!important;gap:8px!important;}
      .donors-search{flex:none!important;min-width:unset!important;width:100%!important;}
      .donors-view-toggle{width:100%!important;}
      .donors-view-toggle button{flex:1!important;justify-content:center!important;}

      /* Kanban: contained horizontal scroll only — page never scrolls horiz */
      .donor-kanban-wrap{display:flex!important;flex-direction:row!important;overflow-x:auto!important;overflow-y:visible!important;-webkit-overflow-scrolling:touch!important;scroll-snap-type:x mandatory!important;align-items:flex-start!important;min-height:auto!important;padding-bottom:12px!important;gap:10px!important;width:100%!important;}
      .kanban-col{min-width:268px!important;width:268px!important;max-width:268px!important;flex-shrink:0!important;scroll-snap-align:start!important;}

      /* Donor profile: single column with ONE scroller (BUILD-41). The left
         column used to keep its own overflowY:auto inside the stacked grid,
         so it height-capped and SLICED the Giving History card mid-render
         with the dark rail starting straight through it. The body is now the
         only scroll container; both columns grow to their content. */
      .donor-profile-body{grid-template-columns:1fr!important;overflow-y:auto!important;overflow-x:hidden!important;}
      /* min-width:0 matters: with overflow:visible a grid item's auto min
         size is its content's min-content (the 537px tab row) — without it
         the whole column blows out sideways. */
      .donor-profile-body>div{overflow:visible!important;height:auto!important;border-right:none!important;min-width:0!important;max-width:100%!important;}
      .dp-tabs{overflow-x:auto!important;}
      /* Header stays ONE row: compact "←" back (word hidden) beside the donor
         name — the full-width Back bar wasted ~60px of a 700px fold. */
      .donor-profile-header{flex-wrap:wrap!important;padding:10px 14px!important;gap:8px!important;}
      .dph-back{padding:8px 12px!important;font-size:16px!important;min-width:40px!important;min-height:40px!important;}
      .dph-back-word{display:none!important;}
      .dph-identity{flex:1 1 auto!important;min-width:0!important;}
      /* Action row: Request Gift is the full-width primary; Impact Summary +
         Edit live behind the "⋯" overflow (they wrapped and misaligned at
         four-across on 390px). Delete is gone from this row entirely. */
      .dph-actions{width:100%!important;flex-shrink:unset!important;gap:8px!important;}
      .dph-primary{flex:1!important;min-height:48px!important;font-size:14px!important;}
      .dph-desktop-act{display:none!important;}
      .dph-more{display:flex!important;align-items:center!important;justify-content:center!important;min-width:48px!important;min-height:48px!important;}
      .donor-stat-grid{grid-template-columns:repeat(2,1fr)!important;}
      /* Profile tab row: right-edge fade = "there's more" affordance (a MASK,
         not a color fill — the §9 gradient ban is about bars/thermometers). */
      /* mask stops only use ALPHA — ink stands in for opaque (allowlist-clean) */
      .dp-tabs{-webkit-mask-image:linear-gradient(to right,#0f1a12 88%,transparent);mask-image:linear-gradient(to right,#0f1a12 88%,transparent);}

      /* Directory donor list (BUILD-41): the desktop table is GONE under
         768px — it crushed names to a 68px cell ("M…", "Ju…"). One tappable
         row per donor instead: full 17px name (wraps, never truncates),
         inline stage chip, muted meta line, right-aligned score badge.
         Checkboxes exist only in explicit Select mode. */
      .dir-header-row,.dir-donor-row{display:none!important;}
      .dir-row-mobile{display:flex!important;}
      .dir-select-toggle{display:inline-flex!important;}

      /* ReEngage table: hide non-essential columns, fix grid template */
      .reEngage-header{grid-template-columns:1fr 90px 100px!important;}
      .reEngage-row{grid-template-columns:1fr 90px 100px!important;}
      .re-col-lifetime,.re-col-lastgift,.re-col-score{display:none!important;}

      /* Filter bar */
      .filter-bar{flex-direction:column!important;gap:12px!important;}
      .filter-bar-row{flex-direction:column!important;align-items:flex-start!important;gap:8px!important;}

      /* Mobile modal sheets */
      .modal-sheet-overlay{align-items:flex-end!important;padding:0!important;}
      .modal-sheet-inner{border-radius:20px 20px 0 0!important;max-width:100%!important;width:100%!important;max-height:90vh!important;margin:0!important;}

      /* Ensure all cards and containers never exceed viewport */
      .fade-in,[class*="card"]{max-width:100%!important;}

      /* Finance now uses SectionTabs (.section-tabbar) which scrolls
         horizontally on its own — no finance-specific override needed. */

      /* Grants pipeline + profile */
      .grants-pipeline-grid{grid-template-columns:repeat(2,1fr)!important;}
      .grant-profile-body{display:flex!important;flex-direction:column!important;overflow-y:auto!important;overflow-x:hidden!important;}
      .grant-profile-body>div{overflow-y:visible!important;border-right:none!important;padding:14px 16px!important;}
      .grant-stat-grid{grid-template-columns:repeat(2,1fr)!important;}
      .grant-2col{grid-template-columns:1fr!important;}
      .grant-add-form-grid{grid-template-columns:1fr!important;}

      /* Communications: section tabs already scroll horizontally (SectionTabs
         base style) — no mobile override needed since the top-tab flip */

      /* Volunteers + Board: 3-col → 2-col */
      .vol-metric-grid,.board-metric-grid{grid-template-columns:repeat(2,1fr)!important;}

      /* Events */
      .events-stats-grid{grid-template-columns:repeat(2,1fr)!important;}
      .events-grid{grid-template-columns:1fr!important;}
      .event-detail-body{grid-template-columns:1fr!important;overflow-y:auto!important;overflow-x:hidden!important;}
      .event-detail-body>div{overflow-y:visible!important;border-right:none!important;padding:14px 16px!important;}

      /* Reports: tabs scroll horizontally at any width (SectionTabs base);
         table scrolls inside its own container (page never scrolls horiz) */
      .reports-table-wrap{overflow-x:auto!important;-webkit-overflow-scrolling:touch!important;max-width:100%!important;}

      /* Signup: two-column hero → stacked single column */
      .signup-shell{flex-direction:column!important;min-height:auto!important;}
      .signup-left{width:100%!important;min-width:unset!important;padding:28px 20px 20px!important;flex-shrink:unset!important;}
      .signup-left-top{margin-bottom:20px!important;}
      .signup-left-hero{margin-bottom:20px!important;}
      .signup-right{flex:none!important;padding:0 20px 32px!important;overflow:visible!important;}
      .signup-card{max-width:100%!important;padding:24px 20px!important;}
    }
  `}</style>;
}

// ── UI Atoms ───────────────────────────────────────────────────────────────

// ── Modal — THE ONE MODAL SHELL (BUILD-87 F.1) ─────────────────────────────
// Every dialog in the app renders through this. There were twenty-eight ad hoc
// shells before it, each re-deciding its own backdrop, z-index, scroll and
// dismissal, and the Edit-campaign dialog on Fundraising > Campaigns was
// clipped below "Start date" with the backdrop covering only the top of a tall
// page. The cause is old and documented (BUILD-22): `.fade-in` and friends
// animate a TRANSFORM with `animation-fill-mode: both`, so the final keyframe's
// `translateY(0)` is retained forever and the element becomes the containing
// block for every `position:fixed` descendant. A fixed overlay inside one is
// not fixed to the viewport at all — it is fixed to a div that may be 4,000px
// tall. `RecurringGiving.jsx` had already learned this and portalled its own.
//
// So: PORTAL TO document.body, where no ancestor can ever do that again. The
// fill-mode is fixed too (`backwards`, below) — belt and braces, because the
// next component to grow a transform should not be able to break dialogs.
//
// What every dialog gets, once, instead of twenty-eight times:
//   · backdrop `position:fixed; inset:0` on document.body
//   · `max-height:90vh` with the BODY scrolling, so nothing is ever cut off
//   · an optional sticky footer, so a long form's primary action stays put
//   · body scroll locked while open (ref-counted, so nested dialogs nest)
//   · Escape closes; focus moves in on open and RETURNS TO THE OPENER on close
//   · the mobile bottom-sheet treatment (`.modal-sheet-*`) for all of them
//
// `padding`, `width` and `dialogStyle` exist so a call site can keep the
// appearance it had: this commit consolidates the SHELL, and is not a licence
// to restyle thirty screens in the same breath.
let scrollLocks = 0;
export function Modal({
  onClose, title, subtitle, header, footer, children,
  width = 460, align = "center", zIndex = 400,
  backdrop = "#0f1a12cc", blur = true,
  padding = "24px 26px", dialogStyle, overlayStyle,
  className = "", dismissOnBackdrop = true, ariaLabel,
}) {
  const dialogRef = useRef(null);
  // THE OPENER IS CAPTURED DURING RENDER, NOT IN THE EFFECT. React applies a
  // child's `autoFocus` during COMMIT, which is before useEffect runs — so an
  // effect that reads `document.activeElement` on mount reads the dialog's own
  // first field and "returns focus" to a node that is about to be unmounted.
  // Closing the Edit-campaign dialog dropped focus to <body> every time, and
  // the only way to see that was to measure where focus actually landed.
  // At first render the dialog is not in the DOM yet, so this is the opener.
  const openerRef = useRef(null);
  if (openerRef.current === null && typeof document !== "undefined") openerRef.current = document.activeElement;
  // `onClose` is almost always an inline arrow at the call site, so its
  // identity changes on every render of the parent. Keeping it in the effect's
  // dependency list therefore re-ran the whole open/close cycle on every
  // render: each re-run's CLEANUP restored focus and each new run re-read
  // `document.activeElement`, so by the time the dialog actually closed the
  // "opener" it remembered was <body>. Found by the F.1 walk, which measured
  // where focus landed instead of trusting that it landed somewhere.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // Ref-counted: a dialog opened FROM a dialog must not unlock the page when
    // only the inner one closes.
    if (scrollLocks === 0) {
      document.body.dataset.modalScrollY = String(document.body.style.overflow || "");
      document.body.style.overflow = "hidden";
    }
    scrollLocks++;
    // Move focus in, so Escape and Tab land somewhere sensible. `preventScroll`
    // because focusing a control inside a freshly portalled dialog otherwise
    // scrolls the page behind it.
    const first = dialogRef.current?.querySelector(
      "[autofocus],input:not([type=hidden]):not([disabled]),select,textarea,button:not([disabled]),[href],[tabindex]:not([tabindex='-1'])");
    (first || dialogRef.current)?.focus?.({ preventScroll: true });

    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); onCloseRef.current?.(); } };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      scrollLocks = Math.max(0, scrollLocks - 1);
      if (scrollLocks === 0) document.body.style.overflow = document.body.dataset.modalScrollY || "";
      // Returning focus to the opener is the half of "Escape closes it" that
      // keyboard users actually feel: without it focus falls to <body> and the
      // next Tab starts from the top of the page.
      const back = openerRef.current;
      if (back && back !== document.body && document.contains(back)) back.focus?.({ preventScroll: true });
    };
    // Mount/unmount ONLY. Everything inside reads through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overlay = {
    position: "fixed", inset: 0, zIndex, background: backdrop,
    backdropFilter: blur ? "blur(4px)" : undefined,
    display: "flex", alignItems: align === "top" ? "flex-start" : "center",
    justifyContent: "center", padding: align === "top" ? "6vh 16px 16px" : 20,
    overflowY: "auto", ...overlayStyle,
  };
  const dialog = {
    display: "flex", flexDirection: "column",
    background: T.white, borderRadius: 18, boxShadow: T.shadowLg,
    width: "100%", maxWidth: width, maxHeight: "90vh",
    boxSizing: "border-box", overflow: "hidden", outline: "none",
    ...dialogStyle,
  };

  return createPortal(
    <div className="modal-overlay modal-sheet-overlay" style={overlay}
      onMouseDown={e => { if (dismissOnBackdrop && e.target === e.currentTarget) onClose?.(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={ariaLabel || title || undefined}
        tabIndex={-1} className={"modal-anim modal-sheet-inner " + className} style={dialog}>
        {/* A dialog whose header is more than a title and a line of prose
            passes its own node; it still does not scroll with the body. */}
        {header && <div style={{ flexShrink: 0 }}>{header}</div>}
        {title && (
          <div style={{ flexShrink: 0, padding: "22px 26px 0", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 21, fontWeight: 400, color: T.ink, lineHeight: 1.2 }}>{title}</div>
              {subtitle && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 5, lineHeight: 1.5 }}>{subtitle}</div>}
            </div>
            <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 19, lineHeight: 1, color: T.ink3, cursor: "pointer", padding: 4, flexShrink: 0 }}>✕</button>
          </div>
        )}
        <div className="modal-body" style={{ overflowY: "auto", minHeight: 0, flex: "1 1 auto", padding: title ? "16px 26px 24px" : padding }}>
          {children}
        </div>
        {footer && (
          <div style={{ flexShrink: 0, borderTop: "1px solid " + T.bg3, padding: "14px 26px", background: T.white,
                        display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body);
}

export function Spin() {
  return <span style={{display:"inline-block",width:11,height:11,border:"2px solid #ffffff30",borderTopColor:"#fff",borderRadius:"50%",animation:"sp 0.7s linear infinite",flexShrink:0}}/>;
}
export function Pill({label,color}) {
  return <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",padding:"4px 10px",borderRadius:99,background:(color||T.ink3)+"1a",color:color||T.ink3,whiteSpace:"nowrap",border:`1px solid ${(color||T.ink3)}28`}}>{label}</span>;
}
export function Card({children,selected,accent,onClick,style={},variant}) {
  const base = variant==="dark"
    ? {background:"#0f1a12",border:`1px solid ${selected?"#c9a84c":"#1a2e1f"}`,color:"#f0ede6"}
    : variant==="elevated"
    ? {background:T.white,border:`1px solid ${selected?accent||T.greenDk:T.bg3}`,boxShadow:T.shadowMd}
    : {background:T.white,border:`1px solid ${selected?accent||T.greenDk:T.bg3}`,boxShadow:T.shadow};
  return <div onClick={onClick} className={onClick?"card-click":""} style={{...base,borderRadius:14,padding:"20px 24px",cursor:onClick?"pointer":"default",...style}}>{children}</div>;
}
// Horizontal section-nav tabs across the top of a tab's content area — the
// in-section counterpart of the app sidebar (Communications, Reports,
// Settings). tabs: [{id,label,icon?,badge?}]. Scrolls horizontally when it
// doesn't fit (base style; no media query needed).
export function SectionTabs({tabs,active,onSelect,className,style}) {
  return <div className={className?`section-tabbar ${className}`:"section-tabbar"} style={{display:"flex",alignItems:"center",gap:2,borderBottom:"1.5px solid "+T.bg3,overflowX:"auto",flexShrink:0,marginBottom:18,...style}}>
    {tabs.map(t=>{
      const on=active===t.id;
      return <button key={t.id} onClick={()=>onSelect(t.id)} className={on?"section-tab-on":undefined} style={{
        background:"transparent",border:"none",
        borderBottom:`2px solid ${on?T.gold:"transparent"}`,
        borderRadius:on?"7px 7px 0 0":0,
        marginBottom:-1.5,padding:"10px 14px",
        color:on?T.ink:T.ink3,fontSize:13,fontWeight:on?700:500,
        cursor:"pointer",display:"flex",alignItems:"center",gap:7,whiteSpace:"nowrap",flexShrink:0,
        transition:"color 0.15s,border-color 0.15s,background 0.15s"}}>
        {t.icon&&<span style={{fontSize:13,opacity:0.7}}>{t.icon}</span>}
        {t.label}
        {t.badge!=null&&<span style={{fontSize:11,fontWeight:700,background:on?T.gold+"2e":T.bg3,borderRadius:99,padding:"1px 7px",color:on?T.ink:T.ink3}}>{t.badge}</span>}
      </button>;
    })}
  </div>;
}
export function SectionLabel({children}) {
  return <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.12em",textTransform:"uppercase",color:T.ink3,marginBottom:12}}>{children}</div>;
}
export function AIBtn({onClick,loading,label="✦ Suggest",small}) {
  return <button onClick={onClick} disabled={loading} style={{background:loading?"#1a2e1f":"linear-gradient(135deg,#0d5c3a,#0d5c3a)",border:"none",borderRadius:small?8:10,padding:small?"6px 12px":"9px 16px",color:"#f0ede6",fontSize:small?12:13,fontWeight:700,cursor:loading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:6,opacity:loading?0.65:1,whiteSpace:"nowrap",boxShadow:loading?"none":"0 2px 12px rgba(13,92,58,0.35)",letterSpacing:"0.01em"}}>
    {loading?<><Spin/>Thinking…</>:label}
  </button>;
}
export function AIPanel({text,onClose}) {
  if(!text) return null;
  return <div className="fade-in modal-anim" style={{background:"#0f1a12",border:"1px solid #1a2e1f",borderLeft:"3px solid #c9a84c",borderRadius:14,padding:"18px 20px",position:"relative",marginTop:12}}>
    <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.12em",textTransform:"uppercase",color:"#c9a84c",marginBottom:10,display:"flex",alignItems:"center",gap:6}}><span>✦</span> Suggested</div>
    <div style={{fontSize:13,color:"#e8e4db",lineHeight:1.8,whiteSpace:"pre-wrap"}}>{text}</div>
    {onClose&&<button onClick={onClose} style={{position:"absolute",top:12,right:14,background:T.bgElevated,border:"1px solid "+T.green650,borderRadius:6,color:T.sage400,cursor:"pointer",fontSize:14,lineHeight:1,width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>×</button>}
  </div>;
}
export function MetricCard({label,value,sub,color,trend}) {
  return <div className="fade-in" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,padding:"16px 20px",display:"flex",flexDirection:"column",gap:5,borderLeft:`3px solid ${color||T.bg3}`,boxShadow:T.shadow}}>
    <span style={{fontSize:10,fontWeight:800,letterSpacing:"0.12em",textTransform:"uppercase",color:T.ink3}}>{label}</span>
    <span style={{fontSize:28,fontWeight:800,color:color||T.ink,fontFamily:"'DM Serif Display',serif",lineHeight:1.05,letterSpacing:"-0.02em"}}>{value}</span>
    {sub&&<span style={{fontSize:11,color:T.ink3}}>{sub}</span>}
    {trend!==undefined&&(
      trend===0
        ?<span style={{fontSize:11,color:T.ink3,fontWeight:600}}>No change</span>
        :<span style={{fontSize:11,color:trend>0?T.greenMid:T.terracotta,fontWeight:600}}>{trend>0?"↑":"↓"} {Math.abs(trend)}%</span>
    )}
  </div>;
}
// Empty-state ornament is a restrained on-palette gold rule — NOT a diamond/
// hexagon logo-ish glyph (retired brand mark, 2026-07-29). A legacy `icon` prop
// some call sites still pass is ignored (no longer a decorative glyph).
export function EmptyState({title,message,action,onAction}) {
  return <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"52px 24px",gap:12,textAlign:"center"}}>
    <div aria-hidden style={{width:32,height:3,borderRadius:2,background:T.gold500,opacity:0.9,marginBottom:6}}/>
    <div style={{fontSize:15,fontWeight:700,color:T.ink2}}>{title||"Nothing here yet"}</div>
    <div style={{fontSize:13,color:T.ink3,maxWidth:340,lineHeight:1.65}}>{message||"Nothing here yet — this is where the magic starts."}</div>
    {action&&<button onClick={onAction} style={{marginTop:8,background:T.greenDk,border:"none",borderRadius:10,padding:"9px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",boxShadow:"0 2px 10px rgba(26,107,74,0.2)"}}>{action}</button>}
  </div>;
}
// ── DriftBadge (BUILD-76 Part 2) ───────────────────────────────────────────
// The drift marker, everywhere a donor appears: brass, small, quiet — these
// are people who LIKE the organization, not problems, so it is deliberately
// not terracotta. Renders ONLY from the server's `drift` field (one
// computation, one truth — the Part 1 exclusion assertions guarantee an
// excluded donor never carries it). The reason rides `title` for hover;
// donor-record surfaces show it inline themselves.
export function DriftBadge({drift,style}) {
  if (!drift || drift.state !== "drifting") return null;
  return (
    <span title={drift.reason} style={{
      display:"inline-flex",alignItems:"center",gap:4,flexShrink:0,
      background:T.gold100,border:"1px solid "+T.gold500+"55",borderRadius:99,
      padding:"1px 8px",fontSize:9.5,fontWeight:800,letterSpacing:"0.07em",
      textTransform:"uppercase",color:T.gold600,lineHeight:1.6,whiteSpace:"nowrap",...style,
    }}>
      <span aria-hidden style={{fontSize:8,lineHeight:1}}>◉</span>
      Drifting{drift.confidence==="medium"?" · unsure":""}
    </span>
  );
}

// ── Warmth pass (BUILD-08 Phase D) ─────────────────────────────────────────
// GoldMoment: the product's one celebration pattern — a single gold moment
// (soft rise + one sheen across the accent bar, no confetti, gone under
// prefers-reduced-motion). Fires ONCE per org per `moment` key: the
// localStorage flag is set the first time it renders, so it never re-greets.
export function GoldMoment({moment,title,line,onDismiss}) {
  const orgId = (()=>{try{return JSON.parse(localStorage.getItem("npe_org")||"{}").id||"org";}catch{return "org";}})();
  const key = `steward_gold_${moment}_${orgId}`;
  const [show,setShow] = useState(()=>{ try{return !localStorage.getItem(key);}catch{return false;} });
  useEffect(()=>{ if(show){ try{localStorage.setItem(key,new Date().toISOString());}catch{} } },[]);
  if(!show) return null;
  return (
    <div className="gold-moment" style={{position:"relative",background:`linear-gradient(135deg,${T.gold50},${T.gold100})`,border:"1px solid #c9a84c55",borderRadius:14,padding:"16px 44px 16px 18px",display:"flex",gap:14,alignItems:"center",overflow:"hidden"}}>
      <div className="gold-moment-bar" style={{position:"absolute",left:0,top:0,bottom:0,width:4,background:T.gold}}/>
      <div style={{width:34,height:34,borderRadius:"50%",background:T.gold,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:T.ink,fontSize:15}}>✦</div>
      <div style={{minWidth:0}}>
        <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:17,color:T.ink,lineHeight:1.3}}>{title}</div>
        {line&&<div style={{fontSize:13,color:T.ink2,marginTop:3,lineHeight:1.55}}>{line}</div>}
      </div>
      <button onClick={()=>{setShow(false);onDismiss&&onDismiss();}} aria-label="Dismiss"
        style={{position:"absolute",top:10,right:12,background:"none",border:"none",color:T.ink3,fontSize:16,cursor:"pointer",lineHeight:1,padding:4}}>×</button>
    </div>
  );
}

// StartHere: the gold signpost for first-run states — points at the one
// thing worth doing first, in the product's narrative voice. Not a modal,
// not a tour; one card that stops rendering once there's data (callers gate
// it) or once dismissed when a `dismissKey` is given.
export function StartHere({line,actionLabel,onAction,dismissKey}) {
  const orgId = (()=>{try{return JSON.parse(localStorage.getItem("npe_org")||"{}").id||"org";}catch{return "org";}})();
  const key = dismissKey ? `steward_seen_${dismissKey}_${orgId}` : null;
  const [show,setShow] = useState(()=>{ if(!key) return true; try{return !localStorage.getItem(key);}catch{return true;} });
  if(!show) return null;
  const dismiss = ()=>{ if(key){ try{localStorage.setItem(key,"1");}catch{} } setShow(false); };
  return (
    <div className="fade-in" style={{background:T.gold50,border:"1px solid #c9a84c55",borderLeft:"4px solid "+T.gold,borderRadius:12,padding:"14px 18px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
      <div style={{flex:"1 1 280px",minWidth:0}}>
        <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.12em",textTransform:"uppercase",color:T.gold600,marginBottom:4}}>Start here</div>
        <div style={{fontSize:13.5,color:T.ink2,lineHeight:1.6}}>{line}</div>
      </div>
      <div style={{display:"flex",gap:10,alignItems:"center",flexShrink:0}}>
        {actionLabel&&<button onClick={()=>{if(key){try{localStorage.setItem(key,"1");}catch{}}onAction&&onAction();}} style={{background:T.gold,border:"none",borderRadius:10,padding:"9px 16px",color:T.ink,fontSize:13,fontWeight:700,cursor:"pointer"}}>{actionLabel}</button>}
        {dismissKey&&<button onClick={dismiss} style={{background:"none",border:"none",color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer",textDecoration:"underline"}}>Got it</button>}
      </div>
    </div>
  );
}

export function PageTitle({main,accent,sub}) {
  return (
    <div style={{marginBottom:16}}>
      <h1 style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:32,fontWeight:400,letterSpacing:"-0.02em",margin:0,lineHeight:1.15}}>
        <span style={{color:T.ink}}>{main}{" "}</span><span style={{color:T.ink,borderBottom:"3px solid "+T.gold500,paddingBottom:2}}>{accent}</span>
      </h1>
      {sub&&<div style={{fontSize:14,color:T.ink3,marginTop:6,fontFamily:"'DM Sans',sans-serif"}}>{sub}</div>}
    </div>
  );
}
// LockGlyph — a monochrome padlock drawn in SVG (NOT an emoji, so it reads
// premium and passes the no-emoji guard). Used by the sidebar Team-gated
// indicator and the LockedFeature overlay.
export const LockGlyph=({size=12,color="currentColor",style})=>(
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{display:"block",...style}}>
    <path d="M7 10.5V8a5 5 0 0 1 10 0v2.5" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round"/>
    <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.4" fill={color}/>
  </svg>
);

// The ONE upgrade destination. Every "See plans / Unlock with Team / Upgrade"
// CTA routes here — the in-app /pricing page, where a plan button starts a real
// Stripe Checkout (POST /billing/create-checkout). Full navigation (not SPA
// navigate) is deliberate: /pricing lives outside the AppShell tab router, and
// it matches the codebase's other billing redirects (openPortal, Stripe URLs).
export const goToPricing=()=>{ window.location.href="/pricing"; };

// LockedFeature — the reusable "Givebutter-style" locked preview. Renders the
// REAL surface (the org's own data) dimmed behind frosted glass, non-
// interactive, with an "Unlock with Team" overlay. Writes are still server-
// gated (requirePlan('team') → 403); this only softens the READ presentation
// so a Core user sees what they'd get, not a bare upgrade card. One wrapper so
// every Team surface shares the exact treatment (top-level tabs AND Team
// sub-tabs inside Core tabs).
export function LockedFeature({title,blurb,cta="See plans",onCta,children,minHeight=420}){
  return (
    <div className="locked-feature" style={{position:"relative",minHeight}}>
      <div aria-hidden="true" style={{filter:"blur(3.5px) saturate(0.82)",opacity:0.5,pointerEvents:"none",userSelect:"none"}}>
        {children}
      </div>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:"clamp(48px,12vh,120px)",background:"linear-gradient(180deg,rgba(240,237,230,0.30),rgba(240,237,230,0.62))",backdropFilter:"blur(0.5px)"}}>
        <div style={{background:T.bgCard||T.white,border:`1px solid ${T.gold300}`,borderLeft:`4px solid ${T.gold500||T.gold}`,borderRadius:T.radiusLg||16,padding:"24px 26px",maxWidth:460,boxShadow:T.shadowLg||"0 12px 40px rgba(15,26,18,0.18)"}}>
          <div style={{fontSize:12,fontWeight:800,letterSpacing:".08em",textTransform:"uppercase",color:T.gold600,display:"flex",alignItems:"center",gap:7}}>
            <LockGlyph size={12} color={T.gold600}/> Team plan
          </div>
          <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:23,color:T.ink,margin:"7px 0 9px",lineHeight:1.2}}>{title}</div>
          <div style={{fontSize:14,color:T.ink2||T.ink3,lineHeight:1.6}}>{blurb}</div>
          {onCta&&<button onClick={onCta} style={{marginTop:18,background:T.gold500||T.gold,border:"none",borderRadius:T.radiusSm||8,padding:"10px 20px",fontSize:14,fontWeight:700,color:T.ink,cursor:"pointer"}}>Unlock with Team — {cta} →</button>}
        </div>
      </div>
    </div>
  );
}
export function GivingHistoryChart({gifts}) {
  if (!gifts?.length) return <div style={{height:80,display:"flex",alignItems:"center",justifyContent:"center",color:T.ink3,fontSize:12}}>No gift history recorded</div>;
  const sorted=[...gifts].sort((a,b)=>new Date(a.date)-new Date(b.date));
  const maxAmt=Math.max(...sorted.map(g=>g.amount),1);
  const W=500,H=110,pad={t:8,r:16,b:24,l:44};
  const pw=W-pad.l-pad.r, ph=H-pad.t-pad.b;
  const xs=sorted.map((_,i)=>pad.l+(sorted.length>1?(i/(sorted.length-1))*pw:pw/2));
  const ys=sorted.map(g=>pad.t+ph-(g.amount/maxAmt)*ph);
  const pts=xs.map((x,i)=>`${x},${ys[i]}`).join(" ");
  const area=sorted.length>1?`M ${xs[0]},${pad.t+ph} L ${xs.map((x,i)=>`${x} ${ys[i]}`).join(" L ")} L ${xs[xs.length-1]},${pad.t+ph} Z`:null;
  const yearOf=g=>new Date(g.date).getFullYear();
  return(
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",overflow:"visible"}}>
      <defs>
        <linearGradient id="giftGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0d5c3a" stopOpacity="0.22"/>
          <stop offset="100%" stopColor="#0d5c3a" stopOpacity="0.01"/>
        </linearGradient>
      </defs>
      {area&&<path d={area} fill="url(#giftGrad)"/>}
      {sorted.length>1&&<polyline points={pts} stroke="#0d5c3a" strokeWidth="2" fill="none" strokeLinejoin="round"/>}
      {sorted.map((g,i)=>(
        <g key={i}>
          <circle cx={xs[i]} cy={ys[i]} r={4} fill="#0d5c3a" stroke={T.white} strokeWidth={1.5}/>
          <title>${g.amount.toLocaleString()} · {g.date}</title>
        </g>
      ))}
      <text x={pad.l-4} y={pad.t+7} textAnchor="end" fontSize={9} fill={T.ink3}>{fmt(maxAmt)}</text>
      <text x={pad.l-4} y={pad.t+ph+1} textAnchor="end" fontSize={9} fill={T.ink3}>$0</text>
      {sorted.map((g,i)=>(i===0||i===sorted.length-1||(sorted.length<=6))?(
        <text key={i} x={xs[i]} y={H-4} textAnchor="middle" fontSize={9} fill={T.ink3}>{yearOf(g)}</text>
      ):null)}
    </svg>
  );
}

// ── Touchpoint helpers (module-level to avoid focus-loss on re-render) ──────
export function TpField({label,children}){
  return <div style={{display:"flex",flexDirection:"column",gap:4}}>
    <span style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5,display:"block"}}>{label}</span>
    {children}
  </div>;
}
export function TpYesNo({val,set}){
  return <div style={{display:"flex",gap:6}}>
    {["yes","no"].map(v=><button key={v} onClick={()=>set(v)} style={{background:val===v?"#0d5c3a":T.bg,border:`1px solid ${val===v?"#0d5c3a":T.bg3}`,borderRadius:7,padding:"7px 20px",color:val===v?"#fff":T.ink3,fontSize:13,fontWeight:600,cursor:"pointer"}}>{v}</button>)}
  </div>;
}
// onDelete (optional): called with the interaction after the user confirms —
// only passed where entries are actual `interactions` rows (DonorProfile);
// Grants renders grant_interactions through this too and passes nothing.
export function TouchpointTimeline({interactions,onDelete}){
  if(!interactions?.length)return<div style={{fontSize:13,color:T.ink3,textAlign:"center",padding:"16px 0"}}>No touchpoints logged yet.</div>;
  const typeColor={call:T.green500,email:T.greenDk,meeting:T.greenMid,gift:T.gold600,event:T.gold500,note:T.ink3,stewardship:T.gold,ask:T.gold500,voice_memo:T.green500,pledge_reminder:T.terracotta};
  const typeLabel={voice_memo:"Voice Memo",pledge_reminder:"Pledge Reminder",ask:"Ask made"};
  const sorted=[...interactions].sort((a,b)=>new Date(b.date)-new Date(a.date));
  return(
    <div style={{display:"flex",flexDirection:"column",gap:0}}>
      {sorted.map((int,i)=>{
        const c=typeColor[int.type]||T.ink3;
        const dAgo=daysDiff(int.date);
        const when=dAgo===0?"Today":dAgo===1?"Yesterday":`${dAgo}d ago`;

        // Parse Gmail-synced email metadata
        const meta=int.metadata||(int.metadata_raw?JSON.parse(int.metadata_raw):null);
        let emailSubject=null,emailSnippet=null,direction=null;
        if(int.type==="email"&&int.note){
          const m=int.note.match(/^Subject: (.+?)(?:\n\n([\s\S]*))?$/);
          if(m){emailSubject=m[1];emailSnippet=m[2]||"";}
        }
        if(meta?.direction)direction=meta.direction;

        return(
          <div key={int.id||i} className="tp-row" style={{display:"flex",gap:12,paddingBottom:16,position:"relative"}}>
            {i<sorted.length-1&&<div style={{position:"absolute",left:12,top:26,width:2,bottom:0,background:T.bg3}}/>}
            <div style={{width:26,height:26,borderRadius:"50%",background:c+"28",border:`2px solid ${c}`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",zIndex:1,marginTop:2}}>
              {int.type==="email"
                ?<span style={{fontSize:11,lineHeight:1,color:c}}>✉</span>
                :<div style={{width:10,height:10,borderRadius:"50%",background:c}}/>}
            </div>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,flexWrap:"wrap"}}>
                <span style={{fontSize:11,fontWeight:700,textTransform:"capitalize",color:c}}>{typeLabel[int.type]||int.type}</span>
                {direction&&(
                  <span style={{fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:99,
                    background:direction==="inbound"?T.green100:T.gold100,
                    color:direction==="inbound"?T.greenDk:T.gold700,
                    border:"1px solid "+(direction==="inbound"?T.green200:T.gold300)}}>
                    {direction==="inbound"?"Received":"Sent"}
                  </span>
                )}
                {meta?.gmail_message_id&&<span style={{fontSize:10,color:T.ink3,fontWeight:500}}>via Gmail</span>}
                <span style={{fontSize:11,color:T.ink3}}>{int.date}</span>
                <span style={{fontSize:11,color:T.ink3,opacity:0.6}}>({when})</span>
              </div>
              {emailSubject?(
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:T.ink,marginBottom:2}}>{emailSubject}</div>
                  {emailSnippet&&<div style={{fontSize:12,color:T.ink3,lineHeight:1.5,overflow:"hidden",textOverflow:"ellipsis",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{emailSnippet}</div>}
                </div>
              ):(
                <div style={{fontSize:13,color:T.ink2,lineHeight:1.5}}>{int.note}</div>
              )}
            </div>
            {onDelete&&int.id&&(
              <button className="tp-del-btn" title="Delete this entry" aria-label="Delete this entry"
                onClick={()=>{if(window.confirm("Delete this timeline entry? This can't be undone."))onDelete(int);}}
                style={{background:"transparent",border:"none",cursor:"pointer",color:T.terracotta,fontSize:14,padding:"2px 4px",alignSelf:"flex-start",flexShrink:0,lineHeight:1}}>
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Voice memo capture ────────────────────────────────────────────────────
// Record -> transcribe (Whisper via /voice-memos/transcribe) -> the officer
// reviews the transcript + two AI-suggested extras and explicitly opts in to
// each before anything is saved. Reachable either pre-scoped to a donor
// (DonorProfile passes `donor`) or as a global quick-capture entry point
// (App.jsx passes `donors` for the picker instead).
function pickMimeType(){
  const candidates=["audio/webm;codecs=opus","audio/webm","audio/mp4","audio/ogg"];
  for(const c of candidates){ if(window.MediaRecorder?.isTypeSupported?.(c)) return c; }
  return "";
}
function blobToBase64(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onloadend=()=>resolve(String(reader.result).split(",")[1]||"");
    reader.onerror=reject;
    reader.readAsDataURL(blob);
  });
}

export function VoiceMemoModal({donor,donors,onClose,onSaved}){
  const [selectedDonor,setSelectedDonor]=useState(donor||null);
  const [search,setSearch]=useState("");
  const [phase,setPhase]=useState("idle"); // idle|recording|recorded|transcribing|review|saving
  const [error,setError]=useState("");
  const [audioUrl,setAudioUrl]=useState(null);
  const [elapsed,setElapsed]=useState(0);
  const [transcript,setTranscript]=useState("");
  const [suggestedDetail,setSuggestedDetail]=useState(null);
  const [suggestedAction,setSuggestedAction]=useState(null);
  const [includeDetail,setIncludeDetail]=useState(false);
  const [includeAction,setIncludeAction]=useState(false);

  const mediaRecorderRef=useRef(null);
  const chunksRef=useRef([]);
  const audioBlobRef=useRef(null);
  const timerRef=useRef(null);
  const streamRef=useRef(null);

  const stopStream=()=>{ streamRef.current?.getTracks()?.forEach(t=>t.stop()); streamRef.current=null; };

  const startRecording=async()=>{
    setError("");
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      streamRef.current=stream;
      const mimeType=pickMimeType();
      const mr=new MediaRecorder(stream,mimeType?{mimeType}:undefined);
      chunksRef.current=[];
      mr.ondataavailable=e=>{ if(e.data.size>0) chunksRef.current.push(e.data); };
      mr.onstop=()=>{
        const blob=new Blob(chunksRef.current,{type:mimeType||"audio/webm"});
        audioBlobRef.current=blob;
        setAudioUrl(URL.createObjectURL(blob));
        setPhase("recorded");
        stopStream();
      };
      mediaRecorderRef.current=mr;
      mr.start();
      setElapsed(0);
      timerRef.current=setInterval(()=>setElapsed(s=>s+1),1000);
      setPhase("recording");
    }catch(e){
      setError("Couldn't access the microphone — check your browser permissions.");
    }
  };

  const stopRecording=()=>{
    clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
  };

  const reRecord=()=>{
    setAudioUrl(null); audioBlobRef.current=null; setPhase("idle");
  };

  const transcribeAndSuggest=async()=>{
    if(!audioBlobRef.current||!selectedDonor)return;
    setPhase("transcribing"); setError("");
    try{
      const audioBase64=await blobToBase64(audioBlobRef.current);
      const r=await apiFetch("/voice-memos/transcribe",{method:"POST",body:JSON.stringify({
        donorId:selectedDonor.id, audioBase64, mimeType:audioBlobRef.current.type,
      })});
      setTranscript(r.transcript||"");
      setSuggestedDetail(r.suggestedDetail||null);
      setSuggestedAction(r.suggestedAction||null);
      setIncludeDetail(false); setIncludeAction(false);
      setPhase("review");
    }catch(e){
      setError(errorMessage(e, "Transcription failed — please try again."));
      setPhase("recorded");
    }
  };

  const save=async()=>{
    setPhase("saving"); setError("");
    try{
      const r=await apiFetch("/voice-memos/save",{method:"POST",body:JSON.stringify({
        donorId:selectedDonor.id, transcript,
        addDetailToNotes:includeDetail, detailText:suggestedDetail,
        createFollowUpTask:includeAction, actionText:suggestedAction,
      })});
      onSaved?.(selectedDonor,r);
      close();
    }catch(e){
      setError(errorMessage(e, "Could not save — please try again."));
      setPhase("review");
    }
  };

  const close=()=>{
    clearInterval(timerRef.current);
    stopStream();
    if(audioUrl) URL.revokeObjectURL(audioUrl);
    onClose?.();
  };

  const mm=String(Math.floor(elapsed/60)).padStart(2,"0");
  const ss=String(elapsed%60).padStart(2,"0");

  const filteredDonors=donors&&search.trim()
    ?donors.filter(d=>d.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0,8)
    :[];

  return(
    <Modal onClose={close} width={460} padding={24} ariaLabel="Voice memo"
      dialogStyle={{border:"1px solid "+T.bg3}}>
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:16,fontWeight:800,color:T.ink}}>Voice memo</div>
          <button onClick={close} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:T.ink3,lineHeight:1}}>×</button>
        </div>

        {!selectedDonor?(
          <div>
            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:6}}>Who is this about?</div>
            <input autoFocus value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search donors…"
              style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:10}}/>
            {filteredDonors.map(d=>(
              <div key={d.id} onClick={()=>{setSelectedDonor(d);setSearch("");}}
                style={{padding:"9px 12px",borderRadius:8,cursor:"pointer",fontSize:13,color:T.ink,border:"1px solid "+T.bg3,marginBottom:6}}
                onMouseEnter={e=>e.currentTarget.style.background=T.bg}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                {d.name}
              </div>
            ))}
            {search.trim()&&filteredDonors.length===0&&<div style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>No donors match "{search}"</div>}
          </div>
        ):(
          <>
            <div style={{fontSize:12,color:T.ink3,marginBottom:14}}>About <strong style={{color:T.ink}}>{selectedDonor.name}</strong>{!donor&&<button onClick={()=>setSelectedDonor(null)} style={{marginLeft:8,background:"none",border:"none",color:T.greenDk,fontSize:12,fontWeight:600,cursor:"pointer",padding:0}}>Change</button>}</div>

            {error&&<div style={{marginBottom:12,fontSize:13,color:T.terra700,background:T.terra100,border:"1px solid "+T.terra200,borderRadius:8,padding:"8px 12px"}}>{error}</div>}

            {(phase==="idle")&&(
              <div style={{textAlign:"center",padding:"24px 0"}}>
                <button onClick={startRecording} style={{width:64,height:64,borderRadius:"50%",background:T.terracotta,border:"none",color:"#fff",fontSize:24,cursor:"pointer",boxShadow:"0 4px 16px rgba(184,89,63,0.35)"}}>●</button>
                <div style={{fontSize:12,color:T.ink3,marginTop:12}}>Tap to start recording</div>
              </div>
            )}

            {phase==="recording"&&(
              <div style={{textAlign:"center",padding:"24px 0"}}>
                <button onClick={stopRecording} style={{width:64,height:64,borderRadius:12,background:T.terracotta,border:"none",color:"#fff",fontSize:20,cursor:"pointer",boxShadow:"0 4px 16px rgba(184,89,63,0.35)"}}>■</button>
                <div style={{fontSize:18,fontWeight:700,color:T.ink,marginTop:12,fontFamily:"monospace"}}>{mm}:{ss}</div>
                <div style={{fontSize:12,color:T.ink3,marginTop:4}}>Recording — tap to stop</div>
              </div>
            )}

            {phase==="recorded"&&(
              <div style={{padding:"12px 0"}}>
                {audioUrl&&<audio controls src={audioUrl} style={{width:"100%",marginBottom:14}}/>}
                <div style={{display:"flex",gap:8}}>
                  <button onClick={transcribeAndSuggest} style={{flex:1,background:T.green,border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Transcribe</button>
                  <button onClick={reRecord} style={{background:T.bg,border:"none",borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Re-record</button>
                </div>
              </div>
            )}

            {phase==="transcribing"&&(
              <div style={{textAlign:"center",padding:"32px 0",display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
                <Spin/><div style={{fontSize:13,color:T.ink3}}>Transcribing…</div>
              </div>
            )}

            {(phase==="review"||phase==="saving")&&(
              <div>
                <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Transcript</div>
                <textarea value={transcript} onChange={e=>setTranscript(e.target.value)} rows={4}
                  style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:13,color:T.ink,background:T.bg,outline:"none",marginBottom:14,resize:"vertical",fontFamily:"inherit",lineHeight:1.55}}/>

                {(suggestedDetail||suggestedAction)&&(
                  <div style={{background:T.green100,border:"1px solid "+T.green200,borderRadius:10,padding:"12px 14px",marginBottom:14}}>
                    <div style={{fontSize:10,fontWeight:800,color:T.greenDk,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Worth saving? (your call)</div>
                    {suggestedDetail&&(
                      <label style={{display:"flex",alignItems:"flex-start",gap:8,fontSize:13,color:T.ink,cursor:"pointer",marginBottom:suggestedAction?8:0}}>
                        <input type="checkbox" checked={includeDetail} onChange={e=>setIncludeDetail(e.target.checked)} style={{marginTop:3,width:15,height:15,cursor:"pointer",flexShrink:0}}/>
                        <span>Add to donor notes: <em>"{suggestedDetail}"</em></span>
                      </label>
                    )}
                    {suggestedAction&&(
                      <label style={{display:"flex",alignItems:"flex-start",gap:8,fontSize:13,color:T.ink,cursor:"pointer"}}>
                        <input type="checkbox" checked={includeAction} onChange={e=>setIncludeAction(e.target.checked)} style={{marginTop:3,width:15,height:15,cursor:"pointer",flexShrink:0}}/>
                        <span>Create follow-up task: <em>"{suggestedAction}"</em></span>
                      </label>
                    )}
                  </div>
                )}

                <div style={{display:"flex",gap:8}}>
                  <button onClick={save} disabled={phase==="saving"||!transcript.trim()} style={{flex:1,background:T.green,border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:14,fontWeight:700,cursor:phase==="saving"?"not-allowed":"pointer",opacity:phase==="saving"?0.7:1}}>
                    {phase==="saving"?"Saving…":"Save to timeline"}
                  </button>
                  <button onClick={close} style={{background:T.bg,border:"none",borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

// ── BUILD-94 Part 1 — PersonMark: the ONE mark for a person ─────────────────
// Wherever a person's name appears as a row, the same mark appears beside it:
// their photograph if the org has one, otherwise their initials on the org's
// colour. Never a grey silhouette — a stranger-shaped icon tells you nothing
// and reads as a placeholder the product forgot to fill; initials at least say
// whose record you are looking at.
//
// ONE component, deliberately. Before this there were two ad-hoc circles (the
// profile header's stage-tinted letter, the pipeline card's assignee dot) and
// five surfaces with no mark at all, which is how a product ends up looking
// like six products.
//
// `photos` is the org-wide { donorId: signedUrl } map from GET /people/photos
// (see PhotoContext below). A row only needs to pass the person's id and name;
// the profile header passes `url` directly because it signs its own.
export function personInitials(name, kind) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const letter = w => (Array.from(w).find(c => /\p{L}|\p{N}/u.test(c)) || "").toUpperCase();
  if (kind === "organization" || words.length === 1) return letter(words[0]) || "?";
  return (letter(words[0]) + letter(words[words.length - 1])) || "?";
}

// The org's colour, set on the app root as --org-accent by App.jsx (BUILD-13's
// one white-label accent, already contrast-normalised server-side). The
// fallbacks are the product's own emerald + ink, so a page rendered outside the
// app shell still gets a legible mark rather than a transparent hole.
export const PhotoContext = createContext({ photos: {}, refresh: () => {} });

export function PersonMark({ id, name, kind, url, size = 34, style = {}, title }) {
  const ctx = useContext(PhotoContext);
  const src = url !== undefined ? url : (id ? (ctx.photos || {})[id] : null);
  const [broken, setBroken] = useState(false);
  // A signed URL that has expired (a tab left open past its twelve hours) 404s
  // or 403s. The mark falls back to initials rather than to a broken-image
  // glyph, and the next page load mints a fresh URL.
  useEffect(() => { setBroken(false); }, [src]);
  const base = {
    width: size, height: size, borderRadius: "50%", flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    overflow: "hidden", ...style,
  };
  if (src && !broken) {
    return (
      <img src={src} alt="" title={title || name || ""} data-testid="person-mark"
        onError={() => setBroken(true)}
        style={{ ...base, objectFit: "cover", background: T.bg2 }} />
    );
  }
  return (
    <div data-testid="person-mark" title={title || name || ""} aria-hidden="true"
      style={{
        ...base,
        background: "var(--org-accent, " + T.greenDk + ")",
        color: "var(--org-accent-fg, " + T.white + ")",
        fontSize: Math.max(9, Math.round(size * 0.4)),
        fontWeight: 800, letterSpacing: "0.02em",
      }}>
      {personInitials(name, kind)}
    </div>
  );
}

// ── BUILD-94 FIRST RUN — THE GREETING AN ORG GETS ONCE ─────────────────────
// A new organisation's first sign-in is the one moment where the product gets
// to say "this is yours" before it says anything else. It fires ONCE per user
// (the server stamps `welcomed_at`; localStorage is only a same-session
// guard), and everything on it is the organisation's own: their name, their
// mission in their words, and — where they have one — a motif that draws the
// thing they are actually about.
//
// IT STAYS INSIDE THE FOUR COLOURS. No confetti: the product's one celebration
// pattern is a gold moment (GoldMoment above, BUILD-33), and this is its
// larger sibling, not a different aesthetic. Brass, ink, cream, and the org's
// own accent — nothing else reaches the screen, and `prefers-reduced-motion`
// turns every movement off while still greeting.
// A motif is ONE path, drawn at whatever size and opacity the herd asks for.
// `box` is its intrinsic viewBox so a caller can scale it without distorting.
//
// PROVENANCE: the horse outline is traced from the reference silhouette
// Jonathan supplied (scratchpad/horse/ref.webp, traced by a contour follower
// in scratchpad/horse/trace.js). Five hand-drawn attempts produced a sheep, a
// deer and three ponies — the browser was the only thing that could tell me,
// and tracing the shape he actually wanted was the honest answer. If that
// reference came from a stock library, check its licence before this ships to
// anyone but a demo org.
const WELCOME_MOTIFS = {
  horse: {
    box: "0 0 298 193",
    d: "M271.0 0.0L269.0 10.0L270.0 14.0L276.0 20.0L281.0 30.0L293.0 40.0L298.0 47.0L295.0 54.0L290.0 57.0L286.0 57.0L282.0 52.0L271.0 51.0L260.0 47.0L253.0 47.0L249.0 51.0L241.0 80.0L242.0 90.0L240.0 106.0L236.0 114.0L253.0 135.0L266.0 147.0L267.0 153.0L271.0 160.0L288.0 184.0L290.0 193.0L279.0 190.0L279.0 181.0L273.0 177.0L271.0 171.0L262.0 157.0L252.0 147.0L225.0 128.0L218.0 125.0L215.0 126.0L210.0 135.0L201.0 163.0L178.0 185.0L163.0 190.0L154.0 189.0L148.0 182.0L149.0 175.0L110.0 145.0L109.0 140.0L116.0 126.0L115.0 121.0L107.0 129.0L100.0 131.0L84.0 141.0L73.0 144.0L65.0 149.0L56.0 160.0L47.0 181.0L31.0 187.0L26.0 187.0L27.0 181.0L30.0 176.0L34.0 175.0L37.0 177.0L45.0 169.0L57.0 135.0L68.0 132.0L79.0 123.0L79.0 90.0L81.0 80.0L85.0 73.0L83.0 71.0L80.0 71.0L77.0 76.0L74.0 72.0L69.0 85.0L68.0 82.0L64.0 80.0L61.0 83.0L54.0 85.0L47.0 92.0L41.0 107.0L40.0 105.0L34.0 114.0L24.0 123.0L11.0 128.0L23.0 112.0L23.0 99.0L12.0 117.0L5.0 124.0L1.0 126.0L6.0 121.0L6.0 115.0L0.0 120.0L15.0 99.0L19.0 90.0L21.0 79.0L35.0 67.0L33.0 65.0L29.0 68.0L31.0 65.0L30.0 64.0L25.0 64.0L22.0 66.0L29.0 60.0L44.0 57.0L53.0 57.0L89.0 63.0L112.0 56.0L153.0 60.0L173.0 59.0L192.0 46.0L182.0 40.0L186.0 42.0L190.0 41.0L184.0 37.0L189.0 39.0L197.0 38.0L200.0 34.0L196.0 30.0L206.0 27.0L211.0 23.0L207.0 22.0L213.0 21.0L215.0 19.0L209.0 17.0L204.0 18.0L209.0 16.0L235.0 17.0L241.0 13.0L248.0 11.0L248.0 9.0L251.0 8.0L260.0 9.0L268.0 1.0L269.0 3.0L270.0 1.0ZM143.0 116.0L142.0 115.0L140.0 117.0L136.0 126.0L130.0 133.0L128.0 138.0L128.0 146.0L132.0 151.0L148.0 163.0L160.0 178.0L164.0 178.0L167.0 182.0L173.0 177.0L180.0 174.0L192.0 162.0L194.0 154.0L194.0 141.0L198.0 130.0L198.0 123.0L163.0 122.0L144.0 116.0Z",
  },
};

// THE HERD. One horse crossing an empty screen was a lone pony; a herd
// streaming past is what an equine programme actually looks like. Depth is
// done the way depth is always done — the far ones are smaller, fainter and
// slower — and they LOOP, because a greeting whose screen empties out while
// she is still reading looks broken rather than finished.
// NEGATIVE delays, so every horse starts PART-WAY ACROSS and the herd is
// already running the instant the screen appears. Positive delays leave an
// empty screen for the first several seconds and then a bunch arriving
// together — which is exactly the wrong first impression, and the only three
// seconds most people will ever see.
const HERD = [
  { scale: 0.34, bottom: "31%", opacity: 0.10, dur: "17s",   delay: "-12.2s" },
  { scale: 0.46, bottom: "22%", opacity: 0.13, dur: "14s",   delay: "-2.1s"  },
  { scale: 0.58, bottom: "13%", opacity: 0.16, dur: "11.5s", delay: "-5.2s"  },
  { scale: 0.72, bottom: "6%",  opacity: 0.20, dur: "9.5s",  delay: "-8.4s"  },
  { scale: 0.52, bottom: "26%", opacity: 0.13, dur: "12.5s", delay: "-3.8s"  },
  { scale: 0.92, bottom: "1%",  opacity: 0.24, dur: "8s",    delay: "-4.8s"  },
  { scale: 0.64, bottom: "17%", opacity: 0.17, dur: "10.5s", delay: "-0.5s"  },
];

export function FirstRunWelcome({ firstName, orgName, mission, motif, words = [], onDone }) {
  const [leaving, setLeaving] = useState(false);
  const close = () => { setLeaving(true); setTimeout(() => onDone && onDone(), 420); };
  // Escape closes it, like every other takeover in the product.
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const art = WELCOME_MOTIFS[motif] || null;

  return (
    <div className={`fr-welcome${leaving ? " fr-leaving" : ""}`} role="dialog" aria-modal="true"
      aria-label={`Welcome to Steward, ${firstName || ""}`} data-testid="first-run-welcome"
      style={{
        position: "fixed", inset: 0, zIndex: 900, background: T.ink,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24, overflow: "hidden",
      }}>
      {/* A soft warm centre, so the ink is a lit room rather than a flat wall.
          This replaced a sweeping band that read as a green smear with a hard
          edge down the middle of the screen — a vignette has no edge to see. */}
      <div aria-hidden="true" style={{
        position: "absolute", inset: "-20%", pointerEvents: "none",
        background: "radial-gradient(ellipse 55% 45% at 50% 42%, rgba(201,168,76,0.10), rgba(201,168,76,0.03) 45%, transparent 70%)",
      }}/>
      {art && HERD.map((hh, i) => (
        <div key={i} className="fr-horse" aria-hidden="true"
          style={{ position: "absolute", bottom: hh.bottom, left: 0, opacity: hh.opacity,
                   animationDuration: hh.dur, animationDelay: hh.delay }}>
          <svg viewBox={art.box} style={{ width: Math.round(300 * hh.scale), display: "block", color: T.gold500 }}>
            <path d={art.d} fill="currentColor" fillRule="evenodd"/>
          </svg>
        </div>
      ))}

      <div className="fr-card" style={{ position: "relative", maxWidth: 620, textAlign: "center", zIndex: 2 }}>
        {orgName && (
          <div className="fr-eyebrow" style={{
            fontSize: 11, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase",
            color: T.gold500, marginBottom: 18,
          }}>{orgName}</div>
        )}
        <div className="fr-title" style={{
          fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 54, lineHeight: 1.08,
          color: T.bg, letterSpacing: "-0.02em", marginBottom: 6,
        }}>
          Welcome, {firstName || "and hello"}.
        </div>
        <div className="fr-rule" aria-hidden="true" style={{
          height: 3, width: 76, background: T.gold500, margin: "20px auto 22px", borderRadius: 2,
        }}/>
        {mission && (
          <div className="fr-line" style={{
            fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 21, lineHeight: 1.5,
            color: T.sage400, marginBottom: 18, fontStyle: "italic",
          }}>&ldquo;{mission}&rdquo;</div>
        )}
        {words.length > 0 && (
          <div className="fr-words" style={{
            display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginBottom: 26,
            fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.gold300,
          }}>
            {words.map((w, i) => <span key={w}>{i > 0 && <span style={{ opacity: 0.5, marginRight: 14 }}>·</span>}{w}</span>)}
          </div>
        )}
        <div className="fr-sub" style={{ fontSize: 15, lineHeight: 1.65, color: T.sage400, marginBottom: 30, maxWidth: 460, marginLeft: "auto", marginRight: "auto" }}>
          This is yours. Your people, your giving, and the next conversation waiting to be picked back up —
          all in one place, in your words.
        </div>
        <button onClick={close} data-testid="first-run-go" autoFocus style={{
          background: T.greenDk, border: "none", borderRadius: 12, padding: "14px 34px",
          color: T.white, fontSize: 15, fontWeight: 800, cursor: "pointer", letterSpacing: "0.01em",
        }}>Show me</button>
      </div>
    </div>
  );
}

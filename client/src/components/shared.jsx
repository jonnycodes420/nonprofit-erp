import { useState, useRef, useEffect } from "react";
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
  bg2:        "#e8e4dc",
  bg3:        "#d4cfc6",
  bgDeep:     "#e6dfd0",
  bgDark:     "#0f1a12",
  bgCard:     "#ffffff",
  bgElevated: "#1a2e1f",
  // Ink
  ink:        "#0f1a12",
  ink2:       "#2d2d2d",
  ink3:       "#6b6560",
  inkInverse: "#f0ede6",
  // Greens (legacy names — kept exactly, still valid tokens)
  green:      "#10b981",
  greenDk:    "#0d5c3a",
  greenMid:   "#1a6b4a",
  greenPale:  "#d1fae5",
  // Green ramp (BUILD-12) — deep pine to mist. Use these for depth + hover.
  green950:   "#0e1a13",  // sidebar / ink — deep near-black pine
  green900:   "#102418",  // one step up from ink for layered dark panels
  green800:   "#14352a",  // deep pine — dark panels (goal card) with real depth
  green700:   "#1b5138",  // evergreen — hover-on-dark, secondary depth
  green600:   "#1e6b45",  // primary / positive (≈ greenMid, AA on cream)
  green500:   "#2f8f62",  // emerald — links, accents, active toggles
  green200:   "#dce7df",  // sage — card hover tint, section bands
  green100:   "#edf3ee",  // mist — subtle fills, zebra rows, hover wash
  // Accents
  gold:       "#c9a84c",
  terracotta: "#b8593f",   // negative/attention — LOCKED, do not repurpose
  red:        "#c0392b",
  amber:      "#d97706",
  blue:       "#2563eb",
  // Gold ramp (BUILD-12) — lean on gold a touch more for highlights.
  gold600:    "#a97f22",  // deep gold — gold text on cream (AA, ~4.5:1)
  gold500:    "#c9a84c",  // primary gold (= legacy `gold`)
  gold300:    "#e7cf91",  // soft gold — highlight underlines, hover accents
  gold100:    "#f6eccf",  // gold wash — active-tab tint, callout fills
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
export const fmt = n => n>=1000?`$${(n/1000).toFixed(n%1000===0?0:1)}k`:`$${n.toLocaleString()}`;
// Whole dollars stay clean ($1,200); cents-carrying amounts (possible since
// the cover-fees NUMERIC migration) render as money, never "$140.5".
export const fmtFull = n => { const v = Number(n) || 0; return `$${v.toLocaleString(undefined, Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
export const daysDiff = d => Math.floor((new Date()-new Date(d))/86400000);
export const daysUntil = d => Math.floor((new Date(d)-new Date())/86400000);
export const SC = { major:"#1a6b4a",mid:"#3b82f6",new:"#8b5cf6",lapsed:"#f59e0b",converted:"#1a6b4a",active:"#1a6b4a",pending:"#3b82f6",prospecting:"#8b5cf6",closed:"#6b7280",high:"#ef4444",medium:"#f59e0b",low:"#6b7280" };
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
export const STAGE_ACTION = {
  prospect:"Research capacity — find a warm intro",
  qualify: "Schedule a discovery call or coffee",
  cultivate:"Share an impact story or invite to a program visit",
  solicit: "Book a gift conversation and make the ask",
  steward: "Send personalized impact update or thank you",
  lapsed:  "Personal outreach — acknowledge lapse, invite back",
};
export const TIER_COLOR = {Micro:"#6b7280",Small:"#3b82f6",Mid:"#1a6b4a",Major:"#8b5cf6",Principal:"#f59e0b"};

// ── Score helpers ──────────────────────────────────────────────────────────
export function donorScore(d) {
  let s=0;
  if(d.total>20000)s+=35; else if(d.total>5000)s+=22; else if(d.total>1000)s+=12; else s+=5;
  const days=daysDiff(d.lastGift);
  if(days<90)s+=30; else if(days<180)s+=22; else if(days<365)s+=12;
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
  const urgencyColor={critical:"#ef4444",due:"#f59e0b",ok:"#1a6b4a"}[level];
  const contactTextColor=days>365?"#ef4444":days>180?"#f59e0b":T.ink3;
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
    ::-webkit-scrollbar-track{background:#e8e4dc;}
    ::-webkit-scrollbar-thumb{background:#c9a84c;border-radius:99px;}
    ::-webkit-scrollbar-thumb:hover{background:#b8933c;}
    ::selection{background:#0d5c3a22;color:#0f1a12;}
    input,textarea,select{background:#f8f6f2;border:1.5px solid #d4cfc6;border-radius:8px;color:#0f1a12;transition:border-color 0.15s,box-shadow 0.15s;}
    input:focus,textarea:focus,select:focus{border-color:#0d5c3a!important;box-shadow:0 0 0 3px rgba(13,92,58,0.12)!important;outline:none!important;}
    button{transition:all 0.15s ease;touch-action:manipulation;}
    button:not(:disabled):active{transform:scale(0.97);}
    .app-header{padding-top:env(safe-area-inset-top,0px);user-select:none;}
    .app-sidebar{user-select:none;}
    .app-topbar{user-select:none;}
    .topbar-search::placeholder{color:#6b8f7a;}
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
    .gold-moment{animation:goldRise 0.5s cubic-bezier(0.2,0.8,0.3,1) both;}
    .gold-moment .gold-moment-bar{background:linear-gradient(100deg,#c9a84c 40%,#e8d9a8 50%,#c9a84c 60%);background-size:200% 100%;animation:goldSheen 1.8s ease-out 0.4s 1;}
    @media (prefers-reduced-motion: reduce){.gold-moment,.gold-moment .gold-moment-bar{animation:none;}}
    .fade-in{animation:fadeIn 0.2s ease-out both;}
    .slide-in{animation:slideIn 0.18s ease-out both;}
    .slide-up{animation:slideup 0.25s ease both;}
    .modal-anim{animation:slideUp 0.2s ease-out both;}
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
    .rpt-row-click:hover td{background:#f0ede6;}
    .dash-action:hover{background:#f0ede6!important;border-color:#0d5c3a!important;transform:translateY(-1px);}

    /* ── Mobile bottom nav (hidden on desktop) ─────────────────────────── */
    .mobile-bottom-bar{display:none;position:fixed;bottom:0;left:0;right:0;z-index:150;background:#0f1a12;border-top:1px solid #1a2e1f;box-shadow:0 -1px 0 rgba(0,0,0,.2),0 -4px 20px rgba(0,0,0,.15);padding-bottom:env(safe-area-inset-bottom,0px);}
    .mobile-bottom-tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:transparent;border:none;cursor:pointer;padding:8px 4px;color:#8fa896;font-family:'DM Sans',system-ui,sans-serif;font-size:9px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;min-height:60px;transition:color .15s;}
    .mobile-bottom-tab .mob-icon{font-size:18px;line-height:1.2;margin-bottom:1px;display:block;}
    .mobile-bottom-tab.active{color:#c9a84c;}
    .mobile-more-overlay{display:none;position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.6);align-items:flex-end;}
    .mobile-more-drawer{background:#0f1a12;border-radius:20px 20px 0 0;width:100%;padding-bottom:env(safe-area-inset-bottom,0px);overflow:hidden;}
    .mobile-more-handle{width:36px;height:4px;border-radius:2px;background:#1a2e1f;margin:12px auto 4px;}
    .mobile-more-row{display:flex;align-items:center;gap:16px;width:100%;background:transparent;border:none;border-bottom:1px solid #1a2e1f;padding:16px 24px;color:#f0ede6;font-family:'DM Sans',system-ui,sans-serif;font-size:16px;font-weight:500;cursor:pointer;text-align:left;}
    .mobile-more-row .mob-icon{font-size:20px;width:28px;text-align:center;flex-shrink:0;}
    .mobile-more-row.active{color:#c9a84c;font-weight:700;}
    .mobile-more-signout{display:flex;align-items:center;gap:16px;width:100%;background:transparent;border:none;padding:16px 24px;color:#8fa896;font-family:'DM Sans',system-ui,sans-serif;font-size:16px;font-weight:400;cursor:pointer;text-align:left;}
    .dir-stage-mobile{display:none;}

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
      .dash-cpad{padding:12px!important;}
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

      /* Donor profile: single column, 2×2 stat mini-cards */
      .donor-profile-body{grid-template-columns:1fr!important;overflow:auto!important;}
      .donor-profile-header{flex-direction:column!important;align-items:stretch!important;padding:10px 16px!important;gap:6px!important;}
      .dph-identity{flex:none!important;}
      .dph-actions{width:100%!important;flex-shrink:unset!important;gap:6px!important;}
      .dph-actions>button{flex:1!important;justify-content:center!important;font-size:12px!important;padding:8px 4px!important;}
      .donor-stat-grid{grid-template-columns:repeat(2,1fr)!important;}

      /* Directory donor list: collapse to 4 columns, hide Stage/Owner/Assign */
      .dir-header-row,.dir-donor-row{grid-template-columns:2fr 68px 68px 44px!important;padding-left:12px!important;padding-right:12px!important;}
      .dir-col-stage,.dir-col-owner,.dir-col-assign{display:none!important;}
      .dir-stage-mobile{display:inline-flex!important;align-items:center!important;margin-top:3px!important;}

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
  return <button onClick={onClick} disabled={loading} style={{background:loading?"#1a2e1f":"linear-gradient(135deg,#0d5c3a,#1a6b4a)",border:"none",borderRadius:small?8:10,padding:small?"6px 12px":"9px 16px",color:"#f0ede6",fontSize:small?12:13,fontWeight:700,cursor:loading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:6,opacity:loading?0.65:1,whiteSpace:"nowrap",boxShadow:loading?"none":"0 2px 12px rgba(13,92,58,0.35)",letterSpacing:"0.01em"}}>
    {loading?<><Spin/>Thinking…</>:label}
  </button>;
}
export function AIPanel({text,onClose}) {
  if(!text) return null;
  return <div className="fade-in modal-anim" style={{background:"#0f1a12",border:"1px solid #1a2e1f",borderLeft:"3px solid #c9a84c",borderRadius:14,padding:"18px 20px",position:"relative",marginTop:12}}>
    <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.12em",textTransform:"uppercase",color:"#c9a84c",marginBottom:10,display:"flex",alignItems:"center",gap:6}}><span>✦</span> Suggested</div>
    <div style={{fontSize:13,color:"#e8e4dc",lineHeight:1.8,whiteSpace:"pre-wrap"}}>{text}</div>
    {onClose&&<button onClick={onClose} style={{position:"absolute",top:12,right:14,background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:6,color:"#8fa896",cursor:"pointer",fontSize:14,lineHeight:1,width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>×</button>}
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
        :<span style={{fontSize:11,color:trend>0?T.greenMid:T.red,fontWeight:600}}>{trend>0?"↑":"↓"} {Math.abs(trend)}%</span>
    )}
  </div>;
}
export function EmptyState({icon,title,message,action,onAction}) {
  return <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"52px 24px",gap:12,textAlign:"center"}}>
    <div style={{fontSize:36,marginBottom:4,opacity:0.25,color:T.greenDk}}>{icon||"◇"}</div>
    <div style={{fontSize:15,fontWeight:700,color:T.ink2}}>{title||"Nothing here yet"}</div>
    <div style={{fontSize:13,color:T.ink3,maxWidth:340,lineHeight:1.65}}>{message||"Nothing here yet — this is where the magic starts."}</div>
    {action&&<button onClick={onAction} style={{marginTop:8,background:T.greenDk,border:"none",borderRadius:10,padding:"9px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",boxShadow:"0 2px 10px rgba(26,107,74,0.2)"}}>{action}</button>}
  </div>;
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
  useEffect(()=>{ if(show){ try{localStorage.setItem(key,new Date().toISOString());}catch{} } },[]); // eslint-disable-line
  if(!show) return null;
  return (
    <div className="gold-moment" style={{position:"relative",background:"linear-gradient(135deg,#fdfaf2,#faf5e6)",border:"1px solid #c9a84c55",borderRadius:14,padding:"16px 44px 16px 18px",display:"flex",gap:14,alignItems:"center",overflow:"hidden"}}>
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
    <div className="fade-in" style={{background:"#fdfaf2",border:"1px solid #c9a84c55",borderLeft:"4px solid "+T.gold,borderRadius:12,padding:"14px 18px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
      <div style={{flex:"1 1 280px",minWidth:0}}>
        <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.12em",textTransform:"uppercase",color:"#a08434",marginBottom:4}}>Start here</div>
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
        <span style={{color:T.ink3}}>{main}{" "}</span><span style={{color:T.ink,borderBottom:"3px solid #c9a84c",paddingBottom:2}}>{accent}</span>
      </h1>
      {sub&&<div style={{fontSize:14,color:T.ink3,marginTop:6,fontFamily:"'DM Sans',sans-serif"}}>{sub}</div>}
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
          <stop offset="0%" stopColor="#1a6b4a" stopOpacity="0.22"/>
          <stop offset="100%" stopColor="#1a6b4a" stopOpacity="0.01"/>
        </linearGradient>
      </defs>
      {area&&<path d={area} fill="url(#giftGrad)"/>}
      {sorted.length>1&&<polyline points={pts} stroke="#1a6b4a" strokeWidth="2" fill="none" strokeLinejoin="round"/>}
      {sorted.map((g,i)=>(
        <g key={i}>
          <circle cx={xs[i]} cy={ys[i]} r={4} fill="#1a6b4a" stroke={T.white} strokeWidth={1.5}/>
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
    {["yes","no"].map(v=><button key={v} onClick={()=>set(v)} style={{background:val===v?"#10b981":T.bg,border:`1px solid ${val===v?"#10b981":T.bg3}`,borderRadius:7,padding:"7px 20px",color:val===v?"#fff":T.ink3,fontSize:13,fontWeight:600,cursor:"pointer"}}>{v}</button>)}
  </div>;
}
// onDelete (optional): called with the interaction after the user confirms —
// only passed where entries are actual `interactions` rows (DonorProfile);
// Grants renders grant_interactions through this too and passes nothing.
export function TouchpointTimeline({interactions,onDelete}){
  if(!interactions?.length)return<div style={{fontSize:13,color:T.ink3,textAlign:"center",padding:"16px 0"}}>No touchpoints logged yet.</div>;
  const typeColor={call:"#3b82f6",email:"#8b5cf6",meeting:T.greenMid,gift:"#f59e0b",event:"#ec4899",note:"#6b7280",stewardship:T.gold,voice_memo:"#0ea5e9",pledge_reminder:T.terracotta};
  const typeLabel={voice_memo:"Voice Memo",pledge_reminder:"Pledge Reminder"};
  const sorted=[...interactions].sort((a,b)=>new Date(b.date)-new Date(a.date));
  return(
    <div style={{display:"flex",flexDirection:"column",gap:0}}>
      {sorted.map((int,i)=>{
        const c=typeColor[int.type]||"#6b7280";
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
                    background:direction==="inbound"?"#f0fdf4":"#eff6ff",
                    color:direction==="inbound"?"#166534":"#1d4ed8",
                    border:"1px solid "+(direction==="inbound"?"#bbf7d0":"#bfdbfe")}}>
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
                🗑
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
      setError(e.message||"Transcription failed — please try again.");
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
      setError(e.message||"Could not save — please try again.");
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
    <div style={{position:"fixed",inset:0,background:"#0f1a12cc",backdropFilter:"blur(4px)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div className="fade-in" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:18,width:"100%",maxWidth:460,padding:24,boxShadow:"0 4px 32px rgba(15,15,15,0.12)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:16,fontWeight:800,color:T.ink}}>🎙 Voice memo</div>
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

            {error&&<div style={{marginBottom:12,fontSize:13,color:"#dc2626",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"8px 12px"}}>{error}</div>}

            {(phase==="idle")&&(
              <div style={{textAlign:"center",padding:"24px 0"}}>
                <button onClick={startRecording} style={{width:64,height:64,borderRadius:"50%",background:T.terracotta,border:"none",color:"#fff",fontSize:24,cursor:"pointer",boxShadow:"0 4px 16px rgba(184,89,63,0.35)"}}>●</button>
                <div style={{fontSize:12,color:T.ink3,marginTop:12}}>Tap to start recording</div>
              </div>
            )}

            {phase==="recording"&&(
              <div style={{textAlign:"center",padding:"24px 0"}}>
                <button onClick={stopRecording} style={{width:64,height:64,borderRadius:12,background:"#dc2626",border:"none",color:"#fff",fontSize:20,cursor:"pointer",boxShadow:"0 4px 16px rgba(220,38,38,0.35)"}}>■</button>
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
                  <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"12px 14px",marginBottom:14}}>
                    <div style={{fontSize:10,fontWeight:800,color:"#166534",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Worth saving? (your call)</div>
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
    </div>
  );
}

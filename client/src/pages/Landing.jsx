import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FIELD_SIZE, DRIFT_COUNTS, STEADY_COUNT, fieldDots, breatheDelay,
} from "../lib/donorField";

// ── Landing — BUILD-73 Part 4 rebuild ───────────────────────────────────────
//
// Structure and every numeric value come from the two reference files that
// shipped with the build (1440px and 390px). Sizes, line-heights, paddings,
// radii, opacities and gaps are copied EXACTLY out of them — not rounded to a
// 4/8px grid, not replaced with framework defaults. Where a value looks odd
// (86px nav, 0.86fr/1.14fr hero, 0.032em tracking) it is the reference's, and
// changing it should be a decision rather than a tidy-up.
//
// What this page must never grow:
//   · a price, a plan name, a tier, or a founding-partner rate. Cost is a
//     conversation. Every path ends at Start free or Talk to the founder.
//   · invented social proof — no logos, no review scores, no testimonials,
//     no customer counts.
//   · an outcome claim. The value math describes the SIZE OF THE PROBLEM and
//     never Steward's results (BUILD-73 Part 3; the ban is asserted in
//     tests/reserved-recovered.test.js and it scans this file).
//
// Copy that is load-bearing and must not be edited casually:
//   · "Fundraising Effectiveness Project, full-year 2025." FEP rebased in
//     Q1 2026 and now headlines a QUARTERLY figure — dropping "full-year"
//     would silently change what the number means.
//
// The dot field is the one piece with real machinery behind it: see
// ../lib/donorField.js for why the drift set is a module constant with a
// load-bearing ORDER, and tests/donor-field.test.js for the properties.

const C = {
  ink:     "#0F1A12",
  cream:   "#F0EDE6",
  cream2:  "#E8E4DB",
  gold:    "#C9A84C",
  greenDk: "#0D5C3A",
  ink3:    "#6B6560",
  sage:    "#8FA896",
};

const CALENDLY_URL   = "https://calendly.com/xjca2006/new-meeting";
const FOUNDER_MAILTO = "mailto:jonathan@stewardapp.dev";

// ── PLACEHOLDERS ────────────────────────────────────────────────────────────
// One exported object, each value carrying a TODO, rendered so an unfilled
// value is OBVIOUS on the page rather than silently blank. None of these are
// invented: a guessed school or legal entity name on a public page is a
// fabrication, and a blank one is a page that looks broken without saying why.
export const PLACEHOLDERS = {
  founderLastName: "[LAST NAME]",        // TODO: Jonathan's surname
  founderSchool:   "[SCHOOL]",           // TODO: the school he attends
  founderPhoto:    "[ FOUNDER PHOTO ]",  // TODO: a real photo, never a stock portrait
  legalEntity:     "[LEGAL ENTITY NAME]",// TODO: the registered entity for the © line
};
const isPlaceholder = v => typeof v === "string" && v.trim().startsWith("[");

// A placeholder renders in a dotted outline so it reads as "not filled in yet"
// at a glance, on the page, to anyone — including whoever is about to demo it.
function Placeholder({ value, block }) {
  if (!isPlaceholder(value)) return <>{value}</>;
  const style = {
    display: block ? "flex" : "inline-flex", alignItems: "center", justifyContent: "center",
    border: `1px dashed rgba(15, 26, 18, 0.32)`, borderRadius: block ? 12 : 4,
    color: C.ink3, letterSpacing: "0.14em", fontSize: 13, fontFamily: "'DM Sans', system-ui, sans-serif",
    padding: block ? 0 : "1px 7px", background: block ? C.cream : "transparent",
    width: block ? "100%" : "auto", height: block ? "100%" : "auto",
  };
  return <span style={style}>{value}</span>;
}

// ── THE DONOR FIELD — one component, four renders ───────────────────────────
// The hero field and the three year fields are THE SAME 199 DONORS at
// different times. Rendering them from one component with a drift count is
// what makes that true rather than merely claimed: there is no second list to
// drift out of sync with the first.
//
// Accessibility: the wrapper carries role="img" and an aria-label that states
// the fact IN WORDS, and the dot container is aria-hidden so a screen reader
// is not read 199 empty elements. The legend below every field is real text,
// not decoration.
//
// Performance: only opacity and transform animate. No filter, no shadow
// transition, nothing layout-affecting — on 199 elements any of those would
// cost a paint per frame.
function DonorField({ count, size, gap, label, className = "" }) {
  const dots = fieldDots(count);
  return (
    <div role="img" aria-label={label} className={className}>
      <div aria-hidden="true" style={{ display: "flex", flexWrap: "wrap", gap }}>
        {dots.map(d => (
          <span
            key={d.i}
            className={d.drifting ? "df-dot df-drift" : "df-dot"}
            style={{
              width: size, height: size, borderRadius: "50%",
              background: d.drifting ? C.gold : C.greenDk,
              // Custom properties, so the animation lives entirely in CSS
              // behind the reduced-motion query and this element never
              // carries an opacity of its own.
              "--d": `${d.delay}ms`,
              "--b": `${breatheDelay(d.i)}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── "Built for orgs like yours" — kept from the live page ───────────────────
// Photography is ILLUSTRATIVE nonprofit work, NOT a Steward customer, and is
// never captioned as one (the honest-imagery rule). Free-tier Unsplash;
// provenance and licence per image in client/public/ASSETS.md.
const VERTICALS = [
  {
    title: "Arts & culture",
    blurb: "Season subscribers, gala tables, patron circles — the giving that quietly lapses between shows.",
    img: "/card-arts",
  },
  {
    title: "Rescue & relief",
    blurb: "Monthly givers who quietly stop giving when a card expires, and no one was watching.",
    img: "/card-rescue",
  },
  {
    title: "Faith & community",
    blurb: "One staffer wearing every hat, keeping a whole community's giving on track.",
    img: "/card-faith",
    pos: "center 60%", // portrait source — keep the lit chapel inside the landscape crop
  },
];

// The three donors on the "Who's slipping away" card. Illustrative, and
// labelled as such in the card's own footer — never presented as real people
// at a real organization.
const SLIPPING = [
  { name: "Margaret Chen",       why: "$2,000 every March since 2019. Nothing for 14 months.",              amt: "$2,000", unit: "a year" },
  { name: "The Halvorsen Family", why: "Gave four times a year, then once, then not at all.",                amt: "$3,400", unit: "lifetime" },
  { name: "David Okonkwo",       why: "Monthly gift failed three weeks ago. Card expired. He doesn't know.", amt: "$150",   unit: "a month" },
];

const YEAR_PANELS = [
  { month: "January",  count: DRIFT_COUNTS.january,
    copy: "Everyone is current. The file looks healthy and the board is happy." },
  { month: "June",     count: DRIFT_COUNTS.june,
    copy: "Thirty-one have quietly gone past their usual month. This is the window, and this is where Steward calls it." },
  { month: "December", count: DRIFT_COUNTS.december,
    copy: "Seventy-four gone, and the year-end report explains the shortfall without ever naming one of them." },
];

function CalendlyModal({ onClose }) {
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const s = document.createElement("script");
    s.src = "https://assets.calendly.com/assets/external/widget.js";
    s.async = true;
    document.head.appendChild(s);
  }, []);
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 500, background: "rgba(15, 26, 18, 0.6)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "40px 16px", overflowY: "auto",
      }}
    >
      <div style={{
        background: C.cream, borderRadius: 18, width: "100%", maxWidth: 680,
        boxShadow: "0 24px 80px rgba(0, 0, 0, 0.25)", border: "1px solid rgba(15, 26, 18, 0.14)", overflow: "hidden",
      }}>
        <div style={{ padding: "22px 26px 0", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <span className="lp-serif" style={{ fontSize: 23, color: C.ink }}>
            Pick a time — it's me you'll be talking to
          </span>
          <button onClick={onClose} aria-label="Close" style={{
            background: "none", border: "none", fontSize: 22, color: C.ink3, cursor: "pointer",
            lineHeight: 1, padding: 10, minWidth: 44, minHeight: 44,
          }}>×</button>
        </div>
        <div style={{ padding: "4px 26px 0", fontSize: 13, color: C.ink3 }}>
          Or just write: <a href={FOUNDER_MAILTO} style={{ color: C.greenDk, textDecoration: "underline", textUnderlineOffset: 3 }}>jonathan@stewardapp.dev</a>
        </div>
        <div className="calendly-inline-widget" data-url={CALENDLY_URL} style={{ minWidth: 320, height: 640 }} />
      </div>
    </div>
  );
}

const STYLES = `
  .lp, .lp *, .lp *::before, .lp *::after { box-sizing: border-box; }
  .lp { background: ${C.cream2}; color: ${C.ink}; font-family: 'DM Sans', system-ui, sans-serif;
        -webkit-font-smoothing: antialiased; overflow-x: hidden; min-height: 100vh; }
  .lp p { margin: 0; }
  .lp h1, .lp h2, .lp h3 { margin: 0; font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; }
  .lp a { color: inherit; text-decoration: none; }
  .lp-serif { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; }

  /* Section rhythm. The reference is 100px 64px at 1440 and 62px 20px at 390;
     the collapse point is chosen by where the 50px headlines start wrapping
     badly, not by a round number — see the 1080px query below. */
  .lp-sec { padding: 100px 64px; }
  .lp-eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 0.16em; }

  /* Buttons. Every one is at least 44px tall including at 390px. */
  .lp-btn { display: inline-flex; align-items: center; justify-content: center;
            border-radius: 999px; font-weight: 500; cursor: pointer; border: none;
            font-family: inherit; min-height: 44px; transition: transform .12s ease, opacity .12s ease; }
  .lp-btn:hover { transform: translateY(-1px); }
  .lp-btn-ink   { background: ${C.ink}; color: ${C.cream}; font-size: 16px; padding: 16px 32px; }
  .lp-btn-gold  { background: ${C.gold}; color: ${C.ink}; font-size: 17px; font-weight: 600; padding: 18px 38px; }
  .lp-btn-ghost { background: transparent; color: ${C.cream}; font-size: 17px; padding: 18px 36px;
                  border: 1px solid rgba(240, 237, 230, 0.3); }
  .lp-btn-quiet { background: transparent; color: ${C.ink}; font-size: 16px; padding: 12px 0;
                  border: none; border-bottom: 1px solid rgba(15, 26, 18, 0.28); border-radius: 0; }
  .lp-navbtn { background: ${C.ink}; color: ${C.cream}; font-weight: 500; padding: 11px 24px;
               border-radius: 999px; border: none; cursor: pointer; font-family: inherit;
               font-size: 15px; min-height: 44px; }
  .lp-navlink { font-size: 15px; color: ${C.ink3}; background: none; border: none; cursor: pointer;
                font-family: inherit; padding: 10px 0; min-height: 44px; display: inline-flex;
                align-items: center; transition: color .15s; }
  .lp-navlink:hover, .lp a:hover { color: ${C.gold}; }
  .lp-focus:focus-visible { outline: 2px solid ${C.gold}; outline-offset: 3px; border-radius: 4px; }

  /* ── THE DOT FIELD ───────────────────────────────────────────────────────
     The base state is fully visible and carries NO opacity of its own. The
     entrance wave and the breathing live entirely inside the no-preference
     query below. Leaving an opacity of 0 as a base state outside that query is
     the bug this structure exists to prevent: with reduced motion on, the
     animation never runs, and a field that starts at zero opacity simply
     never appears. */
  .lp .df-dot { display: block; flex: 0 0 auto; will-change: auto; }

  @media (prefers-reduced-motion: no-preference) {
    @keyframes lpDotIn   { from { opacity: 0; transform: scale(0.35); } to { opacity: 1; transform: none; } }
    @keyframes lpDotGlow { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    @keyframes lpUp      { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
    @keyframes lpPulse   { 0%, 100% { box-shadow: 0 0 0 0 rgba(201, 168, 76, 0.55); }
                           55%      { box-shadow: 0 0 0 7px rgba(201, 168, 76, 0); } }
    .lp .df-dot   { animation: lpDotIn 0.5s ease-out var(--d) both; }
    .lp .df-drift { animation: lpDotIn 0.5s ease-out var(--d) both,
                               lpDotGlow 5s ease-in-out var(--b) infinite; }
    .lp .up       { animation: lpUp 0.95s cubic-bezier(0.2, 0.75, 0.2, 1) both; }
    .lp .lp-pulse { animation: lpPulse 2.4s ease-out infinite; }
  }

  /* ── Layout ── */
  .lp-nav      { display: flex; align-items: center; justify-content: space-between;
                 padding: 0 64px; height: 86px; border-bottom: 1px solid rgba(15, 26, 18, 0.1); }
  .lp-navwrap  { display: flex; align-items: center; gap: 36px; }
  .lp-hero     { display: grid; grid-template-columns: 0.86fr 1.14fr; gap: 60px;
                 align-items: center; padding: 84px 64px 88px; }
  .lp-hero-col { display: flex; flex-direction: column; gap: 26px; }
  .lp-field-hero { max-width: 672px; }
  .lp-legend   { display: flex; align-items: center; gap: 28px; padding-top: 22px;
                 border-top: 1px solid rgba(15, 26, 18, 0.16); max-width: 672px; flex-wrap: wrap; }
  .lp-strip    { background: ${C.cream}; border-top: 1px solid rgba(15, 26, 18, 0.1);
                 padding: 20px 64px; display: flex; align-items: center;
                 justify-content: space-between; gap: 24px; flex-wrap: wrap; }
  .lp-3col     { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 40px; margin-top: 64px; }
  .lp-cards    { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 26px;
                 margin-top: 58px; align-items: start; }
  .lp-split    { display: grid; grid-template-columns: 0.9fr 1.1fr; gap: 72px; align-items: center; }
  .lp-founder  { display: grid; grid-template-columns: 0.72fr 1.28fr; gap: 64px; align-items: start; }
  .lp-sechead  { display: flex; align-items: flex-end; justify-content: space-between; gap: 48px; }
  .lp-ctarow   { display: flex; align-items: center; gap: 24px; margin-top: 10px; flex-wrap: wrap; }
  .lp-verts    { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 26px; margin-top: 58px; }
  .lp-vert-img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; }
  .lp-footer   { background: ${C.ink}; border-top: 1px solid rgba(240, 237, 230, 0.1);
                 padding: 34px 64px; display: flex; align-items: center;
                 justify-content: space-between; gap: 20px; flex-wrap: wrap; }

  /* Wide content scrolls inside its own container; the page body never does. */
  .lp-scrollx { overflow-x: auto; }

  /* ── Collapse point: 1080px, chosen by where the 50px serif headlines start
     wrapping into two-word orphans against the 0.86fr hero column, not by a
     round number. ── */
  @media (max-width: 1080px) {
    .lp-sec     { padding: 72px 40px; }
    .lp-nav     { padding: 0 40px; }
    .lp-hero    { grid-template-columns: 1fr; gap: 44px; padding: 60px 40px 64px; }
    .lp-split, .lp-founder { grid-template-columns: 1fr; gap: 40px; }
    .lp-sechead { flex-direction: column; align-items: flex-start; gap: 18px; }
    .lp-3col, .lp-cards, .lp-verts { grid-template-columns: 1fr; gap: 32px; margin-top: 44px; }
    .lp-cards > * { margin-top: 0 !important; }
    .lp-strip   { padding: 20px 40px; flex-direction: column; align-items: flex-start; gap: 8px; }
    .lp-footer  { padding: 28px 40px; }
    .lp-h1      { font-size: 54px !important; }
    .lp-h2      { font-size: 40px !important; }
    .lp-close-h { font-size: 48px !important; }
  }

  /* ── 390px reference values ── */
  @media (max-width: 640px) {
    .lp-sec     { padding: 62px 20px; }
    .lp-nav     { padding: 0 20px; height: 70px; }
    .lp-nav .lp-navwrap .lp-navlink { display: none; }
    .lp-hero    { padding: 52px 20px 56px; gap: 22px; }
    .lp-hero-col { gap: 22px; }
    .lp-strip   { padding: 20px; }
    .lp-footer  { padding: 28px 20px; flex-direction: column; align-items: flex-start; gap: 14px; }
    .lp-h1      { font-size: 46px !important; }
    .lp-h2      { font-size: 34px !important; }
    .lp-h3      { font-size: 23px !important; }
    .lp-close-h { font-size: 40px !important; }
    .lp-lede    { font-size: 17px !important; }
    .lp-ctarow  { flex-direction: column; align-items: stretch; gap: 12px; }
    .lp-ctarow > .lp-btn { width: 100%; padding: 17px 24px; }
    .lp-btn-quiet { border: 1px solid rgba(15, 26, 18, 0.3); border-radius: 999px; padding: 17px 24px; }
    .lp-legend  { gap: 20px; padding-top: 18px; }
    .lp-legend .lp-grow { display: none; }
    .lp-legend .lp-atrisk { flex-basis: 100%; }
  }

  /* Nothing on this page may scroll the page sideways, at any width from 320. */
  @media (max-width: 400px) {
    .lp-sec, .lp-hero, .lp-nav, .lp-strip, .lp-footer { padding-left: 16px; padding-right: 16px; }
  }
`;

export default function Landing() {
  const navigate = useNavigate();
  const [showCal, setShowCal] = useState(false);

  // Document head. Set here rather than in index.html because index.html is
  // the shared SPA shell — every authenticated route would otherwise inherit
  // the landing's title and description.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = "Steward — donor CRM for small nonprofits";
    const meta = (attr, key, content) => {
      let el = document.head.querySelector(`meta[${attr}="${key}"]`);
      let created = false;
      if (!el) { el = document.createElement("meta"); el.setAttribute(attr, key); document.head.appendChild(el); created = true; }
      const prev = el.getAttribute("content");
      el.setAttribute("content", content);
      return () => { if (created) el.remove(); else if (prev != null) el.setAttribute("content", prev); };
    };
    const DESC = "Donors don't leave, they drift. Steward shows you which of your donors have gone quiet, ranked, with the reason next to each name — before a lapse becomes permanent.";
    const undo = [
      meta("name", "description", DESC),
      meta("property", "og:title", "Steward — donor CRM for small nonprofits"),
      meta("property", "og:description", DESC),
      meta("property", "og:type", "website"),
      meta("property", "og:url", "https://www.stewardapp.dev/"),
      meta("property", "og:image", "https://www.stewardapp.dev/og-image.png"),
      meta("name", "twitter:card", "summary_large_image"),
      meta("name", "twitter:title", "Steward — donor CRM for small nonprofits"),
      meta("name", "twitter:description", DESC),
    ];
    return () => { document.title = prevTitle; undo.forEach(f => f()); };
  }, []);

  const scrollTo = id => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const startFree = () => navigate("/signup");
  const talkToFounder = () => setShowCal(true);

  return (
    <>
      {/* Fonts: non-render-blocking (injected in the render, not a head <link>
          in index.html) with display=OPTIONAL, so the brand serif never swaps
          in mid-load and the hero headline never reflows. Both faces carry a
          real fallback stack in the CSS above (Georgia, serif · system-ui,
          sans-serif). preconnects live in index.html. Do NOT move this into a
          render-blocking <head> stylesheet — it costs ~1.3s of FCP, measured. */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300..700&family=DM+Serif+Display:ital@0;1&display=optional"
      />
      <style>{STYLES}</style>

      {showCal && <CalendlyModal onClose={() => setShowCal(false)} />}

      <div className="lp">

        {/* ── NAV ────────────────────────────────────────────────────────── */}
        <nav className="lp-nav">
          <a href="/" className="lp-serif lp-focus" style={{ fontSize: 26, letterSpacing: "-0.01em", display: "inline-flex", alignItems: "center", minHeight: 44 }}>Steward</a>
          <div className="lp-navwrap">
            {/* No Pricing link, deliberately. Price is a conversation, and every
                path on this page ends at Start free or Talk to the founder.
                The /pricing route still exists for anyone holding a direct link. */}
            <button className="lp-navlink lp-focus" onClick={() => scrollTo("product")}>Product</button>
            <button className="lp-navlink lp-focus" onClick={() => scrollTo("how-it-works")}>How it works</button>
            <a href="/login" className="lp-navlink lp-focus">Log in</a>
            <button className="lp-navbtn lp-focus" onClick={startFree}>Start free</button>
          </div>
        </nav>

        {/* ── HERO ───────────────────────────────────────────────────────── */}
        <header className="lp-hero">
          <div className="lp-hero-col">
            <div className="up lp-eyebrow" style={{ color: C.greenDk }}>DONOR CRM FOR SMALL NONPROFITS</div>
            <h1 className="up lp-h1" style={{ fontSize: 64, lineHeight: 1.02, letterSpacing: "-0.032em", animationDelay: "0.08s" }}>
              Donors don't leave.<br />They drift.<br /><span style={{ color: C.greenDk }}>Steward notices.</span>
            </h1>
            <p className="up lp-lede" style={{ fontSize: 19, lineHeight: 1.55, color: C.ink3, maxWidth: 440, animationDelay: "0.16s" }}>
              Every dot is one of the {FIELD_SIZE} donors who carry 90% of your revenue. The gold ones are the {DRIFT_COUNTS.hero} expected to go quiet this year, one at a time, without telling you.
            </p>
            <div className="up lp-ctarow" style={{ animationDelay: "0.24s" }}>
              <button className="lp-btn lp-btn-ink lp-focus" onClick={startFree}>Start free</button>
              <button className="lp-btn lp-btn-quiet lp-focus" onClick={talkToFounder}>Talk to the founder</button>
            </div>
            <p className="up" style={{ fontSize: 14, color: C.ink3, lineHeight: 1.7, marginTop: 4, animationDelay: "0.3s" }}>
              No platform fee · no donor tip prompt · gifts settle in your own Stripe
            </p>
          </div>

          <div className="lp-hero-col">
            <DonorField
              count={DRIFT_COUNTS.hero}
              size={20}
              gap={12}
              className="lp-field-hero"
              label={`A field of ${FIELD_SIZE} dots, one for each of the donors who carry 90% of a typical file's revenue. ${DRIFT_COUNTS.hero} of them are gold, marking the donors expected to go quiet over a year.`}
            />
            <div className="lp-legend">
              <span style={{ fontSize: 14, color: C.ink3 }}>{STEADY_COUNT} steady</span>
              <span style={{ fontSize: 14, color: C.ink3 }}>{DRIFT_COUNTS.hero} drifting</span>
              <span className="lp-grow" style={{ flexGrow: 1 }} />
              <span className="lp-atrisk" style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span className="lp-serif" style={{ fontSize: 36, letterSpacing: "-0.02em" }}>$360,144</span>
                <span style={{ fontSize: 14, color: C.ink3 }}>walking out</span>
              </span>
            </div>
          </div>
        </header>

        {/* ── SOURCE STRIP ───────────────────────────────────────────────── */}
        {/* "full-year 2025" is load-bearing: FEP rebased in Q1 2026 and now
            headlines a QUARTERLY figure. Dropping those two words silently
            changes what the number means. */}
        <div className="lp-strip">
          <p style={{ fontSize: 14, color: C.ink3, lineHeight: 1.6 }}>
            Distribution and lapse rate from the Fundraising Effectiveness Project, full-year 2025, applied to a 1,000-donor file.
          </p>
          <p style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.5 }}>
            One saved mid-level donor pays for Steward several times over.
          </p>
        </div>

        {/* ── BUILT FOR ORGS LIKE YOURS ──────────────────────────────────── */}
        {/* Kept from the live page. The photography is illustrative nonprofit
            work, never a Steward customer and never captioned as one. */}
        <section className="lp-sec" style={{ background: C.cream2 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, alignItems: "center", textAlign: "center" }}>
            <div className="lp-eyebrow" style={{ color: C.greenDk }}>BUILT FOR ORGS LIKE YOURS</div>
            <h2 className="lp-h2" style={{ fontSize: 50, lineHeight: 1.06, letterSpacing: "-0.025em", maxWidth: 900 }}>
              You know your donors. Steward notices when they're slipping.
            </h2>
          </div>
          <div className="lp-verts">
            {VERTICALS.map(v => (
              <article key={v.title} style={{
                background: C.cream, border: "1px solid rgba(15, 26, 18, 0.1)", borderRadius: 14,
                overflow: "hidden", boxShadow: "0 14px 40px rgba(15, 26, 18, 0.06)",
                display: "flex", flexDirection: "column",
              }}>
                <img
                  className="lp-vert-img"
                  src={`${v.img}-800.webp`}
                  srcSet={`${v.img}-400.webp 400w, ${v.img}-800.webp 800w`}
                  sizes="(max-width: 1080px) 100vw, 33vw"
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  decoding="async"
                  style={{ objectPosition: v.pos || "center" }}
                />
                <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 12 }}>
                  <h3 className="lp-serif lp-h3" style={{ fontSize: 25, lineHeight: 1.18 }}>{v.title}</h3>
                  <p style={{ fontSize: 15, lineHeight: 1.65, color: C.ink3 }}>{v.blurb}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ── ONE YEAR, THE SAME FILE ────────────────────────────────────── */}
        {/* The three fields are the SAME 199 donors at three moments. June's 31
            are literally the first 31 of December's 74 (donorField.js), so the
            progression nests — the section's whole claim is that these are the
            same people further along, and it is true by construction. */}
        <section id="how-it-works" className="lp-sec" style={{ background: C.ink }}>
          <div className="lp-sechead">
            <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 720 }}>
              <div className="lp-eyebrow" style={{ color: C.gold }}>ONE YEAR, THE SAME FILE</div>
              <h2 className="lp-h2" style={{ fontSize: 50, lineHeight: 1.06, color: C.cream, letterSpacing: "-0.025em" }}>
                Nobody decides to stop giving. It just stops.
              </h2>
            </div>
            <p style={{ fontSize: 16, lineHeight: 1.6, color: "rgba(240, 237, 230, 0.6)", maxWidth: 340 }}>
              There is no cancellation, no complaint and no exit survey. A gift simply doesn't arrive, and then another one doesn't.
            </p>
          </div>

          <div className="lp-3col">
            {YEAR_PANELS.map(p => (
              <div key={p.month} style={{ display: "flex", flexDirection: "column", gap: 22 }}>
                <DonorField
                  count={p.count}
                  size={11}
                  gap={7}
                  label={
                    p.count === 0
                      ? `${p.month}: all ${FIELD_SIZE} donors are still current.`
                      : `${p.month}: ${p.count} of the same ${FIELD_SIZE} donors have gone quiet, shown in gold.`
                  }
                />
                <div style={{
                  display: "flex", flexDirection: "column", gap: 7, paddingTop: 18,
                  borderTop: "1px solid rgba(240, 237, 230, 0.2)",
                }}>
                  <div className="lp-serif" style={{ fontSize: 26, color: C.cream }}>{p.month}</div>
                  <p style={{ fontSize: 15, lineHeight: 1.6, color: "rgba(240, 237, 230, 0.6)" }}>{p.copy}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── EVERY DOT IS A PERSON ──────────────────────────────────────── */}
        <section id="product" className="lp-sec" style={{ background: C.cream }}>
          <div className="lp-split">
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div className="lp-eyebrow" style={{ color: C.greenDk }}>EVERY DOT IS A PERSON</div>
              <h2 className="lp-h2" style={{ fontSize: 50, lineHeight: 1.06, letterSpacing: "-0.025em" }}>
                They have names, and one of them is about to be gone.
              </h2>
              <p style={{ fontSize: 18, lineHeight: 1.65, color: C.ink3, maxWidth: 480 }}>
                Steward turns the gold dots back into people with a reason attached, ranked by what they are worth and how long they have been quiet. That list is the whole product.
              </p>
              <div className="lp-ctarow" style={{ marginTop: 8 }}>
                <button className="lp-btn lp-btn-ink lp-focus" onClick={startFree}>See it on your own file</button>
              </div>
            </div>

            <div style={{
              background: C.cream2, border: "1px solid rgba(15, 26, 18, 0.12)", borderRadius: 14,
              overflow: "hidden", boxShadow: "0 26px 60px rgba(15, 26, 18, 0.12)",
            }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14,
                padding: "20px 24px", background: C.cream, borderBottom: "1px solid rgba(15, 26, 18, 0.1)",
              }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", color: C.ink3 }}>TODAY</div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>Who's slipping away</div>
                </div>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, background: C.ink, color: C.gold,
                  fontSize: 13, fontWeight: 600, padding: "8px 14px", borderRadius: 999, flexShrink: 0,
                }}>
                  <span className="lp-pulse" aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: C.gold, display: "block" }} />
                  11 drifting
                </div>
              </div>

              {SLIPPING.map(r => (
                <div key={r.name} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18,
                  padding: "20px 24px", background: C.cream, borderBottom: "1px solid rgba(15, 26, 18, 0.08)",
                }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{r.name}</div>
                    <div style={{ fontSize: 14, color: C.ink3, lineHeight: 1.45 }}>{r.why}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 600 }}>{r.amt}</div>
                    <div style={{ fontSize: 12, color: C.ink3, marginTop: 2 }}>{r.unit}</div>
                  </div>
                </div>
              ))}

              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                padding: "17px 24px", background: C.cream2, flexWrap: "wrap",
              }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.greenDk }}>See all 11 →</span>
                <span style={{ fontSize: 13, color: C.ink3 }}>Illustrative — not a real organization's file</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── WHAT IT DOES ───────────────────────────────────────────────── */}
        <section className="lp-sec" style={{ background: C.cream2 }}>
          <div className="lp-sechead">
            <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 700 }}>
              <div className="lp-eyebrow" style={{ color: C.greenDk }}>WHAT IT DOES</div>
              <h2 className="lp-h2" style={{ fontSize: 48, lineHeight: 1.06, letterSpacing: "-0.025em" }}>
                Built around the fundraiser's week, not the database.
              </h2>
            </div>
            <p style={{ fontSize: 16, lineHeight: 1.6, color: C.ink3, maxWidth: 330 }}>
              Three things it does that a spreadsheet and a general-purpose CRM both fail at.
            </p>
          </div>

          <div className="lp-cards">
            {/* 01 — a short list */}
            <article style={{
              background: C.cream, border: "1px solid rgba(15, 26, 18, 0.1)", borderRadius: 14, padding: 28,
              display: "flex", flexDirection: "column", gap: 24, boxShadow: "0 14px 40px rgba(15, 26, 18, 0.06)",
            }}>
              <div aria-hidden="true" style={{
                display: "flex", flexDirection: "column", gap: 12, background: C.ink,
                borderRadius: 10, padding: 22, height: 136, justifyContent: "center",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <span className="lp-pulse" style={{ width: 9, height: 9, borderRadius: "50%", background: C.gold, flexShrink: 0, display: "block" }} />
                  <span style={{ height: 8, background: "rgba(240, 237, 230, 0.9)", borderRadius: 999, width: 130, display: "block" }} />
                </div>
                <span style={{ height: 8, background: "rgba(240, 237, 230, 0.55)", borderRadius: 999, width: 96, display: "block" }} />
                <span style={{ height: 8, background: "rgba(240, 237, 230, 0.32)", borderRadius: 999, width: 150, maxWidth: "100%", display: "block" }} />
                <span style={{ height: 8, background: "rgba(240, 237, 230, 0.2)", borderRadius: 999, width: 80, display: "block" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="lp-serif" style={{ fontSize: 30, color: "rgba(13, 92, 58, 0.3)", lineHeight: 1 }}>01</div>
                <h3 className="lp-h3" style={{ fontSize: 25, lineHeight: 1.18 }}>A short list, not a dashboard</h3>
                <p style={{ fontSize: 15, lineHeight: 1.65, color: C.ink3 }}>
                  Open Monday morning to the people who changed, ranked, with the reason written next to each name. Nothing to build first.
                </p>
              </div>
            </article>

            {/* 02 — drift, the gold-bordered middle card */}
            <article style={{
              background: C.cream, border: "1px solid rgba(201, 168, 76, 0.55)", borderRadius: 14, padding: 28,
              display: "flex", flexDirection: "column", gap: 24, marginTop: 34,
              boxShadow: "0 20px 54px rgba(15, 26, 18, 0.1)",
            }}>
              <div aria-hidden="true" style={{
                display: "flex", alignItems: "flex-end", gap: 8, background: C.ink,
                borderRadius: 10, padding: 22, height: 136,
              }}>
                {[58, 68, 56, 74, 64].map((h, i) => (
                  <span key={i} style={{ flexGrow: 1, height: h, background: C.greenDk, borderRadius: 3, display: "block" }} />
                ))}
                <span style={{ flexGrow: 1, height: 18, background: C.gold, borderRadius: 3, display: "block" }} />
                <span style={{ flexGrow: 1, height: 5, background: C.gold, borderRadius: 3, display: "block" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="lp-serif" style={{ fontSize: 30, color: "rgba(201, 168, 76, 0.85)", lineHeight: 1 }}>02</div>
                <h3 className="lp-h3" style={{ fontSize: 25, lineHeight: 1.18 }}>Drift, before it becomes a lapse</h3>
                <p style={{ fontSize: 15, lineHeight: 1.65, color: C.ink3 }}>
                  A donor who gave every March and hasn't yet isn't lapsed. That is the window where a phone call still works, and it closes quietly.
                </p>
              </div>
            </article>

            {/* 03 — ask vs gift */}
            <article style={{
              background: C.cream, border: "1px solid rgba(15, 26, 18, 0.1)", borderRadius: 14, padding: 28,
              display: "flex", flexDirection: "column", gap: 24, boxShadow: "0 14px 40px rgba(15, 26, 18, 0.06)",
            }}>
              <div aria-hidden="true" style={{
                display: "flex", flexDirection: "column", justifyContent: "center", gap: 17,
                background: C.ink, borderRadius: 10, padding: 22, height: 136,
              }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgba(240, 237, 230, 0.6)", letterSpacing: "0.1em" }}>
                    <span>ASKED</span><span>$45,000</span>
                  </div>
                  <span style={{ height: 8, background: "rgba(240, 237, 230, 0.26)", borderRadius: 999, display: "block" }} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgba(240, 237, 230, 0.6)", letterSpacing: "0.1em" }}>
                    <span>RECEIVED</span><span>$28,500</span>
                  </div>
                  <div style={{ display: "flex" }}>
                    <span style={{ height: 8, background: C.gold, borderRadius: 999, width: "63%", display: "block" }} />
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="lp-serif" style={{ fontSize: 30, color: "rgba(13, 92, 58, 0.3)", lineHeight: 1 }}>03</div>
                <h3 className="lp-h3" style={{ fontSize: 25, lineHeight: 1.18 }}>Ask versus gift, per officer</h3>
                <p style={{ fontSize: 15, lineHeight: 1.65, color: C.ink3 }}>
                  What was asked, what came in, and by whom. The report your board wants and your current system makes you assemble by hand.
                </p>
              </div>
            </article>
          </div>
        </section>

        {/* ── WHO BUILT THIS ─────────────────────────────────────────────── */}
        <section className="lp-sec" style={{ background: C.cream2 }}>
          <div className="lp-founder">
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{
                width: "100%", aspectRatio: "4 / 5", background: C.cream,
                border: "1px solid rgba(15, 26, 18, 0.14)", borderRadius: 12,
                display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
              }}>
                <Placeholder value={PLACEHOLDERS.founderPhoto} block />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 17, fontWeight: 600 }}>
                  Jonathan <Placeholder value={PLACEHOLDERS.founderLastName} />
                </div>
                <div style={{ fontSize: 15, color: C.ink3 }}>Founder, Steward</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
              <div className="lp-eyebrow" style={{ color: C.greenDk }}>WHO BUILT THIS</div>

              <h2 className="lp-h2" style={{ fontSize: 50, lineHeight: 1.06, letterSpacing: "-0.025em" }}>
                You didn't take this job to chase money.
              </h2>

              <p style={{ fontSize: 18, lineHeight: 1.7, color: C.ink3 }}>
                Nobody starts a nonprofit because they love donor databases. You started it because of a kid who needed a place to go after school, or a family who needed a meal, or a building worth saving. That was the whole point. And then somehow the week fills up with spreadsheets and mail merges and a system that makes you assemble by hand the one report your board actually asked for.
              </p>

              <p style={{ fontSize: 18, lineHeight: 1.7, color: C.ink3 }}>
                My father has spent his career as a development officer, so I grew up hearing about this at the dinner table — not the fundraising wins, but the good people who left quietly and were only noticed a year later, when the number came in short. He'd know their names. He'd know exactly what happened. He just didn't have anything that told him in time.
              </p>

              <p style={{ fontSize: 18, lineHeight: 1.7, color: C.ink3 }}>
                That's the only thing Steward is trying to do: give you back the hours the software should never have taken, and put the right name in front of you while there is still something you can do about it. Less time keeping the machine running. More time on the work you actually signed up for.
              </p>

              <p style={{ fontSize: 18, lineHeight: 1.7, color: C.ink3 }}>
                I'm Jonathan. I'm a student at <Placeholder value={PLACEHOLDERS.founderSchool} />, I started Steward in May 2026, and I have written every line of it since. It was specified with my dad, argued about with him, and rebuilt more than once because he looked at a screen and told me it was wrong.
              </p>

              <div style={{ borderLeft: `2px solid ${C.gold}`, paddingLeft: 24, display: "flex", flexDirection: "column", gap: 8 }}>
                <p style={{ fontSize: 18, lineHeight: 1.7, color: C.ink }}>
                  I am young for this and I am not going to pretend otherwise. What it buys you is someone who picks up the phone, ships the fix the same week, and has no bigger customer to prioritise ahead of you.
                </p>
              </div>

              <div className="lp-ctarow" style={{ marginTop: 6 }}>
                <button className="lp-btn lp-btn-ink lp-focus" onClick={talkToFounder}>Talk to the founder</button>
                <span style={{ fontSize: 15, color: C.ink3 }}>Fifteen minutes, and I will tell you if Steward is wrong for you.</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── CLOSING ────────────────────────────────────────────────────── */}
        <section className="lp-sec" style={{ background: C.ink, paddingTop: 110, paddingBottom: 110 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, textAlign: "center" }}>
            <h2 className="lp-close-h" style={{ fontSize: 62, lineHeight: 1.03, color: C.cream, letterSpacing: "-0.03em", maxWidth: 800 }}>
              Find out which of yours are gold.
            </h2>
            <p style={{ fontSize: 19, lineHeight: 1.55, color: "rgba(240, 237, 230, 0.72)", maxWidth: 540 }}>
              Import a CSV and see your own file drawn this way. About ten minutes, and no card.
            </p>
            <div className="lp-ctarow" style={{ justifyContent: "center", gap: 14, marginTop: 12 }}>
              <button className="lp-btn lp-btn-gold lp-focus" onClick={startFree}>Start free</button>
              <button className="lp-btn lp-btn-ghost lp-focus" onClick={talkToFounder}>Talk to the founder</button>
            </div>
            <p style={{ fontSize: 14, color: C.sage, marginTop: 4 }}>
              No card required · your data exports whenever you want it · cancel by email
            </p>
          </div>
        </section>

        {/* ── FOOTER ─────────────────────────────────────────────────────── */}
        <footer className="lp-footer">
          <div className="lp-serif" style={{ fontSize: 21, color: C.cream }}>Steward</div>
          <div style={{ display: "flex", gap: 30, fontSize: 14, color: C.sage, alignItems: "center", flexWrap: "wrap" }}>
            <a href="/terms" className="lp-focus" style={{ color: C.sage, minHeight: 44, display: "inline-flex", alignItems: "center" }}>Terms</a>
            <a href="/privacy" className="lp-focus" style={{ color: C.sage, minHeight: 44, display: "inline-flex", alignItems: "center" }}>Privacy</a>
            <span>© 2026 <Placeholder value={PLACEHOLDERS.legalEntity} /></span>
          </div>
        </footer>

      </div>
    </>
  );
}

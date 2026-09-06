import { useEffect, useState } from "react";
import {
  FIELD_SIZE, DRIFT_COUNTS, STEADY_COUNT, fieldDots, breatheDelay,
} from "../lib/donorField";

// ── Landing — BUILD-81 rebuild: THE THREAD ──────────────────────────────────
//
// The page says the one sentence the product says: you log a conversation,
// Steward hands you the next step, and it keeps asking until you've done it.
// Built on the question, not a statistic. Section order (BUILD-81 §4.4):
//   Hero (the question, the thread visual) · How it works (three beats,
//   tight renders of the real Part 1 UI) · When a card stops · Drift (the
//   dot field moves DOWN the page as evidence, its FEP caption byte-intact)
//   · The record · Your data · Closing CTAs · Footer.
//
// What this page must never grow (unchanged from BUILD-73/74):
//   · a price, a plan name, a tier, or a founding-partner rate. Cost is a
//     conversation. Every path ends at Start free or Talk to the founder.
//   · invented social proof — no logos, no review scores, no testimonials,
//     no customer counts, no "trusted by", no "join hundreds of".
//   · an outcome claim. "Recovery" is a feature noun; "recovered" is a
//     banned outcome (tests/reserved-recovered.test.js scans this file).
//   · an em dash in the copy. Jonathan's voice uses periods and "·".
//
// Copy that is load-bearing and must not be edited casually:
//   · "Fundraising Effectiveness Project, full-year 2025." FEP rebased in
//     Q1 2026 and now headlines a QUARTERLY figure — dropping "full-year"
//     would silently change what the number means. The caption moved to the
//     Drift section WITH its dot field; the words are byte-identical.
//   · The hero copy and the card-stops copy are supplied by the BUILD-81
//     spec verbatim. Do not invent claims beyond them.
//
// Semantics rule (new in BUILD-81, asserted by landing-prod-verify): every
// CTA that NAVIGATES is a real <a href> (styled as a button), so cmd-click,
// open-in-new-tab and crawlers all work; <button> is reserved for actions
// on this page (the Calendly modal). No element fakes the other.
//
// The thread visual's names are INVENTED and must not match any donor in
// any fixture or in production ("R. Harmon" is the spec's own invention).

const C = {
  ink:     "#0F1A12",
  cream:   "#F0EDE6",
  cream2:  "#E8E4DB",
  gold:    "#C9A84C",
  greenDk: "#0D5C3A",
  // 5.81:1 on cream2, 6.31:1 on cream — the BUILD-74 headroom decision; the
  // verify floor is 5.0.
  ink3:    "#5A554F",
  sage:    "#8FA896",
};

const CALENDLY_URL   = "https://calendly.com/xjca2006/new-meeting";
const FOUNDER_MAILTO = "mailto:jonathan@stewardapp.dev";

// ── PLACEHOLDERS ────────────────────────────────────────────────────────────
export const PLACEHOLDERS = {
  legalEntity: "[LEGAL ENTITY NAME]", // TODO: the registered entity for the © line
};
const isPlaceholder = v => typeof v === "string" && v.trim().startsWith("[");
function Placeholder({ value }) {
  if (!isPlaceholder(value)) return <>{value}</>;
  const style = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    border: "1px dashed currentColor", borderRadius: 4, color: "inherit",
    letterSpacing: "0.14em", fontSize: 13, fontFamily: "'DM Sans', system-ui, sans-serif",
    padding: "1px 7px", background: "transparent",
  };
  return <span style={style}>{value}</span>;
}

// ── THE THREAD VISUAL — one conversation and the thread that comes off it ──
// Built in code, deterministic. A single line with five knots; each knot a
// dated event in DM Sans small caps; the last knot brass, larger, breathing
// (opacity + transform only, one slow cycle) — and under reduced motion it
// renders at full opacity and stays. role="img" reads the sequence.
const THREAD_KNOTS = [
  { date: "Mar 3",  label: "Coffee with R. Harmon" },
  { date: "Mar 5",  label: "Thank-you sent" },
  { date: "Mar 19", label: "Follow up · called, left message" },
  { date: "Mar 21", label: "Try again" },
  { date: null,     label: "Still open · day 11", open: true },
];

function ThreadVisual() {
  return (
    <div
      role="img"
      className="lt-wrap"
      aria-label="A single conversation and its thread: March 3, coffee with R. Harmon. March 5, thank-you sent. March 19, follow up, called and left a message. March 21, try again. The last knot is still open, day 11."
    >
      <div aria-hidden="true" className="lt-line">
        {THREAD_KNOTS.map((k, i) => (
          <div key={i} className={k.open ? "lt-knot lt-knot-open" : "lt-knot"}>
            <span className={k.open ? "lt-dot lt-dot-open" : "lt-dot"} />
            <span className="lt-label">
              {k.date && <span className="lt-date">{k.date}</span>}
              <span className={k.open ? "lt-text lt-text-open" : "lt-text"}>{k.label}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── THE DONOR FIELD — kept, one render, in the Drift section ───────────────
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
              "--d": `${d.delay}ms`,
              "--b": `${breatheDelay(d.i)}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── HOW IT WORKS — three beats, REAL screenshots of the product ─────────────
// Captured from the demo org by `scripts/build81-capture.js --landing-shots`
// (1440, DPR 2, cropped tight, 1x + 2x webp). Re-capture there when the UI
// changes and paste the printed intrinsic dimensions below — width/height
// keep CLS at 0.0000. Donor names in the shots are the demo file's own
// fiction (the capture skips the Atkinson records).

function CalendlyModal({ onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 400, background: "rgba(15, 26, 18, 0.55)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.cream, borderRadius: 14, width: "100%", maxWidth: 720, height: "min(82vh, 760px)",
        display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 30px 80px rgba(15, 26, 18, 0.35)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid rgba(15,26,18,0.12)" }}>
          <span className="lp-serif" style={{ fontSize: 23, color: C.ink }}>Talk to the founder</span>
          <button onClick={onClose} aria-label="Close" className="lp-focus" style={{ background: "transparent", border: "none", fontSize: 22, color: C.ink3, cursor: "pointer", lineHeight: 1, padding: 8 }}>✕</button>
        </div>
        <iframe title="Schedule time with the founder" src={CALENDLY_URL} style={{ flexGrow: 1, border: "none", width: "100%" }} />
        <div style={{ padding: "10px 20px", fontSize: 13, color: C.ink3, borderTop: "1px solid rgba(15,26,18,0.12)" }}>
          Or write directly: <a href={FOUNDER_MAILTO} style={{ color: C.greenDk, fontWeight: 600 }}>jonathan@stewardapp.dev</a>
        </div>
      </div>
    </div>
  );
}

const STYLES = `
  .lp * { margin: 0; padding: 0; box-sizing: border-box; }
  .lp { background: ${C.cream}; color: ${C.ink}; font-family: 'DM Sans', system-ui, sans-serif; overflow-x: hidden; }
  .lp h1, .lp h2, .lp h3 { margin: 0; font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; }
  .lp-serif { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; }
  .lp a { color: inherit; text-decoration: none; }
  .lp button { font-family: inherit; }

  .lp-focus:focus-visible { outline: 3px solid ${C.gold}; outline-offset: 3px; border-radius: 4px; }

  .lp-nav {
    display: flex; align-items: center; justify-content: space-between;
    height: 86px; padding: 0 48px; max-width: 1440px; margin: 0 auto;
  }
  .lp-navwrap { display: flex; align-items: center; gap: 30px; }
  .lp .lp-navlink {
    background: none; border: none; cursor: pointer; color: ${C.ink};
    font-size: 15px; font-weight: 500; min-height: 44px; display: inline-flex; align-items: center;
  }
  .lp .lp-navbtn {
    background: ${C.ink}; color: ${C.cream}; border: none; cursor: pointer;
    font-size: 15px; font-weight: 600; padding: 12px 22px; border-radius: 8px;
    min-height: 44px; display: inline-flex; align-items: center;
  }

  .lp .lp-btn {
    border: none; cursor: pointer; font-size: 16px; font-weight: 600;
    padding: 16px 28px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center;
    min-height: 52px;
  }
  .lp .lp-btn-ink   { background: ${C.ink}; color: ${C.cream}; }
  .lp .lp-btn-quiet { background: transparent; color: ${C.ink}; border: 1.5px solid rgba(15, 26, 18, 0.35); }
  .lp .lp-btn-gold  { background: ${C.gold}; color: ${C.ink}; }
  .lp .lp-btn-ghost { background: transparent; color: ${C.cream}; border: 1.5px solid rgba(240, 237, 230, 0.4); }

  .lp-hero {
    display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 64px; align-items: center;
    max-width: 1440px; margin: 0 auto; padding: 56px 48px 96px;
  }
  .lp-h1 { }
  .lp-lede { }
  .lp-ctarow { display: flex; gap: 12px; flex-wrap: wrap; }
  .lp-hero-col { display: flex; flex-direction: column; gap: 26px; }

  /* the thread visual */
  .lt-wrap { padding: 12px 0 12px 8px; }
  .lt-line { position: relative; display: flex; flex-direction: column; gap: 34px; padding-left: 22px; }
  .lt-line::before {
    content: ""; position: absolute; left: 5px; top: 8px; bottom: 14px; width: 2px;
    background: rgba(15, 26, 18, 0.7);
  }
  .lt-knot { position: relative; display: flex; align-items: baseline; gap: 14px; }
  .lt-dot {
    position: absolute; left: -22px; top: 3px; width: 12px; height: 12px; border-radius: 50%;
    background: ${C.ink}; display: block;
  }
  .lt-dot-open { width: 18px; height: 18px; left: -25px; top: 0; background: ${C.gold}; opacity: 1; }
  .lt-label { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .lt-date {
    font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
    color: ${C.ink3}; white-space: nowrap;
  }
  .lt-text { font-size: 14px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: ${C.ink}; }
  .lt-text-open { font-size: 17px; color: ${C.ink}; }
  @media (prefers-reduced-motion: no-preference) {
    .lt-dot-open { animation: ltBreathe 4.5s ease-in-out infinite; }
    @keyframes ltBreathe {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%      { opacity: 0.55; transform: scale(0.82); }
    }
  }

  .lp-sec { padding: 96px 48px; }
  .lp-sec-inner { max-width: 1440px; margin: 0 auto; }
  .lp-eyebrow { font-size: 13px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; }
  .lp-h2 { }
  .lp-sechead { display: flex; justify-content: space-between; align-items: flex-end; gap: 40px; flex-wrap: wrap; margin-bottom: 56px; }

  .lp-beats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
  .lp-shot { width: 100%; height: auto; display: block; border-radius: 10px; border: 1px solid rgba(15, 26, 18, 0.12); background: #FFFFFF; }
  .lp-beat { background: ${C.cream}; border: 1px solid rgba(15, 26, 18, 0.1); border-radius: 14px; padding: 26px; display: flex; flex-direction: column; gap: 20px; box-shadow: 0 14px 40px rgba(15, 26, 18, 0.06); }

  .lp-split { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: center; max-width: 1440px; margin: 0 auto; }

  .lp-field-drift { max-width: 620px; }
  .lp-legend { display: flex; align-items: baseline; gap: 18px; flex-wrap: wrap; margin-top: 22px; }

  .lp-map-img { width: 100%; height: auto; border-radius: 12px; border: 1px solid rgba(15, 26, 18, 0.14); box-shadow: 0 22px 56px rgba(15, 26, 18, 0.12); display: block; }

  .lp-strip { max-width: 1440px; margin: 0 auto; display: flex; justify-content: space-between; gap: 40px; flex-wrap: wrap; padding: 0 0; }

  .lp-footer {
    background: ${C.ink}; padding: 34px 48px; display: flex; align-items: center;
    justify-content: space-between; gap: 20px; flex-wrap: wrap;
  }

  /* dot field motion (unchanged BUILD-73 machinery — fail-open) */
  @media (prefers-reduced-motion: no-preference) {
    .df-dot { animation: lpDotIn 0.5s ease-out both; animation-delay: var(--d); }
    .df-drift { animation: lpDotIn 0.5s ease-out both, lpDotGlow 3.8s ease-in-out infinite; animation-delay: var(--d), var(--b); }
    @keyframes lpDotIn { from { opacity: 0; transform: scale(0.4); } to { opacity: 1; transform: scale(1); } }
    @keyframes lpDotGlow { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
    .up { animation: lpUp 0.55s ease-out both; }
    @keyframes lpUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
  }

  @media (max-width: 1080px) {
    .lp-nav { padding: 0 28px; height: 72px; }
    .lp-hero { grid-template-columns: 1fr; gap: 48px; padding: 36px 28px 72px; }
    .lp-sec { padding: 64px 28px; }
    .lp-split { grid-template-columns: 1fr; gap: 44px; }
    .lp-beats { grid-template-columns: 1fr; }
    .lp-h1 { font-size: 54px !important; }
  }
  @media (max-width: 640px) {
    .lp-h1 { font-size: 40px !important; }
    .lp-h2 { font-size: 33px !important; }
    .lp-close-h { font-size: 38px !important; }
    .lp .lp-navlink-hide { display: none; }
    .lp-ctarow { flex-direction: column; align-items: stretch; }
    .lp-ctarow .lp-btn { width: 100%; }
    .lp-sec { padding: 52px 20px; }
    .lp-hero { padding: 24px 20px 56px; }
    .lp-nav { padding: 0 20px; }
    .lp-footer { padding: 28px 20px; }
  }
`;

export default function Landing() {
  const [showCal, setShowCal] = useState(false);

  useEffect(() => {
    document.title = "Steward — Donor CRM for small nonprofits";
    // Brand fonts, non-render-blocking, display=optional (the BUILD-28 CLS
    // lesson: swap reflows the serif hero; blocking spikes FCP).
    if (!document.getElementById("lp-fonts")) {
      const l = document.createElement("link");
      l.id = "lp-fonts"; l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=optional";
      document.head.appendChild(l);
    }
  }, []);

  const talkToFounder = () => setShowCal(true);

  return (
    <>
      <style>{STYLES}</style>
      {showCal && <CalendlyModal onClose={() => setShowCal(false)} />}

      <div className="lp">

        {/* ── NAV ────────────────────────────────────────────────────────── */}
        <nav className="lp-nav">
          <a href="/" className="lp-serif lp-focus" style={{ fontSize: 26, letterSpacing: "-0.01em", display: "inline-flex", alignItems: "center", minHeight: 44 }}>Steward</a>
          <div className="lp-navwrap">
            {/* No Pricing link, deliberately. Price is a conversation, and
                every path on this page ends at Start free or Talk to the
                founder. Navigation is real <a href> — semantics first. */}
            <a href="#how-it-works" className="lp-navlink lp-navlink-hide lp-focus">How it works</a>
            <a href="#your-data" className="lp-navlink lp-navlink-hide lp-focus">Your data</a>
            <a href="/login" className="lp-navlink lp-focus">Log in</a>
            <a href="/signup" className="lp-navbtn lp-focus">Start free</a>
          </div>
        </nav>

        {/* ── HERO — the question ────────────────────────────────────────── */}
        <header className="lp-hero">
          <div className="lp-hero-col">
            <h1 className="up lp-h1" style={{ fontSize: 64, lineHeight: 1.04, letterSpacing: "-0.032em" }}>
              Who did you mean to call back?
            </h1>
            <p className="up lp-lede" style={{ fontSize: 19, lineHeight: 1.6, color: C.ink3, maxWidth: 520, animationDelay: "0.08s" }}>
              Every fundraiser has one. The gala guy. The board member&apos;s friend who said &quot;let&apos;s talk in the spring.&quot; The one who was polite and busy and said nothing at all, so he never made it onto today&apos;s list.
            </p>
            <p className="up" style={{ fontSize: 19, lineHeight: 1.6, color: C.ink, maxWidth: 520, fontWeight: 500, animationDelay: "0.14s" }}>
              Steward writes the conversation down, hands you the next step, and keeps asking until you&apos;ve done it.
            </p>
            <div className="up lp-ctarow" style={{ animationDelay: "0.22s" }}>
              <a href="/signup" className="lp-btn lp-btn-ink lp-focus">Start free</a>
              <button className="lp-btn lp-btn-quiet lp-focus" onClick={talkToFounder}>Talk to the founder</button>
            </div>
            <p className="up" style={{ fontSize: 14, color: C.ink3, lineHeight: 1.7, marginTop: 4, animationDelay: "0.28s" }}>
              No platform fee · no donor tip prompt · gifts settle in your own Stripe
            </p>
          </div>

          <div className="lp-hero-col">
            <ThreadVisual />
          </div>
        </header>

        {/* ── HOW IT WORKS — three beats, the real UI ────────────────────── */}
        <section id="how-it-works" className="lp-sec" style={{ background: C.cream2 }}>
          <div className="lp-sec-inner">
            <div className="lp-sechead">
              <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 760 }}>
                <div className="lp-eyebrow" style={{ color: C.greenDk }}>HOW IT WORKS</div>
                <h2 className="lp-h2" style={{ fontSize: 50, lineHeight: 1.06, letterSpacing: "-0.025em" }}>
                  Log it. The next step comes back. It keeps asking.
                </h2>
              </div>
              <p style={{ fontSize: 16, lineHeight: 1.6, color: C.ink3, maxWidth: 340 }}>
                This is called the Thread: a donor plus an open next step. Never a task you had to remember to create.
              </p>
            </div>
            <div className="lp-beats">
              <article className="lp-beat">
                <img
                  className="lp-shot"
                  src="/hiw-log.webp"
                  srcSet="/hiw-log.webp 1x, /hiw-log-2x.webp 2x"
                  width="454" height="214"
                  alt="The Log a conversation panel on a donor's record: touch-type chips with Call reached selected, and one line typed about the scholarship fund."
                  loading="lazy" decoding="async"
                />
                <div>
                  <h3 className="lp-serif" style={{ fontSize: 24, lineHeight: 1.2, marginBottom: 8 }}>Log it.</h3>
                  <p style={{ fontSize: 15, lineHeight: 1.65, color: C.ink3 }}>
                    One line, from the donor&apos;s record or the home screen. That&apos;s the whole ask.
                  </p>
                </div>
              </article>
              <article className="lp-beat">
                <img
                  className="lp-shot"
                  src="/hiw-nextstep.webp"
                  srcSet="/hiw-nextstep.webp 1x, /hiw-nextstep-2x.webp 2x"
                  width="456" height="108"
                  alt="The next-step prompt in the same flow, prefilled with the default: Follow up, dated seven days out."
                  loading="lazy" decoding="async"
                />
                <div>
                  <h3 className="lp-serif" style={{ fontSize: 24, lineHeight: 1.2, marginBottom: 8 }}>The next step comes back.</h3>
                  <p style={{ fontSize: 15, lineHeight: 1.65, color: C.ink3 }}>
                    Logging the conversation is creating the follow-up. A call reached suggests a follow-up in a week; a meeting, a thank-you note in two days. Your call either way.
                  </p>
                </div>
              </article>
              <article className="lp-beat">
                <img
                  className="lp-shot"
                  src="/hiw-thread.webp"
                  srcSet="/hiw-thread.webp 1x, /hiw-thread-2x.webp 2x"
                  width="760" height="212"
                  alt="The Thread on the home screen: three open conversations with their next steps, the oldest overdue at day 11."
                  loading="lazy" decoding="async"
                />
                <div>
                  <h3 className="lp-serif" style={{ fontSize: 24, lineHeight: 1.2, marginBottom: 8 }}>It keeps asking.</h3>
                  <p style={{ fontSize: 15, lineHeight: 1.65, color: C.ink3 }}>
                    One weekday-morning email with everything due or overdue. The subject line carries the day count, and the count keeps climbing until you&apos;ve done it or said why not.
                  </p>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* ── WHEN A CARD STOPS ──────────────────────────────────────────── */}
        <section className="lp-sec" style={{ background: C.ink }}>
          <div className="lp-sec-inner" style={{ maxWidth: 900 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div className="lp-eyebrow" style={{ color: C.gold }}>WHEN A CARD STOPS</div>
              <h2 className="lp-h2" style={{ fontSize: 46, lineHeight: 1.08, color: C.cream, letterSpacing: "-0.025em" }}>
                A monthly donor&apos;s card expires. Most orgs find out when the deposit is short.
              </h2>
              <p style={{ fontSize: 18, lineHeight: 1.65, color: "rgba(240, 237, 230, 0.75)", maxWidth: 700 }}>
                Steward catches it within the hour and emails the donor a link to keep going, in your name. The donor never logs in to anything.
              </p>
              <p style={{ fontSize: 16, lineHeight: 1.6, color: C.sage, maxWidth: 700 }}>
                You know what four fifty-dollar sustainers a month are worth to you by December.
              </p>
            </div>
          </div>
        </section>

        {/* ── DRIFT — the dot field, as evidence ─────────────────────────── */}
        <section id="drift" className="lp-sec" style={{ background: C.cream }}>
          <div className="lp-split">
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div className="lp-eyebrow" style={{ color: C.greenDk }}>DRIFT</div>
              <h2 className="lp-h2" style={{ fontSize: 50, lineHeight: 1.06, letterSpacing: "-0.025em" }}>
                And the ones who already went quiet.
              </h2>
              <p style={{ fontSize: 18, lineHeight: 1.65, color: C.ink3, maxWidth: 480 }}>
                The Thread keeps the conversations you&apos;re having. Drift finds the people you&apos;ve stopped hearing from: each one named, with the reason in their own pattern. &quot;$2,000 every July since 2019. Nothing for 14 months.&quot; That is the window where a phone call still works, and it closes quietly.
              </p>
            </div>
            <div>
              <DonorField
                count={DRIFT_COUNTS.hero}
                size={16}
                gap={10}
                className="lp-field-drift"
                label={`A field of ${FIELD_SIZE} dots, one for each of the donors who carry 90% of a typical file's revenue. ${DRIFT_COUNTS.hero} of them are gold, marking the donors expected to go quiet over a year.`}
              />
              <div className="lp-legend">
                <span style={{ fontSize: 14, color: C.ink3 }}>{STEADY_COUNT} steady</span>
                <span style={{ fontSize: 14, color: C.ink3 }}>{DRIFT_COUNTS.hero} drifting</span>
                <span style={{ flexGrow: 1 }} />
                <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span className="lp-serif" style={{ fontSize: 30, letterSpacing: "-0.02em" }}>$360,144</span>
                  <span style={{ fontSize: 14, color: C.ink3 }}>walking out</span>
                </span>
              </div>
              {/* Load-bearing caption — byte-identical to BUILD-73/74. */}
              <p style={{ fontSize: 14, color: C.ink3, lineHeight: 1.6, marginTop: 14 }}>
                Distribution and lapse rate from the Fundraising Effectiveness Project, full-year 2025, applied to a 1,000-donor file.
              </p>
            </div>
          </div>
        </section>

        {/* ── THE RECORD — the credential, and the one surprise ──────────── */}
        <section className="lp-sec" style={{ background: C.cream2 }}>
          <div className="lp-split">
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div className="lp-eyebrow" style={{ color: C.greenDk }}>THE RECORD</div>
              <h2 className="lp-h2" style={{ fontSize: 46, lineHeight: 1.08, letterSpacing: "-0.025em" }}>
                Built with a development director who has done this for twenty years.
              </h2>
              <p style={{ fontSize: 18, lineHeight: 1.65, color: C.ink3, maxWidth: 480 }}>
                He said what he&apos;d want on a donor&apos;s record, and that&apos;s what&apos;s there.
              </p>
            </div>
            <div>
              <img
                className="lp-map-img"
                src="/donor-map-shot.webp"
                srcSet="/donor-map-shot.webp 1x, /donor-map-shot-2x.webp 2x"
                width="1200" height="760"
                alt="The donor map: every donor on a map of the country, sized by giving."
                loading="lazy" decoding="async"
              />
              <p style={{ fontSize: 13, color: C.ink3, marginTop: 10 }}>
                The donor map, from the sample file. Nobody expects their file drawn on a map. Map data © OpenStreetMap contributors.
              </p>
            </div>
          </div>
        </section>

        {/* ── YOUR DATA — four sentences, all true ───────────────────────── */}
        <section id="your-data" className="lp-sec" style={{ background: C.cream }}>
          <div className="lp-sec-inner" style={{ maxWidth: 820 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div className="lp-eyebrow" style={{ color: C.greenDk }}>YOUR DATA</div>
              <h2 className="lp-h2" style={{ fontSize: 44, lineHeight: 1.08, letterSpacing: "-0.025em" }}>
                Yours, plainly.
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 17, lineHeight: 1.65, color: C.ink3 }}>
                <p>Your donor records live in Steward&apos;s database, scoped to your organization; no other organization on Steward can read them.</p>
                <p>Only your signed-in staff can see your donors, and payments settle in your own Stripe account.</p>
                <p>You can export everything as CSV any time, with one click, even if your subscription has lapsed.</p>
                <p>If you leave, you take the export with you and we delete the rest on request. That is the whole procedure.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── CLOSING ────────────────────────────────────────────────────── */}
        <section className="lp-sec" style={{ background: C.ink, paddingTop: 110, paddingBottom: 110 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, textAlign: "center" }}>
            <h2 className="lp-close-h" style={{ fontSize: 58, lineHeight: 1.05, color: C.cream, letterSpacing: "-0.03em", maxWidth: 820 }}>
              Start with one conversation.
            </h2>
            <p style={{ fontSize: 19, lineHeight: 1.55, color: "rgba(240, 237, 230, 0.72)", maxWidth: 540 }}>
              Import a CSV, log one call, and watch the next step come back to you. About ten minutes, and no card.
            </p>
            <div className="lp-ctarow" style={{ justifyContent: "center", gap: 14, marginTop: 12 }}>
              <a href="/signup" className="lp-btn lp-btn-gold lp-focus">Start free</a>
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

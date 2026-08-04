import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

// ── Landing (BUILD-07 rebuild, 2026-07-17; product shots → DOM, BUILD-12) ───
// Register: warm-serious, book-set, five-color palette only. Every number and
// capability on this page is cross-checked against CLAUDE.md reality — no
// invented testimonials, no implied scale, no marketing verbs.
// PRODUCT VISUALS ARE LIVE DOM/SVG, NOT RASTER SCREENSHOTS (BUILD-12). Three
// raster "fixes" couldn't beat retina blur because this is a Vite static app
// (no image optimizer) serving downscaled bitmaps of antialiased UI text,
// which resample soft at every non-integer DPR. The shots below are the real
// component markup with real / clearly-sample-labeled values (see the shot
// components + CLAUDE.md's "Landing product shots" note). Do NOT reintroduce
// <img> screenshots for these; crispness is now structural.

const C = {
  ink:    "#0f1a12",
  dark2:  "#1a2e1f",
  dark3:  "#2d4a35",
  cream:  "#f0ede6",
  cream2: "#e8e4db",
  cream3: "#ddd9d0",
  white:  "#ffffff",
  gold:   "#c9a84c",
  terra:  "#b8593f",
  sage:   "#8fa896",
  greenDk:"#0d5c3a",
  greenMd:"#1a6b4a",
  ink3:   "#6b6560",
};

const CALENDLY_URL = "https://calendly.com/xjca2006/new-meeting";
const FOUNDER_MAILTO = "mailto:jonathan@stewardapp.dev";

// ── BUILD-28: image-forward, nonprofit-native landing ────────────────────────
// The page's top third is photography + words; the DOM product shots (BUILD-12,
// still live/vector — never rasterized) are demoted below the calculator as
// proof. The hero photo is ILLUSTRATIVE arts/community work, NOT a Steward
// customer — never captioned as one. All photography is free-tier Unsplash;
// provenance + license is recorded in client/public/ASSETS.md.
//
// Hero image is a ONE-LINE swap: change HERO_SRC (the responsive WebP set lives
// at `${HERO_SRC}-{960,1280,1920,2560}.webp` + the index.html preload). The
// scrim is a FLAT rgba wash, never a gradient (gradients are banned).
const HERO_SRC = "/hero-choir";

// "Built for orgs like yours" — the who-it's-for band. Each vertical named in
// its own language. A slot with no cleared photo ships a graceful on-palette
// fallback (Rescue is blocked on a clean licensed file; Faith awaits one).
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
    pos: "center 60%", // portrait source — keep the lit chapel in the landscape crop
  },
];

// ── Interactive wedge (BUILD-11 Build B) ────────────────────────────────────
// The 20–30% of recurring giving lost to failed cards, made visceral with
// HONEST math the visitor drives themselves: annual involuntary loss =
// monthly recurring × 12 × 24% (midpoint of the industry 20–30% range, shown).
// Client-side only, no backend, no invented recovery figure — the point is
// the size of the leak, not a flattering promise.
const CHURN_RATE = 0.24; // midpoint of the industry 20–30% involuntary-churn range
const fmtMoney = n => "$" + Math.round(n).toLocaleString();

function RecoveryCalculator() {
  const [monthly, setMonthly] = useState(1500);
  const annualLoss = monthly * 12 * CHURN_RATE;
  return (
    <div className="lp-calc">
      <div className="lp-calc-copy">
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.14em", color: C.terra, marginBottom: 16 }}>Do the math</div>
        <h2 className="lp-serif" style={{ fontSize: "clamp(28px, 3vw, 40px)", color: C.ink, lineHeight: 1.15, marginBottom: 18 }}>
          What are you leaving on the table?
        </h2>
        <p style={{ fontSize: 16, color: "#2d2d2d", lineHeight: 1.8 }}>
          Recurring donors don't quit — their cards expire. The charge fails at
          2 a.m., no one is watching, and the gift just stops. Move the slider to
          your monthly recurring giving and see the quiet annual leak.
        </p>
      </div>
      <div className="lp-calc-card">
        <label style={{ fontSize: 13, fontWeight: 700, color: C.ink3, display: "block", marginBottom: 10 }}>Your monthly recurring giving</label>
        <div className="lp-serif" style={{ fontSize: 34, color: C.ink, marginBottom: 14 }}>{fmtMoney(monthly)}<span style={{ fontSize: 16, color: C.ink3 }}> / month</span></div>
        <input type="range" min={200} max={20000} step={100} value={monthly}
          onChange={e => setMonthly(Number(e.target.value))} className="lp-slider"
          aria-label="Monthly recurring giving" />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.ink3, marginTop: 6, marginBottom: 22 }}>
          <span>$200</span><span>$20,000</span>
        </div>
        <div style={{ background: C.cream, border: `1px solid ${C.cream3}`, borderLeft: `3px solid ${C.terra}`, borderRadius: 12, padding: "18px 20px", marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.ink3, marginBottom: 6 }}>Silently lost each year</div>
          <div className="lp-calc-loss lp-serif" style={{ fontSize: "clamp(34px, 4.5vw, 46px)", color: C.terra, lineHeight: 1 }}>{fmtMoney(annualLoss)}</div>
          <div style={{ fontSize: 13, color: "#2d2d2d", lineHeight: 1.6, marginTop: 8 }}>
            from donors who never decided to stop giving.
          </div>
        </div>
        <div style={{ fontSize: 14, color: C.greenDk, fontWeight: 600, lineHeight: 1.6 }}>
          ↳ Steward's whole job here: catch each failed card within the hour and
          win the gift back — in your name, no login for the donor.
        </div>
        <p style={{ fontSize: 11.5, color: C.ink3, marginTop: 16, lineHeight: 1.6 }}>
          Assumes 24% annual involuntary churn — the midpoint of the widely-cited
          20–30% range for recurring-gift card failures. How much comes back
          depends on your donors; Steward pursues every dollar of it.
        </p>
      </div>
    </div>
  );
}

// ── Product shots as LIVE DOM, not raster screenshots (BUILD-12) ────────────
// Three raster "fixes" (BUILD-08 → BUILD-10 Part 2 → BUILD-11) could not make
// captured UI text crisp on retina: this is a Vite STATIC app (no Vercel/Next
// image optimizer), so prod serves the committed WebP bytes verbatim — the
// blur was never CDN re-encoding, it was raster-of-text softness. A downscaled
// bitmap of antialiased text resamples soft at every non-integer DPR ratio;
// only vector text is pixel-crisp at every DPR. So the product visuals below
// are the real component markup with real / clearly-sample-labeled values —
// built to match the crisp "DO THE MATH" calculator card exactly (styled
// HTML/CSS in-page, real type, Steward palette, soft elevation). They cannot
// blur, they weigh almost nothing, and they can't drift from what ships.
// DO NOT convert these back into <img> screenshots. See CLAUDE.md.

const PencilIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.sage} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </svg>
);

const GoalStat = ({ label, value, valueColor, sub }) => (
  <div className="lp-goalstat">
    <div className="lp-goalstat-l">{label}</div>
    <div className="lp-goalstat-v" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
    {sub && <div className="lp-goalstat-s">{sub}</div>}
  </div>
);

const RetChip = ({ name, amt }) => (
  <span className="lp-retchip"><b>{name}</b> <span style={{ color: C.ink3 }}>{amt}</span></span>
);

// The hero: the home screen's goal banner + retention card, exactly as the
// product renders them (Dashboard.jsx). Values are the demo org's real numbers
// (goal 22% of $25,000, retention 33% vs the 43% sector average). The one
// deliberate motion — the goal bar filling to its true 22% — is now a REAL
// CSS bar animating its own width, not an overlay faked onto a screenshot.
// A single restrained product signal floated over the hero photo (BUILD-29).
// DOM/vector only (never raster — the crispness guards apply). It reuses the
// BUILD-12 goal-thermometer language so a first-time visitor instantly reads
// "fundraising software," resolving the "is this an arts org?" ambiguity. It's
// a signal, not a demo — one card, decorative (aria-hidden).
function HeroFloatCard() {
  return (
    <div className="lp-hero-card" aria-hidden="true">
      <div className="lp-hcard-eyebrow">Fundraising Goal</div>
      <div className="lp-hcard-label">Raise $25,000 this quarter</div>
      <div className="lp-hcard-row">
        <span className="lp-serif lp-hcard-pct">22%</span>
        <span className="lp-hcard-sub">of goal reached</span>
      </div>
      <div className="lp-hcard-track"><div className="lp-hcard-fill" /></div>
      <div className="lp-hcard-foot">
        <strong className="lp-serif">$5,501</strong> of $25,000 · 53 days left
      </div>
    </div>
  );
}

function HeroShot() {
  return (
    <div className="lp-hero-shot">
      <div className="lp-goalcard">
        <div className="lp-goal-cols">
          <div style={{ flex: "2 1 240px", minWidth: 0 }}>
            <div className="lp-goal-eyebrow">Fundraising Goal</div>
            <div className="lp-goal-label">Raise $25,000 this quarter <PencilIcon /></div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "2px 0 12px" }}>
              <div className="lp-serif lp-goal-pct">22%</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.sage }}>of goal reached</div>
            </div>
            <div className="lp-goal-track"><div className="lp-goal-fill" /></div>
            <div style={{ fontSize: 13, color: "#c9c2b4", marginTop: 10 }}>
              <strong className="lp-serif" style={{ fontSize: 15, color: C.gold, fontWeight: 400 }}>$5,501</strong> of $25,000
            </div>
          </div>
          <div style={{ flex: "1 1 180px", minWidth: 160, display: "flex", flexDirection: "column", gap: 9 }}>
            <GoalStat label="Pace" value="Behind pace" valueColor={C.terra} sub="18pt behind schedule" />
            <GoalStat label="Time Left" value="53 days" sub="left to reach this goal" />
            <GoalStat label="This Week" value="1 donor gave this week" sub="recent momentum" />
          </div>
        </div>
      </div>

      <div className="lp-scope">
        <span style={{ fontSize: 11, color: C.ink3 }}>Showing:</span>
        <div className="lp-scope-toggle">
          <span className="lp-scope-on">My donors</span>
          <span className="lp-scope-off">Whole org</span>
        </div>
      </div>

      <div className="lp-retcard">
        <div className="lp-goalstat-l" style={{ color: C.ink3 }}>Donor Retention Rate</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
          <div className="lp-serif" style={{ fontSize: 32, fontWeight: 400, color: C.terra, lineHeight: 1 }}>33%</div>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.ink3 }}>No change vs 3 weeks ago</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#3a3a3a", marginTop: 6, lineHeight: 1.4, maxWidth: 380 }}>
          10pt below the 43% sector average — worth a closer look at who isn't renewing.
        </div>
        <div className="lp-ret-chips">
          <RetChip name="Vanessa Cole" amt="$3,000" />
          <RetChip name="Sunrise Foundati…" amt="$25,000" />
          <RetChip name="Diana Torres" amt="$250" />
          <span className="lp-ret-more">+3 more →</span>
        </div>
      </div>
    </div>
  );
}

// "Needs Your Attention" queue rows — the real home-screen queue (Dashboard.jsx).
// Sample donors, clearly demo. tone → the product's real row color: task = ink,
// note (personal-note nudge) = deep green, milestone/lapsed (AI draft) = gold.
const QUEUE_ROWS = [
  { initial: "M", name: "Margaret Chen", tone: "task", reason: 'Task: "Call Margaret Chen — major gift conversation"', action: "Mark done ✓" },
  { initial: "J", name: "James Okafor", tone: "task", reason: 'Task: "Re-engage James Okafor (lapsed 18mo)"', action: "Mark done ✓" },
  { initial: "J", name: "Julian Marsh", tone: "note", bullets: [
      "This marks their 2-year anniversary with your organization.",
      'From their file: "Consistent annual donor, due for this year’s ask conversation."',
      "Most recent gift: $5,000 on February 12, 2026.",
    ], action: "Mark sent ✓" },
  { initial: "E", name: "Elena Marchetti", tone: "note", bullets: [
      "Just crossed $10,000 in total lifetime giving ($12,500 total).",
      'From their file: "Just crossed $10,000 lifetime giving. High-touch relationship, board-adjacent."',
      "They’ve been giving for 2 years — since October 2023.",
    ], action: "Mark sent ✓" },
  { initial: "S", name: "Sunrise Foundation", tone: "milestone", reason: "Flagged today — AI-drafted re-engagement email ready for review", action: "Review draft →" },
  { initial: "R", name: "Robert & Lisa Atkinson", tone: "milestone", reason: "Flagged today — AI-drafted re-engagement email ready for review", action: "Review draft →" },
];
const TONE_COLOR = { task: C.ink, note: C.greenDk, milestone: C.gold };

function QueueRow({ r, last }) {
  const color = TONE_COLOR[r.tone];
  const btnText = r.tone === "milestone" ? C.ink : "#fff";
  return (
    <div className="lp-qrow" style={{ borderLeft: `3px solid ${color}`, borderBottom: last ? "none" : `1px solid ${C.cream2}` }}>
      <div className="lp-qav" style={{ background: color + "22", color }}>{r.initial}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{r.name}</div>
        {r.bullets ? (
          <ul style={{ margin: "4px 0 0", padding: "0 0 0 16px", fontSize: 12, color: C.ink3, lineHeight: 1.5 }}>
            {r.bullets.map((b, i) => <li key={i} style={{ marginBottom: 2 }}>{b}</li>)}
          </ul>
        ) : (
          <div style={{ fontSize: 12, color: C.ink3, marginTop: 2, lineHeight: 1.4 }}>{r.reason}</div>
        )}
      </div>
      <span className="lp-qbtn" style={{ background: color, color: btnText }}>{r.action}</span>
    </div>
  );
}

function QueueShot({ rows = QUEUE_ROWS, header = true }) {
  return (
    <div className="lp-qcard">
      {header && (
        <div className="lp-qhead">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="lp-goalstat-l" style={{ color: C.ink, fontSize: 11 }}>Needs Your Attention</span>
            <span className="lp-qmine">Mine</span>
          </span>
          <span style={{ fontSize: 11, color: C.ink3 }}>{rows.length} items</span>
        </div>
      )}
      {rows.map((r, i) => <QueueRow key={i} r={r} last={i === rows.length - 1} />)}
    </div>
  );
}

// Three compact queue rows for the "How it works" step — single-line reasons.
const ATTENTION_ROWS = [
  { initial: "S", name: "Sunrise Foundation", tone: "milestone", reason: "Flagged today — re-engagement draft ready", action: "Review →" },
  { initial: "J", name: "Julian Marsh", tone: "note", reason: "2-year anniversary — time for a personal note", action: "Mark sent ✓" },
  { initial: "M", name: "Margaret Chen", tone: "task", reason: 'Task: "Call — major gift conversation"', action: "Mark done ✓" },
];

// The tax receipt, as the product's receipt renderer lays it out (server.js
// renderReceiptPdf) — the same green header, EIN line, gift row, and the IRS
// "no goods or services" line. Sample values (the live /receipts/preview data).
function ReceiptShot() {
  return (
    <div className="lp-receipt">
      <div className="lp-receipt-head">
        <div className="lp-receipt-kicker">Donation Receipt</div>
        <div className="lp-receipt-org">CREO Arts</div>
        <div className="lp-receipt-ein">EIN: 47-1234567</div>
      </div>
      <div className="lp-receipt-body">
        <div className="lp-receipt-meta">
          <span>Receipt #2026-PREVIEW</span>
          <span>Issued July 18, 2026</span>
        </div>
        <div className="lp-receipt-donor">Jordan Sample</div>
        <div className="lp-receipt-addr">123 Main St, Anytown, ST 00000</div>
        <div className="lp-receipt-grid">
          <div><div className="lp-receipt-k">Gift Date</div><div className="lp-receipt-v">July 18, 2026</div></div>
          <div><div className="lp-receipt-k">Amount</div><div className="lp-receipt-v" style={{ color: C.greenMd }}>$250.00</div></div>
          <div><div className="lp-receipt-k">Payment Method</div><div className="lp-receipt-v">Credit Card</div></div>
        </div>
        <div className="lp-receipt-note">No goods or services were provided in exchange for this contribution.</div>
      </div>
    </div>
  );
}

// How-it-works step 1: the CSV column-mapping the importer does automatically.
function ImportShot() {
  const maps = [
    ["name", "Donor name"],
    ["email", "Email"],
    ["last_gift", "Last gift amount"],
    ["city", "City"],
  ];
  return (
    <div className="lp-import">
      <div className="lp-import-head">
        <span className="lp-goalstat-l" style={{ color: C.ink, fontSize: 11 }}>Import donors</span>
        <span style={{ fontSize: 11, color: C.ink3 }}>donors.csv · 24 rows</span>
      </div>
      <div className="lp-import-body">
        {maps.map(([csv, field]) => (
          <div key={csv} className="lp-import-row">
            <span className="lp-import-csv">{csv}</span>
            <span className="lp-import-arrow">→</span>
            <span className="lp-import-field">{field}</span>
            <span className="lp-import-ok">✓</span>
          </div>
        ))}
        <div className="lp-import-foot">24 donors ready · stages auto-assigned</div>
      </div>
    </div>
  );
}

// How-it-works step 3: the compact goal-progress the numbers climb toward.
function ClimbShot() {
  return (
    <div className="lp-climb">
      <div className="lp-goal-eyebrow">Fundraising Goal</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "6px 0 10px" }}>
        <span className="lp-serif" style={{ fontSize: 42, color: C.gold, lineHeight: 1 }}>22%</span>
        <span style={{ fontSize: 12, color: C.sage }}>of goal reached</span>
      </div>
      <div className="lp-goal-track"><div className="lp-goal-fill lp-goal-fill-static" /></div>
      <div style={{ fontSize: 12, color: "#c9c2b4", marginTop: 8 }}>
        <strong className="lp-serif" style={{ color: C.gold, fontWeight: 400 }}>$5,501</strong> of $25,000
      </div>
    </div>
  );
}

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
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 500, background: "rgba(15,26,18,0.6)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "40px 16px", overflowY: "auto",
      }}
    >
      <div style={{
        background: C.cream, borderRadius: 18, width: "100%", maxWidth: 680,
        boxShadow: "0 24px 80px rgba(0,0,0,0.25)", border: `1px solid ${C.cream3}`, overflow: "hidden",
      }}>
        <div style={{ padding: "22px 26px 0", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 23, color: C.ink }}>
            Pick a time — it's me you'll be talking to
          </span>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 22, color: C.ink3, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div style={{ padding: "4px 26px 0", fontSize: 13, color: C.ink3 }}>
          Or just write: <a href={FOUNDER_MAILTO} style={{ color: C.greenDk, textDecoration: "underline", textUnderlineOffset: 3 }}>jonathan@stewardapp.dev</a>
        </div>
        <div className="calendly-inline-widget" data-url={CALENDLY_URL} style={{ minWidth: 320, height: 640 }} />
      </div>
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const [showCal, setShowCal] = useState(false);

  useEffect(() => {
    document.body.style.overflow = showCal ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [showCal]);

  // Premium scroll reveals (BUILD-29). Each `.lp-reveal` section fades + rises
  // once as it enters view. prefers-reduced-motion (or no IntersectionObserver)
  // reveals everything immediately — the no-motion path is non-negotiable.
  useEffect(() => {
    const els = Array.from(document.querySelectorAll(".lp-reveal"));
    if (!els.length) return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      els.forEach(el => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver((entries, obs) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add("is-visible"); obs.unobserve(e.target); }
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  const GoldBtn = ({ children, onClick, big }) => (
    <button onClick={onClick} className="lp-goldbtn" style={{
      background: C.gold, color: C.ink, border: "none",
      padding: big ? "15px 32px" : "13px 26px", borderRadius: 10,
      fontSize: big ? 16 : 15, fontWeight: 700, cursor: "pointer",
      fontFamily: "'DM Sans',sans-serif", letterSpacing: "0.01em",
    }}>{children}</button>
  );
  const QuietBtn = ({ children, onClick, big, onDark }) => (
    <button onClick={onClick} className="lp-quietbtn" style={{
      background: "transparent", color: onDark ? C.cream : C.ink,
      border: `1.5px solid ${onDark ? C.dark3 : C.cream3}`,
      padding: big ? "14px 30px" : "12px 24px", borderRadius: 10,
      fontSize: big ? 16 : 15, fontWeight: 600, cursor: "pointer",
      fontFamily: "'DM Sans',sans-serif",
    }}>{children}</button>
  );
  const Eyebrow = ({ children, onDark }) => (
    <div style={{
      fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.14em",
      color: onDark ? C.gold : C.greenDk, marginBottom: 16, fontFamily: "'DM Sans',sans-serif",
    }}>{children}</div>
  );

  return (
    <>
      {/* Fonts: injected here (non-render-blocking, so first paint stays fast)
          with display=OPTIONAL — the brand serif never swaps in mid-load, so the
          hero headline never reflows (CLS≈0). preconnects live in index.html. */}
      <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@400;500;600;700;800&display=optional" rel="stylesheet" />
      <style>{`
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { background: ${C.cream}; overflow-x: hidden; }
        /* index.html carries an inline body background (#030712, the app's
           dark pre-paint) — inline style beats any stylesheet, so the page
           ground must live on .lp itself. */
        .lp { background: ${C.cream}; font-family: 'DM Sans', sans-serif; color: ${C.ink}; line-height: 1.65; overflow-x: hidden; min-height: 100vh; }
        .lp a { text-decoration: none; color: inherit; }
        .lp ::selection { background: ${C.greenDk}22; }
        .lp-serif { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; letter-spacing: -0.02em; }
        .lp-goldbtn { transition: transform .12s ease, box-shadow .12s ease; box-shadow: 0 2px 14px rgba(201,168,76,0.35); }
        .lp-goldbtn:hover { transform: translateY(-1px); box-shadow: 0 6px 22px rgba(201,168,76,0.45); }
        .lp-quietbtn { transition: border-color .15s, background .15s; }
        .lp-quietbtn:hover { border-color: ${C.gold}; }
        .lp-navlink { font-size: 14px; color: ${C.ink3}; transition: color .15s; }
        .lp-navlink:hover { color: ${C.ink}; }

        /* ── BUILD-28: image-forward hero. Full-bleed photo + a FLAT rgba
           scrim (never a gradient). Headline sits over the dark, quiet
           upper-left; the choir reads center/right. object-position keeps
           the quiet area behind the type at every breakpoint. ── */
        .lp-hero-photo { position: relative; min-height: min(90vh, 760px); display: flex; align-items: flex-start; overflow: hidden; background: ${C.ink}; }
        .lp-hero-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 60% 30%; z-index: 0; }
        .lp-hero-scrim { position: absolute; inset: 0; background: rgba(15,26,18,0.60); z-index: 1; }
        .lp-hero-content { position: relative; z-index: 2; width: 100%; max-width: 1140px; margin: 0 auto; padding: clamp(76px, 13vh, 150px) 64px 72px; }
        .lp-hero-copy { max-width: 620px; }
        .lp-hero-trust { font-size: 13px; color: rgba(240,237,230,0.72); }

        /* ── BUILD-29: the single floated product card (see HeroFloatCard).
           White card + real elevation over the lower-right of the photo. Shown
           only ≥1140px, where it clears the upper-left copy at every width;
           hidden below so it never crowds the type (mobile: dropped entirely). */
        .lp-hero-card {
          position: absolute; z-index: 3;
          right: clamp(28px, 5vw, 88px); bottom: clamp(40px, 8vh, 76px);
          width: 320px;
          background: ${C.white}; border: 1px solid rgba(255,255,255,0.55);
          border-radius: 16px; padding: 18px 20px;
          box-shadow: 0 34px 74px rgba(15,26,18,0.42), 0 8px 22px rgba(15,26,18,0.28);
        }
        .lp-hcard-eyebrow { font-size: 9.5px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: ${C.greenDk}; margin-bottom: 6px; }
        .lp-hcard-label { font-size: 14px; font-weight: 700; color: ${C.ink}; margin-bottom: 8px; }
        .lp-hcard-row { display: flex; align-items: baseline; gap: 9px; margin-bottom: 11px; }
        .lp-hcard-pct { font-size: 40px; font-weight: 400; color: ${C.gold}; line-height: 1; }
        .lp-hcard-sub { font-size: 12px; font-weight: 600; color: ${C.ink3}; }
        .lp-hcard-track { background: ${C.cream2}; border-radius: 99px; height: 9px; overflow: hidden; }
        .lp-hcard-fill { height: 100%; width: 22%; background: ${C.gold}; border-radius: 99px; animation: lpFill 1.5s ease-out both; }
        .lp-hcard-foot { font-size: 12px; color: ${C.ink3}; margin-top: 10px; }
        .lp-hcard-foot strong { font-size: 14px; color: ${C.gold}; font-weight: 400; }
        @media (max-width: 1139px) { .lp-hero-card { display: none; } }

        /* ── BUILD-29: premium scroll reveals. Fade + a small rise as a section
           enters view — fast + subtle (~380ms / 16px, ease-out). Opacity and
           transform only, so there is ZERO layout shift (CLS unaffected). The
           reduced-motion block below renders everything immediately. */
        .lp-reveal { opacity: 0; transform: translateY(16px); transition: opacity .38s ease-out, transform .38s ease-out; }
        .lp-reveal.is-visible { opacity: 1; transform: none; }

        /* Verticals band — "this is a tool for you" */
        .lp-vert-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; }
        .lp-vert-card { background: ${C.white}; border: 1px solid ${C.cream3}; border-radius: 14px; overflow: hidden; box-shadow: 0 12px 36px rgba(15,26,18,0.08); display: flex; flex-direction: column; }
        .lp-vert-media, .lp-vert-fallback { height: 220px; width: 100%; }
        .lp-vert-media { object-fit: cover; display: block; background: ${C.cream2}; }
        .lp-vert-fallback { background: ${C.cream2}; display: flex; align-items: center; justify-content: center; }
        .lp-vert-rule { width: 46px; height: 3px; border-radius: 2px; background: ${C.gold}; opacity: 0.85; }
        .lp-vert-body { padding: 22px 24px 26px; flex: 1; }

        /* Product proof — the real home screen, framed as evidence */
        .lp-proof { max-width: 720px; margin: 0 auto; }

        .lp-hero-grid { display: grid; grid-template-columns: 1.02fr 1fr; gap: 60px; align-items: center; }

        /* Browser-window chrome around the hero product shot — makes the live
           DOM home screen read like a real app, not markup floating on beige.
           The one deliberate motion on the page (the goal bar filling to its
           true 22%) is now a real CSS bar animating its own width; see
           .lp-goal-fill below. Gone under prefers-reduced-motion. */
        .lp-frame { border-radius: 14px; overflow: hidden; background: ${C.white}; border: 1px solid ${C.cream3}; box-shadow: 0 30px 80px rgba(15,26,18,0.20), 0 6px 22px rgba(15,26,18,0.10); }
        .lp-frame-bar { height: 36px; display: flex; align-items: center; gap: 7px; padding: 0 14px; background: ${C.cream2}; border-bottom: 1px solid ${C.cream3}; }
        .lp-frame-dot { width: 10px; height: 10px; border-radius: 50%; }
        .lp-frame-url { margin-left: 12px; font-size: 11px; color: ${C.ink3}; background: ${C.white}; border: 1px solid ${C.cream3}; border-radius: 6px; padding: 3px 12px; letter-spacing: 0.02em; }
        /* The hero product shot is now LIVE DOM inside the window chrome —
           the home screen's goal banner + retention card, on the app's own
           cream ground, rendered as real markup (crisp at every DPR). */
        .lp-shot-wrap { background: #e9e5dc; padding: 18px; }
        .lp-hero-shot { display: flex; flex-direction: column; gap: 12px; }
        .lp-goalcard { background: linear-gradient(135deg, #0f1a12, #152420); border: 1px solid #1a2e1f; border-radius: 14px; padding: 20px 22px; color: ${C.cream}; }
        .lp-goal-cols { display: flex; gap: 24px; flex-wrap: wrap; }
        .lp-goal-eyebrow { font-size: 10px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: ${C.sage}; margin-bottom: 5px; }
        .lp-goal-label { font-size: 15px; font-weight: 600; color: #c9c2b4; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
        .lp-goal-pct { font-size: 52px; font-weight: 400; color: ${C.gold}; line-height: 1; }
        .lp-goal-track { background: #0a120c; border-radius: 99px; height: 11px; overflow: hidden; }
        .lp-goal-fill { height: 100%; width: 22%; background: ${C.gold}; border-radius: 99px; animation: lpFill 1.5s ease-out both; }
        .lp-goal-fill-static { animation: none; }
        @keyframes lpFill { from { width: 0 } to { width: 22% } }
        .lp-goalstat { background: rgba(255,255,255,0.04); border: 1px solid #1a2e1f; border-radius: 10px; padding: 9px 13px; }
        .lp-goalstat-l { font-size: 9px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: ${C.sage}; margin-bottom: 4px; }
        .lp-goalstat-v { font-size: 14px; font-weight: 700; color: ${C.cream}; line-height: 1.3; }
        .lp-goalstat-s { font-size: 11px; color: ${C.sage}; margin-top: 2px; }
        .lp-scope { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
        .lp-scope-toggle { display: flex; background: #ddd9d0; border-radius: 99px; padding: 2px; }
        .lp-scope-on { background: ${C.white}; border-radius: 99px; padding: 4px 13px; font-size: 12px; font-weight: 700; color: ${C.ink}; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .lp-scope-off { padding: 4px 13px; font-size: 12px; font-weight: 700; color: ${C.ink3}; }
        .lp-retcard { background: ${C.white}; border: 1px solid ${C.cream3}; border-radius: 14px; padding: 18px 22px; }
        .lp-ret-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
        .lp-retchip { font-size: 12px; color: ${C.ink}; background: ${C.cream}; border: 1px solid ${C.cream3}; border-radius: 99px; padding: 5px 11px; }
        .lp-ret-more { font-size: 12px; font-weight: 600; color: ${C.greenDk}; border: 1px dashed ${C.cream3}; border-radius: 99px; padding: 5px 11px; }

        /* Queue card (the morning queue + the how-it-works attention step) */
        .lp-qcard { background: ${C.white}; border: 1px solid ${C.cream3}; border-radius: 14px; overflow: hidden; box-shadow: 0 16px 48px rgba(15,26,18,0.12); }
        .lp-qhead { display: flex; justify-content: space-between; align-items: center; padding: 15px 20px; border-bottom: 1px solid ${C.cream2}; }
        .lp-qmine { font-size: 9px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: ${C.greenDk}; background: ${C.greenDk}12; padding: 2px 7px; border-radius: 99px; }
        .lp-qrow { display: flex; align-items: flex-start; gap: 13px; padding: 13px 18px; }
        .lp-qav { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 800; flex-shrink: 0; }
        .lp-qbtn { border-radius: 8px; padding: 8px 13px; font-size: 12px; font-weight: 700; white-space: nowrap; flex-shrink: 0; align-self: center; }

        /* Receipt (the product's receipt renderer, as DOM) */
        .lp-receipt { background: ${C.white}; border: 1px solid ${C.cream3}; border-radius: 12px; overflow: hidden; box-shadow: 0 16px 48px rgba(15,26,18,0.12); }
        .lp-receipt-head { background: ${C.greenMd}; padding: 20px 26px; }
        .lp-receipt-kicker { font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: #cfe8dc; margin-bottom: 6px; }
        .lp-receipt-org { font-size: 21px; font-weight: 800; color: ${C.white}; letter-spacing: -0.01em; }
        .lp-receipt-ein { font-size: 11px; color: #d6ebe0; margin-top: 5px; }
        .lp-receipt-body { padding: 22px 26px 26px; }
        .lp-receipt-meta { display: flex; justify-content: space-between; font-size: 11px; color: ${C.ink3}; margin-bottom: 14px; }
        .lp-receipt-donor { font-size: 15px; font-weight: 800; color: ${C.ink}; }
        .lp-receipt-addr { font-size: 11px; color: ${C.ink3}; margin-top: 3px; margin-bottom: 16px; }
        .lp-receipt-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; background: #f5f5f0; border-radius: 8px; padding: 16px 18px; }
        .lp-receipt-k { font-size: 8.5px; letter-spacing: 0.06em; text-transform: uppercase; color: ${C.ink3}; margin-bottom: 5px; }
        .lp-receipt-v { font-size: 13px; font-weight: 800; color: ${C.ink}; }
        .lp-receipt-note { font-size: 11.5px; color: #2d2d2d; margin-top: 16px; }

        /* CSV import mapping (how-it-works step 1) */
        .lp-import { width: 100%; background: ${C.white}; border: 1px solid ${C.cream3}; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 26px rgba(15,26,18,0.10); }
        .lp-import-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid ${C.cream2}; }
        .lp-import-body { padding: 14px 16px; }
        .lp-import-row { display: flex; align-items: center; gap: 9px; font-size: 12px; padding: 5px 0; }
        .lp-import-csv { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: ${C.ink3}; background: ${C.cream}; border: 1px solid ${C.cream3}; border-radius: 5px; padding: 2px 8px; }
        .lp-import-arrow { color: ${C.sage}; }
        .lp-import-field { color: ${C.ink}; font-weight: 600; flex: 1; }
        .lp-import-ok { color: ${C.greenMd}; font-weight: 800; }
        .lp-import-foot { margin-top: 10px; padding-top: 10px; border-top: 1px solid ${C.cream2}; font-size: 11px; color: ${C.greenDk}; font-weight: 700; }

        /* Compact goal card (how-it-works step 3) */
        .lp-climb { width: 100%; background: linear-gradient(135deg, #0f1a12, #152420); border: 1px solid #1a2e1f; border-radius: 12px; padding: 18px 20px; }

        /* Recurring-loss calculator (the interactive wedge) */
        .lp-calc { max-width: 1140px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; }
        .lp-calc-card { background: ${C.white}; border: 1px solid ${C.cream3}; border-radius: 16px; padding: 28px 30px; box-shadow: 0 16px 48px rgba(15,26,18,0.10); }
        .lp-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 99px; background: linear-gradient(90deg, ${C.terra} 0%, ${C.gold} 100%); outline: none; }
        .lp-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 24px; height: 24px; border-radius: 50%; background: ${C.ink}; border: 3px solid ${C.white}; box-shadow: 0 2px 8px rgba(15,26,18,0.3); cursor: pointer; }
        .lp-slider::-moz-range-thumb { width: 22px; height: 22px; border-radius: 50%; background: ${C.ink}; border: 3px solid ${C.white}; cursor: pointer; }
        @media (prefers-reduced-motion: reduce) {
          .lp-goal-fill { animation: none; width: 22%; }
          .lp-hcard-fill { animation: none; width: 22%; }
          .lp-goldbtn, .lp-goldbtn:hover { transform: none; }
          /* Accessibility: no fade/rise — content is present immediately. */
          .lp-reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
        }

        .lp-section { padding: 116px 64px; }
        .lp-narrow { max-width: 720px; margin: 0 auto; }
        .lp-wide { max-width: 1140px; margin: 0 auto; }

        /* Moments: alternating prose + real capture */
        .lp-moment { display: grid; grid-template-columns: 5fr 6fr; gap: 64px; align-items: center; }
        .lp-moment.lp-flip { grid-template-columns: 6fr 5fr; }
        .lp-moment.lp-flip .lp-moment-text { order: 2; }
        .lp-moment.lp-flip .lp-moment-media { order: 1; }
        .lp-moment + .lp-moment { margin-top: 120px; }
        .lp-caption { font-size: 12px; color: ${C.ink3}; margin-top: 12px; }

        /* The real dunning email, set like an email */
        .lp-email { background: ${C.white}; border: 1px solid ${C.cream3}; border-radius: 12px; box-shadow: 0 16px 48px rgba(15,26,18,0.12); overflow: hidden; }
        .lp-email-head { padding: 16px 22px; border-bottom: 1px solid ${C.cream2}; font-size: 13px; color: ${C.ink3}; line-height: 1.7; }
        .lp-email-body { padding: 22px; font-size: 14px; color: #2d2d2d; line-height: 1.75; }
        .lp-email-body p + p { margin-top: 13px; }

        /* How it works: three numbered steps */
        .lp-hiw-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px; align-items: stretch; }
        .lp-hiw-step { display: flex; flex-direction: column; gap: 18px; }
        .lp-hiw-imgbox { background: ${C.cream}; border: 1px solid ${C.cream3}; border-radius: 12px; padding: 18px; display: flex; align-items: center; justify-content: center; flex: 1; min-height: 210px; }
        .lp-hiw-imgbox > * { width: 100%; }

        @media (max-width: 768px) {
          .lp-section { padding: 64px 22px; }
          .lp-hiw-grid { grid-template-columns: 1fr; gap: 32px; }
          .lp-hero-grid { grid-template-columns: 1fr; gap: 44px; }
          /* Keep the dark, quiet area behind the headline on portrait screens
             and darken the flat scrim so type stays AA-legible. */
          .lp-hero-photo { min-height: 82vh; }
          .lp-hero-img { object-position: 30% 28%; }
          .lp-hero-scrim { background: rgba(15,26,18,0.66); }
          .lp-hero-content { padding: 92px 22px 56px; }
          .lp-vert-grid { grid-template-columns: 1fr; gap: 20px; }
          .lp-nav { padding: 0 22px !important; }
          .lp-nav-pricing { display: none; }
          .lp-h1 { font-size: 42px !important; }
          .lp-moment, .lp-moment.lp-flip { grid-template-columns: 1fr; gap: 28px; }
          .lp-moment.lp-flip .lp-moment-text { order: 1; }
          .lp-moment.lp-flip .lp-moment-media { order: 2; }
          .lp-moment + .lp-moment { margin-top: 72px; }
          .lp-calc { grid-template-columns: 1fr; gap: 32px; }
        }
      `}</style>

      {showCal && <CalendlyModal onClose={() => setShowCal(false)} />}

      <div className="lp">

        {/* ── Nav — quiet, not sticky; the page is the pitch ── */}
        <nav className="lp-nav" style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 64px", height: 68, borderBottom: `1px solid ${C.cream2}`,
        }}>
          <span className="lp-serif" style={{ fontSize: 22, color: C.ink }}>Steward</span>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <a href="/pricing" className="lp-navlink lp-nav-pricing">Pricing</a>
            <a href="/login" className="lp-navlink">Log in</a>
            <GoldBtn onClick={() => navigate("/signup")}>Start free</GoldBtn>
          </div>
        </nav>

        {/* ── 1. Image-forward hero (BUILD-28). Full-bleed photo + a FLAT rgba
            scrim; headline over the dark, quiet upper-left; the choir reads
            center/right. The photo is ILLUSTRATIVE arts/community work, NOT a
            Steward customer — aria-hidden, never captioned as one. Swapping the
            image is a one-line change to HERO_SRC (+ the index.html preload). ── */}
        <section className="lp-hero-photo">
          <img
            className="lp-hero-img"
            src={`${HERO_SRC}-1280.webp`}
            srcSet={`${HERO_SRC}-960.webp 960w, ${HERO_SRC}-1280.webp 1280w, ${HERO_SRC}-1920.webp 1920w, ${HERO_SRC}-2560.webp 2560w`}
            sizes="100vw"
            width="2560" height="1417"
            alt="" aria-hidden="true" fetchpriority="high" decoding="async"
          />
          <div className="lp-hero-scrim" aria-hidden="true" />
          <div className="lp-hero-content">
            <div className="lp-hero-copy">
              {/* Eyebrow's one job is orientation — say plainly what this IS. */}
              <Eyebrow onDark>Donor CRM for small nonprofits</Eyebrow>
              <h1 className="lp-serif lp-h1" style={{ fontSize: "clamp(44px, 4.8vw, 72px)", lineHeight: 1.06, color: C.cream, marginBottom: 24 }}>
                Donors don't leave.<br />
                They drift.<br />
                Steward{" "}
                <span style={{ borderBottom: `4px solid ${C.gold}`, paddingBottom: 2 }}>notices.</span>
              </h1>
              {/* maxWidth trimmed so every line stays inside the dark scrim area
                  (was crossing into the lit choir, the weakest-contrast point). */}
              <p style={{ fontSize: 17.5, color: "rgba(240,237,230,0.94)", lineHeight: 1.75, maxWidth: 496, marginBottom: 32 }}>
                A donor CRM built by fundraisers. <strong style={{ color: C.cream }}>Keep 100%</strong>{" "}
                of every gift — 0% platform fees, gifts settle in your own Stripe — and{" "}
                <strong style={{ color: C.cream }}>stop losing donors you already earned</strong>{" "}
                to failed cards and silence.
              </p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <GoldBtn big onClick={() => navigate("/signup")}>Start free</GoldBtn>
                <QuietBtn big onDark onClick={() => setShowCal(true)}>Talk to the founder</QuietBtn>
              </div>
              <p className="lp-hero-trust">30-day trial · no credit card · your data exports anytime</p>
            </div>
          </div>
          {/* A single DOM/vector product card floated over the empty lower-right
              quadrant (BUILD-29) — a stranger reads "software FOR nonprofits,"
              not "an arts org." Real elevation (shadow + border) = layered over
              the photo. Hidden ≤1139px so it never crowds the type. */}
          <HeroFloatCard />
        </section>

        {/* ── 1.1 "Built for orgs like yours" — the who-it's-for band (BUILD-28).
            On cream, serif card titles. Signals "a tool FOR you", never a
            nonprofit's own site. Slots with no cleared photo ship a graceful
            on-palette fallback. ── */}
        <section className="lp-section lp-reveal" style={{ background: C.cream, paddingTop: 84, paddingBottom: 84 }}>
          <div className="lp-wide">
            <div style={{ textAlign: "center", marginBottom: 46 }}>
              <Eyebrow>Built for orgs like yours</Eyebrow>
              <h2 className="lp-serif" style={{ fontSize: "clamp(28px, 3.2vw, 42px)", color: C.ink, lineHeight: 1.14 }}>
                You know your donors. Steward notices when they're slipping.
              </h2>
            </div>
            <div className="lp-vert-grid">
              {VERTICALS.map(v => (
                <div key={v.title} className="lp-vert-card">
                  {v.img ? (
                    <img className="lp-vert-media" alt="" aria-hidden="true"
                      src={`${v.img}-800.webp`}
                      srcSet={`${v.img}-400.webp 400w, ${v.img}-800.webp 800w`}
                      sizes="(max-width: 768px) 100vw, 360px"
                      width="800" height="533" loading="lazy" decoding="async"
                      style={v.pos ? { objectPosition: v.pos } : undefined} />
                  ) : (
                    <div className="lp-vert-fallback" aria-hidden="true"><span className="lp-vert-rule" /></div>
                  )}
                  <div className="lp-vert-body">
                    <h3 className="lp-serif" style={{ fontSize: 23, color: C.ink, marginBottom: 8 }}>{v.title}</h3>
                    <p style={{ fontSize: 15, color: "#2d2d2d", lineHeight: 1.65 }}>{v.blurb}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 1.5 The wedge, made visceral + interactive ── */}
        <section className="lp-section lp-reveal" style={{ background: C.white, borderTop: `1px solid ${C.cream2}` }}>
          <RecoveryCalculator />
        </section>

        {/* ── 2. The problem, told plainly ── */}
        <section className="lp-section lp-reveal" style={{ background: C.cream, borderBottom: `1px solid ${C.cream2}` }}>
          <div className="lp-narrow" style={{ textAlign: "center" }}>
            <p className="lp-serif" style={{ fontSize: "clamp(24px, 2.6vw, 33px)", lineHeight: 1.5, color: C.ink }}>
              The average nonprofit keeps 43% of its donors from one year to the
              next. Not because people stop caring — because nobody noticed them
              going quiet. Every CRM can store your donors.{" "}
              <span style={{ borderBottom: `3px solid ${C.gold}` }}>Steward watches over them.</span>
            </p>
            <p style={{ fontSize: 12.5, color: C.ink3, marginTop: 26 }}>
              43% is the sector-average donor retention rate published in Bloomerang's annual benchmarks.
            </p>
          </div>
        </section>

        {/* ── 2.5 Proof: the real home screen (BUILD-28 relocated the product
            shot here, below the wedge, as EVIDENCE — no longer the page's
            visual identity). Live DOM + browser chrome, crisp at every DPR
            (BUILD-12; do not rasterize). ── */}
        <section className="lp-section lp-reveal" style={{ background: C.white, borderTop: `1px solid ${C.cream2}` }}>
          <div className="lp-proof">
            <div style={{ textAlign: "center", marginBottom: 40 }}>
              <Eyebrow>The actual product</Eyebrow>
              <h2 className="lp-serif" style={{ fontSize: "clamp(28px, 3.2vw, 42px)", color: C.ink, lineHeight: 1.14 }}>
                Not a mockup. This is the home screen.
              </h2>
            </div>
            <div className="lp-frame">
              <div className="lp-frame-bar" aria-hidden="true">
                <span className="lp-frame-dot" style={{ background: C.terra, opacity: 0.7 }} />
                <span className="lp-frame-dot" style={{ background: C.gold, opacity: 0.8 }} />
                <span className="lp-frame-dot" style={{ background: C.sage }} />
                <span className="lp-frame-url">app.stewardapp.dev</span>
              </div>
              <div className="lp-shot-wrap" role="img"
                aria-label="Steward's home screen: the quarter's fundraising goal at 22%, and the donor retention rate it's noticing">
                <HeroShot />
              </div>
            </div>
          </div>
        </section>

        {/* ── 3. Three true product moments ── */}
        <section className="lp-section lp-reveal">
          <div className="lp-wide">

            {/* Moment 1 — the morning queue */}
            <div className="lp-moment">
              <div className="lp-moment-text">
                <Eyebrow>Tuesday, 8:04 am</Eyebrow>
                <h2 className="lp-serif" style={{ fontSize: "clamp(28px, 3vw, 40px)", color: C.ink, lineHeight: 1.15, marginBottom: 18 }}>
                  The morning queue
                </h2>
                <p style={{ fontSize: 16, color: "#2d2d2d", lineHeight: 1.8 }}>
                  Steward opens with who needs you today: a donor about to cross a
                  milestone worth a handwritten note, a longtime giver going quiet,
                  a task you set for yourself last month. Each one arrives with its
                  reasons — last gift, what their file says, how long it's been —
                  and one action. It's rarely more than a handful. Work the list
                  over coffee.
                </p>
              </div>
              <div className="lp-moment-media" role="img"
                aria-label="Steward's Needs Your Attention queue: six donors with reasons and a single action each">
                <QueueShot />
                <div className="lp-caption">The queue on Steward's home screen — the live component, rendered here with sample donors.</div>
              </div>
            </div>

            {/* Moment 2 — recovery. The money section; the email shown is the
                real default template from the product (server.js
                DEFAULT_DUNNING_BODY), tokens filled with visibly sample values. */}
            <div className="lp-moment lp-flip">
              <div className="lp-moment-text">
                <Eyebrow>Any night, 2:11 am</Eyebrow>
                <h2 className="lp-serif" style={{ fontSize: "clamp(28px, 3vw, 40px)", color: C.ink, lineHeight: 1.15, marginBottom: 18 }}>
                  The gift you didn't know you were losing
                </h2>
                <p style={{ fontSize: 16, color: "#2d2d2d", lineHeight: 1.8, marginBottom: 14 }}>
                  20–30% of recurring giving is lost to nothing more dramatic than
                  an expired card. The donor never decided to stop — their bank
                  reissued some plastic, the charge failed at two in the morning,
                  and nobody ever asked them to fix it.
                </p>
                <p style={{ fontSize: 16, color: "#2d2d2d", lineHeight: 1.8 }}>
                  When a recurring gift fails, Steward notices within the hour and
                  sends a warm note in your organization's name with a one-click,
                  no-login card update — then follows up on a gentle schedule until
                  it's resolved. You see the dollars at risk on your home screen,
                  and you see them come back.
                </p>
              </div>
              <div className="lp-moment-media">
                <div className="lp-email">
                  <div className="lp-email-head">
                    <div><span style={{ color: C.ink, fontWeight: 600 }}>From:</span> Riverbend Arts Collective</div>
                    <div><span style={{ color: C.ink, fontWeight: 600 }}>Subject:</span> A quick fix to keep your support going</div>
                  </div>
                  <div className="lp-email-body">
                    <p>Hi Maria,</p>
                    <p>Thank you again for your ongoing gift of $50 to Riverbend Arts Collective — support like yours is what makes our work possible.</p>
                    <p>We tried to process your latest gift and the card on file didn't go through. This happens most often when a card has expired or been reissued, and it only takes a minute to fix.</p>
                    <p style={{ textAlign: "center", margin: "22px 0" }}>
                      <span style={{ background: C.greenMd, color: "#fff", padding: "11px 26px", borderRadius: 8, fontWeight: 700, display: "inline-block" }}>Update my card</span>
                    </p>
                    <p>If you have any questions, just reply to this email — we're glad to help.</p>
                    <p>With gratitude,<br />Riverbend Arts Collective</p>
                  </div>
                </div>
                <div className="lp-caption">The actual email Steward sends when a card fails — its built-in template, shown with sample values. Orgs can rewrite every word.</div>
              </div>
            </div>

            {/* Moment 3 — receipts */}
            <div className="lp-moment">
              <div className="lp-moment-text">
                <Eyebrow>Audit season</Eyebrow>
                <h2 className="lp-serif" style={{ fontSize: "clamp(28px, 3vw, 40px)", color: C.ink, lineHeight: 1.15, marginBottom: 18 }}>
                  The receipt that sends itself
                </h2>
                <p style={{ fontSize: 16, color: "#2d2d2d", lineHeight: 1.8 }}>
                  Every online gift gets an IRS-compliant receipt — numbered,
                  recorded, and sent the moment the payment lands. Offline gifts
                  are one click, never automatic, because you know which entries
                  are backfill. Year-end statements consolidate a donor's whole
                  year on demand. Your auditor stops asking.
                </p>
              </div>
              <div className="lp-moment-media" role="img"
                aria-label="A numbered, IRS-compliant donation receipt generated by Steward">
                <ReceiptShot />
                <div className="lp-caption">Steward's actual receipt layout, shown with sample values — the same template the product generates and sends.</div>
              </div>
            </div>

          </div>
        </section>

        {/* ── 3.5 How it works — three numbered steps, one line + one real
            capture each (BUILD-08 Phase A). Same honesty rule as everything
            else on the page: all three images are crops of the live product. */}
        <section className="lp-section lp-reveal" style={{ background: C.white, borderTop: `1px solid ${C.cream2}` }}>
          <div className="lp-wide">
            <div style={{ textAlign: "center", marginBottom: 56 }}>
              <Eyebrow>How it works</Eyebrow>
              <h2 className="lp-serif" style={{ fontSize: "clamp(30px, 3.4vw, 44px)", color: C.ink, lineHeight: 1.12 }}>
                Three steps, and the first one's on me.
              </h2>
            </div>
            <div className="lp-hiw-grid">
              {[
                {
                  shot: <ImportShot />,
                  alt: "Steward's CSV import — columns auto-mapped, stages auto-assigned",
                  line: <><strong>Import your donors.</strong> A CSV is enough — and founding partners get it done for them.</>,
                },
                {
                  shot: <QueueShot rows={ATTENTION_ROWS} header={false} />,
                  alt: "Three rows from the Needs Your Attention queue, each with a reason and one action",
                  line: <><strong>See who needs attention today.</strong> A short queue with reasons, not a database to dig through.</>,
                },
                {
                  shot: <ClimbShot />,
                  alt: "A fundraising goal's progress: 22% of goal reached, $5,501 of $25,000",
                  line: <><strong>Watch retention and recovered gifts climb.</strong> The numbers move because someone finally noticed in time.</>,
                },
              ].map((s, i) => (
                <div key={i} className="lp-hiw-step">
                  <div className="lp-hiw-imgbox" role="img" aria-label={s.alt}>
                    {s.shot}
                  </div>
                  <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                    <span className="lp-serif" style={{ fontSize: 34, color: C.gold, lineHeight: 1, flexShrink: 0 }}>{i + 1}</span>
                    <p style={{ fontSize: 15, color: "#2d2d2d", lineHeight: 1.7 }}>{s.line}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 4. The money strip ── */}
        <section className="lp-section lp-reveal" style={{ background: C.ink }}>
          <div className="lp-narrow" style={{ textAlign: "center" }}>
            <Eyebrow onDark>Where the money goes</Eyebrow>
            <h2 className="lp-serif" style={{ fontSize: "clamp(32px, 3.6vw, 48px)", color: C.cream, lineHeight: 1.12, marginBottom: 24 }}>
              Your donors give to you. Only you.
            </h2>
            <p style={{ fontSize: 16.5, color: C.sage, lineHeight: 1.85, maxWidth: 620, margin: "0 auto 22px" }}>
              Donations settle directly into your organization's own Stripe
              account. Steward never touches the money and takes no percentage —
              0%, on every gift. Your donors are never asked to add a tip to
              cover somebody's software.
            </p>
            <p className="lp-serif" style={{ fontSize: 20, fontStyle: "italic", color: C.gold, lineHeight: 1.6, maxWidth: 560, margin: "0 auto 22px" }}>
              Free platforms are paid for by your donors' tips. Steward is paid
              for by you — flatly, transparently.
            </p>
            <p style={{ fontSize: 12.5, color: "#6b8f7a", maxWidth: 480, margin: "0 auto" }}>
              Stripe's standard card-processing fee still applies — that goes to
              Stripe, not to us. Plans are $99, $249, or $499 a month, flat.{" "}
              <a href="/pricing" style={{ color: C.sage, textDecoration: "underline", textUnderlineOffset: 3 }}>See pricing</a>.
            </p>
          </div>
        </section>

        {/* ── 5. Where Steward is today — the candor section stays; it IS the brand ── */}
        <section className="lp-section lp-reveal" style={{ background: C.white, borderBottom: `1px solid ${C.cream2}` }}>
          <div className="lp-narrow">
            <Eyebrow>Where Steward is today</Eyebrow>
            <h2 className="lp-serif" style={{ fontSize: "clamp(30px, 3.4vw, 44px)", color: C.ink, lineHeight: 1.15, marginBottom: 22 }}>
              This is new. I'd rather tell you the truth than sell you a testimonial.
            </h2>
            <p style={{ fontSize: 16, color: "#2d2d2d", lineHeight: 1.8, marginBottom: 26 }}>
              Steward is built and run by one person. There's no case-study wall
              and no customer count on this page, because it's early and I won't
              invent either. Here is what's actually true today:
            </p>
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
              {[
                "Live now: donor records and pipeline, Gmail sync, email campaigns and sequences, milestone drafts a human reviews before anything sends, failed-payment recovery, tax receipts and year-end statements, six board-ready reports, peer-to-peer fundraising pages.",
                "Load-tested to 25,000 donors and 200,000 gifts per organization.",
                "Errors are monitored in production; your data exports to a zip of clean CSVs in one click — including after you cancel. That's a promise, and it's already built.",
              ].map((t, i) => (
                <li key={i} style={{ display: "flex", gap: 12, fontSize: 15, color: "#2d2d2d", lineHeight: 1.7 }}>
                  <span style={{ color: C.greenDk, fontWeight: 800, flexShrink: 0 }}>—</span>{t}
                </li>
              ))}
            </ul>
            {/* The founding-partner ASK moved to its own section AFTER the
                founder letter (BUILD-29) — the letter is what earns the ask. */}
          </div>
        </section>

        {/* ── The mid-page pottery/studio band was removed (FIX 2026-07-30):
            a tight macro crop read as texture, not a place, and left an
            orphaned white gap. The candor section (white, closing hairline)
            now flows straight into the founder letter (cream) — a deliberate
            tone shift, no decorative slab between them. If a mid-page breath
            is ever wanted, use the wide art-studio ROOM shot (reads as a
            place) at ~half height — not a macro. ── */}

        {/* ── 6. A letter from the founder ──
            Jonathan's own words (BUILD-12). The avatar below is still a
            PLACEHOLDER for a real founder photo — a genuine human face is the
            point of this band; do NOT use a stock portrait implying a team
            Steward doesn't have. "The legacy tools" stands in for the named
            competitors in the source draft, per the no-competitor-names
            decision. */}
        <section className="lp-section lp-reveal">
          <div style={{ maxWidth: 620, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 26 }}>
              <div aria-hidden="true" style={{ width: 64, height: 64, borderRadius: "50%", flexShrink: 0, background: `linear-gradient(135deg, ${C.dark2}, ${C.ink})`, border: `2px solid ${C.gold}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="lp-serif" style={{ fontSize: 26, color: C.gold }}>J</span>
              </div>
              <div>
                <Eyebrow>A letter from the founder</Eyebrow>
                <div style={{ fontSize: 14, color: C.ink3, marginTop: -8 }}>Jonathan · founder, and the person who answers your email</div>
              </div>
            </div>
            <h2 className="lp-serif" style={{ fontSize: "clamp(26px, 2.8vw, 34px)", color: C.ink, lineHeight: 1.15, marginBottom: 22 }}>
              Why I built Steward
            </h2>
            <div className="lp-serif" style={{ fontSize: 19, color: C.ink, lineHeight: 1.85 }}>
              <p style={{ marginBottom: 18 }}>
                My dad has spent his whole career in nonprofit development, and
                he's raised tens of millions of dollars. He built the donor CRM
                at the heart of Steward — and he built it to fix the things that
                always frustrated him about the legacy tools. The legacy tools:
                powerful, but archaic to the people actually using them every
                day. He knew exactly what they should have done instead, so we
                built that.
              </p>
              <p style={{ marginBottom: 18 }}>
                Because I kept seeing the same gap everywhere: mid-sized
                nonprofits that can't afford a $30k system, but have long
                outgrown a Google Sheet, a phone full of contacts, and a mental
                note to "follow up with that person someday." That gap costs orgs
                the one thing they can least afford to lose: the donors who were
                already leaning in, quietly drifting away because nothing was
                built to notice.
              </p>
              <p style={{ marginBottom: 18 }}>
                Steward is for the development director doing the books at 11pm.
                It's for the one-person shop that will grow into it, and the big
                team that needs everything a legacy CRM does — without the legacy
                price. And it will never charge you to reach your own donors, or
                take a cut of a dollar meant for your mission.
              </p>
              <p style={{ marginBottom: 26 }}>
                Here's my promise. I've lived in this world, and I actually care
                about it. If something breaks, I'll fix it this weekend. If you
                need something Steward doesn't do yet, I'll build it this week.
                You'll always know the person who answers your email.
              </p>
              <p style={{ fontStyle: "italic", fontSize: 21 }}>— Jonathan</p>
            </div>
            <p style={{ fontSize: 13, color: C.ink3, marginTop: 18 }}>
              <a href={FOUNDER_MAILTO} style={{ color: C.greenDk, textDecoration: "underline", textUnderlineOffset: 3 }}>jonathan@stewardapp.dev</a>
            </p>
          </div>
        </section>

        {/* ── 6.5 Founding-partner CTA — the ask, now AFTER the letter that
            earns it (BUILD-29 reorder). Carries the quiet pricing signal so a
            visitor never has to click through to /pricing to learn the range. ── */}
        <section className="lp-section lp-reveal" style={{ background: C.white, borderTop: `1px solid ${C.cream2}`, borderBottom: `1px solid ${C.cream2}`, textAlign: "center" }}>
          <div className="lp-narrow">
            <Eyebrow>Founding partners</Eyebrow>
            <h2 className="lp-serif" style={{ fontSize: "clamp(30px, 3.4vw, 44px)", color: C.ink, lineHeight: 1.15, marginBottom: 20 }}>
              Be one of the first five.
            </h2>
            <p style={{ fontSize: 17, color: "#2d2d2d", lineHeight: 1.8, maxWidth: 560, margin: "0 auto 22px" }}>
              I'm looking for <strong>three to five founding partner organizations</strong> —
              nonprofits who'll use Steward for real, tell me what's missing, and shape
              what gets built next. Founding partners get a locked-in price and a direct
              line to me.
            </p>
            <p style={{ fontSize: 14, color: C.ink3, marginBottom: 28 }}>
              From <strong style={{ color: C.ink }}>$149/month</strong> · keep 100% of every gift ·{" "}
              <a href="/pricing" style={{ color: C.greenDk, fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 }}>See pricing</a>
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <QuietBtn big onClick={() => { window.location.href = `${FOUNDER_MAILTO}?subject=Founding%20partner`; }}>Write to me →</QuietBtn>
            </div>
          </div>
        </section>

        {/* ── 7. Close ── */}
        <section className="lp-section lp-reveal" style={{ textAlign: "center" }}>
          <div className="lp-narrow">
            <h2 className="lp-serif" style={{ fontSize: "clamp(34px, 4vw, 52px)", color: C.ink, marginBottom: 30, lineHeight: 1.12 }}>
              See who needs you today.
            </h2>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 18 }}>
              <GoldBtn big onClick={() => navigate("/signup")}>Start free</GoldBtn>
              <QuietBtn big onClick={() => setShowCal(true)}>Talk to the founder</QuietBtn>
            </div>
            <p style={{ fontSize: 13, color: C.ink3 }}>
              30-day trial · no credit card · import your donors this afternoon
            </p>
          </div>
        </section>

        {/* ── Footer — real links only ── */}
        <footer style={{ background: C.ink, padding: "44px 64px" }}>
          <div className="lp-wide" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 18 }}>
            <div>
              <div className="lp-serif" style={{ fontSize: 20, color: C.cream, marginBottom: 4 }}>Steward</div>
              <div style={{ fontSize: 12, color: C.sage }}>© 2026 Steward · Donor retention for small nonprofits</div>
            </div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13 }}>
              <a href="/pricing" style={{ color: C.sage }} className="lp-navlink">Pricing</a>
              <a href="/login" style={{ color: C.sage }} className="lp-navlink">Log in</a>
              <a href={FOUNDER_MAILTO} style={{ color: C.sage }} className="lp-navlink">Contact</a>
              <a href="/terms" style={{ color: C.sage }} className="lp-navlink">Terms</a>
              <a href="/privacy" style={{ color: C.sage }} className="lp-navlink">Privacy</a>
            </div>
          </div>
        </footer>

      </div>
    </>
  );
}

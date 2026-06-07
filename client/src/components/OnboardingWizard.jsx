import { useState, useEffect } from "react";

const STOPS = [
  {
    selector: '[data-tour="nav-today"]',
    title: "Your daily command center",
    body: "Steward tells you exactly who to follow up with today, and why. Start here every morning.",
    position: "bottom",
  },
  {
    selector: '[data-tour="nav-donors"]',
    title: "Your full donor relationship history",
    body: "Every contact, gift, and interaction — all in one place. Build a pipeline from prospect to major donor.",
    position: "bottom",
  },
  {
    selector: '[data-tour="nav-finance"]',
    title: "Never miss an acknowledgment",
    body: "Track every gift so no donor goes unthanked. Finance syncs automatically when a gift is logged.",
    position: "bottom",
  },
  {
    selector: '[data-tour="nav-analytics"]',
    title: "See your pipeline at a glance",
    body: "Giving trends, retention rates, and major gift pipeline — always current, no spreadsheets needed.",
    position: "bottom",
  },
  {
    selector: '[data-tour="ask-ai"]',
    title: "Your fundraising co-pilot",
    body: "Ask for a donor briefing, draft an outreach email, or get help prioritizing your week.",
    position: "above",
  },
];

function getTooltipPos(rect, position) {
  if (!rect) return { top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
  const TW = 320;
  const vw = window.innerWidth;
  const clampLeft = (l) => Math.max(12, Math.min(l, vw - TW - 12));

  if (position === "bottom") {
    return { top: rect.bottom + 14, left: clampLeft(rect.left + rect.width / 2 - TW / 2) };
  }
  if (position === "above") {
    return { top: rect.top - 14, left: clampLeft(rect.left + rect.width / 2 - TW / 2), transform: "translateY(-100%)" };
  }
  return { top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
}

export function OnboardingWizard({ org, onDone }) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState(null);

  useEffect(() => {
    const el = document.querySelector(STOPS[step].selector);
    setTargetRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  const finish = () => {
    if (org?.id) localStorage.setItem("steward_onboarded_" + org.id, "1");
    onDone();
  };

  const next = () => {
    if (step < STOPS.length - 1) setStep(s => s + 1);
    else finish();
  };

  const PAD = 6;
  const stop = STOPS[step];
  const tooltipStyle = getTooltipPos(targetRect, stop.position);

  return (
    <>
      <style>{`@keyframes tour-pulse{0%,100%{box-shadow:0 0 0 4px rgba(26,107,74,0.3)}50%{box-shadow:0 0 0 9px rgba(26,107,74,0.08)}}`}</style>

      {/* Backdrop */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.45)" }}
        onClick={e => e.stopPropagation()}
      />

      {/* Spotlight ring around target */}
      {targetRect && (
        <div style={{
          position: "fixed",
          top: targetRect.top - PAD,
          left: targetRect.left - PAD,
          width: targetRect.width + PAD * 2,
          height: targetRect.height + PAD * 2,
          borderRadius: 10,
          border: "2px solid #1a6b4a",
          animation: "tour-pulse 2s ease-in-out infinite",
          zIndex: 41,
          pointerEvents: "none",
        }} />
      )}

      {/* Tooltip card */}
      <div style={{
        position: "fixed",
        zIndex: 50,
        width: 320,
        background: "#fff",
        borderRadius: 16,
        boxShadow: "0 20px 60px rgba(0,0,0,0.2), 0 4px 16px rgba(0,0,0,0.08)",
        padding: "22px 24px",
        ...tooltipStyle,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 10 }}>
          Step {step + 1} of {STOPS.length}
        </div>
        <div style={{ fontSize: 18, fontWeight: 400, fontFamily: "'DM Serif Display',Georgia,serif", color: "#0f1a12", marginBottom: 8, lineHeight: 1.25 }}>
          {stop.title}
        </div>
        <p style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.55, margin: "0 0 20px" }}>
          {stop.body}
        </p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            onClick={finish}
            style={{ background: "transparent", border: "none", color: "#9ca3af", fontSize: 13, cursor: "pointer", textDecoration: "underline", padding: 0, fontFamily: "inherit" }}
          >
            Skip tour
          </button>
          <button
            onClick={next}
            style={{ background: "#1a6b4a", border: "none", borderRadius: 8, padding: "8px 20px", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            {step === STOPS.length - 1 ? "Done →" : "Next →"}
          </button>
        </div>
      </div>
    </>
  );
}

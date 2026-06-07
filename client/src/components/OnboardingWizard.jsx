import { useState, useEffect, useRef } from "react";

const STOPS = [
  {
    selector: '[data-tour="nav-today"]',
    title: "Start here every morning",
    body: "Steward surfaces who needs attention today — lapsing donors, unacknowledged gifts, overdue tasks. No more guessing who to call.",
    position: "bottom",
    badge: null,
  },
  {
    selector: '[data-tour="nav-donors"]',
    title: "Your donor relationships",
    body: "Every contact, gift, email thread, and interaction in one place. Steward remembers everything so you don't have to.",
    position: "bottom",
    badge: null,
  },
  {
    selector: '[data-tour="nav-finance"]',
    title: "Never miss a thank-you",
    body: "Every gift gets flagged until it's acknowledged. Donors who feel thanked give again — donors who don't, disappear.",
    position: "bottom",
    badge: null,
  },
  {
    selector: '[data-tour="nav-analytics"]',
    title: "See the full picture",
    body: "Giving trends, retention rates, and major gift pipeline. Know exactly where your fundraising stands at any moment.",
    position: "bottom",
    badge: null,
  },
  {
    selector: '[data-tour="ask-ai"]',
    title: "Your AI fundraising co-pilot",
    body: "Ask for a donor briefing before a meeting, draft a personal outreach email, or get your week prioritized. Native AI — not a chatbot bolted on.",
    position: "above",
    badge: "⚡ Powered by Claude",
  },
];

function getTooltipPos(rect, position) {
  if (!rect) return { top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
  const TW = 384;
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
  const [visible, setVisible] = useState(true);
  const [transitioning, setTransitioning] = useState(false);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // On mount: set rect immediately, no fade
    if (isFirstRender.current) {
      isFirstRender.current = false;
      const el = document.querySelector(STOPS[0].selector);
      setTargetRect(el ? el.getBoundingClientRect() : null);
      return;
    }
    // On step change: fade out → reposition → fade in
    setTransitioning(true);
    const t = setTimeout(() => {
      const el = document.querySelector(STOPS[step].selector);
      setTargetRect(el ? el.getBoundingClientRect() : null);
      setTransitioning(false);
    }, 100);
    return () => clearTimeout(t);
  }, [step]);

  const finish = () => {
    if (org?.id) localStorage.setItem("steward_onboarded_" + org.id, "1");
    setVisible(false);
    setTimeout(onDone, 250);
  };

  const next = () => {
    if (step < STOPS.length - 1) setStep(s => s + 1);
    else finish();
  };

  const PAD = 6;
  const stop = STOPS[step];
  const isAskAi = stop.selector.includes("ask-ai");
  const tooltipStyle = getTooltipPos(targetRect, stop.position);
  const layerOpacity = visible ? 1 : 0;
  const cardOpacity = visible && !transitioning ? 1 : 0;

  return (
    <>
      <style>{`@keyframes tour-ring{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}`}</style>

      {/* Backdrop */}
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 40,
          background: "rgba(0,0,0,0.45)",
          opacity: layerOpacity,
          transition: "opacity 200ms ease",
        }}
        onClick={e => e.stopPropagation()}
      />

      {/* Spotlight ring */}
      {targetRect && (
        <div style={{
          position: "fixed",
          top: targetRect.top - PAD,
          left: targetRect.left - PAD,
          width: targetRect.width + PAD * 2,
          height: targetRect.height + PAD * 2,
          borderRadius: isAskAi ? 999 : 10,
          border: "2px solid #10b981",
          boxShadow: "0 0 0 4px rgba(16,185,129,0.2)",
          animation: "tour-ring 1.5s ease-in-out infinite",
          zIndex: 41,
          pointerEvents: "none",
          opacity: layerOpacity,
          transition: "opacity 200ms ease",
        }} />
      )}

      {/* Tooltip card */}
      <div style={{
        position: "fixed",
        zIndex: 50,
        width: 384,
        background: "#fff",
        borderRadius: 16,
        border: "1px solid #f3f4f6",
        boxShadow: "0 25px 50px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.06)",
        padding: "24px",
        opacity: cardOpacity,
        transition: "opacity 100ms ease",
        ...tooltipStyle,
      }}>
        {/* Progress bar */}
        <div style={{ width: "100%", height: 4, background: "#f0ede6", borderRadius: 99, marginBottom: 16, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 99, background: "#1a6b4a",
            width: `${((step + 1) / STOPS.length) * 100}%`,
            transition: "width 200ms ease",
          }} />
        </div>

        {/* Badge */}
        {stop.badge && (
          <div style={{
            display: "inline-flex", alignItems: "center",
            background: "#f0ede6", color: "#1a6b4a",
            fontSize: 11, fontWeight: 600, fontFamily: "'DM Sans',system-ui,sans-serif",
            borderRadius: 999, padding: "3px 10px", marginBottom: 10,
          }}>
            {stop.badge}
          </div>
        )}

        {/* Title */}
        <div style={{
          fontSize: 20, fontWeight: 400,
          fontFamily: "'DM Serif Display',Georgia,serif",
          color: "#0f1a12", marginBottom: 8, lineHeight: 1.2,
        }}>
          {stop.title}
        </div>

        {/* Body */}
        <p style={{
          fontSize: 14, color: "#4b5563", lineHeight: 1.6,
          margin: "0 0 20px", fontFamily: "'DM Sans',system-ui,sans-serif",
        }}>
          {stop.body}
        </p>

        {/* Bottom row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            onClick={finish}
            style={{
              background: "transparent", border: "none", color: "#9ca3af",
              fontSize: 12, cursor: "pointer", textDecoration: "underline",
              padding: 0, fontFamily: "inherit",
            }}
          >
            Skip tour
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 12, color: "#9ca3af" }}>
              {step + 1} / {STOPS.length}
            </span>
            <button
              onClick={next}
              style={{
                background: "#1a6b4a", border: "none", borderRadius: 10,
                padding: "8px 20px", color: "#fff", fontSize: 14, fontWeight: 500,
                cursor: "pointer", fontFamily: "'DM Sans',system-ui,sans-serif",
              }}
            >
              {step === STOPS.length - 1 ? "Done ✓" : "Next →"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

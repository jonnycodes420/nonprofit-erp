import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { useAuth } from "../main";

const FOCUS_OPTIONS = [
  { value: "donors",  label: "Donor Management",     sub: "Track relationships, gifts & pipelines" },
  { value: "grants",  label: "Grant Tracking",       sub: "Manage funders, deadlines & reports" },
  // "finance" removed — the Finance tab is currently hidden from nav (see
  // the Donors/Grants-focus product pivot), so offering it here as a
  // selectable focus promised something a new user couldn't actually reach.
  // Not gone for good: Finance backend/data is intact, just not navigable
  // right now — re-add this option if/when the tab comes back.
  { value: "all",     label: "Both",                 sub: "Get the full picture from day one" },
];

const SETUP_ITEMS = [
  "Standard chart of accounts (26 accounts)",
  "General Operating fund",
  "Donor pipeline (6 stages)",
  "Workspace configured",
];

const SETUP_HINTS = [
  "Configuring accounts…",
  "Creating fund…",
  "Finalizing setup…",
  "Almost done…",
];

function Spin() {
  return (
    <>
      <style>{`@keyframes ws{to{transform:rotate(360deg)}}`}</style>
      <span style={{
        display: "inline-block", width: 15, height: 15,
        border: "2px solid #e8e4db", borderTopColor: "#1a6b4a",
        borderRadius: "50%", animation: "ws 0.8s linear infinite", flexShrink: 0,
      }} />
    </>
  );
}

export default function WelcomePage() {
  const { auth, refreshOrg } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [focus, setFocus] = useState("");
  const [error, setError] = useState("");
  const [setupItems, setSetupItems] = useState([]);
  const [loadingSample, setLoadingSample] = useState(false);
  const focusRef = useRef(focus);

  useEffect(() => {
    if (auth?.org?.onboarding_complete) navigate("/dashboard", { replace: true });
  }, [auth]);

  useEffect(() => {
    if (step !== 1) return;
    let cancelled = false;
    const run = async () => {
      setSetupItems([]);
      const apiCall = apiFetch("/onboarding/complete", {
        method: "POST",
        body: JSON.stringify({ focus: focusRef.current }),
      }).then(refreshOrg);

      for (let i = 0; i < SETUP_ITEMS.length - 1; i++) {
        await new Promise(r => setTimeout(r, 480));
        if (cancelled) return;
        setSetupItems(prev => [...prev, SETUP_ITEMS[i]]);
      }

      await apiCall;
      if (cancelled) return;
      setSetupItems([...SETUP_ITEMS]);
      await new Promise(r => setTimeout(r, 400));
      if (!cancelled) setStep(2);
    };

    run().catch(err => {
      if (!cancelled) {
        setError(err.message || "Setup failed. Please try again.");
        setStep(0);
      }
    });
    return () => { cancelled = true; };
  }, [step]);

  const handleStart = () => {
    focusRef.current = focus;
    setError("");
    setStep(1);
  };

  const handleLoadSample = async () => {
    setLoadingSample(true);
    try { await apiFetch("/org/load-sample-data", { method: "POST" }); } catch {}
    navigate("/dashboard", { replace: true });
  };

  const ink = "#0f1a12";
  const ink3 = "#6b7280";
  const greenDk = "#1a6b4a";
  const green = "#10b981";
  const gold = "#c9a84c";

  return (
    <div style={{
      minHeight: "100vh", background: "#f0ede6",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Sans',system-ui,sans-serif", padding: "32px 16px",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet" />
      <div style={{ width: "100%", maxWidth: 460 }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 48, height: 48, background: greenDk, borderRadius: 14,
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px",
          }}>
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
              <path d="M8 2L13 5v6L8 14 3 11V5L8 2z" stroke="#f0ede6" strokeWidth="1.5" fill="none"/>
              <circle cx="8" cy="8" r="2" fill="#f0ede6"/>
            </svg>
          </div>
          <span style={{ fontSize: 17, fontWeight: 700, color: ink, letterSpacing: "-0.02em", fontFamily: "'DM Serif Display',Georgia,serif" }}>
            Steward
          </span>
        </div>

        {/* Step 0 — Focus selection */}
        {step === 0 && (
          <div style={{ background: "#fff", borderRadius: 20, padding: "36px 36px 32px", boxShadow: "0 4px 24px rgba(15,26,18,0.08)" }}>
            <h1 style={{
              fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 28, fontWeight: 400,
              color: ink, margin: "0 0 6px", letterSpacing: "-0.01em", lineHeight: 1.2,
            }}>
              What brings you to Steward?
            </h1>
            <p style={{ fontSize: 14, color: ink3, margin: "0 0 24px" }}>
              We'll personalize your setup.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
              {FOCUS_OPTIONS.map(opt => (
                <div
                  key={opt.value}
                  onClick={() => setFocus(opt.value)}
                  style={{
                    border: focus === opt.value ? `2px solid ${greenDk}` : "1px solid #e5e7eb",
                    borderRadius: 12, padding: "13px 16px", cursor: "pointer",
                    background: focus === opt.value ? "#f0faf5" : "#f9f8f6",
                    display: "flex", alignItems: "center", gap: 14, transition: "all 0.15s",
                  }}
                >
                  <div style={{
                    width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                    border: `2px solid ${focus === opt.value ? greenDk : "#d1d5db"}`,
                    background: focus === opt.value ? greenDk : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.15s",
                  }}>
                    {focus === opt.value && (
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff" }} />
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: ink }}>{opt.label}</div>
                    <div style={{ fontSize: 12, color: ink3, marginTop: 2 }}>{opt.sub}</div>
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <div style={{
                background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8,
                padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 16,
              }}>{error}</div>
            )}

            <button
              onClick={handleStart}
              disabled={!focus}
              style={{
                width: "100%", background: focus ? greenDk : "#e5e7eb", border: "none",
                borderRadius: 12, padding: "14px 16px",
                color: focus ? "#fff" : "#9ca3af",
                fontSize: 15, fontWeight: 700, cursor: focus ? "pointer" : "not-allowed",
                transition: "all 0.15s", fontFamily: "inherit",
              }}
            >
              Continue →
            </button>
          </div>
        )}

        {/* Step 1 — Animated setup */}
        {step === 1 && (
          <div style={{ background: "#fff", borderRadius: 20, padding: "36px 36px 32px", boxShadow: "0 4px 24px rgba(15,26,18,0.08)" }}>
            <h1 style={{
              fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 24, fontWeight: 400,
              color: ink, margin: "0 0 6px", letterSpacing: "-0.01em", textAlign: "center",
            }}>
              Setting up your workspace…
            </h1>
            <p style={{ fontSize: 13, color: ink3, margin: "0 0 28px", textAlign: "center" }}>
              Just a moment.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {setupItems.map((item, i) => (
                <div key={i} style={{
                  display: "flex", gap: 12, alignItems: "center", padding: "11px 0",
                  borderBottom: i < setupItems.length - 1 ? "1px solid #f3f4f6" : "none",
                }}>
                  <span style={{ color: green, fontWeight: 800, fontSize: 14, flexShrink: 0 }}>✓</span>
                  <span style={{ fontSize: 14, color: ink }}>{item}</span>
                </div>
              ))}
              {setupItems.length < SETUP_ITEMS.length && (
                <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "11px 0" }}>
                  <Spin />
                  <span style={{ fontSize: 14, color: ink3 }}>
                    {SETUP_HINTS[setupItems.length] || "Working…"}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 2 — Done */}
        {step === 2 && (
          <div style={{ background: "#fff", borderRadius: 20, padding: "36px 36px 32px", boxShadow: "0 4px 24px rgba(15,26,18,0.08)" }}>
            <div style={{ textAlign: "center", marginBottom: 30 }}>
              <div style={{
                width: 56, height: 56, background: "#f0faf5", border: `2px solid ${green}`,
                borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 18px", fontSize: 22, color: green,
              }}>✓</div>
              <h1 style={{
                fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 30, fontWeight: 400,
                color: ink, margin: "0 0 8px", letterSpacing: "-0.01em",
              }}>
                You're ready.
              </h1>
              <p style={{ fontSize: 14, fontStyle: "italic", color: gold, margin: 0 }}>
                Every great organization starts here.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                onClick={handleLoadSample}
                disabled={loadingSample}
                style={{
                  width: "100%", background: gold, border: "none",
                  borderRadius: 12, padding: "14px 16px", color: "#fff",
                  fontSize: 14, fontWeight: 700,
                  cursor: loadingSample ? "not-allowed" : "pointer",
                  opacity: loadingSample ? 0.7 : 1, fontFamily: "inherit",
                }}
              >
                {loadingSample ? "Loading sample data…" : "Load sample data & explore →"}
              </button>
              <button
                onClick={() => navigate("/dashboard", { replace: true })}
                style={{
                  width: "100%", background: "transparent", border: `1.5px solid ${greenDk}`,
                  borderRadius: 12, padding: "14px 16px", color: greenDk,
                  fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Start with my real data →
              </button>
            </div>
          </div>
        )}

        {/* Step dots */}
        {step < 2 && (
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 22 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 6, height: 6, borderRadius: "50%",
                background: i === step ? greenDk : "#d1d5db",
                transition: "background 0.2s",
              }} />
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

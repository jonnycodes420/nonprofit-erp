import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, streamAI } from "../api";
import { useAuth } from "../main";

const QUESTIONS = [
  {
    key: "donorCount",
    q: "How many donors are in your network?",
    opts: [
      { label: "Just getting started", sub: "Under 25 donors", value: "under25" },
      { label: "Growing fast", sub: "25–100 donors", value: "25to100" },
      { label: "Established base", sub: "100–500 donors", value: "100to500" },
      { label: "Large community", sub: "500+ donors", value: "500plus" },
    ],
  },
  {
    key: "budget",
    q: "What's your approximate annual budget?",
    opts: [
      { label: "Under $100K", sub: "Early stage nonprofit", value: "under100k" },
      { label: "$100K – $500K", sub: "Growing organization", value: "100kto500k" },
      { label: "$500K – $2M", sub: "Mid-size nonprofit", value: "500kto2m" },
      { label: "$2M+", sub: "Established organization", value: "over2m" },
    ],
  },
  {
    key: "grantCount",
    q: "How many active grants are you managing?",
    opts: [
      { label: "None yet", sub: "Exploring grant funding", value: "none" },
      { label: "1–3 grants", sub: "Getting started with grants", value: "1to3" },
      { label: "4–10 grants", sub: "Active grant portfolio", value: "4to10" },
      { label: "10+ grants", sub: "Heavy grant reliance", value: "10plus" },
    ],
  },
  {
    key: "boardSize",
    q: "How large is your board of directors?",
    opts: [
      { label: "1–5 members", sub: "Founding board", value: "1to5" },
      { label: "6–10 members", sub: "Core board", value: "6to10" },
      { label: "11–20 members", sub: "Full board", value: "11to20" },
      { label: "20+ members", sub: "Large governance body", value: "20plus" },
    ],
  },
  {
    key: "tools",
    q: "What fundraising tools do you currently use?",
    opts: [
      { label: "Spreadsheets only", sub: "Excel / Google Sheets", value: "spreadsheets" },
      { label: "Basic CRM", sub: "Salesforce, HubSpot, etc.", value: "basiccrm" },
      { label: "Nonprofit CRM", sub: "Bloomerang, DonorPerfect, etc.", value: "nonprofitcrm" },
      { label: "Nothing formal", sub: "Starting from scratch", value: "nothing" },
    ],
  },
];

function OptionCard({ opt, selected, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: selected ? "#10b98111" : "#111827",
        border: `1px solid ${selected ? "#10b981" : "#1f2937"}`,
        borderRadius: 12,
        padding: "14px 18px",
        cursor: "pointer",
        transition: "all 0.15s",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{
        width: 18, height: 18, borderRadius: "50%",
        border: `2px solid ${selected ? "#10b981" : "#374151"}`,
        background: selected ? "#10b981" : "transparent",
        flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {selected && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#f3f4f6" }}>{opt.label}</div>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{opt.sub}</div>
      </div>
    </div>
  );
}

function Spin() {
  return (
    <>
      <style>{`@keyframes sp{to{transform:rotate(360deg)}}`}</style>
      <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid #fff4", borderTopColor: "#fff", borderRadius: "50%", animation: "sp 0.7s linear infinite" }} />
    </>
  );
}

export default function WelcomePage() {
  const { auth, refreshOrg } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState("");
  const aiRef = useRef(null);

  const orgName = auth?.org?.name || "your organization";
  const userName = auth?.user?.name || "";
  const totalSteps = QUESTIONS.length;
  const current = QUESTIONS[step];
  const allAnswered = QUESTIONS.every(q => answers[q.key]);

  const select = (key, val) => setAnswers(p => ({ ...p, [key]: val }));

  const next = () => {
    if (step < totalSteps - 1) { setStep(s => s + 1); return; }
    generateRecommendation();
  };

  const generateRecommendation = async () => {
    setStep(totalSteps);
    setAiLoading(true);
    setAiText("");
    setTimeout(() => aiRef.current?.scrollIntoView({ behavior: "smooth" }), 100);

    const systemPrompt = `You are a nonprofit strategy expert helping a new organization get set up with Steward, a nonprofit ERP. Be warm, specific, and encouraging. Keep your response to ~200 words.`;
    const userMessage = `A nonprofit called "${orgName}" just joined Steward. Here's their profile:
- Donors: ${answers.donorCount}
- Annual budget: ${answers.budget}
- Active grants: ${answers.grantCount}
- Board size: ${answers.boardSize}
- Current tools: ${answers.tools}

Write a personalized setup recommendation. Include:
1. What to focus on first in Steward (based on their profile)
2. One specific opportunity you see for them
3. An encouraging closing sentence

Be warm and specific to their situation.`;

    try {
      await streamAI(systemPrompt, userMessage, chunk => setAiText(chunk));
    } catch {
      setAiText("Welcome to Steward! We've set up your workspace with sample data scaled to your organization's size. Explore your dashboard to get started.");
    }
    setAiLoading(false);
  };

  const finish = async () => {
    setCompleting(true);
    setError("");
    try {
      await apiFetch("/onboarding/complete", {
        method: "POST",
        body: JSON.stringify({ answers }),
      });
      await refreshOrg();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message);
      setCompleting(false);
    }
  };

  const inp = { background: "#111827", border: "1px solid #1f2937", borderRadius: 14, padding: 20, marginBottom: 20 };

  return (
    <div style={{ minHeight: "100vh", background: "#030712", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',system-ui,sans-serif", padding: "32px 16px" }}>
      <div style={{ width: "100%", maxWidth: 520 }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 52, height: 52, background: "linear-gradient(135deg,#10b981,#3b82f6)", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 24 }}>◈</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#f9fafb", letterSpacing: "-0.02em" }}>
            Welcome{userName ? `, ${userName.split(" ")[0]}` : ""}!
          </div>
          <div style={{ fontSize: 14, color: "#6b7280", marginTop: 8 }}>
            Let's set up your workspace for <span style={{ color: "#10b981", fontWeight: 600 }}>{orgName}</span>
          </div>
        </div>

        {/* Progress bar */}
        {step < totalSteps && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "#6b7280" }}>Question {step + 1} of {totalSteps}</span>
              <span style={{ fontSize: 12, color: "#10b981", fontWeight: 600 }}>{Math.round(((step + 1) / totalSteps) * 100)}%</span>
            </div>
            <div style={{ height: 4, background: "#1f2937", borderRadius: 99 }}>
              <div style={{ height: "100%", borderRadius: 99, background: "linear-gradient(90deg,#10b981,#3b82f6)", width: `${((step + 1) / totalSteps) * 100}%`, transition: "width 0.3s" }} />
            </div>
          </div>
        )}

        {/* Question step */}
        {step < totalSteps && (
          <div style={inp}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#f9fafb", marginBottom: 20, lineHeight: 1.4 }}>{current.q}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {current.opts.map(opt => (
                <OptionCard
                  key={opt.value}
                  opt={opt}
                  selected={answers[current.key] === opt.value}
                  onClick={() => select(current.key, opt.value)}
                />
              ))}
            </div>
          </div>
        )}

        {/* AI Recommendation step */}
        {step >= totalSteps && (
          <div ref={aiRef}>
            <div style={{ ...inp, background: "linear-gradient(135deg,#1a0f3c,#0f172a)", border: "1px solid #7c3aed44" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8b5cf6", marginBottom: 12 }}>
                ✦ Your Personalized Setup
              </div>
              {aiLoading && !aiText && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#6b7280", fontSize: 13 }}>
                  <Spin /> Analyzing your organization…
                </div>
              )}
              {aiText && (
                <div style={{ fontSize: 14, color: "#e2e8f0", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{aiText}</div>
              )}
            </div>

            {!aiLoading && aiText && (
              <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 14, padding: 20, marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#10b981", marginBottom: 12 }}>What we're setting up for you</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    "Sample donors scaled to your network size",
                    "Grant pipeline matching your portfolio",
                    "Financial data seeded to your budget range",
                    "Tasks and board members ready to customize",
                  ].map(item => (
                    <div key={item} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, color: "#9ca3af" }}>
                      <span style={{ color: "#10b981", flexShrink: 0 }}>✓</span> {item}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ background: "#ef444422", border: "1px solid #ef444444", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#f87171", marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* Navigation buttons */}
        <div style={{ display: "flex", gap: 10 }}>
          {step > 0 && step < totalSteps && (
            <button
              onClick={() => setStep(s => s - 1)}
              style={{ background: "transparent", border: "1px solid #374151", borderRadius: 12, padding: "13px 20px", color: "#6b7280", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              ← Back
            </button>
          )}

          {step < totalSteps && (
            <button
              onClick={next}
              disabled={!answers[current?.key]}
              style={{
                flex: 1,
                background: answers[current?.key] ? "linear-gradient(135deg,#10b981,#3b82f6)" : "#1f2937",
                border: "none", borderRadius: 12, padding: "14px 16px",
                color: "#fff", fontSize: 15, fontWeight: 700,
                cursor: answers[current?.key] ? "pointer" : "not-allowed",
                opacity: answers[current?.key] ? 1 : 0.5,
              }}
            >
              {step === totalSteps - 1 ? "Generate My Setup →" : "Next →"}
            </button>
          )}

          {step >= totalSteps && !aiLoading && aiText && (
            <button
              onClick={finish}
              disabled={completing}
              style={{
                flex: 1,
                background: completing ? "#1f2937" : "linear-gradient(135deg,#10b981,#3b82f6)",
                border: "none", borderRadius: 12, padding: "14px 16px",
                color: "#fff", fontSize: 15, fontWeight: 700,
                cursor: completing ? "not-allowed" : "pointer",
                opacity: completing ? 0.7 : 1,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {completing ? <><Spin /> Setting up workspace…</> : "Enter My Workspace →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

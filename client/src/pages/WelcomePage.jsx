import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { useAuth } from "../main";

const FOCUS_OPTIONS = [
  { value: "donors",  label: "Donor Management",     sub: "Track relationships, gifts & pipelines" },
  { value: "grants",  label: "Grant Tracking",       sub: "Manage funders, deadlines & reports" },
  { value: "finance", label: "Financial Management", sub: "Bookkeeping, budgets & fund accounting" },
  { value: "all",     label: "All of the above",     sub: "Get the full picture from day one" },
];

const SETUP_ITEMS = [
  "Standard chart of accounts (26 accounts)",
  "General Operating fund",
  "Donor pipeline (6 stages)",
  "Workspace configured",
];

function Spin() {
  return (
    <>
      <style>{`@keyframes sp{to{transform:rotate(360deg)}}`}</style>
      <span style={{ display:"inline-block", width:15, height:15, border:"2px solid #1f2937", borderTopColor:"#10b981", borderRadius:"50%", animation:"sp 0.8s linear infinite", flexShrink:0 }} />
    </>
  );
}

export default function WelcomePage() {
  const { auth, refreshOrg } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0); // 0=welcome, 1=setup, 2=done
  const [focus, setFocus] = useState("");
  const [error, setError] = useState("");
  const [setupItems, setSetupItems] = useState([]);
  const focusRef = useRef(focus);

  const orgName  = auth?.org?.name             || "your organization";
  const userName = auth?.user?.name?.split(" ")[0] || "";

  // Redirect already-onboarded users
  useEffect(() => {
    if (auth?.org?.onboarding_complete) navigate("/dashboard", { replace: true });
  }, [auth]);

  // Step 1: run setup
  useEffect(() => {
    if (step !== 1) return;
    let cancelled = false;

    const run = async () => {
      setSetupItems([]);

      // Start API call immediately, in parallel with animation
      const apiCall = apiFetch("/onboarding/complete", {
        method: "POST",
        body: JSON.stringify({ focus: focusRef.current }),
      }).then(() => refreshOrg());

      // Animate first 3 items while API works
      for (let i = 0; i < SETUP_ITEMS.length - 1; i++) {
        await new Promise(r => setTimeout(r, 480));
        if (cancelled) return;
        setSetupItems(prev => [...prev, SETUP_ITEMS[i]]);
      }

      // Wait for API to finish
      await apiCall;
      if (cancelled) return;

      // Show last item then advance
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

  const card = { background:"#111827", border:"1px solid #1f2937", borderRadius:14, padding:20, marginBottom:20 };

  return (
    <div style={{ minHeight:"100vh", background:"#030712", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',system-ui,sans-serif", padding:"32px 16px" }}>
      <div style={{ width:"100%", maxWidth:500 }}>

        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ width:52, height:52, background:"linear-gradient(135deg,#10b981,#3b82f6)", borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px", fontSize:24 }}>◈</div>
        </div>

        {/* Step 0: Focus selection */}
        {step === 0 && (
          <>
            <div style={{ textAlign:"center", marginBottom:28 }}>
              <div style={{ fontSize:26, fontWeight:800, color:"#f9fafb", letterSpacing:"-0.02em" }}>
                Welcome{userName ? `, ${userName}` : ""}!
              </div>
              <div style={{ fontSize:14, color:"#6b7280", marginTop:8 }}>
                Let's get <span style={{ color:"#10b981", fontWeight:600 }}>{orgName}</span> set up — takes about 30 seconds.
              </div>
            </div>

            <div style={card}>
              <div style={{ fontSize:15, fontWeight:700, color:"#f9fafb", marginBottom:16 }}>
                What will you focus on first?
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {FOCUS_OPTIONS.map(opt => (
                  <div
                    key={opt.value}
                    onClick={() => setFocus(opt.value)}
                    style={{
                      background: focus === opt.value ? "#10b98111" : "#0d1117",
                      border: `1px solid ${focus === opt.value ? "#10b981" : "#1f2937"}`,
                      borderRadius:10, padding:"12px 16px", cursor:"pointer",
                      display:"flex", alignItems:"center", gap:12, transition:"all 0.15s",
                    }}
                  >
                    <div style={{
                      width:18, height:18, borderRadius:"50%", flexShrink:0,
                      border: `2px solid ${focus === opt.value ? "#10b981" : "#374151"}`,
                      background: focus === opt.value ? "#10b981" : "transparent",
                      display:"flex", alignItems:"center", justifyContent:"center",
                    }}>
                      {focus === opt.value && <div style={{ width:6, height:6, borderRadius:"50%", background:"#fff" }} />}
                    </div>
                    <div>
                      <div style={{ fontSize:14, fontWeight:600, color:"#f3f4f6" }}>{opt.label}</div>
                      <div style={{ fontSize:12, color:"#6b7280", marginTop:2 }}>{opt.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <div style={{ background:"#ef444422", border:"1px solid #ef444444", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#f87171", marginBottom:16 }}>{error}</div>
            )}

            <button
              onClick={handleStart}
              disabled={!focus}
              style={{
                width:"100%",
                background: focus ? "linear-gradient(135deg,#10b981,#3b82f6)" : "#1f2937",
                border:"none", borderRadius:12, padding:"14px 16px",
                color:"#fff", fontSize:15, fontWeight:700,
                cursor: focus ? "pointer" : "not-allowed", opacity: focus ? 1 : 0.5,
              }}
            >
              Set Up My Workspace →
            </button>
          </>
        )}

        {/* Step 1: Setup in progress */}
        {step === 1 && (
          <div style={{ textAlign:"center" }}>
            <div style={{ marginBottom:28 }}>
              <div style={{ fontSize:22, fontWeight:800, color:"#f9fafb", letterSpacing:"-0.02em", marginBottom:8 }}>
                Setting up your workspace
              </div>
              <div style={{ fontSize:14, color:"#6b7280" }}>Just a moment…</div>
            </div>

            <div style={{ ...card, textAlign:"left" }}>
              {setupItems.map((item, i) => (
                <div key={i} style={{ display:"flex", gap:12, alignItems:"center", padding:"9px 0", borderBottom: i < setupItems.length - 1 ? "1px solid #1f2937" : "none" }}>
                  <span style={{ color:"#10b981", fontWeight:700, fontSize:15, flexShrink:0 }}>✓</span>
                  <span style={{ fontSize:14, color:"#d1d5db" }}>{item}</span>
                </div>
              ))}
              {setupItems.length < SETUP_ITEMS.length && (
                <div style={{ display:"flex", gap:12, alignItems:"center", padding:"9px 0" }}>
                  <Spin />
                  <span style={{ fontSize:14, color:"#6b7280" }}>
                    {["Configuring accounts…","Creating fund…","Finalizing setup…"][setupItems.length] || "Working…"}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Done */}
        {step === 2 && (
          <>
            <div style={{ textAlign:"center", marginBottom:28 }}>
              <div style={{ width:56, height:56, background:"#10b98118", border:"1px solid #10b98140", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px", fontSize:26, color:"#10b981" }}>◈</div>
              <div style={{ fontSize:24, fontWeight:800, color:"#f9fafb", letterSpacing:"-0.02em" }}>You're all set!</div>
              <div style={{ fontSize:14, color:"#6b7280", marginTop:8 }}>
                <span style={{ color:"#10b981", fontWeight:600 }}>{orgName}</span> is ready. Start by adding your first donor.
              </div>
            </div>

            <div style={card}>
              <div style={{ fontSize:11, fontWeight:700, color:"#10b981", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:14 }}>What's ready</div>
              {[
                "Standard chart of accounts (26 accounts)",
                "General Operating fund",
                "Donor pipeline — 6 stages: Prospect through Steward",
                "Grant tracker, volunteer log, task queue",
                "AI assistant ready to help across every module",
              ].map(item => (
                <div key={item} style={{ display:"flex", gap:10, alignItems:"flex-start", fontSize:13, color:"#9ca3af", marginBottom:10 }}>
                  <span style={{ color:"#10b981", flexShrink:0, fontWeight:700 }}>✓</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => navigate("/dashboard", { replace:true })}
              style={{
                width:"100%",
                background:"linear-gradient(135deg,#10b981,#3b82f6)",
                border:"none", borderRadius:12, padding:"14px 16px",
                color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer",
              }}
            >
              Enter My Workspace →
            </button>
          </>
        )}

        {/* Step indicator */}
        <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:24 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ width:8, height:8, borderRadius:"50%", background: step >= i ? "#10b981" : "#1f2937", transition:"all 0.3s" }} />
          ))}
        </div>

      </div>
    </div>
  );
}

import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { useAuth } from "../main";
import { DonorImport } from "../components/Donors";

// 5 real, numbered steps. A guided-tour step is intentionally NOT included
// here — there is currently no tour component in this codebase (it was
// deleted in an earlier session; see PROGRESS.md's superseded "Guided tour"
// entry) and rebuilding one is out of scope for this change. If/when a tour
// is rebuilt, it slots in here as step 6, after impact metrics and before
// the finishing animation.
const TOTAL_STEPS = 5;
const STEP_LABELS = ["Org basics", "Import your donors", "Set your first goal", "Your first impact metric", "Launch"];

const FINISH_ITEMS = [
  "Standard chart of accounts (26 accounts)",
  "General Operating fund",
  "Workspace configured",
];
const FINISH_HINTS = ["Configuring accounts…", "Finalizing setup…", "Almost done…"];

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

function defaultOutcomeTemplate(orgName) {
  // Literal "${amount}" / "{n}" placeholders — NOT JS interpolation. The
  // impact-metrics backend parses these tokens itself (see
  // generateMilestoneDraft() / the Impact Summary PDF route in server.js).
  const name = orgName && orgName.trim() ? orgName.trim() : "our organization";
  return "Your ${amount} gift helps power " + name + "'s work in the community.";
}

function defaultPeriod() {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 90);
  return { periodStart: start.toISOString().split("T")[0], periodEnd: end.toISOString().split("T")[0] };
}

export default function WelcomePage() {
  const { auth, refreshOrg } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [phase, setPhase] = useState("form"); // step 5 only: "finishing" | "ready"
  const [error, setError] = useState("");

  // Step 1 — org basics
  const [orgName, setOrgName] = useState(auth?.org?.name || "");
  const [mission, setMission] = useState(auth?.org?.mission || "");
  const [savingBasics, setSavingBasics] = useState(false);

  // Step 2 — import
  const [showImportModal, setShowImportModal] = useState(false);
  const [donorsSnapshot, setDonorsSnapshot] = useState([]);
  const [importSkipped, setImportSkipped] = useState(false);
  const [loadingDonors, setLoadingDonors] = useState(false);

  // Step 3 — goal
  const [goalForm, setGoalForm] = useState({ label: "", goalAmount: "", goalType: "total_raised", ...defaultPeriod() });
  const [goalPrefilled, setGoalPrefilled] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);

  // Step 4 — impact metric(s)
  const [metric1, setMetric1] = useState({ name: "Everyday Impact", dollarThreshold: "100", outcomeTemplate: defaultOutcomeTemplate(auth?.org?.name) });
  const [showMetric2, setShowMetric2] = useState(false);
  const [metric2, setMetric2] = useState({ name: "", dollarThreshold: "", outcomeTemplate: "" });
  const [savingMetrics, setSavingMetrics] = useState(false);

  // Step 5 — finishing animation + ready screen
  const [setupItems, setSetupItems] = useState([]);
  const [loadingSample, setLoadingSample] = useState(false);

  // Mount-only guard: if someone lands on /welcome while already onboarded,
  // send them to their dashboard. Deliberately NOT watching `auth` reactively
  // (the original version did, via `[auth]`) — refreshOrg() inside
  // runFinish() below updates the auth context with onboarding_complete:1
  // partway through step 5, and a reactive effect fired on that update
  // immediately, hijacking the navigation before the "ready" screen (and
  // its conditional "Load sample data" button) ever rendered. Confirmed
  // live: this same latent bug existed in the original 3-step flow too, but
  // was invisible there because both of its step-2 buttons led to
  // /dashboard anyway — it only became a visible, real bug once "ready" had
  // a meaningful conditional choice on it.
  useEffect(() => {
    if (auth?.org?.onboarding_complete) navigate("/dashboard", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A suggested goal, computed from whatever just got imported — donors who
  // read as lapsed (real win-back opportunity) take priority over a flat
  // "match what you've raised" suggestion, matching the existing product's
  // "lapsed_recovery" vs "total_raised" goal types.
  const suggestion = useMemo(() => {
    if (!donorsSnapshot.length) return null;
    const lapsed = donorsSnapshot.filter(d => d.stage === "lapsed");
    const lapsedTotal = Math.round(lapsed.reduce((s, d) => s + (Number(d.total_giving) || 0), 0));
    if (lapsedTotal > 0) {
      return { goalType: "lapsed_recovery", amount: lapsedTotal, label: `Win back $${lapsedTotal.toLocaleString()} in lapsed giving` };
    }
    const total = Math.round(donorsSnapshot.reduce((s, d) => s + (Number(d.total_giving) || 0), 0));
    if (total > 0) {
      return { goalType: "total_raised", amount: total, label: `Raise $${total.toLocaleString()} this quarter` };
    }
    return null;
  }, [donorsSnapshot]);

  useEffect(() => {
    if (step === 3 && suggestion && !goalPrefilled) {
      setGoalForm(f => ({ ...f, label: suggestion.label, goalAmount: String(suggestion.amount), goalType: suggestion.goalType }));
      setGoalPrefilled(true);
    }
  }, [step, suggestion, goalPrefilled]);

  // ── Step 1: org basics ──
  async function submitBasics() {
    if (!orgName.trim()) { setError("Organization name is required."); return; }
    setSavingBasics(true); setError("");
    try {
      await apiFetch(`/orgs/${auth.org.id}`, { method: "PATCH", body: JSON.stringify({ name: orgName.trim(), mission: mission.trim() }) });
      await refreshOrg();
      setMetric1(m => ({ ...m, outcomeTemplate: defaultOutcomeTemplate(orgName) }));
      setStep(2);
    } catch (e) { setError(e.message || "Could not save — please try again."); }
    setSavingBasics(false);
  }

  // ── Step 2: import (or skip) ──
  async function afterImportDone() {
    setShowImportModal(false);
    setLoadingDonors(true);
    try {
      const donors = await apiFetch("/donors");
      setDonorsSnapshot(donors || []);
    } catch { setDonorsSnapshot([]); }
    setLoadingDonors(false);
    setStep(3);
  }
  function skipImport() {
    setImportSkipped(true);
    setStep(3);
  }

  // ── Step 3: goal ──
  async function submitGoal() {
    if (!goalForm.label.trim() || !goalForm.goalAmount) { setError("Give your goal a label and a target amount."); return; }
    setSavingGoal(true); setError("");
    try {
      await apiFetch("/goals", { method: "POST", body: JSON.stringify(goalForm) });
      setStep(4);
    } catch (e) { setError(e.message || "Could not save — please try again."); }
    setSavingGoal(false);
  }

  // ── Step 4: impact metric(s) ──
  async function submitMetrics() {
    if (!metric1.name.trim() || !metric1.dollarThreshold || !metric1.outcomeTemplate.trim()) {
      setError("Fill in your first impact metric to continue."); return;
    }
    setSavingMetrics(true); setError("");
    try {
      await apiFetch("/impact-metrics", { method: "POST", body: JSON.stringify(metric1) });
      if (showMetric2 && metric2.name.trim() && metric2.dollarThreshold && metric2.outcomeTemplate.trim()) {
        await apiFetch("/impact-metrics", { method: "POST", body: JSON.stringify(metric2) });
      }
      setStep(5);
      runFinish();
    } catch (e) { setError(e.message || "Could not save — please try again."); }
    setSavingMetrics(false);
  }

  // ── Step 5: finish (structural seed) then ready screen ──
  async function runFinish() {
    setPhase("finishing"); setSetupItems([]);
    const apiCall = apiFetch("/onboarding/complete", { method: "POST", body: JSON.stringify({}) }).then(refreshOrg);
    for (let i = 0; i < FINISH_ITEMS.length - 1; i++) {
      await new Promise(r => setTimeout(r, 420));
      setSetupItems(prev => [...prev, FINISH_ITEMS[i]]);
    }
    await apiCall;
    setSetupItems([...FINISH_ITEMS]);
    await new Promise(r => setTimeout(r, 350));
    setPhase("ready");
  }

  async function handleLoadSample() {
    setLoadingSample(true);
    try { await apiFetch("/org/load-sample-data", { method: "POST" }); } catch {}
    navigate("/dashboard", { replace: true });
  }

  const ink = "#0f1a12";
  const ink3 = "#6b7280";
  const greenDk = "#1a6b4a";
  const green = "#10b981";
  const gold = "#c9a84c";

  const card = { background: "#fff", borderRadius: 20, padding: "36px 36px 32px", boxShadow: "0 4px 24px rgba(15,26,18,0.08)" };
  const inp = { width: "100%", boxSizing: "border-box", border: "1px solid #e5e7eb", borderRadius: 10, padding: "11px 14px", fontSize: 14, color: ink, background: "#f9f8f6", outline: "none", fontFamily: "inherit" };
  const label = { fontSize: 12, fontWeight: 700, color: ink3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 };
  const primaryBtn = (disabled) => ({
    width: "100%", background: disabled ? "#e5e7eb" : greenDk, border: "none", borderRadius: 12,
    padding: "14px 16px", color: disabled ? "#9ca3af" : "#fff", fontSize: 15, fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", transition: "all 0.15s",
  });

  return (
    <div style={{
      minHeight: "100vh", background: "#f0ede6",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Sans',system-ui,sans-serif", padding: "32px 16px",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet" />
      <div style={{ width: "100%", maxWidth: 500 }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
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

        {/* Progress: Step X of 5 */}
        {!(step === 5 && phase === "ready") && (
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              Step {step} of {TOTAL_STEPS} — {STEP_LABELS[step - 1]}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
              {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                <div key={i} style={{ width: 28, height: 4, borderRadius: 2, background: i < step ? greenDk : "#e5e7eb", transition: "background 0.2s" }} />
              ))}
            </div>
          </div>
        )}

        {/* Step 1 — Org basics */}
        {step === 1 && (
          <div style={card}>
            <h1 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 26, fontWeight: 400, color: ink, margin: "0 0 6px", letterSpacing: "-0.01em" }}>
              Tell us about your organization
            </h1>
            <p style={{ fontSize: 14, color: ink3, margin: "0 0 24px" }}>Quick — just the basics.</p>

            <div style={{ marginBottom: 16 }}>
              <div style={label}>Organization name</div>
              <input value={orgName} onChange={e => setOrgName(e.target.value)} style={inp} placeholder="e.g. Creo Arts"/>
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={label}>Mission or tagline</div>
              <textarea value={mission} onChange={e => setMission(e.target.value)} rows={3} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }}
                placeholder="e.g. Transformative arts education for underserved youth"/>
              <div style={{ fontSize: 11, color: ink3, marginTop: 5 }}>Used to personalize your AI-drafted communications and reports.</div>
            </div>

            {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 16 }}>{error}</div>}

            <button onClick={submitBasics} disabled={savingBasics || !orgName.trim()} style={primaryBtn(savingBasics || !orgName.trim())}>
              {savingBasics ? "Saving…" : "Continue →"}
            </button>
          </div>
        )}

        {/* Step 2 — Import donors */}
        {step === 2 && (
          <div style={card}>
            <h1 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 26, fontWeight: 400, color: ink, margin: "0 0 6px", letterSpacing: "-0.01em" }}>
              Import your donors
            </h1>
            <p style={{ fontSize: 14, color: ink3, margin: "0 0 22px", lineHeight: 1.6 }}>
              This is the single biggest thing you can do right now — your home screen (queue, goals, funnel) only
              gets useful once there's real donor data behind it. Bring a spreadsheet from your current system, a
              bank/CRM export, or even a rough list — Steward auto-maps common columns (name, email, giving total,
              last gift date) and handles messy rows gracefully.
            </p>

            {donorsSnapshot.length > 0 ? (
              <div style={{ background: "#f0faf5", border: "1px solid #bbf7d0", borderRadius: 12, padding: "16px 18px", marginBottom: 20, textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: greenDk, marginBottom: 2 }}>✓ {donorsSnapshot.length.toLocaleString()} donor{donorsSnapshot.length === 1 ? "" : "s"} imported</div>
                <div style={{ fontSize: 12, color: ink3 }}>You can import more anytime from Donors → Import.</div>
              </div>
            ) : (
              <button onClick={() => setShowImportModal(true)} style={{ ...primaryBtn(false), background: "linear-gradient(135deg,#10b981,#3b82f6)", marginBottom: 12 }}>
                Import a CSV or Excel file →
              </button>
            )}

            {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 12 }}>{error}</div>}

            {donorsSnapshot.length > 0 ? (
              <button onClick={() => setStep(3)} style={primaryBtn(false)}>Continue →</button>
            ) : (
              <div style={{ textAlign: "center" }}>
                <button onClick={skipImport} disabled={loadingDonors} style={{ background: "none", border: "none", color: ink3, fontSize: 13, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
                  {loadingDonors ? "One moment…" : "I don't have a list ready yet — I'll do this later"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 3 — Set first goal */}
        {step === 3 && (
          <div style={card}>
            <h1 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 26, fontWeight: 400, color: ink, margin: "0 0 6px", letterSpacing: "-0.01em" }}>
              Set your first goal
            </h1>
            <p style={{ fontSize: 14, color: ink3, margin: "0 0 22px", lineHeight: 1.6 }}>
              {suggestion
                ? "Based on the donors you just imported, here's a real starting point — edit anything you'd like."
                : "One goal to start tracking against. You can add more anytime from your home screen."}
            </p>

            <div style={{ marginBottom: 14 }}>
              <div style={label}>Label</div>
              <input value={goalForm.label} onChange={e => setGoalForm(f => ({ ...f, label: e.target.value }))} style={inp} placeholder="e.g. Raise $25,000 this quarter"/>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={label}>Target amount ($)</div>
              <input type="number" value={goalForm.goalAmount} onChange={e => setGoalForm(f => ({ ...f, goalAmount: e.target.value }))} style={inp} placeholder="25000"/>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={label}>Goal type</div>
              <div style={{ display: "flex", gap: 8 }}>
                {[["total_raised", "Total raised"], ["lapsed_recovery", "Lapsed recovery"]].map(([v, l]) => (
                  <button key={v} onClick={() => setGoalForm(f => ({ ...f, goalType: v }))}
                    style={{ flex: 1, background: goalForm.goalType === v ? greenDk + "18" : "#f9f8f6", border: `1px solid ${goalForm.goalType === v ? greenDk : "#e5e7eb"}`, borderRadius: 8, padding: "9px", color: goalForm.goalType === v ? greenDk : ink3, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <div style={label}>Period start</div>
                <input type="date" value={goalForm.periodStart} onChange={e => setGoalForm(f => ({ ...f, periodStart: e.target.value }))} style={inp}/>
              </div>
              <div style={{ flex: 1 }}>
                <div style={label}>Period end</div>
                <input type="date" value={goalForm.periodEnd} onChange={e => setGoalForm(f => ({ ...f, periodEnd: e.target.value }))} style={inp}/>
              </div>
            </div>

            {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 16 }}>{error}</div>}

            <button onClick={submitGoal} disabled={savingGoal || !goalForm.label.trim() || !goalForm.goalAmount} style={primaryBtn(savingGoal || !goalForm.label.trim() || !goalForm.goalAmount)}>
              {savingGoal ? "Saving…" : "Continue →"}
            </button>
          </div>
        )}

        {/* Step 4 — First impact metric */}
        {step === 4 && (
          <div style={card}>
            <h1 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 26, fontWeight: 400, color: ink, margin: "0 0 6px", letterSpacing: "-0.01em" }}>
              Define your first impact metric
            </h1>
            <p style={{ fontSize: 14, color: ink3, margin: "0 0 20px", lineHeight: 1.6 }}>
              This is what turns a donor's gift into a concrete outcome in milestone thank-yous. We've started you
              off with a template — edit it to fit your program.
            </p>

            <div style={{ marginBottom: 14 }}>
              <div style={label}>Metric name</div>
              <input value={metric1.name} onChange={e => setMetric1(m => ({ ...m, name: e.target.value }))} style={inp}/>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={label}>Cumulative giving threshold ($)</div>
              <input type="number" value={metric1.dollarThreshold} onChange={e => setMetric1(m => ({ ...m, dollarThreshold: e.target.value }))} style={inp}/>
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={label}>Outcome template</div>
              <textarea value={metric1.outcomeTemplate} onChange={e => setMetric1(m => ({ ...m, outcomeTemplate: e.target.value }))} rows={3} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }}/>
              <div style={{ fontSize: 11, color: ink3, marginTop: 5 }}>
                Use <code>{"${amount}"}</code> for the donor's cumulative giving and <code>{"{n}"}</code> for how many times this threshold has been covered.
              </div>
            </div>

            {!showMetric2 ? (
              <button onClick={() => { setShowMetric2(true); setMetric2({ name: "", dollarThreshold: "", outcomeTemplate: "" }); }}
                style={{ background: "none", border: "none", color: greenDk, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0, marginBottom: 20 }}>
                + Add another metric (optional)
              </button>
            ) : (
              <div style={{ background: "#f9f8f6", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: ink, textTransform: "uppercase", letterSpacing: "0.06em" }}>Second metric (optional)</div>
                  <button onClick={() => setShowMetric2(false)} style={{ background: "none", border: "none", color: ink3, fontSize: 16, cursor: "pointer", lineHeight: 1 }}>×</button>
                </div>
                <input value={metric2.name} onChange={e => setMetric2(m => ({ ...m, name: e.target.value }))} placeholder="e.g. Full-Year Scholarship" style={{ ...inp, marginBottom: 8 }}/>
                <input type="number" value={metric2.dollarThreshold} onChange={e => setMetric2(m => ({ ...m, dollarThreshold: e.target.value }))} placeholder="e.g. 2500" style={{ ...inp, marginBottom: 8 }}/>
                <textarea value={metric2.outcomeTemplate} onChange={e => setMetric2(m => ({ ...m, outcomeTemplate: e.target.value }))} rows={2} placeholder="e.g. Your ${amount} has covered {n} full-year scholarships" style={{ ...inp, resize: "vertical", lineHeight: 1.5 }}/>
              </div>
            )}

            {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 16 }}>{error}</div>}

            <button onClick={submitMetrics} disabled={savingMetrics || !metric1.name.trim() || !metric1.dollarThreshold || !metric1.outcomeTemplate.trim()}
              style={primaryBtn(savingMetrics || !metric1.name.trim() || !metric1.dollarThreshold || !metric1.outcomeTemplate.trim())}>
              {savingMetrics ? "Saving…" : "Continue →"}
            </button>
          </div>
        )}

        {/* Step 5 — Finishing animation, then ready */}
        {step === 5 && phase === "finishing" && (
          <div style={card}>
            <h1 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 24, fontWeight: 400, color: ink, margin: "0 0 6px", letterSpacing: "-0.01em", textAlign: "center" }}>
              Finishing setup…
            </h1>
            <p style={{ fontSize: 13, color: ink3, margin: "0 0 28px", textAlign: "center" }}>Just a moment.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {setupItems.map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: "11px 0", borderBottom: i < setupItems.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                  <span style={{ color: green, fontWeight: 800, fontSize: 14, flexShrink: 0 }}>✓</span>
                  <span style={{ fontSize: 14, color: ink }}>{item}</span>
                </div>
              ))}
              {setupItems.length < FINISH_ITEMS.length && (
                <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "11px 0" }}>
                  <Spin/>
                  <span style={{ fontSize: 14, color: ink3 }}>{FINISH_HINTS[setupItems.length] || "Working…"}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 5 && phase === "ready" && (
          <div style={card}>
            <div style={{ textAlign: "center", marginBottom: 30 }}>
              <div style={{ width: 56, height: 56, background: "#f0faf5", border: `2px solid ${green}`, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", fontSize: 22, color: green }}>✓</div>
              <h1 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 30, fontWeight: 400, color: ink, margin: "0 0 8px", letterSpacing: "-0.01em" }}>You're ready.</h1>
              <p style={{ fontSize: 14, fontStyle: "italic", color: gold, margin: 0 }}>Every great organization starts here.</p>
              <div style={{ fontSize: 13, color: ink3, marginTop: 14, lineHeight: 1.7 }}>
                {donorsSnapshot.length > 0
                  ? <>{donorsSnapshot.length.toLocaleString()} donor{donorsSnapshot.length === 1 ? "" : "s"} imported · 1 goal set · {showMetric2 ? "2 impact metrics" : "1 impact metric"} configured</>
                  : <>1 goal set · {showMetric2 ? "2 impact metrics" : "1 impact metric"} configured</>}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {importSkipped && donorsSnapshot.length === 0 && (
                <button onClick={handleLoadSample} disabled={loadingSample} style={{ width: "100%", background: gold, border: "none", borderRadius: 12, padding: "14px 16px", color: "#fff", fontSize: 14, fontWeight: 700, cursor: loadingSample ? "not-allowed" : "pointer", opacity: loadingSample ? 0.7 : 1, fontFamily: "inherit" }}>
                  {loadingSample ? "Loading sample data…" : "Load sample data & explore →"}
                </button>
              )}
              <button onClick={() => navigate("/dashboard", { replace: true })}
                style={{ width: "100%", background: greenDk, border: "none", borderRadius: 12, padding: "14px 16px", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Go to my home screen →
              </button>
            </div>
          </div>
        )}

      </div>

      {showImportModal && <DonorImport onClose={() => setShowImportModal(false)} onImported={afterImportDone}/>}
    </div>
  );
}

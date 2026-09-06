import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { useAuth } from "../main";
import { DonorImport } from "../components/Donors";
import { T } from "../components/shared";

// The onboarding flow is a KEYED sequence, not a fixed numeric ladder, so a
// Team org can slot in an extra "Invite your team" step while Core skips it
// (plan gating). The active flow is computed from `isTeam` in the component.
// A guided-tour step is intentionally NOT included — there is no tour component
// in this codebase (deleted in an earlier session; see PROGRESS.md's superseded
// "Guided tour" entry). If/when one is rebuilt it slots in before "launch".
// Honest per-step time estimates (BUILD-08 Phase D) — shown beside the label so
// nobody wonders how deep this rabbit hole goes.
const STEP_META = {
  basics: { label: "Org basics",               time: "~1 min" },
  invite: { label: "Invite your team",         time: "~1 min" }, // Team plan only
  import: { label: "Import your donors",       time: "~2 min" },
  goal:   { label: "Set your first goal",      time: "~1 min" },
  metric: { label: "Your first impact metric", time: "~1 min" },
  launch: { label: "Launch",                   time: "~1 min" },
};

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

  const [stepKey, setStepKey] = useState("basics");
  const [phase, setPhase] = useState("form"); // launch step only: "finishing" | "ready"
  const [error, setError] = useState("");

  // Plan gating: Team orgs get the "Invite your team" step; Core skips it. Tier
  // is probed on mount (the same `/portfolio/officers` source the app uses); a
  // fresh trial reads as Team (full-feature trial), so a Team evaluator sees it.
  const [isTeam, setIsTeam] = useState(false);
  const flow = useMemo(
    () => ["basics", ...(isTeam ? ["invite"] : []), "import", "goal", "metric", "launch"],
    [isTeam]
  );
  const stepIdx = Math.max(0, flow.indexOf(stepKey));
  const go = (key) => { setError(""); setStepKey(key); };
  const goNext = () => { const i = flow.indexOf(stepKey); go(flow[Math.min(i + 1, flow.length - 1)]); };

  // Step: Invite your team (Team only)
  const [officerEmails, setOfficerEmails] = useState([""]);
  const [invSending, setInvSending] = useState(false);
  const [invited, setInvited] = useState(null);   // [{email, ok, error}] once sent
  const [seatMsg, setSeatMsg] = useState("");

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
    // Load any donors that already exist (someone returning mid-flow, or an
    // import from another tab) so the import step shows the imported state
    // instead of re-asking for a list that's already in.
    apiFetch("/donors/summaries").then(d => setDonorsSnapshot(d || [])).catch(() => {});
    // Plan tier → whether the Team "Invite your team" step is in the flow.
    apiFetch("/portfolio/officers").then(r => setIsTeam(r?.tier === "team")).catch(() => {});

  }, []);

  // A suggested goal, computed from whatever just got imported — donors who
  // read as lapsed (real win-back opportunity) take priority over a flat
  // "match what you've raised" suggestion, matching the existing product's
  // "lapsed_recovery" vs "total_raised" goal types.
  const [importHealth, setImportHealth] = useState(null);
  useEffect(() => {
    apiFetch("/org/import-health").then(setImportHealth).catch(() => setImportHealth(null));
  }, []);
  const suggestion = useMemo(() => {
    if (!donorsSnapshot.length) return null;
    // BUILD-80 Part 9 — no goal is auto-set from an unbalanced import. "Win
    // back $604,337 in lapsed giving" was once computed from a file where
    // half the gifts were refused and one was a hundred times too large.
    if (importHealth?.caveat) return null;
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
  }, [donorsSnapshot, importHealth]);

  useEffect(() => {
    if (stepKey === "goal" && suggestion && !goalPrefilled) {
      setGoalForm(f => ({ ...f, label: suggestion.label, goalAmount: String(suggestion.amount), goalType: suggestion.goalType }));
      setGoalPrefilled(true);
    }
  }, [stepKey, suggestion, goalPrefilled]);

  // ── Step 1: org basics ──
  async function submitBasics() {
    if (!orgName.trim()) { setError("Organization name is required."); return; }
    setSavingBasics(true); setError("");
    try {
      await apiFetch(`/orgs/${auth.org.id}`, { method: "PATCH", body: JSON.stringify({ name: orgName.trim(), mission: mission.trim() }) });
      await refreshOrg();
      setMetric1(m => ({ ...m, outcomeTemplate: defaultOutcomeTemplate(orgName) }));
      goNext();
    } catch (e) { setError(e.message || "Could not save — please try again."); }
    setSavingBasics(false);
  }

  // ── Step: Invite your team (Team only) ──
  // Reuses the SAME Settings › Team invite path (POST /auth/invite), so there's
  // one invite mechanism, not a fork. Officers are invited as "staff"; each gets
  // an org seat + a portfolio when they accept. Seat-limited (Team = up to 10);
  // fully skippable ("invite later from Settings › Team").
  async function sendInvites() {
    const emails = officerEmails.map(e => e.trim()).filter(Boolean);
    if (!emails.length) { goNext(); return; }
    setInvSending(true); setError(""); setSeatMsg("");
    const results = [];
    for (const email of emails) {
      try {
        await apiFetch("/auth/invite", { method: "POST", body: JSON.stringify({ email, role: "staff" }) });
        results.push({ email, ok: true });
      } catch (e) {
        if (e.error === "seat_limit") { setSeatMsg(e.message || "You've reached your seat limit — Team includes up to 10 users."); results.push({ email, ok: false, error: "seat limit" }); }
        else results.push({ email, ok: false, error: e.message || "couldn't send" });
      }
    }
    setInvited(results);
    setInvSending(false);
  }

  // ── Step 2: import (or skip) ──
  // On a successful import we deliberately STAY on step 2 rather than
  // auto-advancing (which the flow used to do — meaning the success state
  // was never actually seen): the gold "safely home" moment renders and the
  // user clicks Continue themselves. One beat of celebration, then onward.
  async function afterImportDone() {
    setShowImportModal(false);
    setLoadingDonors(true);
    try {
      const donors = await apiFetch("/donors/summaries");
      setDonorsSnapshot(donors || []);
    } catch { setDonorsSnapshot([]); }
    setLoadingDonors(false);
  }
  function skipImport() {
    setImportSkipped(true);
    goNext();
  }

  // ── Step 3: goal ──
  async function submitGoal() {
    if (!goalForm.label.trim() || !goalForm.goalAmount) { setError("Give your goal a label and a target amount."); return; }
    setSavingGoal(true); setError("");
    try {
      await apiFetch("/goals", { method: "POST", body: JSON.stringify(goalForm) });
      goNext();
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
      go("launch");
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

  // Steward brand system (BUILD-12 tokens) — cream / forest green / gold, no
  // gradients, no off-palette blue. `greenDk` keeps its name (points at the
  // brand green) to limit churn across the existing green accent/toggle refs.
  const ink = T.ink;
  const ink3 = T.ink3;
  const greenDk = T.greenMid;   // green links, toggles, secondary accents
  const green = T.green;        // ✓ marks / positive
  const gold = T.gold500;

  const card = { background: T.white, borderRadius: 20, padding: "36px 36px 32px", boxShadow: T.shadowMd };
  const inp = { width: "100%", boxSizing: "border-box", border: `1px solid ${T.bg3}`, borderRadius: 10, padding: "11px 14px", fontSize: 14, color: ink, background: T.bg, outline: "none", fontFamily: "inherit" };
  const label = { fontSize: 12, fontWeight: 700, color: ink3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 };
  // Primary CTA — solid gold with ink text on every step (matches the landing's
  // "Start free"). No gradient, ever.
  const primaryBtn = (disabled) => ({
    width: "100%", background: disabled ? T.bg3 : gold, border: "none", borderRadius: 12,
    padding: "14px 16px", color: disabled ? T.ink3 : ink, fontSize: 15, fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", transition: "all 0.15s",
  });
  // Errors ride terracotta (the locked attention color) — never red/pink.
  const errBox = { background: T.terracotta + "14", border: `1px solid ${T.terracotta}44`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: T.terracotta, marginBottom: 16 };

  return (
    <div style={{
      minHeight: "100vh", background: "#f0ede6",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Sans',system-ui,sans-serif", padding: "32px 16px",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet" />
      <div style={{ width: "100%", maxWidth: 500 }}>

        {/* Wordmark — the serif "Steward" only, no glyph (matches the landing) */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <span style={{ fontSize: 26, fontWeight: 400, color: ink, letterSpacing: "-0.02em", fontFamily: "'DM Serif Display',Georgia,serif" }}>
            Steward
          </span>
        </div>

        {/* Progress: Step X of 5 */}
        {!(stepKey === "launch" && phase === "ready") && (
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              Step {stepIdx + 1} of {flow.length} — {STEP_META[stepKey].label}
              <span style={{ color: T.gold600, marginLeft: 8, letterSpacing: "0.04em" }}>{STEP_META[stepKey].time}</span>
            </div>
            <div style={{ maxWidth: 220, margin: "0 auto", background: T.bg2, borderRadius: 99, height: 5, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round(((stepIdx + 1) / flow.length) * 100)}%`, background: greenDk, borderRadius: 99, transition: "width 0.35s ease" }} />
            </div>
          </div>
        )}

        {/* Step — Org basics */}
        {stepKey === "basics" && (
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

            {error && <div style={errBox}>{error}</div>}

            <button onClick={submitBasics} disabled={savingBasics || !orgName.trim()} style={primaryBtn(savingBasics || !orgName.trim())}>
              {savingBasics ? "Saving…" : "Continue →"}
            </button>
          </div>
        )}

        {/* Step — Invite your team (Team plan only) */}
        {stepKey === "invite" && (
          <div style={card}>
            <h1 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 26, fontWeight: 400, color: ink, margin: "0 0 6px", letterSpacing: "-0.01em" }}>
              Invite your team
            </h1>
            <p style={{ fontSize: 14, color: ink3, margin: "0 0 20px", lineHeight: 1.6 }}>
              Add the gift officers who'll each work their own portfolio. They get an invite by email — when they accept, they become a user in {orgName.trim() || "your organization"} with their own portfolio. Team includes up to 10 users. You can always do this later from Settings › Team.
            </p>

            {invited ? (
              <>
                <div style={{ marginBottom: 20 }}>
                  {invited.map((r, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < invited.length - 1 ? `1px solid ${T.bg2}` : "none" }}>
                      <span style={{ color: r.ok ? green : T.terracotta, fontWeight: 800, fontSize: 14 }}>{r.ok ? "✓" : "✕"}</span>
                      <span style={{ fontSize: 14, color: ink, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email}</span>
                      <span style={{ fontSize: 12, color: r.ok ? ink3 : T.terracotta }}>{r.ok ? "invite sent" : r.error}</span>
                    </div>
                  ))}
                </div>
                {seatMsg && <div style={errBox}>{seatMsg}</div>}
                <button onClick={goNext} style={primaryBtn(false)}>Continue →</button>
              </>
            ) : (
              <>
                {officerEmails.map((em, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input value={em} onChange={e => setOfficerEmails(list => list.map((v, j) => j === i ? e.target.value : v))}
                      style={{ ...inp, flex: 1 }} placeholder="officer@email.org" type="email" />
                    {officerEmails.length > 1 && (
                      <button onClick={() => setOfficerEmails(list => list.filter((_, j) => j !== i))}
                        style={{ background: "none", border: `1px solid ${T.bg3}`, borderRadius: 10, color: ink3, fontSize: 16, cursor: "pointer", padding: "0 12px", lineHeight: 1 }}>×</button>
                    )}
                  </div>
                ))}
                <button onClick={() => setOfficerEmails(list => [...list, ""])}
                  style={{ background: "none", border: "none", color: greenDk, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0, marginBottom: 20 }}>
                  + Add another officer
                </button>

                {seatMsg && <div style={errBox}>{seatMsg}</div>}
                {error && <div style={errBox}>{error}</div>}

                <button onClick={sendInvites} disabled={invSending} style={primaryBtn(invSending)}>
                  {invSending ? "Sending invites…" : officerEmails.some(e => e.trim()) ? "Send invites →" : "Continue →"}
                </button>
                <div style={{ textAlign: "center", marginTop: 12 }}>
                  <button onClick={goNext} disabled={invSending}
                    style={{ background: "none", border: "none", color: ink3, fontSize: 13, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
                    I'll invite them later from Settings › Team
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step — Import donors */}
        {stepKey === "import" && (
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
              /* The import celebration — the product's one-gold-moment
                 pattern (see .gold-moment in shared.jsx GlobalStyles):
                 soft rise, one sheen on the accent bar, nothing louder. */
              <div className="gold-moment" style={{ position: "relative", background: T.gold100, border: `1px solid ${T.gold500}55`, borderRadius: 12, padding: "18px 18px 18px 22px", marginBottom: 20, textAlign: "center", overflow: "hidden" }}>
                {/* WelcomePage renders outside the app shell (no GlobalStyles), so the gold-moment animation is declared locally */}
                <style>{`@keyframes goldRise{from{opacity:0;transform:translateY(8px) scale(0.985)}to{opacity:1;transform:translateY(0) scale(1)}}@keyframes goldSheen{0%{background-position:-200% 0}100%{background-position:200% 0}}.gold-moment{animation:goldRise 0.5s cubic-bezier(0.2,0.8,0.3,1) both}.gold-moment .gold-moment-bar{background:linear-gradient(100deg,#c9a84c 40%,#e7cf91 50%,#c9a84c 60%);background-size:200% 100%;animation:goldSheen 1.8s ease-out 0.4s 1}@media (prefers-reduced-motion: reduce){.gold-moment,.gold-moment .gold-moment-bar{animation:none}}`}</style>
                <div className="gold-moment-bar" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: T.gold500 }} />
                <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 18, color: ink, marginBottom: 3 }}>
                  {donorsSnapshot.length.toLocaleString()} donor{donorsSnapshot.length === 1 ? "" : "s"}, safely home.
                </div>
                <div style={{ fontSize: 12.5, color: ink3 }}>That was the hard part. You can import more anytime from Donors → Import.</div>
              </div>
            ) : (
              <button onClick={() => setShowImportModal(true)} style={{ ...primaryBtn(false), marginBottom: 12 }}>
                Import a CSV or Excel file →
              </button>
            )}

            {error && <div style={{ ...errBox, marginBottom: 12 }}>{error}</div>}

            {donorsSnapshot.length > 0 ? (
              <button onClick={goNext} style={primaryBtn(false)}>Continue →</button>
            ) : (
              <div style={{ textAlign: "center" }}>
                <button onClick={skipImport} disabled={loadingDonors} style={{ background: "none", border: "none", color: ink3, fontSize: 13, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
                  {loadingDonors ? "One moment…" : "I don't have a list ready yet — I'll do this later"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step — Set first goal */}
        {stepKey === "goal" && (
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
                    style={{ flex: 1, background: goalForm.goalType === v ? greenDk + "18" : T.bg, border: `1px solid ${goalForm.goalType === v ? greenDk : T.bg3}`, borderRadius: 8, padding: "9px", color: goalForm.goalType === v ? greenDk : ink3, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
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

            {error && <div style={errBox}>{error}</div>}

            <button onClick={submitGoal} disabled={savingGoal || !goalForm.label.trim() || !goalForm.goalAmount} style={primaryBtn(savingGoal || !goalForm.label.trim() || !goalForm.goalAmount)}>
              {savingGoal ? "Saving…" : "Continue →"}
            </button>
          </div>
        )}

        {/* Step — First impact metric */}
        {stepKey === "metric" && (
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
              <div style={{ background: T.bg, border: `1px solid ${T.bg3}`, borderRadius: 12, padding: 16, marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: ink, textTransform: "uppercase", letterSpacing: "0.06em" }}>Second metric (optional)</div>
                  <button onClick={() => setShowMetric2(false)} style={{ background: "none", border: "none", color: ink3, fontSize: 16, cursor: "pointer", lineHeight: 1 }}>×</button>
                </div>
                <input value={metric2.name} onChange={e => setMetric2(m => ({ ...m, name: e.target.value }))} placeholder="e.g. Full-Year Scholarship" style={{ ...inp, marginBottom: 8 }}/>
                <input type="number" value={metric2.dollarThreshold} onChange={e => setMetric2(m => ({ ...m, dollarThreshold: e.target.value }))} placeholder="e.g. 2500" style={{ ...inp, marginBottom: 8 }}/>
                <textarea value={metric2.outcomeTemplate} onChange={e => setMetric2(m => ({ ...m, outcomeTemplate: e.target.value }))} rows={2} placeholder="e.g. Your ${amount} has covered {n} full-year scholarships" style={{ ...inp, resize: "vertical", lineHeight: 1.5 }}/>
              </div>
            )}

            {error && <div style={errBox}>{error}</div>}

            <button onClick={submitMetrics} disabled={savingMetrics || !metric1.name.trim() || !metric1.dollarThreshold || !metric1.outcomeTemplate.trim()}
              style={primaryBtn(savingMetrics || !metric1.name.trim() || !metric1.dollarThreshold || !metric1.outcomeTemplate.trim())}>
              {savingMetrics ? "Saving…" : "Continue →"}
            </button>
          </div>
        )}

        {/* Step — Finishing animation, then ready */}
        {stepKey === "launch" && phase === "finishing" && (
          <div style={card}>
            <h1 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 24, fontWeight: 400, color: ink, margin: "0 0 6px", letterSpacing: "-0.01em", textAlign: "center" }}>
              Finishing setup…
            </h1>
            <p style={{ fontSize: 13, color: ink3, margin: "0 0 28px", textAlign: "center" }}>Just a moment.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {setupItems.map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: "11px 0", borderBottom: i < setupItems.length - 1 ? "1px solid #e8e4dc" : "none" }}>
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

        {stepKey === "launch" && phase === "ready" && (
          <div style={card}>
            <div style={{ textAlign: "center", marginBottom: 30 }}>
              <div style={{ width: 56, height: 56, background: T.green100, border: `2px solid ${green}`, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", fontSize: 22, color: green }}>✓</div>
              <h1 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 30, fontWeight: 400, color: ink, margin: "0 0 8px", letterSpacing: "-0.01em" }}>You're ready.</h1>
              <p style={{ fontSize: 14, fontStyle: "italic", color: T.gold600, margin: 0 }}>Every great organization starts here.</p>
              <div style={{ fontSize: 13, color: ink3, marginTop: 14, lineHeight: 1.7 }}>
                {donorsSnapshot.length > 0
                  ? <>{donorsSnapshot.length.toLocaleString()} donor{donorsSnapshot.length === 1 ? "" : "s"} imported · 1 goal set · {showMetric2 ? "2 impact metrics" : "1 impact metric"} configured</>
                  : <>1 goal set · {showMetric2 ? "2 impact metrics" : "1 impact metric"} configured</>}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {importSkipped && donorsSnapshot.length === 0 && (
                <button onClick={handleLoadSample} disabled={loadingSample} style={{ width: "100%", background: "transparent", border: `1.5px solid ${greenDk}`, borderRadius: 12, padding: "13px 16px", color: greenDk, fontSize: 14, fontWeight: 700, cursor: loadingSample ? "not-allowed" : "pointer", opacity: loadingSample ? 0.7 : 1, fontFamily: "inherit" }}>
                  {loadingSample ? "Loading sample data…" : "Load sample data & explore →"}
                </button>
              )}
              <button onClick={() => navigate("/dashboard", { replace: true })} style={primaryBtn(false)}>
                Go to my home screen →
              </button>
            </div>
          </div>
        )}

      </div>

      {/* withHistory: onboarding must produce real gifts-table rows, not just
          aggregate donor fields — otherwise Retention Rate, Stewardship Debt,
          and Gifts YTD all render blank on Day 1 (see Donors.jsx's
          DonorImport comment). The regular Donors tab's own "Import Donors"
          button omits this prop, so its behavior is unchanged. */}
      {showImportModal && <DonorImport onClose={() => setShowImportModal(false)} onImported={afterImportDone} withHistory/>}
    </div>
  );
}

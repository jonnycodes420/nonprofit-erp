import { useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { CHECKOUT_PLANS } from "../pages/Pricing";

// In-app plan-selection modal used by "Reactivate" — launches a real Stripe
// Checkout session for the chosen plan. This is deliberately separate from
// the Stripe Customer Portal (POST /billing/create-portal, used by Settings'
// "Manage billing" for orgs that already have a subscription): the Portal
// only manages an existing subscription and shows empty states ("No payment
// method", "No invoice history") for an org with none — the wrong flow for
// picking a first/new plan. Renders CHECKOUT_PLANS (Core/Team, the Stripe-wired
// commercial model as of BUILD-24) so pricing/features never drift from the
// public /pricing page.
export default function PlanPicker({ open, onClose }) {
  const [loading, setLoading] = useState(null);

  if (!open) return null;

  async function selectPlan(planId) {
    setLoading(planId);
    try {
      const r = await apiFetch("/billing/create-checkout", {
        method: "POST",
        body: JSON.stringify({ plan: planId }),
      });
      window.location.href = r.url;
    } catch (e) {
      const code = e?.error || "";
      const raw = e?.message || "";
      // Never surface a raw 500 / Stripe internals. Typed billing-config errors
      // (plan_mode_mismatch / plan_not_configured) carry clean admin-facing copy.
      const clean = (code === "plan_mode_mismatch" || code === "plan_not_configured")
        ? raw
        : /internal server error/i.test(raw) || !raw
        ? "Something went wrong starting checkout. Please try again, or reach out if it keeps happening."
        : raw;
      alert(clean);
      setLoading(null);
    }
  }

  return (
    <div
      style={{ position:"fixed",inset:0,background:"rgba(15,26,18,0.72)",zIndex:900,display:"flex",alignItems:"center",justifyContent:"center",padding:24,overflowY:"auto" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background:T.bg,borderRadius:20,padding:"36px 32px 32px",maxWidth:920,width:"100%",boxShadow:"0 24px 60px rgba(0,0,0,0.2)",border:"1px solid "+T.bg3,position:"relative" }}>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ position:"absolute",top:20,right:20,background:"transparent",border:"none",color:T.ink3,fontSize:20,cursor:"pointer",lineHeight:1,padding:4 }}
        >
          ×
        </button>

        <div style={{ textAlign:"center",marginBottom:32 }}>
          <div style={{ fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.gold,marginBottom:10 }}>Reactivate</div>
          <div style={{ fontSize:28,fontWeight:400,color:T.ink,fontFamily:"'DM Serif Display',Georgia,serif",letterSpacing:"-0.02em",marginBottom:8,lineHeight:1.2 }}>
            Choose your plan
          </div>
          <div style={{ fontSize:14,color:T.ink3,maxWidth:440,margin:"0 auto",lineHeight:1.5 }}>
            Pick a plan to reactivate your workspace — your donors, gifts, and history are exactly as you left them.
          </div>
        </div>

        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))",gap:16 }}>
          {CHECKOUT_PLANS.map(plan => (
            <div key={plan.id} style={{
              background: plan.highlight ? T.white : T.bg2,
              border: plan.highlight ? `2px solid ${T.gold}` : `1px solid ${T.bg3}`,
              borderRadius: 16,
              padding: "24px 22px 26px",
              display: "flex",
              flexDirection: "column",
              position: "relative",
            }}>
              {plan.highlight && (
                <div style={{ position:"absolute",top:-12,left:"50%",transform:"translateX(-50%)",background:T.gold,color:T.ink,fontSize:10,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",borderRadius:99,padding:"4px 12px",whiteSpace:"nowrap" }}>
                  Most Popular
                </div>
              )}
              <div style={{ fontSize:12,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:T.ink3,marginBottom:8 }}>
                {plan.name}
              </div>
              <div style={{ display:"flex",alignItems:"baseline",gap:4,marginBottom:6 }}>
                <span style={{ fontSize:32,fontWeight:800,color:T.ink,fontFamily:"'DM Serif Display',Georgia,serif" }}>${plan.price}</span>
                <span style={{ fontSize:13,color:T.ink3 }}>/month</span>
              </div>
              <div style={{ fontSize:12,color:T.ink3,marginBottom:20,lineHeight:1.4 }}>
                {plan.tagline}
              </div>
              <div style={{ display:"flex",flexDirection:"column",gap:9,marginBottom:22,flex:1 }}>
                {plan.features.map(f => (
                  <div key={f} style={{ display:"flex",alignItems:"center",gap:9 }}>
                    <div style={{ width:16,height:16,background:T.green100,border:`1px solid ${T.green500}`,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                      <svg width="8" height="6" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke={T.greenDk} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    <span style={{ fontSize:12.5,color:T.ink2 }}>{f}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => selectPlan(plan.id)}
                disabled={loading === plan.id}
                style={{
                  background: plan.highlight ? T.greenMid : "transparent",
                  border: plan.highlight ? "none" : `1px solid ${T.bg3}`,
                  borderRadius: 10, padding: "12px 16px",
                  color: plan.highlight ? "#fff" : T.ink2,
                  fontSize: 13, fontWeight: 700,
                  cursor: loading === plan.id ? "not-allowed" : "pointer",
                  opacity: loading === plan.id ? 0.7 : 1,
                }}
              >
                {loading === plan.id ? "Loading…" : `Choose ${plan.name} →`}
              </button>
            </div>
          ))}
        </div>

        <div style={{ textAlign:"center",fontSize:12,color:T.ink3,marginTop:24 }}>
          You'll be redirected to Stripe to complete secure checkout.
        </div>
      </div>
    </div>
  );
}

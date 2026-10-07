import { useState } from "react";
import { apiFetch, billingErrorMessage } from "../api";
import { T, Modal } from "./shared";
import PRICING from "../../../pricing.json";

// In-app plan-selection modal for an org whose PAID subscription has ended
// (read-only, or cancelled after the first charge). It launches a real Stripe
// Checkout for the chosen band. It is deliberately separate from the Stripe
// Customer Portal, which only manages an existing subscription.
//
// FIX-32: the plans are pricing.json's and nothing else: one plan, everything
// included, priced on active donors, monthly or yearly. It used to render the
// retired legacy prices. A trial cancelled inside its thirty days never
// opens this: it gets "Keep Steward" on the plan it already chose (App.jsx).
export default function PlanPicker({ open, onClose }) {
  const [loading, setLoading] = useState(null);
  const [interval, setInterval] = useState("monthly");

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
      alert(billingErrorMessage(e, "Something went wrong starting checkout. Please try again, or reach out if it keeps happening."));
      setLoading(null);
    }
  }

  const yearly = interval === "yearly";
  return (
    <Modal onClose={onClose} width={920} zIndex={900} backdrop="rgba(15,26,18,0.72)" blur={false}
      padding="36px 32px 32px" dialogStyle={{ background:T.bg,borderRadius:20,border:"1px solid "+T.bg3 }}
      ariaLabel="Choose your band">
      <div style={{ position:"relative" }}>
        <button onClick={onClose} aria-label="Close"
          style={{ position:"absolute",top:-8,right:-8,background:"transparent",border:"none",color:T.ink3,fontSize:20,cursor:"pointer",lineHeight:1,padding:4 }}>
          ×
        </button>

        <div style={{ textAlign:"center",marginBottom:24 }}>
          <div style={{ fontSize:28,fontWeight:400,color:T.ink,fontFamily:"'DM Serif Display',Georgia,serif",letterSpacing:"-0.02em",marginBottom:8,lineHeight:1.2 }}>
            Start Steward again
          </div>
          <div style={{ fontSize:14,color:T.ink3,maxWidth:480,margin:"0 auto",lineHeight:1.5 }}>
            One plan, everything included. The price follows how many active donors you work. Your donors, gifts and history are exactly as you left them.
          </div>
          <div style={{ fontSize:12,color:T.ink3,maxWidth:480,margin:"8px auto 0",lineHeight:1.5 }}>{PRICING.activeDonorSentence}</div>
          <div role="group" aria-label="Billing interval" style={{ display:"inline-flex",gap:4,marginTop:16,background:T.bg2,borderRadius:99,padding:4 }}>
            {["monthly","yearly"].map(iv => (
              <button key={iv} onClick={() => setInterval(iv)} aria-pressed={interval === iv}
                style={{ background:interval === iv ? T.white : "transparent",border:"none",borderRadius:99,padding:"6px 14px",fontSize:12,fontWeight:700,color:T.ink,cursor:"pointer" }}>
                {iv === "monthly" ? "Monthly" : "Yearly, two months free"}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))",gap:16 }}>
          {PRICING.tiers.map(tier => {
            const planId = `${tier.id}_${interval}`;
            return (
              <div key={tier.id} data-plan={planId} style={{
                background: tier.featured ? T.white : T.bg2,
                border: tier.featured ? `2px solid ${T.gold}` : `1px solid ${T.bg3}`,
                borderRadius: 16, padding: "24px 22px 26px", display: "flex", flexDirection: "column",
              }}>
                <div style={{ fontSize:13,fontWeight:700,color:T.ink2,marginBottom:8 }}>{tier.band}</div>
                <div style={{ display:"flex",alignItems:"baseline",gap:4,marginBottom:20 }}>
                  <span style={{ fontSize:32,fontWeight:800,color:T.ink,fontFamily:"'DM Serif Display',Georgia,serif" }}>
                    ${(yearly ? tier.yearlyUsd : tier.monthlyUsd).toLocaleString("en-US")}
                  </span>
                  <span style={{ fontSize:13,color:T.ink3 }}>{yearly ? "/year" : "/month"}</span>
                </div>
                <button onClick={() => selectPlan(planId)} disabled={loading === planId}
                  style={{
                    marginTop:"auto",
                    background: tier.featured ? T.greenMid : "transparent",
                    border: tier.featured ? "none" : `1px solid ${T.bg3}`,
                    borderRadius: 10, padding: "12px 16px",
                    color: tier.featured ? T.white : T.ink2,
                    fontSize: 13, fontWeight: 700,
                    cursor: loading === planId ? "not-allowed" : "pointer",
                    opacity: loading === planId ? 0.7 : 1,
                  }}>
                  {loading === planId ? "Loading..." : "Choose this band"}
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ textAlign:"center",fontSize:12,color:T.ink3,marginTop:24 }}>
          You'll be redirected to Stripe to complete secure checkout.
        </div>
      </div>
    </Modal>
  );
}

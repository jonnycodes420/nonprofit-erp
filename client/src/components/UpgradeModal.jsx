import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { T } from "./shared";

export default function UpgradeModal({ open, onClose, reason, current, limit, plan }) {
  const navigate = useNavigate();
  const [portalLoading, setPortalLoading] = useState(false);

  if (!open) return null;

  const isSeat = reason === "seat_limit";

  async function handleManageSeats() {
    // TODO: true per-seat add-on checkout (future step). For now open Stripe billing portal.
    setPortalLoading(true);
    try {
      const r = await apiFetch("/billing/create-portal", { method: "POST" });
      window.location.href = r.url;
    } catch {
      navigate("/pricing");
    }
    setPortalLoading(false);
  }

  return (
    <div
      style={{ position:"fixed",inset:0,background:"rgba(15,26,18,0.72)",zIndex:900,display:"flex",alignItems:"center",justifyContent:"center",padding:24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background:T.bg,borderRadius:20,padding:"36px 32px",maxWidth:440,width:"100%",boxShadow:"0 24px 60px rgba(0,0,0,0.2)",border:"1px solid "+T.bg3 }}>
        <div style={{ fontSize:26,fontWeight:400,color:T.ink,fontFamily:"'DM Serif Display',Georgia,serif",letterSpacing:"-0.02em",marginBottom:12,lineHeight:1.2 }}>
          {isSeat ? "Your team is growing." : "You're building real momentum."}
        </div>
        <div style={{ fontSize:14,color:"#4a5e4f",lineHeight:1.65,marginBottom:8 }}>
          {isSeat
            ? <>You're using all <strong>{limit}</strong> seats on your current plan. Add more seats for $25/mo each, or move up to a plan with more room.</>
            : <>You've reached <strong>{limit}</strong> donor records on your current plan. Upgrade to keep adding contacts and growing your database.</>}
        </div>
        <div style={{ fontSize:12,color:T.ink3,marginBottom:28 }}>
          {current} of {limit} {isSeat ? "seats" : "records"} used
          {plan && plan !== "trial" && <> · <span style={{ textTransform:"capitalize" }}>{plan}</span> plan</>}
        </div>
        <div style={{ display:"flex",gap:10,flexWrap:"wrap" }}>
          {isSeat ? (
            <>
              <button
                onClick={handleManageSeats}
                disabled={portalLoading}
                style={{ flex:1,background:"#1a6b4a",border:"none",borderRadius:10,padding:"11px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",opacity:portalLoading?0.7:1 }}
              >
                {portalLoading ? "Opening…" : "Manage seats →"}
              </button>
              <button
                onClick={() => { onClose(); navigate("/pricing"); }}
                style={{ flex:1,background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 16px",color:T.ink2,fontSize:13,fontWeight:600,cursor:"pointer" }}
              >
                Compare plans
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => { onClose(); navigate("/pricing"); }}
                style={{ flex:1,background:"#1a6b4a",border:"none",borderRadius:10,padding:"11px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer" }}
              >
                Upgrade plan →
              </button>
              <button
                onClick={onClose}
                style={{ flex:1,background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 16px",color:T.ink2,fontSize:13,fontWeight:600,cursor:"pointer" }}
              >
                Maybe later
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

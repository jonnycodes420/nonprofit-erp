import { useNavigate } from "react-router-dom";
import { T, Modal } from "./shared";

const PLAN_NAME = { seed: "Seed", growth: "Growth", impact: "Impact", trial: "Trial" };

export default function UpgradeModal({ open, onClose, reason, current, limit, plan }) {
  const navigate = useNavigate();

  if (!open) return null;

  const isSeat = reason === "seat_limit";
  const planName = PLAN_NAME[plan] || (plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : "");

  return (
    <Modal onClose={onClose} width={440} zIndex={900} backdrop="rgba(15,26,18,0.72)" blur={false}
      padding="36px 32px" dialogStyle={{ background:T.bg,borderRadius:20,border:"1px solid "+T.bg3 }}
      ariaLabel="Upgrade your plan">
      <div>
        <div style={{ fontSize:26,fontWeight:400,color:T.ink,fontFamily:"'DM Serif Display',Georgia,serif",letterSpacing:"-0.02em",marginBottom:12,lineHeight:1.2 }}>
          {isSeat ? "Your team is growing." : "You're building real momentum."}
        </div>
        <div style={{ fontSize:14,color:"#4a5e4f",lineHeight:1.65,marginBottom:8 }}>
          {isSeat
            ? <>You're using all <strong>{limit}</strong> seats on the {planName} plan. Upgrade to add your whole team and keep growing.</>
            : <>You've reached <strong>{limit}</strong> donor records on your current plan. Upgrade to keep adding contacts and growing your database.</>}
        </div>
        <div style={{ fontSize:12,color:T.ink3,marginBottom:28 }}>
          {current} of {limit} {isSeat ? "seats" : "records"} used
          {planName && plan !== "trial" && <> · {planName} plan</>}
        </div>
        <div style={{ display:"flex",gap:10,flexWrap:"wrap" }}>
          <button
            onClick={() => { onClose(); navigate("/pricing"); }}
            style={{ flex:1,background:"#0d5c3a",border:"none",borderRadius:10,padding:"11px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer" }}
          >
            Upgrade plan →
          </button>
          <button
            onClick={onClose}
            style={{ flex:1,background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 16px",color:T.ink2,fontSize:13,fontWeight:600,cursor:"pointer" }}
          >
            Maybe later
          </button>
        </div>
      </div>
    </Modal>
  );
}

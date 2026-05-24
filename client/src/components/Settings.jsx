import { useState, useEffect } from "react";
import { T, Pill, SectionLabel, PageTitle } from "./shared";
import { apiFetch } from "../api";

export function Settings({auth,logout}) {
  const orgName=auth?.org?.name||"Your Organization";
  const userName=auth?.user?.name||"User";
  const userEmail=auth?.user?.email||"";
  const userRole=auth?.user?.role||"staff";
  const isAdmin=userRole==="admin";
  const plan=auth?.org?.plan||"seed";
  const PLANS=[
    {id:"seed",label:"Seed",price:"Free",features:["Up to 50 donors","3 staff seats","AI features","Email campaigns"],current:plan==="seed"},
    {id:"growth",label:"Growth",price:"$99/mo",features:["Unlimited donors","10 staff seats","Priority AI","Advanced analytics","Phone support"],current:plan==="growth"},
    {id:"impact",label:"Impact",price:"$299/mo",features:["Unlimited everything","Unlimited seats","Dedicated success manager","Custom integrations","SLA support"],current:plan==="impact"},
  ];

  const [team,setTeam]=useState([]);
  const [showInvite,setShowInvite]=useState(false);
  const [invEmail,setInvEmail]=useState("");
  const [invRole,setInvRole]=useState("staff");
  const [inviting,setInviting]=useState(false);
  const [inviteResult,setInviteResult]=useState(null);
  const [invErr,setInvErr]=useState("");
  const [copied,setCopied]=useState(false);

  useEffect(()=>{
    apiFetch("/org/team").then(setTeam).catch(()=>{});
  },[]);

  async function sendInvite(){
    if(!invEmail.trim()){setInvErr("Email required");return;}
    setInviting(true);setInvErr("");
    try{
      const r=await apiFetch("/auth/invite",{method:"POST",body:JSON.stringify({email:invEmail.trim(),role:invRole})});
      setInviteResult({link:r.inviteLink,emailSent:r.emailSent});
    }catch(e){
      setInvErr(e.message||"Failed to send invite");
    }finally{setInviting(false);}
  }

  function closeInvite(){
    setShowInvite(false);setInvEmail("");setInvRole("staff");
    setInviting(false);setInviteResult(null);setInvErr("");setCopied(false);
  }

  function copyLink(){
    if(!inviteResult?.link)return;
    navigator.clipboard.writeText(inviteResult.link).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});
  }

  return(
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <PageTitle main="Workspace" accent="settings."/>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Your Account</SectionLabel>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20}}>
          <div style={{width:52,height:52,borderRadius:"50%",background:T.green+"18",border:"2px solid "+T.green+"40",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:700,color:T.green,flexShrink:0}}>
            {(userName[0]||"U").toUpperCase()}
          </div>
          <div>
            <div style={{fontSize:18,fontWeight:700,color:T.ink,letterSpacing:"-0.01em"}}>{userName}</div>
            <div style={{fontSize:13,color:T.ink3,marginTop:2}}>{userEmail}</div>
            <div style={{marginTop:6}}><Pill label={userRole} color={userRole==="admin"?T.greenDk:"#6b7280"}/></div>
          </div>
        </div>
        <div style={{background:T.bg,borderRadius:10,padding:"14px 16px"}}>
          <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Organization</div>
          <div style={{fontSize:15,fontWeight:700,color:T.ink}}>{orgName}</div>
          {auth?.org?.mission&&<div style={{fontSize:12,color:T.ink3,marginTop:4,lineHeight:1.5}}>{auth.org.mission}</div>}
        </div>
      </div>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Billing & Plan</SectionLabel>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12}}>
          {PLANS.map(p=>(
            <div key={p.id} style={{border:`2px solid ${p.current?T.green:T.bg3}`,borderRadius:14,padding:"20px",background:p.current?T.green+"08":T.white,position:"relative"}}>
              {p.current&&<div style={{position:"absolute",top:-10,left:16,background:T.green,color:"#fff",fontSize:10,fontWeight:700,letterSpacing:"0.05em",padding:"2px 10px",borderRadius:99,textTransform:"uppercase"}}>Current</div>}
              <div style={{fontSize:14,fontWeight:700,color:T.ink,marginBottom:4}}>{p.label}</div>
              <div style={{fontSize:22,fontWeight:800,color:T.green,fontFamily:"'DM Serif Display',serif",marginBottom:14}}>{p.price}</div>
              {p.features.map(f=>(
                <div key={f} style={{fontSize:12,color:T.ink3,marginBottom:5,display:"flex",gap:6,alignItems:"flex-start"}}>
                  <span style={{color:T.green,flexShrink:0,marginTop:1}}>✓</span>{f}
                </div>
              ))}
              {!p.current&&<button style={{marginTop:14,width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px",color:T.ink2,fontSize:12,fontWeight:600,cursor:"pointer"}}>Upgrade →</button>}
            </div>
          ))}
        </div>
      </div>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <SectionLabel>Team Members</SectionLabel>
          {isAdmin&&<button onClick={()=>setShowInvite(true)} style={{background:T.green,border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Invite Staff</button>}
        </div>
        {team.map((m,i)=>(
          <div key={m.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 0",borderBottom:i<team.length-1?"1px solid "+T.bg3:"none"}}>
            <div style={{width:36,height:36,borderRadius:"50%",background:T.green+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:T.green,flexShrink:0}}>
              {(m.name?.[0]||"U").toUpperCase()}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{m.name}{m.id===auth?.user?.id&&<span style={{fontSize:11,color:T.ink3,marginLeft:6}}>(you)</span>}</div>
              <div style={{fontSize:11,color:T.ink3,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.email}</div>
            </div>
            <Pill label={m.role} color={m.role==="admin"?T.greenDk:"#6b7280"}/>
          </div>
        ))}
        {team.length===0&&<div style={{fontSize:13,color:T.ink3}}>Loading…</div>}
      </div>
      <div style={{background:T.white,border:"1px solid #fecaca",borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Account Actions</SectionLabel>
        <button onClick={logout} style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"9px 18px",color:"#dc2626",fontSize:13,fontWeight:600,cursor:"pointer"}}>
          Sign out of Steward
        </button>
      </div>

      {showInvite&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>{if(e.target===e.currentTarget)closeInvite();}}>
          <div style={{background:T.white,borderRadius:20,padding:"32px 28px",width:420,maxWidth:"calc(100vw - 32px)",boxShadow:"0 8px 40px rgba(0,0,0,0.16)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:17,fontWeight:700,color:T.ink}}>Invite a team member</div>
              <button onClick={closeInvite} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:T.ink3,lineHeight:1}}>×</button>
            </div>

            {!inviteResult?(
              <>
                <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Email address</div>
                <input value={invEmail} onChange={e=>setInvEmail(e.target.value)}
                  placeholder="staff@yourorg.org"
                  style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:12}}
                  onKeyDown={e=>e.key==="Enter"&&sendInvite()}
                />
                <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Role</div>
                <select value={invRole} onChange={e=>setInvRole(e.target.value)}
                  style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:16}}>
                  <option value="staff">Staff — can view and edit data</option>
                  <option value="admin">Admin — full access including settings</option>
                </select>
                {invErr&&<div style={{marginBottom:12,fontSize:13,color:"#dc2626",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"8px 12px"}}>{invErr}</div>}
                <div style={{display:"flex",gap:10}}>
                  <button onClick={closeInvite} style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px",color:T.ink2,fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
                  <button onClick={sendInvite} disabled={inviting} style={{flex:2,background:T.green,border:"none",borderRadius:10,padding:"10px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",opacity:inviting?0.7:1}}>
                    {inviting?"Generating invite…":"Generate invite link"}
                  </button>
                </div>
              </>
            ):(
              <>
                <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:12,padding:"14px 16px",marginBottom:16}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#166534",marginBottom:4}}>
                    {inviteResult.emailSent?"Invite sent! You can also share the link below:":"Share this invite link:"}
                  </div>
                  <div style={{fontSize:12,color:"#15803d",wordBreak:"break-all",lineHeight:1.5}}>{inviteResult.link}</div>
                </div>
                {!inviteResult.emailSent&&<div style={{fontSize:12,color:T.ink3,marginBottom:14,lineHeight:1.5}}>
                  SMTP not configured — copy and share this link directly. It expires in 7 days.
                </div>}
                <div style={{display:"flex",gap:10}}>
                  <button onClick={copyLink} style={{flex:1,background:copied?T.green:T.bg,border:"1px solid "+(copied?T.green:T.bg3),borderRadius:10,padding:"10px",color:copied?"#fff":T.ink2,fontSize:13,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>
                    {copied?"Copied!":"Copy link"}
                  </button>
                  <button onClick={closeInvite} style={{flex:1,background:T.green,border:"none",borderRadius:10,padding:"10px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

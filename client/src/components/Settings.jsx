import { useState, useEffect } from "react";
import QRCode from "qrcode";
import { T, Pill, SectionLabel, PageTitle } from "./shared";
import { apiFetch } from "../api";

export function Settings({auth,logout}) {
  const orgName=auth?.org?.name||"Your Organization";
  const userName=auth?.user?.name||"User";
  const userEmail=auth?.user?.email||"";
  const userRole=auth?.user?.role||"staff";
  const isAdmin=userRole==="admin";

  const [team,setTeam]=useState([]);
  const [showInvite,setShowInvite]=useState(false);
  const [invEmail,setInvEmail]=useState("");
  const [invRole,setInvRole]=useState("staff");
  const [inviting,setInviting]=useState(false);
  const [inviteResult,setInviteResult]=useState(null);
  const [invErr,setInvErr]=useState("");
  const [copied,setCopied]=useState(false);

  const [stripe,setStripe]=useState(null);
  const [stripeLoading,setStripeLoading]=useState(false);

  const [orgSlug,setOrgSlug]=useState(auth?.org?.org_slug||"");
  const [qrDataUrl,setQrDataUrl]=useState("");
  const [qrLoading,setQrLoading]=useState(false);
  const [embedCopied,setEmbedCopied]=useState(false);

  useEffect(()=>{
    apiFetch("/org/team").then(setTeam).catch(()=>{});
    apiFetch("/stripe/status").then(setStripe).catch(()=>{});
    if(!auth?.org?.org_slug){
      apiFetch("/org").then(r=>{ if(r.org_slug) setOrgSlug(r.org_slug); }).catch(()=>{});
    }
  },[]);

  const donationUrl = orgSlug ? `${window.location.origin}/give/${orgSlug}` : "";
  const embedCode = orgSlug
    ? `<iframe src="${window.location.origin}/give/${orgSlug}" width="100%" height="600" frameborder="0"></iframe>`
    : "";

  async function generateQR(){
    if(!donationUrl) return;
    setQrLoading(true);
    try{
      const url=await QRCode.toDataURL(donationUrl,{width:300,margin:2,color:{dark:"#1a1a1a",light:"#faf8f4"}});
      setQrDataUrl(url);
    }catch(e){ console.error(e); }
    setQrLoading(false);
  }

  function downloadQR(){
    if(!qrDataUrl) return;
    const a=document.createElement("a");
    a.href=qrDataUrl;
    a.download=`${orgName.toLowerCase().replace(/[^a-z0-9]+/g,"-")}-donation-qr.png`;
    a.click();
  }

  function printQR(){
    if(!qrDataUrl) return;
    const w=window.open("","_blank","width=600,height=700");
    w.document.write(`<!DOCTYPE html><html><head><title>Donation QR — ${orgName}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#fff;font-family:'DM Sans',system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:40px}
  img{width:280px;height:280px}
  h1{font-size:26px;font-weight:800;color:#1a1a1a;margin:24px 0 8px;text-align:center}
  p{font-size:16px;color:#6b6b6b;text-align:center}
  @media print{@page{margin:0.5in}body{padding:20px}}
</style></head><body>
<img src="${qrDataUrl}"/>
<h1>${orgName}</h1>
<p>Scan to give</p>
<script>window.onload=()=>{setTimeout(()=>{window.print();},400)}<\/script>
</body></html>`);
    w.document.close();
  }

  function copyEmbed(){
    navigator.clipboard.writeText(embedCode).then(()=>{setEmbedCopied(true);setTimeout(()=>setEmbedCopied(false),2500);});
  }

  async function connectStripe(){
    setStripeLoading(true);
    try{
      const r=await apiFetch("/stripe/connect",{method:"POST"});
      window.location.href=r.url;
    }catch(e){
      alert(e.message||"Failed to start Stripe connect");
      setStripeLoading(false);
    }
  }

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
          <div style={{width:52,height:52,borderRadius:"50%",background:T.greenDk+"18",border:"2px solid "+T.greenDk+"40",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:700,color:T.greenDk,flexShrink:0}}>
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
        <SectionLabel>Payments</SectionLabel>
        {stripe?.connected?(
          <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"10px 16px"}}>
              <span style={{fontSize:16}}>💳</span>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:"#166534"}}>Stripe Connected</div>
                <div style={{fontSize:11,color:"#15803d",marginTop:1}}>Account: {stripe.accountId}</div>
              </div>
            </div>
            <div style={{fontSize:12,color:T.ink3}}>Connected {stripe.connectedAt?new Date(stripe.connectedAt).toLocaleDateString():""}</div>
          </div>
        ):(
          <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:200}}>
              <div style={{fontSize:13,color:T.ink2,marginBottom:4}}>Set up Stripe to accept online donations directly from your donors. Steward creates a Stripe Express account linked to your organization — you'll be guided through a short onboarding on Stripe's site.</div>
              <div style={{fontSize:11,color:T.ink3,marginTop:4}}>Steward never touches your money — donors pay directly to your Stripe account.</div>
            </div>
            {isAdmin&&<button onClick={connectStripe} disabled={stripeLoading}
              style={{background:T.green,border:"none",borderRadius:10,padding:"10px 20px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",opacity:stripeLoading?0.7:1,flexShrink:0}}>
              {stripeLoading?"Setting up…":"Set up Stripe →"}
            </button>}
          </div>
        )}
      </div>
      {orgSlug&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Donation QR Code</SectionLabel>
        <div style={{fontSize:13,color:T.ink3,marginBottom:14,lineHeight:1.6}}>
          Print this QR code and put it in your bulletin, on a sign, or anywhere donors can scan it to give.
        </div>
        <div style={{background:T.bg,borderRadius:10,padding:"10px 14px",fontFamily:"monospace",fontSize:12,color:T.ink2,wordBreak:"break-all",marginBottom:14,border:"1px solid "+T.bg3}}>
          {donationUrl}
        </div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-start"}}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {!qrDataUrl?(
              <button onClick={generateQR} disabled={qrLoading}
                style={{background:T.green,border:"none",borderRadius:8,padding:"9px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:qrLoading?"not-allowed":"pointer",opacity:qrLoading?0.7:1}}>
                {qrLoading?"Generating…":"Generate QR Code"}
              </button>
            ):(
              <>
                <button onClick={downloadQR}
                  style={{background:T.greenDk,border:"none",borderRadius:8,padding:"9px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                  ↓ Download PNG
                </button>
                <button onClick={printQR}
                  style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 18px",color:T.ink,fontSize:13,fontWeight:600,cursor:"pointer"}}>
                  🖨 Print
                </button>
                <button onClick={()=>setQrDataUrl("")}
                  style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>
                  Regenerate
                </button>
              </>
            )}
          </div>
          {qrDataUrl&&<img src={qrDataUrl} alt="Donation QR Code" style={{width:120,height:120,borderRadius:8,border:"1px solid "+T.bg3,flexShrink:0}}/>}
        </div>
      </div>}

      {orgSlug&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Embed Donation Form</SectionLabel>
        <div style={{fontSize:13,color:T.ink3,marginBottom:14,lineHeight:1.6}}>
          Paste this anywhere on your website to let donors give without leaving your site.
        </div>
        <div style={{position:"relative",marginBottom:10}}>
          <pre style={{background:"#0f172a",color:"#a5f3c0",borderRadius:10,padding:"14px 16px",fontSize:12,lineHeight:1.7,overflowX:"auto",margin:0,fontFamily:"'Fira Code',monospace,monospace",whiteSpace:"pre-wrap",wordBreak:"break-all"}}>
            {embedCode}
          </pre>
          <button onClick={copyEmbed}
            style={{position:"absolute",top:10,right:10,background:embedCopied?"#10b98130":"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:6,padding:"4px 10px",color:embedCopied?"#a5f3c0":"#e2e8f0",fontSize:11,fontWeight:700,cursor:"pointer",transition:"all 0.15s"}}>
            {embedCopied?"✓ Copied!":"Copy Code"}
          </button>
        </div>
        <div style={{fontSize:11,color:T.ink3,marginBottom:16}}>Width and height are customizable. Use <code style={{background:T.bg3,padding:"1px 5px",borderRadius:4}}>height="700"</code> for the full form without scrolling.</div>
        <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Live Preview</div>
        <div style={{border:"1px solid "+T.bg3,borderRadius:10,overflow:"hidden",background:T.bg}}>
          <iframe
            src={donationUrl}
            width="100%"
            height="560"
            frameBorder="0"
            title="Donation form preview"
            style={{display:"block"}}
          />
        </div>
      </div>}

      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <SectionLabel>Team Members</SectionLabel>
          {isAdmin&&<button onClick={()=>setShowInvite(true)} style={{background:T.green,border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Invite Staff</button>}
        </div>
        {team.map((m,i)=>(
          <div key={m.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 0",borderBottom:i<team.length-1?"1px solid "+T.bg3:"none"}}>
            <div style={{width:36,height:36,borderRadius:"50%",background:T.greenDk+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:T.greenDk,flexShrink:0}}>
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

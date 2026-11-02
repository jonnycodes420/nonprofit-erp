import { useState } from "react";
import { T } from "../shared";

// Section tabs — one per former SecHead group. ids are stable and
// deep-linkable via navigateTo("settings",{section:id}) (App.jsx
// settingsIntent → initialSection prop), e.g. Communications' CAN-SPAM
// prompt lands directly on "receipts".

// ── BUILD-55 — the old PortalManager form (and its PortalThemePreview) is
// GONE, deliberately: everything appearance/content-editable moved into the
// in-portal editor's Design mode (client/src/pages/PortalEditor.jsx — edit
// what you see, where you see it). The status/listing switches it also
// carried (enabled, network_listed, directory card) live on the CRM's Donor
// Portal tab (DonorPortalHub.jsx). Every field has exactly ONE home — do not
// rebuild a second editing surface here.

// ── BUILD-49 entry point (e) — "put it on your website" snippet ─────────────
// A link and a button an org can paste into its own site, pointing donors at
// their giving account with from=<slug> (the cosmetic theming fragment — no
// donor data rides the URL). Shown only while the org is network-listed.
export function PortalWebsiteSnippet({ps}){
  const [copied,setCopied]=useState("");
  // Derive the canonical site base from the server-built portal_url so the
  // snippet always carries the same host the server links carry.
  const base=(ps.portal_url||"").replace(/\/portal\/.*$/,"")||"https://www.stewardapp.dev";
  const givingUrl=`${base}/giving#from=${ps.org_slug}`;
  const orgName=ps.display_name||"our organization";
  const linkHtml=`<a href="${givingUrl}">See your giving with ${orgName} receipts, recurring gifts, and history</a>`;
  const buttonHtml=`<a href="${givingUrl}" style="display:inline-block;background:${T.ink};color:${T.inkInverse};padding:10px 22px;border-radius:8px;font-family:sans-serif;font-size:14px;font-weight:600;text-decoration:none;">Your giving account</a>`;
  const copy=async(label,text)=>{
    try{await navigator.clipboard.writeText(text);setCopied(label);setTimeout(()=>setCopied(""),2000);}
    catch{/* clipboard blocked — the text is selectable below */}
  };
  const pre={fontFamily:"monospace",fontSize:11.5,background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",whiteSpace:"pre-wrap",wordBreak:"break-all",color:T.ink,margin:"6px 0 8px"};
  const copyBtn=(label,text)=>(
    <button onClick={()=>copy(label,text)} style={{background:T.bg2,border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 12px",fontSize:12,fontWeight:600,color:T.ink,cursor:"pointer"}}>
      {copied===label?"Copied ✓":"Copy"}
    </button>
  );
  return(
    <div style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"14px 16px",marginBottom:16}}>
      <div style={{fontSize:12,fontWeight:700,color:T.ink,marginBottom:4}}>Put it on your website</div>
      <div style={{fontSize:12,color:T.ink3,lineHeight:1.5,marginBottom:10,maxWidth:560}}>
        Give your donors a way to reach their giving account from your own site, history, receipts,
        and recurring gifts. The link carries your organization's name so the sign-up page greets
        them with it; it never carries any donor information.
      </div>
      <div style={lblCopy}>Text link</div>
      <div style={pre}>{linkHtml}</div>
      {copyBtn("link",linkHtml)}
      <div style={{...lblCopy,marginTop:14}}>Button</div>
      <div style={pre}>{buttonHtml}</div>
      {copyBtn("button",buttonHtml)}
      <div style={{...lblCopy,marginTop:14}}>Preview</div>
      <div style={{background:T.white,border:"1px dashed "+T.bg3,borderRadius:8,padding:"14px 16px",margin:"6px 0 2px"}}>
        <div style={{marginBottom:10}}>
          <a href={givingUrl} target="_blank" rel="noreferrer" style={{color:T.greenDk,fontSize:13}}>See your giving with {orgName} receipts, recurring gifts, and history</a>
        </div>
        <a href={givingUrl} target="_blank" rel="noreferrer" style={{display:"inline-block",background:T.ink,color:T.bg,padding:"10px 22px",borderRadius:8,fontSize:14,fontWeight:600,textDecoration:"none"}}>Your giving account</a>
      </div>
      <div style={{fontSize:12,color:T.ink3,marginTop:10,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <span>Your donor portal (this organization only):</span>
        <a href={ps.portal_url} target="_blank" rel="noreferrer" style={{display:"inline-block",background:T.bg2,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink,fontSize:12,fontWeight:700,textDecoration:"none"}}>Open donor portal ↗</a>
      </div>
    </div>
  );
}
export const lblCopy={fontSize:11,fontWeight:700,color:T.ink3,};

// The snippet renders in the Donor Portal hub now (a share/links artifact);
// this gate keeps the enabled+listed+slug rule in ONE place (pinned by
// tests/donor-front-door.test.js — unlisted orgs' donors never see any
// giving-account entry point, including on the org's own site).
export function PortalWebsiteSnippetCard({ps}){
  if(!ps)return null;
  return <>{ps.enabled===true&&ps.network_listed===true&&ps.org_slug&&<PortalWebsiteSnippet ps={ps}/>}</>;
}

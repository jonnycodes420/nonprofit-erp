import { useState } from "react";
import QRCode from "qrcode";

// One QR/embed mechanism, parameterized by URL — used for the org-wide
// donation page, each Giving Page, and each peer-to-peer fundraiser's own
// shareable link, rather than a separate QR/embed system per surface.
// Factored out of Settings.jsx (where it originated with the Giving Pages
// build) so pages outside the admin Settings tree — e.g. a supporter's own
// public "manage your fundraiser" page — can reuse it without importing all
// of Settings.jsx just to reach these two components.
//
// Deliberately does NOT import the admin app's `T` from ./shared — this
// component now renders on both the authenticated Settings screen and
// fully public pages (ManageFundraiser.jsx), which carry their own,
// slightly different local `T` (see Donate.jsx/ManageFundraiser.jsx). A
// shared component pulling one caller's token object produced a real,
// visible color mismatch (this file's old T.greenDk was a different shade
// than the public pages' own greenDk) the first time it was reused outside
// Settings. Small literal constants here, close enough to both palettes to
// look intentional in either context, are the fix — not a third import path
// or a props-based theme override for two buttons and an image border.
const green = "#10b981", greenDk = "#1a6b4a", bg = "#f0ede6", bg3 = "#ded7ca", ink = "#171717", ink3 = "#6b6b6b";
export function QrCodeBlock({url,filenameBase}){
  const [qrDataUrl,setQrDataUrl]=useState("");
  const [qrLoading,setQrLoading]=useState(false);

  async function generateQR(){
    if(!url)return;
    setQrLoading(true);
    try{
      const dataUrl=await QRCode.toDataURL(url,{width:300,margin:2,color:{dark:"#0f1a12",light:"#faf8f4"}});
      setQrDataUrl(dataUrl);
    }catch(e){console.error(e);}
    setQrLoading(false);
  }
  function downloadQR(){
    if(!qrDataUrl)return;
    const a=document.createElement("a");
    a.href=qrDataUrl;
    a.download=`${filenameBase}-donation-qr.png`;
    a.click();
  }
  function printQR(){
    if(!qrDataUrl)return;
    const w=window.open("","_blank","width=600,height=700");
    w.document.write(`<!DOCTYPE html><html><head><title>Donation QR</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#fff;font-family:'DM Sans',system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:40px}
  img{width:280px;height:280px}
  p{font-size:16px;color:#6b6b6b;text-align:center;margin-top:16px}
  @media print{@page{margin:0.5in}body{padding:20px}}
</style></head><body>
<img src="${qrDataUrl}"/>
<p>Scan to give</p>
<script>window.onload=()=>{setTimeout(()=>{window.print();},400)}<\/script>
</body></html>`);
    w.document.close();
  }

  return(
    <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-start"}}>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {!qrDataUrl?(
          <button onClick={generateQR} disabled={qrLoading}
            style={{background:green,border:"none",borderRadius:8,padding:"9px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:qrLoading?"not-allowed":"pointer",opacity:qrLoading?0.7:1}}>
            {qrLoading?"Generating…":"Generate QR Code"}
          </button>
        ):(
          <>
            <button onClick={downloadQR}
              style={{background:greenDk,border:"none",borderRadius:8,padding:"9px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
              ↓ Download PNG
            </button>
            <button onClick={printQR}
              style={{background:bg,border:"1px solid "+bg3,borderRadius:8,padding:"9px 18px",color:ink,fontSize:13,fontWeight:600,cursor:"pointer"}}>
              Print
            </button>
            <button onClick={()=>setQrDataUrl("")}
              style={{background:"transparent",border:"1px solid "+bg3,borderRadius:8,padding:"9px 14px",color:ink3,fontSize:13,cursor:"pointer"}}>
              Regenerate
            </button>
          </>
        )}
      </div>
      {qrDataUrl&&<img src={qrDataUrl} alt="Donation QR Code" style={{width:120,height:120,borderRadius:8,border:"1px solid "+bg3,flexShrink:0}}/>}
    </div>
  );
}

export function EmbedCodeBlock({url}){
  const [embedCopied,setEmbedCopied]=useState(false);
  const embedCode = url ? `<iframe src="${url}" width="100%" height="600" frameborder="0"></iframe>` : "";
  function copyEmbed(){
    navigator.clipboard.writeText(embedCode).then(()=>{setEmbedCopied(true);setTimeout(()=>setEmbedCopied(false),2500);});
  }
  return(
    <div style={{position:"relative"}}>
      <pre style={{background:"#0f172a",color:"#a5f3c0",borderRadius:10,padding:"14px 16px",fontSize:12,lineHeight:1.7,overflowX:"auto",margin:0,fontFamily:"'Fira Code',monospace,monospace",whiteSpace:"pre-wrap",wordBreak:"break-all"}}>
        {embedCode}
      </pre>
      <button onClick={copyEmbed}
        style={{position:"absolute",top:10,right:10,background:embedCopied?"#10b98130":"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:6,padding:"4px 10px",color:embedCopied?"#a5f3c0":"#e2e8f0",fontSize:11,fontWeight:700,cursor:"pointer",transition:"all 0.15s"}}>
        {embedCopied?"✓ Copied!":"Copy Code"}
      </button>
    </div>
  );
}

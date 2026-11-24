// PERF-5 · What's new, the panel. Its own chunk with the entries (every file in
// docs/changelog/, lib/changelog.js), loaded when What's new is opened from the
// name chip's menu, never with Home (TopBar.jsx keeps only the unread dot).
// `hidden` is the ids a super-admin hid; `onSeen` hears the newest entry shown,
// so the dot clears even when the newest file was hidden.
import { useEffect } from "react";
import { T } from "./shared";
import { CHANGELOG, PRODUCT_WORDS } from "../lib/changelog";

export default function WhatsNewPanel({ hidden, onClose, onSeen }) {
  const entries = CHANGELOG.filter(e => !hidden || !hidden.has(e.id));
  const newest = entries[0] ? entries[0].id : "";
  useEffect(() => { if (newest) onSeen(newest); }, [newest]);   // eslint-disable-line react-hooks/exhaustive-deps
  return <div role="dialog" aria-label="What's new" data-testid="whats-new-panel" onClick={onClose}
    style={{position:"fixed",inset:0,background:"rgba(15,26,18,0.5)",zIndex:400,display:"flex",justifyContent:"flex-end"}}>
    <div onClick={e=>e.stopPropagation()} style={{width:"min(440px,100%)",height:"100%",overflowY:"auto",background:T.bg,padding:"24px 22px",boxSizing:"border-box"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <span style={{fontFamily:"'DM Serif Display',serif",fontSize:26,color:T.ink}}>What's new</span>
        <button onClick={onClose} aria-label="Close" style={{background:"none",border:"none",fontSize:20,color:T.ink3,cursor:"pointer"}}>×</button>
      </div>
      {entries.map(e=><div key={e.id} style={{background:T.white,borderRadius:14,padding:"14px 16px",marginBottom:10}}>
        <div style={{fontSize:11,color:T.ink3}}>{PRODUCT_WORDS[e.product]||"New"} · {new Date(e.date+"T12:00:00Z").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"})}</div>
        <div style={{fontSize:15,fontWeight:700,color:T.ink,margin:"4px 0"}}>{e.title}</div>
        <div style={{fontSize:13.5,color:T.ink2,lineHeight:1.55}}>{e.body}</div>
      </div>)}
      <a href="/whats-new" target="_blank" rel="noreferrer" style={{fontSize:13,color:T.greenDk}}>The full list</a>
    </div>
  </div>;
}

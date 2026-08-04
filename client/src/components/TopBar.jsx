import { useState, useEffect, useRef, useMemo } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";

// ── Global top bar (desktop shell only, BUILD-08; full-width BUILD-10) ──────
// Slim 52px bar spanning the FULL viewport width (fixed, top:0/left:0/right:0),
// above the sidebar (which starts at top:52). Ink background, hairline
// elevated-green bottom border. Left→right: wordmark (over the 220px rail
// zone, links to Home), global search (⌘K, cap ~560px), help menu, user
// chip/sign-out. zIndex 250 sits above the z-200 full-screen takeovers so the
// bar stays visible over DonorProfile/GrantProfile. Hidden ≤768px by
// GlobalStyles; mobile keeps its own header.

// V1 search scope: donors (name/email via GET /donors?search=&limit=),
// grants (funder/program via GET /grants?search=&limit=), plus static
// quick-nav actions. All matching against donor/grant data happens
// server-side, org-scoped — nothing is fuzzy-matched over client caches.
const QUICK_NAV = [
  { id:"nav_reports", label:"Reports", hint:"Open the Reports tab",
    keywords:"reports report giving summary lybunt sybunt retention top donors",
    go:nav=>nav("reports") },
  { id:"nav_settings_receipts", label:"Settings → Tax Receipts", hint:"Receipt settings & year-end statements",
    keywords:"settings tax receipts receipt year end statement ein legal",
    go:nav=>nav("settings",{section:"receipts"}) },
];

const fmtMoney = n => "$" + Math.round(Number(n)||0).toLocaleString();

export function TopBar({ auth, logout, onNavigate }) {
  const [q,setQ] = useState("");
  const [results,setResults] = useState(null);   // {donors:[], grants:[]} | null
  const [open,setOpen] = useState(false);
  const [sel,setSel] = useState(0);
  const [helpOpen,setHelpOpen] = useState(false);
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const helpRef = useRef(null);
  const seqRef = useRef(0);

  // ⌘K / Ctrl+K from anywhere in the authenticated app (desktop — the bar
  // is display:none ≤768px, where focusing a hidden input is a no-op).
  // BUILD-10: the bar is now full-width at zIndex 250, above the z-200
  // full-screen takeovers (DonorProfile/GrantProfile), so it's always
  // visible and clickable — the old elementFromPoint occlusion guard is gone.
  useEffect(()=>{
    const onKey = e => {
      if ((e.metaKey||e.ctrlKey) && (e.key==="k"||e.key==="K")) {
        const el = inputRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return; // hidden (mobile shell)
        e.preventDefault();
        el.focus(); el.select();
      }
    };
    window.addEventListener("keydown",onKey);
    return ()=>window.removeEventListener("keydown",onKey);
  },[]);

  // Close dropdowns on outside click
  useEffect(()=>{
    const onDown = e => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
      if (helpRef.current && !helpRef.current.contains(e.target)) setHelpOpen(false);
    };
    document.addEventListener("mousedown",onDown);
    return ()=>document.removeEventListener("mousedown",onDown);
  },[]);

  // Debounced org-scoped server search (donors + grants in parallel)
  useEffect(()=>{
    const term = q.trim();
    if (term.length < 2) { setResults(null); return; }
    const seq = ++seqRef.current;
    const t = setTimeout(async ()=>{
      try {
        const [d,g] = await Promise.all([
          apiFetch(`/donors?search=${encodeURIComponent(term)}&limit=5`),
          apiFetch(`/grants?search=${encodeURIComponent(term)}&limit=5`),
        ]);
        if (seq !== seqRef.current) return; // stale response — a newer query is in flight
        setResults({ donors:d.donors||[], grants:Array.isArray(g)?g:[] });
        setSel(0);
      } catch { if (seq === seqRef.current) setResults({donors:[],grants:[]}); }
    }, 220);
    return ()=>clearTimeout(t);
  },[q]);

  const navMatches = useMemo(()=>{
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return QUICK_NAV.filter(a=>a.keywords.includes(term)||a.label.toLowerCase().includes(term));
  },[q]);

  const pick = item => {
    setOpen(false); setQ(""); setResults(null);
    inputRef.current?.blur();
    item.onSelect();
  };

  // Flat, ordered list backing keyboard navigation; groups are a render
  // concern only.
  const flat = useMemo(()=>{
    const out = [];
    (results?.donors||[]).forEach(d=>out.push({
      group:"Donors", key:"d_"+d.id, title:d.name, sub:d.email||fmtMoney(d.total_giving)+" lifetime",
      onSelect:()=>onNavigate("donors",{selectDonorId:d.id}),
    }));
    (results?.grants||[]).forEach(g=>out.push({
      group:"Grants", key:"g_"+g.id, title:g.funder, sub:[g.program,g.amount?fmtMoney(g.amount):null].filter(Boolean).join(" · "),
      onSelect:()=>onNavigate("grants",{grantId:g.id}),
    }));
    navMatches.forEach(a=>out.push({
      group:"Go to", key:a.id, title:a.label, sub:a.hint,
      onSelect:()=>a.go(onNavigate),
    }));
    return out;
  },[results,navMatches,onNavigate]);

  const showDrop = open && q.trim().length>0 && (flat.length>0 || (q.trim().length>=2 && results!==null));

  const onKeyDown = e => {
    if (e.key==="Escape") { setOpen(false); inputRef.current?.blur(); return; }
    if (!flat.length) return;
    if (e.key==="ArrowDown") { e.preventDefault(); setSel(s=>(s+1)%flat.length); setOpen(true); }
    else if (e.key==="ArrowUp") { e.preventDefault(); setSel(s=>(s-1+flat.length)%flat.length); }
    else if (e.key==="Enter") { e.preventDefault(); pick(flat[sel]||flat[0]); }
  };

  // Grouped render preserving flat indices
  let flatIdx = -1;
  const groups = [];
  flat.forEach(item=>{
    const last = groups[groups.length-1];
    if (!last || last.name!==item.group) groups.push({name:item.group,items:[item]});
    else last.items.push(item);
  });

  const userName = auth?.user?.name || "You";

  return <div className="app-topbar" style={{height:52,background:"#0f1a12",borderBottom:"1px solid "+T.bgElevated,display:"flex",alignItems:"center",gap:14,padding:"0 20px 0 0",position:"fixed",top:0,left:0,right:0,zIndex:250,boxSizing:"border-box"}}>

    {/* Wordmark — over the 220px sidebar rail zone (20px inset matches the
        old sidebar wordmark), links to Home */}
    <button data-testid="topbar-wordmark" onClick={()=>onNavigate("dashboard")} title="Steward — Home"
      style={{width:220,flexShrink:0,textAlign:"left",padding:"0 20px",background:"transparent",border:"none",cursor:"pointer",boxSizing:"border-box"}}>
      <span style={{fontSize:21,fontWeight:400,color:"#f0ede6",fontFamily:"'DM Serif Display',Georgia,serif",letterSpacing:"-0.02em"}}>Steward</span>
    </button>

    {/* Global search */}
    <div ref={rootRef} style={{position:"relative",flex:"0 1 560px",minWidth:0}}>
      <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:"#6b8f7a",fontSize:13,pointerEvents:"none"}}>⌕</span>
      <input
        ref={inputRef}
        className="topbar-search"
        data-testid="global-search"
        value={q}
        onChange={e=>{setQ(e.target.value);setOpen(true);}}
        onFocus={()=>setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search donors, grants… ⌘K"
        style={{width:"100%",boxSizing:"border-box",background:T.bgElevated,border:"1px solid #2d4a35",borderRadius:10,padding:"7px 12px 7px 30px",color:"#f0ede6",fontSize:13,outline:"none",fontFamily:"inherit"}}
      />
      {showDrop && <div data-testid="search-dropdown" style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:12,boxShadow:"0 12px 40px rgba(0,0,0,0.45)",padding:"6px 0",maxHeight:420,overflowY:"auto",zIndex:130}}>
        {flat.length===0 && <div style={{padding:"10px 14px",fontSize:12.5,color:"#6b8f7a"}}>No matches for “{q.trim()}”</div>}
        {groups.map(gr=><div key={gr.name}>
          <div style={{padding:"6px 14px 3px",fontSize:10,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:"#6b8f7a"}}>{gr.name}</div>
          {gr.items.map(item=>{
            flatIdx++;
            const active = flatIdx===sel;
            const i = flatIdx;
            return <button key={item.key} data-testid="search-result"
              onMouseDown={e=>{e.preventDefault();pick(item);}}
              onMouseEnter={()=>setSel(i)}
              style={{display:"block",width:"100%",textAlign:"left",background:active?T.bgElevated:"transparent",border:"none",borderLeft:`3px solid ${active?T.gold:"transparent"}`,padding:"7px 14px 7px 11px",cursor:"pointer",boxSizing:"border-box"}}>
              <div style={{fontSize:13,fontWeight:600,color:"#f0ede6",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.title}</div>
              {item.sub && <div style={{fontSize:11.5,color:"#8fa896",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.sub}</div>}
            </button>;
          })}
        </div>)}
      </div>}
    </div>

    <div style={{flex:1}}/>

    {/* Help menu */}
    <div ref={helpRef} style={{position:"relative"}}>
      <button data-testid="topbar-help" onClick={()=>setHelpOpen(v=>!v)} title="Help"
        style={{width:28,height:28,borderRadius:"50%",background:helpOpen?T.bgElevated:"transparent",border:"1px solid #2d4a35",color:"#8fa896",fontSize:13,fontWeight:700,cursor:"pointer",lineHeight:1}}>?</button>
      {helpOpen && <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:12,boxShadow:"0 12px 40px rgba(0,0,0,0.45)",padding:"6px 0",width:210,zIndex:130}}>
        <a href="mailto:jonathan@stewardapp.dev?subject=Steward%20question" onClick={()=>setHelpOpen(false)}
          style={{display:"block",padding:"8px 14px",fontSize:13,color:"#f0ede6",textDecoration:"none",fontWeight:600}}>
          Email the founder
          <div style={{fontSize:11,color:"#8fa896",fontWeight:400}}>jonathan@stewardapp.dev</div>
        </a>
      </div>}
    </div>

    {/* User chip + sign out (moved from sidebar bottom). The chip (avatar + name)
        is a REAL button → Settings › Account (BUILD-31 Part 2.2): it reads as one
        and every user tries it, so it now behaves as one — keyboard-accessible. */}
    <div style={{display:"flex",alignItems:"center",gap:9}}>
      <button onClick={()=>onNavigate("settings",{section:"account"})} title="Account settings"
        style={{display:"flex",alignItems:"center",gap:9,background:"transparent",border:"none",padding:"3px 5px",borderRadius:8,cursor:"pointer"}}>
        <div style={{width:28,height:28,borderRadius:8,background:T.greenDk,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <span style={{fontSize:11,fontWeight:700,color:"#f0ede6"}}>{userName[0].toUpperCase()}</span>
        </div>
        <span style={{fontSize:12.5,fontWeight:600,color:"#f0ede6",maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{userName}</span>
      </button>
      <button onClick={logout} style={{background:"transparent",border:"1px solid #2d4a35",borderRadius:8,padding:"5px 11px",color:"#8fa896",fontSize:12,cursor:"pointer"}}>Sign out</button>
    </div>
  </div>;
}

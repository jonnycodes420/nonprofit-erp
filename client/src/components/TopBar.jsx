import { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { apiFetch } from "../api";
import { T, DriftBadge, firstNameOf, PersonMark } from "./shared";
import { typeLabels, isDonor as personIsDonor } from "../../../shared/personType.js";
import { RecordLink } from "./RecordLink";
import { donorHref, tabHref, isPlainLeftClick } from "../lib/appUrls";
import { openRecentChanges } from "./RecentChanges";
import { AtlasBell } from "./AtlasNote";   // AGENT-5
import { orgsSeenCount } from "../lib/orgBinding"; // HARDEN-1
import { useMyOrgs } from "../lib/myOrgs";   // ACCESS-1
const OrgSwitcher = lazy(() => import("./OrgSwitcher"));   // ACCESS-1: only when opened


const LAST_SEEN_KEY = "npe_whats_new_seen";

// ── Global top bar (desktop shell only, BUILD-08; full-width BUILD-10) ──────
// Slim 52px bar spanning the FULL viewport width (fixed, top:0/left:0/right:0),
// above the sidebar (which starts at top:52). Ink background, hairline
// elevated-green bottom border. Left→right: wordmark (over the 240px rail
// zone, links to Home), global search (⌘K, cap ~560px), help menu, user
// chip/sign-out. zIndex 250 sits above the z-200 full-screen takeovers so the
// bar stays visible over DonorProfile/GrantProfile. Hidden ≤768px by
// GlobalStyles; mobile keeps its own header.

// WIRE-1 search scope: every kind of record, by GET /search?q= (routes/
// search.js), plus static quick-nav actions. All matching happens
// server-side, org-scoped; nothing is fuzzy-matched over client caches.
// HARDEN-2: the Help panel (Support chat and every help article) loads when
// it is opened, not with the top bar on every first look.
const HelpPanel = lazy(() => import("./HelpPanel").then(m => ({ default: m.HelpPanel })));
const QUICK_NAV = [
  { id:"nav_reports", label:"Reports", hint:"Open the Reports tab",
    keywords:"reports report giving summary lybunt sybunt retention top donors",
    go:nav=>nav("reports") },
  // FLOWS-4 (W-1107-Finance-35): the Trash, by any word a person uses for it.
  { id:"nav_settings_trash", label:"Settings → Trash", hint:"People you deleted: restore them, or empty the trash",
    keywords:"trash bin deleted delete removed restore recover undelete bring back empty trash",
    go:nav=>nav("settings",{section:"trash"}) },
  { id:"nav_settings_receipts", label:"Settings → Tax Receipts", hint:"Receipt settings & year-end statements",
    keywords:"settings tax receipts receipt year end statement ein legal",
    go:nav=>nav("settings",{section:"receipts"}) },
  // FIX-25: a careful tester searched for these three and decided Steward did
  // not have them. Each is a part of Fundraising with a rail entry of its own.
  { id:"nav_auctions", label:"Auctions", hint:"Items, bids, winners and pay links",
    keywords:"auctions auction silent auction live auction bids bidding bidder paddle gala items lots winners",
    go:nav=>nav("auctions") },
  { id:"nav_p2p", label:"Peer-to-peer", hint:"Teams, fundraisers and their pages",
    keywords:"peer-to-peer peer to peer p2p teams team captain fundraisers personal fundraising page walk run ride a-thon",
    go:nav=>nav("p2p") },
  { id:"nav_memberships", label:"Memberships", hint:"Members, levels, renewals and the membership page",
    keywords:"memberships membership members member levels tiers renewals renew lapsed dues join card",
    go:nav=>nav("memberships") },
  // GIFTS-2: "recurring" and "monthly" found people's plans and never the page
  // that lists them all (Muse, 6 Nov). It opens Fundraising → Money in.
  { id:"nav_recurring", label:"Recurring giving", hint:"Every monthly and yearly plan, failed cards and recoveries",
    keywords:"recurring giving monthly donors monthly giving monthly gifts sustainers sustaining subscriptions plans yearly annual plan failed card dunning",
    go:nav=>nav("fundraising",{frSection:"recurring"}) },
];

const fmtMoney = n => "$" + Math.round(Number(n)||0).toLocaleString();

// WIRE-1 · WHAT EACH KIND OF RESULT SAYS AND WHERE IT OPENS. The group name,
// the second line, and the screen (a tab and its options, the same ones the
// rest of the app navigates with). Order here is the order on screen.
// SEARCH-2: `key` is the server's name for the kind ("see all" asks for it).
const fmtCents = n => { const v=Number(n)||0; return "$"+(Number.isInteger(v)?v.toLocaleString():v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})); };
const shortDay = iso => { if(!iso) return null; const d=new Date(iso+"T12:00:00"); return isNaN(d)?iso:d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}); };
const SEARCH_KINDS = [
  // SEARCH-2: "Rafael gift" is the person, opened on their gifts.
  { kind:"personGifts", key:"personGifts", group:"Their gifts", row:d=>({ title:d.title+"’s gifts",
      sub:d.totalGiving?fmtMoney(d.totalGiving)+" lifetime":"Gifts and pledges",
      personId:d.id, personName:d.title, personKind:d.personKind||null,
      tab:"donors", opts:{selectDonorId:d.id, anchor:"gifts"} }) },
  { kind:"person", group:"People", row:d=>({
      // WALKB-1: a match that is not the name says what matched ("household: The Marlowe Hart household").
      sub:[d.why&&d.why!=="name"?"Matched "+d.why:null, d.organization?"Organization":typeLabels(d).join(" · "), d.contactName&&!/^contact person/.test(d.why||"")?"Contact "+d.contactName:null,
           (/^(email|phone)/.test(d.why||"")?null:d.email||d.phone)||(personIsDonor(d)?fmtMoney(d.totalGiving)+" lifetime":null)].filter(Boolean).join(" · "),
      personId:d.id, personName:d.title, personKind:d.personKind||null,
      tab:"donors", opts:{selectDonorId:d.id} }) },
  { kind:"household", group:"Households", row:h=>({
      sub:`${h.members} ${h.members===1?"person":"people"}`,
      tab:"donors", opts:h.openDonorId?{selectDonorId:h.openDonorId}:{}, link:!!h.openDonorId }) },
  { kind:"campaign", group:"Campaigns and appeals", row:c=>({
      sub:[c.type?c.type.charAt(0).toUpperCase()+c.type.slice(1):null, c.status].filter(Boolean).join(" · "),
      ...(c.fundraising ? { tab:"fundraising", opts:{frSection:"campaigns",campaignId:c.id} } : { tab:"communications", opts:{campaignId:c.id} }) }) },
  { kind:"event", group:"Events", row:e=>({ sub:[e.date,e.location].filter(Boolean).join(" · "), tab:"events", opts:{eventId:e.id} }) },
  // VOL-PAGE-1: a volunteer page is a page too, and opens in its editor.
  { kind:"page", group:"Giving pages", row:g=>(g.page_kind==="volunteer"
    ? { sub:"Volunteer page"+(g.slug?" · /"+g.slug:""), tab:"fundraising", opts:{frSection:"pages"}, url:"/portal-editor?page="+encodeURIComponent(g.id) }
    : { sub:g.slug?"/"+g.slug:"", tab:"fundraising", opts:{frSection:"pages"} }) },
  { kind:"p2p", group:"Peer-to-peer pages", row:f=>({ sub:f.pageTitle, tab:"fundraising", opts:{frSection:"p2p"} }) },
  { kind:"grant", group:"Grants", row:g=>({ sub:[g.program,g.amount?fmtMoney(g.amount):null].filter(Boolean).join(" · "), tab:"grants", opts:{grantId:g.id} }) },
  { kind:"auction", group:"Auctions", row:a=>({ sub:[a.status, a.itemHits?`${a.itemHits} matching ${a.itemHits===1?"item":"items"}`:null].filter(Boolean).join(" · "), tab:"fundraising", opts:{frSection:"auctions"} }) },
  { kind:"level", group:"Membership levels", row:l=>({ sub:l.price?fmtMoney(l.price):"", tab:"fundraising", opts:{frSection:"members"} }) },
  { kind:"task", group:"Open tasks", row:t=>({ sub:[t.donorName,t.due?"due "+t.due:null].filter(Boolean).join(" · "),
      ...(t.donorId ? { tab:"donors", opts:{selectDonorId:t.donorId} } : { tab:"tasks", opts:{} }) }) },
  { kind:"report", group:"Saved reports", row:r=>({ sub:"Saved report", tab:"reports", opts:{savedReport:r.id} }) },
  { kind:"dashboard", group:"Saved reports", row:r=>({ sub:"Dashboard", tab:"reports", opts:{report:"sdash:"+r.id} }) },
  { kind:"boardFile", group:"Past reports", row:b=>({ sub:[b.kindLabel||"Past board report",b.system?"from "+b.system:null,b.period].filter(Boolean).join(" · "), tab:"reports", opts:{report:"board-files"} }) },
  { kind:"document", group:"Documents", row:f=>({ sub:f.donorName, tab:"donors", opts:{selectDonorId:f.donorId} }) },
  { kind:"grantDocument", group:"Documents", row:f=>({ sub:f.funder, tab:"grants", opts:{grantId:f.grantId} }) },
  // SEARCH-2: the records that hang off a person open on that person's
  // profile, on their own row (the profile reads the #anchor).
  { kind:"gift", key:"gifts", group:"Gifts", row:g=>({ title:fmtCents(g.amount)+" from "+g.title,
      sub:[shortDay(g.date), g.checkNumber?"check "+g.checkNumber:g.method].filter(Boolean).join(" · "),
      tab:"donors", opts:{selectDonorId:g.donorId, anchor:"gift-"+g.id} }) },
  { kind:"plan", key:"plans", group:"Monthly plans", row:r=>({ title:fmtCents(r.amount)+(r.interval==="year"?" a year":" a month")+" from "+r.title,
      sub:{active:"Active",past_due:"Payment failed",recovering:"Recovering",recovered:"Card fixed",paused:"Paused",canceled:"Canceled"}[r.status]||r.status||"",
      tab:"donors", opts:{selectDonorId:r.donorId, anchor:"plan-"+r.id} }) },
  { kind:"pledge", key:"pledges", group:"Pledges", row:p=>({ title:fmtCents(p.amount)+" pledged by "+p.title,
      sub:[p.status==="open"?"Open":p.status==="fulfilled"?"Fulfilled":p.status==="written_off"?"Written off":p.status, p.due?"due "+shortDay(p.due):null].filter(Boolean).join(" · "),
      tab:"donors", opts:{selectDonorId:p.donorId, anchor:"pledge-"+p.id} }) },
  { kind:"journey", key:"journeys", group:"Journeys", row:j=>({ sub:[`${j.steps} ${j.steps===1?"step":"steps"}`, j.on?"On":null].filter(Boolean).join(" · "),
      tab:"journeys", opts:{journeyId:j.id} }) },
  { kind:"meeting", key:"meetings", group:"Meetings", row:m=>({ sub:[m.donorName, shortDay(m.date), m.location].filter(Boolean).join(" · "),
      ...(m.logged ? { tab:"donors", opts:{selectDonorId:m.donorId, anchor:"item-"+m.id} } : { tab:"calendar", opts:{day:m.date} }) }) },
  { kind:"email", key:"emails", group:"Emails", row:e=>({ sub:[e.from?"from "+e.from:null, e.from!==e.donorName?e.donorName:null, shortDay(e.date)].filter(Boolean).join(" · "),
      tab:"donors", opts:{selectDonorId:e.donorId, anchor:"item-"+e.id} }) },
  { kind:"note", key:"notes", group:"Notes", row:n=>({ sub:[n.donorName, shortDay(n.date)].filter(Boolean).join(" · "),
      tab:"donors", opts:{selectDonorId:n.donorId, anchor:"item-"+n.id} }) },
  { kind:"import", key:"imports", group:"Imports", row:i=>({ sub:[shortDay(i.date), `${i.rows} ${i.rows===1?"row":"rows"}`, i.undone?"Undone":null].filter(Boolean).join(" · "),
      tab:"settings", opts:{section:"imports", importId:i.id} }) },
];
// The server's names for each kind, so "See all" on a group asks for its kinds.
const SERVER_KEY = { person:"people", household:"households", campaign:"campaigns", event:"events", page:"pages",
  p2p:"p2p", grant:"grants", auction:"auctions", level:"levels", task:"tasks", report:"reports", dashboard:"dashboards",
  boardFile:"boardFiles", document:"files", grantDocument:"grantFiles" };
const serverKey = k => k.key || SERVER_KEY[k.kind];
const GROUP_TOP = 3;
// FLOWS-4 (W-1109-Volunteers-27): people who share a name carry a type chip
// (Donor, Contact, Volunteer) so the right one is picked.
const nameKey = t => String(t||"").trim().toLowerCase().replace(/\s+/g," ");
function sameNameTwins(results) {
  const n = new Map();
  (results||[]).filter(r=>r.kind==="person").forEach(r=>n.set(nameKey(r.title),(n.get(nameKey(r.title))||0)+1));
  return new Set([...n].filter(([,c])=>c>1).map(([k])=>k));
}
const typeChip = r => { if (r.organization) return "Organization"; const t = typeLabels(r); return t.includes("Donor") ? "Donor" : t.includes("Volunteer") ? "Volunteer" : "Contact"; };

// FIX-26: THE ONE SEARCH, for the desktop bar and the phone header alike. It
// was written inside TopBar, which a phone never shows, so on a phone nothing
// could be searched for and Auctions, Peer-to-peer and Memberships could not
// be found. Same server search, same quick-nav list, same rows.
// POLISH-1 — the key a visitor presses to open search, by THEIR platform:
// ⌘K on a Mac, iPhone or iPad, Ctrl K everywhere else. The listener accepts
// both on every platform; only the words on the screen differ.
export function isApplePlatform(nav = typeof navigator !== "undefined" ? navigator : null) {
  if (!nav) return false;
  const p = (nav.userAgentData && nav.userAgentData.platform) || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(p);
}
export const searchShortcutLabel = (nav) => (isApplePlatform(nav) ? "⌘K" : "Ctrl K");
const OPEN_EVENT = "steward:search-open";

function GlobalSearch({ onNavigate, inputRef, style, autoFocus = false, onPicked, placeholder = `Search people, gifts, notes, meetings… ${searchShortcutLabel()}` }) {
  const [q,setQ] = useState("");
  const [results,setResults] = useState(null);   // [{kind,id,title,…}] | null
  const [more,setMore] = useState({});           // server kind -> it has more than it sent
  const [expanded,setExpanded] = useState(null);  // { group, results } once "See all" is picked
  const [open,setOpen] = useState(false);
  const [sel,setSel] = useState(0);
  const rootRef = useRef(null);
  const seqRef = useRef(0);
  const shownSeqRef = useRef(0);                 // LIST-3: the question the answer on screen answers
  const [pending,setPending] = useState(false);  // LIST-3: the latest question is still on its way
  const qRef = useRef(""); qRef.current = q;
  const movedRef = useRef(false);
  // LIST-2: the words the results on screen answer, and an Enter pressed
  // before they arrived (it opens the top match when they do).
  const [resultsFor,setResultsFor] = useState(null);
  const enterRef = useRef(null);

  useEffect(()=>{
    const onDown = e => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown",onDown);
    return ()=>document.removeEventListener("mousedown",onDown);
  },[]);

  // WIRE-1: ONE server search (GET /search), org-scoped, every kind of
  // record by its name, five of each. Debounced; a stale answer is dropped.
  // FIX-46: and again each time the box opens, so a person's figures are
  // today's, not the ones from before a gift was logged elsewhere.
  // LIST-3: an answer is dropped only when a NEWER one is already on screen.
  // It used to be dropped whenever a newer question had been asked, so on a
  // slow connection (prod, ~0.9 s) every answer was thrown away while she was
  // still typing and Cmd+K showed nothing until she stopped. Now the latest
  // answer to land stays up until a newer one replaces it, and "Searching…"
  // shows while the first is on its way.
  useEffect(()=>{
    const term = q.trim();
    if (term.length < 2) { setResults(null); setResultsFor(null); setPending(false); shownSeqRef.current = ++seqRef.current; return; }
    if (!open) return;
    const seq = ++seqRef.current;
    setPending(true);
    const t = setTimeout(async ()=>{
      const land = (list, moreOf) => {
        if (seq < shownSeqRef.current) return; // a newer answer is already on screen
        // An older answer shows only while it is for the start of what she has typed now.
        if (seq !== seqRef.current && !qRef.current.trim().toLowerCase().startsWith(term.toLowerCase())) return;
        shownSeqRef.current = seq;
        setResults(list); setMore(moreOf); setExpanded(null);
        if (!movedRef.current) setSel(0);
        setResultsFor(term);
        if (seq === seqRef.current) setPending(false);
      };
      try {
        const r = await apiFetch(`/search?q=${encodeURIComponent(term)}`);
        land(Array.isArray(r?.results) ? r.results : [], r?.more || {});
      } catch { land([], {}); }
    }, enterRef.current === term ? 0 : 220);
    return ()=>clearTimeout(t);
  },[q,open]);

  const navMatches = useMemo(()=>{
    const term = q.trim().toLowerCase();
    // POLISH-1: an empty box that has been opened (a click, ⌘K or Ctrl K)
    // shows where it can take her, instead of nothing at all.
    if (!term) return QUICK_NAV;
    return QUICK_NAV.filter(a=>a.keywords.includes(term)||a.label.toLowerCase().includes(term));
  },[q]);

  // SEARCH-2: "See all" on a group: the same search, only that group's kinds,
  // up to fifty of each. The group grows in place; the rest stay as they were.
  const seeAll = async group => {
    const keys = SEARCH_KINDS.filter(k=>k.group===group).map(serverKey);
    const term = q.trim(); const seq = seqRef.current;
    try {
      const r = await apiFetch(`/search?q=${encodeURIComponent(term)}&kinds=${keys.join(",")}`);
      if (seq !== seqRef.current) return;
      setExpanded({ group, results: Array.isArray(r?.results) ? r.results : [] });
    } catch { /* the top three stay */ }
    inputRef.current?.focus();
  };

  const pick = item => {
    if (item.seeAll) { seeAll(item.seeAll); return; }
    setOpen(false); setQ(""); setResults(null); setExpanded(null);
    inputRef.current?.blur();
    item.onSelect();
    if (onPicked) onPicked();
  };

  // Flat, ordered list backing keyboard navigation; groups are a render
  // concern only.
  const flat = useMemo(()=>{
    const out = [];
    // WIRE-1: each result is a row in its kind's group, in SEARCH_KINDS
    // order, and opens the screen that kind lives on.
    // SEARCH-2: three to a group, then "See all" when it holds more.
    const byKind = {};
    (results||[]).forEach(r=>{ (byKind[r.kind] = byKind[r.kind] || []).push(r); });
    const exp = {};
    (expanded?.results||[]).forEach(r=>{ (exp[r.kind] = exp[r.kind] || []).push(r); });
    const groupNames = [];
    SEARCH_KINDS.forEach(k=>{ if (!groupNames.includes(k.group)) groupNames.push(k.group); });
    const twins = sameNameTwins(results);   // FLOWS-4: two people with one name say which is which
    groupNames.forEach(g=>{
      const kinds = SEARCH_KINDS.filter(k=>k.group===g);
      const all = expanded?.group===g;
      const rows = [];
      kinds.forEach(k=>(((all?exp:byKind)[k.kind])||[]).forEach(r=>{
        const row = k.row(r);
        rows.push({ group:g, key:k.kind+"_"+r.id, title:r.title, ...row, chip:k.kind==="person"&&twins.has(nameKey(r.title))?typeChip(r):null,
          onSelect:row.url?()=>window.location.assign(row.url):()=>onNavigate(row.tab,row.opts),
          href:row.url||(row.link===false?undefined:tabHref(row.tab,row.opts)) });
      }));
      const shown = all ? rows : rows.slice(0, GROUP_TOP);
      out.push(...shown);
      const hasMore = !all && (rows.length > GROUP_TOP || kinds.some(k=>more[serverKey(k)]));
      if (hasMore) out.push({ group:g, key:"seeall_"+g, title:"See all "+g.toLowerCase(), seeAll:g, isSeeAll:true });
    });
    navMatches.forEach(a=>out.push({
      group:"Go to", key:a.id, title:a.label, sub:a.hint,
      onSelect:()=>a.go(onNavigate),
    }));
    return out;
  },[results,more,expanded,navMatches,onNavigate]);

  // LIST-2: Enter pressed while the answer was on its way opens the top match
  // (a record, never the first "Go to" link) the moment it lands.
  useEffect(()=>{
    const term = enterRef.current;
    if (!term || resultsFor !== term) return;
    enterRef.current = null;
    const top = flat.find(x=>x.group!=="Go to"&&!x.seeAll) || flat[0];
    if (top) pick(top);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[resultsFor,flat]);

  const empty = q.trim().length===0;
  const searching = pending && q.trim().length>=2 && results===null;
  const showDrop = open && (empty || flat.length>0 || searching || (q.trim().length>=2 && results!==null));

  // POLISH-1 — ⌘K / Ctrl K opens the list even when the box already has the
  // focus (focusing a focused field fires no focus event).
  useEffect(()=>{
    const el = inputRef.current;
    if (!el) return undefined;
    const on = () => setOpen(true);
    el.addEventListener(OPEN_EVENT, on);
    return ()=>el.removeEventListener(OPEN_EVENT, on);
  },[inputRef]);

  const onKeyDown = e => {
    if (e.key==="Escape") { setOpen(false); inputRef.current?.blur(); return; }
    const typed = q.trim();
    if (e.key==="Enter" && typed.length>=2 && !movedRef.current && resultsFor!==typed) {
      e.preventDefault(); enterRef.current = typed; setOpen(true);
      return;
    }
    if (!flat.length) return;
    if (e.key==="ArrowDown") { e.preventDefault(); movedRef.current = true; setSel(s=>(s+1)%flat.length); setOpen(true); }
    else if (e.key==="ArrowUp") { movedRef.current = true; e.preventDefault(); setSel(s=>(s-1+flat.length)%flat.length); }
    // An empty box only goes somewhere once she has arrowed to a row.
    else if (e.key==="Enter") { e.preventDefault(); if (movedRef.current) pick(flat[sel]||flat[0]); else if (q.trim()) pick(flat.find(x=>x.group!=="Go to"&&!x.seeAll)||flat[0]); }
  };

  // Grouped render preserving flat indices
  let flatIdx = -1;
  const groups = [];
  flat.forEach(item=>{
    const last = groups[groups.length-1];
    if (!last || last.name!==item.group) groups.push({name:item.group,items:[item]});
    else last.items.push(item);
  });

  return (
    <div ref={rootRef} style={style}>
      <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:"rgba(240,237,230,0.55)",fontSize:13,pointerEvents:"none"}}>⌕</span>
      <input
        ref={inputRef}
        className="topbar-search"
        data-testid="global-search"
        value={q}
        onChange={e=>{setQ(e.target.value);setOpen(true);movedRef.current=false;}}
        onFocus={()=>setOpen(true)}
        onClick={()=>setOpen(true)}
        aria-keyshortcuts={isApplePlatform() ? "Meta+K" : "Control+K"}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        placeholder={placeholder}
        style={{width:"100%",boxSizing:"border-box",background:T.bgElevated,border:"1px solid "+T.green650,borderRadius:10,padding:"7px 12px 7px 30px",color:T.inkInverse,fontSize:13,outline:"none",fontFamily:"inherit"}}
      />
      {showDrop && <div data-testid="search-dropdown" style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,background:T.ink,border:"1px solid "+T.green650,borderRadius:12,boxShadow:"0 12px 40px rgba(0,0,0,0.45)",padding:"6px 0",maxHeight:420,overflowY:"auto",zIndex:130}}>
        {searching && !flat.length && <div data-testid="search-searching" style={{padding:"8px 14px 4px",fontSize:12.5,color:"rgba(240,237,230,0.7)"}}>Searching…</div>}
        {empty && <div data-testid="search-hint" style={{padding:"8px 14px 4px",fontSize:12.5,color:"rgba(240,237,230,0.7)"}}>Type a name, a gift, a note or a meeting.</div>}
        {!empty && !searching && flat.length===0 && <div style={{padding:"10px 14px",fontSize:12.5,color:"rgba(240,237,230,0.55)"}}>No matches for “{q.trim()}”</div>}
        {groups.map(gr=><div key={gr.name}>
          <div className="eyebrow" style={{padding:"6px 14px 3px",color:"rgba(240,237,230,0.55)"}}>{gr.name}</div>
          {gr.items.map(item=>{
            flatIdx++;
            const active = flatIdx===sel && (!empty || movedRef.current);
            const i = flatIdx;
            // FIX-13 Part 6 — a person or grant result is a real link, so
            // Cmd/Ctrl/middle-click opens it in a new tab. A plain press still
            // picks it on mousedown (before the field's blur closes the list).
            const Row = item.href ? RecordLink : "button";
            return <Row key={item.key} data-testid="search-result" {...(item.href?{to:item.href,onOpen:()=>{}}:{})}
              onMouseDown={e=>{if(item.href&&!isPlainLeftClick(e))return;e.preventDefault();pick(item);}}
              onMouseEnter={()=>setSel(i)}
              style={{display:"block",width:"100%",textAlign:"left",background:active?T.bgElevated:"transparent",border:"none",borderLeft:`3px solid ${active?T.gold:"transparent"}`,padding:"7px 14px 7px 11px",cursor:"pointer",boxSizing:"border-box"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                {/* BUILD-94 Part 1 — the same mark the profile and every list
                    uses. Only people get one; a grant is not a person. */}
                {item.personId && <PersonMark id={item.personId} name={item.personName} kind={item.personKind} size={22}/>}
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:T.inkInverse,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",...(item.isSeeAll?{color:T.gold,fontWeight:700,fontSize:12}:{})}} {...(item.isSeeAll?{"data-testid":"search-see-all"}:{})}>{item.title}</span>
                    {item.chip && <span data-testid="search-type-chip" style={{flexShrink:0,fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:99,border:"1px solid rgba(240,237,230,0.35)",color:T.inkInverse}}>{item.chip}</span>}
                    <DriftBadge drift={item.drift}/>
                  </div>
                  {item.sub && <div style={{fontSize:11.5,color:"rgba(240,237,230,0.7)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.sub}</div>}
                </div>
              </div>
            </Row>;
          })}
        </div>)}
      </div>}
    </div>
  );
}

// FIX-26: on a phone, an icon in the header opens the same search across the
// top of the screen; picking a row, Cancel or Escape closes it.
export function MobileSearch({ onNavigate }) {
  const [on,setOn] = useState(false);
  const inputRef = useRef(null);
  return <>
    <button type="button" data-testid="mobile-search-open" aria-label="Search" title="Search" onClick={()=>setOn(true)}
      style={{width:36,height:36,borderRadius:10,background:"transparent",border:"1px solid "+T.green650,color:T.inkInverse,fontSize:17,lineHeight:1,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>⌕</button>
    {on && <div data-testid="mobile-search" role="search"
      onKeyDown={e=>{ if (e.key==="Escape") setOn(false); }}
      style={{position:"fixed",top:0,left:0,right:0,zIndex:300,background:T.ink,borderBottom:"1px solid "+T.bgElevated,padding:"calc(8px + env(safe-area-inset-top,0px)) 12px 8px",display:"flex",gap:8,alignItems:"flex-start",boxSizing:"border-box"}}>
      <GlobalSearch onNavigate={onNavigate} inputRef={inputRef} autoFocus onPicked={()=>setOn(false)}
        placeholder="Search people, gifts, notes"
        style={{position:"relative",flex:1,minWidth:0}}/>
      <button type="button" onClick={()=>setOn(false)}
        style={{background:"transparent",border:"none",color:T.inkInverse,fontSize:13,fontWeight:600,padding:"8px 4px",cursor:"pointer",flexShrink:0}}>Cancel</button>
    </div>}
  </>;
}

export function TopBar({ auth, logout, onNavigate, screen }) {
  const [helpOpen,setHelpOpen] = useState(false);
  const [meOpen,setMeOpen] = useState(false);
  // TRUST-2 — What's new. A dot on the chip until the newest entry is opened.
  const [wnOpen,setWnOpen] = useState(false);
  const [wnHidden,setWnHidden] = useState(null);
  const [wnSeen,setWnSeen] = useState(()=>{ try { return localStorage.getItem(LAST_SEEN_KEY)||""; } catch { return ""; } });
  useEffect(()=>{ apiFetch("/changelog/hidden").then(d=>setWnHidden(new Set(d.hidden||[]))).catch(()=>setWnHidden(new Set())); },[]);
  // SWEEP-6 (PERF-1): the entries are every docs/changelog file, so they load
  // once the page has drawn, not before Home's first look.
  const [changelog,setChangelog] = useState([]);
  const [PRODUCT_WORDS,setProductWords] = useState({});   // PERF-2: with the entries, not with Home
  const loadChangelog = () => { import("../lib/changelog").then(m=>{setProductWords(m.PRODUCT_WORDS);setChangelog(m.CHANGELOG);}).catch(()=>{}); };
  useEffect(()=>{ const t=setTimeout(()=>{ if(window.requestIdleCallback) window.requestIdleCallback(loadChangelog,{timeout:4000}); else loadChangelog(); },4000); return ()=>clearTimeout(t); },[]);
  useEffect(()=>{ if(meOpen&&!changelog.length) loadChangelog(); },[meOpen]);   // eslint-disable-line react-hooks/exhaustive-deps
  const wnEntries = changelog.filter(e=>!wnHidden||!wnHidden.has(e.id));
  const wnUnseen = !!wnEntries[0] && wnEntries[0].id !== wnSeen && wnHidden!==null;
  const openWn = () => { setWnOpen(true); const id=wnEntries[0]?.id||""; setWnSeen(id); try { localStorage.setItem(LAST_SEEN_KEY,id); } catch { /* private window */ } };
  const meRef = useRef(null);
  const inputRef = useRef(null);

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
        el.dispatchEvent(new Event(OPEN_EVENT));
      }
    };
    window.addEventListener("keydown",onKey);
    return ()=>window.removeEventListener("keydown",onKey);
  },[]);

  // Close dropdowns on outside click
  useEffect(()=>{
    const onDown = e => {
      if (meRef.current && !meRef.current.contains(e.target)) setMeOpen(false);
    };
    document.addEventListener("mousedown",onDown);
    return ()=>document.removeEventListener("mousedown",onDown);
  },[]);


  // BUILD-88a A.4 — FIRST NAME EVERYWHERE. The bar showed the whole stored
  // name, so a seeded "Admin User" sat at the top of every screen in the
  // product. It is how a colleague is addressed, not how a row is keyed.
  const userName = firstNameOf(auth?.user?.name) || "You";
  // HARDEN-1 item 6: a super admin, or a browser that has been signed in to
  // more than one org, always sees which org this tab is in.
  // ACCESS-1: and anyone in more than one org, who can switch from the menu.
  const myOrgs = useMyOrgs(!!auth?.user && !auth?.user?.support);
  const manyOrgs = (myOrgs || []).length > 1;
  const [switchOpen, setSwitchOpen] = useState(false);
  // The viewer's button gate is loaded only for a viewer (lib/viewOnlyGate.js).
  const viewer = auth?.user?.role === "viewer";
  useEffect(() => { if (viewer) import("../lib/viewOnlyGate.js").then(m => m.installViewOnlyGate()).catch(() => {}); }, [viewer]);
  const orgLabel = (auth?.user?.isSuperAdmin || manyOrgs || orgsSeenCount() > 1) ? (auth?.org?.name || "") : "";

  return <div className="app-topbar" style={{height:52,background:T.ink,borderBottom:"1px solid "+T.bgElevated,display:"flex",alignItems:"center",gap:14,padding:"0 20px 0 0",position:"fixed",top:0,left:0,right:0,zIndex:250,boxSizing:"border-box"}}>

    {/* Wordmark — over the 240px sidebar rail zone (20px inset matches the
        old sidebar wordmark), links to Home */}
    <button data-testid="topbar-wordmark" onClick={()=>onNavigate("dashboard")} title="Steward: Home"
      style={{width:240,flexShrink:0,textAlign:"left",padding:"0 20px",background:"transparent",border:"none",cursor:"pointer",boxSizing:"border-box"}}>
      <span style={{fontSize:21,fontWeight:400,color:T.inkInverse,fontFamily:"'DM Serif Display',Georgia,serif",letterSpacing:"-0.02em"}}>Steward</span>
    </button>

    {/* Global search */}
    <GlobalSearch onNavigate={onNavigate} inputRef={inputRef}
      style={{position:"relative",flex:"0 1 560px",minWidth:0}}/>

    <div style={{flex:1}}/>

    {orgLabel && <div data-testid="topbar-org" title={"You are in " + orgLabel}
      style={{maxWidth:260,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:T.inkInverse,fontSize:13.5,fontWeight:700,
              padding:"4px 10px",border:"1px solid "+T.green650,borderRadius:8}}>{orgLabel}</div>}
    {viewer && <div data-testid="topbar-view-only" title="View-only access: you can see every page, and change nothing"
      style={{color:T.gold,fontSize:12,fontWeight:700,padding:"4px 9px",border:"1px solid "+T.gold,borderRadius:8,whiteSpace:"nowrap"}}>View only</div>}

    {/* HOME-6 — no Automatic email pill up here: the setting lives in Settings, Automatic email. */}

    {/* HELP-1 — the "?" opens the article for this screen, beside the page. */}
    {/* AGENT-5: the bell. Everything Atlas did and readied; its count is what waits. */}
    <AtlasBell onNavigate={onNavigate}/>
    <button data-testid="topbar-help" onClick={()=>setHelpOpen(true)} title="Help for this screen" aria-label="Help for this screen"
      style={{width:28,height:28,borderRadius:"50%",background:helpOpen?T.bgElevated:"transparent",border:"1px solid "+T.green650,color:"rgba(240,237,230,0.7)",fontSize:13,fontWeight:700,cursor:"pointer",lineHeight:1}}>?</button>
    {helpOpen && <Suspense fallback={null}><HelpPanel screen={screen} onClose={()=>setHelpOpen(false)}/></Suspense>}

    {/* User chip + sign out (moved from sidebar bottom).
        INT-BUILD-1 Part 0 — THE CHIP OPENS A MENU NOW. INT-4 said the inbox
        connect was "in the profile menu"; there was no profile menu, only a
        button straight to Account, which is half of why nobody found it. */}
    <div style={{display:"flex",alignItems:"center",gap:9}}>
      <div ref={meRef} style={{position:"relative"}}>
      <button data-testid="topbar-me" onClick={()=>setMeOpen(v=>!v)} title="Your account" aria-expanded={meOpen} aria-haspopup="menu"
        style={{display:"flex",alignItems:"center",gap:9,background:meOpen?T.bgElevated:"transparent",border:"none",padding:"3px 5px",borderRadius:8,cursor:"pointer"}}>
        <div style={{width:28,height:28,borderRadius:8,background:T.bg2,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <span style={{fontSize:11,fontWeight:700,color:T.ink}}>{userName[0].toUpperCase()}</span>
        </div>
        <span style={{fontSize:12.5,fontWeight:600,color:T.inkInverse,maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{userName}</span>
        {wnUnseen && <span data-testid="whats-new-dot" aria-label="Something new" style={{width:7,height:7,borderRadius:99,background:T.gold,flexShrink:0}}/>}
      </button>
      {meOpen && <div role="menu" style={{position:"absolute",top:"calc(100% + 8px)",right:0,background:T.ink,border:"1px solid "+T.green650,borderRadius:12,boxShadow:"0 12px 40px rgba(0,0,0,0.45)",padding:"6px 0",width:230,zIndex:130}}>
        {[["Account settings","Your name, password and sign-in",()=>onNavigate("settings",{section:"account"})],
          ["Your email","Your weekly and daily email: what's in them and when",()=>onNavigate("settings",{section:"myemail"})],
          ...(manyOrgs?[["Switch organization",`You're in ${auth?.org?.name||"this organization"}`,()=>setSwitchOpen(true)]]:[]),
          ...(viewer?[]:[["Connect your inbox","Gmail or Outlook, so conversations log themselves",()=>onNavigate("settings",{section:"connections",focus:"inbox"})]]),
          ["Two-factor and sessions","A code at sign-in, and every browser you're signed in on",()=>onNavigate("settings",{section:"security"})],
          ["Recent changes","Your last 50 changes, each with Undo",openRecentChanges],
          ["What's new"+(wnUnseen?" ·":""),"What we shipped lately",openWn]]
          .map(([label,sub,go])=><button key={label} role="menuitem" data-viewer-ok="1" data-testid={label==="Connect your inbox"?"topbar-connect-inbox":label==="Recent changes"?"topbar-recent-changes":label==="Switch organization"?"topbar-switch-org":undefined}
            onClick={()=>{setMeOpen(false);go();}}
            style={{display:"block",width:"100%",textAlign:"left",background:"transparent",border:"none",padding:"8px 14px",cursor:"pointer",fontFamily:"inherit"}}>
            <div style={{fontSize:13,color:T.inkInverse,fontWeight:600}}>{label}</div>
            <div style={{fontSize:11,color:"rgba(240,237,230,0.7)"}}>{sub}</div>
          </button>)}
      </div>}
      </div>
      <button onClick={logout} style={{background:"transparent",border:"1px solid "+T.green650,borderRadius:8,padding:"5px 11px",color:"rgba(240,237,230,0.7)",fontSize:12,cursor:"pointer"}}>Sign out</button>
    </div>
    {switchOpen && <Suspense fallback={null}><OrgSwitcher orgs={myOrgs} currentId={auth?.org?.id} onClose={()=>setSwitchOpen(false)}/></Suspense>}
    {wnOpen && <div role="dialog" aria-label="What's new" data-testid="whats-new-panel" onClick={()=>setWnOpen(false)}
      style={{position:"fixed",inset:0,background:"rgba(15,26,18,0.5)",zIndex:400,display:"flex",justifyContent:"flex-end"}}>
      <div onClick={e=>e.stopPropagation()} style={{width:"min(440px,100%)",height:"100%",overflowY:"auto",background:T.bg,padding:"24px 22px",boxSizing:"border-box"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <span style={{fontFamily:"'DM Serif Display',serif",fontSize:26,color:T.ink}}>What's new</span>
          <button onClick={()=>setWnOpen(false)} aria-label="Close" style={{background:"none",border:"none",fontSize:20,color:T.ink3,cursor:"pointer"}}>×</button>
        </div>
        {wnEntries.map(e=><div key={e.id} style={{background:T.white,borderRadius:14,padding:"14px 16px",marginBottom:10}}>
          <div style={{fontSize:11,color:T.ink3}}>{PRODUCT_WORDS[e.product]||"New"} · {new Date(e.date+"T12:00:00Z").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"})}</div>
          <div style={{fontSize:15,fontWeight:700,color:T.ink,margin:"4px 0"}}>{e.title}</div>
          <div style={{fontSize:13.5,color:T.ink2,lineHeight:1.55}}>{e.body}</div>
        </div>)}
        <a href="/whats-new" target="_blank" rel="noreferrer" style={{fontSize:13,color:T.greenDk}}>The full list</a>
      </div>
    </div>}
  </div>;
}

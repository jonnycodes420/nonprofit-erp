import { countLabel } from "../../../../shared/countWords.js";
import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { T, fmtFull, Modal, SectionLabel } from "../shared";
import { askConfirm } from "../ConfirmDialog";
import SpreadsheetImport from "../SpreadsheetImport";

// ── BUILD-89S 89f — WHERE GIVING COMES IN ─────────────────────────────────
// An organisation keeps what it takes gifts through today. This page is the
// whole of what that looks like from the inside: one tile per source, when
// Steward last looked, how many gifts it found, a way to look now, and a way
// to stop.
//
// NEVER "live", NEVER "real time". Steward checks every six hours and PayPal
// itself can take up to three hours to publish a transaction. The screen says
// when it last looked, with the time on it.
//
// ── BUILD-92 B2 · THE PAGE JONATHAN SHARES HIS SCREEN ON ───────────────────
// It is the same component in two places: a step in onboarding, right after
// the donor file goes in, and Settings → Where giving comes in forever after.
// Two plain groups, because the difference between them is the only thing a
// person needs to understand here:
//
//   "Connects directly"   Steward holds a read key and checks every six hours.
//   "Upload a statement"  There is no API that reads the account. Once a month
//                         a human drops the statement in.
//
// Cash App and Venmo are NEVER in the first group. Neither has an API that
// reads an account, and a tile that implies otherwise is a promise the product
// cannot keep, which is the one thing this whole area of the product exists
// not to do.
//
// ONBOARDING NEVER BLOCKS ON A SOURCE. "I'll do this later" is always there.
export function checkedPhrase(lastSyncedAt){
  if(!lastSyncedAt) return "not checked yet";
  const then=new Date(lastSyncedAt);
  if(Number.isNaN(then.getTime())) return "not checked yet";
  const mins=Math.round((Date.now()-then.getTime())/60000);
  const clock=then.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
  if(mins<2) return "checked just now";
  if(mins<60) return `checked ${mins} minutes ago, at ${clock}`;
  const hrs=Math.round(mins/60);
  if(hrs<24) return `checked ${countLabel(hrs, "hour")} ago, at ${clock}`;
  return `checked ${then.toLocaleDateString(undefined,{month:"short",day:"numeric"})} at ${clock}`;
}

// When Steward last TRIED, for a source whose last attempt did not work. A
// failure must never sit beside "not checked yet": Steward did check, and
// saying otherwise reads as a second, different fault.
export function triedPhrase(at){
  if(!at) return "Tried just now";
  const then=new Date(at);
  if(Number.isNaN(then.getTime())) return "Tried just now";
  return "Tried at "+then.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
}

// THE FOUR STATES A TILE CAN BE IN.
//   none      nothing connected yet
//   connected Steward holds a key and has looked
//   waiting   the provider has not switched the permission on YET. Brass, not
//             red: nothing is broken and nobody has to do anything.
//   failed    Steward tried and was refused or could not reach the account.
//
// SEAM (BUILD-92, Track A in parallel): the API is growing an explicit
// `waiting` flag and a `lastTriedAt`. Until those land, `waiting` is read from
// the shape of the provider's own sentence, and the timestamp falls back to
// lastErrorAt. Both degrade to the current API rather than assuming the new
// one: an absent field must never turn a working page into a broken one.
export const WAITING_RE=/not (yet )?(allowed|enabled|approved|permitted)|no permission|permission is not|still switching|not authorized yet/i;
export function sourceState(s){
  if(!s||s.connected===false||s.status==="disconnected") return "none";
  if(s.waiting===true) return "waiting";
  if(s.lastError) return WAITING_RE.test(s.lastError)?"waiting":"failed";
  return "connected";
}
export const STATE_LABEL={none:"Not connected",connected:"Connected",waiting:"Waiting on the provider",failed:"Could not check"};

// THE LOGO SLOT.
// The slot is built and the names are set in type. No company's mark is drawn,
// traced or approximated in code here, and nothing is shipped from a brand
// page that has not been read: turning this on is a decision about somebody
// else's trademark terms, and it is Jonathan's to make, not a build's. When he
// has skimmed the terms, official files go in client/src/assets/sources/ with
// a SOURCES.md naming the URL and date each came from, they are registered in
// SOURCE_LOGOS below, and this ONE flag turns them on everywhere.
export const SOURCE_LOGOS_ENABLED=false;
export const SOURCE_LOGOS={};   // key -> imported asset URL, once the files exist

// The two groups, in order. Track C may merge another direct source; it is
// added here and nowhere else. Cash App and Venmo are pinned to the upload
// group by the registry's own `mode`, and a guard holds them there.
export const DIRECT_ORDER=["paypal","zeffy","stripe","givebutter","square"];

// ── BUILD-96 Part 4 — AN ADAPTER THAT HAS NEVER SEEN A REAL PAYLOAD ────────
// Zeffy and Square both have merged, green adapters and NEITHER has read a
// real payment. That is the state BUILD-91's rule was written for: they stay
// off the public allowlist entirely (shared/publicSources.js — still empty),
// and in-app they say what is actually true rather than sitting in the row
// looking exactly like PayPal.
//
// "Available" is honest — the adapter is there and an org can connect one
// today. "Being verified with a first organization" is the part that stops it
// reading as a finished integration, and the ask is the one thing Jonathan
// needs from that organisation, in one sentence, so the screen is also the
// request. Nothing else is promised here.
//
// A key leaves this map the moment a real account has synced through it, and
// NEEDS-JONATHAN.md §6 is where the two asks are tracked.
// CONNECT-2 (11 Oct 2026): Zeffy and Square were checked field by field
// against each provider's published reference, and the tile no longer says
// "being verified". What each one needs from the organisation is in the
// connect panel's own steps. The map stays, empty, as the seam for the next
// provider that has never read a real payload.
export const VERIFYING={};
export const VERIFYING_LINE="Available, being verified with a first organization.";
export const UPLOAD_ORDER=["cashapp","venmo"];
export const STATEMENT_LINE="Once a month, drop the statement in.";
// The bank is not a provider and never will be one, so it is a tile in its own
// right rather than a row in the registry.
export const BANK_TILE={key:"bank",label:"My bank (Zelle, checks, anything else)",mode:"file"};

// CONNECT-2 · WHICH SQUARE LOCATIONS TAKE GIFTS. Square cannot tell a
// donation from a lesson fee, so nothing comes in until these are chosen.
// The list is Square's own, read when the person opens it.
export function SquareLocations({sourceId,disabled,onSaved}){
  const [open,setOpen]=useState(false);
  const [state,setState]=useState(null); // {locations, sentence} | {error}
  const [picked,setPicked]=useState([]);
  const [saving,setSaving]=useState(false);
  const read=async()=>{
    setOpen(true); setState(null);
    try{
      const r=await apiFetch(`/giving-sources/${sourceId}/square-locations`,{method:"POST",body:JSON.stringify({})});
      setState(r); setPicked((r.locations||[]).filter(l=>l.chosen).map(l=>l.id));
    }catch(e){ setState({error:errorMessage(e,"Steward could not read your Square locations.")}); }
  };
  const save=async()=>{
    setSaving(true);
    try{ await apiFetch(`/giving-sources/${sourceId}`,{method:"PATCH",body:JSON.stringify({config:{locationIds:picked}})}); setOpen(false); onSaved&&onSaved(); }
    catch(e){ setState(st=>({...(st||{}),error:errorMessage(e,"Could not save the locations.")})); }
    finally{ setSaving(false); }
  };
  if(!open) return (
    <button data-testid="gs-square-locations" disabled={disabled} onClick={read}
      style={{font:"inherit",fontSize:11.5,marginTop:8,padding:0,background:"none",border:"none",color:T.green,cursor:"pointer",textDecoration:"underline"}}>
      Choose which Square locations take donations
    </button>);
  return (
    <div data-testid="gs-square-panel" style={{fontSize:11.5,color:T.ink,marginTop:8,lineHeight:1.5}}>
      {!state&&<div style={{color:T.ink3}}>Reading your Square locations…</div>}
      {state&&state.error&&<div style={{color:T.terra700}}>{state.error}</div>}
      {state&&state.locations&&(<>
        <div style={{color:T.ink3,marginBottom:4}}>{state.sentence}</div>
        {state.locations.map(l=>(
          <label key={l.id} style={{display:"flex",gap:6,alignItems:"center"}}>
            <input type="checkbox" checked={picked.includes(l.id)} disabled={disabled}
              onChange={e=>setPicked(p=>e.target.checked?[...p,l.id]:p.filter(x=>x!==l.id))}/>
            {l.name}{l.active?"":" (closed)"}
          </label>))}
        <button data-testid="gs-square-save" disabled={disabled||saving} onClick={save}
          style={{font:"inherit",fontSize:11.5,fontWeight:700,marginTop:6,padding:"4px 10px",borderRadius:6,border:"none",background:T.green,color:T.white,cursor:"pointer"}}>
          {saving?"Saving…":"Save locations"}
        </button>
      </>)}
    </div>);
}

export function GivingSourceTile({title,logoKey,state,statusLine,note,error,actions,onOpen,openLabel}){
  const tone=state==="waiting"?T.gold700:state==="failed"?T.terra700:T.ink3;
  return (
    <div data-testid="gs-tile" style={{border:"1px solid "+T.bg3,borderRadius:14,background:T.bgCard,
      display:"flex",flexDirection:"column",minHeight:150,overflow:"hidden"}}>
      <button data-testid="gs-connect-btn" type="button" onClick={onOpen}
        aria-label={openLabel}
        style={{font:"inherit",textAlign:"left",background:"none",border:"none",cursor:"pointer",
          padding:"18px 18px 14px",display:"flex",flexDirection:"column",gap:8,flex:1,color:T.ink}}>
        {SOURCE_LOGOS_ENABLED&&SOURCE_LOGOS[logoKey]&&(
          <span aria-hidden style={{height:26,display:"flex",alignItems:"center"}}>
            <img src={SOURCE_LOGOS[logoKey]} alt="" style={{maxHeight:26,maxWidth:120}}/>
          </span>)}
        <span data-testid="gs-name" style={{fontSize:17,fontWeight:700,letterSpacing:"-0.01em",color:T.ink,lineHeight:1.25}}>{title}</span>
        <span style={{fontSize:11.5,fontWeight:700,color:tone}}>
          {STATE_LABEL[state]||STATE_LABEL.none}
        </span>
        <span data-testid="gs-checked" style={{fontSize:12.5,color:T.ink3,lineHeight:1.5}}>{statusLine}</span>
        {note&&<span style={{fontSize:12.5,color:T.ink3,lineHeight:1.5}}>{note}</span>}
      </button>
      {error&&(
        <div data-testid="gs-row-error" style={{fontSize:12,color:T.terra700,lineHeight:1.5,padding:"0 18px 12px"}}>{error}</div>
      )}
      {actions&&<div style={{padding:"0 18px 16px"}}>{actions}</div>}
    </div>
  );
}

export function GivingSourcesManager({isReadOnly,isAdmin,compact,autoConnect,onChanged}){
  const [sources,setSources]=useState(null);
  const [providers,setProviders]=useState([]);
  const [credState,setCredState]=useState({ready:true,problem:null});
  const [funds,setFunds]=useState([]);
  const [otherSources,setOtherSources]=useState([]);
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState("");
  const [connect,setConnect]=useState(null); // {provider, values, testing, tested}
  const [panel,setPanel]=useState(null);     // {kind:"file"|"other", label}
  const [otherName,setOtherName]=useState("");
  const [showImport,setShowImport]=useState(false);

  // FIX-34 Y: after a connect, a disconnect or a check, the page around this
  // panel (the Connections card above it) reads the same row again, so one
  // connection never shows two states at once.
  const load=(changed=true)=>apiFetch("/giving-sources")
    .then(r=>{setSources(Array.isArray(r.sources)?r.sources:[]);setOtherSources(Array.isArray(r.otherSources)?r.otherSources:[]);
      if(Array.isArray(r.funds)) setFunds(r.funds);
      if(changed&&onChanged) onChanged();})
    .catch(e=>{setSources([]);setErr(errorMessage(e,"Could not load your giving sources."));});

  useEffect(()=>{
    load(false);
    apiFetch("/giving-sources/providers").then(r=>{
      setProviders(Array.isArray(r.providers)?r.providers:[]);
      setCredState({ready:r.credentialsReady!==false,problem:r.credentialsProblem||null});
    }).catch(()=>{});
    // FIX-34 Y: the funds come with /giving-sources now. /finance/funds
    // answers with a bare array and this read `r.funds` off it, so the
    // picker offered no fund at all.
  },[]);

  const checkNow=async(id)=>{
    setBusy(id); setErr("");
    try{
      const r=await apiFetch(`/giving-sources/${id}/sync`,{method:"POST",body:JSON.stringify({})});
      if(r&&r.ok===false&&r.message) setErr(r.message);
      await load();
    }catch(e){ setErr(errorMessage(e,"Steward could not check that source just now.")); }
    finally{ setBusy(""); }
  };

  const disconnect=async(s)=>{
    // Disconnect KEEPS every gift, and the confirm says so rather than asking
    // a frightening question about deletion that is not what happens.
    if(!(await askConfirm({title:`Stop checking ${s.displayName}?`,body:`The ${countLabel(s.giftsTotal, "gift")} already read from it stay on your records.`,yes:"Stop checking"}))) return;
    setBusy(s.id); setErr("");
    try{ await apiFetch(`/giving-sources/${s.id}`,{method:"DELETE"}); await load(); }
    catch(e){ setErr(errorMessage(e,"Could not disconnect that source.")); }
    finally{ setBusy(""); }
  };

  const setFund=async(id,fundId)=>{
    try{ await apiFetch(`/giving-sources/${id}`,{method:"PATCH",body:JSON.stringify({defaultFundId:fundId||null})}); await load(); }
    catch(e){ setErr(errorMessage(e,"Could not set the fund for that source.")); }
  };

  const chooseFund=async(id,giftId,fundId)=>{
    try{ await apiFetch(`/giving-sources/${id}/fund`,{method:"POST",body:JSON.stringify({giftId,fundId})}); await load(); }
    catch(e){ setErr(errorMessage(e,"Could not set the fund for that gift.")); }
  };

  const startConnect=(p)=>setConnect({provider:p,values:{},testing:false,tested:null,error:""});
  // FIX-13 Part 5 — a Connect on a Connections card opens THIS panel for that
  // provider: the same panel, the same Test and Connect, one click sooner.
  useEffect(()=>{
    if(!autoConnect||!credState.ready||!isAdmin||isReadOnly) return;
    const p=providers.find(x=>x.key===autoConnect);
    if(p) startConnect(p);
  },[autoConnect,providers.length,credState.ready]); // eslint-disable-line
  const testConnect=async()=>{
    setConnect(c=>({...c,testing:true,error:"",tested:null}));
    try{
      const r=await apiFetch("/giving-sources/test",{method:"POST",
        body:JSON.stringify({provider:connect.provider.key,credentials:connect.values})});
      setConnect(c=>({...c,testing:false,tested:r,error:r&&r.ok===false?(r.message||"That key was refused."):""}));
    }catch(e){ setConnect(c=>({...c,testing:false,error:errorMessage(e,"Steward could not reach that provider.")})); }
  };
  const saveConnect=async()=>{
    setConnect(c=>({...c,testing:true,error:""}));
    try{
      await apiFetch("/giving-sources",{method:"POST",
        body:JSON.stringify({provider:connect.provider.key,credentials:connect.values})});
      setConnect(null); await load();
    }catch(e){ setConnect(c=>({...c,testing:false,error:errorMessage(e,"Could not connect that source.")})); }
  };

  // "Something else": the name is RECORDED on the organisation, and then the
  // ordinary import opens. SEAM (BUILD-92, Track A in parallel): a generic
  // statement preset is being built; when it lands, the import below takes the
  // typed name as its preset. Until then this is the normal import path and
  // nothing here depends on that work.
  const saveOther=async()=>{
    const name=otherName.trim();
    if(!name) return;
    setBusy("other"); setErr("");
    try{
      const r=await apiFetch("/giving-sources/other",{method:"POST",body:JSON.stringify({name})});
      if(Array.isArray(r.otherSources)) setOtherSources(r.otherSources);
      setPanel(null); setOtherName(""); setShowImport(true);
    }catch(e){ setErr(errorMessage(e,"Could not record that name.")); }
    finally{ setBusy(""); }
  };

  const byProvider={};
  for(const s of (sources||[])) if(s.status!=="disconnected") byProvider[s.provider]=s;
  const providerByKey=Object.fromEntries(providers.map(p=>[p.key,p]));
  const apiProviders=providers.filter(p=>p.mode==="api");
  const fileProviders=providers.filter(p=>p.mode==="file");

  // ONE ERROR SENTENCE, ONCE. Two sources refused by the same expired key used
  // to print the same paragraph twice, which reads as two problems. The page
  // keeps a set of what it has already said and shows each sentence once.
  const saidErrors=new Set();
  const sayErrorOnce=(s)=>{
    const msg=(s&&s.lastError||"").trim();
    if(!msg||saidErrors.has(msg)) return false;
    saidErrors.add(msg);
    return true;
  };

  const groupHead=(text)=>(
    <h3 style={{fontSize:13,fontWeight:700,color:T.ink,margin:"22px 0 10px"}}>{text}</h3>
  );
  const grid={display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))",gap:14};
  const quietBtn={font:"inherit",fontSize:12.5,padding:"6px 11px",borderRadius:8,cursor:"pointer",
    background:"none",color:T.ink3,border:"1px solid "+T.bg3};
  const greenBtn={font:"inherit",fontSize:12.5,fontWeight:700,padding:"6px 12px",borderRadius:8,
    border:"none",background:T.green,color:T.white,cursor:"pointer"};

  const body=(
    <>
      <div data-testid="gs-intro" style={{fontSize:13,color:T.ink3,marginBottom:18,lineHeight:1.6,maxWidth:600}}>
        Keep whatever you take gifts through today. Steward reads those gifts onto your donor records and never holds or moves a dollar. You can switch any of this off at any time, and the gifts already read stay where they are.
      </div>

      {err&&<div data-testid="gs-error" style={{fontSize:12.5,color:T.terra700,marginBottom:14}}>{err}</div>}

      {!credState.ready&&(
        <div data-testid="gs-unavailable" style={{fontSize:12.5,color:T.terra700,marginBottom:14,lineHeight:1.6}}>
          Steward cannot store a provider key safely on this server yet, so connecting is switched off until an administrator sets one up. Nothing you have is affected.
        </div>
      )}

      {sources===null&&<div style={{fontSize:13,color:T.ink3}}>Loading…</div>}

      {/* ── Connects directly ────────────────────────────────────────────── */}
      <section data-testid="gs-group" data-gs-group="direct">
      {groupHead("Connects directly")}
      <div style={grid}>
        {DIRECT_ORDER.filter(k=>providerByKey[k]).map(k=>{
          const p=providerByKey[k], s=byProvider[k], state=sourceState(s);
          const gifts=s&&s.everChecked?`, ${countLabel(s.giftsThisWeek, "new gift")} this week`:"";
          // An unverified provider says so INSTEAD of the generic line, and
          // only while nothing is connected: once this org has connected one,
          // what its own connection is doing is the more useful truth.
          const verifying=state==="none"&&VERIFYING[k];
          const status=state==="connected"?checkedPhrase(s.lastSyncedAt)+gifts
            :state==="waiting"||state==="failed"?triedPhrase(s.lastTriedAt||s.lastErrorAt||s.lastSyncedAt)
            :verifying?VERIFYING_LINE
            :"Steward checks every six hours once it is connected.";
          // The SERVER's own sentence, never a code, and never twice.
          const row=state!=="none"&&sayErrorOnce(s)?<span>{s.lastError}</span>:null;
          return (
            <div key={k} {...(state!=="none"?{"data-testid":"gs-row"}:{})}>
              <GivingSourceTile title={p.label} logoKey={k} state={state} statusLine={status} error={row}
                note={verifying?<span data-testid="gs-verifying-ask">{VERIFYING[k]}</span>:null}
                openLabel={state==="none"?`Connect ${p.label}`:`${p.label}, ${STATE_LABEL[state].toLowerCase()}`}
                onOpen={()=>{ if(credState.ready&&isAdmin&&!isReadOnly) startConnect(p); }}
                actions={state!=="none"?(
                  <div>
                    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                      <button data-testid="gs-check-now" disabled={busy===s.id||isReadOnly||!isAdmin} onClick={()=>checkNow(s.id)}
                        style={{...greenBtn,cursor:busy===s.id?"wait":"pointer",opacity:(isReadOnly||!isAdmin)?0.5:1}}>
                        {busy===s.id?"Checking…":"Check now"}
                      </button>
                      <button data-testid="gs-disconnect" disabled={busy===s.id||isReadOnly||!isAdmin} onClick={()=>disconnect(s)}
                        style={{font:"inherit",fontSize:12.5,padding:"6px 10px",borderRadius:8,cursor:"pointer",
                          background:"none",color:T.ink3,border:"none",opacity:(isReadOnly||!isAdmin)?0.5:1}}>
                        Disconnect
                      </button>
                    </div>
                    {s.lastRun&&(
                      <div data-testid="gs-last-run" style={{fontSize:11.5,color:T.ink3,marginTop:8,lineHeight:1.5}}>
                        {s.lastRun.sentence}
                        {s.lastRun.feeCents>0&&` Fees ${fmtFull(s.lastRun.feeCents/100)}, so ${fmtFull((s.lastRun.centsCreated-s.lastRun.feeCents)/100)} net.`}
                      </div>)}
                    {s.lastRun&&s.lastRun.skipped&&s.lastRun.skipped.length>0&&(
                      <details data-testid="gs-skipped" style={{fontSize:11.5,color:T.ink3,marginTop:6}}>
                        <summary style={{cursor:"pointer"}}>{countLabel(s.lastRun.skipped.length, "row")} skipped</summary>
                        <ul style={{margin:"6px 0 0",paddingLeft:16,lineHeight:1.5}}>
                          {s.lastRun.skipped.map((r,i)=><li key={i}>{r.externalId||"A row with no id"}: {r.reason}</li>)}
                        </ul>
                      </details>)}
                    {k==="square"&&<SquareLocations sourceId={s.id} disabled={isReadOnly||!isAdmin} onSaved={load}/>}
                    <div style={{fontSize:11.5,color:T.ink3,marginTop:8}}>
                      Gifts go to{" "}
                      <select data-testid="gs-fund" value={s.defaultFundId||""} disabled={isReadOnly||!isAdmin}
                        onChange={e=>setFund(s.id,e.target.value)}
                        style={{font:"inherit",fontSize:11.5,padding:"2px 4px",border:"1px solid "+T.bg3,borderRadius:6,background:T.bgCard,color:T.ink}}>
                        <option value="">Ask me each time</option>
                        {funds.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </div>
                    {(s.needsFund||[]).length>0&&(
                      <div data-testid="gs-needs-fund" style={{fontSize:11.5,color:T.ink,marginTop:8,lineHeight:1.5}}>
                        {s.needsFund.length} gift{s.needsFund.length===1?" is":"s are"} waiting for you to choose a fund:
                        {s.needsFund.map(g=>(
                          <div key={g.giftId} style={{display:"flex",gap:6,alignItems:"center",marginTop:4,flexWrap:"wrap"}}>
                            <span>{g.donorName||"A donor"}, {fmtFull(g.cents/100)} on {g.date}</span>
                            <select data-testid="gs-gift-fund" defaultValue="" disabled={isReadOnly||!isAdmin}
                              onChange={e=>e.target.value&&chooseFund(s.id,g.giftId,e.target.value)}
                              style={{font:"inherit",fontSize:11.5,padding:"2px 4px",border:"1px solid "+T.bg3,borderRadius:6,background:T.bgCard,color:T.ink}}>
                              <option value="">Choose a fund</option>
                              {funds.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
                            </select>
                          </div>))}
                      </div>)}
                  </div>
                ):null}/>
            </div>
          );
        })}
      </div>

      </section>

      {/* ── Upload a statement ───────────────────────────────────────────── */}
      {/* CASH APP AND VENMO LIVE HERE AND NOWHERE ELSE. Neither has an API
          that reads an account; a tile in the group above would be a promise
          the product cannot keep. The registry's `mode` is what puts them
          here, and a guard holds them to it. */}
      <section data-testid="gs-group" data-gs-group="upload">
      {groupHead("Upload a statement")}
      <div style={grid}>
        {[...UPLOAD_ORDER.filter(k=>providerByKey[k]).map(k=>({key:k,label:providerByKey[k].label})),BANK_TILE].map(t=>(
          <GivingSourceTile key={t.key} title={t.label} logoKey={t.key} state="none"
            statusLine={STATEMENT_LINE}
            openLabel={`Upload a statement from ${t.label}`}
            onOpen={()=>setPanel({kind:"file",label:t.label})}/>
        ))}
        <GivingSourceTile title="Something else" logoKey="other" state="none"
          statusLine={otherSources.length?`You named ${otherSources.join(", ")}.`:"Tell Steward the name and drop a statement in."}
          openLabel="Tell Steward about another place gifts come in"
          onOpen={()=>setPanel({kind:"other",label:"Something else"})}/>
      </div>
      </section>

      <div data-testid="gs-file-note" style={{fontSize:12.5,color:T.ink3,marginTop:14,lineHeight:1.6,maxWidth:600}}>
        {fileProviders.map(p=>p.label).join(" and ")} have no way for Steward to read an account, so there is nothing to connect. Once a month you drop the statement in on the import screen and Steward reads it.
      </div>

      {/* ── The panel. THE ONE MODAL SHELL (BUILD-87 F.1). ───────────────── */}
      {connect&&(
        <Modal onClose={()=>setConnect(null)} width={520}
          title={`Connect ${connect.provider.label}`}
          ariaLabel={`Connect ${connect.provider.label}`}
          footer={
            <div data-testid="gs-connect-panel" style={{display:"flex",gap:8,alignItems:"center"}}>
              <button onClick={()=>setConnect(null)}
                style={{...quietBtn,border:"none"}}>Cancel</button>
              <button data-testid="gs-test" disabled={connect.testing} onClick={testConnect}
                style={quietBtn}>{connect.testing?"Checking…":"Test"}</button>
              <button data-testid="gs-save" disabled={connect.testing} onClick={saveConnect}
                style={{...greenBtn,fontSize:13,padding:"8px 16px"}}>Connect</button>
            </div>
          }>
          {(connect.provider.waitNote||connect.provider.delay)&&(
            <div data-testid="gs-delay" style={{fontSize:12.5,color:T.gold700,lineHeight:1.6,marginBottom:14,
              background:T.bg2,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px"}}>
              {connect.provider.waitNote||connect.provider.delay}
            </div>
          )}
          {Array.isArray(connect.provider.steps)&&connect.provider.steps.length?(
            <ol data-testid="gs-steps" style={{margin:"0 0 16px",paddingLeft:20,fontSize:13,color:T.ink,lineHeight:1.65}}>
              {connect.provider.steps.map((step,i)=><li key={i} style={{marginBottom:5}}>{step}</li>)}
            </ol>
          ):(
            <div style={{fontSize:12.5,color:T.ink3,lineHeight:1.6,marginBottom:14}}>{connect.provider.help}</div>
          )}
          {(connect.provider.credentialFields||[]).map(f=>(
            <div key={f.name} style={{marginBottom:10}}>
              <label style={{display:"block",fontSize:12,color:T.ink3,marginBottom:3}}>{f.label}</label>
              <input data-testid="gs-cred" type={f.secret?"password":"text"} autoComplete="off"
                value={connect.values[f.name]||""}
                onChange={e=>{const v=e.target.value;setConnect(c=>({...c,values:{...c.values,[f.name]:v},tested:null}));}}
                style={{width:"100%",font:"inherit",fontSize:13,padding:"7px 9px",
                  border:"1px solid "+T.bg3,borderRadius:8,background:T.bgCard,color:T.ink}}/>
            </div>
          ))}
          {connect.error&&<div data-testid="gs-connect-error" style={{fontSize:12.5,color:T.terra700,margin:"8px 0",lineHeight:1.55}}>{connect.error}</div>}
          {connect.tested&&connect.tested.ok&&(
            // HER OWN NUMBERS, BEFORE ANYTHING IS SAVED. This is the only way
            // to know a key works, and nothing is written on this path.
            <div data-testid="gs-test-result" style={{fontSize:13,color:T.ink,margin:"8px 0",lineHeight:1.55}}>
              {connect.tested.count>0
                ? `Steward read ${countLabel(connect.tested.count, "gift")} in the last seven days, ${fmtFull(connect.tested.totalCents/100)} in total.`
                : (connect.tested.message||"Steward reached the account and there were no gifts in the last seven days.")}
            </div>
          )}
        </Modal>
      )}

      {panel&&panel.kind==="file"&&(
        <Modal onClose={()=>setPanel(null)} width={480} title={panel.label} ariaLabel={panel.label}
          footer={<button data-testid="gs-open-import" onClick={()=>{setPanel(null);setShowImport(true);}}
            style={{...greenBtn,fontSize:13,padding:"8px 16px"}}>Upload a statement</button>}>
          <ol style={{margin:0,paddingLeft:20,fontSize:13,color:T.ink,lineHeight:1.65}}>
            <li style={{marginBottom:5}}>Download last month&apos;s statement from {panel.label}.</li>
            <li style={{marginBottom:5}}>Drop the file in on the next screen.</li>
            <li>Steward reads the gifts onto your donor records and tells you what it found.</li>
          </ol>
          <div style={{fontSize:12.5,color:T.ink3,marginTop:12,lineHeight:1.6}}>{STATEMENT_LINE}</div>
        </Modal>
      )}

      {panel&&panel.kind==="other"&&(
        <Modal onClose={()=>setPanel(null)} width={460} title="Something else" ariaLabel="Something else"
          footer={<button data-testid="gs-other-save" disabled={!otherName.trim()||busy==="other"} onClick={saveOther}
            style={{...greenBtn,fontSize:13,padding:"8px 16px",opacity:otherName.trim()?1:0.5}}>
            {busy==="other"?"Saving…":"Save and upload a statement"}</button>}>
          <div style={{fontSize:13,color:T.ink3,lineHeight:1.6,marginBottom:12}}>
            Type the name of the place gifts come in. Steward records it, and the gifts come in the same way a bank statement does.
          </div>
          <label style={{display:"block",fontSize:12,color:T.ink3,marginBottom:3}} htmlFor="gs-other-name">Name</label>
          <input id="gs-other-name" data-testid="gs-other-name" value={otherName} autoComplete="off"
            onChange={e=>setOtherName(e.target.value)}
            style={{width:"100%",font:"inherit",fontSize:13,padding:"8px 10px",border:"1px solid "+T.bg3,
              borderRadius:8,background:T.bgCard,color:T.ink}}/>
        </Modal>
      )}

      {/* HARDEN-1: every import door opens the one reader */}
      {showImport&&<SpreadsheetImport onClose={()=>setShowImport(false)} onImported={()=>{setShowImport(false);load();}}/>}
    </>
  );

  // FIX-10 D — ONBOARDING DOES NOT SHOW A GRID NOBODY CAN USE. When this
  // server cannot store a provider key, every tile in the grid below is dead:
  // the first thing a new customer met was eight logos, none of which do
  // anything, under a sentence about our server. One line instead, and she
  // moves on.
  if(compact&&!credState.ready) return (
    <div data-testid="gs-page">
      <div data-testid="gs-later" style={{fontSize:13,color:T.ink3,lineHeight:1.6,maxWidth:600}}>
        You can connect PayPal, Stripe and others later in Settings, Connections.
      </div>
    </div>
  );
  if(compact) return <div data-testid="gs-page">{body}</div>;
  return (
    <div data-testid="gs-page" style={{background:T.bgCard,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
      <SectionLabel>Where giving comes in</SectionLabel>
      {body}
    </div>
  );
}

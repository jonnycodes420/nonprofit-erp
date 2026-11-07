import { useState, useEffect } from "react";
import { apiFetch, API, getToken } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { T, SectionLabel } from "../shared";
import { fmtInZone } from "../EditHistory";
import { tabHref } from "../../lib/appUrls";
import { RecordLink } from "../RecordLink";
import DateInput from "../inputs/DateInput";   // POLISH-6: the one date box

// ── FIX-11 Part 1 — THE AUDIT LOG ─────────────────────────────────────────
// Newest first, filtered by person, record type, action and date, searchable
// by donor name. Every row opens its record, including a voided gift or a
// deleted donor: the row whose history this is, is usually the one somebody
// is trying to account for.
//
// What it is NOT is a feed. The line at the top says what the log covers and
// the rows below it say what happened, each in one sentence, with both sides
// of every field that moved behind a disclosure. A screen that showed the
// whole JSON of every change would hide the one change that mattered inside
// forty that did not.
export function AuditLog({onNavigate}){
  const [state,setState]=useState({loading:true,rows:[],facets:{entityTypes:[],actions:[],actors:[]},coverage:"",timezone:null,err:""});
  // FIX-14 Part 2: `person` and `record` narrow the log to one person (all
  // their records) or one record; set from a row, cleared with Clear.
  const [filters,setFilters]=useState({actor:"",entityType:"",action:"",from:"",to:"",q:"",person:"",record:""});
  const [scopeName,setScopeName]=useState("");
  const [openRow,setOpenRow]=useState(null);
  const [limit,setLimit]=useState(200);

  const qs=()=>{
    const p=new URLSearchParams();
    for(const [k,v] of Object.entries(filters)) if(v&&String(v).trim())p.set(k,String(v).trim());
    p.set("limit",String(limit));
    return p.toString();
  };

  const load=()=>{
    setState(s=>({...s,loading:true,err:""}));
    apiFetch(`/audit/log?${qs()}`)
      .then(r=>setState({loading:false,rows:r.rows||[],facets:r.facets||{entityTypes:[],actions:[],actors:[]},coverage:r.coverage||"",timezone:r.timezone||null,err:""}))
      .catch(e=>setState(s=>({...s,loading:false,err:errorMessage(e,"Could not load the audit log.")})));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load,[filters,limit]);

  const downloadCsv=async()=>{
    try{
      const res=await fetch(`${API}/audit/log.csv?${qs()}`,{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!res.ok)throw new Error("The log could not be downloaded.");
      const blob=await res.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;a.download=`audit-log-${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a);a.click();
      document.body.removeChild(a);URL.revokeObjectURL(url);
      // The download of the log is itself a change of record somebody made,
      // so the server logged it; reloading shows that row rather than leaving
      // the screen quietly out of date about its own export.
      setTimeout(load,600);
    }catch(e){setState(s=>({...s,err:errorMessage(e,"Could not download the log.")}));}
  };

  const sel={background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",fontFamily:"inherit"};
  const anyFilter=Object.values(filters).some(v=>v&&String(v).trim());
  // In the organisation's zone, with the zone named ("Oct 1, 2026, 11:21 PM EDT").
  const fmtWhen=iso=>fmtInZone(iso,state.timezone);
  const linkHref=row=>{
    if(!row.link)return null;
    const {tab,...rest}=row.link;
    return tabHref(tab,{...rest,selectDonorId:rest.donorId});
  };
  const openRecord=row=>{
    if(!row.link||!onNavigate)return;
    const {tab,...rest}=row.link;
    onNavigate(tab,rest);
  };

  return (
    <div data-testid="audit-log" style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Audit log</SectionLabel>
        <div style={{fontSize:13,color:T.ink3,lineHeight:1.65,maxWidth:640,marginBottom:16}}>
          {state.coverage||"Every change anyone makes in Steward."}
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          {/* SECURE-2 item 8: every CSV, workbook, report and "Export everything", in one click. */}
          <button type="button" data-testid="audit-exports" aria-pressed={filters.entityType==="export"}
            onClick={()=>setFilters(f=>({...f,entityType:f.entityType==="export"?"":"export"}))}
            style={{...sel,cursor:"pointer",fontWeight:700,background:filters.entityType==="export"?T.ink:T.white,color:filters.entityType==="export"?T.white:T.ink}}>
            Exports
          </button>
          <input value={filters.q} onChange={e=>setFilters(f=>({...f,q:e.target.value}))}
            placeholder="Search a donor, a person or a record id" style={{...sel,minWidth:240,flex:"1 1 240px"}}/>
          <select value={filters.actor} onChange={e=>setFilters(f=>({...f,actor:e.target.value}))} style={{...sel,cursor:"pointer"}}>
            <option value="">Anyone</option>
            {state.facets.actors.map(a=><option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filters.entityType} onChange={e=>setFilters(f=>({...f,entityType:e.target.value}))} style={{...sel,cursor:"pointer"}}>
            <option value="">Any record</option>
            {state.facets.entityTypes.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filters.action} onChange={e=>setFilters(f=>({...f,action:e.target.value}))} style={{...sel,cursor:"pointer"}}>
            <option value="">Any action</option>
            {state.facets.actions.map(a=><option key={a} value={a}>{a}</option>)}
          </select>
          <DateInput value={filters.from} onChange={e=>setFilters(f=>({...f,from:e.target.value}))} style={sel} aria-label="From"/>
          <DateInput value={filters.to} onChange={e=>setFilters(f=>({...f,to:e.target.value}))} style={sel} aria-label="To"/>
          {(filters.person||filters.record)&&<span style={{fontSize:12,color:T.ink,border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 10px"}}>
            {filters.person?`Only ${scopeName||"this person"}`:`Only ${scopeName||"this record"}`}</span>}
          {anyFilter&&<button onClick={()=>{setFilters({actor:"",entityType:"",action:"",from:"",to:"",q:"",person:"",record:""});setScopeName("");}}
            style={{background:"none",border:"none",color:T.greenDk,fontSize:12,fontWeight:700,cursor:"pointer",padding:"6px 4px"}}>Clear</button>}
          <button onClick={downloadCsv}
            style={{marginLeft:"auto",background:T.greenDk,border:"none",borderRadius:8,padding:"8px 14px",color:T.white,fontSize:12,fontWeight:700,cursor:"pointer"}}>
            Export as CSV
          </button>
        </div>
      </div>

      {state.err&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 18px",fontSize:13,color:T.ink}}>{state.err}</div>}

      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,overflow:"hidden"}}>
        {state.loading
          ? <div style={{padding:28,textAlign:"center",color:T.ink3,fontSize:12}}>Loading…</div>
          : state.rows.length===0
            ? <div style={{padding:"32px 28px",textAlign:"center",color:T.ink3,fontSize:13,lineHeight:1.6}}>
                {anyFilter?"Nothing matches those filters.":"Nothing has been changed yet. Every change from here on shows up on this screen."}
              </div>
            : <div>
                {state.rows.map(r=>{
                  const open=openRow===r.id;
                  const moved=r.before||r.after||(r.changes&&Object.keys(r.changes).length>0);
                  return (
                    <div key={r.id} style={{borderTop:"1px solid "+T.bg3,padding:"12px 18px"}}>
                      <div style={{display:"flex",gap:12,alignItems:"baseline",flexWrap:"wrap"}}>
                        <span style={{fontSize:11.5,color:T.ink3,minWidth:148}}>{fmtWhen(r.created_at)}</span>
                        <span style={{fontSize:13,color:T.ink,fontWeight:700}}>{r.user_name||"System"}</span>
                        {/* FIX-14 Part 2 — the Description: what happened, in a sentence. Never a dash. */}
                        <span data-testid="audit-description" style={{fontSize:13,color:T.ink,flex:"1 1 260px"}}>{r.description||r.sentence}</span>
                        {(r.entity_label||r.entity_id)&&(r.link&&linkHref(r)
                          ? <RecordLink to={linkHref(r)} onOpen={onNavigate?()=>openRecord(r):undefined} data-testid="audit-entity"
                              style={{fontSize:13,fontWeight:700,color:T.greenDk,textDecoration:"underline dotted"}}>
                              {r.record_name||r.entity_label||r.entity_type}
                            </RecordLink>
                          : <span style={{fontSize:13,fontWeight:700,color:T.ink}}>{r.record_name||r.entity_label||r.entity_type}</span>)}
                        {r.link&&r.link.donorId&&!filters.person&&<button onClick={()=>{setFilters(f=>({...f,person:r.link.donorId,record:""}));setScopeName(r.entity_label&&/^(donor|person|organisation|organization)$/.test(r.entity_type)?r.entity_label:"this person");}}
                          style={{background:"none",border:"none",padding:0,color:T.ink3,fontSize:11.5,cursor:"pointer",textDecoration:"underline"}}>Only this person</button>}
                        {r.entity_id&&!filters.record&&!(r.link&&r.link.donorId&&/^(donor|person|organisation|organization)$/.test(r.entity_type))&&<button onClick={()=>{setFilters(f=>({...f,record:r.entity_id,person:""}));setScopeName(r.entity_label||r.entity_type||"this record");}}
                          style={{background:"none",border:"none",padding:0,color:T.ink3,fontSize:11.5,cursor:"pointer",textDecoration:"underline"}}>Only this record</button>}
                        {r.record_count!=null&&<span style={{fontSize:11.5,color:T.ink3}}>{r.record_count} records</span>}
                        {r.actor_kind&&r.actor_kind!=="user"&&<span style={{fontSize:10.5,color:T.ink3,border:"1px solid "+T.bg3,borderRadius:6,padding:"1px 6px"}}>{r.actor_kind.replace(/_/g," ")}</span>}
                        {moved&&<button onClick={()=>setOpenRow(open?null:r.id)}
                          style={{marginLeft:"auto",background:"none",border:"none",color:T.greenDk,fontSize:11.5,fontWeight:700,cursor:"pointer"}}>
                          {open?"Hide what changed":"What changed"}
                        </button>}
                      </div>

                      {open&&<AuditRowDetail row={r}/>}
                    </div>
                  );
                })}
              </div>}
      </div>

      {!state.loading&&state.rows.length>=limit&&(
        <button onClick={()=>setLimit(l=>l+200)}
          style={{alignSelf:"flex-start",background:T.bg2,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 14px",color:T.ink,fontSize:12,fontWeight:700,cursor:"pointer"}}>
          Show more
        </button>
      )}
      <div style={{fontSize:11.5,color:T.ink3,lineHeight:1.6}}>
        Rows cannot be edited or removed, by anyone, from any screen. They are kept for at least seven years.
      </div>
    </div>
  );
}

// BOTH SIDES OF EVERY FIELD THAT MOVED, and nothing else. A field name, what
// it was, what it is. A password, token or secret shows that it changed and
// never what to.
export function AuditRowDetail({row}){
  const before=row.before||{};
  const after=row.after||{};
  const keys=[...new Set([...Object.keys(before),...Object.keys(after)])].sort();
  const extra=Object.entries(row.changes||{}).filter(([k])=>k!=="before"&&k!=="after"&&k!=="record");
  const cell={fontSize:12,color:T.ink,padding:"4px 10px 4px 0",verticalAlign:"top",lineHeight:1.5,wordBreak:"break-word"};
  // "not set" rather than a dash. A dash in a Was column is ambiguous between
  // "this field was empty" and "we did not record it", and the house rule is
  // no em dashes in copy anyway.
  const show=v=>v===null||v===undefined||v===""?"not set":typeof v==="object"?JSON.stringify(v):String(v);
  return (
    <div style={{marginTop:10,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px"}}>
      {keys.length>0
        ? <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Field","Was","Is now"].map(h=>(
              <th key={h} style={{textAlign:"left",fontSize:10,fontWeight:700,color:T.ink3,padding:"0 10px 6px 0"}}>{h}</th>))}</tr></thead>
            <tbody>
              {keys.map(k=>(
                <tr key={k}>
                  <td style={{...cell,fontWeight:700,whiteSpace:"nowrap"}}>{k.replace(/_/g," ")}</td>
                  <td style={{...cell,color:T.ink3}}>{show(before[k])}</td>
                  <td style={cell}>{show(after[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        : <div style={{fontSize:12,color:T.ink3}}>{row.action==="created"?"The record was created.":row.action==="deleted"?"The record was removed.":"No field changed."}</div>}
      {extra.length>0&&(
        <div style={{marginTop:8,fontSize:11.5,color:T.ink3,lineHeight:1.6}}>
          {extra.map(([k,v])=><div key={k}><strong style={{color:T.ink}}>{k.replace(/_/g," ")}:</strong> {show(v)}</div>)}
        </div>
      )}
      <div style={{marginTop:8,fontSize:11,color:T.ink3}}>
        {row.request_method} {row.request_path}{row.status_code?` · ${row.status_code}`:""}
      </div>
    </div>
  );
}

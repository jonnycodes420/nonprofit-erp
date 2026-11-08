// components/profile/ListTabs.jsx (PROFILE-3): part of the donor profile, cut from DonorProfile.jsx.
import { TAB_KIND, TAB_SUBCHIPS } from "./profileShared";
import { Spin, T, firstNameOf } from "../shared";
import Uploader from "../Uploader";
import { InboxNudge } from "../InboxConnect";
import { ThankYouDrafts } from "../ThankYouDrafts";
import { EmailsReceived } from "../EmailAsSent";
import { ProfileTimeline } from "../ProfileTimeline";
import { HistoryList } from "../EditHistory";
import { shownTags, shownNote } from "../../lib/internalLabels";
import DateInput from "../inputs/LazyDateInput";   // POLISH-6: the one date box, loaded when first shown

function ListTabs(props){
  // FLOWS-2: the files attached to conversations and notes (the timeline's own read) count as files too.
  const attachedFiles=(props.tlExtras&&Array.isArray(props.tlExtras.attachments))?props.tlExtras.attachments.length:0;
  return <ListTabsBody {...props} attachedFiles={attachedFiles}/>;
}
function ListTabsBody({attachedFiles,deleteMaterial,donor,dpTab,giftsFull,inboxConnected,intActions,isReadOnly,loadDpThread,loadGiftsFull,loadRel,localInts,matLoading,matUploading,materials,onInteractionAdded,onLogTouchpoint,onNavigate,rel,saveStewardship,setLogMeeting,setStwForm,setStwOpen,stwForm,stwOpen,stwSaving,tlExtras,tlSearch,uploadMaterial,viewMaterial}){
  return <>
          {/* ── THE LIST TABS (PROFILE-1 header) ──────────────────────────
              Conversations, Emails, Tasks, Notes and Files are the old
              "Everything with" chips, each its own tab with the Timeline / List
              switch. Files also holds what the Materials tab held, and the
              record's History (from the old Activity tab). */}
          {TAB_KIND[dpTab]&&<div data-testid={"dp-tab-"+dpTab} className="dp3-gutter" style={{padding:"24px var(--dp-gutter,40px)",display:"flex",flexDirection:"column",gap:16}}>
            {dpTab==="conversations"&&!isReadOnly&&<div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              <button onClick={()=>setStwOpen(v=>!v)} data-testid="dp-log-stewardship" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 12px",color:T.ink,fontSize:12,fontWeight:700,cursor:"pointer"}}>Log stewardship</button>
              <button onClick={onLogTouchpoint} data-testid="dp-log-touchpoint" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 12px",color:T.ink,fontSize:12,fontWeight:700,cursor:"pointer"}}>Log a touchpoint</button>
            </div>}
            {dpTab==="conversations"&&stwOpen&&<div style={{background:T.white,border:"1px solid "+T.greenDk+"30",borderRadius:12,padding:"14px 16px"}}>
                <div style={{fontSize:12,fontWeight:700,color:T.ink,marginBottom:10}}>Log Stewardship Touch</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <select value={stwForm.type} onChange={e=>setStwForm(p=>({...p,type:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}>
                    {[["thank_you","Thank You Sent"],["recognition","Recognition"],["gift_sent","Gift Sent"],["impact_update","Impact Update"],["appreciation_event","Appreciation Event"],["holiday_card","Holiday Card"],["birthday","Birthday"],["other","Other"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                  <DateInput value={stwForm.date} onChange={e=>setStwForm(p=>({...p,date:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                  <input value={stwForm.detail} onChange={e=>setStwForm(p=>({...p,detail:e.target.value}))} placeholder="What was sent/done (e.g. signed book, tote bag)" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",gridColumn:"1/-1"}}/>
                  <input value={stwForm.note} onChange={e=>setStwForm(p=>({...p,note:e.target.value}))} placeholder="Optional note" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",gridColumn:"1/-1"}}/>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={saveStewardship} disabled={stwSaving} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"7px 14px",color:T.white,fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
                  <button onClick={()=>setStwOpen(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"7px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>Cancel</button>
                </div>
              </div>}
            {dpTab==="notes"&&shownNote(donor.notes)&&<div data-testid="dp-record-notes" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 14px",fontSize:13,color:T.ink3,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{shownNote(donor.notes)}</div>}
            {dpTab==="files"&&<>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              {/* FLOWS-2: the header counts every file on this person: uploaded here, and attached to a conversation or note (listed below) */}
              <div data-testid="dp-files-head" style={{fontSize:14,fontWeight:800,color:T.ink}}>Files{matLoading?"":` · ${(materials.length+attachedFiles).toLocaleString("en-US")}`}</div>
            </div>
            <Uploader accept={[]} readAs="none" busy={matUploading}
              label={matUploading?"Uploading…":"Drop a file here, or browse: proposals, letters, research (any file type)"}
              onFile={({file})=>uploadMaterial(file)}/>
            {matLoading?<div style={{textAlign:"center",color:T.ink3,fontSize:12,padding:16}}><Spin/></div>:materials.length===0?<div data-testid="dp-files-none" style={{fontSize:12,color:T.ink3,textAlign:"center",padding:16}}>{attachedFiles>0
              ?`Nothing uploaded here yet. ${attachedFiles===1?"1 file is":`${attachedFiles.toLocaleString("en-US")} files are`} attached to conversations and notes, below.`
              :"No files yet. Drop one above, or attach one to a conversation or note."}</div>:(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {materials.map(m=>(
                  <div key={m.id} data-testid={m.kind==="check_image"?"dp-file-check":"dp-file"} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",gap:12}}>
                    <div style={{fontSize:22,flexShrink:0}}>
                      ▤
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.file_name}</div>
                      <div style={{fontSize:11,color:T.ink3,marginTop:1}}>{m.uploaded_by&&`Uploaded by ${m.uploaded_by} · `}{new Date(m.uploaded_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
                      {m.notes&&<div style={{fontSize:11,color:T.ink3,marginTop:2}}>{m.notes}</div>}
                    </div>
                    <div style={{display:"flex",gap:6,flexShrink:0}}>
                      {(m.file_data||m.file_url)&&<button onClick={()=>viewMaterial(m)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 10px",color:T.ink3,fontSize:11,cursor:"pointer"}}>View</button>}
                      {m.kind!=="check_image"&&<button onClick={()=>deleteMaterial(m.id)} style={{background:"none",border:"1px solid "+T.terracotta+"30",borderRadius:7,padding:"5px 10px",color:T.terracotta,fontSize:11,cursor:"pointer"}}>Delete</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            </>}
            {dpTab==="conversations"&&<InboxNudge firstName={firstNameOf(donor.name)} onNavigate={onNavigate}/>}
            {dpTab==="emails"&&<><ThankYouDrafts donorId={donor.id} hideWhenEmpty testid="dp-ty-drafts"/><EmailsReceived donorId={donor.id} firstName={firstNameOf(donor.name)}/></>}
            {rel?<ProfileTimeline key={dpTab} search={tlSearch} fixed={TAB_KIND[dpTab]} subChips={TAB_SUBCHIPS[dpTab]||null} extras={tlExtras} canWrite={!isReadOnly} inboxConnected={inboxConnected} onConnect={onNavigate?()=>onNavigate("settings",{section:"connections",focus:"inbox"}):null} rel={rel} donor={donor} gifts={giftsFull} interactions={localInts??donor.interactions??[]} onLog={m=>setLogMeeting(m)} renderActions={intActions} onChanged={()=>{loadRel();loadGiftsFull();loadDpThread();onInteractionAdded&&onInteractionAdded();}}/>:<div style={{padding:16,textAlign:"center"}}><Spin/></div>}
            {dpTab==="files"&&<section data-testid="dp-history" style={{display:"flex",flexDirection:"column",gap:10}}>
              <h2 style={{margin:0,fontSize:13,fontWeight:600}}>History</h2>
              <HistoryList donorId={donor.id}/>
            </section>}
          </div>}
  </>;
}

export { ListTabs };

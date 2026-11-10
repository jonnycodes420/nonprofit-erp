// components/profile/RailFacts.jsx (PROFILE-3): part of the donor profile, cut from DonorProfile.jsx.
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { RAIL, RailSection } from "../ProfileRail";
import { T } from "../shared";
import { renderCustomValue } from "../../../../shared/customFieldShape";
import { PlanPanel } from "../MajorGifts";
import { CarePlanRail } from "../majorGifts/CarePlan";   // TOP100-1
import { WEALTH_SCORE_DEFINITION, WEALTH_SCORE_SOURCE } from "./profileShared";

function RailFacts({nothingLogged,cfData,cfEditVal,cfEditing,cfError,cfSaved,cfShowAll,donor,isReadOnly,isTeam,localConf,localRationale,localScore,localTier,lockMajor,onCfSaved,recalcScore,scoreLoading,setCfData,setCfEditVal,setCfEditing,setCfError,setCfSaved,setCfShowAll}){
  return <>
          {cfData.length>0&&(()=>{
            // BUILD-78 5.1 — custom fields in position order, empty fields
            // collapsed behind a show-all; every edit goes through the same
            // validation seam as import and the API (a refused value names
            // its reason, never silently stores something else).
            const withValues=cfData.filter(f=>f.value!==null&&f.value!==undefined&&f.value!=="");
            const shown=cfShowAll?cfData:withValues;
            const hidden=cfData.length-withValues.length;
            const editStr=f=>{
              const v=f.value;
              if(v===null||v===undefined)return "";
              if(f.type==="money")return Number.isInteger(v)?(v/100).toFixed(2):String(v);
              if(f.type==="checkbox")return v===true?"yes":v===false?"no":String(v);
              if(f.type==="multi_select")return Array.isArray(v)?v.join("; "):String(v);
              return String(v);
            };
            const saveCf=async f=>{
              try{
                const r=await apiFetch(`/donors/${donor.id}/custom-fields`,{method:"PUT",body:JSON.stringify({values:{[f.key]:cfEditVal}})});
                setCfData(prev=>prev.map(x=>x.key===f.key?{...x,value:r.customFields[f.key]!==undefined?r.customFields[f.key]:null}:x));
                setCfSaved(f.key);setTimeout(()=>setCfSaved(null),2000);
                setCfEditing(null);setCfError("");onCfSaved?.();
              }catch(e){
                setCfError(e?.errors?.[0]?.error||errorMessage(e, "That value was refused"));
              }
            };
            const inputStyle={flex:1,background:RAIL.panel,border:"1px solid "+RAIL.line,borderRadius:8,padding:"5px 8px",fontSize:12,color:RAIL.text,outline:"none"};
            return <RailSection title="Custom fields" testid="dp-rail-custom-fields" fold
              foldOpenLabel="Hide" foldShutLabel={`Show ${withValues.length||cfData.length}`}>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {shown.map(f=>(
                <div key={f.key} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                  <div style={{fontSize:12,color:RAIL.dim,fontWeight:600,minWidth:90,flexShrink:0}}>{f.label}</div>
                  {cfEditing===f.key?(
                    <div style={{display:"flex",gap:6,flex:1}}>
                      {f.type==="checkbox"?(
                        <select value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)} style={inputStyle}>
                          <option value="">Not set</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      ):f.type==="select"?(
                        <select value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)} style={inputStyle}>
                          <option value="">Not set</option>
                          {(f.options||[]).map(o=><option key={o} value={o}>{o}</option>)}
                        </select>
                      ):f.type==="multi_select"?(
                        <div style={{flex:1,display:"flex",flexWrap:"wrap",gap:5,background:RAIL.panel,border:"1px solid "+RAIL.line,borderRadius:8,padding:"5px 8px"}}>
                          {(f.options||[]).map(o=>{
                            const cur=cfEditVal?cfEditVal.split("; ").filter(Boolean):[];
                            const on=cur.includes(o);
                            return <button key={o} onClick={()=>{
                              const next=on?cur.filter(x=>x!==o):[...cur,o];
                              setCfEditVal(next.join("; "));
                            }} aria-pressed={on} style={{background:on?T.greenDk:"transparent",border:"1px solid "+(on?T.greenDk:RAIL.line),borderRadius:7,padding:"2px 8px",fontSize:11,color:on?T.white:RAIL.dim,cursor:"pointer"}}>{o}</button>;
                          })}
                        </div>
                      ):f.type==="long_text"?(
                        <textarea value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)} rows={3}
                          style={{...inputStyle,resize:"vertical"}} autoFocus/>
                      ):(
                        <input value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)}
                          type={f.type==="date"?"date":"text"}
                          inputMode={f.type==="number"||f.type==="money"?"decimal":undefined}
                          style={inputStyle}
                          onKeyDown={e=>{
                            if(e.key==="Enter"){saveCf(f);}
                            else if(e.key==="Escape"){setCfEditing(null);setCfError("");}
                          }}
                          autoFocus
                        />
                      )}
                      <button onClick={()=>saveCf(f)} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"5px 10px",color:T.white,fontSize:11,fontWeight:700,cursor:"pointer"}}>Save</button>
                      <button onClick={()=>{setCfEditing(null);setCfError("");}} style={{background:"transparent",border:"none",padding:"5px 8px",color:RAIL.dim,fontSize:12,cursor:"pointer"}}>✕</button>
                    </div>
                  ):(
                    <div style={{display:"flex",alignItems:"center",gap:6,flex:1,justifyContent:"flex-end"}}>
                      <span style={{fontSize:12,color:(f.value!==null&&f.value!==undefined&&f.value!=="")?RAIL.text:RAIL.dim,fontStyle:(f.value!==null&&f.value!==undefined&&f.value!=="")?"normal":"italic",textAlign:"right",overflowWrap:"anywhere"}}>
                        {cfSaved===f.key?"Saved ✓":(renderCustomValue(f,f.value)||"Not set")}
                      </span>
                      <button onClick={()=>{setCfEditing(f.key);setCfEditVal(editStr(f));setCfError("");}}
                        style={{background:"transparent",border:"1px solid "+RAIL.line,borderRadius:6,padding:"3px 8px",fontSize:10,color:RAIL.text,cursor:"pointer"}}>Edit</button>
                    </div>
                  )}
                </div>
              ))}
              {cfError&&<div style={{fontSize:11.5,color:T.gold300}}>{cfError}</div>}
              {hidden>0&&(
                <button onClick={()=>setCfShowAll(v=>!v)} style={{background:"none",border:"none",padding:0,fontSize:11,fontWeight:600,color:RAIL.dim,cursor:"pointer",textAlign:"left"}}>
                  {cfShowAll?"Hide empty fields":`Show all ${cfData.length} fields (${hidden} empty)`}
                </button>
              )}
            </div>
            </RailSection>;
          })()}

          {/* BUILD-99 Part 3 — the cultivation plan. It moved off the reading
              column and into the rail with the rest of how-we-manage-them, and
              it is folded because most days she does not open it. */}
          {/* TOP100-1 — the plan of care and the Top 100 rank, for admins and
              staff with the major gifts permission (it draws nothing otherwise). */}
          <CarePlanRail donorId={donor.id} isReadOnly={isReadOnly} RailSection={RailSection}/>

          {!nothingLogged&&<RailSection title="Cultivation plan" testid="dp-rail-plan" fold foldOpenLabel="Hide" foldShutLabel="Show">
            <div>{lockMajor(<PlanPanel donorId={donor.id} isReadOnly={isReadOnly} canWrite={isTeam}/>,{minHeight:120})}</div>
          </RailSection>}


          {/* BUILD-88a A.4 — THE WEALTH SCORE IS HIDDEN UNTIL IT CAN SAY WHAT
              IT IS (WEALTH_SCORE_DEFINITION + WEALTH_SCORE_SOURCE). Kept here,
              folded, so turning it back on is still one line. */}
          {WEALTH_SCORE_DEFINITION&&WEALTH_SCORE_SOURCE&&(
            <RailSection title="Proven capacity" testid="dp-wealth-score" fold foldOpenLabel="Hide" foldShutLabel="Show">
              <div style={{background:RAIL.panel,borderRadius:10,padding:"14px"}}>
                {localScore!==null?(
                  <>
                    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                      <div style={{textAlign:"center",border:"1px solid "+RAIL.line,borderRadius:10,padding:"10px 14px",minWidth:56,flexShrink:0}}>
                        <div style={{fontSize:26,fontWeight:800,color:RAIL.strong,lineHeight:1,fontFamily:"'DM Serif Display',serif"}}>{localScore}</div>
                        <div style={{fontSize:9,color:RAIL.dim,fontWeight:600,marginTop:2}}>/ 10</div>
                      </div>
                      <div>
                        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:5}}>
                          <span style={{border:"1px solid "+RAIL.line,color:RAIL.text,borderRadius:99,padding:"3px 10px",fontSize:11,fontWeight:800,letterSpacing:"0.04em"}}>{localTier}</span>
                        </div>
                        <div style={{fontSize:10,color:RAIL.dim,fontWeight:600}}>{localConf} confidence</div>
                      </div>
                    </div>
                    {localRationale&&<p style={{fontSize:12,color:RAIL.dim,lineHeight:1.6,margin:"0 0 12px 0",borderLeft:"2px solid "+RAIL.line,paddingLeft:10}}>{localRationale}</p>}
                    <button onClick={recalcScore} disabled={scoreLoading} style={{background:"transparent",border:"1px solid "+RAIL.line,borderRadius:8,padding:"6px",color:RAIL.text,fontSize:11,fontWeight:600,cursor:"pointer",width:"100%",textAlign:"center"}}>{scoreLoading?"Calculating…":"↻ Recalculate"}</button>
                  </>
                ):(
                  <div style={{textAlign:"center",padding:"4px 0"}}>
                    <div style={{fontSize:12,color:RAIL.dim,marginBottom:10}}>No score yet</div>
                    <button onClick={recalcScore} disabled={scoreLoading} style={{background:"transparent",border:"1px solid "+RAIL.line,borderRadius:8,padding:"7px 15px",color:RAIL.text,fontSize:12,fontWeight:600,cursor:"pointer"}}>{scoreLoading?"Calculating…":"Calculate score"}</button>
                  </div>
                )}
                <div style={{fontSize:10.5,color:RAIL.dim,marginTop:10,lineHeight:1.5}}>{WEALTH_SCORE_DEFINITION} Source: {WEALTH_SCORE_SOURCE}.</div>
              </div>
            </RailSection>
          )}
  </>;
}

export { RailFacts };

// components/profile/ProfileDialogs.jsx (PROFILE-3): part of the donor profile, cut from DonorProfile.jsx.
import { Modal, T, fmtFull } from "../shared";

function ProfileDialogs({createHousehold,donor,eraseBusy,eraseMsg,eraseOpen,erasePerson,eraseWord,hhModalOpen,hhPeople,hhPick,hhSearch,isAdmin,setEraseOpen,setEraseWord,setHhModalOpen,setHhPick,setHhSearch}){
  return <>
          {/* Dialogs any tab can open (PROFILE-1 header). */}
              {hhModalOpen&&(
                <Modal onClose={()=>setHhModalOpen(false)} width={440} zIndex={1000}
                  backdrop="rgba(15,26,18,0.5)" blur={false} padding={20}
                  ariaLabel="Group into a household" dialogStyle={{background:T.bg,borderRadius:16,maxHeight:"80vh"}}>
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:19,color:T.ink}}>Group {donor.name} into a household</div>
                    <div style={{fontSize:12,color:T.ink3}}>Pick the spouse/partner(s) to combine with. {donor.name} becomes the primary. Hard credit stays with each donor; only the relationship view combines.</div>
                    <input value={hhSearch} onChange={e=>setHhSearch(e.target.value)} placeholder="Search donors…" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:9,padding:"9px 12px",fontSize:13,color:T.ink,outline:"none"}}/>
                    <div style={{overflowY:"auto",display:"flex",flexDirection:"column",gap:4,flex:1}}>
                      {hhPeople.filter(x=>x.id!==donor.id&&!x.householdId).slice(0,40).map(x=>{
                        const picked=hhPick.has(x.id);
                        return(
                          <label key={x.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:9,background:picked?T.greenDk+"12":T.white,border:"1px solid "+(picked?T.greenDk+"55":T.bg3),cursor:"pointer"}}>
                            <input type="checkbox" checked={picked} onChange={()=>{const n=new Set(hhPick);n.has(x.id)?n.delete(x.id):n.add(x.id);setHhPick(n);}} style={{accentColor:T.greenDk}}/>
                            <span style={{fontSize:13,fontWeight:600,color:T.ink}}>{x.name}</span>
                            <span style={{marginLeft:"auto",fontSize:11,color:T.ink3}}>{fmtFull(x.total||0)}</span>
                          </label>
                        );
                      })}
                    </div>
                    <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
                      <button onClick={()=>{setHhModalOpen(false);setHhPick(new Set());}} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:9,padding:"9px 16px",fontSize:13,fontWeight:700,color:T.ink3,cursor:"pointer"}}>Cancel</button>
                      <button onClick={createHousehold} disabled={hhPick.size===0} style={{background:hhPick.size?T.greenDk:T.bg3,color:T.white,border:"none",borderRadius:9,padding:"9px 18px",fontSize:13,fontWeight:700,cursor:hhPick.size?"pointer":"not-allowed"}}>Create household</button>
                    </div>
                  </div>
                </Modal>
              )}
            {isAdmin&&eraseOpen&&(<Modal onClose={()=>setEraseOpen(false)} width={520} title="Erase this person">
              <div data-testid="dp-erase-confirm" style={{fontSize:13.5,color:T.ink,lineHeight:1.55}}>
                <strong>Erase {donor.name}?</strong> Their name, contact details, notes, tags, photo and every logged email, meeting and conversation are removed for good. Their gifts stay as anonymous gifts, so your books, the receipts already issued and every total still match to the cent. If they asked not to be emailed, their address stays on your do-not-email list so they are never mailed again. This cannot be undone.
                <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap",alignItems:"center"}}>
                  <input value={eraseWord} onChange={e=>setEraseWord(e.target.value)} placeholder="Type ERASE" aria-label="Type ERASE to confirm"
                    style={{border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",fontSize:13,fontFamily:"inherit",width:140}}/>
                  <button type="button" data-commit disabled={eraseWord!=="ERASE"||eraseBusy} onClick={erasePerson}
                    style={{background:eraseWord==="ERASE"?T.terracotta:T.bg3,border:"none",borderRadius:8,padding:"9px 16px",color:T.white,fontSize:13,fontWeight:700,cursor:eraseWord==="ERASE"?"pointer":"not-allowed"}}>{eraseBusy?"Erasing…":"Erase for good"}</button>
                  <button onClick={()=>setEraseOpen(false)} style={{background:"none",border:"none",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
                </div>
                {eraseMsg&&<div role="status" style={{marginTop:8}}>{eraseMsg}</div>}
              </div>
            </Modal>)}
  </>;
}

export { ProfileDialogs };

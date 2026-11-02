import { useState, useRef } from "react";
import { apiFetch } from "../../api";
import { rethrowProgrammerError, errorMessage } from "../../lib/domainError";
import { T, SectionLabel } from "../shared";
import { photoSentence } from "./importsWords";

// ── BUILD-96 Part 5 — ADD PHOTOS, beside the file import ───────────────────
// She arrives with a folder of headshots off the old system, and one at a time
// is not a feature for two hundred people. It sits on the Imports page because
// that is where "I have a pile of things from the old system" already lives.
//
// The report is two numbers and a list of file names: "41 photos attached,
// 6 need you." Every file that did not attach is shown BY NAME with a picker,
// because the alternative — guessing from a partial name — puts a face on the
// wrong donor, and nobody ever reviews a photo that worked.
export function AddPhotos({isReadOnly}){
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState(null);
  const [err,setErr]=useState("");
  const [people,setPeople]=useState([]);
  const [progress,setProgress]=useState(null);
  const [placing,setPlacing]=useState({});    // fileName -> donorId chosen
  const pending=useRef({});                   // fileName -> data URI, kept for the picker

  // A FOLDER IS NOT A REQUEST. Two hundred headshots is hundreds of megabytes
  // and fits in no request at all — the first version of this sent the lot in
  // one body and got a PayloadTooLargeError back as a bare 500. So the folder
  // is chunked, by COUNT and by BYTES (whichever runs out first), and the
  // answers are added up. Reading one chunk at a time also means a folder of
  // two hundred is never all in memory at once.
  const CHUNK_FILES=20, CHUNK_BYTES=18*1024*1024;

  const readOne=f=>new Promise((res,rej)=>{
    const fr=new FileReader();
    fr.onload=()=>res({fileName:f.name,image:fr.result});
    fr.onerror=rej;
    fr.readAsDataURL(f);
  });

  const load=async(files)=>{
    const list=Array.from(files||[]);
    if(!list.length)return;
    setBusy(true);setErr("");setResult(null);setPlacing({});
    pending.current={};
    let attached=0;const needsYou=[];
    try{
      let i=0;
      while(i<list.length){
        const chunk=[];let bytes=0;
        while(i<list.length&&chunk.length<CHUNK_FILES){
          const one=await readOne(list[i]);
          // A file bigger than a whole chunk is still sent on its own, so the
          // SERVER refuses it by name rather than this loop silently dropping
          // it. The size rule belongs to the server, not to the screen.
          if(chunk.length&&bytes+one.image.length>CHUNK_BYTES)break;
          chunk.push(one);bytes+=one.image.length;i++;
        }
        if(!chunk.length)break;
        for(const c of chunk) pending.current[c.fileName]=c.image;
        const r=await apiFetch("/photos/bulk",{method:"POST",body:JSON.stringify({files:chunk})});
        attached+=r.attached||0;
        if(Array.isArray(r.needsYou)) needsYou.push(...r.needsYou);
        setProgress({done:i,total:list.length});
        setResult({attached,needsYou,sentence:photoSentence(attached,needsYou.length)});
      }
      if(needsYou.length&&!people.length){
        apiFetch("/people/photos").then(pr=>setPeople(Array.isArray(pr.people)?pr.people:[])).catch(()=>{});
      }
    }catch(e){
      rethrowProgrammerError(e);
      setErr(errorMessage(e,"Steward could not add those photos."));
    }
    setProgress(null);
    setBusy(false);
  };

  // Placing one by hand goes through the ordinary single-photo route — the
  // same one the donor's own profile uses.
  const place=async(fileName,donorId)=>{
    const image=pending.current[fileName];
    if(!image||!donorId)return;
    setPlacing(p=>({...p,[fileName]:"saving"}));
    try{
      await apiFetch(`/donors/${donorId}/photo`,{method:"POST",body:JSON.stringify({image})});
      setPlacing(p=>({...p,[fileName]:"done"}));
      setResult(r=>r?{...r,attached:r.attached+1,needsYou:r.needsYou.filter(n=>n.fileName!==fileName)}:r);
    }catch(e){
      setPlacing(p=>({...p,[fileName]:""}));
      setErr(errorMessage(e,"That photo could not be attached."));
    }
  };

  return (
    <div data-testid="add-photos" style={{background:T.bgCard,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",marginBottom:16}}>
      <SectionLabel>Add photos</SectionLabel>
      <div style={{fontSize:13,color:T.ink3,marginBottom:16,lineHeight:1.6,maxWidth:560}}>
        Drop a folder of headshots from your old system. Steward matches each file to a person by
        the email address, the old system&apos;s ID, or the full name in the file name, and hands
        back anything it is not certain about, rather than guessing.
      </div>
      <label data-testid="add-photos-input"
        style={{display:"inline-flex",alignItems:"center",gap:8,cursor:(busy||isReadOnly)?"default":"pointer",
                border:"1px solid "+T.bg3,borderRadius:9,padding:"9px 16px",fontSize:13,fontWeight:700,
                color:(busy||isReadOnly)?T.ink3:T.ink,background:T.white}}>
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple webkitdirectory=""
          disabled={busy||isReadOnly} style={{display:"none"}}
          onChange={e=>{load(e.target.files);e.target.value="";}}/>
        {busy?(progress?`Adding… ${progress.done} of ${progress.total}`:"Adding…"):"Choose a folder"}
      </label>
      <label style={{display:"inline-flex",alignItems:"center",gap:8,marginLeft:10,
                cursor:(busy||isReadOnly)?"default":"pointer",fontSize:12.5,color:T.ink3}}>
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple
          disabled={busy||isReadOnly} style={{display:"none"}}
          onChange={e=>{load(e.target.files);e.target.value="";}}/>
        or pick the files
      </label>

      {err&&<div style={{fontSize:12.5,color:T.terra700,marginTop:12}}>{err}</div>}

      {result&&(
        <div style={{marginTop:16}}>
          <div data-testid="add-photos-report" style={{fontSize:14,fontWeight:700,color:T.ink}}>{result.sentence}</div>
          {result.needsYou&&result.needsYou.length>0&&(
            <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:8}}>
              {result.needsYou.map(n=>(
                <div key={n.fileName} data-testid="add-photos-needs-you"
                  style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",fontSize:12.5,color:T.ink2}}>
                  <span style={{fontWeight:700,color:T.ink}}>{n.fileName}</span>
                  <span style={{color:T.ink3}}>{n.message}</span>
                  {n.reason!=="not_a_photo"&&(
                    placing[n.fileName]==="done"?<span style={{color:T.greenDk,fontWeight:700}}>attached ✓</span>:
                    <select data-testid="add-photos-picker" disabled={isReadOnly||placing[n.fileName]==="saving"}
                      value={""} onChange={e=>place(n.fileName,e.target.value)}
                      style={{font:"inherit",fontSize:12.5,padding:"4px 6px",border:"1px solid "+T.bg3,
                              borderRadius:7,background:T.bgCard,color:T.ink,maxWidth:260}}>
                      <option value="">Who is this?</option>
                      {(n.candidates&&n.candidates.length?n.candidates:people).map(p=>(
                        <option key={p.id} value={p.id}>{p.name}{p.email?` · ${p.email}`:""}</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from "react";
import { apiFetch, API, getToken } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { askConfirm } from "../ConfirmDialog";
import { T, SectionLabel } from "../shared";
import { MailTypeSwitches } from "../MailTypes";
import { plural } from "../../../../shared/countWords.js";

export function fmtDollars(n){
  return "$"+Math.round(n||0).toLocaleString();
}

// Tax Receipting settings — its own module-scope component (like
// GivingPagesManager above) rather than inlined in Settings' body, since
// it carries meaningfully more state (legal fields form + enable gate +
// preview + a separate year-end dry-run/generate flow) than the simple
// list-of-items pattern Custom Fields/Impact Metrics use. See CLAUDE.md
// "Tax receipting" — US-only v1, cash gifts only, receipts auto-send for
// online gifts once enabled, offline gifts are one click from DonorProfile.
export function TaxReceiptsManager({orgId,isAdmin,isReadOnly}){
  const [form,setForm]=useState({legalName:"",ein:"",receiptAddress:"",receiptSignatureName:"",receiptSignatureTitle:"",receiptCustomMessage:"",receiptsEnabled:false});
  const [loaded,setLoaded]=useState(false);
  const [saving,setSaving]=useState(false);
  const [saveErr,setSaveErr]=useState("");
  const [saveMsg,setSaveMsg]=useState("");
  const [previewLoading,setPreviewLoading]=useState(false);

  const [yearEndYear,setYearEndYear]=useState(String(new Date().getFullYear()-1));
  const [dryRunResult,setDryRunResult]=useState(null);
  const [dryRunLoading,setDryRunLoading]=useState(false);
  const [runLoading,setRunLoading]=useState(false);
  const [runResult,setRunResult]=useState(null);
  const [runErr,setRunErr]=useState("");

  useEffect(()=>{
    apiFetch("/org").then(o=>{
      setForm({
        legalName:o.legal_name||"", ein:o.ein||"", receiptAddress:o.receipt_address||"",
        receiptSignatureName:o.receipt_signature_name||"", receiptSignatureTitle:o.receipt_signature_title||"",
        receiptCustomMessage:o.receipt_custom_message||"", receiptsEnabled:!!o.receipts_enabled,
      });
      setLoaded(true);
    }).catch(()=>setLoaded(true));
  },[]);

  const canEnable=form.legalName.trim()&&form.ein.trim()&&form.receiptAddress.trim();

  async function save(overrideEnabled){
    setSaving(true); setSaveErr(""); setSaveMsg("");
    const nextEnabled=overrideEnabled!==undefined?overrideEnabled:form.receiptsEnabled;
    try{
      const updated=await apiFetch(`/orgs/${orgId}`,{method:"PATCH",body:JSON.stringify({
        legalName:form.legalName, ein:form.ein, receiptAddress:form.receiptAddress,
        receiptSignatureName:form.receiptSignatureName, receiptSignatureTitle:form.receiptSignatureTitle,
        receiptCustomMessage:form.receiptCustomMessage, receiptsEnabled:nextEnabled,
      })});
      setForm({
        legalName:updated.legal_name||"", ein:updated.ein||"", receiptAddress:updated.receipt_address||"",
        receiptSignatureName:updated.receipt_signature_name||"", receiptSignatureTitle:updated.receipt_signature_title||"",
        receiptCustomMessage:updated.receipt_custom_message||"", receiptsEnabled:!!updated.receipts_enabled,
      });
      setSaveMsg("Saved.");
      setTimeout(()=>setSaveMsg(""),3000);
    }catch(e){ setSaveErr(errorMessage(e, "Failed to save.")); }
    setSaving(false);
  }

  async function downloadPreview(){
    setPreviewLoading(true);
    try{
      const resp=await fetch(`${API}/receipts/preview`,{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!resp.ok)throw new Error("Could not generate preview");
      const blob=await resp.blob();
      const url=URL.createObjectURL(blob);
      window.open(url,"_blank");
      setTimeout(()=>URL.revokeObjectURL(url),10000);
    }catch(e){ alert(errorMessage(e, "Could not generate preview")); }
    setPreviewLoading(false);
  }

  async function runDryRun(){
    setDryRunLoading(true); setDryRunResult(null); setRunResult(null); setRunErr("");
    try{
      const r=await apiFetch("/receipts/year-end-run",{method:"POST",body:JSON.stringify({year:parseInt(yearEndYear,10),dryRun:true})});
      setDryRunResult(r);
    }catch(e){ setRunErr(errorMessage(e, "Dry run failed.")); }
    setDryRunLoading(false);
  }

  async function generateAndSend(){
    if(!(await askConfirm({title:"Send year-end statements?",body:`Steward generates and emails a statement to every donor with a ${yearEndYear} gift. This sends real emails.`,yes:"Send statements"})))return;
    setRunLoading(true); setRunErr("");
    try{
      const r=await apiFetch("/receipts/year-end-run",{method:"POST",body:JSON.stringify({year:parseInt(yearEndYear,10),dryRun:false})});
      setRunResult(r);
      setDryRunResult(null);
    }catch(e){ setRunErr(errorMessage(e, "Year-end run failed.")); }
    setRunLoading(false);
  }

  const inp={width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"9px 12px",fontSize:13,color:T.ink,background:T.bg,outline:"none",marginBottom:12,fontFamily:"inherit"};
  const lbl={fontSize:11,fontWeight:700,color:T.ink3,marginBottom:4};

  if(!loaded) return <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",fontSize:13,color:T.ink3}}>Loading…</div>;

  return(
    <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",display:"flex",flexDirection:"column",gap:24}}>
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <SectionLabel>Tax Receipts</SectionLabel>
          <span style={{fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:99,background:form.receiptsEnabled?T.green100:T.bg2,color:form.receiptsEnabled?T.greenDk:T.ink3,border:"1px solid "+(form.receiptsEnabled?T.greenDk:T.bg3)}}>
            {form.receiptsEnabled?"Enabled":"Not enabled"}
          </span>
        </div>
        <div style={{fontSize:13,color:T.ink3,marginBottom:16,lineHeight:1.6}}>
          US donors need a written acknowledgment for any single gift of $250+ to claim the deduction (IRC §170(f)(8)). Fill in your organization's legal details below, then online gifts get an automatic, branded receipt, offline gifts are one click from a donor's Gifts &amp; Pledges tab.
        </div>
        <div style={{marginTop:-8,marginBottom:14}}><MailTypeSwitches keys={["gift_receipt","year_end"]} from="tax_receipts"/></div>

        <div style={lbl}>Legal name</div>
        <input value={form.legalName} onChange={e=>setForm(f=>({...f,legalName:e.target.value}))} placeholder="e.g. CREO Arts, Inc." style={inp} disabled={!isAdmin||isReadOnly}/>

        <div style={lbl}>EIN</div>
        <input value={form.ein} onChange={e=>setForm(f=>({...f,ein:e.target.value}))} placeholder="XX-XXXXXXX" style={inp} disabled={!isAdmin||isReadOnly}/>

        <div style={lbl}>Receipt address</div>
        <textarea value={form.receiptAddress} onChange={e=>setForm(f=>({...f,receiptAddress:e.target.value}))} placeholder={"123 Main St\nAnytown, ST 00000"} rows={2} style={{...inp,resize:"vertical"}} disabled={!isAdmin||isReadOnly}/>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <div style={lbl}>Signature name (optional)</div>
            <input value={form.receiptSignatureName} onChange={e=>setForm(f=>({...f,receiptSignatureName:e.target.value}))} placeholder="e.g. Jordan Lee" style={inp} disabled={!isAdmin||isReadOnly}/>
          </div>
          <div>
            <div style={lbl}>Signature title (optional)</div>
            <input value={form.receiptSignatureTitle} onChange={e=>setForm(f=>({...f,receiptSignatureTitle:e.target.value}))} placeholder="e.g. Executive Director" style={inp} disabled={!isAdmin||isReadOnly}/>
          </div>
        </div>

        <div style={lbl}>Custom message (optional)</div>
        <textarea value={form.receiptCustomMessage} onChange={e=>setForm(f=>({...f,receiptCustomMessage:e.target.value}))} placeholder="A warm line or two for {{donor_name}}, added to every receipt." rows={3} style={{...inp,resize:"vertical",marginBottom:6}} disabled={!isAdmin||isReadOnly}/>

        {!canEnable&&<div style={{fontSize:12,color:T.gold700,background:T.gold100,borderRadius:8,padding:"8px 12px",marginBottom:12}}>Legal name, EIN, and receipt address are all required before receipts can be enabled.</div>}

        {saveErr&&<div style={{fontSize:12,color:T.terra700,background:T.terra100,borderRadius:8,padding:"8px 12px",marginBottom:12}}>{saveErr}</div>}

        {isAdmin&&(
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <button onClick={()=>save()} disabled={saving||isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
              style={{background:T.white,border:"1.5px solid "+T.ink,borderRadius:8,padding:"8px 15px",color:T.ink,fontSize:12,fontWeight:700,cursor:(saving||isReadOnly)?"not-allowed":"pointer",opacity:(saving||isReadOnly)?0.6:1}}>
              {saving?"Saving…":"Save settings"}
            </button>
            <button onClick={()=>save(!form.receiptsEnabled)} disabled={saving||isReadOnly||(!form.receiptsEnabled&&!canEnable)}
              title={isReadOnly?"Reactivate your subscription to make changes.":(!form.receiptsEnabled&&!canEnable)?"Fill in legal name, EIN, and receipt address first.":undefined}
              style={{background:form.receiptsEnabled?T.terra100:T.green,border:"1px solid "+(form.receiptsEnabled?T.terra200:T.green),borderRadius:8,padding:"9px 16px",color:form.receiptsEnabled?T.terra700:T.white,fontSize:12,fontWeight:700,cursor:(saving||isReadOnly||(!form.receiptsEnabled&&!canEnable))?"not-allowed":"pointer",opacity:(saving||isReadOnly||(!form.receiptsEnabled&&!canEnable))?0.6:1}}>
              {form.receiptsEnabled?"Disable receipts":"Enable receipts"}
            </button>
            <button onClick={downloadPreview} disabled={previewLoading} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 16px",color:T.ink2,fontSize:12,fontWeight:600,cursor:previewLoading?"not-allowed":"pointer"}}>
              {previewLoading?"Generating…":"Preview receipt"}
            </button>
            {saveMsg&&<span style={{fontSize:12,color:T.greenDk,fontWeight:600}}>✓ {saveMsg}</span>}
          </div>
        )}
      </div>

      {isAdmin&&(
        <div style={{borderTop:"1px solid "+T.bg3,paddingTop:20}}>
          <SectionLabel>Year-End Giving Statements</SectionLabel>
          <div style={{fontSize:12,color:T.ink3,marginBottom:12,lineHeight:1.6}}>
            Generate a consolidated statement for every donor with a gift in the selected tax year. No automatic January run, trigger this deliberately each year.
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:12}}>
            <span style={{fontSize:11,fontWeight:700,color:T.ink3}}>Tax year</span>
            <input type="number" value={yearEndYear} onChange={e=>{setYearEndYear(e.target.value);setDryRunResult(null);setRunResult(null);}} style={{...inp,width:110,marginBottom:0}} disabled={!form.receiptsEnabled}/>
            <button onClick={runDryRun} disabled={dryRunLoading||!form.receiptsEnabled} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 14px",color:T.ink2,fontSize:12,fontWeight:600,cursor:(dryRunLoading||!form.receiptsEnabled)?"not-allowed":"pointer"}}>
              {dryRunLoading?"Checking…":"Dry run"}
            </button>
          </div>
          {!form.receiptsEnabled&&<div style={{fontSize:12,color:T.ink3}}>Enable tax receipts above first.</div>}
          {runErr&&<div style={{fontSize:12,color:T.terra700,background:T.terra100,borderRadius:8,padding:"8px 12px",marginBottom:10}}>{runErr}</div>}
          {dryRunResult&&(
            <div style={{background:T.bg,borderRadius:10,padding:"12px 16px",marginBottom:12,fontSize:13,color:T.ink}}>
              <strong>{dryRunResult.donorCount}</strong> {plural(dryRunResult.donorCount, "donor")} · <strong>{dryRunResult.giftCount}</strong> {plural(dryRunResult.giftCount, "gift")} in {yearEndYear}
              {dryRunResult.missingEmailCount>0&&<span style={{color:T.gold700}}> · {dryRunResult.missingEmailCount} donor{dryRunResult.missingEmailCount===1?" has":"s have"} no email on file (statement generated but not sent)</span>}
              <div style={{marginTop:10}}>
                <button onClick={generateAndSend} disabled={runLoading} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"9px 16px",color:T.white,fontSize:12,fontWeight:700,cursor:runLoading?"not-allowed":"pointer"}}>
                  {runLoading?"Generating & sending…":"Generate & send"}
                </button>
              </div>
            </div>
          )}
          {runResult&&(
            <div style={{background:T.green100,border:"1px solid "+T.greenDk,borderRadius:10,padding:"12px 16px",fontSize:13,color:T.greenDk}}>
              ✓ Generated <strong>{runResult.generated}</strong> {plural(runResult.generated, "statement")}, emailed <strong>{runResult.emailed}</strong>{runResult.skipped>0?`, skipped ${runResult.skipped}`:""}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

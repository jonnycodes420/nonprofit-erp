import { useState, useEffect, useRef } from "react";
import { AtlasSettings } from "./AtlasSettings";   // AGENT-5
import { BrandKitManager } from "./BrandKit";
import { useUrlWriter } from "./RecordLink";
import { tabHref } from "../lib/appUrls";
import { T, activeMark, Pill, SectionLabel, PageTitle, SectionTabs, fmt, quietPhrase, Modal } from "./shared";
import { MoveCard } from "./MoveIn";
import { YourWords } from "./YourWords";
import { apiFetch, API, getToken, billingErrorMessage } from "../api";
import UpgradeModal from "./UpgradeModal";
import { confirmIfDirty } from "../lib/dirtyGuard";
import { errorMessage, rethrowProgrammerError } from "../lib/domainError";
import { ApiKeysPanel } from "./ApiKeysPanel";
import { ConnectionsPage } from "./Connections";
import { SecurityPanel } from "./SecurityPanel";
import SupportAccessCard from "./SupportAccessCard";   // FIX-57
import { PrivacyPanel } from "./PrivacyPanel";
import { MyEmailPanel } from "./MyEmail";   // STAFF-MAIL-1
import { MailTypesSettings, GoingOut } from "./MailTypes";   // SEND-GATE-2
import JourneyBuilder from "./JourneyBuilder";
import { displayDate } from "../../../shared/displayDate";
import { askConfirm } from "./ConfirmDialog";
import { offerUndo } from "./EditHistory";
import { planDisplayName, planDisplayBand } from "../lib/planNames";
import { BillingBand } from "./BillingBand";
import MyProfile from "./MyProfile";
import { countLabel, plural } from "../../../shared/countWords.js";
import { GivingPagesManager } from "./settings/GivingPagesManager";
import { BrandingManager } from "./settings/BrandingManager";
import { TimezoneCard } from "./settings/TimezoneCard";
import { MajorGiftsCheckbox } from "./settings/MajorGiftsCheckbox";   // PROSPECT-1, moved by WEALTH-1
import { WealthScoresTeamSetting } from "./settings/WealthScoresTeamCard";   // WEALTH-1
import { BoardPackRecipientsCard } from "./settings/BoardPackRecipientsCard";
import { ProcessingRatesCard } from "./settings/ProcessingRatesCard";
import { MatchingEmployersCard } from "./settings/MatchingEmployersCard";
import { CoverFeesCard } from "./settings/CoverFeesCard";
import { GivingLevelsCard } from "./settings/GivingLevelsCard";
import { TaxReceiptsManager } from "./settings/TaxReceiptsManager";
import { OrgNameCard } from "./settings/OrgNameCard";   // FLOWS-2
import { useAuth } from "../main";   // FLOWS-2: refreshOrg, as Communications reads it
import { AddPhotos } from "./settings/AddPhotos";
import { DpaDownload } from "./settings/DpaDownload";
import { BringInAFile } from "./settings/BringInAFile";
import { ImportsDrop } from "./settings/ImportsDrop";
import { InvitedList } from "./settings/InvitedList";   // WALKB-2: pending invites under Team
import { EmptyTrash } from "./settings/EmptyTrash";
import { TrashLink, useTrashCount, trashLabel } from "./settings/TrashLink";   // FLOWS-4
import { DataSectionTop } from "./settings/DataSectionTop";   // FLOWS-4
import { SavedMappings } from "./settings/SavedMappings";
import { ImportsHistory } from "./settings/ImportsHistory";
import { InboundEmailCard } from "./settings/InboundEmailCard";
import { GivingSourcesManager } from "./settings/GivingSourcesManager";
import { BccAddressCard } from "./settings/BccAddressCard";
import { AuditLog } from "./settings/AuditLog";
import { StaffBoardList } from "./settings/StaffBoardList";
import { SETTINGS_TABS, SECTION_ALIAS, BILLING_STATUS_META } from "./settings/settingsTabs";
import { displayOrgDate } from "../lib/orgDay";
import { impactExample } from "../lib/impactExample";
import { VIEWER, ROLES, ROLE_LABEL, roleWord } from "../../../shared/viewOnly.js"; import { ViewerExports } from "./settings/ViewerExports";   // ACCESS-1
export { PortalWebsiteSnippet, PortalWebsiteSnippetCard } from "./settings/PortalWebsiteSnippet";
export { ImpactUpdatesManager } from "./settings/ImpactUpdatesManager";
export { GivingSourcesManager } from "./settings/GivingSourcesManager";

export function Settings({auth,logout,initialSection,initialFocus,onNavigate}) {
  const { refreshOrg } = useAuth() || {};   // FLOWS-2: a saved org name is read back into the app
  // THE TDZ RULE. Every const the tab filter reads is declared above it: the
  // Audit log tab is admin-only, so `visibleTabs` now reads `isAdmin`, which
  // used to be declared six lines further down. A component-scope const read
  // above its declaration is a blank screen, and this is the fifth time that
  // class has cost a build (see CLAUDE.md and scripts/ci/tdz-scan.js).
  const userName=auth?.user?.name||"User";
  const userEmail=auth?.user?.email||"";
  const userRole=auth?.user?.role||"staff";
  const isAdmin=userRole==="admin";
  const isPortalTier=auth?.org?.plan==="portal";
  const trashN=useTrashCount(!!isAdmin);   // FLOWS-4: Settings → Trash carries its count
  const visibleTabs=SETTINGS_TABS.filter(t=>(!t.portalTierOnly||isPortalTier)&&(!t.adminOnly||isAdmin)&&(!t.viewerHidden||userRole!==VIEWER)).map(t=>t.id==="trash"?{...t,label:trashLabel(trashN)}:t);   // ACCESS-1: a viewer has no Team or Connections
  const wantSection=SECTION_ALIAS[initialSection]?.section||initialSection;
  const wantFocus=initialFocus||SECTION_ALIAS[initialSection]?.focus||null;
  const [section,setSection]=useState(visibleTabs.some(t=>t.id===wantSection)?wantSection:"org");
  // FIX-14 Part 5: the section on screen is in the address bar, replaced
  // (a section switch is not a step Back should undo). A URL that already
  // names this section keeps its #focus card.
  const goUrl=useUrlWriter();
  useEffect(()=>{
    if(!/^\/app\/settings\/?$/.test(window.location.pathname))return;
    const at=new URLSearchParams(window.location.search).get("section");
    if(at===section||(!at&&section==="org"))return;
    goUrl(tabHref("settings",{section}),true);
  },[section]);  // eslint-disable-line react-hooks/exhaustive-deps

  const [team,setTeam]=useState([]);
  const [showInvite,setShowInvite]=useState(false);
  const [invEmail,setInvEmail]=useState("");
  const [invRole,setInvRole]=useState("staff");
  const [inviting,setInviting]=useState(false);
  const [inviteResult,setInviteResult]=useState(null);
  const [invVer,setInvVer]=useState(0);   // WALKB-2: the Invited list reloads after an invite
  const [invErr,setInvErr]=useState("");
  const [copied,setCopied]=useState(false);

  const [stripe,setStripe]=useState(null);
  const [stripeLoading,setStripeLoading]=useState(false);

  const [orgSlug,setOrgSlug]=useState(auth?.org?.org_slug||"");

  // BUILD-78 — one list per entity; archive/restore, never delete; type
  // immutable after creation (the modal says so instead of hiding it).
  const [customFields,setCustomFields]=useState({donor:[],gift:[]});
  const [cfEntity,setCfEntity]=useState("donor");
  // BUILD-80 Part 10 — the kept-raw surface: stored custom values that do
  // not coerce under their field's current type, with a fix-in-place.
  const [keptRaw,setKeptRaw]=useState(null);
  const [keptRawEdits,setKeptRawEdits]=useState({});
  const loadKeptRaw=()=>apiFetch("/custom-fields/kept-raw").then(r=>setKeptRaw(r.keptRaw||[])).catch(()=>setKeptRaw([]));
  useEffect(()=>{ if(isAdmin) loadKeptRaw(); },[]); // eslint-disable-line
  const fixKeptRaw=async(row)=>{
    const val=keptRawEdits[`${row.donorId}|${row.key}`];
    if(val===undefined)return;
    try{
      await apiFetch(`/custom-fields/kept-raw/${row.donorId}`,{method:"PUT",body:JSON.stringify({key:row.key,value:val})});
      loadKeptRaw();
    }catch(e){alert(e.details?.[0]?.error||errorMessage(e, "That value still doesn't match the field's type."));}
  };
  const [cfShowArchived,setCfShowArchived]=useState(false);
  const [showAddField,setShowAddField]=useState(false);
  const [editingField,setEditingField]=useState(null);
  const [cfForm,setCfForm]=useState({label:"",type:"text",options:[]});
  const [cfOptInput,setCfOptInput]=useState("");
  const [cfSaving,setCfSaving]=useState(false);
  async function reloadCf(entity){
    try{
      const rows=await apiFetch(`/custom-fields?entity=${entity}&includeArchived=1`);
      setCustomFields(prev=>({...prev,[entity]:Array.isArray(rows)?rows:[]}));
    }catch{/* section renders empty */}
  }

  const [impactMetrics,setImpactMetrics]=useState([]);
  const [showAddMetric,setShowAddMetric]=useState(false);
  const [editingMetric,setEditingMetric]=useState(null);
  const [imForm,setImForm]=useState({name:"",dollarThreshold:"",outcomeTemplate:""});
  const [imSaving,setImSaving]=useState(false);

  const [billing,setBilling]=useState(null);
  const [impact,setImpact]=useState(null);
  const [impactOpen,setImpactOpen]=useState(false);
  const [portalLoading,setPortalLoading]=useState(false);

  // BUILD-88a A.6 — "Other income this year": one figure the org keeps
  // elsewhere, off by default, shown under giving on the board and never added
  // to it.
  const [otherIncomeOn,setOtherIncomeOn]=useState(null);
  const [otherIncome,setOtherIncome]=useState("");
  const [otherIncomeSaved,setOtherIncomeSaved]=useState("");
  useEffect(()=>{apiFetch("/org").then(o=>{
    setOtherIncomeOn(!!(o?.otherIncomeEnabled??o?.other_income_enabled));
    const v=o?.otherIncomeThisYear??o?.other_income_this_year;
    setOtherIncome(v==null?"":String(v));
  }).catch(()=>{});},[]);
  async function toggleOtherIncome(){
    const next=!otherIncomeOn; setOtherIncomeOn(next);
    try{ await apiFetch(`/orgs/${auth?.org?.id}`,{method:"PATCH",body:JSON.stringify({otherIncomeEnabled:next})}); }
    catch{ setOtherIncomeOn(!next); }
  }
  // BUILD-88c C.1 — the org's own sending domain.
  const [sd,setSd]=useState(null);
  const [sdEmail,setSdEmail]=useState("");
  const [sdBusy,setSdBusy]=useState(false);
  const [sdErr,setSdErr]=useState("");
  const [sdCopied,setSdCopied]=useState(null);
  useEffect(()=>{apiFetch("/org/sending-domain").then(setSd).catch(()=>setSd(null));},[]);
  async function claimDomain(){
    setSdBusy(true);setSdErr("");
    try{ setSd(await apiFetch("/org/sending-domain",{method:"POST",body:JSON.stringify({fromEmail:sdEmail.trim()})})); }
    catch(e){ setSdErr(errorMessage(e,"That address could not be set up.")); }
    setSdBusy(false);
  }
  async function checkDomain(){
    setSdBusy(true);setSdErr("");
    try{ const r=await apiFetch("/org/sending-domain/check",{method:"POST"}); setSd(r);
         if(!r.verified)setSdErr("The records have not reached the internet yet. Give it a few minutes and check again."); }
    catch(e){ setSdErr(errorMessage(e,"Steward could not check that just now.")); }
    setSdBusy(false);
  }
  async function releaseDomain(){
    setSdBusy(true);setSdErr("");
    try{ await apiFetch("/org/sending-domain",{method:"DELETE"});
         setSd(await apiFetch("/org/sending-domain")); setSdEmail(""); }
    catch(e){ setSdErr(errorMessage(e,"That could not be released.")); }
    setSdBusy(false);
  }
  async function copyRecord(i,value){
    try{ await navigator.clipboard.writeText(String(value||"")); setSdCopied(i); setTimeout(()=>setSdCopied(null),2500); }
    catch(e){ rethrowProgrammerError(e); setSdErr("Your browser would not let Steward reach the clipboard. Select the value and copy it."); }
  }

  // BUILD-88b B.3 — her voice: three samples, and Steward takes two lines.
  const [voice,setVoice]=useState(null);
  const [voiceDraft,setVoiceDraft]=useState(["","",""]);
  const [voiceSaved,setVoiceSaved]=useState("");
  useEffect(()=>{apiFetch("/org/voice-samples").then(r=>{
    setVoice(r); setVoiceDraft([(r.samples||[])[0]||"",(r.samples||[])[1]||"",(r.samples||[])[2]||""]);
  }).catch(()=>setVoice({samples:[],ready:false,needs:3}));},[]);
  // FIX-55: Home's "Teach Steward your voice" lands here (section account, focus voice).
  const voiceRef=useRef(null);
  useEffect(()=>{ if(wantFocus==="voice"&&voice!==null&&voiceRef.current&&voiceRef.current.scrollIntoView) voiceRef.current.scrollIntoView({behavior:"smooth",block:"start"}); },[voice]); // eslint-disable-line react-hooks/exhaustive-deps
  async function saveVoice(){
    setVoiceSaved("");
    try{ const r=await apiFetch("/org/voice-samples",{method:"PUT",body:JSON.stringify({samples:voiceDraft})});
         setVoice(v=>({...(v||{}),...r,samples:voiceDraft.filter(x=>x.trim().length>=40)}));
         setVoiceSaved(r.ready?"Saved. Steward will write in your voice.":`Saved. ${r.needs} more to go.`); }
    catch(e){ setVoiceSaved(errorMessage(e,"Those could not be saved.")); }
  }
  async function saveOtherIncome(){
    setOtherIncomeSaved("");
    try{ await apiFetch(`/orgs/${auth?.org?.id}`,{method:"PATCH",body:JSON.stringify({otherIncomeThisYear:otherIncome})});
         setOtherIncomeSaved("Saved"); }
    catch(e){ setOtherIncomeSaved(errorMessage(e,"That figure could not be saved.")); }
  }
  const [portalError,setPortalError]=useState("");
  const [portalUrl,setPortalUrl]=useState("");   // fallback link when the pop-up is blocked
  const [upgradeModal,setUpgradeModal]=useState(null);
  const isReadOnly=billing?.accessState==="read_only";


  const [sampleStatus,setSampleStatus]=useState(null);
  // BUILD-96 Part 3 — the Anthropic disclosure and its per-org switch.
  const [aiStatus,setAiStatus]=useState(null);
  const [aiSaving,setAiSaving]=useState(false);
  async function toggleAi(next){
    if(aiSaving)return;
    setAiSaving(true);
    try{
      const r=await apiFetch("/org/ai-settings",{method:"PATCH",body:JSON.stringify({enabled:next})});
      setAiStatus(a=>({...(a||{}),enabled:r.enabled,chequeReading:r.configured&&r.enabled,agentDrafting:r.configured&&r.enabled}));
    }catch(e){ /* the switch stays where it was; the server is the gate */ }
    setAiSaving(false);
  }
  const [sampleLoading,setSampleLoading]=useState(false);
  const [sampleClearing,setSampleClearing]=useState(false);
  const [exporting,setExporting]=useState(false);
  const [exportingCsv,setExportingCsv]=useState(false);
  // FIX-6 item 4 — the done state: what was built, and a link that still works.
  const [csvExport,setCsvExport]=useState(null);
  const [csvErr,setCsvErr]=useState("");

  useEffect(()=>{
    apiFetch("/org/team").then(setTeam).catch(()=>{});
    apiFetch("/stripe/status").then(setStripe).catch(()=>{});
    apiFetch("/billing/status").then(setBilling).catch(()=>{});
    apiFetch("/impact").then(setImpact).catch(()=>{});
    if(!auth?.org?.org_slug){
      apiFetch("/org").then(r=>{ if(r.org_slug) setOrgSlug(r.org_slug); }).catch(()=>{});
    }
    reloadCf("donor");reloadCf("gift");
    apiFetch("/impact-metrics").then(setImpactMetrics).catch(()=>{});
    apiFetch("/org/sample-data-status").then(setSampleStatus).catch(()=>{});
    apiFetch("/org/ai-status").then(setAiStatus).catch(()=>{});
  },[]);


  // BUILD-90 90b — the cancel button's two outcomes, said plainly: before the
  // first charge nothing was ever billed; after one, access runs out with the
  // month already paid for. Asks once, because it ends a paid relationship.
  const [cancelBusy,setCancelBusy]=useState(false);
  const [cancelNote,setCancelNote]=useState("");
  const [confirmCancel,setConfirmCancel]=useState(false);
  async function cancelSubscription(){
    if(!confirmCancel){ setConfirmCancel(true); setCancelNote(billing?.cancelIsFree
      ? "Press again to cancel. You have not been charged and you will not be."
      : "Press again to cancel. You keep access until the end of the month you have paid for."); return; }
    setCancelBusy(true); setConfirmCancel(false);
    try{
      const r=await apiFetch("/billing/cancel",{method:"POST"});
      setCancelNote(r?.when==="now"
        ? "Cancelled. You were never charged."
        : "Cancelled. You will not be charged again and you keep access until the end of this billing period.");
      apiFetch("/billing/status").then(setBilling).catch(()=>{});
    }catch(e){ setCancelNote(billingErrorMessage(e,"Couldn't cancel. Please try again, or reply to your Steward email and we'll do it for you.")); }
    finally{ setCancelBusy(false); }
  }

  // FIX-32: "Keep Steward" after a cancel inside the trial: a new Checkout
  // on the plan already chosen, ending its free period on the same date.
  const [keepBusy,setKeepBusy]=useState(false);
  async function keepSteward(){
    setKeepBusy(true);
    try{
      const r=await apiFetch("/billing/create-checkout",{method:"POST",body:JSON.stringify({keep:true,plan:billing?.plan})});
      window.location.href=r.url;
    }catch(e){ setKeepBusy(false); setCancelNote(billingErrorMessage(e,"Checkout could not be opened. Please try again.")); }
  }

  async function openBillingPortal(){
    // Open the portal in a NEW TAB so Settings stays put, and ALWAYS reset the
    // loading state (the old same-tab redirect left the button stuck on
    // "Opening…" whenever the nav didn't happen). Pop-up-blocked and error cases
    // surface a clear message + a direct fallback link / retry (BUILD-31 Part 1).
    setPortalLoading(true); setPortalError(""); setPortalUrl("");
    try{
      const r=await apiFetch("/billing/create-portal",{method:"POST"});
      const w=window.open(r.url,"_blank","noopener,noreferrer");
      if(!w){ setPortalUrl(r.url); setPortalError("Your browser blocked the pop-up. Allow pop-ups for this site, or open the portal directly:"); }
    }catch(e){ setPortalError(billingErrorMessage(e, "Couldn't open the billing portal. Please try again.")); }
    finally{ setPortalLoading(false); }
  }


  async function loadSampleData(){
    setSampleLoading(true);
    try{
      await apiFetch("/org/load-sample-data",{method:"POST"});
      const s=await apiFetch("/org/sample-data-status");
      setSampleStatus(s);
      window.location.reload();
    }catch(e){ alert(errorMessage(e, "Failed to load sample data")); setSampleLoading(false); }
  }

  async function clearSampleData(){
    if(!(await askConfirm({title:"Remove all sample data?",body:"Every sample record goes. This cannot be undone.",yes:"Remove sample data",danger:true})))return;
    setSampleClearing(true);
    try{
      await apiFetch("/org/clear-sample-data",{method:"POST"});
      setSampleStatus({hasSampleData:false,sampleDonorCount:0});
      window.location.reload();
    }catch(e){ alert(errorMessage(e, "Failed to clear sample data")); setSampleClearing(false); }
  }

  async function exportData(){
    setExporting(true);
    try{
      const r=await fetch(`${API}/org/export`,{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||"Export failed");}
      const blob=await r.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url; a.download=`steward-export.json`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    }catch(e){alert(errorMessage(e, "Export failed"));}
    setExporting(false);
  }

  // ── FIX-6 item 4 · AN EXPORT THAT SAYS WHAT IT DID ────────────────────
  // It used to build the zip, click a hidden link, revoke the object URL and
  // put the button back. If the browser saved the file quietly, nothing on
  // screen said so; if it refused the download, nothing on screen said that
  // either, and the two were indistinguishable. Now the result is kept: the
  // filename, the row counts the server put in the zip, and a link that still
  // works, so the download can be taken again without rebuilding anything.
  // The object URL is NOT revoked while that link is on screen.
  async function exportCsv(){
    setExportingCsv(true); setCsvExport(null); setCsvErr("");
    try{
      const r=await fetch(`${API}/org/export/csv`,{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||e.message||"The export did not build.");}
      const blob=await r.blob();
      if(!blob || !blob.size) throw new Error("The export came back empty. Nothing was downloaded.");
      let counts=null;
      try{ counts=JSON.parse(r.headers.get("X-Steward-Export-Counts")||"null"); }catch{ counts=null; }
      const name=r.headers.get("X-Steward-Export-Filename")
        ||`steward-export-${new Date().toISOString().split("T")[0]}.zip`;
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url; a.download=name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setCsvExport({url,name,counts,bytes:blob.size});
    }catch(e){setCsvErr(errorMessage(e, "The export did not build. Nothing was downloaded."));}
    setExportingCsv(false);
  }

  async function connectStripe(){
    setStripeLoading(true);
    try{
      const r=await apiFetch("/stripe/connect",{method:"POST"});
      window.location.href=r.url;
    }catch(e){
      alert(errorMessage(e, "Failed to start Stripe connect"));
      setStripeLoading(false);
    }
  }

  async function sendInvite(){
    if(!invEmail.trim()){setInvErr("Email required");return;}
    setInviting(true);setInvErr("");
    try{
      const r=await apiFetch("/auth/invite",{method:"POST",body:JSON.stringify({email:invEmail.trim(),role:invRole})});
      setInviteResult({link:r.inviteLink,emailSent:r.emailSent,emailMessage:r.emailMessage});setInvVer(v=>v+1);
    }catch(e){
      if(e.error==="seat_limit"){
        closeInvite();
        setUpgradeModal({reason:e.error,current:e.current,limit:e.limit,plan:e.plan});
      } else {
        setInvErr(errorMessage(e, "Failed to send invite"));
      }
    }finally{setInviting(false);}
  }

  function openAddField(){
    setEditingField(null);
    setCfForm({label:"",type:"text",options:[]});
    setCfOptInput("");
    setShowAddField(true);
  }

  function openEditField(f){
    setEditingField(f);
    setCfForm({label:f.label,type:f.type,options:Array.isArray(f.options)?f.options:[]});
    setCfOptInput("");
    setShowAddField(true);
  }

  function closeCfModal(){
    setShowAddField(false);setEditingField(null);
    setCfForm({label:"",type:"text",options:[]});
    setCfOptInput("");
  }

  function addCfOption(){
    const v=cfOptInput.trim();
    if(!v)return;
    setCfForm(f=>({...f,options:[...f.options,v]}));
    setCfOptInput("");
  }

  function removeCfOption(i){
    setCfForm(f=>({...f,options:f.options.filter((_,j)=>j!==i)}));
  }

  async function saveCfField(){
    if(!cfForm.label.trim()){return;}
    setCfSaving(true);
    try{
      if(editingField){
        await apiFetch(`/custom-fields/${editingField.id}`,{method:"PUT",body:JSON.stringify({label:cfForm.label,options:cfForm.options})});
      }else{
        await apiFetch("/custom-fields",{method:"POST",body:JSON.stringify({entity:cfEntity,label:cfForm.label,type:cfForm.type,options:cfForm.options})});
      }
      await reloadCf(cfEntity);
      closeCfModal();
    }catch(e){alert(errorMessage(e, "Failed to save field"));}
    setCfSaving(false);
  }

  // Archive hides a field from the record, the mapper and the export, and
  // destroys nothing; restore brings every value back. There is no delete.
  async function archiveCfField(f){
    try{await apiFetch(`/custom-fields/${f.id}/archive`,{method:"POST"});await reloadCf(f.entity);}
    catch(e){alert(errorMessage(e, "Failed to archive field"));}
  }
  async function restoreCfField(f){
    try{await apiFetch(`/custom-fields/${f.id}/restore`,{method:"POST"});await reloadCf(f.entity);}
    catch(e){alert(errorMessage(e, "Failed to restore field"));}
  }
  async function moveCfField(f,dir){
    const live=customFields[f.entity].filter(x=>!x.archivedAt);
    const i=live.findIndex(x=>x.id===f.id);
    const j=i+dir;
    if(i<0||j<0||j>=live.length)return;
    const ids=live.map(x=>x.id);
    [ids[i],ids[j]]=[ids[j],ids[i]];
    try{await apiFetch("/custom-fields/reorder",{method:"PUT",body:JSON.stringify({entity:f.entity,ids})});await reloadCf(f.entity);}
    catch(e){alert(errorMessage(e, "Failed to reorder"));}
  }

  const CF_TYPE_LABELS={text:"Text",long_text:"Long text",number:"Number",money:"Money",date:"Date",select:"Select",multi_select:"Multi-select",checkbox:"Yes/No"};

  function openAddMetric(){
    setEditingMetric(null);
    setImForm({name:"",dollarThreshold:"",outcomeTemplate:""});
    setShowAddMetric(true);
  }

  function openEditMetric(m){
    setEditingMetric(m);
    setImForm({name:m.name,dollarThreshold:String(m.dollar_threshold),outcomeTemplate:m.outcome_template});
    setShowAddMetric(true);
  }

  function closeImModal(){
    setShowAddMetric(false);setEditingMetric(null);
    setImForm({name:"",dollarThreshold:"",outcomeTemplate:""});
  }

  async function saveImMetric(){
    if(!imForm.name.trim()||!imForm.dollarThreshold||!imForm.outcomeTemplate.trim())return;
    setImSaving(true);
    try{
      if(editingMetric){
        const updated=await apiFetch(`/impact-metrics/${editingMetric.id}`,{method:"PUT",body:JSON.stringify({name:imForm.name,dollarThreshold:imForm.dollarThreshold,outcomeTemplate:imForm.outcomeTemplate,active:true})});
        setImpactMetrics(prev=>prev.map(m=>m.id===editingMetric.id?updated:m));
      }else{
        const created=await apiFetch("/impact-metrics",{method:"POST",body:JSON.stringify({name:imForm.name,dollarThreshold:imForm.dollarThreshold,outcomeTemplate:imForm.outcomeTemplate})});
        setImpactMetrics(prev=>[...prev,created]);
      }
      closeImModal();
    }catch(e){alert(errorMessage(e, "Failed to save impact metric"));}
    setImSaving(false);
  }

  async function deleteImMetric(id){
    const r=await apiFetch(`/impact-metrics/${id}`,{method:"DELETE"}).catch(()=>null);
    setImpactMetrics(prev=>prev.filter(m=>m.id!==id));
    offerUndo(r,"impact metric",()=>apiFetch("/impact-metrics").then(rows=>Array.isArray(rows)&&setImpactMetrics(rows)).catch(()=>{}));
  }

  function closeInvite(){
    setShowInvite(false);setInvEmail("");setInvRole("staff");
    setInviting(false);setInviteResult(null);setInvErr("");setCopied(false);
  }

  function copyLink(){
    if(!inviteResult?.link)return;
    navigator.clipboard.writeText(inviteResult.link).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});
  }

  return(
    <div style={{display:"flex",flexDirection:"column",gap:20}} data-viewer-ok={["account","profile","myemail","security"].includes(section)?"1":undefined}>
      <PageTitle main="Workspace" accent="settings."/>
      {/* Value-first landing (BUILD-31 Part 2.1): the first thing an org sees is
          what Steward has done for them, not a near-empty Organization card.
          Honest numbers only — forward-looking copy when there's nothing yet. */}
      {/* BUILD-92 B2 — NOT on "Where giving comes in". That page answers one
          question, it is the page Jonathan shares his screen on during an
          onboarding hour, and a banner about platform fees above it argues
          with it (and renders an em dash while it does). Every other section
          keeps it. */}
      {impact&&section!=="connections"&&(()=>{
        // BUILD-73 Part 3 — this banner leads with MONEY AT RISK, not with
        // anything Steward claims to have done. The value math describes the
        // size of the problem; it never describes Steward's results. Same
        // vocabulary as the Home hero and the landing page, on purpose.
        const atRisk=impact.atRiskAmount||0;
        const quiet=impact.quietDonorCount||0;
        const watching=impact.watchingRecurringCount||0;
        const clauses=[];
        if(atRisk>0&&quiet>0)clauses.push(<><strong style={{color:T.ink}}>{fmt(atRisk)}</strong> at risk across <strong style={{color:T.ink}}>{quiet.toLocaleString()}</strong> quiet {plural(quiet, "donor")}</>);
        let msg;
        if(clauses.length){
          msg=<>{clauses.map((c,i)=><span key={i}>{i>0?(i===clauses.length-1?" and ":", "):""}{c}</span>)}, with no gift in over {quietPhrase(impact.quietSinceDays)}. <strong style={{color:T.ink}}>No platform fee and no donor tip</strong>; gifts settle in your own Stripe.</>;
        }else if(watching>0){
          msg=<>Steward is watching <strong style={{color:T.ink}}>{watching}</strong> recurring {plural(watching, "gift")} for failed cards. <strong style={{color:T.ink}}>No platform fee, no donor tip</strong>; gifts settle in your own Stripe.</>;
        }else{
          msg=<><strong style={{color:T.ink}}>No platform fee, no donor tip.</strong> Your gifts settle in your own Stripe. Your at-risk giving appears here as donors go quiet.</>;
        }
        return (
          <div style={{background:T.white,border:"1px solid "+T.bg3,borderLeft:"3px solid "+T.gold500,borderRadius:12,padding:"12px 16px",display:"flex",alignItems:"center",gap:10}}>
            <span aria-hidden style={{color:T.gold500,fontSize:14,lineHeight:1}}>◈</span>
            <span style={{flex:1,fontSize:13,color:T.ink2,lineHeight:1.5}}>{msg}</span>
          </div>
        );
      })()}
      <SectionTabs className="settings-tabbar" style={{marginBottom:-2}} tabs={visibleTabs} active={section} onSelect={id=>{if(confirmIfDirty())setSection(id);}}/>

      {/* ── Organization ──────────────────────────────────────────────────── */}
      {section==="org"&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Your Account</SectionLabel>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20}}>
          <div style={{width:52,height:52,borderRadius:"50%",background:T.bg2,border:"2px solid "+T.bg3,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:700,color:T.ink,flexShrink:0}}>
            {(userName[0]||"U").toUpperCase()}
          </div>
          <div>
            <div style={{fontSize:18,fontWeight:700,color:T.ink,letterSpacing:"-0.01em"}}>{userName}</div>
            <div style={{fontSize:13,color:T.ink3,marginTop:2}}>{userEmail}</div>
            <div style={{marginTop:6}}><Pill label={userRole} color={userRole==="admin"?T.ink:T.ink3}/></div>
          </div>
        </div>
        <div style={{background:T.bg,borderRadius:10,padding:"14px 16px"}}>
          {/* FLOWS-2: the name is editable here (settings/OrgNameCard.jsx says why it vanished) */}
          <OrgNameCard key={auth?.org?.id||"org"} org={auth?.org||{}} isAdmin={isAdmin} isReadOnly={isReadOnly} onSaved={refreshOrg}/>
          {auth?.org?.mission&&<div style={{fontSize:12,color:T.ink3,marginTop:4,lineHeight:1.5}}>{auth.org.mission}</div>}
        </div>
      </div>}

      {/* FIX-1 D — the organisation's own people: staff and board. */}
      {section==="org"&&<StaffBoardList onNavigate={onNavigate}/>}
      {/* ONBOARD-1 — the same "Set up Steward for me" a new org lands on. */}
      {section==="org"&&isAdmin&&<div data-testid="settings-setup-door" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"18px 24px",marginTop:16,display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{flex:"1 1 260px"}}>
          <div style={{fontSize:14.5,fontWeight:700,color:T.ink}}>Set up Steward for me</div>
          <div style={{fontSize:12.5,color:T.ink3,marginTop:3,lineHeight:1.5}}>Hand Steward your donor files and your website. It shows its plan first, and every step can be undone.</div>
        </div>
        <a href="/setup" style={{background:T.green600,color:T.white,borderRadius:10,padding:"9px 15px",fontSize:13,fontWeight:700,textDecoration:"none"}}>Open setup</a>
      </div>}

      {/* REPORTS-3 — who gets the board pack, directly under the staff and
          board list it is about. It belongs on this tab and not beside the
          giving pages, which is where it first landed by following the wrong
          card's pattern: the browser walk found it missing from Organization
          and sitting under Giving Pages instead. */}
      {section==="org"&&<div style={{marginTop:16}}>
        <BoardPackRecipientsCard orgId={auth?.org?.id} isAdmin={isAdmin} isReadOnly={isReadOnly}
          focused={initialFocus==="board-pack"} onNavigate={onNavigate}/>
      </div>}

      {/* ── Branding — merged into the Organization tab (BUILD-31 Part 2.4) ── */}
      {section==="org"&&<div style={{marginTop:16}}><BrandingManager orgId={auth?.org?.id} isAdmin={isAdmin} isReadOnly={isReadOnly}/></div>}

      {/* ── Team ──────────────────────────────────────────────────────────── */}
      {section==="team"&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <SectionLabel>Team Members</SectionLabel>
          {isAdmin&&<ViewerExports/>}{isAdmin&&<button onClick={()=>setShowInvite(true)} style={{background:T.green,border:"none",borderRadius:8,padding:"7px 14px",color:T.white,fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Invite Staff</button>}
        </div>
        {billing&&!billing.isTrial&&billing.limits?.seats!==999999999&&billing.usage?.seats>=billing.limits?.seats&&(
          <div style={{background:T.ground,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:T.ink3,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
            <span>You're using all {countLabel(billing.limits.seats, "seat")}.</span>
            <a href="/pricing" style={{color:T.greenDk,fontWeight:700,textDecoration:"none",whiteSpace:"nowrap"}}>Upgrade your plan →</a>
          </div>
        )}
        {team.map((m,i)=>(
          <div key={m.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 0",borderBottom:i<team.length-1?"1px solid "+T.bg3:"none"}}>
            <div style={{width:36,height:36,borderRadius:"50%",background:T.bg2,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:T.ink,flexShrink:0}}>
              {(m.name?.[0]||"U").toUpperCase()}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{m.name}{m.id===auth?.user?.id&&<span style={{fontSize:11,color:T.ink3,marginLeft:6}}>(you)</span>}</div>
              <div style={{fontSize:11,color:T.ink3,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.email}</div>
            </div>
            <Pill label={roleWord(m.role)+(m.member?" · joined from another org":"")} color={m.role==="admin"?T.ink:T.ink3}/>
            <MajorGiftsCheckbox m={m} isAdmin={isAdmin} setTeam={setTeam}/>{/* PROSPECT-1 (settings/MajorGiftsCheckbox.jsx) */}
            {auth?.user?.role==="admin"&&m.id!==auth?.user?.id&&(
              /* BUILD-75 C.3 — soft-detach: revokes their sessions, frees their
                 seat, unassigns their portfolio; everything they authored keeps
                 their name. Quiet terracotta outline per the destructive-action
                 convention. */
              <button onClick={async()=>{
                if(!(await askConfirm({title:`Remove ${m.name||m.email}?`,body:"Their sign-in stops working immediately; everything they logged keeps their name. Their assigned donors return to the Directory unassigned.",yes:"Remove",danger:true})))return;
                try{
                  await apiFetch(`/users/${m.id}`,{method:"DELETE"});
                  setTeam(t=>t.filter(x=>x.id!==m.id));
                }catch(e){ alert(errorMessage(e, "Couldn't remove this person")); }
              }} style={{fontSize:12,padding:"5px 12px",borderRadius:8,border:"1px solid "+T.terra200,background:"transparent",color:T.terra700,cursor:"pointer",flexShrink:0}}>
                Remove
              </button>
            )}
          </div>
        ))}
        {team.length===0&&<div style={{fontSize:13,color:T.ink3}}>Loading…</div>}
        <InvitedList isAdmin={isAdmin} version={invVer}/>
        <WealthScoresTeamSetting isAdmin={isAdmin}/>{/* WEALTH-1: "Everyone on the team can see Wealth Scores" */}
      </div>}

      {/* ── FIX-13 Part 5 · Connections, the one page ─────────────────────────
          What Integrations held is on it: Payments is the Stripe card's
          Manage, the BCC card and the inbox card are under Email and calendar,
          "Where giving comes in" opens from the Giving cards, API keys is a
          card under Build your own. The QR code and the embed form are not
          connections and moved to Fundraising, Giving pages and forms. */}
      {section==="connections"&&<ConnectionsPage isReadOnly={isReadOnly} isAdmin={isAdmin} onNavigate={onNavigate}
        focus={wantFocus} stripe={stripe} stripeLoading={stripeLoading} onConnectStripe={connectStripe}
        paymentsPanel={<>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Payments</SectionLabel>
        {stripe?.connected?(
          <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,background:T.green100,border:"1px solid "+T.green200,borderRadius:10,padding:"10px 16px"}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:T.greenDk}}>Stripe Connected</div>
                <div style={{fontSize:11,color:T.greenDk,marginTop:1}}>Account: {stripe.accountId}</div>
              </div>
            </div>
            <div style={{fontSize:12,color:T.ink3}}>Connected {stripe.connectedAt?displayOrgDate(stripe.connectedAt):""}</div>
          </div>
        ):stripe?.onboardingStarted?(
          <div data-testid="stripe-unfinished" style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:200}}>
              <div style={{fontSize:13,fontWeight:700,color:T.ink,marginBottom:4}}>{stripe.checked?"Stripe setup isn't finished":"Steward couldn't check with Stripe just now"}</div>
              <div style={{fontSize:13,color:T.ink2}}>{stripe.checked
                ?"Your Stripe account exists, but Stripe can't take donations on it until onboarding is complete. Finish it on Stripe's site; it picks up where you left off."
                :"Your Stripe account was set up on "+(stripe.connectedAt?displayOrgDate(stripe.connectedAt):"an earlier day")+". Reload this page to check again whether it can take donations."}</div>
            </div>
            {isAdmin&&stripe.checked&&<button onClick={connectStripe} disabled={stripeLoading}
              style={{background:T.green,border:"none",borderRadius:10,padding:"10px 20px",color:T.white,fontSize:13,fontWeight:700,cursor:"pointer",opacity:stripeLoading?0.7:1,flexShrink:0}}>
              {stripeLoading?"Opening…":"Finish setting up Stripe →"}
            </button>}
          </div>
        ):(
          <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:200}}>
              <div style={{fontSize:13,color:T.ink2,marginBottom:4}}>Set up Stripe to accept online donations directly from your donors. Steward creates a Stripe Express account linked to your organization, and you'll be guided through a short onboarding on Stripe's site.</div>
              <div style={{fontSize:11,color:T.ink3,marginTop:4}}>Steward never touches your money. Donors pay directly to your Stripe account.</div>
            </div>
            {isAdmin&&<button onClick={connectStripe} disabled={stripeLoading}
              style={{background:T.green,border:"none",borderRadius:10,padding:"10px 20px",color:T.white,fontSize:13,fontWeight:700,cursor:"pointer",opacity:stripeLoading?0.7:1,flexShrink:0}}>
              {stripeLoading?"Setting up…":"Set up Stripe →"}
            </button>}
          </div>
        )}
      </div>
        </>}
        renderGivingSources={(k,n,onChanged)=><GivingSourcesManager key={n} isReadOnly={isReadOnly} isAdmin={isAdmin} autoConnect={k} onChanged={onChanged}/>}
        bccPanel={<InboundEmailCard isReadOnly={isReadOnly}/>}
        apiKeysPanel={<ApiKeysPanel isReadOnly={isReadOnly}/>}/>}

      {/* ── Giving Pages ──────────────────────────────────────────────────── */}
      {section==="giving"&&<>
        <TimezoneCard orgId={auth?.org?.id} isAdmin={isAdmin} isReadOnly={isReadOnly} focused={initialFocus==="timezone"}/>
        <CoverFeesCard orgId={auth?.org?.id} isAdmin={isAdmin}/>
        <GivingLevelsCard isAdmin={isAdmin} isReadOnly={isReadOnly}/>
        <ProcessingRatesCard orgId={auth?.org?.id} isAdmin={isAdmin} isReadOnly={isReadOnly}/>
        <MatchingEmployersCard isAdmin={isAdmin} isReadOnly={isReadOnly}/>
        <GivingPagesManager orgSlug={orgSlug} isAdmin={isAdmin} isReadOnly={isReadOnly}/>
      </>}

      {/* ── Donor Portal — moved to its own top-level section (BUILD-54 §3).
          One home only: this tab is a pointer, never a second editor. */}
      {section==="portal"&&(
        <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
          <SectionLabel>Donor Portal</SectionLabel>
          <div style={{fontSize:13,color:T.ink3,lineHeight:1.6,marginTop:6,marginBottom:16,maxWidth:560}}>
            The Donor Portal has its own home now, portal status, theme, impact updates, and
            engagement all live under <strong style={{color:T.ink2}}>Donor Portal</strong> in the left navigation.
          </div>
          <button onClick={()=>onNavigate&&onNavigate("portal")}
            style={{background:T.gold500,border:"none",borderRadius:9,padding:"10px 18px",color:T.ink,fontSize:13,fontWeight:700,cursor:"pointer"}}>
            Open Donor Portal →
          </button>
        </div>
      )}

      {/* ── Customization ─────────────────────────────────────────────────── */}
      {/* FIX-2 C — this read <Card> and <SecHead>, neither of which exists in
          Settings, so the Your words tab threw and the error boundary took the
          whole of Settings with it. The same card and label every other
          Settings section draws. */}
      {/* THREAD-2b 3 — the journey builder, in Direction A. */}
      {section==="journeys"&&(
        <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
          <SectionLabel>Journeys</SectionLabel>
          <JourneyBuilder isAdmin={isAdmin} isReadOnly={isReadOnly}/>
        </div>
      )}

      {section==="words"&&(
        <div style={{background:T.bgCard,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",marginBottom:16}}>
          <SectionLabel>Your words</SectionLabel>
          <div style={{fontSize:12.5,color:T.ink3,margin:"10px 0 14px",lineHeight:1.6}}>
            Steward uses these on your screens and in the emails it sends you. It never changes the words on a receipt, a year-end statement or your donor portal.
          </div>
          <YourWords mode="settings"/>
        </div>
      )}
      {section==="customization"&&<>
      {/* BUILD-80 Part 10 — kept-raw values: what the migration stored that
          doesn't type, each fixable in place through the validated seam. */}
      {isAdmin&&keptRaw&&keptRaw.length>0&&(
        <div style={{background:T.white,border:"1px solid "+T.gold500+"55",borderRadius:16,padding:"24px 28px",marginBottom:16}}>
          <SectionLabel>Values that don't match their field's type</SectionLabel>
          <div style={{fontSize:12.5,color:T.ink3,margin:"10px 0 12px",lineHeight:1.6}}>
            These came in through the one-time migration and were kept as written. Fix each in place, the corrected value is validated against the field's type before it's stored.
          </div>
          {keptRaw.slice(0,30).map(row=>(
            <div key={row.donorId+row.key} style={{display:"flex",gap:8,alignItems:"center",padding:"6px 0",borderBottom:"1px solid "+T.bg2,fontSize:12.5}}>
              <span style={{minWidth:0,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                <strong style={{color:T.ink}}>{row.donorName}</strong>
                <span style={{color:T.ink3}}> · {row.label}{row.type?` (${row.type})`:""} · </span>
                <span style={{color:T.terracotta}}>"{String(row.value).slice(0,40)}"</span>
                <span style={{color:T.ink3}}>: {row.problem}</span>
              </span>
              <input defaultValue={String(row.value)} onChange={e=>setKeptRawEdits(p=>({...p,[`${row.donorId}|${row.key}`]:e.target.value}))}
                style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 8px",fontSize:12,color:T.ink,width:140}}/>
              <button onClick={()=>fixKeptRaw(row)} disabled={isReadOnly}
                style={{background:T.green,border:"none",borderRadius:6,padding:"4px 10px",color:T.white,fontSize:11.5,fontWeight:700,cursor:"pointer"}}>Fix</button>
            </div>
          ))}
          {keptRaw.length>30&&<div style={{fontSize:12,color:T.ink3,marginTop:6}}>+{keptRaw.length-30} more.</div>}
        </div>
      )}
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <SectionLabel>Custom Fields</SectionLabel>
          {isAdmin&&<button onClick={openAddField} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:T.green,border:"none",borderRadius:8,padding:"7px 14px",color:T.white,fontSize:12,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>+ Add Field</button>}
        </div>
        {/* Purpose + example + payoff (BUILD-31 Part 3): make the value obvious. */}
        <div style={{fontSize:12.5,color:T.ink3,marginBottom:14,lineHeight:1.6,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px"}}>
          Extra data specific to your org, e.g. <strong style={{color:T.ink2}}>Board Connection</strong>, <strong style={{color:T.ink2}}>Matching Employer</strong>, or a gift's <strong style={{color:T.ink2}}>Appeal Code</strong>. Fields show on <strong style={{color:T.ink2}}>each record</strong>, can be filled by <strong style={{color:T.ink2}}>imports</strong>, and each is a column in your <strong style={{color:T.ink2}}>CSV export</strong>.
        </div>
        <div style={{display:"flex",gap:6,marginBottom:12}}>
          {["donor","gift"].map(en=>(
            <button key={en} aria-pressed={cfEntity===en} onClick={()=>setCfEntity(en)}
              style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 14px",fontSize:12,fontWeight:700,color:T.ink2,cursor:"pointer",...activeMark(cfEntity===en,"bottom")}}>
              {en==="donor"?"Donor fields":"Gift fields"}
            </button>
          ))}
        </div>
        {(()=>{
          const live=customFields[cfEntity].filter(f=>!f.archivedAt);
          const archived=customFields[cfEntity].filter(f=>!!f.archivedAt);
          return <>
            {live.length===0&&<div style={{fontSize:12.5,color:T.ink3,padding:"8px 0"}}>No {cfEntity} fields yet.{isAdmin?" Add your first above.":""}</div>}
            {live.map((f,i)=>(
              <div key={f.id}
                style={{display:"flex",alignItems:"center",gap:12,padding:"11px 0 11px 10px",borderBottom:i<live.length-1?"1px solid "+T.bg3:"none",borderLeft:"3px solid "+T.bg3,transition:"border-color 0.15s",marginLeft:-10}}
                onMouseEnter={e=>e.currentTarget.style.borderLeftColor=T.greenDk}
                onMouseLeave={e=>e.currentTarget.style.borderLeftColor=T.bg3}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{f.label}</div>
                  <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{CF_TYPE_LABELS[f.type]||f.type}{(f.type==="select"||f.type==="multi_select")&&f.options?.length?`: ${f.options.slice(0,8).join(", ")}${f.options.length>8?` (+${f.options.length-8} more)`:""}`:""}
                    {f.createdSource&&f.createdSource!=="legacy-migration"?` · created during ${f.createdSource}${f.createdByName?` by ${f.createdByName}`:""}`:""}
                  </div>
                </div>
                {isAdmin&&<div style={{display:"flex",gap:6,flexShrink:0}}>
                  <button onClick={()=>moveCfField(f,-1)} disabled={i===0} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",fontSize:11,color:T.ink2,cursor:i===0?"default":"pointer",opacity:i===0?0.4:1}}>↑</button>
                  <button onClick={()=>moveCfField(f,1)} disabled={i===live.length-1} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",fontSize:11,color:T.ink2,cursor:i===live.length-1?"default":"pointer",opacity:i===live.length-1?0.4:1}}>↓</button>
                  <button onClick={()=>openEditField(f)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.ink2,cursor:"pointer"}}>Edit</button>
                  <button onClick={()=>archiveCfField(f)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.ink2,cursor:"pointer"}}
                    title="Hides this field from records, imports and exports. Every saved value is kept and comes back if you restore the field.">Archive</button>
                </div>}
              </div>
            ))}
            {archived.length>0&&(
              <div style={{marginTop:14}}>
                <button onClick={()=>setCfShowArchived(v=>!v)} style={{background:"none",border:"none",padding:0,fontSize:12,fontWeight:600,color:T.ink3,cursor:"pointer"}}>
                  {cfShowArchived?"▾":"▸"} Archived ({archived.length})
                </button>
                {cfShowArchived&&archived.map(f=>(
                  <div key={f.id} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 0 9px 10px",marginLeft:-10,borderLeft:"3px solid "+T.bg3,opacity:0.7}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.ink2}}>{f.label}</div>
                      <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{CF_TYPE_LABELS[f.type]||f.type} · archived, values kept</div>
                    </div>
                    {isAdmin&&<button onClick={()=>restoreCfField(f)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.ink2,cursor:"pointer",flexShrink:0}}>Restore</button>}
                  </div>
                ))}
              </div>
            )}
          </>;
        })()}
      </div>

      {/* ── Impact Metrics ────────────────────────────────────────────────── */}
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <SectionLabel>Impact Metrics</SectionLabel>
          {isAdmin&&<button onClick={openAddMetric} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:T.white,border:"1.5px solid "+T.ink,borderRadius:8,padding:"6px 13px",color:T.ink,fontSize:12,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>+ Add Metric</button>}
        </div>
        {/* Purpose + example + payoff (BUILD-31 Part 3): make the value obvious. */}
        <div style={{fontSize:12.5,color:T.ink3,marginBottom:14,lineHeight:1.6,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px"}}>
          Turn a donor's cumulative giving into a concrete outcome, e.g. <strong style={{color:T.ink2}}>"$100 = 40 meals served"</strong> or <strong style={{color:T.ink2}}>"$250 = a week of after-school tutoring"</strong>. These appear in <strong style={{color:T.ink2}}>milestone thank-you emails</strong> and each donor's <strong style={{color:T.ink2}}>Impact Summary PDF</strong>, so a major donor sees exactly what their giving funded.{impactMetrics.length===0?" Add your first below.":""}
        </div>
        {impactMetrics.map((m,i)=>(
          <div key={m.id}
            style={{display:"flex",alignItems:"center",gap:12,padding:"11px 0 11px 10px",borderBottom:i<impactMetrics.length-1?"1px solid "+T.bg3:"none",borderLeft:"3px solid "+T.bg3,transition:"border-color 0.15s",marginLeft:-10}}
            onMouseEnter={e=>e.currentTarget.style.borderLeftColor=T.greenDk}
            onMouseLeave={e=>e.currentTarget.style.borderLeftColor=T.bg3}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{m.name}{m.active===false&&<span style={{marginLeft:5,fontSize:10,color:T.ink3,fontWeight:400}}>inactive</span>}</div>
              <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{`Every $${Number(m.dollar_threshold).toLocaleString("en-US")}. A donor at that amount reads: “${impactExample(m.outcome_template, m.dollar_threshold)}”`}</div>
            </div>
            {isAdmin&&<div style={{display:"flex",gap:6,flexShrink:0}}>
              <button onClick={()=>openEditMetric(m)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.ink2,cursor:"pointer"}}>Edit</button>
              <button onClick={()=>deleteImMetric(m.id)} style={{background:T.terra100,border:"1px solid "+T.terra200,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.terra700,cursor:"pointer"}}>Delete</button>
            </div>}
          </div>
        ))}
      </div>
      </>}

      {/* ── Tax Receipts ──────────────────────────────────────────────────── */}
      {section==="receipts"&&<TaxReceiptsManager orgId={auth?.org?.id} isAdmin={isAdmin} isReadOnly={isReadOnly}/>}
      {section==="brandkit"&&<BrandKitManager isAdmin={isAdmin} isReadOnly={isReadOnly}/>}
      {section==="profile"&&<MyProfile isReadOnly={isReadOnly}/>}

      {/* ── Your Data ─────────────────────────────────────────────────────── */}

      {section==="imports"&&<ImportsDrop isReadOnly={isReadOnly}><BringInAFile onNavigate={onNavigate} isReadOnly={isReadOnly}/><MoveCard isReadOnly={isReadOnly}/><AddPhotos isReadOnly={isReadOnly}/><ImportsHistory/><SavedMappings isReadOnly={isReadOnly}/><TrashLink isAdmin={isAdmin} onNavigate={onNavigate} lead="People you deleted, with Restore and Empty trash, are in " style={{padding:"4px 4px 12px"}}/></ImportsDrop>}
      {section==="trash"&&<EmptyTrash isAdmin={isAdmin} isReadOnly={isReadOnly}/>}

      {/* ── Audit log ─────────────────────────────────────────────────────── */}
      {section==="audit"&&(isAdmin
        ? <AuditLog onNavigate={onNavigate}/>
        : <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",fontSize:13,color:T.ink3}}>
            The audit log is available to your organization's admins.
          </div>)}

      {section==="privacy"&&<PrivacyPanel isAdmin={isAdmin} isReadOnly={isReadOnly}/>}
      {section==="myemail"&&<MyEmailPanel isAdmin={isAdmin}/>}
      {section==="automatic"&&<MailTypesSettings onNavigate={onNavigate}/>}
      {section==="going-out"&&<GoingOut onNavigate={onNavigate} isReadOnly={isReadOnly}/>}
      {section==="atlas"&&<AtlasSettings isAdmin={isAdmin} isReadOnly={isReadOnly} onNavigate={onNavigate}/>}

      {section==="data"&&<>
      <DataSectionTop isAdmin={isAdmin} onNavigate={onNavigate}/>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderLeft:"3px solid "+T.gold500,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Export your data</SectionLabel>
        <div style={{fontSize:15,fontWeight:700,color:T.ink,marginBottom:6}}>Your data is yours.</div>
        <div style={{fontSize:13,color:T.ink3,marginBottom:6,lineHeight:1.6,maxWidth:520}}>
          Export everything as CSV anytime, including if you cancel. One zip of spreadsheet-ready files: donors (with your custom fields), gifts, interactions, grants, pledges, recurring gifts, giving pages, receipts, and more.
        </div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:18}}>{isAdmin?"CSV opens anywhere; JSON is the machine-readable copy of the same data.":"Exporting all of your organization's data is something your admins do. Ask one of them for a copy."}</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          {isAdmin&&<button onClick={exportCsv} disabled={exportingCsv}
            style={{background:T.gold500,color:T.white,border:"none",borderRadius:8,padding:"10px 22px",fontSize:13,fontWeight:700,cursor:exportingCsv?"not-allowed":"pointer",opacity:exportingCsv?0.7:1}}>
            {exportingCsv?"Building export…":"Export all data (CSV)"}
          </button>}
          {isAdmin&&<button onClick={exportData} disabled={exporting}
            style={{background:"transparent",color:T.ink,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 22px",fontSize:13,fontWeight:700,cursor:exporting?"not-allowed":"pointer",opacity:exporting?0.7:1}}>
            {exporting?"Building export…":"Export as JSON"}
          </button>}
        </div>

        {csvErr&&<div role="alert" data-testid="csv-export-error"
          style={{marginTop:14,fontSize:13,color:T.terra700,background:T.terra100,border:"1px solid "+T.terra200,borderRadius:9,padding:"10px 13px",lineHeight:1.6}}>
          {csvErr}
        </div>}

        {csvExport&&<div role="status" data-testid="csv-export-done"
          style={{marginTop:14,background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px",maxWidth:560}}>
          <div style={{fontSize:14,fontWeight:700,color:T.ink,marginBottom:4}}>Your export is ready.</div>
          <div style={{fontSize:13,color:T.ink3,lineHeight:1.6,marginBottom:10}}>
            {csvExport.name} · {Math.max(1,Math.round(csvExport.bytes/1024)).toLocaleString()} KB.
            It should be in your downloads. If your browser blocked it, take it here.
          </div>
          <a href={csvExport.url} download={csvExport.name} data-testid="csv-export-link"
            style={{display:"inline-block",background:T.greenDk,color:T.white,borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:700,textDecoration:"none"}}>
            Download it again
          </a>
          {csvExport.counts&&<div style={{marginTop:12}}>
            <div style={{fontSize:10,fontWeight:800,color:T.ink3,marginBottom:6}}>What is in it</div>
            <div data-testid="csv-export-counts" style={{fontSize:12.5,color:T.ink3,lineHeight:1.8}}>
              {Object.entries(csvExport.counts).map(([k,n])=>(
                <div key={k}>{k}.csv: {Number(n).toLocaleString()} {Number(n)===1?"row":"rows"}</div>
              ))}
            </div>
          </div>}
        </div>}
      </div>

      {/* BUILD-96 Part 3 — THE SUBPROCESSOR, SAID IN THE ORGANISATION'S OWN
          SETTINGS. Two features send this organisation's data to Anthropic: a
          photograph of a cheque, and the rows the agent drafts from. That is a
          disclosure, not a feature description, so it lives beside the export
          and the sample data rather than in a help article — and it comes with
          the switch, because "our board does not want donor images leaving the
          building" is a legitimate answer that needs somewhere to live.

          Shown only when a key is CONFIGURED. Offering an organisation a
          switch for something Steward cannot do either way is a setting that
          means nothing. */}
      {aiStatus&&aiStatus.configured&&(
        <div data-testid="settings-ai-disclosure"
          style={{background:T.white,border:"1px solid "+T.bg3,borderLeft:"3px solid "+T.gold500,borderRadius:16,padding:"20px 24px"}}>
          <SectionLabel>Reading and drafting</SectionLabel>
          <div style={{fontSize:13,color:T.ink3,marginBottom:14,lineHeight:1.6,maxWidth:560}}>
            Steward&apos;s AI features send what each one needs to Anthropic: check photographs to suggest an
            amount, and your records for drafts, briefs, scores, board summaries and Ask Steward, and your grant library pieces for a grant section draft. Voice memos
            are transcribed by OpenAI, which receives the recording only. Nothing is entered or sent until
            you confirm it. This one switch covers all of them.
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <button data-testid="settings-ai-toggle"
              onClick={()=>toggleAi(!aiStatus.enabled)} disabled={!isAdmin||aiSaving}
              style={{background:aiStatus.enabled?T.gold500:"transparent",color:aiStatus.enabled?T.white:T.ink,
                      border:aiStatus.enabled?"none":"1px solid "+T.bg3,borderRadius:8,padding:"8px 18px",
                      fontSize:13,fontWeight:700,cursor:(!isAdmin||aiSaving)?"not-allowed":"pointer",
                      opacity:(!isAdmin||aiSaving)?0.6:1}}>
              {aiSaving?"Saving…":aiStatus.enabled?"On":"Off"}
            </button>
            <span style={{fontSize:12.5,color:T.ink3}}>
              {aiStatus.enabled
                ? "Turn this off and Steward sends nothing to Anthropic or OpenAI. Check photographs still attach to each line."
                : "AI is turned off for your organization. Check photographs still attach to each line, and nothing is sent to Anthropic or OpenAI."}
            </span>
          </div>
          {!isAdmin&&(
            <div style={{fontSize:12,color:T.ink3,marginTop:10}}>Only an admin can change this.</div>
          )}
        </div>
      )}

      {sampleStatus&&(
        <div style={{background:T.white,border:"1px solid "+T.bg3,borderLeft:"3px solid "+T.gold500,borderRadius:16,padding:"20px 24px"}}>
          <SectionLabel>Demo Data</SectionLabel>
          <div style={{fontSize:13,color:T.ink3,marginBottom:14,lineHeight:1.6}}>
            Instantly populate this workspace with a realistic sample dataset, 25 donors across every stage, gifts, grants, events, campaigns, and tasks, so you can explore every feature without entering real data first.
          </div>
          {sampleStatus.hasSampleData?(
            <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
              <span style={{fontSize:13,color:T.ink3,background:T.bg,borderRadius:8,padding:"6px 12px"}}>{sampleStatus.sampleDonorCount} sample donors loaded</span>
              <button onClick={clearSampleData} disabled={sampleClearing}
                style={{background:T.terra100,color:T.terra700,border:"1px solid "+T.terra200,borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:600,cursor:sampleClearing?"not-allowed":"pointer",opacity:sampleClearing?0.7:1}}>
                {sampleClearing?"Clearing…":"Clear sample data"}
              </button>
            </div>
          ):(
            <button onClick={loadSampleData} disabled={sampleLoading}
              style={{background:T.gold500,color:T.white,border:"none",borderRadius:8,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:sampleLoading?"not-allowed":"pointer",opacity:sampleLoading?0.7:1}}>
              {sampleLoading?"Loading sample data…":"Load sample data"}
            </button>
          )}
        </div>
      )}
      </>}

      {/* ── Account ───────────────────────────────────────────────────────── */}
      {/* ── SEC-1 · Security ─────────────────────────────────────────────── */}
      {section==="security"&&<SecurityPanel isAdmin={isAdmin}/>}
      {/* FIX-57: whether Steward support may open this account. */}
      {section==="security"&&isAdmin&&<SupportAccessCard/>}

      {section==="account"&&<>
      {/* TRUST-2 — the DPA, once an attorney has read it and it is published. */}
      <DpaDownload/>
      {/* FIX-11 Part 5 — YOUR BCC ADDRESS, where you would look for it.
          INT-4 built the whole inbound path and nothing on any screen said the
          address existed, so nobody could use it. The user chip in the top bar
          already comes here, which makes this the profile menu's destination
          and the right home for a thing that is personal to how you work. */}
      <BccAddressCard/>
      <div hidden={userRole===VIEWER} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",marginTop:16}}>
        <SectionLabel>Billing</SectionLabel>
        {billing ? (
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:4}}>Current Plan</div>
                {/* FIX-4 6 — THE PLAN'S NAME, with the donor count under it.
                    This printed the raw plan value capitalised, so a new org
                    read "T5000 monthly" on the screen that answers "what am I
                    paying for". */}
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span data-testid="billing-plan-name" style={{fontSize:15,fontWeight:700,color:T.ink,textTransform:planDisplayName(billing.plan)?"none":"capitalize"}}>
                    {planDisplayName(billing.plan)||billing.plan||"Trial"}
                  </span>
                  {(()=>{const m=BILLING_STATUS_META[billing.subscriptionStatus]||BILLING_STATUS_META.trialing; return (
                  <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:99,background:m.bg,color:m.color,border:"1px solid "+m.border}}>
                    {m.label}
                  </span>
                  );})()}
                </div>
                {planDisplayBand(billing.plan)&&(
                  <div data-testid="billing-plan-band" style={{fontSize:12,color:T.ink3,marginTop:2}}>{planDisplayBand(billing.plan)}</div>
                )}
              </div>
              {/* BUILD-90 90b — THE DATE, WHERE SHE LOOKS FOR IT. The same
                  date Checkout showed her and the same one the seven-day
                  reminder names, because all three are built from
                  orgs.trial_ends_at through closeLink.js. A date approaching
                  is not a danger, so it is BRASS, not red (THE DESIGN RULE). */}
              {billing.subscriptionStatus==="trialing"&&billing.trialEndsAt&&(
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:4}}>First Charge</div>
                  <div style={{fontSize:14,fontWeight:600,color:billing.trialDaysLeft<=7?T.gold600:T.ink}}>
                    {new Date(billing.trialEndsAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                    {billing.trialDaysLeft!=null&&<span style={{fontSize:12,color:T.ink3,fontWeight:400,marginLeft:6}}>({billing.trialDaysLeft} days left)</span>}
                  </div>
                </div>
              )}
              {billing.cardLast4&&(
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:4}}>Card On File</div>
                  <div style={{fontSize:14,fontWeight:600,color:T.ink}}><span style={{textTransform:"capitalize"}}>{billing.cardBrand||"Card"}</span> ending {billing.cardLast4}</div>
                </div>
              )}
            </div>
            {/* PRICING-1 — band, records and how they are counted, price, next
                charge, setup fee; the band note waits here for the owner's yes. */}
            <BillingBand billing={billing} isAdmin={isAdmin} onChanged={()=>apiFetch("/billing/status").then(setBilling).catch(()=>{})}/>
            {billing.trialCanceled&&(
              <div data-testid="settings-trial-canceled" style={{fontSize:13,color:T.ink,lineHeight:1.55,background:T.bg,border:`1px solid ${T.bg2}`,borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <span style={{flex:1,minWidth:200}}><strong>{billing.trialCanceledSentence}</strong> Everything stays open until then.</span>
                {isAdmin&&<button data-testid="settings-keep-steward" onClick={keepSteward} disabled={keepBusy} style={{background:T.greenMid,border:"none",borderRadius:8,padding:"9px 18px",color:T.white,fontSize:13,fontWeight:700,cursor:keepBusy?"wait":"pointer",opacity:keepBusy?0.7:1}}>{keepBusy?"Opening checkout...":"Keep Steward"}</button>}
              </div>
            )}
            {billing.firstChargeSentence&&(
              <div style={{fontSize:13,color:T.ink,lineHeight:1.55,background:T.bg,border:`1px solid ${T.bg2}`,borderRadius:10,padding:"12px 14px"}}>
                <strong>{billing.firstChargeSentence}</strong> Cancel any time before then and you pay nothing{billing.setupFee?.paid?" more":""}.
              </div>
            )}
            {/* ROI / impact line. BUILD-73 Part 3: it leads with what is AT RISK
                in the org's own file, next to what the plan costs — the size of
                the problem, never a claim about what Steward achieved. Click for
                the provenance breakdown + the assumption on the one estimate. */}
            {impact&&(impact.atRiskAmount>0||impact.recoveredAmount>0||impact.reengagedAmount>0||impact.watchingRecurringCount>0||impact.onlineGivingProcessed>0)&&(()=>{
              const retried=impact.recoveredAmount||0, cost=impact.planMonthlyCost, watching=impact.watchingRecurringCount||0, online=impact.onlineGivingProcessed||0;
              const returned=impact.reengagedAmount||0, returnedDonors=impact.reengagedDonorCount||0;
              const atRisk=impact.atRiskAmount||0, quiet=impact.quietDonorCount||0;
              const head=(atRisk>0&&quiet>0)
                ? <><strong style={{color:T.ink}}>{fmt(atRisk)}</strong> at risk across <strong style={{color:T.ink}}>{quiet.toLocaleString()}</strong> quiet {plural(quiet, "donor")}{cost!=null&&<> · your plan is <strong style={{color:T.ink}}>${cost}/mo</strong></>}. No platform fee, no donor tip.</>
                : watching>0
                  ? <>Steward is watching <strong style={{color:T.ink}}>{watching}</strong> recurring {plural(watching, "donor")} for failed cards, money most orgs lose silently{cost!=null&&<>, on a <strong style={{color:T.ink}}>${cost}/mo</strong> plan</>}. No platform fee, no donor tip.</>
                  : <>No platform fee, no donor tip, <strong style={{color:T.green600}}>$0</strong> to Steward on every gift{cost!=null&&<>, on a <strong style={{color:T.ink}}>${cost}/mo</strong> plan</>}.</>;
              const brow=(label,value,note)=>(
                <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:12,padding:"7px 0",borderTop:"1px solid "+T.bg3}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12.5,fontWeight:700,color:T.ink}}>{label}</div>
                    <div style={{fontSize:11.5,color:T.ink3,lineHeight:1.45,marginTop:1}}>{note}</div>
                  </div>
                  <div style={{fontSize:14,fontWeight:800,color:T.ink,whiteSpace:"nowrap"}}>{value}</div>
                </div>
              );
              return (
                <div style={{border:"1px solid "+T.bg3,borderLeft:"3px solid "+T.gold500,borderRadius:12,overflow:"hidden",background:T.white}}>
                  <div role="button" tabIndex={0} onClick={()=>setImpactOpen(o=>!o)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setImpactOpen(o=>!o);}}}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"11px 16px",cursor:"pointer"}}>
                    <span aria-hidden style={{color:T.gold500,fontSize:14,lineHeight:1}}>◈</span>
                    <span style={{flex:1,fontSize:13,color:T.ink2,lineHeight:1.5}}>{head}</span>
                    <span style={{fontSize:11,fontWeight:700,color:T.green600,whiteSpace:"nowrap"}}>{impactOpen?"Hide":"Details"}</span>
                  </div>
                  {impactOpen&&(
                    <div style={{padding:"2px 16px 12px",background:T.green100}}>
                      {atRisk>0&&brow("At risk right now",fmt(atRisk),
                        `Lifetime giving of ${countLabel(quiet, "donor")} with no gift in over ${quietPhrase(impact.quietSinceDays)}: lapsing or lapsed. Your file's own history: the size of the problem, measured, not anything Steward did.`)}
                      {retried>0&&brow("Failed cards, retried automatically",fmt(retried),
                        `${countLabel(impact.recoveredCount, "gift")} whose card failed and which the dunning workflow retried. Tracked per gift, attributable to a retry Steward actually ran.`)}
                      {returned>0&&brow("Gifts after a year-long gap",fmt(returned),
                        `${fmt(returned)} from ${countLabel(returnedDonors, "donor")} who gave again after a 365-day gap. A fact about your file's history, counted separately from the failed-card retries.`)}
                      {brow("Platform fees you paid Steward","$0",
                        "Donations run on your own Stripe, no platform fee, no donor tip. (Stripe's standard card fee still applies, and goes to Stripe, not to us.)")}
                      {online>0&&brow(
                        <>What you'd likely have paid elsewhere <span style={{fontSize:10,fontWeight:700,color:T.gold600}}>· estimate</span></>,
                        "~"+fmt(impact.estimatedFeesElsewhere),
                        `Estimate, assumes ~${impact.feeAssumptionPct}% in platform/processing fees a typical platform charges, on the ${fmt(online)} in online giving you processed through Steward.`)}
                    </div>
                  )}
                </div>
              );
            })()}
            {(()=>{
              // ONE canonical destination — Stripe's Customer Portal — never two
              // identically-acting buttons (BUILD-31 Part 1). The portal itself
              // handles plan change, payment method, invoices, and cancel, so a
              // single "Manage billing" is enough. Expectation-setting copy sits
              // ABOVE the action. A manual-grant plan (no Stripe subscription)
              // would open an EMPTY portal → we explain that in-app instead.
              // FIX-32: any plan but the bare trial/seed is a subscriber's plan. The
              // list used to name the legacy plans only, so an org on a current
              // band was told to "Start a subscription".
              const isSubscriber=!!billing.plan&&billing.plan!=="trial"&&billing.plan!=="seed";
              const hasSub=!!billing.hasSubscription;
              const isUpgradable=billing.plan==="trial"||billing.plan==="seed";
              const planLabel=planDisplayName(billing.plan)||billing.plan;
              return (
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div style={{fontSize:12.5,color:T.ink3,lineHeight:1.5}}>
                  {isSubscriber&&hasSub
                    ? "Change your plan, update your payment method, download invoices, or cancel, all in Stripe's secure billing portal. Opens in a new tab; plan changes are prorated automatically."
                    : isSubscriber&&!hasSub
                      ? <>You're on <strong style={{color:T.ink}}>{planLabel}</strong> via a manual grant from Steward, there's <strong style={{color:T.ink}}>no active subscription</strong> to manage, and nothing to pay. To move to self-serve billing, choose a plan.</>
                      : "Start a subscription any time, opens Stripe's secure checkout."}
                </div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                  {isSubscriber&&hasSub&&(
                    <button onClick={openBillingPortal} disabled={portalLoading} style={{background:T.greenMid,border:"none",borderRadius:8,padding:"9px 18px",color:T.white,fontSize:13,fontWeight:700,cursor:portalLoading?"wait":"pointer",opacity:portalLoading?0.7:1}}>
                      {portalLoading?"Opening…":"Manage billing →"}
                    </button>
                  )}
                  {!billing.trialCanceled&&(isUpgradable||(isSubscriber&&!hasSub))&&(
                    <a href="/pricing" style={{display:"inline-block",background:T.greenMid,border:"none",borderRadius:8,padding:"9px 18px",color:T.white,fontSize:13,fontWeight:700,cursor:"pointer",textDecoration:"none"}}>
                      Choose a plan →
                    </a>
                  )}
                  {/* BUILD-90 90b — cancelling takes a click, here, and does
                      not require finding the Stripe portal or ringing anybody.
                      Before the first charge it costs nothing; after one, it
                      runs to the end of the month already paid for. */}
                  {billing.canCancel&&(
                    <button onClick={cancelSubscription} disabled={cancelBusy} style={{background:"none",border:`1px solid ${T.bg3}`,borderRadius:8,padding:"9px 18px",color:T.ink,fontSize:13,fontWeight:700,cursor:cancelBusy?"wait":"pointer",opacity:cancelBusy?0.7:1}}>
                      {cancelBusy?"Cancelling…":"Cancel subscription"}
                    </button>
                  )}
                </div>
                {cancelNote&&(
                  <div role="status" style={{fontSize:12.5,color:T.ink,lineHeight:1.5}}>{cancelNote}</div>
                )}
                {portalError&&(
                  <div role="alert" style={{fontSize:12.5,color:T.terracotta,lineHeight:1.5}}>
                    {portalError}{" "}
                    {portalUrl
                      ? <a href={portalUrl} target="_blank" rel="noopener noreferrer" style={{color:T.greenDk,fontWeight:700,textDecoration:"underline"}}>Open billing portal →</a>
                      : <button onClick={openBillingPortal} style={{background:"none",border:"none",padding:0,color:T.greenDk,fontWeight:700,cursor:"pointer",textDecoration:"underline",fontSize:12.5}}>Try again</button>}
                  </div>
                )}
              </div>
              );})()}
          </div>
        ) : (
          <div style={{fontSize:13,color:T.ink3}}>Loading billing information…</div>
        )}
      </div>

      {/* The organisation's own email settings, admins only. The per-person
          email list that lived here moved to Settings → My email (STAFF-MAIL-1). */}
      {isAdmin&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",marginBottom:20}}>
        <SectionLabel>Your organization's email</SectionLabel>
        {/* ── BUILD-88c C.1 — SEND FROM YOUR OWN ADDRESS ─────────────────────
            Every email has left through Steward's domain with the organisation's
            NAME on it. That closed the "bare unfamiliar domain" trust gap and
            did nothing about the other one: an unfamiliar SENDING domain costs
            deliverability, and on a shared domain one organisation's spam
            complaints drag down everybody else's. Publish three DNS records and
            donors see your address instead. Nothing is blocked while you wait. */}
        {isAdmin&&sd!==null&&(
          <div style={{padding:"10px 0 0",borderTop:"1px solid "+T.bg2}} data-testid="sending-domain">
            <div style={{fontSize:14,fontWeight:600,color:T.ink}}>Send from your own address</div>
            <div style={{fontSize:12,color:T.ink3,marginTop:2,maxWidth:600,lineHeight:1.55}}>{sd.sentence}</div>
            {!sd.domain&&(
              <div style={{display:"flex",gap:8,alignItems:"center",marginTop:10,flexWrap:"wrap"}}>
                <input value={sdEmail} onChange={e=>setSdEmail(e.target.value)} data-testid="sd-email"
                  aria-label="The address donors should see" placeholder="ada@yourcharity.org"
                  style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none",width:260}}/>
                <button onClick={claimDomain} disabled={sdBusy} data-testid="sd-claim"
                  style={{background:T.ink,border:"none",borderRadius:8,padding:"8px 14px",color:T.white,fontSize:12.5,fontWeight:700,cursor:sdBusy?"not-allowed":"pointer"}}>
                  {sdBusy?"Setting up…":"Use this address"}</button>
              </div>
            )}
            {sd.domain&&(
              <div style={{marginTop:10}}>
                <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
                  <span style={{fontSize:13,fontWeight:700,color:T.ink}}>{sd.fromEmail}</span>
                  {sd.verified
                    ?<span data-testid="sd-verified" style={{fontSize:11,fontWeight:800,background:T.bg2,color:T.ink3,border:"1px solid "+T.bg3,borderRadius:99,padding:"2px 9px"}}>
                       Verified {displayOrgDate(sd.verifiedAt)}</span>
                    :<span style={{fontSize:11,fontWeight:800,background:T.gold100,color:T.gold700,border:"1px solid "+T.gold300,borderRadius:99,padding:"2px 9px"}}>
                       Waiting for DNS</span>}
                  {!sd.verified&&(
                    <button onClick={checkDomain} disabled={sdBusy} data-testid="sd-check"
                      style={{background:T.greenDk,border:"none",borderRadius:8,padding:"7px 13px",color:T.white,fontSize:12.5,fontWeight:700,cursor:sdBusy?"not-allowed":"pointer"}}>
                      {sdBusy?"Checking…":"Check"}</button>
                  )}
                  <button onClick={releaseDomain} disabled={sdBusy}
                    style={{background:"none",border:"none",padding:0,color:T.ink3,fontSize:12,cursor:"pointer",textDecoration:"underline"}}>Use Steward's address instead</button>
                </div>
                {!sd.verified&&sd.records.length>0&&(
                  <div style={{border:"1px solid "+T.bg3,borderRadius:10,overflow:"hidden"}}>
                    <div style={{padding:"8px 12px",background:T.bg2,fontSize:11.5,color:T.ink3}}>
                      Add these to {sd.domain}'s DNS, then press Check. They usually take a few minutes.
                    </div>
                    {sd.records.map((r,i)=>(
                      <div key={i} data-testid="sd-record" style={{padding:"10px 12px",borderTop:"1px solid "+T.bg3,display:"flex",gap:10,alignItems:"flex-start",flexWrap:"wrap"}}>
                        <span style={{fontSize:10.5,fontWeight:800,color:T.ink3,width:44,flexShrink:0}}>{r.type}</span>
                        <div style={{flex:"1 1 260px",minWidth:0}}>
                          <div style={{fontSize:12.5,color:T.ink,fontWeight:600,wordBreak:"break-all"}}>{r.name}</div>
                          <div style={{fontSize:11.5,color:T.ink3,wordBreak:"break-all",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace"}}>{r.value}{r.priority?` · priority ${r.priority}`:""}</div>
                        </div>
                        <button onClick={()=>copyRecord(i,r.value)} data-testid="sd-copy"
                          style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 11px",color:T.ink3,fontSize:11.5,fontWeight:700,cursor:"pointer",flexShrink:0}}>
                          {sdCopied===i?"Copied ✓":"Copy"}</button>
                      </div>
                    ))}
                  </div>
                )}
                {sd.checkedAt&&!sd.verified&&(
                  <div style={{fontSize:11.5,color:T.ink3,marginTop:6}}>Last checked {String(sd.checkedAt).slice(0,16).replace("T"," ")}.</div>
                )}
              </div>
            )}
            {sdErr&&<div role="alert" style={{fontSize:12.5,color:T.terra700,marginTop:8}}>{sdErr}</div>}
          </div>
        )}
        {/* ── BUILD-88b B.3 — YOUR VOICE ────────────────────────────────────
            Steward drafts the thank-yous; she sends them. Three notes she has
            already written are enough to open and close them the way she does —
            and until they exist the draft stays ONE plain sentence, because a
            warm four-paragraph letter in nobody's voice is worse than a plain
            line she finishes herself. Only the greeting and the sign-off are
            lifted: copying somebody's habits is defensible, copying their
            sentences into a letter they did not write is not. */}
        {isAdmin&&voice!==null&&(
          <div ref={voiceRef} id="settings-voice" data-testid="settings-voice" style={{padding:"10px 0 0",borderTop:"1px solid "+T.bg2}}>
            <div style={{fontSize:14,fontWeight:600,color:T.ink}}>Your voice, for the thank-yous Steward drafts</div>
            <div style={{fontSize:12,color:T.ink3,marginTop:2,maxWidth:560,lineHeight:1.55}}>
              Paste three thank-yous you have already sent. Steward takes your greeting and your sign-off and
              nothing else. {voice.ready
                ? <>It has what it needs: {voice.greeting?<em>“{voice.greeting}”</em>:"your greeting"} … {voice.signoff?<em>“{voice.signoff}”</em>:"your sign-off"}.</>
                : <>{voice.needs} more to go. Until then the drafts are one plain sentence.</>}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:10,maxWidth:620}}>
              {[0,1,2].map(i=>(
                <textarea key={i} value={voiceDraft[i]||""} onChange={e=>setVoiceDraft(p2=>{const n=[...p2];n[i]=e.target.value;return n;})}
                  aria-label={`Thank-you sample ${i+1}`} data-testid={`voice-sample-${i}`}
                  placeholder={i===0?"Dear Anna,\n\nThank you so much for the gift…\n\nWith gratitude,\nAda":"Another one you have sent"}
                  style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 11px",color:T.ink,fontSize:12.5,lineHeight:1.5,minHeight:i===0?110:70,resize:"vertical",fontFamily:"inherit",boxSizing:"border-box"}}/>
              ))}
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <button onClick={saveVoice} data-testid="voice-save"
                  style={{background:T.ink,border:"none",borderRadius:8,padding:"8px 14px",color:T.white,fontSize:12.5,fontWeight:700,cursor:"pointer"}}>Save my voice</button>
                {voiceSaved&&<span style={{fontSize:12,color:T.ink3}}>{voiceSaved}</span>}
              </div>
            </div>
          </div>
        )}
        {/* BUILD-88a A.6 — Steward counts GIVING. An organisation with earned
            income keeps that figure somewhere else; this is where it says so,
            on its own line under giving on the board, never added to it. */}
        {isAdmin&&otherIncomeOn!==null&&(
          <div style={{padding:"10px 0 0",borderTop:"1px solid "+T.bg2}}>
            <label style={{display:"flex",alignItems:"flex-start",gap:12,cursor:"pointer"}}>
              <input type="checkbox" checked={otherIncomeOn} onChange={toggleOtherIncome} data-testid="other-income-toggle"
                style={{width:16,height:16,marginTop:2,cursor:"pointer",accentColor:T.greenMid}}/>
              <div>
                <div style={{fontSize:14,fontWeight:600,color:T.ink}}>Show other income on the board dashboard</div>
                <div style={{fontSize:12,color:T.ink3,marginTop:1}}>Steward counts gifts. Earned income, a store, tickets, program fees, is not tracked here, so this is one figure you type. It appears on its own line under giving and is never added to it.</div>
              </div>
            </label>
            {otherIncomeOn&&(
              <div style={{display:"flex",gap:8,alignItems:"center",marginTop:10,marginLeft:28,flexWrap:"wrap"}}>
                <input value={otherIncome} onChange={e=>setOtherIncome(e.target.value)} inputMode="decimal"
                  aria-label="Other income this year" data-testid="other-income-amount" placeholder="e.g. 41,250"
                  style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none",width:160}}/>
                <button onClick={saveOtherIncome}
                  style={{background:T.greenDk,border:"none",borderRadius:8,padding:"8px 14px",color:T.white,fontSize:12.5,fontWeight:700,cursor:"pointer"}}>Save</button>
                {otherIncomeSaved&&<span style={{fontSize:12,color:T.ink3}}>{otherIncomeSaved}</span>}
              </div>
            )}
          </div>
        )}
      </div>}

      {/* On-brand Account panel (BUILD-31 Part 2.3): plain white/cream section,
          ink label, sign-out as a QUIET terracotta outline (destructive-but-not-
          alarming) — not a near-black block with alarm-red text that read as an
          error state. Terms/Privacy are ordinary links. */}
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Account</SectionLabel>
        <button onClick={logout} style={{background:"none",border:"1px solid "+T.terracotta,borderRadius:8,padding:"9px 18px",color:T.terracotta,fontSize:13,fontWeight:600,cursor:"pointer"}}>
          Sign out
        </button>
        <div style={{marginTop:20,display:"flex",gap:20}}>
          <a href="/terms" target="_blank" rel="noopener noreferrer" style={{fontSize:12,color:T.ink3,textDecoration:"none",borderBottom:"1px solid "+T.bg3}}>Terms of Service</a>
          <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{fontSize:12,color:T.ink3,textDecoration:"none",borderBottom:"1px solid "+T.bg3}}>Privacy Policy</a>
        </div>
      </div>
      </>}

      {showAddField&&(
        <Modal onClose={closeCfModal} width={440} zIndex={500} backdrop="rgba(0,0,0,0.45)" blur={false}
          padding="32px 28px" ariaLabel={editingField?"Edit field":"Add custom field"}
          dialogStyle={{borderRadius:20}}>
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:17,fontWeight:700,color:T.ink}}>{editingField?"Edit field":"Add custom field"}</div>
              <button onClick={closeCfModal} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:T.ink3,lineHeight:1}}>×</button>
            </div>
            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Field label</div>
            <input value={cfForm.label} onChange={e=>setCfForm(f=>({...f,label:e.target.value}))}
              placeholder="e.g. Board Connection, Peer-to-Peer Interest"
              style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:14}}
            />
            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Field type</div>
            <select value={cfForm.type} onChange={e=>setCfForm(f=>({...f,type:e.target.value}))} disabled={!!editingField}
              style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:editingField?4:14,opacity:editingField?0.6:1}}>
              <option value="text">Text</option>
              <option value="long_text">Long text (up to 2,000 characters)</option>
              <option value="number">Number</option>
              <option value="money">Money</option>
              <option value="date">Date</option>
              <option value="select">Select (one choice)</option>
              <option value="multi_select">Multi-select</option>
              <option value="checkbox">Yes/No (Checkbox)</option>
            </select>
            {editingField&&<div style={{fontSize:11.5,color:T.ink3,marginBottom:14,lineHeight:1.5}}>
              A field's type can't change after creation, changing it would silently rewrite every saved value. Archive this field and add a new one instead.
            </div>}
            {(cfForm.type==="select"||cfForm.type==="multi_select")&&(
              <div style={{marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:6}}>Options</div>
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <input value={cfOptInput} onChange={e=>setCfOptInput(e.target.value)}
                    placeholder="Add option…"
                    onKeyDown={e=>e.key==="Enter"&&(e.preventDefault(),addCfOption())}
                    style={{flex:1,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 12px",fontSize:13,color:T.ink,background:T.bg,outline:"none"}}
                  />
                  <button onClick={addCfOption} style={{background:T.green,border:"none",borderRadius:8,padding:"8px 14px",color:T.white,fontSize:12,fontWeight:700,cursor:"pointer"}}>Add</button>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {cfForm.options.map((o,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:4,background:T.bg2,border:"1px solid "+T.bg3,borderRadius:20,padding:"3px 10px 3px 10px",fontSize:12,color:T.ink}}>
                      {o}
                      <span onClick={()=>removeCfOption(i)} style={{cursor:"pointer",marginLeft:4,color:T.ink3,fontSize:14,lineHeight:1}}>×</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{display:"flex",gap:10,marginTop:6}}>
              <button onClick={closeCfModal} style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px",color:T.ink2,fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
              <button onClick={saveCfField} disabled={cfSaving||!cfForm.label.trim()} style={{flex:2,background:T.green,border:"none",borderRadius:10,padding:"10px",color:T.white,fontSize:13,fontWeight:700,cursor:"pointer",opacity:(cfSaving||!cfForm.label.trim())?0.7:1}}>
                {cfSaving?"Saving…":editingField?"Save changes":"Add field"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showAddMetric&&(
        <Modal onClose={closeImModal} width={440} zIndex={500} backdrop="rgba(0,0,0,0.45)" blur={false}
          padding="32px 28px" ariaLabel={editingMetric?"Edit impact metric":"Add impact metric"}
          dialogStyle={{borderRadius:20}}>
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:17,fontWeight:700,color:T.ink}}>{editingMetric?"Edit impact metric":"Add impact metric"}</div>
              <button onClick={closeImModal} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:T.ink3,lineHeight:1}}>×</button>
            </div>
            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Metric name</div>
            <input value={imForm.name} onChange={e=>setImForm(f=>({...f,name:e.target.value}))}
              placeholder="e.g. Full-Year Scholarship"
              style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:14}}
            />
            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Cumulative giving threshold ($)</div>
            <input type="number" value={imForm.dollarThreshold} onChange={e=>setImForm(f=>({...f,dollarThreshold:e.target.value}))}
              placeholder="e.g. 2500"
              style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:14}}
            />
            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Outcome template</div>
            <textarea value={imForm.outcomeTemplate} onChange={e=>setImForm(f=>({...f,outcomeTemplate:e.target.value}))}
              placeholder="e.g. Your ${amount} has covered {n} full-year arts program scholarships"
              rows={3}
              style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:6,fontFamily:"inherit",resize:"vertical"}}
            />
            <div style={{fontSize:11,color:T.ink3,marginBottom:20,lineHeight:1.5}}>
              Use <code>{"{amount}"}</code> for the donor's cumulative giving and <code>{"{n}"}</code> for how many times this threshold has been covered. Used to draft warm, specific milestone emails, not shown to donors verbatim.
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={closeImModal} style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px",color:T.ink2,fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
              <button onClick={saveImMetric} disabled={imSaving||!imForm.name.trim()||!imForm.dollarThreshold||!imForm.outcomeTemplate.trim()} style={{flex:2,background:T.green,border:"none",borderRadius:10,padding:"10px",color:T.white,fontSize:13,fontWeight:700,cursor:"pointer",opacity:(imSaving||!imForm.name.trim()||!imForm.dollarThreshold||!imForm.outcomeTemplate.trim())?0.7:1}}>
                {imSaving?"Saving…":editingMetric?"Save changes":"Add metric"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showInvite&&(
        <Modal onClose={closeInvite} width={420} zIndex={500} backdrop="rgba(0,0,0,0.45)" blur={false}
          padding="32px 28px" ariaLabel={"Invite a team member"}
          dialogStyle={{borderRadius:20}}>
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:17,fontWeight:700,color:T.ink}}>Invite a team member</div>
              <button onClick={closeInvite} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:T.ink3,lineHeight:1}}>×</button>
            </div>

            {!inviteResult?(
              <>
                <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Email address</div>
                <input value={invEmail} onChange={e=>setInvEmail(e.target.value)}
                  placeholder="staff@yourorg.org"
                  style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:12}}
                  onKeyDown={e=>e.key==="Enter"&&sendInvite()}
                />
                <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Role</div>
                <select value={invRole} onChange={e=>setInvRole(e.target.value)}
                  style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:16}}>
                  {ROLES.map(r=><option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                {invErr&&<div style={{marginBottom:12,fontSize:13,color:T.terra700,background:T.terra100,border:"1px solid "+T.terra200,borderRadius:8,padding:"8px 12px"}}>{invErr}</div>}
                <div style={{display:"flex",gap:10}}>
                  <button onClick={closeInvite} style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px",color:T.ink2,fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
                  <button onClick={sendInvite} disabled={inviting} style={{flex:2,background:T.green,border:"none",borderRadius:10,padding:"10px",color:T.white,fontSize:13,fontWeight:700,cursor:"pointer",opacity:inviting?0.7:1}}>
                    {inviting?"Generating invite…":"Generate invite link"}
                  </button>
                </div>
              </>
            ):(
              <>
                <div style={{background:T.green100,border:"1px solid "+T.green200,borderRadius:12,padding:"14px 16px",marginBottom:16}}>
                  <div style={{fontSize:13,fontWeight:700,color:T.greenDk,marginBottom:4}}>
                    {inviteResult.emailSent?"Invite sent! You can also share the link below:":"Share this invite link:"}
                  </div>
                  <div style={{fontSize:12,color:T.greenDk,wordBreak:"break-all",lineHeight:1.5}}>{inviteResult.link}</div>
                </div>
                {!inviteResult.emailSent&&<div style={{fontSize:12,color:T.ink3,marginBottom:14,lineHeight:1.5}}>
                  {inviteResult.emailMessage||"The invite was not emailed."} The link expires in 7 days.
                </div>}
                <div style={{display:"flex",gap:10}}>
                  <button onClick={copyLink} style={{flex:1,background:copied?T.green:T.bg,border:"1px solid "+(copied?T.green:T.bg3),borderRadius:10,padding:"10px",color:copied?T.white:T.ink2,fontSize:13,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>
                    {copied?"Copied!":"Copy link"}
                  </button>
                  <button onClick={closeInvite} style={{flex:1,background:T.green,border:"none",borderRadius:10,padding:"10px",color:T.white,fontSize:13,fontWeight:700,cursor:"pointer"}}>Done</button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
      {upgradeModal&&<UpgradeModal open={true} onClose={()=>setUpgradeModal(null)} reason={upgradeModal.reason} current={upgradeModal.current} limit={upgradeModal.limit} plan={upgradeModal.plan}/>}
    </div>
  );
}

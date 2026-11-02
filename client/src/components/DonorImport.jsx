// DonorImport.jsx — every way a file comes into Donors: the one-file import,
// gift history, and merging duplicates.
//
// FIX-1 split: moved VERBATIM out of Donors.jsx. Nothing in it changed.
// Tests read it through readSource("client/src/components/Donors.jsx").
import { useState, useEffect, useMemo } from "react";
import { apiFetch } from "../api";
import { MoveStart } from "./MoveIn";
import { newRunId } from "../../../shared/movePlan";
import { rethrowProgrammerError, errorMessage, isProgrammerError } from "../lib/domainError";
import { useAuth } from "../main";
import UpgradeModal from "./UpgradeModal";
import { detectMailchimpAudience, fileStatusFromName } from "../../../shared/mailchimpPreset.js";
import { emailProblem, emailHint } from "../../../shared/contactCheck.js";
import { detectNpsp, npspMapping, NPSP_OBJECT_OPPORTUNITY } from "../../../shared/npspPreset.js";
import { detectMigrationPreset, migrationMapping, MIGRATION_PRESETS } from "../../../shared/migrationPresets.js";
import { membershipColumns, buildMembershipRows, MEMBERSHIP_FIELDS } from "../../../shared/membershipImport.js";
import { buildMapperPlan, buildColumnLedger, summarizeColumnLedger, generateFieldKey } from "../../../shared/customFieldShape";
import { T, Modal } from "./shared";
import { detectImportShape, YEAR_HDR_PAT, detectWorkbookRoles, pickMatchKey, detectOwnerColumn, matchOwnersToUsers, applyOwnerAssignment, groupOwnerMatches, classifyColumns, analyzeCsvText, assessAggregateCollapse, scanAmountShapedColumns, normalizeHeader, stageAssignmentBasis, validateMappingChoice, buildProposalRows, autoDetectTxMapping, inferDateConvention } from "../../../shared/importShape";
import { WorkbookImport } from "./WorkbookImport";
import { inferStage } from "./donorShared";
import { countLabel } from "../../../shared/countWords.js";
import { guessField, VALID_IMPORT_KEYS, CSV_STANDARD_FIELDS, plainFieldLabel, txRoleLabel } from "./import/fields";
import { parseFileToSheets, reportFromAnalysis } from "./import/reader";
import { orgCivilToday, buildAutoMapping, buildTransactionPayload, buildWidePayload, buildAggregatePayload, STANDARD_METHODS, submitImportChunked, moveFileFactsFrom, buildBothPayload } from "./import/payload";
import { autoDetectWideConfig, yearColToDate, GiftHistoryImport } from "./import/GiftHistoryImport";
import { MergeDuplicatesModal } from "./import/MergeDuplicatesModal";
import { ImportReview } from "./import/ImportReview";
import { ImportMapping } from "./import/ImportMapping";
import { ImportDetection } from "./import/ImportDetection";
import { ImportReader } from "./import/ImportReader";
import { ImportDone } from "./import/ImportDone";
import { ImportHeader, ImportFileTile } from "./import/ImportHeader";
export { plainFieldLabel, txRoleLabel, anyFieldLabel } from "./import/fields";

// ── DonorImport component ──────────────────────────────────────────────────
// Exported so WelcomePage's onboarding flow can reuse it directly as the
// centerpiece "Import your donors" step, rather than forking/rebuilding it.
// `withHistory` (used only by onboarding — the regular Donors tab's "Import
// Donors" button always omits it, so its behavior is unchanged): when true,
// also derives one real `gifts` row per donor from their imported total/
// last-gift-date and posts through /donors/import-combined instead of the
// plain /donors/import. Without this, a brand-new org's donor records only
// ever get aggregate fields — no queryable gifts/interactions rows — which
// is why Retention Rate, Stewardship Debt, and Gifts YTD render blank
// immediately after onboarding for every org that isn't shown the OTHER
// import button, buried in the regular Donors tab, after the fact.
// FIX-32 · A REAL FILE REPLACES THE SAMPLE, AND SHE SAYS SO FIRST. An org
// that explored the demo has 25 invented people in it; importing her own file
// on top of them mixes fiction into every total. Before the importer opens,
// the sample count is read from the same route the banner and the clear use,
// and if there is any, she confirms the clear (or keeps the sample and
// closes). Nothing is deleted without the click.
export function DonorImport(props) {
  const [gate, setGate] = useState("checking"); // checking | ask | open
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    apiFetch("/org/sample-data-status")
      .then(st => { if (!live) return;
        if (st && st.hasSampleData) { setCount(st.sampleDonorCount || 0); setGate("ask"); } else setGate("open"); })
      .catch(() => { if (live) setGate("open"); });
    return () => { live = false; };
  }, []);
  async function clearAndOpen() {
    setBusy(true); setErr("");
    try { await apiFetch("/org/clear-sample-data", { method: "POST" }); setGate("open"); }
    catch (e) { setErr(errorMessage(e, "The sample data could not be cleared. Please try again.")); }
    setBusy(false);
  }
  if (gate === "open") return <DonorImportFile {...props} />;
  if (gate === "checking") return null;
  return (
    <Modal className="commit-screen" onClose={props.onClose} width={520} zIndex={300} backdrop="rgba(15,26,18,0.72)" blur={false}
      padding={28} ariaLabel="Sample data is loaded" dialogStyle={{borderRadius:20,border:"1px solid "+T.bg3}}>
      <div data-testid="import-clear-sample">
        <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:22,color:T.ink,marginBottom:8}}>Sample data is loaded</div>
        <div style={{fontSize:14,color:T.ink2,lineHeight:1.6,marginBottom:18}}>
          {count.toLocaleString()} sample donor{count===1?" is":"s are"} in your workspace. Importing your real file clears them first, with
          their gifts and conversations, so nothing invented ends up in your totals. Your file is not touched.
        </div>
        {err && <div style={{fontSize:13,color:T.terracotta,marginBottom:12}}>{err}</div>}
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={props.onClose} disabled={busy}
            style={{background:"none",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 16px",fontSize:14,fontWeight:600,color:T.ink,cursor:"pointer",fontFamily:"inherit"}}>
            Keep the sample
          </button>
          <button data-testid="import-clear-sample-yes" onClick={clearAndOpen} disabled={busy}
            style={{background:T.green,border:"none",borderRadius:10,padding:"10px 16px",fontSize:14,fontWeight:700,color:T.white,cursor:busy?"not-allowed":"pointer",opacity:busy?0.7:1,fontFamily:"inherit"}}>
            {busy ? "Clearing…" : "Clear the sample and import"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DonorImportFile({ onClose, onImported, withHistory = false, org = null, onOpenHome = null }) {
  // The org's civil today, for the future-date test (BUILD-72's rule).
  const orgToday = orgCivilToday(org?.timezone);
  // An org already mid-move is not asked where its donors are every time it
  // opens the importer: the answer is on the org.
  useEffect(() => {
    let live = true;
    apiFetch("/move")
      .then(r => { if (!live || !r || !r.move) return;
        if (r.move.active) { setMoveSource(r.move.source); setMoveLabel(r.move.label || ""); setMoveAsked(true); } })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  // ── TRANS-1 Part 1 — WHERE ARE YOUR DONORS TODAY? ───────────────────────
  // Asked BEFORE the file, not guessed after it. The preset the tile picks
  // pre-fills the mapper; detection still runs underneath, so a file that
  // disagrees with the tile is still read correctly. `moveAsked` goes true the
  // moment she answers OR skips, so the question is asked once.
  const [moveSource, setMoveSource] = useState(null);
  const [moveLabel,  setMoveLabel]  = useState("");
  const [moveAsked,  setMoveAsked]  = useState(false);
  const [csvText,    setCsvText]    = useState("");
  const [srcFile,    setSrcFile]    = useState(null);       // the uploaded File (name/size for the file tile)
  const [parsed,     setParsed]     = useState(null);       // { headers:[], rows:[] }
  const [xlsxSheets, setXlsxSheets]= useState(null);       // [{name, rowCount, headers, rows}] | null (legacy multi-sheet path — CSV only now)
  const [workbook,   setWorkbook]   = useState(null);       // BUILD-82 — the one-import workbook flow ({roled})
  const [adaptiveFile, setAdaptiveFile] = useState(null);   // IMPORT-3: a file read by the adaptive reader
  const [mapping,    setMapping]    = useState({});         // aggregate + wide donor-field mapping
  const [txMap,      setTxMap]      = useState({ donorName:"",donorEmail:"",amount:"",date:"",type:"",campaign:"",notes:"",phone:"",city:"",state:"",owner:"",externalId:"" });
  // LIVE-1 — files map themselves (the saved answer for these headers and the
  // columns it does not cover), the thank-you count before saving, and the
  // value answers ("CHK" is Check) she gives once for every later file.
  const [shapeMemory, setShapeMemory] = useState(null);
  const [undoBusy,   setUndoBusy]   = useState(false);
  const [tyPreview,  setTyPreview]  = useState(null);
  const [thanks,     setThanks]     = useState(null);   // FIX-37: her answer; null = the default
  const [valueAnswers, setValueAnswers] = useState({});   // "field|raw" → value
  const [savedValues, setSavedValues] = useState([]);
  const [yearCols,   setYearCols]   = useState([]);         // wide year columns
  const [yearConvention, setYearConvention] = useState("dec31");
  const [shape,      setShape]      = useState("aggregate");// auto-detected file shape
  const [shapeDetail, setShapeDetail] = useState(null);      // BUILD-79 Part 2 — the detection's evidence { reason, recognized, … }
  const [shapeOverride, setShapeOverride] = useState(null); // user override, if any
  const [bothMode,   setBothMode]   = useState(null);       // { donorSheet, giftSheet, matchInfo } when "Import both" is chosen
  const [matchKey,   setMatchKey]   = useState("email");    // gift→donor link column in both-mode
  const [loading,    setLoading]    = useState(false);
  const [ackUnmapped, setAckUnmapped] = useState(false);    // BUILD-77 Part 3d — homeless columns require an explicit acknowledgement (aggregate/wide shapes)
  // ── BUILD-78 — the column mapper (transaction shape) ──
  const [physicalCols, setPhysicalCols] = useState(null);   // { headerCells, orphanColumns, overflowRows, total } — parse entry, never derived from the mapping
  const [parseReport, setParseReport] = useState(null);
  const [mapRefusal, setMapRefusal] = useState(null);       // BUILD-79 Part 5 — last refused mapping choice + its evidence
  // FIX (2026-09-09) — a CSV donor column can now land in a custom field too,
  // so the donor mapper carries the same two-axis decision the workbook does:
  // `mapping` for standard targets, `donorCfChoices` for custom ones.
  const [donorCfChoices, setDonorCfChoices] = useState({});  // header → {fieldId,key,entity,label}
  const [dateConventionChoice, setDateConventionChoice] = useState(null); // BUILD-80 Part 2.2 — a human's answer for a MIXED date column     // BUILD-79 Part 1 — { records, chromeAbove, chromeRows, totalRow, headerLine, cp1252Lines } from parse entry
  const [cfDefs, setCfDefs] = useState({ donor: [], gift: [] });
  const [savedCfMappings, setSavedCfMappings] = useState([]);
  const [cfDecisions, setCfDecisions] = useState({});       // columnIndex → { action, entity?, type?, label?, options?, role? }
  const [progress,   setProgress]   = useState(null);       // { done, total } during chunked submit
  const [flaggedPage,setFlaggedPage]= useState(1);          // A.7 — the flagged list pages at 50 DONORS
  const [aiLoading,  setAiLoading]  = useState(false);
  const [result,     setResult]     = useState(null);       // {created,giftsInserted,duplicates,warned,skipped,batchErrors}
  const [err,        setErr]        = useState("");
  const [upgradeInfo,setUpgradeInfo]= useState(null);

  // ── Officer routing (Team) — map an owner/officer column to org users so each
  // donor lands in the right officer's portfolio on import (pairs with the
  // pipeline-portfolio model). Core orgs never see this (isTeam=false → the
  // panel is hidden and the server ignores any assignment). ────────────────────
  const { auth } = useAuth();
  const [orgUsers,   setOrgUsers]   = useState([]);   // [{id,name,email,role}]
  const [isTeam,     setIsTeam]     = useState(false);
  const [ownerMap,   setOwnerMap]   = useState({});   // rawOwnerValue → userId | "" (unassigned)
  const [bulkAssign, setBulkAssign] = useState("");   // no-owner-column case: "" | "__me__" | userId
  const [inviteFor,  setInviteFor]  = useState(null); // owner value being invited
  const [inviteEmail,setInviteEmail]= useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteErr,  setInviteErr]  = useState("");
  const [invitedValues,setInvitedValues]= useState({}); // owner value → true once invited
  const myId = auth?.user?.id || "";
  const myName = auth?.user?.name || auth?.user?.email || "";

  const loadOfficers = () => apiFetch("/portfolio/officers").then(r => {
    setIsTeam(r?.tier === "team");
    // Active users AND pending invitees, so an owner value can match/assign to
    // someone who's only been invited. A pending invitee's synthetic id is
    // "invite:<id>" — the server resolver holds the assignment until they accept.
    const active = (r?.officers || []).map(o => ({ id:o.id, name:o.name, email:o.email, role:o.role, pending:false }));
    const pending = (r?.invites || []).map(i => ({ id:"invite:"+i.id, name:i.name, email:i.email, pending:true }));
    setOrgUsers([...active, ...pending]);
    return { active, pending };
  }).catch(()=>({ active:[], pending:[] }));

  useEffect(() => { loadOfficers(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    apiFetch("/custom-fields?entity=donor").then(r=>setCfDefs(p=>({...p,donor:Array.isArray(r)?r:[]}))).catch(()=>{});
    apiFetch("/custom-fields?entity=gift").then(r=>setCfDefs(p=>({...p,gift:Array.isArray(r)?r:[]}))).catch(()=>{});
    apiFetch("/import-field-mappings").then(r=>setSavedCfMappings(Array.isArray(r)?r:[])).catch(()=>{});
  }, []);

  // FIX (2026-09-09) item 2 — TWO COLUMNS CANNOT BECOME ONE FIELD. A standard
  // target another column already claims is disabled in the dropdown, and the
  // Import button refuses by name if one slips through (an AI/auto guess, a
  // stale mapping). No standard donor field legitimately takes two sources:
  // first/last name are two DIFFERENT fields, and a second email is `email2`
  // on the workbook side — a shape that grows one gets an exception here, with
  // its reason, not a silent overwrite.
  const MULTI_SOURCE_DONOR_FIELDS = new Set();
  const takenDonorTargets = (exceptHeader) => {
    const taken = new Set();
    for (const [h, f] of Object.entries(mapping)) {
      if (!f || h === exceptHeader || MULTI_SOURCE_DONOR_FIELDS.has(f)) continue;
      taken.add(f);
    }
    return taken;
  };
  const duplicateDonorTargets = useMemo(() => {
    const byField = {};
    for (const [h, f] of Object.entries(mapping)) {
      if (!f || MULTI_SOURCE_DONOR_FIELDS.has(f)) continue;
      (byField[f] = byField[f] || []).push(h);
    }
    return Object.entries(byField).filter(([, hs]) => hs.length > 1)
      .map(([f, hs]) => ({ field: f, headers: hs }));
  }, [mapping]);

  const effectiveShape = shapeOverride || shape;
  // BUILD-79 Part 2.2 — totals mode refuses when >1/3 of keyed rows collapse
  // onto a key already seen in THIS file: that is a per-gift file. The rows
  // are all scanned (not a sample) against the columns the mapping actually
  // sends as email/name.
  const aggregateCollapse = useMemo(() => {
    if (effectiveShape !== "aggregate" || !parsed) return null;
    const emailCol = Object.keys(mapping).find(h => mapping[h] === "email") || "";
    const nameCol = Object.keys(mapping).find(h => mapping[h] === "name") || "";
    if (!emailCol && !nameCol) return null;
    return assessAggregateCollapse(parsed.rows, emailCol, nameCol);
  }, [effectiveShape, parsed, mapping]);
  // SECURE-2 item 3: an address that is not one is imported as it is, never
  // refused; the preview counts them, and each profile says "Check this email".
  const emailsToCheck = useMemo(() => {
    if (!parsed) return null;
    const emailCol = Object.keys(mapping).find(h => mapping[h] === "email") || "";
    if (!emailCol) return null;
    const bad = (parsed.rows || []).map(r => String(r[emailCol] || "").trim()).filter(v => v && (emailProblem(v) || emailHint(v)));
    return bad.length ? { n: bad.length, example: bad[0], hint: emailHint(bad[0]) } : null;
  }, [parsed, mapping]);
  const shapeBlocked = effectiveShape === "unknown" || (aggregateCollapse && aggregateCollapse.refuse);
  // BUILD-79 Part 5 — when most headers are unrecognised, one-click Auto-map
  // is demoted to an explicit contents-based guess with a warning.
  const headersUnrecognized = useMemo(() => {
    if (!parsed) return false;
    const hs = parsed.headers.filter(h => h && !/^_\d+$/.test(h));
    if (!hs.length) return true;
    const memberCols = new Set(Object.values(membershipColumns(hs)));   // BUILD-101 Part 6
    const recognized = hs.filter(h => guessField(h) || memberCols.has(h)).length;
    return recognized / parsed.headers.length < 0.5;
  }, [parsed]);

  // Multi-sheet workbook: detect a "Donors + Gift History" pair so we can offer
  // "Import both" above the per-sheet options. Runs detectImportShape per sheet.
  const workbookRoles = useMemo(
    () => (xlsxSheets && xlsxSheets.length >= 2 ? detectWorkbookRoles(xlsxSheets) : null),
    [xlsxSheets]
  );

  // Enter "Import both": pick the default link column (email → name → donor-id).
  const startImportBoth = () => {
    if (!workbookRoles?.isBoth) return;
    const matchInfo = pickMatchKey(workbookRoles.donorSheet, workbookRoles.giftSheet);
    setMatchKey(matchInfo.key);
    setBothMode({ donorSheet: workbookRoles.donorSheet, giftSheet: workbookRoles.giftSheet, matchInfo });
    setErr("");
  };

  const applyParsed = (headers, rows, physical, report) => {
    // BUILD-79 Part 3.1 — the independent dollar scan happens ONCE, at parse
    // entry, before any mapping exists to bias it.
    const amountScan = scanAmountShapedColumns(headers, rows);
    setParseReport(report ? { ...report, amountScan } : { amountScan });
    const det = detectImportShape(headers, rows);
    setShape(det.shape); setShapeOverride(null); setShapeDetail(det);
    // Donor-field mapping is over the non-year columns (year columns are gifts,
    // configured separately) so a wide file's donor grid stays clean.
    // ── BUILD-97 Part 1 — A RECOGNISED EXPORT'S PRESET OUTRANKS THE GUESS ───
    // `buildAutoMapping` reads one header at a time and knows nothing about
    // which system wrote the file. The NPSP preset knows both, so where it has
    // an answer it wins: `Account Name` is `organization` on a contact sheet
    // and `orgName` on a gift sheet, `Primary Campaign Source` is the FUND
    // (which no generic guess would reach), and `Stage` is a column the
    // generic mapper has no target for at all — unmapped, it would let a
    // Closed Lost row import as cash.
    //
    // Every header the preset does NOT name keeps whatever the generic guess
    // made of it, and the person can still change any of it: this is a
    // pre-filled answer, not a locked one.
    const npspAuto = detectNpsp(headers);
    const autoDonor = buildAutoMapping(headers.filter(h => !YEAR_HDR_PAT.test(String(h))), rows);
    // BUILD-101 Part 6 — a membership file's level and dates are MAPPED, not
    // left for a custom-field decision.
    for (const [field, header] of Object.entries(membershipColumns(headers))) autoDonor[header] = field;
    const autoTx = autoDetectTxMapping(headers, rows);
    if (npspAuto.isNpsp) {
      const pre = npspMapping(headers, { object: npspAuto.object });
      if (npspAuto.object === NPSP_OBJECT_OPPORTUNITY) {
        // txMap is field -> header (the inverse of the donor mapping's shape).
        const inv = {};
        for (const [header, field] of Object.entries(pre.mapping)) inv[field] = header;
        setMapping(autoDonor);
        setTxMap({ ...autoTx, ...inv });
      } else {
        setMapping({ ...autoDonor, ...pre.mapping });
        setTxMap(autoTx);
      }
    } else {
      // BUILD-98 (switch) Part 7 — another CRM's gift export. Same rule as
      // NPSP: the preset's answers win where it has one, the generic guess
      // keeps the rest, and the person can change any of it.
      const mig = detectMigrationPreset(headers);
      const migMap = mig && mig.key ? migrationMapping(headers, mig.key) : null;
      setMapping(autoDonor);
      setTxMap(migMap ? { ...autoTx, ...migMap.txMap } : autoTx);

      // ── TRANS-1 Part 1 — A CLAIMED VENDOR EXPORT IS A GIFT FILE ──────────
      // The walk found this one, and it cost the whole file's money. A real
      // DonorPerfect gift export (donor_id, gift_id, gift_date, amount, …)
      // was read by the generic shape detector as "one row per donor
      // (totals)" -- its reason, in full, was "no per-gift date column",
      // about a file whose fifth column is `gift_date`. The preset knew
      // better and had already mapped date and amount, but the SHAPE decides
      // which mapper is rendered, so the transaction mapping was built and
      // never shown: every gift column sat on "Don't import this column" and
      // the screen said "No giving data in this file". Eight donors, no
      // money, no warning.
      //
      // A preset only claims a file when TWO of that vendor's own signal
      // columns are present (the BUILD-98 rule), so it is stronger evidence
      // than a heuristic over header spellings. Where it has named both a
      // date and an amount, the file is a gift ledger and the shape follows
      // the preset. The override select is untouched, so a person who
      // disagrees still changes it in one click.
      if (migMap && migMap.txMap && migMap.txMap.date && migMap.txMap.amount && det.shape !== "transaction") {
        setShape("transaction");
        setShapeDetail({
          ...det, shape: "transaction", presetOverride: true,
          reason: `${mig.label}'s own export columns, one row per gift`,
        });
      }
    }
    const cfg = autoDetectWideConfig(headers, rows);
    setYearCols(cfg.yearCols.map(col => ({ col, date: yearColToDate(col, "dec31"), enabled: true })));
    setParsed({ headers, rows });
    // LIVE-1 · A FILE WITH COLUMNS SHE HAS MAPPED BEFORE MAPS ITSELF. Her saved
    // answers win over the guess for every column the saved file had; only
    // the new columns are left for her.
    setShapeMemory(null);
    apiFetch("/import-shapes/match", { method: "POST", body: JSON.stringify({ headers }) }).then(m => {
      if (!m || !m.matched) return;
      const d = {}, t = {};
      for (const [h, code] of Object.entries(m.mapping || {})) for (const part of String(code).split("|")) {
        if (part.startsWith("d:")) d[h] = part.slice(2); else if (part.startsWith("t:")) t[part.slice(2)] = h;
      }
      if (Object.keys(d).length) setMapping(prev => ({ ...prev, ...d }));
      if (Object.keys(t).length) setTxMap(prev => ({ ...prev, ...t }));
      setShapeMemory({ newHeaders: m.newHeaders || [], why: m.why || "" });
    }).catch(() => {});
    // BUILD-78 Part 3.1 — left side of the column equation, from parse entry.
    setPhysicalCols(physical || { headerCells: headers, headerCount: headers.length, orphanColumns: 0, overflowRows: 0, total: headers.length });
    setCfDecisions({});
    setXlsxSheets(null);
    setErr("");
  };

  // ── File handler ──
  const handleFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setErr("");
    await parseFileToSheets(file, { onSingle:applyParsed, onMulti:s=>setXlsxSheets(s), onWorkbook:w=>{ setWorkbook(w); setParsed(null); setXlsxSheets(null); }, onError:msg=>setErr(msg), onAdaptive:f=>setAdaptiveFile(f) });
  };

  // ── Paste flow ──
  const doParse = () => {
    if (!csvText.trim()) return;
    try {
      const analysis = analyzeCsvText(csvText);
      if (!analysis.rows.length) { setErr("No rows found. Check CSV format."); return; }
      applyParsed(analysis.headers, analysis.rows, analysis.physical, { ...reportFromAnalysis(analysis), cp1252Lines: [] });
    } catch (ex) { setErr(isProgrammerError(ex) ? errorMessage(ex) : "Parse error: " + ex.message); }
  };

  // ── AI column mapping (aggregate/wide donor fields only) ──
  const doAiMap = async () => {
    if (!parsed) return;
    setAiLoading(true);
    try {
      const sample = parsed.rows[0] || {};
      const res = await apiFetch("/ai/column-map", { method:"POST", body:JSON.stringify({ headers:parsed.headers, sample }) });
      if (res.mapping) {
        // FIX (2026-09-09) item 3 — a CONTENTS-based guess is low confidence by
        // construction: it is reading values, not a header anyone wrote. So it
        // may only FILL a target nothing else claims — it never overwrites a
        // mapping already made, and never duplicates a target another column
        // took. Anything it cannot place safely defaults to skip, which is the
        // honest outcome for a guess nobody can check.
        const merged = { ...mapping };
        const taken = new Set(Object.values(merged).filter(Boolean));
        const dropped = [];
        Object.entries(res.mapping).forEach(([h, f]) => {
          if (!f || !VALID_IMPORT_KEYS.has(f)) return;
          if (merged[h]) return;                                   // a human/auto choice stands
          if (taken.has(f)) { dropped.push([h, f]); return; }      // never two columns → one field
          // BUILD-79 Part 5 — the model's guesses pass the same type checks a
          // human's choices do. Spouse→lastName and phone→email died here.
          if (!validateMappingChoice(parsed.headers, parsed.rows, h, f).ok) { dropped.push([h, f]); return; }
          merged[h] = f;
          taken.add(f);
        });
        setMapping(merged);
        if (dropped.length) {
          setMapRefusal({ header: dropped[0][0], field: dropped[0][1],
            summary: `a contents guess can't take a field another column already has, ${dropped.length} guess${dropped.length === 1 ? "" : "es"} left for you to place` });
        }
      }
    } catch { /* keep existing mapping on AI failure */ }
    setAiLoading(false);
  };

  const onConventionChange = (val) => {
    setYearConvention(val);
    setYearCols(cols => cols.map(yc => ({ ...yc, date: yearColToDate(yc.col, val) })));
  };

  // ── BUILD-78 — the mapper plan: one entry per PHYSICAL column ──
  const mapperPlan = useMemo(() => {
    if (!parsed || effectiveShape !== "transaction" || !physicalCols) return null;
    try {
      return buildMapperPlan({
        headers: physicalCols.headerCells, fields: parsed.headers, rows: parsed.rows, txMap,
        existingDefs: cfDefs, savedMappings: savedCfMappings,
        orphanColumns: physicalCols.orphanColumns, overflowRows: physicalCols.overflowRows,
      });
    } catch (e) {
      // Worse than the payload case: a null plan takes `cfUndecided` to 0, so a
      // swallowed bug here would let an import run with columns nobody decided.
      rethrowProgrammerError(e);
      console.error("[import] mapper plan failed:", e); return null;
    }
  }, [parsed, effectiveShape, physicalCols, txMap, cfDefs, savedCfMappings]);

  // The columns that flow into the accounted builder, from plan + decisions.
  // Preview keys for not-yet-created fields are provisional; doImport swaps in
  // the real ones after the explicit accepts create the fields.
  const cfBuildInputs = useMemo(() => {
    if (!mapperPlan) return { flagColumns: {}, cfColumns: [], exclusionColumns: [], undecided: 0, ledger: null };
    const flagColumns = {}, cfColumns = [], exclusionColumns = [];
    let undecided = 0;
    for (const c of mapperPlan.columns) {
      const d = cfDecisions[c.index] || {};
      const action = d.action || (c.status === "flag" ? "flag" : c.status === "custom-existing" ? "existing" : null);
      // BUILD-80 Part 4 — a VALUE-routed exclusion column (Solicit Code /
      // Status): each cell parses through the family, several flags per
      // column. Never storable as a custom field.
      if (c.status === "flag" && action === "flag" && c.flag === "exclusion") { exclusionColumns.push(c.field); continue; }
      // BUILD-80 Part 8 — Frequency maps to the recurring surface; the
      // builder reads the column itself (a cadence claim the pattern can
      // override), so nothing to collect here.
      if (c.status === "flag" && c.flag === "frequency") continue;
      if (c.status === "flag" && action === "flag") { flagColumns[c.flag] = c.field; continue; }
      if (action === "existing" && (c.def || d.fieldId)) {
        const def = c.def || [...cfDefs.donor, ...cfDefs.gift].find(x => x.id === d.fieldId);
        if (def) cfColumns.push({ field: c.field, entity: def.entity, key: def.key, def, delimiter: d.delimiter });
        continue;
      }
      if (action === "accept") {
        const type = d.type || c.proposal.type;
        const label = d.label || c.proposal.label;
        const entity = d.entity || c.entity;
        const options = d.options || c.proposal.options || [];
        cfColumns.push({ field: c.field, entity, key: generateFieldKey(label), provisional: { label, type, options }, def: { type, options }, delimiter: d.delimiter });
        continue;
      }
      if (c.status === "custom-proposed" && !d.action) undecided++;
    }
    const ledger = buildColumnLedger(mapperPlan, cfDecisions);
    return { flagColumns, cfColumns, exclusionColumns, undecided, ledger };
  }, [mapperPlan, cfDecisions, cfDefs]);

  // BUILD-80 Part 2.2 — the date column's convention, inferred at the column
  // level (impossible-month evidence). Shown on the mapper; a MIXED column
  // blocks the import until a human chooses, with examples of both readings.
  const dateConvEvidence = useMemo(() => {
    if (!parsed || effectiveShape !== "transaction" || !txMap.date) return null;
    // A null here removes the mixed-date-convention block, so a swallowed bug
    // would let an ambiguous date column import unasked.
    try { return inferDateConvention(parsed.rows.map(r => r[txMap.date])); }
    catch (e) { rethrowProgrammerError(e); return null; }
  }, [parsed, effectiveShape, txMap.date]);

  // BUILD-84 P0-3 — the basis this import actually has, declared once and read
  // by both the preview split and the sentence under it.
  const stageBasis = useMemo(() => stageAssignmentBasis(
    effectiveShape === "transaction" ? { amount: txMap.amount, date: txMap.date }
    : effectiveShape === "wide" ? { yearColumns: yearCols.some(y => y.enabled) }
    : { total: Object.values(mapping).includes("total"),
        lastAmount: Object.values(mapping).includes("lastAmount"),
        lastGift: Object.values(mapping).includes("lastGift") }
  ), [effectiveShape, mapping, txMap.amount, txMap.date, yearCols]);

  // ── BUILD-94 Part 2 — the Mailchimp audience preset ──────────────────────
  // NOT a second importer (the BUILD-89S 89d rule): a preset is a pre-filled
  // answer to the questions this mapper already asks. Two questions are left
  // for the person, because neither can be read off the file with certainty:
  //   • IS THIS THE UNSUBSCRIBED FILE? Mailchimp exports one CSV per status,
  //     so the unsubscribed half arrives as a SECOND file with identical
  //     headers. Import only the first and every unsubscribe Mailchimp was
  //     honouring is silently lost. The file NAME preselects the answer.
  //   • DO THE TAGS SAY WHAT SOMEONE IS? "Board Game Night 2024" contains the
  //     word board and is not a board member, so tag→type is OFFERED, never
  //     applied silently (the BUILD-78 ask gate).
  const mcDetect = useMemo(
    () => (parsed?.headers ? detectMailchimpAudience(parsed.headers) : { isMailchimp:false, hasTags:false }),
    [parsed]);
  const mcTagsHeader = useMemo(
    () => (parsed?.headers || []).find(h => String(h).trim().toLowerCase() === "tags") || null,
    [parsed]);
  const mcStatusHeader = useMemo(
    () => (parsed?.headers || []).find(h => /^(member )?status$/i.test(String(h).trim())) || null,
    [parsed]);
  // ── BUILD-97 Part 1 — SALESFORCE NPSP ─────────────────────────────────────
  // The same shape as the Mailchimp preset above, and for the same reason: a
  // migration off the Nonprofit Success Pack is two exports Steward already
  // knows how to read, so this is a PRE-FILLED ANSWER to the questions this
  // mapper already asks — never a second importer.
  //
  // The one question left for the person is the one that cannot be read off a
  // file: a stage this organisation invented. Everything else — which column
  // is the close date, which is the amount, whether `Account Name` is an
  // organisation or somebody's household — is decided by the preset and shown.
  const npsp = useMemo(
    () => (parsed?.headers ? npspMapping(parsed.headers) : null),
    [parsed]);
  const npspIs = !!(npsp && npsp.detected && npsp.detected.isNpsp);
  // BUILD-98 (switch) Part 7 — the other CRMs' gift exports.
  const migDetected = useMemo(
    () => (parsed?.headers && !npspIs ? detectMigrationPreset(parsed.headers) : null),
    [parsed, npspIs]);
  const mig = migDetected && migDetected.key ? migrationMapping(parsed.headers, migDetected.key) : null;

  // ── FIX-10 E · THE TILE IS THE ACCEPT, FOR WHAT THE PRESET COVERS ────────
  //
  // Picking "DonorPerfect" on the move-in screen IS a decision about
  // DonorPerfect's own columns. The preset already names every one it sets
  // aside and why (`noTarget` in shared/migrationPresets.js), and the mapper
  // was then asking her to decide each of them again from scratch: `donor_id`
  // arrived as an un-homed column with a proposal card and a type dropdown, on
  // a file where the preset's whole point is that it knows what donor_id is.
  //
  // So the preset's set-aside columns come in DECIDED, marked as having come
  // from the tile, with one click to change. Every OTHER column is untouched:
  // the "no field without an explicit accept" rule is unchanged, and the tile
  // is the accept only for what the preset actually covers.
  const presetKey = (moveSource && MIGRATION_PRESETS[moveSource]) ? moveSource
                  : (migDetected && migDetected.key) || null;
  const presetSetAside = useMemo(() => {
    const pk = presetKey;
    if (!pk || !parsed?.headers) return null;
    const m = migrationMapping(parsed.headers, pk);
    if (!m || !m.ignored.length) return null;
    const byHeader = {};
    for (const ig of m.ignored) byHeader[normalizeHeader(ig.header)] = ig.reason;
    return { label: m.label, byHeader };
  }, [presetKey, parsed]);

  useEffect(() => {
    if (!presetSetAside || !mapperPlan) return;
    const pending = {};
    for (const c of mapperPlan.columns) {
      if (c.status !== "custom-proposed") continue;
      const reason = presetSetAside.byHeader[normalizeHeader(c.header)];
      if (!reason) continue;
      if (cfDecisions[c.index]) continue;            // her own decision always wins
      pending[c.index] = { action: "discard", viaPreset: presetSetAside.label, presetReason: reason };
    }
    if (Object.keys(pending).length) setCfDecisions(p => ({ ...pending, ...p }));
  }, [presetSetAside, mapperPlan]);
  const [mcFileStatus, setMcFileStatus] = useState(null);
  const [mcApplyTagTypes, setMcApplyTagTypes] = useState(false);
  useEffect(() => {
    if (!mcDetect.isMailchimp) { setMcFileStatus(null); setMcApplyTagTypes(false); return; }
    setMcFileStatus(fileStatusFromName(srcFile?.name) || "subscribed");
  }, [mcDetect.isMailchimp, srcFile]);
  const mcPeople = useMemo(() => mcDetect.isMailchimp ? {
    fileStatus: mcFileStatus, statusHeader: mcStatusHeader, tagsHeader: mcTagsHeader,
    applyTagTypes: mcApplyTagTypes,
    // A Mailchimp contact is NOT a donor. Calling one a donor is how a giving
    // total goes wrong; "Other" is the honest answer until a gift says otherwise.
    defaultType: "other",
  } : null, [mcDetect.isMailchimp, mcFileStatus, mcStatusHeader, mcTagsHeader, mcApplyTagTypes]);

  // ── Shape-aware payload build (memoized) ──
  // aggregate → donors (+ one seeded gift/donor from total+lastGift when
  // withHistory, so onboarding gets real gifts rows); transaction → group the
  // gift ledger into donors + a gift per row; wide → donors + a gift per year.
  const payload = useMemo(() => {
    if (!parsed) return { donors:[], gifts:[], warnedCount:0, skippedCount:0 };
    try {
      if (effectiveShape === "transaction") return buildTransactionPayload(parsed, txMap, cfBuildInputs, parseReport?.rowLines, dateConventionChoice, orgToday);
      if (effectiveShape === "wide")        return buildWidePayload(parsed, mapping, yearCols, parseReport?.rowLines);
      return buildAggregatePayload(parsed, mapping, withHistory, parseReport?.rowLines, stageBasis, mcPeople);
    } catch (e) {
      // FIX (2026-09-10) — a bug is RE-THROWN, never rendered as a sentence
      // about the user's file. Returning an empty payload here is how a
      // ReferenceError became "No rows ready — map at least one column to name
      // or email". See client/src/lib/domainError.js.
      rethrowProgrammerError(e);
      console.error("[import] payload build failed:", e);
      return { donors:[], gifts:[], warnedCount:0, skippedCount:0, error:e.message };
    }
  }, [parsed, effectiveShape, mapping, txMap, yearCols, withHistory, cfBuildInputs, parseReport, dateConventionChoice, orgToday, mcPeople]);
  // LIVE-1 · BEFORE ANYONE SAVES: how many thank-you drafts this file makes
  // (one per gift from the last 30 days). The server holds the rule.
  const giftDatesKey = (payload?.gifts || []).map(g => g.date || "").join(",");
  useEffect(() => {
    const dates = (payload?.gifts || []).map(g => g.date).filter(Boolean);
    if (!dates.length) { setTyPreview(null); return; }
    let live = true;
    apiFetch("/imports/thank-you-preview", { method: "POST", body: JSON.stringify({ dates, headers: parsed?.headers || [] }) })
      .then(r => { if (live) setTyPreview(r); }).catch(() => {});
    return () => { live = false; };
  }, [giftDatesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // The value answers she gave before, and the values in THIS file's payment
  // method and fund columns that are not the same word as a standard one.
  useEffect(() => { apiFetch("/import-values").then(r => setSavedValues(r?.values || [])).catch(() => {}); }, []);
  const valueQuestions = useMemo(() => {
    if (!parsed || effectiveShape !== "transaction") return [];
    const out = [];
    for (const field of ["paymentMethod", "fund"]) {
      const col = txMap[field];
      if (!col) continue;
      const seen = new Map();
      for (const r of parsed.rows) { const v = String(r[col] ?? "").trim(); if (v) seen.set(v, (seen.get(v) || 0) + 1); }
      const vals = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
      for (const [raw, n] of vals) {
        const norm = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        // A payment method already spelled as a standard one ("Cash", "credit
        // card") needs no answer; an abbreviation ("CC", "CHK") does.
        if (field === "paymentMethod" && STANDARD_METHODS.has(norm)) continue;
        const saved = savedValues.find(v => v.field === field && v.raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === norm);
        out.push({ field, raw, n, saved: saved ? saved.value : "" });
      }
    }
    return out;
  }, [parsed, effectiveShape, txMap, savedValues]);

  // Stage-count preview from the built payload (aggregate donors carry a client
  // stage; transaction/wide donors are re-staged server-side from their gifts,
  // so preview those from the grouped gift totals).
  const stagePreview = useMemo(() => {
    const counts = {};
    if (effectiveShape === "aggregate") {
      payload.donors.forEach(d => { const s = d.stage || "prospect"; counts[s] = (counts[s]||0)+1; });
    } else {
      const giftsByDonor = {};
      payload.gifts.forEach(g => { (giftsByDonor[g.donorIndex] ||= []).push(g); });
      payload.donors.forEach((d, idx) => {
        const gg = giftsByDonor[idx] || [];
        const total = gg.reduce((s,g)=>s+g.amount,0);
        const last = gg.length ? gg.reduce((m,g)=>g.date>m?g.date:m, gg[0].date) : null;
        // BUILD-84 P0-3 — with no giving input mapped there is nothing to
        // infer from; one stage, never a fabricated distribution.
        const s = !stageBasis.hasGivingData ? stageBasis.fallbackStage
                : last ? inferStage(total, last, !!(d.email||d.phone))
                : inferStage(0, null, !!(d.email||d.phone));
        counts[s] = (counts[s]||0)+1;
      });
    }
    return counts;
  }, [payload, effectiveShape, stageBasis]);

  // BUILD-78 — the plan supersedes BUILD-77's bulk acknowledgement: every
  // unmapped column now takes an explicit per-column decision (store as
  // custom / map to core / discard), and the import is gated on zero
  // undecided columns rather than one checkbox.
  const cfUndecided = cfBuildInputs.undecided;

  // ── Submit import (chunked, with progress — the hang fix) ──
  const doImport = async () => {
    // BUILD-79 Part 2 — shape is a decision with evidence, or a question.
    if (effectiveShape === "unknown") { setErr("Choose how this file is shaped before importing, we couldn't tell from the columns."); return; }
    // FIX (2026-09-09) item 2 — two columns mapped to one field is a refusal by
    // name, never a silent last-one-wins. (Auto-mapping put contact_name AND
    // contact_confidence on `name` and nothing objected.)
    if (duplicateDonorTargets.length) {
      const d = duplicateDonorTargets[0];
      const label = (CSV_STANDARD_FIELDS.find(f => f.key === d.field) || {}).label || plainFieldLabel(d.field);
      setErr(`Two columns are mapped to ${label.toLowerCase()} “${d.headers.join("” and “")}”. Pick one, or send the other somewhere else.`);
      return;
    }
    if (aggregateCollapse?.refuse) { setErr(`${aggregateCollapse.collapsed.toLocaleString()} of ${aggregateCollapse.keyedRows.toLocaleString()} rows collapse onto the same donors, this file is one row per gift. Switch the shape to individual gifts.`); return; }
    // BUILD-80 Part 2.2 — a MIXED date column is a question, never a guess.
    if (dateConvEvidence?.convention === "mixed" && !dateConventionChoice) {
      setErr("This file's date column mixes day-first and month-first dates, choose which convention to apply (above the mapping) before importing.");
      return;
    }
    let activePayload = payload;
    let importExtras = null;
    setLoading(true); setErr("");
    try {
      if (effectiveShape === "transaction" && mapperPlan) {
        // BUILD-78 4.3/4.5 — the ONLY point where accepted proposals become
        // fields: an explicit accept, a POST per field with the import as its
        // source, and the real keys swapped into the build. Existing fields
        // are resolved, never re-created — prevention, not cleanup.
        const ledger = buildColumnLedger(mapperPlan, cfDecisions);
        const colSummary = summarizeColumnLedger(physicalCols.total, ledger);
        if (!colSummary.balanced) { setErr("Some columns still need a decision before the import can run."); setLoading(false); return; }
        const finalCfColumns = [];
        const fieldMappings = [];
        for (const entry of ledger) {
          const col = mapperPlan.columns.find(c => c.index === entry.index);
          if (entry.disposition === "custom-existing") {
            const def = col.def || [...cfDefs.donor, ...cfDefs.gift].find(x => x.id === entry.fieldId);
            finalCfColumns.push({ field: col.field, entity: def.entity, key: def.key, def, delimiter: entry.delimiter });
            fieldMappings.push({ entity: def.entity, header: String(entry.header).trim(), fieldId: def.id });
          } else if (entry.disposition === "custom-new") {
            const created = await apiFetch("/custom-fields", { method: "POST", body: JSON.stringify({
              entity: entry.entity, label: entry.label, type: entry.type,
              options: (entry.type === "select" || entry.type === "multi_select") ? entry.options : [],
              source: `import of ${srcFile?.name || "pasted data"}`,
            })});
            finalCfColumns.push({ field: col.field, entity: created.entity, key: created.key, def: created, delimiter: entry.delimiter });
            fieldMappings.push({ entity: created.entity, header: String(entry.header).trim(), fieldId: created.id });
          }
        }
        activePayload = buildTransactionPayload(parsed, txMap, { flagColumns: cfBuildInputs.flagColumns, cfColumns: finalCfColumns, exclusionColumns: cfBuildInputs.exclusionColumns }, parseReport?.rowLines, dateConventionChoice);
        importExtras = {
          columns: { inFile: physicalCols.total, ledger: ledger.map(({ index, header, disposition, flag, role, fieldId, entity, reason }) => ({ index, header, disposition, flag, role, fieldId, entity, reason })) },
          fieldMappings,
          customFieldDelimiters: Object.fromEntries(finalCfColumns.filter(c => c.delimiter).map(c => [c.key, c.delimiter])),
          columnLedgerFull: ledger,
          // BUILD-88a A.7 — this path runs the FULL BUILD-80 Part 6 identity
          // pass (id → email-with-a-compatible-name → name) before it submits,
          // exactly as the workbook path does. Without this flag the server's
          // blunt within-file email fold undid it and put "Mr. and Mrs. Gerald
          // Kane" and "Marilyn Kane" back on one record — a household of two
          // arriving as one merged person.
          identityResolved: true,
          // BUILD-99 (major gifts) Part 6 — THE OPEN ASKS ON THE SAME ROWS. Read
          // as a second pass over the same rows rather than a branch inside the
          // gift builder: a file can legitimately carry a gift last year and an
          // open ask this year for the same person, and folding the two into one
          // pass would make one of them win.
          //
          // THE CLIENT SENDS A NAME, NOT AN INDEX, AND THAT IS A DECISION. The
          // gift builder's row→donor resolution is internal to it (BUILD-80's
          // identity pass runs inside `buildTransactionRows` and its key→index
          // map does not leave), so threading an index out would mean widening
          // that builder's contract for this one caller. A name resolves
          // server-side to the oldest matching record — the SAME rule
          // `importGiftExtras` already uses for an imported soft credit
          // (BUILD-98 Part 1), so this carries a decision that was already made
          // and reviewed rather than inventing a second one. The index path stays
          // available to the API (tests/build99-import.test.js drives it) for a
          // caller that genuinely has one.
          proposals: txMap.proposalAmount
            ? buildProposalRows(parsed, txMap, { dateConvention: dateConventionChoice || undefined }).proposals
            : [],
        };
      }
    } catch (e) {
      rethrowProgrammerError(e);
      console.error("IMPORT FIELD SETUP FAILED:", e);
      setErr(errorMessage(e, "Could not create the custom fields. Nothing was imported."));
      setLoading(false); return;
    }
    // FIX (2026-09-09) — a CSV donor column mapped to a custom field carries its
    // raw value on the row; the server validates it through the ONE seam
    // (BUILD-78) exactly as the workbook path does.
    if (Object.keys(donorCfChoices).length && activePayload && Array.isArray(activePayload.donors)) {
      const entries = Object.entries(donorCfChoices);
      activePayload = {
        ...activePayload,
        donors: activePayload.donors.map((d, i) => {
          const row = parsed.rows[d._rowIndex != null ? d._rowIndex - 2 : i];
          if (!row) return d;
          const cf = {};
          for (const [h, choice] of entries) {
            const v = String(row[h] ?? "").trim();
            if (v && choice.entity === "donor") cf[choice.key] = v;
          }
          return Object.keys(cf).length ? { ...d, customFields: { ...(d.customFields || {}), ...cf } } : d;
        }),
      };
    }
    const { donors: rawDonors, gifts, warnedCount, skippedCount, error } = activePayload;
    if (error) { setErr("Failed to prepare import data, " + error + ". Check the browser console."); setLoading(false); return; }
    if (!rawDonors.length) {
      setErr(skippedCount ? `All ${skippedCount} rows skipped, no usable name or email.` : "Nothing to import, map a name or email column.");
      setLoading(false); return;
    }
    // BUILD-101 Part 6 — memberships named on these rows, read from what the
    // person finally mapped (the preset's guess, or her correction).
    {
      const memCols = {}, colFor = f => Object.keys(mapping).find(h => mapping[h] === f) || null;
      for (const f of MEMBERSHIP_FIELDS) { const h = colFor(f); if (h) memCols[f] = h; }
      if (memCols.membershipLevel) {
        const mem = buildMembershipRows(parsed, memCols, { nameCol: colFor("name"), emailCol: colFor("email"),
          firstCol: colFor("_firstName"), lastCol: colFor("_lastName"), dayFirst: dateConventionChoice === "dmy" });
        if (mem.memberships.length || mem.setAside.length)
          importExtras = { ...(importExtras || {}), memberships: mem.memberships, membershipsSetAside: mem.setAside };
      }
    }
    const payloadForSummary = activePayload;
    const donors = assignPayloadDonors(rawDonors); // stamp assignedTo from the owner mapping (Team)
    setProgress({ done:0, total:donors.length });
    try {
      // TRANS-1 Part 3 — the run id is minted BEFORE the write, so this
      // file's gifts and people carry it and its Move Report can scope
      // itself to them. Every chunk sends the same id.
      const runId = newRunId();
      // LIVE-1 — the value answers she gave on this screen are saved FIRST,
      // so this file is read with them too, and every later file after it.
      const answers = Object.entries(valueAnswers).map(([k, value]) => { const i = k.indexOf("|"); return { field: k.slice(0, i), raw: k.slice(i + 1), value }; })
        .filter(a => a.value && a.value.trim() && a.value.trim() !== a.raw);
      if (answers.length) await apiFetch("/import-values", { method: "POST", body: JSON.stringify({ values: answers }) }).catch(() => {});
      const thanksAnswer = thanks || (tyPreview && tyPreview.defaultAnswer) || null;   // FIX-37
      const totals = await submitImportChunked(donors, gifts, (done,total) => setProgress({ done, total }), importExtras, runId,
        { thanks: thanksAnswer, headers: parsed?.headers || [], sourceName: srcFile?.name });
      // ── BUILD-77 Part 3a — the file-level equation, from PARSE ENTRY ──
      // "In your file" is the physical non-blank row count taken once when
      // the file was parsed, never the count of what survived the client's
      // own builders. The client's refused rows (unparseable amount/date,
      // future-dated, refunds are NOT refused) join the buckets with their
      // reasons, and balance is recomputed against the FILE. The old code
      // summed only the server's payload-scoped equation, which is how 74
      // rows and ~$154,806 of a real file hid behind "Balanced".
      if (payloadForSummary.file && payloadForSummary.dispositions) {
        const R = totals.reconciliation;
        R.rows.inFile = payloadForSummary.file.rows;
        R.dollars.inFile = payloadForSummary.file.dollars;
        const bump = (bucket, reason, rows, dollars) => {
          R.rows[bucket] += rows; R.dollars[bucket] += dollars;
          const box = bucket === "skipped" ? R.skippedReasons : R.erroredReasons;
          const e = box[reason] || (box[reason] = { rows: 0, dollars: 0 });
          e.rows += rows; e.dollars += dollars;
        };
        const byReason = {};
        for (const d of payloadForSummary.dispositions) {
          if (d.disposition === "gift") continue;   // sent to the server; its ledger owns them
          const key = d.disposition + "|" + (d.reason || "donor_info_only");
          const e = byReason[key] || (byReason[key] = { rows: 0, dollars: 0 });
          e.rows += 1; e.dollars += d.dollars || 0;
        }
        for (const [key, v] of Object.entries(byReason)) {
          const [disp, reason] = key.split("|");
          if (disp === "errored") bump("errored", reason, v.rows, v.dollars);
          else bump("skipped", reason, v.rows, v.dollars);   // skipped + donor_only both surface as skipped-with-reason
        }
        const accounted = R.rows.created + R.rows.skipped + R.rows.errored;
        R.rows.accounted = accounted;
        R.rows.balanced = accounted === R.rows.inFile;
        const dAccounted = R.dollars.created + R.dollars.skipped + R.dollars.errored;
        R.dollars.accounted = Math.round(dAccounted * 100) / 100;
        R.dollars.balanced = Math.abs(R.dollars.inFile - dAccounted) < 0.005;
        R.balanced = R.rows.balanced && R.dollars.balanced;
        totals.refusedRows = payloadForSummary.dispositions.filter(d => d.disposition === "skipped" || d.disposition === "errored");
        totals.flaggedRows = payloadForSummary.flaggedRows || [];
        // BUILD-80 Part 1 — the largest-gifts panel + the convention lines
        // ride the same accounted builder output.
        totals.largestGifts = payloadForSummary.largestGifts || [];
        totals.amountConventions = payloadForSummary.amountConventions || null;
        totals.dateConvention = payloadForSummary.dateConvention || null;
        totals.exclusionConflicts = payloadForSummary.exclusionConflicts || [];
        totals.frequencyConflicts = payloadForSummary.frequencyConflicts || [];
        totals.semantics = payloadForSummary.semantics || null;
        totals.identity = payloadForSummary.identity || null;
        // BUILD-80 Part 5/7 — the semantic rows land in ONE follow-up call:
        // pledges to the pledges table, in-kind as FMV records, soft credits
        // and matching/DAF attributions as relationship links.
        if (payloadForSummary.semantics && (payloadForSummary.semantics.pledges.length || payloadForSummary.semantics.inKind.length || payloadForSummary.semantics.links.length || payloadForSummary.semantics.reviewTwins.length)) {
          try {
            const semRes = await apiFetch("/donors/import-semantics", { method: "POST", body: JSON.stringify({
              importId: runId,   // FIX-60: Undo import takes these pledges with the gifts
              pledges: payloadForSummary.semantics.pledges.map(p => ({ ...p, dueDate: p.dueDate })),
              inKind: payloadForSummary.semantics.inKind,
              links: payloadForSummary.semantics.links,
              reviewTwins: payloadForSummary.semantics.reviewTwins,
              merges: payloadForSummary.identity?.mergeReview || [],
              // BUILD-80 Part 9 — the import's health rides with it, so every
              // headline stat can carry the caveat while refusals are high.
              fileStats: {
                rows: payloadForSummary.file?.rows || 0,
                refused: (payloadForSummary.dispositions || []).filter(d2 => d2.disposition === "errored" || (d2.disposition === "skipped" && ["no_amount", "zero_amount"].includes(d2.reason))).length,
                refusedDollars: (payloadForSummary.dispositions || []).filter(d2 => d2.disposition === "errored").reduce((s2, d2) => s2 + (d2.dollars || 0), 0),
                largestGifts: payloadForSummary.largestGifts || [],
              },
            }) });
            totals.semanticsApplied = semRes?.counts || null;
            totals.mergeRows = semRes?.merges || [];
          } catch (e) {
            console.error("[import] semantics call failed:", e);
            totals.semanticsError = errorMessage(e, "the pledge/in-kind/link rows could not be recorded");
          }
        }
      }
      // ── BUILD-79 Part 3 — the file-level equation exists on EVERY path.
      // The aggregate/wide paths used to show only the server's payload-scoped
      // ledger: both sides derived from what the client chose to send, so a
      // 2,500-record report import could read "Balanced · 2,438 · $0". Rows
      // come from parse entry; DOLLARS come from the independent raw-file scan
      // (Part 3.1) — never from the mapping.
      else if (parseReport?.records) {
        const R = totals.reconciliation;
        R.rows.inFile = parseReport.records;
        const bump = (bucket, reason, rows, dollars) => {
          R.rows[bucket] += rows; R.dollars[bucket] += dollars;
          const box = bucket === "skipped" ? R.skippedReasons : R.erroredReasons;
          const e = box[reason] || (box[reason] = { rows: 0, dollars: 0 });
          e.rows += rows; e.dollars += dollars;
        };
        for (const k of (payloadForSummary.skippedRows || [])) bump("skipped", k.reason || "skipped_before_submit", 1, 0);
        if (payloadForSummary.warnedRows) {
          totals.warnedRows = payloadForSummary.warnedRows.map(w => ({
            line: parseReport.rowLines?.[w.idx] ?? (w.idx + 2), reasons: w.reasons,
            raw: parsed?.rows?.[w.idx] || {},
          }));
        }
        // server buckets (created + its skipped/errored reasons, incl. the
        // duplicate split) were already merged per chunk; the client-side
        // pre-submit skips just joined them above. One partition, one sum.
        R.rows.accounted = R.rows.created + R.rows.skipped + R.rows.errored;
        R.rows.balanced = R.rows.accounted === R.rows.inFile;
        // BUILD-84 P0-1 — the file's dollars are ONE column's own subtotal or
        // they are unknown. The scan now returns every column that qualifies
        // as currency; a figure may only anchor the equation when there is no
        // ambiguity about which column it came from:
        //   · the import mapped an amount column → that column's subtotal,
        //   · exactly one column in the file qualifies → that one,
        //   · otherwise → null, and the panel names each candidate instead of
        //     adding several unrelated money columns into one number nobody
        //     can check. (Two money columns summed is not a reconcilable
        //     figure; picking the biggest is picking the best of a bad set.)
        const scan = parseReport.amountScan;
        const mappedAmountHdr = Object.keys(mapping).find(h => mapping[h] === "total" || mapping[h] === "lastAmount") || null;
        const anchor = scan && (
          (mappedAmountHdr && scan.columns.find(c => c.header === mappedAmountHdr))
          || (scan.unambiguous ? scan.columns[0] : null));
        R.dollars.inFile = anchor ? anchor.sum : null;
        R.dollars.accounted = Math.round((R.dollars.created + R.dollars.skipped + R.dollars.errored) * 100) / 100;
        R.dollars.balanced = R.dollars.inFile == null ? false : Math.abs(R.dollars.inFile - R.dollars.accounted) < 0.005;
        R.dollars.scanColumn = anchor ? anchor.header : null;
        R.dollars.currencyColumns = scan ? scan.columns.map(c => ({ header: c.header, sum: c.sum, why: c.why })) : [];
        R.balanced = R.rows.balanced && R.dollars.balanced;
      }
      // BUILD-79 Part 3.3 — GREEN IS EARNED. The check mark and "every row and
      // every dollar accounted for" require: an amount column mapped, a date
      // column mapped, non-zero imported dollars, and both axes balanced.
      // Anything less is amber, and the panel says what is missing.
      {
        const R = totals.reconciliation;
        const amountMapped = effectiveShape === "transaction" ? !!txMap.amount
          : effectiveShape === "wide" ? yearCols.some(y => y.enabled)
          : Object.values(mapping).some(f => f === "total" || f === "lastAmount");
        const dateMapped = effectiveShape === "transaction" ? !!txMap.date
          : effectiveShape === "wide" ? true /* year columns carry their own dates */
          : Object.values(mapping).some(f => f === "lastGift");
        const dollarsIn = Number(R.dollars.created || 0);
        const missing = [];
        // BUILD-84 P0-1 — every currency column is named with its own subtotal,
        // and a column that was never mapped as a gift amount is never
        // described as money that went missing.
        const cur = R.dollars.currencyColumns || [];
        const money$ = n => "$" + Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
        // FIX (2026-09-10) — a DISPLAY cap, not a logic one. Every qualifying
        // column is still scanned, still counted, and still carried on
        // `reconciliation.dollars.currencyColumns` for anything that reads the
        // receipt. But five subtotals headed by a $386,923,121 figure reads as
        // confusion on a receipt even when every number in it is correct, so
        // the sentence names the LARGEST THREE and puts the rest behind a
        // count. The count is what keeps it honest: "and 2 more" is a fact the
        // reader can act on, an elided list is not.
        const CURRENCY_COLS_SHOWN = 3;
        const curRanked = [...cur].sort((a, b) => b.sum - a.sum);
        const curShown = curRanked.slice(0, CURRENCY_COLS_SHOWN);
        const curRest = curRanked.length - curShown.length;
        const curList = curShown.map(c => `“${c.header}” ${money$(c.sum)}`).join(" · ")
          + (curRest > 0 ? ` · and ${curRest} more` : "");
        if (!amountMapped) missing.push("no amount column was mapped");
        if (!dateMapped) missing.push("no gift-date column was mapped");
        if (dollarsIn <= 0 && R.dollars.scanColumn && R.dollars.inFile > 0)
          missing.push(`$0 was imported, but the file's “${R.dollars.scanColumn}” column carries ${money$(R.dollars.inFile)} of currency-shaped values`);
        else if (dollarsIn <= 0 && cur.length)
          missing.push(`${countLabel(cur.length, "column")} in this file read${cur.length===1?"s":""} as currency, ${curList} and none was mapped as a gift amount, so there is nothing to reconcile against`);
        else if (dollarsIn <= 0)
          missing.push("no unmapped column reads as currency either, so there is nothing to reconcile against");
        if (!R.rows.balanced) missing.push("the row equation does not balance");
        // The list is printed ONCE. Repeating it here read as two findings
        // where there is one, which is its own small dishonesty on a panel
        // whose whole job is to be countable.
        if (!R.dollars.balanced) missing.push(
          R.dollars.inFile == null
            ? (cur.length
                 ? "so the dollar equation has no left-hand side to check, that is why it does not balance, not a lost figure"
                 : "the file's dollars are unknown (no column in it reads as currency)")
            : "the dollar equation does not balance");
        totals.summaryHealth = {
          greenEarned: amountMapped && dateMapped && dollarsIn > 0 && R.rows.balanced && R.dollars.balanced,
          missing,
        };
        // Part 3.2 — the file's own TOTAL row is the first outside number the
        // product has ever reconciled against.
        if (parseReport?.totalRow) {
          const diff = Math.round((parseReport.totalRow.amount - dollarsIn) * 100) / 100;
          totals.fileTotalRow = { stated: parseReport.totalRow.amount, line: parseReport.totalRow.line,
            imported: dollarsIn, difference: diff,
            explained: { skipped: R.dollars.skipped || 0, errored: R.dollars.errored || 0 } };
        }
      }
      // Don't call onImported() here — the result screen must render first; its
      // Done button calls onImported() so the modal stays until dismissed.
      // BUILD-58 Part 2 — the class fix: every column accounted for, by name.
      const colReport = (() => {
        const headers = parsed?.headers || [];
        if (effectiveShape === "transaction") {
          const m = {};
          Object.entries(txMap).forEach(([role, h]) => { if (h) m[h] = role; });
          return classifyColumns(headers, m, []);
        }
        const m = { ...mapping };
        const ignored = [];
        if (effectiveShape === "wide") yearCols.forEach(yc => { if (yc.enabled) m[yc.col] = "gift (" + yc.col + ")"; else ignored.push(yc.col); });
        return classifyColumns(headers, m, ignored);
      })();
      // The column axis exists only where the transaction mapper built a
      // ledger. BUILD-101 Part 6 found that "extras exist" was standing in for
      // "a ledger exists": membership extras ride a donor-shaped file with no
      // ledger, and the receipt crashed reading one that was not there.
      if (importExtras && Array.isArray(importExtras.columnLedgerFull)) {
        totals.columnAxis = {
          inFile: physicalCols.total,
          summary: summarizeColumnLedger(physicalCols.total, importExtras.columnLedgerFull),
          ledger: importExtras.columnLedgerFull,
        };
      }
      setResult({ ...totals, warned:warnedCount, skipped:skippedCount, shape:effectiveShape, columnReport: colReport, runId });

      // ── TRANS-1 Part 3 — RECORD THE RUN ────────────────────────────────
      // The walk found that this path recorded nothing at all: only the
      // workbook flow ever wrote an `imports` row, so a CSV -- which is what
      // every vendor tile leads to -- produced no named import, no Move
      // Report, and a Settings card that said "0 imports" the morning after
      // a successful move. Recording is best-effort and never fails the
      // import: the money is already safely written by here.
      try {
        const R = totals.reconciliation || {};
        const rowsR = R.rows || {}, dollarsR = R.dollars || {};
        const rec = await apiFetch("/imports", { method: "POST", body: JSON.stringify({
          id: runId,
          thanks: thanksAnswer || undefined,
          migrationSource: moveSource || undefined,
          name: srcFile?.name || "Imported file",
          sourceFilename: srcFile?.name || null,
          shape: effectiveShape === "transaction" ? "transaction"
               : effectiveShape === "wide" ? "wide" : "aggregate",
          rowsIn: Number(rowsR.inFile) || 0,
          giftsCreated: Number(totals.giftsInserted) || 0,
          donorsCreated: Number(totals.created) || 0,
          donorsMerged: Number(totals.donorsMatched) || 0,
          rowsSetAside: Number(rowsR.skipped) || 0,
          rowsErrored: Number(rowsR.errored) || 0,
          dollarsIn: Number(dollarsR.inFile) || 0,
          dollarsCreated: Number(dollarsR.created) || 0,
          summary: {
            rowsIn: Number(rowsR.inFile) || 0,
            giftsCreated: Number(totals.giftsInserted) || 0,
            donorsCreated: Number(totals.created) || 0,
            rowsSetAside: Number(rowsR.skipped) || 0,
            rowsErrored: Number(rowsR.errored) || 0,
            dollarsIn: Number(dollarsR.inFile) || 0,
            dollarsCreated: Number(dollarsR.created) || 0,
            dollarsSetAside: Number(dollarsR.skipped) || 0,
            dollarsErrored: Number(dollarsR.errored) || 0,
            donorsMatched: Number(totals.donorsMatched) || 0,
            externalIdDupes: Number(totals.externalIdDupes) || 0,
            reconciliation: R,
            // The FILE's own figures, from the rows that were submitted.
            moveFile: moveFileFactsFrom(donors, gifts),
            // FIX-33: the rows that could not be read, kept on the run so a
            // person's profile can open theirs ("2 rows from your import
            // couldn't be read. See them"), not only this one screen.
            refusedRows: (totals.refusedRows || []).slice(0, 5000).map(r => ({ line: r.line ?? null, reason: r.reason || null, name: r.name || null, raw: r.raw || {} })),
          },
        })});
        // LIVE-1 — what this file told us, on the result screen.
        if (rec && rec.readout) setResult(r => (r ? { ...r, readout: rec.readout } : r));
        // FIX-37: the recent gifts are still being worked through: follow them.
        if (rec && rec.working) setResult(r => (r ? { ...r, working: true } : r));
        // LIVE-1 — files map themselves: her answers for these columns, saved
        // against the file's headers ("d:" a donor field, "t:" a gift field).
        const enc = {};
        for (const h of parsed.headers) {
          const parts = [];
          if (mapping[h]) parts.push("d:" + mapping[h]);
          for (const [f, hh] of Object.entries(txMap)) if (hh === h) parts.push("t:" + f);
          if (parts.length) enc[h] = parts.join("|").slice(0, 120);
        }
        if (Object.keys(enc).length) apiFetch("/import-shapes", { method: "POST", body: JSON.stringify({ headers: parsed.headers, mapping: enc }) }).catch(() => {});
      } catch (e) {
        console.error("[import] could not record the run:", e);
      }
    } catch (e) {
      // A refusal from a route is a domain error and its message is real. A
      // TypeError in this function is not, and must not be shown as one.
      rethrowProgrammerError(e);
      console.error("IMPORT FAILED:", e);
      if (e.error === "record_limit") { setUpgradeInfo(e); }
      else { setErr(errorMessage(e, "Import failed. See browser console.")); }
    }
    setLoading(false); setProgress(null);
  };

  // ── "Import both" — donor sheet + gift-history sheet linked in one pass ──
  const bothPayload = useMemo(() => {
    if (!bothMode) return null;
    try {
      return buildBothPayload(bothMode.donorSheet, bothMode.giftSheet, bothMode.matchInfo, matchKey);
    } catch (e) {
      rethrowProgrammerError(e);   // a bug is a crash, not "0 gifts → 0 donors"
      console.error("[import-both] payload build failed:", e);
      return { donors:[], gifts:[], matchedGifts:0, unmatchedGifts:0, newDonors:0, skippedGifts:0, error:e.message };
    }
  }, [bothMode, matchKey]);

  // Smart-stage preview over the linked history (donors are re-staged server-side
  // from their attached gifts, so preview from the grouped gift totals).
  const bothStagePreview = useMemo(() => {
    const counts = {};
    if (!bothPayload) return counts;
    const giftsByDonor = {};
    bothPayload.gifts.forEach(g => { (giftsByDonor[g.donorIndex] ||= []).push(g); });
    bothPayload.donors.forEach((d, idx) => {
      const gg = giftsByDonor[idx] || [];
      const total = gg.reduce((s,g)=>s+g.amount,0);
      const last = gg.length ? gg.reduce((m,g)=>g.date>m?g.date:m, gg[0].date) : null;
      const s = last ? inferStage(total, last, !!(d.email||d.phone)) : inferStage(0, null, !!(d.email||d.phone));
      counts[s] = (counts[s]||0)+1;
    });
    return counts;
  }, [bothPayload]);

  const doImportBoth = async () => {
    if (!bothPayload) return;
    const { donors: rawDonors, gifts, error } = bothPayload;
    if (error) { setErr("Failed to prepare import data, " + error + ". Check the browser console."); return; }
    if (!rawDonors.length) { setErr("Nothing to import, no usable donor rows."); return; }
    const donors = assignPayloadDonors(rawDonors); // stamp assignedTo from the owner mapping (Team)
    setLoading(true); setErr(""); setProgress({ done:0, total:donors.length });
    try {
      const totals = await submitImportChunked(donors, gifts, (done,total) => setProgress({ done, total }), undefined, undefined, { sourceName: srcFile?.name });
      // ── BUILD-77 Part 3a — the file-level equation, from PARSE ENTRY ──
      // "In your file" is the physical non-blank row count taken once when
      // the file was parsed, never the count of what survived the client's
      // own builders. The client's refused rows (unparseable amount/date,
      // future-dated, refunds are NOT refused) join the buckets with their
      // reasons, and balance is recomputed against the FILE. The old code
      // summed only the server's payload-scoped equation, which is how 74
      // rows and ~$154,806 of a real file hid behind "Balanced".
      if (payload.file && payload.dispositions) {
        const R = totals.reconciliation;
        R.rows.inFile = payload.file.rows;
        R.dollars.inFile = payload.file.dollars;
        const bump = (bucket, reason, rows, dollars) => {
          R.rows[bucket] += rows; R.dollars[bucket] += dollars;
          const box = bucket === "skipped" ? R.skippedReasons : R.erroredReasons;
          const e = box[reason] || (box[reason] = { rows: 0, dollars: 0 });
          e.rows += rows; e.dollars += dollars;
        };
        const byReason = {};
        for (const d of payload.dispositions) {
          if (d.disposition === "gift") continue;   // sent to the server; its ledger owns them
          const key = d.disposition + "|" + (d.reason || "donor_info_only");
          const e = byReason[key] || (byReason[key] = { rows: 0, dollars: 0 });
          e.rows += 1; e.dollars += d.dollars || 0;
        }
        for (const [key, v] of Object.entries(byReason)) {
          const [disp, reason] = key.split("|");
          if (disp === "errored") bump("errored", reason, v.rows, v.dollars);
          else bump("skipped", reason, v.rows, v.dollars);   // skipped + donor_only both surface as skipped-with-reason
        }
        const accounted = R.rows.created + R.rows.skipped + R.rows.errored;
        R.rows.accounted = accounted;
        R.rows.balanced = accounted === R.rows.inFile;
        const dAccounted = R.dollars.created + R.dollars.skipped + R.dollars.errored;
        R.dollars.accounted = Math.round(dAccounted * 100) / 100;
        R.dollars.balanced = Math.abs(R.dollars.inFile - dAccounted) < 0.005;
        R.balanced = R.rows.balanced && R.dollars.balanced;
        totals.refusedRows = payload.dispositions.filter(d => d.disposition === "skipped" || d.disposition === "errored");
        totals.flaggedRows = payload.flaggedRows || [];
      }
      setResult({
        ...totals,
        warned: bothPayload.donorWarned,
        skipped: bothPayload.donorSkipped + bothPayload.skippedGifts,
        shape: "both",
        unmatched: bothPayload.unmatchedGifts,
        newDonors: bothPayload.newDonors,
        columnReports: bothPayload.columnReports,
        rowReport: bothPayload.rowReport,
      });
    } catch (e) {
      rethrowProgrammerError(e);
      console.error("IMPORT-BOTH FAILED:", e);
      if (e.error === "record_limit") { setUpgradeInfo(e); }
      else { setErr(errorMessage(e, "Import failed. See browser console.")); }
    }
    setLoading(false); setProgress(null);
  };

  // ── Officer routing: which column carries the owner, and its distinct values ─
  const effectiveOwnerCol = useMemo(() => {
    if (bothMode) return detectOwnerColumn(bothMode.donorSheet.headers || []);
    if (!parsed) return "";
    if (effectiveShape === "transaction") return txMap.owner || detectOwnerColumn(parsed.headers);
    const mapped = Object.keys(mapping).find(h => mapping[h] === "owner");
    return mapped || detectOwnerColumn(parsed.headers);
  }, [bothMode, parsed, effectiveShape, txMap.owner, mapping]);

  const ownerMatches = useMemo(() => {
    if (!isTeam || !effectiveOwnerCol || !orgUsers.length) return [];
    const rows = bothMode ? (bothMode.donorSheet.rows || []) : (parsed?.rows || []);
    const values = rows.map(r => r[effectiveOwnerCol]);
    return matchOwnersToUsers(values, orgUsers); // [{value,count,userId,userName,matchType}]
  }, [isTeam, effectiveOwnerCol, orgUsers, bothMode, parsed]);

  // Seed ownerMap from the auto-match whenever the set of owner values changes.
  const ownerValuesKey = ownerMatches.map(m => m.value).join("|");
  useEffect(() => {
    if (!ownerMatches.length) return;
    const init = {};
    ownerMatches.forEach(m => { init[m.value] = m.userId || ""; });
    setOwnerMap(init);
  }, [ownerValuesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply the confirmed routing to a payload's donors (strips the raw `owner`
  // field either way). Core (isTeam=false) → always unassigned.
  const assignPayloadDonors = (donors) => {
    if (!isTeam) return donors.map(({ owner, ...d }) => d);
    if (effectiveOwnerCol && ownerMatches.length) {
      const resolved = {};
      for (const m of ownerMatches) {
        const uid = ownerMap[m.value];
        if (uid) { const u = orgUsers.find(x => x.id === uid); resolved[String(m.value).toLowerCase().trim()] = { userId: uid, userName: u?.name || null }; }
      }
      return applyOwnerAssignment(donors, resolved);
    }
    if (bulkAssign === "__me__" && myId) return donors.map(({ owner, ...d }) => ({ ...d, assignedTo: myId, assignedToName: myName || null }));
    if (bulkAssign && bulkAssign !== "__me__") { const u = orgUsers.find(x => x.id === bulkAssign); return donors.map(({ owner, ...d }) => ({ ...d, assignedTo: bulkAssign, assignedToName: u?.name || null })); }
    return donors.map(({ owner, ...d }) => d);
  };

  async function sendOfficerInvite() {
    if (!inviteEmail.trim()) return;
    setInviteBusy(true); setInviteErr("");
    try {
      const r = await apiFetch("/auth/invite", { method:"POST", body: JSON.stringify({ email: inviteEmail.trim(), role: "staff" }) });
      const val = inviteFor;
      // FIX-15 Part 3: "invited" means the email went. When it did not, the
      // link is shown to copy instead (as Settings does).
      setInvitedValues(p => ({ ...p, [val]: r && r.emailSent === false ? { link: r.inviteLink || "" } : true }));
      // Make the just-invited officer immediately selectable AND assigned to
      // this owner value as PENDING — no re-import needed (task #4). The invite
      // resolves into their portfolio when they accept.
      if (r?.id) {
        const pseudo = { id:"invite:"+r.id, name:r.name || r.email, email:r.email, pending:true };
        setOrgUsers(prev => prev.some(u=>u.id===pseudo.id) ? prev : [...prev, pseudo]);
        setOwnerMap(p => ({ ...p, [val]: pseudo.id }));
      }
      loadOfficers();  // refresh from server (pending list + counts)
      setInviteFor(null); setInviteEmail("");
    } catch (e) {
      setInviteErr(e.error === "seat_limit" ? (errorMessage(e, "You've reached your seat limit.")) : (errorMessage(e, "Could not send invite.")));
    }
    setInviteBusy(false);
  }

  // Label for an officer <option> — pending invitees are clearly marked so an
  // admin knows the assignment is held until acceptance.
  const officerOptionLabel = (u) => u.pending ? `${u.name} (invited, pending)` : `${u.name}${u.email?` (${u.email})`:""}`;
  // Re-point every spelling in a collapsed group at once (still overridable).
  const setGroupOwner = (g, id) => setOwnerMap(p => { const n={...p}; g.values.forEach(v => { n[v.value] = id; }); return n; });

  // The Team officer-routing panel (an owner-column map, or bulk options when
  // there's no owner column). A plain function (not a nested component) so the
  // invite input never remounts on keystroke.
  function ownerRoutingUI() {
    if (!isTeam) return null;
    const panel = { background:T.bg, borderRadius:10, padding:"12px 14px", marginBottom:12, border:`1px solid ${T.bg3}` };
    const eyebrow = { fontSize:11, fontWeight:700, color:T.ink3, marginBottom:6 };
    if (effectiveOwnerCol && ownerMatches.length) {
      // Collapse the messy spellings onto the people they resolve to
      // ("Jonathan — 2,190 donors, from 4 spellings") — always overridable.
      const { groups, unmatched } = groupOwnerMatches(ownerMatches);
      return (
        <div style={panel}>
          <div style={eyebrow}>Route donors to officers</div>
          <div style={{fontSize:12,color:T.ink3,marginBottom:10}}>
            We found an <strong style={{color:T.ink}}>{effectiveOwnerCol}</strong> column, confirm who each value is. Spelling variants are grouped onto one person; matched donors land in that officer's portfolio.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {groups.map(g => {
              const cur = ownerMap[g.values[0].value] ?? "";
              const groupPending = String(g.userId).startsWith("invite:");
              const badge = g.matchType === "email" ? "matched by email" : "matched by name";
              return (
                <div key={g.userId} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span style={{fontSize:12.5,color:T.ink,fontWeight:700,whiteSpace:"nowrap"}}>{g.userName}{groupPending&&<span style={{color:T.gold600,fontWeight:600}}> · pending</span>}</span>
                  <span style={{fontSize:10.5,color:T.green600,fontWeight:600}}>{countLabel(g.totalCount, "donor")} · {badge}{g.spellingCount>1?` · from ${g.spellingCount} spellings`:""}</span>
                  {g.spellingCount>1 && (
                    <span style={{fontSize:10.5,color:T.ink3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:230}} title={g.values.map(v=>v.value).join(", ")}>
                      ({g.values.map(v=>v.value).join(", ")})
                    </span>
                  )}
                  <span style={{flex:1}}/>
                  <select value={cur} onChange={e=>setGroupOwner(g, e.target.value)}
                    style={{background:T.white,border:`1px solid ${cur?T.green600:T.bg3}`,borderRadius:7,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none",cursor:"pointer",maxWidth:230}}>
                    <option value="">Leave unassigned</option>
                    {orgUsers.map(u => <option key={u.id} value={u.id}>{officerOptionLabel(u)}</option>)}
                  </select>
                </div>
              );
            })}
            {unmatched.map(mm => {
              const invited = invitedValues[mm.value];
              return (
                <div key={mm.value} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span style={{fontSize:12.5,color:T.ink,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:160}} title={mm.value}>{mm.value}</span>
                  <span style={{fontSize:10.5,color:T.gold600,fontWeight:600}}>no match · ×{mm.count}</span>
                  <span style={{flex:1}}/>
                  <select value={ownerMap[mm.value] ?? ""} onChange={e=>setOwnerMap(p=>({...p,[mm.value]:e.target.value}))}
                    style={{background:T.white,border:`1px solid ${ownerMap[mm.value]?T.green600:T.bg3}`,borderRadius:7,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none",cursor:"pointer",maxWidth:230}}>
                    <option value="">Leave unassigned</option>
                    {orgUsers.map(u => <option key={u.id} value={u.id}>{officerOptionLabel(u)}</option>)}
                  </select>
                  {!ownerMap[mm.value] && !invited && (
                    <button onClick={()=>{ setInviteFor(mm.value); setInviteEmail(mm.value.includes("@")?mm.value:""); setInviteErr(""); }}
                      style={{background:"transparent",border:`1px solid ${T.gold500}`,borderRadius:7,padding:"4px 10px",color:T.gold600,fontSize:11,fontWeight:700,cursor:"pointer"}}>Invite</button>
                  )}
                  {invited === true && <span style={{fontSize:11,color:T.green600,fontWeight:700}}>✓ invited</span>}
                  {invited && invited !== true && <span style={{fontSize:11,color:T.gold700,fontWeight:700}}>
                    Invite created, but the email did not go.{invited.link ? <> Copy this link to them: <span style={{fontWeight:400,userSelect:"all",overflowWrap:"anywhere"}}>{invited.link}</span></> : null}</span>}
                </div>
              );
            })}
          </div>
          <div style={{fontSize:11,color:T.ink3,marginTop:8}}>Unmatched officers → invite them (they become assignable as pending; donors resolve to their portfolio when they accept) or leave unassigned. Never silently mis-assigned.</div>
          {inviteFor && (
            <div style={{marginTop:10,background:T.white,border:`1px solid ${T.bg3}`,borderRadius:8,padding:"10px 12px"}}>
              <div style={{fontSize:12,color:T.ink,marginBottom:6}}>Invite <strong>{inviteFor}</strong> as a gift officer</div>
              <div style={{display:"flex",gap:6}}>
                <input value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="officer@email.org" style={{...inp,flex:1}}/>
                <button onClick={sendOfficerInvite} disabled={!inviteEmail.trim()||inviteBusy}
                  style={{background:inviteEmail.trim()?T.green600:T.bg2,border:"none",borderRadius:8,padding:"8px 14px",color:T.white,fontSize:12,fontWeight:700,cursor:inviteEmail.trim()?"pointer":"not-allowed"}}>{inviteBusy?"Sending…":"Send invite"}</button>
                <button onClick={()=>{setInviteFor(null);setInviteEmail("");setInviteErr("");}} style={{background:"transparent",border:`1px solid ${T.bg3}`,borderRadius:8,padding:"8px 10px",color:T.ink3,fontSize:12,cursor:"pointer"}}>Cancel</button>
              </div>
              {inviteErr && <div style={{color:T.terracotta,fontSize:11,marginTop:6}}>{inviteErr}</div>}
            </div>
          )}
        </div>
      );
    }
    // No owner column → bulk options.
    return (
      <div style={panel}>
        <div style={eyebrow}>Assign these donors to an officer</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:10}}>No owner/officer column detected. Route them all now, or leave unassigned and split them from the Directory later.</div>
        <select value={bulkAssign} onChange={e=>setBulkAssign(e.target.value)}
          style={{background:T.white,border:`1px solid ${bulkAssign?T.green600:T.bg3}`,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:13,outline:"none",cursor:"pointer",width:"100%"}}>
          <option value="">Leave unassigned (assign later from the Directory)</option>
          {myId && <option value="__me__">Assign all to me</option>}
          {orgUsers.filter(u=>u.id!==myId).map(u => <option key={u.id} value={u.id}>Assign all to {u.name}{u.pending?" (invited, pending)":""}</option>)}
        </select>
      </div>
    );
  }

  // ── Shared styles ──
  const inp     = { width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box" };

  // ── Result screen ──
  if (result !== null) {
    const hasBatchErrors = result.batchErrors?.length > 0;
    return (
      <ImportDone flaggedPage={flaggedPage} hasBatchErrors={hasBatchErrors} onClose={onClose} onImported={onImported} result={result} setErr={setErr} setFlaggedPage={setFlaggedPage} setResult={setResult} setUndoBusy={setUndoBusy} undoBusy={undoBusy}/>
    );
  }

  const donorCount = payload.donors.length;
  const giftCount  = payload.gifts.length;
  const donorHeaders = parsed ? parsed.headers.filter(h => !YEAR_HDR_PAT.test(String(h))) : [];
  // FIX-10 D — the ROLES this picker offers, in the order it offers them. The
  // LABEL is not written here: it comes from TX_ROLE_LABELS through
  // txRoleLabel, so this list and the column-target dropdown say the same words
  // and neither can fall back to a camelCase key.
  const TX_ROLES = [
    "donorName","donorEmail","amount","date",
    "type","campaign","notes","externalId","phone","city","state",
    "softCreditName","softCreditAmount",
    "tributeName","tributeType","tributeNotify",
    "matchEmployer",
    "wealthRating","wealthCapacity","wealthDate",
    "birthday",
    // BUILD-99 (major gifts) Part 6 — A PROPOSAL IS NOT A GIFT, so the mapper has
    // to be able to say which one a column is. Team only, because the whole
    // major-gifts layer is (the 2026-07-19 split); a Core org importing a file
    // with an ask column maps it to a custom field as before rather than being
    // shown a target it cannot use. `owner` is BUILD-36's existing target and is
    // relabelled, not duplicated — BUILD-98 Part 6's line for it is the one this
    // replaces, so there is still exactly one.
    ...(isTeam ? [
      "owner","proposalPurpose","proposalAmount","proposalStage",
      "proposalCloseDate","proposalProbability",
    ] : []),
  ].map(role => [role, txRoleLabel(role)]);

  return (
    <Modal className="commit-screen" onClose={onClose} width={700} zIndex={300} backdrop="rgba(15,26,18,0.72)" blur={false}
      padding={28} ariaLabel={"Import donors"} dialogStyle={{borderRadius:20,border:"1px solid "+T.bg3}}>
      <div>

        <ImportHeader onClose={onClose}/>

        <ImportFileTile adaptiveFile={adaptiveFile} bothMode={bothMode} effectiveShape={effectiveShape} handleFile={handleFile} onImported={onImported} parsed={parsed} setAdaptiveFile={setAdaptiveFile} setBothMode={setBothMode} setErr={setErr} setParsed={setParsed} setSrcFile={setSrcFile} setWorkbook={setWorkbook} setXlsxSheets={setXlsxSheets} srcFile={srcFile} workbook={workbook} xlsxSheets={xlsxSheets}/>
        {/* ── BUILD-82: a workbook is ONE import (all xlsx land here) ── */}
        {workbook && (
          <WorkbookImport workbook={workbook} fileName={srcFile?.name}
            vocabulary={org?.vocabulary} onOpenHome={onOpenHome}
            onClose={()=>{setWorkbook(null);setSrcFile(null);setErr("");}}
            onImported={onImported} />
        )}

        {/* ── TRANS-1 Parts 1 and 2 — WHERE ARE YOUR DONORS TODAY? ──
            Asked BEFORE the file rather than guessed after it, with the
            vendor's own how-to page behind each tile. It stands in front of
            the uploader exactly once: answering it or skipping it both set
            `moveAsked`, and an org already mid-move is never asked again. */}
        {!parsed && !xlsxSheets && !workbook && !moveAsked && !srcFile && (
          <MoveStart
            onPicked={(key, howTo) => { setMoveSource(key); setMoveLabel((howTo && howTo.label) || key); setMoveAsked(true); }}
            onSkip={() => setMoveAsked(true)} />
        )}

        <ImportReader applyParsed={applyParsed} bothMode={bothMode} bothPayload={bothPayload} bothStagePreview={bothStagePreview} csvText={csvText} doImportBoth={doImportBoth} doParse={doParse} err={err} handleFile={handleFile} inp={inp} loading={loading} matchKey={matchKey} moveAsked={moveAsked} moveLabel={moveLabel} moveSource={moveSource} ownerRoutingUI={ownerRoutingUI} parsed={parsed} progress={progress} setBothMode={setBothMode} setCsvText={setCsvText} setErr={setErr} setMatchKey={setMatchKey} setMoveAsked={setMoveAsked} setSrcFile={setSrcFile} setXlsxSheets={setXlsxSheets} startImportBoth={startImportBoth} workbook={workbook} workbookRoles={workbookRoles} xlsxSheets={xlsxSheets}/>

        {/* ── Step 2: Detection + shape-specific mapping + preview ── */}
        {parsed && (<>

          <ImportDetection aggregateCollapse={aggregateCollapse} effectiveShape={effectiveShape} parseReport={parseReport} parsed={parsed} setShapeOverride={setShapeOverride} shapeDetail={shapeDetail} shapeOverride={shapeOverride}/>

          <ImportMapping TX_ROLES={TX_ROLES} aiLoading={aiLoading} cfDefs={cfDefs} dateConvEvidence={dateConvEvidence} dateConventionChoice={dateConventionChoice} doAiMap={doAiMap} donorCfChoices={donorCfChoices} donorHeaders={donorHeaders} effectiveShape={effectiveShape} headersUnrecognized={headersUnrecognized} mapRefusal={mapRefusal} mapping={mapping} mcApplyTagTypes={mcApplyTagTypes} mcDetect={mcDetect} mcFileStatus={mcFileStatus} mig={mig} npsp={npsp} npspIs={npspIs} onConventionChange={onConventionChange} parsed={parsed} payload={payload} setCfDefs={setCfDefs} setDateConventionChoice={setDateConventionChoice} setDonorCfChoices={setDonorCfChoices} setMapRefusal={setMapRefusal} setMapping={setMapping} setMcApplyTagTypes={setMcApplyTagTypes} setMcFileStatus={setMcFileStatus} setTxMap={setTxMap} setYearCols={setYearCols} srcFile={srcFile} takenDonorTargets={takenDonorTargets} txMap={txMap} yearCols={yearCols} yearConvention={yearConvention}/>

          {/* Officer routing (Team) — owner column → teammates, or bulk options */}
          {ownerRoutingUI()}

          <ImportReview cfDecisions={cfDecisions} cfDefs={cfDefs} cfUndecided={cfUndecided} donorCount={donorCount} effectiveShape={effectiveShape} emailsToCheck={emailsToCheck} err={err} giftCount={giftCount} isTeam={isTeam} loading={loading} mapperPlan={mapperPlan} payload={payload} progress={progress} setCfDecisions={setCfDecisions} setCfDefs={setCfDefs} setThanks={setThanks} setTxMap={setTxMap} setValueAnswers={setValueAnswers} shapeMemory={shapeMemory} srcFile={srcFile} stageBasis={stageBasis} stagePreview={stagePreview} thanks={thanks} txMap={txMap} tyPreview={tyPreview} valueAnswers={valueAnswers} valueQuestions={valueQuestions}/>
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>{setParsed(null);setErr("");}} disabled={loading}
              style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 18px",color:T.ink3,fontSize:13,cursor:loading?"not-allowed":"pointer",opacity:loading?0.5:1}}>← Back</button>
            <button type="button" data-commit data-testid="import-commit" onClick={doImport} disabled={loading||donorCount===0||cfUndecided>0||shapeBlocked}
              style={{flex:1,background:loading||donorCount===0||cfUndecided>0||shapeBlocked?T.bg2:T.green600,border:"none",borderRadius:10,padding:"11px 20px",color:T.white,fontSize:14,fontWeight:700,cursor:loading||donorCount===0||cfUndecided>0||shapeBlocked?"not-allowed":"pointer",opacity:loading||donorCount===0||cfUndecided>0||shapeBlocked?0.6:1}}>
              {loading?"Importing…":`Import ${countLabel(donorCount, "donor")}${giftCount>0?` + ${giftCount.toLocaleString()} gifts`:""} →`}
            </button>
          </div>
        </>)}
      </div>
      {upgradeInfo&&<UpgradeModal open={true} onClose={()=>{setUpgradeInfo(null);onClose();}} reason={upgradeInfo.error} current={upgradeInfo.current} limit={upgradeInfo.limit} plan={upgradeInfo.plan}/>}
    </Modal>
  );
}

export { GiftHistoryImport, MergeDuplicatesModal, parseFileToSheets };

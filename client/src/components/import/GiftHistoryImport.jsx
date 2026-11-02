import { YEAR_HDR_PAT, normalizeHeader, eitherContainsTokenRun, autoDetectTxMapping, normalizeMoney, normalizeDate } from "../../../../shared/importShape";
import { normalizeNameForDonorMatch, donorsFromUnmatchedGifts } from "../../../../shared/giftFileDonors.js";
import { useState, useEffect, useMemo } from "react";
import { allPeople } from "../../lib/people";
import { T, Modal } from "../shared";
import Papa from "papaparse";
import { errorMessage } from "../../lib/domainError";
import { newRunId } from "../../../../shared/movePlan";
import { apiFetch } from "../../api";
import { plural, countLabel } from "../../../../shared/countWords.js";
import Uploader from "../Uploader";
import SpreadsheetImport from "../SpreadsheetImport";
import { WorkbookImport } from "../WorkbookImport";
import { displayDate } from "../../../../shared/displayDate";
import { parseFileToSheets } from "./reader";
import { submitImportChunked } from "./payload";
import { ImportProgress, ImportReadout } from "./ImportProgress";
import { ThankYouPreview } from "./ThanksQuestion";

// ── Gift History Import helpers ────────────────────────────────────────────
export function detectGiftFormat(headers) {
  const yearCols = headers.filter(h => YEAR_HDR_PAT.test(String(h)));
  const hasDateCol = headers.some(h => /\bdate\b|\bwhen\b/i.test(String(h)));
  if (yearCols.length >= 2 && !hasDateCol) return "wide";
  const hasAmtCol = headers.some(h => /^(amount|gift|giving|donation)\b/i.test(String(h).trim()) && !/\b(19|20)\d{2}\b/.test(String(h)));
  if (hasAmtCol && hasDateCol) return "transactional";
  if (yearCols.length >= 2) return "wide";
  return "transactional";
}

export function yearColToDate(header, convention) {
  // BUILD-84 census — `\b` DOES NOT FIRE AT AN UNDERSCORE (`_` is a word
  // character), so `\b(20\d{2})\b` read nothing out of `fund_2023` and
  // `fy[\s_-]?(\d{2,4})\b` read nothing out of `fy2024_total` — while
  // YEAR_HDR_PAT, which is unanchored, called both year columns. Two rules,
  // one header, opposite answers. Normalising the header to tokens first
  // (separators become spaces) makes every \b below mean what it says.
  const h = normalizeHeader(header);
  const MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const monYear = h.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*[\s\-]+(\d{4})/i);
  if (monYear) {
    const m = MON[monYear[1].slice(0,3).toLowerCase()];
    const y = parseInt(monYear[2]);
    if (convention === "first") return `${y}-${String(m).padStart(2,"0")}-01`;
    const last = new Date(y, m, 0).getDate();
    return `${y}-${String(m).padStart(2,"0")}-${String(last).padStart(2,"0")}`;
  }
  const yr = h.match(/\b(20\d{2}|19\d{2})\b/);
  if (yr) return convention === "first" ? `${yr[1]}-01-01` : `${yr[1]}-12-31`;
  const fy = h.match(/fy[\s_-]?(\d{2,4})\b/i);
  if (fy) {
    let y = parseInt(fy[1]);
    if (y < 100) y = y < 50 ? 2000 + y : 1900 + y;
    return convention === "first" ? `${y}-01-01` : `${y}-12-31`;
  }
  return null;
}

export function matchDonorForGift(rawName, rawEmail, donors) {
  const em   = (rawEmail || "").toLowerCase().trim();
  const name = (rawName  || "").trim();
  if (em && em.includes("@")) {
    const m = donors.find(d => (d.email||"").toLowerCase().trim() === em);
    if (m) return { confidence:"high", suggestedDonor:m, ambiguousDonors:null };
  }
  if (name) {
    const norm  = normalizeNameForDonorMatch(name);
    const exact = donors.filter(d => normalizeNameForDonorMatch(d.name) === norm);
    if (exact.length === 1) return { confidence:"medium", suggestedDonor:exact[0],    ambiguousDonors:null };
    if (exact.length > 1)   return { confidence:"low",    suggestedDonor:null,         ambiguousDonors:exact };
    // BUILD-84 census — a partial NAME match respects token boundaries.
    // `dn.includes(norm)` matched "Ann Lee" inside "Joann Leewood" and offered
    // it as the donor for a gift; a name is a sequence of tokens, not letters.
    const partial = donors.filter(d => {
      const dn = normalizeNameForDonorMatch(d.name);
      return dn.length > 3 && eitherContainsTokenRun(dn, norm);
    });
    if (partial.length === 1) return { confidence:"low", suggestedDonor:partial[0],   ambiguousDonors:null };
    if (partial.length > 1)   return { confidence:"low", suggestedDonor:null,          ambiguousDonors:partial.slice(0,5) };
  }
  return { confidence:"unmatched", suggestedDonor:null, ambiguousDonors:null };
}

// ── FIX-11 Part 4 — THE PEOPLE A GIFT FILE WOULD CREATE ──────────────────
//
// On 30 September Jonathan imported a 40-gift file into an org where those
// donors did not exist. The screen said "0 gifts ready to import, attaching to
// 0 donors · 40 unmatched (will skip)", offered a grey "Import 0 Gifts" button
// and told him to "use combined mode later", which is not a place. A customer
// arriving with a gift file from another system hits exactly that, and the
// answer the product had was: go away and come back.
//
// This is the grouping that makes the other answer possible. ONE person per
// identity: by email where there is one (lower-cased, because Ada@x and ada@x
// are one person), otherwise by exact normalised name. Two gifts from the same
// new donor create ONE donor, which is the whole point and the thing the
// suite asserts.
//
// It returns the SAME shapes `buildBothPayload` returns, because the import it
// feeds is the combined import that already exists. There is no second import
// path, and this function adds no third.
// It lives in shared/giftFileDonors.js (FIX-43) so setup's gifts-only file
// runs the same grouping.
// FIX-11 Part 4 — THE GIFT-HISTORY IMPORTER WAS ROUNDING TO WHOLE DOLLARS.
//
// `Math.round(amtVal || 0)` in both parse paths, since this surface was
// written. A $250.50 gift was imported as $251.00 and a $33.33 one as $33.00,
// so every gift-history import was quietly wrong by up to 49 cents a row and
// a file never reconciled against its own source. The suite for this part says
// the dollars foot to the cent, and the browser walk is what found it: the
// server-side test posts amounts directly and never saw the parse.
//
// Cents, to two places, through one helper. Never a float sum.
export const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

export const fmtMoneyPlain = n => "$" + (Math.round((Number(n) || 0) * 100) / 100)
  .toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function autoDetectWideConfig(headers, rows) {
  const yearCols = headers.filter(h => YEAR_HDR_PAT.test(String(h)));
  let donorNameCol = "", donorEmailCol = "";
  for (const h of headers) {
    const hl = h.toLowerCase().trim();
    if (!donorNameCol  && /^(name|full.?name|donor.?name|donor|contact)$/.test(hl))  donorNameCol  = h;
    if (!donorEmailCol && /^(email|email.?address|e-?mail)$/.test(hl))               donorEmailCol = h;
  }
  const sample = rows.slice(0,10);
  const validYearCols = yearCols.filter(col =>
    sample.some(r => {
      const v = r[col];
      return v !== null && v !== undefined && v !== "" && !isNaN(parseFloat(String(v).replace(/[$,]/g,"")));
    })
  );
  return { yearCols: validYearCols, donorNameCol, donorEmailCol };
}

// autoDetectTxMapping moved to (now shared/importShape.js) (BUILD-77) so the golden
// fixture suite drives the REAL auto-mapping, not a copy.

// ── GiftHistoryImport ──────────────────────────────────────────────────────
export function GiftHistoryImport({ donors: donorsProp, onClose, onImported, org = null, onOpenHome = null }) {
  // SCALE-2: the shell no longer holds every donor. Matching a gift file
  // against the people on file (matchDonorForGift) still needs all of them,
  // so this import loads the whole-org list itself when it opens, and the
  // preview waits for it. The matching is unchanged.
  const [loadedDonors, setLoadedDonors] = useState(null);
  useEffect(() => {
    if (donorsProp) return undefined;
    let live = true;
    allPeople().then(rows => { if (live) setLoadedDonors(rows); }).catch(() => {});
    return () => { live = false; };
  }, [donorsProp]);
  const donorsReady = donorsProp || loadedDonors;
  const [step, setStep]             = useState("upload");
  const [csvText, setCsvText]       = useState("");
  const [srcFile, setSrcFile]       = useState(null); // the uploaded File (name/size for the file tile)
  const [xlsxSheets, setXlsxSheets] = useState(null);
  const [workbook, setWorkbook]     = useState(null); // BUILD-82 — xlsx goes through the workbook flow (gift-alone links by Donor ID)
  const [adaptiveFile, setAdaptiveFile] = useState(null); // IMPORT-3: nobody to attach to: the import that creates them
  const [parsed, setParsed]         = useState(null);
  const [ghThanks, setGhThanks]     = useState(null);   // FIX-37: her answer; null = the default
  const [ghPreview, setGhPreview]   = useState(null);
  const [err, setErr]               = useState("");

  const [detectedFormat, setDetectedFormat] = useState("transactional");
  const [formatOverride, setFormatOverride] = useState(null);
  const effectiveFormat = formatOverride || detectedFormat;

  const [yearCols, setYearCols]             = useState([]);
  const [yearConvention, setYearConvention] = useState("dec31");
  const [wideDonorNameCol, setWideDonorNameCol]   = useState("");
  const [wideDonorEmailCol, setWideDonorEmailCol] = useState("");

  const [txMap, setTxMap] = useState({ donorName:"",donorEmail:"",amount:"",date:"",type:"",campaign:"",notes:"",externalId:"" });

  const [matchedGifts, setMatchedGifts] = useState([]);
  const [dateRefused, setDateRefused] = useState([]);   // BUILD-79 Part 4 — rows refused for unparseable dates (never dated today)
  const [overrides, setOverrides]       = useState({});
  const [pickingIdx, setPickingIdx]     = useState(null);
  const [pickSearch, setPickSearch]     = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);

  const inp     = { width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box" };

  const handleFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setErr("");
    // IMPORT-3 item 10: an org with no donors has nobody to attach a gift to,
    // so the file goes to the import that creates the people with their gifts.
    await parseFileToSheets(file, { onSingle:applyParsed, onMulti:s=>setXlsxSheets(s), onWorkbook:w=>{ setWorkbook(w); setParsed(null); setXlsxSheets(null); }, onError:msg=>setErr(msg),
      onAdaptive:f=>setAdaptiveFile(f), preferAdaptive: !!donorsReady && donorsReady.length === 0 });
  };

  const doPaste = () => {
    if (!csvText.trim()) return;
    Papa.parse(csvText, {
      header:true, skipEmptyLines:true, transformHeader: h => h.trim(),
      complete: res => {
        if (!res.data?.length) { setErr("No rows found."); return; }
        applyParsed(res.meta.fields || [], res.data);
      },
      error: ex => setErr("Parse error: " + ex.message),
    });
  };

  const applyParsed = (headers, rows) => {
    const fmt = detectGiftFormat(headers);
    setDetectedFormat(fmt); setFormatOverride(null);
    setParsed({ headers, rows }); setXlsxSheets(null); setErr("");
    if (fmt === "wide") {
      const cfg = autoDetectWideConfig(headers, rows);
      setWideDonorNameCol(cfg.donorNameCol); setWideDonorEmailCol(cfg.donorEmailCol);
      setYearCols(cfg.yearCols.map(col => ({ col, date: yearColToDate(col,"dec31"), enabled:true })));
    } else {
      setTxMap(autoDetectTxMapping(headers, rows));
    }
    setStep("configure");
  };

  const onConventionChange = (val) => {
    setYearConvention(val);
    setYearCols(cols => cols.map(yc => ({ ...yc, date: yearColToDate(yc.col, val) })));
  };

  const buildPreview = async () => {
    setErr("");
    let donors = donorsReady;
    if (!donors) {
      try { donors = await allPeople(); setLoadedDonors(donors); }
      catch (e) { setErr(errorMessage(e, "Import failed.")); return; }
    }
    const gifts = [];
    const refusedDates = [];
    if (effectiveFormat === "wide") {
      if (!wideDonorNameCol && !wideDonorEmailCol) {
        setErr("Select at least one donor identifier column (name or email)."); return;
      }
      const activeCols = yearCols.filter(yc => yc.enabled && yc.date);
      if (!activeCols.length) { setErr("Enable at least one gift year column."); return; }
      for (const row of parsed.rows) {
        const rawName  = wideDonorNameCol  ? String(row[wideDonorNameCol]  || "").trim() : "";
        const rawEmail = wideDonorEmailCol ? String(row[wideDonorEmailCol] || "").trim() : "";
        if (!rawName && !rawEmail) continue;
        for (const yc of activeCols) {
          const { value: amtVal } = normalizeMoney(row[yc.col]);
          const amt = round2(amtVal);
          if (amt <= 0) continue;
          const match = matchDonorForGift(rawName, rawEmail, donors);
          gifts.push({ amount:amt, date:yc.date, type:"cash", campaign:"", notes:"", rawName, rawEmail, rawSource:yc.col, ...match });
        }
      }
    } else {
      if (!txMap.amount) { setErr("Map an amount column."); return; }
      for (let i = 0; i < parsed.rows.length; i++) {
        const row = parsed.rows[i];
        const rawName  = txMap.donorName  ? String(row[txMap.donorName]  || "").trim() : "";
        const rawEmail = txMap.donorEmail ? String(row[txMap.donorEmail] || "").trim() : "";
        if (!rawName && !rawEmail) continue;
        const { value: amtVal } = normalizeMoney(row[txMap.amount]);
        const amt = round2(amtVal);
        if (amt <= 0) continue;
        const rawDate = txMap.date ? row[txMap.date] : null;
        const { value: parsedDate } = normalizeDate(rawDate || "");
        // BUILD-79 Part 4 — a gift whose date does not parse is REFUSED with
        // its row and reason, never stamped with today (the || today here was
        // the last write-path survivor of the BUILD-77 sweep).
        if (!parsedDate) { refusedDates.push({ row: i + 2, rawDate: String(rawDate ?? ""), rawName, rawEmail, amount: amt }); continue; }
        const match = matchDonorForGift(rawName, rawEmail, donors);
        gifts.push({
          amount:amt, date:parsedDate,
          type:     txMap.type     ? (String(row[txMap.type]    ||"").toLowerCase() || "cash") : "cash",
          campaign: txMap.campaign ? String(row[txMap.campaign] ||"") : "",
          notes:    txMap.notes    ? String(row[txMap.notes]    ||"") : "",
          externalId: txMap.externalId ? (String(row[txMap.externalId]||"").trim() || undefined) : undefined,
          paymentMethod: txMap.paymentMethod ? (String(row[txMap.paymentMethod]||"").trim() || undefined) : undefined,
          rawName, rawEmail, rawSource:`row ${i+2}`, ...match,
        });
      }
    }
    setDateRefused(refusedDates);
    if (!gifts.length) { setErr(refusedDates.length ? `All ${refusedDates.length} gift rows had unparseable dates, nothing was stamped with today. Fix the date column and re-upload.` : "No valid gift rows found. Check your column mapping."); return; }
    setMatchedGifts(gifts); setOverrides({}); setPickingIdx(null);
    setStep("preview");
  };

  const stats = useMemo(() => {
    let high=0, medium=0, low=0, lowPending=0, unmatched=0, toImportCount=0;
    const donorSet = new Set();
    for (let i = 0; i < matchedGifts.length; i++) {
      const g = matchedGifts[i];
      const ov = overrides[i];
      let willImport = false;
      if      (g.confidence === "high")      { high++;    willImport = ov?.action !== "skip"; }
      else if (g.confidence === "medium")    { medium++;  willImport = ov?.action !== "skip"; }
      else if (g.confidence === "low")       { low++;     if (!ov) lowPending++; else willImport = ov.action !== "skip"; }
      else                                   { unmatched++; }
      if (willImport) {
        const did = ov?.donorId || g.suggestedDonor?.id;
        if (did) { toImportCount++; donorSet.add(did); }
      }
    }
    return { high, medium, low, lowPending, unmatched, toImportCount, donorCount: donorSet.size };
  }, [matchedGifts, overrides]);

  const skipAllPending = () => {
    const newOv = { ...overrides };
    matchedGifts.forEach((g,i) => { if (g.confidence === "low" && !newOv[i]) newOv[i] = { action:"skip" }; });
    setOverrides(newOv);
  };

  // ── FIX-11 Part 4 — THE PEOPLE THIS FILE WOULD CREATE ──────────────────
  // Computed from the unmatched rows, shown BEFORE anything is written, and
  // fed to the combined import that already exists. A mapped payment method
  // rides along (shared/giftFileDonors.js keeps it, as setup does: FIX-44).
  const wouldCreate = useMemo(
    () => donorsFromUnmatchedGifts(matchedGifts.filter(g => g.confidence === "unmatched")),
    [matchedGifts]);

  // CREATE THEM AND IMPORT THEIR GIFTS. The same `/donors/import-combined`
  // chunked submit the two-sheet flow uses, under ONE import run id, so the
  // whole thing is one import and undoes as one.
  const createAndImport = async () => {
    if (!wouldCreate.donors.length) return;
    const runId = newRunId();        // the one run-id helper (shared/movePlan.js)
    setLoading(true); setErr("");
    try {
      // No owner mapping on this screen (that belongs to the donor-sheet
      // flow), so the rows go as they are rather than through
      // assignPayloadDonors, which is scoped to that component.
      const ghAnswer = ghThanks || (ghPreview && ghPreview.defaultAnswer) || null;   // FIX-37
      const totals = await submitImportChunked(
        wouldCreate.donors, wouldCreate.gifts, null, undefined, runId, { thanks: ghAnswer, headers: parsed?.headers || [], sourceName: srcFile?.name });
      // The run is recorded so Settings, Imports shows it and the undo has
      // something to undo. `gift_file_with_donors` is what makes this import
      // reversible as a whole (routes/crm.js).
      const rec = await apiFetch("/imports", { method: "POST", body: JSON.stringify({
        id: runId,
        thanks: ghAnswer || undefined,
        name: srcFile?.name || "Gift file",
        sourceFilename: srcFile?.name || null,
        shape: "gift_file_with_donors",
        donorsCreated: wouldCreate.donors.length,
        giftsCreated: wouldCreate.gifts.length,
        dollars: wouldCreate.dollars,
      }) }).catch(() => null);   // the import happened; the receipt is not the import
      setResult({ ...totals, shape: "gift_file_with_donors", runId, readout: rec && rec.readout ? rec.readout : null, working: !!(rec && rec.working),
                  donorsCreated: wouldCreate.donors.length,
                  giftsCreated: wouldCreate.gifts.length });
      setStep("result");
      // NOT onImported() here. The parent wires onImported to closing this
      // modal (Donors.jsx), so calling it dismissed the result screen the
      // instant the import finished — taking the undo with it. The result
      // screen's own close is what tells the parent to refresh.
    } catch (e) { setErr(errorMessage(e, "The import did not finish.")); }
    setLoading(false);
  };

  // ONE UNDO FOR ONE IMPORT. The run id the create path minted is what the
  // server reverses, so the gifts and the people go together or not at all.
  const undoCreatedImport = async () => {
    if (!result || !result.runId) return;
    setLoading(true); setErr("");
    try {
      const r = await apiFetch(`/imports/${result.runId}/reverse`, { method: "POST" });
      setResult(x => ({ ...x, undone: true, undoSentence: r.sentence || "Undone." }));
    } catch (e) { setErr(errorMessage(e, "The undo did not finish. Nothing was changed.")); }
    setLoading(false);
  };

  const doImport = async () => {
    const toSend = matchedGifts.map((g,i) => {
      const ov = overrides[i];
      if (ov?.action === "skip")              return null;
      if (g.confidence === "unmatched")       return null;
      if (g.confidence === "low" && !ov)      return null;
      const donorId = ov?.donorId || g.suggestedDonor?.id;
      if (!donorId)                           return null;
      return { donorId, amount:g.amount, date:g.date, type:g.type, campaign:g.campaign, notes:g.notes, externalId:g.externalId, paymentMethod:g.paymentMethod };
    }).filter(Boolean);
    if (!toSend.length) { setErr("No gifts to import."); return; }
    setLoading(true); setErr("");
    try {
      // WIRE-1: one run id, stamped on every gift and recorded, so Undo this
      // import removes exactly these gifts.
      const runId = newRunId();
      const ghAnswer = ghThanks || (ghPreview && ghPreview.defaultAnswer) || null;   // FIX-37
      const res = await apiFetch("/gifts/import-history", { method:"POST", body:JSON.stringify({ gifts:toSend, importId:runId,
        ...(ghAnswer ? { thanks: ghAnswer } : {}), headers: parsed?.headers || [] }) });
      let recorded = false;
      if (res.inserted > 0) {
        const R = res.reconciliation || {}, rowsR = R.rows || {}, dollarsR = R.dollars || {};
        const fig = { rowsIn: Number(rowsR.inFile) || 0, giftsCreated: Number(res.inserted) || 0, donorsCreated: 0,
          rowsSetAside: Number(rowsR.skipped) || 0, rowsErrored: Number(rowsR.errored) || 0,
          dollarsIn: Number(dollarsR.inFile) || 0, dollarsCreated: Number(dollarsR.created) || 0 };
        recorded = await apiFetch("/imports", { method: "POST", body: JSON.stringify({
          id: runId, name: srcFile?.name || "Gift file", sourceFilename: srcFile?.name || null, shape: "gifts", ...fig,
          summary: { ...fig, dollarsSetAside: Number(dollarsR.skipped) || 0, dollarsErrored: Number(dollarsR.errored) || 0 },
        }) }).catch(() => false);   // the import happened; the receipt is not the import
      }
      setResult(recorded ? { ...res, runId, readout: recorded.readout || null, working: !!recorded.working } : res); setStep("result");
    } catch(e) { setErr(errorMessage(e, "Import failed.")); }
    setLoading(false);
  };

  // §1.2 F-4 — the human decided: import the rows held as possible duplicates.
  const importHeld = async () => {
    if (!result || !Array.isArray(result.heldForReview) || !result.heldForReview.length) return;
    setLoading(true);
    try {
      const res = await apiFetch("/gifts/import-history", { method:"POST",
        body:JSON.stringify({ includeDuplicates:true, gifts:result.heldForReview }) });
      setResult(r => ({ ...r, inserted:(r.inserted||0)+(res.inserted||0), heldForReview:[] }));
    } catch(e) { setErr(errorMessage(e, "Import failed.")); }
    setLoading(false);
  };

  if (step === "result" && result) {
    return (
      <Modal className="commit-screen" onClose={onClose} width={720} zIndex={300} backdrop="rgba(15,26,18,0.72)" blur={false}
        padding={28} ariaLabel={"Import result"} dialogStyle={{borderRadius:20,border:"1px solid "+T.bg3}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:12}}>✓</div>
          <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:22,fontWeight:400,color:T.ink,marginBottom:12,letterSpacing:"-0.01em"}}>
            Import complete.
          </div>
          {result.working&&!result.readout&&(
            <ImportProgress runId={result.runId} onDone={r=>setResult(x=>(x?{...x,working:false,readout:r.readout||x.readout}:x))}/>
          )}
          <ImportReadout readout={result.readout}/>
          {/* FIX-11 Part 4 — when the import CREATED the people, the result
              says so, and offers the one undo that removes both halves. */}
          {result.shape === "gift_file_with_donors" ? (
            <div data-testid="gi-result-created" style={{fontSize:14,color:T.ink3,marginBottom:16,lineHeight:1.8}}>
              <strong style={{color:T.ink}}>{result.donorsCreated}</strong> {result.donorsCreated===1?"donor":"donors"} created and{" "}
              <strong style={{color:T.ink}}>{result.giftsCreated ?? result.inserted ?? 0}</strong> {(result.giftsCreated ?? result.inserted) === 1 ? "gift" : "gifts"} imported, as one import.
              <div style={{fontSize:12.5,marginTop:10}}>
                {result.undone ? (
                  <div data-testid="gi-undone" style={{color:T.ink}}>{result.undoSentence}</div>
                ) : (<>
                  <button type="button" data-commit data-testid="gi-undo" disabled={loading} onClick={undoCreatedImport}
                    style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink,fontSize:12.5,fontWeight:700,cursor:loading?"not-allowed":"pointer"}}>
                    {loading?"Undoing…":"Undo this import"}
                  </button>
                  <div style={{color:T.ink3,marginTop:6}}>
                    Undoing removes the gifts and the people this file created, and nothing else.
                  </div>
                </>)}
              </div>
            </div>
          ) : (
            <div style={{fontSize:14,color:T.ink3,marginBottom:16,lineHeight:1.8}}>
              <strong style={{color:T.ink}}>{result.inserted}</strong> gifts imported across{" "}
              <strong style={{color:T.ink}}>{result.donorsUpdated}</strong> donors
              {result.externalIdDupes > 0 && <> · <strong>{result.externalIdDupes}</strong> already imported (matched by transaction ID)</>}
              {result.runId && (
                <div style={{fontSize:12.5,marginTop:10}}>
                  {result.undone ? (
                    <div data-testid="gi-undone" style={{color:T.ink}}>{result.undoSentence}</div>
                  ) : (
                    <button type="button" data-commit data-testid="gi-undo" disabled={loading} onClick={undoCreatedImport}
                      style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink,fontSize:12.5,fontWeight:700,cursor:loading?"not-allowed":"pointer"}}>
                      {loading?"Undoing…":"Undo this import"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {Array.isArray(result.heldForReview) && result.heldForReview.length > 0 && (
            <div style={{fontSize:13,color:T.ink,background:T.gold100,border:"1px solid "+T.gold300,borderRadius:10,padding:"12px 16px",marginBottom:16,textAlign:"left",lineHeight:1.6}}>
              <strong>{result.heldForReview.length}</strong> {plural(result.heldForReview.length, "row")} matched a gift already on file
              (same donor, amount, and date) and {result.heldForReview.length===1?"was":"were"} held for your review.
              Nothing was silently dropped. If these are genuinely separate gifts (e.g. two identical checks the same day), import them.
              <div style={{marginTop:10}}>
                <button disabled={loading} onClick={importHeld}
                  style={{background:T.gold500,border:"none",borderRadius:8,padding:"8px 16px",color:T.ink,fontSize:13,fontWeight:700,cursor:"pointer"}}>
                  {loading?"Importing…":`Import ${countLabel(result.heldForReview.length, "held row")}`}
                </button>
              </div>
            </div>
          )}
          {result.duplicateCandidates && result.duplicateCandidates.withinFile > 0 && (
            <div style={{fontSize:12,color:T.ink3,marginBottom:12}}>
              {result.duplicateCandidates.withinFile} same-day/same-amount twin{result.duplicateCandidates.withinFile===1?" was":"s were"} imported
              from within this file (they are treated as real, separate gifts, map a Gift/Transaction ID column for exact dedup).
            </div>
          )}
          <div style={{fontSize:12,color:T.ink3,marginBottom:28}}>Donor giving totals have been recalculated from the gifts table.</div>
          <button onClick={onImported} style={{background:T.greenDk,border:"none",borderRadius:10,padding:"12px 28px",color:T.white,fontSize:14,fontWeight:700,cursor:"pointer"}}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal className="commit-screen" onClose={onClose} width={720} zIndex={300} backdrop="rgba(15,26,18,0.72)" blur={false}
      padding={28} ariaLabel={"Import gift history"} dialogStyle={{borderRadius:20,border:"1px solid "+T.bg3}}>
      <div>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:T.ink}}>Import Giving History</div>
            <div style={{fontSize:13,color:T.ink3,marginTop:2}}>Attach historical gifts to existing donors · CSV, TSV, or Excel</div>
          </div>
          <button onClick={onClose} style={{background:T.bg3,border:"none",borderRadius:8,padding:"6px 12px",color:T.ink3,cursor:"pointer",fontSize:13,flexShrink:0}}>✕ Close</button>
        </div>

        {/* The uploaded file as a tile — still a drop target for a replacement */}
        {srcFile && (parsed || xlsxSheets || workbook) && (
          <div style={{marginBottom:16}}>
            <Uploader accept={[".csv",".tsv",".xlsx",".xls"]} acceptLabel=".csv, .tsv, .xlsx, .xls" compact readAs="none"
              label="Replace file"
              fileMeta={srcFile ? {
                name: srcFile.name, size: srcFile.size,
                detail: parsed ? `${parsed.rows.length.toLocaleString()} rows · ${effectiveFormat === "wide" ? "wide year columns" : "transaction ledger"}`
                  : workbook ? `${workbook.roled.length} sheets · one import`
                  : `${(xlsxSheets || []).length} sheets`,
              } : null}
              onFile={({file})=>{setSrcFile(file);handleFile({target:{files:[file]}});}}
              onRemove={()=>{setSrcFile(null);setParsed(null);setXlsxSheets(null);setWorkbook(null);setStep("upload");setErr("");}}/>
          </div>
        )}

        {adaptiveFile && <SpreadsheetImport file={adaptiveFile} onClose={()=>{setAdaptiveFile(null);setSrcFile(null);}} onImported={()=>{setAdaptiveFile(null);onImported&&onImported();}}/>}
        {/* IMPORT-3 item 10: said plainly, never "0 donors + 0 gift rows" */}
        {step === "upload" && !workbook && donorsReady && donorsReady.length === 0 && (
          <div data-testid="gi-no-donors" style={{background:T.gold100,border:"1px solid "+T.gold300,borderRadius:12,padding:"12px 14px",marginBottom:14,fontSize:13,color:T.ink,lineHeight:1.5}}>
            <strong>There are no donors here yet, so there is nobody to attach giving history to.</strong> Drop your file anyway: Steward will read it as a new import and create the people together with their gifts.
          </div>
        )}
        {/* BUILD-82: xlsx routes through the workbook flow — a gift sheet with
            only an ID column links to existing donors by Donor ID */}
        {workbook && (
          <WorkbookImport workbook={workbook} fileName={srcFile?.name}
            vocabulary={org?.vocabulary} onOpenHome={onOpenHome}
            onClose={()=>{setWorkbook(null);setSrcFile(null);setErr("");}}
            onImported={onImported} />
        )}

        {/* Upload */}
        {step === "upload" && !xlsxSheets && !workbook && (<>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:6}}>Upload file</div>
            <Uploader accept={[".csv",".tsv",".xlsx",".xls"]} acceptLabel=".csv, .tsv, .xlsx, .xls" compact readAs="none"
              label="Choose your spreadsheet, or drag it here"
              fileMeta={null}
              onFile={({file})=>{setSrcFile(file);handleFile({target:{files:[file]}});}}/>
            <div style={{fontSize:11,color:T.ink3,marginTop:5}}>One row per donor with a column for each year, or one row per gift. We work out which.</div>

          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <div style={{flex:1,height:1,background:T.bg3}}/><span style={{fontSize:12,color:T.ink3}}>or paste CSV text</span><div style={{flex:1,height:1,background:T.bg3}}/>
          </div>
          <textarea value={csvText} onChange={e=>setCsvText(e.target.value)} rows={5}
            placeholder={"Donor,Email,2021 Gift,2022 Gift,2023 Gift\nJane Smith,jane@example.com,500,750,1000"}
            style={{...inp,resize:"vertical",lineHeight:1.5,marginBottom:12}}/>
          {err&&<div style={{color:T.terracotta,fontSize:12,marginBottom:10}}>{err}</div>}
          <button onClick={doPaste} disabled={!csvText.trim()}
            style={{background:csvText.trim()?T.gold500:T.bg2,border:"none",borderRadius:10,padding:"11px 20px",color:csvText.trim()?T.ink:T.ink3,fontSize:14,fontWeight:700,cursor:csvText.trim()?"pointer":"not-allowed",opacity:csvText.trim()?1:0.5}}>
            Parse →
          </button>
        </>)}

        {/* Sheet picker */}
        {step === "upload" && xlsxSheets && (<>
          <div style={{fontSize:14,fontWeight:700,color:T.ink,marginBottom:4}}>This workbook has {xlsxSheets.length} sheets with data.</div>
          <div style={{fontSize:13,color:T.ink3,marginBottom:16}}>Pick the sheet to import.</div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
            {xlsxSheets.map((s,i)=>(
              <div key={s.name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 16px"}}>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:T.ink}}>{s.name}</div>
                  <div style={{fontSize:12,color:T.ink3,marginTop:2}}>{s.rowCount.toLocaleString()} rows · {s.headers.filter(Boolean).length} columns</div>
                </div>
                <button onClick={()=>applyParsed(s.headers,s.rows,s.physical,s.report)}
                  style={{background:T.greenDk,border:"none",borderRadius:8,padding:"8px 16px",color:T.white,fontSize:13,fontWeight:700,cursor:"pointer"}}>
                  {i===0?"Use this ←":"Select"}
                </button>
              </div>
            ))}
          </div>
          <button onClick={()=>setXlsxSheets(null)} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"9px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>← Back</button>
        </>)}

        {/* Configure */}
        {step === "configure" && parsed && (<>

          {/* Format toggle */}
          <div style={{background:T.bg,borderRadius:10,padding:"12px 14px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:T.ink}}>
                Detected: <span style={{color:effectiveFormat==="wide"?T.gold600:T.green600}}>
                  {effectiveFormat==="wide"?"Wide format (one row/donor, year columns)":"Transactional format (one row/gift)"}
                </span>
              </div>
              <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{parsed.rows.length.toLocaleString()} rows · {parsed.headers.length} columns</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              {["wide","transactional"].map(f=>(
                <button key={f} onClick={()=>setFormatOverride(effectiveFormat===f?null:f)}
                  style={{background:effectiveFormat===f?T.bg2:"transparent",border:`1px solid ${effectiveFormat===f?T.greenDk:T.bg3}`,borderRadius:7,padding:"5px 12px",color:effectiveFormat===f?T.greenDk:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer"}}>
                  {f==="wide"?"Wide":"Transactional"}
                  {f===detectedFormat&&<span style={{fontSize:10,color:T.ink3,marginLeft:4,fontWeight:400}}>(auto)</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Wide config */}
          {effectiveFormat === "wide" && (<>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:8}}>Year Date Convention</div>
              <div style={{display:"flex",gap:8}}>
                {[["dec31","Dec 31 (end of year)"],["first","Jan 1 (start of year)"]].map(([v,l])=>(
                  <button key={v} onClick={()=>onConventionChange(v)}
                    style={{flex:1,background:yearConvention===v?T.bg2:"transparent",border:`1px solid ${yearConvention===v?T.greenDk:T.bg3}`,borderRadius:8,padding:"8px 12px",color:yearConvention===v?T.greenDk:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer",textAlign:"left"}}>
                    {l}
                    {v==="dec31"&&<span style={{fontSize:10,color:T.ink3,display:"block",fontWeight:400,marginTop:1}}>Default, treats each gift as end-of-year</span>}
                  </button>
                ))}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              {[["Donor Name Column",wideDonorNameCol,setWideDonorNameCol],["Donor Email Column",wideDonorEmailCol,setWideDonorEmailCol]].map(([label,val,setter])=>(
                <div key={label}>
                  <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:5}}>{label}</div>
                  <select value={val} onChange={e=>setter(e.target.value)} style={{...inp,cursor:"pointer"}}>
                    <option value="">Not in file</option>
                    {parsed.headers.filter(h=>!YEAR_HDR_PAT.test(h)).map(h=><option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:8}}>
                Gift Year Columns, {yearCols.filter(yc=>yc.enabled).length}/{yearCols.length} enabled
              </div>
              {yearCols.length===0&&(
                <div style={{color:T.gold600,fontSize:13,background:T.gold100,borderRadius:8,padding:"10px 12px"}}>
                  No year-like columns detected. Switch to Transactional format.
                </div>
              )}
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {yearCols.map((yc,i)=>(
                  <div key={yc.col} style={{display:"flex",alignItems:"center",gap:10,background:yc.enabled?T.bg:"transparent",border:`1px solid ${yc.enabled?T.bg3:"transparent"}`,borderRadius:8,padding:"8px 10px"}}>
                    <input type="checkbox" checked={yc.enabled} onChange={e=>setYearCols(c=>c.map((x,j)=>j===i?{...x,enabled:e.target.checked}:x))} style={{cursor:"pointer"}}/>
                    <span style={{flex:1,fontSize:13,color:yc.enabled?T.ink:T.ink3}}>{yc.col}</span>
                    <span style={{fontSize:12,color:T.ink3}}>→</span>
                    <input type="date" value={yc.date||""} onChange={e=>setYearCols(c=>c.map((x,j)=>j===i?{...x,date:e.target.value}:x))}
                      style={{background:T.bg2,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                  </div>
                ))}
              </div>
            </div>
          </>)}

          {/* Transactional config */}
          {effectiveFormat === "transactional" && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:8}}>Map Columns</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[
                  ["Donor Name","donorName","for matching"],
                  ["Donor Email","donorEmail","email match = highest confidence"],
                  ["Amount *","amount","required"],
                  ["Gift Date","date","ISO, M/D/YYYY, Excel serial"],
                  ["Gift Type","type","cash, check, online…"],
                  ["Campaign / Fund","campaign",""],
                  ["Notes","notes",""],
                  ["Gift / Transaction ID","externalId","dedupes re-imports safely"],
                ].map(([label,key,hint])=>(
                  <div key={key}>
                    <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:4}}>
                      {label}{hint&&<span style={{fontSize:10,fontWeight:400,marginLeft:4,textTransform:"none",color:T.ink3}}>· {hint}</span>}
                    </div>
                    <select value={txMap[key]||""} onChange={e=>setTxMap(m=>({...m,[key]:e.target.value}))}
                      style={{...inp,cursor:"pointer",fontSize:12}}>
                      <option value="">Skip</option>
                      {parsed.headers.map(h=><option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {err&&<div style={{color:T.terracotta,fontSize:12,marginBottom:10}}>{err}</div>}
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>{setParsed(null);setStep("upload");setErr("");}}
              style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 18px",color:T.ink3,fontSize:13,cursor:"pointer"}}>← Back</button>
            <button onClick={buildPreview}
              style={{flex:1,background:T.gold500,border:"none",borderRadius:10,padding:"11px 20px",color:T.ink,fontSize:14,fontWeight:700,cursor:"pointer"}}>
              Match Donors & Preview →
            </button>
          </div>
        </>)}

        {/* Preview */}
        {step === "preview" && (<>

          {/* BUILD-79 Part 4 — refused dates are named, never today-stamped */}
          {dateRefused.length > 0 && (
            <div style={{background:T.terra100,border:`1px solid ${T.terra200}`,borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12.5,color:T.terra700,lineHeight:1.6}}>
              <strong>{countLabel(dateRefused.length, "gift row")} refused, because the gift date could not be read.</strong>{" "}
              Nothing is ever stamped with today's date. Examples:{" "}
              {dateRefused.slice(0,3).map(r=>`row ${r.row} (“${r.rawDate||"blank"}”)`).join(" · ")}{dateRefused.length>3?" · …":""}
            </div>
          )}

          {/* IMPORT-3 item 10: no name in the file matches anybody here */}
          {stats.high+stats.medium+stats.low===0 && srcFile && (
            <div data-testid="gi-no-matches" style={{background:T.gold100,border:"1px solid "+T.gold300,borderRadius:12,padding:"12px 14px",marginBottom:14,fontSize:13,color:T.ink,lineHeight:1.5}}>
              <strong>None of the names in this file match anyone in Steward yet.</strong> Giving history attaches to people already here. Read it as a new import instead, and Steward will create the people together with their gifts.
              <div style={{marginTop:8}}><button data-testid="gi-read-as-new" onClick={()=>setAdaptiveFile(srcFile)} style={{background:T.greenDk,color:T.white,border:"none",borderRadius:9,padding:"8px 14px",fontWeight:800,fontSize:13,cursor:"pointer"}}>Read it as a new import</button></div>
            </div>
          )}
          {/* Summary card */}
          <div style={{background:T.bg,borderRadius:12,padding:"14px 16px",marginBottom:16}}>
            <div style={{fontSize:15,fontWeight:700,color:T.ink,marginBottom:8}}>
              <span style={{color:T.greenDk}}>{stats.toImportCount}</span> gifts ready to import, attaching to{" "}
              <span style={{color:T.ink}}>{stats.donorCount}</span> donors
              {stats.lowPending>0&&<> · <span style={{color:T.gold600}}>{stats.lowPending} need review</span></>}
              {stats.unmatched>0&&<> · <span style={{color:T.ink}}>{stats.unmatched} for {wouldCreate.donors.length} {wouldCreate.donors.length===1?"person":"people"} not on file yet</span></>}
            </div>
            <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
              {[[stats.high,T.greenMid,"matched by email"],[stats.medium,T.green500,"matched by name"],[stats.low,T.gold600,"needs your confirmation"],[stats.unmatched,T.ink,"not on file yet"]].filter(([n])=>n>0).map(([n,color,label])=>(
                <span key={label} style={{fontSize:12}}><span style={{color,fontWeight:700}}>{n}</span> <span style={{color:T.ink3}}>{label}</span></span>
              ))}
            </div>
          </div>

          {/* Low confidence review list */}
          {stats.low > 0 && (
            <div style={{marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:T.gold700}}>
                  {stats.lowPending} waiting for you to confirm
                </div>
                {stats.lowPending>0&&(
                  <button onClick={skipAllPending} style={{fontSize:11,color:T.ink3,background:"none",border:"1px solid "+T.bg3,borderRadius:6,padding:"3px 10px",cursor:"pointer"}}>
                    Skip all {stats.lowPending}
                  </button>
                )}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:320,overflowY:"auto",paddingRight:2}}>
                {matchedGifts.map((g,i)=>{
                  if (g.confidence !== "low") return null;
                  const ov = overrides[i];
                  return (
                    <div key={i} style={{background:ov?.action==="skip"?T.bg:T.gold50,border:`1px solid ${ov?.action==="skip"?T.bg3:T.gold300}`,borderRadius:10,padding:"10px 12px",opacity:ov?.action==="skip"?0.55:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5,flexWrap:"wrap"}}>
                        <span style={{fontSize:13,fontWeight:700,color:T.ink}}>${g.amount.toLocaleString()}</span>
                        <span style={{fontSize:12,color:T.ink3}}>{displayDate(g.date)||g.date}</span>
                        <span style={{fontSize:12,color:T.ink}}>· {g.rawName||g.rawEmail}</span>
                        <span style={{fontSize:11,color:T.ink3}}>({g.rawSource})</span>
                      </div>
                      {!ov&&g.ambiguousDonors&&(
                        <div style={{marginBottom:6}}>
                          <div style={{fontSize:11,color:T.gold700,marginBottom:4}}>More than one donor has this name. Choose one:</div>
                          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                            {g.ambiguousDonors.map(d=>(
                              <button key={d.id} onClick={()=>setOverrides(p=>({...p,[i]:{action:"pick",donorId:d.id,donorName:d.name}}))}
                                style={{fontSize:11,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 10px",cursor:"pointer",color:T.ink}}>
                                {d.name}{d.email?` (${d.email})`:""}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {!ov&&g.suggestedDonor&&!g.ambiguousDonors&&(
                        <div style={{fontSize:12,color:T.ink3,marginBottom:5}}>
                          Suggested: <strong style={{color:T.ink}}>{g.suggestedDonor.name}</strong>
                          {g.suggestedDonor.email&&<span> ({g.suggestedDonor.email})</span>}
                          <span style={{color:T.gold600,marginLeft:4}}>partial match</span>
                        </div>
                      )}
                      {(ov?.action==="confirm"||ov?.action==="pick")&&(
                        <div style={{fontSize:12,color:T.greenDk,marginBottom:5}}>✓ Will attach to: <strong>{ov.donorName}</strong></div>
                      )}
                      {ov?.action==="skip"&&(
                        <div style={{fontSize:12,color:T.ink3,marginBottom:5}}>✗ Skipped</div>
                      )}
                      {pickingIdx===i&&(
                        <div style={{marginBottom:8}}>
                          <input value={pickSearch} onChange={e=>setPickSearch(e.target.value)}
                            placeholder="Search donors by name or email…" autoFocus
                            style={{...inp,marginBottom:5,fontSize:12}}/>
                          {pickSearch.length>=2&&(
                            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:8,maxHeight:160,overflowY:"auto"}}>
                              {(()=>{
                                const q = pickSearch.toLowerCase();
                                const hits = (donorsReady || []).filter(d=>d.name.toLowerCase().includes(q)||(d.email||"").toLowerCase().includes(q)).slice(0,8);
                                return hits.length ? hits.map(d=>(
                                  <div key={d.id} onClick={()=>{setOverrides(p=>({...p,[i]:{action:"pick",donorId:d.id,donorName:d.name}}));setPickingIdx(null);setPickSearch("");}}
                                    style={{padding:"7px 12px",cursor:"pointer",fontSize:12,color:T.ink,borderBottom:"1px solid "+T.bg2}}>
                                    <strong>{d.name}</strong>{d.email?` · ${d.email}`:""}
                                  </div>
                                )) : <div style={{padding:"10px 12px",fontSize:12,color:T.ink3}}>No donors found</div>;
                              })()}
                            </div>
                          )}
                        </div>
                      )}
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {!ov&&g.suggestedDonor&&(
                          <button onClick={()=>setOverrides(p=>({...p,[i]:{action:"confirm",donorId:g.suggestedDonor.id,donorName:g.suggestedDonor.name}}))}
                            style={{background:T.greenDk,border:"none",borderRadius:7,padding:"5px 12px",color:T.white,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                            ✓ Confirm
                          </button>
                        )}
                        {!ov&&(
                          <button onClick={()=>{setPickingIdx(pickingIdx===i?null:i);setPickSearch("");}}
                            style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 12px",color:T.ink,fontSize:12,cursor:"pointer"}}>
                            {pickingIdx===i?"Cancel":"Pick donor →"}
                          </button>
                        )}
                        {!ov&&(
                          <button onClick={()=>{setOverrides(p=>({...p,[i]:{action:"skip"}}));setPickingIdx(null);}}
                            style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>
                            Skip
                          </button>
                        )}
                        {ov&&(
                          <button onClick={()=>{setOverrides(p=>{const n={...p};delete n[i];return n;});setPickingIdx(null);}}
                            style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:6,padding:"3px 8px",color:T.ink3,fontSize:11,cursor:"pointer"}}>
                            Undo
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* FIX-11 Part 4 — NOT A DEAD END.
              This block used to say "✗ 40 Unmatched — Will Be Skipped" over
              "These donors don't exist yet — import them first via donor
              import, or use combined mode later." Every part of that was a
              problem: an ✗ for the ordinary case of bringing your gift history
              with you, a destination ("donor import") that means a second pass
              over the same file, and "later", which is not a place. It is an
              offer now, and the people it would create are named before
              anything is written. */}
          {stats.unmatched > 0 && (
            <div data-testid="gi-new-donors" style={{marginBottom:14}}>
              <div style={{fontSize:12,fontWeight:700,color:T.ink,marginBottom:5}}>
                {wouldCreate.donors.length} {wouldCreate.donors.length===1?"person":"people"} in this file {wouldCreate.donors.length===1?"is":"are"} not on file yet
              </div>
              <div style={{fontSize:12,color:T.ink3,marginBottom:8,lineHeight:1.6,maxWidth:560}}>
                Steward can create {wouldCreate.donors.length===1?"them":"them"} and import their {stats.unmatched} {stats.unmatched===1?"gift":"gifts"},
                {" "}{fmtMoneyPlain(wouldCreate.dollars)} in all, as one import. Nothing is written until you choose.
                {wouldCreate.nameless>0&&<> {wouldCreate.nameless} {wouldCreate.nameless===1?"row has":"rows have"} no name and no email, so {wouldCreate.nameless===1?"it":"they"} cannot become a person and {wouldCreate.nameless===1?"is":"are"} left out.</>}
              </div>
              <div style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 12px",maxHeight:180,overflowY:"auto"}}>
                {wouldCreate.donors.slice(0,12).map((d,i)=>(
                  <div key={i} style={{fontSize:12,color:T.ink,padding:"2px 0"}}>
                    {d.name}{d.email?<span style={{color:T.ink3}}> · {d.email}</span>:<span style={{color:T.ink3}}> · no email</span>}
                  </div>
                ))}
                {wouldCreate.donors.length>12&&<div style={{fontSize:12,color:T.ink3,marginTop:4}}>and {wouldCreate.donors.length-12} more</div>}
              </div>
            </div>
          )}

          <ThankYouPreview dates={matchedGifts.map(g => g.date)} headers={parsed?.headers} answer={ghThanks} onAnswer={setGhThanks} onPreview={setGhPreview}/>
          {err&&<div style={{color:T.terracotta,fontSize:12,marginBottom:10}}>{err}</div>}
          {/* FIX-11 Part 4 — TWO WAYS FORWARD, on the same screen. Creating the
              people is the emerald one, because it is what somebody arriving
              with a gift file came to do; importing only the matches is beside
              it, named by its count so there is no doubt what it leaves out.
              When nothing matches, that second button said "Import 0 Gifts"
              and was the only button there was. */}
          <div style={{display:"flex",gap:10,marginTop:4,flexWrap:"wrap"}}>
            <button onClick={()=>setStep("configure")}
              style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 18px",color:T.ink3,fontSize:13,cursor:"pointer"}}>← Back</button>
            {wouldCreate.donors.length>0&&(
              <button type="button" data-commit data-testid="gi-create-and-import" onClick={createAndImport} disabled={loading}
                style={{flex:"2 1 240px",background:loading?T.bg2:T.greenDk,border:"none",borderRadius:10,padding:"11px 20px",color:loading?T.ink3:T.white,fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer",opacity:loading?0.6:1}}>
                {loading?"Importing…":`Create ${wouldCreate.donors.length} new ${wouldCreate.donors.length===1?"donor":"donors"} and import their ${stats.unmatched===1?"gift":"gifts"}`}
              </button>
            )}
            <button type="button" data-commit data-testid="gi-import-matched" onClick={doImport} disabled={loading||stats.toImportCount===0}
              title={stats.toImportCount===0?"None of these gifts match somebody already on file.":undefined}
              style={{flex:"1 1 180px",background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 20px",color:loading||stats.toImportCount===0?T.ink3:T.ink,fontSize:13.5,fontWeight:700,cursor:loading||stats.toImportCount===0?"not-allowed":"pointer",opacity:loading||stats.toImportCount===0?0.55:1}}>
              {loading?"Importing…":stats.toImportCount===0
                ? "No gifts match somebody on file"
                : `Import only the ${stats.toImportCount} that ${stats.toImportCount===1?"matches":"match"}`}
            </button>
          </div>
          {stats.lowPending>0&&<div style={{fontSize:11,color:T.ink3,marginTop:8,textAlign:"center"}}>{stats.lowPending} gifts matched somebody only loosely, so they wait for you to confirm before they are included.</div>}
        </>)}

      </div>
    </Modal>
  );
}

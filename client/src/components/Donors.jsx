import { useState, useEffect, useRef, useMemo, Component } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { apiFetch, API, getToken, adaptDonor } from "../api";
import { useAuth } from "../main";
import UpgradeModal from "./UpgradeModal";

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("DonorProfile error:", error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:"32px 24px",textAlign:"center",color:"#ef4444",fontSize:14}}>
          <div style={{fontWeight:700,marginBottom:8}}>Something went wrong loading this profile.</div>
          <div style={{color:"#6b7280",marginBottom:16}}>{this.state.error?.message}</div>
          <button onClick={()=>this.setState({error:null})} style={{background:"#10b981",border:"none",borderRadius:8,padding:"8px 18px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
import { T, fmt, fmtFull, daysDiff, SC, askClaude, STAGES, STAGE_ACTION, TIER_COLOR, donorScore, moveUrgency, Spin, Pill, Card, AIBtn, AIPanel, PageTitle, EmptyState, GivingHistoryChart, TpField, TpYesNo, TouchpointTimeline } from "./shared";
// SHELVED — voice capture works but unproven adoption assumption, revisit
// later. Code intact, re-enable by uncommenting (see showVoiceMemo state,
// profile button, and modal render below, and add `VoiceMemoModal` back to
// the import above).
import { DonorMap } from "./DonorMap";

// ── CSV Import helpers ─────────────────────────────────────────────────────
// ── Import field registry ──────────────────────────────────────────────────
const CSV_FIELDS = [
  { key:"name",      labels:["name","full name","donor name","contact","display name"] },
  { key:"email",     labels:["email","email address","e-mail","e mail"] },
  { key:"phone",     labels:["phone","phone number","mobile","cell","telephone"] },
  { key:"total",     labels:["total","total giving","lifetime","lifetime giving","total donated","cumulative giving"] },
  { key:"lastAmount",labels:["last gift amount","last amount","last donation amount","recent gift","most recent gift"] },
  { key:"lastGift",  labels:["last gift date","last donation date","most recent date","last gift"] },
  { key:"gifts",     labels:["gifts","gift count","# gifts","number of gifts","donations","gift #","# donations"] },
  { key:"status",    labels:["status","donor status","type"] },
  { key:"city",      labels:["city","town"] },
  { key:"state",     labels:["state","province","region"] },
  { key:"notes",     labels:["notes","note","comments","memo"] },
];
const VALID_IMPORT_KEYS = new Set([...CSV_FIELDS.map(f => f.key), "_firstName", "_lastName"]);
const IMPORT_STAGES = ["prospect","qualify","cultivate","solicit","steward","lapsed"];

// Donor-to-donor relationship types (server.js's DONOR_RELATIONSHIP_TYPES) —
// spouse/household pool into the profile's combined household total; family
// and employer_match are relationship context only. Manual linking only, no
// auto-detection in this pass.
const DONOR_RELATIONSHIP_LABELS = [
  ["spouse","Spouse"],
  ["household","Household"],
  ["family","Family"],
  ["employer_match","Employer Match"],
];

// Headers that negate a contact field — never map to that field
const NEGATOR_PHRASES = ["do not", "don't", "opt out", "opt-out", "unsubscribe", "no email", "no phone", "no mail", "do not contact"];

function guessField(header) {
  if (!header || !String(header).trim()) return "";
  const h = String(header).toLowerCase().trim();
  // Reject headers that signal a negation/flag ("do not email", "opt out of email", etc.)
  if (NEGATOR_PHRASES.some(n => h.includes(n))) return "";
  // Separate first/last name columns → internal keys combined into name on build
  if (h === "first" || h === "first name" || h === "firstname" || h === "given name") return "_firstName";
  if (h === "last"  || h === "last name"  || h === "lastname"  || h === "surname" || h === "family name") return "_lastName";
  for (const f of CSV_FIELDS) {
    if (f.labels.some(l => h === l || h.includes(l))) return f.key;
  }
  return "";
}

// `days` is `null` (not Infinity) when the last-gift date is missing or
// unparseable — deliberately distinct from "known to be a long time ago" so
// a donor with real giving history but a bad/blank date never reads as a
// confidently-wrong "lapsed" (that was the actual bug: Infinity > 365 is
// true, so any donor with an unparseable date silently became "lapsed").
// `hasContactInfo` (email or phone on file) gives a real, reachable path to
// "qualify" for a donor with no gift history yet but some engagement signal
// — previously "qualify" and "solicit" were structurally unreachable outputs
// of this function regardless of input.
function inferStage(total, lastGiftStr, hasContactInfo) {
  const amount = parseFloat(String(total || "0").replace(/[$,]/g, "")) || 0;
  const d = lastGiftStr ? new Date(lastGiftStr) : null;
  const days = d && !isNaN(d) ? Math.floor((Date.now() - d) / 86400000) : null;
  if (!amount && days === null) return hasContactInfo ? "qualify" : "prospect";
  if (days !== null && days > 365) return "lapsed";
  if (days !== null && days < 90 && amount > 0) return "steward";
  // A substantial gift 90–180 days ago reads as "ready for a follow-up ask"
  // rather than folding into the generic "cultivate" bucket.
  if (days !== null && days >= 90 && days <= 180 && amount >= 1000) return "solicit";
  if (amount > 0) return "cultivate";
  return "prospect";
}

const STAGE_COLORS = Object.fromEntries(STAGES.map(s => [s.id, s.color]));

// ── Normalization helpers ──────────────────────────────────────────────────
function normalizeDate(val) {
  if (val === null || val === undefined || val === "") return { value:null, warn:null };
  if (val instanceof Date) {
    return isNaN(val) ? { value:null, warn:"invalid date" } : { value:val.toISOString().split("T")[0], warn:null };
  }
  const s = String(val).trim();
  if (!s) return { value:null, warn:null };
  // Excel serial (5-digit number > 25569 = 1970-01-01)
  if (/^\d{5}$/.test(s)) {
    const n = parseInt(s);
    if (n > 25569 && n < 60000) {
      const d = new Date((n - 25569) * 86400000);
      if (!isNaN(d)) return { value:d.toISOString().split("T")[0], warn:null };
    }
  }
  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + "T12:00:00Z");
    if (!isNaN(d)) return { value:s, warn:null };
  }
  // MM/DD/YYYY or M/D/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const iso = `${mdy[3]}-${mdy[1].padStart(2,"0")}-${mdy[2].padStart(2,"0")}`;
    const d = new Date(iso + "T12:00:00Z");
    if (!isNaN(d)) return { value:iso, warn:null };
  }
  // YYYY/MM/DD
  const ymd = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (ymd) {
    const iso = `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    const d = new Date(iso + "T12:00:00Z");
    if (!isNaN(d)) return { value:iso, warn:null };
  }
  // "Jan 2023" / "January 2023"
  const monYear = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monYear) {
    const d = new Date(`${monYear[1]} 1, ${monYear[2]}`);
    if (!isNaN(d)) return { value:d.toISOString().split("T")[0], warn:null };
  }
  // Native parse as last resort (guard against bare 4-digit years)
  if (!/^\d{4}$/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d) && d.getFullYear() > 1900 && d.getFullYear() < 2100)
      return { value:d.toISOString().split("T")[0], warn:null };
  }
  return { value:null, warn:`couldn't parse date '${s}'` };
}

function normalizeMoney(val) {
  if (val === null || val === undefined || val === "") return { value:null, warn:null };
  if (typeof val === "number" && !isNaN(val)) return { value:val, warn:null };
  const s = String(val).trim();
  if (!s) return { value:null, warn:null };
  const n = parseFloat(s.replace(/[$,\s]/g, ""));
  if (isNaN(n)) return { value:null, warn:`couldn't parse amount '${s}'` };
  return { value:n, warn:null };
}

function normalizeStage(val) {
  if (!val) return null;
  const v = String(val).toLowerCase().trim();
  if (IMPORT_STAGES.includes(v)) return v;
  if (v.includes("prospect") || v.includes("lead") || v.includes("potential")) return "prospect";
  if (v.includes("qualif") || v.includes("engaged") || v.includes("warm")) return "qualify";
  if (v.includes("cultivat") || v.includes("nurtur")) return "cultivate";
  if (v.includes("solicit") || v.includes("ask") || v.includes("pledge pending") || v.includes("ready to ask")) return "solicit";
  if (v.includes("steward") || v.includes("current") || v.includes("active donor")) return "steward";
  if (v.includes("lapsed") || v.includes("inactive") || v.includes("lost") || v.includes("former")) return "lapsed";
  return null;
}

function normalizeEmail(val) {
  if (!val) return { value:null, warn:null };
  const s = String(val).trim();
  if (!s) return { value:null, warn:null };
  const lower = s.toLowerCase();
  if (!lower.includes("@") || !lower.includes(".") || lower.length < 5)
    return { value:lower, warn:`invalid email '${s}'` };
  return { value:lower, warn:null };
}

// ── Shared file-parsing helper ────────────────────────────────────────────
// Replaces the identical ~45-line xlsx/CSV block duplicated in each importer.
async function parseFileToSheets(file, { onSingle, onMulti, onError }) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type:"array" });
      const sheetsData = wb.SheetNames.map(sn => {
        const ws = wb.Sheets[sn];
        if (!ws) return null;
        const rawArr = XLSX.utils.sheet_to_json(ws, { header:1, defval:"" });
        if (rawArr.length < 2) return { name:sn, rowCount:0, headers:[], rows:[] };
        const headers = rawArr[0].map(h => String(h||"").trim());
        const dataRows = rawArr.slice(1).filter(r => r.some(c => String(c||"").trim()));
        const rows = dataRows.map(r =>
          Object.fromEntries(headers.map((h,i) => {
            const v = r[i];
            if (v instanceof Date) return [h, isNaN(v) ? "" : v.toISOString().split("T")[0]];
            return [h, String(v ?? "").trim()];
          }))
        );
        return { name:sn, rowCount:rows.length, headers, rows };
      }).filter(s => s && s.rowCount > 0);
      if (!sheetsData.length) { onError("No data rows found in this file."); return; }
      if (sheetsData.length === 1) { onSingle(sheetsData[0].headers, sheetsData[0].rows); }
      else { sheetsData.sort((a,b) => b.rowCount - a.rowCount); onMulti(sheetsData); }
    } catch(ex) { onError("Could not read Excel file: " + ex.message); }
  } else {
    Papa.parse(file, {
      header:true, skipEmptyLines:true, transformHeader: h => h.trim(),
      complete: res => {
        if (!res.data?.length) { onError("No rows found."); return; }
        onSingle(res.meta.fields || [], res.data);
      },
      error: ex => onError("Parse error: " + ex.message),
    });
  }
}

// ── Module-level column auto-mapper ──────────────────────────────────────
// Extracted from DonorImport so CombinedImport can reuse it.
function buildAutoMapping(headers, rows = []) {
  const sample = rows.slice(0, 10);
  const guesses = headers.map(h => ({ h, g: guessField(h) }));
  const hasSingleName = guesses.some(x => x.g === "name");
  const auto = {};
  guesses.forEach(({ h, g }) => {
    if (!g) return;
    if (hasSingleName && (g === "_firstName" || g === "_lastName")) return;
    if (g === "email") {
      const vals = sample.map(r => String(r[h] ?? "").trim()).filter(Boolean);
      if (vals.length && !vals.some(v => v.includes("@"))) return;
    }
    if (g === "phone") {
      const vals = sample.map(r => String(r[h] ?? "").trim()).filter(Boolean);
      if (vals.length && !vals.some(v => /\d/.test(v))) return;
    }
    auto[h] = g;
  });
  return auto;
}

// ── Module-level donor row normalization ──────────────────────────────────
// Extracted from DonorImport's built useMemo so CombinedImport can share it.
function buildDonorRows(parsed, mapping) {
  if (!parsed) return { ready:[], warned:[], skipped:[] };
  const ready = [], warned = [], skipped = [];
  parsed.rows.forEach((row, idx) => {
    const d = {};
    const warnings = [];
    const rowLabel = `Row ${idx + 2}`;
    Object.entries(mapping).forEach(([h, field]) => {
      if (!field) return;
      const raw = row[h];
      if (raw instanceof Date) { d[field] = isNaN(raw) ? "" : raw.toISOString().split("T")[0]; }
      else { d[field] = raw === null || raw === undefined ? "" : String(raw); }
    });
    if (d._firstName || d._lastName) {
      const combined = [String(d._firstName??"").trim(), String(d._lastName??"").trim()].filter(Boolean).join(" ");
      if (!d.name || !String(d.name).trim()) d.name = combined;
    }
    delete d._firstName; delete d._lastName;
    const hasName  = !!(d.name  && String(d.name).trim());
    const hasEmail = !!(d.email && String(d.email).trim());
    if (!hasName && !hasEmail) { skipped.push({ row:idx+2, reason:"no name or email" }); return; }
    if (!hasName) { d.name = String(d.email).trim(); warnings.push(`${rowLabel}: no name — using email as name`); }
    else d.name = String(d.name).trim();
    if (d.email !== undefined) { const {value,warn} = normalizeEmail(d.email); d.email=value; if(warn) warnings.push(`${rowLabel}: ${warn}`); }
    if (d.phone) d.phone = String(d.phone).trim() || null;
    if (d.total !== undefined && d.total !== "") { const {value,warn} = normalizeMoney(d.total); d.total=value; if(warn) warnings.push(`${rowLabel}: ${warn}`); }
    if (d.lastAmount !== undefined && d.lastAmount !== "") {
      const s = String(d.lastAmount||"");
      if (/^\d{4}[-/]\d{2}/.test(s)) { d.lastAmount=null; }
      else { const {value,warn} = normalizeMoney(d.lastAmount); d.lastAmount=value; if(warn) warnings.push(`${rowLabel}: ${warn}`); }
    }
    if (d.lastGift !== undefined && d.lastGift !== "") { const {value,warn} = normalizeDate(d.lastGift); d.lastGift=value; if(warn) warnings.push(`${rowLabel}: ${warn}`); }
    if (d.gifts !== undefined && d.gifts !== "") d.gifts = parseInt(d.gifts) || null;
    d.stage = normalizeStage(d.stage) || inferStage(d.total, d.lastGift, !!(d.email || d.phone));
    if (d.city)  d.city  = String(d.city).trim()  || null;
    if (d.state) d.state = String(d.state).trim()  || null;
    if (warnings.length) warned.push({ ...d, _warnings:warnings, _rowIndex:idx+2 });
    else ready.push(d);
  });
  return { ready, warned, skipped };
}

// ── Combined-row builder (donor + year-column gifts in one pass) ──────────
// Used only by CombinedImport. Preserves rowIdx so gift attachments are exact.
function buildCombinedRows(parsed, donorMapping, yearCols) {
  if (!parsed) return [];
  const activeCols = yearCols.filter(yc => yc.enabled && yc.date);
  const results = [];
  parsed.rows.forEach((row, idx) => {
    const d = {};
    const warnings = [];
    const rowLabel = `Row ${idx + 2}`;
    Object.entries(donorMapping).forEach(([h, field]) => {
      if (!field) return;
      const raw = row[h];
      if (raw instanceof Date) { d[field] = isNaN(raw) ? "" : raw.toISOString().split("T")[0]; }
      else { d[field] = raw === null || raw === undefined ? "" : String(raw); }
    });
    if (d._firstName || d._lastName) {
      const combined = [String(d._firstName??"").trim(), String(d._lastName??"").trim()].filter(Boolean).join(" ");
      if (!d.name || !String(d.name).trim()) d.name = combined;
    }
    delete d._firstName; delete d._lastName;
    const hasName  = !!(d.name  && String(d.name).trim());
    const hasEmail = !!(d.email && String(d.email).trim());
    if (!hasName && !hasEmail) { results.push({ rowIdx:idx, donor:null, gifts:[], warnings:[], skipped:true }); return; }
    if (!hasName) { d.name = String(d.email).trim(); warnings.push(`${rowLabel}: no name`); }
    else d.name = String(d.name).trim();
    if (d.email !== undefined) { const {value,warn} = normalizeEmail(d.email); d.email=value; if(warn) warnings.push(`${rowLabel}: ${warn}`); }
    if (d.phone) d.phone = String(d.phone).trim() || null;
    if (d.total !== undefined && d.total !== "") { const {value,warn} = normalizeMoney(d.total); d.total=value; if(warn) warnings.push(`${rowLabel}: ${warn}`); }
    if (d.lastAmount !== undefined && d.lastAmount !== "") {
      const s = String(d.lastAmount||"");
      if (/^\d{4}[-/]\d{2}/.test(s)) { d.lastAmount=null; }
      else { const {value,warn} = normalizeMoney(d.lastAmount); d.lastAmount=value; if(warn) warnings.push(`${rowLabel}: ${warn}`); }
    }
    if (d.lastGift !== undefined && d.lastGift !== "") { const {value,warn} = normalizeDate(d.lastGift); d.lastGift=value; if(warn) warnings.push(`${rowLabel}: ${warn}`); }
    if (d.gifts !== undefined && d.gifts !== "") d.gifts = parseInt(d.gifts) || null;
    d.stage = normalizeStage(d.stage) || inferStage(d.total, d.lastGift, !!(d.email || d.phone));
    if (d.city)  d.city  = String(d.city).trim()  || null;
    if (d.state) d.state = String(d.state).trim()  || null;
    const gifts = activeCols.map(yc => {
      const {value:amtVal} = normalizeMoney(row[yc.col]);
      const amt = Math.round(amtVal || 0);
      return amt > 0 ? { amount:amt, date:yc.date, type:"cash", campaign:"" } : null;
    }).filter(Boolean);
    results.push({ rowIdx:idx, donor:d, gifts, warnings, skipped:false });
  });
  return results;
}

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
export function DonorImport({ onClose, onImported, withHistory = false }) {
  const [csvText,    setCsvText]    = useState("");
  const [parsed,     setParsed]     = useState(null);       // { headers:[], rows:[] }
  const [xlsxSheets, setXlsxSheets]= useState(null);       // [{name, rowCount, headers, rows}] | null
  const [mapping,    setMapping]    = useState({});
  const [loading,    setLoading]    = useState(false);
  const [aiLoading,  setAiLoading]  = useState(false);
  const [result,     setResult]     = useState(null);       // {created,duplicates,warned,skipped,batchErrors}
  const [err,        setErr]        = useState("");
  const [upgradeInfo,setUpgradeInfo]= useState(null);

  const applyParsed = (headers, rows) => {
    setMapping(buildAutoMapping(headers, rows));
    setParsed({ headers, rows });
    setXlsxSheets(null);
    setErr("");
  };

  // ── File handler ──
  const handleFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setErr("");
    await parseFileToSheets(file, { onSingle:applyParsed, onMulti:s=>setXlsxSheets(s), onError:msg=>setErr(msg) });
  };

  // ── Paste flow ──
  const doParse = () => {
    if (!csvText.trim()) return;
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => h.trim(),
      complete: res => {
        if (!res.data?.length) { setErr("No rows found. Check CSV format."); return; }
        applyParsed(res.meta.fields || [], res.data);
      },
      error: ex => setErr("Parse error: " + ex.message),
    });
  };

  // ── AI column mapping ──
  const doAiMap = async () => {
    if (!parsed) return;
    setAiLoading(true);
    try {
      const sample = parsed.rows[0] || {};
      const res = await apiFetch("/ai/column-map", { method:"POST", body:JSON.stringify({ headers:parsed.headers, sample }) });
      if (res.mapping) {
        const merged = { ...mapping };
        Object.entries(res.mapping).forEach(([h, f]) => {
          if (f && VALID_IMPORT_KEYS.has(f)) merged[h] = f;
        });
        setMapping(merged);
      }
    } catch { /* keep existing mapping on AI failure */ }
    setAiLoading(false);
  };

  // ── Normalized donor build (memoized — calls the extracted buildDonorRows) ──
  const built = useMemo(() => buildDonorRows(parsed, mapping), [parsed, mapping]);

  // ── Submit import ──
  const doImport = async () => {
    // Body-build phase — wrapped in try/catch so a silent throw here is never
    // swallowed. Previously this threw before reaching the fetch with no UX feedback.
    let toSend, warnedCount, skippedCount;
    try {
      const { ready, warned, skipped } = built;
      warnedCount  = warned.length;
      skippedCount = skipped.length;
      toSend = [...ready, ...warned].map(({ _warnings, _rowIndex, ...d }) => d);
      if (!toSend.length) {
        setErr(skippedCount ? `All ${skippedCount} rows skipped — no usable name or email.` : "Nothing to import.");
        return;
      }
    } catch (e) {
      console.error("[import] failed preparing donor payload:", e);
      setErr("Failed to prepare import data — " + (e.message || "unknown error") + ". Check the browser console.");
      return;
    }

    setLoading(true); setErr("");
    try {
      let res;
      if (withHistory) {
        // One real gift per donor, derived from their imported total/last-gift
        // date — NOT a fabricated interaction (see Donors.jsx's inferStage
        // comment / WelcomePage's onboarding flow): this is the same total
        // the admin's own file already reported, just also recorded as a
        // queryable gifts-table row instead of only an aggregate donor field.
        // Uses `total` (not `lastAmount`) deliberately: /donors/import-combined
        // recalculates total_giving from the sum of each donor's actual gift
        // rows after insert, so seeding the one gift with `total` preserves
        // the imported total exactly; seeding it with a smaller `lastAmount`
        // would silently shrink total_giving down to just that one figure.
        const giftsToSend = toSend.map((d, idx) => {
          const amount = Math.round(parseFloat(d.total) || 0);
          if (amount <= 0 || !d.lastGift) return null;
          return { donorIndex: idx, amount, date: d.lastGift, type: "cash", campaign: "" };
        }).filter(Boolean);
        res = await apiFetch("/donors/import-combined", { method:"POST", body:JSON.stringify({ donors:toSend, gifts:giftsToSend }) });
      } else {
        res = await apiFetch("/donors/import", { method:"POST", body:JSON.stringify({ donors:toSend }) });
      }
      // Don't call onImported() here — result screen must render first.
      // Done button calls onImported() so the modal stays visible until user dismisses.
      setResult({ ...res, warned:warnedCount, skipped:skippedCount });
    } catch (e) {
      console.error("IMPORT FAILED:", e);
      if (e.error === "record_limit") { setUpgradeInfo(e); }
      else { setErr(e.message || "Import failed. See browser console."); }
    }
    setLoading(false);
  };

  // ── Shared styles ──
  const overlay = { position:"fixed",inset:0,background:"rgba(15,26,18,0.72)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20 };
  const modal   = { background:T.white,border:"1px solid "+T.bg3,borderRadius:20,width:"100%",maxWidth:700,maxHeight:"90vh",overflowY:"auto",padding:28,boxSizing:"border-box" };
  const inp     = { width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box" };

  // ── Result screen ──
  if (result !== null) {
    const hasBatchErrors = result.batchErrors?.length > 0;
    return (
      <div style={overlay} className="modal-sheet-overlay">
        <div style={{...modal,textAlign:"center"}} className="modal-sheet-inner">
          <div style={{fontSize:36,marginBottom:12}}>{hasBatchErrors?"⚠":"✓"}</div>
          <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:22,fontWeight:400,color:T.ink,marginBottom:12,letterSpacing:"-0.01em"}}>
            {hasBatchErrors ? "Import finished with errors." : "Import complete."}
          </div>
          <div style={{fontSize:14,color:T.ink3,marginBottom:hasBatchErrors?12:28,lineHeight:1.8}}>
            <strong style={{color:T.ink}}>{result.created}</strong> added
            {withHistory && result.giftsInserted > 0 && <> · <strong>{result.giftsInserted}</strong> gifts attached</>}
            {result.duplicates > 0 && <> · <strong>{result.duplicates}</strong> duplicates skipped</>}
            {result.warned > 0    && <> · <strong>{result.warned}</strong> imported with warnings</>}
            {result.skipped > 0   && <> · <strong>{result.skipped}</strong> skipped (no name or email)</>}
          </div>
          {hasBatchErrors && (
            <div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:10,padding:"10px 14px",marginBottom:24,textAlign:"left",fontSize:12,color:"#991b1b"}}>
              <strong>Batch errors — some rows may not have been inserted:</strong>
              {result.batchErrors.map((e,i) => <div key={i} style={{marginTop:4}}>Rows {e.rows}: {e.error}</div>)}
            </div>
          )}
          <button onClick={onImported} style={{background:"#10b981",border:"none",borderRadius:10,padding:"12px 28px",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Done</button>
        </div>
      </div>
    );
  }

  const { ready, warned, skipped } = built;
  const totalToImport = ready.length + warned.length;

  return (
    <div style={overlay} className="modal-sheet-overlay">
      <div style={modal} className="modal-sheet-inner">

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:T.ink}}>Import Donors</div>
            <div style={{fontSize:13,color:T.ink3,marginTop:2}}>CSV, TSV, or Excel · columns auto-mapped · stages auto-assigned</div>
          </div>
          <button onClick={onClose} style={{background:T.bg3,border:"none",borderRadius:8,padding:"6px 12px",color:T.ink3,cursor:"pointer",fontSize:13,flexShrink:0}}>✕ Close</button>
        </div>

        {/* ── Step 1a: Upload / Paste ── */}
        {!parsed && !xlsxSheets && (<>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Upload file</div>
            <input type="file" accept=".csv,.tsv,.xlsx,.xls" onChange={handleFile} style={{fontSize:13,color:T.ink3}}/>
            <div style={{fontSize:11,color:T.ink3,marginTop:5}}>Supports .csv, .tsv, .xlsx, .xls — multi-tab Excel files will let you pick the right sheet.</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <div style={{flex:1,height:1,background:T.bg3}}/><span style={{fontSize:12,color:T.ink3}}>or paste CSV text</span><div style={{flex:1,height:1,background:T.bg3}}/>
          </div>
          <textarea value={csvText} onChange={e=>setCsvText(e.target.value)} rows={6}
            placeholder={"Name,Email,Total Giving,Last Gift Date\nJane Smith,jane@example.com,5000,2024-11-01"}
            style={{...inp,resize:"vertical",lineHeight:1.5,marginBottom:12}}/>
          {err && <div style={{color:"#f87171",fontSize:12,marginBottom:10}}>{err}</div>}
          <button onClick={doParse} disabled={!csvText.trim()}
            style={{background:csvText.trim()?"linear-gradient(135deg,#10b981,#3b82f6)":T.bg2,border:"none",borderRadius:10,padding:"11px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:csvText.trim()?"pointer":"not-allowed",opacity:csvText.trim()?1:0.5}}>
            Parse →
          </button>
        </>)}

        {/* ── Step 1b: Multi-sheet picker (xlsx with 2+ data sheets) ── */}
        {!parsed && xlsxSheets && (<>
          <div style={{fontSize:14,fontWeight:700,color:T.ink,marginBottom:4}}>This workbook has {xlsxSheets.length} sheets with data.</div>
          <div style={{fontSize:13,color:T.ink3,marginBottom:16}}>Pick the sheet to import. You can import the others separately afterward.</div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
            {xlsxSheets.map((s,i) => (
              <div key={s.name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 16px"}}>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:T.ink}}>{s.name}</div>
                  <div style={{fontSize:12,color:T.ink3,marginTop:2}}>{s.rowCount.toLocaleString()} rows · {s.headers.filter(Boolean).length} columns</div>
                </div>
                <button onClick={()=>applyParsed(s.headers,s.rows)}
                  style={{background:"#1a6b4a",border:"none",borderRadius:8,padding:"8px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                  {i===0?"Use this ←":"Select"}
                </button>
              </div>
            ))}
          </div>
          <button onClick={()=>setXlsxSheets(null)} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"9px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>← Back</button>
        </>)}

        {/* ── Step 2: Column mapping + validation preview ── */}
        {parsed && (<>

          {/* Column mapper */}
          <div style={{marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{fontSize:13,fontWeight:700,color:T.ink}}>
                Map Columns <span style={{fontSize:11,color:T.ink3,fontWeight:400}}>({parsed.headers.length} columns · {parsed.rows.length.toLocaleString()} rows)</span>
              </div>
              <button onClick={doAiMap} disabled={aiLoading}
                style={{background:aiLoading?"#1a2235":"linear-gradient(135deg,#1a6b4a,#2563eb)",border:"none",borderRadius:8,padding:"6px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:aiLoading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:6,opacity:aiLoading?0.7:1}}>
                {aiLoading?<><Spin/>Mapping…</>:<>✦ Auto-map</>}
              </button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {parsed.headers.map(h => (
                <div key={h} style={{display:"flex",alignItems:"center",gap:6,background:mapping[h]?T.bg:"transparent",borderRadius:7,padding:"5px 8px",border:`1px solid ${mapping[h]?T.bg3:"transparent"}`}}>
                  <span style={{fontSize:12,color:mapping[h]?T.ink:T.ink3,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}} title={h||"(blank)"}>{h||"(blank)"}</span>
                  <select value={mapping[h]||""} onChange={e=>setMapping(p=>({...p,[h]:e.target.value}))}
                    style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 6px",color:T.ink,fontSize:11,outline:"none",flexShrink:0}}>
                    <option value="">— skip —</option>
                    <option value="_firstName">firstName</option>
                    <option value="_lastName">lastName</option>
                    {CSV_FIELDS.map(f=><option key={f.key} value={f.key}>{f.key}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Validation summary */}
          <div style={{background:T.bg,borderRadius:10,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:700,color:T.ink,marginBottom:warned.length||skipped.length?8:0}}>
              {totalToImport>0
                ? <>{" "}<span style={{color:"#10b981"}}>{totalToImport.toLocaleString()}</span>{" ready"}
                    {warned.length>0&&<>{" · "}<span style={{color:"#f59e0b"}}>{warned.length}</span>{" with warnings"}</>}
                    {skipped.length>0&&<>{" · "}<span style={{color:T.ink3}}>{skipped.length}</span>{" skipped (no name or email)"}</>}</>
                : <span style={{color:T.ink3}}>No rows ready — map at least one column to <em>name</em> or <em>email</em>.</span>}
            </div>
            {warned.slice(0,5).flatMap(d=>d._warnings).slice(0,6).map((w,i)=>(
              <div key={i} style={{fontSize:11,color:"#92400e",background:"#fef3c7",borderRadius:5,padding:"3px 8px",marginTop:4,display:"inline-block",marginRight:4}}>⚠ {w}</div>
            ))}
            {warned.length>5&&<div style={{fontSize:11,color:T.ink3,marginTop:6}}>{warned.length-5} more rows with warnings — they will still import.</div>}
            {skipped.length>0&&<div style={{fontSize:11,color:T.ink3,marginTop:4}}>Skipped: {skipped.slice(0,3).map(s=>`row ${s.row}`).join(", ")}{skipped.length>3?` +${skipped.length-3} more`:""}</div>}
          </div>

          {/* Smart stage assignment preview */}
          {(()=>{
            const all=[...ready,...warned];
            const stageCounts={};
            all.forEach(d=>{stageCounts[d.stage]=(stageCounts[d.stage]||0)+1;});
            return Object.keys(stageCounts).length>0&&(
              <div style={{background:T.bg,borderRadius:10,padding:"10px 14px",marginBottom:12}}>
                <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:6}}>Smart Stage Assignment Preview</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {Object.entries(stageCounts).map(([s,n])=>(
                    <span key={s} style={{fontSize:12,fontWeight:600,padding:"3px 10px",borderRadius:99,background:(STAGE_COLORS[s]||T.ink3)+"22",color:STAGE_COLORS[s]||T.ink3,border:`1px solid ${(STAGE_COLORS[s]||T.ink3)}30`}}>
                      {s} × {n}
                    </span>
                  ))}
                </div>
                <div style={{fontSize:11,color:T.ink3,marginTop:6}}>Based on last gift date + amount. Override after import by dragging in the Kanban.</div>
              </div>
            );
          })()}

          {/* Row preview table */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:600,color:T.ink3,marginBottom:6}}>{parsed.rows.length.toLocaleString()} rows · showing first 5</div>
            <div style={{overflowX:"auto",border:"1px solid "+T.bg3,borderRadius:8}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:T.bg}}>
                  {parsed.headers.filter(h=>mapping[h]).map(h=><th key={h} style={{padding:"6px 10px",textAlign:"left",color:T.ink3,fontWeight:600,borderBottom:"1px solid "+T.bg3,whiteSpace:"nowrap"}}>{mapping[h]}</th>)}
                  <th style={{padding:"6px 10px",textAlign:"left",color:T.ink3,fontWeight:600,borderBottom:"1px solid "+T.bg3}}>stage</th>
                </tr></thead>
                <tbody>{parsed.rows.slice(0,5).map((row,i)=>{
                  const d={};Object.entries(mapping).forEach(([h,f])=>{if(f)d[f]=row[h];});
                  const st=inferStage(d.total,d.lastGift);
                  return(
                    <tr key={i} style={{borderBottom:"1px solid "+T.bg2}}>
                      {parsed.headers.filter(h=>mapping[h]).map(h=><td key={h} style={{padding:"6px 10px",color:T.ink,maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row[h]}</td>)}
                      <td style={{padding:"6px 10px"}}>
                        <span style={{fontSize:11,fontWeight:600,padding:"2px 8px",borderRadius:99,background:(STAGE_COLORS[st]||T.ink3)+"22",color:STAGE_COLORS[st]||T.ink3}}>{st}</span>
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </div>

          {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:10}}>{err}</div>}
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>{setParsed(null);setErr("");}}
              style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 18px",color:T.ink3,fontSize:13,cursor:"pointer"}}>← Back</button>
            <button onClick={doImport} disabled={loading||totalToImport===0}
              style={{flex:1,background:loading||totalToImport===0?T.bg2:"linear-gradient(135deg,#10b981,#3b82f6)",border:"none",borderRadius:10,padding:"11px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:loading||totalToImport===0?"not-allowed":"pointer",opacity:loading||totalToImport===0?0.6:1}}>
              {loading?"Importing…":`Import ${totalToImport.toLocaleString()} Donors →`}
            </button>
          </div>
        </>)}
      </div>
      {upgradeInfo&&<UpgradeModal open={true} onClose={()=>{setUpgradeInfo(null);onClose();}} reason={upgradeInfo.error} current={upgradeInfo.current} limit={upgradeInfo.limit} plan={upgradeInfo.plan}/>}
    </div>
  );
}

// ── Gift History Import helpers ────────────────────────────────────────────
const YEAR_HDR_PAT = /(19|20)\d{2}|fy[\s_-]?\d{2,4}|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*[\s\-]+(19|20)\d{2}/i;

function detectGiftFormat(headers) {
  const yearCols = headers.filter(h => YEAR_HDR_PAT.test(String(h)));
  const hasDateCol = headers.some(h => /\bdate\b|\bwhen\b/i.test(String(h)));
  if (yearCols.length >= 2 && !hasDateCol) return "wide";
  const hasAmtCol = headers.some(h => /^(amount|gift|giving|donation)\b/i.test(String(h).trim()) && !/\b(19|20)\d{2}\b/.test(String(h)));
  if (hasAmtCol && hasDateCol) return "transactional";
  if (yearCols.length >= 2) return "wide";
  return "transactional";
}

function yearColToDate(header, convention) {
  const h = String(header);
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

function normalizeNameForDonorMatch(name) {
  if (!name) return "";
  let s = String(name).trim().toLowerCase().replace(/\s+/g, " ");
  const ci = s.indexOf(",");
  if (ci > 0) s = `${s.slice(ci+1).trim()} ${s.slice(0,ci).trim()}`;
  return s;
}

function matchDonorForGift(rawName, rawEmail, donors) {
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
    const partial = donors.filter(d => {
      const dn = normalizeNameForDonorMatch(d.name);
      return dn.length > 3 && (dn.includes(norm) || norm.includes(dn));
    });
    if (partial.length === 1) return { confidence:"low", suggestedDonor:partial[0],   ambiguousDonors:null };
    if (partial.length > 1)   return { confidence:"low", suggestedDonor:null,          ambiguousDonors:partial.slice(0,5) };
  }
  return { confidence:"unmatched", suggestedDonor:null, ambiguousDonors:null };
}

function autoDetectWideConfig(headers, rows) {
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

function autoDetectTxMapping(headers, rows) {
  const map = { donorName:"",donorEmail:"",amount:"",date:"",type:"",campaign:"",notes:"" };
  const sample = rows.slice(0,10);
  for (const h of headers) {
    const hl = h.toLowerCase().trim();
    if (!map.donorName  && /^(name|full.?name|donor.?name|donor|contact|first.?name)$/.test(hl)) map.donorName  = h;
    if (!map.donorEmail && /^(email|email.?address|e-?mail)$/.test(hl))                          map.donorEmail = h;
    if (!map.amount     && /^(amount|gift.?amount|donation.?amount|gift|giving|sum)$/.test(hl)) {
      if (sample.some(r => !isNaN(parseFloat(String(r[h]||"").replace(/[$,]/g,""))))) map.amount = h;
    }
    if (!map.date     && /^(date|gift.?date|donation.?date|when)$/.test(hl))           map.date     = h;
    if (!map.type     && /^(type|gift.?type|payment.?type|method|payment)$/.test(hl)) map.type     = h;
    if (!map.campaign && /^(campaign|fund|appeal|designation)$/.test(hl))              map.campaign = h;
    if (!map.notes    && /^(notes?|memo|comments?)$/.test(hl))                         map.notes    = h;
  }
  return map;
}

// ── GiftHistoryImport ──────────────────────────────────────────────────────
function GiftHistoryImport({ donors, onClose, onImported }) {
  const [step, setStep]             = useState("upload");
  const [csvText, setCsvText]       = useState("");
  const [xlsxSheets, setXlsxSheets] = useState(null);
  const [parsed, setParsed]         = useState(null);
  const [err, setErr]               = useState("");

  const [detectedFormat, setDetectedFormat] = useState("transactional");
  const [formatOverride, setFormatOverride] = useState(null);
  const effectiveFormat = formatOverride || detectedFormat;

  const [yearCols, setYearCols]             = useState([]);
  const [yearConvention, setYearConvention] = useState("dec31");
  const [wideDonorNameCol, setWideDonorNameCol]   = useState("");
  const [wideDonorEmailCol, setWideDonorEmailCol] = useState("");

  const [txMap, setTxMap] = useState({ donorName:"",donorEmail:"",amount:"",date:"",type:"",campaign:"",notes:"" });

  const [matchedGifts, setMatchedGifts] = useState([]);
  const [overrides, setOverrides]       = useState({});
  const [pickingIdx, setPickingIdx]     = useState(null);
  const [pickSearch, setPickSearch]     = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);

  const overlay = { position:"fixed",inset:0,background:"rgba(15,26,18,0.72)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20 };
  const modal   = { background:T.white,border:"1px solid "+T.bg3,borderRadius:20,width:"100%",maxWidth:720,maxHeight:"90vh",overflowY:"auto",padding:28,boxSizing:"border-box" };
  const inp     = { width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box" };

  const handleFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setErr("");
    await parseFileToSheets(file, { onSingle:applyParsed, onMulti:s=>setXlsxSheets(s), onError:msg=>setErr(msg) });
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

  const buildPreview = () => {
    setErr("");
    const gifts = [];
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
          const amt = Math.round(amtVal || 0);
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
        const amt = Math.round(amtVal || 0);
        if (amt <= 0) continue;
        const rawDate = txMap.date ? row[txMap.date] : null;
        const { value: parsedDate } = normalizeDate(rawDate || "");
        const finalDate = parsedDate || new Date().toISOString().split("T")[0];
        const match = matchDonorForGift(rawName, rawEmail, donors);
        gifts.push({
          amount:amt, date:finalDate,
          type:     txMap.type     ? (String(row[txMap.type]    ||"").toLowerCase() || "cash") : "cash",
          campaign: txMap.campaign ? String(row[txMap.campaign] ||"") : "",
          notes:    txMap.notes    ? String(row[txMap.notes]    ||"") : "",
          rawName, rawEmail, rawSource:`row ${i+2}`, ...match,
        });
      }
    }
    if (!gifts.length) { setErr("No valid gift rows found. Check your column mapping."); return; }
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

  const doImport = async () => {
    const toSend = matchedGifts.map((g,i) => {
      const ov = overrides[i];
      if (ov?.action === "skip")              return null;
      if (g.confidence === "unmatched")       return null;
      if (g.confidence === "low" && !ov)      return null;
      const donorId = ov?.donorId || g.suggestedDonor?.id;
      if (!donorId)                           return null;
      return { donorId, amount:g.amount, date:g.date, type:g.type, campaign:g.campaign, notes:g.notes };
    }).filter(Boolean);
    if (!toSend.length) { setErr("No gifts to import."); return; }
    setLoading(true); setErr("");
    try {
      const res = await apiFetch("/gifts/import-history", { method:"POST", body:JSON.stringify({ gifts:toSend }) });
      setResult(res); setStep("result");
    } catch(e) { setErr(e.message || "Import failed."); }
    setLoading(false);
  };

  if (step === "result" && result) {
    return (
      <div style={overlay} className="modal-sheet-overlay">
        <div style={{...modal,textAlign:"center"}} className="modal-sheet-inner">
          <div style={{fontSize:36,marginBottom:12}}>✓</div>
          <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:22,fontWeight:400,color:T.ink,marginBottom:12,letterSpacing:"-0.01em"}}>
            Import complete.
          </div>
          <div style={{fontSize:14,color:T.ink3,marginBottom:16,lineHeight:1.8}}>
            <strong style={{color:T.ink}}>{result.inserted}</strong> gifts imported across{" "}
            <strong style={{color:T.ink}}>{result.donorsUpdated}</strong> donors
            {result.duplicates > 0 && <> · <strong>{result.duplicates}</strong> duplicates skipped</>}
          </div>
          <div style={{fontSize:12,color:T.ink3,marginBottom:28}}>Donor giving totals have been recalculated from the gifts table.</div>
          <button onClick={onImported} style={{background:"#10b981",border:"none",borderRadius:10,padding:"12px 28px",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div style={overlay} className="modal-sheet-overlay">
      <div style={modal} className="modal-sheet-inner">

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:T.ink}}>Import Giving History</div>
            <div style={{fontSize:13,color:T.ink3,marginTop:2}}>Attach historical gifts to existing donors · CSV, TSV, or Excel</div>
          </div>
          <button onClick={onClose} style={{background:T.bg3,border:"none",borderRadius:8,padding:"6px 12px",color:T.ink3,cursor:"pointer",fontSize:13,flexShrink:0}}>✕ Close</button>
        </div>

        {/* Upload */}
        {step === "upload" && !xlsxSheets && (<>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Upload file</div>
            <input type="file" accept=".csv,.tsv,.xlsx,.xls" onChange={handleFile} style={{fontSize:13,color:T.ink3}}/>
            <div style={{fontSize:11,color:T.ink3,marginTop:5}}>Wide format (one row/donor, year columns) or transactional (one row/gift) — auto-detected.</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <div style={{flex:1,height:1,background:T.bg3}}/><span style={{fontSize:12,color:T.ink3}}>or paste CSV text</span><div style={{flex:1,height:1,background:T.bg3}}/>
          </div>
          <textarea value={csvText} onChange={e=>setCsvText(e.target.value)} rows={5}
            placeholder={"Donor,Email,2021 Gift,2022 Gift,2023 Gift\nJane Smith,jane@example.com,500,750,1000"}
            style={{...inp,resize:"vertical",lineHeight:1.5,marginBottom:12}}/>
          {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:10}}>{err}</div>}
          <button onClick={doPaste} disabled={!csvText.trim()}
            style={{background:csvText.trim()?"linear-gradient(135deg,#10b981,#3b82f6)":T.bg2,border:"none",borderRadius:10,padding:"11px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:csvText.trim()?"pointer":"not-allowed",opacity:csvText.trim()?1:0.5}}>
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
                <button onClick={()=>applyParsed(s.headers,s.rows)}
                  style={{background:"#1a6b4a",border:"none",borderRadius:8,padding:"8px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
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
                Detected: <span style={{color:effectiveFormat==="wide"?"#8b5cf6":"#10b981"}}>
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
              <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Year Date Convention</div>
              <div style={{display:"flex",gap:8}}>
                {[["dec31","Dec 31 (end of year)"],["first","Jan 1 (start of year)"]].map(([v,l])=>(
                  <button key={v} onClick={()=>onConventionChange(v)}
                    style={{flex:1,background:yearConvention===v?T.bg2:"transparent",border:`1px solid ${yearConvention===v?T.greenDk:T.bg3}`,borderRadius:8,padding:"8px 12px",color:yearConvention===v?T.greenDk:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer",textAlign:"left"}}>
                    {l}
                    {v==="dec31"&&<span style={{fontSize:10,color:T.ink3,display:"block",fontWeight:400,marginTop:1}}>Default — treats each gift as end-of-year</span>}
                  </button>
                ))}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              {[["Donor Name Column",wideDonorNameCol,setWideDonorNameCol],["Donor Email Column",wideDonorEmailCol,setWideDonorEmailCol]].map(([label,val,setter])=>(
                <div key={label}>
                  <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>{label}</div>
                  <select value={val} onChange={e=>setter(e.target.value)} style={{...inp,cursor:"pointer"}}>
                    <option value="">— not in file —</option>
                    {parsed.headers.filter(h=>!YEAR_HDR_PAT.test(h)).map(h=><option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>
                Gift Year Columns — {yearCols.filter(yc=>yc.enabled).length}/{yearCols.length} enabled
              </div>
              {yearCols.length===0&&(
                <div style={{color:"#f59e0b",fontSize:13,background:"#fef3c7",borderRadius:8,padding:"10px 12px"}}>
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
              <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Map Columns</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[
                  ["Donor Name","donorName","for matching"],
                  ["Donor Email","donorEmail","email match = highest confidence"],
                  ["Amount *","amount","required"],
                  ["Gift Date","date","ISO, M/D/YYYY, Excel serial"],
                  ["Gift Type","type","cash, check, online…"],
                  ["Campaign / Fund","campaign",""],
                  ["Notes","notes",""],
                ].map(([label,key,hint])=>(
                  <div key={key}>
                    <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>
                      {label}{hint&&<span style={{fontSize:10,fontWeight:400,marginLeft:4,textTransform:"none",color:T.ink3}}>· {hint}</span>}
                    </div>
                    <select value={txMap[key]||""} onChange={e=>setTxMap(m=>({...m,[key]:e.target.value}))}
                      style={{...inp,cursor:"pointer",fontSize:12}}>
                      <option value="">— skip —</option>
                      {parsed.headers.map(h=><option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:10}}>{err}</div>}
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>{setParsed(null);setStep("upload");setErr("");}}
              style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 18px",color:T.ink3,fontSize:13,cursor:"pointer"}}>← Back</button>
            <button onClick={buildPreview}
              style={{flex:1,background:"linear-gradient(135deg,#1a6b4a,#2563eb)",border:"none",borderRadius:10,padding:"11px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>
              Match Donors & Preview →
            </button>
          </div>
        </>)}

        {/* Preview */}
        {step === "preview" && (<>

          {/* Summary card */}
          <div style={{background:T.bg,borderRadius:12,padding:"14px 16px",marginBottom:16}}>
            <div style={{fontSize:15,fontWeight:700,color:T.ink,marginBottom:8}}>
              <span style={{color:"#10b981"}}>{stats.toImportCount}</span> gifts ready to import, attaching to{" "}
              <span style={{color:T.ink}}>{stats.donorCount}</span> donors
              {stats.lowPending>0&&<> · <span style={{color:"#f59e0b"}}>{stats.lowPending} need review</span></>}
              {stats.unmatched>0&&<> · <span style={{color:T.ink3}}>{stats.unmatched} unmatched (will skip)</span></>}
            </div>
            <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
              {[[stats.high,"#10b981","high confidence (email)"],[stats.medium,"#3b82f6","medium (name match)"],[stats.low,"#f59e0b","low (review)"],[stats.unmatched,T.ink3,"unmatched"]].filter(([n])=>n>0).map(([n,color,label])=>(
                <span key={label} style={{fontSize:12}}><span style={{color,fontWeight:700}}>{n}</span> <span style={{color:T.ink3}}>{label}</span></span>
              ))}
            </div>
          </div>

          {/* Low confidence review list */}
          {stats.low > 0 && (
            <div style={{marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:"#92400e",textTransform:"uppercase",letterSpacing:"0.08em"}}>
                  ⚠ Low Confidence — {stats.lowPending} pending review
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
                    <div key={i} style={{background:ov?.action==="skip"?T.bg:"#fef9f0",border:`1px solid ${ov?.action==="skip"?T.bg3:"#fde68a"}`,borderRadius:10,padding:"10px 12px",opacity:ov?.action==="skip"?0.55:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5,flexWrap:"wrap"}}>
                        <span style={{fontSize:13,fontWeight:700,color:T.ink}}>${g.amount.toLocaleString()}</span>
                        <span style={{fontSize:12,color:T.ink3}}>{g.date}</span>
                        <span style={{fontSize:12,color:T.ink}}>· {g.rawName||g.rawEmail}</span>
                        <span style={{fontSize:11,color:T.ink3}}>({g.rawSource})</span>
                      </div>
                      {!ov&&g.ambiguousDonors&&(
                        <div style={{marginBottom:6}}>
                          <div style={{fontSize:11,color:"#92400e",marginBottom:4}}>Multiple donors with this name — select one:</div>
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
                          <span style={{color:"#f59e0b",marginLeft:4}}>— partial match</span>
                        </div>
                      )}
                      {(ov?.action==="confirm"||ov?.action==="pick")&&(
                        <div style={{fontSize:12,color:"#10b981",marginBottom:5}}>✓ Will attach to: <strong>{ov.donorName}</strong></div>
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
                                const hits = donors.filter(d=>d.name.toLowerCase().includes(q)||(d.email||"").toLowerCase().includes(q)).slice(0,8);
                                return hits.length ? hits.map(d=>(
                                  <div key={d.id} onClick={()=>{setOverrides(p=>({...p,[i]:{action:"pick",donorId:d.id,donorName:d.name}}));setPickingIdx(null);setPickSearch("");}}
                                    style={{padding:"7px 12px",cursor:"pointer",fontSize:12,color:T.ink,borderBottom:"1px solid "+T.bg2}}>
                                    <strong>{d.name}</strong>{d.email?` — ${d.email}`:""}
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
                            style={{background:"#10b981",border:"none",borderRadius:7,padding:"5px 12px",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>
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

          {/* Unmatched */}
          {stats.unmatched > 0 && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:12,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>
                ✗ {stats.unmatched} Unmatched — Will Be Skipped
              </div>
              <div style={{fontSize:11,color:T.ink3,marginBottom:6}}>
                These donors don't exist yet — import them first via donor import, or use combined mode later.
              </div>
              <div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:8,padding:"8px 12px"}}>
                {matchedGifts.filter(g=>g.confidence==="unmatched").slice(0,8).map((g,i)=>(
                  <div key={i} style={{fontSize:12,color:"#991b1b",padding:"2px 0"}}>
                    · {g.rawName||g.rawEmail} — ${g.amount.toLocaleString()} on {g.date}
                  </div>
                ))}
                {stats.unmatched>8&&<div style={{fontSize:12,color:"#991b1b",marginTop:4}}>…and {stats.unmatched-8} more</div>}
              </div>
            </div>
          )}

          {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:10}}>{err}</div>}
          <div style={{display:"flex",gap:10,marginTop:4}}>
            <button onClick={()=>setStep("configure")}
              style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 18px",color:T.ink3,fontSize:13,cursor:"pointer"}}>← Back</button>
            <button onClick={doImport} disabled={loading||stats.toImportCount===0}
              style={{flex:1,background:loading||stats.toImportCount===0?T.bg2:"linear-gradient(135deg,#10b981,#3b82f6)",border:"none",borderRadius:10,padding:"11px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:loading||stats.toImportCount===0?"not-allowed":"pointer",opacity:loading||stats.toImportCount===0?0.6:1}}>
              {loading?"Importing…":`Import ${stats.toImportCount} Gifts →`}
            </button>
          </div>
          {stats.lowPending>0&&<div style={{fontSize:11,color:T.ink3,marginTop:8,textAlign:"center"}}>{stats.lowPending} low-confidence gifts need review before they'll be included in the import.</div>}
        </>)}

      </div>
    </div>
  );
}

// ── CombinedImport ─────────────────────────────────────────────────────────
function CombinedImport({ onClose, onImported }) {
  const [step, setStep]             = useState("upload");
  const [csvText, setCsvText]       = useState("");
  const [xlsxSheets, setXlsxSheets] = useState(null);
  const [parsed, setParsed]         = useState(null);
  const [err, setErr]               = useState("");

  const [donorMapping, setDonorMapping]     = useState({});
  const [yearCols, setYearCols]             = useState([]);
  const [yearConvention, setYearConvention] = useState("dec31");

  const [combinedRows, setCombinedRows] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const [upgradeInfo, setUpgradeInfo] = useState(null);

  const overlay = { position:"fixed",inset:0,background:"rgba(15,26,18,0.72)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20 };
  const modal   = { background:T.white,border:"1px solid "+T.bg3,borderRadius:20,width:"100%",maxWidth:720,maxHeight:"90vh",overflowY:"auto",padding:28,boxSizing:"border-box" };
  const inp     = { width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box" };

  // Non-year headers only — used for donor field mapping
  const donorHeaders = parsed?.headers.filter(h => !YEAR_HDR_PAT.test(h)) ?? [];

  const applyParsed = (headers, rows) => {
    const nonYear = headers.filter(h => !YEAR_HDR_PAT.test(h));
    setDonorMapping(buildAutoMapping(nonYear, rows));
    const cfg = autoDetectWideConfig(headers, rows);
    setYearCols(cfg.yearCols.map(col => ({ col, date: yearColToDate(col,"dec31"), enabled:true })));
    setParsed({ headers, rows }); setXlsxSheets(null); setErr("");
    setStep("configure");
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setErr("");
    await parseFileToSheets(file, { onSingle:applyParsed, onMulti:s=>setXlsxSheets(s), onError:msg=>setErr(msg) });
  };

  const doPaste = () => {
    if (!csvText.trim()) return;
    Papa.parse(csvText, {
      header:true, skipEmptyLines:true, transformHeader:h=>h.trim(),
      complete: res => { if (!res.data?.length) { setErr("No rows found."); return; } applyParsed(res.meta.fields||[], res.data); },
      error: ex => setErr("Parse error: " + ex.message),
    });
  };

  const onConventionChange = (val) => {
    setYearConvention(val);
    setYearCols(cols => cols.map(yc => ({ ...yc, date: yearColToDate(yc.col, val) })));
  };

  const buildPreview = () => {
    setErr("");
    if (!parsed) return;
    const rows = buildCombinedRows(parsed, donorMapping, yearCols);
    if (!rows.some(r => !r.skipped)) { setErr("No valid rows — map a name or email column."); return; }
    setCombinedRows(rows);
    setStep("preview");
  };

  const stats = useMemo(() => {
    const valid   = combinedRows.filter(r => !r.skipped);
    const skipped = combinedRows.filter(r => r.skipped).length;
    const warned  = valid.filter(r => r.warnings.length > 0).length;
    const gifts   = valid.reduce((s,r) => s + r.gifts.length, 0);
    return { donors:valid.length, gifts, warned, skipped };
  }, [combinedRows]);

  const doImport = async () => {
    const validRows = combinedRows.filter(r => !r.skipped);
    const donors = validRows.map(({donor}) => { const {_warnings,_rowIndex,...d}=donor; return d; });
    const gifts  = [];
    validRows.forEach(({gifts:rg}, idx) => rg.forEach(g => gifts.push({ ...g, donorIndex:idx })));
    if (!donors.length) { setErr("No donors to import."); return; }
    setLoading(true); setErr("");
    try {
      const res = await apiFetch("/donors/import-combined", { method:"POST", body:JSON.stringify({ donors, gifts }) });
      setResult(res); setStep("result");
    } catch(e) {
      if (e.error === "record_limit") setUpgradeInfo(e);
      else setErr(e.message || "Import failed.");
    }
    setLoading(false);
  };

  // Result screen
  if (step === "result" && result) {
    return (
      <div style={overlay} className="modal-sheet-overlay">
        <div style={{...modal,textAlign:"center"}} className="modal-sheet-inner">
          <div style={{fontSize:36,marginBottom:12}}>✓</div>
          <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:22,fontWeight:400,color:T.ink,marginBottom:12,letterSpacing:"-0.01em"}}>Import complete.</div>
          <div style={{fontSize:14,color:T.ink3,marginBottom:20,lineHeight:1.8}}>
            <strong style={{color:T.ink}}>{result.created}</strong> donors created &nbsp;·&nbsp;
            <strong style={{color:T.ink}}>{result.giftsInserted}</strong> gifts attached
            {result.duplicates>0 && <> &nbsp;·&nbsp; <strong>{result.duplicates}</strong> duplicates skipped</>}
          </div>
          {result.donorsUpdated>0 && <div style={{fontSize:12,color:T.ink3,marginBottom:24}}>{result.donorsUpdated} donor giving total{result.donorsUpdated!==1?"s":""} recalculated.</div>}
          <button onClick={onImported} style={{background:"#10b981",border:"none",borderRadius:10,padding:"12px 28px",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div style={overlay} className="modal-sheet-overlay">
      <div style={modal} className="modal-sheet-inner">

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:T.ink}}>Import Donors + History</div>
            <div style={{fontSize:13,color:T.ink3,marginTop:2}}>One wide file: donor info + year-column gifts — creates donors and attaches their history in one step</div>
          </div>
          <button onClick={onClose} style={{background:T.bg3,border:"none",borderRadius:8,padding:"6px 12px",color:T.ink3,cursor:"pointer",fontSize:13,flexShrink:0}}>✕ Close</button>
        </div>

        {/* Upload */}
        {step === "upload" && !xlsxSheets && (<>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Upload file</div>
            <input type="file" accept=".csv,.tsv,.xlsx,.xls" onChange={handleFile} style={{fontSize:13,color:T.ink3}}/>
            <div style={{fontSize:11,color:T.ink3,marginTop:5}}>Wide format with donor columns (Name, Email…) and gift year columns (2021, 2022 Gift, Jan 2023…).</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <div style={{flex:1,height:1,background:T.bg3}}/><span style={{fontSize:12,color:T.ink3}}>or paste CSV text</span><div style={{flex:1,height:1,background:T.bg3}}/>
          </div>
          <textarea value={csvText} onChange={e=>setCsvText(e.target.value)} rows={5}
            placeholder={"Name,Email,2021 Gift,2022 Gift,2023 Gift\nJane Smith,jane@example.com,500,750,1000"}
            style={{...inp,resize:"vertical",lineHeight:1.5,marginBottom:12}}/>
          {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:10}}>{err}</div>}
          <button onClick={doPaste} disabled={!csvText.trim()}
            style={{background:csvText.trim()?"linear-gradient(135deg,#10b981,#3b82f6)":T.bg2,border:"none",borderRadius:10,padding:"11px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:csvText.trim()?"pointer":"not-allowed",opacity:csvText.trim()?1:0.5}}>
            Parse →
          </button>
        </>)}

        {/* Sheet picker */}
        {step === "upload" && xlsxSheets && (<>
          <div style={{fontSize:14,fontWeight:700,color:T.ink,marginBottom:4}}>This workbook has {xlsxSheets.length} sheets with data.</div>
          <div style={{fontSize:13,color:T.ink3,marginBottom:16}}>Pick the sheet to import.</div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
            {xlsxSheets.map((s,i) => (
              <div key={s.name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 16px"}}>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:T.ink}}>{s.name}</div>
                  <div style={{fontSize:12,color:T.ink3,marginTop:2}}>{s.rowCount.toLocaleString()} rows · {s.headers.filter(Boolean).length} columns</div>
                </div>
                <button onClick={()=>applyParsed(s.headers,s.rows)}
                  style={{background:"#1a6b4a",border:"none",borderRadius:8,padding:"8px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                  {i===0?"Use this ←":"Select"}
                </button>
              </div>
            ))}
          </div>
          <button onClick={()=>setXlsxSheets(null)} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"9px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>← Back</button>
        </>)}

        {/* Configure */}
        {step === "configure" && parsed && (<>

          <div style={{background:T.bg,borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:12,color:T.ink3}}>
            {parsed.rows.length.toLocaleString()} rows · {parsed.headers.length} columns &nbsp;·&nbsp;
            {donorHeaders.length} donor field{donorHeaders.length!==1?"s":""} · {yearCols.length} year column{yearCols.length!==1?"s":""}
          </div>

          {/* Donor field mapping */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>
              Donor Field Mapping
            </div>
            {donorHeaders.length === 0
              ? <div style={{fontSize:13,color:"#f59e0b",background:"#fef3c7",borderRadius:8,padding:"10px 12px"}}>No non-year columns detected. This file may be gift-only — use "↑ Giving History" instead.</div>
              : <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  {donorHeaders.map(h => (
                    <div key={h} style={{display:"flex",alignItems:"center",gap:6,background:donorMapping[h]?T.bg:"transparent",borderRadius:7,padding:"5px 8px",border:`1px solid ${donorMapping[h]?T.bg3:"transparent"}`}}>
                      <span style={{fontSize:12,color:donorMapping[h]?T.ink:T.ink3,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={h}>{h}</span>
                      <select value={donorMapping[h]||""} onChange={e=>setDonorMapping(p=>({...p,[h]:e.target.value}))}
                        style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 6px",color:T.ink,fontSize:11,outline:"none",flexShrink:0}}>
                        <option value="">— skip —</option>
                        <option value="_firstName">firstName</option>
                        <option value="_lastName">lastName</option>
                        {CSV_FIELDS.map(f=><option key={f.key} value={f.key}>{f.key}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
            }
          </div>

          {/* Year columns */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>
              Gift Year Columns — {yearCols.filter(yc=>yc.enabled).length}/{yearCols.length} enabled
            </div>

            {/* Convention toggle */}
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              {[["dec31","Dec 31 (end of year)"],["first","Jan 1 (start of year)"]].map(([v,l]) => (
                <button key={v} onClick={()=>onConventionChange(v)}
                  style={{flex:1,background:yearConvention===v?T.bg2:"transparent",border:`1px solid ${yearConvention===v?T.greenDk:T.bg3}`,borderRadius:8,padding:"7px 12px",color:yearConvention===v?T.greenDk:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer",textAlign:"left"}}>
                  {l}
                </button>
              ))}
            </div>

            {yearCols.length === 0
              ? <div style={{fontSize:13,color:T.ink3}}>No year-like columns found. Proceed to create donors without gift history, or go back and check your file.</div>
              : <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {yearCols.map((yc,i) => (
                    <div key={yc.col} style={{display:"flex",alignItems:"center",gap:10,background:yc.enabled?T.bg:"transparent",border:`1px solid ${yc.enabled?T.bg3:"transparent"}`,borderRadius:8,padding:"7px 10px"}}>
                      <input type="checkbox" checked={yc.enabled} onChange={e=>setYearCols(c=>c.map((x,j)=>j===i?{...x,enabled:e.target.checked}:x))} style={{cursor:"pointer"}}/>
                      <span style={{flex:1,fontSize:13,color:yc.enabled?T.ink:T.ink3}}>{yc.col}</span>
                      <span style={{fontSize:12,color:T.ink3}}>→</span>
                      <input type="date" value={yc.date||""} onChange={e=>setYearCols(c=>c.map((x,j)=>j===i?{...x,date:e.target.value}:x))}
                        style={{background:T.bg2,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                    </div>
                  ))}
                </div>
            }
          </div>

          {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:10}}>{err}</div>}
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>{setParsed(null);setStep("upload");setErr("");}}
              style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 18px",color:T.ink3,fontSize:13,cursor:"pointer"}}>← Back</button>
            <button onClick={buildPreview}
              style={{flex:1,background:"linear-gradient(135deg,#1a6b4a,#2563eb)",border:"none",borderRadius:10,padding:"11px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>
              Preview →
            </button>
          </div>
        </>)}

        {/* Preview — mandatory confirm before any write */}
        {step === "preview" && (<>

          {/* Summary card */}
          <div style={{background:T.bg,borderRadius:12,padding:"14px 16px",marginBottom:16}}>
            <div style={{fontSize:15,fontWeight:700,color:T.ink,marginBottom:6}}>
              <span style={{color:"#10b981"}}>{stats.donors}</span> donors to create &nbsp;·&nbsp;
              <span style={{color:"#3b82f6"}}>{stats.gifts}</span> gifts to attach
              {stats.warned>0&&<> &nbsp;·&nbsp; <span style={{color:"#f59e0b"}}>{stats.warned}</span> with warnings</>}
              {stats.skipped>0&&<> &nbsp;·&nbsp; <span style={{color:T.ink3}}>{stats.skipped}</span> skipped</>}
            </div>
            <div style={{fontSize:12,color:T.ink3}}>No data is written until you click the confirm button below.</div>
          </div>

          {/* Row preview */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>
              First {Math.min(combinedRows.filter(r=>!r.skipped).length,6)} Rows
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {combinedRows.filter(r=>!r.skipped).slice(0,6).map((cr,i) => (
                <div key={i} style={{background:cr.warnings.length?`#fef9f0`:"#f8fdf8",border:`1px solid ${cr.warnings.length?"#fde68a":T.bg3}`,borderRadius:9,padding:"10px 12px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:cr.gifts.length?5:0,flexWrap:"wrap"}}>
                    <span style={{fontSize:13,fontWeight:700,color:T.ink}}>{cr.donor.name}</span>
                    {cr.donor.email&&<span style={{fontSize:11,color:T.ink3}}>{cr.donor.email}</span>}
                    {cr.warnings.length>0&&<span style={{fontSize:11,color:"#92400e",background:"#fef3c7",borderRadius:4,padding:"1px 6px"}}>⚠ {cr.warnings[0]}</span>}
                  </div>
                  {cr.gifts.length>0&&(
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {cr.gifts.map((g,j)=>(
                        <span key={j} style={{fontSize:11,background:T.bg2,borderRadius:5,padding:"2px 8px",color:T.ink2}}>${g.amount.toLocaleString()} · {g.date}</span>
                      ))}
                    </div>
                  )}
                  {cr.gifts.length===0&&<div style={{fontSize:11,color:T.ink3}}>No gift amounts in year columns</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Skipped rows */}
          {stats.skipped>0&&(
            <div style={{marginBottom:14,fontSize:12,color:T.ink3}}>
              <strong>{stats.skipped} row{stats.skipped!==1?"s":""} skipped</strong> — no name or email to identify the donor.
            </div>
          )}

          {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:10}}>{err}</div>}
          <div style={{display:"flex",gap:10,marginTop:4}}>
            <button onClick={()=>setStep("configure")}
              style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 18px",color:T.ink3,fontSize:13,cursor:"pointer"}}>← Back</button>
            <button onClick={doImport} disabled={loading||stats.donors===0}
              style={{flex:1,background:loading||stats.donors===0?T.bg2:"linear-gradient(135deg,#10b981,#3b82f6)",border:"none",borderRadius:10,padding:"11px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:loading||stats.donors===0?"not-allowed":"pointer",opacity:loading||stats.donors===0?0.6:1}}>
              {loading?"Importing…":`Import ${stats.donors} Donor${stats.donors!==1?"s":""} + ${stats.gifts} Gift${stats.gifts!==1?"s":""} →`}
            </button>
          </div>
        </>)}

      </div>
      {upgradeInfo&&<UpgradeModal open={true} onClose={()=>{setUpgradeInfo(null);onClose();}} reason={upgradeInfo.error} current={upgradeInfo.current} limit={upgradeInfo.limit} plan={upgradeInfo.plan}/>}
    </div>
  );
}

// ── Follow-up Task Modal ───────────────────────────────────────────────────
function FollowUpTaskModal({donor,onSave,onClose}){
  const due7=new Date();due7.setDate(due7.getDate()+7);
  const[title,setTitle]=useState(`Follow up: ${donor.name}`);
  const[due,setDue]=useState(due7.toISOString().split("T")[0]);
  const[priority,setPriority]=useState("medium");
  const[loading,setLoading]=useState(false);
  const inp={width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
  const save=async()=>{
    if(!title.trim())return;setLoading(true);
    try{
      const raw=await apiFetch("/tasks",{method:"POST",body:JSON.stringify({title,due,priority,type:"donor",donorId:donor.id})});
      onSave({id:raw.id,title:raw.title,due:raw.due||"",priority:raw.priority,type:raw.type,done:!!raw.done,donorId:donor.id});
    }catch(e){console.error(e);}
    setLoading(false);
  };
  return(
    <div className="modal-sheet-overlay" style={{position:"fixed",inset:0,background:"#0f1a12cc",backdropFilter:"blur(4px)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div className="fade-in modal-sheet-inner" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:18,width:"100%",maxWidth:420,padding:24,boxShadow:"0 4px 32px rgba(15,15,15,0.12)"}}>
        <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:2}}>Create Follow-up Task</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:20}}>For {donor.name}</div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Task Title</div>
            <input value={title} onChange={e=>setTitle(e.target.value)} style={inp}/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Due Date</div>
            <input type="date" value={due} onChange={e=>setDue(e.target.value)} style={inp}/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Priority</div>
            <div style={{display:"flex",gap:6}}>
              {["high","medium","low"].map(p=>(
                <button key={p} onClick={()=>setPriority(p)} style={{flex:1,background:priority===p?SC[p]:T.bg,border:`1px solid ${priority===p?SC[p]:T.bg3}`,borderRadius:8,padding:"8px",color:priority===p?"#fff":T.ink3,fontSize:12,fontWeight:600,cursor:"pointer",textTransform:"capitalize"}}>{p}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,marginTop:20}}>
          <button onClick={save} disabled={loading||!title.trim()} style={{flex:1,background:title.trim()?"#10b981":T.bg2,border:"none",borderRadius:10,padding:"12px",color:"#fff",fontSize:14,fontWeight:700,cursor:title.trim()?"pointer":"not-allowed"}}>{loading?"Creating…":"Create Task"}</button>
          <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"12px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Skip</button>
        </div>
      </div>
    </div>
  );
}

// ── Log Touchpoint Modal ───────────────────────────────────────────────────
function LogTouchpointModal({donor,onSave,onClose}){
  const[type,setType]=useState("call");
  const[date,setDate]=useState(new Date().toISOString().split("T")[0]);
  const[loading,setLoading]=useState(false);
  const[kt1,setKt1]=useState("");const[kt2,setKt2]=useState("");const[kt3,setKt3]=useState("");
  const[history,setHistory]=useState("");const[spouse,setSpouse]=useState("");const[nextStep,setNextStep]=useState("");
  const[answered,setAnswered]=useState("yes");const[duration,setDuration]=useState("");const[objections,setObjections]=useState("");
  const[attendees,setAttendees]=useState("");const[location,setLocation]=useState("");
  const[sentiment,setSentiment]=useState("Positive");const[asksMade,setAsksMade]=useState("");
  const[subject,setSubject]=useState("");const[summary,setSummary]=useState("");const[responded,setResponded]=useState("no");
  const[eventName,setEventName]=useState("");const[attended,setAttended]=useState("yes");const[observations,setObservations]=useState("");
  const[amount,setAmount]=useState("");const[designation,setDesignation]=useState("");
  const[payMethod,setPayMethod]=useState("");const[ackSent,setAckSent]=useState("no");
  const[otherNotes,setOtherNotes]=useState("");
  const[finFunds,setFinFunds]=useState([]);const[finFundId,setFinFundId]=useState("");const[finAcctId,setFinAcctId]=useState("");
  const[orgEvents,setOrgEvents]=useState([]);
  useEffect(()=>{
    Promise.all([apiFetch("/finance/funds"),apiFetch("/finance/accounts"),apiFetch("/events")]).then(([fds,accts,evts])=>{
      setFinFunds(fds);
      const def=fds.find(f=>!f.restricted)||fds[0];if(def)setFinFundId(def.id);
      const ca=accts.find(a=>a.type==="revenue"&&(a.code==="4010"||a.name.toLowerCase().includes("contribution")))||accts.find(a=>a.type==="revenue");
      if(ca)setFinAcctId(ca.id);
      setOrgEvents(Array.isArray(evts)?evts.slice(0,20):[]);
    }).catch(()=>{});
  },[]);

  const TYPES=[["call","Call"],["meeting","Meeting"],["email","Email"],["event","Event"],["gift","Gift/Pledge"],["other","Other"]];

  const buildNote=()=>{
    const L=[];
    const add=(k,v)=>{if(v&&String(v).trim())L.push(`${k}: ${v.trim()}`);};
    if(type==="call"){
      L.push(`Answered: ${answered}`);
      add("Duration",duration);add("Key Takeaway 1",kt1);add("Key Takeaway 2",kt2);add("Key Takeaway 3",kt3);
      add("Objections / Concerns",objections);add("Donor History",history);add("Spouse / Partner",spouse);add("Next Step",nextStep);
    }else if(type==="meeting"){
      add("Attendees",attendees);add("Location",location);
      add("Key Takeaway 1",kt1);add("Key Takeaway 2",kt2);add("Key Takeaway 3",kt3);
      L.push(`Donor Sentiment: ${sentiment}`);
      add("Spouse / Partner",spouse);add("Donor History",history);add("Asks Made",asksMade);add("Next Step",nextStep);
    }else if(type==="email"){
      add("Subject",subject);add("Summary",summary);
      L.push(`Response Received: ${responded}`);
      add("Donor History",history);add("Next Step",nextStep);
    }else if(type==="event"){
      add("Event",eventName);L.push(`Donor Attended: ${attended}`);
      add("Observations",observations);add("Donor History",history);add("Next Step",nextStep);
    }else if(type==="gift"){
      add("Amount",amount);add("Designation",designation);
      add("Payment Method",payMethod);L.push(`Acknowledgement Sent: ${ackSent}`);add("Next Step",nextStep);
    }else{
      add("Notes",otherNotes);add("Donor History",history);add("Spouse / Partner",spouse);add("Next Step",nextStep);
    }
    return L.join("\n");
  };

  const save=async()=>{
    const note=buildNote();if(!note.trim())return;setLoading(true);
    try{
      const saveType=type==="gift"?"gift":type==="meeting"?"meeting":type;
      await apiFetch(`/donors/${donor.id}/interactions`,{method:"POST",body:JSON.stringify({type:saveType,note,date})});
      const giftAmt=type==="gift"?(parseFloat(String(amount).replace(/[$,]/g,""))||0):0;
      if(type==="gift"&&giftAmt>0){
        await apiFetch(`/donors/${donor.id}/gifts`,{method:"POST",body:JSON.stringify({amount:giftAmt,date,notes:note})});
        if(finAcctId){
          try{
            await apiFetch("/finance/transactions",{method:"POST",body:JSON.stringify({
              date,description:`Gift from ${donor.name}`,vendorDonor:donor.name,
              amount:giftAmt,type:"income",accountId:finAcctId,fundId:finFundId||"",notes:note,
            })});
          }catch(e){console.error("Finance sync:",e);}
        }
      }
      onSave({type:saveType,note,date,amount:giftAmt});
    }catch(e){console.error(e);}
    setLoading(false);
  };

  const inp={width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
  const ta={...inp,resize:"vertical",lineHeight:1.55};
  const canSave=buildNote().trim().length>0;

  return(
    <div className="modal-sheet-overlay" style={{position:"fixed",inset:0,background:"#0f1a12cc",backdropFilter:"blur(4px)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div className="fade-in modal-sheet-inner" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:18,width:"100%",maxWidth:520,maxHeight:"92vh",overflowY:"auto",padding:24,boxShadow:"0 4px 32px rgba(15,15,15,0.12)"}}>
        <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:2}}>Log Touchpoint</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:16}}>{donor.name}</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:16}}>
          {TYPES.map(([v,l])=><button key={v} onClick={()=>setType(v)} style={{background:type===v?"#10b981":T.bg2,border:`1px solid ${type===v?"#10b981":T.bg3}`,borderRadius:7,padding:"5px 13px",color:type===v?"#fff":T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>{l}</button>)}
        </div>
        <div style={{marginBottom:16}}><span style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5,display:"block"}}>Date</span><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={inp}/></div>
        <div style={{display:"flex",flexDirection:"column",gap:14,marginBottom:20}}>
          {type==="call"&&<>
            <TpField label="Answered?"><TpYesNo val={answered} set={setAnswered}/></TpField>
            <TpField label="Duration"><input value={duration} onChange={e=>setDuration(e.target.value)} placeholder="e.g. 20 min" style={inp}/></TpField>
            <TpField label="Key Takeaway 1"><textarea value={kt1} onChange={e=>setKt1(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Key Takeaway 2"><textarea value={kt2} onChange={e=>setKt2(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Key Takeaway 3"><textarea value={kt3} onChange={e=>setKt3(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Objections / Concerns"><textarea value={objections} onChange={e=>setObjections(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Past relationship, giving context, background…" rows={3} style={ta}/></TpField>
            <TpField label="Spouse / Partner"><input value={spouse} onChange={e=>setSpouse(e.target.value)} placeholder="Name and relevant details" style={inp}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="meeting"&&<>
            <TpField label="Attendees"><input value={attendees} onChange={e=>setAttendees(e.target.value)} placeholder="Names of everyone present" style={inp}/></TpField>
            <TpField label="Location"><input value={location} onChange={e=>setLocation(e.target.value)} style={inp}/></TpField>
            <TpField label="Key Takeaway 1"><textarea value={kt1} onChange={e=>setKt1(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Key Takeaway 2"><textarea value={kt2} onChange={e=>setKt2(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Key Takeaway 3"><textarea value={kt3} onChange={e=>setKt3(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Donor Sentiment">
              <select value={sentiment} onChange={e=>setSentiment(e.target.value)} style={{...inp,cursor:"pointer"}}>
                {["Enthusiastic","Positive","Neutral","Hesitant"].map(s=><option key={s}>{s}</option>)}
              </select>
            </TpField>
            <TpField label="Spouse / Partner"><input value={spouse} onChange={e=>setSpouse(e.target.value)} placeholder="Name and relevant details" style={inp}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Past relationship, context…" rows={3} style={ta}/></TpField>
            <TpField label="Asks Made"><textarea value={asksMade} onChange={e=>setAsksMade(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="email"&&<>
            <TpField label="Subject"><input value={subject} onChange={e=>setSubject(e.target.value)} style={inp}/></TpField>
            <TpField label="Summary"><textarea value={summary} onChange={e=>setSummary(e.target.value)} rows={4} style={ta}/></TpField>
            <TpField label="Response Received?"><TpYesNo val={responded} set={setResponded}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Context for this outreach…" rows={3} style={ta}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="event"&&<>
            <TpField label="Event">
              {orgEvents.length>0?(
                <select value={eventName} onChange={e=>setEventName(e.target.value)} style={{...inp,cursor:"pointer"}}>
                  <option value="">— select event or type below —</option>
                  {orgEvents.map(ev=><option key={ev.id} value={ev.name}>{ev.name}</option>)}
                </select>
              ):<input value={eventName} onChange={e=>setEventName(e.target.value)} placeholder="Event name" style={inp}/>}
            </TpField>
            {orgEvents.length>0&&<TpField label="Event Name (or override)"><input value={eventName} onChange={e=>setEventName(e.target.value)} placeholder="Custom event name" style={inp}/></TpField>}
            <TpField label="Donor Attended?"><TpYesNo val={attended} set={setAttended}/></TpField>
            <TpField label="Interactions & Observations"><textarea value={observations} onChange={e=>setObservations(e.target.value)} rows={4} style={ta}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} rows={3} style={ta}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="gift"&&<>
            <TpField label="Amount"><input type="text" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="e.g. 5,000" style={inp}/></TpField>
            <TpField label="Designation"><input value={designation} onChange={e=>setDesignation(e.target.value)} placeholder="e.g. General Operating, Arts Education…" style={inp}/></TpField>
            <TpField label="Payment Method"><input value={payMethod} onChange={e=>setPayMethod(e.target.value)} placeholder="Check, ACH, Credit Card, Stock…" style={inp}/></TpField>
            <TpField label="Acknowledgement Sent?"><TpYesNo val={ackSent} set={setAckSent}/></TpField>
            {finFunds.length>0&&<TpField label="Finance Fund">
              <select value={finFundId} onChange={e=>setFinFundId(e.target.value)} style={{...inp,cursor:"pointer"}}>
                <option value="">— no fund —</option>
                {finFunds.map(f=><option key={f.id} value={f.id}>{f.name}{f.restricted?" (Restricted)":""}</option>)}
              </select>
            </TpField>}
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="other"&&<>
            <TpField label="Notes"><textarea value={otherNotes} onChange={e=>setOtherNotes(e.target.value)} rows={5} style={ta}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Past relationship, context…" rows={3} style={ta}/></TpField>
            <TpField label="Spouse / Partner"><input value={spouse} onChange={e=>setSpouse(e.target.value)} placeholder="Name and relevant details" style={inp}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={save} disabled={loading||!canSave} style={{flex:1,background:canSave?"#10b981":T.bg2,border:"none",borderRadius:10,padding:"12px",color:"#fff",fontSize:14,fontWeight:700,cursor:canSave?"pointer":"not-allowed"}}>{loading?"Saving…":"Save Touchpoint"}</button>
          <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"12px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Donor Modal ───────────────────────────────────────────────────────
function EditDonorModal({donor,onSave,onClose}){
  const inp={width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
  const[form,setForm]=useState({
    name:donor.name||"",email:donor.email||"",phone:donor.phone||"",
    notes:donor.notes||"",tags:(donor.tags||[]).join(", "),
    stage:donor.stage||"cultivate",status:donor.status||"new",
    city:donor.city||"",state:donor.state||"",zip:donor.zip||"",
    employer:donor.employer||"",
  });
  const[loading,setLoading]=useState(false);
  const[err,setErr]=useState("");
  const set=k=>e=>setForm(p=>({...p,[k]:e.target.value}));

  const save=async()=>{
    if(!form.name.trim()){setErr("Name is required");return;}
    setLoading(true);setErr("");
    try{
      const tags=form.tags.split(",").map(t=>t.trim()).filter(Boolean);
      const res=await apiFetch(`/donors/${donor.id}`,{method:"PUT",body:JSON.stringify({...form,tags})});
      onSave(res);
    }catch(e){setErr(e.message||"Failed to save");}
    setLoading(false);
  };

  return(
    <div className="modal-sheet-overlay" style={{position:"fixed",inset:0,background:"#000c",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div className="modal-sheet-inner" style={{background:"#ffffff",border:"1px solid "+T.bg3,borderRadius:20,width:"100%",maxWidth:480,padding:28,boxSizing:"border-box",overflowY:"auto"}}>
        <div style={{fontSize:18,fontWeight:800,color:T.ink,marginBottom:4}}>Edit Donor Profile</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:20}}>{donor.name}</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {[["name","Full Name","text"],["email","Email","email"],["phone","Phone","tel"],["employer","Employer","text"]].map(([k,pl,t])=>(
            <input key={k} type={t} value={form[k]} onChange={set(k)} placeholder={pl} style={inp}/>
          ))}
          <div style={{display:"flex",gap:8}}>
            <input value={form.city} onChange={set("city")} placeholder="City" style={{...inp,flex:2}}/>
            <input value={form.state} onChange={set("state")} placeholder="State" style={{...inp,flex:1}}/>
            <input value={form.zip} onChange={set("zip")} placeholder="ZIP" style={{...inp,flex:1}}/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Stage</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {STAGES.map(s=>(
                <button key={s.id} onClick={()=>setForm(p=>({...p,stage:s.id}))}
                  style={{background:form.stage===s.id?s.color+"22":T.bg,border:`1px solid ${form.stage===s.id?s.color:T.bg3}`,borderRadius:7,padding:"5px 11px",color:form.stage===s.id?s.color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Tags <span style={{fontSize:10,fontWeight:400,textTransform:"none"}}>(comma-separated)</span></div>
            <input value={form.tags} onChange={set("tags")} placeholder="e.g. board-adjacent, recurring, arts" style={inp}/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Notes</div>
            <textarea value={form.notes} onChange={set("notes")} rows={3} style={{...inp,resize:"vertical",lineHeight:1.5}}/>
          </div>
          {err&&<div style={{color:"#f87171",fontSize:12}}>{err}</div>}
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button onClick={save} disabled={loading} style={{flex:1,background:loading?T.bg2:"#10b981",border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer"}}>
              {loading?"Saving…":"Save Changes"}
            </button>
            <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Gift Link Modal ────────────────────────────────────────────────────────
function GiftLinkModal({donor,orgName,onClose}){
  const[url,setUrl]=useState("");
  const[loading,setLoading]=useState(true);
  const[err,setErr]=useState("");
  const[copied,setCopied]=useState(false);
  const[showEmail,setShowEmail]=useState(false);
  const[emailSubject,setEmailSubject]=useState(`A quick way to give to ${orgName}`);
  const[emailBody,setEmailBody]=useState(
    `<p>Hi ${donor.name.split(" ")[0]},</p>\n<p>Thank you so much for your continued support of ${orgName}. Your generosity makes our work possible.</p>\n<p>If you'd like to make a gift online, we've made it simple:</p>\n<p><a href="PAYMENT_LINK">Give now →</a></p>\n<p>It only takes a moment, and every gift goes directly to our programs. Thank you for everything you do for our mission.</p>\n<p>With gratitude,<br>The ${orgName} Team</p>`
  );
  const[sending,setSending]=useState(false);
  const[sent,setSent]=useState(false);
  const[sendErr,setSendErr]=useState("");

  useEffect(()=>{
    apiFetch("/stripe/donation-page",{method:"POST",body:JSON.stringify({donorName:donor.name,donorEmail:donor.email})})
      .then(r=>{setUrl(r.url);setEmailBody(b=>b.replace("PAYMENT_LINK",r.url));})
      .catch(e=>setErr(e.message||"Could not create payment link"))
      .finally(()=>setLoading(false));
  },[]);

  const copyLink=()=>{
    if(!url)return;
    navigator.clipboard.writeText(url).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2500);});
  };

  const sendEmail=async()=>{
    if(!donor.email){setSendErr("This donor has no email address.");return;}
    setSending(true);setSendErr("");
    try{
      const seg={mode:"manual",donorIds:[donor.id]};
      const created=await apiFetch("/campaigns",{method:"POST",body:JSON.stringify({
        name:`Gift request — ${donor.name}`,subject:emailSubject,body:emailBody,segment:seg,status:"draft"
      })});
      await apiFetch(`/campaigns/${created.id}/send`,{method:"POST"});
      setSent(true);
    }catch(e){setSendErr(e.message||"Failed to send email");}
    setSending(false);
  };

  const inp={width:"100%",boxSizing:"border-box",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit"};

  return(
    <div style={{position:"fixed",inset:0,background:"#0f1a12cc",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:18,width:"100%",maxWidth:480,padding:24,boxShadow:"0 8px 40px rgba(0,0,0,0.18)"}}>
        {!showEmail?(
          <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <div style={{fontSize:16,fontWeight:800,color:T.ink}}>Request Gift</div>
                <div style={{fontSize:12,color:T.ink3,marginTop:2}}>For {donor.name}</div>
              </div>
              <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:T.ink3}}>×</button>
            </div>
            {loading&&<div style={{padding:"24px 0",textAlign:"center",color:T.ink3,fontSize:13}}>Generating payment link…</div>}
            {err&&<div style={{color:"#dc2626",fontSize:13,background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 12px",marginBottom:14}}>{err}</div>}
            {url&&!loading&&(
              <>
                <div style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",fontSize:12,color:T.ink3,wordBreak:"break-all",lineHeight:1.5,marginBottom:16}}>{url}</div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={copyLink} style={{flex:1,background:copied?T.greenDk:T.bg,border:"1px solid "+(copied?T.greenDk:T.bg3),borderRadius:10,padding:"11px",color:copied?"#fff":T.ink2,fontSize:13,fontWeight:700,cursor:"pointer",transition:"all 0.15s"}}>
                    {copied?"✓ Copied!":"Copy Link"}
                  </button>
                  {donor.email&&<button onClick={()=>setShowEmail(true)} style={{flex:1,background:T.greenDk,border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                    ✉ Send via Email
                  </button>}
                </div>
              </>
            )}
          </>
        ):(
          <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <div style={{fontSize:16,fontWeight:800,color:T.ink}}>Send via Email</div>
                <div style={{fontSize:12,color:T.ink3,marginTop:2}}>To: {donor.email}</div>
              </div>
              <button onClick={()=>setShowEmail(false)} style={{background:"none",border:"none",fontSize:13,cursor:"pointer",color:T.ink3}}>← Back</button>
            </div>
            {sent?(
              <div style={{textAlign:"center",padding:"20px 0"}}>
                <div style={{fontSize:28,marginBottom:10}}>✓</div>
                <div style={{fontSize:15,fontWeight:700,color:T.ink,marginBottom:6}}>Email sent!</div>
                <div style={{fontSize:13,color:T.ink3,marginBottom:20}}>Your message to {donor.name} has been sent.</div>
                <button onClick={onClose} style={{background:T.greenDk,border:"none",borderRadius:10,padding:"11px 24px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Done</button>
              </div>
            ):(
              <>
                <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Subject</div>
                    <input value={emailSubject} onChange={e=>setEmailSubject(e.target.value)} style={inp}/>
                  </div>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Message</div>
                    <textarea value={emailBody} onChange={e=>setEmailBody(e.target.value)} rows={8}
                      style={{...inp,resize:"vertical",lineHeight:1.55,fontSize:12}}/>
                  </div>
                </div>
                {sendErr&&<div style={{color:"#dc2626",fontSize:13,background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"8px 12px",marginBottom:12}}>{sendErr}</div>}
                <div style={{display:"flex",gap:8}}>
                  <button onClick={sendEmail} disabled={sending} style={{flex:1,background:sending?T.bg3:T.greenDk,border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:13,fontWeight:700,cursor:sending?"not-allowed":"pointer"}}>
                    {sending?"Sending…":"Send Email"}
                  </button>
                  <button onClick={()=>setShowEmail(false)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Donor Profile ──────────────────────────────────────────────────────────
function DonorProfile({donor,onClose,onStageChange,onLogTouchpoint,aiMap,loadingKey,getAI,isAdmin,onEdit,onDelete,tasks=[],onTaskToggle,onAddTask,orgName="",orgTeam=[],onReassign,onCfSaved,onInteractionAdded,isReadOnly=false,allDonors=[],onSelectRelatedDonor}){
  const [gifts,setGifts]=useState([]);
  const [giftLoading,setGiftLoading]=useState(true);
  const [localInts,setLocalInts]=useState(null); // loaded lazily from GET /donors/:id
  const [sequences,setSequences]=useState([]);
  useEffect(()=>{apiFetch("/sequences").then(rows=>setSequences(Array.isArray(rows)?rows.filter(s=>s.status==="active"):[])).catch(()=>{});},[]);

  // Related donors (household/spouse/family/employer_match) — manual
  // linking only, see server.js's donor_relationships routes.
  const [relationships,setRelationships]=useState([]);
  const [householdTotal,setHouseholdTotal]=useState(null);
  const [relLoading,setRelLoading]=useState(true);
  const [relPickerOpen,setRelPickerOpen]=useState(false);
  const [relSearch,setRelSearch]=useState("");
  const [relType,setRelType]=useState("spouse");
  const [relSaving,setRelSaving]=useState(false);
  const [relErr,setRelErr]=useState("");
  const loadRelationships=()=>{
    setRelLoading(true);
    apiFetch(`/donors/${donor.id}/relationships`)
      .then(r=>{setRelationships(r.relationships||[]);setHouseholdTotal(r.householdTotal??null);})
      .catch(()=>{setRelationships([]);setHouseholdTotal(null);})
      .finally(()=>setRelLoading(false));
  };
  useEffect(()=>{loadRelationships();},[donor.id]);

  const linkDonor=async(relatedDonorId)=>{
    setRelSaving(true);setRelErr("");
    try{
      await apiFetch(`/donors/${donor.id}/relationships`,{method:"POST",body:JSON.stringify({relatedDonorId,relationshipType:relType})});
      setRelPickerOpen(false);setRelSearch("");
      loadRelationships();
    }catch(e){setRelErr(e.message||"Could not link donor");}
    setRelSaving(false);
  };
  const unlinkDonor=async(relId)=>{
    try{await apiFetch(`/donor-relationships/${relId}`,{method:"DELETE"});loadRelationships();}
    catch(e){console.error(e);}
  };
  const linkedIds=new Set(relationships.map(r=>r.relatedDonorId));
  const relPickerResults=relSearch.trim()
    ?allDonors.filter(d=>d.id!==donor.id&&!linkedIds.has(d.id)&&d.name.toLowerCase().includes(relSearch.trim().toLowerCase())).slice(0,8)
    :[];

  const [cfData,setCfData]=useState([]);
  const [cfEditing,setCfEditing]=useState(null);
  const [cfEditVal,setCfEditVal]=useState("");
  const [cfSaved,setCfSaved]=useState(null);
  useEffect(()=>{apiFetch(`/donors/${donor.id}/custom-fields`).then(rows=>setCfData(Array.isArray(rows)?rows:[])).catch(()=>{});},[donor.id]);
  const [donorEvents,setDonorEvents]=useState([]);
  useEffect(()=>{apiFetch(`/donors/${donor.id}/events`).then(rows=>setDonorEvents(Array.isArray(rows)?rows:[])).catch(()=>{});},[donor.id]);
  const [localScore,setLocalScore]=useState(donor.wealthScore??null);
  const [localTier,setLocalTier]=useState(donor.capacityTier??null);
  const [localConf,setLocalConf]=useState(donor.scoreConfidence??null);
  const [localRationale,setLocalRationale]=useState(donor.scoreRationale??null);
  const [scoreLoading,setScoreLoading]=useState(false);

  const wsc=localScore===null?T.ink3:localScore<=3?"#6b7280":localScore<=5?"#3b82f6":localScore<=7?"#1a6b4a":localScore<=9?"#8b5cf6":"#f59e0b";

  const recalcScore=async()=>{
    setScoreLoading(true);
    try{
      const r=await apiFetch(`/donors/${donor.id}/score`,{method:"POST"});
      setLocalScore(r.wealthScore);setLocalTier(r.capacityTier);
      setLocalConf(r.scoreConfidence);setLocalRationale(r.scoreRationale);
    }catch(e){console.error(e);}
    setScoreLoading(false);
  };

  const [showReassign,setShowReassign]=useState(false);
  const [reassignId,setReassignId]=useState(donor.assignedTo||"");
  const [reassignLoading,setReassignLoading]=useState(false);

  const [gmailConnected,setGmailConnected]=useState(null);
  const [gmailEmail,setGmailEmail]=useState("");
  const [composeOpen,setComposeOpen]=useState(false);
  const [composeTo,setComposeTo]=useState(donor.email||"");
  const [composeSubject,setComposeSubject]=useState("");
  const [composeBody,setComposeBody]=useState("");
  const [composeSending,setComposeSending]=useState(false);
  const [composeSent,setComposeSent]=useState(false);
  const [composeErr,setComposeErr]=useState("");
  const [draftLoading,setDraftLoading]=useState(false);
  useEffect(()=>{
    apiFetch("/gmail/status").then(s=>{setGmailConnected(!!s.connected);setGmailEmail(s.email||"");}).catch(()=>setGmailConnected(false));
  },[]);

  const handleReassign=async()=>{
    const member=orgTeam.find(u=>u.id===reassignId);
    if(!member)return;
    setReassignLoading(true);
    try{
      const prevOwner=donor.assignedToName||"nobody";
      await apiFetch(`/donors/${donor.id}/assign`,{method:"PATCH",body:JSON.stringify({assignedTo:member.id,assignedToName:member.name})});
      await apiFetch(`/donors/${donor.id}/interactions`,{method:"POST",body:JSON.stringify({
        type:"other",note:`Reassigned from ${prevOwner} to ${member.name}`,
        date:new Date().toISOString().split("T")[0]
      })});
      if(onReassign)onReassign(donor.id,member.id,member.name);
      setShowReassign(false);
    }catch(e){console.error(e);}
    setReassignLoading(false);
  };

  const sendEmail=async()=>{
    if(!composeTo||!composeSubject)return;
    setComposeSending(true);setComposeErr("");
    const first=donor.name.split(" ")[0];
    const resolvedSubj=composeSubject.replace(/\{\{donor_name\}\}/g,first).replace(/\{\{org_name\}\}/g,orgName);
    const resolvedBody=composeBody.replace(/\{\{donor_name\}\}/g,first).replace(/\{\{org_name\}\}/g,orgName);
    try{
      await apiFetch("/gmail/send",{method:"POST",body:JSON.stringify({donorId:donor.id,to:composeTo,subject:resolvedSubj,body:resolvedBody})});
      setComposeSent(true);
      setTimeout(()=>{setComposeSent(false);setComposeOpen(false);setComposeSubject("");setComposeBody("");if(onInteractionAdded)onInteractionAdded();},3000);
    }catch(e){setComposeErr(e.message||"Failed to send email");}
    setComposeSending(false);
  };

  const draftWithAI=async()=>{
    setDraftLoading(true);setComposeBody("");setComposeSubject("");
    try{
      let thread=[];
      try{thread=await apiFetch(`/gmail/thread/${donor.id}`);}catch(e){}
      const threadCtx=thread.length>0?`\n\nRecent email thread:\n${thread.map(t=>`[${t.direction}] ${t.subject}: ${t.snippet}`).join("\n")}`:"";
      const sys=`You are a nonprofit development officer assistant. Draft a warm, personal email.`;
      const prompt=`Draft a warm, personal email to ${donor.name} from ${orgName}.\n\nDonor context:\n- Lifetime giving: ${fmtFull(donor.total)}\n- Stage: ${donor.stage||"cultivate"}\n- Last gift: ${donor.lastGift}\n- Notes: ${donor.notes||"none"}${threadCtx}\n\nWrite a professional but warm email. Subject line first (starting with "Subject: "), then body. Keep it under 200 words. Address them by first name.`;
      await askClaude(sys,prompt,(chunk)=>{
        const lines=chunk.split("\n");
        const sIdx=lines.findIndex(l=>l.startsWith("Subject: "));
        if(sIdx>=0){
          setComposeSubject(lines[sIdx].replace("Subject: ","").trim());
          setComposeBody(lines.slice(sIdx+1).join("\n").replace(/^\n+/,""));
        }else{setComposeBody(chunk);}
      });
    }catch(e){console.error(e);}
    setDraftLoading(false);
  };

  const [showGiftModal,setShowGiftModal]=useState(false);
  const [seqOpen,setSeqOpen]=useState(false);
  const [seqId,setSeqId]=useState("");
  const [seqLoading,setSeqLoading]=useState(false);
  const [seqToast,setSeqToast]=useState("");

  // Tabs
  const [dpTab,setDpTab]=useState("overview");

  // Full gift data for Gifts & Pledges tab
  const [giftsFull,setGiftsFull]=useState([]);
  const [giftEditId,setGiftEditId]=useState(null);
  const [giftEditForm,setGiftEditForm]=useState({});
  const [addGiftForm,setAddGiftForm]=useState({amount:"",date:new Date().toISOString().split("T")[0],type:"cash",payment_method:"",notes:"",fund_id:"",acknowledgement_sent:false,pledgeId:""});
  const [addGiftOpen,setAddGiftOpen]=useState(false);
  const [giftSaving,setGiftSaving]=useState(false);

  // Planned gifts
  const [plannedGifts,setPlannedGifts]=useState([]);
  const [pgForm,setPgForm]=useState({type:"bequest",estimated_value:"",date_indicated:"",notes:""});
  const [addPgOpen,setAddPgOpen]=useState(false);
  const [pgSaving,setPgSaving]=useState(false);

  // Pledges — a promise to give $X by a future date, distinct from both
  // gifts (money already received) and planned gifts (bequests/trusts, no
  // due date). Past-due unfulfilled pledges get reminders on the same
  // cadence as the recurring-gift dunning system (see processPledgeReminders
  // in server.js).
  const [pledges,setPledges]=useState([]);
  const [pledgeForm,setPledgeForm]=useState({amount:"",dueDate:new Date().toISOString().split("T")[0],notes:""});
  const [addPledgeOpen,setAddPledgeOpen]=useState(false);
  const [pledgeSaving,setPledgeSaving]=useState(false);
  const [pledgeResendBusyId,setPledgeResendBusyId]=useState(null);
  const [pledgeResentIds,setPledgeResentIds]=useState(()=>new Set());

  // Fund affinity
  const [fundAffinity,setFundAffinity]=useState(null);
  const [fundLoading,setFundLoading]=useState(false);

  // Materials
  const [materials,setMaterials]=useState([]);
  const [matLoading,setMatLoading]=useState(false);
  const [matDragging,setMatDragging]=useState(false);
  const [matNote,setMatNote]=useState("");
  const [matUploading,setMatUploading]=useState(false);
  const fileInputRef=useRef(null);

  // Activity tab
  const [actFilter,setActFilter]=useState("all");
  const [actMode,setActMode]=useState("log");

  // Stewardship log form
  const [stwOpen,setStwOpen]=useState(false);
  const [stwForm,setStwForm]=useState({type:"thank_you",detail:"",date:new Date().toISOString().split("T")[0],note:""});
  const [stwSaving,setStwSaving]=useState(false);

  // Campaigns for gift attribution
  const [campaigns,setCampaigns]=useState([]);

  // Recurring gift recovery — health record (past_due/recovering/etc.), if any
  const [recurringSub,setRecurringSub]=useState(null);
  const [recurResendBusy,setRecurResendBusy]=useState(false);
  const [recurResendSent,setRecurResendSent]=useState(false);
  useEffect(()=>{
    apiFetch(`/donors/${donor.id}/recurring-subscription`).then(r=>setRecurringSub(r||null)).catch(()=>setRecurringSub(null));
  },[donor.id]);
  const resendRecurringLink=async()=>{
    setRecurResendBusy(true);
    try{
      await apiFetch(`/recurring/${donor.id}/resend`,{method:"POST"});
      setRecurResendSent(true);
    }catch(e){alert(e.message||"Could not resend the update link");}
    setRecurResendBusy(false);
  };

  // Households / soft credit / designations (BUILD-14)
  const [household,setHousehold]=useState(null);
  const [softCredit,setSoftCredit]=useState(null);
  const [designations,setDesignations]=useState([]);
  const [hhModalOpen,setHhModalOpen]=useState(false);
  const [hhPick,setHhPick]=useState(new Set());
  const [hhSearch,setHhSearch]=useState("");
  const refreshSoftCredit=()=>apiFetch(`/donors/${donor.id}/soft-credit`).then(sc=>{
    setSoftCredit(sc);
    if(sc&&sc.householdId)apiFetch(`/households/${sc.householdId}`).then(setHousehold).catch(()=>setHousehold(null));
    else setHousehold(null);
  }).catch(()=>{setSoftCredit(null);setHousehold(null);});
  // Pipeline: moves history + ask/gift opportunities (BUILD-15, Team plan)
  const [moves,setMoves]=useState([]);
  const [opps,setOpps]=useState([]);
  const [planTier,setPlanTier]=useState("core");
  const [askOpen,setAskOpen]=useState(false);
  const [askName,setAskName]=useState("");const [askAmt,setAskAmt]=useState("");
  const refreshPipeline=()=>{
    apiFetch(`/donors/${donor.id}/moves`).then(m=>setMoves(Array.isArray(m)?m:[])).catch(()=>setMoves([]));
    apiFetch(`/donors/${donor.id}/opportunities`).then(o=>setOpps(Array.isArray(o)?o:[])).catch(()=>setOpps([]));
  };
  const addAsk=async()=>{
    const amt=parseFloat(askAmt);if(!(amt>0)){alert("Enter a positive target ask amount.");return;}
    try{await apiFetch(`/donors/${donor.id}/opportunities`,{method:"POST",body:JSON.stringify({name:askName.trim()||"Ask",targetAmount:amt})});
      setAskOpen(false);setAskName("");setAskAmt("");refreshPipeline();}catch(e){alert(e.message||"Could not add ask");}
  };
  const closeAsk=async(o,status)=>{
    const body={status};
    if(status==="won"){const amt=prompt(`Actual gift amount closed (asked ${fmtFull(o.target_amount)}):`,o.target_amount);if(amt==null)return;body.giftAmount=parseFloat(amt)||0;}
    try{await apiFetch(`/opportunities/${o.id}`,{method:"PUT",body:JSON.stringify(body)});refreshPipeline();}catch(e){alert(e.message||"Could not update ask");}
  };
  useEffect(()=>{
    refreshSoftCredit();refreshPipeline();
    apiFetch(`/donors/${donor.id}/designations`).then(d=>setDesignations(Array.isArray(d)?d:[])).catch(()=>setDesignations([]));
    apiFetch("/portfolio/officers").then(r=>setPlanTier(r?.tier||"core")).catch(()=>{});
  },[donor.id]);
  const isTeam=planTier==="team";
  const hasDesignation=k=>designations.some(d=>d.kind===k);
  const toggleDesignation=async(kind)=>{
    try{
      if(hasDesignation(kind))await apiFetch(`/donors/${donor.id}/designations/${kind}`,{method:"DELETE"});
      else await apiFetch(`/donors/${donor.id}/designations`,{method:"POST",body:JSON.stringify({kind})});
      const d=await apiFetch(`/donors/${donor.id}/designations`);setDesignations(Array.isArray(d)?d:[]);
    }catch(e){alert(e.message||"Could not update designation");}
  };
  const createHousehold=async()=>{
    const ids=[...hhPick];if(!ids.length)return;
    try{
      const hh=await apiFetch("/households",{method:"POST",body:JSON.stringify({memberIds:[donor.id,...ids],primaryDonorId:donor.id})});
      setHousehold(hh);setHhModalOpen(false);setHhPick(new Set());setHhSearch("");refreshSoftCredit();
    }catch(e){alert(e.message||"Could not create household");}
  };
  const removeFromHousehold=async()=>{
    if(!household)return;
    const remaining=household.members.filter(m=>m.id!==donor.id).map(m=>m.id);
    try{
      if(remaining.length<2)await apiFetch(`/households/${household.id}`,{method:"DELETE"});
      else await apiFetch(`/households/${household.id}`,{method:"PUT",body:JSON.stringify({memberIds:remaining})});
      setHousehold(null);refreshSoftCredit();
    }catch(e){alert(e.message||"Could not update household");}
  };

  // Tax receipts — per-gift status + whether the org has receipts enabled
  // at all (governs whether "Send receipt" is even offered, vs. a setup
  // nudge). See CLAUDE.md "Tax receipting."
  const [donorReceipts,setDonorReceipts]=useState([]);
  const [receiptsEnabled,setReceiptsEnabled]=useState(false);
  const [receiptBusyId,setReceiptBusyId]=useState(null);
  const loadDonorReceipts=()=>apiFetch(`/donors/${donor.id}/receipts`).then(r=>setDonorReceipts(r||[])).catch(()=>setDonorReceipts([]));
  useEffect(()=>{
    loadDonorReceipts();
    apiFetch("/org").then(o=>setReceiptsEnabled(!!o.receipts_enabled)).catch(()=>{});
  },[donor.id]);

  const receiptForGift=giftId=>donorReceipts.find(r=>r.gift_id===giftId&&!r.voided_at);

  const sendReceipt=async giftId=>{
    setReceiptBusyId(giftId);
    try{
      await apiFetch(`/gifts/${giftId}/receipt`,{method:"POST"});
      await loadDonorReceipts();
    }catch(e){alert(e.message||"Could not send receipt");}
    setReceiptBusyId(null);
  };

  const downloadReceiptPdf=async(receiptId,filenameHint)=>{
    try{
      const resp=await fetch(`${API}/receipts/${receiptId}/pdf`,{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!resp.ok)throw new Error("Could not download receipt");
      const blob=await resp.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");a.href=url;a.download=`${filenameHint}.pdf`;
      document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
    }catch(e){alert(e.message||"Could not download receipt");}
  };

  const [showYearEnd,setShowYearEnd]=useState(false);
  const [yearEndYear,setYearEndYear]=useState(String(new Date().getFullYear()-1));
  const [yearEndBusy,setYearEndBusy]=useState(false);
  const [yearEndErr,setYearEndErr]=useState("");
  const sendYearEndStatement=async()=>{
    setYearEndBusy(true); setYearEndErr("");
    try{
      await apiFetch(`/donors/${donor.id}/year-end-statement`,{method:"POST",body:JSON.stringify({year:parseInt(yearEndYear,10),send:true})});
      await loadDonorReceipts();
      setShowYearEnd(false);
    }catch(e){setYearEndErr(e.message||"Could not generate statement");}
    setYearEndBusy(false);
  };

  const loadGiftsFull=()=>{
    apiFetch(`/donors/${donor.id}`).then(raw=>{
      const g=(raw.gifts||[]).map(g=>({
        id:g.id,amount:parseFloat(g.amount)||0,date:g.date||g.created_at?.split("T")[0],
        type:g.type||"cash",campaign:g.campaign||"",notes:g.notes||"",
        fund_id:g.fund_id||"",payment_method:g.payment_method||"",
        acknowledgement_sent:!!g.acknowledgement_sent,
      }));
      setGiftsFull(g);
      setGifts(g.map(x=>({amount:x.amount,date:x.date})));
      setGiftLoading(false);
      // Capture full interactions from the profile fetch so the timeline works
      // without the list endpoint needing to embed them.
      if(raw.interactions) setLocalInts(raw.interactions.map(i=>({
        ...i, date:i.date||i.created_at?.split("T")[0], note:i.note||"",
      })));
    }).catch(()=>setGiftLoading(false));
  };

  const loadPlannedGifts=()=>{
    apiFetch(`/donors/${donor.id}/planned-gifts`).then(rows=>setPlannedGifts(Array.isArray(rows)?rows:[])).catch(()=>{});
  };

  const loadPledges=()=>{
    apiFetch(`/donors/${donor.id}/pledges`).then(rows=>setPledges(Array.isArray(rows)?rows:[])).catch(()=>{});
  };

  const loadMaterials=()=>{
    setMatLoading(true);
    apiFetch(`/donors/${donor.id}/materials`).then(rows=>setMaterials(Array.isArray(rows)?rows:[])).catch(()=>{}).finally(()=>setMatLoading(false));
  };

  const loadFundAffinity=()=>{
    setFundLoading(true);
    apiFetch(`/donors/${donor.id}/fund-affinity`).then(r=>setFundAffinity(r||null)).catch(()=>{}).finally(()=>setFundLoading(false));
  };

  // Optimistic delete: drop the entry locally right away; on failure, refetch
  // the profile (restores the row) and surface the error.
  const deleteInteraction=async(int)=>{
    const prev=localInts??donor.interactions??[];
    setLocalInts(prev.filter(x=>x.id!==int.id));
    try{
      await apiFetch(`/interactions/${int.id}`,{method:"DELETE"});
    }catch(e){
      loadGiftsFull();
      alert("Could not delete this entry: "+(e.message||"unknown error"));
    }
  };

  const saveStewardship=async()=>{
    if(!stwForm.type)return;
    setStwSaving(true);
    try{
      await apiFetch(`/donors/${donor.id}/interactions`,{method:"POST",body:JSON.stringify({
        type:"stewardship",
        note:`${stwForm.type.replace(/_/g," ")}${stwForm.detail?" — "+stwForm.detail:""}${stwForm.note?"\n"+stwForm.note:""}`,
        date:stwForm.date,
        metadata:{stewardship_type:stwForm.type,detail:stwForm.detail},
      })});
      setStwOpen(false);
      setStwForm({type:"thank_you",detail:"",date:new Date().toISOString().split("T")[0],note:""});
      if(onInteractionAdded)onInteractionAdded();
    }catch(e){console.error(e);}
    setStwSaving(false);
  };

  const stage=STAGES.find(s=>s.id===(donor.stage||"cultivate"))||STAGES[2];
  const sc=donorScore(donor);const scoreColor=sc>70?"#1a6b4a":sc>45?"#f59e0b":"#ef4444";
  const urg=moveUrgency(donor);

  const interactionCount=donor.interactions?.length||0;
  useEffect(()=>{
    setGiftLoading(true);
    loadGiftsFull();
    loadPlannedGifts();
    loadPledges();
  },[donor.id,interactionCount]);

  useEffect(()=>{
    if(dpTab==="materials")loadMaterials();
    if(dpTab==="funds"&&!fundAffinity)loadFundAffinity();
  },[dpTab,donor.id]);

  useEffect(()=>{
    apiFetch("/campaigns").then(r=>setCampaigns(Array.isArray(r)?r:[])).catch(()=>{});
  },[]);

  const saveGiftEdit=async(giftId)=>{
    setGiftSaving(true);
    try{
      await apiFetch(`/gifts/${giftId}`,{method:"PUT",body:JSON.stringify(giftEditForm)});
      loadGiftsFull();
      setGiftEditId(null);
    }catch(e){console.error(e);}
    setGiftSaving(false);
  };

  const deleteGift=async(giftId)=>{
    if(!confirm("Delete this gift?"))return;
    try{
      await apiFetch(`/gifts/${giftId}`,{method:"DELETE"});
      loadGiftsFull();
    }catch(e){console.error(e);}
  };

  const addGift=async()=>{
    if(!addGiftForm.amount||isNaN(Number(addGiftForm.amount)))return;
    setGiftSaving(true);
    try{
      await apiFetch(`/donors/${donor.id}/gifts`,{method:"POST",body:JSON.stringify({
        amount:Number(addGiftForm.amount),date:addGiftForm.date,type:addGiftForm.type,
        campaign:addGiftForm.campaign||"",notes:addGiftForm.notes,
        fund_id:addGiftForm.fund_id,payment_method:addGiftForm.payment_method,
        acknowledgement_sent:addGiftForm.acknowledgement_sent,
        pledgeId:addGiftForm.pledgeId||undefined,
      })});
      setAddGiftOpen(false);
      setAddGiftForm({amount:"",date:new Date().toISOString().split("T")[0],type:"cash",payment_method:"",notes:"",fund_id:"",acknowledgement_sent:false,pledgeId:""});
      loadGiftsFull();
      if(addGiftForm.pledgeId)loadPledges();
    }catch(e){console.error(e);}
    setGiftSaving(false);
  };

  const addPledge=async()=>{
    if(!pledgeForm.amount||isNaN(Number(pledgeForm.amount))||!pledgeForm.dueDate)return;
    setPledgeSaving(true);
    try{
      await apiFetch(`/donors/${donor.id}/pledges`,{method:"POST",body:JSON.stringify(pledgeForm)});
      setAddPledgeOpen(false);
      setPledgeForm({amount:"",dueDate:new Date().toISOString().split("T")[0],notes:""});
      loadPledges();
    }catch(e){alert(e.message||"Could not save pledge");}
    setPledgeSaving(false);
  };

  const setPledgeStatus=async(id,status)=>{
    try{
      await apiFetch(`/pledges/${id}`,{method:"PUT",body:JSON.stringify({status})});
      loadPledges();
    }catch(e){alert(e.message||"Could not update pledge");}
  };

  const deletePledge=async(id)=>{
    if(!confirm("Delete this pledge? This cannot be undone."))return;
    try{
      await apiFetch(`/pledges/${id}`,{method:"DELETE"});
      loadPledges();
    }catch(e){console.error(e);}
  };

  const resendPledgeReminder=async(id)=>{
    setPledgeResendBusyId(id);
    try{
      await apiFetch(`/pledges/${id}/resend`,{method:"POST"});
      setPledgeResentIds(prev=>new Set(prev).add(id));
    }catch(e){alert(e.message||"Could not resend the reminder");}
    setPledgeResendBusyId(null);
  };

  const addPlannedGift=async()=>{
    if(!pgForm.type)return;
    setPgSaving(true);
    try{
      await apiFetch(`/donors/${donor.id}/planned-gifts`,{method:"POST",body:JSON.stringify(pgForm)});
      setAddPgOpen(false);
      setPgForm({type:"bequest",estimated_value:"",date_indicated:"",notes:""});
      loadPlannedGifts();
    }catch(e){console.error(e);}
    setPgSaving(false);
  };

  const deletePlannedGift=async(id)=>{
    if(!confirm("Delete this planned gift entry?"))return;
    try{
      await apiFetch(`/planned-gifts/${id}`,{method:"DELETE"});
      loadPlannedGifts();
    }catch(e){console.error(e);}
  };

  const uploadMaterial=async(file)=>{
    setMatUploading(true);
    try{
      let file_data=null,file_url=null;
      if(file.size<1024*1024){
        const buf=await file.arrayBuffer();
        file_data=btoa(String.fromCharCode(...new Uint8Array(buf)));
      }
      await apiFetch(`/donors/${donor.id}/materials`,{method:"POST",body:JSON.stringify({
        file_name:file.name,file_type:file.type||"application/octet-stream",
        file_data,file_url,notes:matNote,
      })});
      setMatNote("");
      loadMaterials();
    }catch(e){console.error(e);}
    setMatUploading(false);
  };

  const viewMaterial=(m)=>{
    if(m.file_data){
      const byteCharacters=atob(m.file_data);
      const byteNumbers=new Array(byteCharacters.length).fill(0).map((_,i)=>byteCharacters.charCodeAt(i));
      const byteArray=new Uint8Array(byteNumbers);
      const blob=new Blob([byteArray],{type:m.file_type||"application/octet-stream"});
      const url=URL.createObjectURL(blob);
      window.open(url,"_blank");
    }else if(m.file_url){
      window.open(m.file_url,"_blank");
    }
  };

  const deleteMaterial=async(id)=>{
    if(!confirm("Delete this file?"))return;
    try{
      await apiFetch(`/materials/${id}`,{method:"DELETE"});
      loadMaterials();
    }catch(e){console.error(e);}
  };

  const [impactPdfLoading,setImpactPdfLoading]=useState(false);
  // SHELVED — voice capture works but unproven adoption assumption, revisit
  // later. Code intact, re-enable by uncommenting.
  // const [showVoiceMemo,setShowVoiceMemo]=useState(false);
  const downloadImpactSummary=async()=>{
    setImpactPdfLoading(true);
    try{
      const resp=await fetch(`${API}/donors/${donor.id}/impact-summary/pdf`,{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!resp.ok)throw new Error("Could not generate impact summary");
      const blob=await resp.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;a.download=`${donor.name}-impact-summary.pdf`;
      document.body.appendChild(a);a.click();
      document.body.removeChild(a);URL.revokeObjectURL(url);
    }catch(e){console.error(e);}
    setImpactPdfLoading(false);
  };

  const exportGiftsCSV=()=>{
    const rows=[["Date","Amount","Type","Payment Method","Fund","Ack Sent","Notes"],...giftsFull.map(g=>[g.date,g.amount,g.type,g.payment_method,g.fund_id,g.acknowledgement_sent?"Yes":"No",g.notes])];
    const csv=rows.map(r=>r.map(v=>`"${(v||"").toString().replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`${donor.name}-gifts.csv`;a.click();
  };

  useEffect(()=>{
    if(!aiMap[`${donor.id}_nextmove`])getAI(donor,"nextmove");
  },[donor.id]);

  const sortedGifts=[...gifts].sort((a,b)=>new Date(b.date)-new Date(a.date));
  const lastGiftDisplay=giftLoading?"…":sortedGifts.length>0?fmtFull(sortedGifts[0].amount):fmtFull(donor.lastAmount);

  return(
    <div className="fade-in fullscreen-takeover" style={{position:"fixed",top:52,left:0,right:0,bottom:0,background:T.bg,zIndex:200,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {showGiftModal&&<GiftLinkModal donor={donor} orgName={orgName} onClose={()=>setShowGiftModal(false)}/>}
      {/* SHELVED — voice capture works but unproven adoption assumption, revisit later.
          Code intact, re-enable by uncommenting.
      {showVoiceMemo&&<VoiceMemoModal donor={donor} onClose={()=>setShowVoiceMemo(false)} onSaved={()=>{setShowVoiceMemo(false);if(onInteractionAdded)onInteractionAdded();}}/>}
      */}
      <div className="donor-profile-header" style={{background:T.white,borderBottom:"1px solid "+T.bg3,padding:"10px 24px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={onClose} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer",whiteSpace:"nowrap"}}>← Back</button>
        <div className="dph-identity" style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
          <div style={{width:34,height:34,borderRadius:"50%",background:stage.color+"33",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:stage.color,flexShrink:0}}>{donor.name[0]}</div>
          <div style={{minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <span style={{fontSize:16,fontWeight:800,color:T.ink,letterSpacing:"-0.01em"}}>{donor.name}</span>
              <span style={{fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:99,background:stage.color+"22",color:stage.color}}>{stage.label}</span>
              <span style={{fontSize:11,color:T.ink3}}>{donor.email}</span>
            </div>
            <div className="dph-meta" style={{fontSize:11,color:T.ink3,marginTop:2,display:"flex",flexWrap:"wrap",gap:"0 4px"}}>
              <span style={{whiteSpace:"nowrap"}}>{fmtFull(donor.total)} lifetime</span>
              <span style={{whiteSpace:"nowrap"}}>·</span>
              <span style={{whiteSpace:"nowrap"}}>{donor.gifts} gifts</span>
            </div>
          </div>
        </div>
        <div className="dph-actions" style={{display:"flex",gap:6,flexShrink:0,alignItems:"center"}}>
          <button onClick={()=>setShowGiftModal(true)} style={{background:T.green,border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
            💳 Request Gift
          </button>
          {/* SHELVED — voice capture works but unproven adoption assumption, revisit later.
              Code intact, re-enable by uncommenting.
          <button onClick={()=>setShowVoiceMemo(true)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>
            🎙 Voice memo
          </button>
          */}
          <button onClick={downloadImpactSummary} disabled={impactPdfLoading} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:impactPdfLoading?"not-allowed":"pointer",opacity:impactPdfLoading?0.6:1}}>
            {impactPdfLoading?"Generating…":"↓ Impact Summary"}
          </button>
          <button onClick={onEdit} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Edit</button>
          {isAdmin&&<button onClick={()=>onDelete(donor.id)} style={{background:"transparent",border:"1px solid #ef444455",borderRadius:8,padding:"7px 14px",color:"#ef4444",fontSize:13,cursor:"pointer"}}>Delete</button>}
        </div>
      </div>

      <div className="donor-profile-body" style={{flex:1,display:"grid",gridTemplateColumns:"minmax(0,1.25fr) minmax(0,0.75fr)",overflow:"hidden"}}>
        {/* LEFT */}
        <div style={{overflowY:"auto",borderRight:"1px solid "+T.bg3,display:"flex",flexDirection:"column"}}>
          {/* Tab Nav */}
          <div style={{display:"flex",background:T.white,borderBottom:"1px solid "+T.bg3,flexShrink:0,overflowX:"auto"}}>
            {[["overview","Overview"],["gifts","Gifts & Pledges"],["funds","Funds"],["related","Related"],["materials","Materials"],["activity","Activity"]].map(([id,label])=>(
              <button key={id} onClick={()=>setDpTab(id)} style={{background:"none",border:"none",borderBottom:`2px solid ${dpTab===id?T.greenDk:"transparent"}`,padding:"11px 16px",color:dpTab===id?T.greenDk:T.ink3,fontSize:13,fontWeight:dpTab===id?700:400,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                {label}
                {id==="gifts"&&giftsFull.length>0&&<span style={{marginLeft:5,background:T.bg2,borderRadius:99,padding:"1px 6px",fontSize:10,fontWeight:700,color:T.ink3}}>{giftsFull.length}</span>}
                {id==="related"&&relationships.length>0&&<span style={{marginLeft:5,background:T.bg2,borderRadius:99,padding:"1px 6px",fontSize:10,fontWeight:700,color:T.ink3}}>{relationships.length}</span>}
                {id==="materials"&&materials.length>0&&<span style={{marginLeft:5,background:T.bg2,borderRadius:99,padding:"1px 6px",fontSize:10,fontWeight:700,color:T.ink3}}>{materials.length}</span>}
              </button>
            ))}
          </div>

          {/* Overview tab */}
          {dpTab==="overview"&&<div style={{padding:"22px 20px 24px 24px",display:"flex",flexDirection:"column",gap:18}}>
            <div className="donor-stat-grid" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
              {[["Lifetime",fmtFull(donor.total),T.ink],["Last Gift",lastGiftDisplay,"#1a6b4a"],["Contact",`${urg.days}d ago`,urg.urgencyColor],["Score",`${sc}/99`,scoreColor]].map(([l,v,c])=>(
                <div key={l} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"12px 14px"}}>
                  <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:4}}>{l}</div>
                  <div style={{fontSize:20,fontWeight:800,color:c,fontFamily:"'DM Serif Display',serif",lineHeight:1.1}}>{v}</div>
                </div>
              ))}
            </div>

            {householdTotal!=null&&(
              <div style={{background:T.gold+"12",border:"1px solid "+T.gold+"40",borderRadius:12,padding:"10px 14px",fontSize:12,color:T.ink,cursor:"pointer"}} onClick={()=>setDpTab("related")}>
                <strong>{fmtFull(donor.total)}</strong> individually · <strong style={{color:"#92700f"}}>{fmtFull(householdTotal)}</strong> household total — <span style={{color:T.greenDk,fontWeight:700}}>see who's linked →</span>
              </div>
            )}

            {/* Matching-gift flag — from a curated static list (matchingGifts.js
                on the backend), not a live vendor feed; source/last-verified
                is surfaced on hover so this reads as informed, not magic. */}
            {donor.matchingGift&&(
              <div title={`${donor.matchingGift.sourceNote} List curated ${donor.matchingGift.lastVerified}.`}
                style={{background:"#10b98112",border:"1px solid #10b98140",borderRadius:12,padding:"10px 14px",fontSize:12,color:T.ink,display:"flex",alignItems:"flex-start",gap:8}}>
                <span style={{fontSize:14,lineHeight:1.4}}>🤝</span>
                <div>
                  <div><strong>{donor.matchingGift.companyName}</strong> matches employee gifts {donor.matchingGift.ratio} — ask {donor.name.split(" ")[0]} to submit a match request.</div>
                  <div style={{fontSize:10,color:T.ink3,marginTop:2}}>Curated list, not a live feed — verify current terms before outreach.</div>
                </div>
              </div>
            )}

            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,padding:"16px 18px"}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:12}}>Giving History</div>
              {giftLoading?<div style={{height:80,display:"flex",alignItems:"center",justifyContent:"center",color:T.ink3,fontSize:12}}><Spin/></div>:<GivingHistoryChart gifts={gifts}/>}
            </div>

            {donor.tags?.length>0&&<div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{donor.tags.map(t=><Pill key={t} label={t}/>)}</div>}
            {donor.notes&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 14px",fontSize:13,color:T.ink3,lineHeight:1.6}}>{donor.notes}</div>}

            {/* Household & planned giving (BUILD-14) */}
            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:"#1a6b4a"}}>Household</span>
                {household
                  ?<span style={{fontSize:12,color:T.ink,fontWeight:700}}>{household.name}</span>
                  :<span style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>Not in a household</span>}
                {household
                  ?!isReadOnly&&<button onClick={removeFromHousehold} style={{marginLeft:"auto",background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"3px 9px",color:T.terracotta,fontSize:11,fontWeight:700,cursor:"pointer"}}>Remove</button>
                  :!isReadOnly&&<button onClick={()=>setHhModalOpen(true)} style={{marginLeft:"auto",background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"3px 9px",color:T.greenMid,fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Group into household</button>}
              </div>
              {household&&(
                <>
                  <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
                    <div><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:".05em"}}>Hard credit</div><div style={{fontSize:16,fontWeight:800,color:T.ink}}>{fmtFull(softCredit?.hardCredit||0)}</div></div>
                    <div><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:".05em"}}>Soft credit</div><div style={{fontSize:16,fontWeight:800,color:"#a97f22"}}>{fmtFull(softCredit?.softCredit||0)}</div></div>
                    <div style={{borderLeft:"1px solid "+T.bg3,paddingLeft:18}}><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:".05em"}}>Household combined</div><div style={{fontSize:16,fontWeight:800,color:"#1a6b4a"}}>{fmtFull(household.combined_giving)}</div></div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {household.members.map(m=>(
                      <div key={m.id} onClick={()=>m.id!==donor.id&&onSelectRelatedDonor&&onSelectRelatedDonor(m.id)} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,padding:"6px 8px",borderRadius:8,background:m.id===donor.id?"#1a6b4a10":"transparent",cursor:m.id!==donor.id?"pointer":"default"}}>
                        <span style={{fontWeight:m.id===donor.id?800:600,color:T.ink}}>{m.name}</span>
                        {m.is_primary&&<span style={{background:"#c9a84c",color:"#0f1a12",borderRadius:99,padding:"1px 7px",fontSize:9,fontWeight:800,textTransform:"uppercase"}}>Primary</span>}
                        <span style={{marginLeft:"auto",color:T.ink3}}>{fmtFull(m.total_giving)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:11,color:T.ink3}}>Combined view only — each gift's hard credit stays with the donor who gave it.</div>
                </>
              )}
              <div style={{borderTop:"1px solid "+T.bg3,paddingTop:10}}>
                <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:"#1a6b4a",marginBottom:7}}>Planned giving & designations</div>
                <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  {DESIGNATION_OPTS.map(([k,label])=>{const on=hasDesignation(k);return(
                    <button key={k} onClick={()=>!isReadOnly&&toggleDesignation(k)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                      style={{background:on?"#1a6b4a":"transparent",color:on?"#fff":T.ink3,border:"1px solid "+(on?"#1a6b4a":T.bg3),borderRadius:99,padding:"4px 11px",fontSize:11,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer"}}>
                      {on?"✓ ":""}{label}
                    </button>
                  );})}
                </div>
              </div>
              {/* Pipeline: Moves & Asks (BUILD-15, Team plan) */}
              {(isTeam||moves.length>0||opps.length>0)&&(
                <div style={{borderTop:"1px solid "+T.bg3,paddingTop:10}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7}}>
                    <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:"#1a6b4a"}}>Pipeline — moves & asks</div>
                    {isTeam&&!isReadOnly&&<button onClick={()=>setAskOpen(v=>!v)} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:99,padding:"3px 10px",fontSize:11,fontWeight:700,color:"#a97f22",cursor:"pointer"}}>{askOpen?"Cancel":"+ Add ask"}</button>}
                  </div>
                  {askOpen&&(
                    <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                      <input value={askName} onChange={e=>setAskName(e.target.value)} placeholder="What's the ask? (optional)" style={{flex:"1 1 140px",border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 9px",fontSize:12}}/>
                      <input value={askAmt} onChange={e=>setAskAmt(e.target.value)} placeholder="$ target" style={{width:100,border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 9px",fontSize:12}}/>
                      <button onClick={addAsk} style={{background:"#1a6b4a",border:"none",borderRadius:8,padding:"6px 14px",fontSize:12,fontWeight:700,color:"#fff",cursor:"pointer"}}>Save</button>
                    </div>
                  )}
                  {opps.length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:moves.length?10:0}}>
                      {opps.map(o=>(
                        <div key={o.id} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,padding:"6px 8px",borderRadius:8,background:o.status==="open"?"#c9a84c14":T.bg2}}>
                          <span style={{fontWeight:700,color:T.ink}}>{o.name}</span>
                          <span style={{color:"#a97f22",fontWeight:800}}>{fmtFull(o.target_amount)} ask</span>
                          {o.status==="won"&&<span style={{color:"#1a6b4a",fontWeight:700}}>→ {fmtFull(o.gift_amount||0)} gift</span>}
                          {o.status==="lost"&&<span style={{color:T.terracotta,fontWeight:700}}>lost</span>}
                          <span style={{marginLeft:"auto",display:"flex",gap:6}}>
                            {o.status==="open"&&isTeam&&!isReadOnly&&<>
                              <button onClick={()=>closeAsk(o,"won")} style={{background:"#1a6b4a",border:"none",borderRadius:6,padding:"2px 9px",fontSize:11,fontWeight:700,color:"#fff",cursor:"pointer"}}>Won</button>
                              <button onClick={()=>closeAsk(o,"lost")} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:6,padding:"2px 9px",fontSize:11,fontWeight:700,color:T.ink3,cursor:"pointer"}}>Lost</button>
                            </>}
                            {o.status!=="open"&&<span style={{fontSize:10,color:T.ink3,textTransform:"uppercase"}}>{o.status}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {moves.length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      {moves.slice(0,6).map(m=>(
                        <div key={m.id} style={{fontSize:12,color:T.ink2,paddingLeft:10,borderLeft:"2px solid "+T.bg3}}>
                          <div><span style={{fontWeight:700,color:T.ink}}>{cap(m.from_stage)} → {cap(m.to_stage)}</span> <span style={{color:T.ink3}}>· {m.officer_name||"—"} · {new Date(m.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span></div>
                          {m.description&&<div style={{color:T.ink3,fontSize:11}}>{m.description}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {isTeam&&moves.length===0&&opps.length===0&&<div style={{fontSize:11,color:T.ink3}}>No moves or asks logged yet. Move this donor on the Pipeline board, or add an ask above.</div>}
                </div>
              )}
              {hhModalOpen&&(
                <div onClick={()=>setHhModalOpen(false)} style={{position:"fixed",inset:0,background:"rgba(15,26,18,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
                  <div onClick={e=>e.stopPropagation()} style={{background:T.bg,borderRadius:16,padding:20,width:"min(440px,94vw)",maxHeight:"80vh",display:"flex",flexDirection:"column",gap:12}}>
                    <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:19,color:T.ink}}>Group {donor.name} into a household</div>
                    <div style={{fontSize:12,color:T.ink3}}>Pick the spouse/partner(s) to combine with. {donor.name} becomes the primary. Hard credit stays with each donor — only the relationship view combines.</div>
                    <input value={hhSearch} onChange={e=>setHhSearch(e.target.value)} placeholder="Search donors…" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:9,padding:"9px 12px",fontSize:13,color:T.ink,outline:"none"}}/>
                    <div style={{overflowY:"auto",display:"flex",flexDirection:"column",gap:4,flex:1}}>
                      {allDonors.filter(x=>x.id!==donor.id&&!x.householdId&&(!hhSearch.trim()||(x.name+(x.email||"")).toLowerCase().includes(hhSearch.toLowerCase()))).slice(0,40).map(x=>{
                        const picked=hhPick.has(x.id);
                        return(
                          <label key={x.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:9,background:picked?"#1a6b4a12":T.white,border:"1px solid "+(picked?"#1a6b4a55":T.bg3),cursor:"pointer"}}>
                            <input type="checkbox" checked={picked} onChange={()=>{const n=new Set(hhPick);n.has(x.id)?n.delete(x.id):n.add(x.id);setHhPick(n);}} style={{accentColor:"#1a6b4a"}}/>
                            <span style={{fontSize:13,fontWeight:600,color:T.ink}}>{x.name}</span>
                            <span style={{marginLeft:"auto",fontSize:11,color:T.ink3}}>{fmtFull(x.total||0)}</span>
                          </label>
                        );
                      })}
                    </div>
                    <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
                      <button onClick={()=>{setHhModalOpen(false);setHhPick(new Set());}} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:9,padding:"9px 16px",fontSize:13,fontWeight:700,color:T.ink3,cursor:"pointer"}}>Cancel</button>
                      <button onClick={createHousehold} disabled={hhPick.size===0} style={{background:hhPick.size?"#1a6b4a":T.bg3,color:"#fff",border:"none",borderRadius:9,padding:"9px 18px",fontSize:13,fontWeight:700,cursor:hhPick.size?"pointer":"not-allowed"}}>Create household</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                Follow-up Tasks
                {tasks.filter(t=>!t.done).length>0&&<span style={{background:"#1a6b4a",color:"#fff",borderRadius:99,padding:"1px 6px",fontSize:9,fontWeight:800}}>{tasks.filter(t=>!t.done).length}</span>}
                {onAddTask&&<button onClick={onAddTask} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":"Add a follow-up task"} style={{marginLeft:"auto",background:"transparent",border:`1px solid ${T.bg3}`,borderRadius:7,padding:"3px 9px",color:isReadOnly?T.ink3:T.greenMid,fontSize:11,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",letterSpacing:0,textTransform:"none",opacity:isReadOnly?0.5:1}}>+ Add task</button>}
              </div>
              {tasks.length===0
                ?<div style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>No tasks yet — add a follow-up so nothing slips.</div>
                :<div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {[...tasks].sort((a,b)=>a.done-b.done||(a.due||"").localeCompare(b.due||"")).map(t=>{
                    const overdue=t.due&&!t.done&&daysDiff(t.due)<0;
                    return <div key={t.id} onClick={()=>onTaskToggle(t)} style={{background:T.white,border:`1px solid ${t.done?"#1a6b4a30":overdue?"#ef444430":T.bg3}`,borderRadius:10,padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:18,height:18,borderRadius:5,border:`2px solid ${t.done?"#1a6b4a":SC[t.priority]}`,background:t.done?"#1a6b4a":"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {t.done&&<span style={{color:"#fff",fontSize:10,lineHeight:1}}>✓</span>}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:500,color:t.done?T.ink3:T.ink,textDecoration:t.done?"line-through":"none",lineHeight:1.3}}>{t.title}</div>
                        {t.due&&<div style={{fontSize:11,color:overdue?"#ef4444":T.ink3,marginTop:2,fontWeight:overdue?700:400}}>
                          {overdue?"Overdue — was ":""}{new Date(t.due).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                        </div>}
                      </div>
                      <Pill label={t.priority} color={SC[t.priority]}/>
                    </div>;
                  })}
                </div>
              }
            </div>

            <div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3}}>Touchpoint Timeline</div>
                <button onClick={onLogTouchpoint} style={{background:"#10b981",border:"none",borderRadius:7,padding:"5px 12px",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Log</button>
              </div>
              <TouchpointTimeline interactions={localInts??donor.interactions??[]} onDelete={deleteInteraction}/>
            </div>
          </div>}

          {/* Gifts & Pledges tab */}
          {dpTab==="gifts"&&<div style={{padding:"20px 20px 24px 24px",display:"flex",flexDirection:"column",gap:18}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:14,fontWeight:800,color:T.ink}}>Gift History</div>
                <div style={{fontSize:12,color:T.ink3,marginTop:2}}>
                  Total: <strong style={{color:"#1a6b4a"}}>{fmtFull(giftsFull.reduce((s,g)=>s+g.amount,0))}</strong> · {giftsFull.length} gifts
                </div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <button onClick={exportGiftsCSV} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>↓ CSV</button>
                {receiptsEnabled&&(
                  <button onClick={()=>setShowYearEnd(v=>!v)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                    style={{background:showYearEnd?T.greenDk:T.bg,border:"1px solid "+(showYearEnd?T.greenDk:T.bg3),borderRadius:8,padding:"6px 12px",color:showYearEnd?"#fff":T.ink3,fontSize:12,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>
                    Year-end statement
                  </button>
                )}
                <button onClick={()=>setAddGiftOpen(v=>!v)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:"#10b981",border:"none",borderRadius:8,padding:"7px 12px",color:"#fff",fontSize:12,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>+ Add Gift</button>
              </div>
            </div>

            {!receiptsEnabled&&isAdmin&&(
              <div style={{background:"#fef3c7",border:"1px solid #fde68a",borderRadius:10,padding:"10px 14px",fontSize:12,color:"#92400e"}}>
                Tax receipts aren't set up yet — add your organization's legal info in Settings to send IRS-compliant receipts for gifts of $250+.
              </div>
            )}

            {showYearEnd&&receiptsEnabled&&(
              <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"16px"}}>
                <div style={{fontSize:12,fontWeight:700,color:T.ink,marginBottom:10}}>Year-End Giving Statement</div>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <span style={{fontSize:11,color:T.ink3}}>Tax year</span>
                  <input type="number" value={yearEndYear} onChange={e=>setYearEndYear(e.target.value)} style={{width:100,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"6px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                  <button onClick={sendYearEndStatement} disabled={yearEndBusy} style={{background:"#10b981",border:"none",borderRadius:6,padding:"7px 12px",color:"#fff",fontSize:12,fontWeight:700,cursor:yearEndBusy?"not-allowed":"pointer"}}>
                    {yearEndBusy?"Generating…":"Generate & email"}
                  </button>
                  <button onClick={()=>setShowYearEnd(false)} style={{background:T.bg,border:"none",borderRadius:6,padding:"7px 10px",color:T.ink3,fontSize:12,cursor:"pointer"}}>Cancel</button>
                </div>
                {yearEndErr&&<div style={{fontSize:11,color:"#dc2626",marginTop:8}}>{yearEndErr}</div>}
                <div style={{fontSize:11,color:T.ink3,marginTop:8,lineHeight:1.5}}>Consolidates every {yearEndYear} gift into one statement, emailed to the donor and superseding any prior statement for that year.</div>
              </div>
            )}

            {/* Recurring gift health — failed-payment recovery status */}
            {recurringSub&&(()=>{
              const RS_META={
                active:      {label:"Active",         color:"#1a6b4a"},
                past_due:    {label:"Payment failed",  color:T.red},
                recovering:  {label:"Recovering",      color:"#c9a84c"},
                recovered:   {label:"Recovered",       color:"#10b981"},
                canceled:    {label:"Canceled",        color:T.ink3},
              };
              const meta=RS_META[recurringSub.status]||{label:recurringSub.status,color:T.ink3};
              const atRisk=["past_due","recovering"].includes(recurringSub.status);
              return(
                <div style={{background:T.white,border:"1px solid "+meta.color+"30",borderLeft:"3px solid "+meta.color,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <span style={{background:meta.color+"15",color:meta.color,border:"1px solid "+meta.color+"40",borderRadius:99,padding:"3px 10px",fontSize:11,fontWeight:800}}>{meta.label}</span>
                    <span style={{fontSize:12,color:T.ink3}}>
                      Recurring gift{recurringSub.amount!=null?` · ${fmtFull(recurringSub.amount)}/${recurringSub.interval==="year"?"yr":"mo"}`:""}
                      {atRisk&&recurringSub.failure_count>0&&` · ${recurringSub.failure_count} failed attempt${recurringSub.failure_count===1?"":"s"}`}
                    </span>
                  </div>
                  {atRisk&&(
                    <button onClick={resendRecurringLink} disabled={isReadOnly||recurResendBusy||recurResendSent}
                      title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                      style={{background:meta.color,border:"none",borderRadius:8,padding:"6px 12px",color:"#fff",fontSize:12,fontWeight:700,cursor:(isReadOnly||recurResendBusy||recurResendSent)?"not-allowed":"pointer",opacity:(isReadOnly||recurResendBusy||recurResendSent)?0.5:1,whiteSpace:"nowrap"}}>
                      {recurResendSent?"Sent ✓":recurResendBusy?"Sending…":"Send card-update link"}
                    </button>
                  )}
                </div>
              );
            })()}

            {addGiftOpen&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"16px"}}>
              <div style={{fontSize:12,fontWeight:700,color:T.ink,marginBottom:12}}>New Gift</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                <input value={addGiftForm.amount} onChange={e=>setAddGiftForm(p=>({...p,amount:e.target.value}))} placeholder="Amount ($)" type="number" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none"}}/>
                <input value={addGiftForm.date} onChange={e=>setAddGiftForm(p=>({...p,date:e.target.value}))} type="date" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none"}}/>
                <select value={addGiftForm.type} onChange={e=>setAddGiftForm(p=>({...p,type:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none"}}>
                  {["cash","check","credit_card","stock","in_kind","matching","other"].map(t=><option key={t}>{t}</option>)}
                </select>
                <input value={addGiftForm.payment_method} onChange={e=>setAddGiftForm(p=>({...p,payment_method:e.target.value}))} placeholder="Payment method" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none"}}/>
              </div>
              <input value={addGiftForm.notes} onChange={e=>setAddGiftForm(p=>({...p,notes:e.target.value}))} placeholder="Notes" style={{width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none",boxSizing:"border-box",marginBottom:8}}/>
              {campaigns.length>0&&<select value={addGiftForm.campaign_id||""} onChange={e=>setAddGiftForm(p=>({...p,campaign_id:e.target.value}))} style={{width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none",boxSizing:"border-box",marginBottom:8}}>
                <option value="">No campaign attribution</option>
                {campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>}
              {pledges.filter(p=>p.status==="open").length>0&&(
                <select value={addGiftForm.pledgeId} onChange={e=>setAddGiftForm(p=>({...p,pledgeId:e.target.value}))} style={{width:"100%",background:T.bg,border:"1px solid "+T.terracotta+"50",borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none",boxSizing:"border-box",marginBottom:8}}>
                  <option value="">Not fulfilling a pledge</option>
                  {pledges.filter(p=>p.status==="open").map(p=>(
                    <option key={p.id} value={p.id}>Fulfills {fmtFull(p.amount)} pledge due {p.due_date}</option>
                  ))}
                </select>
              )}
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:T.ink,cursor:"pointer"}}>
                  <input type="checkbox" checked={addGiftForm.acknowledgement_sent} onChange={e=>setAddGiftForm(p=>({...p,acknowledgement_sent:e.target.checked}))} style={{accentColor:"#1a6b4a"}}/>
                  Acknowledgement sent
                </label>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={addGift} disabled={giftSaving} style={{background:"#10b981",border:"none",borderRadius:8,padding:"8px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Save</button>
                <button onClick={()=>setAddGiftOpen(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"8px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
              </div>
            </div>}

            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,overflow:"hidden"}}>
              {giftLoading?<div style={{padding:24,textAlign:"center",color:T.ink3,fontSize:12}}><Spin/></div>:giftsFull.length===0?(
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"40px 24px",textAlign:"center",gap:0}}>
                  <div style={{marginBottom:16,color:"#10b981",opacity:0.7}}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                  </div>
                  <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:20,fontWeight:400,color:"#0f1a12",letterSpacing:"-0.01em",marginBottom:8}}>No gifts recorded yet.</div>
                  <div style={{fontSize:13,color:"#6b7280",maxWidth:260,lineHeight:1.65,marginBottom:20}}>Log your first gift to start tracking acknowledgments and giving history.</div>
                  <button onClick={()=>setAddGiftOpen(true)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                    style={{background:"#1a6b4a",color:"#fff",border:"none",borderRadius:10,padding:"10px 22px",fontSize:13,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1,fontFamily:"'DM Sans',system-ui,sans-serif"}}>
                    Record a gift →
                  </button>
                </div>
              ):(
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:T.bg2}}>
                      {["Date","Amount","Type","Method","Ack","Receipt","Note",""].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:T.ink3,fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",borderBottom:"1px solid "+T.bg3}}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[...giftsFull].sort((a,b)=>new Date(b.date)-new Date(a.date)).map(g=>(
                      <tr key={g.id} style={{borderBottom:"1px solid "+T.bg3}}>
                        {giftEditId===g.id?(
                          <td colSpan={8} style={{padding:"10px 12px"}}>
                            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                              <input value={giftEditForm.amount} onChange={e=>setGiftEditForm(p=>({...p,amount:e.target.value}))} placeholder="Amount" type="number" style={{width:80,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                              <input value={giftEditForm.date} onChange={e=>setGiftEditForm(p=>({...p,date:e.target.value}))} type="date" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                              <select value={giftEditForm.type} onChange={e=>setGiftEditForm(p=>({...p,type:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}>
                                {["cash","check","credit_card","stock","in_kind","matching","other"].map(t=><option key={t}>{t}</option>)}
                              </select>
                              <input value={giftEditForm.payment_method} onChange={e=>setGiftEditForm(p=>({...p,payment_method:e.target.value}))} placeholder="Method" style={{width:100,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                              <input value={giftEditForm.notes} onChange={e=>setGiftEditForm(p=>({...p,notes:e.target.value}))} placeholder="Notes" style={{flex:1,minWidth:80,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                              <label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:T.ink,cursor:"pointer",flexShrink:0}}>
                                <input type="checkbox" checked={!!giftEditForm.acknowledgement_sent} onChange={e=>setGiftEditForm(p=>({...p,acknowledgement_sent:e.target.checked}))} style={{accentColor:"#1a6b4a"}}/>
                                Ack
                              </label>
                              <button onClick={()=>saveGiftEdit(g.id)} disabled={giftSaving} style={{background:"#10b981",border:"none",borderRadius:6,padding:"5px 10px",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>Save</button>
                              <button onClick={()=>setGiftEditId(null)} style={{background:T.bg,border:"none",borderRadius:6,padding:"5px 10px",color:T.ink3,fontSize:11,cursor:"pointer"}}>Cancel</button>
                            </div>
                          </td>
                        ):(
                          <>
                            <td style={{padding:"9px 12px",color:T.ink3,whiteSpace:"nowrap"}}>{g.date}</td>
                            <td style={{padding:"9px 12px",fontWeight:700,color:"#1a6b4a",whiteSpace:"nowrap"}}>{fmtFull(g.amount)}</td>
                            <td style={{padding:"9px 12px",color:T.ink3,textTransform:"capitalize"}}>{g.type||"cash"}</td>
                            <td style={{padding:"9px 12px",color:T.ink3}}>{g.payment_method||"—"}</td>
                            <td style={{padding:"9px 12px",textAlign:"center"}}>{g.acknowledgement_sent?<span style={{color:"#1a6b4a",fontSize:13}}>✓</span>:<span style={{color:T.ink3,fontSize:13}}>—</span>}</td>
                            <td style={{padding:"9px 12px",whiteSpace:"nowrap"}}>
                              {(()=>{
                                const r=receiptForGift(g.id);
                                if(r) return <button onClick={()=>downloadReceiptPdf(r.id,`receipt-${r.receipt_number}.pdf`)} style={{background:"none",border:"none",color:"#1a6b4a",fontSize:11,fontWeight:700,cursor:"pointer",padding:"2px 4px"}}>Receipt ✓ #{r.receipt_number}</button>;
                                if(!receiptsEnabled) return <span style={{color:T.ink3,fontSize:13}}>—</span>;
                                const busy=receiptBusyId===g.id;
                                return <button onClick={()=>sendReceipt(g.id)} disabled={busy||isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":""} style={{background:"none",border:"1px solid "+T.bg3,borderRadius:6,color:isReadOnly?T.ink3:"#1a6b4a",fontSize:11,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer",padding:"3px 8px",opacity:busy?0.6:1}}>{busy?"Sending…":"Send receipt"}</button>;
                              })()}
                            </td>
                            <td style={{padding:"9px 12px",color:T.ink3,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.notes||""}</td>
                            <td style={{padding:"9px 12px",whiteSpace:"nowrap"}}>
                              <button onClick={()=>{setGiftEditId(g.id);setGiftEditForm({amount:g.amount,date:g.date,type:g.type,payment_method:g.payment_method||"",notes:g.notes||"",fund_id:g.fund_id||"",acknowledgement_sent:g.acknowledgement_sent});}} style={{background:"none",border:"none",color:T.ink3,fontSize:12,cursor:"pointer",padding:"2px 6px"}}>Edit</button>
                              <button onClick={()=>deleteGift(g.id)} style={{background:"none",border:"none",color:"#ef4444",fontSize:12,cursor:"pointer",padding:"2px 6px"}}>Delete</button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pledges — a promise to give $X by a future date. Past-due
                unfulfilled pledges get reminders on the same cadence as the
                recurring-gift dunning system (see processPledgeReminders in
                server.js). Distinct from both Gift History above (money
                already received) and Planned Giving below (bequests/trusts,
                no due date). */}
            <div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <div style={{fontSize:12,fontWeight:700,color:T.ink}}>Pledges</div>
                <button onClick={()=>setAddPledgeOpen(v=>!v)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"5px 10px",color:T.ink3,fontSize:11,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.5:1}}>+ Add Pledge</button>
              </div>
              {addPledgeOpen&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"14px",marginBottom:10}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <input value={pledgeForm.amount} onChange={e=>setPledgeForm(p=>({...p,amount:e.target.value}))} placeholder="Pledged amount ($)" type="number" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                  <input value={pledgeForm.dueDate} onChange={e=>setPledgeForm(p=>({...p,dueDate:e.target.value}))} type="date" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                </div>
                <input value={pledgeForm.notes} onChange={e=>setPledgeForm(p=>({...p,notes:e.target.value}))} placeholder="Notes (optional)" style={{width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",boxSizing:"border-box",marginBottom:8}}/>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={addPledge} disabled={pledgeSaving} style={{background:T.terracotta,border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
                  <button onClick={()=>setAddPledgeOpen(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"7px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>Cancel</button>
                </div>
              </div>}
              {pledges.length===0?<div style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>No pledges on file</div>:(
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {pledges.map(pl=>{
                    const PL_META={open:{label:"Open",color:"#3b82f6"},fulfilled:{label:"Fulfilled",color:"#1a6b4a"},written_off:{label:"Written off",color:T.ink3}};
                    const meta=PL_META[pl.status]||PL_META.open;
                    const isOverdue=pl.status==="open"&&pl.first_overdue_at;
                    const daysOver=isOverdue?daysDiff(pl.due_date):null;
                    return(
                      <div key={pl.id} style={{background:T.white,border:`1px solid ${isOverdue?T.terracotta+"40":T.bg3}`,borderLeft:`3px solid ${isOverdue?T.terracotta:meta.color}`,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                        <div>
                          <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                            <span style={{fontSize:14,fontWeight:800,color:T.ink}}>{fmtFull(pl.amount)}</span>
                            <span style={{background:meta.color+"15",color:meta.color,border:"1px solid "+meta.color+"40",borderRadius:99,padding:"2px 8px",fontSize:10,fontWeight:800}}>{meta.label}</span>
                            {isOverdue&&<span style={{fontSize:10,fontWeight:800,color:T.terracotta}}>{daysOver}d overdue · reminder {Math.min(pl.reminder_step+1,4)}/4 sent</span>}
                          </div>
                          <div style={{fontSize:11,color:T.ink3,marginTop:2}}>Due {pl.due_date}</div>
                          {pl.notes&&<div style={{fontSize:12,color:T.ink3,marginTop:3,lineHeight:1.4}}>{pl.notes}</div>}
                        </div>
                        <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                          {pl.status==="open"&&<>
                            {isOverdue&&<button onClick={()=>resendPledgeReminder(pl.id)} disabled={isReadOnly||pledgeResendBusyId===pl.id||pledgeResentIds.has(pl.id)}
                              style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 9px",color:T.ink2,fontSize:11,fontWeight:600,cursor:(isReadOnly||pledgeResendBusyId===pl.id||pledgeResentIds.has(pl.id))?"not-allowed":"pointer",opacity:(isReadOnly||pledgeResendBusyId===pl.id||pledgeResentIds.has(pl.id))?0.5:1}}>
                              {pledgeResentIds.has(pl.id)?"Sent ✓":pledgeResendBusyId===pl.id?"Sending…":"Resend reminder"}
                            </button>}
                            <button onClick={()=>setPledgeStatus(pl.id,"fulfilled")} disabled={isReadOnly} style={{background:"#e8f5ef",border:"1px solid #10b981",borderRadius:6,padding:"5px 9px",color:"#1a6b4a",fontSize:11,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer"}}>Mark Fulfilled</button>
                            <button onClick={()=>setPledgeStatus(pl.id,"written_off")} disabled={isReadOnly} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 9px",color:T.ink3,fontSize:11,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer"}}>Write Off</button>
                          </>}
                          <button onClick={()=>deletePledge(pl.id)} style={{background:"none",border:"none",color:"#ef4444",fontSize:14,cursor:"pointer",flexShrink:0,padding:"2px 4px"}}>×</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Planned Giving */}
            <div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <div style={{fontSize:12,fontWeight:700,color:T.ink,display:"flex",alignItems:"center",gap:7}}>
                  Planned Giving
                  {donor.plannedGiving&&<span style={{background:"#8b5cf610",color:"#8b5cf6",border:"1px solid #8b5cf640",borderRadius:99,padding:"2px 8px",fontSize:10,fontWeight:700}}>Indicated</span>}
                </div>
                <button onClick={()=>setAddPgOpen(v=>!v)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"5px 10px",color:T.ink3,fontSize:11,cursor:"pointer"}}>+ Add</button>
              </div>
              {addPgOpen&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"14px",marginBottom:10}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <select value={pgForm.type} onChange={e=>setPgForm(p=>({...p,type:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}>
                    {["bequest","charitable_remainder_trust","charitable_lead_trust","annuity","ira_beneficiary","life_insurance","real_estate","other"].map(t=><option key={t} value={t}>{t.replace(/_/g," ")}</option>)}
                  </select>
                  <input value={pgForm.estimated_value} onChange={e=>setPgForm(p=>({...p,estimated_value:e.target.value}))} placeholder="Estimated value ($)" type="number" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                  <input value={pgForm.date_indicated} onChange={e=>setPgForm(p=>({...p,date_indicated:e.target.value}))} type="date" placeholder="Date indicated" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                  <input value={pgForm.notes} onChange={e=>setPgForm(p=>({...p,notes:e.target.value}))} placeholder="Notes" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={addPlannedGift} disabled={pgSaving} style={{background:"#8b5cf6",border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
                  <button onClick={()=>setAddPgOpen(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"7px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>Cancel</button>
                </div>
              </div>}
              {plannedGifts.length===0?<div style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>No planned giving on file</div>:(
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {plannedGifts.map(pg=>(
                    <div key={pg.id} style={{background:T.white,border:"1px solid #8b5cf620",borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:700,color:"#8b5cf6",textTransform:"capitalize"}}>{(pg.type||"").replace(/_/g," ")}</div>
                        {pg.estimated_value&&<div style={{fontSize:12,color:T.ink3,marginTop:2}}>Est. {fmtFull(pg.estimated_value)}</div>}
                        {pg.date_indicated&&<div style={{fontSize:11,color:T.ink3,marginTop:1}}>Indicated {pg.date_indicated}</div>}
                        {pg.notes&&<div style={{fontSize:12,color:T.ink3,marginTop:3,lineHeight:1.4}}>{pg.notes}</div>}
                      </div>
                      <button onClick={()=>deletePlannedGift(pg.id)} style={{background:"none",border:"none",color:"#ef4444",fontSize:12,cursor:"pointer",flexShrink:0,padding:"2px 4px"}}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>}

          {/* Materials tab */}
          {/* Funds tab */}
          {dpTab==="funds"&&<div style={{padding:"20px 20px 24px 24px",display:"flex",flexDirection:"column",gap:18}}>
            {fundLoading&&<div style={{textAlign:"center",color:T.ink3,fontSize:12,padding:24}}><Spin/></div>}
            {!fundLoading&&fundAffinity&&(()=>{
              const {affinity,unrestrictedTotal,restrictedTotal,totalGiving,activeFunds}=fundAffinity;
              const maxFund=affinity.length>0?affinity[0].total:1;
              return(<>
                <div>
                  <div style={{fontSize:14,fontWeight:800,color:T.ink,marginBottom:14}}>What they support</div>
                  {affinity.length===0
                    ?<div style={{fontSize:13,color:T.ink3,fontStyle:"italic"}}>No fund-attributed gifts yet. Assign funds when logging gifts.</div>
                    :<div style={{display:"flex",flexDirection:"column",gap:10}}>
                      {affinity.map(f=>(
                        <div key={f.fundId} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px"}}>
                          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:6}}>
                            <div>
                              <span style={{fontSize:13,fontWeight:700,color:T.ink}}>{f.fundName}</span>
                              {f.restricted&&<span style={{marginLeft:6,fontSize:10,fontWeight:700,color:"#8b5cf6",background:"#8b5cf610",borderRadius:99,padding:"2px 7px"}}>Restricted</span>}
                            </div>
                            <div style={{textAlign:"right"}}>
                              <div style={{fontSize:14,fontWeight:800,color:"#1a6b4a"}}>{fmtFull(f.total)}</div>
                              <div style={{fontSize:10,color:T.ink3}}>{f.pct}% of lifetime</div>
                            </div>
                          </div>
                          <div style={{background:T.bg3,borderRadius:99,height:6,overflow:"hidden",marginBottom:6}}>
                            <div style={{height:"100%",background:"#1a6b4a",borderRadius:99,width:`${Math.round(f.total/maxFund*100)}%`,transition:"width 0.4s"}}/>
                          </div>
                          <div style={{fontSize:11,color:T.ink3}}>{f.giftCount} gift{f.giftCount!==1?"s":""} · Last: {f.lastDate}</div>
                        </div>
                      ))}
                    </div>
                  }
                </div>

                <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px"}}>
                  <div style={{fontSize:12,fontWeight:700,color:T.ink,marginBottom:10}}>Restricted vs Unrestricted</div>
                  {totalGiving>0?(()=>{
                    const rPct=Math.round(restrictedTotal/totalGiving*100);
                    const uPct=100-rPct;
                    return(<>
                      <div style={{height:10,borderRadius:99,overflow:"hidden",display:"flex",marginBottom:8}}>
                        <div style={{width:`${rPct}%`,background:"#8b5cf6",transition:"width 0.4s"}}/>
                        <div style={{flex:1,background:"#10b981"}}/>
                      </div>
                      <div style={{display:"flex",gap:16,fontSize:12}}>
                        <div style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:2,background:"#8b5cf6",display:"inline-block"}}/>Restricted: {fmtFull(restrictedTotal)} ({rPct}%)</div>
                        <div style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:2,background:"#10b981",display:"inline-block"}}/>Unrestricted: {fmtFull(unrestrictedTotal)} ({uPct}%)</div>
                      </div>
                    </>);
                  })():<div style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>No giving data yet</div>}
                </div>

                {affinity.length>0&&(
                  <div style={{background:"#c9a84c10",border:"1px solid #c9a84c40",borderRadius:12,padding:"14px 16px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#c9a84c",marginBottom:8}}>💡 Suggested Asks</div>
                    {affinity.slice(0,2).map(f=>(
                      <div key={f.fundId} style={{fontSize:12,color:T.ink,marginBottom:4}}>
                        This donor has given {fmtFull(f.total)} to <strong>{f.fundName}</strong>. Consider them for {f.fundName} campaign appeals.
                      </div>
                    ))}
                    {activeFunds.filter(f=>!affinity.find(a=>a.fundId===f.id)).length>0&&(
                      <div style={{fontSize:12,color:T.ink3,marginTop:8}}>
                        Not yet engaged with: {activeFunds.filter(f=>!affinity.find(a=>a.fundId===f.id)).map(f=>f.name).slice(0,3).join(", ")}
                      </div>
                    )}
                  </div>
                )}
              </>);
            })()}
            {!fundLoading&&!fundAffinity&&<div style={{fontSize:13,color:T.ink3,fontStyle:"italic",textAlign:"center",padding:24}}>Could not load fund data.</div>}
          </div>}

          {/* Related tab — manual household/spouse/family/employer_match
              links. No auto-detection (matching last name, address, etc.) —
              a real fast-follow idea, not built here. */}
          {dpTab==="related"&&<div style={{padding:"20px 20px 24px 24px",display:"flex",flexDirection:"column",gap:16}}>
            {householdTotal!=null&&(
              <div style={{background:T.gold+"12",border:"1px solid "+T.gold+"40",borderRadius:12,padding:"12px 16px"}}>
                <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:T.ink3,marginBottom:4}}>Household Giving</div>
                <div style={{fontSize:13,color:T.ink}}><strong>{fmtFull(donor.total)}</strong> individually · <strong style={{color:"#92700f"}}>{fmtFull(householdTotal)}</strong> household total</div>
              </div>
            )}

            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{fontSize:14,fontWeight:800,color:T.ink}}>Linked Donors</div>
              {!isReadOnly&&<button onClick={()=>{setRelPickerOpen(v=>!v);setRelErr("");}} style={{background:"#10b981",border:"none",borderRadius:7,padding:"6px 12px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Link to another donor</button>}
            </div>

            {relPickerOpen&&(
              <div style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:12,display:"flex",flexDirection:"column",gap:8}}>
                <div style={{display:"flex",gap:8}}>
                  {DONOR_RELATIONSHIP_LABELS.map(([v,l])=>(
                    <button key={v} onClick={()=>setRelType(v)} style={{background:relType===v?T.greenDk+"18":T.white,border:`1px solid ${relType===v?T.greenDk:T.bg3}`,borderRadius:7,padding:"5px 10px",color:relType===v?T.greenDk:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer"}}>{l}</button>
                  ))}
                </div>
                <input value={relSearch} onChange={e=>setRelSearch(e.target.value)} placeholder="Search donors by name…" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 12px",color:T.ink,fontSize:13,outline:"none"}}/>
                {relSearch.trim()&&(
                  <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:180,overflowY:"auto"}}>
                    {relPickerResults.length===0
                      ?<div style={{fontSize:12,color:T.ink3,fontStyle:"italic",padding:"6px 4px"}}>No matching donors.</div>
                      :relPickerResults.map(d=>(
                        <button key={d.id} disabled={relSaving} onClick={()=>linkDonor(d.id)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",cursor:relSaving?"not-allowed":"pointer",textAlign:"left"}}>
                          <span style={{fontSize:12,fontWeight:600,color:T.ink}}>{d.name}</span>
                          <span style={{fontSize:11,color:T.ink3}}>{fmtFull(d.total)} →</span>
                        </button>
                      ))}
                  </div>
                )}
                {relErr&&<div style={{color:"#ef4444",fontSize:12}}>{relErr}</div>}
              </div>
            )}

            {relLoading?<div style={{padding:20,textAlign:"center"}}><Spin/></div>
              :relationships.length===0
                ?<div style={{fontSize:13,color:T.ink3,fontStyle:"italic",textAlign:"center",padding:24}}>No linked donors yet.</div>
                :<div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {relationships.map(r=>(
                    <div key={r.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 14px"}}>
                      <div onClick={()=>onSelectRelatedDonor&&onSelectRelatedDonor(r.relatedDonorId)} style={{cursor:onSelectRelatedDonor?"pointer":"default",minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:T.ink}}>{r.relatedDonorName} →</div>
                        <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{fmtFull(r.relatedDonorTotalGiving)} lifetime</div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                        <Pill label={DONOR_RELATIONSHIP_LABELS.find(([v])=>v===r.relationshipType)?.[1]||r.relationshipType}/>
                        {!isReadOnly&&<button onClick={()=>unlinkDonor(r.id)} style={{background:"transparent",border:"1px solid #ef444455",borderRadius:7,padding:"4px 9px",color:"#ef4444",fontSize:11,cursor:"pointer"}}>Remove</button>}
                      </div>
                    </div>
                  ))}
                </div>
            }
          </div>}

          {dpTab==="materials"&&<div style={{padding:"20px 20px 24px 24px",display:"flex",flexDirection:"column",gap:16}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{fontSize:14,fontWeight:800,color:T.ink}}>Donor Materials</div>
            </div>
            <div
              onDragOver={e=>{e.preventDefault();setMatDragging(true);}}
              onDragLeave={()=>setMatDragging(false)}
              onDrop={async e=>{e.preventDefault();setMatDragging(false);const file=e.dataTransfer.files[0];if(file)uploadMaterial(file);}}
              onClick={()=>fileInputRef.current?.click()}
              style={{border:`2px dashed ${matDragging?"#10b981":T.bg3}`,borderRadius:12,padding:"28px 20px",textAlign:"center",cursor:"pointer",transition:"border-color 0.15s",background:matDragging?"#10b98108":T.bg}}>
              <div style={{fontSize:28,marginBottom:6}}>📎</div>
              <div style={{fontSize:13,color:T.ink3}}>{matUploading?"Uploading…":"Drop a file here or click to browse"}</div>
              <div style={{fontSize:11,color:T.ink3,marginTop:4}}>Proposals, letters, research — any file type</div>
              <input ref={fileInputRef} type="file" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(f)uploadMaterial(f);e.target.value="";}}/>
            </div>
            {matLoading?<div style={{textAlign:"center",color:T.ink3,fontSize:12,padding:16}}><Spin/></div>:materials.length===0?<div style={{fontSize:12,color:T.ink3,fontStyle:"italic",textAlign:"center",padding:16}}>No materials uploaded yet</div>:(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {materials.map(m=>(
                  <div key={m.id} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",gap:12}}>
                    <div style={{fontSize:22,flexShrink:0}}>
                      {m.file_type?.includes("pdf")?"📄":m.file_type?.includes("image")?"🖼️":m.file_type?.includes("word")?"📝":"📎"}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.file_name}</div>
                      <div style={{fontSize:11,color:T.ink3,marginTop:1}}>{m.uploaded_by&&`Uploaded by ${m.uploaded_by} · `}{new Date(m.uploaded_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
                      {m.notes&&<div style={{fontSize:11,color:T.ink3,marginTop:2}}>{m.notes}</div>}
                    </div>
                    <div style={{display:"flex",gap:6,flexShrink:0}}>
                      {(m.file_data||m.file_url)&&<button onClick={()=>viewMaterial(m)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 10px",color:T.ink3,fontSize:11,cursor:"pointer"}}>View</button>}
                      <button onClick={()=>deleteMaterial(m.id)} style={{background:"none",border:"1px solid #ef444430",borderRadius:7,padding:"5px 10px",color:"#ef4444",fontSize:11,cursor:"pointer"}}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>}

          {/* Activity tab */}
          {dpTab==="activity"&&<div style={{padding:"20px 20px 24px 24px",display:"flex",flexDirection:"column",gap:14}}>
            {/* Mode toggle */}
            <div style={{display:"flex",background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,overflow:"hidden",alignSelf:"flex-start"}}>
              {[["log","Activity Log"],["timeline","Stewardship Timeline"]].map(([m,l])=>(
                <button key={m} onClick={()=>setActMode(m)} style={{background:actMode===m?T.white:"transparent",border:"none",padding:"8px 16px",color:actMode===m?T.ink:T.ink3,fontSize:12,fontWeight:actMode===m?700:400,cursor:"pointer"}}>
                  {l}
                </button>
              ))}
            </div>

            {actMode==="log"&&<>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {["all","call","meeting","email","gift","event","stewardship","note"].map(t=>(
                    <button key={t} onClick={()=>setActFilter(t)} style={{background:actFilter===t?T.greenDk:"transparent",border:`1px solid ${actFilter===t?T.greenDk:T.bg3}`,borderRadius:99,padding:"4px 10px",color:actFilter===t?"#fff":T.ink3,fontSize:11,cursor:"pointer",fontWeight:actFilter===t?700:400,textTransform:"capitalize"}}>
                      {t}
                    </button>
                  ))}
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>setStwOpen(v=>!v)} style={{background:"#10b98110",border:"1px solid #10b98130",borderRadius:8,padding:"7px 12px",color:"#10b981",fontSize:12,fontWeight:700,cursor:"pointer"}}>💌 Log Stewardship</button>
                  <button onClick={onLogTouchpoint} style={{background:"#10b981",border:"none",borderRadius:8,padding:"7px 12px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Log Touchpoint</button>
                </div>
              </div>
              {stwOpen&&<div style={{background:T.white,border:"1px solid #10b98130",borderRadius:12,padding:"14px 16px"}}>
                <div style={{fontSize:12,fontWeight:700,color:T.ink,marginBottom:10}}>Log Stewardship Touch</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <select value={stwForm.type} onChange={e=>setStwForm(p=>({...p,type:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}>
                    {[["thank_you","Thank You Sent"],["recognition","Recognition"],["gift_sent","Gift Sent"],["impact_update","Impact Update"],["appreciation_event","Appreciation Event"],["holiday_card","Holiday Card"],["birthday","Birthday"],["other","Other"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                  <input value={stwForm.date} onChange={e=>setStwForm(p=>({...p,date:e.target.value}))} type="date" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                  <input value={stwForm.detail} onChange={e=>setStwForm(p=>({...p,detail:e.target.value}))} placeholder="What was sent/done (e.g. signed book, tote bag)" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",gridColumn:"1/-1"}}/>
                  <input value={stwForm.note} onChange={e=>setStwForm(p=>({...p,note:e.target.value}))} placeholder="Optional note" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",gridColumn:"1/-1"}}/>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={saveStewardship} disabled={stwSaving} style={{background:"#10b981",border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
                  <button onClick={()=>setStwOpen(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"7px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>Cancel</button>
                </div>
              </div>}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {(localInts??donor.interactions??[]).filter(i=>actFilter==="all"||i.type===actFilter).map(i=>{
                  const typeIcon={call:"📞",meeting:"🤝",email:"✉️",gift:"🎁",event:"🎟️",stewardship:"💌",note:"📝",stage_change:"📈",planned_gift:"⭐",material:"📄"}[i.type]||"•";
                  const typeColor={call:"#3b82f6",meeting:"#1a6b4a",email:"#8b5cf6",gift:"#c9a84c",event:"#ec4899",stewardship:"#10b981",stage_change:"#3b82f6",planned_gift:"#f59e0b",material:"#6b7280"}[i.type]||T.ink3;
                  return(<div key={i.id||i.date} className="tp-row" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",display:"flex",gap:10,alignItems:"flex-start"}}>
                    <div style={{fontSize:16,flexShrink:0,marginTop:1}}>{typeIcon}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontSize:11,fontWeight:700,color:typeColor,textTransform:"capitalize"}}>{(i.type||"note").replace(/_/g," ")}</span>
                        <span style={{fontSize:11,color:T.ink3}}>{i.date}</span>
                        {i.logged_by_name&&<span style={{fontSize:10,color:T.ink3,fontStyle:"italic"}}>by {i.logged_by_name}</span>}
                      </div>
                      {i.note&&<div style={{fontSize:12,color:T.ink,marginTop:3,lineHeight:1.5,whiteSpace:"pre-wrap"}}>{i.note}</div>}
                    </div>
                    {i.id&&<button className="tp-del-btn" title="Delete this entry" aria-label="Delete this entry"
                      onClick={()=>{if(window.confirm("Delete this timeline entry? This can't be undone."))deleteInteraction(i);}}
                      style={{background:"transparent",border:"none",cursor:"pointer",color:T.terracotta,fontSize:14,padding:"2px 4px",flexShrink:0,lineHeight:1}}>🗑</button>}
                  </div>);
                })}
                {(localInts??donor.interactions??[]).filter(i=>actFilter==="all"||i.type===actFilter).length===0&&<div style={{fontSize:12,color:T.ink3,fontStyle:"italic",textAlign:"center",padding:16}}>No activity logged yet</div>}
              </div>
            </>}

            {actMode==="timeline"&&(()=>{
              const ints=localInts??donor.interactions??[];
              const sortedGiftsForTimeline=[...giftsFull].sort((a,b)=>new Date(a.date)-new Date(b.date));
              const firstGiftDate=sortedGiftsForTimeline[0]?.date;
              const largestGift=sortedGiftsForTimeline.reduce((m,g)=>g.amount>m.amount?g:m,{amount:0,date:""});
              const milestones=[];
              if(firstGiftDate)milestones.push({date:firstGiftDate,icon:"⭐",label:"First gift",desc:`$${sortedGiftsForTimeline[0]?.amount?.toLocaleString()} — relationship began`,color:"#c9a84c",big:true});
              if(largestGift.amount>0&&largestGift.date!==firstGiftDate)milestones.push({date:largestGift.date,icon:"⭐",label:"Largest gift",desc:`$${largestGift.amount.toLocaleString()} — record gift`,color:"#c9a84c",big:true});
              if(firstGiftDate){
                const ann=new Date(firstGiftDate);ann.setFullYear(ann.getFullYear()+1);
                const annStr=ann.toISOString().split("T")[0];
                if(new Date(annStr)<=new Date())milestones.push({date:annStr,icon:"⭐",label:"1-year anniversary",desc:"One year as a donor",color:"#c9a84c",big:true});
              }
              let cumulative=0;
              sortedGiftsForTimeline.forEach(g=>{
                const prev=cumulative;cumulative+=g.amount;
                const crossed=[10000,25000,50000,100000,250000].filter(t=>prev<t&&cumulative>=t);
                crossed.forEach(t=>milestones.push({date:g.date,icon:"⭐",label:`$${(t/1000)}k milestone`,desc:`Lifetime giving crossed $${(t/1000)}k`,color:"#c9a84c",big:true}));
              });

              const events=[
                ...ints.filter(i=>["call","meeting","email","gift","event","stewardship","stage_change","planned_gift"].includes(i.type)).map(i=>({
                  date:i.date,
                  icon:{call:"📞",meeting:"🤝",email:"✉️",gift:"🎁",event:"🎟️",stewardship:"💌",stage_change:"📈",planned_gift:"⭐"}[i.type]||"•",
                  label:(i.type||"note").replace(/_/g," "),
                  desc:i.note||"",
                  color:{call:"#3b82f6",meeting:"#1a6b4a",email:"#8b5cf6",gift:"#c9a84c",event:"#ec4899",stewardship:"#10b981",stage_change:"#3b82f6",planned_gift:"#f59e0b"}[i.type]||T.ink3,
                  big:false,
                  loggedBy:i.logged_by_name,
                })),
                ...milestones,
              ].sort((a,b)=>new Date(b.date)-new Date(a.date));

              if(events.length===0)return<div style={{fontSize:12,color:T.ink3,fontStyle:"italic",textAlign:"center",padding:24}}>No timeline events yet. Log touchpoints and gifts to build the relationship arc.</div>;

              return(<div style={{position:"relative",paddingLeft:28}}>
                <div style={{position:"absolute",left:10,top:0,bottom:0,width:2,background:"linear-gradient(to bottom, #10b981, #c9a84c44)"}}/>
                {events.map((ev,i)=>(
                  <div key={i} style={{position:"relative",marginBottom:ev.big?20:14}}>
                    <div style={{position:"absolute",left:-28,width:ev.big?20:16,height:ev.big?20:16,borderRadius:"50%",background:ev.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:ev.big?11:9,border:`2px solid ${T.white}`,boxShadow:`0 0 0 2px ${ev.color}44`,top:0,flexShrink:0,zIndex:1}}>
                      {ev.icon}
                    </div>
                    <div style={{background:ev.big?"#c9a84c08":T.white,border:`1px solid ${ev.big?"#c9a84c40":T.bg3}`,borderRadius:10,padding:ev.big?"12px 14px":"9px 13px",marginLeft:4}}>
                      <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontSize:12,fontWeight:ev.big?800:700,color:ev.color,textTransform:"capitalize"}}>{ev.label}</span>
                        <span style={{fontSize:11,color:T.ink3}}>{ev.date}</span>
                        {ev.loggedBy&&<span style={{fontSize:10,color:T.ink3,fontStyle:"italic"}}>by {ev.loggedBy}</span>}
                      </div>
                      {ev.desc&&<div style={{fontSize:12,color:T.ink,marginTop:2,lineHeight:1.4}}>{ev.desc}</div>}
                    </div>
                  </div>
                ))}
              </div>);
            })()}
          </div>}
        </div>

        {/* RIGHT */}
        <div style={{overflowY:"auto",padding:"22px 24px 24px 20px",display:"flex",flexDirection:"column",gap:18,background:"#0f1a12"}}>
          {donor.stripeSubscriptionStatus==="active"&&(
            <div style={{background:"#10b98110",border:"1px solid #10b98130",borderRadius:12,padding:"12px 14px",display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:16}}>🔁</span>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:"#1a6b4a"}}>Recurring Donor</div>
                <div style={{fontSize:11,color:"#15803d",marginTop:1}}>Active {donor.stripeSubscriptionId?"subscription":"recurring gift"}</div>
              </div>
            </div>
          )}
          <div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"#8fa896",marginBottom:8}}>Relationship Owner</div>
            <div style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:12,padding:"12px 14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:T.greenDk+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#10b981",flexShrink:0}}>{(donor.assignedToName||"?")[0]}</div>
                <div style={{flex:1,fontSize:13,fontWeight:600,color:"#f0ede6"}}>{donor.assignedToName||"Unassigned"}</div>
                {isAdmin&&<button onClick={()=>setShowReassign(v=>!v)} style={{background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:7,padding:"3px 10px",color:"#8fa896",fontSize:11,cursor:"pointer"}}>{showReassign?"Cancel":"Reassign"}</button>}
              </div>
              {showReassign&&isAdmin&&<div style={{marginTop:10,display:"flex",flexDirection:"column",gap:8}}>
                <select value={reassignId} onChange={e=>setReassignId(e.target.value)} style={{width:"100%",background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"8px 10px",color:"#f0ede6",fontSize:12,outline:"none",cursor:"pointer"}}>
                  <option value="">Select team member…</option>
                  {orgTeam.map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                </select>
                <button onClick={handleReassign} disabled={reassignLoading||!reassignId} style={{background:reassignId?T.greenDk:"#1a2e1f",border:"none",borderRadius:8,padding:"8px",color:"#f0ede6",fontSize:12,fontWeight:600,cursor:reassignId?"pointer":"not-allowed"}}>
                  {reassignLoading?"Saving…":"Confirm Reassignment"}
                </button>
              </div>}
            </div>
          </div>

          {sequences.length>0&&<div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"#8fa896",marginBottom:8}}>Sequences</div>
            {seqToast&&<div style={{background:"#0d5c3a22",border:"1px solid #10b981",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#10b981",fontWeight:600,marginBottom:8}}>{seqToast}</div>}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              {!seqOpen?<button onClick={()=>{setSeqOpen(true);setSeqId("");}} style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:8,padding:"6px 12px",fontSize:12,color:"#10b981",cursor:"pointer"}}>+ Enroll in sequence</button>
              :<>
                <select value={seqId} onChange={e=>setSeqId(e.target.value)} style={{background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"6px 10px",color:"#f0ede6",fontSize:12,outline:"none",cursor:"pointer",flex:1}}>
                  <option value="">Select sequence…</option>
                  {sequences.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button disabled={!seqId||seqLoading} onClick={async()=>{
                  if(!seqId)return;setSeqLoading(true);
                  try{
                    await apiFetch(`/sequences/${seqId}/enroll`,{method:"POST",body:JSON.stringify({donorId:donor.id})});
                    const seqName=sequences.find(s=>s.id===seqId)?.name||"sequence";
                    setSeqToast(`Enrolled in "${seqName}"`);setTimeout(()=>setSeqToast(""),3500);
                    setSeqOpen(false);setSeqId("");
                  }catch(e){alert(e.message||"Could not enroll");}
                  setSeqLoading(false);
                }} style={{background:seqId?T.greenDk:"#1a2e1f",border:"none",borderRadius:8,padding:"6px 12px",color:"#f0ede6",fontSize:12,fontWeight:600,cursor:seqId?"pointer":"not-allowed"}}>
                  {seqLoading?"…":"Enroll"}
                </button>
                <button onClick={()=>{setSeqOpen(false);setSeqId("");}} style={{background:"transparent",border:"none",padding:"6px 8px",color:"#8fa896",fontSize:12,cursor:"pointer"}}>✕</button>
              </>}
            </div>
          </div>}

          {cfData.length>0&&<div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"#8fa896",marginBottom:8}}>Custom Fields</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {cfData.map(f=>(
                <div key={f.fieldId} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                  <div style={{fontSize:12,color:"#8fa896",fontWeight:600,minWidth:90,flexShrink:0}}>{f.label}{f.required&&<span style={{color:"#f87171",marginLeft:2}}>*</span>}</div>
                  {cfEditing===f.fieldId?(
                    <div style={{display:"flex",gap:6,flex:1}}>
                      {f.fieldType==="checkbox"?(
                        <select value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)}
                          style={{flex:1,background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"5px 8px",fontSize:12,color:"#f0ede6",outline:"none"}}>
                          <option value="">—</option>
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                        </select>
                      ):f.fieldType==="dropdown"?(
                        <select value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)}
                          style={{flex:1,background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"5px 8px",fontSize:12,color:"#f0ede6",outline:"none"}}>
                          <option value="">—</option>
                          {(f.options||[]).map(o=><option key={o} value={o}>{o}</option>)}
                        </select>
                      ):(
                        <input value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)}
                          type={f.fieldType==="number"?"number":f.fieldType==="date"?"date":"text"}
                          style={{flex:1,background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"5px 8px",fontSize:12,color:"#f0ede6",outline:"none"}}
                          onKeyDown={async e=>{
                            if(e.key==="Enter"){
                              await apiFetch(`/donors/${donor.id}/custom-fields`,{method:"POST",body:JSON.stringify({fieldId:f.fieldId,value:cfEditVal})});
                              setCfData(prev=>prev.map(x=>x.fieldId===f.fieldId?{...x,value:cfEditVal}:x));
                              setCfSaved(f.fieldId);setTimeout(()=>setCfSaved(null),2000);
                              setCfEditing(null);onCfSaved?.();
                            }else if(e.key==="Escape"){setCfEditing(null);}
                          }}
                          autoFocus
                        />
                      )}
                      <button onClick={async()=>{
                        await apiFetch(`/donors/${donor.id}/custom-fields`,{method:"POST",body:JSON.stringify({fieldId:f.fieldId,value:cfEditVal})});
                        setCfData(prev=>prev.map(x=>x.fieldId===f.fieldId?{...x,value:cfEditVal}:x));
                        setCfSaved(f.fieldId);setTimeout(()=>setCfSaved(null),2000);
                        setCfEditing(null);onCfSaved?.();
                      }} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"5px 10px",color:"#f0ede6",fontSize:11,fontWeight:700,cursor:"pointer"}}>Save</button>
                      <button onClick={()=>setCfEditing(null)} style={{background:"transparent",border:"none",padding:"5px 8px",color:"#8fa896",fontSize:12,cursor:"pointer"}}>✕</button>
                    </div>
                  ):(
                    <div style={{display:"flex",alignItems:"center",gap:6,flex:1,justifyContent:"flex-end"}}>
                      <span style={{fontSize:12,color:f.value?"#f0ede6":"#8fa896",fontStyle:f.value?"normal":"italic"}}>
                        {cfSaved===f.fieldId?"Saved ✓":f.value||"—"}
                      </span>
                      <button onClick={()=>{setCfEditing(f.fieldId);setCfEditVal(f.value||"");}}
                        style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:6,padding:"3px 8px",fontSize:10,color:"#10b981",cursor:"pointer"}}>Edit</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>}

          {donorEvents.length>0&&<div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"#8fa896",marginBottom:8}}>Events</div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {donorEvents.slice(0,5).map(e=>{
                const EVT_ICONS={gala:"🎭",cultivation:"🍽️",site_visit:"🏢",board_meeting:"🏛️",volunteer:"🤝",webinar:"💻",other:"📅"};
                const EVT_COLORS={gala:"#8b5cf6",cultivation:"#10b981",site_visit:"#3b82f6",board_meeting:"#0d5c3a",volunteer:"#f59e0b",webinar:"#ec4899",other:"#6b7280"};
                const ATT_COL={invited:"#6b7280",confirmed:"#3b82f6",attended:"#10b981",no_show:"#ef4444",cancelled:"#6b7280"};
                const icon=EVT_ICONS[e.event_type]||"📅";
                const attCol=ATT_COL[e.attendee_status]||"#6b7280";
                const d=e.date?new Date(e.date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"";
                return(
                  <div key={e.id} style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:8,padding:"8px 10px",display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:14,flexShrink:0}}>{icon}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:"#f0ede6",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.name}</div>
                      <div style={{fontSize:10,color:"#8fa896"}}>{d}</div>
                    </div>
                    <span style={{background:attCol+"22",color:attCol,border:`1px solid ${attCol}44`,borderRadius:99,padding:"2px 8px",fontSize:9,fontWeight:700,flexShrink:0,textTransform:"capitalize"}}>{(e.attendee_status||"invited").replace("_"," ")}</span>
                  </div>
                );
              })}
            </div>
          </div>}

          <div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"#8fa896",marginBottom:8}}>Move Stage</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {STAGES.map(s=>(
                <button key={s.id} onClick={()=>onStageChange(donor.id,s.id)}
                  style={{background:(donor.stage||"cultivate")===s.id?s.color+"28":"#1a2e1f",border:`1px solid ${(donor.stage||"cultivate")===s.id?s.color:"#2d4a35"}`,borderRadius:8,padding:"6px 12px",color:(donor.stage||"cultivate")===s.id?s.color:"#8fa896",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  {s.label}
                </button>
              ))}
            </div>
            <div style={{marginTop:8,fontSize:11,color:"#8fa896",lineHeight:1.5,borderLeft:`2px solid ${stage.color}`,paddingLeft:8}}>
              {STAGE_ACTION[donor.stage||"cultivate"]}
            </div>
          </div>

          <div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"#8fa896",marginBottom:8}}>Wealth Score</div>
            <div style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:14,padding:"16px"}}>
              {localScore!==null?(
                <>
                  <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                    <div style={{textAlign:"center",background:wsc+"22",border:`2px solid ${wsc}`,borderRadius:12,padding:"10px 14px",minWidth:56,flexShrink:0}}>
                      <div style={{fontSize:26,fontWeight:800,color:wsc,lineHeight:1,fontFamily:"'DM Serif Display',serif"}}>{localScore}</div>
                      <div style={{fontSize:9,color:"#8fa896",fontWeight:600,marginTop:2}}>/ 10</div>
                    </div>
                    <div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:5}}>
                        <span style={{background:(TIER_COLOR[localTier]||"#8fa896")+"33",color:TIER_COLOR[localTier]||"#8fa896",borderRadius:99,padding:"3px 10px",fontSize:11,fontWeight:800,letterSpacing:"0.04em"}}>{localTier}</span>
                      </div>
                      <div style={{fontSize:10,color:"#8fa896",fontWeight:600}}>{localConf} confidence</div>
                    </div>
                  </div>
                  {localRationale&&<p style={{fontSize:12,color:"#8fa896",lineHeight:1.6,margin:"0 0 12px 0",fontStyle:"italic",borderLeft:"2px solid #2d4a35",paddingLeft:10}}>{localRationale}</p>}
                  <button onClick={recalcScore} disabled={scoreLoading} style={{background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"6px",color:"#10b981",fontSize:11,fontWeight:600,cursor:"pointer",width:"100%",textAlign:"center"}}>{scoreLoading?"Calculating…":"↻ Recalculate"}</button>
                </>
              ):(
                <div style={{textAlign:"center",padding:"4px 0"}}>
                  <div style={{fontSize:12,color:"#8fa896",marginBottom:10}}>No score yet</div>
                  <button onClick={recalcScore} disabled={scoreLoading} style={{background:T.green,border:"none",borderRadius:8,padding:"8px 16px",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>{scoreLoading?"Calculating…":"Calculate Score"}</button>
                </div>
              )}
            </div>
          </div>

          <div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"#8fa896",marginBottom:8}}>Suggested Actions</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
              <AIBtn onClick={()=>getAI(donor,"nextmove")} loading={loadingKey===`${donor.id}_nextmove`} label="✦ Next Move" small/>
              <AIBtn onClick={()=>getAI(donor,"outreach")} loading={loadingKey===`${donor.id}_outreach`} label="✦ Outreach" small/>
              <AIBtn onClick={()=>getAI(donor,"email")} loading={loadingKey===`${donor.id}_email`} label="✦ Draft Email" small/>
              <AIBtn onClick={()=>getAI(donor,"callscript")} loading={loadingKey===`${donor.id}_callscript`} label="✦ Call Script" small/>
              <button onClick={()=>setComposeOpen(o=>!o)} style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:8,padding:"5px 11px",color:"#c9a84c",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>✉ Send Email</button>
            </div>
            {["nextmove","outreach","email","callscript"].map(t=>aiMap[`${donor.id}_${t}`]?<AIPanel key={t} text={aiMap[`${donor.id}_${t}`]} onClose={()=>{}}/>:null)}

            {composeOpen&&(
              <div style={{marginTop:12,background:"#1a2e1f",borderRadius:12,padding:"20px",border:"1px solid #2d4a35"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                  <div>
                    <span style={{fontSize:12,fontWeight:700,color:"#f0ede6"}}>Send via Gmail</span>
                    {gmailEmail&&<span style={{fontSize:11,color:"#8fa896",marginLeft:8}}>{gmailEmail}</span>}
                  </div>
                  <button onClick={()=>{setComposeOpen(false);setComposeSent(false);setComposeErr("");}} style={{background:"transparent",border:"none",color:"#8fa896",fontSize:18,cursor:"pointer",lineHeight:1,padding:0}}>×</button>
                </div>
                {gmailConnected===false?(
                  <div style={{fontSize:13,color:"#8fa896",textAlign:"center",padding:"12px 0"}}>
                    <a href="/dashboard" onClick={e=>{e.preventDefault();window.location.href="/dashboard?tab=settings";}} style={{color:"#10b981",textDecoration:"none"}}>Connect Gmail in Settings</a> to send emails from donor profiles.
                  </div>
                ):!donor.email?(
                  <div style={{fontSize:13,color:"#8fa896",textAlign:"center",padding:"12px 0"}}>No email address on file for this donor.</div>
                ):(
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    <input value={composeTo} onChange={e=>setComposeTo(e.target.value)} placeholder="To" style={{background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:7,padding:"8px 10px",color:"#f0ede6",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box",width:"100%"}}/>
                    <input value={composeSubject} onChange={e=>setComposeSubject(e.target.value)} placeholder="Subject…" style={{background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:7,padding:"8px 10px",color:"#f0ede6",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box",width:"100%"}}/>
                    <textarea value={composeBody} onChange={e=>setComposeBody(e.target.value)} placeholder="Write your message…" style={{background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:7,padding:"8px 10px",color:"#f0ede6",fontSize:13,outline:"none",fontFamily:"inherit",resize:"vertical",minHeight:120,width:"100%",boxSizing:"border-box"}}/>
                    <div style={{fontSize:11,color:"#8fa896"}}>Use <code style={{background:"#0f1a12",padding:"1px 5px",borderRadius:4,fontFamily:"monospace"}}>{"{{donor_name}}"}</code> and <code style={{background:"#0f1a12",padding:"1px 5px",borderRadius:4,fontFamily:"monospace"}}>{"{{org_name}}"}</code></div>
                    {composeErr&&<div style={{fontSize:12,color:"#ef4444",background:"#1a0a0a",border:"1px solid #3d1515",borderRadius:7,padding:"8px 10px"}}>{composeErr}</div>}
                    {composeSent&&<div style={{fontSize:12,color:"#10b981",background:"#0a1a0f",border:"1px solid #1a4a2a",borderRadius:7,padding:"8px 10px"}}>✓ Sent and logged to timeline</div>}
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={draftWithAI} disabled={draftLoading} style={{flex:1,background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"9px",color:"#c9a84c",fontSize:12,fontWeight:700,cursor:draftLoading?"not-allowed":"pointer",fontFamily:"inherit"}}>{draftLoading?"Drafting…":"✦ Draft this email"}</button>
                      <button onClick={sendEmail} disabled={composeSending||!composeTo||!composeSubject} style={{flex:1,background:composeSending||!composeTo||!composeSubject?"#2d4a35":"#10b981",border:"none",borderRadius:8,padding:"9px",color:"#fff",fontSize:12,fontWeight:700,cursor:composeSending||!composeTo||!composeSubject?"not-allowed":"pointer",fontFamily:"inherit"}}>{composeSending?"Sending…":"Send →"}</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Re-engage View ─────────────────────────────────────────────────────────
function ReEngageView({donors,org,onLogTouchpoint,onSelectDonor}){
  const lapsed=[...donors].filter(d=>d.stage==="lapsed"||(d.lastGift&&daysDiff(d.lastGift)>365)).sort((a,b)=>b.total-a.total);
  const totalValue=lapsed.reduce((s,d)=>s+d.total,0);
  const avgDays=lapsed.length
    ?Math.round(lapsed.reduce((s,d)=>s+daysDiff(d.lastGift||d.lastTouchpoint||new Date().toISOString()),0)/lapsed.length)
    :0;
  const[aiText,setAiText]=useState("");
  const[aiLoading,setAiLoading]=useState(false);

  const getStrategy=async()=>{
    setAiLoading(true);setAiText("");
    await askClaude(
      `You are a nonprofit major gifts officer. Be specific and tactical. Max 250 words.`,
      `Re-engagement strategy for ${org?.name||"this organization"}.\n\nLapsed donors: ${lapsed.length} total, ${fmtFull(totalValue)} combined lifetime value, avg ${avgDays} days lapsed.\n\nTop lapsed donors:\n${lapsed.slice(0,8).map(d=>`- ${d.name}: ${fmtFull(d.total)} lifetime, last gift ${d.lastGift||"unknown"} (${fmtFull(d.lastAmount)}), ${daysDiff(d.lastGift||d.lastTouchpoint||new Date().toISOString())}d lapsed`).join("\n")}\n\nProvide:\n1. Top 3 highest-priority donors to call this week and why\n2. Best re-engagement message angle for this portfolio\n3. One creative re-engagement tactic for the full group`,
      chunk=>setAiText(chunk)
    );
    setAiLoading(false);
  };

  if(!lapsed.length)return<EmptyState icon="♦" title="No lapsed donors" message="All your donors are active — great work!"/>;

  const fmtGiftDate=s=>{
    if(!s)return null;
    const dt=new Date(s);
    return isNaN(dt)?null:dt.toLocaleDateString("en-US",{month:"short",year:"numeric"});
  };

  const cols=["Donor","Lifetime Giving","Last Gift","Days Lapsed","Score",""];
  const colWidths="2fr 130px 130px 120px 80px 130px";

  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        {[
          ["Lapsed donors",lapsed.length,T.ink],
          ["Total lapsed value",fmtFull(totalValue),T.ink],
          ["Avg days lapsed",`${avgDays}d`,"#ef4444"],
        ].map(([label,val,color])=>(
          <div key={label} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"10px 18px",display:"flex",flexDirection:"column",gap:2}}>
            <div style={{fontSize:10,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:".06em"}}>{label}</div>
            <div style={{fontSize:20,fontWeight:800,color,fontFamily:"'DM Serif Display',serif"}}>{val}</div>
          </div>
        ))}
        <div style={{marginLeft:"auto"}}>
          <AIBtn onClick={getStrategy} loading={aiLoading} label="✦ Re-engage Plan"/>
        </div>
      </div>
      {(aiLoading||aiText)&&<AIPanel text={aiText} onClose={()=>setAiText("")}/>}
      <div style={{background:T.white,borderRadius:14,overflow:"hidden",border:"1px solid "+T.bg3}}>
        <div className="reEngage-header" style={{display:"grid",gridTemplateColumns:colWidths,gap:0,padding:"10px 18px",background:"#1a6b4a",borderBottom:"1px solid "+T.bg3}}>
          <div className="re-col-name" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em"}}>Donor</div>
          <div className="re-col-lifetime" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}>Lifetime Giving</div>
          <div className="re-col-lastgift" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}>Last Gift</div>
          <div className="re-col-days" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}>Days Lapsed</div>
          <div className="re-col-score" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}>Score</div>
          <div className="re-col-actions" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}></div>
        </div>
        {lapsed.map((d,idx)=>{
          const days=daysDiff(d.lastGift||d.lastTouchpoint||new Date().toISOString());
          const sc=donorScore(d);
          const scColor=sc>70?"#1a6b4a":sc>45?"#f59e0b":"#ef4444";
          const rowBg=days>730?"#ef444409":days>365?"#f59e0b09":"#eab30809";
          const rowBorderColor=days>730?"#ef444425":days>365?"#f59e0b25":"#eab30825";
          const daysColor=days>730?"#ef4444":days>365?"#f59e0b":"#ca8a04";
          const urgencyLabel=days>730?"Critical":days>365?"At Risk":"Watch";
          const giftDate=fmtGiftDate(d.lastGift);
          return(
            <div key={d.id} className="reEngage-row" style={{display:"grid",gridTemplateColumns:colWidths,gap:0,padding:"13px 18px",background:rowBg,borderBottom:idx<lapsed.length-1?`1px solid ${rowBorderColor}`:"none",alignItems:"center"}}>
              <div className="re-col-name">
                <div style={{fontSize:13,fontWeight:700,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
                {d.email&&<div style={{fontSize:11,color:T.ink3,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.email}</div>}
              </div>
              <div className="re-col-lifetime" style={{textAlign:"right",fontSize:13,fontWeight:700,color:T.ink}}>{fmtFull(d.total)}</div>
              <div className="re-col-lastgift" style={{textAlign:"right"}}>
                {giftDate
                  ?<><div style={{fontSize:13,color:T.ink,fontWeight:600}}>{giftDate}</div><div style={{fontSize:11,color:T.ink3,marginTop:1}}>{d.lastAmount>0?fmtFull(d.lastAmount):""}</div></>
                  :<div style={{fontSize:13,color:T.ink3}}>—</div>
                }
              </div>
              <div className="re-col-days" style={{textAlign:"right"}}>
                <div style={{fontSize:13,fontWeight:700,color:daysColor}}>{days}d</div>
                <div style={{fontSize:10,color:daysColor,fontWeight:700,marginTop:2,textTransform:"uppercase",letterSpacing:".04em"}}>{urgencyLabel}</div>
              </div>
              <div className="re-col-score" style={{textAlign:"right"}}>
                <span style={{fontSize:13,fontWeight:800,color:scColor,background:scColor+"18",borderRadius:7,padding:"3px 9px",display:"inline-block"}}>{sc}</span>
              </div>
              <div className="re-col-actions" style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
                <button onClick={e=>{e.stopPropagation();onLogTouchpoint(d);}} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"4px 10px",color:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer"}}>+ Log</button>
                <button onClick={()=>onSelectDonor(d)} style={{background:"#1a6b4a14",border:"1px solid #1a6b4a40",borderRadius:7,padding:"4px 10px",color:"#1a6b4a",fontSize:11,fontWeight:600,cursor:"pointer"}}>View →</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Assign Modal ───────────────────────────────────────────────────────────
function AssignModal({donor,orgTeam,onSave,onClose}){
  const[selectedId,setSelectedId]=useState(donor.assignedTo||"");
  const[loading,setLoading]=useState(false);
  const inp={width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box",cursor:"pointer"};
  const save=async()=>{
    if(!selectedId)return;
    const member=orgTeam.find(u=>u.id===selectedId);
    if(!member)return;
    setLoading(true);
    try{
      await apiFetch(`/donors/${donor.id}/assign`,{method:"PATCH",body:JSON.stringify({assignedTo:member.id,assignedToName:member.name})});
      onSave(donor.id,member.id,member.name);
    }catch(e){console.error(e);}
    setLoading(false);
    onClose();
  };
  return(
    <div style={{position:"fixed",inset:0,background:"#0f1a12cc",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:18,width:"100%",maxWidth:360,padding:24,boxShadow:"0 4px 32px rgba(15,15,15,0.12)"}}>
        <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:4}}>Assign Relationship Owner</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:16}}>{donor.name}</div>
        <select value={selectedId} onChange={e=>setSelectedId(e.target.value)} style={{...inp,marginBottom:16}}>
          <option value="">— unassigned —</option>
          {orgTeam.map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
        </select>
        <div style={{display:"flex",gap:8}}>
          <button onClick={save} disabled={loading||!selectedId} style={{flex:1,background:selectedId?"#1a6b4a":T.bg2,border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:13,fontWeight:700,cursor:selectedId?"pointer":"not-allowed"}}>
            {loading?"Saving…":"Assign"}
          </button>
          <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Directory View ─────────────────────────────────────────────────────────
// (The old client-side downloadDirectoryCsv/directoryCsvCell were removed in
// BUILD-06 Phase A: with a server-paginated list, "the rows on screen" is
// one page, so Export CSV now hits GET /donors/export/csv with the same
// search/stage/owner query params — every matching row, same injection
// guard, applied server-side by toCsv/reportCsvCell.)
// Server-paginated as of BUILD-06 Phase A: `donors` is the current 50-row
// page (already narrowed by any client-side advanced/custom-field filters —
// see the Donors component), `serverTotal` is the query's full match count,
// and stage/owner/search filtering happens in the GET /donors query itself.
const DESIGNATION_OPTS=[["planned_confirmed","Planned gift confirmed"],["planned_prospect","Planned-giving prospect"],["estate","Estate giving"]];
const cap=s=>s?String(s).charAt(0).toUpperCase()+String(s).slice(1):"—";
function DirectoryView({donors,loading,serverTotal,page,pageSize,onPage,clientFilterCount,exportParams,totalDonors,orgTeam,isAdmin,onSelectDonor,onAssign,stageFilter,setStageFilter,assigneeFilter,setAssigneeFilter,designationFilter,setDesignationFilter,officers=[],officerColorMap={},portfolioMeta={tier:"core",single_user:true},onOfficersChanged,onLoadSampleData,sampleLoading,hasSampleData,onAddDonor,onBulkDone}){
  const [selIds,setSelIds]=useState(new Set());
  const [stageDrop,setStageDrop]=useState(false);
  const [assignDrop,setAssignDrop]=useState(false);
  const [delModal,setDelModal]=useState(false);
  const [busy,setBusy]=useState(false);
  const [toast,setToast]=useState("");
  const [exporting,setExporting]=useState(false);
  // Persisted across the session, not just this mount — a compact preference
  // shouldn't reset every time you navigate away from Directory and back.
  const [density,setDensity]=useState(()=>localStorage.getItem("steward_dir_density")||"comfortable");
  useEffect(()=>{localStorage.setItem("steward_dir_density",density);},[density]);
  const compact=density==="compact";

  // Stage/owner already applied server-side; the rows arrive filtered.
  const filtered=donors;
  const totalPages=Math.max(1,Math.ceil(serverTotal/pageSize));

  // Exports EVERY row matching the server query (search/stage/owner), not
  // just this page — client-only advanced/custom-field filters are NOT
  // reflected (they only narrow the loaded page; see note pill below).
  async function exportCsv(){
    setExporting(true);
    try{
      const qs=new URLSearchParams();
      Object.entries(exportParams||{}).forEach(([k,v])=>{if(v)qs.set(k,v);});
      const res=await fetch(`${API}/donors/export/csv?${qs.toString()}`,{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!res.ok)throw new Error("Export failed");
      const blob=await res.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;a.download=`donors-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
    }catch(e){flash("Export failed: "+(e.message||"unknown error"));}
    setExporting(false);
  }

  const selFiltered=filtered.filter(d=>selIds.has(d.id));
  const allChecked=filtered.length>0&&filtered.every(d=>selIds.has(d.id));
  const someChecked=!allChecked&&filtered.some(d=>selIds.has(d.id));

  function toggleAll(){
    if(allChecked){const n=new Set(selIds);filtered.forEach(d=>n.delete(d.id));setSelIds(n);}
    else{const n=new Set(selIds);filtered.forEach(d=>n.add(d.id));setSelIds(n);}
  }
  function toggleOne(id,e){
    e.stopPropagation();
    const n=new Set(selIds);n.has(id)?n.delete(id):n.add(id);setSelIds(n);
  }
  function flash(msg){setToast(msg);setTimeout(()=>setToast(""),3500);}

  async function bulkStage(stage){
    const ids=selFiltered.map(d=>d.id);
    setBusy(true);
    try{
      const r=await apiFetch("/donors/bulk-stage",{method:"PATCH",body:JSON.stringify({ids,stage})});
      flash(`${r.updated} donor${r.updated!==1?"s":""} moved to ${STAGES.find(s=>s.id===stage)?.label||stage}`);
      setSelIds(new Set());if(onBulkDone)onBulkDone();
    }catch(e){flash("Error: "+e.message);}
    setBusy(false);setStageDrop(false);
  }

  async function bulkAssign(userId,name){
    const ids=selFiltered.map(d=>d.id);
    setBusy(true);
    try{
      const r=await apiFetch("/donors/bulk-assign",{method:"PATCH",body:JSON.stringify({ids,assignedTo:userId})});
      flash(`${r.updated} donor${r.updated!==1?"s":""} assigned to ${name}`);
      setSelIds(new Set());if(onBulkDone)onBulkDone();
    }catch(e){flash("Error: "+e.message);}
    setBusy(false);setAssignDrop(false);
  }

  async function bulkDelete(){
    const ids=selFiltered.map(d=>d.id);
    setBusy(true);
    try{
      const r=await apiFetch("/donors/bulk-delete",{method:"POST",body:JSON.stringify({ids})});
      flash(`${r.deleted} donor${r.deleted!==1?"s":""} moved to trash`);
      setSelIds(new Set());setDelModal(false);if(onBulkDone)onBulkDone();
    }catch(e){flash("Error: "+e.message);}
    setBusy(false);
  }

  async function saveOfficerColor(userId,color){
    try{ await apiFetch(`/portfolio/officers/${userId}/color`,{method:"PUT",body:JSON.stringify({color})}); onOfficersChanged&&onOfficersChanged(); }
    catch(e){ flash("Could not save color: "+(e.message||"error")); }
  }
  const teamPortfolios=portfolioMeta.tier==="team";
  const showPortfolios=officers.length>1; // single-user shop: no color clutter at all

  const filterSel={background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",cursor:"pointer"};
  const colGrid="36px minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) 120px 110px 60px"+(isAdmin?" 80px":"");
  const dropItem={display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"9px 14px",fontSize:13,color:"#0f1a12",cursor:"pointer",borderBottom:"1px solid #f3f0eb",fontFamily:"'DM Sans',system-ui,sans-serif"};

  if(totalDonors===0&&!hasSampleData){
    return(
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"60px 20px",gap:0,textAlign:"center"}}>
        <div style={{marginBottom:18,color:"#10b981",opacity:0.7}}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:22,fontWeight:400,color:"#0f1a12",letterSpacing:"-0.01em",marginBottom:10}}>No donors yet.</div>
        <div style={{fontSize:14,color:"#6b7280",maxWidth:300,lineHeight:1.65,marginBottom:24}}>Every relationship in Steward starts as one row — bring in a spreadsheet from Import above, or add a single name to begin.</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",justifyContent:"center"}}>
          {onAddDonor&&<button onClick={onAddDonor} style={{background:"#1a6b4a",color:"#fff",border:"none",borderRadius:12,padding:"12px 24px",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',system-ui,sans-serif"}}>Add a donor →</button>}
          {onLoadSampleData&&<button onClick={onLoadSampleData} disabled={sampleLoading} style={{background:"transparent",color:"#1a6b4a",border:"1.5px solid #1a6b4a",borderRadius:12,padding:"12px 24px",fontSize:14,fontWeight:600,cursor:sampleLoading?"not-allowed":"pointer",opacity:sampleLoading?0.7:1,fontFamily:"'DM Sans',system-ui,sans-serif"}}>{sampleLoading?"Loading…":"Explore with sample data"}</button>}
        </div>
      </div>
    );
  }

  return(
    <div style={{display:"flex",flexDirection:"column",gap:10}}>

      {/* Toast */}
      {toast&&<div style={{background:"#0f1a12",color:"#f0ede6",borderRadius:10,padding:"10px 16px",fontSize:13,fontWeight:600,textAlign:"center"}}>{toast}</div>}

      {/* Filters */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <select value={stageFilter} onChange={e=>setStageFilter(e.target.value)} style={filterSel}>
          <option value="">All stages</option>
          {STAGES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={assigneeFilter} onChange={e=>setAssigneeFilter(e.target.value)} style={filterSel}>
          <option value="">All owners</option>
          {orgTeam.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={designationFilter||""} onChange={e=>setDesignationFilter&&setDesignationFilter(e.target.value)} style={filterSel} title="Filter by planned-giving / estate designation">
          <option value="">All designations</option>
          {DESIGNATION_OPTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select>
        <span style={{fontSize:12,color:T.ink3}}>{serverTotal} donor{serverTotal!==1?"s":""}</span>
        {clientFilterCount>0&&<span title="Advanced and custom-field filters apply within the loaded page only — server-side filtering for these is not available yet."
          style={{fontSize:11,color:T.terracotta,fontWeight:700,background:"#b8593f14",border:"1px solid #b8593f40",borderRadius:99,padding:"3px 10px"}}>
          filtering current page
        </span>}
        <div style={{flex:1}}/>
        <button onClick={exportCsv} disabled={exporting||serverTotal===0} title="Download every donor matching the search/stage/owner filters as a CSV"
          style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 12px",color:serverTotal===0?T.ink3:T.ink,fontSize:12,fontWeight:600,cursor:exporting||serverTotal===0?"not-allowed":"pointer"}}>
          {exporting?"Exporting…":"Export CSV"}
        </button>
        <div style={{display:"flex",background:T.bg,borderRadius:99,padding:2,border:"1px solid "+T.bg3}}>
          {[["comfortable","Comfortable"],["compact","Compact"]].map(([v,l])=>(
            <button key={v} onClick={()=>setDensity(v)} title={l+" row spacing"}
              style={{background:density===v?T.white:"transparent",border:"none",borderRadius:99,padding:"5px 12px",fontSize:11,fontWeight:700,color:density===v?T.ink:T.ink3,cursor:"pointer",boxShadow:density===v?T.shadow:"none",transition:"background 0.12s"}}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Officer portfolios (BUILD-14) — color legend + rollups. Team plan
          gets color assignment; Core sees a lock hint; a 1-person shop sees
          nothing (graceful, no empty "assign" clutter). */}
      {showPortfolios&&(
        <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"11px 14px",display:"flex",flexWrap:"wrap",alignItems:"center",gap:14}}>
          <span style={{fontSize:10,fontWeight:800,color:"#1a6b4a",textTransform:"uppercase",letterSpacing:".06em"}}>Officer portfolios</span>
          {officers.map(o=>{
            const col=o.portfolio_color;
            return(
              <div key={o.id} style={{display:"flex",alignItems:"center",gap:7}}>
                <label style={{position:"relative",display:"inline-flex",cursor:teamPortfolios&&isAdmin?"pointer":"default"}} title={teamPortfolios&&isAdmin?"Set portfolio color":undefined}>
                  <span style={{width:14,height:14,borderRadius:"50%",background:col||"#c9beac",border:"1px solid "+(col?col+"88":"#b7ad9b"),display:"inline-block"}}/>
                  {teamPortfolios&&isAdmin&&<input type="color" value={col||"#1a6b4a"} onChange={e=>saveOfficerColor(o.id,e.target.value)} style={{position:"absolute",inset:0,opacity:0,width:14,height:14,cursor:"pointer"}}/>}
                </label>
                <span style={{fontSize:12,color:T.ink,fontWeight:600}}>{o.name}</span>
                <span style={{fontSize:11,color:T.ink3}}>{o.portfolio_count} · {fmtFull(o.portfolio_giving)}</span>
              </div>
            );
          })}
          {!teamPortfolios&&<span style={{fontSize:11,color:T.ink3,fontStyle:"italic"}}>🔒 Color-code portfolios on the Team plan</span>}
        </div>
      )}

      {/* Bulk action bar — shown when ≥1 rows selected */}
      {selIds.size>0&&(
        <div style={{background:"#0f1a12",borderRadius:12,padding:"10px 14px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span style={{fontSize:13,fontWeight:700,color:"#f0ede6",whiteSpace:"nowrap"}}>{selFiltered.length} selected</span>
          <button onClick={()=>setSelIds(new Set())} style={{background:"none",border:"none",color:"#a1b5a8",fontSize:12,cursor:"pointer",padding:0,textDecoration:"underline",whiteSpace:"nowrap"}}>Clear</button>
          <div style={{flex:1,minWidth:8}}/>

          {/* Move to stage */}
          <div style={{position:"relative"}}>
            <button onClick={()=>{setStageDrop(v=>!v);setAssignDrop(false);}} disabled={busy}
              style={{background:"#1a6b4a",border:"none",borderRadius:8,padding:"7px 12px",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",opacity:busy?0.6:1}}>
              Move to stage ▾
            </button>
            {stageDrop&&(
              <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,background:"#f0ede6",border:"1px solid #d4cfc6",borderRadius:12,boxShadow:"0 8px 28px rgba(0,0,0,0.15)",zIndex:500,minWidth:148,overflow:"hidden"}}>
                {STAGES.map(s=>(
                  <button key={s.id} onClick={()=>bulkStage(s.id)} style={dropItem}
                    onMouseEnter={e=>e.target.style.background="#e8e4db"} onMouseLeave={e=>e.target.style.background="none"}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Assign to (admin only) */}
          {isAdmin&&orgTeam.length>0&&(
            <div style={{position:"relative"}}>
              <button onClick={()=>{setAssignDrop(v=>!v);setStageDrop(false);}} disabled={busy}
                style={{background:"#1a6b4a",border:"none",borderRadius:8,padding:"7px 12px",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",opacity:busy?0.6:1}}>
                Assign to ▾
              </button>
              {assignDrop&&(
                <div style={{position:"absolute",top:"calc(100% + 6px)",right:0,background:"#f0ede6",border:"1px solid #d4cfc6",borderRadius:12,boxShadow:"0 8px 28px rgba(0,0,0,0.15)",zIndex:500,minWidth:160,overflow:"hidden"}}>
                  {orgTeam.map(u=>(
                    <button key={u.id} onClick={()=>bulkAssign(u.id,u.name)} style={dropItem}
                      onMouseEnter={e=>e.target.style.background="#e8e4db"} onMouseLeave={e=>e.target.style.background="none"}>
                      {u.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Delete (admin only) */}
          {isAdmin&&(
            <button onClick={()=>setDelModal(true)} disabled={busy}
              style={{background:"#ef4444",border:"none",borderRadius:8,padding:"7px 12px",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",opacity:busy?0.6:1}}>
              Delete
            </button>
          )}
        </div>
      )}

      {/* Donor table */}
      {loading
        ?<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:"48px 0",color:T.ink3,fontSize:13}}>
          <span style={{display:"inline-block",width:14,height:14,border:"2px solid "+T.bg3,borderTopColor:T.green,borderRadius:"50%",animation:"sp 0.7s linear infinite"}}/>Loading donors…
        </div>
        :filtered.length===0
        ?<EmptyState icon="♦" title="No donors found" message="Try adjusting your filters or search term."/>
        :<div style={{background:T.white,borderRadius:14,overflow:"hidden",border:"1px solid "+T.bg3}}>
          {/* Header — light treatment (not a solid green fill) so Directory
              reads as its own surface instead of blurring into the Kanban
              stage headers and Home hero banner, which are both solid dark
              green. Green identity stays via text color + underline accent. */}
          <div className="dir-header-row" style={{display:"grid",gridTemplateColumns:colGrid,gap:0,padding:"10px 18px",background:"#f6f4ee",borderBottom:"2px solid #1a6b4a",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
              <input type="checkbox" checked={allChecked} ref={el=>{if(el)el.indeterminate=someChecked;}} onChange={toggleAll}
                style={{width:15,height:15,cursor:"pointer",accentColor:"#1a6b4a"}}/>
            </div>
            {["Donor","Stage","Owner","Lifetime","Last Gift","Score",...(isAdmin?[""]:[])]
              .map((h,i)=>(
                <div key={i} className={h==="Stage"?"dir-col-stage":h==="Owner"?"dir-col-owner":h===""?"dir-col-assign":""}
                  style={{fontSize:10,fontWeight:800,color:"#1a6b4a",textTransform:"uppercase",letterSpacing:".06em",textAlign:i>=3?"right":"left"}}>{h}</div>
              ))}
          </div>
          {/* Rows */}
          {filtered.map((d,idx)=>{
            const stage=STAGES.find(s=>s.id===(d.stage||"cultivate"))||STAGES[2];
            const sc=donorScore(d);const scColor=sc>70?"#1a6b4a":sc>45?"#f59e0b":"#ef4444";
            const isLast=idx===filtered.length-1;
            const checked=selIds.has(d.id);
            const rowBg=checked?"#f0faf4":idx%2===0?T.white:"#faf9f6";
            return(
              <div key={d.id} className="dir-donor-row" onClick={()=>onSelectDonor(d)}
                style={{display:"grid",gridTemplateColumns:colGrid,gap:0,padding:compact?"4px 18px":"11px 18px",background:rowBg,borderBottom:isLast?"none":"1px solid "+T.bg3,cursor:"pointer",alignItems:"center",transition:"background 0.1s, padding 0.12s"}}
                onMouseEnter={e=>e.currentTarget.style.background=checked?"#e6f5ec":T.bg}
                onMouseLeave={e=>e.currentTarget.style.background=rowBg}>
                <div onClick={e=>toggleOne(d.id,e)} style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"4px"}}>
                  <input type="checkbox" checked={checked} onChange={e=>{e.stopPropagation();toggleOne(d.id,e);}}
                    style={{width:15,height:15,cursor:"pointer",accentColor:"#10b981"}} onClick={e=>e.stopPropagation()}/>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                  <div style={{width:compact?22:32,height:compact?22:32,borderRadius:"50%",background:stage.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:compact?10:12,fontWeight:800,color:stage.color,flexShrink:0,transition:"width 0.12s,height 0.12s"}}>{d.name[0]}</div>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:compact?12:13,fontWeight:700,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
                    {!compact&&d.email&&<div style={{fontSize:11,color:T.ink3,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.email}</div>}
                    <span className="dir-stage-mobile" style={{background:stage.color+"22",color:stage.color,borderRadius:99,padding:"2px 7px",fontSize:10,fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase",marginTop:3}}>{stage.label}</span>
                  </div>
                </div>
                <div className="dir-col-stage">
                  <span style={{background:stage.color+"22",color:stage.color,borderRadius:99,padding:compact?"2px 8px":"4px 10px",fontSize:10,fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase"}}>{stage.label}</span>
                </div>
                <div className="dir-col-owner" style={{display:"flex",alignItems:"center",gap:5,minWidth:0}}>
                  {(()=>{const oc=officerColorMap[d.assignedTo];return(
                    <div title={d.assignedToName||"Unassigned"} style={{width:22,height:22,borderRadius:"50%",background:oc?oc:"#1a6b4a22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:oc?"#fff":"#1a6b4a",flexShrink:0,boxShadow:oc?"0 0 0 2px "+oc+"33":"none"}}>{(d.assignedToName||"?")[0]}</div>
                  );})()}
                  <span style={{fontSize:12,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.assignedToName||"—"}</span>
                </div>
                <div style={{textAlign:"right",fontSize:13,fontWeight:700,color:T.ink}}>{fmtFull(d.total)}</div>
                <div style={{textAlign:"right"}}>
                  {d.lastGift
                    ?<><div style={{fontSize:12,color:T.ink}}>{new Date(d.lastGift).toLocaleDateString("en-US",{month:"short",year:"numeric"})}</div>{!compact&&<div style={{fontSize:11,color:T.ink3}}>{d.lastAmount>0?fmtFull(d.lastAmount):""}</div>}</>
                    :<div style={{fontSize:12,color:T.ink3}}>—</div>}
                </div>
                <div style={{textAlign:"right"}}>
                  <span style={{background:scColor+"18",color:scColor,borderRadius:7,padding:"3px 8px",fontSize:12,fontWeight:800}}>{sc}</span>
                </div>
                {isAdmin&&<div className="dir-col-assign dir-assign-cell" style={{textAlign:"right"}}>
                  <button onClick={e=>{e.stopPropagation();onAssign(d);}} className="dir-assign-btn" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"4px 10px",color:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer"}}>Assign</button>
                </div>}
              </div>
            );
          })}
        </div>
      }

      {/* Pagination — 50/page server-side */}
      {!loading&&totalPages>1&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:14,padding:"6px 0"}}>
          <button onClick={()=>onPage(page-1)} disabled={page===0}
            style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:page===0?T.ink3:T.ink,fontSize:12,fontWeight:700,cursor:page===0?"not-allowed":"pointer",opacity:page===0?0.5:1}}>
            ← Prev
          </button>
          <span style={{fontSize:12,color:T.ink3,fontWeight:600}}>Page {page+1} of {totalPages}</span>
          <button onClick={()=>onPage(page+1)} disabled={page>=totalPages-1}
            style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:page>=totalPages-1?T.ink3:T.ink,fontSize:12,fontWeight:700,cursor:page>=totalPages-1?"not-allowed":"pointer",opacity:page>=totalPages-1?0.5:1}}>
            Next →
          </button>
        </div>
      )}

      {/* Delete confirmation modal — never auto-confirm */}
      {delModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,26,18,0.72)",zIndex:900,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}
          onClick={e=>{if(e.target===e.currentTarget)setDelModal(false);}}>
          <div style={{background:"#f0ede6",borderRadius:20,padding:"36px 32px",maxWidth:420,width:"100%",boxShadow:"0 24px 60px rgba(0,0,0,0.22)"}}>
            <div style={{fontSize:24,fontWeight:400,color:"#0f1a12",fontFamily:"'DM Serif Display',Georgia,serif",letterSpacing:"-0.02em",marginBottom:12,lineHeight:1.2}}>
              Delete {selFiltered.length} donor{selFiltered.length!==1?"s":""}?
            </div>
            <div style={{fontSize:14,color:"#4a5e4f",lineHeight:1.65,marginBottom:28}}>
              This removes {selFiltered.length} donor{selFiltered.length!==1?"s":""} and their gift history from your active lists. You can restore them later from trash.
            </div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button onClick={()=>setDelModal(false)}
                style={{flex:1,background:"transparent",border:"1px solid #c9c3b8",borderRadius:10,padding:"11px 16px",color:"#4a5e4f",fontSize:13,fontWeight:600,cursor:"pointer",minWidth:100}}>
                Cancel
              </button>
              <button onClick={bulkDelete} disabled={busy}
                style={{flex:1,background:"#ef4444",border:"none",borderRadius:10,padding:"11px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:busy?"not-allowed":"pointer",opacity:busy?0.7:1,minWidth:100}}>
                {busy?"Deleting…":`Delete ${selFiltered.length} donor${selFiltered.length!==1?"s":""}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Team View ──────────────────────────────────────────────────────────────
function TeamView({donors,orgTeam,onSelectDonor}){
  if(!orgTeam.length)return<EmptyState icon="◆" title="No team members yet" message="Invite team members from Settings to assign and track donor ownership."/>;
  return(
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12}}>
      {orgTeam.map(member=>{
        const md=donors.filter(d=>d.assignedTo===member.id).sort((a,b)=>b.total-a.total);
        const tv=md.reduce((s,d)=>s+d.total,0);
        return(
          <div key={member.id} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,padding:16}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,paddingBottom:10,borderBottom:"1px solid "+T.bg3}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:"#1a6b4a22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:"#1a6b4a",flexShrink:0}}>{member.name[0]}</div>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:T.ink}}>{member.name}</div>
                <div style={{fontSize:11,color:T.ink3,marginTop:1}}>{md.length} donor{md.length!==1?"s":""} · {fmtFull(tv)}</div>
              </div>
            </div>
            {md.length===0
              ?<div style={{fontSize:12,color:T.ink3,fontStyle:"italic",padding:"4px 0 8px"}}>No assigned donors yet</div>
              :md.slice(0,10).map((d,i)=>{
                const stage=STAGES.find(s=>s.id===(d.stage||"cultivate"))||STAGES[2];
                return(
                  <div key={d.id} onClick={()=>onSelectDonor(d)} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 0",borderBottom:i<Math.min(md.length,10)-1?"1px solid "+T.bg3:"none",cursor:"pointer"}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:stage.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:stage.color,flexShrink:0}}>{d.name[0]}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
                      <div style={{fontSize:11,color:T.ink3,marginTop:1}}>{stage.label} · {fmtFull(d.total)}</div>
                    </div>
                  </div>
                );
              })
            }
            {md.length>10&&<div style={{fontSize:11,color:T.ink3,textAlign:"center",paddingTop:10,fontStyle:"italic"}}>+{md.length-10} more donors</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── Donor Segmentation ─────────────────────────────────────────────────────
const TIER_META=[
  {id:"micro",    label:"Micro",     color:"#6b7280"},
  {id:"small",    label:"Small",     color:"#3b82f6"},
  {id:"mid",      label:"Mid",       color:"#8b5cf6"},
  {id:"major",    label:"Major",     color:"#f59e0b"},
  {id:"principal",label:"Principal", color:"#1a6b4a"},
];
const PATTERN_META=[
  {id:"one-time", label:"One-time"},
  {id:"recurring",label:"Recurring (2+ gifts)"},
  {id:"major",    label:"Major gift (>$10k)"},
  {id:"lapsed",   label:"Lapsed (>365d)"},
];

function FilterBar({filters,onChange,customFields,cfFilters,onCfChange}){
  const set=(key,val)=>onChange({...filters,[key]:val});
  const tog=(key,val)=>{const arr=filters[key];set(key,arr.includes(val)?arr.filter(v=>v!==val):[...arr,val]);};
  const inp={background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",boxSizing:"border-box"};
  const row={display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"};
  const lbl={fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:".06em",whiteSpace:"nowrap",minWidth:90};
  function setCf(fieldId,val){onCfChange({...cfFilters,[fieldId]:val});}
  function togCfOption(fieldId,opt){const cur=cfFilters[fieldId]||[];onCfChange({...cfFilters,[fieldId]:cur.includes(opt)?cur.filter(v=>v!==opt):[...cur,opt]});}
  return(
    <div className="filter-bar" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"16px 18px",display:"flex",flexDirection:"column",gap:12}}>
      <div className="filter-bar-row" style={row}>
        <span style={lbl}>Capacity Tier</span>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {TIER_META.map(t=>{const a=filters.tiers.includes(t.id);return(
            <button key={t.id} onClick={()=>tog("tiers",t.id)} style={{background:a?t.color+"22":T.bg,border:`1px solid ${a?t.color:T.bg3}`,borderRadius:7,padding:"4px 12px",color:a?t.color:T.ink3,fontSize:12,fontWeight:a?700:400,cursor:"pointer"}}>{t.label}</button>
          );})}
        </div>
      </div>
      <div className="filter-bar-row" style={row}>
        <span style={lbl}>Stage</span>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {STAGES.map(s=>{const a=filters.stages.includes(s.id);return(
            <button key={s.id} onClick={()=>tog("stages",s.id)} style={{background:a?s.color+"22":T.bg,border:`1px solid ${a?s.color:T.bg3}`,borderRadius:7,padding:"4px 12px",color:a?s.color:T.ink3,fontSize:12,fontWeight:a?700:400,cursor:"pointer"}}>{s.label}</button>
          );})}
        </div>
      </div>
      <div className="filter-bar-row" style={row}>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span style={lbl}>Giving Pattern</span>
          <select value={filters.pattern} onChange={e=>set("pattern",e.target.value)} style={{...inp,cursor:"pointer",minWidth:190}}>
            <option value="">Any</option>
            {PATTERN_META.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={lbl}>Geography</span>
          <input value={filters.geo} onChange={e=>set("geo",e.target.value)} placeholder="Search notes & tags…" style={{...inp,minWidth:160}}/>
        </div>
      </div>
      <div className="filter-bar-row" style={row}>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span style={lbl}>Last Gift</span>
          <input type="date" value={filters.giftFrom} onChange={e=>set("giftFrom",e.target.value)} style={inp}/>
          <span style={{fontSize:11,color:T.ink3}}>→</span>
          <input type="date" value={filters.giftTo} onChange={e=>set("giftTo",e.target.value)} style={inp}/>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span style={lbl}>Lifetime Giving</span>
          <input type="number" value={filters.totalMin} onChange={e=>set("totalMin",e.target.value)} placeholder="$min" style={{...inp,width:80}}/>
          <span style={{fontSize:11,color:T.ink3}}>→</span>
          <input type="number" value={filters.totalMax} onChange={e=>set("totalMax",e.target.value)} placeholder="any" style={{...inp,width:80}}/>
        </div>
      </div>
      {customFields&&customFields.length>0&&(
        <div style={{borderTop:"1px solid "+T.bg3,paddingTop:12,display:"flex",flexDirection:"column",gap:10}}>
          <span style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:".06em"}}>Custom Fields</span>
          {customFields.map(f=>{
            if(f.field_type==="dropdown"){
              const sel=cfFilters[f.id]||[];
              return(
                <div key={f.id} className="filter-bar-row" style={row}>
                  <span style={lbl}>{f.label}</span>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {(f.options||[]).map(opt=>{const a=sel.includes(opt);return(
                      <button key={opt} onClick={()=>togCfOption(f.id,opt)} style={{background:a?T.greenDk+"22":T.bg,border:`1px solid ${a?T.greenDk:T.bg3}`,borderRadius:7,padding:"4px 12px",color:a?T.greenDk:T.ink3,fontSize:12,fontWeight:a?700:400,cursor:"pointer"}}>{opt}</button>
                    );})}
                  </div>
                </div>
              );
            }
            if(f.field_type==="checkbox"){
              const val=cfFilters[f.id]||"";
              return(
                <div key={f.id} className="filter-bar-row" style={row}>
                  <span style={lbl}>{f.label}</span>
                  <div style={{display:"flex",gap:5}}>
                    {["","Yes","No"].map((opt,i)=>{const a=val===opt;return(
                      <button key={i} onClick={()=>setCf(f.id,opt)} style={{background:a?T.greenDk+"22":T.bg,border:`1px solid ${a?T.greenDk:T.bg3}`,borderRadius:7,padding:"4px 12px",color:a?T.greenDk:T.ink3,fontSize:12,fontWeight:a?700:400,cursor:"pointer"}}>{opt||"Any"}</button>
                    );})}
                  </div>
                </div>
              );
            }
            if(f.field_type==="date"){
              const val=cfFilters[f.id]||{from:"",to:""};
              return(
                <div key={f.id} className="filter-bar-row" style={row}>
                  <span style={lbl}>{f.label}</span>
                  <input type="date" value={val.from||""} onChange={e=>setCf(f.id,{...val,from:e.target.value})} style={inp}/>
                  <span style={{fontSize:11,color:T.ink3}}>→</span>
                  <input type="date" value={val.to||""} onChange={e=>setCf(f.id,{...val,to:e.target.value})} style={inp}/>
                </div>
              );
            }
            const val=cfFilters[f.id]||"";
            return(
              <div key={f.id} className="filter-bar-row" style={row}>
                <span style={lbl}>{f.label}</span>
                <input value={val} onChange={e=>setCf(f.id,e.target.value)} type={f.field_type==="number"?"number":"text"} placeholder={f.field_type==="number"?"Any value":"Search…"} style={{...inp,minWidth:160}}/>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Merge duplicates (BUILD-08 Phase C) ────────────────────────────────────
// Staff-level data-hygiene tool: GET /donors/duplicates lists candidate
// groups (same email; same/near name), the officer picks which record to
// keep, and POST /donors/merge folds each other record into it — children
// reassigned, blanks filled, secondary soft-deleted with a merge note.
function MergeDuplicatesModal({onClose,onMerged,isReadOnly}){
  const overlay={position:"fixed",inset:0,background:"rgba(15,26,18,0.72)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20};
  const modal={background:T.white,border:"1px solid "+T.bg3,borderRadius:20,width:"100%",maxWidth:760,maxHeight:"90vh",overflowY:"auto",padding:28,boxSizing:"border-box"};
  const[groups,setGroups]=useState(null); // null = loading
  const[open,setOpen]=useState(null);     // group index expanded
  const[primaryId,setPrimaryId]=useState(null);
  const[busy,setBusy]=useState(false);
  const[done,setDone]=useState("");
  const[err,setErr]=useState("");

  const load=()=>{
    setGroups(null);setOpen(null);setPrimaryId(null);setErr("");
    apiFetch("/donors/duplicates").then(r=>setGroups(r.groups||[])).catch(e=>{setGroups([]);setErr(e.message||"Could not check for duplicates.");});
  };
  useEffect(load,[]);

  async function doMerge(group){
    if(!primaryId||busy)return;
    const others=group.donors.filter(d=>d.id!==primaryId);
    const keep=group.donors.find(d=>d.id===primaryId);
    if(!window.confirm(`Merge ${others.length} record${others.length!==1?"s":""} into "${keep.name}"? Their gifts, notes, and history move to the kept record; the duplicate${others.length!==1?"s go":" goes"} to trash.`))return;
    setBusy(true);setErr("");
    try{
      for(const o of others){
        await apiFetch("/donors/merge",{method:"POST",body:JSON.stringify({primaryId,secondaryId:o.id})});
      }
      setDone(`Merged ${others.length} duplicate${others.length!==1?"s":""} into ${keep.name}.`);
      onMerged();
      load();
    }catch(e){setErr(e.message||"Merge failed.");}
    setBusy(false);
  }

  const fmtMoney=n=>"$"+(parseFloat(n)||0).toLocaleString();
  const ROWS=[
    ["Email",d=>d.email||"—"],["Phone",d=>d.phone||"—"],
    ["Total giving",d=>fmtMoney(d.total_giving)],["Gifts",d=>d.gift_count||0],
    ["Last gift",d=>d.last_gift_date||"—"],["Stage",d=>d.stage||"—"],
    ["Location",d=>[d.city,d.state].filter(Boolean).join(", ")||"—"],
    ["Added",d=>(d.created_at||"").split("T")[0]||"—"],
  ];

  return(
    <div style={overlay} className="modal-sheet-overlay">
      <div style={modal} className="modal-sheet-inner">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:T.ink}}>Merge Duplicates</div>
            <div style={{fontSize:13,color:T.ink3,marginTop:2}}>Same email, or names close enough to be the same person — pick the record to keep.</div>
          </div>
          <button onClick={onClose} style={{background:T.bg3,border:"none",borderRadius:8,padding:"6px 12px",color:T.ink3,cursor:"pointer",fontSize:13,flexShrink:0}}>✕ Close</button>
        </div>

        {done&&<div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#166534",fontWeight:600,margin:"10px 0"}}>✓ {done}</div>}
        {err&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#dc2626",margin:"10px 0"}}>{err}</div>}

        {groups===null&&<div style={{display:"flex",alignItems:"center",gap:8,color:T.ink3,fontSize:13,padding:"24px 0"}}><Spin/>Checking your donor list…</div>}

        {groups&&groups.length===0&&!err&&(
          <div style={{textAlign:"center",padding:"36px 0",color:T.ink3}}>
            <div style={{fontSize:26,marginBottom:10,opacity:0.35}}>✓</div>
            <div style={{fontSize:14,fontWeight:600,color:T.ink2,marginBottom:4}}>Your donor list looks clean.</div>
            <div style={{fontSize:13}}>No shared emails, no near-identical names — nothing that needs merging today.</div>
          </div>
        )}

        {groups&&groups.map((g,gi)=>{
          const isOpen=open===gi;
          return(
            <div key={gi} style={{border:"1px solid "+T.bg3,borderRadius:12,marginTop:12,overflow:"hidden"}}>
              <button onClick={()=>{setOpen(isOpen?null:gi);setPrimaryId(null);}}
                style={{width:"100%",background:isOpen?T.bg:T.white,border:"none",padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",gap:10}}>
                <span style={{fontSize:13,fontWeight:700,color:T.ink,textAlign:"left"}}>
                  <span style={{display:"inline-block",background:g.tier==="email"?T.greenDk:T.gold,color:g.tier==="email"?"#fff":T.ink,borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:800,marginRight:8,verticalAlign:"middle"}}>{g.tier==="email"?"SAME EMAIL":"SIMILAR NAME"}</span>
                  {g.donors.map(d=>d.name).join("  ·  ")}
                </span>
                <span style={{fontSize:12,color:T.ink3,flexShrink:0}}>{isOpen?"▲":"▼"}</span>
              </button>
              {isOpen&&(
                <div style={{padding:"14px 16px",borderTop:"1px solid "+T.bg3}}>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                      <thead><tr>
                        <td style={{padding:"6px 10px"}}/>
                        {g.donors.map(d=>(
                          <td key={d.id} style={{padding:"6px 10px",verticalAlign:"top"}}>
                            <label style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",fontWeight:800,color:T.ink,whiteSpace:"nowrap"}}>
                              <input type="radio" name={"mergeprimary"+gi} checked={primaryId===d.id} onChange={()=>setPrimaryId(d.id)} style={{accentColor:T.greenDk}}/>
                              {d.name}
                            </label>
                            <div style={{fontSize:10,color:T.ink3,marginLeft:22,marginTop:1}}>{primaryId===d.id?"keeping this record":"keep this one?"}</div>
                          </td>
                        ))}
                      </tr></thead>
                      <tbody>
                        {ROWS.map(([label,fn])=>(
                          <tr key={label} style={{borderTop:"1px solid "+T.bg2}}>
                            <td style={{padding:"6px 10px",color:T.ink3,fontWeight:600,whiteSpace:"nowrap"}}>{label}</td>
                            {g.donors.map(d=>{
                              const v=fn(d);
                              return <td key={d.id} style={{padding:"6px 10px",color:T.ink2}}>{v}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:10,marginTop:12}}>
                    <span style={{fontSize:12,color:T.ink3}}>Nothing is lost — gifts, notes, and history all move to the kept record.</span>
                    <button onClick={()=>doMerge(g)} disabled={!primaryId||busy||isReadOnly}
                      title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                      style={{background:(!primaryId||busy||isReadOnly)?T.bg3:T.greenDk,border:"none",borderRadius:10,padding:"9px 18px",color:(!primaryId||busy||isReadOnly)?T.ink3:"#fff",fontSize:13,fontWeight:700,cursor:(!primaryId||busy||isReadOnly)?"not-allowed":"pointer"}}>
                      {busy?"Merging…":"Merge into kept record"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Donors ─────────────────────────────────────────────────────────────────
export function Donors({data,setData,isReadOnly=false,initialView,initialLogDonorId,initialStageFilter,initialSelectDonorId,onIntentConsumed}){
  const{auth}=useAuth();
  const isAdmin=auth?.user?.role==="admin";
  const userId=auth?.user?.id||"";
  const userName=auth?.user?.name||auth?.user?.email||"";
  const lapsedCount=data.donors.filter(d=>d.stage==="lapsed"||(d.lastGift&&daysDiff(d.lastGift)>365)).length;
  const[view,setView]=useState(initialView||"directory");
  const[search,setSearch]=useState("");
  const[selected,setSelected]=useState(()=>initialSelectDonorId?data.donors.find(d=>d.id===initialSelectDonorId)||null:null);
  const[logTarget,setLogTarget]=useState(()=>initialLogDonorId?data.donors.find(d=>d.id===initialLogDonorId)||null:null);
  const[editTarget,setEditTarget]=useState(null);
  const[followUpTarget,setFollowUpTarget]=useState(null);
  const[aiMap,setAiMap]=useState({});const[loadingKey,setLoadingKey]=useState(null);
  const[callList,setCallList]=useState("");const[callLoading,setCallLoading]=useState(false);
  const[showAdd,setShowAdd]=useState(false);const[showImport,setShowImport]=useState(false);const[showGiftImport,setShowGiftImport]=useState(false);const[showCombinedImport,setShowCombinedImport]=useState(false);const[showMerge,setShowMerge]=useState(false);
  const[upgradeModal,setUpgradeModal]=useState(null);
  const[newDonor,setNewDonor]=useState({name:"",email:"",phone:"",lastAmount:"",stage:"prospect"});
  const[filtersOpen,setFiltersOpen]=useState(false);
  const[filters,setFilters]=useState({tiers:[],stages:[],pattern:"",geo:"",giftFrom:"",giftTo:"",totalMin:"",totalMax:""});
  const[orgTeam,setOrgTeam]=useState([]);
  const[customFields,setCustomFields]=useState([]);
  const[cfValues,setCfValues]=useState({});
  const[cfFilters,setCfFilters]=useState({});
  const[dirStage,setDirStage]=useState(initialStageFilter||"");
  const[dirAssignee,setDirAssignee]=useState("");
  const[dirDesignation,setDirDesignation]=useState("");   // BUILD-14 planned-giving/estate segment
  const[officers,setOfficers]=useState([]);               // BUILD-14 officer portfolios + color
  const[portfolioMeta,setPortfolioMeta]=useState({tier:"core",single_user:true});
  const[assignTarget,setAssignTarget]=useState(null);
  const[sampleStatus,setSampleStatus]=useState(null);
  const[sampleLoading,setSampleLoading]=useState(false);
  // Server-paginated directory (BUILD-06 Phase A): the Directory view fetches
  // its own 50-row pages with search/stage/owner pushed to query params;
  // data.donors (now /donors/summaries) keeps feeding the whole-org views
  // (pipeline/team/re-engage/map) and everything else.
  const DIR_PAGE_SIZE=50;
  const[dirPage,setDirPage]=useState(0);
  const[dirRows,setDirRows]=useState(null); // null = loading
  const[dirTotal,setDirTotal]=useState(0);
  const[dirSearch,setDirSearch]=useState(search);
  const[dirReloadKey,setDirReloadKey]=useState(0);
  useEffect(()=>{const t=setTimeout(()=>setDirSearch(search),300);return()=>clearTimeout(t);},[search]);
  useEffect(()=>{setDirPage(0);},[dirSearch,dirStage,dirAssignee,dirDesignation]);
  useEffect(()=>{
    if(view!=="directory")return;
    let cancelled=false;
    (async()=>{
      try{
        const qs=new URLSearchParams({limit:String(DIR_PAGE_SIZE),offset:String(dirPage*DIR_PAGE_SIZE)});
        if(dirSearch.trim())qs.set("search",dirSearch.trim());
        if(dirStage)qs.set("stage",dirStage);
        if(dirAssignee)qs.set("assignedTo",dirAssignee);
        if(dirDesignation)qs.set("designation",dirDesignation);
        const r=await apiFetch(`/donors?${qs.toString()}`);
        if(cancelled)return;
        setDirRows((r.donors||[]).map(adaptDonor));
        setDirTotal(r.total||0);
      }catch(e){console.error(e);if(!cancelled)setDirRows([]);}
    })();
    return()=>{cancelled=true;};
  },[view,dirPage,dirSearch,dirStage,dirAssignee,dirDesignation,dirReloadKey]);
  // Officer color map — assigned_to → hex; used for portfolio color-coding.
  const officerColorMap=useMemo(()=>Object.fromEntries(officers.filter(o=>o.portfolio_color).map(o=>[o.id,o.portfolio_color])),[officers]);

  useEffect(()=>{
    if((initialView||initialLogDonorId||initialStageFilter||initialSelectDonorId)&&onIntentConsumed)onIntentConsumed();
    // A deep-linked selection starts from a summary row — upgrade it to the
    // full record (selectDonor is defined below; safe to call from here).
    if(initialSelectDonorId){
      const d=data.donors.find(x=>x.id===initialSelectDonorId);
      if(d)selectDonor(d);
    }
  },[]);

  // Advanced + custom-field filters as shared predicates: applied to the
  // whole summaries list for pipeline/team/re-engage/map, and within the
  // loaded page for the server-paginated Directory (the documented
  // BUILD-06 compromise — full server-side custom-field querying is out of
  // scope; DirectoryView shows a "filtering current page" note instead).
  const matchesAdvanced=d=>{
    if(filters.tiers.length&&!filters.tiers.includes((d.capacityTier||"").toLowerCase()))return false;
    if(filters.stages.length&&!filters.stages.includes(d.stage||"cultivate"))return false;
    if(filters.pattern==="one-time"&&d.gifts!==1)return false;
    if(filters.pattern==="recurring"&&d.gifts<2)return false;
    if(filters.pattern==="major"&&d.lastAmount<10000)return false;
    if(filters.pattern==="lapsed"&&!(d.stage==="lapsed"||(d.lastGift&&daysDiff(d.lastGift)>365)))return false;
    if(filters.geo.trim()&&!`${d.notes||""} ${(d.tags||[]).join(" ")}`.toLowerCase().includes(filters.geo.toLowerCase()))return false;
    if(filters.giftFrom&&d.lastGift&&d.lastGift<filters.giftFrom)return false;
    if(filters.giftTo&&d.lastGift&&d.lastGift>filters.giftTo)return false;
    if(filters.totalMin!==""&&!isNaN(parseFloat(filters.totalMin))&&d.total<parseFloat(filters.totalMin))return false;
    if(filters.totalMax!==""&&!isNaN(parseFloat(filters.totalMax))&&d.total>parseFloat(filters.totalMax))return false;
    return true;
  };
  const matchesCf=d=>{
    for(const [fieldId,fval] of Object.entries(cfFilters)){
      if(!fval||fval==="")continue;
      if(Array.isArray(fval)&&fval.length===0)continue;
      if(typeof fval==="object"&&!Array.isArray(fval)&&!fval.from&&!fval.to)continue;
      const f=customFields.find(x=>x.id===fieldId);
      if(!f)continue;
      const dv=(cfValues[d.id]?.[fieldId]||"").toLowerCase();
      if(f.field_type==="dropdown"){
        if(fval.length===0)continue;
        if(!fval.some(opt=>dv===opt.toLowerCase()))return false;
      }else if(f.field_type==="checkbox"){
        if(fval&&dv!==fval.toLowerCase())return false;
      }else if(f.field_type==="date"){
        if(fval.from&&dv<fval.from)return false;
        if(fval.to&&dv>fval.to)return false;
      }else{
        if(!dv.includes(fval.toLowerCase()))return false;
      }
    }
    return true;
  };
  const advFilterCount=filters.tiers.length+filters.stages.length+(filters.pattern?1:0)+(filters.geo.trim()?1:0)+((filters.giftFrom||filters.giftTo)?1:0)+((filters.totalMin||filters.totalMax)?1:0);
  const cfFilterCount=Object.entries(cfFilters).filter(([,v])=>{if(!v||v==="")return false;if(Array.isArray(v))return v.length>0;if(typeof v==="object")return v.from||v.to;return true;}).length;

  const filtered=data.donors
    .filter(d=>!search||(d.name+d.email).toLowerCase().includes(search.toLowerCase()))
    .filter(matchesAdvanced)
    .filter(matchesCf);
  const dirPageRows=(dirRows||[]).filter(matchesAdvanced).filter(matchesCf);

  const loadOfficers=()=>apiFetch("/portfolio/officers").then(r=>{setOfficers(r.officers||[]);setPortfolioMeta({tier:r.tier||"core",single_user:!!r.single_user});}).catch(()=>{});
  useEffect(()=>{
    apiFetch("/org/sample-data-status").then(setSampleStatus).catch(()=>{});
    apiFetch("/org/team").then(setOrgTeam).catch(()=>{});
    loadOfficers();
    apiFetch("/custom-fields").then(rows=>setCustomFields(Array.isArray(rows)?rows:[])).catch(()=>{});
    apiFetch("/donors/custom-field-values/all").then(rows=>{
      if(!Array.isArray(rows))return;
      const map={};
      rows.forEach(r=>{if(!map[r.donorId])map[r.donorId]={};map[r.donorId][r.fieldId]=r.value;});
      setCfValues(map);
    }).catch(()=>{});
  },[]);

  const loadSampleData=async()=>{
    setSampleLoading(true);
    try{
      await apiFetch("/org/load-sample-data",{method:"POST"});
      window.location.reload();
    }catch(e){ alert(e.message||"Failed to load sample data"); setSampleLoading(false); }
  };

  const patchDirRows=(donorId,patch)=>setDirRows(prev=>prev?prev.map(d=>d.id===donorId?{...d,...patch}:d):prev);

  const handleAssign=(donorId,assignedToId,assignedToName)=>{
    setData(prev=>({...prev,donors:prev.donors.map(d=>d.id===donorId?{...d,assignedTo:assignedToId,assignedToName}:d)}));
    patchDirRows(donorId,{assignedTo:assignedToId,assignedToName});
    if(selected?.id===donorId)setSelected(prev=>({...prev,assignedTo:assignedToId,assignedToName}));
  };

  const moveToStage=async(donorId,stage)=>{
    setData(prev=>({...prev,donors:prev.donors.map(d=>d.id===donorId?{...d,stage}:d)}));
    patchDirRows(donorId,{stage});
    if(selected?.id===donorId)setSelected(prev=>({...prev,stage}));
    try{await apiFetch(`/donors/${donorId}/stage`,{method:"PATCH",body:JSON.stringify({stage})});}
    catch(e){console.error(e);}
  };

  const handleLogged=(donor,interaction)=>{
    const updated={...donor,lastTouchpoint:interaction.date,interactions:[interaction,...(donor.interactions||[])]};
    setData(prev=>({...prev,donors:prev.donors.map(d=>d.id===donor.id?updated:d)}));
    patchDirRows(donor.id,{lastTouchpoint:interaction.date});
    if(selected?.id===donor.id)setSelected(updated);
    setLogTarget(null);
    setFollowUpTarget(donor);
    if(interaction.type==="gift"&&interaction.amount>0)reloadDonors();
  };

  const toggleTask=async(task)=>{
    const updated={...task,done:!task.done};
    setData(prev=>({...prev,tasks:prev.tasks.map(t=>t.id===task.id?updated:t)}));
    try{await apiFetch(`/tasks/${task.id}`,{method:"PUT",body:JSON.stringify({title:task.title,due:task.due||"",priority:task.priority,type:task.type,done:updated.done})});}
    catch(e){console.error(e);}
  };

  const getAI=async(donor,type)=>{
    const key=`${donor.id}_${type}`;setLoadingKey(key);setAiMap(p=>({...p,[key]:""}));
    const stage=STAGES.find(s=>s.id===(donor.stage||"cultivate"))||STAGES[2];
    const urg=moveUrgency(donor);
    const sys=`You are an expert major gifts officer. Be specific, strategic, brief. Max 200 words. Reference actual donor data.`;
    let threadCtx="";
    if(type==="email"||type==="outreach"){
      try{
        const thread=await apiFetch(`/gmail/thread/${donor.id}`);
        if(thread.length>0){
          threadCtx=`\n\nRecent email history with this donor:\n${thread.map(t=>`[${t.created_at.split("T")[0]}] ${t.direction==="outbound"?"You":donor.name}: "${t.subject}" — ${t.note.slice(0,200)}`).join("\n")}`;
        }
      }catch(e){}
    }
    const prompts={
      nextmove:`Donor: ${donor.name} | Stage: ${stage.label} | Days since contact: ${urg.days} | Total: ${fmtFull(donor.total)} (${donor.gifts} gifts) | Last: ${fmtFull(donor.lastAmount)} on ${donor.lastGift}\nNotes: ${donor.notes||"none"}\nOrg: ${data.org.name} — ${data.org.mission}\nRecent touchpoints: ${donor.interactions?.slice(0,3).map(i=>`${i.date}: ${i.type} - ${i.note}`).join("; ")||"none"}\n\nProvide:\n**Urgency Score:** X/10\n**Recommended Move:** [exact action]\n**Timing:** [when]\n**What to say:** [2-3 sentences]\n**Goal:** [what you're trying to achieve]`,
      outreach:`Write an outreach strategy for ${donor.name} (${stage.label} stage).\nTotal: ${fmtFull(donor.total)}, last gift ${fmtFull(donor.lastAmount)} ${urg.days}d ago.\nNotes: ${donor.notes}\nOrg: ${data.org.mission}${threadCtx}\n\nBest channel, talking points, suggested ask amount, personal hook.`,
      email:`Write a personalized email to ${donor.name} (${stage.label} stage).\nLast gift: ${fmtFull(donor.lastAmount)} on ${donor.lastGift}. Notes: ${donor.notes}\nOrg: ${data.org.name}.${threadCtx}\n\nWarm, specific, 150 words max.`,
      callscript:`Phone call script for ${donor.name} (${stage.label}).\nContext: ${donor.notes}\nLast gift: ${fmtFull(donor.lastAmount)}\n\nOpening, 2 listening questions, impact hook, soft ask.`,
    };
    await askClaude(sys,prompts[type],chunk=>setAiMap(p=>({...p,[key]:chunk})));
    setLoadingKey(null);
  };

  const reloadCfValues=async()=>{
    try{
      const rows=await apiFetch("/donors/custom-field-values/all");
      if(!Array.isArray(rows))return;
      const map={};
      rows.forEach(r=>{if(!map[r.donorId])map[r.donorId]={};map[r.donorId][r.fieldId]=r.value;});
      setCfValues(map);
    }catch(e){console.error(e);}
  };

  const reloadDonors=async()=>{
    // Reuse the shared single-donor adapter (see api.js's adaptDonor comment)
    // — this hand-duplicated mapping previously dropped assignedTo/
    // assignedToName (and wealth score, city/state/zip, employer, etc.) from
    // local state on every refresh, which is especially costly here since
    // reloadDonors() is the general post-action refresh (import, gift log,
    // custom field save…), not a rare path.
    try{
      const donors=await apiFetch("/donors/summaries");
      setData(prev=>({...prev,donors:donors.map(adaptDonor)}));
      setDirReloadKey(k=>k+1); // refresh the Directory's server page too
    }catch(e){console.error(e);}
  };

  // Selecting a donor from any view hands DonorProfile a summary row first
  // (instant render), then swaps in the full record — notes, score rationale,
  // Stripe ids — from GET /donors/:id (the summaries list deliberately omits
  // the heavy columns; see BUILD-06 Phase A).
  const selectDonor=async(d)=>{
    if(!d){setSelected(null);return;}
    setSelected(d);
    try{
      const full=await apiFetch(`/donors/${d.id}`);
      setSelected(prev=>prev?.id===d.id?{
        ...adaptDonor(full),
        lastTouchpoint:prev.lastTouchpoint??null,
        interactions:prev.interactions||[],
      }:prev);
    }catch(e){console.error(e);}
  };

  const handleEditSaved=(raw)=>{
    // Reuse the same single-donor adapter adaptData() uses for the initial
    // load — a hand-duplicated shorter field list here previously dropped
    // assignedTo/assignedToName (and wealth score, city/state/zip, etc.)
    // from local state after every edit, even though the database itself
    // was untouched (see api.js's adaptDonor comment).
    const adapted={
      ...adaptDonor(raw),
      interactions:selected?.id===raw.id?(selected.interactions||[]):[],
      lastTouchpoint:selected?.id===raw.id?selected.lastTouchpoint:null,
    };
    setData(prev=>({...prev,donors:prev.donors.map(d=>d.id===raw.id?adapted:d)}));
    setDirRows(prev=>prev?prev.map(d=>d.id===raw.id?adapted:d):prev);
    if(selected?.id===raw.id)setSelected(adapted);
    setEditTarget(null);
  };

  const deleteDonor=async(id)=>{
    if(!window.confirm("Delete this donor? This cannot be undone."))return;
    try{
      await apiFetch(`/donors/${id}`,{method:"DELETE"});
      setData(prev=>({...prev,donors:prev.donors.filter(d=>d.id!==id)}));
      setDirRows(prev=>prev?prev.filter(d=>d.id!==id):prev);
      setDirTotal(t=>Math.max(0,t-1));
      setSelected(null);
    }catch(e){console.error(e);}
  };

  const generateCallList=async()=>{
    setCallLoading(true);setCallList("");
    await askClaude(`You are a chief development officer. Be tactical. Max 200 words.`,
      `Prioritized call list for this week:\n${data.donors.map(d=>`${d.name} [${d.stage||"cultivate"}]: ${daysDiff(d.lastTouchpoint||d.lastGift)}d since contact, ${fmtFull(d.lastAmount)} last gift, score ${donorScore(d)}, notes: ${d.notes}`).join("\n")}`,
      chunk=>setCallList(chunk));
    setCallLoading(false);
  };

  const[newDonorAssignee,setNewDonorAssignee]=useState("");

  const addDonor=async()=>{
    if(!newDonor.name)return;
    const assignTo=newDonorAssignee||userId;
    const assignToName=newDonorAssignee?(orgTeam.find(u=>u.id===newDonorAssignee)?.name||""):userName;
    const temp={id:"tmp_"+Date.now(),name:newDonor.name,email:newDonor.email,phone:newDonor.phone,
      total:parseInt(newDonor.lastAmount)||0,lastGift:new Date().toISOString().split("T")[0],
      lastAmount:parseInt(newDonor.lastAmount)||0,gifts:newDonor.lastAmount?1:0,
      status:"new",stage:newDonor.stage,tags:[],notes:"",interactions:[],lastTouchpoint:null,
      assignedTo:assignTo,assignedToName:assignToName};
    setData(prev=>({...prev,donors:[...prev.donors,temp]}));
    setShowAdd(false);setNewDonor({name:"",email:"",phone:"",lastAmount:"",stage:"prospect"});setNewDonorAssignee("");
    try{await apiFetch("/donors",{method:"POST",body:JSON.stringify({...newDonor,stage:newDonor.stage,assignedTo:assignTo,assignedToName:assignToName})});await reloadDonors();}
    catch(e){
      if(e.error==="record_limit"){
        setData(prev=>({...prev,donors:prev.donors.filter(d=>d.id!==temp.id)}));
        setUpgradeModal({reason:e.error,current:e.current,limit:e.limit,plan:e.plan});
      } else { console.error(e); }
    }
  };

  return(
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      <PageTitle main="Your" accent="donors."/>
      {assignTarget&&<AssignModal donor={assignTarget} orgTeam={orgTeam} onSave={handleAssign} onClose={()=>setAssignTarget(null)}/>}
      {showImport&&<DonorImport onClose={()=>setShowImport(false)} onImported={()=>{reloadDonors();setShowImport(false);}}/>}
      {showGiftImport&&<GiftHistoryImport donors={data.donors} onClose={()=>setShowGiftImport(false)} onImported={()=>{reloadDonors();setShowGiftImport(false);}}/>}
      {showMerge&&<MergeDuplicatesModal onClose={()=>setShowMerge(false)} onMerged={reloadDonors} isReadOnly={isReadOnly}/>}
      {showCombinedImport&&<CombinedImport onClose={()=>setShowCombinedImport(false)} onImported={()=>{reloadDonors();setShowCombinedImport(false);}}/>}
      {upgradeModal&&<UpgradeModal open={true} onClose={()=>setUpgradeModal(null)} reason={upgradeModal.reason} current={upgradeModal.current} limit={upgradeModal.limit} plan={upgradeModal.plan}/>}
      {logTarget&&<LogTouchpointModal donor={logTarget} onSave={int=>handleLogged(logTarget,int)} onClose={()=>setLogTarget(null)}/>}
      {followUpTarget&&<FollowUpTaskModal donor={followUpTarget} onClose={()=>setFollowUpTarget(null)} onSave={task=>{setData(prev=>({...prev,tasks:[task,...prev.tasks]}));setFollowUpTarget(null);}}/>}
      {editTarget&&<EditDonorModal donor={editTarget} onSave={handleEditSaved} onClose={()=>setEditTarget(null)}/>}
      {selected ? (
      <ErrorBoundary key={selected.id}><DonorProfile donor={selected} onClose={()=>setSelected(null)}
        onStageChange={moveToStage} onLogTouchpoint={()=>{setLogTarget(selected);}}
        aiMap={aiMap} loadingKey={loadingKey} getAI={getAI}
        isAdmin={isAdmin} onEdit={()=>setEditTarget(selected)} onDelete={deleteDonor}
        tasks={data.tasks.filter(t=>t.donorId===selected.id)} onTaskToggle={toggleTask} onAddTask={()=>setFollowUpTarget(selected)}
        orgName={data.org?.name||""} orgTeam={orgTeam} onReassign={handleAssign} onCfSaved={reloadCfValues} onInteractionAdded={reloadDonors}
        isReadOnly={isReadOnly} allDonors={data.donors} onSelectRelatedDonor={id=>{const d=data.donors.find(x=>x.id===id);if(d)selectDonor(d);}}/></ErrorBoundary>
      ) : (<>

      <div className="donors-toolbar" style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <input className="donors-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search donors…" style={{flex:1,minWidth:160,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink,fontSize:13,outline:"none"}}/>
        <div className="donors-view-toggle" style={{display:"flex",background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,overflow:"hidden"}}>
          {[["directory","Directory"],...(isAdmin?[["team","Team"]]:[]),["reengage","Re-engage"],["map","Map"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{background:view===v?T.bg2:"transparent",border:"none",padding:"9px 14px",color:view===v?T.ink:"#6b7280",fontSize:13,fontWeight:view===v?700:400,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
              {l}
              {v==="reengage"&&lapsedCount>0&&<span style={{background:"#1a6b4a",color:"#fff",borderRadius:99,padding:"1px 6px",fontSize:10,fontWeight:800,lineHeight:1.4}}>{lapsedCount}</span>}
            </button>
          ))}
        </div>
        <AIBtn onClick={generateCallList} loading={callLoading} label="✦ Call List"/>
        <button onClick={()=>setShowAdd(!showAdd)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:"#10b981",border:"none",borderRadius:10,padding:"10px 14px",color:"#fff",fontSize:13,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>+ Add</button>
        <button onClick={()=>setShowImport(true)} style={{background:T.bg3,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>↑ Import</button>
        <button onClick={()=>setShowGiftImport(true)} style={{background:T.bg3,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>↑ Giving History</button>
        <button onClick={()=>setShowCombinedImport(true)} style={{background:T.bg3,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>↑ Import + History</button>
        <button onClick={()=>setShowMerge(true)} style={{background:T.bg3,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>⇆ Merge duplicates</button>
      </div>

      {(()=>{
        const count=advFilterCount+cfFilterCount;
        const pills=[];
        filters.tiers.forEach(t=>{const m=TIER_META.find(x=>x.id===t);pills.push({id:"t"+t,label:`Tier: ${m?.label||t}`,rm:()=>setFilters(f=>({...f,tiers:f.tiers.filter(v=>v!==t)}))});});
        filters.stages.forEach(s=>{const m=STAGES.find(x=>x.id===s);pills.push({id:"s"+s,label:`Stage: ${m?.label||s}`,rm:()=>setFilters(f=>({...f,stages:f.stages.filter(v=>v!==s)}))});});
        if(filters.pattern){const m=PATTERN_META.find(p=>p.id===filters.pattern);pills.push({id:"pat",label:`Pattern: ${m?.label||filters.pattern}`,rm:()=>setFilters(f=>({...f,pattern:""}))});}
        if(filters.geo.trim())pills.push({id:"geo",label:`Geo: "${filters.geo}"`,rm:()=>setFilters(f=>({...f,geo:""}))});
        if(filters.giftFrom||filters.giftTo)pills.push({id:"gift",label:`Last gift: ${filters.giftFrom||"any"} → ${filters.giftTo||"any"}`,rm:()=>setFilters(f=>({...f,giftFrom:"",giftTo:""}))});
        if(filters.totalMin||filters.totalMax)pills.push({id:"total",label:`Giving: ${filters.totalMin?"$"+filters.totalMin:"$0"} → ${filters.totalMax?"$"+filters.totalMax:"any"}`,rm:()=>setFilters(f=>({...f,totalMin:"",totalMax:""}))});
        Object.entries(cfFilters).forEach(([fieldId,fval])=>{
          if(!fval||fval==="")return;
          if(Array.isArray(fval)&&fval.length===0)return;
          if(typeof fval==="object"&&!Array.isArray(fval)&&!fval.from&&!fval.to)return;
          const f=customFields.find(x=>x.id===fieldId);
          if(!f)return;
          let label=`${f.label}: `;
          if(Array.isArray(fval))label+=fval.join(", ");
          else if(typeof fval==="object")label+=`${fval.from||"any"} → ${fval.to||"any"}`;
          else label+=fval;
          pills.push({id:"cf_"+fieldId,label,rm:()=>setCfFilters(p=>({...p,[fieldId]:f.field_type==="dropdown"?[]:f.field_type==="date"?{from:"",to:""}:""}))});
        });
        const clearAll=()=>{setFilters({tiers:[],stages:[],pattern:"",geo:"",giftFrom:"",giftTo:"",totalMin:"",totalMax:""});setCfFilters({});};
        return<>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <button onClick={()=>setFiltersOpen(v=>!v)} style={{background:filtersOpen||count>0?T.bg2:T.bg,border:"1px solid "+(count>0?T.greenDk:T.bg3),borderRadius:9,padding:"7px 12px",color:count>0?T.greenDk:T.ink3,fontSize:12,fontWeight:count>0?700:400,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
              ⊞ Filters
              {count>0&&<span style={{background:T.greenDk,color:"#fff",borderRadius:99,padding:"0 6px",fontSize:10,fontWeight:800,lineHeight:"16px"}}>{count}</span>}
            </button>
            {pills.map(p=>(
              <span key={p.id} style={{background:T.bg2,border:"1px solid "+T.bg3,borderRadius:99,padding:"4px 10px",fontSize:12,color:T.ink2,display:"inline-flex",alignItems:"center",gap:5}}>
                {p.label}
                <button onClick={p.rm} style={{background:"none",border:"none",cursor:"pointer",color:T.ink3,fontSize:13,lineHeight:1,padding:0,marginLeft:2}}>×</button>
              </span>
            ))}
            {count>0&&<button onClick={clearAll} style={{background:"none",border:"none",color:T.ink3,fontSize:12,cursor:"pointer",textDecoration:"underline",padding:0}}>Clear all</button>}
          </div>
          {filtersOpen&&<FilterBar filters={filters} onChange={setFilters} customFields={customFields} cfFilters={cfFilters} onCfChange={setCfFilters}/>}
        </>;
      })()}

      {(callLoading||callList)&&<AIPanel text={callList} onClose={()=>setCallList("")}/>}

      {showAdd&&<Card style={{gap:10,display:"flex",flexDirection:"column"}}>
        <div style={{fontSize:14,fontWeight:700,color:T.ink}}>New Donor</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {STAGES.map(s=><button key={s.id} onClick={()=>setNewDonor(p=>({...p,stage:s.id}))} style={{background:newDonor.stage===s.id?s.color+"22":T.bg,border:`1px solid ${newDonor.stage===s.id?s.color:T.bg3}`,borderRadius:7,padding:"5px 11px",color:newDonor.stage===s.id?s.color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>{s.label}</button>)}
        </div>
        {[["name","Full Name"],["email","Email"],["phone","Phone"],["lastAmount","Gift Amount ($)"]].map(([k,pl])=>(
          <input key={k} value={newDonor[k]} onChange={e=>setNewDonor(p=>({...p,[k]:e.target.value}))} placeholder={pl} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none"}}/>
        ))}
        {isAdmin&&orgTeam.length>1&&<select value={newDonorAssignee} onChange={e=>setNewDonorAssignee(e.target.value)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",cursor:"pointer"}}>
          <option value="">Assign to me ({userName})</option>
          {orgTeam.filter(u=>u.id!==userId).map(u=><option key={u.id} value={u.id}>Assign to {u.name}</option>)}
        </select>}
        <div style={{display:"flex",gap:8}}>
          <button onClick={addDonor} style={{background:"#10b981",border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>Save</button>
          <button onClick={()=>setShowAdd(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"9px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </Card>}

      {view==="directory"&&<DirectoryView donors={dirPageRows} loading={dirRows===null} serverTotal={dirTotal} page={dirPage} pageSize={DIR_PAGE_SIZE} onPage={setDirPage} clientFilterCount={advFilterCount+cfFilterCount} exportParams={{search:dirSearch.trim(),stage:dirStage,assignedTo:dirAssignee,designation:dirDesignation}} totalDonors={data.donors.length} orgTeam={orgTeam} isAdmin={isAdmin} onSelectDonor={selectDonor} onAssign={d=>setAssignTarget(d)} stageFilter={dirStage} setStageFilter={setDirStage} assigneeFilter={dirAssignee} setAssigneeFilter={setDirAssignee} designationFilter={dirDesignation} setDesignationFilter={setDirDesignation} officers={officers} officerColorMap={officerColorMap} portfolioMeta={portfolioMeta} onOfficersChanged={loadOfficers} onLoadSampleData={loadSampleData} sampleLoading={sampleLoading} hasSampleData={sampleStatus?.hasSampleData} onAddDonor={()=>setShowAdd(true)} onBulkDone={reloadDonors}/>}

      {view==="team"&&isAdmin&&<TeamView donors={filtered} orgTeam={orgTeam} onSelectDonor={selectDonor}/>}

      {view==="reengage"&&<ReEngageView donors={filtered} org={data.org} onLogTouchpoint={d=>setLogTarget(d)} onSelectDonor={selectDonor}/>}
      {view==="map"&&<DonorMap donors={filtered} userId={userId} onSelectDonor={selectDonor}/>}
      </>)}
    </div>
  );
}

// BUILD-82 — A WORKBOOK IS ONE IMPORT. Sheets are parts of a file, not files:
// every sheet gets a role with the sentence that justifies it, chrome and
// decoys stay out without an explicit override (a decoy override warns in
// dollars), the sheet's own signals (hidden rows, fill colours, comments,
// hidden columns) are surfaced as questions with the file's legend quoted,
// every column is ONE dropdown (standard · existing custom · new custom field
// created inline), and the whole thing lands in one pass, one summary, one
// transaction. The pre-write summary and the write both come from
// buildWorkbookSubmission — the screen cannot disagree with the write.
import { useState, useMemo, useEffect } from "react";
import { apiFetch } from "../api";
import { T, Spin } from "./shared";
import {
  buildWorkbookSubmission, buildStandardMapping, buildSheetSignals, extractWorkbookLegend,
  STANDARD_DONOR_FIELDS, STANDARD_GIFT_FIELDS, inferDateConventionCells,
} from "../../../shared/importShape";
import { detectExclusionColumn, proposeCustomField, proposalEvidenceText, CF_TYPES } from "../../../shared/customFieldShape";

const ROLE_LABEL = { donors: "Donors", gifts: "Gifts", pledges: "Pledges", recurring: "Recurring", chrome: "Not data", decoy: "Superseded copy", empty: "Empty", unknown: "Unknown" };
const ROLE_COLOR = r => r === "donors" || r === "gifts" ? (T.green600 || "#1e6b45") : r === "pledges" || r === "recurring" ? (T.gold600 || "#a97f22") : T.ink3;
const fmtN = n => Number(n || 0).toLocaleString();
const fmt$ = n => "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// a client-side CSV download for the itemised refusal/skip lists
function downloadCsv(name, rows, cols) {
  const esc = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const SectionHead = ({ children }) => (
  <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: T.ink3, margin: "18px 0 8px" }}>{children}</div>
);

export function WorkbookImport({ workbook, fileName, hasExistingDonors, onClose, onImported }) {
  // workbook: { roled (classifyWorkbookSheets output over analyzeWorkbookSheet sheets) }
  const [step, setStep] = useState("sheets");        // sheets → signals → mapper → summary → result
  const [roleOverrides, setRoleOverrides] = useState({});
  const [includeDecoy, setIncludeDecoy] = useState(false);
  const [signalAnswers, setSignalAnswers] = useState({});
  const [mappingOverrides, setMappingOverrides] = useState({});   // sheet → header → stdKey|""
  const [cfChoices, setCfChoices] = useState({});                  // sheet → header → {action, entity, key, fieldId, label}
  const [newFieldDraft, setNewFieldDraft] = useState(null);        // {sheet, header, label, type, entity}
  const [cfDefs, setCfDefs] = useState({ donor: [], gift: [] });
  const [submission, setSubmission] = useState(null);
  const [linkPreview, setLinkPreview] = useState(null);            // gift-alone pre-write link counts (server dryRun)
  const [building, setBuilding] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [elapsed, setElapsed] = useState(null);

  useEffect(() => {
    apiFetch("/custom-fields?entity=donor").then(r => setCfDefs(p => ({ ...p, donor: Array.isArray(r) ? r : [] }))).catch(() => {});
    apiFetch("/custom-fields?entity=gift").then(r => setCfDefs(p => ({ ...p, gift: Array.isArray(r) ? r : [] }))).catch(() => {});
  }, []);

  const roled = useMemo(() => workbook.roled.map(s => ({ ...s, role: roleOverrides[s.name] || s.role })), [workbook, roleOverrides]);
  const legend = useMemo(() => extractWorkbookLegend(workbook.roled), [workbook]);
  const donorsSheet = roled.find(s => s.role === "donors") || null;
  const giftSheets = roled.filter(s => s.role === "gifts");
  const pledgeSheet = roled.find(s => s.role === "pledges") || null;
  const recurringSheet = roled.find(s => s.role === "recurring") || null;
  const giftAlone = !donorsSheet && giftSheets.length > 0;   // Part 2.5 — link to the org's existing records

  const signals = useMemo(() => {
    const out = [];
    for (const s of roled) {
      if (s.role !== "donors" && s.role !== "gifts") continue;
      out.push(...buildSheetSignals(s.name, s.meta || {}, legend, { headerCells: s.headerCells }));
    }
    return out;
  }, [roled, legend]);

  // ── the mapper model: one entry per column of each importable sheet ──────
  const mapperSheets = useMemo(() => {
    const importable = [donorsSheet, ...giftSheets].filter(Boolean);
    return importable.map(s => {
      const entity = s.role === "donors" ? "donor" : "gift";
      const auto = buildStandardMapping(s.headers, s.rows, entity);
      const hiddenCols = new Set(((s.meta || {}).hiddenCols || []).map(h => h.index));
      const columns = s.headers.map((h, idx) => {
        if (!String(h).trim()) return null;
        const values = s.rows.map(r => r[h]);
        const excl = detectExclusionColumn(h, values);
        const stdDefault = auto.mapping[h] || "";
        const hidden = hiddenCols.has(idx);
        const proposal = proposeCustomField(h, values, {});
        return { header: h, index: idx, entity, excl, stdDefault, hidden,
                 evidence: auto.evidence[h] || "", proposal,
                 sample: values.find(v => String(v ?? "").trim() !== "") };
      }).filter(Boolean);
      // Part 3.2 — convention inference is PER SHEET, said on screen at the mapper
      let convention = null;
      const dateHdr = Object.keys(auto.mapping).find(h => auto.mapping[h] === "date");
      if (dateHdr) {
        const cells = s.rows.map((r, i) => {
          const t = (s.typedRows || [])[i];
          return t && t[dateHdr] !== undefined ? t[dateHdr] : r[dateHdr];
        });
        convention = inferDateConventionCells(cells);
      }
      return { name: s.name, entity, columns, convention };
    });
  }, [donorsSheet, giftSheets]);

  const targetOf = (sheet, col) => {
    const o = (mappingOverrides[sheet] || {})[col.header];
    if (o !== undefined) return o ? `std:${o}` : ((cfChoices[sheet] || {})[col.header] ? cfTarget(sheet, col) : "ignore");
    const cf = (cfChoices[sheet] || {})[col.header];
    if (cf) return cfTarget(sheet, col);
    if (col.excl) return "flag";
    // Part 3.5 — a hidden column is never auto-mapped.
    if (col.hidden) return "ignore";
    return col.stdDefault ? `std:${col.stdDefault}` : "ignore";
  };
  const cfTarget = (sheet, col) => {
    const c = (cfChoices[sheet] || {})[col.header];
    return c ? (c.action === "existing" ? `cf:${c.fieldId}` : `new:${c.key}`) : "ignore";
  };

  const setTarget = (sheetName, col, value) => {
    if (value === "__new__") {
      setNewFieldDraft({ sheet: sheetName, header: col.header, label: String(col.header).trim().slice(0, 60),
        type: col.proposal.type, entity: col.entity });
      return;
    }
    setNewFieldDraft(null);
    if (value.startsWith("std:")) {
      setMappingOverrides(p => ({ ...p, [sheetName]: { ...(p[sheetName] || {}), [col.header]: value.slice(4) } }));
      setCfChoices(p => ({ ...p, [sheetName]: { ...(p[sheetName] || {}), [col.header]: undefined } }));
    } else if (value.startsWith("cf:")) {
      const def = [...cfDefs.donor, ...cfDefs.gift].find(d => d.id === value.slice(3));
      if (!def) return;
      setMappingOverrides(p => ({ ...p, [sheetName]: { ...(p[sheetName] || {}), [col.header]: "" } }));
      setCfChoices(p => ({ ...p, [sheetName]: { ...(p[sheetName] || {}), [col.header]: { action: "existing", entity: def.entity, key: def.key, fieldId: def.id, label: def.label } } }));
    } else { // ignore
      setMappingOverrides(p => ({ ...p, [sheetName]: { ...(p[sheetName] || {}), [col.header]: "" } }));
      setCfChoices(p => ({ ...p, [sheetName]: { ...(p[sheetName] || {}), [col.header]: undefined } }));
    }
  };

  // Part 4.1 — the field exists the moment it's created, and the column maps to it.
  const createField = async () => {
    const d = newFieldDraft;
    if (!d || !d.label.trim()) return;
    try {
      const created = await apiFetch("/custom-fields", { method: "POST", body: JSON.stringify({
        entity: d.entity, label: d.label.trim(), type: d.type, options: [],
        source: `import of ${fileName || "workbook"}`,
      })});
      setCfDefs(p => ({ ...p, [created.entity]: [...p[created.entity], created] }));
      setMappingOverrides(p => ({ ...p, [d.sheet]: { ...(p[d.sheet] || {}), [d.header]: "" } }));
      setCfChoices(p => ({ ...p, [d.sheet]: { ...(p[d.sheet] || {}), [d.header]: { action: "existing", entity: created.entity, key: created.key, fieldId: created.id, label: created.label } } }));
      setNewFieldDraft(null);
    } catch (e) { setErr(e.message || "Could not create the field."); }
  };

  // ── build the ONE submission (summary + write share it) ──────────────────
  const buildNow = async () => {
    setBuilding(true); setErr("");
    setProgressText(`Reading ${fmtN(roled.filter(s => s.role === "gifts").reduce((a, s) => a + s.rowCount, 0))} gift rows across ${giftSheets.length} sheet${giftSheets.length === 1 ? "" : "s"}…`);
    await new Promise(r => setTimeout(r, 60));   // let the status paint before the sync build
    try {
      const customAssignments = {};
      for (const [sheet, cols] of Object.entries(cfChoices)) {
        for (const [header, c] of Object.entries(cols)) {
          if (c && c.key) (customAssignments[sheet] = customAssignments[sheet] || {})[header] = { entity: c.entity, key: c.key };
        }
      }
      const sub = buildWorkbookSubmission(roled, {
        signalAnswers, legend, includeDecoy,
        currentYear: new Date().getFullYear(),
        mappingOverrides, customAssignments,
      });
      setSubmission(sub);
      // gift-alone: ask the server how the link would land BEFORE the write —
      // the pre-write summary never guesses ("map a name or email" is dead;
      // a Donor ID column is a first-class link key).
      if (giftAlone && sub.giftAloneItems) {
        setProgressText(`Checking ${fmtN(sub.giftAloneItems.length)} gifts against your existing records…`);
        const giftRows = sub.giftAloneItems.map(i => ({ donorExternalId: i.donorId, email: i.email || "", name: i.name || "", line: i.line, ...i.gift }));
        const dr = await apiFetch("/donors/import-combined", { method: "POST", body: JSON.stringify({ donors: [], gifts: giftRows, linkToExisting: true, dryRun: true }) });
        setLinkPreview(dr);
      }
      setStep("summary");
    } catch (e) {
      console.error("workbook build failed:", e);
      setErr("Could not prepare the import: " + (e.message || e));
    }
    setBuilding(false); setProgressText("");
  };

  const doImport = async () => {
    if (!submission) return;
    setBuilding(true); setErr("");
    const t0 = Date.now();
    try {
      if (giftAlone) {
        // Part 2.5 — gifts alone, linked to the org's existing records
        const allItems = submission.giftAloneItems || [];
        setProgressText(`Linking ${fmtN(allItems.length)} gifts to your existing records…`);
        const giftRows = allItems.map(i => ({ donorExternalId: i.donorId, email: i.email || "", name: i.name || "", line: i.line, ...i.gift }));
        const res = await apiFetch("/donors/import-combined", { method: "POST", body: JSON.stringify({ donors: [], gifts: giftRows, linkToExisting: true }) });
        setResult({ ...res, giftAlone: true });
      } else {
        setProgressText(`Writing ${fmtN(submission.donors.length)} donors + ${fmtN(submission.gifts.length)} gifts — one transaction, all or nothing…`);
        const donors = submission.donors.map(({ _line, _freqMonthlyClaim, _staleChargeClaim, staleFrequency, address1, ...d }) => d);
        const res = await apiFetch("/donors/import-combined", { method: "POST", body: JSON.stringify({
          donors, gifts: submission.gifts, identityResolved: true,
        })});
        setProgressText("Routing pledges, merges and the import record…");
        const sem = await apiFetch("/donors/import-semantics", { method: "POST", body: JSON.stringify({
          pledges: submission.pledges.pledges.map(p => ({ donorExternalId: p.donorExternalId, amount: p.amount, date: p.date, externalId: p.externalId, status: p.status })),
          merges: submission.merges.map(m => ({ surviving: m.surviving, folded: m.folded, reason: m.reason })),
          fileStats: submission.fileStats,
        })}).catch(e => ({ error: e.message }));
        setResult({ ...res, semantics: sem });
      }
      setElapsed(((Date.now() - t0) / 1000).toFixed(1));
      setStep("result");   // the Done button hands control back (onImported closes the modal + reloads)
    } catch (e) {
      console.error("workbook import failed:", e);
      setErr(e.message || "Import failed — nothing was written.");
    }
    setBuilding(false); setProgressText("");
  };

  // ─────────────────────────── RENDER ───────────────────────────
  const btn = (label, onClick, opts = {}) => (
    <button onClick={onClick} disabled={opts.disabled}
      data-testid={opts.testid}
      style={{ background: opts.secondary ? "transparent" : (T.green600 || "#1e6b45"), color: opts.secondary ? T.ink3 : "#fff",
               border: opts.secondary ? `1px solid ${T.bg3}` : "none", borderRadius: 10, padding: "11px 18px",
               fontSize: 13.5, fontWeight: 700, cursor: opts.disabled ? "default" : "pointer", opacity: opts.disabled ? 0.5 : 1 }}>
      {label}
    </button>
  );

  if (step === "sheets") {
    const importables = roled.filter(s => ["donors", "gifts", "pledges", "recurring"].includes(s.role));
    const donorsN = donorsSheet ? donorsSheet.rowCount : 0;
    const giftsN = giftSheets.reduce((a, s) => a + s.rowCount, 0);
    return (
      <div data-testid="wb-sheet-roles">
        <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, marginBottom: 4 }}>This workbook is one import.</div>
        <div style={{ fontSize: 13, color: T.ink3, marginBottom: 14 }}>
          {fmtN(workbook.roled.length)} sheets — each with a role and the reason. Roles are editable; nothing marked “not data” or “superseded” imports without your say-so.
        </div>
        {legend.length > 0 && (
          <div style={{ background: T.gold100 || "#f6eccf", border: `1px solid ${T.gold300 || "#e7cf91"}`, borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: T.gold600 || "#a97f22", marginBottom: 4 }}>The file's own legend</div>
            {legend.map((l, i) => <div key={i} style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.5 }}>“{l.text}” <span style={{ color: T.ink3 }}>— {l.sheet}</span></div>)}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {roled.map(s => (
            <div key={s.name} data-testid={`wb-sheet-${s.name}`} style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 14px", opacity: ["chrome", "empty", "decoy"].includes(s.role) && !(s.role === "decoy" && includeDecoy) ? 0.75 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{s.name}
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: T.ink3, marginLeft: 8 }}>{s.rowCount ? fmtN(s.rowCount) + " rows" : "—"}</span>
                </div>
                <select value={s.role} onChange={e => setRoleOverrides(p => ({ ...p, [s.name]: e.target.value }))}
                  data-testid={`wb-role-${s.name}`}
                  style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 7, padding: "4px 8px", fontSize: 12, fontWeight: 700, color: ROLE_COLOR(s.role), cursor: "pointer" }}>
                  {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div style={{ fontSize: 12, color: T.ink3, marginTop: 4, lineHeight: 1.45 }}>{s.evidence}</div>
              {s.chromeRows && s.chromeRows.filter(c => c.kind !== "blank").length > 0 && ["gifts", "donors"].includes(s.role) && (
                <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 4 }}>
                  Not counted: {s.chromeRows.filter(c => c.kind !== "blank").map(c => `row ${c.line} (${c.kind.replace(/_/g, " ")}${c.amount != null ? ", " + fmt$(c.amount) : ""})`).join(" · ")}
                </div>
              )}
              {s.role === "decoy" && (
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8, fontSize: 12, color: "#b8593f", cursor: "pointer" }}>
                  <input type="checkbox" checked={includeDecoy} onChange={e => setIncludeDecoy(e.target.checked)} style={{ marginTop: 2 }} />
                  <span>Import it anyway — this would add <strong>{fmt$(s.decoyDollars)}</strong> of gifts that look already-imported; anything duplicating a real sheet (same donor, date, amount) will be excluded and shown.</span>
                </label>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center" }}>
          {btn(giftAlone
            ? `Continue — link ${fmtN(giftsN)} gifts to your existing records →`
            : `Continue — one import: ${fmtN(donorsN)} donors + ${fmtN(giftsN)} gifts${pledgeSheet ? ` + ${fmtN(pledgeSheet.rowCount)} pledges` : ""}${recurringSheet ? ` + ${fmtN(recurringSheet.rowCount)} recurring` : ""} →`,
            () => setStep(signals.length ? "signals" : "mapper"), { disabled: !importables.length, testid: "wb-continue" })}
          {btn("← Back", onClose, { secondary: true })}
        </div>
      </div>
    );
  }

  if (step === "signals") {
    return (
      <div data-testid="wb-signals">
        <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, marginBottom: 4 }}>What the sheet knows that the cells don't.</div>
        <div style={{ fontSize: 13, color: T.ink3, marginBottom: 14 }}>Hidden rows, highlights and comments were detected — they are never silently included or excluded. The file's legend is quoted where it speaks.</div>
        {signals.map((sig, i) => (
          <div key={i} data-testid={`wb-signal-${sig.kind}`} style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.5, marginBottom: 8 }}>{sig.question}</div>
            {sig.kind === "comments" && (
              <div style={{ maxHeight: 130, overflowY: "auto", background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>
                {(sig.comments || []).map((c, j) => <div key={j} style={{ fontSize: 11.5, color: T.ink3 }}>row {c.row}: “{c.text}”</div>)}
              </div>
            )}
            {(sig.kind === "hidden_rows" || sig.kind === "filled_rows") && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[["legend", sig.legend ? "Treat them per the legend" : "Flag per the legend (none found)"], ["import", "Import as normal"], ["skip", "Skip these rows"]].map(([v, label]) => (
                  <label key={v} style={{ fontSize: 12.5, color: T.ink, display: "flex", gap: 6, alignItems: "center", cursor: "pointer", border: `1px solid ${signalAnswers[sig.kind] === v ? (T.green600 || "#1e6b45") : T.bg3}`, borderRadius: 8, padding: "6px 10px" }}>
                    <input type="radio" name={sig.kind} checked={signalAnswers[sig.kind] === v} onChange={() => setSignalAnswers(p => ({ ...p, [sig.kind]: v }))} />
                    {label}
                  </label>
                ))}
              </div>
            )}
            {sig.kind === "comments" && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[["route", `Flag the ${sig.exclusionCount} that match the exclusion family (deceased / do-not-contact)`], ["ignore", "Keep as note text only"]].map(([v, label]) => (
                  <label key={v} style={{ fontSize: 12.5, color: T.ink, display: "flex", gap: 6, alignItems: "center", cursor: "pointer", border: `1px solid ${signalAnswers.comments === v ? (T.green600 || "#1e6b45") : T.bg3}`, borderRadius: 8, padding: "6px 10px" }}>
                    <input type="radio" name="comments" checked={signalAnswers.comments === v} onChange={() => setSignalAnswers(p => ({ ...p, comments: v }))} />
                    {label}
                  </label>
                ))}
              </div>
            )}
            {sig.kind === "hidden_column" && (
              <div style={{ fontSize: 12, color: T.ink3 }}>It stays unmapped unless you map it yourself on the next screen.</div>
            )}
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          {btn("Continue to the mapping →", () => setStep("mapper"), {
            disabled: signals.some(s => (s.kind === "hidden_rows" || s.kind === "filled_rows") && !signalAnswers[s.kind]) || (signals.some(s => s.kind === "comments") && !signalAnswers.comments),
            testid: "wb-signals-continue" })}
          {btn("← Back", () => setStep("sheets"), { secondary: true })}
        </div>
      </div>
    );
  }

  if (step === "mapper") {
    return (
      <div data-testid="wb-mapper">
        <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, marginBottom: 4 }}>Every column, one decision.</div>
        <div style={{ fontSize: 13, color: T.ink3, marginBottom: 6 }}>Standard fields · your existing custom fields · a new custom field created right here. Exclusion-shaped columns route to the safety flags and can never become custom fields.</div>
        {mapperSheets.map(ms => {
          const stdList = ms.entity === "donor" ? STANDARD_DONOR_FIELDS : STANDARD_GIFT_FIELDS;
          const takenStd = new Set(ms.columns.map(c => { const t = targetOf(ms.name, c); return t.startsWith("std:") ? t.slice(4) : null; }).filter(Boolean));
          const conv = ms.convention && ms.convention.convention === "dmy"
            ? `${fmtN(ms.convention.slashCells)} dates on this sheet use day/month/year — ${fmtN(ms.convention.dayFirstEvidence)} would be impossible the other way (e.g. ${(ms.convention.dayFirstExamples || []).join(", ")}). Every slash date here reads day-first.`
            : ms.convention && ms.convention.convention === "mdy"
            ? `Dates on this sheet read month/day/year (${fmtN(ms.convention.monthFirstEvidence)} cases would be impossible day-first).`
            : null;
          return (
            <div key={ms.name} style={{ marginBottom: 10 }}>
              <SectionHead>{ms.name} — {ms.entity === "donor" ? "one row per person" : "one row per gift"}</SectionHead>
              {conv && (
                <div style={{ fontSize: 12, color: T.ink, background: T.bg, borderRadius: 8, padding: "7px 12px", marginBottom: 8 }}>{conv}</div>
              )}
              {ms.columns.map(col => {
                const t = targetOf(ms.name, col);
                const isDraft = newFieldDraft && newFieldDraft.sheet === ms.name && newFieldDraft.header === col.header;
                return (
                  <div key={col.header} data-wb-col={col.header} style={{ borderTop: `1px solid ${T.bg3}`, padding: "8px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>
                        {col.header}
                        {col.hidden && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#b8593f", marginLeft: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>hidden column — not auto-mapped</span>}
                        <span style={{ fontSize: 11.5, fontWeight: 400, color: T.ink3, marginLeft: 8 }}>e.g. “{String(col.sample ?? "").slice(0, 28)}”</span>
                      </div>
                      {col.excl ? (
                        <div style={{ fontSize: 12, fontWeight: 700, color: T.gold600 || "#a97f22" }}>→ safety flags ({col.excl.flag}) — locked</div>
                      ) : (
                        <select value={t === "flag" ? "ignore" : t} onChange={e => setTarget(ms.name, col, e.target.value)}
                          data-testid={`wb-map-${col.header}`}
                          style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, color: T.ink, cursor: "pointer", maxWidth: 320 }}>
                          <optgroup label="Standard fields">
                            {stdList.filter(f => !f.flag).map(f => {
                              const v = `std:${f.key}`;
                              return <option key={f.key} value={v} disabled={takenStd.has(f.key) && t !== v}>{f.label}</option>;
                            })}
                          </optgroup>
                          {cfDefs[ms.entity].filter(d => !d.archived_at && !d.archivedAt).length > 0 && (
                            <optgroup label="Your custom fields">
                              {cfDefs[ms.entity].filter(d => !d.archived_at && !d.archivedAt).map(d => <option key={d.id} value={`cf:${d.id}`}>{d.label}</option>)}
                            </optgroup>
                          )}
                          <optgroup label="—">
                            <option value="__new__">＋ New custom field…</option>
                            <option value="ignore">Don't import this column</option>
                          </optgroup>
                        </select>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 3 }}>
                      {col.excl ? `Values match the exclusion family — routed to ${col.excl.flag}; never a custom field.`
                        : t.startsWith("std:") ? (col.evidence || `mapped to ${t.slice(4)}`)
                        : t.startsWith("cf:") || t.startsWith("new:") ? `→ custom field “${(cfChoices[ms.name] || {})[col.header]?.label}”`
                        : proposalEvidenceText(col.proposal.type, col.proposal.evidence)}
                    </div>
                    {isDraft && (
                      <div data-testid="wb-new-field" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: T.bg, borderRadius: 8, padding: "8px 10px", marginTop: 6 }}>
                        <input value={newFieldDraft.label} onChange={e => setNewFieldDraft(p => ({ ...p, label: e.target.value }))}
                          style={{ border: "1px solid " + T.bg3, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, width: 180 }} />
                        <select value={newFieldDraft.type} onChange={e => setNewFieldDraft(p => ({ ...p, type: e.target.value }))}
                          style={{ border: "1px solid " + T.bg3, borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}>
                          {CF_TYPES.map(tp => <option key={tp} value={tp}>{tp.replace("_", " ")}</option>)}
                        </select>
                        <select value={newFieldDraft.entity} onChange={e => setNewFieldDraft(p => ({ ...p, entity: e.target.value }))}
                          style={{ border: "1px solid " + T.bg3, borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}>
                          <option value="donor">on the donor</option>
                          <option value="gift">on the gift</option>
                        </select>
                        <button onClick={createField} data-testid="wb-create-field"
                          style={{ background: T.green600 || "#1e6b45", color: "#fff", border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                          Create field
                        </button>
                        <span style={{ fontSize: 11, color: T.ink3 }}>{proposalEvidenceText(col.proposal.type, col.proposal.evidence)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
          {btn(building ? "Reading the workbook…" : "Review the import →", buildNow, { disabled: building, testid: "wb-review" })}
          {btn("← Back", () => setStep(signals.length ? "signals" : "sheets"), { secondary: true, disabled: building })}
          {building && <span style={{ fontSize: 12.5, color: T.ink3 }}><Spin /> {progressText}</span>}
        </div>
        {err && <div style={{ color: "#b8593f", fontSize: 12.5, marginTop: 8 }}>{err}</div>}
      </div>
    );
  }

  if (step === "summary" && submission) {
    const s = submission;
    const reasonRows = {};
    for (const r of s.refusals) (reasonRows[r.reason] = reasonRows[r.reason] || []).push(r);
    const REASON_LABEL = {
      no_donor_match: "no donor match — the ID matches nothing on any sheet",
      unreadable_amount: "unreadable amount", unreadable_date: "unreadable date",
      formula_no_value: "formula without a computed value (shown with its formula — never imported as $0)",
      zero_amount: "amount is $0", no_amount: "no amount",
      subtotal_row: "subtotal row", decoy_duplicate: "superseded-copy duplicate",
      gift_id_repeated_in_file: "the same gift id listed twice in the file — imported once",
      hidden_row_skipped_by_choice: "hidden row — skipped by your choice",
      highlighted_row_skipped_by_choice: "highlighted row — skipped by your choice",
      excel_error: "spreadsheet error cell (#N/A, #REF!)", boolean: "TRUE/FALSE in the amount column",
    };
    return (
      <div data-testid="wb-summary">
        <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, marginBottom: 10 }}>One import, fully accounted — before anything is written.</div>

        <div style={{ background: T.bg, borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, lineHeight: 1.7 }}>
            {giftAlone
              ? <><span style={{ color: T.green600 }}>{fmtN((s.giftAloneItems || []).length)}</span> gifts → your existing records</>
              : <><span style={{ color: T.green600 }}>{fmtN(s.totals.donors)}</span> donors</>}
            {s.totals.folded > 0 && <> (after <span title="review list below">{fmtN(s.totals.folded)} duplicate rows fold</span>)</>}
            {" · "}<span style={{ color: T.green600 }}>{fmtN(s.totals.gifts)}</span> gifts, {fmt$(s.totals.cash)}
            {s.pledges.pledges.length > 0 && <> · {fmtN(s.pledges.pledges.length)} pledges as commitments ({fmt$(s.pledges.totalPledged)}, $0 in cash)</>}
            {s.recurring.claims.length > 0 && <> · {fmtN(s.recurring.recovery.length)} failed sustainers to the recovery list · {fmtN(s.recurring.stale.length)} stale “Active” flags</>}
          </div>
          {s.exclusionSummary && s.exclusionSummary.total > 0 && (
            <div style={{ fontSize: 12.5, color: T.ink, marginTop: 6 }}>
              <strong>{fmtN(s.exclusionSummary.total)}</strong> people carry an exclusion (deceased / do-not-contact family) and stay off every ask surface — including {s.exclusionSummary.fromHidden} hidden rows, {s.exclusionSummary.fromFill} highlighted, {s.exclusionSummary.fromComments} from comments.
            </div>
          )}
        </div>

        {linkPreview && (
          <div data-testid="wb-link-preview" style={{ background: T.bg, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12.5, color: T.ink }}>
            <strong>{fmtN(linkPreview.linkable)}</strong> of these gifts link to donors already in Steward — {fmtN(linkPreview.byKey?.donorId || 0)} by Donor ID, {fmtN(linkPreview.byKey?.email || 0)} by email, {fmtN(linkPreview.byKey?.name || 0)} by name. {fmtN(linkPreview.refusedCount)} match nothing and will be refused with their rows — never invented as new donors.
          </div>
        )}
        <SectionHead>Every row, one disposition — per sheet and for the workbook</SectionHead>
        <div style={{ background: T.bg, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12.5, color: T.ink }}>
          {s.reconciliation.perSheet.map(ps => (
            <div key={ps.sheet} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}>
              <span>{ps.sheet}</span>
              <span>{fmtN(ps.rowsInFile)} rows = {fmtN(ps.imported)} imported + {fmtN(ps.refused)} refused + {fmtN(ps.routed)} routed {ps.balanced ? "✓" : "✗ UNBALANCED"}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0 0", fontWeight: 700, borderTop: `1px solid ${T.bg3}`, marginTop: 4 }}>
            <span>Workbook</span>
            <span data-testid="wb-invariant">{fmtN(s.reconciliation.workbook.rowsInFile)} = {fmtN(s.reconciliation.workbook.imported)} + {fmtN(s.reconciliation.workbook.refused)} + {fmtN(s.reconciliation.workbook.routed)} {s.reconciliation.workbook.balanced ? "✓ balanced" : "✗"}</span>
          </div>
        </div>

        <SectionHead>Set aside, by reason — every row has its sheet, row number and reason</SectionHead>
        <div style={{ background: T.bg, borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
          {Object.entries(reasonRows).sort((a, b) => b[1].length - a[1].length).map(([reason, rows]) => (
            <div key={reason} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12.5, color: T.ink, padding: "3px 0" }}>
              <span>{REASON_LABEL[reason] || reason} — <strong>{fmtN(rows.length)}</strong>{rows.some(r => r.dollars) ? ` (${fmt$(rows.reduce((a, r) => a + (r.dollars || 0), 0))})` : ""}</span>
              <button onClick={() => downloadCsv(`refused-${reason}.csv`, rows, ["sheet", "line", "id", "reason", "detail", "dollars", "formula"])}
                style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 7, padding: "3px 10px", fontSize: 11.5, color: T.ink3, cursor: "pointer" }}>Download</button>
            </div>
          ))}
          {s.flags.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12.5, color: T.ink, padding: "3px 0" }}>
              <span>percent-format amounts, read as dollars and flagged (e.g. “{s.flags[0].text}”) — <strong>{fmtN(s.flags.length)}</strong></span>
              <button onClick={() => downloadCsv("flagged-percent-format.csv", s.flags, ["sheet", "line", "kind", "text", "dollars"])}
                style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 7, padding: "3px 10px", fontSize: 11.5, color: T.ink3, cursor: "pointer" }}>Download</button>
            </div>
          )}
          {(s.routed.refunds.length + s.routed.inKind.length + s.routed.pledges.length + s.routed.softCredits.length + s.routed.reversals.length) > 0 && (
            <div style={{ fontSize: 12.5, color: T.ink3, padding: "3px 0" }}>
              Routed to their own surfaces (never dropped): {s.routed.refunds.length ? `${fmtN(s.routed.refunds.length)} refunds/negatives · ` : ""}{s.routed.inKind.length ? `${fmtN(s.routed.inKind.length)} in-kind · ` : ""}{s.routed.pledges.length ? `${fmtN(s.routed.pledges.length)} pledge rows · ` : ""}{s.routed.softCredits.length ? `${fmtN(s.routed.softCredits.length)} soft credits · ` : ""}{s.routed.reversals.length ? `${fmtN(s.routed.reversals.length)} positive reversals (need a human)` : ""}
            </div>
          )}
        </div>

        {s.totalRows.length > 0 && (<>
          <SectionHead>The file's own totals, reconciled</SectionHead>
          <div style={{ background: T.bg, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12.5, color: T.ink }}>
            {s.totalRows.map(tr => {
              const gap = Math.round((tr.stated - tr.readable) * 100) / 100;
              return (
                <div key={tr.sheet} style={{ padding: "3px 0", lineHeight: 1.5 }}>
                  <strong>{tr.sheet}</strong> row {fmtN(tr.line)} says {fmt$(tr.stated)}; the readable cells hold {fmt$(tr.readable)} — the {fmt$(Math.abs(gap))} difference is {tr.refusedCount ? `${fmtN(tr.refusedCount)} refused rows + ` : ""}{fmt$(tr.routedAbs)} routed{Math.abs(gap) > tr.routedAbs + 1 ? " + amounts the sheet itself no longer carries (its cached total is stale)" : ""}.
                </div>
              );
            })}
          </div>
        </>)}

        <SectionHead>Largest gifts about to land</SectionHead>
        <div style={{ background: T.bg, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12.5, color: T.ink }}>
          {s.largestGifts.map((g, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}><span>{g.name}</span><span>{fmt$(g.dollars)} · {g.date}</span></div>)}
        </div>

        {s.merges.length > 0 && (<>
          <SectionHead>Duplicate people folded — review list ({fmtN(s.merges.length)}, undo after import)</SectionHead>
          <div style={{ background: T.bg, borderRadius: 10, padding: "10px 14px", marginBottom: 12, maxHeight: 140, overflowY: "auto" }}>
            {s.merges.slice(0, 300).map((m, i) => <div key={i} style={{ fontSize: 11.5, color: T.ink3, padding: "1px 0" }}><strong style={{ color: T.ink }}>{m.folded}</strong> (id {m.foldedId}) folds into <strong style={{ color: T.ink }}>{m.surviving}</strong> — {m.reason}; gifts posted to either id land on the surviving record.</div>)}
          </div>
        </>)}

        {s.columnNotes.length > 0 && s.columnNotes.map((n, i) => <div key={i} style={{ fontSize: 11.5, color: T.ink3, marginBottom: 8 }}>{n}</div>)}

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
          {btn(building ? "Importing…" : `Import ${fmtN(s.totals.donors)} donors + ${fmtN(s.totals.gifts)} gifts →`, doImport, { disabled: building, testid: "wb-import" })}
          {btn("← Back", () => setStep("mapper"), { secondary: true, disabled: building })}
          {building && <span style={{ fontSize: 12.5, color: T.ink3 }}><Spin /> {progressText}</span>}
        </div>
        <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 8 }}>One transaction: if anything fails mid-way, nothing lands — never a half-imported org.</div>
        {err && <div style={{ color: "#b8593f", fontSize: 12.5, marginTop: 8 }}>{err}</div>}
      </div>
    );
  }

  if (step === "result" && result) {
    return (
      <div data-testid="wb-result">
        <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, marginBottom: 8 }}>
          {result.created != null ? `Imported: ${fmtN(result.created)} donors created, ${fmtN(result.giftsInserted || 0)} gifts recorded.` : "Import finished."}
        </div>
        {elapsed && <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 8 }}>Click to summary: {elapsed}s for the write.</div>}
        {result.semantics && !result.semantics.error && (
          <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 8 }}>
            {fmtN(result.semantics.counts?.pledges || 0)} pledges recorded as commitments · {fmtN(result.semantics.counts?.merges || 0)} merges logged for undo.
          </div>
        )}
        {btn("Done", () => (onImported ? onImported() : onClose()), { testid: "wb-done" })}
      </div>
    );
  }

  return <div style={{ padding: 20 }}><Spin /> Preparing…</div>;
}

export default WorkbookImport;

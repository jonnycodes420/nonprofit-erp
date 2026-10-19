// shared/setupFiles.js · ONBOARD-1. EVERY FILE THEY GAVE, READ AS ONE IMPORT.
//
// Setup is handed a pile of files: a Salesforce Contacts report and its
// Donations report, a DonorPerfect export, a spreadsheet somebody kept. This
// module is NOT a second importer. It treats the pile as the sheets of one
// workbook and hands it to the one submission builder (importShape.js
// buildWorkbookSubmission), which already links gifts to people by id, folds
// duplicates and accounts for every row. What it adds is what a person would
// otherwise answer in the mapper:
//
//   * which system wrote each file (NPSP's own detector, then the vendor
//     presets), said with the columns that gave it away;
//   * the vendor's spellings translated to the builder's own field keys, so a
//     "Close Date" is the date and a "Contact ID" on a gift links it;
//   * Salesforce's stage rule, applied BEFORE the builder: only Closed Won is
//     money that arrived. Every other row is set aside by line with the reason
//     npspGiftDecision gives, so the readout can say what did not come in.
//
// Pure: no DB, no network, no clock, no JSX. Counts and cents are computed
// here and nowhere else.

import {
  parseCsvRecords, analyzeWorkbookSheet, classifyWorkbookSheets, buildWorkbookSubmission, normalizeHeader,
} from "./importShape.js";
import { detectNpsp, npspGiftDecision, NPSP_CONTACT_COLUMNS, NPSP_OPPORTUNITY_COLUMNS, NPSP_OBJECT_OPPORTUNITY } from "./npspPreset.js";
import { detectMigrationPreset, MIGRATION_PRESETS } from "./migrationPresets.js";

const norm = h => normalizeHeader(String(h || ""));

// NPSP's mapper vocabulary → the workbook builder's standard keys.
const NPSP_DONOR_KEYS = { _firstName: "_firstName", _lastName: "_lastName", name: "name", email: "email", phone: "phone",
  address: "address1", city: "city", state: "state", zip: "zip" };
const NPSP_GIFT_KEYS = { externalId: "externalId", amount: "amount", date: "date", donorName: "donorName",
  donorEmail: "donorEmail", paymentMethod: "paymentMethod", notes: "notes" };
// A vendor preset's txMap vocabulary → the builder's gift keys.
const PRESET_GIFT_KEYS = { externalId: "externalId", date: "date", amount: "amount", fund: "fund", campaign: "campaign",
  paymentMethod: "paymentMethod", donorEmail: "donorEmail", donorName: "donorName", type: "type", notes: "notes" };

function claim(headers, spellings) {
  const by = new Map(headers.map(h => [norm(h), h]));
  for (const s of spellings) { const h = by.get(norm(s)); if (h) return h; }
  return null;
}

// The system that wrote one file, and the evidence.
export function detectSourceSystem(headers = []) {
  const np = detectNpsp(headers);
  if (np.isNpsp) return { key: "salesforce", label: "Salesforce", object: np.object, signals: np.signals };
  const mp = detectMigrationPreset(headers);
  if (mp && mp.key) return { key: mp.key, label: (MIGRATION_PRESETS[mp.key] || {}).label || mp.key, object: null, signals: mp.signals || [] };
  return { key: "spreadsheet", label: "a spreadsheet", object: null, signals: [] };
}

// The answers the mapper would have asked for, per sheet.
function overridesFor(sheet, system) {
  const hs = sheet.headers || [];
  const o = {};
  if (system.key === "salesforce" && system.object === NPSP_OBJECT_OPPORTUNITY) {
    for (const [k, std] of Object.entries(NPSP_GIFT_KEYS)) { const h = claim(hs, NPSP_OPPORTUNITY_COLUMNS[k] || []); if (h) o[h] = std; }
    const cid = claim(hs, ["contact id", "contactid", "primary contact id", "npsp__primary_contact__c id"]);
    if (cid) o[cid] = "donorId";
    // A General Accounting Unit is NPSP's fund; the campaign source is the appeal.
    const gau = claim(hs, ["general accounting unit", "gau", "gau name", "npsp__general_accounting_unit__c", "fund", "designation"]);
    if (gau) o[gau] = "fund";
    const camp = claim(hs, ["primary campaign source", "campaign", "campaign name"]);
    if (camp && camp !== gau) o[camp] = "campaign";
    // The stage is a DECISION read below, never a field.
    const st = claim(hs, NPSP_OPPORTUNITY_COLUMNS.stage); if (st) o[st] = "";
  } else if (system.key === "salesforce") {
    for (const [k, std] of Object.entries(NPSP_DONOR_KEYS)) { const h = claim(hs, NPSP_CONTACT_COLUMNS[k] || []); if (h) o[h] = std; }
    const cid = claim(hs, ["contact id", "contactid", "id"]); if (cid) o[cid] = "donorId";
    // Account Name is a household in NPSP; never an organisation by default.
    const acct = claim(hs, ["account name", "account"]); if (acct) o[acct] = "";
  } else if (MIGRATION_PRESETS[system.key]) {
    const cols = MIGRATION_PRESETS[system.key].columns || {};
    for (const [k, spellings] of Object.entries(cols)) {
      const std = PRESET_GIFT_KEYS[k]; if (!std) continue;
      const h = claim(hs, spellings); if (h) o[h] = std;
    }
  }
  return o;
}

// Salesforce's rule, before the builder: one decision per opportunity row.
function applyStageRule(sheet, system) {
  if (!(system.key === "salesforce" && system.object === NPSP_OBJECT_OPPORTUNITY)) return { sheet, setAside: [] };
  const setAside = [], keepIdx = [];
  sheet.rows.forEach((row, i) => {
    const d = npspGiftDecision(row);
    if (d.bucket === "cash") keepIdx.push(i);
    else setAside.push({ file: sheet.name, line: sheet.rowLines[i] || i + 2, reason: d.reason, stage: d.stage,
      cents: Math.round((Number(String(row[claim(sheet.headers, NPSP_OPPORTUNITY_COLUMNS.amount)] || "0").replace(/[$,]/g, "")) || 0) * 100) });
  });
  const pick = arr => keepIdx.map(i => arr[i]);
  return { sheet: { ...sheet, rows: pick(sheet.rows), typedRows: sheet.typedRows ? pick(sheet.typedRows) : sheet.typedRows,
                    rowLines: pick(sheet.rowLines), records: keepIdx.length, rowCount: keepIdx.length }, setAside };
}

// files: [{ name, text }] (CSV text) or [{ name, records }] (rows already read
// from a spreadsheet by the caller). Returns everything the plan, the write
// and the readout need, computed once.
export function readSetupFiles(files = [], { anchorDate, currentYear } = {}) {
  const sheets = [], setAside = [], perFile = [];
  for (const f of files) {
    const records = f.records || parseCsvRecords(String(f.text || ""));
    if (!records.length) { perFile.push({ name: f.name, system: null, rows: 0, role: "empty" }); continue; }
    const a = analyzeWorkbookSheet(records);
    const system = detectSourceSystem(a.headers);
    const base = { name: f.name, ...a, rowCount: a.records };
    const staged = applyStageRule(base, system);
    setAside.push(...staged.setAside);
    sheets.push({ sheet: staged.sheet, system });
  }
  const roled = classifyWorkbookSheets(sheets.map(s => s.sheet));
  const mappingOverrides = {};
  for (const s of sheets) mappingOverrides[s.sheet.name] = overridesFor(s.sheet, s.system);
  const sub = buildWorkbookSubmission(roled, { anchorDate, currentYear, mappingOverrides });
  for (const s of sheets) {
    const r = roled.find(x => x.name === s.sheet.name) || {};
    perFile.push({ name: s.sheet.name, system: s.system, role: r.role || null, evidence: r.evidence || "",
      rows: s.sheet.rowCount + setAside.filter(x => x.file === s.sheet.name).length });
  }
  const giftCents = sub.gifts.reduce((n, g) => n + Math.round(Number(g.amount || 0) * 100), 0);
  // Funds the gifts name, ordered by dollars, computed here once.
  const fundCents = new Map();
  for (const g of sub.gifts) { const k = String(g.fund || "").trim(); if (k) fundCents.set(k, (fundCents.get(k) || 0) + Math.round(Number(g.amount) * 100)); }
  const funds = [...fundCents.entries()].sort((a, b) => b[1] - a[1]).map(([name, cents]) => ({ name, cents }));
  const campaigns = [...new Set(sub.gifts.map(g => String(g.campaign || "").trim()).filter(Boolean))];
  const methods = [...new Set(sub.gifts.map(g => String(g.paymentMethod || "").trim()).filter(Boolean))];
  const systems = [...new Set(perFile.filter(p => p.system).map(p => p.system.label))];
  const hasDonorSheet = roled.some(r => r.role === "donors");
  return {
    perFile, systems, setAside, funds, campaigns, methods,
    donors: sub.donors, gifts: sub.gifts, merges: sub.merges, pledges: sub.pledges,
    refusals: sub.refusals, reconciliation: sub.reconciliation, totals: sub.totals,
    giftCents, giftAlone: !hasDonorSheet && sub.gifts.length === 0 && (sub.giftAloneItems || []).length > 0,
    giftAloneCount: (sub.giftAloneItems || []).length,
    headers: [...new Set(sheets.flatMap(s => s.sheet.headers || []))],
  };
}

// The payment tools a file's own payment-method column names, as connection keys.
export function toolsFromMethods(methods = []) {
  const out = new Set();
  for (const m of methods.map(x => String(x).toLowerCase())) {
    if (/paypal/.test(m)) out.add("paypal");
    if (/zeffy/.test(m)) out.add("zeffy");
    if (/givebutter/.test(m)) out.add("givebutter");
    if (/square/.test(m)) out.add("square");
    if (/stripe|credit|card|visa|mastercard|amex/.test(m)) out.add("stripe");
    if (/check|cheque/.test(m)) out.add("checks");
  }
  return [...out];
}

export default { readSetupFiles, detectSourceSystem, toolsFromMethods };

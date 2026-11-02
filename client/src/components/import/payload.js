import { validateMappingChoice, stageAssignmentBasis, resolveDonorIdentity, NAMEABILITY_REASON, normalizeName, normalizeEmail, normalizeMoney, normalizeDate, parseBoolFlag, localCivilToday, buildTransactionRows, YEAR_HDR_PAT, autoDetectTxMapping, buildGiftItemsFromLedger, classifyColumns, linkGiftsToDonors } from "../../../../shared/importShape";
import { normalizeStage, inferStage } from "../donorShared";
import { typeSuggestionForTags, rowIsUnsubscribed } from "../../../../shared/mailchimpPreset.js";
import { coerceCustomValue, parseBoolValue, parseExclusionValue } from "../../../../shared/customFieldShape";
import { buildMoveFileFacts } from "../../../../shared/movePlan";
import { MEMBERSHIP_FIELDS } from "../../../../shared/membershipImport.js";
import { apiFetch } from "../../api";
import { guessField } from "./fields";

// ── Module-level column auto-mapper ──────────────────────────────────────
// Extracted from DonorImport so CombinedImport can reuse it.
export function buildAutoMapping(headers, rows = []) {
  const guesses = headers.map(h => ({ h, g: guessField(h) }));
  const hasSingleName = guesses.some(x => x.g === "name");
  const auto = {};
  // FIX (2026-09-09) item 3 — a guess that duplicates a target another column
  // already took is DROPPED, not made. Two columns cannot become one field, and
  // an automatic mapping is the last place that should be discovered: the
  // 30-column export put contact_name and contact_confidence on `name` and the
  // second silently won. First header wins; the rest are left for a human.
  const taken = new Set();
  guesses.forEach(({ h, g }) => {
    if (!g) return;
    if (hasSingleName && (g === "_firstName" || g === "_lastName")) return;
    if (taken.has(g)) return;
    // BUILD-79 Part 5 — every guess passes its own type check over the FULL
    // values (a 10-row sample once let phone-shaped columns map to email).
    if (!validateMappingChoice(headers, rows, h, g).ok) return;
    auto[h] = g;
    taken.add(g);
  });
  return auto;
}

// ── Module-level donor row normalization ──────────────────────────────────
// Extracted from DonorImport's built useMemo so CombinedImport can share it.
// BUILD-94 Part 2 — `people` carries the Mailchimp preset's answers:
//   { fileStatus, statusHeader, tagsHeader, applyTagTypes, defaultType }
// Absent (every other file) ⇒ every row is a Donor and reachable, which is
// byte-identical to what this function did before the argument existed.
// Cents, to two places. Declared here because the donor-row builder below is
// the first thing in this file that needs it, and the TDZ rule says a const
// goes above every line that reads it.
export const round2Donor = n => Math.round((Number(n) || 0) * 100) / 100;

export function buildDonorRows(parsed, mapping, rowLines, basis, people) {
  if (!parsed) return { ready:[], warned:[], skipped:[] };
  // BUILD-84 P0-3 — a stage may only be inferred from an input this import
  // actually has. With no amount and no date mapped there is nothing to infer
  // from, and everyone lands in ONE stage rather than a fabricated split.
  const stageBasis = basis || stageAssignmentBasis({
    total: Object.values(mapping).includes("total"),
    lastAmount: Object.values(mapping).includes("lastAmount"),
    lastGift: Object.values(mapping).includes("lastGift"),
  });
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
    // BUILD-84 P0-2 — nameability is decided by ONE function (shared with the
    // transaction path and the workbook): a person name, an email, OR an
    // organization. An organization row is a first-class donor, and a contact
    // person on the same row rides as the contact, not as the donor's name.
    const ident = resolveDonorIdentity({ name: d.name, organization: d.organization, email: d.email });
    delete d.organization;
    if (!ident.nameable) { skipped.push({ row:idx+2, reason: NAMEABILITY_REASON }); return; }
    if (!ident.hasName) {
      // BUILD-79 Part 5 — a display name never falls back to email/phone.
      d.name = `Unnamed donor (line ${rowLines?.[idx] ?? idx + 2})`;
      d.tags = ["needs-name"];
      warnings.push(`${rowLabel}: no name, flagged as unnamed for review`);
    } else {
      d.name = normalizeName(ident.displayName); // B2 — tidy Last,First / ALL-CAPS in the preview (editable)
      if (ident.contactName) d.contactName = normalizeName(ident.contactName);
      if (ident.kind && ident.kind !== "person") d.kind = ident.kind;
      else d.kind = "person";
    }
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
    // Initial pipeline stage: an explicit stage column always wins; otherwise
    // infer from giving history (this donor-only flow's history IS the aggregate
    // total/last-gift columns). `_stageExplicit` tells the server not to
    // re-infer over it in the combined/history import paths.
    const _explicitStage = normalizeStage(d.stage);
    d.stage = _explicitStage
      || (stageBasis.hasGivingData
            ? inferStage(d.total, d.lastGift, !!(d.email || d.phone))
            : stageBasis.fallbackStage);
    d._stageExplicit = !!_explicitStage;
    if (d.city)  d.city  = String(d.city).trim()  || null;
    if (d.state) d.state = String(d.state).trim()  || null;
    if (d.deceased !== undefined) d.deceased = parseBoolFlag(d.deceased);
    if (d.doNotContact !== undefined) d.doNotContact = parseBoolFlag(d.doNotContact);
    // BUILD-94 Part 2 — what this person is, and whether they are reachable.
    if (people) {
      const sug = people.applyTagTypes && people.tagsHeader
        ? typeSuggestionForTags(row[people.tagsHeader]) : null;
      d.personTypes = [sug || people.defaultType || "other"];
      // AN UNSUBSCRIBED CONTACT IMPORTS AS UNSUBSCRIBED. Never as reachable.
      if (rowIsUnsubscribed(row, { fileStatus: people.fileStatus, statusHeader: people.statusHeader })) {
        d.unsubscribed = true;
      }
    }
    if (warnings.length) warned.push({ ...d, _warnings:warnings, _rowIndex:idx+2 });
    else ready.push(d);
  });
  return { ready, warned, skipped };
}

// ── Combined-row builder (donor + year-column gifts in one pass) ──────────
// Used only by CombinedImport. Preserves rowIdx so gift attachments are exact.
export function buildCombinedRows(parsed, donorMapping, yearCols, rowLines) {
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
    // BUILD-84 P0-2 — same one nameability test as the aggregate path.
    const ident = resolveDonorIdentity({ name: d.name, organization: d.organization, email: d.email });
    delete d.organization;
    if (!ident.nameable) { results.push({ rowIdx:idx, donor:null, gifts:[], warnings:[], skipped:true, skipReason: NAMEABILITY_REASON }); return; }
    if (!ident.hasName) { d.name = `Unnamed donor (line ${rowLines?.[idx] ?? idx + 2})`; d.tags = ["needs-name"]; warnings.push(`${rowLabel}: no name, flagged as unnamed for review`); }
    else {
      d.name = normalizeName(ident.displayName); // B2 — tidy Last,First / ALL-CAPS in the preview (editable)
      if (ident.contactName) d.contactName = normalizeName(ident.contactName);
      d.kind = ident.kind && ident.kind !== "person" ? ident.kind : "person";
    }
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
    if (d.city)  d.city  = String(d.city).trim()  || null;
    if (d.state) d.state = String(d.state).trim()  || null;
    if (d.deceased !== undefined) d.deceased = parseBoolFlag(d.deceased);
    if (d.doNotContact !== undefined) d.doNotContact = parseBoolFlag(d.doNotContact);
    // Derive the year-column gifts BEFORE inferring stage, so stage reflects the
    // real giving history (sum + latest gift date) — not the mapped total/
    // last-gift columns, which a wide year-column file usually doesn't have.
    // The server re-infers from the recalculated gift rows on import too; doing
    // it here keeps the preview honest and matching what actually gets saved.
    const gifts = activeCols.map(yc => {
      const {value:amtVal} = normalizeMoney(row[yc.col]);
      // FIX-11 Part 4 — THE THIRD ROUNDING SITE, found by widening the guard
      // that caught the other two. This is the year-column branch of the
      // RECOMMENDED "Import + History" path, so the import Steward pushes
      // hardest was also turning $250.50 into $251.00.
      const amt = round2Donor(amtVal);
      return amt > 0 ? { amount:amt, date:yc.date, type:"cash", campaign:"" } : null;
    }).filter(Boolean);
    const _giftTotal = gifts.reduce((s,g) => s + g.amount, 0);
    // Gift dates are ISO YYYY-MM-DD, so lexicographic max === chronological max.
    const _lastGiftDate = gifts.length ? gifts.reduce((m,g) => g.date > m ? g.date : m, gifts[0].date) : null;
    const _explicitStage = normalizeStage(d.stage);
    d.stage = _explicitStage || inferStage(_giftTotal || d.total, _lastGiftDate || d.lastGift, !!(d.email || d.phone));
    d._stageExplicit = !!_explicitStage;
    results.push({ rowIdx:idx, donor:d, gifts, warnings, skipped:false });
  });
  return results;
}

// FIX (2026-09-10) — the ORG's civil today, for the import's future-date test.
// BUILD-72's rule is that every date boundary is computed in the ORGANIZATION's
// timezone: not the server's, not the browser's, and above all not UTC. Intl is
// the only correct way to ask what day it is somewhere (it knows the offset for
// this instant, DST and half-hour zones included). Falls back to the browser's
// own calendar when the org has no zone on file — still right far more often
// than UTC, which is a different day for a third of every day in the Americas.
export function orgCivilToday(timezone) {
  try {
    if (timezone) return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch { /* an invalid zone falls through to the local calendar */ }
  return localCivilToday();
}

// ── Shape-aware payload builders ───────────────────────────────────────────
// All three return a common { donors, gifts, warnedCount, skippedCount }.
// `gifts` carry a `donorIndex` into `donors` — the exact { donors, gifts } shape
// /donors/import-combined consumes (server dedupes, attaches, recalcs, re-infers
// stage). This is what makes one uploaded file → donors + their giving history.

// AGGREGATE: one row per donor. `seedHistory` derives one real gift from the
// imported total + last-gift date so a brand-new org gets queryable gifts rows
// (not just aggregate donor fields) — same rationale as DonorImport's old
// `withHistory` flag, now the default for the magical one-file path.
export function buildAggregatePayload(parsed, mapping, seedHistory, rowLines, stageBasis, people) {
  const { ready, warned, skipped } = buildDonorRows(parsed, mapping, rowLines, stageBasis, people);
  const donors = [...ready, ...warned].map(({ _warnings, _rowIndex, ...d }) => d);
  const gifts = [];
  if (seedHistory) {
    donors.forEach((d, idx) => {
      const amount = Math.round(parseFloat(d.total) || 0);
      if (amount > 0 && d.lastGift) gifts.push({ donorIndex: idx, amount, date: d.lastGift, type: "cash", campaign: "" });
    });
  }
  // BUILD-79 Part 3.4 — "N imported with warnings" with no warning visible is a
  // number, not information. The warnings ride out with their row index (the
  // caller maps index → physical line via the parse report) and download as CSV.
  const warnedRows = warned.map(w => ({ idx: (w._rowIndex ?? 2) - 2, reasons: w._warnings || [] }));
  const skippedRows = skipped.map(k => ({ idx: (k.row ?? 2) - 2, reason: k.reason }));
  return { donors, gifts, warnedCount: warned.length, skippedCount: skipped.length, warnedRows, skippedRows };
}

// TRANSACTION: one row per GIFT, donor repeated. Delegates to importShape's
// buildTransactionRows — the ONE accounted builder (BUILD-77 Parts 2+3):
// every physical row leaves with a disposition, no date ever defaults to
// today, refunds import as negative gifts, and the file-level counts are
// taken at parse entry and carried through unchanged.
export function buildTransactionPayload(parsed, txMap, cfInputs, rowLines, dateConvention, today) {
  if (!parsed) return { donors: [], gifts: [], warnedCount: 0, skippedCount: 0, dispositions: [], flaggedRows: [], file: { rows: 0, dollars: 0, imported: 0, donorOnly: 0, skipped: 0, errored: 0 } };
  const built = buildTransactionRows(parsed, txMap, {
    rowLines,
    // The ORG's calendar decides what "future-dated" means — see orgCivilToday.
    today,
    // BUILD-80 Part 2.2 — a human's answer to a mixed-convention date column;
    // otherwise the builder infers from the column's own evidence.
    dateConvention: dateConvention || undefined,
    // BUILD-78 — exclusion-shaped columns route to the flag family; custom
    // columns coerce per type and a failed value refuses the row pre-write.
    flagColumns: cfInputs ? cfInputs.flagColumns : {},
    cfColumns: cfInputs ? cfInputs.cfColumns : [],
    exclusionColumns: cfInputs ? (cfInputs.exclusionColumns || []) : [],
    coerceCustomValue, parseBoolValue, parseExclusionValue,
  });
  return { ...built,
    warnedCount: 0,
    skippedCount: built.file.skipped + built.file.errored };
}

// WIDE: one row per donor, year columns → one gift per funded year.
export function buildWidePayload(parsed, donorMapping, yearCols, rowLines) {
  const rows = buildCombinedRows(parsed, donorMapping, yearCols, rowLines);
  const valid = rows.filter(r => !r.skipped);
  const donors = valid.map(({ donor }) => { const { _warnings, _rowIndex, ...d } = donor; return d; });
  const gifts = [];
  valid.forEach(({ gifts: rg }, idx) => rg.forEach(g => gifts.push({ ...g, donorIndex: idx })));
  return { donors, gifts, warnedCount: valid.filter(r => r.warnings.length).length, skippedCount: rows.filter(r => r.skipped).length };
}

// Chunked submit with progress — the other half of the hang fix. Donors are
// sent 500 at a time so each request returns fast (real progress, and no single
// request long enough to hit a platform timeout). Each chunk is self-contained:
// its gifts are re-indexed to the chunk's local donor positions. Cross-chunk
// email dedup is handled server-side (chunk N sees chunk N-1's committed rows).
// TRANS-1 Part 3 — the FILE's own figures, built from the rows this import
// submitted. Stored on the run and never recomputed later: by the time anyone
// opens the Move Report the file is gone, and a figure rebuilt from the rows
// it produced is not evidence about the file.
export function moveFileFactsFrom(donors, gifts) {
  try {
    const rows = (gifts || []).map(g => {
      const d = donors[g.donorIndex] || {};
      return {
        donorKey: String(d.externalDonorId || d.email || d.name || "").toLowerCase(),
        donorName: d.name || "",
        amountCents: Math.round(Number(g.amount || 0) * 100),
        year: Number(String(g.date || "").slice(0, 4)) || null,
        recurring: d.importedSustainer === true,
        householdKey: d.householdId || "",
      };
    });
    return buildMoveFileFacts(rows);
  } catch (e) { console.error("[move] could not build the file's own figures:", e); return null; }
}

export async function submitImportChunked(donorsIn, gifts, onProgress, extras, runId, opts = {}) {
  let donors = donorsIn;
  const CHUNK = 500;
  // BUILD-99 Part 6 — the open asks ride the same chunked submit and are
  // RE-INDEXED to each chunk's local donor positions exactly as the gifts are.
  // A proposal whose donorIndex still pointed at the whole file's numbering would
  // land on whoever happened to sit at that position in chunk two.
  const proposals = (extras && Array.isArray(extras.proposals)) ? extras.proposals : [];
  const hasGifts = gifts.length > 0;
  // BUILD-101 Part 6 — memberships ride the LAST chunk, when every person in
  // the file already exists to put them on. The membership columns never
  // reach a donor row.
  const memberships = (extras && Array.isArray(extras.memberships)) ? extras.memberships : [];
  donors = donors.map(d => { const o = { ...d }; for (const f of MEMBERSHIP_FIELDS) delete o[f]; return o; });
  const giftsByDonor = new Map();
  for (const g of gifts) {
    if (!giftsByDonor.has(g.donorIndex)) giftsByDonor.set(g.donorIndex, []);
    giftsByDonor.get(g.donorIndex).push(g);
  }
  const propsByDonor = new Map();
  for (const p of proposals) {
    if (p.donorIndex == null) continue;
    if (!propsByDonor.has(p.donorIndex)) propsByDonor.set(p.donorIndex, []);
    propsByDonor.get(p.donorIndex).push(p);
  }
  const totals = { created: 0, giftsInserted: 0, duplicates: 0, duplicatesOnFile: 0, duplicatesInFile: 0, donorsUpdated: 0, financeSynced: 0, batchErrors: [], twinCandidates: 0,
    // BUILD-72 Part 1 — the file-level reconciliation, summed across chunks.
    // The server asserts it per request; this is what the user is shown.
    donorsMatched: 0, matchesExistingCount: 0, roundingAdjustment: 0, fundsCreated: 0,
    reconciliation: { rows: { inFile: 0, created: 0, skipped: 0, errored: 0 },
                      dollars: { inFile: 0, created: 0, skipped: 0, errored: 0 },
                      skippedReasons: {}, erroredReasons: {}, balanced: true },
    // BUILD-99 Part 6 — the open asks, counted like everything else so the
    // receipt can say what became of them.
    proposals: { written: 0, skippedDuplicate: 0, stageDefaulted: 0, probabilityDropped: 0, unresolved: [] },
    // BUILD-101 Part 6 — what became of every membership row: written, already
    // on file, or held with its line and reason (the file's own set-asides first).
    memberships: { rows: memberships.length + ((extras && extras.membershipsSetAside) || []).length, written: 0, skippedDuplicate: 0,
                   held: [...((extras && extras.membershipsSetAside) || [])] },
    duplicateGroups: [] };
  const total = donors.length;
  if (!total) return totals;
  for (let start = 0; start < total; start += CHUNK) {
    const slice = donors.slice(start, start + CHUNK);
    let res;
    const chunkProposals = [];
    slice.forEach((_, localIdx) => {
      const pp = propsByDonor.get(start + localIdx);
      if (pp) pp.forEach(p => { const { donorIndex, ...rest } = p; chunkProposals.push({ ...rest, donorIndex: localIdx }); });
    });
    const isLast = start + CHUNK >= total;
    const chunkMemberships = isLast ? memberships : [];
    if (hasGifts || chunkProposals.length || chunkMemberships.length) {
      const chunkGifts = [];
      slice.forEach((_, localIdx) => {
        const gg = giftsByDonor.get(start + localIdx);
        if (gg) gg.forEach(g => { const { donorIndex, ...rest } = g; chunkGifts.push({ ...rest, donorIndex: localIdx }); });
      });
      res = await apiFetch("/donors/import-combined", { method: "POST", body: JSON.stringify({ donors: slice, gifts: chunkGifts,
        ...(runId ? { importId: runId } : {}),
        // NUMBERS-2: the file's name labels a total it states (kept as its own figure).
        ...(opts.sourceName ? { sourceName: opts.sourceName } : {}),
        // FIX-37: the thank-you answer and the headers it was decided from.
        ...(opts.thanks ? { thanks: opts.thanks } : {}),
        ...(opts.headers && opts.headers.length ? { headers: opts.headers } : {}),
        ...(chunkProposals.length ? { proposals: chunkProposals } : {}),
        ...(chunkMemberships.length ? { memberships: chunkMemberships } : {}),
        // BUILD-78 — the column ledger + saved mappings ride every chunk
        // (idempotent server-side); the ledger is validated per request.
        ...(extras ? { columns: extras.columns, fieldMappings: extras.fieldMappings, customFieldDelimiters: extras.customFieldDelimiters,
                       identityResolved: extras.identityResolved === true } : {}) }) });
    } else {
      res = await apiFetch("/donors/import", { method: "POST", body: JSON.stringify({ donors: slice, ...(opts.sourceName ? { sourceName: opts.sourceName } : {}) }) });
    }
    totals.created       += res.created       || 0;
    totals.giftsInserted += res.giftsInserted || 0;
    totals.duplicates    += res.duplicates    || 0;
    totals.duplicatesOnFile += res.duplicatesOnFile || 0;
    totals.duplicatesInFile += res.duplicatesInFile || 0;
    totals.twinCandidates += (res.duplicateCandidates && res.duplicateCandidates.withinFile) || 0;
    totals.donorsUpdated += res.donorsUpdated || 0;
    totals.financeSynced += res.financeSynced || 0;
    totals.donorsMatched += res.donorsMatched || 0;
    totals.externalIdDupes = (totals.externalIdDupes || 0) + (res.externalIdDupes || 0);
    totals.matchedByExternalId = (totals.matchedByExternalId || 0) + (res.matchedByExternalId || 0);
    totals.matchesExistingCount += res.matchesExistingCount || 0;
    totals.roundingAdjustment += res.roundingAdjustment || 0;
    totals.fundsCreated  += res.fundsCreated  || 0;   // BUILD-88a A.7
    if (res.proposals) {                              // BUILD-99 Part 6
      totals.proposals.written += res.proposals.written || 0;
      totals.proposals.skippedDuplicate += res.proposals.skippedDuplicate || 0;
      totals.proposals.stageDefaulted += res.proposals.stageDefaulted || 0;
      totals.proposals.probabilityDropped += res.proposals.probabilityDropped || 0;
      if (res.proposals.unresolved?.length) totals.proposals.unresolved.push(...res.proposals.unresolved);
    }
    if (res.memberships) {                            // BUILD-101 Part 6
      totals.memberships.written += res.memberships.written || 0;
      totals.memberships.skippedDuplicate += res.memberships.skippedDuplicate || 0;
      if (res.memberships.held?.length) totals.memberships.held.push(...res.memberships.held);
      if (res.memberships.error) totals.memberships.held.push({ line: null, why: "the memberships could not be written: " + res.memberships.error });
    }
    if (res.duplicateGroups?.length) totals.duplicateGroups.push(...res.duplicateGroups);
    // Sum the per-request equations into one file-level equation. If ANY chunk
    // failed to balance the whole file is reported unbalanced — a file is only
    // reconciled if every part of it was.
    const rr = res.reconciliation;
    if (rr) {
      for (const axis of ["rows", "dollars"])
        for (const k of ["inFile", "created", "skipped", "errored"])
          totals.reconciliation[axis][k] += rr[axis][k] || 0;
      for (const [reason, v] of Object.entries(rr.skippedReasons || {})) {
        const e = totals.reconciliation.skippedReasons[reason] || (totals.reconciliation.skippedReasons[reason] = { rows: 0, dollars: 0 });
        e.rows += v.rows; e.dollars += v.dollars;
      }
      for (const [reason, v] of Object.entries(rr.erroredReasons || {})) {
        const e = totals.reconciliation.erroredReasons[reason] || (totals.reconciliation.erroredReasons[reason] = { rows: 0, dollars: 0 });
        e.rows += v.rows; e.dollars += v.dollars;
      }
      if (rr.balanced === false) totals.reconciliation.balanced = false;
    }
    if (res.batchErrors?.length) totals.batchErrors.push(...res.batchErrors);
    if (onProgress) onProgress(Math.min(start + CHUNK, total), total);
  }
  return totals;
}

// ── "Import both" payload builder ──────────────────────────────────────────
// A multi-sheet workbook that carries a Donors sheet AND a Gift History sheet:
// build donor rows from the donor sheet, one gift item per gift-ledger row, then
// link the gifts to the donors by the chosen match column (email/name/donor-id).
// Returns the common { donors, gifts:[{donorIndex}] } shape the chunked submit +
// /donors/import-combined already consume, plus the counts the preview shows.
export function buildBothPayload(donorSheet, giftSheet, matchInfo, matchKey) {
  // Donor rows from the donor sheet. Year columns (if any) stay out of the donor
  // grid; the real history comes from the gift sheet, so we do NOT seed history
  // from the donor sheet's totals here (that would double-count).
  const donorHeaders = (donorSheet.headers || []).filter(h => !YEAR_HDR_PAT.test(String(h)));
  const donorMapping = buildAutoMapping(donorHeaders, donorSheet.rows);
  if (matchInfo.donorIdCol) donorMapping[matchInfo.donorIdCol] = "_donorId";
  const { ready, warned, skipped } = buildDonorRows({ headers: donorSheet.headers, rows: donorSheet.rows }, donorMapping);
  // Keep _stageExplicit (server honors it) + _donorId (linkGiftsToDonors strips it).
  const donors = [...ready, ...warned].map(({ _warnings, _rowIndex, ...d }) => d);

  // One gift item per gift-ledger row — through the ONE accounted builder
  // (BUILD-58 Part 2): externalId rides each gift (the F-4 idempotency key
  // this surface used to DROP), and every skipped row gets a stated reason.
  const tx = autoDetectTxMapping(giftSheet.headers, giftSheet.rows);
  const idCol = matchInfo.giftIdCol;
  const { items, report } = buildGiftItemsFromLedger(giftSheet.rows || [], tx, idCol);

  // Column accounting for BOTH sheets (the class fix): mapped / deliberately
  // ignored (year columns — history comes from the gift sheet) / unrecognized.
  const yearIgnored = (donorSheet.headers || []).filter(h => YEAR_HDR_PAT.test(String(h)));
  const donorColumns = classifyColumns(donorSheet.headers || [], donorMapping, yearIgnored);
  const giftMapping = {};
  Object.entries(tx).forEach(([role, h]) => { if (h) giftMapping[h] = role; });
  if (idCol) giftMapping[idCol] = giftMapping[idCol] || "donor id (match key)";
  const giftColumns = classifyColumns(giftSheet.headers || [], giftMapping, []);

  const linked = linkGiftsToDonors(donors, items, matchKey);
  return {
    ...linked,                                   // donors, gifts, matchedGifts, unmatchedGifts, newDonors, skippedGifts
    donorSheetRows: donors.length,               // donors that came from the donor sheet
    donorWarned: warned.length,
    donorSkipped: skipped.length,
    giftRows: (giftSheet.rows || []).length,
    rowReport: report,                           // negative/unparsable/zero rows, by count + reason
    columnReports: { donorSheet: donorColumns, giftSheet: giftColumns },
  };
}

// LIVE-1 · the payment methods a file can name that need no explaining.
export const STANDARD_METHODS = new Set(["cash", "check", "cheque", "credit card", "card", "debit card", "ach", "bank transfer", "eft",
  "wire", "wire transfer", "stock", "securities", "daf", "donor advised fund", "paypal", "venmo", "zelle", "apple pay",
  "google pay", "online", "in kind", "money order", "crypto", "other", "visa", "mastercard", "amex", "american express", "discover"]);

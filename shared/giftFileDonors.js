// shared/giftFileDonors.js · FIX-11 Part 4, shared by FIX-43.
//
// THE PEOPLE A GIFT FILE WOULD CREATE. A file with one gift per row and the
// donor's name (and maybe email) on each row, with no separate people file.
// The Import screen (DonorImport.jsx, GiftHistoryImport) and setup's gifts-only
// file (shared/setupFiles.js) both turn it into people with this one grouping,
// so the two can never disagree about who a row is.
//
// ONE person per identity: by email where there is one (lower-cased, because
// Ada@x and ada@x are one person), otherwise by exact normalised name. Two
// gifts from the same new donor create ONE donor. It returns the shapes the
// combined import (`/donors/import-combined`) takes: there is no second import
// path, and this adds no third.
//
// Pure: no DB, no network, no clock, no JSX.

// "Lovelace, Ada" and "ada  lovelace" are one name.
export function normalizeNameForDonorMatch(name) {
  if (!name) return "";
  let s = String(name).trim().toLowerCase().replace(/\s+/g, " ");
  const ci = s.indexOf(",");
  if (ci > 0) s = `${s.slice(ci+1).trim()} ${s.slice(0,ci).trim()}`;
  return s;
}

// unmatched: [{ rawName, rawEmail, amount, date, type, campaign, notes, externalId, ... }]
// `keep` names extra gift fields a caller's rows carry and wants kept. A
// mapped payment method is always kept (FIX-44: the Import screen passed
// nothing, so a file with no people file lost the column setup kept); setup
// also keeps the fund its file mapped.
export const ALWAYS_KEEP = ["paymentMethod"];
export function donorsFromUnmatchedGifts(unmatched, { keep = [] } = {}) {
  keep = [...new Set([...ALWAYS_KEEP, ...keep])];
  const byKey = new Map();
  const donors = [];
  const gifts = [];
  for (const g of unmatched) {
    const email = String(g.rawEmail || "").toLowerCase().trim();
    const name = String(g.rawName || "").trim();
    // An identity with neither is not a person and cannot be created. It stays
    // out, counted, rather than becoming a donor called "".
    if (!email && !name) continue;
    const key = email && email.includes("@") ? "e:" + email : "n:" + normalizeNameForDonorMatch(name);
    if (!byKey.has(key)) {
      byKey.set(key, donors.length);
      donors.push({
        name: name || email,
        email: email && email.includes("@") ? email : "",
        // Everything else a donor row can carry is deliberately absent: a gift
        // file knows a name, an address and an amount, and inventing a stage
        // or a status from it would be making something up.
      });
    }
    const extra = {};
    for (const k of keep) if (g[k] != null && g[k] !== "") extra[k] = g[k];
    gifts.push({
      donorIndex: byKey.get(key),
      amount: g.amount, date: g.date,
      type: g.type || "cash", campaign: g.campaign || "", notes: g.notes || "",
      externalId: g.externalId || undefined,
      ...extra,
    });
  }
  return {
    donors, gifts,
    nameless: unmatched.filter(g => !String(g.rawEmail || "").trim() && !String(g.rawName || "").trim()).length,
    dollars: Math.round(gifts.reduce((s, g) => s + (Number(g.amount) || 0), 0) * 100) / 100,
  };
}

export default { normalizeNameForDonorMatch, donorsFromUnmatchedGifts, ALWAYS_KEEP };

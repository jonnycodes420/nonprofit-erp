// shared/addressSplit.js: IMPORT-5 (7a). A whole address in one column
// ("1815 Juniper Way, Lexington Kentucky 40502") is split into street, unit,
// city, state and ZIP, with or without a comma before the state, and with the
// state as a code or its full name. It splits only when it is sure: a street
// that starts with a number (or a PO Box), a city, and a state Steward knows.
// Anything else stays whole and is marked "Check this address". The second
// half (contactNoteFlags) reads a person's notes for contact info marked bad.
// Pure: no I/O, imported by shared/sheetRead.js.

const STATES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};
const CODES = new Set(Object.values(STATES));
const ZIP_END = /^(\d{5})(?:-(\d{4}))?$/;
const UNIT_RE = /^(suite|ste\.?|apt\.?|apartment|unit|#\s*\w+|bldg\.?|building|floor|fl\.?|room|rm\.?|lot|trlr|trailer|dept\.?)(\s|$|#|\d)/i;
const STREET_START = /^(\d+[a-z]?(?:-\d+)?\s+\S|p\.?\s*o\.?\s*box\s+\d|po\s+box\s+\d|rr\s*\d|hc\s*\d|box\s+\d)/i;

const tidy = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

// "Lexington Kentucky 40502" / "Lexington, KY" / "KY 40502" / "New York NY":
// the state and ZIP off the end of a run of words, and what is left before.
function tailOf(words) {
  let zip = null;
  const w = [...words];
  if (w.length && ZIP_END.test(w[w.length - 1])) zip = w.pop();
  // the longest state name that ends the run (three words, then two, then one)
  for (let k = Math.min(3, w.length); k >= 1; k--) {
    const cand = w.slice(w.length - k).join(" ").replace(/\.$/, "");
    const code = STATES[cand.toLowerCase()] || (k === 1 && CODES.has(cand.toUpperCase()) && cand.length === 2 ? cand.toUpperCase() : null);
    if (code) return { state: code, zip, before: w.slice(0, w.length - k) };
  }
  return { state: null, zip, before: w };
}

// → { split: true, address, address2, city, state, zip } when sure;
//   { split: false, check: true } when it looks like a whole address and is not;
//   { split: false, check: false } when it is just a street (nothing to split).
export function splitAddress(raw) {
  const text = tidy(raw);
  if (!text) return { split: false, check: false };
  const parts = text.split(/\s*,\s*/).filter(Boolean);
  const hasZip = /\b\d{5}(-\d{4})?$/.test(text);
  // one piece with no ZIP: a street on its own, which is what a street column holds
  if (parts.length === 1 && !hasZip) return { split: false, check: false };
  const not = { split: false, check: true };
  if (parts.length < 2 || !STREET_START.test(parts[0])) return not;
  const street = parts[0];
  const units = [];
  let i = 1;
  while (i < parts.length - 1 && UNIT_RE.test(parts[i])) units.push(parts[i++]);
  const rest = parts.slice(i);
  // "City State ZIP" in one piece, or "City" then "State ZIP" (a trailing "USA" goes)
  if (rest.length > 1 && /^(usa|us|united states( of america)?)$/i.test(rest[rest.length - 1])) rest.pop();
  let city = null, state = null, zip = null;
  if (rest.length === 1) {
    const t = tailOf(rest[0].split(" "));
    if (!t.state || !t.before.length) return not;
    ({ state, zip } = t); city = t.before.join(" ");
  } else if (rest.length === 2) {
    const t = tailOf(rest[1].split(" "));
    if (!t.state || t.before.length) return not;
    ({ state, zip } = t); city = rest[0];
  } else return not;
  if (!/^[A-Za-z][A-Za-z .'-]*$/.test(city)) return not;
  return { split: true, address: street, address2: units.join(", ") || null, city, state, zip: zip || null };
}

// IMPORT-5 (7d). Notes that say the phone or the address is bad. The words
// are kept on the person as written; these only set the flag on the field.
const PHONE_BAD_RE = /\b(incorrect|wrong|bad|invalid|disconnected)\s+(phone\s+)?(number|#|no\.?|phone|ph\.?)(?![a-z])|\b(number|phone)\s+(is\s+)?(disconnected|not in service|no longer in service|wrong|incorrect|invalid|bad)\b|\bnot (a )?working number\b|\bnumber not in service\b/i;
const ADDRESS_BAD_RE = /\b(got|was|were|been|mail(ing)?|letters?|envelopes?)\s+returned\b|\breturned\s+(mail|letter|envelope|to sender)\b|\breturn to sender\b|\b(bad|wrong|incorrect)\s+address\b|\bundeliverable\b|\bmoved,?\s+no forwarding\b|\bno longer at (this|that) address\b/i;
export function contactNoteFlags(text) {
  const t = tidy(text);
  return { phoneBad: !!t && PHONE_BAD_RE.test(t), addressBad: !!t && ADDRESS_BAD_RE.test(t) };
}

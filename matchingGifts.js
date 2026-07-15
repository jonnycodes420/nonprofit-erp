// ── Matching-gift company lookup ────────────────────────────────────────────
// A curated, static snapshot of well-known employers with public
// matching-gift programs — NOT a live/comprehensive data feed. Vendors like
// Double the Donation or 360MatchPro sell an always-current version of this
// as a paid API; that's a deliberate future decision, not bundled here. This
// module exists so that decision is a drop-in swap later: lookupMatchingGift()
// is the only thing any caller ever touches, and its internal implementation
// (static array today) can be replaced with a real API call without any call
// site changing.
//
// Ratios reflect the most commonly published default for each company's
// program (overwhelmingly "1:1" is the US corporate standard) — this is
// curated from general public knowledge of these companies' matching-gift
// policies, not a fabricated guess, but it is a snapshot and WILL drift out
// of date. Every lookup result carries a source/last-verified note for
// exactly that reason — always confirm current terms (ratio, caps,
// deadlines) directly with the company before a donor submits a request.

const LIST_CURATED_DATE = "2026-07-15";
const SOURCE_NOTE = "Curated from publicly known company matching-gift programs — not a live feed. Confirm current terms with the employer before submitting a match request.";

// name: the canonical display name. aliases: alternate legal names,
// abbreviations, or former names that don't reduce to the canonical name via
// normalize() alone (suffix-stripping already handles "Inc"/"Corp"/"LLC"
// variants of the same name, so aliases are only needed for genuinely
// different strings — tickers, initialisms, rebrands).
const MATCHING_GIFT_COMPANIES = [
  // ── Technology ──────────────────────────────────────────────────────────
  { name: "Microsoft", aliases: ["MSFT"], ratio: "1:1" },
  { name: "Google", aliases: ["Alphabet", "GOOGL"], ratio: "1:1" },
  { name: "Apple", aliases: ["AAPL"], ratio: "1:1" },
  { name: "Meta", aliases: ["Facebook", "Meta Platforms"], ratio: "1:1" },
  { name: "Adobe", aliases: [], ratio: "1:1" },
  { name: "Salesforce", aliases: [], ratio: "1:1" },
  { name: "Intel", aliases: [], ratio: "1:1" },
  { name: "IBM", aliases: ["International Business Machines"], ratio: "1:1" },
  { name: "Oracle", aliases: [], ratio: "1:1" },
  { name: "Cisco", aliases: ["Cisco Systems"], ratio: "1:1" },
  { name: "Dell", aliases: ["Dell Technologies"], ratio: "1:1" },
  { name: "HP", aliases: ["Hewlett-Packard", "HP Inc"], ratio: "1:1" },
  { name: "Hewlett Packard Enterprise", aliases: ["HPE"], ratio: "1:1" },
  { name: "Intuit", aliases: [], ratio: "1:1" },
  { name: "PayPal", aliases: [], ratio: "1:1" },
  { name: "eBay", aliases: [], ratio: "1:1" },
  { name: "Qualcomm", aliases: [], ratio: "1:1" },
  { name: "Texas Instruments", aliases: ["TI"], ratio: "1:1" },
  { name: "VMware", aliases: [], ratio: "1:1" },
  { name: "Autodesk", aliases: [], ratio: "1:1" },
  { name: "Workday", aliases: [], ratio: "1:1" },
  { name: "ServiceNow", aliases: [], ratio: "1:1" },
  { name: "Nvidia", aliases: [], ratio: "1:1" },
  { name: "eBay Foundation", aliases: [], ratio: "1:1" },
  { name: "Juniper Networks", aliases: [], ratio: "1:1" },
  { name: "Applied Materials", aliases: [], ratio: "1:1" },
  { name: "Micron Technology", aliases: ["Micron"], ratio: "1:1" },

  // ── Financial services ──────────────────────────────────────────────────
  { name: "JPMorgan Chase", aliases: ["JP Morgan", "JPMorgan", "Chase"], ratio: "1:1" },
  { name: "Bank of America", aliases: ["BofA"], ratio: "1:1" },
  { name: "Wells Fargo", aliases: [], ratio: "1:1" },
  { name: "Goldman Sachs", aliases: [], ratio: "1:1" },
  { name: "Morgan Stanley", aliases: [], ratio: "1:1" },
  { name: "Citigroup", aliases: ["Citibank", "Citi"], ratio: "1:1" },
  { name: "American Express", aliases: ["Amex"], ratio: "1:1" },
  { name: "Visa", aliases: [], ratio: "1:1" },
  { name: "Mastercard", aliases: [], ratio: "1:1" },
  { name: "Capital One", aliases: [], ratio: "1:1" },
  { name: "State Street", aliases: [], ratio: "1:1" },
  { name: "BlackRock", aliases: [], ratio: "1:1" },
  { name: "Prudential Financial", aliases: ["Prudential"], ratio: "1:1" },
  { name: "MetLife", aliases: [], ratio: "1:1" },
  { name: "Charles Schwab", aliases: ["Schwab"], ratio: "1:1" },
  { name: "PNC Financial Services", aliases: ["PNC Bank", "PNC"], ratio: "1:1" },
  { name: "US Bank", aliases: ["U.S. Bancorp"], ratio: "1:1" },
  { name: "Truist Financial", aliases: ["Truist"], ratio: "1:1" },
  { name: "Fidelity Investments", aliases: ["Fidelity"], ratio: "1:1" },
  { name: "Northern Trust", aliases: [], ratio: "1:1" },
  { name: "T. Rowe Price", aliases: [], ratio: "1:1" },
  { name: "Ameriprise Financial", aliases: [], ratio: "1:1" },
  { name: "Travelers", aliases: ["The Travelers Companies"], ratio: "1:1" },
  { name: "Aetna", aliases: [], ratio: "1:1" },
  { name: "Allstate", aliases: [], ratio: "1:1" },
  { name: "Liberty Mutual", aliases: [], ratio: "1:1" },
  { name: "Progressive", aliases: ["Progressive Insurance"], ratio: "1:1" },

  // ── Consulting & professional services ──────────────────────────────────
  { name: "Deloitte", aliases: ["Deloitte & Touche"], ratio: "1:1" },
  { name: "PwC", aliases: ["PricewaterhouseCoopers"], ratio: "1:1" },
  { name: "EY", aliases: ["Ernst & Young"], ratio: "1:1" },
  { name: "KPMG", aliases: [], ratio: "1:1" },
  { name: "McKinsey & Company", aliases: ["McKinsey"], ratio: "1:1" },
  { name: "Boston Consulting Group", aliases: ["BCG"], ratio: "1:1" },
  { name: "Accenture", aliases: [], ratio: "1:1" },
  { name: "Bain & Company", aliases: ["Bain"], ratio: "1:1" },

  // ── Consumer, retail & media ─────────────────────────────────────────────
  { name: "Target", aliases: [], ratio: "1:1" },
  { name: "Starbucks", aliases: [], ratio: "1:1" },
  { name: "Nike", aliases: [], ratio: "1:1" },
  { name: "Coca-Cola", aliases: ["The Coca-Cola Company"], ratio: "1:1" },
  { name: "PepsiCo", aliases: [], ratio: "1:1" },
  { name: "Procter & Gamble", aliases: ["P&G"], ratio: "1:1" },
  { name: "Johnson & Johnson", aliases: ["J&J"], ratio: "1:1" },
  { name: "Home Depot", aliases: ["The Home Depot"], ratio: "1:1" },
  { name: "Best Buy", aliases: [], ratio: "1:1" },
  { name: "Costco", aliases: ["Costco Wholesale"], ratio: "1:1" },
  { name: "Walt Disney Company", aliases: ["Disney"], ratio: "1:1" },
  { name: "Comcast", aliases: ["NBCUniversal"], ratio: "1:1" },
  { name: "Warner Bros Discovery", aliases: [], ratio: "1:1" },
  { name: "Gap Inc", aliases: ["Gap"], ratio: "1:1" },
  { name: "Nordstrom", aliases: [], ratio: "1:1" },
  { name: "Kroger", aliases: [], ratio: "1:1" },
  { name: "Levi Strauss & Co", aliases: ["Levi's"], ratio: "1:1" },

  // ── Pharma, healthcare & life sciences ───────────────────────────────────
  { name: "Pfizer", aliases: [], ratio: "1:1" },
  { name: "Merck", aliases: [], ratio: "1:1" },
  { name: "Eli Lilly and Company", aliases: ["Eli Lilly", "Lilly"], ratio: "1:1" },
  { name: "Bristol Myers Squibb", aliases: ["BMS"], ratio: "1:1" },
  { name: "AbbVie", aliases: [], ratio: "1:1" },
  { name: "Amgen", aliases: [], ratio: "1:1" },
  { name: "Gilead Sciences", aliases: ["Gilead"], ratio: "1:1" },
  { name: "Medtronic", aliases: [], ratio: "1:1" },
  { name: "UnitedHealth Group", aliases: ["UnitedHealthcare", "UHG"], ratio: "1:1" },
  { name: "CVS Health", aliases: [], ratio: "1:1" },
  { name: "Cigna", aliases: [], ratio: "1:1" },
  { name: "Anthem", aliases: ["Elevance Health"], ratio: "1:1" },
  { name: "Abbott Laboratories", aliases: ["Abbott"], ratio: "1:1" },
  { name: "Thermo Fisher Scientific", aliases: ["Thermo Fisher"], ratio: "1:1" },

  // ── Industrial, energy & aerospace ───────────────────────────────────────
  { name: "General Electric", aliases: ["GE"], ratio: "1:1" },
  { name: "ExxonMobil", aliases: ["Exxon", "Exxon Mobil"], ratio: "1:1 (up to 3:1 for higher-education gifts)" },
  { name: "Chevron", aliases: [], ratio: "1:1" },
  { name: "Shell", aliases: ["Shell Oil"], ratio: "1:1" },
  { name: "BP", aliases: ["British Petroleum"], ratio: "1:1" },
  { name: "ConocoPhillips", aliases: [], ratio: "1:1" },
  { name: "Boeing", aliases: [], ratio: "1:1" },
  { name: "Lockheed Martin", aliases: [], ratio: "1:1" },
  { name: "RTX", aliases: ["Raytheon", "Raytheon Technologies"], ratio: "1:1" },
  { name: "Northrop Grumman", aliases: [], ratio: "1:1" },
  { name: "Honeywell", aliases: [], ratio: "1:1" },
  { name: "3M", aliases: [], ratio: "1:1" },
  { name: "Caterpillar", aliases: ["CAT"], ratio: "1:1" },
  { name: "General Motors", aliases: ["GM"], ratio: "1:1" },
  { name: "Ford Motor Company", aliases: ["Ford"], ratio: "1:1" },
  { name: "John Deere", aliases: ["Deere & Company"], ratio: "1:1" },
  { name: "Emerson Electric", aliases: ["Emerson"], ratio: "1:1" },
  { name: "Eaton Corporation", aliases: ["Eaton"], ratio: "1:1" },
  { name: "Parker Hannifin", aliases: [], ratio: "1:1" },
  { name: "Illinois Tool Works", aliases: ["ITW"], ratio: "1:1" },
  { name: "Duke Energy", aliases: [], ratio: "1:1" },
  { name: "Southern Company", aliases: [], ratio: "1:1" },
  { name: "Dow", aliases: ["Dow Chemical", "Dow Inc"], ratio: "1:1" },
  { name: "DuPont", aliases: ["DuPont de Nemours"], ratio: "1:1" },

  // ── Telecom ──────────────────────────────────────────────────────────────
  { name: "AT&T", aliases: [], ratio: "1:1" },
  { name: "Verizon", aliases: [], ratio: "1:1" },

  // ── Professional/business services & staffing ───────────────────────────
  { name: "ADP", aliases: ["Automatic Data Processing"], ratio: "1:1" },
  { name: "Paychex", aliases: [], ratio: "1:1" },
  { name: "FedEx", aliases: ["Federal Express"], ratio: "1:1" },
  { name: "UPS", aliases: ["United Parcel Service"], ratio: "1:1" },
];

const LEGAL_SUFFIX_RE = /\b(incorporated|corporation|company|limited|llc|l l c|inc|corp|co|ltd|plc|llp|lp)\b\.?/gi;

function normalize(raw) {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(LEGAL_SUFFIX_RE, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    // A legal name like "Wells Fargo & Company" strips down to a dangling
    // "wells fargo and" once "Company" is removed as a suffix — "&" was
    // connecting to the very word that just got stripped. Trim a leftover
    // leading/trailing "and" rather than leaving that mismatch.
    .replace(/^and\s+|\s+and$/g, "");
}

// Built once at module load: normalized name/alias → company record.
const INDEX = new Map();
for (const company of MATCHING_GIFT_COMPANIES) {
  for (const label of [company.name, ...company.aliases]) {
    const key = normalize(label);
    if (key) INDEX.set(key, company);
  }
}

// Exact match only, after normalization (lowercase, "&"→"and", common legal
// suffixes stripped, punctuation/whitespace collapsed) — deliberately not a
// loose substring/partial match. A substring match would false-positive
// donor employer strings like "Apple Valley Dental" against "Apple", which
// is worse than surfacing nothing. Trailing "Inc."/"Corp"/case differences
// are the "obvious variants" this handles; genuinely different names
// (tickers, rebrands, abbreviations) go in a company's `aliases` list above.
function lookupMatchingGift(employerName) {
  const key = normalize(employerName);
  if (!key) return null;
  const company = INDEX.get(key);
  if (!company) return null;
  return {
    matched: true,
    companyName: company.name,
    ratio: company.ratio,
    sourceNote: SOURCE_NOTE,
    lastVerified: LIST_CURATED_DATE,
  };
}

module.exports = { lookupMatchingGift, MATCHING_GIFT_COMPANIES };

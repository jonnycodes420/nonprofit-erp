// shared/sheetRead.js · IMPORT-3. A NONPROFIT'S FILE IS NEVER WRONG.
//
// One reader for any spreadsheet a small nonprofit keeps: an event night's
// gift sheet with no dates, a vendor export, a QuickBooks report with a title
// and subtotals, two tables side by side, one tab per year. It works out what
// the file is, says what it understood, and asks only what it cannot tell.
//
// Three steps, all pure (no I/O), so the browser and the server walk one plan:
//   1. findTables(grid)       the table wherever it sits: a title above it,
//                             blank rows, margin notes, totals and subtotals,
//                             several tables on a sheet, several sheets.
//   2. mapColumns(table)      each column by its name AND its contents. A
//                             header that says "Amount" over a column of
//                             names is not an amount.
//   3. buildPlan(...)         every row becomes a gift, a pledge, a person, or
//                             a line in "Help me with these" with its reason.
//
// Amounts come from the cells, always. A model may PROPOSE a mapping (the
// server asks one when the AI switch is on); proposeFromModel's answer is
// checked here against every row exactly like a rule's, so a wrong proposal is
// counted, never trusted. A column nobody can place is a question, never a
// silent drop. Nothing here writes; routes/sheetImport.js does, through
// recordGift.
import { normalizeMoney, normalizeDate, resolveDonorIdentity } from "./importShape.js";
import { pledgeMoneyWords } from "./pledgeWords.js";
import { EXPORT_SHAPES, shapeOfTable, shapeColumn, knownShapeSentence, reshapeKnownGrid } from "./exportShapes.js";
import { isGivenName } from "./givenNames.js";
import { splitAddress, contactNoteFlags } from "./addressSplit.js";
export { pledgeMoneyWords };

// ── vocabularies (declared before every reader, the TDZ rule) ─────────────
const ROLE_LABELS = {
  name: "Full name", first: "First name", last: "Last name", lastFirst: "Name (Last, First)",
  org: "Organization", email: "Email", phone: "Phone", address: "Street address",
  address2: "Address line 2", city: "City", state: "State", zip: "ZIP", amount: "Amount",
  date: "Date given", method: "Payment method", frequency: "How often", paid: "Paid yet? (yes/no)",
  status: "Status", type: "Transaction type", pledgeTotal: "Pledge total (all years)",
  fund: "Fund", campaign: "Campaign or appeal", note: "Note", giftNote: "On each gift's note", externalId: "Donor ID (old system)",
  category: "Gift category (an event or appeal becomes the campaign)",
  giftId: "Gift or transaction ID",
  // IMPORT-4: the engagement, communication and role layers. Each lands on the
  // person; nothing in a file with data is left out by default.
  invited: "Invited", rsvp: "RSVP", attended: "Attended", table: "Table", partySize: "Party size",
  logistics: "Event logistics (kept on the attendance)", mailingList: "Mailing list (on or off)",
  optOut: "Opted out of email", doNotEmail: "Do not email", doNotMail: "Do not mail", doNotCall: "Do not call",
  doNotContact: "Do not contact", deceased: "Deceased", volunteer: "Volunteer (yes or x)", board: "Board member",
  staff: "Staff", keep: "Keep as a custom field", totalOf: "A total of another sheet", ignore: "Leave out",
};
export const SHEET_ROLES = Object.keys(ROLE_LABELS).map(k => ({ key: k, label: ROLE_LABELS[k] }));

// Headers, normalised to lower-case words. Exact header match only (the
// imports rule: a header is matched whole, never by substring).
const HEADER_ROLES = [
  ["first", ["first", "first name", "firstname", "fname", "given name", "contact first name", "primary contact first name", "donor first name", "contact: first name", "first_name"]],
  ["last", ["last", "last name", "lastname", "lname", "surname", "family name", "contact last name", "primary contact last name", "donor last name", "contact: last name", "last_name"]],
  ["name", ["name", "full name", "donor", "donor name", "contact", "contact name", "constituent", "constituent name", "customer", "customer name", "received from", "from", "giver", "account name", "household name", "supporter", "supporter name", "payer", "donor/organization", "name (full)", "person", "guest", "guest name", "attendee"]],
  ["org", ["organization", "organisation", "company", "company name", "organization name", "business", "business name"]],
  ["email", ["email", "e-mail", "email address", "e-mail address", "from email address", "contact email", "primary email", "donor email", "email_address", "personal email"]],
  ["phone", ["phone", "phone number", "phone #", "mobile", "cell", "telephone", "home phone", "mobile phone", "primary phone"]],
  ["address", ["address", "street", "address 1", "address1", "address line 1", "mailing address", "street address", "mailing street", "address_1", "addr1", "home street"]],
  ["address2", ["address 2", "address2", "address line 2", "address_2", "apt", "suite"]],
  ["city", ["city", "town", "mailing city", "home city"]],
  ["state", ["state", "st", "province", "state/province", "mailing state/province", "mailing state", "home state", "region"]],
  ["zip", ["zip", "zip code", "zipcode", "postal code", "postcode", "zip/postal code", "mailing zip/postal code", "home zip", "zip_code"]],
  ["amount", ["amount", "gift amount", "donation", "donation amount", "gross", "amount (total)", "gift", "payment amount", "amt", "gift_amount", "total amount", "received amount", "contribution", "amount received", "pledge amount", "gift $", "$"]],
  ["date", ["date", "received", "date of gift", "timestamp", "gift date", "donation date", "close date", "received date", "payment date", "datetime", "transaction date", "deposit date", "date received", "gift_date", "date given", "created at", "donated at"]],
  ["method", ["method", "payment method", "payment type", "pay method", "tender", "paid by", "payment", "pay type", "payment_method", "gift method", "how paid"]],
  ["frequency", ["frequency", "recurring", "recurrence", "interval", "schedule", "how often", "gift frequency"]],
  ["paid", ["completed", "paid", "paid?", "collected", "fulfilled", "received?", "complete", "paid yet"]],
  ["status", ["status", "stage", "payment status", "gift status", "transaction status"]],
  ["type", ["type", "transaction type", "txn type", "gift type"]],
  ["pledgeTotal", ["pledge total", "total pledged", "total pledge", "3 yr total", "3 year total", "three year total", "multi-year total", "commitment", "total commitment"]],
  ["fund", ["fund", "designation", "fund name", "gl code", "fund/designation", "restricted to", "gl_code"]],
  ["campaign", ["campaign", "appeal", "campaign title", "campaign name", "solicit code", "appeal name", "event", "solicit_code"]],
  ["note", ["note", "notes", "memo", "memo/description", "description", "comments", "comment", "message", "dedication", "gift note"]],
  ["externalId", ["donor id", "constituent id", "account number", "account id", "donor_id", "id number", "donor number", "contact id", "supporter id", "account #", "account no"]],
  ["giftId", ["transaction id", "gift id", "receipt", "receipt #", "num", "ref", "reference", "payment id", "id", "receipt number", "check #", "check number", "opportunity id", "gift_id"]],
  ["invited", ["invited", "invite", "invitation", "invited?", "on invite list"]],
  ["rsvp", ["rsvp", "rsvp'd", "rsvpd", "rsvp?", "rsvp status", "registered", "responded", "coming", "attending"]],
  ["attended", ["attended", "attended?", "checked in", "check in", "checked-in", "came", "present", "attendance", "showed", "showed up"]],
  ["table", ["table", "table #", "table number", "table no", "seat", "seating", "table assignment"]],
  ["partySize", ["party size", "guests", "# guests", "number of guests", "guest count", "party", "headcount", "tickets", "seats"]],
  ["logistics", ["name tag", "nametag", "name badge", "invite sent", "invitation sent", "called", "call made", "reminder sent", "thank you sent"]],
  ["mailingList", ["mailing list", "newsletter", "email list", "opt in", "opt-in", "subscribed", "email opt in", "on mailing list", "mailing", "e-news"]],
  ["optOut", ["unsubscribed", "opt out", "opted out", "opt-out", "unsubscribe", "email opt out"]],
  ["doNotEmail", ["do not email", "no email", "dne", "do not e-mail"]],
  ["doNotMail", ["do not mail", "no mail", "dnm", "no mailings"]],
  ["doNotCall", ["do not call", "no calls", "no phone calls"]],
  ["doNotContact", ["do not contact", "dnc", "no contact", "do not solicit"]],
  ["deceased", ["deceased", "is deceased", "passed away", "died"]],
  ["volunteer", ["volunteer", "volunteered", "volunteer?", "is volunteer", "volunteers"]],
  ["board", ["board", "board member", "on board", "trustee", "board?"]],
  ["staff", ["staff", "employee", "staff member", "staff?"]],
];
// A column that adds up money kept elsewhere ("Gave at dinner" beside a Gifts
// sheet). Checked against the gifts before it is skipped; one that does not
// foot is kept, never dropped.
const TOTAL_OF_RE = /^(gave at .+|gift total|total gifts?|total given|total donated|amount given|giving total|.+ gift total|total giving|gave)$/i;
// Columns that mean "this sheet is about volunteers" when nothing else says so.
const VOLUNTEER_HDR = new Set(["hours", "volunteer hours", "shifts", "shift", "volunteer role", "availability", "skills", "hours served", "hours volunteered"]);
// An opt-out written anywhere on the row, in any column.
const PLEASE_REMOVE_RE = /\b(please remove|remove me|unsubscribe me|take me off|stop (emailing|mailing)|no more (emails?|mail))\b/i;
const OPT_OUT_WORDS = /^(unsubscribed?|opt(ed)?[- ]?out|remove|removed|no emails?|do not email|stop|off|bounced? and removed)$/i;
const EVENT_WORD_RE = /\b(dinner|gala|lunch|luncheon|breakfast|auction|benefit|banquet|celebration|party|golf|walk|run|5k|concert|reception|fundraiser|night|brunch|tea|festival|open house)\b/i;
// The roles that put a value on the person (core Steward fields).
const PERSON_ROLES = new Set(["name", "first", "last", "lastFirst", "org", "email", "phone", "address", "address2", "city", "state", "zip", "externalId"]);
const ENGAGE_ROLES = new Set(["invited", "rsvp", "attended", "table", "partySize", "logistics"]);
const COMMS_ROLES = new Set(["mailingList", "optOut", "doNotEmail", "doNotMail", "doNotCall", "doNotContact", "deceased"]);
const ROLE_FLAG_ROLES = new Set(["volunteer", "board", "staff"]);
const HEADER_INDEX = new Map();
for (const [role, list] of HEADER_ROLES) for (const h of list) if (!HEADER_INDEX.has(h)) HEADER_INDEX.set(h, role);
// Columns that are deliberately left out, with the reason said out loud.
const IGNORED_HEADERS = new Map([
  ["fee", "a processing fee, not the gift"], ["fees", "a processing fee, not the gift"],
  ["net", "the amount after fees; the gift is the gross"], ["net amount", "the amount after fees; the gift is the gross"],
  ["fee amount", "a processing fee, not the gift"], ["processing fee", "a processing fee, not the gift"],
  ["fee covered", "whether the donor covered the fee"], ["amount (fee)", "a processing fee, not the gift"],
  ["amount (net)", "the amount after fees; the gift is the gross"], ["amount (tip)", "a tip, not the gift"],
  ["time", "the time of day"], ["timezone", "the time zone"], ["time zone", "the time zone"],
  ["currency", "the currency (dollars)"], ["clr", "the bank's cleared mark"],
  ["opportunity name", "a label the old system made from the name and date"],
  ["to", "who received the payment (you)"], ["funding source", "the payer's bank or card"],
  ["destination", "where the money went"], ["beginning balance", "a running balance"],
  ["ending balance", "a running balance"], ["balance", "a running balance"], ["vendor", "a bill paid, not a gift"],
  ["split", "the account it posted to"], ["account", "the account it posted to"],
  ["statement period venmo fees", "a fee"], ["terminal location", "where it was taken"],
  ["year to date", "a running total"], ["to email address", "your own address"], ["amount (tax)", "sales tax, not the gift"],
  ["tax rate", "sales tax, not the gift"], ["tax exempt", "sales tax, not the gift"], ["disclaimer", "the statement's small print"],
  ["year to date venmo fees", "a fee"], ["receipt id", "the processor's receipt"], ["ytd", "a running total"], ["lifetime giving", "a running total from the old system"],
]);
// FIX-52: a sheet of review notes about people already listed ("Check these":
// Person, What to check, How matched) is not a list of people. These headers
// are a reviewer's, never a person's field.
const NOTES_HDR_RE = /^(what to check|to check|check|check this|needs checking|how matched|matched (by|on|how)|match(ed)?|match type|match reason|why|reason|issue|issues|problem|problems|question|questions|review|review note|flag|flags|reviewer note|comment|comments|note|notes|action|to do|todo)$/;
// The sheet's own counts above a header ("People 443", "Attended (checked in) 172").
const SHEET_FIGURE_RE = /^(.{2,40}?)[\s:=]+([\d,]+)$/;
function figureKind(label) {
  const l = hnorm(label).replace(/[()]/g, " ");
  if (/\b(attended|checked in|came|present|showed)\b/.test(l)) return "attended";
  if (/\brsvp/.test(l) || /\b(registered|yes responses|coming)\b/.test(l)) return "rsvp";
  if (/\binvit/.test(l)) return "invited";
  if (/^(people|persons|guests|names|contacts|records|rows|households|total people|people listed|on the list)\b/.test(l)) return "people";
  return null;
}
const NUMERIC_TOTAL_RE = /\b(sub-?total|grand total|total|totals|sum)\b/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const YES = new Set(["yes", "y", "true", "x", "paid", "done", "complete", "completed", "received", "collected", "1", "✓", "✔"]);
const NO = new Set(["no", "n", "false", "unpaid", "not yet", "pending", "0", "open", "outstanding", "pledged", "promised"]);
// Status words, read as stage words (imports rule). Anything not listed is a
// question for a person, never a guess.
const STATUS_PAID = new Set(["completed", "complete", "succeeded", "success", "paid", "closed won", "posted", "received", "settled", "cleared", "approved", "captured", "deposited"]);
const STATUS_PLEDGE = new Set(["pledged", "promised", "open", "outstanding", "committed", "not yet received", "not received", "unpaid", "balance due", "pledge", "awaiting payment",
  "not yet paid", "not paid", "not paid yet", "to be paid", "owed", "due"]);
const STATUS_ASIDE = new Set(["refunded", "failed", "denied", "declined", "reversed", "canceled", "cancelled", "voided", "void", "pending", "chargeback", "disputed", "closed lost", "partially refunded", "unclaimed", "expired"]);
const TYPE_GIFT = /^(donation|donation payment|payment|deposit|sales receipt|gift|contribution|charge|website payment|express checkout payment|mobile payment|subscription payment|recurring payment|p2p|merchant transaction|credit card|one-time donation|recurring donation|check|cash)$/i;
const TYPE_ASIDE = /(withdrawal|transfer|refund|fee|journal|bill|expense|hold|reversal|invoice|payout|authorization|currency conversion)/i;
const ORG_WORDS = /\b(foundation|fund|inc|incorporated|llc|l\.l\.c|corp|corporation|company|co\.|church|ministries|ministry|trust|bank|association|club|society|school|university|college|council|group|partners|lp|llp|pc|pllc|daf|giving|philanthropies|charitable|rotary|lions|kiwanis|temple|synagogue|parish|diocese|chapel)\b/i;
const GIFT_CATEGORY_HDR = /^(category|gift category|donation category|giving category|income category|revenue category|class|gift class|income type|contribution type)$/;
// HARDEN-1 (Jonathan, 27 Oct): in a category column only an event or appeal
// label is a campaign ("Bourbon & Breeders Gala", "Gallop & Glow 5K"); an
// accounting label ("Business Contributions") stays on its gift as its category.
const EVENT_APPEAL_WORDS = /\b(gala|ball|5k|10k|half marathon|marathon|fun run|run|walk|race|trot|ride|dinner|luncheon|lunch|breakfast|brunch|banquet|auction|raffle|appeal|campaign|drive|telethon|radiothon|golf|tournament|classic|derby|fundraiser|benefit|concert|festival|fair|party|soiree|celebration|event|night|challenge|giving tuesday|givingtuesday|year[- ]end appeal)\b/i;
const PAID_OUT_RE = /\b(purchase|purchased|paid to|payment to|expense|bill|invoice|reimburse(ment)?|bought|vendor|supplies)\b/i;
const TITLE_RE = /^(mr|mrs|ms|miss|mx|dr|rev|fr|sr|jr|the honorable|hon|prof)\.?$/i;
// Payment methods, mapped to Steward's words; anything else is Other with the
// original text kept on the gift.
const METHOD_MAP = [
  [/^(online|web|website|internet|online giving|web form|givebutter|paypal|venmo|stripe|square|zelle|apple pay|google pay|cash app)$/i, "Card", "online"],
  [/^(credit|credit card|cc|card|debit|debit card|visa|mastercard|amex|american express|discover|creditcard|credit_card|card payment)$/i, "Card", null],
  [/^(check|cheque|chk|ck|personal check|business check|cashier'?s check)$/i, "Check", null],
  [/^(cash|currency)$/i, "Cash", null],
  [/^(stock|stock transfer|securities|shares|stock gift|equities)$/i, "Stock", null],
  [/^(investment dist|investment distribution|investment pledge|brokerage)$/i, "Stock", null],
  [/^(retirement dist|retirement distribution|ira|ira distribution|qcd|qualified charitable distribution|ira rollover|rmd)$/i, "Qualified charitable distribution", null],
  [/^(foundation|foundation grant|grant|private foundation)$/i, "Foundation", null],
  [/^(daf|donor advised fund|donor-advised fund)$/i, "DAF", null],
  [/^(ach|eft|bank transfer|wire|direct deposit|bank draft)$/i, "ACH", null],
  [/^(in[- ]?kind|ik|goods|gift in kind|non-?cash)$/i, "In-kind", null],
];
const RECURRING_RE = /^(rec+ur+ing|monthly|recurring monthly|month|every month|sustainer|recurring gift|per month|\/mo|mo)$/i;
const ONCE_RE = /^(once|one[- ]?time|single|one off|one-off|onetime)$/i;
const MULTIYEAR_RE = /^x\s*(\d)\s*(years?|yrs?)$|^(\d)\s*(years?|yrs?)$|^(\d)[- ]year( pledge)?$/i;
const ANNUAL_RE = /^(annual|annually|yearly|every year)$/i;
const QUARTERLY_RE = /^(quarterly|every quarter)$/i;
const DATE_HDR_WORD = /\b(date|datetime|day|when|given on|received on)\b/i;
const MONTH_LABEL_RE = new RegExp(`^(${MONTHS.join("|")})[a-z]*\\.?(\\s+\\d{4})?$`, "i");

// ── small helpers ─────────────────────────────────────────────────────────
const s = v => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
// HARDEN-1: a business's own words, matched as whole tokens of the name (the
// imports rule: word boundaries, never substrings), beside ORG_WORDS above.
// Dots are dropped first, so "U.S.A." is "usa" and "L.L.C." is "llc".
const ORG_TOKENS = new Set(["store", "stores", "farm", "farms", "services", "service", "realty", "construction", "excavating", "inn", "community",
  "unlimited", "cafe", "café", "restaurant", "grill", "market", "shop", "ltd", "limited", "enterprises", "enterprise", "industries", "holdings",
  "properties", "motors", "insurance", "agency", "associates", "stables", "stable", "ranch", "vineyards", "winery", "distillery", "brewing",
  "brewery", "plumbing", "electric", "roofing", "landscaping", "lawncare", "contracting", "contractors", "consulting", "solutions", "dental",
  "clinic", "hospital", "pharmacy", "studio", "salon", "academy", "center", "centre", "co", "corp", "inc", "llc", "lp", "llp", "pllc", "plc",
  "usa", "pc", "pa", "dba", "partnership"]);
// after a comma: a company's ending ("Car Town Kia, U.S.A") or a person's
// suffix ("Perel V. Warville, Jr"); either way the name is not "Last, First"
const ORG_SUFFIX = new Set(["inc", "llc", "ltd", "corp", "co", "lp", "llp", "pllc", "plc", "pc", "pa", "usa", "us", "na", "company", "incorporated", "limited"]);
const PERSON_SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v", "esq", "md", "phd", "dds", "cpa", "rn", "dvm", "do"]);
const nameTokens = x => s(x).replace(/\./g, "").toLowerCase().split(/[^a-z0-9'’&é-]+/).filter(Boolean);
export function isOrgName(x) { return ORG_WORDS.test(s(x)) || nameTokens(x).some(w => ORG_TOKENS.has(w)); }
// "Last, First" only when the part after the comma can be a first name: not a
// company's ending, not a suffix, not a place in capitals after a mixed-case
// name ("Cranwick Allow Glenstead, OAKWOOD"), and not after three or more words.
function commaIsLastFirst(before, after) {
  const a = nameTokens(after);
  if (!a.length || a.every(w => ORG_SUFFIX.has(w) || PERSON_SUFFIX.has(w))) return false;
  if (after === after.toUpperCase() && /[A-Z]{2}/.test(after) && before !== before.toUpperCase()) return false;
  if (before.split(/\s+/).filter(w => !/^(van|von|de|del|der|da|di|la|le|st\.?|mac|mc|o')$/i.test(w)).length >= 3) return false;
  return true;
}
// IMPORT-5 · A COUPLE WRITTEN WITH A COMMA. "Alex, Brad Hubbard": one first
// name before the comma, a first name and a surname after it, is two people of
// one household ("Alex & Brad Hubbard"), never "Last, First". The last word must
// not itself be a first name ("Thomas, Paul James" stays Paul James Thomas).
// FIX-59: the second first name need not be on the list ("Josh, Kesi Tanabe"):
// a known first name before the comma, then exactly two capitalised words, the
// last not a first name either. "Last, First Middle" would need a surname that
// is also a first name, so the first names that are common surnames ("Grant,
// Kesi Mae") keep reading "Last, First".
const SURNAME_LIKE = new Set(("thomas lewis grant dean wade mitchell marshall howard james allen lee scott morgan taylor carter russell "
  + "warren wayne gordon curtis craig kelly ross ray jordan bruce henry george arthur martin owen wesley clay chase lance kent kirk "
  + "glenn dale mason logan tyler douglas stanley herbert vernon norman milton marion lynn neil neal bernard clifford calvin drew "
  + "frank franklin austin lloyd miles barry graham elliott gilbert harvey cooper nelson spencer fay grace rose joy").split(" "));
function commaCouple(before, after) {
  const b = s(before).split(/\s+/).filter(Boolean), a = s(after).split(/\s+/).filter(Boolean);
  if (b.length !== 1 || a.length < 2 || a.length > 3) return null;
  if (a.length === 3 && !/^[A-Za-z]\.?$/.test(a[1])) return null;
  if (!isGivenName(b[0]) || isGivenName(a[a.length - 1])) return null;
  if (!isGivenName(a[0]) && (a.length !== 2 || SURNAME_LIKE.has(b[0].toLowerCase()) || TITLE_RE.test(a[0])
      || !/^[A-Z][a-z'’-]{2,}$/.test(a[0]) || !/^[A-Z]/.test(a[1]))) return null;
  return { first: `${b[0]} & ${a.slice(0, -1).join(" ")}`, last: a[a.length - 1] };
}
// The same couple on a record already here, for Data health's review: written
// as typed ("Alex, Brad Hubbard"), or as the old reading left it ("Brad Hubbard
// Alex", only on a record an import made). Never applied without her click.
export function commaCoupleFix(name, { imported = false } = {}) {
  const n = s(name);
  let c = null;
  const m = n.match(/^([^,]+),\s*(.+)$/);
  if (m) c = commaCouple(m[1], m[2]);
  else if (imported) {
    const w = n.split(/\s+/);
    if (w.length === 3 && !isGivenName(w[1]) && isGivenName(w[2]) && !isOrgName(n)) c = commaCouple(w[2], `${w[0]} ${w[1]}`);
  }
  // FIX-59: "Randy or Jessamy Barlow", "Conrad and Celia Hartwell" (or
  // "Or", as the older reading left it): the joining word makes two people,
  // the way the import's reader reads it. "&" is how Steward itself writes a
  // joint name, so a record named with "&" is left as she has it.
  const j = !c && n.match(/^([A-Za-z'’-]+)\s+(and|or)\s+([A-Za-z'’-]+)\s+([A-Za-z'’-]+)$/i);
  if (j && (isGivenName(j[1]) || isGivenName(j[3])) && !isOrgName(n)) c = { first: `${j[1]} & ${j[3]}`, last: j[4] };
  if (!c) return null;
  const r = readName({ first: c.first, last: c.last });
  return r.kind === "household" && r.people.length === 2 ? { before: n, household: r.household, people: r.people.map(p => p.name) } : null;
}
const hnorm = h => s(h).toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
const isBlank = v => s(v) === "";
const cents = v => Math.round(v * 100);
const fmt$ = c => (c < 0 ? "-$" : "$") + (Math.abs(Math.round(c)) / 100).toLocaleString("en-US", { minimumFractionDigits: (c % 100) ? 2 : 0, maximumFractionDigits: 2 });
const plural = (n, a, b) => `${n.toLocaleString("en-US")} ${n === 1 ? a : (b || a + "s")}`;

function moneyOf(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let t = s(v);
  if (!t) return null;
  // "1.5k", "2K"
  const k = t.match(/^\$?\s*(\d+(?:\.\d+)?)\s*[kK]$/);
  if (k) return Number(k[1]) * 1000;
  t = t.replace(/\s*(usd|dollars)$/i, "").replace(/^(in[- ]?kind|ik)[:\s]+/i, "");
  const m = normalizeMoney(t);
  return m.value == null ? null : m.value;
}
function looksMoney(v) {
  if (typeof v === "number") return true;
  const t = s(v).replace(/^(in[- ]?kind|ik)[:\s]+/i, "").replace(/^usd\s+/i, "");
  if (!t) return false;
  if (/^[+-]?\s*\$?\s*\(?[+-]?\$?\s*\d[\d,]*(\.\d{1,2})?\)?\s*(usd)?$/i.test(t)) return true;
  if (/^\$?\d+(\.\d+)?[kK]$/.test(t)) return true;
  return false;
}
function hasCurrencyMark(v) { return /[$€£]|usd/i.test(s(v)); }

// Excel serial day → ISO. 1900 system, with Excel's phantom Feb 29 1900.
function serialToIso(n) {
  if (!(n > 20000 && n < 80000)) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
// A date cell → ISO, or null. `ctx.year` fills a missing year ("Oct 22"),
// stepping back a year when that would put the gift in the future.
function dateOf(v, ctx = {}) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number") return ctx.serials ? serialToIso(v) : null;
  // IMPORT-5: an export's timestamp may name its zone ("2025-04-02 10:11:12 UTC")
  const t = s(v).replace(/\s+(utc|gmt)$/i, "");
  if (/^\d{5}(\.\d+)?$/.test(t)) return ctx.serials ? serialToIso(Number(t)) : null;
  const md = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?$/) || null;
  const dm = !md && t.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?$/);
  const slash = !md && !dm && t.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (md || dm || slash) {
    let mon, day;
    if (slash) { mon = +slash[1]; day = +slash[2]; if (ctx.dayFirst) [mon, day] = [day, mon]; }
    else {
      const word = (md ? md[1] : dm[2]).slice(0, 3).toLowerCase();
      mon = MONTHS.indexOf(word) + 1; day = +(md ? md[2] : dm[1]);
    }
    if (!(mon >= 1 && mon <= 12 && day >= 1 && day <= 31)) return null;
    const today = ctx.today || new Date().toISOString().slice(0, 10);
    let year = ctx.year || +today.slice(0, 4);
    const iso = y => `${y}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!ctx.year && iso(year) > today) year -= 1;
    const check = normalizeDate(iso(year));
    return check.value || null;
  }
  const r = normalizeDate(t, { dayFirst: !!ctx.dayFirst });
  return r.value || null;
}
// IMPORT-4: "Oct 2026" is a month (dated the 1st, with the file's words kept);
// "FY26" names a year Steward cannot place in a month, so the gift is undated
// with the words kept. Both still read as a date column.
const MONTH_YEAR_RE = /^([A-Za-z]{3,9})\.?\s+((19|20)\d{2})$/;
const FISCAL_RE = /^fy\s*'?(\d{2}|\d{4})$/i;
function looksDate(v, ctx) {
  if (v instanceof Date) return true;
  if (typeof v === "number") return !!(ctx && ctx.serials && serialToIso(v));
  const t = s(v);
  if (FISCAL_RE.test(t)) return true;
  if (!t || /^\d{1,3}$/.test(t)) return false;
  if (/^\$/.test(t)) return false;
  return !!dateOf(t, { ...(ctx || {}), serials: !!(ctx && ctx.serials) });
}
function yesNo(v) {
  const t = s(v).toLowerCase();
  if (!t) return null;
  if (YES.has(t)) return true;
  if (NO.has(t)) return false;
  return undefined;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;
const ZIP_RE = /^\d{4,5}(-\d{4})?$/;
const STATE_RE = /^(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[DLNA]|K[SY]|LA|M[EDAINSOT]|N[EVHJMYCD]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[TA]|W[AVIY]|PR|GU|VI)$/i;

// ── 0. any file → grids ───────────────────────────────────────────────────
// One grid per sheet: rows of cells, a cell a string, number, or ISO date
// string (Excel date cells arrive as Dates and leave as "YYYY-MM-DD").
// Merged cells are filled with their value across the merge, so a merged
// title or a merged "Arnold" over two rows reads as the person would read it.
export function gridsFromWorkbook(wb, XLSX) {
  const out = [];
  for (const name of wb.SheetNames || []) {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) { out.push({ name, grid: [] }); continue; }
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: true });
    const grid = rows.map(r => (r || []).map(c => (c instanceof Date ? (isNaN(c) ? null : c.toISOString().slice(0, 10)) : c)));
    // a sheet whose used range starts below row 1 or right of column A keeps
    // its real row numbers, so "row 26" is the row she sees in Excel
    const range0 = XLSX.utils.decode_range(ws["!ref"]);
    for (let k = 0; k < range0.s.r; k++) grid.unshift([]);
    if (range0.s.c) for (const r of grid) if (r.length) r.unshift(...new Array(range0.s.c).fill(null));
    // A cell whose number format is a date but that SheetJS left as a number
    // (cellDates off) is a serial; mark it by converting here.
    const range = range0;
    for (let R = range.s.r; R <= range.e.r; R++) for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.t === "n" && cell.z && /[dmy]/i.test(String(cell.z)) && !/^[#0.,%$ ]+$/.test(String(cell.z))) {
        const iso = serialToIso(cell.v);
        if (iso && grid[R]) grid[R][C] = iso;
      }
    }
    for (const m of ws["!merges"] || []) {
      const v = grid[m.s.r]?.[m.s.c];
      if (v == null) continue;
      for (let R = m.s.r; R <= m.e.r; R++) for (let C = m.s.c; C <= m.e.c; C++) {
        // a merged title across columns stays one cell (it is a title, not
        // several); a merged value down rows fills each row (it is each row's)
        if (R === m.s.r) continue;
        const row = grid[R] || (grid[R] = []);
        if (row[C] == null) row[C] = v;
      }
    }
    out.push({ name, grid });
  }
  return out;
}

// CSV / TSV / semicolon text → one grid. Quotes honoured; the delimiter is
// the one that splits the most lines into the same number of cells.
export function gridFromText(text) {
  const t = String(text || "").replace(/^﻿/, "");
  const sample = t.split(/\r?\n/).slice(0, 30);
  let best = ",", bestScore = -1;
  for (const d of [",", "\t", ";", "|"]) {
    const counts = sample.map(l => splitLine(l, d).length).filter(n => n > 1);
    if (!counts.length) continue;
    const mode = counts.sort((a, b) => counts.filter(x => x === b).length - counts.filter(x => x === a).length)[0];
    const score = counts.filter(x => x === mode).length * 10 + mode;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === best) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(c => (c === "" ? null : c)));
}
function splitLine(line, d) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"' && cur === "") q = true;
    else if (ch === d) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ── 1. find the tables ────────────────────────────────────────────────────
// A table is a header row and the rows under it. Around it: title lines
// above, section labels and totals inside, notes in the margin. Several
// tables side by side are split at a column that is empty from top to bottom
// of the block; several stacked are split where a new header row appears.
function headerScore(row) {
  const cells = row.map(s);
  const filled = cells.filter(Boolean);
  if (filled.length < 2) return 0;
  let known = 0, texty = 0;
  for (const c of filled) {
    const h = hnorm(c);
    if (HEADER_INDEX.has(h) || IGNORED_HEADERS.has(h) || /total|amount|date|name/i.test(h)) known++;
    if (!looksMoney(c) && !looksDate(c, {}) && !EMAIL_RE.test(c) && c.length <= 40) texty++;
  }
  if (texty < filled.length * 0.8) return 0;
  return known * 3 + filled.length;
}

export function findTables(sheetName, grid) {
  const G = (grid || []).map(r => (Array.isArray(r) ? r : []));
  const width = G.reduce((m, r) => Math.max(m, r.length), 0);
  const notes = [];
  // column blocks: split at columns empty for the whole sheet
  const colFilled = [];
  for (let c = 0; c < width; c++) colFilled[c] = G.reduce((n, r) => n + (isBlank(r[c]) ? 0 : 1), 0);
  const blocks = [];
  let start = null;
  for (let c = 0; c <= width; c++) {
    if (c < width && colFilled[c] > 0) { if (start == null) start = c; }
    else if (start != null) { blocks.push([start, c - 1]); start = null; }
  }
  const tables = [];
  for (const [c0, c1] of blocks) {
    const cellCount = colFilled.slice(c0, c1 + 1).reduce((a, b) => a + b, 0);
    // A lone cell or a single sparse column far from everything is a note.
    if (cellCount <= 2 || (c1 === c0 && cellCount < 4)) {
      G.forEach((r, i) => { for (let c = c0; c <= c1; c++) if (!isBlank(r[c])) notes.push({ sheet: sheetName, line: i + 1, col: c, text: s(r[c]) }); });
      continue;
    }
    const sub = G.map(r => r.slice(c0, c1 + 1));
    tables.push(...tablesInBlock(sheetName, sub, c0, notes));
  }
  return { tables, notes };
}

function tablesInBlock(sheetName, rows, c0, notes) {
  const out = [];
  let i = 0;
  const titles = [];
  while (i < rows.length) {
    // find the next header row
    let hi = -1, bestScore = 0;
    for (let j = i; j < Math.min(rows.length, i + 40); j++) {
      const sc = headerScore(rows[j]);
      if (!sc) {
        if (!rows[j].every(isBlank) && hi < 0) continue;
        continue;
      }
      // the row under a header holds data, not another header-like row of words only
      // the next rows hold data (a section label like "Checking" may sit between)
      const next = rows.slice(j + 1, j + 6).find(r => r.filter(c => !isBlank(c)).length >= 2);
      if (!next) continue;
      if (sc > bestScore) { bestScore = sc; hi = j; }
      break;
    }
    if (hi < 0) {
      for (let j = i; j < rows.length; j++) if (!rows[j].every(isBlank)) notes.push({ sheet: sheetName, line: j + 1, col: c0, text: rows[j].map(s).filter(Boolean).join(" ") });
      break;
    }
    for (let j = i; j < hi; j++) if (!rows[j].every(isBlank)) titles.push({ line: j + 1, text: rows[j].map(s).filter(Boolean).join(" ") });
    const header = rows[hi].map(s);
    const width = header.length;
    // trim trailing empty header columns that never carry data
    const body = [];
    let j = hi + 1;
    for (; j < rows.length; j++) {
      const r = rows[j];
      if (r.every(isBlank)) { body.push({ line: j + 1, blank: true, cells: [] }); continue; }
      const cells = r.slice(0, width).map(s);
      // a repeated header (a report that prints its header on every page)
      if (cells.join("|").toLowerCase() === header.join("|").toLowerCase()) { body.push({ line: j + 1, repeatHeader: true, cells }); continue; }
      // a NEW header after a gap of 2+ blank rows starts another stacked table
      const gap = body.length >= 2 && body.slice(-2).every(b => b.blank);
      if (gap && headerScore(r) >= 6 && cells.join("|") !== header.join("|")) break;
      body.push({ line: j + 1, cells, raw: r.slice(0, width) });
    }
    // columns with no header and no data are not columns
    const used = header.map((h, c) => !!h || body.some(b => b.cells && !isBlank(b.cells[c])));
    out.push({ sheet: sheetName, colOffset: c0, headerLine: hi + 1, header, used, body, titles: titles.splice(0) });
    i = j;
  }
  return out;
}

// ── 2. map the columns ────────────────────────────────────────────────────
// Each column gets a role by its header, checked against its contents; a
// header nobody recognises gets a role from its contents alone when the
// contents are unmistakable (emails, money with a $, dates). Otherwise the
// column is a question.
function dataRows(table) { return table.body.filter(b => b.cells && !b.blank && !b.repeatHeader); }

export function profileColumn(table, c, ctx = {}) {
  const vals = dataRows(table).map(b => (b.raw ? b.raw[c] : b.cells[c])).filter(v => !isBlank(v));
  const n = vals.length || 1;
  const frac = f => vals.filter(f).length / n;
  const serials = vals.length > 0 && vals.every(v => /^\d{5}(\.\d+)?$/.test(s(v))) && vals.every(v => serialToIso(Number(s(v))));
  const dayFirst = vals.some(v => { const m = s(v).match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}$/); return m && +m[1] > 12 && +m[2] <= 12; });
  const lc = vals.map(v => s(v).toLowerCase());
  return {
    count: vals.length,
    sample: [...new Set(vals.map(s))].slice(0, 6),
    money: frac(looksMoney), currency: frac(hasCurrencyMark),
    date: frac(v => looksDate(v, { serials, today: ctx.today })), serials, dayFirst,
    // a header that says date may hold an Excel serial among written dates
    dateLoose: frac(v => looksDate(v, { serials: true, today: ctx.today })),
    email: frac(v => EMAIL_RE.test(s(v))), phone: frac(v => PHONE_RE.test(s(v))),
    zip: frac(v => ZIP_RE.test(s(v))), state: frac(v => STATE_RE.test(s(v))),
    yesno: frac(v => yesNo(v) !== undefined),
    lastFirst: frac(v => /^[A-Za-z'’ .-]+,\s*[A-Za-z'’ .&-]+$/.test(s(v)) && !isOrgName(s(v))),
    method: frac(v => METHOD_MAP.some(([re]) => re.test(s(v))) || /^(unknown|other|pledge)$/i.test(s(v))),
    frequency: frac(v => RECURRING_RE.test(s(v)) || ONCE_RE.test(s(v)) || MULTIYEAR_RE.test(s(v)) || ANNUAL_RE.test(s(v)) || QUARTERLY_RE.test(s(v))),
    status: frac(v => STATUS_PAID.has(s(v).toLowerCase()) || STATUS_PLEDGE.has(s(v).toLowerCase()) || STATUS_ASIDE.has(s(v).toLowerCase())),
    wordy: frac(v => /^[A-Za-z][A-Za-z'’.&, -]*$/.test(s(v))),
    smallCount: frac(v => /^\d{1,2}$/.test(s(v)) && +s(v) <= 60),
    distinct: new Set(lc).size,
  };
}

// A column with no header whose cells are only section labels ("Checking")
// and total lines is the report's left margin, not data.
function labelsOnly(table, c) {
  return dataRows(table).every(b => {
    const v = s(b.cells[c]);
    if (!v) return true;
    return NUMERIC_TOTAL_RE.test(v) || b.cells.filter(x => !isBlank(x)).length === 1 || b.cells.every((x, i) => i === c || isBlank(x) || looksMoney(x));
  });
}

function contentFits(role, p) {
  if (!p.count) return true;
  switch (role) {
    case "amount": case "pledgeTotal": return p.money >= 0.8;
    case "date": return p.date >= 0.8 || p.dateLoose >= 0.8;
    case "email": return p.email >= 0.6;
    case "phone": return p.phone >= 0.6 || p.money < 0.5;
    case "zip": return p.zip >= 0.6 || p.money < 0.5;
    case "paid": return p.yesno >= 0.8;
    case "status": return p.status >= 0.6 || p.yesno >= 0.8;
    case "invited": case "rsvp": case "attended": case "volunteer": case "board": case "staff":
    case "doNotEmail": case "doNotMail": case "doNotCall": case "doNotContact": case "deceased":
      return p.yesno >= 0.6 || p.date >= 0.6 || p.distinct <= 4;
    case "partySize": return p.smallCount >= 0.9 && p.currency < 0.2;
    case "optOut": case "mailingList": return p.money < 0.5;
    case "first": case "last": case "name": case "lastFirst": return p.money < 0.5 && p.email < 0.5;
    default: return true;
  }
}

export function mapColumns(table, opts = {}) {
  const cols = [];
  const taken = new Set();
  const header = table.header;
  for (let c = 0; c < header.length; c++) {
    if (!table.used[c]) continue;
    const h = hnorm(header[c]);
    const p = profileColumn(table, c, opts);
    const col = { index: c, header: header[c], profile: p, role: null, reason: "", by: null };
    if (!p.count) { col.role = "ignore"; col.reason = "the column is empty"; col.by = "rule"; cols.push(col); continue; }
    if (IGNORED_HEADERS.has(h)) { col.role = "ignore"; col.reason = IGNORED_HEADERS.get(h); col.by = "rule"; cols.push(col); continue; }
    if (!h && labelsOnly(table, c)) { col.role = "ignore"; col.reason = "section labels and totals, not a column"; col.by = "rule"; cols.push(col); continue; }
    let role = HEADER_INDEX.get(h) || null;
    // "Donor #", "Member ID": a person's number. "Locker #" is not (IMPORT-4).
    if (!role && /^((donor|constituent|member|account|contact|supporter|person|record|customer|household|guest|attendee|gift|transaction|receipt)\s*)?(id|number|no|#)$/.test(h) && p.money < 1.01)
      role = /^(gift|transaction|receipt)/.test(h) || taken.has("externalId") ? "giftId" : "externalId";
    // a header with "total" and years over a money column is a multi-year total
    if (!role && /\b(\d|three|two|five)\s*(yr|year)s?\b.*total|total.*\b(\d|three)\s*(yr|year)/i.test(h)) role = "pledgeTotal";
    if (!role && /\bamount\b|\bgift\b.*\$|donation/i.test(h) && p.money >= 0.8) role = "amount";
    if (!role && DATE_HDR_WORD.test(h) && p.date >= 0.8) role = "date";
    if (!role && /\bname\b/.test(h) && !/\b(user|campaign|fund|event|opportunity|appeal|page|file|company|employer|team|product|item)\b/.test(h) && p.money < 0.5) role = "name";
    if (!role && /\be-?mail\b/.test(h) && p.email >= 0.6) role = "email";
    if (role === "status" && p.yesno >= 0.8 && p.status < 0.6) role = "paid";
    if (role === "date" && !contentFits("date", p) && p.yesno >= 0.8) role = "paid";
    if (role === "name" && p.lastFirst >= 0.8) role = "lastFirst";
    if (role === "type" && p.method >= 0.8) role = "method";
    if (role && !contentFits(role, p)) { col.mismatch = `the header says ${ROLE_LABELS[role].toLowerCase()}, but the cells do not read that way`; role = null; }
    if (role) { col.by = "header"; col.reason = `the header "${header[c]}"`; }
    // contents alone, only when unmistakable
    if (!role && !col.mismatch) {
      if (p.email >= 0.9) role = "email";
      else if (p.money >= 0.9 && p.currency >= 0.5) role = "amount";
      else if (p.date >= 0.9 && !p.serials) role = "date";
      else if (p.yesno >= 0.95 && p.distinct <= 4 && !isBlank(header[c])) role = null;   // a yes/no we cannot name: ask
      else if (p.lastFirst >= 0.9) role = "lastFirst";
      else if (p.frequency >= 0.9) role = "frequency";
      else if (p.method >= 0.9) role = "method";
      if (role) { col.by = "contents"; col.reason = `the cells read as ${ROLE_LABELS[role].toLowerCase()}`; }
    }
    // IMPORT-4: a total of another sheet, and a volunteer sheet's own columns
    if (!role && !col.mismatch && TOTAL_OF_RE.test(h) && p.money >= 0.8) { role = "totalOf"; col.by = "header"; col.reason = `the header "${header[c]}"`; }
    if (!role && !col.mismatch && VOLUNTEER_HDR.has(h)) { role = "keep"; col.volunteerSignal = true; col.by = "header"; col.reason = `the header "${header[c]}" is about volunteering`; }
    if (role && taken.has(role) && !["note", "logistics", "keep", "totalOf"].includes(role)) {
      col.duplicateOf = role; col.role = null;
    } else if (role) { col.role = role; taken.add(role); }
    cols.push(col);
  }
  // A second unclaimed money column next to "Amount" is unknown, not a gift.
  return cols;
}

// IMPORT-5: a known export's shape places the columns it knows. Each role is
// still checked against the cells; a role the cells refuse is left to the
// reader. A role the shape gives one column is let go by any other.
const MULTI_ROLES = new Set(["ignore", "note", "giftNote", "keep", "logistics", "totalOf"]);
function applyShape(table, cols, shape) {
  const placed = [];
  for (const col of cols) {
    const spec = shapeColumn(shape, col.header, dataRows(table).map(b => (b.raw ? b.raw[col.index] : b.cells[col.index])));
    if (!spec || !ROLE_LABELS[spec.role]) continue;
    // a column of the system's own codes fits when its cells are those codes
    const fits = spec.values
      ? (() => { const v = dataRows(table).map(b => s(b.raw ? b.raw[col.index] : b.cells[col.index]).toLowerCase()).filter(Boolean); return v.length > 0 && v.filter(x => spec.values[x]).length >= v.length * 0.6; })()
      : MULTI_ROLES.has(spec.role) || contentFits(spec.role, col.profile);
    if (!fits) continue;
    placed.push([col, spec]);
  }
  for (const [col, spec] of placed) {
    if (!MULTI_ROLES.has(spec.role)) for (const o of cols) if (o !== col && o.role === spec.role && !placed.some(([p]) => p === o)) { o.role = null; o.by = null; o.reason = ""; }
    col.role = spec.role; col.by = "shape"; col.mismatch = null; col.duplicateOf = null;
    col.reason = spec.reason || `${shape.system}'s "${col.header}" column`;
    if (spec.values) col.values = spec.values;
  }
}

// Apply a person's (or a model's) overrides: {headerOrIndex: role}. Each is
// checked against the contents; a role that does not fit is refused by name.
export function applyOverrides(cols, overrides = {}) {
  const refused = [];
  if (!overrides || typeof overrides !== "object") return { cols, refused };
  const byKey = k => cols.find(c => String(c.index) === String(k) || c.header === k);
  const next = cols.map(c => ({ ...c }));
  for (const [k, role] of Object.entries(overrides)) {
    const col = next.find(c => String(c.index) === String(k) || c.header === k);
    if (!col || !byKey(k)) continue;
    if (!ROLE_LABELS[role]) { refused.push({ header: col.header, role, reason: "not a place Steward can put a column" }); continue; }
    if (!["ignore", "note", "giftNote", "category", "keep", "logistics"].includes(role) && !contentFits(role, col.profile)) {
      refused.push({ header: col.header, role, reason: `the cells in "${col.header}" do not read as ${ROLE_LABELS[role].toLowerCase()}` });
      continue;
    }
    // the role moves: whoever held it lets go
    if (!["ignore", "note", "giftNote", "keep", "logistics", "totalOf"].includes(role)) for (const o of next) if (o !== col && o.role === role) { o.role = null; o.duplicateOf = role; }
    col.role = role; col.by = "person"; col.reason = "you chose it"; col.mismatch = null; col.duplicateOf = null;
  }
  return { cols: next, refused };
}

// ── 3. names ──────────────────────────────────────────────────────────────
// "Suzanna & Walt" + "Arnold" → two people, one household. "Arnold, Suzanna
// & Walt", "Mr. and Mrs. Walt Arnold", "Walt and Suzanna Arnold" too. An
// organisation's name stays whole.
const JOINT_RE = /\s*(?:&|\band\b|\bor\b|\+)\s*/i;   // FIX-59: "Randolph or Joenell Barnett" is a couple too
function titleCase(w) { return w && (w === w.toUpperCase() || w === w.toLowerCase()) ? w.replace(/[A-Za-zÀ-ÿ][^\s-]*/g, x => x[0].toUpperCase() + x.slice(1).toLowerCase()) : w; }
function cleanPart(x) { return titleCase(s(x).replace(/^[,.\s]+|[,.\s]+$/g, "")); }

export function readName({ first, last, full, lastFirst, org }) {
  first = s(first); last = s(last); full = s(full || lastFirst); org = s(org);
  if (org && !first && !last && !full) return { kind: "organization", name: org, people: [] };
  if (!first && !last && full) {
    if (isOrgName(full) || resolveDonorIdentity({ name: full }).kind === "organisation") return { kind: "organization", name: full, people: [] };
    if (/^anonymous$/i.test(full)) return { kind: "anonymous", name: "Anonymous", people: [] };
    const comma = full.match(/^([^,]+),\s*(.+)$/);
    // a company's ending after the comma is an organisation; a person's suffix,
    // or anything else that is not a first name, keeps the name as written
    if (comma && nameTokens(comma[2]).length && nameTokens(comma[2]).every(w => ORG_SUFFIX.has(w))) return { kind: "organization", name: full, people: [] };
    if (comma && !commaIsLastFirst(comma[1].trim(), comma[2].trim())) return { kind: "person", name: full, people: [{ name: full }] };
    const couple = comma && commaCouple(comma[1], comma[2]);
    if (couple) return readName({ first: couple.first, last: couple.last });
    // "S & S Westford", "R & R Hardware": initials joined are a business's name, never two people of one initial
    if (!comma && /^([A-Za-z]\.?\s*(&|and|\+)\s*)+[A-Za-z]\.?\s+\S/.test(full)) return { kind: "organization", name: full, people: [] };
    if (comma) { last = comma[1]; first = comma[2]; }
    else {
      // "Mr. and Mrs. Walt Arnold" / "Walt and Suzanna Arnold" / "Walt Arnold"
      const words = full.split(/\s+/);
      const lastWord = words[words.length - 1];
      const rest = words.slice(0, -1).join(" ");
      if (/^(the )?[A-Za-z'’-]+ family$/i.test(full)) return { kind: "person", name: titleCase(full), people: [{ name: titleCase(full) }] };
      if (JOINT_RE.test(rest)) {
        if (/family$/i.test(full)) return { kind: "person", name: titleCase(full), people: [{ name: titleCase(full) }] };
        first = rest; last = lastWord;
      } else return { kind: "person", name: titleCase(full), people: [{ name: titleCase(full.replace(/^(mr|mrs|ms|dr|rev)\.?\s+/i, "")) }] };
    }
  }
  // HARDEN-1: a Last Name of two or more words with no First Name is a
  // business or a farm ("Linhurst Bradmore Farm"), its words exactly as
  // written. One word alone ("Foxland") is a family's surname: a person.
  if (!first && last) {
    if (isOrgName(last) || s(last).split(/\s+/).length >= 2) return { kind: "organization", name: s(last), people: [] };
    return { kind: "person", name: cleanPart(last), people: [{ name: cleanPart(last) }] };
  }
  if (first && !last) return { kind: "person", name: cleanPart(first), people: [{ name: cleanPart(first) }] };
  const L = cleanPart(last);
  // IMPORT-5: "Alex, Brad" in a First Name column is two first names, a couple
  const firstComma = first.match(/^([^,\s]+),\s*([^,\s]+)$/);
  if (firstComma && isGivenName(firstComma[1]) && isGivenName(firstComma[2])) first = `${firstComma[1]} & ${firstComma[2]}`;
  const parts = first.split(JOINT_RE).map(cleanPart).filter(Boolean);
  if (parts.length >= 2) {
    // titles only ("Mr. and Mrs. Walt") → one named person and a spouse by title
    const named = [], titled = [], attached = [];
    for (const p of parts) {
      const all = p.split(/\s+/);
      const ws = all.filter(w => !TITLE_RE.test(w));
      if (ws.length) { named.push(ws.join(" ")); attached.push(...all.filter(w => TITLE_RE.test(w))); } else titled.push(p);
    }
    const household = `${parts.join(" & ")} ${L}`;
    if (named.length >= 2) return { kind: "household", name: household, household, people: named.map(n => ({ name: `${n} ${L}` })) };
    if (named.length === 1) {
      const t0 = (attached[0] || titled[0] || "").replace(/\.$/, "");
      return { kind: "household", name: household, household, people: [{ name: `${named[0]} ${L}`, spouse: t0 ? `${titleCase(t0)}. ${L}` : null }] };
    }
  }
  const one = parts[0] || cleanPart(first);
  const clean = one.split(/\s+/).filter(w => !TITLE_RE.test(w)).join(" ") || one;
  return { kind: "person", name: `${clean} ${L}`, people: [{ name: `${clean} ${L}` }] };
}

function methodOf(raw) {
  const t = s(raw);
  if (!t) return { method: "Other", original: "", known: false };
  for (const [re, m, channel] of METHOD_MAP) if (re.test(t)) return { method: m, original: t, known: true, channel };
  return { method: "Other", original: t, known: false };
}
export function frequencyOf(raw) {
  const t = s(raw);
  if (!t) return { kind: "unknown", original: "" };
  if (ONCE_RE.test(t)) return { kind: "once", original: t };
  if (RECURRING_RE.test(t)) return { kind: "monthly", original: t };
  if (ANNUAL_RE.test(t)) return { kind: "annual", original: t };
  if (QUARTERLY_RE.test(t)) return { kind: "quarterly", original: t };
  const m = t.match(MULTIYEAR_RE);
  if (m) return { kind: "multiYear", years: +(m[1] || m[3] || m[5]), original: t };
  return { kind: "unknown", original: t };
}
export function mapMethodWord(raw) { return methodOf(raw); }

// Suggested event name from a file name: "Finding Joy Dinner Gifts.xlsx" →
// "Finding Joy Dinner".
export function eventNameFromFile(fileName) {
  let n = s(fileName).replace(/\.(xlsx|xls|csv|tsv|txt)$/i, "").replace(/[_]+/g, " ");
  n = n.replace(/[-]+/g, " ").replace(/\b(gifts?|donations?|pledges?|export|final|copy|v\d+|\(\d+\)|list|sheet|results|totals?|scrubbed|tally|combined|guests?|guest list|rsvps?|attendance|seating|name tags?|invites?|invitations?|workbook)\b/gi, " ").replace(/\s+/g, " ").trim();
  // FIX-55: a row count or an id in the name ("jp dinner 106") is not the event's
  // name; a name with no capitals is a file name, so its short codes go and it
  // reads as a name ("Dinner"), which she can still change
  n = n.replace(/\b(?!(?:19|20)\d\d\b)\d+\b/g, " ").replace(/\s+/g, " ").trim();
  if (n && !/[A-Z]/.test(n)) n = n.split(" ").filter(w => w.length > 2).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
  if (/^(event|events|file|data|book\d*|sheet\d*)$/i.test(n)) return null;
  return n || null;
}
// The event a title row names: "Finding Joy Dinner · Guest List" → "Finding Joy Dinner".
function eventNameFromTitles(tables) {
  for (const t of tables) for (const ti of t.titles || []) {
    const text = s(ti.text);
    if (!EVENT_WORD_RE.test(text) || text.length > 80) continue;
    const cut = text.split(/\s*[·|:\u2013\u2014-]\s+/)[0].replace(/\b(guest list|rsvp list|seating chart|name tags|invite list|summary|results)\b/gi, "").replace(/\s+/g, " ").trim();
    if (cut) return cut;
  }
  return null;
}

// IMPORT-5: two files from one system that go together (a Salesforce Contacts
// export and its Donations export) are one import. files: [{ id, name, sheets }]
// → groups, each { ids, name, sheets }; a pair's sheets carry their file's name
// (as the import screen names them, readSheetFile), every other file stands alone.
export function pairExportFiles(files = []) {
  const keysOf = f => new Set((f.sheets || []).flatMap(sh => findTables(sh.name, reshapeKnownGrid(sh.grid || [])).tables
    .map(t => shapeOfTable(t.header, dataRows(t).map(b => b.raw || b.cells))).filter(Boolean).map(x => x.key)));
  const shapes = files.map(f => ({ f, keys: keysOf(f) }));
  const used = new Set(), out = [];
  const named = f => (f.sheets || []).map(sh => ({ ...sh, name: f.sheets.length === 1 ? String(f.name || "file").replace(/\.[a-z]+$/i, "") : `${String(f.name || "file").replace(/\.[a-z]+$/i, "")} · ${sh.name}` }));
  for (const a of shapes) {
    if (used.has(a.f)) continue;
    const want = EXPORT_SHAPES.filter(x => a.keys.has(x.key) && x.pairWith).map(x => x.pairWith);
    const b = want.length ? shapes.find(o => o !== a && !used.has(o.f) && want.some(k => o.keys.has(k))) : null;
    if (b) { used.add(a.f); used.add(b.f); out.push({ ids: [a.f.id, b.f.id], name: `${a.f.name} + ${b.f.name}`, sheets: [...named(a.f), ...named(b.f)], files: [a.f, b.f] }); }
    else { used.add(a.f); out.push({ ids: [a.f.id], name: a.f.name, sheets: a.f.sheets, files: [a.f] }); }
  }
  return out;
}

// ── 4. the plan ───────────────────────────────────────────────────────────
// understand({sheets:[{name, grid}], fileName, today, overrides, answers})
// → everything the review screen shows and everything the write does.
//
// IMPORT-4: the plan is read in layers, each on the one before.
//   1. People   everyone in the file once: sheets that list the same people
//               merge (a shared ID first, then an email, then the exact name
//               with no contact detail that disagrees); couples are a household.
//   2. Roles    what each person is, from the data: donor (gave), pledger,
//               event guest, prospect (invited, never gave), volunteer, board,
//               staff, or a contact when nothing else is true.
//   3. Money    every gift and pledge, on its person. A gift with a person and
//               an amount always lands; with no date it lands undated.
//   4. Engagement  the event (invited, RSVP, attended, table, party size,
//               logistics), and communication choices (opted out, do not
//               contact, do not mail, do not call) with where they came from.
//   5. Everything else  every remaining column with data is kept on the person
//               as a custom field under its own header. Nothing is lost.
//
// answers: { date: "YYYY-MM-DD" (every undated gift), eventName, eventDate,
//            linkEvent: bool, useEventDate: bool,
//            rows: { "<sheet>:<line>": "gift" | "pledge" | "skip" } }
export function understand({ sheets = [], fileName = "", today, overrides = {}, answers = {} } = {}) {
  const T = today || new Date().toISOString().slice(0, 10);
  const all = [], notes = [];
  for (const sh of sheets) {
    // IMPORT-5: a report that writes its customer above their lines (QuickBooks) gives each line its customer
    const f = findTables(sh.name, reshapeKnownGrid(sh.grid || []));
    f.tables.forEach((t, i) => { t.key = `${sh.name}#${i + 1}`; all.push(t); });
    notes.push(...f.notes);
  }
  const tables = all.map(t => {
    const auto = mapColumns(t, { today: T });
    // IMPORT-5: another system's known export places its own columns; her answers still win
    const shape = shapeOfTable(t.header, dataRows(t).map(b => b.raw || b.cells));
    if (shape) applyShape(t, auto, shape);
    const ov = {};
    for (const [k, v] of Object.entries(overrides || {})) { const [tk, idx] = String(k).split("|"); if (tk === t.key) ov[idx] = v; }
    const { cols, refused } = applyOverrides(auto, ov);
    return { ...t, cols, refused, shape };
  });
  // what each table is
  for (const t of tables) {
    const has = r => t.cols.some(c => c.role === r);
    const named = has("name") || has("first") || has("last") || has("lastFirst") || has("org") || has("email");
    t.kind = named && has("amount") ? "gifts" : named ? "people" : has("amount") ? "summary" : "other";
    // A sheet of people's IDs: a bare "ID" is the person's, not a gift's.
    if (t.kind === "people") for (const c of t.cols) if (c.role === "giftId" && !has("externalId")) { c.role = "externalId"; c.reason = `the header "${c.header}" on a list of people`; }
    t.isVolunteer = /volunteer/i.test(t.sheet) || t.cols.some(c => c.volunteerSignal);
  }
  const roleOf = (t, r) => t.cols.find(c => c.role === r);
  const cellOf = (t, b, c) => (b.raw ? b.raw[c.index] : b.cells[c.index]);
  // HARDEN-1: does a column hold more than one value for one person's rows?
  // The person is read off the table's own name, email and ID cells.
  const variesWithinPerson = (t, c) => {
    const who = ["name", "first", "last", "lastFirst", "org", "email", "externalId"].map(r => roleOf(t, r)).filter(Boolean);
    if (!who.length) return false;
    const seen = new Map();
    for (const b of dataRows(t)) {
      const k = who.map(x => s(cellOf(t, b, x)).toLowerCase()).join("|"), v = s(cellOf(t, b, c));
      if (k.replace(/\|/g, "") === "" || !v) continue;
      if (seen.has(k) && seen.get(k) !== v) return true;
      if (!seen.has(k)) seen.set(k, v);
    }
    return false;
  };
  // FIX-52 · A NOTES SHEET IS NOT PEOPLE. A table with a reviewer's columns
  // ("What to check", "How matched") and no money, whose rows mostly name
  // people another sheet already lists, is notes about those people: not read
  // as people, and its columns are not kept as fields, unless she says
  // "Import it anyway" (answers.notesSheets).
  const notesSheets = [];
  {
    const variants = name => {
      const w = readName({ full: name });
      const out = new Set([w.name, w.household, ...(w.people || []).map(x => x.name)].filter(Boolean).map(x => x.toLowerCase().replace(/[^a-z0-9& ]/g, "").replace(/\s+/g, " ").trim()));
      return out;
    };
    const rowName = (t, b) => {
      const g = r => { const c = roleOf(t, r); return c ? s(cellOf(t, b, c)) : ""; };
      if (g("first") || g("last")) return `${g("first")} ${g("last")}`.trim();
      return g("name") || g("lastFirst") || g("org");
    };
    const wanted = new Set((Array.isArray(answers.notesSheets) ? answers.notesSheets : []).map(String));
    for (const t of tables) {
      if (t.kind !== "people" && t.kind !== "other") continue;
      if (t.cols.some(c => c.role === "amount" || c.role === "pledgeTotal")) continue;
      const noteCols = t.cols.filter(c => NOTES_HDR_RE.test(hnorm(c.header)));
      if (!noteCols.length) continue;
      const nameCol = t.cols.find(c => ["name", "lastFirst", "first", "last", "org"].includes(c.role))
        || t.cols.find(c => /^(person|who|name|guest|donor)$/.test(hnorm(c.header)));
      if (!nameCol) continue;
      const others = tables.filter(o => o !== t && (o.kind === "people" || o.kind === "gifts"));
      if (!others.length) continue;
      const known = new Set(), ids = new Set(), emails = new Set();
      for (const o of others) for (const b of dataRows(o)) {
        for (const v of variants(rowName(o, b))) known.add(v);
        const ic = roleOf(o, "externalId"); if (ic) { const v = s(cellOf(o, b, ic)).toLowerCase(); if (v) ids.add(v); }
        const ec = roleOf(o, "email"); if (ec) { const v = s(cellOf(o, b, ec)).toLowerCase(); if (v) emails.add(v); }
      }
      const rows = dataRows(t);
      let hits = 0;
      for (const b of rows) {
        const nm = nameCol.role ? rowName(t, b) : s(cellOf(t, b, nameCol));
        const cells = b.cells.map(x => s(x).toLowerCase());
        if ([...variants(nm)].some(v => known.has(v)) || cells.some(v => v && (ids.has(v) || emails.has(v)))) hits++;
      }
      if (!rows.length || hits < rows.length * 0.6) continue;
      const entry = { sheet: t.sheet, key: t.key, rows: rows.length, matched: hits, columns: noteCols.map(c => c.header), imported: wanted.has(t.sheet),
        sentence: `Sheet '${t.sheet}' looks like notes about people already on the list. Not imported.` };
      notesSheets.push(entry);
      if (!entry.imported) t.kind = "notes";
    }
  }
  // A shared ID column links sheets: a gift sheet's ID whose values are the
  // people sheet's IDs is the person, never the gift (and gifts attach by it,
  // never by name, when it exists).
  const peopleIds = new Set();
  for (const t of tables) if (t.kind === "people") { const c = roleOf(t, "externalId"); if (c) for (const b of dataRows(t)) { const v = s(cellOf(t, b, c)); if (v) peopleIds.add(v.toLowerCase()); } }
  for (const t of tables) if (t.kind === "gifts" && peopleIds.size && !roleOf(t, "externalId")) {
    const c = roleOf(t, "giftId");
    if (!c) continue;
    const vals = dataRows(t).map(b => s(cellOf(t, b, c)).toLowerCase()).filter(Boolean);
    if (vals.length && vals.filter(v => peopleIds.has(v)).length >= vals.length * 0.5) {
      c.role = "externalId"; c.reason = `the same IDs as your list of people, so each gift attaches to its person by ID`; c.by = "rule"; c.links = true;
    }
  }
  const usable = tables.filter(t => t.kind === "gifts" || t.kind === "people");
  // people first, so a gift sheet finds the person its ID names
  usable.sort((a, b) => (a.kind === "people" ? 0 : 1) - (b.kind === "people" ? 0 : 1));
  const giftTables = usable.filter(t => t.kind === "gifts");
  const fileKind = giftTables.length ? "gifts" : usable.length ? "people" : "unknown";
  const dateAnswer = answers.date && /^\d{4}-\d{2}-\d{2}$/.test(answers.date) ? answers.date : null;
  // "Date them all" with the event linked is the event's date too (the write reads it the same way)
  const eventDateAnswer = answers.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(answers.eventDate) ? answers.eventDate : (answers.linkEvent && dateAnswer) || null;
  // IMPORT-5: a pledge with no date of its own is due from the event's date
  // (counted as before: a one-year pledge by that year's end, a multi-year one
  // yearly from it), from a date she chose (that day, then yearly), or has no
  // set due date. Unanswered, it has none, and the question blocks.
  const pledgeDueDate = answers.pledgeDueDate && /^\d{4}-\d{2}-\d{2}$/.test(answers.pledgeDueDate) ? answers.pledgeDueDate : null;
  const pledgeDueBase = answers.pledgeDue === "event" ? eventDateAnswer : answers.pledgeDue === "choose" ? pledgeDueDate : null;
  const singleDue = base => !base ? null : answers.pledgeDue === "choose" && base === pledgeDueDate ? base : yearEnd(base);
  const questions = [];
  const help = [];
  const hasEngagement = usable.some(t => t.cols.some(c => ENGAGE_ROLES.has(c.role)));

  // Every column's fate: mapped (a Steward field), kept (a custom field under
  // its own header), or skipped with the reason said out loud. A column with
  // data is never skipped by default; the one exception is a money-shaped
  // column on a table that has no amount yet, which may be the gift.
  for (const t of tables) for (const c of t.cols) {
    const usableT = t.kind === "gifts" || t.kind === "people";
    if (!usableT) {
      c.disposition = "skipped";
      c.skipReason = t.kind === "summary" ? "a summary of amounts with no names, so it is not people or gifts"
        : t.kind === "notes" ? "notes about people already on the list, not imported" : "a table with no names and no amounts";
      continue;
    }
    if (c.role === "ignore") { c.disposition = "skipped"; c.skipReason = c.reason || "you left it out"; continue; }
    if (c.role === "keep") { c.disposition = "kept"; continue; }
    if (c.role === "totalOf") { c.disposition = "skipped"; c.skipReason = "a total of the gifts in this file"; continue; }
    if (c.role) { c.disposition = "mapped"; continue; }
    const p = c.profile;
    // a list of people with a date and a column of numbers may be a list of gifts
    const maybeAmount = !roleOf(t, "amount") && p.money >= 0.8 && p.smallCount < 0.9
      && (t.kind === "gifts" || roleOf(t, "date") || p.currency >= 0.2);
    if (maybeAmount || (c.mismatch && p.money >= 0.8 && !roleOf(t, "amount"))) {
      c.disposition = "question";
      help.push({ kind: "column", key: `${t.key}|${c.index}`, sheet: t.sheet, header: c.header || `(column ${c.index + 1})`,
                  sample: p.sample, reason: c.mismatch || "this may be the amount: Steward could not tell", options: SHEET_ROLES });
      continue;
    }
    if (c.duplicateOf && dataRows(t).every(b => s(cellOf(t, b, c)) === s(cellOf(t, b, roleOf(t, c.duplicateOf))))) {
      c.disposition = "skipped"; c.skipReason = `the same values as "${roleOf(t, c.duplicateOf).header}"`; continue;
    }
    // section labels in a headed column ("Month": January, February) are not data
    if (dataRows(t).every(b => isBlank(b.cells[c.index]) || b.cells.filter(x => !isBlank(x)).length === 1)) {
      c.disposition = "skipped"; c.skipReason = "section labels between the rows, not a column of data"; continue;
    }
    // HARDEN-1: on a table of gifts, a column that is about the gift belongs to
    // the gift, never the person. A category is read cell by cell: an event or
    // appeal label is the gift's campaign (gifts.campaign, which reports and an
    // event's fallback read), an accounting label stays on the gift's note as
    // its category. Any other column whose value differs between one person's
    // gifts goes on each gift's note under its header. Kept on the person it kept only one.
    if (t.kind === "gifts" && roleOf(t, "amount")) {
      if (GIFT_CATEGORY_HDR.test(hnorm(c.header)) && !roleOf(t, "category")) {
        c.role = "category"; c.disposition = "mapped"; c.by = "rule";
        c.reason = `the header "${c.header}" on a list of gifts: an event or appeal is the gift's campaign, any other label stays on the gift as its category`;
        continue;
      }
      if (variesWithinPerson(t, c)) {
        c.role = "giftNote"; c.disposition = "mapped"; c.by = "rule";
        c.reason = "it differs between one person's gifts, so it is kept on each gift's note";
        continue;
      }
    }
    c.role = "keep"; c.disposition = "kept"; c.by = c.by || "rule";
    c.reason = c.mismatch ? `${c.mismatch}, so it is kept under its own name` : c.duplicateOf
      ? `another column is already the ${ROLE_LABELS[c.duplicateOf].toLowerCase()}, so this one is kept under its own name`
      : "kept on each person under its own name";
  }
  for (const t of tables) if (t.kind === "summary" || t.kind === "other") {
    help.push({ kind: "table", key: t.key, sheet: t.sheet, header: t.header.filter(Boolean).join(", "), line: t.headerLine,
                reason: t.kind === "summary" ? "a table of amounts with no names: read as a summary, not gifts" : "a table with no names and no amounts",
                informational: true });
  }

  // ── Placeholders: an email or phone on three or more people with different
  // last names is the organisation's own line, not theirs. It is never used to
  // tell people apart and never copied onto them.
  const contactLasts = { email: new Map(), phone: new Map() };
  const contactNames = { email: new Map(), phone: new Map() };
  const contactShown = { email: new Map(), phone: new Map() };   // the value as the file wrote it
  for (const t of usable) for (const b of dataRows(t)) {
    const who = readName({ first: roleOf(t, "first") && cellOf(t, b, roleOf(t, "first")), last: roleOf(t, "last") && cellOf(t, b, roleOf(t, "last")),
      full: roleOf(t, "name") && cellOf(t, b, roleOf(t, "name")), lastFirst: roleOf(t, "lastFirst") && cellOf(t, b, roleOf(t, "lastFirst")), org: roleOf(t, "org") && cellOf(t, b, roleOf(t, "org")) });
    const last = (who.name || "").split(/\s+/).pop().toLowerCase();
    for (const k of ["email", "phone"]) {
      const c = roleOf(t, k); if (!c) continue;
      const v = k === "email" ? s(cellOf(t, b, c)).toLowerCase() : s(cellOf(t, b, c)).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      if (!v) continue;
      if (!contactLasts[k].has(v)) { contactLasts[k].set(v, new Set()); contactNames[k].set(v, new Set()); contactShown[k].set(v, s(cellOf(t, b, c))); }
      if (last) { contactLasts[k].get(v).add(last); contactNames[k].get(v).add((who.name || "").toLowerCase()); }
    }
  }
  const placeholder = { email: new Set(), phone: new Set() };
  for (const k of ["email", "phone"]) for (const [v, lasts] of contactLasts[k]) if (lasts.size >= 3) placeholder[k].add(v);
  const phoneKey = v => s(v).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

  const people = new Map();   // key → the record
  const byId = new Map(), byEmail = new Map(), byName = new Map();
  const gifts = [], pledges = [], aside = [], totals = [], flags = [];
  const nearMisses = [];
  const merged = [];   // IMPORT-5 (7c): rows read into a person already on the list
  const occ = new Map();
  const sourceFile = s(fileName) || "your file";
  const personGiftCents = new Map();   // for "Gave at dinner" checks
  const keptHeaders = new Map();       // header → { header, sheet, count }
  for (const t of usable) {
    const role = r => roleOf(t, r);
    const get = (b, r) => { const c = role(r); return c ? cellOf(t, b, c) : null; };
    const dateCol = role("date");
    const dctx = dateCol ? { serials: true, dayFirst: dateCol.profile.dayFirst, today: T } : null;
    const nameCols = ["name", "first", "last", "lastFirst", "org", "email"].map(role).filter(Boolean);
    const moneyCols = t.cols.filter(c => c.role === "amount" || c.role === "pledgeTotal");
    // IMPORT-5 (7a): the whole address in one column, with no city, state or ZIP column beside it
    const oneColumnAddress = !!role("address") && !role("city") && !role("state") && !role("zip");
    const noteCols = t.cols.filter(c => c.role === "note" || c.role === "keep");
    t.readCount = 0;   // rows that are people or gifts: not titles, labels or totals
    const tableSums = Object.fromEntries(moneyCols.map(c => [c.index, 0]));
    const sinceSubtotal = Object.fromEntries(moneyCols.map(c => [c.index, 0]));
    for (const b of t.body) {
      if (b.blank || b.repeatHeader) continue;
      const cells = b.cells;
      const filled = cells.filter(c => !isBlank(c));
      const nameText = nameCols.map(c => s(cells[c.index])).filter(Boolean).join(" ");
      const anyTotalWord = cells.some((c, i) => NUMERIC_TOTAL_RE.test(s(c)) && !moneyCols.some(m => m.index === i));
      // a section label ("October 2026") or a stray line inside the table
      if (filled.length === 1 && !moneyCols.some(m => !isBlank(cells[m.index]))) {
        const lbl = filled[0];
        if (!NUMERIC_TOTAL_RE.test(lbl)) { notes.push({ sheet: t.sheet, line: b.line, text: lbl, label: true }); continue; }
      }
      const moneyHere = moneyCols.filter(m => moneyOf(cellOf(t, b, m)) != null);
      // A row with no name is a total when it says so, or when it foots: its
      // amount is exactly the sum of the rows above it. Otherwise it is a row
      // with no name (a withdrawal, a stray line) and is listed, not read.
      const amtCol = moneyCols.find(m => m.role === "amount");
      const foots = amtCol && moneyHere.includes(amtCol) && (() => {
        const v = cents(moneyOf(cellOf(t, b, amtCol)));
        return v !== 0 && (v === tableSums[amtCol.index] || v === sinceSubtotal[amtCol.index]);
      })();
      const saysTotal = anyTotalWord || (nameText && NUMERIC_TOTAL_RE.test(nameText) && /^(sub-?total|grand total|total|totals|sum)\b/i.test(nameText));
      if (moneyHere.length && (saysTotal || (!nameText && t.kind === "gifts" && foots))) {
        // the label's words only: "TOTAL 178240" is a total, not "total for"
        const labelText = cells.filter(x => !isBlank(x) && !looksMoney(x)).join(" ");
        const isSub = /sub-?total|total for|total\s+[a-z]\w*/i.test(labelText) && !/grand total/i.test(labelText);
        for (const m of moneyHere) {
          const stated = cents(moneyOf(cellOf(t, b, m)));
          const against = isSub && sinceSubtotal[m.index] ? sinceSubtotal[m.index] : tableSums[m.index];
          totals.push({ sheet: t.sheet, line: b.line, column: t.header[m.index], role: m.role, statedCents: stated, sumCents: against, rowsAbove: t.readCount,
                        matches: stated === against, subtotal: isSub && !!sinceSubtotal[m.index], label: cells.filter(Boolean).filter(x => !looksMoney(x)).join(" ") || "Total" });
          sinceSubtotal[m.index] = 0;
        }
        continue;
      }
      t.readCount++;
      if (!nameText) {
        for (const m of moneyHere) { const v = cents(moneyOf(cellOf(t, b, m))); tableSums[m.index] += v; sinceSubtotal[m.index] += v; }
        const v = amtCol ? moneyOf(cellOf(t, b, amtCol)) : null;
        aside.push({ sheet: t.sheet, line: b.line, reason: "no name, email or organization on this row", cells: filled.slice(0, 6), cents: v != null ? cents(v) : null });
        continue;
      }
      // ── layer 1: who
      let who = readName({ first: get(b, "first"), last: get(b, "last"), full: get(b, "name"), lastFirst: get(b, "lastFirst"), org: get(b, "org") });
      let email = s(get(b, "email")).toLowerCase();
      if (email && placeholder.email.has(email)) email = "";
      const extId = s(get(b, "externalId"));
      if (!who.name && email) { who.kind = "person"; who.name = email; who.people = [{ name: "" }]; }
      const nameKey = who.kind + ":" + who.name.toLowerCase().replace(/[^a-z0-9& ]/g, "").replace(/\s+/g, " ");
      let pkey = null, linkedBy = null;
      if (extId && byId.has(extId.toLowerCase())) { pkey = byId.get(extId.toLowerCase()); linkedBy = "id"; }
      else if (email && byEmail.has(email)) { pkey = byEmail.get(email); linkedBy = "email"; }
      else if (byName.has(nameKey)) {
        const k = byName.get(nameKey), other = people.get(k);
        // the same name with a different email, or a different ID, is someone else
        const clash = (email && other.email && other.email !== email) || (extId && other.externalId && other.externalId.toLowerCase() !== extId.toLowerCase());
        if (!clash) { pkey = k; linkedBy = "name"; }
      }
      if (!pkey) pkey = extId ? "id:" + extId.toLowerCase() : email || nameKey;
      // a linked row keeps the person's own name, whatever the clipboard said
      if (linkedBy === "id") { const p0 = people.get(pkey); who = { kind: p0.kind, name: p0.name, household: p0.household, people: p0.people }; }
      const phoneRaw = s(get(b, "phone"));
      const phonePlaceholder = phoneRaw && placeholder.phone.has(phoneKey(phoneRaw));
      const stateV = s(get(b, "state"));
      const fresh = { key: pkey, name: who.name, kind: who.kind, household: who.household || null, people: who.people,
                      email: email || null, phone: phonePlaceholder ? null : (phoneRaw || null), address: s(get(b, "address")) || null,
                      address2: s(get(b, "address2")) || null, city: s(get(b, "city")) || null, state: stateV || null,
                      zip: fixZip(s(get(b, "zip")), stateV) || null, externalId: extId || null, lines: [],
                      roles: new Set(), attendance: null, comms: {}, kept: {}, flags: [] };
      if (oneColumnAddress && fresh.address) {
        const sp = splitAddress(fresh.address);
        if (sp.split) {
          fresh.addressFrom = fresh.address;
          Object.assign(fresh, { address: sp.address, address2: sp.address2, city: sp.city, state: sp.state, zip: sp.zip });
        } else if (sp.check) { fresh.addressCheck = fresh.address; fresh.flags.push(`Check this address: "${fresh.address}" could not be split into street, city, state and ZIP for sure, so it is kept whole`); }
      }
      // IMPORT-5 (7d): a note that says the phone or the address is bad flags that field (the note itself is kept as before)
      for (const c of noteCols) {
        const v = s(cellOf(t, b, c)); if (!v) continue;
        const nf = contactNoteFlags(v);
        const src = { header: c.header, value: v, sheet: t.sheet, line: b.line };
        if (nf.phoneBad && fresh.phone && !fresh.phoneBad) fresh.phoneBad = src;
        if (nf.addressBad && fresh.address && !fresh.addressBad) fresh.addressBad = src;
      }
      const zipRaw = s(get(b, "zip"));
      if (zipRaw && fresh.zip && fresh.zip !== zipRaw) fresh.flags.push(`ZIP ${zipRaw} read as ${fresh.zip} (the leading zero was lost)`);
      if (phonePlaceholder) fresh.flags.push(`the phone ${phoneRaw} is on ${contactNames.phone.get(phoneKey(phoneRaw)).size} different people in this file, so it was not copied`);
      if (s(get(b, "email")) && !email) fresh.flags.push(`the email ${s(get(b, "email"))} is on several different people in this file, so it was not copied`);
      // ── layers 2, 4, 5 on this row: roles, engagement, communication, kept
      const absorbRow = (person, tt, bb) => {
        const yes = r => { const c = role(r); return c ? truthy(cellOf(tt, bb, c)) : null; };
        if (tt.isVolunteer) person.roles.add("volunteer");
        if (yes("volunteer")) person.roles.add("volunteer");
        if (yes("board")) person.roles.add("board");
        if (yes("staff")) person.roles.add("staff");
        if (t.cols.some(c => ENGAGE_ROLES.has(c.role))) {
          const at = person.attendance || (person.attendance = { invited: false, rsvp: null, attended: false, table: null, party: null, logistics: [] });
          const inv = yes("invited"), rs = yes("rsvp"), att = yes("attended");
          if (inv) at.invited = true;
          if (rs === true) at.rsvp = true; else if (rs === false && at.rsvp == null) at.rsvp = false;
          if (att) at.attended = true;
          const tb = s(get(bb, "table")); if (tb && !at.table) at.table = /^\d+$/.test(tb) ? `Table ${tb}` : tb;
          const ps = s(get(bb, "partySize")); if (ps && /^\d{1,2}$/.test(ps) && !at.party) at.party = +ps;
          for (const c of tt.cols.filter(c => c.role === "logistics")) { const v = s(cellOf(tt, bb, c)); if (v) { const line = `${c.header}: ${v}`; if (!at.logistics.includes(line)) at.logistics.push(line); } }
          // anyone on a guest list was invited, even when no column says so
          if (!roleOf(tt, "invited") && (at.rsvp != null || at.attended)) at.invited = true;
          if (at.attended || at.rsvp) person.roles.add("guest");
        }
        const src = (c, v) => ({ header: c.header, value: v, sheet: tt.sheet, file: sourceFile });
        for (const r of COMMS_ROLES) {
          const c = role(r); if (!c) continue;
          const raw = s(cellOf(tt, bb, c)); if (!raw) continue;
          if (r === "mailingList") {
            if (OPT_OUT_WORDS.test(raw) || PLEASE_REMOVE_RE.test(raw)) person.comms.optOut = person.comms.optOut || src(c, raw);
            else if (truthy(raw) === true) person.comms.optIn = person.comms.optIn || src(c, raw);
            continue;
          }
          if (r === "optOut") { if (truthy(raw) === true || OPT_OUT_WORDS.test(raw)) person.comms.optOut = person.comms.optOut || src(c, raw); continue; }
          if (truthy(raw) === true) person.comms[r] = person.comms[r] || src(c, raw);
        }
        // "please remove" in any cell of the row
        if (!person.comms.optOut) for (const c of tt.cols) {
          if (COMMS_ROLES.has(c.role)) continue;
          const v = s(cellOf(tt, bb, c));
          if (v && PLEASE_REMOVE_RE.test(v)) { person.comms.optOut = src(c, v); break; }
        }
        for (const c of tt.cols.filter(c => c.role === "keep")) {
          const v = s(cellOf(tt, bb, c)); if (!v) continue;
          const k = c.header || `Column ${c.index + 1}`;
          if (!keptHeaders.has(k)) keptHeaders.set(k, { header: k, sheet: tt.sheet, count: 0 });
          const prev = person.kept[k];
          if (prev == null) { person.kept[k] = v; keptHeaders.get(k).count++; }
          else if (!String(prev).split("; ").includes(v)) person.kept[k] = `${prev}; ${v}`;
        }
      };
      const ensure = () => {
        if (!people.has(pkey)) {
          people.set(pkey, fresh);
          if (!linkedBy) {
            // a near miss: the same last name, a first name one or two letters off, nothing to confirm it
            const last = (who.name || "").split(/\s+/).pop().toLowerCase(), first = (who.name || "").split(/\s+/)[0].toLowerCase();
            for (const o of people.values()) {
              if (o === fresh || o.kind !== "person" || who.kind !== "person") continue;
              const ol = o.name.split(/\s+/).pop().toLowerCase(), of = o.name.split(/\s+/)[0].toLowerCase();
              if (ol === last && of !== first && editDistance(of, first) <= 2 && Math.min(of.length, first.length) >= 4) {
                nearMisses.push({ a: o.name, b: who.name, line: b.line, sheet: t.sheet, reason: "the same last name and a first name a letter or two apart, with no email or ID to confirm it, so they are kept as two people" });
                break;
              }
            }
          }
        }
        const person = people.get(pkey);
        // IMPORT-5 (7c): a row read into someone already on this list of people is accounted for, never silently gone
        if (person !== fresh && t.kind === "people") merged.push({ sheet: t.sheet, line: b.line, name: who.name, into: person.name, intoLine: person.lines[0], by: linkedBy || "name" });
        // the address is one block: it comes from one row, never a street from one and a city from another
        if (!person.address && fresh.address) for (const f of ["address", "address2", "city", "state", "zip", "addressFrom", "addressCheck", "addressBad"]) person[f] = fresh[f];
        for (const f of ["email", "phone", "address", "address2", "city", "state", "zip", "externalId"]) if (!person[f] && fresh[f]) person[f] = fresh[f];
        // a bad-number note is about the number on its own row
        if (fresh.phoneBad && person.phone && phoneKey(person.phone) === phoneKey(fresh.phone) && !person.phoneBad) person.phoneBad = fresh.phoneBad;
        if (fresh.addressBad && person.address === fresh.address && !person.addressBad) person.addressBad = fresh.addressBad;
        for (const fl of fresh.flags) if (!person.flags.includes(fl)) person.flags.push(fl);
        person.lines.push(`${t.sheet}:${b.line}`);
        if (person.externalId) byId.set(person.externalId.toLowerCase(), pkey);
        if (person.email) byEmail.set(person.email, pkey);
        if (!byName.has(nameKey)) byName.set(nameKey, pkey);
        absorbRow(person, t, b);
        return person;
      };
      if (t.kind === "people") { ensure(); continue; }

      // ── layer 3: money
      const amtRaw = get(b, "amount");
      const amt = moneyOf(amtRaw);
      for (const m of moneyCols) { const v = moneyOf(cellOf(t, b, m)); if (v != null) { tableSums[m.index] += cents(v); sinceSubtotal[m.index] += cents(v); } }
      if (amt == null) { aside.push({ sheet: t.sheet, line: b.line, who: who.name, reason: isBlank(amtRaw) ? "no amount on this row" : `the amount "${s(amtRaw)}" is not a number` }); continue; }
      if (amt === 0) { aside.push({ sheet: t.sheet, line: b.line, who: who.name, reason: "the amount is $0", cents: 0 }); continue; }
      if (amt < 0) {
        // HARDEN-1: "Purchase of Oakwell Horse" is money the org paid out, not a donor's refund
        const said = s(get(b, "note")) || s(get(b, "type"));
        const out = PAID_OUT_RE.test(said);
        aside.push({ sheet: t.sheet, line: b.line, who: who.name, cents: cents(amt),
                     reason: out ? `money paid out (${fmt$(cents(amt))}, "${said.slice(0, 60)}"), an expense, not a gift` : `a refund or reversal (${fmt$(cents(amt))}), not a gift` });
        continue;
      }
      const statusCol = role("status");
      const statusWord = s(get(b, "status")).toLowerCase();
      // a known export's own codes (DonorPerfect's G and P) read as the words they stand for
      const status = statusCol && statusCol.values && statusCol.values[statusWord] ? statusCol.values[statusWord] : statusWord;
      const type = s(get(b, "type"));
      if (type && TYPE_ASIDE.test(type) && !TYPE_GIFT.test(type)) { aside.push({ sheet: t.sheet, line: b.line, who: who.name, reason: `a ${type.toLowerCase()}, not a gift`, cents: cents(amt) }); continue; }
      if (status && STATUS_ASIDE.has(status)) { aside.push({ sheet: t.sheet, line: b.line, who: who.name, reason: `marked "${s(get(b, "status"))}" in your file`, cents: cents(amt) }); continue; }
      // when: a gift with a person and an amount always lands. No date, or a
      // date Steward cannot place in a day, is a gift with no date, flagged.
      let date = null, dateNote = null;
      if (dateCol) {
        const raw = get(b, "date");
        if (!isBlank(raw)) {
          const t0 = s(raw);
          if (FISCAL_RE.test(t0)) dateNote = `Date in your file: ${t0}`;
          else {
            date = dateOf(raw, { ...dctx, year: answers.year || null });
            if (date && MONTH_YEAR_RE.test(t0)) dateNote = `Date in your file: ${t0}`;
            if (!date) dateNote = `Date in your file: ${t0}`;
          }
          if (date && date > T) { aside.push({ sheet: t.sheet, line: b.line, who: who.name, reason: `dated ${date}, which is after today`, cents: cents(amt) }); continue; }
        }
      }
      if (!date && dateAnswer) date = dateAnswer;
      let datedBy = date ? (dateCol && !isBlank(get(b, "date")) ? "file" : "you") : null;
      if (!date && answers.useEventDate && eventDateAnswer) { date = eventDateAnswer; datedBy = "event"; }
      // paid or promised
      const rowKey = `${t.sheet}:${b.line}`;
      const pledgeList = /\bpledge/i.test(hnorm(t.header[(role("amount") || {}).index] || ""));
      let paid = !pledgeList, paidSource = pledgeList ? "file" : "default";
      const paidCol = role("paid");
      const methodRaw = s(get(b, "method"));
      if (/^pledge$/i.test(methodRaw)) { paid = false; paidSource = "file"; }
      if (paidCol) {
        const yn = yesNo(get(b, "paid"));
        if (yn === true) { paid = true; paidSource = "file"; }
        else if (yn === false) { paid = false; paidSource = "file"; }
        else {
          const a = answers.rows && answers.rows[rowKey];
          if (a === "gift") { paid = true; paidSource = "you"; }
          else if (a === "pledge") { paid = false; paidSource = "you"; }
          else if (a === "skip") { aside.push({ sheet: t.sheet, line: b.line, who: who.name, reason: "you left it out", cents: cents(amt) }); continue; }
          else {
            questions.push({ id: `row:${rowKey}`, kind: "row", key: rowKey, line: b.line, sheet: t.sheet, who: who.name, cents: cents(amt),
                             text: `Row ${b.line}: ${who.name}, ${fmt$(cents(amt))}. "${t.header[paidCol.index]}" is blank. Was it paid?`,
                             options: [{ key: "gift", label: "Paid, a gift" }, { key: "pledge", label: "Not yet, a pledge" }, { key: "skip", label: "Leave it out" }] });
            ensure();
            continue;
          }
        }
      } else if (status) {
        if (STATUS_PLEDGE.has(status)) { paid = false; paidSource = "file"; }
        else if (STATUS_PAID.has(status)) { paid = true; paidSource = "file"; }
        else if (yesNo(status) === false) { paid = false; paidSource = "file"; }
        else if (yesNo(status) !== true) {
          const a = answers.rows && answers.rows[rowKey];
          if (a === "gift") paid = true; else if (a === "pledge") paid = false;
          else if (a === "skip") { aside.push({ sheet: t.sheet, line: b.line, who: who.name, reason: "you left it out", cents: cents(amt) }); continue; }
          else {
            questions.push({ id: `row:${rowKey}`, kind: "row", key: rowKey, line: b.line, sheet: t.sheet, who: who.name, cents: cents(amt),
                             text: `Row ${b.line}: ${who.name}, ${fmt$(cents(amt))}, status "${s(get(b, "status"))}". Was it paid?`,
                             options: [{ key: "gift", label: "Paid, a gift" }, { key: "pledge", label: "Not yet, a pledge" }, { key: "skip", label: "Leave it out" }] });
            ensure();
            continue;
          }
        }
      }
      const methodCol = role("method");
      const inKind = /^(in[- ]?kind|ik)\b/i.test(s(amtRaw));
      const m = inKind ? { method: "In-kind", original: s(amtRaw), known: true }
        : methodCol ? methodOf(methodRaw) : (type && METHOD_MAP.some(([re]) => re.test(type)) ? methodOf(type) : { method: null, original: "", known: false });
      const freq = frequencyOf(get(b, "frequency"));
      const totalCol = role("pledgeTotal");
      const multiTotal = totalCol ? moneyOf(get(b, "pledgeTotal")) : null;
      const noteParts = [];
      if (s(get(b, "note"))) noteParts.push(s(get(b, "note")));
      for (const c of t.cols.filter(x => x.role === "giftNote")) { const v = s(cellOf(t, b, c)); if (v) noteParts.push(`${c.header || `Column ${c.index + 1}`}: ${v}`); }
      const catCell = s(get(b, "category"));
      const catCampaign = catCell && EVENT_APPEAL_WORDS.test(catCell) ? catCell : null;
      if (catCell && !catCampaign) noteParts.push(`${role("category").header || "Category"}: ${catCell}`);
      if (methodCol && !m.known && m.original && !/^pledge$/i.test(m.original)) noteParts.push(`Method in your file: ${m.original}`);
      if (methodCol && !m.original && !inKind) noteParts.push("Method in your file: blank");
      if (methodCol && m.known && /pledge|dist|stock|transfer/i.test(m.original) && m.original.toLowerCase() !== m.method.toLowerCase()) noteParts.push(`Method in your file: ${m.original}`);
      if (freq.kind === "unknown" && freq.original) noteParts.push(`Frequency in your file: ${freq.original}`);
      // HARDEN-1: a monthly word ("Reccuring") is kept on the gift as written; no plan is made from it
      if (freq.kind === "monthly" && freq.original) noteParts.push(`Frequency in your file: ${freq.original}`);
      if (dateNote) noteParts.push(dateNote);
      // a stable key for this row, so a second import adds nothing
      const sig = [hnorm(t.header.join("|")), who.name.toLowerCase(), email, cents(amt), methodRaw.toLowerCase(), freq.original.toLowerCase(),
                   s(get(b, "paid")).toLowerCase(), dateCol ? s(get(b, "date")) : "", s(get(b, "giftId")), extId.toLowerCase()].join("|");
      const n = (occ.get(sig) || 0) + 1; occ.set(sig, n);
      const rowId = hash(sig + "#" + n);
      const giftFlags = [];
      if (!date) giftFlags.push("no_date");
      if (methodCol && (!m.known || !m.original) && !inKind && !/^pledge$/i.test(m.original)) giftFlags.push("method_unknown");
      const base = { rowId, sheet: t.sheet, line: b.line, personKey: pkey, who: who.name, cents: cents(amt), date, datedBy, undated: !date,
                     method: m.method || (methodCol ? "Other" : null), methodOriginal: m.original || null,
                     fund: s(get(b, "fund")) || null, campaign: s(get(b, "campaign")) || catCampaign, externalId: s(get(b, "giftId")) || null,
                     note: noteParts.join(". ") || null, frequency: freq.kind, frequencyOriginal: freq.original || null, flags: giftFlags };
      const person = ensure();
      if (freq.kind === "monthly") flags.push({ personKey: pkey, who: who.name, flag: "monthly", cents: cents(amt), line: b.line, sheet: t.sheet });
      // IMPORT-5: a pledge's due dates come from the file, or from her answer
      // (the event's date, a date she chose, or "No set due date"). Never from
      // the day of the import: Steward does not make up a day.
      const ownDate = datedBy === "file" || datedBy === "you" ? date : null;
      const dueBase = ownDate || pledgeDueBase;
      if (!ownDate) noteParts.push(dueBase ? `Your file gave no date. Due dates count from ${dueBase}, ${answers.pledgeDue === "choose" ? "the date you chose" : "the event's date"}` : "No set due date");
      if (freq.kind === "multiYear" && freq.years > 1) {
        const yearly = cents(amt);
        const total = multiTotal != null && cents(multiTotal) > 0 ? cents(multiTotal) : yearly * freq.years;
        const installments = [];
        let remaining = total;
        for (let k = 0; k < freq.years; k++) {
          const amtK = k === freq.years - 1 ? remaining : Math.min(yearly, remaining);
          remaining -= amtK;
          installments.push({ seq: k + 1, dueDate: dueBase ? addYears(dueBase, k) : null, cents: amtK, paid: k === 0 && paid });
        }
        pledges.push({ ...base, datedBy: ownDate ? datedBy : (dueBase ? answers.pledgeDue : "none"), note: noteParts.join(". ") || null, kind: "pledge", pledgeCents: total, years: freq.years, installments, firstPaid: paid,
                       paidCents: paid ? yearly : 0, openCents: total - (paid ? yearly : 0),
                       thisYearCents: yearly, dueDate: dueBase, why: `"${freq.original}": ${fmt$(total)} over ${freq.years} years, ${fmt$(yearly)} a year` + (paid ? ", the first year paid" : "") });
        person.roles.add("pledger");
        if (paid) { gifts.push({ ...base, kind: "installment", installmentOf: rowId }); person.roles.add("donor"); personGiftCents.set(pkey, (personGiftCents.get(pkey) || 0) + yearly); }
        continue;
      }
      if (!paid) {
        pledges.push({ ...base, note: noteParts.join(". ") || null, kind: "pledge", pledgeCents: cents(amt), years: 1, thisYearCents: cents(amt), paidCents: 0, openCents: cents(amt),
                       installments: [{ seq: 1, dueDate: singleDue(dueBase), cents: cents(amt), paid: false }],
                       dueDate: singleDue(dueBase), datedBy: ownDate ? datedBy : (dueBase ? answers.pledgeDue : "none"), why: paidSource === "you" ? "you said not yet paid" : /^pledge$/i.test(methodRaw) ? `Method "Pledge": a promise, not yet paid`
                         : pledgeList && !paidCol ? `"${t.header[role("amount").index]}": a promise, not yet paid` : `"${t.header[(paidCol || role("status") || {}).index] || "Status"}" says not yet paid` });
        person.roles.add("pledger");
        continue;
      }
      gifts.push({ ...base, kind: "gift" });
      person.roles.add("donor");
      personGiftCents.set(pkey, (personGiftCents.get(pkey) || 0) + cents(amt));
    }
  }
  // "Gave at dinner" beside a gift sheet: skipped only when it foots, person by
  // person, against the gifts this file gives them; otherwise kept, never lost.
  const totalOfChecks = [];
  for (const t of usable) for (const c of t.cols.filter(c => c.role === "totalOf")) {
    let checked = 0, agree = 0;
    const misses = [];
    for (const b of dataRows(t)) {
      const v = moneyOf(cellOf(t, b, c)); if (v == null) continue;
      const pk = [...people.values()].find(p => p.lines.includes(`${t.sheet}:${b.line}`));
      checked++;
      if (pk && (personGiftCents.get(pk.key) || 0) === cents(v)) agree++;
      else misses.push({ line: b.line, cents: cents(v), gifts: pk ? (personGiftCents.get(pk.key) || 0) : 0 });
    }
    const footed = checked > 0 && giftTables.length > 0 && agree === checked;
    totalOfChecks.push({ sheet: t.sheet, header: c.header, checked, agree, footed, misses: misses.slice(0, 20) });
    if (footed) { c.skipReason = `a total of each person's gifts on the ${giftTables.map(g => g.sheet).join(" and ")} sheet (checked: all ${checked} agree to the cent)`; }
    else {
      c.role = "keep"; c.disposition = "kept"; c.reason = giftTables.length
        ? `it looks like a total, but ${checked - agree} of ${checked} people do not match their gifts here, so it is kept under its own name`
        : "a total with no gift rows behind it, kept under its own name";
      for (const b of dataRows(t)) {
        const v = s(cellOf(t, b, c)); if (!v) continue;
        const pk = [...people.values()].find(p => p.lines.includes(`${t.sheet}:${b.line}`));
        if (pk && pk.kept[c.header] == null) { pk.kept[c.header] = v; if (!keptHeaders.has(c.header)) keptHeaders.set(c.header, { header: c.header, sheet: t.sheet, count: 0 }); keptHeaders.get(c.header).count++; }
      }
    }
  }

  // ── the event: named by a title row, the file name, or her answer.
  // IMPORT-5 · DATES ARE ASKED, NEVER INVENTED. When the file names an event
  // (a guest list, a title row, or a file name with an event word) and holds
  // no dates, the event's date is a question that blocks: without it, every
  // gift would land "No date" and every pledge be due from a made-up day.
  const undatedCount = gifts.filter(g => !g.date).length;
  const suggestedEventName = eventNameFromTitles(tables) || eventNameFromFile(fileName);
  const evName = s(answers.eventName) || suggestedEventName || "";
  const fileHasDates = usable.some(t => t.cols.some(c => c.role === "date"));
  // a title row or a file name names the event only for a file with no dates:
  // a dated gift export called "Gala gifts" is gifts, not an event to create
  const eventNamed = !answers.notEvent && (hasEngagement || !!(answers.linkEvent && answers.eventName)
    || (!fileHasDates && !!(suggestedEventName && (eventNameFromTitles(tables) || EVENT_WORD_RE.test(suggestedEventName)))));
  const eventWanted = eventNamed || (answers.linkEvent && answers.eventName);
  // the gifts that would take the event's date: no date of their own
  const eventGiftCount = gifts.filter(g => !g.date || g.datedBy === "event").length;
  const undatedPledges = pledges.filter(p => p.datedBy !== "file" && p.datedBy !== "you");
  const rowsInFile = usable.reduce((a, t) => a + (t.readCount != null ? t.readCount : dataRows(t).length), 0);
  const eventNeedsDate = eventNamed && !eventDateAnswer && (eventGiftCount + undatedPledges.length > 0 || (hasEngagement && !fileHasDates));
  if (eventNamed) {
    const named = evName ? `the ${evName}` : "this event";
    questions.push({ id: "event", kind: "event", optional: !!evName && !eventNeedsDate, required: eventNeedsDate,
                     text: eventNeedsDate ? `When was ${named}?` : "What was this event called, and when?",
                     holds: fileHasDates ? null : `${rowsInFile.toLocaleString("en-US")} ${rowsInFile === 1 ? "row" : "rows"}, no dates`,
                     hint: eventNeedsDate ? `Your file names ${named} but gives no date, so Steward asks rather than make one up. Import waits for it.`
                       : "Steward found who was invited and who came.",
                     canSayNotEvent: !hasEngagement,
                     suggestedEventName: evName || null, suggestedDate: eventDateAnswer || answers.suggestedDate || null });
  }
  if (eventNamed && eventDateAnswer && eventGiftCount && typeof answers.useEventDate !== "boolean") {
    questions.push({ id: "eventGifts", kind: "useEventDate", count: eventGiftCount, eventName: evName || null, eventDate: eventDateAnswer,
                     text: `Use the ${evName || "event"} date for ${eventGiftCount === 1 ? "this gift" : `these ${eventGiftCount.toLocaleString("en-US")} gifts`}?`,
                     hint: "Yes dates them on the event's day. No leaves them No date: they count in Lifetime and the event's total, not in This year, a goal or retention.",
                     options: [{ key: "yes", label: "Yes" }, { key: "no", label: "No, leave them No date" }] });
  }
  // pledges: each needs a due date or an explicit "No set due date", asked once
  const pledgeDueAnswered = answers.pledgeDue === "none" || (answers.pledgeDue === "event" && !!eventDateAnswer) || (answers.pledgeDue === "choose" && !!pledgeDueDate);
  if (undatedPledges.length && !pledgeDueAnswered) {
    const multi = undatedPledges.filter(p => p.years > 1).length;
    questions.push({ id: "pledgeDue", kind: "pledgeDue", count: undatedPledges.length, multiYear: multi,
                     text: `When are ${undatedPledges.length === 1 ? "this pledge" : `these ${undatedPledges.length.toLocaleString("en-US")} pledges`} due?`,
                     hint: (eventDateAnswer ? `From the event's date: a one-year pledge is due by ${longIso(yearEnd(eventDateAnswer))}` : "Your file gives no due dates")
                       + (multi ? `; ${plural(multi, "multi-year pledge")} ${multi === 1 ? "gets" : "get"} a yearly installment from the first date.` : ".")
                       + " Steward never counts from the day of the import.",
                     options: [...(eventNamed ? [{ key: "event", label: "Same as the event date", needs: eventDateAnswer ? null : "the event's date" }] : []),
                               { key: "choose", label: "A date I choose" }, { key: "none", label: "No set due date" }] });
  }
  // undated gifts with no event are one optional question, never a block
  if (!eventNamed && undatedCount && !dateAnswer) {
    questions.unshift({ id: "date", kind: "date", optional: true, count: undatedCount,
                        text: undatedCount === 1 ? "1 gift has no date." : `${undatedCount.toLocaleString("en-US")} gifts have no date.`,
                        hint: "They import either way, each marked No date. They count in Lifetime and the event's total, never in This year, a goal or retention, until they have a date.",
                        suggestedEventName, suggestedDate: answers.suggestedDate || null, canUseEventDate: !!eventWanted });
  }
  // nothing readable at all is a question too, never "0 donors + 0 gift rows"
  if (!usable.length) {
    questions.push({ id: "nothing", kind: "nothing", text: "Steward could not find names or amounts in this file. Which sheet holds your people or gifts, and which columns are the names and amounts?" });
  }
  // help on columns blocks the import; informational help does not
  for (const h of help) if (!h.informational) questions.push({ id: `col:${h.key}`, kind: "column", ...h });

  // ── layer 2, finished: what each person is
  const peopleList = [...people.values()];
  for (const p of peopleList) {
    if (p.attendance && !p.roles.has("donor") && !p.roles.has("pledger") && (p.attendance.invited || p.attendance.rsvp != null)) p.roles.add("prospect");
    if (!p.roles.size) p.roles.add("contact");
    p.roles = [...p.roles];
    p.personTypes = personTypesFor(p.roles);
  }
  const giftCents = gifts.reduce((a, g) => a + g.cents, 0);
  const pledgeCents = pledges.reduce((a, p) => a + p.pledgeCents, 0);
  const pledgeOpenCents = pledges.reduce((a, p) => a + p.openCents, 0);
  const pledgeThisYear = pledges.reduce((a, p) => a + p.thisYearCents, 0);
  // FIX-55: what is still to come this calendar year (unpaid installments due
  // by Dec 31), and the longest pledge in years, so money says which it is
  const yearEndT = `${T.slice(0, 4)}-12-31`;
  const pledgeDueThisYear = pledges.reduce((a, p) => a + (p.installments || []).filter(i => !i.paid && i.dueDate && i.dueDate <= yearEndT).reduce((x, i) => x + i.cents, 0), 0);
  const pledgeYears = pledges.reduce((a, p) => Math.max(a, p.years || 1), 0);
  const pledgeUndatedCents = pledges.reduce((a, p) => a + (p.installments || []).filter(i => !i.paid && !i.dueDate).reduce((x, i) => x + i.cents, 0), 0);
  const paidInstallments = gifts.filter(g => g.kind === "installment").reduce((a, g) => a + g.cents, 0);
  const unpaidRowCents = pledges.filter(p => !p.firstPaid).reduce((a, p) => a + p.thisYearCents, 0);
  // "raised" in the file's own terms: this year's amount on every row read
  const rowCents = gifts.filter(g => g.kind === "gift").reduce((a, g) => a + g.cents, 0) + pledgeThisYear;
  const asideCents = aside.reduce((a, x) => a + (x.cents || 0), 0);
  const ready = questions.filter(q => q.kind !== "info" && !q.optional).length === 0;
  const totalsSentence = totals.filter(t => !t.subtotal && t.role === "amount").map(t => {
    if (!t.matches) return `Your total row says ${fmt$(t.statedCents)}, but the rows above it add up to ${fmt$(t.sumCents)}.`;
    const parts = [`${plural(gifts.length, "gift")} (${fmt$(giftCents)})`];
    if (unpaidRowCents) parts.push(`${fmt$(unpaidRowCents)} promised and not yet received (${plural(pledges.filter(p => !p.firstPaid).length, "row")})`);
    if (asideCents) parts.push(`${fmt$(asideCents)} set aside`);
    return `Your total row says ${fmt$(t.statedCents)}, and the ${plural(t.rowsAbove, "row")} above it add up to ${fmt$(t.sumCents)}: ${parts.join(", ")}.`;
  });
  // the column account: every column is mapped, kept, or skipped with a reason
  const columnList = [];
  for (const t of tables) for (const c of t.cols) columnList.push({ table: t.key, sheet: t.sheet, index: c.index, header: c.header || `(column ${c.index + 1})`,
    disposition: c.disposition, role: c.role, roleLabel: c.role ? ROLE_LABELS[c.role] : null, reason: c.disposition === "skipped" ? c.skipReason : c.reason,
    links: !!c.links, sample: c.profile.sample.slice(0, 3) });
  const columnAccount = { total: columnList.length, mapped: 0, kept: 0, skipped: 0, question: 0 };
  for (const c of columnList) columnAccount[c.disposition] = (columnAccount[c.disposition] || 0) + 1;
  const att = peopleList.filter(p => p.attendance);
  // counted in people, as they land: a couple's row is two attendances
  const members = p => Math.max(1, p.people.length);
  const comm = k => peopleList.filter(p => p.comms[k]).length;
  const persons = peopleList.reduce((a, p) => a + Math.max(1, p.people.length), 0);
  // IMPORT-5 (7c): every row of a list of people is a person, a row merged into
  // one, or a row set aside, and the line says so: "656 rows · 650 people · 6 merged"
  const rowAccount = (() => {
    const pt = usable.filter(t => t.kind === "people");
    if (!pt.length || giftTables.length) return null;
    const keys = new Set(pt.map(t => t.sheet));
    const rows = pt.reduce((a, t) => a + (t.readCount || 0), 0);
    const asideRows = aside.filter(x => keys.has(x.sheet)).length;
    const parts = [plural(rows, "row"), plural(peopleList.length, "person", "people")];
    if (merged.length) parts.push(`${merged.length.toLocaleString("en-US")} merged with a near-duplicate`);
    if (asideRows) parts.push(`${asideRows.toLocaleString("en-US")} set aside`);
    return { rows, people: peopleList.length, merged: merged.length, aside: asideRows, balanced: rows === peopleList.length + merged.length + asideRows, sentence: parts.join(" · ") };
  })();
  // FIX-52 · THE SHEET'S OWN FIGURES. Counts written above a header ("People
  // 443", "Invited 422") are notes, never people, and the preview's counts are
  // checked against them. A sheet counts rows; a couple's row is one row and
  // two people, so either reading agrees, and a difference is said plainly.
  const recordCounts = {
    people: peopleList.length,
    invited: att.filter(p => p.attendance.invited).length,
    rsvp: att.filter(p => p.attendance.rsvp === true).length,
    attended: att.filter(p => p.attendance.attended).length,
  };
  const personCounts = {
    people: persons,
    invited: att.filter(p => p.attendance.invited).reduce((a, p) => a + members(p), 0),
    rsvp: att.filter(p => p.attendance.rsvp === true).reduce((a, p) => a + members(p), 0),
    attended: att.filter(p => p.attendance.attended).reduce((a, p) => a + members(p), 0),
  };
  const WORD = { people: "people", invited: "invited", rsvp: "RSVP'd", attended: "attended" };
  const figureChecks = [];
  for (const t of tables) if (t.kind === "people") for (const ti of t.titles || []) {
    const m = s(ti.text).match(SHEET_FIGURE_RE);
    const kind = m && figureKind(m[1]);
    if (!kind || figureChecks.some(f => f.kind === kind)) continue;
    const stated = Number(m[2].replace(/,/g, ""));
    notes.push({ sheet: t.sheet, line: ti.line, text: s(ti.text), figure: true });
    const rows = recordCounts[kind], ppl = personCounts[kind];
    const agrees = stated === rows || stated === ppl;
    figureChecks.push({ sheet: t.sheet, line: ti.line, label: m[1].trim(), kind, stated, steward: rows, persons: ppl, agrees,
      sentence: agrees
        ? (rows !== ppl ? `${t.sheet} says ${m[1].trim()} ${stated}: Steward reads ${rows.toLocaleString("en-US")} rows, ${ppl.toLocaleString("en-US")} people (a couple's row is two).` : `${t.sheet} says ${m[1].trim()} ${stated}, and Steward reads the same.`)
        : `${t.sheet} says ${m[1].trim()} ${stated}, but Steward reads ${rows.toLocaleString("en-US")} ${WORD[kind] === "people" ? "rows" : WORD[kind]}${rows !== ppl ? ` (${ppl.toLocaleString("en-US")} people)` : ""}. Check before importing.` });
  }
  return {
    fileKind, ready, knownShape: knownShapeSentence(tables.filter(t => t.kind === "gifts" || t.kind === "people").map(t => t.shape)),
    tables: tables.map(t => ({ key: t.key, sheet: t.sheet, headerLine: t.headerLine, kind: t.kind, titles: t.titles, isVolunteer: !!t.isVolunteer,
      rows: t.readCount != null ? t.readCount : dataRows(t).length,
      columns: t.cols.map(c => ({ index: c.index, header: c.header, role: c.role, roleLabel: c.role ? ROLE_LABELS[c.role] : null, by: c.by,
        reason: c.disposition === "skipped" ? c.skipReason : c.reason, disposition: c.disposition, links: !!c.links, sample: c.profile.sample })),
      refused: t.refused })),
    people: peopleList, gifts, pledges, aside, totals, flags, notes, questions, help, nearMisses, totalOfChecks, merged, rowAccount,
    addressExample: (() => { const p = peopleList.find(x => x.addressFrom); return p ? { from: p.addressFrom, address: p.address, address2: p.address2, city: p.city, state: p.state, zip: p.zip } : null; })(),
    columns: columnList, columnAccount, keptHeaders: [...keptHeaders.values()], notesSheets, figureChecks,
    placeholders: [...[...placeholder.email].map(v => ({ kind: "email", value: v, people: contactNames.email.get(v).size })),
                   ...[...placeholder.phone].map(v => ({ kind: "phone", value: contactShown.phone.get(v) || v, people: contactNames.phone.get(v).size }))],
    event: eventWanted ? { name: answers.eventName || suggestedEventName || null, date: eventDateAnswer, fromEngagement: hasEngagement, named: eventNamed } : null,
    counts: {
      people: persons, persons, records: peopleList.length,
      households: peopleList.filter(p => p.household).length,
      organizations: peopleList.filter(p => p.kind === "organization").length,
      donors: peopleList.filter(p => p.roles.includes("donor")).length,
      pledgers: peopleList.filter(p => p.roles.includes("pledger")).length,
      volunteers: peopleList.filter(p => p.roles.includes("volunteer")).length,
      board: peopleList.filter(p => p.roles.includes("board")).length,
      staff: peopleList.filter(p => p.roles.includes("staff")).length,
      guests: peopleList.filter(p => p.roles.includes("guest")).reduce((a, p) => a + Math.max(1, p.people.length), 0),
      prospects: peopleList.filter(p => p.roles.includes("prospect")).length,
      contacts: peopleList.filter(p => p.roles.includes("contact")).length,
      gifts: gifts.length, giftCents, undatedGifts: gifts.filter(g => !g.date).length, undatedGiftCents: gifts.filter(g => !g.date).reduce((a, g) => a + g.cents, 0),
      pledges: pledges.length, pledgeCents, pledgeOpenCents, pledgeThisYearCents: pledgeThisYear, pledgeDueThisYearCents: pledgeDueThisYear, pledgeYears, pledgeUndatedCents,
      paidInstallmentCents: paidInstallments, rowCents, aside: aside.length, asideCents, monthly: flags.length,
      invited: att.filter(p => p.attendance.invited).reduce((a, p) => a + members(p), 0),
      rsvp: att.filter(p => p.attendance.rsvp === true).reduce((a, p) => a + members(p), 0),
      attended: att.filter(p => p.attendance.attended).reduce((a, p) => a + members(p), 0),
      optOuts: comm("optOut"), doNotContact: comm("doNotContact"), doNotMail: comm("doNotMail"), doNotCall: comm("doNotCall"),
      doNotEmail: comm("doNotEmail"), deceased: comm("deceased"), optIns: comm("optIn"),
      kept: keptHeaders.size, nearMisses: nearMisses.length, merged: merged.length,
      addressesSplit: peopleList.filter(p => p.addressFrom).length, addressesToCheck: peopleList.filter(p => p.addressCheck).length,
      phonesMarkedWrong: peopleList.filter(p => p.phoneBad).length, addressesMarkedReturned: peopleList.filter(p => p.addressBad).length,
      invitedRecords: recordCounts.invited, rsvpRecords: recordCounts.rsvp, attendedRecords: recordCounts.attended,
    },
    totalsSentence, needsDate: undatedCount > 0,
  };
}

// person_types (BUILD-94) from the roles: a pledger is a donor too; a person
// who only came, was invited, or is listed is a contact ("other"), never a donor.
function personTypesFor(roles) {
  const out = [];
  if (roles.includes("donor") || roles.includes("pledger")) out.push("donor");
  if (roles.includes("volunteer")) out.push("volunteer");
  if (roles.includes("board") || roles.includes("staff")) out.push("staff_board");
  return out.length ? out : ["other"];
}
// yes / x / a date → true; no → false; anything else → null
function truthy(v) {
  if (v == null || v === "") return null;
  const yn = yesNo(v);
  if (yn === true || yn === false) return yn;
  const t = s(v).toLowerCase();
  if (/^(attended|came|checked in|here|present|rsvp'?d|registered|coming|going|accepted|invited|sent|y\b)/.test(t)) return true;
  if (/^(declined|not coming|regrets|absent|no show|no-show)/.test(t)) return false;
  if (looksDate(v, { serials: true })) return true;
  return null;
}
// A ZIP that lost its leading zero ("2134") in a state whose ZIPs start with 0.
const ZERO_ZIP_STATES = new Set(["CT", "MA", "ME", "NH", "NJ", "PR", "RI", "VT", "VI", "GU"]);
function fixZip(z, state) {
  if (!z) return z;
  const m = z.match(/^(\d{4})(-\d{4})?$/);
  if (!m) return z;
  const st = s(state).toUpperCase();
  if (st && !ZERO_ZIP_STATES.has(st)) return z;
  return "0" + z;
}
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// The one line the Import button says: what will exist afterwards (rule C).
// More than 5% of the people or the dollars set aside, and it asks for a
// review first instead.
export function importButtonSentence(u, extra = {}) {
  const c = u.counts || {};
  const asideShare = (c.aside || 0) / Math.max(1, (c.records || 0) + (c.aside || 0));
  const money = (c.giftCents || 0) + (c.pledgeThisYearCents || 0);
  const asideMoney = (u.aside || []).reduce((a, x) => a + Math.abs(x.cents || 0), 0);
  const review = !!(c.aside && (asideShare > 0.05 || asideMoney > 0.05 * Math.max(1, money + asideMoney)));
  const parts = [];
  const sub = [];
  if (c.donors) sub.push(plural(c.donors, "donor"));
  if (c.volunteers) sub.push(plural(c.volunteers, "volunteer"));
  parts.push(`${plural(c.persons || 0, "person", "people")}${sub.length ? ` (${sub.join(", ")})` : ""}`);
  if (c.gifts) parts.push(`${plural(c.gifts, "gift")} ${fmt$(c.giftCents)}${c.undatedGifts ? ` (${c.undatedGifts.toLocaleString("en-US")} undated)` : ""}`);
  if (c.pledges) parts.push(`${plural(c.pledges, "pledge")} ${pledgeMoneyWords({ dueThisYearCents: c.pledgeDueThisYearCents, openCents: c.pledgeOpenCents, years: c.pledgeYears, undatedCents: c.pledgeUndatedCents }, fmt$)}`);
  if (u.event && u.event.name && u.event.fromEngagement) parts.push(`${u.event.name}: ${c.attended.toLocaleString("en-US")} attended`);
  if (c.optOuts) parts.push(plural(c.optOuts, "opt-out"));
  if (c.doNotContact) parts.push(`${c.doNotContact.toLocaleString("en-US")} do not contact`);
  if (extra.matched) parts.push(`${extra.matched.toLocaleString("en-US")} already in Steward`);
  if (extra.waiting) parts.push(`${extra.waiting.toLocaleString("en-US")} waiting on your answer`);
  const importText = "Import " + parts.join(" · ");
  return review ? { review, text: `Review ${c.aside.toLocaleString("en-US")} set aside first`, importText } : { review, text: importText, importText };
}

function addYears(iso, k) {
  const [y, m, d] = iso.split("-").map(Number);
  const dd = (m === 2 && d === 29 && k % 4) ? 28 : d;
  return `${y + k}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}
function yearEnd(iso) { return `${iso.slice(0, 4)}-12-31`; }
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function longIso(iso) { return `${MONTH_NAMES[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}`; }
// FNV-1a, 32-bit, twice with different seeds → 16 hex. Stable across Node and browsers.
function hash(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c; h2 = Math.imul(h2, 0x5bd1e995) >>> 0; h2 ^= h2 >>> 13;
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

// What a model is shown and what it may answer: the headers and a sample of
// rows, never the whole file, and only a role per column back. Its answer
// goes through applyOverrides like a person's, so a role the cells refute is
// refused there.
export const MAPPING_TOOL = {
  name: "propose_column_roles",
  description: "Propose what each spreadsheet column is. Only columns you are confident about.",
  input_schema: {
    type: "object", additionalProperties: false, required: ["columns"],
    properties: { columns: { type: "array", items: { type: "object", additionalProperties: false, required: ["index", "role"],
      properties: { index: { type: "integer" }, role: { type: "string", enum: Object.keys(ROLE_LABELS) } } } } },
  },
};
export function modelPrompt(table) {
  const rows = dataRows(table).slice(0, 8).map(b => b.cells);
  return `A small nonprofit's spreadsheet. Columns (index: header):\n${table.header.map((h, i) => `${i}: ${h || "(no header)"}`).join("\n")}\n\nFirst rows:\n${rows.map(r => r.join(" | ")).join("\n")}\n\nRoles: ${Object.entries(ROLE_LABELS).map(([k, v]) => `${k} (${v})`).join(", ")}.`;
}
export function tablesForModel(sheets) {
  const out = [];
  for (const sh of sheets || []) findTables(sh.name, sh.grid || []).tables.forEach((t, i) => out.push({ key: `${sh.name}#${i + 1}`, table: t }));
  return out;
}

// IMPORT-5 · SAVED MAPPINGS. Her answers about a file's columns are kept per
// org against the file's header set (every table's headers, normalised, order
// and sheet names ignored), by header, never by position, so the next export
// from the same system reads with no column questions.
const mapHeader = h => s(h).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function headerSetKey(sheets) {
  const hs = new Set();
  for (const { table } of tablesForModel(sheets)) for (const h of table.header) { const k = mapHeader(h); if (k) hs.add(k); }
  return hs.size ? "sheet:" + [...hs].sort().join("|") : null;
}
export function fileHeaders(sheets) {
  const hs = [];
  for (const { table } of tablesForModel(sheets)) for (const h of table.header) if (s(h) && !hs.includes(s(h))) hs.push(s(h));
  return hs;
}
// overrides { "<table>|<index>": role } → { "<normalised header>": role }
export function mappingFromOverrides(sheets, overrides = {}) {
  const out = {};
  for (const { key, table } of tablesForModel(sheets)) for (const [k, role] of Object.entries(overrides || {})) {
    const [tk, idx] = String(k).split("|");
    if (tk !== key || !(role in ROLE_LABELS)) continue;
    const h = mapHeader(table.header[+idx]);
    if (h) out[h] = role;
  }
  return out;
}
// the reverse, for this file's positions
export function overridesFromMapping(sheets, mapping = {}) {
  const out = {};
  for (const { key, table } of tablesForModel(sheets)) table.header.forEach((h, i) => {
    const role = mapping[mapHeader(h)];
    if (role && role in ROLE_LABELS) out[`${key}|${i}`] = role;
  });
  return out;
}
export function roleLabel(role) { return ROLE_LABELS[role] || null; }

// When the file should be read by this reader rather than the column mapper:
// whenever the mapper would dead-end ("shape unclear", "0 donors + 0 gift
// rows") or misread it. A file with no date column, a paid/pledge/frequency
// column, more than one table on a sheet, or nothing it recognises.
export function wantsAdaptiveReading(sheets, roled = null) {
  if (roled && roled.some(s => s.role === "unknown")) return true;
  if (roled && !roled.some(s => ["donors", "gifts", "pledges", "recurring"].includes(s.role))) return true;
  // IMPORT-4: a file that knows who came, who volunteers or who said don't
  // email me, or whose gifts have no date, is read in layers here. The column
  // mapper would set those gifts aside and leave those columns out (26 Oct:
  // "Import 443 donors + 0 gifts" for an event workbook with 106 gifts).
  const u0 = understand({ sheets });
  const LAYER_ROLES = new Set([...ENGAGE_ROLES, ...COMMS_ROLES, ...ROLE_FLAG_ROLES]);
  if (u0.tables.some(tb => tb.isVolunteer || tb.columns.some(c => LAYER_ROLES.has(c.role)))) return true;
  if (u0.counts.undatedGifts > 0) return true;
  // a workbook the workbook flow already reads (a donors sheet and a gifts
  // sheet, every sheet with a role) stays there
  if (roled && roled.filter(s => s.rowCount > 0 && s.role !== "chrome").length > 1) return false;
  const u = u0;
  if (u.fileKind === "unknown") return true;
  // No date column: an event night's sheet, unless the file is one row per
  // donor with running totals (Total Giving, Last Gift, year columns), which
  // the column mapper reads as an aggregate file.
  const AGG_HDR = /total|lifetime|last gift|ytd|cumulative|\b(19|20)\d\d\b|first gift|largest/i;
  const aggregate = u.tables.some(tb => tb.columns.some(c => c.role !== "pledgeTotal" && AGG_HDR.test(String(c.header || ""))));
  if (u.fileKind === "gifts" && u.needsDate && !aggregate) return true;
  const perSheet = new Map();
  for (const tb of u.tables) if (tb.kind === "gifts" || tb.kind === "people") perSheet.set(tb.sheet, (perSheet.get(tb.sheet) || 0) + 1);
  if ([...perSheet.values()].some(n => n > 1)) return true;
  // what the mapper misreads: a paid/promised column, a multi-year pledge,
  // a pledge list, couples ("Suzanna & Walt"), total and subtotal rows, and
  // dates with no year ("Oct 22")
  if (u.tables.some(tb => tb.columns.some(c => ["paid", "pledgeTotal"].includes(c.role)))) return true;
  if (u.pledges.some(p => p.years > 1) || (u.pledges.length && !u.gifts.length)) return true;
  // couples, when there is no email to tell people apart (an event sheet);
  // subtotals (one TOTAL line the mapper already reads as chrome)
  const hasEmail = u.tables.some(tb => tb.columns.some(c => c.role === "email"));
  if ((u.counts.households > 0 && !hasEmail) || u.totals.filter(x => x.role === "amount").length > 1) return true;
  return u.tables.some(tb => tb.columns.some(c => c.role === "date" && (c.sample || []).some(v => /^[A-Za-z]{3,9}\.?\s+\d{1,2}$/.test(String(v).trim()))));
}

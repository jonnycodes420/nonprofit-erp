// BUILD-95 — READING A CHEQUE.
//
// A cheque carries its amount TWICE: the digits in the box (the bank calls it
// the courtesy amount) and the words on the line (the legal amount). A bank
// pays the words when they disagree, and it disagrees often enough to have a
// rule about it.
//
// That is the whole design here. Steward does not ask a model how confident it
// is — a model saying "90%" is not evidence of anything. It asks the model to
// TRANSCRIBE both amounts and then does the arithmetic itself, in this module,
// against `shared/money.js`'s one parser. Two independent readings that agree
// to the cent is a real check; a self-reported confidence is a feeling.
//
// THE MODEL READS GLYPHS AND NOTHING ELSE. It never decides who the donor is,
// which fund it belongs to, or whether the money is a gift at all — every one
// of those decisions stays in `shared/depositSheet.js`, where a human is
// standing. A read fills in a line; the deposit sheet still places it, and
// still refuses to place what it cannot back.

// Claude Opus 5. A cheque is handwriting, often in cursive, sometimes in pen
// that has run — this is the wrong place to economise, because a misread digit
// lands on somebody's giving record.
export const CHEQUE_READ_MODEL = "claude-opus-5";
export const CHEQUE_READ_MAX_IMAGES = 20;

// What the model is allowed to say. Every field is nullable BY DESIGN: a
// cheque where the memo line is blank must come back blank, not filled with
// the model's best idea of what a memo would say.
export const CHEQUE_READ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["amountDigits", "amountWords", "payer", "memo", "chequeNumber", "date", "unreadable"],
  properties: {
    amountDigits: { type: ["string", "null"], description: "The amount in the box, transcribed EXACTLY as written, digits and punctuation only. null if not legible." },
    amountWords:  { type: ["string", "null"], description: "The amount line, transcribed VERBATIM including any fraction such as 00/100. null if not legible." },
    payer:        { type: ["string", "null"], description: "The name PRINTED on the check (top left), not the signature. null if not legible." },
    memo:         { type: ["string", "null"], description: "The memo/for line, verbatim. null if blank or not legible." },
    chequeNumber: { type: ["string", "null"], description: "The check number, top right. null if not legible." },
    date:         { type: ["string", "null"], description: "The date line, verbatim as written. null if not legible." },
    unreadable:   { type: "array", items: { type: "string" }, description: "Field names that could not be read, and why in a few words." },
  },
};

export const CHEQUE_READ_PROMPT = [
  "You are transcribing a photograph of a paper check for a nonprofit's bookkeeper.",
  "",
  "Transcribe ONLY what is written. Do not interpret, correct, complete or tidy anything.",
  "",
  "- Transcribe the two amounts SEPARATELY and INDEPENDENTLY. Do not let one influence",
  "  your reading of the other, and never copy one into the other's field. They are",
  "  checked against each other afterwards, which only works if they are read apart.",
  "- The payer is the name PRINTED on the check, not the signature.",
  "- A field you cannot read confidently is null, and its name goes in `unreadable`.",
  "  A blank left blank costs one line of typing. A guess costs somebody's record.",
  "- Never infer an amount from the other fields, and never round.",
].join("\n");

const ONES = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9,
  ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16,
  seventeen:17, eighteen:18, nineteen:19 };
const TENS = { twenty:20, thirty:30, forty:40, fourty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90 };
const SCALES = { hundred:100, thousand:1000, million:1000000 };

// The cents as people write them on a check (VOICE-2): a fraction over 100,
// with "xx" or "--" standing in for either side ("17/xx", "xx/100", "17/--").
// The numerator is the cents; a placeholder numerator is no cents.
const FRAC = /(?:^|\s)(\d{1,2}|no|xx|x|zero|-{1,2})\s*\/\s*(?:100|xx|x|-{1,2})\s*$/;
function fracCents(f) { return /^\d+$/.test(f) ? Number(f) : 0; }

// "Two hundred fifty and 00/100" → 25000 cents. Returns null when the words do
// not parse, which is a REFUSAL, not a zero. VOICE-2: "&" and "+" read as
// "and" ("Two hundred & fifty dollars + 17/100" is $250.17), and the fraction
// may use a placeholder ("17/xx", "xx/100").
export function writtenAmountToCents(raw) {
  if (!raw) return null;
  let s = String(raw).toLowerCase().replace(/[*—–_]+/g, " ").replace(/[&+]/g, " and ").trim();
  s = s.replace(/\bdollars?\b/g, " ").replace(/\bonly\b/g, " ").replace(/\bcents?\b/g, " ").replace(/\s+/g, " ").trim();

  // The cents ride a fraction over 100. It is always the LAST thing on the
  // line, which is what separates it from a British "one hundred and fifty".
  let cents = 0;
  const frac = s.match(FRAC);
  if (frac) {
    cents = fracCents(frac[1]);
    s = s.slice(0, frac.index);
  }
  s = s.replace(/\band\s*$/, " ").trim();
  if (!s) return null;

  // A written amount may be part numeric ("1,250 and 00/100"), which is a real
  // thing people do and is still two independent readings.
  const bare = s.replace(/[,\s]/g, "");
  if (/^\d+$/.test(bare)) return Number(bare) * 100 + cents;

  const words = s.split(/[\s-]+/).filter(w => w && w !== "and");
  if (!words.length) return null;

  let total = 0, run = 0, saw = false;
  for (const w of words) {
    if (w in ONES) { run += ONES[w]; saw = true; }
    else if (w in TENS) { run += TENS[w]; saw = true; }
    else if (w in SCALES) {
      if (!saw) return null;                      // "hundred" with nothing before it
      if (SCALES[w] === 100) run *= 100;
      else { total += (run || 1) * SCALES[w]; run = 0; }
    } else if (/^\d+$/.test(w)) { run += Number(w); saw = true; }
    else return null;                             // an unknown word is a refusal
  }
  if (!saw) return null;
  return (total + run) * 100 + cents;
}

// The figures in the box (VOICE-2). People write the cents in the box the same
// way as on the line: "$250 17/xx", "250 xx/100", "$75 17/--", or the
// superscript "250^17" that a transcription reads as "250 17". Anything else
// goes to `fallback` (the app's one money parser, normalizeMoney), so "250.17"
// and "$1,250.00" read exactly as they always have. null is a refusal.
export function chequeDigitsToCents(raw, fallback) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().replace(/^\$\s*/, "").replace(/\s*(?:dollars?|usd)\s*$/i, "").trim();
  const m = s.match(/^(\d{1,3}(?:,\d{3})+|\d+)(?:\.|\s+|-)?\s*(\d{1,2}|xx|x|no|-{1,2})\s*\/\s*(?:100|xx|x|-{1,2})$/i);
  if (m) return Number(m[1].replace(/,/g, "")) * 100 + fracCents(m[2].toLowerCase());
  if (typeof fallback === "function") {
    const v = fallback(String(raw));
    return Number.isFinite(v) ? v : null;
  }
  const n = s.replace(/,/g, "");
  return /^\d+(\.\d{1,2})?$/.test(n) ? Math.round(Number(n) * 100) : null;
}

// THE CROSS-CHECK. This is the whole reason a read can be trusted at all.
//
// `digitsCents` comes from Steward's one money parser; `wordsCents` from the
// function above. Agreement to the CENT is the only outcome that fills in an
// amount. Anything else states what it saw and leaves the line to the person.
export function reconcileAmount(digitsCents, wordsCents) {
  const d = Number.isFinite(digitsCents) ? digitsCents : null;
  const w = Number.isFinite(wordsCents) ? wordsCents : null;
  if (d !== null && w !== null) {
    if (d === w) return { cents: d, agreed: true, reason: "the figures and the words agree" };
    // The bank's rule is that the words win. Steward does NOT apply it: a bank
    // is reading the cheque it is about to pay, and Steward is reading a
    // photograph of one somebody has already banked.
    return { cents: null, agreed: false, reason: "the figures and the words disagree", digits: d, words: w };
  }
  if (d !== null) return { cents: null, agreed: false, reason: "only the figures could be read", digits: d };
  if (w !== null) return { cents: null, agreed: false, reason: "only the words could be read", words: w };
  return { cents: null, agreed: false, reason: "neither amount could be read" };
}

// The sentence the line carries when the read did not settle it. Written here
// so the screen, the count and any future surface say the same thing.
export function unsettledSentence(rec, money) {
  const f = c => money(c);
  if (rec.reason === "the figures and the words disagree")
    return `The box says ${f(rec.digits)} and the line says ${f(rec.words)}. Type the amount.`;
  if (rec.reason === "only the figures could be read")
    return `Only the figures could be read (${f(rec.digits)}). Check them against the line and type the amount.`;
  if (rec.reason === "only the words could be read")
    return `Only the written amount could be read (${f(rec.words)}). Check it against the box and type the amount.`;
  return "Neither amount could be read. Type it from the check.";
}

export const CHEQUE_READ_NOTE =
  "Steward read these from the photographs. Nothing is recorded until you commit the deposit.";

// WHO THE CHECK IS MADE OUT TO (VOICE-2). A check made out to somebody else
// ("Pay to the order of Captain Hook") is not the org's money, however it
// arrived. `payeeMismatch` says so in one sentence, and the confirm waits for
// "Log it anyway". Forgiving on purpose: case, punctuation, "the", "Inc",
// common abbreviations, a shortened name ("Harborlight" for "Harborlight Youth
// Collective") and the initials all count as the org. A blank payee (or one
// that could not be read) is no warning. `orgNames` is every name the org goes
// by (display name first: the one the sentence uses).
const PAYEE_DROP = new Set(["the", "inc", "incorporated", "llc", "ltd", "corp", "corporation", "co", "company", "nfp", "pbc", "a"]);
const PAYEE_ABBR = { ctr: "center", cntr: "center", centre: "center", assn: "association", assoc: "association", intl: "international",
  fdn: "foundation", fndn: "foundation", found: "foundation", svcs: "services", svc: "services", soc: "society", univ: "university",
  dept: "department", natl: "national", amer: "american", mt: "mount", ft: "fort", org: "organization", orgn: "organization" };
const NOT_A_NAME = /^(cash|bearer|n\/?a|none|blank|illegible|unreadable)$/;
export function payeeWords(name) {
  return String(name || "").toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ")
    .split(" ").filter(Boolean).map(w => PAYEE_ABBR[w] || w).filter(w => !PAYEE_DROP.has(w));
}
function payeeIsOrg(payee, orgName) {
  const p = payeeWords(payee), o = payeeWords(orgName);
  if (!p.length || !o.length) return false;
  if (p.join(" ") === o.join(" ")) return true;
  const ps = p.filter(w => w !== "and" && w !== "of" && w !== "for"), os = new Set(o);
  // Every word she wrote is one of the org's words: "Harborlight" or "Harborlight Youth".
  if (ps.length && ps.every(w => os.has(w))) return true;
  // Spacing: "Harbor Light Youth" for "Harborlight Youth Collective".
  const pj = ps.join(""), oj = o.join("");
  if (pj.length >= 5 && oj.startsWith(pj)) return true;
  // The initials: "HYC" for Harborlight Youth Collective.
  const initials = o.filter(w => w !== "and" && w !== "of" && w !== "for").map(w => w[0]).join("");
  return ps.length === 1 && initials.length >= 2 && ps[0] === initials;
}
export function payeeMismatch(payee, orgNames) {
  const raw = String(payee || "").replace(/^\s*pay\s+to\s+the\s+order\s+of\s*:?\s*/i, "").trim();
  if (!raw || NOT_A_NAME.test(raw.toLowerCase())) return null;
  const names = (orgNames || []).map(n => String(n || "").trim()).filter(Boolean);
  if (!names.length) return null;
  if (names.some(n => payeeIsOrg(raw, n))) return null;
  return { payee: raw, orgName: names[0], sentence: `This check is made out to ${raw}, not ${names[0]}.` };
}

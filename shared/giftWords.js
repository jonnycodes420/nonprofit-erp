// shared/giftWords.js — FEEL-1 item 4. Words, not code.
//
// A gift's type, a sequence's trigger and a fund are stored as keys and ids.
// What a person reads is a label: "Pledge payment", never "Pledge_payment"
// (CSS capitalize on the raw key); "First gift", never "first_gift"; and a gift
// with no fund is "Unrestricted (no fund)" on every surface, where it used to
// be "No fund", "No fund named", "(no fund)" or "General" depending on the
// screen (RecurringGiving called it "General", which read as the General
// Operating fund).
import { plural } from "./countWords.js";

const GIFT_TYPES = {
  cash: "Cash", check: "Check", cheque: "Cheque", credit_card: "Credit card", card: "Card",
  stock: "Stock", securities: "Securities", in_kind: "In-kind", matching: "Matching gift",
  pledge_payment: "Pledge payment", pledge: "Pledge", recurring: "Recurring gift", online: "Online",
  wire: "Wire transfer", ach: "Bank transfer (ACH)", daf: "Donor-advised fund", grant: "Grant",
  ira: "IRA distribution", qcd: "IRA distribution", payroll: "Payroll giving", other: "Other",
};

// "pledge_payment" → "Pledge payment"; an unknown key reads as words, first letter up.
export function giftTypeLabel(type) {
  const k = String(type == null || type === "" ? "cash" : type).trim();
  const known = GIFT_TYPES[k.toLowerCase()];
  if (known) return known;
  const words = k.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Cash";
}

// A sequence's trigger key, as she would say it (the builder's list has its
// own longer labels; this is for every key, including ones it no longer offers).
const TRIGGERS = {
  first_gift: "First gift", new_donor: "First gift", first_recurring: "First recurring gift",
  added_volunteer: "Added as a volunteer", manual: "Started by hand",
  lapsed: "Lapsed", lapsed_90: "Lapsed", lapsed_180: "Lapsed", lapsed_365: "Lapsed",
  lapsing: "Lapsing", major_gift: "Major gift", upgrade: "Gave more", anniversary: "Giving anniversary",
};
export function triggerLabel(key) {
  const k = String(key || "").trim();
  if (!k) return "No trigger";
  if (TRIGGERS[k.toLowerCase()]) return TRIGGERS[k.toLowerCase()];
  const words = k.replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const NO_FUND_LABEL = "Unrestricted (no fund)";
// The fund's one name: its own, or the no-fund label. Never a second spelling.
export function fundLabel(name) {
  const s = name == null ? "" : String(name).trim();
  return s || NO_FUND_LABEL;
}

// A receipt is for money given: a $0 (or refund) row has nothing to receipt.
export function receiptOffered(gift) {
  const a = Number(gift && gift.amount);
  return Number.isFinite(a) && a > 0;
}

// User copy never carries a build's own note about where a thing came from.
const INTERNAL_NOTES = [/\s*\(Was the Workflows recipe of the same kind\.?\)/gi];
export function withoutInternalNotes(text) {
  if (text == null) return text;
  let s = String(text);
  for (const re of INTERNAL_NOTES) s = s.replace(re, "");
  return s.trim();
}

// FEEL-1: the event's "adds up" line, as a person says it. Parts are text and
// {k} tokens (a count the screen draws as a figure that opens its rows);
// eventStoryText joins them with the numbers for the server's sentence.
export function eventStoryParts(s) {
  const n = k => Number((s && s[k]) || 0);
  const came = n("attended"), cameGave = n("cameGave"), cameNot = n("cameDidntGive"), gaveNotCame = n("gaveNotCame");
  if (!came && !n("gave")) return null;
  const out = [];
  if (came) {
    out.push({ k: "attended" }, " came");
    if (!cameGave) out.push(", and nobody gave yet.");
    else if (!cameNot) out.push(cameGave === 1 && came === 1 ? ", and gave." : ", and every one of them gave.");
    else out.push(", and ", { k: "cameGave" }, ` of them gave; `, { k: "cameDidntGive" }, ` ${plural(cameNot, "hasn't", "haven't")} yet.`);
    if (gaveNotCame) out.push(" ", { k: "gaveNotCame" }, ` ${plural(gaveNotCame, "other", "others")} gave or pledged without coming.`);
  } else {
    out.push({ k: "gave" }, " gave or pledged, and nobody is marked as having come yet.");
  }
  return out;
}
export function eventStoryText(s) {
  const parts = eventStoryParts(s);
  if (!parts) return null;
  return parts.map(p => (typeof p === "string" ? p : Number((s && s[p.k]) || 0).toLocaleString("en-US"))).join("");
}

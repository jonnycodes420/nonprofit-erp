// shared/giftMethods.js · GIFTS-3. HOW THE MONEY CAME IN, ONE LIST.
//
// Every place a payment method is chosen (the gift form, Record a gift, a
// logged conversation, a deposit line) offers this list, and every place one is
// shown (the gift row, a receipt, the deposit sheet, an export) reads it through
// methodLabel, so "ACH", "ach / bank transfer" and "EFT" are one method with one
// name, and a method nobody gave reads "Not set".
//
// A blank method is stored as nothing (NULL). Older rows say "Needs you", the
// word recordGift used for a blank before GIFTS-3; they read "Not set" too.

export const ACH = "Bank transfer (ACH)";
export const NOT_SET = "Not set";
export const GIFT_METHODS = ["Check", "Cash", "Card", ACH, "Wire", "Stock", "DAF", "Online", "Other"];

const SAME_AS = [
  [/^(ach|eft|e-?check|bank( transfer| draft)?|direct (debit|deposit)|ach ?\/ ?bank transfer|bank transfer \(ach\)|wire\/ach)$/i, ACH],
  [/^(cheque|check)$/i, "Check"],
  [/^(cash)$/i, "Cash"],
  [/^(card|credit card|credit_card|debit card|credit\/debit card)$/i, "Card"],
  [/^(wire|wire transfer)$/i, "Wire"],
  [/^(stock|securities)$/i, "Stock"],
  [/^(daf|donor-advised fund|daf grant)$/i, "DAF"],
  [/^(online)$/i, "Online"],
  [/^(other)$/i, "Other"],
];
const BLANK = /^(|needs you|unknown|not set|none|n\/a)$/i;

// The stored value, or null when nobody said.
export function methodValue(v) {
  const t = String(v == null ? "" : v).trim();
  if (BLANK.test(t)) return null;
  for (const [re, name] of SAME_AS) if (re.test(t)) return name;
  return t.slice(0, 60);
}

// What a person reads: the method's one name, or "Not set".
export function methodLabel(v) {
  return methodValue(v) || NOT_SET;
}

// The choices for a select: the list, plus a stored value the list does not
// have (an imported "Venmo"), so editing a gift never silently changes it.
export function methodChoices(current) {
  const v = methodValue(current);
  return v && !GIFT_METHODS.includes(v) ? [v, ...GIFT_METHODS] : GIFT_METHODS;
}

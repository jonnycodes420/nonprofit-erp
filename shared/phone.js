// shared/phone.js — POLISH-1. ONE WAY TO SHOW A PHONE NUMBER.
//
// A phone number is stored as it was typed or imported: "(929) 650-4776" on
// one record and "7315061544" on the next. The screen never shows the second
// form. A ten-digit US number (or eleven with a leading 1) reads
// "(731) 506-1544"; anything else (an extension, a number from abroad) is
// shown as it was typed, trimmed, because reformatting it would be a guess.
// The link is always the digits: tel:+17315061544, so a tap dials on a phone.

const digitsOf = raw => String(raw ?? "").replace(/\D/g, "");

export function usDigits(raw) {
  const s = String(raw ?? "").trim();
  if (!s || /[a-z]/i.test(s)) return null;   // "ext 12", letters: keep it as typed
  const d = digitsOf(s);
  if (d.length === 10) return d;
  if (d.length === 11 && d[0] === "1") return d.slice(1);
  return null;
}

export function phoneDisplay(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const d = usDigits(s);
  return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : s;
}

export function phoneHref(raw) {
  // An extension is dialled by hand after the call connects: the link is the number.
  const s = String(raw ?? "").trim().replace(/\s*(ext\.?|extension|x)\s*\d+\s*$/i, "");
  if (!s) return null;
  const d = usDigits(s);
  if (d) return `tel:+1${d}`;
  const all = digitsOf(s);
  return all.length >= 5 ? `tel:${s.startsWith("+") ? "+" : ""}${all}` : null;
}

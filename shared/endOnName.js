// shared/endOnName.js · POLISH-12 item 3. A SENTENCE THAT ENDS ON A NAME GETS ONE PERIOD.
//
// The profile's rail read "Nothing is open for <an organization ending in
// Inc.>.." because the sentence put "." after a name that already ended in
// one ("Inc.", "Co.", "Jr.", "Ltd."). Every sentence that ends on a person's
// or an organization's name ends through here: the name, then a period only
// when the name has not already ended the sentence.
//
//   endOnName("Larkspur Supply Co., Inc.")  → "Larkspur Supply Co., Inc."
//   endOnName("Wren")                       → "Wren."
export function endOnName(name, mark = ".") {
  const s = String(name == null ? "" : name).replace(/\s+$/, "");
  return /[.!?]$/.test(s) ? s : s + mark;
}

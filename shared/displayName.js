// shared/displayName.js — POLISH-2 Part 4. A NAME IN THE CASE SHE TYPED IT.
//
// A name shows the way the person was entered, with one exception: an import
// that shouted. "Susan ANDERSON" from a spreadsheet sat on Home beside
// "Heather Parker", and the capitals read as a flag nobody raised. So a word
// of three or more letters written ALL IN CAPITALS shows in title case:
//
//   "Susan ANDERSON"  -> "Susan Anderson"
//   "SUSAN ANDERSON"  -> "Susan Anderson"
//   "MARY O'BRIEN-SMITH" -> "Mary O'Brien-Smith"
//   "Ian MCDONALD"    -> "Ian McDonald"
//
// Left alone: a word of one or two letters ("JR", "MD", initials), a Roman
// numeral ("III"), any word that is already mixed or lower case ("deBois",
// "van der Berg"), and an organisation's name, whose capitals are usually an
// acronym ("Harbor YMCA", "IBM Foundation"). Display only: stored data is
// never changed, and search and exports read the stored value.

const ORG_WORD = /\b(foundation|fund|trust|inc|llc|church|company|co|corp|corporation|association|society|council|bank|group|partners|university|school|college|ministries|institute|club|ymca|ywca|united way)\b\.?/i;
const ROMAN = /^[IVXLC]+$/;

function titleWord(w) {
  // O'BRIEN, SMITH-JONES: each part after an apostrophe or hyphen is capped.
  return w.split(/([-'’])/).map(part => {
    if (!part || /^[-'’]$/.test(part)) return part;
    const low = part.toLowerCase();
    if (/^mc[a-z]{2,}$/.test(low)) return "Mc" + low[2].toUpperCase() + low.slice(3);
    return low[0].toUpperCase() + low.slice(1);
  }).join("");
}

export function displayName(name, { isOrg = false } = {}) {
  const s = name == null ? "" : String(name);
  // One word is as likely a brand ("IBM") as a person, so it is left alone.
  if (!s || isOrg || ORG_WORD.test(s) || !/\s/.test(s.trim())) return s;
  return s.replace(/[A-Za-zÀ-ÖØ-öø-ÿ'’-]+/g, w => {
    const letters = w.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "");
    if (letters.length < 3) return w;
    if (letters !== letters.toUpperCase() || letters === letters.toLowerCase()) return w;
    if (ROMAN.test(letters)) return w;
    return titleWord(w);
  });
}

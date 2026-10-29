// shared/nearNames.js · FIX-59. TWO SPELLINGS OF ONE PERSON, AND NOTES IN A NAME.
//
// One answer for the import's preview and for Data health, so a pair the import
// asks about is the pair Data health would list, and a name the import cleans is
// the name Data health would offer to clean.
//
//   nearDuplicate(a, b)  two names that may be one person, with the reason, or
//                        null: a letter or two apart ("Allanson"/"Alanson"), a
//                        nickname ("Fran"/"Frances"), or a couple's form beside
//                        one of the pair ("Cary Hintz & Coppinger"/"Cary Hintz").
//                        Two different full first names on one surname are a
//                        family (spouses, a parent and child), never this.
//   nameAndNotes(raw)    the name as a person would read it, with markup gone
//                        ("**Bryan May") and parenthetical notes moved off it
//                        ("Scarlette (send with Tiffany's) Nesbeth"), and
//                        whether the row is a note rather than a person
//                        ("1 Medical Gluten").
//
// The nicknames are CHECK-2's list (donorMatch.js, which is CommonJS and keeps
// its own synchronous copy) plus the families seen on event lists since.
import { isGivenName } from "./givenNames.js";

export const NICK_GROUPS = [
  "william bill billy will willy liam", "robert bob bobby rob robbie bert", "richard dick rick ricky rich richie",
  "james jim jimmy jamie", "john jack johnny jon", "joseph joe joey", "thomas tom tommy", "charles charlie chuck chas",
  "edward ed eddie ted teddy ned", "michael mike mikey mick", "elizabeth liz lizzie beth betsy betty eliza libby",
  "margaret maggie meg peggy marge margie greta", "katherine catherine kate katie kathy cathy kat kitty",
  "henrietta hattie hetty etta", "patricia pat patty trish", "susan sue susie suzanne", "deborah debra deb debbie",
  "jennifer jen jenny", "christopher chris kit", "christine christina chris tina", "daniel dan danny",
  "david dave davey", "anthony tony", "nicholas nick nicky", "alexander alex al sandy", "alexandra alex sandra sandy",
  "benjamin ben benny", "samuel sam sammy", "steven stephen steve", "matthew matt", "andrew andy drew",
  "jonathan jon jonny", "timothy tim timmy", "gregory greg", "kenneth ken kenny", "lawrence larry",
  "frederick fred freddie", "theodore ted teddy theo", "albert al bert", "harold hal harry", "henry hank harry hal",
  "eleanor ellie nell nellie nora", "dorothy dot dottie", "rebecca becky becca", "victoria vicky tori",
  "abigail abby gail", "barbara barb barbie", "frances fran frannie", "francis frank frankie", "gerald jerry gerry",
  "donald don donnie", "ronald ron ronnie", "raymond ray", "walter walt wally", "virginia ginny ginger",
  "jeffrey jeff", "beverly bev", "patrick pat", "stanley stan", "leslie les", "cynthia cindy", "pamela pam",
  "kimberly kim", "joshua josh", "zachary zach zack", "jacqueline jackie", "judith judy", "phillip philip phil",
  "douglas doug", "russell russ", "ernest ernie", "eugene gene", "leonard leo len lenny", "lucille lucy",
];
const NICK = new Map();
for (const g of NICK_GROUPS) {
  const names = g.split(" ");
  for (const n of names) NICK.set(n, new Set([...(NICK.get(n) || []), ...names]));
}
export const isNickname = (a, b) => a !== b && !!(NICK.get(a) && NICK.get(a).has(b));

export function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// ── notes in a name ────────────────────────────────────────────────────────
const MARKUP_RE = /[*_#~`=]+/g;
const NOTE_WORDS = /\b(gluten|vegan|vegetarian|veggie|allerg(y|ies|ic)|medical|wheelchair|kosher|halal|dairy|nuts?|peanuts?|shellfish|celiac|diet(ary)?|accessible|accessibility|no (pork|meat|fish|alcohol)|gf|df|pescatarian|diabetic|walker|cane|hearing|vip|reserved|comp(ed|limentary)?|tbd|n\/a)\b/i;
const s = v => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();

export function nameAndNotes(raw) {
  const original = s(raw);
  const notes = [];
  let name = original.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (_, a, b) => { const t = s(a || b); if (t) notes.push(t); return " "; });
  const hadMarkup = MARKUP_RE.test(name);
  name = s(name.replace(MARKUP_RE, " "));
  // a note typed into the name column: a number and a note word, or only note words and no first name
  const words = name.split(" ").filter(Boolean);
  const isNote = !!name && NOTE_WORDS.test(name) && (/^\d+\b/.test(name) || !words.some(w => isGivenName(w)));
  // "Neil (husband) Martha (daughter) Lyle": two first names left around the notes are a couple
  if (notes.length && words.length === 3 && isGivenName(words[0]) && isGivenName(words[1]) && !isGivenName(words[2])) {
    name = `${words[0]} & ${words[1]} ${words[2]}`;
  }
  return { name: isNote ? "" : name, notes, isNote, noteText: isNote ? original : null, changed: !isNote && name !== original, hadMarkup };
}

// ── two spellings of one person ────────────────────────────────────────────
const JOINT = /\s*(?:&|\+|\band\b|\bor\b)\s*/i;
const norm = x => s(x).toLowerCase().replace(/[^a-z0-9&+' -]/g, "").replace(/\s+/g, " ").trim();
const parts = x => {
  const w = norm(x).replace(/['’]/g, "").split(" ").filter(Boolean);
  return { first: w[0] || "", last: w[w.length - 1] || "", n: w.length };
};

export function nearDuplicate(a, b) {
  const A = norm(nameAndNotes(a).name), B = norm(nameAndNotes(b).name);
  if (!A || !B || A === B) return null;
  // a couple's form beside one of the pair: "Cary Hintz & Coppinger" / "Cary Hintz"
  for (const [x, y] of [[A, B], [B, A]]) {
    if (!JOINT.test(x) || JOINT.test(y)) continue;
    const head = x.split(JOINT)[0].trim();
    if (head.split(" ").length >= 2 && head === y) return { why: "couple", sentence: `"${s(x === A ? a : b)}" looks like a couple's form of "${s(y === A ? a : b)}"` };
  }
  if (JOINT.test(A) || JOINT.test(B)) return null;
  const p = parts(A), q = parts(B);
  if (p.n < 2 || q.n < 2) return null;
  // a word with a digit is not a name: "Person 12345" and "Person 12346" are two rows, never a spelling
  if (/\d/.test(p.first + p.last + q.first + q.last)) return null;
  if (p.last === q.last) {
    if (isNickname(p.first, q.first)) return { why: "nickname", sentence: `${cap(p.first)} and ${cap(q.first)} are often one name` };
    // one or two letters apart, and long enough that it is a spelling, not a sibling ("Jay"/"Jami" are two people)
    if (Math.min(p.first.length, q.first.length) >= 4 && editDistance(p.first, q.first) <= (Math.min(p.first.length, q.first.length) >= 6 ? 2 : 1)
        && p.first[0] === q.first[0]) return { why: "spelling", sentence: `the first names are a letter apart` };
    return null;
  }
  const sameFirst = p.first === q.first || isNickname(p.first, q.first);
  const L = Math.min(p.last.length, q.last.length);
  if (sameFirst && L >= 5 && editDistance(p.last, q.last) <= (L >= 8 ? 2 : 1) && p.last[0] === q.last[0]) {
    return { why: "spelling", sentence: `the last names are a letter apart` };
  }
  return null;
}
const cap = w => w ? w[0].toUpperCase() + w.slice(1) : w;

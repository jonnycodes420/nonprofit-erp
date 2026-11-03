// shared/greeting.js · FIX-45 1.4. WHAT A DRAFT CALLS SOMEBODY.
//
// Every draft that opens "Dear ..." reads its name from here, so a record for
// two people is greeted as two people. "Desmond & Ruth Okafor" used to open
// "Dear Desmond," because every builder took the first word of the name.
//
// In order, the first one that applies:
//   1. the record's own salutation, typed by a person or imported ("Dear Dr. Chen")
//   2. an organisation: its named contact, else "friends at <name>" (FIX-56)
//   3. a household or joint name, both people: "Desmond & Ruth Okafor" reads
//      "Desmond and Ruth"; "Mr. and Mrs. Okafor" is used whole and "The Okafor
//      Family" reads "Okafor Family", because neither first word is a name
//   4. a spouse on the record: "<first> and <spouse's first>"
//   5. the first name
// POLISH-4 · and never a word that is not a name: a title alone ("Dear Dr.,")
// takes the last name ("Dr. Ramirez"); a title before a full name reads the
// title and the last name; a leading "&" or "and" is dropped ("Hi &,"); an
// initial is never a first name ("Hi K,"): the next full name, else the whole
// name; a business kept as a person ("Redshaw Holville Wine Spirits") is
// greeted as an organisation. greetingLine() below is the one opening line
// every draft and email writes; "Hello," only when there is truly no name.
//
// Pure: no clock, no database. The callers pass what they read.

const TITLE = /^(mr|mrs|ms|miss|mx|dr|rev|fr|sr|br|prof|hon|pastor|rabbi)\.?$/i;
const JOINT = /^(.+?)\s+(?:&|and|\+)\s+(.+)$/i;

const firstWord = s => String(s || "").trim().split(/\s+/)[0] || "";
// FIX-56: a record kept as a person whose name can only be an organisation's
// ("... Family Foundation", "... Inc.") is greeted as one. Narrow on purpose:
// "Ellen Church" is a person, so a church is read from the record's kind.
const ORG_NAME = /\b(foundation|inc\.?|llc|ltd\.?|corp\.?|corporation|company|ministries|trust)$/i;
// POLISH-4: words no person's name carries, anywhere in it; and words a
// surname can be ("Ellen Church", "Tom Bank"), counted only in a name of three
// words or more ("Redshaw Holville Wine Spirits").
const BUSINESS_WORD = /\b(inc|llc|llp|pllc|ltd|corp|corporation|incorporated|excavating|construction|contracting|plumbing|roofing|landscaping|enterprises|holdings|associates|services|realty|insurance|restaurant|bakery|brewing|brewery|winery|spirits|dental|auto|motors|logistics|consulting|properties|industries|technologies|solutions|manufacturing)\b\.?/i;
const BUSINESS_WEAK = /\b(bank|club|church|school|market|farms?|studio|group|partners|wine|cafe|kitchen|hardware|supply|electric|garage|salon|press|co)\b\.?/i;
const looksLikeBusiness = name => {
  const n = String(name || "").trim();
  if (!n) return false;
  if (BUSINESS_WORD.test(n) || ORG_NAME.test(n)) return true;
  return n.split(/\s+/).length >= 3 && BUSINESS_WEAK.test(n) && !JOINT.test(n);
};
const isOrg = p => p.kind === "organisation" || p.kind === "organization" || looksLikeBusiness(p.name);
const INITIAL = /^[A-Za-z]\.?$/;
const lastWord = s => { const w = String(s || "").trim().replace(/,.*$/, "").split(/\s+/).filter(t => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(t)); return w.length > 1 ? w[w.length - 1] : ""; };
const titled = t => /\.$/.test(t) || /^(miss|pastor|rabbi|hon)$/i.test(t) ? t : `${t}.`;

export function greetingName(person = {}) {
  const p = typeof person === "string" ? { name: person } : (person || {});
  const salutation = String(p.salutation || "").trim().replace(/^dear\s+/i, "").replace(/[,:\s]+$/, "");
  // POLISH-4: a salutation that is a title alone ("Dr.") takes the last name.
  if (salutation && TITLE.test(salutation)) {
    const last = lastWord(String(p.name || "").replace(/^\s*(mr|mrs|ms|miss|mx|dr|rev|fr|sr|br|prof|hon|pastor|rabbi)\.?\s+/i, " "));
    if (last && !isOrg(p)) return `${titled(salutation)} ${last}`;
  } else if (salutation) return salutation;
  // POLISH-4: a leading "&" or "and" is not part of anyone's name.
  const name = String(p.name || "").trim().replace(/\s+/g, " ").replace(/^(?:&|\+|and)\s*/i, "").trim();
  if (!name || /^[&+]$/.test(name)) return "";
  // FIX-56: an organisation is greeted by its named contact, else as "friends at" it.
  if (isOrg(p)) {
    const contact = String(p.contactName || p.contact_name || "").trim();
    return contact ? greetingName({ name: contact }) : `friends at ${name}`;
  }
  if (/^the\s/i.test(name)) return name.replace(/^the\s+/i, "");
  // POLISH-4: "Smith, John" is John Smith, written last name first.
  const comma = /^([^,&]+),\s*([^,]+)$/.exec(name);
  if (comma && !/^(jr|sr|ii|iii|iv)\.?$/i.test(comma[2].trim())) return greetingName({ ...p, salutation: "", name: `${comma[2].trim()} ${comma[1].trim()}` });
  const joint = name.match(JOINT);
  if (joint) {
    const a = firstWord(joint[1]), b = firstWord(joint[2]);
    if (TITLE.test(a) || TITLE.test(b)) return name;
    // an initial on either side is no first name: the whole name, as written
    if (INITIAL.test(a) || INITIAL.test(b)) return name;
    return `${a} and ${b}`;
  }
  const words = name.split(" ");
  let first = words[0];
  // POLISH-4: a title before the name reads the title and the last name.
  if (TITLE.test(first)) {
    const last = lastWord(words.slice(1).join(" ")) || (words.length === 2 ? words[1] : "");
    return last && !INITIAL.test(last) ? `${titled(first)} ${last}` : "";
  }
  // POLISH-4: an initial is not a first name: the next full name, else the
  // whole name ("K. Valon Lane" reads "Valon"; "K. Lane" stays "K. Lane").
  if (INITIAL.test(first)) {
    const next = words.slice(1, -1).find(w => !INITIAL.test(w));
    if (!next) return words.length > 1 ? name : "";
    first = next;
  }
  // POLISH-4: a stray full stop is not part of a first name ("Ivoin. Milina"),
  // and a word with a digit in it is no one's name ("Birchfield5").
  first = first.replace(/[.,;:]+$/, "");
  if (!first || /\d/.test(first)) return "";
  const spouse = firstWord(p.spouseName || p.spouse_name);
  if (spouse && spouse.toLowerCase() !== first.toLowerCase()) return `${first} and ${spouse}`;
  return first;
}

// The {{first_name}} merge field: the first names on the record, so a joint
// record reads "Desmond and Ruth" there too. No salutation: a template that
// says "Dear {{first_name}}" chose first names. FIX-56: an organisation has no
// first name, so "Lynn & Rovena Alexander Family Foundation" is never "Lynn
// and Rovena": it is its named contact, else "friends at" it.
export function firstNames(person = {}) {
  const p = typeof person === "string" ? { name: person } : (person || {});
  if (isOrg(p))
    return greetingName({ name: p.name, kind: "organisation", contactName: p.contactName || p.contact_name });
  return greetingName({ name: p.name, spouseName: p.spouseName || p.spouse_name });
}

// FIX-46 · A MERGE FIELD THAT GREETS. A saved template, a sequence step or a
// journey email that opens "Dear {{donor_name}}," used to print the whole
// name ("Dear Margaret Chen,"). After Dear/Hi/Hello, the full-name field
// ({{donor_name}}, {{full_name}}, {{name}}) is the greeting above: the
// salutation, then first names, both people on a joint record. Everywhere else
// it keeps its own meaning, so "a gift from {{donor_name}}" is still the full
// name. {{first_name}} is never touched here (Jonathan, 19 Oct): a template
// that says "Dear {{first_name}}" chose first names, both on a joint record,
// never the salutation; that field is firstNames() in every renderer. Every
// renderer runs this first, with greetingName(person) as `greeting`.
const GREETS = /\b(dear|hi|hello|hey|greetings|good (?:morning|afternoon|evening))(,?[ \t]+)\{\{\s*(?:donor_name|full_name|name)\s*\}\}/gi;
export function greetMerge(text, greeting) {
  const s = String(text == null ? "" : text);
  const g = String(greeting || "").trim();
  return g ? s.replace(GREETS, (m, word, sep) => `${word}${sep}${g}`) : s;
}

// POLISH-4 · THE ONE OPENING LINE. Every draft, email and letter Steward
// writes opens with this: "<word> <greetingName>," ("Hi Desmond and Ruth,"),
// "Dear" whenever the name is formal (a salutation, a title, a whole name, an
// organisation), and "Hello," only when there is truly no name. `word` is the
// writer's register: "Dear" (letters, thank-yous) or "Hi" (short emails).
// `punct: ""` leaves the comma off, for a line that continues.
export function greetingLine(person = {}, { word = "Dear", punct = "," } = {}) {
  const p = typeof person === "string" ? { name: person } : (person || {});
  const g = greetingName(p);
  if (!g) return `Hello${punct}`;
  const name = String(p.name || "").trim().replace(/\s+/g, " ");
  const formal = !!String(p.salutation || "").trim() || /^friends at /.test(g) || /\./.test(g) || g === name || /\s/.test(g) && !/ and /.test(g);
  return `${formal ? "Dear" : word} ${g}${punct}`;
}

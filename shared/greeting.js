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
//
// Pure: no clock, no database. The callers pass what they read.

const TITLE = /^(mr|mrs|ms|miss|mx|dr|rev|fr|sr|br|prof|hon|pastor|rabbi)\.?$/i;
const JOINT = /^(.+?)\s+(?:&|and|\+)\s+(.+)$/i;

const firstWord = s => String(s || "").trim().split(/\s+/)[0] || "";
// FIX-56: a record kept as a person whose name can only be an organisation's
// ("... Family Foundation", "... Inc.") is greeted as one. Narrow on purpose:
// "Ellen Church" is a person, so a church is read from the record's kind.
const ORG_NAME = /\b(foundation|inc\.?|llc|ltd\.?|corp\.?|corporation|company|ministries|trust)$/i;
const isOrg = p => p.kind === "organisation" || p.kind === "organization" || ORG_NAME.test(String(p.name || "").trim());

export function greetingName(person = {}) {
  const p = typeof person === "string" ? { name: person } : (person || {});
  const salutation = String(p.salutation || "").trim().replace(/^dear\s+/i, "").replace(/[,:\s]+$/, "");
  if (salutation) return salutation;
  const name = String(p.name || "").trim().replace(/\s+/g, " ");
  if (!name) return "";
  // FIX-56: an organisation is greeted by its named contact, else as "friends at" it.
  if (isOrg(p)) {
    const contact = String(p.contactName || p.contact_name || "").trim();
    return contact ? greetingName({ name: contact }) : `friends at ${name}`;
  }
  if (/^the\s/i.test(name)) return name.replace(/^the\s+/i, "");
  const joint = name.match(JOINT);
  if (joint) {
    const a = firstWord(joint[1]), b = firstWord(joint[2]);
    if (TITLE.test(a) || TITLE.test(b)) return name;
    return `${a} and ${b}`;
  }
  const first = firstWord(name);
  if (TITLE.test(first)) return name;
  const spouse = firstWord(p.spouseName || p.spouse_name);
  if (spouse && spouse.toLowerCase() !== first.toLowerCase()) return `${first} and ${spouse}`;
  return first;
}

// The whole opening line, the same everywhere.
export function dearLine(person, fallback = "friend") {
  return `Dear ${greetingName(person) || fallback},`;
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

// dataHealth.js · CLEAN-1. Clean data without the dread.
//
// The pure half of Data health: nothing here touches the database, so the
// route, the nightly run, the import hook and the tests all read the SAME
// definitions. What it decides:
//
//   findDuplicatePairs   likely pairs inside ONE org's rows, each with its
//                        reasons in plain words and a confidence of high,
//                        medium or low (never a number).
//   tidyAddress          a US address standardised offline (parse-address,
//                        no outside call), or "can't read it", never a guess.
//   emailIssues          bounced, fails a syntax check, a common typo domain
//                        (with the suggested fix), a role address for a person.
//   NCOA                 the file we hand a licensed vendor, and the reader for
//                        the file they hand back (standard move codes).
//
// Steward suggests; staff apply. Nothing in this file writes anything.
"use strict";

const parseAddress = require("parse-address");

// ── Names ──────────────────────────────────────────────────────────────────
const NICKNAMES = [
  ["robert", "bob", "rob", "bobby"], ["william", "bill", "will", "billy"], ["richard", "rick", "dick", "rich"],
  ["james", "jim", "jimmy"], ["john", "jack", "johnny"], ["michael", "mike"], ["elizabeth", "liz", "beth", "betty", "eliza"],
  ["margaret", "maggie", "meg", "peggy"], ["katherine", "kate", "kathy", "katie", "catherine"], ["thomas", "tom", "tommy"],
  ["joseph", "joe"], ["daniel", "dan", "danny"], ["david", "dave"], ["christopher", "chris"], ["patricia", "pat", "patty"],
  ["jennifer", "jen", "jenny"], ["susan", "sue", "susie"], ["deborah", "deb", "debbie"], ["anthony", "tony"],
  ["edward", "ed", "eddie", "ted"], ["charles", "charlie", "chuck"], ["samuel", "sam"], ["alexander", "alex"],
  ["benjamin", "ben"], ["nicholas", "nick"], ["steven", "steve", "stephen"], ["matthew", "matt"], ["andrew", "andy", "drew"],
  ["rebecca", "becky"], ["victoria", "vicky", "tori"], ["theodore", "ted", "teddy"], ["jonathan", "jon"],
];
const NICK = new Map();
NICKNAMES.forEach((group, i) => group.forEach(n => NICK.set(n, i)));
const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "rev", "prof", "jr", "sr", "ii", "iii", "iv"]);

function normName(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function nameTokens(s) { return normName(s).split(" ").filter(t => t && !HONORIFICS.has(t)); }

function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0]; dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const t = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return dp[a.length];
}

// How two names relate, in the words a person would use. null = not similar.
//   same        identical once case, punctuation and titles are set aside
//   initial     the same first and last name, one has a middle name or initial
//   nickname    Bob and Robert, with the same last name
//   spelling    one or two letters apart
function nameRelation(a, b) {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length) return null;
  const ja = ta.join(" "), jb = tb.join(" ");
  if (ja === jb) return "same";
  const fa = ta[0], fb = tb[0], la = ta[ta.length - 1], lb = tb[tb.length - 1];
  if (ta.length >= 2 && tb.length >= 2 && fa === fb && la === lb) return "initial";
  if (la === lb && ta.length >= 2 && tb.length >= 2 && NICK.has(fa) && NICK.get(fa) === NICK.get(fb)) return "nickname";
  if (ja.length >= 8 && jb.length >= 8 && editDistance(ja, jb, 2) <= 2) return "spelling";
  // FIX-33: two shapes a real export plants that none of the above saw.
  // "Bar Morales" / "Barbara Morales": a first name cut short (three letters
  // or more, same last name). "Alexander Sanders-Johnson" / "Alexander
  // Sanders": the same first name, one surname a part of the other's
  // double-barrelled one. Both only ever make a PAIR for a person to judge.
  if (ta.length >= 2 && tb.length >= 2) {
    const short = fa.length < fb.length ? fa : fb, long = fa.length < fb.length ? fb : fa;
    if (la === lb && short.length >= 3 && short !== long && long.startsWith(short)) return "shortened";
    const rawLast = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().split(/\s+/).pop() || "";
    const pa = rawLast(a).split("-").filter(Boolean), pb = rawLast(b).split("-").filter(Boolean);
    if (fa === fb && (pa.length > 1 || pb.length > 1) && la !== lb
        && (pa.length > 1 ? pa.includes(rawLast(b)) : pb.includes(rawLast(a)))) return "surname";
  }
  return null;
}
const NAME_WORDS = {
  same: "same name",
  initial: "names differ by a middle initial",
  nickname: "one name is a nickname of the other",
  spelling: "names differ by a letter or two",
  shortened: "one first name is the other cut short",
  surname: "one surname is part of the other's double surname",
};

const lowerEmail = e => String(e || "").trim().toLowerCase();
const phoneKey = p => { const d = String(p || "").replace(/\D+/g, ""); const t = d.length === 11 && d[0] === "1" ? d.slice(1) : d; return t.length === 10 ? t : null; };
function addressKey(d) {
  const line = normName(d.address).replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|place|pl)\b/g, "").replace(/\s+/g, " ").trim();
  const zip = String(d.zip || "").replace(/\D+/g, "").slice(0, 5);
  const city = normName(d.city);
  if (!line || !/\d/.test(line) || (!zip && !city)) return null;
  return line + "|" + (zip || city);
}
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// The rules, strongest first. Each returns {confidence, reason} or null.
// A pair takes the strongest rule it meets; every rule it meets is a reason.
//   high    same email + similar name · same phone + similar name ·
//           same address + same name
//   medium  same email, different names (a couple sharing one inbox) ·
//           same address + similar name · similar name in the same household
//   low     similar name + same employer · same phone, different names
const RANK = { high: 3, medium: 2, low: 1 };
function judgePair(a, b) {
  const rel = nameRelation(a.name, b.name);
  const emailsA = [lowerEmail(a.email), lowerEmail(a.email2)].filter(Boolean);
  const emailsB = new Set([lowerEmail(b.email), lowerEmail(b.email2)].filter(Boolean));
  const sameEmail = emailsA.some(e => emailsB.has(e));
  const phonesA = [phoneKey(a.phone), phoneKey(a.mobile)].filter(Boolean);
  const phonesB = new Set([phoneKey(b.phone), phoneKey(b.mobile)].filter(Boolean));
  const samePhone = phonesA.some(p => phonesB.has(p));
  const ak = addressKey(a), bk = addressKey(b);
  const sameAddress = !!ak && ak === bk;
  const sameHousehold = !!a.household_id && a.household_id === b.household_id;
  const emp = s => normName(s);
  const sameEmployer = !!emp(a.employer) && emp(a.employer) === emp(b.employer);

  const reasons = [];
  let confidence = null;
  const meet = (c, words) => { reasons.push(words); if (!confidence || RANK[c] > RANK[confidence]) confidence = c; };
  const nameWords = rel ? NAME_WORDS[rel] : "different names";
  if (sameEmail && rel) meet("high", `same email, ${nameWords}`);
  if (samePhone && rel) meet("high", `same phone, ${nameWords}`);
  if (sameAddress && rel === "same") meet("high", "same address, same name");
  if (sameEmail && !rel) meet("medium", "same email, different names");
  if (sameAddress && rel && rel !== "same") meet("medium", `same address, ${nameWords}`);
  if (sameHousehold && rel) meet("medium", `same household, ${nameWords}`);
  if (sameEmployer && rel) meet("low", `same employer, ${nameWords}`);
  if (samePhone && !rel) meet("low", "same phone, different names");
  if (!confidence) return null;
  return { confidence, reasons: [...new Set(reasons)] };
}

// Likely pairs among ONE org's rows. The caller passes only that org's rows;
// a row from another org is refused here as well, so a mistake upstream can
// never pair two organisations' people.
function findDuplicatePairs(rows, { orgId, dismissed = new Set() } = {}) {
  const live = rows.filter(d => !d.deleted_at && !d.erased_at && (!orgId || d.org_id === orgId));
  if (orgId && live.length !== rows.filter(d => !d.deleted_at && !d.erased_at).length) {
    throw new Error("findDuplicatePairs: rows from another org");
  }
  const candidates = new Set();
  const block = (keyFn) => {
    const m = new Map();
    for (const d of live) for (const k of [].concat(keyFn(d) || [])) {
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(d);
    }
    for (const list of m.values()) {
      if (list.length < 2 || list.length > 50) continue;   // a shared office line is not 50 duplicates
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) candidates.add(pairKey(list[i].id, list[j].id));
    }
  };
  block(d => [lowerEmail(d.email), lowerEmail(d.email2)].filter(Boolean).map(e => "e:" + e));
  block(d => [phoneKey(d.phone), phoneKey(d.mobile)].filter(Boolean).map(p => "p:" + p));
  block(d => { const k = addressKey(d); return k ? "a:" + k : null; });
  block(d => d.household_id ? "h:" + d.household_id : null);
  block(d => normName(d.employer) ? "w:" + normName(d.employer) : null);
  // Names: same last name and the same first letter puts two people in one
  // bucket, so a spelling slip is found without comparing everyone to everyone.
  block(d => { const t = nameTokens(d.name); return t.length ? "n:" + t[t.length - 1].slice(0, 4) + "|" + t[0][0] : null; });

  const byId = new Map(live.map(d => [d.id, d]));
  const pairs = [];
  for (const key of candidates) {
    if (dismissed.has(key)) continue;
    const [x, y] = key.split("|");
    const a = byId.get(x), b = byId.get(y);
    const j = judgePair(a, b);
    if (!j) continue;
    const crossHousehold = !!a.household_id && !!b.household_id && a.household_id !== b.household_id;
    pairs.push({ key, a: a.id, b: b.id, confidence: j.confidence, reasons: j.reasons, crossHousehold });
  }
  pairs.sort((p, q) => RANK[q.confidence] - RANK[p.confidence] || p.key.localeCompare(q.key));
  return pairs;
}

// ── Merge: which value wins, field by field ─────────────────────────────────
// The fields a person chooses between on the side-by-side screen. Every other
// column follows a fixed rule in the route (system ids fill blanks, flags OR,
// tags and custom fields union) and is listed in the merge report.
const MERGE_FIELDS = [
  ["name", "Name"], ["kind", "Kind"], ["salutation", "Salutation"], ["middle_name", "Middle name"], ["suffix", "Suffix"],
  ["contact_name", "Contact at the organisation"], ["spouse_name", "Spouse"],
  ["email", "Email"], ["email2", "Second email"], ["phone", "Phone"], ["mobile", "Mobile"],
  ["address", "Street"], ["address2", "Street, line 2"], ["city", "City"], ["state", "State"], ["zip", "ZIP"], ["country", "Country"],
  ["employer", "Employer"], ["household_id", "Household"], ["stage", "Stage"],
  ["assigned_to", "Assigned to"], ["birth_month", "Birthday month"], ["birth_day", "Birthday day"], ["birth_year", "Birth year"],
  ["external_donor_id", "Id in the old system"], ["notes", "Notes"],
];
const ADDRESS_GROUP = ["address", "address2", "city", "state", "zip", "country"];
const empty = v => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const stamp = d => new Date(d.updated_at || d.created_at || 0).getTime() || 0;

// Defaults: the most recent non-empty value. An address moves as one piece,
// so a street from one record never lands beside a ZIP from the other.
function defaultChoices(kept, other) {
  const newer = stamp(other) > stamp(kept) ? "other" : "kept";
  const out = {};
  for (const [f] of MERGE_FIELDS) {
    if (ADDRESS_GROUP.includes(f)) continue;
    const kv = kept[f], ov = other[f];
    out[f] = empty(kv) && !empty(ov) ? "other" : empty(ov) ? "kept" : (String(kv) === String(ov) ? "kept" : newer);
  }
  const hasAddr = d => !empty(d.address) || !empty(d.city) || !empty(d.zip);
  const addrSide = !hasAddr(kept) && hasAddr(other) ? "other" : !hasAddr(other) ? "kept" : newer;
  for (const f of ADDRESS_GROUP) out[f] = addrSide;
  return out;
}

// Apply choices, then keep BOTH emails and BOTH phones: the losing email goes
// to the second-email slot, the losing phone to mobile, and whatever has no
// slot left is named in the merge note so nothing silently disappears.
function resolveMergedValues(kept, other, choices) {
  const vals = {};
  for (const [f] of MERGE_FIELDS) vals[f] = (choices[f] === "other" ? other : kept)[f];
  const leftovers = [];
  const emails = [kept.email, kept.email2, other.email, other.email2].filter(e => !empty(e));
  const seenE = new Set([lowerEmail(vals.email), lowerEmail(vals.email2)].filter(Boolean));
  for (const e of emails) {
    if (seenE.has(lowerEmail(e))) continue;
    if (empty(vals.email)) vals.email = e; else if (empty(vals.email2)) vals.email2 = e; else leftovers.push(`email ${e}`);
    seenE.add(lowerEmail(e));
  }
  const phones = [kept.phone, kept.mobile, other.phone, other.mobile].filter(p => !empty(p));
  const seenP = new Set([phoneKey(vals.phone) || vals.phone, phoneKey(vals.mobile) || vals.mobile].filter(Boolean));
  for (const p of phones) {
    const k = phoneKey(p) || p;
    if (seenP.has(k)) continue;
    if (empty(vals.phone)) vals.phone = p; else if (empty(vals.mobile)) vals.mobile = p; else leftovers.push(`phone ${p}`);
    seenP.add(k);
  }
  return { vals, leftovers };
}

// ── Addresses ──────────────────────────────────────────────────────────────
const STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP AA AE AP".split(" "));
const UNIT_WORDS = { apt: "Apt", apartment: "Apt", ste: "Ste", suite: "Ste", unit: "Unit", "#": "#", rm: "Rm", room: "Rm", fl: "Fl", floor: "Fl", bldg: "Bldg", building: "Bldg", lot: "Lot", trlr: "Trlr", spc: "Spc", dept: "Dept", ph: "Ph", penthouse: "Ph" };
function titleWord(w) {
  if (!w) return w;
  if (/[a-z]/.test(w) && /[A-Z]/.test(w.slice(1))) return w;           // McDonald, DeKalb: keep what a person typed
  if (/^\d+(st|nd|rd|th)$/i.test(w)) return w.toLowerCase();            // 3rd, 21st
  return w.split("-").map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("-");
}
const titleCase = s => String(s || "").trim().split(/\s+/).map(titleWord).join(" ");
const cleanUnitNum = s => String(s || "").replace(/^#/, "").toUpperCase();

// ZIPs that start with 0 belong to these states; a spreadsheet that ate the
// leading zero is the only repair made without asking, and only for them.
const ZERO_ZIP_STATES = new Set(["CT", "MA", "ME", "NH", "NJ", "RI", "VT", "PR", "VI", "AE"]);
function formatZip(zip, plus4, state) {
  const d = String(zip || "").replace(/\D+/g, "");
  if (!d) return { zip: "", ok: true };
  if (d.length === 5 && !plus4) return { zip: d, ok: true };
  if (d.length === 5 && /^\d{4}$/.test(String(plus4 || ""))) return { zip: `${d}-${plus4}`, ok: true };
  if (d.length === 9) return { zip: `${d.slice(0, 5)}-${d.slice(5)}`, ok: true };
  if (d.length === 4 && /^\d{4}$/.test(String(zip).trim()) && ZERO_ZIP_STATES.has(state)) return { zip: "0" + d, ok: true };
  return { zip: String(zip || ""), ok: false };
}

// Words a standard address may shorten (Street to St, North to N). Any other
// word or number in the old address must still be in the new one, or the
// address is flagged instead of tidied: a tidy never loses part of an address.
const SHORTENABLE = new Set(("north south east west northeast northwest southeast southwest street avenue road drive lane court "
  + "boulevard place terrace circle parkway highway square trail way apartment suite unit room floor building post office box "
  + "ave av st rd dr ln ct blvd pl ter cir pkwy hwy sq trl apt ste rm fl bldg po n s e w ne nw se sw").split(" "));
function lostWords(before, after) {
  const tok = s => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  const have = new Set(tok(after));
  return tok(before).filter(t => !have.has(t) && !SHORTENABLE.has(t));
}

// One donor's address in, the standard form out, or a reason it can't be
// read. US only: an address in another country is left alone.
function tidyAddress(d) {
  const cur = { address: d.address || "", address2: d.address2 || "", city: d.city || "", state: d.state || "", zip: d.zip || "" };
  const country = String(d.country || "US").trim().toUpperCase();
  if (country && !["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"].includes(country)) return { status: "skip", current: cur };
  if (!cur.address.trim()) return { status: "skip", current: cur };
  const line1 = cur.address.replace(/\s+/g, " ").trim().replace(/[.,]+$/, "");
  const po = line1.match(/^p\.?\s*o\.?\s*box\s+([a-z0-9-]+)$/i) || line1.match(/^post\s+office\s+box\s+([a-z0-9-]+)$/i);
  let street, unit = cur.address2.replace(/\s+/g, " ").trim();
  let city = cur.city.trim(), state = cur.state.trim(), zip = cur.zip.trim(), plus4 = null;
  if (po) {
    street = `PO Box ${po[1].toUpperCase()}`;
  } else {
    // The street line is parsed ALONE: given a bad ZIP, the parser drops
    // the unit without a word, so city, state and ZIP are handled below.
    const p = parseAddress.parseLocation(line1);
    if (!p || !p.number || !p.street) return { status: "unreadable", current: cur, why: "no house number and street could be found" };
    const parts = [p.number, p.prefix && p.prefix.toUpperCase().replace(/\./g, ""), titleCase(p.street), p.type && titleWord(p.type), p.suffix && p.suffix.toUpperCase().replace(/\./g, "")].filter(Boolean);
    street = parts.join(" ");
    if (p.sec_unit_type || p.sec_unit_num) {
      const kind = UNIT_WORDS[String(p.sec_unit_type || "#").toLowerCase()] || titleWord(p.sec_unit_type || "#");
      const u = kind === "#" ? `# ${cleanUnitNum(p.sec_unit_num)}` : `${kind} ${cleanUnitNum(p.sec_unit_num)}`.trim();
      unit = unit ? `${u} ${unit}` : u;
    }
  }
  const zm = zip.match(/^(\d{5})-?(\d{4})$/);
  if (zm) { zip = zm[1]; plus4 = zm[2]; }
  if (unit) {
    const um = unit.match(/^(apt|apartment|ste|suite|unit|rm|room|fl|floor|bldg|building|lot|#)\.?\s*#?\s*([a-z0-9-]+)$/i);
    if (um) { const k = UNIT_WORDS[um[1].toLowerCase()] || "#"; unit = k === "#" ? `# ${cleanUnitNum(um[2])}` : `${k} ${cleanUnitNum(um[2])}`; }
    else unit = titleCase(unit);
  }
  state = state.toUpperCase().replace(/\./g, "");
  if (state.length > 2) {
    const p = parseAddress.parseLocation(`1 Main St, X, ${state} 00000`);
    state = p && p.state ? String(p.state).toUpperCase() : state;
  }
  if (state && !STATES.has(state)) return { status: "unreadable", current: cur, why: `"${cur.state}" is not a US state` };
  const z = formatZip(zip, plus4, state);
  if (!z.ok) return { status: "unreadable", current: cur, why: `"${cur.zip}" is not a ZIP code` };
  const proposed = { address: street, address2: unit, city: titleCase(city), state, zip: z.zip };
  const lost = lostWords(`${cur.address} ${cur.address2}`, `${proposed.address} ${proposed.address2}`);
  if (lost.length) return { status: "unreadable", current: cur, why: `standardising it would drop "${lost.join(" ")}"` };
  const changed = Object.keys(proposed).some(k => String(proposed[k] || "") !== String(cur[k] || ""));
  return { status: changed ? "tidy" : "clean", current: cur, proposed };
}
const oneLine = a => [a.address, a.address2, [a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ");

// ── Emails ─────────────────────────────────────────────────────────────────
const TYPO_DOMAINS = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com", "gmaill.com": "gmail.com",
  "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gmail.cm": "gmail.com", "gmali.com": "gmail.com", "gmal.com": "gmail.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.co": "yahoo.com", "yahoo.con": "yahoo.com", "yhoo.com": "yahoo.com", "yaoo.com": "yahoo.com",
  "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmail.co": "hotmail.com", "hotmail.con": "hotmail.com", "hotmil.com": "hotmail.com",
  "outlok.com": "outlook.com", "outllook.com": "outlook.com", "outlook.co": "outlook.com", "outlook.con": "outlook.com",
  "iclod.com": "icloud.com", "icoud.com": "icloud.com", "icloud.co": "icloud.com", "icloud.con": "icloud.com",
  "aol.co": "aol.com", "aol.con": "aol.com", "aoll.com": "aol.com",
  "comcast.ent": "comcast.net", "comcat.net": "comcast.net", "sbcglobal.ent": "sbcglobal.net", "verizon.ent": "verizon.net", "att.ent": "att.net",
  "msn.co": "msn.com", "live.co": "live.com", "me.co": "me.com",
};
const ROLE_LOCALS = new Set(["info", "office", "admin", "administrator", "contact", "hello", "support", "sales", "team", "staff", "mail", "webmaster", "billing", "accounts", "accounting", "frontdesk", "reception", "inquiries", "enquiries", "help", "donations", "giving", "noreply", "no-reply"]);
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/i;
const isValidEmail = e => EMAIL_RE.test(String(e || "").trim()) && !/\.\./.test(String(e)) && String(e).length <= 254;

// Every problem with one person's email, each in words, with a suggested fix
// where one is obvious. `bounced` comes from the caller (the suppression list
// and the person's own unreachable mark), never guessed here.
function emailIssues(d, { bounced = null } = {}) {
  const email = String(d.email || "").trim();
  if (!email) return [];
  const out = [];
  if (bounced) out.push({ kind: "bounced", words: bounced === "complained" ? "marked our mail as spam" : "mail to it bounces" });
  if (!isValidEmail(email)) {
    const fixed = email.replace(/\s+/g, "").replace(/,/g, ".").replace(/\.\.+/g, ".").replace(/@@+/g, "@");
    out.push({ kind: "syntax", words: "not a valid email address", suggestion: fixed !== email && isValidEmail(fixed) ? fixed.toLowerCase() : null });
    return out;
  }
  const [local, domain] = email.toLowerCase().split("@");
  const fix = TYPO_DOMAINS[domain] || (/\.(con|cmo|ocm|vom)$/.test(domain) ? domain.replace(/\.(con|cmo|ocm|vom)$/, ".com") : null);
  if (fix) out.push({ kind: "typo", words: `"${domain}" looks like a typo for ${fix}`, suggestion: `${local}@${fix}` });
  const isPerson = !d.kind || d.kind === "person";
  if (isPerson && ROLE_LOCALS.has(local)) out.push({ kind: "role", words: `${local}@ is a shared office address, not a person's` });
  return out;
}

// ── NCOA: the file out, and the file back ──────────────────────────────────
// The layout every licensed NCOALink provider takes: a unique id per row we
// get back unchanged, the name, and the address in separate columns.
const NCOA_EXPORT_COLUMNS = ["Record ID", "Full Name", "First Name", "Last Name", "Address Line 1", "Address Line 2", "City", "State", "ZIP Code"];
const mailable = d => !d.deceased && !d.address_unmailable && !d.deleted_at && !!String(d.address || "").trim()
  && !!String(d.city || "").trim() && !!String(d.state || "").trim() && !!String(d.zip || "").trim()
  && ["", "US", "USA", "UNITED STATES"].includes(String(d.country || "US").trim().toUpperCase());

function csvCell(v) { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s; }
function ncoaExportCsv(rows) {
  const lines = [NCOA_EXPORT_COLUMNS.join(",")];
  for (const d of rows) {
    const t = String(d.name || "").trim().split(/\s+/);
    const isOrg = d.kind === "organization" || d.kind === "organisation";
    lines.push([d.id, d.name, isOrg ? "" : t.slice(0, -1).join(" ") || t[0], isOrg ? "" : (t.length > 1 ? t[t.length - 1] : ""),
      d.address, d.address2 || "", d.city, d.state, d.zip].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ""));
}

// Column names vendors use for the same thing. Matched after lower-casing and
// dropping everything but letters and digits.
const NCOA_COLS = {
  id: ["recordid", "id", "uniqueid", "customerid", "key", "donorid", "constituentid", "clientid", "recordkey"],
  code: ["ncoareturncode", "returncode", "ncoamatchcode", "matchcode", "ncoaactioncode", "actioncode", "coareturncode", "ncoafootnote", "ncoaresult", "ncoacode"],
  type: ["movetype", "ncoamovetype", "coamovetype", "coatype"],
  date: ["moveeffectivedate", "movedate", "coaeffectivedate", "ncoamovedate", "effectivedate", "moveeffective"],
  addr1: ["newaddressline1", "newaddress1", "newaddress", "newstreet", "coaaddress", "coaaddressline1", "ncoaaddress", "ncoaaddressline1", "newprimaryaddress"],
  addr2: ["newaddressline2", "newaddress2", "coaaddressline2", "ncoaaddressline2", "newsecondaryaddress"],
  city: ["newcity", "coacity", "ncoacity"],
  state: ["newstate", "coastate", "ncoastate"],
  zip: ["newzip", "newzipcode", "newzip4", "newzipplus4", "coazip", "ncoazip", "newpostalcode"],
  plus4: ["newplus4", "newzip4code", "coaplus4", "ncoaplus4"],
};
const keyOf = h => String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
// USPS NCOALink return codes. A, 91 and 92 carry a new address; 01, 02, 03
// and 19 are moves where the person can no longer be mailed at the old one and
// there is no new address to use. Everything else is "no move found".
const MOVE_WITH_ADDRESS = new Set(["A", "91", "92"]);
const MOVE_NO_FORWARD = { "01": "moved out of the country", "02": "moved and left no forwarding address", "03": "the PO box closed with no forwarding order", "19": "moved, but the new address could not be confirmed" };
const MOVE_TYPES = { I: "person", INDIVIDUAL: "person", F: "family", FAMILY: "family", B: "business", BUSINESS: "business" };

function ncoaMoveDate(s) {
  const t = String(s || "").trim();
  let m;
  if ((m = t.match(/^(\d{4})(\d{2})$/))) return `${m[1]}-${m[2]}`;
  if ((m = t.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/))) return `${m[1]}-${m[2].padStart(2, "0")}`;
  if ((m = t.match(/^(\d{1,2})\/(\d{4})$/))) return `${m[2]}-${m[1].padStart(2, "0")}`;
  if ((m = t.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/))) return `${m[2]}-${m[1].padStart(2, "0")}`;
  return null;
}

// The returned file → one entry per row: a move with a new address, a move
// with none (mark not mailable), or no move. Unknown layouts are refused with
// the column that is missing, never guessed.
function readNcoaReturn(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { error: "The file has no rows." };
  const head = rows[0].map(keyOf);
  const col = {};
  for (const [k, names] of Object.entries(NCOA_COLS)) col[k] = head.findIndex(h => names.includes(h));
  if (col.id < 0) return { error: "The file has no Record ID column, so its rows can't be matched to people. Send the file Steward prepared and ask the provider to keep that column." };
  if (col.code < 0 && col.addr1 < 0) return { error: "The file has no return code and no new address column, so it can't say who moved." };
  const at = (r, k) => (col[k] >= 0 ? String(r[col[k]] || "").trim() : "");
  const entries = [];
  for (const r of rows.slice(1)) {
    const id = at(r, "id");
    if (!id) continue;
    const code = at(r, "code").toUpperCase();
    const newAddr = { address: at(r, "addr1"), address2: at(r, "addr2"), city: at(r, "city"), state: at(r, "state").toUpperCase(), zip: at(r, "zip") };
    if (newAddr.zip && at(r, "plus4") && /^\d{5}$/.test(newAddr.zip)) newAddr.zip = `${newAddr.zip}-${at(r, "plus4")}`;
    const moveType = MOVE_TYPES[at(r, "type").toUpperCase()] || null;
    const moveDate = ncoaMoveDate(at(r, "date"));
    const hasNew = !!(newAddr.address && newAddr.city && newAddr.state);
    if (MOVE_NO_FORWARD[code]) entries.push({ recordId: id, code, kind: "no_forwarding", words: MOVE_NO_FORWARD[code], moveType, moveDate, newAddress: null });
    else if ((MOVE_WITH_ADDRESS.has(code) || (!code && col.code < 0)) && hasNew) entries.push({ recordId: id, code: code || null, kind: "move", words: "moved", moveType, moveDate, newAddress: newAddr });
    else entries.push({ recordId: id, code: code || null, kind: "none" });
  }
  return { entries };
}

module.exports = {
  NICKNAMES, normName, nameRelation, judgePair, findDuplicatePairs, pairKey, phoneKey, addressKey,
  MERGE_FIELDS, ADDRESS_GROUP, defaultChoices, resolveMergedValues,
  tidyAddress, oneLine, titleCase,
  TYPO_DOMAINS, ROLE_LOCALS, isValidEmail, emailIssues,
  NCOA_EXPORT_COLUMNS, mailable, ncoaExportCsv, parseCsv, readNcoaReturn, MOVE_NO_FORWARD,
};

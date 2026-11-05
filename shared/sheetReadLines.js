// shared/sheetReadLines.js · IMPORT-8. What the sheet reader says about a file
// beside its plan: each communication choice with its column, the notes that
// read like one (listed, never acted on), the rows combined into a person,
// partners and households, a people sheet's amounts checked against the gift
// sheets, and one line for each count on a preview that differs from another.
// Moved out of shared/sheetRead.js (the 1,500-line ratchet); sheetRead calls
// these and re-exports countLines.
import { countLabel as plural } from "./countWords.js";
import { pledgeMoneyWords } from "./pledgeWords.js";

const s = v => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
const fmt$ = c => (c < 0 ? "-$" : "$") + (Math.abs(Math.round(c)) / 100).toLocaleString("en-US", { minimumFractionDigits: (c % 100) ? 2 : 0, maximumFractionDigits: 2 });
const hnorm = h => s(h).toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

// IMPORT-8 · FREE TEXT NEVER SETS OR CLEARS A CHOICE. A note that reads like
// a preference ("Asked for no more mail, email only") is listed for her to
// review, never acted on: on 3 Nov a "please remove" scan over every cell read
// 16 such notes backwards and blocked people who want email.
// in a Mailing list column only: the column names the choice, the cell says which
export const MAILING_REMOVE_RE = /\b(please remove|remove me|unsubscribe me|take me off|stop (emailing|mailing)|no more (emails?|mail))\b/i;
export const PREF_SAYS_RE = /\b(no more|don'?t|do not|never|stop|remove|removed|take (me|them|her|him) off|unsubscrib\w*|opt(ed)?[- ]?(out|in)|only|prefers?|wants?|asked)\b/i;
export const PREF_ABOUT_RE = /\b(e-?mails?|mail(ing|ings)?|newsletters?|letters?|calls?|phone|contact|solicit\w*|appeals?)\b/i;
// Bloomerang's "Communication Restrictions" names each choice in its cells
export const RESTRICTION_CODES = [["doNotCall", /do\s*not\s*call|no\s*calls?/i], ["doNotMail", /do\s*not\s*mail|no\s*mail/i],
  ["doNotEmail", /do\s*not\s*e-?mail|no\s*e-?mail/i], ["doNotContact", /do\s*not\s*(contact|solicit)|no\s*solicit/i]];
// IMPORT-8: a phone on more people than this is the org's switchboard, not a household's
export const SHARED_PHONE_MAX = 10;
// IMPORT-8: a money header that is about a person, not one gift
export const PEOPLE_MONEY_HDR_RE = /lifetime|total|last\s*gift|largest|first\s*gift|ytd|year to date|cumulative|average|\b(19|20)\d\d\b|to date|giving/i;

// IMPORT-8 · THE COUNTS ON ONE PREVIEW AGREE OR SAY WHY. Gift rows, gifts
// and the deposit question, and the set-aside count beside the set-aside
// list, each differ for a reason; one line names each difference. Called by
// understand and again by the server once it has held back the people who
// match someone deleted, so the lines read the plan that will be written.
export function countLines(u) {
  const out = [];
  const N = x => Number(x || 0).toLocaleString("en-US");
  const gifts = (u.gifts || []).length, inst = (u.gifts || []).filter(g => g.kind === "installment").length;
  const nPledges = (u.pledges || []).length;
  if (inst) out.push({ kind: "gifts", sentence: `${plural(gifts, "gift")} = ${plural(gifts - inst, "gift row")} + ${plural(inst, "first payment")} on a pledge, which ${inst === 1 ? "rides" : "ride"} on ${inst === 1 ? "its" : "their"} pledge's row` });
  const L = u.rowLedger || { setAside: [], readBySheet: {} };
  const giftSheets = [...new Set((u.tables || []).filter(t => t.kind === "gifts").map(t => t.sheet))];
  if (giftSheets.length) {
    const rows = giftSheets.reduce((a, sh) => a + ((L.readBySheet || {})[sh] || 0), 0);
    const onSheets = k => k.filter(x => giftSheets.includes(x.sheet));
    const giftRows = new Set(onSheets((u.gifts || []).filter(g => g.kind !== "installment")).map(g => `${g.sheet}:${g.line}`)).size;
    const pledgeRows = new Set(onSheets(u.pledges || []).map(g => `${g.sheet}:${g.line}`)).size;
    const asideOn = onSheets(L.setAside || []).length;
    const otherRows = rows - giftRows - pledgeRows - asideOn;
    if (rows && (rows !== gifts || nPledges || asideOn)) out.push({ kind: "giftRows", sentence: `${plural(rows, "row")} on the gift ${giftSheets.length === 1 ? "sheet" : "sheets"} = ${plural(giftRows, "gift")}`
      + (pledgeRows ? ` + ${plural(pledgeRows, "pledge")}` : "") + ` + ${N(asideOn)} set aside` + (otherRows > 0 ? ` + ${plural(otherRows, "row")} read as people or notes` : "") });
  }
  const depQ = (u.questions || []).find(q => q.id === "giftsDeposited");
  if (depQ && depQ.count !== gifts) out.push({ kind: "deposit", sentence: `The deposit question asks about ${plural(depQ.count, "gift")} of the ${N(gifts)}: ${N(gifts - depQ.count)} ${gifts - depQ.count === 1 ? "is" : "are"} not asked about` });
  const listed = (L.setAside || []).length, asideRows = new Set((u.aside || []).map(a => `${a.sheet}:${a.line}`));
  const ofRows = (L.setAside || []).filter(x => asideRows.has(`${x.sheet}:${x.line}`)).length;
  const asideCount = (u.counts || {}).aside || 0;
  if (listed !== asideCount) out.push({ kind: "setAside", sentence: `${plural(listed, "line")} set aside: ${plural(ofRows, "row")} of people or gifts, each with its reason`
    + (listed - ofRows ? `, and ${plural(listed - ofRows, "line")} that ${listed - ofRows === 1 ? "is" : "are"} not a person or a gift (section labels, totals, repeated headers)` : "")
    + (asideCount !== ofRows ? `. The ${N(asideCount)} on the button counts each reason, and some rows have more than one` : "") });
  return out;
}

// IMPORT-8 · A GIFT IS COUNTED ONCE. When a workbook has a gift sheet, an
// amount on the people sheet (Lifetime, Last gift amount) is never a gift: it
// is a check against the gift sheets, said with both sums. On 3 Nov a Donors
// sheet's "Last Gift Amount" made a second gift beside the same gift on Gift
// History. A file with no gift sheet keeps reading it as a gift.
export function demotePeopleSheetAmounts(tables, { cellOf, dataRows }) {
  const named = t => t.cols.some(c => ["name", "first", "last", "lastFirst", "org", "email", "externalId"].includes(c.role));
  const giftish = t => t.kind === "gifts";
  const PEOPLE_SHEET = /donor|people|person|contact|constituent|member|supporter|account|household|roster|list/i;
  const GIFT_SHEET = /gift|donation|transaction|payment|history|opportunit|contribution|receipt|ledger/i;
  const oneRowEach = t => {
    const who = ["email", "externalId", "name", "lastFirst"].map(r => t.cols.find(c => c.role === r)).find(Boolean);
    const firstC = t.cols.find(c => c.role === "first"), lastC = t.cols.find(c => c.role === "last");
    const keyOf = b => who ? s(cellOf(t, b, who)).toLowerCase() : `${s(firstC ? cellOf(t, b, firstC) : "")} ${s(lastC ? cellOf(t, b, lastC) : "")}`.toLowerCase().trim();
    const ks = dataRows(t).map(keyOf).filter(Boolean);
    return ks.length > 0 && new Set(ks).size >= ks.length * 0.95;
  };
  const giftTabs = tables.filter(giftish);
  for (const t of giftTabs) {
    if (!named(t)) continue;
    const amt = t.cols.find(c => c.role === "amount"); if (!amt) continue;
    const others = giftTabs.filter(o => o !== t && o.sheet !== t.sheet);
    if (!others.length) continue;
    const peopleLike = PEOPLE_MONEY_HDR_RE.test(hnorm(amt.header)) || (PEOPLE_SHEET.test(t.sheet) && !GIFT_SHEET.test(t.sheet));
    const otherIsGifts = others.some(o => GIFT_SHEET.test(o.sheet) || dataRows(o).length > dataRows(t).length || !oneRowEach(o));
    if (!peopleLike || !otherIsGifts || !oneRowEach(t)) continue;
    const last = /last|recent|latest|largest|first/i.test(hnorm(amt.header));
    amt.role = "totalOf"; amt.checkKind = last ? "lastGift" : "lifetime"; amt.by = "rule";
    amt.reason = `an amount on the people sheet, checked against the ${others.map(o => o.sheet).join(" and ")} sheet, never a gift`;
    for (const c of t.cols) if (["date", "method", "fund", "campaign", "giftId", "paid", "status", "frequency", "type"].includes(c.role)) {
      c.role = "keep"; c.by = "rule"; c.reason = `a gift detail on the people sheet; the gifts come from the ${others.map(o => o.sheet).join(" and ")} sheet`;
    }
    t.kind = "people"; t.giftsElsewhere = others.map(o => o.sheet);
  }
  // a Lifetime column on a people sheet beside a gift sheet is the same check
  for (const t of tables) if (t.kind === "people" && giftTabs.some(o => o.kind === "gifts" && o.sheet !== t.sheet)) for (const c of t.cols) {
    if ((c.role == null || c.role === "keep") && !c.duplicateOf && /^(lifetime|lifetime (giving|total|gifts?|amount|given)|total lifetime( giving)?|lifetime value|ltv|total giving|giving to date|cumulative giving)$/.test(hnorm(c.header)) && c.profile.money >= 0.8) {
      c.role = "totalOf"; c.checkKind = "lifetime"; c.by = "rule";
      c.reason = "a lifetime total on the people sheet, checked against the gift sheets, never a gift";
    }
  }
}

// IMPORT-8 · THE ROWS COMBINED, NAMED: "5 rows matched another row by email:
// …", so 1,005 rows → 1,000 people adds up on screen.
export function mergedLinesOf(merged) {
  const MERGE_BY = { email: "by email", id: "by the ID in the file", name: "by the same name", near: "as a near-duplicate you said is the same person", phone: "by phone" };
  return Object.entries(merged.reduce((m, x) => { (m[x.by] = m[x.by] || []).push(x); return m; }, {})).map(([by, xs]) => ({
    by, count: xs.length,
    sentence: `${plural(xs.length, "row")} matched another row ${MERGE_BY[by] || "by " + by}: `
      + xs.slice(0, 10).map(x => `${x.name} (line ${x.line}${xs.length && x.sheet ? ` of ${x.sheet}` : ""}, the same person as ${String(x.intoLine || "").replace(/^.*:/, "line ")})`).join("; ")
      + (xs.length > 10 ? `; and ${(xs.length - 10).toLocaleString("en-US")} more` : ""),
  }));
}

// IMPORT-8 · A PARTNER IS OFFERED AS A LINK, never a custom field: a name in
// the Spouse/Partner column that is a person in this file is linked into one
// household with them unless she says no (answers.spouseLinks = "no"). A
// household column, and linked partners, become households: one per name.
export function partnersAndHouseholds(peopleList, answers = {}) {
  const byFullName = new Map();
  for (const p of peopleList) if (p.kind === "person") { const k = s(p.name).toLowerCase(); byFullName.set(k, byFullName.has(k) ? null : p); }
  const spouseLinks = [];
  for (const p of peopleList) {
    if (!p.spouseName || p.spouseKey) continue;
    const o = byFullName.get(p.spouseName.toLowerCase());
    if (!o || o === p) continue;
    p.spouseKey = o.key; if (!o.spouseKey) o.spouseKey = p.key;
    if (!spouseLinks.some(x => x.b === p.key && x.a === o.key)) spouseLinks.push({ a: p.key, b: o.key, aName: p.name, bName: o.name });
  }
  const linkSpouses = answers.spouseLinks !== "no";

  // a household column, and linked partners, become households: one per name
  const householdGroups = new Map();
  for (const p of peopleList) if (p.householdName) { const k = "col:" + p.householdName.toLowerCase(); if (!householdGroups.has(k)) householdGroups.set(k, { name: p.householdName, keys: [] }); householdGroups.get(k).keys.push(p.key); }
  if (linkSpouses) for (const x of spouseLinks) {
    const pa = peopleList.find(p => p.key === x.a), pb = peopleList.find(p => p.key === x.b);
    if (pa.householdName || pb.householdName) continue;   // the file's own household wins
    const last = s(pa.name).split(/\s+/).pop();
    householdGroups.set("sp:" + [x.a, x.b].sort().join("|"), { name: `${s(pa.name).split(/\s+/)[0]} & ${s(pb.name).split(/\s+/)[0]} ${last}`, keys: [x.a, x.b] });
  }
  for (const [k, g] of householdGroups) for (const key of g.keys) { const p = peopleList.find(x => x.key === key); if (p) p.householdGroup = k; }
  const householdLine = householdGroups.size ? { count: householdGroups.size, people: [...householdGroups.values()].reduce((a, g) => a + g.keys.length, 0),
    sentence: `${plural([...householdGroups.values()].reduce((a, g) => a + g.keys.length, 0), "person", "people")} in ${plural(householdGroups.size, "household")}`
      + ([...householdGroups.keys()].some(k => k.startsWith("col:")) ? " from the Household column" : "") + ([...householdGroups.keys()].some(k => k.startsWith("sp:")) ? ", partners linked" : "") } : null;
  return { spouseLinks, householdGroups, householdLine };
}
export function spouseQuestion(spouseLinks, answers = {}) {
  return { id: "spouseLinks", kind: "spouseLinks", optional: true, defaulted: true, default: "link", answer: answers.spouseLinks !== "no" ? "link" : "no",
    count: spouseLinks.length, pairs: spouseLinks.slice(0, 50),
    text: `${plural(spouseLinks.length, "partner")} named in the Spouse/Partner column ${spouseLinks.length === 1 ? "is" : "are"} in this file. Link each pair into one household?`,
    hint: `For example ${spouseLinks[0].aName} and ${spouseLinks[0].bName}. A name that is not in the file is kept on the person as their partner's name.`,
    options: [{ key: "link", label: "Link them" }, { key: "no", label: "Leave them separate" }] };
}

// IMPORT-8 · EACH CHOICE WITH ITS COLUMN: "36 marked Do not email (column 'Do
// not email')". A note that reads like a preference is a line to review.
export function choiceLines(peopleList) {
  const COMMS_LINE = { optOut: "opted out of email", doNotEmail: "marked Do not email", doNotMail: "marked Do not mail", doNotCall: "marked Do not call",
    doNotContact: "marked Do not contact", deceased: "marked Deceased", optIn: "on the mailing list" };
  const commsLines = Object.keys(COMMS_LINE).map(k => {
    const who = peopleList.filter(p => p.comms[k]);
    if (!who.length) return null;
    const cols = [...new Set(who.map(p => p.comms[k].header))];
    return { kind: k, count: who.length, columns: cols,
      sentence: `${who.length.toLocaleString("en-US")} ${COMMS_LINE[k]} (${cols.length === 1 ? "column" : "columns"} ${cols.map(h => `'${h}'`).join(", ")})` };
  }).filter(Boolean);
  const prefNotePeople = peopleList.filter(p => p.prefNotes && p.prefNotes.length);
  const prefNotes = prefNotePeople.length ? {
    count: prefNotePeople.length,
    sentence: `${plural(prefNotePeople.length, "note")} ${prefNotePeople.length === 1 ? "mentions" : "mention"} mail or email; nothing was changed`,
    people: prefNotePeople.slice(0, 50).map(p => ({ name: p.name, email: p.email || null, ...p.prefNotes[0] })),
  } : null;
  return { commsLines, prefNotes, prefNotePeople };
}

// "Gave at dinner" beside a gift sheet: skipped only when it foots, person by
// person, against the gifts this file gives them; otherwise kept, never lost.
// IMPORT-8: a people sheet's Lifetime or Last gift is the same check, said with
// both sums. Moved from understand (shared/sheetRead.js).
export function amountChecks({ usable, people, gifts, giftTables, personGiftCents, keptHeaders, cellOf, dataRows, moneyOf, cents }) {
  const totalOfChecks = [];
  // IMPORT-8: who each line is, once (the find over every person was n²)
  const personAtLine = new Map();
  for (const p of people.values()) for (const ln of p.lines) personAtLine.set(ln, p);
  const latestGift = new Map();
  for (const gf of gifts) {
    if (!gf.date || !gf.personKey) continue;
    const x = latestGift.get(gf.personKey), later = !x || String(gf.date).localeCompare(x.date) > 0;
    if (later) latestGift.set(gf.personKey, { date: gf.date, cents: gf.cents }); else if (gf.date === x.date && gf.cents > x.cents) x.cents = gf.cents;
  }
  for (const t of usable) for (const c of t.cols.filter(c => c.role === "totalOf")) {
    let checked = 0, agree = 0, fileCents = 0, sheetGiftCents = 0;
    const misses = [];
    for (const b of dataRows(t)) {
      const v = moneyOf(cellOf(t, b, c)); if (v == null) continue;
      const pk = personAtLine.get(`${t.sheet}:${b.line}`);
      checked++;
      const theirs = !pk ? 0 : c.checkKind === "lastGift" ? ((latestGift.get(pk.key) || {}).cents || 0) : (personGiftCents.get(pk.key) || 0);
      fileCents += cents(v); sheetGiftCents += theirs;
      if (pk && theirs === cents(v)) agree++;
      else misses.push({ line: b.line, who: pk ? pk.name : null, cents: cents(v), gifts: theirs });
    }
    const footed = checked > 0 && giftTables.length > 0 && agree === checked;
    const giftSheetNames = giftTables.map(g => g.sheet).join(" and ");
    // "Donors sheet's Lifetime column: $X; the gift sheets add up to $Y"
    const sentence = c.checkKind && giftTables.length
      ? `${t.sheet} sheet's ${c.header} column: ${fmt$(fileCents)}; ${c.checkKind === "lastGift" ? "the last gift of each person on the gift sheets adds up to" : "the gift sheets add up to"} ${fmt$(sheetGiftCents)}.`
        + (footed ? ` All ${checked.toLocaleString("en-US")} people agree to the cent.` : ` ${plural(checked - agree, "person", "people")} ${checked - agree === 1 ? "differs" : "differ"}; the gifts come from ${giftSheetNames} only, and nothing is added for the difference.`)
      : null;
    totalOfChecks.push({ sheet: t.sheet, header: c.header, kind: c.checkKind || "total", checked, agree, footed, fileCents, giftCents: sheetGiftCents, sentence, misses: misses.slice(0, 50) });
    if (footed) { c.skipReason = c.checkKind ? `checked against the ${giftSheetNames} sheet: all ${checked} agree to the cent` : `a total of each person's gifts on the ${giftSheetNames} sheet (checked: all ${checked} agree to the cent)`; }
    else {
      c.role = "keep"; c.disposition = "kept"; c.reason = giftTables.length
        ? `${c.checkKind ? "an amount on the people sheet, never a gift" : "it looks like a total"}, but ${checked - agree} of ${checked} people do not match their gifts here, so it is kept under its own name`
        : "a total with no gift rows behind it, kept under its own name";
      for (const b of dataRows(t)) {
        const v = s(cellOf(t, b, c)); if (!v) continue;
        const pk = personAtLine.get(`${t.sheet}:${b.line}`);
        if (pk && pk.kept[c.header] == null) { pk.kept[c.header] = v; if (!keptHeaders.has(c.header)) keptHeaders.set(c.header, { header: c.header, sheet: t.sheet, count: 0 }); keptHeaders.get(c.header).count++; }
      }
    }
  }
  return totalOfChecks;
}

// Moved verbatim from shared/sheetRead.js (IMPORT-8, the line ratchet).
export function importButtonSentence(u, extra = {}) {
  const c = u.counts || {};
  const asideShare = (c.aside || 0) / Math.max(1, (c.records || 0) + (c.aside || 0));
  const money = (c.giftCents || 0) + (c.pledgeThisYearCents || 0);
  const asideMoney = (u.aside || []).reduce((a, x) => a + Math.abs(x.cents || 0), 0);
  const review = !!(c.aside && (asideShare > 0.05 || asideMoney > 0.05 * Math.max(1, money + asideMoney)));
  const parts = [];
  const sub = [];
  if (c.donors) sub.push(plural(c.donors, "donor"));
  if (c.volunteers) sub.push(plural(c.volunteers, "volunteer"));
  // EVENTS-3: a couple's row is one entry on her list and two people in
  // Steward. The button says what will exist (the people) and the list's own
  // count beside it ("558 people, 443 on the list"): SWEEP-2's "558 against 443".
  const onList = c.records != null && c.persons != null && c.records !== c.persons ? `, ${(c.records || 0).toLocaleString("en-US")} on the list` : "";
  parts.push(`${plural(c.persons || 0, "person", "people")}${onList}${sub.length ? ` (${sub.join(", ")})` : ""}`);
  if (c.gifts) parts.push(`${plural(c.gifts, "gift")} ${fmt$(c.giftCents)}${c.undatedGifts ? ` (${c.undatedGifts.toLocaleString("en-US")} undated)` : ""}`);
  if (c.pledges) parts.push(`${plural(c.pledges, "pledge")} ${pledgeMoneyWords({ dueThisYearCents: c.pledgeDueThisYearCents, openCents: c.pledgeOpenCents, years: c.pledgeYears, undatedCents: c.pledgeUndatedCents }, fmt$)}`);
  if (u.event && u.event.name && u.event.fromEngagement) {
    const rows = c.attendedRecords ?? c.attended;
    parts.push(`${u.event.name}: ${rows.toLocaleString("en-US")} attended${rows !== c.attended ? ` (${c.attended.toLocaleString("en-US")} people)` : ""}`);
  }
  if (c.optOuts) parts.push(plural(c.optOuts, "opt-out"));
  if (c.doNotEmail) parts.push(`${c.doNotEmail.toLocaleString("en-US")} do not email`);
  if (c.doNotContact) parts.push(`${c.doNotContact.toLocaleString("en-US")} do not contact`);
  if (extra.matched) parts.push(`${extra.matched.toLocaleString("en-US")} already in Steward`);
  if (extra.waiting) parts.push(`${extra.waiting.toLocaleString("en-US")} waiting on your answer`);
  const importText = "Import " + parts.join(" · ");
  return review ? { review, text: `Review ${c.aside.toLocaleString("en-US")} set aside first`, importText } : { review, text: importText, importText };
}

// IMPORT-8: a note that reads like a preference ("Asked for no more mail,
// email only") is listed on the person for review; it sets nothing.
const NOTE_ROLES = new Set(["keep", "note", "giftNote", "aboutThem", null, undefined]);
export function notePreferences(person, cells, sheet, line) {
  for (const c of cells) {
    if (!NOTE_ROLES.has(c.role)) continue;
    const v = c.value;
    if (!(v && v.length > 3 && PREF_SAYS_RE.test(v) && PREF_ABOUT_RE.test(v))) continue;
    person.prefNotes = person.prefNotes || [];
    if (!person.prefNotes.some(x => x.value === v)) person.prefNotes.push({ header: c.header, value: v.slice(0, 200), sheet, line });
  }
}
// IMPORT-8: tags (split on ; , |), About them, a partner's name, a household
export function personFields(person, get) {
  const tg = get("tags");
  if (tg) { person.tags = person.tags || []; for (const x of tg.split(/[;,|]/).map(v => v.trim()).filter(Boolean)) if (!person.tags.some(y => y.toLowerCase() === x.toLowerCase())) person.tags.push(x.slice(0, 60)); }
  const ab = get("aboutThem"); if (ab && !person.aboutThem) person.aboutThem = ab.slice(0, 500);
  const sp = get("spouse"); if (sp && !person.spouseName) person.spouseName = sp.slice(0, 200);
  const hn = get("householdName"); if (hn && !person.householdName) person.householdName = hn.slice(0, 200);
}
// IMPORT-8: a file of people with an amount and no gift sheet keeps reading
// that amount as one gift a person, and says so.
export function peopleSheetGiftsOf(tables, giftTables) {
  if (tables.some(t => t.giftsElsewhere)) return null;
  const one = giftTables.length === 1 && giftTables[0];
  if (!one) return null;
  const amt = one.cols.find(c => c.role === "amount");
  if (!amt || !PEOPLE_MONEY_HDR_RE.test(hnorm(amt.header))) return null;
  return { sheet: one.sheet, header: amt.header, sentence: `There is no gift sheet in this file, so the ${amt.header} column is read as one gift for each person.` };
}

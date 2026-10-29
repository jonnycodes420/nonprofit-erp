// donorMatch.js · CHECK-2. WHO IS THIS FROM, IN A FILE THAT ALREADY HAS THEM?
//
// personMatch.js answers a door with one exact name or an email. A check is
// messier: "HENRIETTA M. DUFFIELD / GEORGE A. DUFFIELD" for a file that has
// "Henrietta Duffield" and 27 other Henriettas. The confirm card, and IMPORT-3's
// rows, ask this module first and make somebody new only when it says "none"
// and a person chooses "New donor".
//
// THE SIGNALS, in the order they decide:
//   1. Email, lower-cased: one record is the answer.
//   2. The name. Every name on the item is parsed (first, middle initials,
//      last) and compared only with records of the SAME last name, so a common
//      first name alone never matches anyone. Same last name plus the same first
//      name (with or without a middle initial), a nickname of it (Bill for
//      William), or the same first initial is a strong match. A middle initial
//      that disagrees is somebody else. Last name alone is weak.
//   3. The household: a second name on a joint check that is the spouse on
//      file, or a member of the same household, says it is the same family.
//   4. The address: the street number and street, or the ZIP, against the
//      address on file. It turns a weak match strong and breaks a tie.
//   One strong person (or one household) is "matched", with the reasons and
//   their history in one sentence. Two or more is "choices", one click each.
//   Nothing strong is "none", and the weak ones are offered as choices.
//
// NOT USED: the bank account. A one-way fingerprint of the account number would
// have to be computed from the number, which means reading the MICR line (the
// model is told never to) and holding it in memory; and a keyed hash of a
// 10-to-12-digit number is rebuilt by trying every number with the key, which
// the server has. So it would store something that can rebuild the number, and
// it is skipped.
"use strict";

const { query } = require("./db");

// The nicknames people sign checks with. Each line is one family of names.
const NICK_GROUPS = [
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
];
const NICK = new Map();
for (const g of NICK_GROUPS) {
  const names = g.split(" ");
  for (const n of names) NICK.set(n, new Set([...(NICK.get(n) || []), ...names]));
}
const sameFirst = (a, b) => a === b || !!(NICK.get(a) && NICK.get(a).has(b));

const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "md", "phd", "esq", "dds", "cpa"]);
const TITLE = new Set(["mr", "mrs", "ms", "miss", "dr", "rev", "prof", "hon", "mx"]);
const lc = s => String(s || "").trim().toLowerCase();
const word = s => lc(s).replace(/[^a-z'-]/g, "").replace(/^['-]+|['-]+$/g, "");

// "HENRIETTA M. DUFFIELD" -> { first: "henrietta", middle: ["m"], last: "duffield" }.
// "Duffield, Henrietta M." reads the same.
function parseName(raw) {
  let s = String(raw || "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const comma = s.match(/^([^,]+),\s*(.+)$/);
  if (comma && !SUFFIX.has(word(comma[2]))) s = `${comma[2]} ${comma[1]}`;
  const parts = s.split(" ").map(word).filter(Boolean).filter(w => !TITLE.has(w));
  while (parts.length > 1 && SUFFIX.has(parts[parts.length - 1])) parts.pop();
  if (!parts.length) return null;
  if (parts.length === 1) return { first: "", middle: [], last: parts[0], raw: String(raw).trim() };
  return { first: parts[0], middle: parts.slice(1, -1).map(m => m[0]), last: parts[parts.length - 1], raw: String(raw).trim() };
}

// The names on one check: "A / B", "A & B", "A and B", one per line. A shared
// last name is lent to a first name standing alone ("Henrietta & George
// Duffield" is two Duffields).
function splitNames(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  const bits = s.split(/\s*(?:\/|\n|;|\s&\s|\s\+\s|\sand\s|\sor\s)\s*/i).map(x => x.trim()).filter(Boolean);
  const out = bits.map(b => ({ text: b, p: parseName(b) })).filter(x => x.p);
  const lastFull = [...out].reverse().find(x => x.p.first);
  for (const x of out) {
    if (!x.p.first && lastFull && x !== lastFull && out.length > 1) {
      // "Henrietta" alone beside "George Duffield": a first name, borrowing his last.
      x.p = { first: x.p.last, middle: [], last: lastFull.p.last, raw: `${x.text} ${lastFull.text.split(/\s+/).pop()}` };
      x.text = x.p.raw;
    }
  }
  return out.map(x => ({ text: x.text, ...x.p }));
}

// PROPER CASE, for a name READ OFF A CHECK and only when it was printed all in
// capitals (or all in lower case). A name a person typed keeps its capitals.
const LOWER_PARTICLES = new Set(["van", "von", "de", "der", "den", "da", "di", "du", "la", "le", "del", "della", "of", "and"]);
function properCase(raw) {
  const s = String(raw || "");
  if (!s.trim()) return s;
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (!letters || (letters !== letters.toUpperCase() && letters !== letters.toLowerCase())) return s;
  const cap = w => w ? w[0].toUpperCase() + w.slice(1) : w;
  return s.toLowerCase().split(/(\s+)/).map((tok, i) => {
    if (/^\s+$/.test(tok)) return tok;
    if (i > 0 && LOWER_PARTICLES.has(tok)) return tok;
    if (/^(ii|iii|iv)$/.test(tok)) return tok.toUpperCase();
    return tok.split(/([-'’])/).map(p => {
      if (/^[-'’]$/.test(p)) return p;
      if (/^mc[a-z]{2,}/.test(p)) return "Mc" + cap(p.slice(2));
      return cap(p);
    }).join("");
  }).join("");
}

// "123 Main Street, Apt 4" and "123 Main St" are the same house: the number
// and the first word of the street.
function streetKey(line1) {
  const m = lc(line1).replace(/[.,#]/g, " ").match(/^\s*(\d+[a-z]?)\s+([a-z0-9]+)/);
  return m ? `${m[1]} ${m[2]}` : null;
}
const zip5 = z => String(z || "").replace(/[^0-9]/g, "").slice(0, 5) || null;

const likeEscape = s => String(s).replace(/[\\%_]/g, c => "\\" + c);

// One read name against one record's name: { strength, why } or null.
function nameFit(n, rec) {
  const r = parseName(rec);
  if (!r || !n || r.last !== n.last) return null;
  if (n.middle.length && r.middle.length && n.middle[0] !== r.middle[0]) return null;   // a different middle initial is somebody else
  if (!n.first || !r.first) return { strength: "weak", why: "same last name" };
  if (n.first === r.first) return { strength: "strong", why: "same name" };
  if (sameFirst(n.first, r.first)) return { strength: "strong", why: `${properCase(n.first)} is short for ${properCase(r.first)}` };
  if ((n.first.length === 1 || r.first.length === 1) && n.first[0] === r.first[0]) return { strength: "initial", why: "same last name and first initial" };
  return null;
}

// "same name" and "same address" read as "same name and address".
function whyLine(whys) {
  const w = [...whys];
  const i = w.indexOf("same name"), j = w.indexOf("same address");
  if (i >= 0 && j >= 0) { w[i] = "same name and address"; w.splice(j, 1); }
  return w.join(", ");
}

async function historyLine(orgId, id, q) {
  if (q.snapshot) return q.snapshot.history(id);
  const [h] = await q(`SELECT COUNT(*)::int AS n, MIN(LEFT(date,4)) AS since FROM gifts WHERE org_id=? AND donor_id=? AND amount > 0`, [orgId, id]);
  const n = h ? Number(h.n) : 0;
  return n ? `${n} ${n === 1 ? "gift" : "gifts"} since ${h.since}` : "no gifts yet";
}

// matchDonor(orgId, { name, names, email, line1, postal }) ->
//   { state: "matched" | "choices" | "none", selectedId, sentence,
//     choices: [{ id, name, why, history }], joint: [{ name, id, relation, sentence }],
//     names: the parsed names, in the order written }
async function matchDonor(orgId, input = {}, q = query) {
  const email = lc(input.email);
  const names = Array.isArray(input.names) ? input.names.flatMap(splitNames) : splitNames(input.name);
  const street = streetKey(input.line1), zip = zip5(input.postal);
  const empty = { state: "none", selectedId: null, sentence: null, choices: [], joint: [], names };

  if (email) {
    const m = q.snapshot ? q.snapshot.byEmail(email, 1) : await q(`SELECT id, name FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(TRIM(email))=?
                         ORDER BY created_at ASC NULLS LAST, id LIMIT 1`, [orgId, email]);
    if (m.length) {
      const history = await historyLine(orgId, m[0].id, q);
      return { ...empty, state: "matched", selectedId: m[0].id, by: "email",
        choices: [{ id: m[0].id, name: m[0].name, why: "same email", history }],
        sentence: `Matched ${m[0].name}: same email, ${history}.`, joint: await jointFor(orgId, names, m[0], q) };
    }
  }
  if (!names.length) return empty;

  // Everyone with one of these last names, plus anyone whose spouse on file
  // carries one, plus the members of a household named for one.
  const lasts = [...new Set(names.map(n => n.last).filter(w => w.length >= 2))];
  if (!lasts.length) return empty;
  const like = lasts.map(l => `%${likeEscape(l)}%`);
  const rows = q.snapshot ? q.snapshot.byLastNames(lasts, 400) : await q(
    `SELECT d.id, d.name, d.email, d.address, d.zip, d.household_id, d.spouse_name
       FROM donors d LEFT JOIN households h ON h.id = d.household_id AND h.org_id = d.org_id
      WHERE d.org_id=? AND d.deleted_at IS NULL
        AND (${lasts.map(() => "LOWER(d.name) LIKE ? OR LOWER(COALESCE(d.spouse_name,'')) LIKE ? OR LOWER(COALESCE(h.name,'')) LIKE ?").join(" OR ")})
      ORDER BY d.created_at ASC NULLS LAST, d.id LIMIT 400`,
    [orgId, ...like.flatMap(l => [l, l, l])]);

  // Score every record against every name on the check.
  const byId = new Map();
  const note = (rec, strength, why, nameIdx) => {
    const cur = byId.get(rec.id) || { rec, strength: "weak", whys: [], nameIdx: new Set() };
    const rank = { weak: 0, initial: 1, strong: 2 };
    if (rank[strength] > rank[cur.strength]) cur.strength = strength;
    if (!cur.whys.includes(why)) cur.whys.push(why);
    if (nameIdx != null) cur.nameIdx.add(nameIdx);
    byId.set(rec.id, cur);
  };
  names.forEach((n, i) => {
    for (const rec of rows) {
      const f = nameFit(n, rec.name);
      if (f) note(rec, f.strength, f.why, i);
    }
  });
  // The first initial is strong only when it points at one person of that last name.
  const initials = [...byId.values()].filter(c => c.strength === "initial");
  for (const c of initials) {
    const rivals = initials.filter(o => [...o.nameIdx].some(i => c.nameIdx.has(i)));
    c.strength = rivals.length === 1 ? "strong" : "weak";
  }
  // The address on file: a strong reason of its own, and a tie-breaker.
  for (const c of byId.values()) {
    const sameStreet = street && streetKey(c.rec.address) === street;
    const sameZip = zip && zip5(c.rec.zip) === zip;
    if (sameStreet) { c.whys.push("same address"); c.addr = 2; }
    else if (sameZip) { c.whys.push("same ZIP"); c.addr = 1; }
    else c.addr = 0;
    if (c.strength === "weak" && c.addr === 2) c.strength = "strong";
  }
  // The household: another name on the check is this person's spouse on file,
  // or a member of the same household.
  for (const c of byId.values()) {
    for (const [i, n] of names.entries()) {
      const sp = parseName(c.rec.spouse_name);
      if (sp && n.first && sameFirst(sp.first, n.first) && (!sp.last || sp.last === n.last) && !c.nameIdx.has(i)) {
        c.whys.push(`${properCase(n.raw)} is the spouse on file`); c.household = true;
      }
    }
    if (c.rec.household_id) {
      const mates = [...byId.values()].filter(o => o !== c && o.rec.household_id === c.rec.household_id && o.strength === "strong");
      if (mates.length) { c.household = true; if (!c.whys.includes("same household")) c.whys.push("same household"); }
    }
  }

  let strong = [...byId.values()].filter(c => c.strength === "strong");
  // A joint check is one household: keep the person the FIRST name on it is,
  // and let the household's other members ride along as the joint name.
  if (strong.length > 1) {
    const hh = new Set(strong.map(c => c.rec.household_id).filter(Boolean));
    const firstName = strong.filter(c => c.nameIdx.has(0));
    if (hh.size === 1 && strong.every(c => c.rec.household_id) && firstName.length === 1) strong = firstName;
  }
  if (strong.length > 1) {
    const best = Math.max(...strong.map(c => c.addr));
    if (best > 0) { const top = strong.filter(c => c.addr === best); if (top.length === 1) strong = top; }
  }
  if (strong.length > 1) {
    // Several of the first name on the check, or one per name: prefer the first name's.
    const first = strong.filter(c => c.nameIdx.has(0));
    if (first.length === 1 && strong.every(c => c.nameIdx.has(0) || c.household)) strong = first;
  }

  const choiceOf = async c => ({ id: c.rec.id, name: c.rec.name, why: whyLine(c.whys), history: await historyLine(orgId, c.rec.id, q) });
  if (strong.length === 1) {
    const c = strong[0];
    const ch = await choiceOf(c);
    return { ...empty, state: "matched", selectedId: c.rec.id, by: c.addr === 2 ? "name_address" : "name",
      choices: [ch], sentence: `Matched ${c.rec.name}: ${ch.why}, ${ch.history}.`, joint: await jointFor(orgId, names, c.rec, q) };
  }
  if (strong.length > 1) {
    const choices = [];
    for (const c of strong.slice(0, 8)) choices.push(await choiceOf(c));
    return { ...empty, state: "choices", choices, sentence: `${choices.length} people could be ${names[0].raw ? properCase(names[0].raw) : "this"}. Choose one.` };
  }
  const weak = [...byId.values()].filter(c => c.strength !== "strong").slice(0, 5);
  if (weak.length) {
    const choices = [];
    for (const c of weak) choices.push(await choiceOf(c));
    return { ...empty, state: "none", choices, sentence: `Nobody in Steward is clearly ${properCase(names[0].raw)}. These share the last name; choose one, or add a new donor.` };
  }
  return { ...empty, sentence: `Nobody in Steward matches ${properCase(names[0].raw)}.` };
}

// The other names on a joint check, against the person chosen: the spouse on
// file, a member of the same household, another record, or nobody Steward has.
async function jointFor(orgId, names, person, q = query) {
  if (names.length < 2) return [];
  const [p] = q.snapshot ? [q.snapshot.byId(person.id)].filter(Boolean)
    : await q(`SELECT id, name, household_id, spouse_name FROM donors WHERE id=? AND org_id=?`, [person.id, orgId]);
  if (!p) return [];
  const mates = q.snapshot ? (p.household_id ? q.snapshot.householdOf(p.household_id, p.id) : [])
    : p.household_id ? await q(`SELECT id, name FROM donors WHERE org_id=? AND household_id=? AND id<>? AND deleted_at IS NULL`, [orgId, p.household_id, p.id]) : [];
  const own = parseName(p.name);
  const out = [];
  for (const n of names) {
    if (own && nameFit(n, p.name) && (!n.first || !own.first || n.first === own.first || sameFirst(n.first, own.first) || n.first[0] === own.first[0])) continue;
    const shown = properCase(n.raw);
    const mate = mates.find(m => nameFit(n, m.name) && nameFit(n, m.name).strength !== "weak");
    if (mate) { out.push({ name: shown, id: mate.id, relation: "household", recordName: mate.name }); continue; }
    const sp = parseName(p.spouse_name);
    if (sp && n.first && sameFirst(sp.first, n.first)) { out.push({ name: shown, id: null, relation: "spouse_on_file" }); continue; }
    const other = await matchDonor(orgId, { name: n.raw }, q);
    if (other.state === "matched" && other.selectedId !== p.id) { out.push({ name: shown, id: other.selectedId, relation: "other_record", recordName: other.choices[0].name }); continue; }
    out.push({ name: shown, id: null, relation: "not_on_file" });
  }
  return out;
}

// FIX-55 · THE ORG'S PEOPLE, READ ONCE, FOR A WHOLE FILE. matchDonor asks
// three or four questions of the database per name; a preview of 650 names
// against a remote database was 38 seconds of round trips, and every answer
// she gave read it again. orgSnapshot reads the living people and their gift
// history in two statements, and snapshotQuery(snap) is a `q` that answers
// matchDonor's, jointFor's and findPersonId's reads from it: the same matcher,
// the same rules, the same order (created_at, then id), no second matcher.
// Only for reads that happen inside one request; a write never goes through it.
async function orgSnapshot(orgId, q = query) {
  const rows = await q(
    `SELECT d.id, d.name, d.email, d.address, d.zip, d.household_id, d.spouse_name, d.is_client,
            d.external_donor_id, d.external_donor_ids, COALESCE(h.name,'') AS hh_name
       FROM donors d LEFT JOIN households h ON h.id = d.household_id AND h.org_id = d.org_id
      WHERE d.org_id=? AND d.deleted_at IS NULL
      ORDER BY d.created_at ASC NULLS LAST, d.id`, [orgId]);
  const hist = await q(`SELECT donor_id, COUNT(*)::int AS n, MIN(LEFT(date,4)) AS since FROM gifts
                         WHERE org_id=? AND amount > 0 AND donor_id IS NOT NULL GROUP BY donor_id`, [orgId]);
  const byId = new Map(), byEmail = new Map(), byName = new Map(), byHh = new Map(), byExt = new Map();
  const push = (m, k, v) => { if (!k) return; const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  for (const r of rows) {
    r.lname = lc(r.name); r.lspouse = lc(r.spouse_name); r.lhh = lc(r.hh_name);
    byId.set(r.id, r);
    push(byEmail, lc(r.email), r);
    push(byName, r.lname, r);
    if (r.household_id) push(byHh, r.household_id, r);
    let more = r.external_donor_ids;
    if (typeof more === "string") { try { more = JSON.parse(more); } catch { more = []; } }
    for (const x of [r.external_donor_id, ...(Array.isArray(more) ? more : [])]) push(byExt, lc(x), r);
  }
  const h = new Map(hist.map(x => [x.donor_id, x]));
  return {
    size: rows.length,
    byId: id => byId.get(id) || null,
    byEmail: (email, limit) => (byEmail.get(lc(email)) || []).slice(0, limit),
    byExactName: (name, limit) => (byName.get(lc(name)) || []).slice(0, limit),
    byExternalId: (x, limit) => (byExt.get(lc(x)) || []).slice(0, limit),
    // LOWER(name) LIKE '%last%' on the name, the spouse or the household, as the query does
    byLastNames(lasts, limit) {
      const out = [];
      for (const r of rows) {
        if (lasts.some(l => r.lname.includes(l) || r.lspouse.includes(l) || r.lhh.includes(l))) out.push(r);
        if (out.length >= limit) break;
      }
      return out;
    },
    householdOf: (hid, notId) => (byHh.get(hid) || []).filter(r => r.id !== notId),
    history(id) {
      const x = h.get(id), n = x ? Number(x.n) : 0;
      return n ? `${n} ${n === 1 ? "gift" : "gifts"} since ${x.since}` : "no gifts yet";
    },
  };
}
function snapshotQuery(snap) {
  const q = () => { throw new Error("snapshotQuery answers the matcher's reads only"); };
  q.snapshot = snap;
  return q;
}

module.exports = { orgSnapshot, snapshotQuery, matchDonor, jointFor, parseName, splitNames, properCase, nameFit, streetKey, sameFirst };

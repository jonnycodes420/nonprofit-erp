// scripts/seed/clean1-mess.js · CLEAN-1 Part 6. Believable mess for Harborlight.
//
// What an office's file looks like a year after two imports and a gala:
// eight pairs of records that are probably one person (three high, three
// medium, two low confidence, each for a different reason), fifteen addresses
// typed every which way, four emails that need a look, and four people whose
// change-of-address results are in tests/fixtures/clean1/harborlight-ncoa-return.csv.
//
// Called by scripts/seed-demo.js only, after the rest of the org exists. The
// seed checks itself through the same dataHealth.js the page reads, and stops
// if the mess is not what this header says it is.
"use strict";
const DH = require("../../dataHealth");

const P = "d_c1_";
// [id, name, email, phone, street, city, state, zip, extra]
const PAIRS = [
  // HIGH: same email, names differ by a middle initial
  ["h1a", "Robert Ellison", "rellison@seawall.example", null, null, "Portland", "ME", null],
  ["h1b", "Robert J. Ellison", "rellison@seawall.example", null, null, "Portland", "ME", null],
  // HIGH: same phone, one name is a nickname of the other
  ["h2a", "Katherine Sorensen", "ksorensen@lindenmail.example", "207-555-0143", null, "Falmouth", "ME", null],
  ["h2b", "Kate Sorensen", "kate.sorensen@quaymail.example", "(207) 555-0143", null, "Falmouth", "ME", null],
  // HIGH: same address, same name
  ["h3a", "Malcolm Whitaker", "malcolm.w@harbourpost.example", null, "22 Ferry Ln", "Portland", "ME", "04101"],
  ["h3b", "Malcolm Whitaker", "mwhitaker@tidewater.example", null, "22 Ferry Ln", "Portland", "ME", "04101"],
  // MEDIUM: same email, different names (a couple sharing one inbox)
  ["m1a", "Grace Lindqvist", "lindqvist.family@lindenmail.example", null, null, "Yarmouth", "ME", null],
  ["m1b", "Henrik Lindqvist", "lindqvist.family@lindenmail.example", null, null, "Yarmouth", "ME", null],
  // MEDIUM: same address, names a letter apart
  ["m2a", "Theresa Abernathy", "t.abernathy@quaymail.example", null, "9 Spring St", "South Portland", "ME", "04106"],
  ["m2b", "Teresa Abernathy", "teresa.ab@harbourpost.example", null, "9 Spring St", "South Portland", "ME", "04106"],
  // MEDIUM: same household, names differ by a middle initial
  ["m3a", "Samuel Okonkwo", "sam.okonkwo@seawall.example", null, null, "Cape Elizabeth", "ME", null, { household: "hh_c1_okonkwo" }],
  ["m3b", "Samuel T. Okonkwo", "s.t.okonkwo@tidewater.example", null, null, "Cape Elizabeth", "ME", null, { household: "hh_c1_okonkwo" }],
  // LOW: same employer, one name a nickname of the other
  ["l1a", "William Prescott", "wprescott@lindenmail.example", null, null, "Freeport", "ME", null, { employer: "Casco Bay Marine Supply" }],
  ["l1b", "Bill Prescott", "bill.p@quaymail.example", null, null, "Freeport", "ME", null, { employer: "Casco Bay Marine Supply" }],
  // LOW: same phone, different names
  ["l2a", "Nadia Haddad", "nadia.haddad@harbourpost.example", "207-555-0177", null, "Westbrook", "ME", null],
  ["l2b", "Omar Haddad", "ohaddad@seawall.example", "207-555-0177", null, "Westbrook", "ME", null],
];
const EXPECT = { high: [["h1a", "h1b"], ["h2a", "h2b"], ["h3a", "h3b"]], medium: [["m1a", "m1b"], ["m2a", "m2b"], ["m3a", "m3b"]], low: [["l1a", "l1b"], ["l2a", "l2b"]] };

// Fifteen addresses as people type them, each with a standard form.
const MESSY = [
  ["ad01", "Imogen Tarrant", "14 harbor view road", null, "portland", "maine", "04101"],
  ["ad02", "Lionel Ashcombe", "301 Congress Street Apartment 4B", null, "Portland", "ME", "041012345"],
  ["ad03", "Felicity Marlowe", "88 north elm st.", null, "Yarmouth", "me", "4096"],
  ["ad04", "Rupert Vane", "7 PINE AVENUE", "UNIT 2", "BRUNSWICK", "ME", "04011"],
  ["ad05", "Ottoline Price", "1200 forest ave suite 210", null, "Portland", "Maine", "04103"],
  ["ad06", "Jasper Quill", "45 W. Commercial St.", null, "portland", "ME", "04101-4630"],
  ["ad07", "Sybil Crane", "19 Ocean Boulevard", null, "Old Orchard Beach", "maine", "04064"],
  ["ad08", "Edmund Fairweather", "250 main street #3", null, "Westbrook", "ME", "04092"],
  ["ad09", "Henrietta Bloom", "6 bayview terrace", null, "Falmouth", "ME", "4105"],
  ["ad10", "Cosmo Hartley", "33 Middle St", "apt 12", "portland", "me", "04101"],
  ["ad11", "Winifred Ames", "410 payne road", null, "Scarborough", "Maine", "04074"],
  ["ad12", "Barnaby Thistle", "77 SOUTH STREET", null, "FREEPORT", "ME", "040321234"],
  ["ad13", "Clarissa Wren", "2 Lighthouse Lane", null, "cape elizabeth", "ME", "04107"],
  ["ad14", "Augustus Pell", "903 Brighton Avenue Apartment 2", null, "Portland", "ME", "04102"],
  ["ad15", "Marigold Finch", "15 north st", null, "saco", "me", "04072"],
];
// One the tidy cannot read, so the "flagged, never guessed" list is not empty.
const UNREADABLE = [["ad16", "Percival Gage", "The Old Sail Loft", null, "Bath", "ME", "04530"]];

// Four emails to look at: two typo domains, a shared office address on a
// person, and one that bounced.
const EMAILS = [
  ["em1", "Lucinda Vargas", "lucinda.vargas@gmial.com"],
  ["em2", "Desmond Achebe", "desmond.achebe@hotmial.com"],
  ["em3", "Philippa Rowe", "office@roweandsons.example"],
  ["em4", "Tobias Kerr", "tkerr@oldharbor.example", { bounced: true }],
];

// Four people with clean addresses whose results are in the sample file.
const MOVERS = [
  ["mv1", "Annika Bergstrom", "18 Danforth St", "Portland", "ME", "04101"],
  ["mv2", "Caspian Moore", "61 Pleasant St", "Brunswick", "ME", "04011"],
  ["mv3", "Delphine Okafor", "5 Mill Pond Rd", "Yarmouth", "ME", "04096"],
  ["mv4", "Evander Hale", "140 State St", "Portland", "ME", "04101"],
];

async function seedClean1Mess(q, ORG, { TODAY } = {}) {
  const by = ["u_b72demo", "Dana Reyes"];
  await q(`INSERT INTO households (id,org_id,name,created_by,created_by_name) VALUES ('hh_c1_okonkwo',$1,'The Okonkwo household',$2,$3)`, [ORG, ...by]);
  const person = (id, name, email, phone, street, unit, city, state, zip, extra = {}) => q(
    `INSERT INTO donors (id,org_id,name,email,phone,address,address2,city,state,zip,country,employer,household_id,stage,status,tags,person_types,
                         email_unreachable,email_unreachable_at,email_unreachable_reason,created_by,created_by_name,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'US',$11,$12,'cultivate','active','[]','["donor"]'::jsonb,$13,$14,$15,$16,$17,
             NOW() - ($18 || ' days')::interval, NOW() - ($19 || ' days')::interval)`,
    [P + id, ORG, name, email || null, phone || null, street || null, unit || null, city || null, state || null, zip || null,
     extra.employer || null, extra.household || null, !!extra.bounced, extra.bounced ? new Date(Date.now() - 20 * 86400000).toISOString() : null,
     extra.bounced ? "bounced" : null, ...by, String(400 + (id.charCodeAt(1) % 9) * 30), String(10 + (id.charCodeAt(2) % 7) * 20)]);

  for (const [id, name, email, phone, street, city, state, zip, extra] of PAIRS) await person(id, name, email, phone, street, null, city, state, zip, extra || {});
  for (const [id, name, street, unit, city, state, zip] of [...MESSY, ...UNREADABLE]) await person(id, name, null, null, street, unit, city, state, zip);
  for (const [id, name, email, extra] of EMAILS) await person(id, name, email, null, null, null, "Portland", "ME", null, extra || {});
  for (const [id, name, street, city, state, zip] of MOVERS) await person(id, name, `${id}.${name.split(" ")[1].toLowerCase()}@lindenmail.example`, null, street, null, city, state, zip);

  // Gifts on both halves of every pair, in cents a merge has to foot.
  const year = Number(String(TODAY || new Date().toISOString()).slice(0, 4));
  let n = 0;
  for (const [id] of PAIRS) {
    const amounts = { a: ["250.00", "125.50"], b: ["75.25"] }[id.slice(-1)];
    for (const amt of amounts) {
      n++;
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,campaign,created_by,created_by_name)
               VALUES ($1,$2,$3,$4,$5,'cash','Check',$6,$7,$8)`,
        [`g_c1_${n}`, ORG, P + id, amt, `${year - 1}-${String(3 + (n % 9)).padStart(2, "0")}-1${n % 9}`, `Annual Fund ${year - 1}`, ...by]);
    }
  }
  await q(`UPDATE donors d SET total_giving = s.t, gift_count = s.c, last_gift_date = s.l, first_gift_date = s.f
             FROM (SELECT donor_id, SUM(amount) t, COUNT(*) c, MAX(date) l, MIN(date) f FROM gifts WHERE org_id=$1 AND donor_id LIKE $2 GROUP BY donor_id) s
            WHERE d.id = s.donor_id AND d.org_id=$1`, [ORG, P + "%"]);

  // ── The seed checks itself through the page's own rules ──────────────────
  const rows = await q(`SELECT * FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG]);
  const pairs = DH.findDuplicatePairs(rows, { orgId: ORG });
  const mine = pairs.filter(p => p.a.startsWith(P) || p.b.startsWith(P));
  const problems = [];
  for (const [conf, list] of Object.entries(EXPECT)) for (const [x, y] of list) {
    const p = mine.find(m => m.key === DH.pairKey(P + x, P + y));
    if (!p) problems.push(`${x}/${y} is not found as a pair`);
    else if (p.confidence !== conf) problems.push(`${x}/${y} is ${p.confidence}, not ${conf}`);
  }
  if (mine.length !== 8) problems.push(`expected exactly 8 seeded pairs, found ${mine.length}: ${mine.map(m => m.key).join(" ")}`);
  const tidy = rows.filter(d => d.id.startsWith(P) && DH.tidyAddress(d).status === "tidy").length;
  if (tidy !== 15) problems.push(`expected 15 addresses to tidy, found ${tidy}`);
  const emails = rows.filter(d => d.id.startsWith(P) && DH.emailIssues(d, { bounced: d.email_unreachable ? "bounced" : null }).length).length;
  if (emails !== 4) problems.push(`expected 4 emails to look at, found ${emails}`);
  if (problems.length) throw new Error(`CLEAN-1 seed is not the mess its header promises: ${problems.join("; ")}`);
  const others = pairs.length - mine.length;
  console.log(`[seed] data health mess: 8 duplicate pairs (3 high, 3 medium, 2 low), 15 addresses to tidy, 1 unreadable, 4 emails, 4 movers in the sample change-of-address file${others ? ` (plus ${others} pairs the generated file made on its own)` : ""}`);
}

module.exports = { seedClean1Mess, PAIRS, MESSY, EMAILS, MOVERS, PREFIX: P };

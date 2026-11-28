// tests/fixtures/import/systems-full/make.cjs · IMPORT-12 item 1. FULL-SIZE,
// HONEST EXPORTS FROM THE SYSTEMS OUR PROSPECTS RUN.
//
//   node tests/fixtures/import/systems-full/make.cjs          write every export + expected.json
//   node tests/fixtures/import/systems-full/make.cjs --big    a 25,000-person, 100,000-gift Bloomerang
//                                                             export into .generated/import12-big/ (item 6; never committed)
//
// One made-up org (the Riverbend Reading Alliance) and its made-up people are
// written out the way each system's own export writes them: its own headers,
// its own file split, its own date format, its own codes. Every name, email,
// street and amount is invented here from a seeded random stream, so the same
// run writes the same bytes. The answer key (expected.json) is computed from
// the model this script writes, never by the reader (the BUILD-77 lesson).
//
// Each export carries the mess real files have: households and spouses,
// business and foundation donors, soft credits, monthly series, refunds,
// pledges and their payments, tributes, anonymous gifts, deceased and
// do-not-contact flags, two emails, split designations across funds, and a
// handful of true duplicates (one person exported twice under two IDs).
//
// The headers follow each system's documented export (the URL is beside each
// writer). Where a help page did not list a column, the column is marked
// "inferred" beside it: documented-not-walked, like exportShapes.js.
"use strict";
const fs = require("fs");
const path = require("path");

const OUT = __dirname;
const BIG = process.argv.includes("--big");

// ── a seeded stream (mulberry32): the same bytes every run ─────────────────
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const FIRST = ["Adele", "Barnaby", "Cressida", "Dorian", "Elspeth", "Fenwick", "Ginevra", "Hollis", "Imogen", "Jasper", "Kestrel", "Leopold", "Marisol", "Nathaniel",
  "Ottilie", "Percival", "Quillon", "Rosalind", "Sebastian", "Tamsin", "Ulric", "Verity", "Wendell", "Xanthe", "Yardley", "Zinnia", "Ambrose", "Bettina", "Cosmo",
  "Delphine", "Ezra", "Florentine", "Gideon", "Honora", "Ignatius", "Juniper", "Lazlo", "Mirabel", "Osric", "Philippa", "Rafferty", "Saoirse", "Thaddeus", "Wilhelmina"];
const LAST = ["Ashcombe", "Brackenridge", "Cardew", "Dunsmore", "Everleigh", "Fairweather", "Glenrothes", "Hawksley", "Inchbald", "Jessop", "Kittredge", "Larkspur",
  "Merriweather", "Northcote", "Ottershaw", "Pemberton", "Quenby", "Rathbone", "Stanwick", "Thistlewood", "Underhill", "Vantongeren", "Wexcombe", "Yarborough",
  "Ashdown", "Birchall", "Coldridge", "Dewhurst", "Elmstead", "Foxcroft", "Greywell", "Holloway", "Ingleby", "Kilbride", "Lowndes", "Marchbank", "Nettlefold",
  "Oakhurst", "Pickering", "Redfern", "Saltonstall", "Tolliver", "Upcott", "Waverley", "Wintergreen", "Allardyce", "Blakemore", "Chessington", "Drummond", "Esterbrook"];
const BIZ = ["Riverbend Hardware Co", "Larkspur Dental Group LLC", "Foxcroft Family Foundation", "Oakhurst Realty Inc", "Northcote Community Foundation",
  "Pemberton Excavating", "Greywell Bakery", "Thistlewood Farm Supply", "Saltonstall Charitable Trust", "Holloway Printing Services", "Marchbank Insurance Agency",
  "Wexcombe Construction LLC", "Kilbride Veterinary Clinic", "Redfern Credit Union", "Esterbrook Fund for Children"];
const STREETS = ["Maple Ave", "Orchard Ln", "Kingfisher Rd", "Mill St", "Harbor View Dr", "Quarry Rd", "Linden Ct", "Willow Bend", "Ridge Rd", "Church St"];
const TOWNS = [["Riverbend", "VT", "05401"], ["Ashby Falls", "VT", "05403"], ["North Hollis", "NH", "03049"], ["Cardew", "NY", "12801"], ["Lake Larkin", "VT", "05446"]];
const FUNDS = ["General Operating", "Books for Babies", "Adult Literacy", "Building Fund", "Summer Readers"];
const CAMPAIGNS = ["Annual Appeal", "Spring Gala", "Giving Tuesday", "Read-a-thon", "Year-End"];
const METHODS = ["Check", "Credit Card", "Cash", "ACH", "Stock"];
const HONOREES = ["Margaret Ashcombe", "Walter Pemberton", "Ruth Inchbald", "Samuel Kittredge", "the Glenrothes family"];
const pad = (n, w = 2) => String(n).padStart(w, "0");

// ── THE MODEL: one org's people and their gifts ────────────────────────────
// Built once per system (its own seed and size), so each export is its own
// population but every one follows the same rules.
function buildOrg({ seed, people: N, giftsPer = 3.2, startYear = 2019, endIso = "2026-10-31" }) {
  const R = rng(seed);
  const pick = a => a[Math.floor(R() * a.length)];
  const chance = p => R() < p;
  const people = [], households = [], gifts = [], pledges = [], recurring = [];
  let pid = 0, gid = 0, hid = 0, plid = 0, rid = 0;
  const usedNames = new Set();
  const newPerson = (last, opts = {}) => {
    let first = opts.first || pick(FIRST), tries = 0;
    while (usedNames.has(`${first} ${last}`) && tries++ < 40) first = pick(FIRST);
    if (usedNames.has(`${first} ${last}`)) first = `${first} ${String.fromCharCode(65 + Math.floor(R() * 26))}.`;
    usedNames.add(`${first} ${last}`);
    const [city, state, zip] = pick(TOWNS);
    const p = { pid: ++pid, kind: "person", first, last, org: null,
      email: `${first.toLowerCase().replace(/[^a-z]/g, "")}.${last.toLowerCase()}${pid}@example.org`,
      email2: chance(0.18) ? `${first[0].toLowerCase()}${last.toLowerCase()}${pid}@mail.example.net` : "",
      street: `${10 + Math.floor(R() * 980)} ${pick(STREETS)}`, city, state, zip, phone: `802-555-${pad(Math.floor(R() * 10000), 4)}`,
      deceased: false, dnc: false, noEmail: false, hh: null, spouse: null, dupOf: null, ...opts };
    people.push(p);
    return p;
  };
  // people, households and spouses (about 1 in 6 people is half of a couple)
  while (people.length < N) {
    const last = pick(LAST);
    const a = newPerson(last);
    if (chance(0.17) && people.length < N - 1) {
      const b = newPerson(last, { street: a.street, city: a.city, state: a.state, zip: a.zip, phone: a.phone });
      const h = { hid: ++hid, name: `${a.first} & ${b.first} ${last}`, members: [a.pid, b.pid] };
      a.hh = b.hh = h.hid; a.spouse = b.pid; b.spouse = a.pid;
      households.push(h);
    }
  }
  // business and foundation donors (about 3%)
  const nBiz = Math.max(8, Math.round(N * 0.03));
  for (let i = 0; i < nBiz; i++) {
    // a real file's businesses have names of their own, never "Co 2", "Co 3"
    const TRADE = ["Plumbing LLC", "Family Foundation", "Insurance Agency", "Orchards", "Builders Inc", "Law Office", "Charitable Trust", "Auto Repair", "Dental Group"];
    const name = i < BIZ.length ? BIZ[i] : `${LAST[(i * 7) % LAST.length]} ${TRADE[Math.floor(i / LAST.length) % TRADE.length]}${i >= LAST.length * TRADE.length ? ` of ${TOWNS[i % TOWNS.length][0]}` : ""}`;
    const p = newPerson("", { first: "", kind: "org" });
    p.org = name; p.last = ""; p.email = `giving${p.pid}@${name.toLowerCase().replace(/[^a-z]+/g, "")}.example.com`; p.email2 = "";
    usedNames.delete(" ");
  }
  // flags
  for (const p of people) {
    if (p.kind !== "person") continue;
    if (chance(0.012)) { p.deceased = true; p.deceasedDate = `20${pad(20 + Math.floor(R() * 6))}-${pad(1 + Math.floor(R() * 12))}-${pad(1 + Math.floor(R() * 27))}`; }
    else if (chance(0.02)) p.dnc = true;
    else if (chance(0.04)) p.noEmail = true;
  }
  // gifts. Amounts in whole cents; dates between startYear and endIso.
  const end = new Date(endIso + "T12:00:00Z").getTime(), start = Date.UTC(startYear, 0, 1, 12);
  const dayOf = t => new Date(t).toISOString().slice(0, 10);
  const randDay = () => dayOf(start + Math.floor(R() * (end - start)));
  const amount = big => {
    const tiers = big ? [250000, 500000, 1000000, 2500000] : [2500, 5000, 7500, 10000, 15000, 25000, 50000, 100000];
    const c = pick(tiers);
    return chance(0.12) ? c + Math.floor(R() * 99) + 1 : c;   // a few odd cents, as cards and stock make
  };
  const addGift = (p, o = {}) => {
    const g = { gid: ++gid, pid: p.pid, cents: o.cents || amount(p.kind === "org"), date: o.date || randDay(),
      fund: o.fund || (chance(0.7) ? FUNDS[0] : pick(FUNDS)), campaign: o.campaign !== undefined ? o.campaign : (chance(0.6) ? pick(CAMPAIGNS) : ""),
      method: o.method || pick(METHODS), kind: o.kind || "gift", pledge: o.pledge || null, recurring: o.recurring || null,
      soft: o.soft || null, tribute: o.tribute || null, anonymous: !!o.anonymous, splitOf: o.splitOf || null, refundOf: o.refundOf || null };
    gifts.push(g);
    return g;
  };
  for (const p of people) {
    if (p.dupOf) continue;
    // about 72% of the file gave at least once; the rest are contacts and prospects
    if (!chance(p.kind === "org" ? 0.95 : 0.72)) continue;
    const n = 1 + Math.floor(R() * giftsPer * 2 - 1e-9) % 7;
    for (let k = 0; k < n; k++) {
      const o = {};
      // a spouse's gift soft-credits the other half of the couple
      if (p.spouse && chance(0.35)) o.soft = p.spouse;
      if (chance(0.04)) o.tribute = { type: chance(0.6) ? "In Memory Of" : "In Honor Of", honoree: pick(HONOREES) };
      if (chance(0.02)) o.anonymous = true;
      const g = addGift(p, o);
      // a split designation: the same gift across two funds (about 2%)
      if (chance(0.02) && g.cents >= 5000) {
        const part = Math.round(g.cents * 0.4);
        g.cents -= part; g.fund = FUNDS[0];
        addGift(p, { cents: part, date: g.date, fund: FUNDS[2], campaign: g.campaign, method: g.method, splitOf: g.gid });
      }
      // a refund (about 0.6%): the money went back, a negative row against the gift
      if (chance(0.006) && !g.splitOf) {
        const d = new Date(new Date(g.date + "T12:00:00Z").getTime() + 6 * 86400000).toISOString().slice(0, 10);
        if (d <= endIso) addGift(p, { cents: -g.cents, date: d, fund: g.fund, campaign: g.campaign, method: g.method, kind: "refund", refundOf: g.gid });
      }
    }
    // monthly givers (about 4% of people): a recurring series of 6 to 24 gifts
    if (p.kind === "person" && chance(0.04)) {
      const r = { rid: ++rid, pid: p.pid, cents: pick([1000, 2000, 2500, 5000]), months: 6 + Math.floor(R() * 19) };
      recurring.push(r);
      const [y0, m0] = [2024 + Math.floor(R() * 2), 1 + Math.floor(R() * 12)];
      for (let k = 0; k < r.months; k++) {
        const y = y0 + Math.floor((m0 - 1 + k) / 12), m = 1 + ((m0 - 1 + k) % 12), d = `${y}-${pad(m)}-15`;
        if (d > endIso) break;
        addGift(p, { cents: r.cents, date: d, fund: FUNDS[0], campaign: "", method: "Credit Card", kind: "recurring", recurring: r.rid });
      }
    }
    // pledges (about 3% of people): a promise, then payments against it
    if (chance(0.03)) {
      const total = pick([100000, 250000, 500000, 1200000]), years = pick([1, 2, 3]);
      const pl = { plid: ++plid, pid: p.pid, cents: total, date: `202${3 + Math.floor(R() * 2)}-0${1 + Math.floor(R() * 8)}-01`, years, payments: [] };
      pledges.push(pl);
      const paid = Math.floor(R() * (years + 1));
      for (let k = 0; k < paid; k++) {
        const g = addGift(p, { cents: Math.round(total / years), date: `${Number(pl.date.slice(0, 4)) + k}-${pl.date.slice(5, 7)}-20`, fund: FUNDS[3], campaign: "Building Campaign",
          method: "Check", kind: "pledgePayment", pledge: pl.plid });
        pl.payments.push(g.gid);
      }
    }
  }
  // a handful of true duplicates: the same person exported twice, under a second ID
  const dupBase = people.filter(p => p.kind === "person" && !p.hh && !p.deceased).slice(5, 5 + Math.max(6, Math.round(N / 600)));
  for (const p of dupBase) {
    const d = { ...p, pid: ++pid, dupOf: p.pid, email2: "", phone: "" };
    people.push(d);
    // the duplicate carries one gift of its own (a second record that someone gave under)
    addGift(d, { cents: 5000, campaign: "Year-End", fund: FUNDS[0], method: "Check" });
  }
  return { people, households, gifts, pledges, recurring, byPid: new Map(people.map(p => [p.pid, p])) };
}

// ── THE KEY, from the model ────────────────────────────────────────────────
// people: distinct persons and organisations (a duplicate counts once).
// gifts: rows of money above zero (a refund is no gift; a split is one row per fund).
// cents: every money row, refunds off (MONEY's rule: net of what went back).
// pledgeCents: what was promised; it is no gift until a payment comes.
function keyOf(org) {
  const real = org.people.filter(p => !p.dupOf);
  const money = org.gifts;
  const pos = money.filter(g => g.cents > 0);
  const cents = money.reduce((s, g) => s + g.cents, 0);
  const softCents = pos.filter(g => g.soft).reduce((s, g) => s + g.cents, 0);
  const byFund = {};
  for (const g of money) byFund[g.fund] = (byFund[g.fund] || 0) + g.cents;
  const byYear = {};
  for (const g of money) byYear[g.date.slice(0, 4)] = (byYear[g.date.slice(0, 4)] || 0) + g.cents;
  return {
    people: real.length, persons: real.filter(p => p.kind === "person").length, organisations: real.filter(p => p.kind === "org").length,
    households: org.households.length, duplicates: org.people.filter(p => p.dupOf).length,
    gifts: pos.length, cents, refunds: money.filter(g => g.cents < 0).length, refundCents: -money.filter(g => g.cents < 0).reduce((s, g) => s + g.cents, 0),
    softCredits: pos.filter(g => g.soft).length, softCreditCents: softCents,
    recurringSeries: org.recurring.length, recurringGifts: money.filter(g => g.kind === "recurring").length,
    pledges: org.pledges.length, pledgeCents: org.pledges.reduce((s, p) => s + p.cents, 0), pledgePayments: money.filter(g => g.kind === "pledgePayment").length,
    tributes: pos.filter(g => g.tribute).length, anonymous: pos.filter(g => g.anonymous).length, splits: money.filter(g => g.splitOf).length,
    deceased: real.filter(p => p.deceased).length, doNotContact: real.filter(p => p.dnc).length, noEmail: real.filter(p => p.noEmail).length,
    twoEmails: real.filter(p => p.email2).length, byFund, byYear,
    // a few named people the walk opens: lifetime is their own money rows, never a soft credit
    spot: real.filter(p => p.kind === "person").slice(0, 400).filter((p, i) => i % 40 === 0).map(p => ({
      first: p.first, last: p.last, email: p.email,
      lifetimeCents: org.gifts.filter(g => g.pid === p.pid || (org.byPid.get(g.pid).dupOf === p.pid)).reduce((s, g) => s + g.cents, 0),
      softCents: org.gifts.filter(g => g.soft === p.pid && g.cents > 0).reduce((s, g) => s + g.cents, 0),
      deceased: p.deceased, dnc: p.dnc, noEmail: p.noEmail })),
  };
}

// ── CSV writing: quote what needs it, as every one of these systems does ───
const cell = v => { const t = v == null ? "" : String(v); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const csv = (header, rows) => [header, ...rows].map(r => r.map(cell).join(",")).join("\r\n") + "\r\n";
const usDate = iso => { const [y, m, d] = iso.split("-"); return `${m}/${d}/${y}`; };          // 03/07/2024
const usShort = iso => { const [y, m, d] = iso.split("-"); return `${+m}/${+d}/${y}`; };       // 3/7/2024
const dollars = c => (c / 100).toFixed(2);
const money$ = c => (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
const yn = b => (b ? "Yes" : "No");
const tf = b => (b ? "TRUE" : "FALSE");

// ── 1. SALESFORCE NPSP: Contacts + Opportunities, linked by Contact ID ─────
// Field labels read from the NPSP package source (Contact and Opportunity fields):
// https://github.com/SalesforceFoundation/NPSP (force-app/main/default/objects/Contact/fields,
// Opportunity/fields) and https://github.com/SalesforceFoundation/Contacts_and_Organizations.
// Deceased, Do Not Contact, Personal/Work/Alternate/Preferred Email, Honoree Name,
// Tribute Type (Honor / Memorial) are read; Email Opt Out, Recurring Donation,
// the two-report split and M/D/YYYY dates are inferred. Payment Method lives on
// the Payment object and soft credits on Contact Roles, so neither is a column
// here; General Accounting Unit is a cross-object column (inferred). A refund is
// not native to NPSP: it is written as a negative Opportunity (inferred).
const sfId = (pfx, n) => (pfx + "5f00000" + String(n).padStart(8, "0") + "AAA").slice(0, 18);
function salesforce(org) {
  const C = ["Contact ID", "Account ID", "Account Name", "Salutation", "First Name", "Last Name", "Personal Email", "Work Email", "Preferred Email", "Email",
    "Mailing Street", "Mailing City", "Mailing State/Province", "Mailing Zip/Postal Code", "Mailing Country", "Home Phone", "Deceased", "Do Not Contact", "Email Opt Out",
    "Contact Owner", "Created Date"];
  const contacts = org.people.filter(p => p.kind === "person").map(p => {
    const h = p.hh ? org.households.find(x => x.hid === p.hh) : null;
    return [sfId("003", p.pid), sfId("001", p.hh ? 100000 + p.hh : p.pid), h ? `${p.last} (${h.name.split(" ")[0]} and ${h.name.split(" ")[2]}) Household` : `${p.last} Household`,
      "", p.first, p.last, p.email, p.email2, "Personal", p.email, p.street, p.city, p.state, p.zip, "United States", p.phone,
      tf(p.deceased), tf(p.dnc), tf(p.noEmail), "Ines Okafor", "1/15/2019"];
  });
  // Organisations are Accounts with no contact; their gifts name the Account
  const O = ["Opportunity ID", "Opportunity Name", "Contact ID", "Primary Contact", "Account Name", "Amount", "Close Date", "Stage", "Record Type",
    "Primary Campaign Source", "General Accounting Unit", "Recurring Donation", "Honoree Name", "Tribute Type"];
  const opps = [];
  for (const g of org.gifts) {
    const p = org.byPid.get(g.pid);
    const who = p.kind === "org" ? "" : `${p.first} ${p.last}`;
    const acct = p.kind === "org" ? p.org : `${p.last} Household`;
    const stage = "Closed Won";
    const rt = g.kind === "recurring" ? "Donation" : g.kind === "pledgePayment" ? "Major Gift" : g.kind === "refund" ? "Donation" : p.kind === "org" ? "Grant" : "Donation";
    opps.push([sfId("006", g.gid), `${who || acct} ${g.cents < 0 ? "Refund" : "Donation"} ${usShort(g.date)}`, p.kind === "org" ? "" : sfId("003", p.pid), who, acct, dollars(g.cents), usShort(g.date), stage, rt,
      g.campaign, g.fund, g.recurring ? `${who} $${dollars(org.recurring.find(r => r.rid === g.recurring).cents)} - Monthly` : "",
      g.tribute ? g.tribute.honoree : "", g.tribute ? (g.tribute.type === "In Memory Of" ? "Memorial" : "Honor") : ""]);
  }
  // open pledges: an Opportunity at stage Pledged for what is still owed
  for (const pl of org.pledges) {
    const p = org.byPid.get(pl.pid), paid = pl.payments.length * Math.round(pl.cents / pl.years), owed = pl.cents - paid;
    if (owed <= 0) continue;
    const who = p.kind === "org" ? "" : `${p.first} ${p.last}`;
    opps.push([sfId("006", 900000 + pl.plid), `${who || p.org} Pledge ${usShort(pl.date)}`, p.kind === "org" ? "" : sfId("003", p.pid), who, p.kind === "org" ? p.org : `${p.last} Household`,
      dollars(owed), usShort(pl.date), "Pledged", "Major Gift", "Building Campaign", FUNDS[3], "", "", ""]);
  }
  const open = org.pledges.filter(pl => pl.cents - pl.payments.length * Math.round(pl.cents / pl.years) > 0);
  return { files: { "salesforce-npsp-contacts.csv": csv(C, contacts), "salesforce-npsp-opportunities.csv": csv(O, opps) }, joinedOn: "Contact ID", system: "Salesforce",
    // what this export can say: soft credits and anonymity are not on an Opportunity report; a pledge is what is still owed
    // an Account with no contact is in the file only through its Opportunities
    file: { people: org.people.filter(p => !p.dupOf && (p.kind === "person" || org.gifts.some(g => g.pid === p.pid) || open.some(pl => pl.pid === p.pid))).length,
      softCredits: 0, softCreditCents: 0, anonymous: 0, pledges: open.length, pledgePayments: 0,
      pledgeCents: open.reduce((t, pl) => t + pl.cents - pl.payments.length * Math.round(pl.cents / pl.years), 0) } };
}

// ── 2. BLOOMERANG: Constituents + Transactions, linked by Account Number ───
// Report columns read from https://help.bloomerang.com/en/articles/12632575-report-columns-and-filters
// and https://help.givebutter.com/en/articles/10985242-migrating-to-givebutter-from-bloomerang:
// Status (Active / Inactive / Deceased), Communication Restrictions, Email Interest
// Type, Household Name; Soft Credit Name(s), Tribute, Tribute Type, Is Refunded,
// Refund Date, Pledge Transaction Number, Type (Donation, Pledge, Pledge Payment,
// Recurring Donation Payment). A transaction report gets Account Number from its
// Constituent column group. A refund is the original transaction marked Is
// Refunded, never a negative row. Dates M/D/YYYY and "$" amounts are inferred.
function bloomerang(org) {
  const acct = p => String(1000 + p.pid);
  const C = ["Account Number", "Type", "Name", "First Name", "Last Name", "Organization Name", "Household Name", "Primary Email", "Secondary Email", "Primary Phone",
    "Primary Street", "Primary City", "Primary State", "Primary ZIP Code", "Status", "Communication Restrictions", "Email Interest Type", "Created Date"];
  const cons = org.people.map(p => {
    const h = p.hh ? org.households.find(x => x.hid === p.hh) : null;
    return [acct(p), p.kind === "org" ? "Organization" : "Individual", p.kind === "org" ? p.org : `${p.first} ${p.last}`, p.first, p.last, p.org || "", h ? h.name : "",
      p.email, p.email2, p.phone, p.street, p.city, p.state, p.zip, p.deceased ? "Deceased" : "Active", p.dnc ? "Do Not Solicit" : "", p.noEmail ? "Opted Out" : "All", "1/15/2019"];
  });
  const T = ["Transaction Number", "Account Number", "Name", "Date", "Amount", "Type", "Method", "Fund", "Campaign", "Appeal", "Has Tribute", "Tribute", "Tribute Type",
    "Soft Credit Name(s)", "Soft Credited Amount", "Is Refunded", "Refund Date", "Pledge Transaction Number", "Note"];
  const rows = [];
  const refundOf = new Map(org.gifts.filter(g => g.refundOf).map(g => [g.refundOf, g]));
  for (const g of org.gifts) {
    if (g.kind === "refund") continue;   // the original carries it
    const rf = refundOf.get(g.gid);
    const p = org.byPid.get(g.pid), soft = g.soft ? org.byPid.get(g.soft) : null;
    // a split designation is a second line under the same Transaction Number
    const tn = String(500000 + (g.splitOf || g.gid));
    const type = g.kind === "recurring" ? "Recurring Donation Payment" : g.kind === "pledgePayment" ? "Pledge Payment" : "Donation";
    rows.push([tn, acct(p), p.kind === "org" ? p.org : `${p.first} ${p.last}`, usShort(g.date), money$(g.cents), type, g.method, g.fund, g.campaign, g.campaign ? `${g.campaign} ${g.date.slice(0, 4)}` : "",
      g.tribute ? "True" : "False", g.tribute ? g.tribute.honoree : "", g.tribute ? g.tribute.type : "", soft ? `${soft.first} ${soft.last}` : "", soft ? money$(g.cents) : "",
      rf ? "True" : "False", rf ? usShort(rf.date) : "", g.pledge ? String(800000 + g.pledge) : "", g.anonymous ? "Anonymous" : ""]);
  }
  for (const pl of org.pledges) {
    const p = org.byPid.get(pl.pid);
    rows.push([String(800000 + pl.plid), acct(p), p.kind === "org" ? p.org : `${p.first} ${p.last}`, usShort(pl.date), money$(pl.cents), "Pledge", "", FUNDS[3], "Building Campaign", "",
      "False", "", "", "", "", "False", "", "", `${pl.years}-year pledge`]);
  }
  return { files: { "bloomerang-constituents.csv": csv(C, cons), "bloomerang-transactions.csv": csv(T, rows) }, joinedOn: "Account Number", system: "Bloomerang",
    file: { anonymous: 0 } };
}

// ── 3. DONORPERFECT: Donors + Gifts, linked by Donor ID, with its codes ────
// Field names are DonorPerfect's own (the dp and dpgift tables), read from
// https://docs.anedot.com/integrations/crm-donor-management/donorperfect.md and
// https://github.com/LukeTowers/php-donorperfect-api (which quotes DonorPerfect's
// XML API manual). RECORD_TYPE: G a gift (or a split's part), P a pledge, M a
// split's main row (GL_CODE SEE_SPLIT; its parts carry the money), S a soft
// credit whose GLINK is the real gift. A pledge payment's PLINK is the pledge's
// GIFT_ID. Deceased is NOMAIL_REASON "DE". MM/DD/YYYY dates. An export's headers
// being the field names in capitals, and refunds as negative gifts, are inferred.
function donorperfect(org) {
  const did = p => String(20000 + p.pid);
  const D = ["DONOR_ID", "FIRST_NAME", "LAST_NAME", "ORG_REC", "DONOR_TYPE", "OPT_LINE", "ADDRESS", "CITY", "STATE", "ZIP", "EMAIL", "EMAIL2", "HOME_PHONE",
    "NOMAIL", "NOMAIL_REASON", "SPOUSE_ID", "SALUTATION", "CREATED_DATE"];
  const donors = org.people.map(p => [did(p), p.first, p.kind === "org" ? p.org : p.last, p.kind === "org" ? "Y" : "N", p.kind === "org" ? (/foundation|trust|fund/i.test(p.org) ? "FD" : "CO") : "IN",
    "", p.street, p.city, p.state, p.zip, p.email, p.email2, p.phone, p.dnc || p.deceased ? "Y" : "N", p.deceased ? "DE" : p.dnc ? "NC" : "",
    p.spouse ? did(org.byPid.get(p.spouse)) : "", p.kind === "org" ? "" : `Dear ${p.first}`, "01/15/2019"]);
  const GL = { [FUNDS[0]]: "GEN", [FUNDS[1]]: "BFB", [FUNDS[2]]: "ADLIT", [FUNDS[3]]: "BLDG", [FUNDS[4]]: "SUMR" };
  const SOL = { "Annual Appeal": "AA", "Spring Gala": "GALA", "Giving Tuesday": "GT", "Read-a-thon": "RAT", "Year-End": "YE", "Building Campaign": "CAP", "": "" };
  const GT = { Check: "CK", "Credit Card": "CC", Cash: "CA", ACH: "EFT", Stock: "STK" };
  const G = ["GIFT_ID", "DONOR_ID", "FIRST_NAME", "LAST_NAME", "RECORD_TYPE", "GIFT_DATE", "AMOUNT", "GL_CODE", "SOLICIT_CODE", "SUB_SOLICIT_CODE", "GIFT_TYPE",
    "SPLIT_GIFT", "PLEDGE_PAYMENT", "PLINK", "GLINK", "MEMORY_HONOR", "GFNAME", "GLNAME", "GIFT_NARRATIVE"];
  const rows = [];
  const parts = new Map();
  for (const g of org.gifts) if (g.splitOf) { if (!parts.has(g.splitOf)) parts.set(g.splitOf, []); parts.get(g.splitOf).push(g); }
  const row = (id, p, rt, g, o = {}) => {
    const ho = g.tribute ? g.tribute.honoree.split(" ") : null;
    rows.push([id, did(p), p.first, p.kind === "org" ? p.org : p.last, rt, usDate(g.date), dollars(o.cents != null ? o.cents : g.cents), o.gl || GL[g.fund], SOL[g.campaign] || "", g.campaign ? "MAIL" : "",
      GT[g.method] || "OT", o.split ? "Y" : "N", g.pledge ? "Y" : "N", g.pledge ? String(700000 + g.pledge) : "", o.glink || "", g.tribute ? (g.tribute.type === "In Memory Of" ? "M" : "H") : "",
      ho ? ho.slice(0, -1).join(" ") : "", ho ? ho[ho.length - 1] : "", o.narr || (g.refundOf ? `Refund of gift ${300000 + g.refundOf}` : "")]);
  };
  for (const g of org.gifts) {
    if (g.splitOf) continue;   // written under its main row
    const p = org.byPid.get(g.pid), ps = parts.get(g.gid);
    if (ps) {
      // a split: the main row (M, SEE_SPLIT, the whole amount), then each part (G, SPLIT_GIFT Y, GLINK the main)
      row(String(300000 + g.gid), p, "M", g, { cents: g.cents + ps.reduce((t, x) => t + x.cents, 0), gl: "SEE_SPLIT" });
      for (const part of [g, ...ps]) row(String(400000 + part.gid), p, "G", part, { split: true, glink: String(300000 + g.gid) });
    } else row(String(300000 + g.gid), p, "G", g);
    // a soft credit is its own row: RECORD_TYPE S on the soft-credited donor, GLINK the real gift
    if (g.soft && g.cents > 0) row(String(600000 + g.gid), org.byPid.get(g.soft), "S", { ...g, tribute: null, pledge: null }, { glink: String(ps ? 300000 + g.gid : 300000 + g.gid), narr: "Soft credit" });
  }
  for (const pl of org.pledges) {
    const p = org.byPid.get(pl.pid);
    rows.push([String(700000 + pl.plid), did(p), p.first, p.kind === "org" ? p.org : p.last, "P", usDate(pl.date), dollars(pl.cents), "BLDG", "CAP", "", "", "N", "N", "", "", "", "", "", `${pl.years}-year pledge`]);
  }
  return { files: { "donorperfect-donors.csv": csv(D, donors), "donorperfect-gifts.csv": csv(G, rows) }, joinedOn: "DONOR_ID", system: "DonorPerfect",
    // DonorPerfect has no do-not-contact flag: NOMAIL is do not mail, and its reason NC is kept as written
    file: { anonymous: 0, noEmail: 0, doNotContact: 0 } };
}

// ── 4. NEON CRM: Accounts + Donations, linked by Account ID ────────────────
// NOT VERIFIED: Neon's help and developer pages refused automated reading. "Account ID",
// "Campaign Name", "Fund" and "Purpose" are read from https://help.bloomerang.com/en/articles/13382602-neoncrm;
// every other header is inferred from Neon's own UI words (https://developer.neoncrm.com/?p=277).
function neon(org) {
  const aid = p => String(4000 + p.pid);
  const A = ["Account ID", "Account Type", "First Name", "Last Name", "Company Name", "Household Name", "Email 1", "Email 2", "Phone 1 Full Number (F)",
    "Address Line 1", "City", "State/Province", "Zip Code", "Deceased", "Do Not Contact", "Email Opt-Out", "Account Created Date"];
  const accts = org.people.map(p => {
    const h = p.hh ? org.households.find(x => x.hid === p.hh) : null;
    return [aid(p), p.kind === "org" ? "Company" : "Individual", p.first, p.last, p.org || "", h ? h.name : "", p.email, p.email2, p.phone, p.street, p.city, p.state, p.zip,
      yn(p.deceased), yn(p.dnc), yn(p.noEmail), "2019-01-15"];
  });
  const D = ["Donation ID", "Account ID", "Account Name", "Donation Amount", "Donation Date", "Tender Type", "Campaign Name", "Fund", "Purpose", "Donation Status",
    "Recurring Donation", "Tribute Type", "Tribute Name", "Soft Credit Name", "Anonymous Type", "Pledge ID"];
  const rows = [];
  for (const g of org.gifts) {
    const p = org.byPid.get(g.pid), soft = g.soft ? org.byPid.get(g.soft) : null;
    rows.push([String(90000 + g.gid), aid(p), p.kind === "org" ? p.org : `${p.first} ${p.last}`, dollars(g.cents), g.date, g.method, g.campaign, g.fund, g.splitOf ? "Split designation" : "",
      g.cents < 0 ? "Refunded" : "Succeeded", g.recurring ? "Yes" : "No", g.tribute ? (g.tribute.type === "In Memory Of" ? "In Memory" : "In Honor") : "", g.tribute ? g.tribute.honoree : "",
      soft ? `${soft.first} ${soft.last}` : "", g.anonymous ? "Anonymous to public" : "Not anonymous", g.pledge ? String(70000 + g.pledge) : ""]);
  }
  return { files: { "neon-accounts.csv": csv(A, accts), "neon-donations.csv": csv(D, rows) }, joinedOn: "Account ID", system: "Neon CRM",
    file: { pledges: 0, pledgeCents: 0 } };
}

// ── 5. LITTLE GREEN LIGHT: one gifts export, the constituent on each row ──
// Columns read from https://help.littlegreenlight.com/article/241-generate-a-lump-sum-report-to-record-into-quickbooks,
// /article/288-mapping-gift-fields, /article/228-uploading-related-gifts and /article/479-mapping-tribute-gifts:
// LGL Constituent ID, LGL Gift ID, Sort name, Gift date, Gift type, Gift category,
// Amount, Deductible amount, Campaign, Fund, Appeal, Payment Type, Preferred Email,
// Tribute Name, Tribute Dedication, Parent Gift ID. A soft credit is a related
// gift typed "Soft Credit" on the person thanked, its Parent Gift ID the real
// gift. A gifts report carries no deceased or do-not-contact flags. YYYY-MM-DD
// dates and negative refund rows are inferred.
function lgl(org) {
  const H = ["LGL Gift ID", "LGL Constituent ID", "Sort name", "First Name", "Last Name", "Preferred Email", "Preferred Phone", "Gift date", "Gift type", "Gift category",
    "Amount", "Deductible amount", "Fund", "Campaign", "Appeal", "Payment Type", "Tribute Name", "Tribute Dedication", "Parent Gift ID", "Note"];
  const rows = [];
  const type = g => (g.kind === "pledgePayment" ? "Pledge Payment" : "Gift");
  const per = p => [String(7000 + p.pid), p.kind === "org" ? p.org : `${p.last}, ${p.first}`, p.first, p.kind === "org" ? p.org : p.last, p.email, p.phone];
  for (const g of org.gifts) {
    const p = org.byPid.get(g.pid);
    rows.push([String(100000 + g.gid), ...per(p), g.date, type(g), g.recurring ? "Monthly giving" : g.kind === "refund" ? "Refund" : "Donation", dollars(g.cents), dollars(g.cents),
      g.fund, g.campaign, g.campaign ? `${g.campaign} ${g.date.slice(0, 4)}` : "", g.method, g.tribute ? g.tribute.honoree : "", g.tribute ? g.tribute.type : "",
      g.pledge ? String(900000 + g.pledge) : g.refundOf ? String(100000 + g.refundOf) : "", g.refundOf ? `Refund of gift ${100000 + g.refundOf}` : ""]);
    if (g.soft && g.cents > 0) {
      const s = org.byPid.get(g.soft);
      rows.push([String(200000 + g.gid), ...per(s), g.date, "Soft Credit", "Donation", dollars(g.cents), "0.00", g.fund, g.campaign, "", "", "", "", String(100000 + g.gid), ""]);
    }
  }
  for (const pl of org.pledges) {
    const p = org.byPid.get(pl.pid);
    rows.push([String(900000 + pl.plid), ...per(p), pl.date, "Pledge", "Donation", dollars(pl.cents), "0.00", FUNDS[3], "Building Campaign", "", "", "", "", "", `${pl.years}-year pledge`]);
  }
  // LGL writes a constituent with no gift nowhere in a gifts export: they are not in this file
  return { files: { "littlegreenlight-gifts.csv": csv(H, rows) }, joinedOn: null, system: "Little Green Light", giftsOnly: true, softRows: true,
    file: { anonymous: 0, deceased: 0, doNotContact: 0, noEmail: 0, households: 0, twoEmails: 0 } };
}

// ── 6. eKYROS (pregnancy centers): donor + gift export ─────────────────────
// eKYROS does not publish its export columns: ekyros.com now redirects to
// https://fundeasy.com/ekyros (FundEasy bought eKYROS), whose FAQ
// (https://fundeasy.com/ekyros/faq) says only that reports export to CSV. This
// is the closest documented shape, a one-file report with the donor beside
// each gift, and EVERY header here is invented ("inferred"). A soft credit and
// a pledge are not in it.
function ekyros(org) {
  const H = ["Donor #", "Title", "First", "Last", "Spouse", "Organization", "Address", "City", "St", "Zip", "Email", "Email 2", "Phone", "Deceased", "No Mail",
    "Gift #", "Gift Date", "Gift Amt", "Fund", "Appeal", "Pay Type", "Gift Kind", "In Memory/Honor Of", "Anonymous", "Comments"];
  const rows = [];
  for (const g of org.gifts) {
    const p = org.byPid.get(g.pid);
    rows.push([String(50000 + p.pid), "", p.first, p.kind === "org" ? "" : p.last, p.spouse ? org.byPid.get(p.spouse).first : "", p.org || "", p.street, p.city, p.state, p.zip,
      p.email, p.email2, p.phone, p.deceased ? "Y" : "", p.dnc ? "Y" : "", String(800000 + g.gid), usShort(g.date), money$(g.cents), g.fund, g.campaign, g.method,
      g.kind === "refund" ? "Refund" : g.kind === "recurring" ? "Monthly" : g.kind === "pledgePayment" ? "Pledge Pmt" : "Gift",
      g.tribute ? `${g.tribute.type === "In Memory Of" ? "IMO" : "IHO"} ${g.tribute.honoree}` : "", g.anonymous ? "Y" : "", ""]);
  }
  return { files: { "ekyros-donor-gifts.csv": csv(H, rows) }, joinedOn: null, system: "eKYROS", giftsOnly: true,
    file: { softCredits: 0, softCreditCents: 0, pledges: 0, pledgeCents: 0, doNotContact: 0, noEmail: 0 } };
}

// ── 7. A PLAIN SPREADSHEET, as a one-person office keeps it ────────────────
// One tab, a name per row (a couple on one row), each year's giving in its own
// column, notes in a cell. No IDs, no gift dates: a year column is that year's total.
function plain(org) {
  const years = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const H = ["Name", "Address", "City", "State", "Zip", "Email", "Phone", ...years.map(String), "Notes"];
  const rows = [], seen = new Set();
  const gifts = [];
  for (const p of org.people) {
    if (seen.has(p.pid) || p.dupOf) continue;
    seen.add(p.pid);
    const sp = p.spouse ? org.byPid.get(p.spouse) : null;
    if (sp) seen.add(sp.pid);
    const mine = org.gifts.filter(g => (g.pid === p.pid || (sp && g.pid === sp.pid)) && g.cents > 0 && years.includes(+g.date.slice(0, 4)));
    const byY = years.map(y => mine.filter(g => +g.date.slice(0, 4) === y).reduce((s, g) => s + g.cents, 0));
    byY.forEach((c, i) => { if (c > 0) gifts.push({ pid: p.pid, year: years[i], cents: c }); });
    const name = p.kind === "org" ? p.org : sp ? `${p.first} & ${sp.first} ${p.last}` : `${p.first} ${p.last}`;
    const notes = p.deceased ? "Deceased, do not mail" : p.dnc ? "Asked not to be contacted" : (p.pid % 17 === 0 ? "Met at the spring gala; loves the summer program" : "");
    rows.push([name, p.street, p.city, p.state, p.zip, p.email, p.phone, ...byY.map(c => (c ? dollars(c) : "")), notes]);
  }
  return { files: { "plain-donor-spreadsheet.csv": csv(H, rows) }, joinedOn: null, system: null, plainGifts: gifts, plainRows: rows.length };
}

// ── write ──────────────────────────────────────────────────────────────────
const SYSTEMS = [
  { key: "salesforce", write: salesforce, seed: 101, people: 4200 },
  { key: "bloomerang", write: bloomerang, seed: 202, people: 4800 },
  { key: "donorperfect", write: donorperfect, seed: 303, people: 3600 },
  { key: "neon", write: neon, seed: 404, people: 3200 },
  { key: "littlegreenlight", write: lgl, seed: 505, people: 3000 },
  { key: "ekyros", write: ekyros, seed: 606, people: 3000 },
  { key: "plain", write: plain, seed: 707, people: 3000 },
];

if (BIG) {
  const dir = path.join(__dirname, "..", "..", "..", "..", ".generated", "import12-big");
  fs.mkdirSync(dir, { recursive: true });
  const org = buildOrg({ seed: 909, people: 25000, giftsPer: 4.0 });
  const out = bloomerang(org);
  for (const [f, text] of Object.entries(out.files)) fs.writeFileSync(path.join(dir, f), text);
  const key = keyOf(org);
  fs.writeFileSync(path.join(dir, "expected.json"), JSON.stringify(key, null, 2) + "\n");
  console.log(`wrote ${dir}: ${key.people} people, ${key.gifts} gifts, ${money$(key.cents)}`);
  process.exit(0);
}

const expected = {};
for (const s of SYSTEMS) {
  const org = buildOrg({ seed: s.seed, people: s.people });
  const out = s.write(org);
  for (const [f, text] of Object.entries(out.files)) fs.writeFileSync(path.join(OUT, f), text);
  const key = keyOf(org);
  if (s.key === "plain") {
    // the plain sheet is a couple per row and a year's total per cell: its key is its own cells
    key.rows = out.plainRows;
    key.gifts = out.plainGifts.length; key.cents = out.plainGifts.reduce((t, g) => t + g.cents, 0);
    key.byYear = {}; for (const g of out.plainGifts) key.byYear[g.year] = (key.byYear[g.year] || 0) + g.cents;
    for (const k of ["softCredits", "softCreditCents", "refunds", "refundCents", "recurringSeries", "recurringGifts", "pledges", "pledgeCents", "pledgePayments", "tributes", "anonymous", "splits", "duplicates", "byFund", "spot"]) delete key[k];
  }
  // LGL and eKYROS are gift exports: a person with no gift is not in the file
  if (out.giftsOnly) {
    const gave = new Set(org.gifts.map(g => org.byPid.get(g.pid).dupOf || g.pid).concat(org.pledges.map(p => p.pid))
      // LGL writes a soft credit as a row on the person thanked, so they are in the file too
      .concat(out.softRows ? org.gifts.filter(g => g.soft && g.cents > 0).map(g => g.soft) : []));
    key.people = [...gave].length;
    // only the people in the file can carry a flag in it
    const inFile = org.people.filter(p => gave.has(p.pid));
    key.deceased = inFile.filter(p => p.deceased).length; key.doNotContact = inFile.filter(p => p.dnc).length; key.noEmail = inFile.filter(p => p.noEmail).length;
    key.householdsNote = "only couples who both appear with a gift";
  }
  Object.assign(key, out.file || {});
  expected[s.key] = { system: out.system, files: Object.keys(out.files), joinedOn: out.joinedOn, ...key };
  console.log(`${s.key.padEnd(17)} ${String(key.people).padStart(5)} people ${String(key.gifts).padStart(6)} gifts ${money$(key.cents).padStart(16)}`);
}
fs.writeFileSync(path.join(OUT, "expected.json"), JSON.stringify(expected, null, 2) + "\n");

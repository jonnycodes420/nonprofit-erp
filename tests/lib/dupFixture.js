// tests/lib/dupFixture.js · HOTFIX-RHYTHM. A real-shaped person file, made up.
//
// 6,200 people the way a small nonprofit's export arrives: common first and
// last names (so many people share a name), most with no email, placeholders
// where a field was required ("n/a", "none", "noemail@…", 000-000-0000),
// households (two or three people, different first names, one address), an
// office line many people share, and PLANTED true duplicates: one person
// entered twice with the same email or phone and a similar name. Seeded, so
// every run is the same file. Nothing here is a real person.
"use strict";

const FIRST = ["James","Mary","John","Patricia","Robert","Jennifer","Michael","Linda","William","Elizabeth","David","Barbara",
  "Richard","Susan","Joseph","Jessica","Thomas","Sarah","Charles","Karen","Daniel","Nancy","Matthew","Lisa","Anthony","Betty",
  "Mark","Margaret","Donald","Sandra","Steven","Ashley","Paul","Kimberly","Andrew","Emily","Joshua","Donna","Kenneth","Michelle",
  "Kevin","Carol","Brian","Amanda","George","Melissa","Timothy","Deborah","Ronald","Stephanie","Edward","Rebecca","Jason","Laura",
  "Jeffrey","Sharon","Ryan","Cynthia","Jacob","Kathleen","Gary","Amy","Nicholas","Angela","Eric","Shirley","Jonathan","Anna"];
const LAST = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez",
  "Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez","Thompson","White","Harris",
  "Sanchez","Clark","Ramirez","Lewis","Robinson","Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill",
  "Flores","Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Roberts","Okafor","Lindqvist",
  "Brightwater","Fairholm","Quillon","Ashcombe","Marrow","Penhallow","Tessaly","Vantreight"];
const STREETS = ["Oak","Maple","Cedar","Pine","Elm","Birch","Willow","Harbor","Lake","Hill","Park","River"];
const PLACEHOLDER_EMAILS = ["n/a", "none", "N/A", " ", "noemail@noemail.com", "none@none.com", "no@email.com", "na@na.com", "unknown", "-"];
const PLACEHOLDER_PHONES = ["000-000-0000", "n/a", "(000) 000-0000", "999-999-9999", "111-111-1111", "555-555-5555", "1234567890", "none"];

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function build({ people = 6200, planted = 24, orgId = "org_dupfixture", seed = 20261105 } = {}) {
  const r = rng(seed);
  const pick = a => a[Math.floor(r() * a.length)];
  const rows = [];
  let n = 0;
  const id = () => "d_fx" + String(++n).padStart(6, "0");
  const addr = () => ({ address: `${100 + Math.floor(r() * 9800)} ${pick(STREETS)} St`, city: "Harborview", state: "WA", zip: String(98000 + Math.floor(r() * 400)) });
  const phone = () => `(206) ${200 + Math.floor(r() * 700)}-${String(1000 + Math.floor(r() * 8999))}`;
  const base = () => ({ org_id: orgId, household_id: null, employer: null, email2: null, mobile: null, created_at: "2026-11-01T12:00:00Z" });
  while (rows.length < people - planted * 2) {
    const last = pick(LAST);
    const home = addr();
    // a household: two or three people with different first names at one address
    const size = r() < 0.12 ? 2 + (r() < 0.3 ? 1 : 0) : 1;
    const hh = size > 1 && r() < 0.5 ? "hh_fx" + n : null;   // half of them never made a household
    const firsts = new Set();
    while (firsts.size < size) firsts.add(pick(FIRST));
    for (const f of firsts) {
      const u = r();
      // most people have no email; some carry a placeholder; a few a real one
      const email = u < 0.55 ? null : u < 0.62 ? "" : u < 0.72 ? pick(PLACEHOLDER_EMAILS)
        : `${f}.${last}${n}@example.org`.toLowerCase();
      const v = r();
      const ph = v < 0.5 ? null : v < 0.62 ? pick(PLACEHOLDER_PHONES) : v < 0.66 ? "(206) 555-0100" /* the office line */ : phone();
      rows.push({ ...base(), id: id(), name: `${f} ${last}`, email, phone: ph, ...home, household_id: hh });
    }
  }
  // the planted true duplicates: the same person twice
  const plantedPairs = [];
  for (let i = 0; i < planted; i++) {
    const f = pick(FIRST), last = "Plantwell" + String.fromCharCode(65 + (i % 26)) + i;
    const home = addr();
    const a = { ...base(), id: id(), name: `${f} ${last}`, ...home };
    const b = { ...base(), id: id(), ...home };
    if (i % 3 === 0) { a.email = `${f}.${last}@example.net`.toLowerCase(); b.email = a.email.toUpperCase() + " "; b.name = `${f} ${last}`; a.phone = null; b.phone = null; }
    else if (i % 3 === 1) { a.phone = phone(); b.phone = a.phone.replace(/\D/g, ""); b.name = `${f.toLowerCase()}  ${last}`; a.email = null; b.email = ""; }
    else { a.email = null; b.email = null; a.phone = null; b.phone = null; b.name = `${f} ${last}`; b.address = a.address.toUpperCase(); }
    rows.push(a, b);
    plantedPairs.push(a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);
  }
  return { rows, planted: plantedPairs, orgId };
}

module.exports = { build, PLACEHOLDER_EMAILS, PLACEHOLDER_PHONES };

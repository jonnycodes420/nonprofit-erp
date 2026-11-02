// tests/import6.test.js: IMPORT-6. EVERY ROW IS ACCOUNTED FOR, AND A REAL
// CUSTOMER'S FIRST IMPORT GOES RIGHT. Guards donor data: on 1 Nov a beta org's
// people list of 1,697 rows previewed 1,380; the 317 rows holding only a name
// were read as section labels (shared/sheetRead.js, the one-cell label rule)
// and the preview hid labels, so they vanished without a line. Its "Mailing
// Zip" became a custom field, its 1,701 contacts hid behind "No donors found",
// and a read-only org still opened the import.
//
//   §1 every row: on EVERY import fixture, rows read = written + set aside,
//      no row missing, each row set aside with its line and reason; the
//      people-shapes fixture (made-up names) reads every name-only row as a
//      person, counted exactly; chrome on a list of people is set aside, listed.
//   §2 address columns: each mailing/home/billing header family maps into the
//      address (ZIP, state, street, city, country), never a custom field; ZIPs
//      keep their zero and ZIP+4 reads 12345-6789.
//   §0 contacts in the Directory: a people-only import, then Everyone and
//      Contacts hold them, Donors reads 0, role=auto opens on Everyone, the
//      receipt's import id opens exactly its people, and the truth check agrees.
//   §3 a read-only org: the preview and the write refuse with the sentence.
//   §5 couples: a middle initial, a double surname, a suffix or a title is one
//      person; Data health proposes no couple from the people-shapes names.
//
// HOW IT GOES RED ON MAIN: rowLedger does not exist and the name-only rows are
// labels (§1: 13 of 20, 0 of 8 on the one-column file), "Mailing Zip" and
// "Mailing Country" are kept (§2), role=contact is a 400 (§0), the preview
// reads a read-only org's file (§3), and "Anthony C Thomas" from an import is
// proposed as "Thomas & Anthony C" (§5).
//
// Standard scratch stack (tests/README.md). Sends nothing. The reader's today
// is fixed (2026-11-02); the server legs read no date.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");

const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
const FX = path.join(__dirname, "fixtures", "import");
const PS = path.join(FX, "people-shapes");
const PASSWORD = "loadtest1234";
const TODAY = "2026-11-02";

let R = null;
const reader = async () => (R = R || await import("../shared/sheetRead.js"));
async function sheetsOf(full) {
  const Rm = await reader();
  if (/\.(csv|tsv|txt)$/i.test(full)) return [{ name: "Sheet1", grid: Rm.gridFromText(fs.readFileSync(full, "utf8")) }];
  return Rm.gridsFromWorkbook(XLSX.read(fs.readFileSync(full), { type: "buffer", cellDates: true }), XLSX);
}
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
async function read(full, answers = {}) {
  const Rm = await reader();
  return Rm.understand({ sheets: await sheetsOf(full), fileName: path.basename(full), today: TODAY, answers });
}
async function readText(text, fileName = "people.csv") {
  const Rm = await reader();
  return Rm.understand({ sheets: [{ name: "Sheet1", grid: Rm.gridFromText(text) }], fileName, today: TODAY });
}
async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
const one = async (sql, args) => (await q(sql, args))[0];
async function importJob(tok, body) {
  const r = await api("POST", "/sheet-import/commit", tok, { ...body, background: true });
  if (r.status !== 202) return { start: r, end: null, importId: null };
  const t0 = performance.now();
  for (;;) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok);
    if (j.status === 200 && j.body.status !== "running") return { start: r, end: j.body, importId: r.body.importId };
    if (performance.now() - t0 > 120000) return { start: r, end: { status: "timeout" }, importId: r.body.importId };
    await new Promise(res => setTimeout(res, 150));
  }
}

// ── §1 every row accounted for ─────────────────────────────────────────────
async function everyRow() {
  const files = walk(FX).filter(f => /\.(csv|tsv|xlsx|xls)$/i.test(f)).sort();
  const bad = [];
  for (const f of files) {
    const u = await read(f);
    const L = u.rowLedger;
    if (!L) { bad.push(`${path.relative(FX, f)}: no row ledger`); continue; }
    const unlisted = L.setAside.filter(x => !x.line || !x.reason);
    if (!L.balanced || L.missing.length || L.read !== L.written + L.setAside.length || unlisted.length)
      bad.push(`${path.relative(FX, f)}: read ${L.read}, written ${L.written}, set aside ${L.setAside.length}, missing ${L.missing.map(m => m.line + " " + m.text).slice(0, 3).join(" | ")}`);
  }
  ok(`§1 every import fixture (${files.length}): rows read = written + set aside, none missing, each set-aside row with its line and reason`, files.length >= 60 && !bad.length, bad.slice(0, 8).join("\n"));

  // the people-shapes fixture, counted by hand from the files
  const key = {
    "mixed-names-and-addresses.csv": { rows: 20, nameOnly: ["Bo Carrow", "Marisol", "Anthony C Thomas", "Erin Swanson Russell", "Dr. Priya Raman", "Glenn Ostrowski III", "Quinn Abernathy", "Owen Prescott", "Lark Hollow Community Garden", "Theo Lindqvist", "Juniper"] },
    "full-name-only.csv": { rows: 8, nameOnly: ["Harriet Vale", "Cormac", "Sunny Acres Farm Stand", "Basil Fenwick Sr."] },
    "first-and-last.csv": { rows: 7, nameOnly: ["Ivo", "Fairbanks", "Gwen Talley", "Ines Albright", "Kai Nakamura"] },
    "full-name-and-parts.csv": { rows: 7, nameOnly: ["Dorian Pike", "Lucia Bramble", "Hollis", "just.an.email@example.org"] },
  };
  for (const [f, k] of Object.entries(key)) {
    const u = await read(path.join(PS, f));
    const names = new Set(u.people.map(p => p.name));
    const lost = k.nameOnly.filter(nm => !names.has(nm) && !u.people.some(p => (p.people || []).some(x => x.name === nm)));
    ok(`§1 ${f}: ${k.rows} rows, ${k.rows} on the list, every name-only row a person, nothing set aside`,
       u.counts.records === k.rows && u.rowLedger.read === k.rows && u.rowLedger.setAside.length === 0 && !lost.length && !u.notes.some(x => x.label),
       JSON.stringify({ records: u.counts.records, ledger: u.rowLedger && [u.rowLedger.read, u.rowLedger.written, u.rowLedger.setAside.length], lost, labels: u.notes.filter(x => x.label).map(x => x.text) }));
  }
  const mixed = await read(path.join(PS, "mixed-names-and-addresses.csv"));
  const kinds = Object.fromEntries(mixed.people.map(p => [p.name, p.kind]));
  ok("§1 a single-word name is a person, an organization's name is an organization, a couple is a household",
     kinds.Marisol === "person" && kinds.Juniper === "person" && kinds["Tidewater Rowing Club"] === "organization" && kinds["Lark Hollow Community Garden"] === "organization"
     && kinds["Tom & Jane Halverson"] === "household", JSON.stringify(kinds));
  ok("§1 the import button counts every row: 22 people, 20 on the list", /^Import 22 people, 20 on the list/.test((await reader()).importButtonSentence(mixed).text), (await reader()).importButtonSentence(mixed).text);

  // chrome on a list of people is set aside, each with its line and reason
  const chrome = await readText([
    "Name,City,State", "Wendell Ashby,Salem,MA", "Board members,,", "Fern Gallow,,", "Name,City,State", "Page 2 of 3,,", "Hugo Brandt,Dover,NH", "B,,", "Nell Ortiz,,",
  ].join("\n"));
  const L = chrome.rowLedger;
  const why = L.setAside.map(x => `${x.line}: ${x.reason}`);
  ok("§1 a heading, a repeated header, a page footer and an alphabet divider are set aside, each listed with its line; the four names are people",
     chrome.people.length === 4 && L.balanced && L.read === 8 && L.setAside.length === 4
     && why.some(w => /^3: a section label \("Board members"\)/.test(w)) && why.some(w => /^5: the header row again/.test(w)) && why.some(w => /^6: a section label \("Page 2 of 3"\)/.test(w)) && why.some(w => /^8: a section label \("B"\)/.test(w)),
     JSON.stringify({ people: chrome.people.map(p => p.name), why }));
}

// ── §2 address columns and ZIPs ───────────────────────────────────────────
async function addressColumns() {
  const families = {
    zip: ["Mailing Zip", "Zip", "ZIP Code", "Postal Code", "Mailing Zip/Postal Code", "Mailing Postal Code", "Home Zip", "Billing Zip", "Zip+4"],
    state: ["Mailing State", "State/Province", "Mailing State/Province", "Province", "Billing State"],
    address: ["Mailing Street", "Street", "Mailing Address", "Address Line 1", "Street 1", "Home Address", "Billing Street"],
    city: ["Mailing City", "City", "Town", "Billing City", "Home City"],
    country: ["Country", "Mailing Country", "Home Country", "Billing Country"],
  };
  const sample = { zip: "02134", state: "MA", address: "12 Elm St", city: "Salem", country: "United States" };
  const wrong = [];
  for (const [role, headers] of Object.entries(families)) for (const h of headers) {
    const u = await readText(`Name,${h}\nAda Brightwater,${sample[role]}\nBo Carrow,${sample[role]}\nCal Dunmore,${sample[role]}\n`);
    const col = u.columns.find(c => c.header === h) || {};
    const v = (u.people[0] || {})[role];
    if (col.role !== role || col.disposition !== "mapped" || v !== sample[role] || Object.keys(u.people[0].kept || {}).length) wrong.push(`${h} → ${col.role}/${col.disposition} (${v})`);
  }
  ok(`§2 every address header (${Object.values(families).flat().length}) goes into the address, none into a custom field`, !wrong.length, wrong.join("; "));
  const Rm = await reader();
  const zips = [["01970", "MA", "01970"], ["1970", "MA", "01970"], ["1970", "", "01970"], ["21341234", "MA", "02134-1234"], ["2134-1234", "MA", "02134-1234"],
    ["123456789", "TX", "12345-6789"], ["12345 6789", "TX", "12345-6789"], ["78701-1234", "TX", "78701-1234"], ["7870", "TX", "7870"], ["02840.0", "RI", "02840"]];
  const zipBad = zips.filter(([z, st, want]) => Rm.fixZip(z, st) !== want).map(([z, st, want]) => `${z} (${st}) → ${Rm.fixZip(z, st)}, want ${want}`);
  ok("§2 a ZIP keeps its leading zero (4 and 8 digits) and a ZIP+4 reads 12345-6789", !zipBad.length, zipBad.join("; "));
  const mixed = await read(path.join(PS, "mixed-names-and-addresses.csv"));
  const z = Object.fromEntries(mixed.people.map(p => [p.name, [p.zip, p.country]]));
  ok("§2 the people-shapes file's ZIPs and countries land in the address",
     JSON.stringify([z["Ada Brightwater"], z["Tidewater Rowing Club"], z["Tom & Jane Halverson"], z["Kim & Lee Park"], z["Rosa Delgado-Vance"], z["Imani Okafor"]])
       === JSON.stringify([["01970", "United States"], ["03820", "United States"], ["04101-1234", "United States"], ["80202-1234", null], ["02840-1234", null], ["05401", null]])
     && !(mixed.keptHeaders || []).length, JSON.stringify(z));
}

// ── §5 couples written as one name ────────────────────────────────────────
async function couples() {
  const Rm = await reader();
  const names = [];
  for (const f of fs.readdirSync(PS).filter(x => x.endsWith(".csv"))) for (const p of (await read(path.join(PS, f))).people) if (p.kind === "person") names.push(p.name);
  const split = names.filter(nm => Rm.commaCoupleFix(nm, { imported: true }) || Rm.commaCoupleFix(nm, { imported: true, together: true }));
  ok(`§5 none of the ${names.length} one-person names in the fixture is proposed as a couple, even on a record with a household`, names.length >= 20 && !split.length, split.join(", "));
  const oneP = ["Anthony C Thomas", "Erin Swanson Russell", "Thomas, Anthony C", "Bell, Marcus Jr.", "Dr. Priya Raman", "Glenn Ostrowski III"];
  ok("§5 a middle initial, a double surname, a suffix and a title are one person", oneP.every(nm => !Rm.commaCoupleFix(nm, { imported: true, together: true })),
     oneP.map(nm => `${nm}: ${JSON.stringify(Rm.commaCoupleFix(nm, { imported: true, together: true }))}`).join("; "));
  const two = [["Alex, Brad Hollins", {}], ["Randy or Jessamy Barlow", {}], ["Brad Hollins Alex", { imported: true, together: true }]];
  ok("§5 a couple with a comma, a joining word, or the old reading on a record that says two people is still proposed",
     two.every(([nm, o]) => Rm.commaCoupleFix(nm, o)) && !Rm.commaCoupleFix("Brad Hollins Alex", { imported: true }), "");
}

// ── §0 contacts in the Directory, §3 read-only, §5 Data health ─────────────
async function directory() {
  const ORG = "org_import6_people";
  const tok = await freshOrg(ORG, "IMPORT-6 people only (test)");
  const sheets = await sheetsOf(path.join(PS, "mixed-names-and-addresses.csv"));
  const base = { fileName: "mixed-names-and-addresses.csv", sheets };
  const pre = (await api("POST", "/sheet-import/understand", tok, base)).body || {};
  ok("§0 the preview of a people-only file: 20 rows, 20 on the list, nothing set aside", pre.counts && pre.counts.records === 20 && pre.rowLedger && pre.rowLedger.setAside.length === 0,
     JSON.stringify(pre.counts && [pre.counts.records, pre.rowLedger && pre.rowLedger.setAside.length]));
  const j = await importJob(tok, base);
  ok("§0 the import ends done", j.end && j.end.status === "done", JSON.stringify(j.end || j.start && j.start.body).slice(0, 300));
  const db = await one(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE name='Bo Carrow')::int AS bo, COUNT(*) FILTER (WHERE name='Juniper')::int AS juniper,
                               MAX(zip) FILTER (WHERE name='Ada Brightwater') AS ada_zip, MAX(country) FILTER (WHERE name='Ada Brightwater') AS ada_country
                          FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG]);
  ok("§0 every person is written, the name-only rows too, with the ZIP and country in the address",
     db.n === 22 && db.bo === 1 && db.juniper === 1 && db.ada_zip === "01970" && db.ada_country === "United States", JSON.stringify(db));
  const auto = (await api("GET", "/donors?role=auto&roleCounts=1&limit=100", tok)).body || {};
  ok("§0 an org with no donors opens on Everyone: Everyone 22 · Donors 0 · Contacts 22",
     auto.role === "everyone" && auto.total === 22 && JSON.stringify(auto.roleCounts) === JSON.stringify({ everyone: 22, donors: 0, contacts: 22 }), JSON.stringify({ role: auto.role, total: auto.total, c: auto.roleCounts }));
  const donorsV = (await api("GET", "/donors?role=donor&roleCounts=1&limit=100", tok)).body || {};
  const contactsV = (await api("GET", "/donors?role=contact&limit=100", tok)).body || {};
  ok("§0 Donors reads 0 and Contacts holds all 22", donorsV.total === 0 && (donorsV.donors || []).length === 0 && contactsV.total === 22 && (contactsV.donors || []).length === 22,
     JSON.stringify([donorsV.total, contactsV.total]));
  const filtered = (await api("GET", "/donors?role=contact&search=Carrow&roleCounts=1&limit=100", tok)).body || {};
  ok("§0 a filter works in the Contacts view, and the counts are under the same filter", filtered.total === 1 && filtered.roleCounts && filtered.roleCounts.everyone === 1 && filtered.roleCounts.contacts === 1,
     JSON.stringify([filtered.total, filtered.roleCounts]));
  const ids = (await api("GET", "/donors/ids?role=contact&limit=500", tok)).body || {};
  ok("§0 select-all (bulk actions) gathers the contacts", Array.isArray(ids.ids) && ids.ids.length === 22, JSON.stringify(ids).slice(0, 200));
  const brought = (await api("GET", `/donors?fromImport=${encodeURIComponent(j.importId || "")}&roleCounts=1&limit=100`, tok)).body || {};
  ok("§0 the receipt's link opens exactly the 22 people the import brought in", brought.total === 22, JSON.stringify([brought.total, j.importId]));
  let agree;
  try { agree = await assertSurfacesAgree(ORG, { token: tok, label: "after a people-only import", soft: true }); } catch (e) { agree = { ok: false, diffs: [String(e.message)] }; }
  ok("§0 the truth check: contacts are never counted as donors on any surface", agree.ok, (agree.diffs || []).join("\n"));

  // §5 Data health proposes no couple from these names (each was made by an import)
  const health = (await api("GET", "/data-health", tok)).body || {};
  ok("§5 Data health: no couples proposed from a list of single people", health.counts && !health.counts.couples, JSON.stringify(health.counts && health.counts.couples));

  // §3 the trial ended: read-only
  await q(`UPDATE orgs SET subscription_status='trial_expired' WHERE id=$1`, [ORG]);
  const before = await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1", [ORG]);
  const u3 = await api("POST", "/sheet-import/understand", tok, { fileName: "full-name-only.csv", sheets: await sheetsOf(path.join(PS, "full-name-only.csv")) });
  ok("§3 a read-only org's preview says so plainly and reads nothing", u3.status === 402 && u3.body && u3.body.error === "read_only"
     && u3.body.sentence === "Your account is read-only, so nothing can be imported. Reactivate to continue.", JSON.stringify([u3.status, u3.body]).slice(0, 300));
  const c3 = await api("POST", "/sheet-import/commit", tok, { fileName: "full-name-only.csv", sheets: await sheetsOf(path.join(PS, "full-name-only.csv")), background: true });
  const after = await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1", [ORG]);
  ok("§3 and the write refuses with the same sentence, writing nothing", c3.status === 402 && c3.body && c3.body.error === "read_only" && after.n === before.n, JSON.stringify([c3.status, before.n, after.n]));
  await q(`UPDATE orgs SET subscription_status='active' WHERE id=$1`, [ORG]);
}

(async () => {
  // each section runs on its own, so a red one never hides the next
  for (const [name, fn] of [["§1", everyRow], ["§2", addressColumns], ["§5", couples], ["§0 §3 §5", directory]]) {
    try { await fn(); } catch (e) { ok(`${name} ran to the end`, false, e.stack); }
  }
  await closeDb();
  summary("import6");
})();

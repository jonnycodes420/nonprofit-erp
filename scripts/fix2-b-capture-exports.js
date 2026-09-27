// FIX-2 B — capture every Reports export's bytes, so "CSV and PDF unchanged in
// CONTENT" is a diff, not a claim.
//
//   node scripts/fix2-b-capture-exports.js <outDir>
//
// Seeds the fixture org (tests/fix2-b-fixture.js) on the LOCAL stack named by
// BASE / DATABASE_URL, then writes one file per export. Run it on the code
// before a change and after it, and `diff -r` the two folders. A PDF carries
// its creation time and a random document id; those two are normalised away
// (they differ between two runs of unchanged code), nothing else is.
const fs = require("fs"), path = require("path");
const zlib = require("zlib");
const { BASE, closeDb } = require("../tests/helpers");
const { seed, reset } = require("../tests/fix2-b-fixture");

// Loopback only: it seeds a fixture org, so it refuses any other target.
for (const [k, v] of [["BASE", BASE], ["DATABASE_URL", process.env.DATABASE_URL || ""]]) {
  if (v && !/localhost|127\.0\.0\.1/.test(v)) { console.error(`Refusing: ${k} is not loopback (${v}).`); process.exit(2); }
}

const out = process.argv[2];
if (!out) { console.error("usage: node scripts/fix2-b-capture-exports.js <outDir>"); process.exit(2); }

// A PDF's content streams are deflated; inflate them so the diff reads text.
function normalisePdf(buf) {
  let s = buf.toString("latin1");
  s = s.replace(/\(D:\d{14}Z\)/g, "(D:X)").replace(/\/CreationDate \(D:[^)]*\)/g, "/CreationDate (D:X)").replace(/\/ModDate \(D:[^)]*\)/g, "/ModDate (D:X)")
       .replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/gi, "/ID [<X> <X>]");
  const parts = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(s))) {
    try { parts.push(zlib.inflateSync(Buffer.from(m[1], "latin1")).toString("latin1")); } catch { parts.push("[binary stream " + m[1].length + "]"); }
  }
  // The xref offsets move with nothing but the date strings' length; drop them.
  return parts.join("\n----\n") + "\n====\n" + s.replace(/stream\r?\n[\s\S]*?\r?\nendstream/g, "stream…endstream").replace(/\d{10} \d{5} [nf]/g, "xref").replace(/startxref\s+\d+/, "startxref N");
}

(async () => {
  const { tok, y, savedId, from, to } = await seed();
  fs.mkdirSync(out, { recursive: true });
  const get = async p => {
    const r = await fetch(BASE + p, { headers: { Authorization: "Bearer " + tok } });
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  };
  const fy = y + 1;
  const csv = [
    `/reports/giving-summary?year=${fy}&yearMode=fiscal`, `/reports/giving-summary?from=${from}&to=${to}`,
    `/reports/by-group?year=${fy}&yearMode=fiscal&groupBy=funds`, `/reports/by-group?year=${fy}&yearMode=fiscal&groupBy=campaigns`,
    `/reports/by-group?year=${fy - 1}&yearMode=fiscal&groupBy=giving_pages`,
    `/reports/lybunt?year=${fy}&yearMode=fiscal`, `/reports/lybunt?year=${y}&yearMode=calendar`,
    `/reports/sybunt?year=${fy}&yearMode=fiscal`, `/reports/retention?yearMode=fiscal`, `/reports/retention?yearMode=calendar`,
    `/reports/top-donors?year=${fy - 1}&yearMode=fiscal&scope=period&limit=50`, `/reports/top-donors?scope=lifetime&limit=50`,
    `/reports/three-year?year=${fy}&yearMode=fiscal`, `/reports/annual?year=${fy - 1}&yearMode=fiscal`,
    `/reports/solicitations?yearMode=fiscal`, `/reports/bookkeeper?from=${y - 1}-07-01&to=${y}-06-30`,
    `/reports/grant-deadlines`, `/reports/grant-restricted`, `/reports/members-directory`, `/reports/members-by-level`,
    `/reports/members-expiring`, `/reports/members-lapsed`, `/reports/members-new-renewed`, `/reports/membership-revenue`,
  ];
  const list = await get("/saved-reports");
  const ids = [...JSON.parse(list.buf.toString()).standard.map(s => s.id), savedId];
  let n = 0;
  const write = (name, body) => { fs.writeFileSync(path.join(out, name), body); n++; };
  for (const p of csv) {
    const r = await get(p + (p.includes("?") ? "&" : "?") + "format=csv");
    write(p.replace(/^\/reports\//, "report_").replace(/[^a-z0-9_=.-]+/gi, "_") + ".csv", `HTTP ${r.status}\n` + r.buf.toString("utf8"));
  }
  for (const id of ids) {
    const c = await get(`/saved-reports/${encodeURIComponent(id)}/csv`);
    write(`saved_${id.replace(/[^a-z0-9-]+/gi, "_")}.csv`, `HTTP ${c.status}\n` + c.buf.toString("utf8"));
    const pdf = await get(`/saved-reports/${encodeURIComponent(id)}/pdf`);
    write(`saved_${id.replace(/[^a-z0-9-]+/gi, "_")}.pdf.txt`, `HTTP ${pdf.status}\n` + normalisePdf(pdf.buf));
  }
  // The saved report's id is minted fresh each run; name the file by role.
  const mine = path.join(out, `saved_${savedId.replace(/[^a-z0-9-]+/gi, "_")}`);
  for (const ext of [".csv", ".pdf.txt"]) fs.renameSync(mine + ext, path.join(out, "saved_user-big-givers" + ext));
  console.log(`captured ${n} exports into ${out}`);
  await reset();
  await closeDb();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

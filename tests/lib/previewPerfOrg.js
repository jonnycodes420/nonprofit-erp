// tests/lib/previewPerfOrg.js · FIX-55 item 1b. An org shaped like the one the
// preview was slow in: 2,000 people, 500 of them deleted, many of them sharing
// names and emails with the real-shaped files, so the preview's matching does
// the work it does on prod. Used by the preview budgets in tests/perf-app.spec.js
// and by scripts/preview-perf.js, which prints the before-and-after numbers.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const FX = path.join(__dirname, "..", "fixtures", "import", "real-shaped");
const FILES = ["jp-gift-history-287.xlsx", "jp-dinner-gifts-106.xlsx", "jp-contacts-656.xlsx"];
const WORKBOOK = path.join(__dirname, "..", "fixtures", "import", "fix52", "event-workbook-shape.xlsx");

let R = null;
async function sheetsOf(file, XLSX) {
  R = R || await import("../../shared/sheetRead.js");
  const p = path.isAbsolute(file) ? file : path.join(FX, file);
  return R.gridsFromWorkbook(XLSX.read(fs.readFileSync(p), { type: "buffer", cellDates: true }), XLSX);
}

// The names and emails the files carry, read off their cells: every cell in a
// column whose header says name or email.
function namesIn(sheets) {
  const names = [], emails = [];
  for (const sh of sheets) {
    const g = sh.grid || [];
    const hi = g.findIndex(r => (r || []).filter(c => c != null && String(c).trim()).length >= 2);
    if (hi < 0) continue;
    const head = g[hi].map(c => String(c || "").toLowerCase());
    const first = head.findIndex(h => /first/.test(h)), last = head.findIndex(h => /last/.test(h));
    const full = head.findIndex(h => /name/.test(h) && !/first|last|event|company|org/.test(h));
    const em = head.findIndex(h => /e-?mail/.test(h));
    for (const r of g.slice(hi + 1)) {
      const nm = first >= 0 && last >= 0 ? `${r[first] || ""} ${r[last] || ""}`.trim() : full >= 0 ? String(r[full] || "").trim() : "";
      if (nm) names.push(nm);
      if (em >= 0 && r[em]) emails.push(String(r[em]).trim());
    }
  }
  return { names, emails };
}

// 2,000 people: the files' own names first (living, so the preview matches
// them), 500 deleted (a share of them the files' names too), the rest made up.
async function seedPreviewOrg(q, orgId, XLSX, { people = 2000, deleted = 500 } = {}) {
  const seen = new Set(), rows = [];
  for (const f of [...FILES.map(x => x), WORKBOOK]) {
    const { names, emails } = namesIn(await sheetsOf(f, XLSX));
    names.forEach((nm, i) => { const k = nm.toLowerCase(); if (!seen.has(k)) { seen.add(k); rows.push({ name: nm, email: emails[i] || null }); } });
  }
  const FIRST = ["Ada", "Basil", "Cora", "Dmitri", "Edda", "Felix", "Gwen", "Hollis", "Ines", "Jory", "Kit", "Lark", "Mabel", "Nils", "Opal", "Pim"];
  const LAST = ["Arden", "Bellweather", "Carrow", "Dunmore", "Ellery", "Fenwick", "Galloway", "Hartigan", "Ives", "Jessup", "Kestrel", "Lindqvist"];
  for (let i = 0; rows.length < people; i++) rows.push({ name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]} ${i}`, email: `perf${i}@example.org` });
  rows.length = people;
  // every fourth person is deleted, so the deleted share the files' names too
  const vals = rows.map((r, i) => [`d_pp_${orgId.slice(-6)}_${i}`, orgId, r.name, r.email, i % 4 === 3 && i / 4 < deleted ? true : false]);
  for (let k = 0; k < vals.length; k += 500) {
    const b = vals.slice(k, k + 500);
    await q(`INSERT INTO donors (id, org_id, name, email, deleted_at, created_by, created_by_name)
             VALUES ${b.map((_, j) => `($${j * 5 + 1},$${j * 5 + 2},$${j * 5 + 3},$${j * 5 + 4},CASE WHEN $${j * 5 + 5}::boolean THEN NOW() END,'system:test','Preview perf seed')`).join(",")}`, b.flat());
  }
  const [{ n }] = await q("SELECT COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS n FROM donors WHERE org_id=$1", [orgId]);
  return { people: rows.length, deleted: n };
}

async function freshPerfOrg(q, login, id, name, password = "loadtest1234") {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(password, 4)]);
  return { email, token: await login(email, password) };
}

// The budgets: the first preview under 4 seconds and each re-read after an
// answer under 2, at prod's round trip. The scratch database answers in well
// under a millisecond, so each preview is charged what it took here PLUS its
// statements (X-Steward-Round-Trips, TEST_MODE) at ROUND_TRIP_MS each, which is
// what made the 656-row preview 38 seconds on prod. A preview that goes back
// to asking the matcher once per person fails here, not on a customer's file.
const ROUND_TRIP_MS = 17, FIRST_MS = 4000, REREAD_MS = 2000;
async function timedPreview(base, token, body) {
  const t0 = performance.now();
  const r = await fetch(base + "/sheet-import/understand", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  const ms = performance.now() - t0, trips = Number(r.headers.get("x-steward-round-trips"));
  return { status: r.status, body: json, ms, trips: Number.isFinite(trips) ? trips : null, atProd: ms + (Number.isFinite(trips) ? trips : 0) * ROUND_TRIP_MS };
}
async function previewBudgets({ ok, base, token, XLSX }) {
  const out = [];
  for (const f of [...FILES, WORKBOOK]) {
    const sheets = await sheetsOf(f, XLSX), fileName = path.basename(f);
    const first = await timedPreview(base, token, { fileName, sheets, answers: {} });
    const again = await timedPreview(base, token, { fileName, fileKey: first.body.fileKey, answers: { eventDate: "2026-10-22", useEventDate: true } });
    ok(`preview budget ${fileName}: first ${Math.round(first.atProd)}ms (${Math.round(first.ms)}ms + ${first.trips} round trips × ${ROUND_TRIP_MS}ms) under ${FIRST_MS}ms`,
       first.status === 200 && first.trips != null && first.atProd < FIRST_MS, JSON.stringify({ status: first.status, ms: first.ms, trips: first.trips }));
    ok(`preview budget ${fileName}: re-read ${Math.round(again.atProd)}ms (${Math.round(again.ms)}ms + ${again.trips} round trips) under ${REREAD_MS}ms`,
       again.status === 200 && again.trips != null && again.atProd < REREAD_MS, JSON.stringify({ status: again.status, ms: again.ms, trips: again.trips }));
    out.push({ fileName, first, again });
  }
  return out;
}

module.exports = { FILES, WORKBOOK, ROUND_TRIP_MS, sheetsOf, seedPreviewOrg, freshPerfOrg, timedPreview, previewBudgets };

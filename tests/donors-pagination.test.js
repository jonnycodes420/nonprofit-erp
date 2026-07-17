// BUILD-06 Phase A verification: server-side donor pagination/filtering,
// /donors/summaries, /donors/export/csv. Run against the seeded load-test DB
// (scripts/seed-loadtest.js → org_loadtest 25k donors, org_smalltest 300).
// Perf targets from the BUILD-06 spec: /donors?limit=50 sub-second <500KB;
// /donors/summaries <2s. Also asserts /dashboard/today + stewardship summary
// didn't regress past their BUILD-05 post-fix ballpark.
//
//   node tests/donors-pagination.test.js
//
const { ok, summary, login, api, wireSize } = require("./helpers");

async function main() {
  const tBig = await login("admin@riverbend.test");
  const tSmall = await login("admin@willow.test");

  // ── Legacy shape unchanged when no limit param ────────────────────────────
  console.log("\n── Back-compat (no limit param) ──");
  const full = await api("GET", "/donors", tBig);
  ok("unpaginated response is a plain array", Array.isArray(full.body), typeof full.body);
  ok("unpaginated returns whole org", full.body.length === 25000, full.body.length);
  console.log(`  (info) unpaginated payload: ${(full.bytes / 1048576).toFixed(1)}MB in ${full.ms}ms`);

  // ── Paginated shape + perf ────────────────────────────────────────────────
  console.log("\n── Paginated page ──");
  const page = await api("GET", "/donors?limit=50", tBig);
  ok("paginated returns {donors, total}", Array.isArray(page.body.donors) && typeof page.body.total === "number", Object.keys(page.body));
  ok("page has 50 rows", page.body.donors.length === 50, page.body.donors.length);
  ok("total is whole org", page.body.total === 25000, page.body.total);
  ok(`page under 1s (was ${page.ms}ms)`, page.ms < 1000, page.ms);
  ok(`page payload under 500KB (was ${(page.bytes / 1024).toFixed(0)}KB)`, page.bytes < 512000, page.bytes);
  ok("page rows carry last_touchpoint + parsed tags", "last_touchpoint" in page.body.donors[0] && Array.isArray(page.body.donors[0].tags), Object.keys(page.body.donors[0]));
  ok("default sort is total_giving DESC", page.body.donors[0].total_giving >= page.body.donors[49].total_giving);

  // ── Parity: concatenated pages == unpaginated id set ──────────────────────
  console.log("\n── Page-concatenation parity (25k donors, 200/page) ──");
  const fullIds = new Set(full.body.map(d => d.id));
  const seen = new Set();
  let offset = 0, dup = false, pages = 0;
  for (;;) {
    const p = await api("GET", `/donors?limit=200&offset=${offset}`, tBig);
    for (const d of p.body.donors) { if (seen.has(d.id)) dup = true; seen.add(d.id); }
    pages++;
    offset += 200;
    if (p.body.donors.length < 200) break;
  }
  ok(`no duplicate ids across ${pages} pages (stable sort tiebreak)`, !dup);
  ok("concatenated pages == unpaginated donor set", seen.size === fullIds.size && [...seen].every(id => fullIds.has(id)), { pages: seen.size, full: fullIds.size });

  // ── Server-side filters vs client-side ground truth ───────────────────────
  console.log("\n── Filters ──");
  const lapsedTruth = full.body.filter(d => d.stage === "lapsed").length;
  const lapsed = await api("GET", "/donors?limit=1&stage=lapsed", tBig);
  ok("stage filter total matches client-side count", lapsed.body.total === lapsedTruth, { server: lapsed.body.total, truth: lapsedTruth });

  const probeName = full.body[123].name.split(" ")[0].toLowerCase();
  const searchTruth = full.body.filter(d => (d.name + " " + (d.email || "")).toLowerCase().includes(probeName)).length;
  const searched = await api("GET", `/donors?limit=1&search=${encodeURIComponent(probeName)}`, tBig);
  // server matches name OR email separately; client truth above approximates with concat — recompute exactly:
  const searchTruthExact = full.body.filter(d => d.name.toLowerCase().includes(probeName) || (d.email || "").toLowerCase().includes(probeName)).length;
  ok(`search "${probeName}" total matches`, searched.body.total === searchTruthExact, { server: searched.body.total, truth: searchTruthExact, concatTruth: searchTruth });

  const someOwner = full.body.find(d => d.assigned_to)?.assigned_to;
  const ownerTruth = full.body.filter(d => d.assigned_to === someOwner).length;
  const owned = await api("GET", `/donors?limit=1&assignedTo=${someOwner}`, tBig);
  ok("assignedTo filter total matches", owned.body.total === ownerTruth, { server: owned.body.total, truth: ownerTruth });

  const majorTruth = full.body.filter(d => d.status === "major").length;
  const majors = await api("GET", "/donors?limit=1&status=major", tBig);
  ok("status filter total matches", majors.body.total === majorTruth, { server: majors.body.total, truth: majorTruth });

  const byName = await api("GET", "/donors?limit=50&sort=name", tBig);
  const names = byName.body.donors.map(d => d.name.toLowerCase());
  ok("sort=name orders ascending", names.every((n, i) => i === 0 || names[i - 1] <= n));
  const badSort = await api("GET", "/donors?limit=5&sort=;DROP TABLE donors", tBig);
  ok("unknown sort falls back safely (whitelist)", badSort.status === 200 && badSort.body.donors.length === 5, badSort.status);

  // ── /donors/summaries ─────────────────────────────────────────────────────
  console.log("\n── /donors/summaries ──");
  const sums = await api("GET", "/donors/summaries", tBig);
  ok("summaries returns whole org", Array.isArray(sums.body) && sums.body.length === 25000, sums.body.length);
  ok(`summaries under 2s (was ${sums.ms}ms)`, sums.ms < 2000, sums.ms);
  console.log(`  (info) summaries payload: ${(sums.bytes / 1048576).toFixed(1)}MB vs full ${(full.bytes / 1048576).toFixed(1)}MB (${(100 * sums.bytes / full.bytes).toFixed(0)}%)`);
  const wire = await wireSize("/donors/summaries", tBig);
  ok(`summaries gzipped on the wire (${(wire.bytes / 1024).toFixed(0)}KB, target <2MB)`, wire.encoding === "gzip" && wire.bytes < 2 * 1048576, wire);
  const pageWire = await wireSize("/donors?limit=50", tBig);
  ok(`page gzipped on the wire (${(pageWire.bytes / 1024).toFixed(0)}KB)`, pageWire.encoding === "gzip" && pageWire.bytes < 100 * 1024, pageWire);
  const s0 = sums.body[0];
  ok("summaries omit heavy columns (notes, score_rationale)", !("notes" in s0) && !("score_rationale" in s0), Object.keys(s0));
  const needed = ["id", "name", "email", "stage", "status", "total_giving", "last_gift_date", "last_gift_amount", "gift_count", "assigned_to", "assigned_to_name", "city", "state", "zip", "tags", "wealth_score", "capacity_tier", "last_touchpoint"];
  ok("summaries carry every field the views need", needed.every(k => k in s0), needed.filter(k => !(k in s0)));

  // ── /donors/export/csv ────────────────────────────────────────────────────
  console.log("\n── /donors/export/csv ──");
  const csv = await api("GET", "/donors/export/csv?stage=lapsed", tBig);
  ok("export streams CSV", csv.status === 200 && csv.text.includes("Name,Email"), csv.status);
  const csvRows = csv.text.trim().split("\r\n").length - 1; // minus header
  ok("export row count == filtered total", csvRows === lapsedTruth, { csvRows, lapsedTruth });
  const csvAll = await api("GET", "/donors/export/csv", tBig);
  ok("unfiltered export == whole org", csvAll.text.trim().split("\r\n").length - 1 === 25000);

  // ── Org isolation ─────────────────────────────────────────────────────────
  console.log("\n── Org isolation ──");
  const smallPage = await api("GET", "/donors?limit=50", tSmall);
  ok("small org total is its own 300", smallPage.body.total === 300, smallPage.body.total);
  const smallCsv = await api("GET", "/donors/export/csv", tSmall);
  ok("small org export == 300 rows", smallCsv.text.trim().split("\r\n").length - 1 === 300);
  const smallSums = await api("GET", "/donors/summaries", tSmall);
  ok("small org summaries == 300", smallSums.body.length === 300, smallSums.body.length);

  // ── No regression on the Home-screen stack ────────────────────────────────
  console.log("\n── Home stack (no regression) ──");
  const today = await api("GET", "/dashboard/today?scope=all", tBig);
  ok(`/dashboard/today under 2s (was ${today.ms}ms)`, today.status === 200 && today.ms < 2000, today.ms);
  const stew = await api("GET", "/metrics/stewardship-summary?scope=all", tBig);
  ok(`stewardship-summary under 2s (was ${stew.ms}ms)`, stew.status === 200 && stew.ms < 2000, stew.ms);

  summary();
}
main().catch(e => { console.error(e); process.exit(1); });

// SCALE-1 · a 10,000-row gift file through the same route, in the same
// 500-person chunks, that the import screen uses (DonorImport.jsx CHUNK), and
// the server's peak memory while it runs.
//
//   SERVER_PID=<pid of the load server> node scripts/load/import-drive.js [orgSlug]
//
// 6,000 rows belong to people already on file and 4,000 to new people; one
// row in twenty is dated inside the last 30 days (the recent-gift lane).
// Loopback only.
const { execFileSync } = require("child_process");

const BASE = process.env.BASE || "http://localhost:6701";
if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE)) { console.error("Refusing: BASE must be loopback."); process.exit(1); }
const slug = process.argv[2] || "load020";
const ROWS = Number(process.env.ROWS || 10000);
const CHUNK = 500;
const PID = process.env.SERVER_PID;

const rssMb = () => { try { return Number(execFileSync("ps", ["-o", "rss=", "-p", PID]).toString().trim()) / 1024; } catch { return null; } };

(async () => {
  const lr = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `admin@${slug}.load`, password: "loadtest1234" }) });
  const { token } = await lr.json();
  // One donor entry per distinct person, the gifts pointing at them by index.
  const donors = [], gifts = [], index = new Map();
  for (let i = 0; i < ROWS; i++) {
    const known = i < ROWS * 0.6;
    const email = known ? `d${1 + (i % 4500)}@${slug}.example` : `imp${Math.floor(i / 2)}@${slug}.example`;
    const name = known ? `Known ${1 + (i % 4500)}` : `Imported Person ${Math.floor(i / 2)}`;
    if (!index.has(email)) { index.set(email, donors.length); donors.push({ name, email }); }
    const daysAgo = i % 20 === 0 ? (i % 29) + 1 : 40 + (i * 37) % 1050;
    gifts.push({ donorIndex: index.get(email), amount: Number((25 + (i * 13) % 975).toFixed(2)),
      date: new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10), type: "cash" });
  }
  const byDonor = new Map();
  for (const g of gifts) { if (!byDonor.has(g.donorIndex)) byDonor.set(g.donorIndex, []); byDonor.get(g.donorIndex).push(g); }
  const importId = "imp_" + Date.now().toString(16).padStart(24, "0").slice(-24);
  let peak = rssMb() || 0; const base = peak;
  const timer = setInterval(() => { const m = rssMb(); if (m && m > peak) peak = m; }, 100);
  const t0 = Date.now();
  let inserted = 0, created = 0; const chunkMs = [];
  for (let start = 0; start < donors.length; start += CHUNK) {
    const slice = donors.slice(start, start + CHUNK);
    const chunkGifts = [];
    slice.forEach((_, j) => (byDonor.get(start + j) || []).forEach(g => chunkGifts.push({ ...g, donorIndex: j })));
    const c0 = Date.now();
    const r = await fetch(`${BASE}/donors/import-combined`, { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ donors: slice, gifts: chunkGifts, importId }) });
    const b = await r.json().catch(() => ({}));
    chunkMs.push(Date.now() - c0);
    if (!r.ok) { console.error("chunk failed", r.status, JSON.stringify(b).slice(0, 300)); break; }
    inserted += b.giftsInserted || 0; created += b.created || 0;
  }
  const ms = Date.now() - t0;
  clearInterval(timer);
  const out = { rows: ROWS, people: donors.length, chunks: chunkMs.length, seconds: +(ms / 1000).toFixed(1),
    giftsInserted: inserted, peopleCreated: created, slowestChunkMs: Math.max(...chunkMs),
    rssBaseMb: Math.round(base), rssPeakMb: Math.round(peak) };
  console.log(JSON.stringify(out));
})().catch(e => { console.error(e); process.exit(1); });

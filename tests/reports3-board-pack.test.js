// REPORTS-3 — EVERY NUMBER IN THE BOARD PACK PDF EQUALS THE LIVE REPORT.
//
// The build's one test, and the only thing it guards: a board pack is a
// document that leaves the building. It is attached to an email, forwarded,
// printed and read at a meeting six weeks later by people who cannot click
// anything on it. A figure that is right on the screen and a quarter of a per
// cent out on the paper is a figure nobody can catch.
//
// So this does not check the composer against itself. It reads the numbers
// back OUT of the generated PDF (which is why renderBoardPackPdf passes
// `compress: false`) and foots each one against GET /figures/:source/rows —
// the live report's own rows, paged, summed in integer cents.
//
//   §1  every figure in the pack foots to its rows, in cents
//   §2  every number printed in the PDF is a number the live report agrees
//       with, for the same period and the same filters
//   §3  a filtered pack narrows, and says so where a number cannot be narrowed
//   §4  the definitions page defines every number that got printed
//   §5  the schedule: off by default, one send per period, released on failure,
//       recipients are the org's own list and never a donor
//   §6  THE GUARD CAN FAIL — a figure moved one cent, and one printed number
//       altered, are both caught
//
// Run on the scratch stack: BASE, DATABASE_URL (see tests/run-all.sh).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, SINK_PORT } = require("./helpers");
const http = require("http");
const orgTime = require("../orgTime");

const ORG = "org_rp3pack", ORG2 = "org_rp3pack2";
const EMAIL = "rp3pack@example.org", EMAIL2 = "rp3pack2@example.org";
const PW = "loadtest1234";
const cents = n => Math.round((Number(n) || 0) * 100);
const qs = p => Object.entries(p || {}).filter(([, v]) => v !== undefined && v !== null && v !== "")
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

const TABLES = ["volunteer_shifts", "board_pack_sends", "board_pack_schedules", "saved_dashboards",
  "saved_report_sends", "saved_reports", "gift_soft_credits", "recurring_subscriptions", "interactions",
  "threads", "tasks", "pledges", "grants", "gifts", "campaigns", "donors", "fin_audit_log", "users", "fin_funds"];
async function reset() {
  for (const o of [ORG, ORG2]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

// Every row behind a source, every page of it — the live report's own rows.
async function allRows(tok, source) {
  const rows = []; let page = 1, first = null;
  for (;;) {
    const r = await api("GET", `/figures/${encodeURIComponent(source.key)}/rows?${qs({ ...source.params, page, pageSize: 200 })}`, tok);
    if (r.status !== 200) return { status: r.status, body: r.body, rows: [] };
    first = first || r.body;
    rows.push(...(r.body.rows || []));
    if (rows.length >= (r.body.totalRows || 0) || !(r.body.rows || []).length) break;
    page++;
  }
  return { status: 200, body: first, rows };
}
function measureOf(measure, rows) {
  if (measure === "sum") return rows.reduce((s, r) => s + cents(r.amount), 0) / 100;
  if (measure === "count") return rows.length;
  if (measure === "avg") return rows.length ? Math.round(rows.reduce((s, r) => s + Number(r.amount || 0), 0) / rows.length) : 0;
  return NaN;
}
const ratioOf = (formula, num, den) => formula === "change"
  ? (den > 0 ? Math.round(((num - den) / den) * 100) : null)
  : (den > 0 ? Math.round((num / den) * 100) : null);

// Does one figure foot to the live rows behind it? [true] or [false, why].
async function foots(tok, fig) {
  if (!fig.source) return [false, "no source on the figure"];
  const got = await allRows(tok, fig.source);
  if (got.status !== 200) return [false, `rows answered ${got.status}`];
  const b = got.body;
  if (fig.value === null || fig.value === undefined) {
    return typeof b.blank === "string" && b.blank.length > 20 ? [true] : [false, `a blank with no sentence: ${JSON.stringify(b.blank)}`];
  }
  if (b.measure === "ratio" || b.measure === "difference") {
    const [p1, p2] = b.parts || [];
    if (!p1 || !p2) return [false, "a ratio without its two parts"];
    const r1 = await allRows(tok, p1.source), r2 = await allRows(tok, p2.source);
    const v1 = measureOf(p1.measure, r1.rows), v2 = measureOf(p2.measure, r2.rows);
    if (b.measure === "difference") return cents(v1) - cents(v2) === cents(fig.value) ? [true] : [false, `${v1} − ${v2} ≠ ${fig.value}`];
    const want = ratioOf(b.formula, v1, v2);
    return want === fig.value ? [true] : [false, `${b.formula}(${v1}, ${v2}) = ${want} ≠ ${fig.value}`];
  }
  if (got.rows.length !== b.totalRows) return [false, `pages returned ${got.rows.length} of ${b.totalRows}`];
  const v = measureOf(b.measure, got.rows);
  if (b.measure === "sum") {
    return cents(v) === cents(fig.value) && b.cents === cents(fig.value) ? [true] : [false, `rows ${v} · endpoint ${b.value} · figure ${fig.value}`];
  }
  return v === fig.value && b.value === fig.value ? [true] : [false, `${b.measure} of rows ${v} · figure ${fig.value}`];
}

// Every figure the pack holds, wherever it sits.
function figuresOf(pack) {
  const out = [];
  for (const s of pack.sections) {
    if (s.kind === "figures") for (const f of s.figures) out.push({ where: `${s.key}.${f.key}`, ...f });
    if (s.kind === "list") out.push({ where: `${s.key}.total`, label: s.label, value: s.total, source: s.source });
    // A goal prints its three numbers as ONE line beside its name
    // ("$2,439.35 of $40,000.00 · 6%"), so they are footed individually here
    // and their printing is checked once, as that line, below.
    if (s.kind === "goals") for (const g of s.goals) {
      out.push({ where: `${s.key}.${g.label}.raised`, label: g.label, value: g.raised.value, source: g.raised.source, kind: "money", onOwnLine: false });
      out.push({ where: `${s.key}.${g.label}.target`, label: g.label, value: g.target.value, source: g.target.source, kind: "money", onOwnLine: false });
      out.push({ where: `${s.key}.${g.label}.percent`, label: g.label, value: g.percent.value, source: g.percent.source, kind: "percent", onOwnLine: false });
    }
  }
  return out;
}

// ── READING THE PDF ────────────────────────────────────────────────────────
// With `compress: false` the content streams are literal, and pdfkit writes a
// run of text as a KERNED array — `[<48656c> -20 <6c6f>] TJ` — with each piece
// a hex string and the numbers between them kerning. So a word is split across
// pieces and the pieces of one array must be joined to get the run back. (The
// first attempt at this looked only for `(…) Tj`, found nothing at all, and
// every "is it printed" assertion passed vacuously: an extractor that returns
// nothing agrees with everything. That is why §6 below checks that this reader
// can tell $7,477.80 from $7,477.81 before anything else is believed.)
function pdfText(buf) {
  const raw = buf.toString("latin1");
  const runs = [];
  const unesc = t => t.replace(/\\([()\\])/g, "$1");
  const hex = h => Buffer.from(h.replace(/[^0-9a-fA-F]/g, ""), "hex").toString("latin1");
  // Each kerned array, joined back into one run.
  const arr = /\[((?:<[0-9a-fA-F\s]*>|\((?:\\.|[^\\()])*\)|[-\d.\s])*)\]\s*TJ/g;
  let m;
  while ((m = arr.exec(raw)) !== null) {
    let out = "";
    const piece = /<([0-9a-fA-F\s]*)>|\(((?:\\.|[^\\()])*)\)/g;
    let p;
    while ((p = piece.exec(m[1])) !== null) out += p[1] !== undefined ? hex(p[1]) : unesc(p[2]);
    if (out) runs.push(out);
  }
  // And the plain form, for anything written without kerning.
  const one = /(?:<([0-9a-fA-F\s]*)>|\(((?:\\.|[^\\()])*)\))\s*Tj/g;
  while ((m = one.exec(raw)) !== null) runs.push(m[1] !== undefined ? hex(m[1]) : unesc(m[2]));
  return runs;
}
const fmtMoney = v => "$" + (Math.round((Number(v) || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function printedOf(kind, v, suffix) {
  if (v === null || v === undefined) return "—";
  if (kind === "money") return fmtMoney(v);
  if (kind === "percent") return `${v}%`;
  return Number(v).toLocaleString("en-US") + (suffix ? ` ${suffix}` : "");
}

async function getPdf(tok, query) {
  const BASE = process.env.BASE || "http://localhost:5601";
  const r = await fetch(`${BASE}/board-pack/pdf?${qs(query)}`, { headers: { Authorization: "Bearer " + tok } });
  if (!r.ok) return { status: r.status, buf: null };
  return { status: 200, buf: Buffer.from(await r.arrayBuffer()) };
}

// THE MAIL SINK. RESEND_BASE_URL points the server's Resend client here, so a
// send is captured and never leaves. It is also how the attachment is proven:
// a board pack whose email carries no PDF is a board pack nobody received.
const mails = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", c => b += c);
  req.on("end", () => {
    try { if (req.url === "/emails") mails.push(JSON.parse(b)); } catch { /* not a send */ }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});

(async () => {
  console.log("reports3-board-pack");
  await new Promise((r, j) => { sink.on("error", j); sink.listen(SINK_PORT, r); });
  await reset();
  const org = { timezone: orgTime.DEFAULT_TZ };
  const today = orgTime.orgToday(org);
  // The period a quarterly pack covers: the last COMPLETE quarter.
  const lastQ = orgTime.orgPeriodBounds(org, "quarter", -1);
  const lastM = orgTime.orgPeriodBounds(org, "month", -1);
  const prevQ = orgTime.samePointLastYear(lastQ.start, lastQ.end, today);
  const hash = bcrypt.hashSync(PW, 4);
  for (const [id, email, name, slug] of [[ORG, EMAIL, "Westbrook Community Arts", "rp3-pack"], [ORG2, EMAIL2, "Other Shop", "rp3-pack2"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,created_at)
             VALUES ($1,$2,$3,1,'active','growth', NOW() - INTERVAL '1200 days')`, [id, name, slug]);
  // MAIL-1: an org that has onboarded (its donor file is in); without it nothing sends.
  await q("UPDATE orgs SET onboarded_at=NOW() WHERE id=$1", [id]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Pack Admin','admin')`, ["u_" + id, id, email, hash]);
  }
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES
           ('ff_rp3_sch',$1,'Scholarships',true),('ff_rp3_gen',$1,'General Operating',false)`, [ORG]);

  // Enough history for retention to be a number, and gifts inside AND outside
  // the quarter the pack covers, so a wrong window shows up as a wrong total.
  const Y = orgTime.parseCivil(today).y;
  const donors = [];
  for (let i = 1; i <= 26; i++) donors.push(`d_rp3_${String(i).padStart(2, "0")}`);
  for (const [i, id] of donors.entries()) {
    await q(`INSERT INTO donors (id,org_id,name,email,assigned_to,created_at)
             VALUES ($1,$2,$3,$4,$5, NOW() - INTERVAL '1100 days')`,
      [id, ORG, `Patron ${String(i + 1).padStart(2, "0")}`, `patron${i + 1}@rp3.example.org`, i < 4 ? "u_" + ORG : null]);
  }
  let n = 0;
  const gift = async (donor, amount, date, fund = null, extra = {}) => {
    n++;
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,campaign_id,cover_fee_amount)
             VALUES ($1,$2,$3,$4,$5,'cash',$6,$7,$8)`,
      [`g_rp3_${n}`, ORG, donor, amount, date, fund, extra.campaign || null, extra.fee || 0]);
  };
  // Last calendar year and this one, so retention has a cohort.
  for (const [i, id] of donors.entries()) await gift(id, 50 + i * 7.77, `${Y - 1}-02-10`, i % 2 ? "ff_rp3_gen" : null);
  for (const [i, id] of donors.entries()) if (i % 2 === 0) await gift(id, 60 + i * 3.21, `${Y}-01-20`);
  // Inside the quarter the pack covers — with cents, two funds, one campaign.
  const inQ = [lastQ.start, orgTime.addDays(lastQ.start, 20), orgTime.addDays(lastQ.end, -5), lastQ.end];
  for (let i = 0; i < 10; i++) {
    await gift(donors[i], 312.37 + i * 41.19, inQ[i % inQ.length], ["ff_rp3_sch", "ff_rp3_gen", null][i % 3]);
  }
  // The same quarter a year earlier, for the comparison.
  if (prevQ) for (let i = 0; i < 5; i++) await gift(donors[i + 10], 201.11 + i * 13.5, prevQ.from, "ff_rp3_gen");
  // Just OUTSIDE the quarter, both sides: these must not be in the pack.
  await gift(donors[20], 99999.01, orgTime.addDays(lastQ.start, -1));
  await gift(donors[21], 88888.02, orgTime.addDays(lastQ.end, 1));
  // A goal with gifts toward it, and volunteer shifts inside and outside.
  await q(`INSERT INTO campaigns (id,org_id,name,goal_amount,status,start_date,end_date)
           VALUES ('c_rp3',$1,'Studio Roof',40000,'active',$2,$3)`, [ORG, lastQ.start, orgTime.addDays(today, 120)]);
  await gift(donors[3], 2500.55, inQ[1], null, { campaign: "c_rp3", fee: 61.2 });
  let vs = 0;
  const shift = async (donor, hours, date, role) => {
    vs++;
    await q(`INSERT INTO volunteer_shifts (id,org_id,person_id,date,hours,role,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,'u_${ORG}','Pack Admin')`, [`vsh_rp3_${vs}`, ORG, donor, date, hours, role]);
  };
  await shift(donors[0], 6.5, lastQ.start, "Front of house");
  await shift(donors[0], 3.25, orgTime.addDays(lastQ.start, 14), "Front of house");
  await shift(donors[1], 8, orgTime.addDays(lastQ.end, -2), "Set build");
  await shift(donors[2], 12.75, orgTime.addDays(lastQ.start, -3), "Outside the quarter");  // must not count
  await shift(donors[2], 4, orgTime.addDays(lastQ.end, 2), "Outside the quarter");         // must not count
  // Another org's data, to prove the pack never reaches across.
  await q(`INSERT INTO donors (id,org_id,name,created_at) VALUES ('d_rp3_other',$1,'Somebody Else', NOW())`, [ORG2]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ('g_rp3_other',$1,'d_rp3_other',777777,$2,'cash')`, [ORG2, lastQ.start]);

  const tok = await login(EMAIL);
  const tok2 = await login(EMAIL2);

  // ── §1 every figure in the pack foots to its rows, in cents ──
  const packR = await api("GET", "/board-pack?frequency=quarterly", tok);
  ok("§1 the pack is built", packR.status === 200 && Array.isArray(packR.body.sections) && packR.body.sections.length >= 5,
    { status: packR.status, sections: (packR.body.sections || []).length });
  const pack = packR.body;
  ok("§1 the period is the last complete quarter", pack.period.from === lastQ.start && pack.period.to === lastQ.end,
    { got: [pack.period.from, pack.period.to], want: [lastQ.start, lastQ.end] });

  const figs = figuresOf(pack);
  ok("§1 the pack holds figures to check", figs.length >= 8, figs.length);
  let bad = [];
  for (const f of figs) {
    const [good, why] = await foots(tok, f);
    if (!good) bad.push(`${f.where}: ${why}`);
  }
  ok("§1 every figure in the pack foots to its own rows", bad.length === 0, bad.slice(0, 6));

  // The window is really the quarter: the two gifts a day either side are out.
  const givingFig = figs.find(f => f.where === "giving.givingThisPeriod");
  ok("§1 a gift one day outside the period is not in the total",
    givingFig && cents(givingFig.value) < cents(80000), givingFig && givingFig.value);
  const volFig = figs.find(f => f.where === "volunteers.volunteerHours");
  ok("§1 volunteer hours are the shifts inside the period only", volFig && cents(volFig.value) === cents(6.5 + 3.25 + 8),
    volFig && volFig.value);

  // ── §2 every number PRINTED in the PDF is one the live report agrees with ──
  const got = await getPdf(tok, { frequency: "quarterly" });
  ok("§2 the PDF is produced", got.status === 200 && got.buf && got.buf.length > 2000 && got.buf.slice(0, 5).toString() === "%PDF-",
    { status: got.status, bytes: got.buf && got.buf.length });
  const text = pdfText(got.buf);
  const joined = text.join("\n");
  ok("§2 the PDF carries the org name, the period and the day it was produced",
    joined.includes(pack.orgName) && joined.includes(pack.period.label) && joined.includes(pack.producedOnLabel),
    { orgName: joined.includes(pack.orgName), period: joined.includes(pack.period.label) });
  ok("§2 the PDF numbers its pages", /page 1 of \d+/.test(joined), text.filter(t => /page \d/.test(t)).slice(0, 2));

  // THE ONE TEST, stated exactly: each number on the paper, footed to the rows
  // of the live report for the same period and filters.
  //
  // "On the page" is not enough, and finding that out cost a planted defect.
  // With every money figure printed one cent high, only ONE of them was caught
  // — because the right value for the others still appeared elsewhere in the
  // document (the Top gifts total is the same number as giving this period),
  // and `text.includes` cannot tell a number on its own line from the same
  // digits somewhere else. So a figure's value must appear in a run NEXT TO
  // ITS OWN LABEL, which is how pdfkit lays a label and its figure down.
  const near = (label, printed) => {
    for (let i = 0; i < text.length; i++) {
      if (!text[i].includes(label)) continue;
      for (let j = i; j <= Math.min(text.length - 1, i + 3); j++) if (text[j].includes(printed)) return true;
    }
    return false;
  };
  const missing = [], disagreed = [];
  for (const f of figs) {
    const [good, why] = await foots(tok, f);
    if (!good) disagreed.push(`${f.where}: ${why}`);
    if (f.value === null || f.value === undefined) continue;
    const printed = printedOf(f.kind || "money", f.value, f.suffix);
    if (!near(f.label, printed)) missing.push(`${f.where} → ${printed} not beside "${f.label}"`);
  }
  ok("§2 every number the PDF prints sits beside the label it belongs to", missing.length === 0, missing.slice(0, 8));
  ok("§2 every number the PDF prints equals the live report for the same period", disagreed.length === 0, disagreed.slice(0, 6));

  // ── §3 a filtered pack narrows, and says where it cannot ──
  const filtered = await api("GET", `/board-pack?${qs({ frequency: "quarterly", fund: "ff_rp3_sch" })}`, tok);
  ok("§3 a fund-filtered pack is built", filtered.status === 200, filtered.status);
  const fFigs = figuresOf(filtered.body);
  const fGiving = fFigs.find(f => f.where === "giving.givingThisPeriod");
  ok("§3 the fund filter narrows the giving total",
    fGiving && cents(fGiving.value) > 0 && cents(fGiving.value) < cents(givingFig.value),
    { filtered: fGiving && fGiving.value, all: givingFig && givingFig.value });
  let fBad = [];
  for (const f of fFigs) { const [good, why] = await foots(tok, f); if (!good) fBad.push(`${f.where}: ${why}`); }
  ok("§3 every figure in a filtered pack foots to its filtered rows", fBad.length === 0, fBad.slice(0, 6));
  const donorFig = fFigs.find(f => f.where === "people.donorCount");
  ok("§3 a number that cannot be narrowed by fund says so rather than implying it was",
    donorFig && typeof donorFig.note === "string" && /not narrowed by fund/.test(donorFig.note), donorFig && donorFig.note);

  // ── §4 the definitions page defines every number that got printed ──
  const labels = figs.filter(f => f.where.startsWith("giving.") || f.where.startsWith("people.") || f.where.startsWith("volunteers."))
    .map(f => f.label);
  const undefined_ = labels.filter(l => !pack.definitions.some(d => d.label === l));
  ok("§4 every figure on the pack has a definition on the definitions page", undefined_.length === 0, undefined_);
  ok("§4 every definition is a sentence", pack.definitions.every(d => d.definition.length > 25 && /[.!]$/.test(d.definition.trim())),
    pack.definitions.filter(d => !(d.definition.length > 25 && /[.!]$/.test(d.definition.trim()))).map(d => d.label).slice(0, 4));
  ok("§4 the definitions page is printed", joined.includes("What each number means")
    && pack.definitions.every(d => joined.includes(d.definition.slice(0, 40))),
    pack.definitions.filter(d => !joined.includes(d.definition.slice(0, 40))).map(d => d.label).slice(0, 4));

  // ── §5 the schedule ──
  const sch0 = await api("GET", "/board-pack/schedule", tok);
  ok("§5 an org starts with no schedule and the sentence that says so",
    sch0.status === 200 && sch0.body.schedule === null && /off/i.test(sch0.body.offSentence), sch0.body);
  const noAddr = await api("PUT", "/board-pack/schedule", tok, { frequency: "quarterly", dayOfMonth: 5, enabled: true });
  ok("§5 turning it on with nobody to send to is refused, with what to do",
    noAddr.status === 400 && /Settings/.test(noAddr.body.error || ""), noAddr.body);
  const asDonor = await api("PATCH", `/orgs/${ORG}`, tok, { boardPackEmails: ["patron3@rp3.example.org"] });
  ok("§5 a DONOR's address is refused as a board-pack recipient",
    asDonor.status === 400 && /never to a donor/.test(asDonor.body.error || ""), asDonor.body);
  const badAddr = await api("PATCH", `/orgs/${ORG}`, tok, { boardPackEmails: ["not-an-address"] });
  ok("§5 an address that is not one is refused", badAddr.status === 400, badAddr.body);
  const setAddr = await api("PATCH", `/orgs/${ORG}`, tok,
    { boardPackEmails: ["jonathan@stewardapp.dev", "jonathan@stewardapp.dev", " "] });
  ok("§5 the recipient list saves, deduped", setAddr.status === 200, setAddr.body);
  const sch1 = await api("GET", "/board-pack/schedule", tok);
  ok("§5 the saved list comes back once", JSON.stringify(sch1.body.recipients) === JSON.stringify(["jonathan@stewardapp.dev"]),
    sch1.body.recipients);
  const on = await api("PUT", "/board-pack/schedule", tok, { frequency: "quarterly", dayOfMonth: 5, enabled: true });
  ok("§5 the schedule turns on once there is somebody to send it to", on.status === 200 || on.status === 201, on.body);
  const badDay = await api("PUT", "/board-pack/schedule", tok, { frequency: "quarterly", dayOfMonth: 31, enabled: true });
  ok("§5 a day that does not exist in every month is refused", badDay.status === 400, badDay.body);
  const wrongDay = await api("POST", "/board-pack/schedule/run", tok, { today: `${Y}-04-06` });
  ok("§5 nothing goes out on a day that is not the chosen one", wrongDay.body.sent === 0 && wrongDay.body.reason === "not the day", wrongDay.body);
  mails.length = 0;
  const run1 = await api("POST", "/board-pack/schedule/run", tok, { today: `${Y}-04-05` });
  ok("§5 on the day, the pack goes to the org's own list", run1.body.sent === 1, run1.body);
  ok("§5 it went to the listed address and nowhere else",
    mails.length === 1 && mails[0].to === "jonathan@stewardapp.dev", mails.map(m => m.to));
  const att = (mails[0] && mails[0].attachments) || [];
  ok("§5 the email carries the pack as a PDF attachment",
    att.length === 1 && /\.pdf$/.test(att[0].filename) &&
    Buffer.from(att[0].content, "base64").slice(0, 5).toString() === "%PDF-",
    att.map(a => a.filename));
  ok("§5 the attached PDF holds the same giving total the pack reports",
    att.length === 1 && pdfText(Buffer.from(att[0].content, "base64")).some(t => t.includes(printedOf("money", givingFig.value))),
    printedOf("money", givingFig.value));
  const run2 = await api("POST", "/board-pack/schedule/run", tok, { today: `${Y}-04-05` });
  ok("§5 the same period is never sent twice", run2.body.sent === 0 && run2.body.skipped === 1, run2.body);
  const ledger = await q(`SELECT period_key, recipients FROM board_pack_sends WHERE org_id=$1`, [ORG]);
  ok("§5 each send is logged once, with how many it reached",
    ledger.length === 1 && Number(ledger[0].recipients) === 1, ledger);
  const test = await api("POST", "/board-pack/schedule/test", tok, {});
  ok("§5 a test goes to the caller and nobody else", test.status === 200 && test.body.to === EMAIL, test.body);
  const ledger2 = await q(`SELECT count(*)::int AS n FROM board_pack_sends WHERE org_id=$1`, [ORG]);
  ok("§5 a test reserves nothing and logs no send", ledger2[0].n === 1, ledger2);

  // Another org never reaches this one's numbers.
  const theirs = await api("GET", "/board-pack?frequency=quarterly", tok2);
  const theirGiving = figuresOf(theirs.body).find(f => f.where === "giving.givingThisPeriod");
  ok("§5 another org's pack holds only its own money",
    theirs.status === 200 && cents(theirGiving.value) === cents(777777), theirGiving && theirGiving.value);
  const theirSch = await api("GET", "/board-pack/schedule", tok2);
  ok("§5 another org does not see this org's recipients or sends",
    theirSch.body.schedule === null && theirSch.body.recipients.length === 0 && theirSch.body.sends.length === 0, theirSch.body);

  // ── §7 A SAVED DASHBOARD ──
  // The gap that let a real crash through. §1–§6 only ever exercised the
  // DEFAULT pack, whose figures are all plain sums and counts — so nothing
  // here put a tile over a RATIO source, and `sDef.measure(...)` on one (a
  // ratio is computed from its two parts and has no measure function) threw
  // out of the composition and took the whole dashboard down: a blank screen
  // with a 500 behind it, found by opening the seeded dashboard in a browser.
  // All three tile kinds are covered now, and so is one tile failing.
  const made = await api("POST", "/saved-dashboards", tok, {
    name: "The board's questions", shared: true,
    tiles: [{ kind: "figure", source: "gifts", params: {} },
            { kind: "figure", source: "retention", params: {} },       // a RATIO
            { kind: "figure", source: "volunteer-hours", params: {} }, // not money
            { kind: "chart", chart: "givingByMonth" },
            { kind: "list", report: "std:lybunt", limit: 5 },
            { kind: "figure", source: "no-such-source", params: {} }], // and one that cannot be drawn
  });
  ok("§7 a dashboard saves with all three kinds of tile", made.status === 201 && !!made.body.id, made.body);
  const ran = await api("GET", `/saved-dashboards/${made.body.id}/run`, tok);
  ok("§7 it runs, and every tile is accounted for",
    ran.status === 200 && ran.body.sections.length === 6, { status: ran.status, sections: (ran.body.sections || []).length });
  const kinds = (ran.body.sections || []).map(x => x.kind);
  ok("§7 a number, a ratio, a non-money number, a chart and a list all draw",
    kinds.filter(k => k === "figures").length === 3 && kinds.includes("chart") && kinds.includes("report"), kinds);
  ok("§7 one tile that cannot be drawn costs that tile and not the dashboard",
    kinds.filter(k => k === "missing").length === 1 && kinds.length === 6, kinds);
  const ratioTile = (ran.body.sections || []).find(x => x.kind === "figures" && x.figures[0] && x.figures[0].source
    && x.figures[0].source.key === "retention");
  ok("§7 the ratio tile is a percentage, not a sum", ratioTile && ratioTile.figures[0].kind === "percent",
    ratioTile && ratioTile.figures[0].kind);
  const hoursTile = (ran.body.sections || []).find(x => x.kind === "figures" && x.figures[0] && x.figures[0].source
    && x.figures[0].source.key === "volunteer-hours");
  ok("§7 hours are counted in hours, never shown as money", hoursTile && hoursTile.figures[0].kind === "count"
    && hoursTile.figures[0].suffix === "hours", hoursTile && hoursTile.figures[0]);
  let dBad = [];
  for (const sec of (ran.body.sections || [])) {
    if (sec.kind !== "figures") continue;
    for (const f of sec.figures) { const [good, why] = await foots(tok, { ...f, where: sec.key }); if (!good) dBad.push(`${sec.title}: ${why}`); }
  }
  ok("§7 every number on a saved dashboard foots to its own rows", dBad.length === 0, dBad.slice(0, 5));
  ok("§7 every tile carries the definition of what it counted",
    (ran.body.sections || []).every(x => typeof x.definition === "string" ? x.definition.length > 10
      : (x.figures || []).every(f => typeof f.definition === "string" && f.definition.length > 10)),
    (ran.body.sections || []).map(x => x.title));
  // Its PDF is the dashboard's, not the default pack's.
  const dpdf = await getPdf(tok, { dashboard: made.body.id });
  ok("§7 a dashboard's own PDF is produced and titled with its name",
    dpdf.status === 200 && pdfText(dpdf.buf).some(t => t.includes("The board's questions")),
    { status: dpdf.status });
  // Another org cannot open it, shared or not.
  const notYours = await api("GET", `/saved-dashboards/${made.body.id}/run`, tok2);
  ok("§7 another org cannot open this org's dashboard", notYours.status === 404, notYours.status);
  const badTile = await api("POST", "/saved-dashboards", tok, { name: "Bad", tiles: [{ kind: "nonsense" }] });
  ok("§7 a tile kind Steward does not know is refused", badTile.status === 400, badTile.body);
  const noName = await api("POST", "/saved-dashboards", tok, { name: "", tiles: [{ kind: "figure", source: "gifts" }] });
  ok("§7 a dashboard with no name is refused", noName.status === 400, noName.body);

  // ── §6 THE GUARD CAN FAIL ──
  // What would make it fail: a figure a cent off its rows, and a number
  // printed on the paper that is not the number the rows make. Both planted.
  const plantedFig = { where: "planted", label: "Giving this period", kind: "money",
    value: Number(givingFig.value) + 0.01, source: givingFig.source };
  const [plantedGood, plantedWhy] = await foots(tok, plantedFig);
  ok("§6 a figure one cent off its own rows does not foot", plantedGood === false, plantedWhy);
  const printedNow = printedOf("money", givingFig.value);
  const printedOff = printedOf("money", Number(givingFig.value) + 0.01);
  ok("§6 the PDF reader can tell the two apart",
    text.some(t => t.includes(printedNow)) && !text.some(t => t.includes(printedOff)),
    { now: printedNow, off: printedOff });
  // And the reader is really reading the paper: a string that is not on it.
  ok("§6 the PDF reader does not find a number that was never printed",
    !text.some(t => t.includes("$99,999.01")) && !text.some(t => t.includes("$777,777.00")),
    text.filter(t => /99,999|777,777/.test(t)).slice(0, 3));

  await reset();
  await closeDb();
  await new Promise(r => sink.close(r));
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} try { sink.close(); } catch {} process.exit(1); });

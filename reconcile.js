// reconcile.js · RECONCILE-1. AN OLD REPORT, CHECKED AGAINST THE REST OF STEWARD.
//
// REPORTS-5 brings an old system's report in as HISTORICAL TOTALS and, by
// design, never turns them into gifts. This checks those numbers against what
// Steward has for the same period and kind, and says plainly where they agree
// and where they don't:
//
//   · total raised, gift count and donor count for the period (the `gifts` and
//     `givers` sources: the giving summary's own figures)
//   · each fund or campaign the report names (the same sources, narrowed)
//   · each person the report names, against what Steward has from them
//   · a LYBUNT, SYBUNT or retention list against Steward's own list for that
//     year (the `bunt` and `retention-window-kept` sources), person for person
//   · the report's contributions against QuickBooks, when it is connected
//     (`qbo-contributions`: Steward's own record of its reads, never a call)
//
// Every Steward figure in the answer is a source, so it opens its rows. WHY
// two numbers differ is said only when Steward can show it (a fund it has no
// match for, people it has no record of, a gift dated just outside the
// period, a soft credit or matching gift on one side only, a refund, a giving
// source not connected yet); whatever is left is "Steward can't tell why".
//
// It READS. The only write is the stored result (old_report_checks), which a
// re-check replaces. It never creates a gift, a person or a fund.
"use strict";

const { query, run } = require("./db");
const FS = require("./figureSources");
const O = require("./oldReports");

const ACTOR = { id: "system:reconcile", name: "Steward (checking an old report)" };
const NEAR_DAYS = 45;                 // "just outside the period"
const LIST_MAX = 50;                  // names listed per group; the count is always whole
const PROVIDERS = ["paypal", "zeffy", "givebutter", "square", "venmo", "stripe", "benevity"];
const CREDIT_TYPES = ["soft credit", "soft-credit", "soft_credit", "matching gift credit", "matched gift credit"];

// ── small pure helpers ──────────────────────────────────────────────────
const norm = s => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const nameKey = s => norm(s).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const toCents = v => Math.round(Number(v || 0) * 100);
function money(c) {
  const neg = c < 0, a = Math.abs(Math.round(c));
  const s = (a / 100).toLocaleString("en-US", { minimumFractionDigits: a % 100 ? 2 : 0, maximumFractionDigits: 2 });
  return `${neg ? "-" : ""}$${s}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = iso => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
function periodLabel(from, to) {
  if (from.slice(5) === "01-01" && to.slice(5) === "12-31" && from.slice(0, 4) === to.slice(0, 4)) return from.slice(0, 4);
  return `${dayLabel(from)} to ${dayLabel(to)}`;
}
function addDays(iso, n) { return new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10); }
const plural = (n, one, many) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// The columns that say who a row is about, when a report lists people.
function peopleColumns(headers) {
  const find = re => headers.findIndex(h => re.test(norm(h)));
  const name = find(/^(donor name|account name|constituent name|constituent|donor|name|full name|contact name|donor full name)$/);
  const email = find(/e-?mail/);
  const source = find(/^(payment method|payment type|tender type|source|giving source|platform|method)$/);
  return { name, email, source };
}

const KIND_WORDS = { giving_summary: "giving summary", by_fund: "giving by fund report", lybunt: "LYBUNT list", retention: "retention list",
  top_donors: "top donors report", board_report: "board report", grant_report: "grant report", other: "report" };

// Which report kinds can be checked, and against what. Exported so the report
// and the screen say the same thing.
const CHECKABLE = {
  giving_summary: "Total raised, gift and donor counts, and each person or fund it names, against Steward's gifts for the period.",
  by_fund: "Each fund or campaign against the same fund in Steward, and the total against Steward's gifts for the period.",
  board_report: "A board report's total-raised row (with gifts and donors when it has them) against Steward's gifts for each year.",
  lybunt: "The people on a LYBUNT or SYBUNT list against Steward's own list for that year, person for person.",
  retention: "The people on a retention list against the people Steward has giving in both years.",
  top_donors: "Each named donor against what Steward has from them for the period (or lifetime, when the report says lifetime).",
};
const NOT_CHECKABLE = {
  grant_report: "A grant report's numbers are a funder's, not a total Steward keeps, so there is nothing of Steward's to set beside them.",
  other: "Steward does not know what this report's numbers count, so it does not guess at what to compare them with.",
};

// ── reading the report ──────────────────────────────────────────────────
async function loadSheet(orgId, sheetId) {
  const [s] = await query(`SELECT * FROM stored_sheets WHERE id=? AND org_id=? AND kind='old_report' AND removed_at IS NULL`, [sheetId, orgId]);
  if (!s) return null;
  const parse = v => (typeof v === "string" ? JSON.parse(v) : v);
  s.headers = parse(s.headers) || [];
  s.rows = parse(s.rows) || [];
  s.mapping = parse(s.mapping) || null;
  return s;
}

// One row per person on the report: their name, email and amount (cents),
// with each row's fund label and source word kept for the causes.
function reportPeople(sheet) {
  const headers = sheet.headers, rows = sheet.rows;
  const pc = peopleColumns(headers);
  if (pc.name < 0 && pc.email < 0) return null;
  const m = sheet.mapping && !sheet.mapping.wide ? sheet.mapping : O.guessMapping(headers);
  const A = Number.isInteger(m.amount) ? m.amount : -1;
  const L = Number.isInteger(m.label) && m.label !== pc.name ? m.label : -1;
  const out = new Map();
  for (const r of rows) {
    const name = pc.name >= 0 ? String(r[pc.name] ?? "").trim() : "";
    const email = pc.email >= 0 ? norm(r[pc.email]) : "";
    if (!name && !email) continue;
    if (/^(grand\s+)?totals?:?$|^sub-?totals?:?$/i.test(name)) continue;
    const c = A >= 0 ? O.cents(r[A]) : null;
    const key = `${email}|${nameKey(name)}`;
    let p = out.get(key);
    if (!p) { p = { key, name: name || email, email, cents: 0, hasAmount: false, rows: [] }; out.set(key, p); }
    if (c !== null) { p.cents += c; p.hasAmount = true; }
    p.rows.push({ label: L >= 0 ? String(r[L] ?? "").trim() : "", cents: c || 0, source: pc.source >= 0 ? norm(r[pc.source]) : "" });
  }
  return [...out.values()];
}

// Each person on the report, matched to one record in Steward: by email
// first, then by the whole name when exactly one person has it.
// Two records in Steward with the same email AND the same name are one
// person kept twice: both are counted, and each opens its own rows.
async function matchPeople(orgId, people) {
  const donors = await query(`SELECT id, name, LOWER(TRIM(COALESCE(email,''))) AS email FROM donors WHERE org_id=? AND deleted_at IS NULL ORDER BY id`, [orgId]);
  const byEmail = new Map(), byName = new Map();
  for (const d of donors) {
    if (d.email) byEmail.set(d.email, [...(byEmail.get(d.email) || []), d]);
    const k = nameKey(d.name);
    byName.set(k, [...(byName.get(k) || []), d]);
  }
  for (const p of people) {
    const nk = nameKey(p.name);
    let hit = [];
    if (p.email) {
      const list = byEmail.get(p.email) || [];
      hit = list.length === 1 ? list : list.filter(d => nameKey(d.name) === nk);
    }
    if (!hit.length) {
      const list = byName.get(nk) || [];
      hit = list.length === 1 ? list : list.filter(d => d.email && d.email === p.email);
    }
    p.donorIds = hit.map(d => d.id);
    p.donorId = hit.length ? hit[0].id : null;
    p.stewardName = hit.length ? hit[0].name : null;
  }
}

async function fundsAndMaps(orgId) {
  const funds = await query(`SELECT id, name FROM fin_funds WHERE org_id=?`, [orgId]);
  const camps = await query(`SELECT id, name FROM campaigns WHERE org_id=?`, [orgId]);
  const maps = await query(`SELECT label_key, fund_id FROM old_report_fund_maps WHERE org_id=?`, [orgId]);
  const fundById = new Map(funds.map(f => [f.id, f]));
  return {
    funds: funds.map(f => ({ id: f.id, name: f.name })),
    resolve(label) {
      const k = nameKey(label);
      // A line for gifts with no fund named: the `gifts` source's own "Unrestricted".
      if (["unrestricted", "no fund", "none", "undesignated"].includes(k)) return { fund: "none", name: "Unrestricted" };
      const mapped = maps.find(m => m.label_key === k);
      if (mapped && fundById.has(mapped.fund_id)) return { fund: mapped.fund_id, name: fundById.get(mapped.fund_id).name, mapped: true };
      const f = funds.find(x => nameKey(x.name) === k);
      if (f) return { fund: f.id, name: f.name };
      const c = camps.find(x => nameKey(x.name) === k);
      if (c) return { campaign: c.id, name: c.name };
      return null;
    },
  };
}

const val = async (orgId, source) => (await FS.figureValue(orgId, source));
const line = (o) => ({ status: o.steward === null || o.steward === undefined ? "not_checked" : (o.reportCents === o.stewardCents ? "matches" : "differs"), ...o });

// ── THE CHECK ──────────────────────────────────────────────────────────
async function checkSheet(orgId, sheetId) {
  const sheet = await loadSheet(orgId, sheetId);
  if (!sheet) return null;
  const kind = sheet.report_kind || "other";
  const totals = await query(`SELECT * FROM historical_totals WHERE org_id=? AND sheet_id=? ORDER BY period_from, label, id`, [orgId, sheetId]);
  const base = { sheetId, kind, kindWord: KIND_WORDS[kind] || "report", title: sheet.title, fileName: sheet.file_name, system: sheet.source_system };
  if (sheet.scanned) return { ...base, status: "not_checked", sentence: "Steward can't check this report: it is a scan, so it has no numbers to read.", lines: [], causes: [], periods: [] };
  if (NOT_CHECKABLE[kind]) return { ...base, status: "not_checked", sentence: `Steward can't check this report. ${NOT_CHECKABLE[kind]}`, lines: [], causes: [], periods: [] };

  const people = ["lybunt", "retention", "top_donors", "giving_summary", "by_fund", "board_report"].includes(kind) && !(sheet.mapping && sheet.mapping.wide)
    ? reportPeople(sheet) : null;
  if (people) await matchPeople(orgId, people);

  // The periods the report speaks for: its totals' periods, else the file's.
  const periods = [];
  for (const t of totals) if (!periods.some(p => p.from === t.period_from && p.to === t.period_to)) periods.push({ from: t.period_from, to: t.period_to });
  if (!periods.length && sheet.period_from && sheet.period_to) periods.push({ from: sheet.period_from, to: sheet.period_to });
  if (!periods.length) return { ...base, status: "not_checked", sentence: "Steward can't check this report: it has no period, so there is no stretch of Steward's gifts to set beside it. Say which period it covers and import it again.", lines: [], causes: [], periods: [] };

  if (kind === "lybunt" || kind === "retention") return { ...base, ...(await checkList(orgId, sheet, kind, periods[0], people || [])) };

  const giving = totals.filter(t => t.counts_as_giving);
  const fm = await fundsAndMaps(orgId);
  const out = { ...base, lines: [], causes: [], people: null, periods: [], funds: fm.funds };
  const [qbo] = await query(`SELECT id FROM bookkeeping_connections WHERE org_id=? AND vendor='quickbooks' AND status <> 'disconnected' LIMIT 1`, [orgId]);

  for (const per of periods) {
    const pl = periodLabel(per.from, per.to);
    const inP = giving.filter(t => t.period_from === per.from && t.period_to === per.to);
    const P = { from: per.from, to: per.to };
    const lines = [];
    let reportTotal = null, stewardTotal = null;
    if (inP.length || (kind === "top_donors" && people)) {
      // TOTAL RAISED
      if (inP.length) {
        reportTotal = inP.reduce((s, t) => s + toCents(t.amount), 0);
        const src = { key: "gifts", params: P };
        const f = await val(orgId, src);
        stewardTotal = f.cents;
        // The imports that brought Steward's gifts for the period, to open.
        const imports = reportTotal === f.cents ? [] : (await query(
          `SELECT g.import_id AS id, COALESCE(MAX(i.name), g.import_id) AS name, COUNT(*)::int AS n, COALESCE(SUM(g.amount),0)::text AS s
             FROM gifts g LEFT JOIN imports i ON i.id = g.import_id AND i.org_id = g.org_id
            WHERE g.org_id=? AND g.date >= ? AND g.date <= ? AND g.import_id IS NOT NULL
            GROUP BY g.import_id ORDER BY COUNT(*) DESC LIMIT 5`, [orgId, P.from, P.to])).map(r => ({ id: r.id, name: r.name, gifts: r.n, cents: toCents(r.s) }));
        lines.push(line({ key: "total", label: `Total raised, ${pl}`, kind: "money", reportCents: reportTotal, stewardCents: f.cents, steward: f.value, source: src,
          ...(imports.length ? { imports, action: { kind: "open_import" } } : {}) }));
        // GIFT COUNT, when every line of the report gives one
        if (inP.every(t => t.gift_count !== null && t.gift_count !== undefined)) {
          const rep = inP.reduce((s, t) => s + Number(t.gift_count), 0);
          const cs = { key: "gifts", params: { ...P, measure: "count" } };
          const g = await val(orgId, cs);
          lines.push(line({ key: "gifts", label: `Gifts, ${pl}`, kind: "count", reportCents: rep, stewardCents: g.value, steward: g.value, source: cs }));
        }
      }
      // DONOR COUNT: the people it names, or a single line's own count
      const repDonors = people && people.length ? people.length : (inP.length === 1 && inP[0].donor_count !== null && inP[0].donor_count !== undefined ? Number(inP[0].donor_count) : null);
      if (repDonors !== null && kind !== "top_donors") {
        const ds = { key: "givers", params: P };
        const d = await val(orgId, ds);
        lines.push(line({ key: "donors", label: `Donors, ${pl}`, kind: "count", reportCents: repDonors, stewardCents: d.value, steward: d.value, source: ds }));
      }
      // BY FUND OR CAMPAIGN, when the report's lines are named
      const labelled = inP.filter(t => t.label);
      const byLabel = new Map();
      for (const t of labelled) { const k = nameKey(t.label); const x = byLabel.get(k) || { label: t.label, cents: 0 }; x.cents += toCents(t.amount); byLabel.set(k, x); }
      const isFundReport = kind === "by_fund" || (byLabel.size > 1 && kind !== "board_report");
      const unmapped = [];
      if (isFundReport) {
        for (const x of byLabel.values()) {
          const r = fm.resolve(x.label);
          if (!r) {
            unmapped.push(x);
            lines.push({ key: "fund:" + nameKey(x.label), label: x.label, kind: "money", reportCents: x.cents, stewardCents: null, steward: null, status: "differs",
              note: "Steward has no fund or campaign by this name.", action: { kind: "map_fund", label: x.label } });
            continue;
          }
          const src = { key: "gifts", params: { ...P, ...(r.fund ? { fund: r.fund } : { campaign: r.campaign }) } };
          const f = await val(orgId, src);
          lines.push(line({ key: "fund:" + nameKey(x.label), label: x.label, kind: "money", reportCents: x.cents, stewardCents: f.cents, steward: f.value, source: src,
            note: r.mapped ? `Mapped to your fund ${r.name}.` : (nameKey(r.name) === nameKey(x.label) ? null : `Steward's ${r.name}.`) }));
        }
      }
      // FINANCE: the report's contributions against QuickBooks
      if (reportTotal !== null) {
        if (!qbo) lines.push({ key: "quickbooks", label: `QuickBooks, ${pl}`, kind: "money", reportCents: reportTotal, stewardCents: null, steward: null, status: "not_checked",
          note: "QuickBooks is not connected, so the books could not be checked.", action: { kind: "connect_quickbooks" } });
        else {
          const qs = { key: "qbo-contributions", params: P };
          const qf = await FS.figureValue(orgId, qs);
          if (!qf.totalRows) lines.push({ key: "quickbooks", label: `QuickBooks, ${pl}`, kind: "money", reportCents: reportTotal, stewardCents: null, steward: null, status: "not_checked",
            note: "Steward has not read QuickBooks for this period yet. A read from Finance brings it in." });
          else lines.push(line({ key: "quickbooks", label: `QuickBooks, ${pl}`, kind: "money", reportCents: reportTotal, stewardCents: qf.cents, steward: qf.value, source: qs,
            note: "Contributions in your books, from Steward's reads of QuickBooks." }));
        }
      }
      // PEOPLE, each against what Steward has from them
      let peopleOut = null;
      if (people && people.some(p => p.hasAmount)) peopleOut = await checkPeople(orgId, sheet, kind, P, people, unmapped);
      if (peopleOut) {
        // Said in words under the table, not as a line: "found in Steward" is
        // a match, not a figure with rows of its own.
        peopleOut.note = `The report names ${plural(peopleOut.total, "person", "people")}: ` + (`${plural(peopleOut.matched, "person", "people")} found in Steward, ${plural(peopleOut.same, "matches", "match")} to the cent`
            + (peopleOut.differing.some(x => x.onlyByFund) ? `; ${plural(peopleOut.differing.filter(x => x.onlyByFund).length, "differs", "differ")} only by gifts to a fund Steward has no match for.` : "."));
        out.people = peopleOut;
      }
      out.lines.push(...lines);
      // WHY, for the total
      if (reportTotal !== null && reportTotal !== stewardTotal) {
        const causes = await whyDiffer(orgId, { P, pl, reportTotal, stewardTotal, people: peopleOut, unmapped, sheet });
        out.causes.push(...causes);
      }
      out.periods.push({ from: per.from, to: per.to, label: pl, reportCents: reportTotal, stewardCents: stewardTotal });
    }
  }

  if (!out.lines.length) return { ...out, status: "not_checked", sentence: "Steward can't check this report: no amount on it stands for what was raised. Import it again and say which column holds the amount." };
  const differs = out.lines.filter(l => l.status === "differs");
  out.status = differs.length ? "differs" : "matches";
  // THE SENTENCE: the first period that differs, else the first.
  const p = out.periods.find(x => x.reportCents !== null && x.reportCents !== x.stewardCents) || out.periods[0];
  const your = `Your ${p.label} ${out.kindWord}`;
  if (!differs.length) out.sentence = "Matches Steward to the cent.";
  else if (p.reportCents === null) out.sentence = `${your} names ${plural(out.people ? out.people.total : 0, "person", "people")}; ${plural(differs.length, "line differs", "lines differ")} from Steward.`;
  else if (p.reportCents === p.stewardCents) out.sentence = `${your} says ${money(p.reportCents)}, the same as Steward to the cent. ${plural(differs.length, "other line differs", "other lines differ")}.`;
  else if (p.reportCents > p.stewardCents) out.sentence = `${your} says ${money(p.reportCents)}. Steward has ${money(p.stewardCents)} for ${p.label}. ${money(p.reportCents - p.stewardCents)} is missing.`;
  else out.sentence = `${your} says ${money(p.reportCents)}. Steward has ${money(p.stewardCents)} for ${p.label}, ${money(p.stewardCents - p.reportCents)} more than the report.`;
  return out;
}

// Each named person against Steward's gifts from them in the period (or
// lifetime, when the report's amount says lifetime). Rows in a fund Steward
// has no match for are set aside here: that cause is the fund's.
async function checkPeople(orgId, sheet, kind, P, people, unmapped) {
  const amountHeader = (() => { const m = sheet.mapping && !sheet.mapping.wide ? sheet.mapping : O.guessMapping(sheet.headers); return norm(sheet.headers[m.amount] || ""); })();
  const lifetime = kind === "top_donors" && /lifetime|all.time/.test(amountHeader);
  const span = lifetime ? { from: "1900-01-01", to: "2999-12-31" } : P;
  const unm = new Set(unmapped.map(x => nameKey(x.label)));
  const ids = people.flatMap(p => p.donorIds || []);
  const sums = ids.length ? await query(`SELECT donor_id, COALESCE(SUM(amount),0)::text AS s FROM gifts WHERE org_id=? AND donor_id = ANY(?) AND date >= ? AND date <= ? GROUP BY donor_id`,
    [orgId, ids, span.from, span.to]) : [];
  const by = new Map(sums.map(r => [r.donor_id, toCents(r.s)]));
  const res = { total: people.length, matched: 0, same: 0, lifetime, differing: [], missing: [], missingCents: 0, rest: [] };
  for (const p of people) {
    if (!p.donorId) { res.missing.push({ name: p.name, email: p.email, cents: p.cents }); res.missingCents += p.cents; continue; }
    res.matched++;
    const inFunds = p.rows.filter(r => !unm.has(nameKey(r.label))).reduce((s, r) => s + r.cents, 0);
    const st = p.donorIds.reduce((s, id) => s + (by.get(id) || 0), 0);
    if (p.cents === st) { res.same++; continue; }
    res.differing.push({ name: p.stewardName || p.name, email: p.email, donorId: p.donorId, reportCents: p.cents, stewardCents: st, mappedCents: inFunds,
      onlyByFund: inFunds === st,
      records: p.donorIds.map(id => ({ donorId: id, cents: by.get(id) || 0, source: { key: "gifts", params: { ...span, donor: id } } })),
      source: { key: "gifts", params: { ...span, donor: p.donorId } }, rows: p.rows });
  }
  res.differing.sort((a, b) => Math.abs(b.reportCents - b.stewardCents) - Math.abs(a.reportCents - a.stewardCents));
  return res;
}

// ── WHY THEY DIFFER, ONLY WHEN STEWARD CAN SHOW IT ─────────────────────
async function whyDiffer(orgId, { P, pl, reportTotal, stewardTotal, people, unmapped, sheet }) {
  const D = reportTotal - stewardTotal;           // above zero: the report has more
  const causes = [];
  let explained = 0;
  const missingKeys = new Set();
  // 1. People on the report Steward has no record of.
  if (people && people.missing.length) {
    const c = people.missing.reduce((s, m) => s + m.cents, 0);
    for (const m of people.missing) missingKeys.add(`${m.email}|${nameKey(m.name)}`);
    causes.push({ key: "missing_people", cents: c, sentence: `${plural(people.missing.length, "person", "people")} on the report ${people.missing.length === 1 ? "is" : "are"} not in Steward at all: ${money(c)} of what the report counts.`,
      people: people.missing.slice(0, LIST_MAX), action: { kind: "add_person" } });
    explained += c;
  }
  // 2. A fund the report has that Steward doesn't (less any of its rows from
  //    people already counted above, so no dollar is explained twice).
  for (const u of unmapped) {
    let c = u.cents;
    if (people) {
      const sheetPeople = reportPeople(sheet) || [];
      c = u.cents - sheetPeople.filter(p => missingKeys.has(p.key)).reduce((s, p) => s + p.rows.filter(r => nameKey(r.label) === nameKey(u.label)).reduce((a, r) => a + r.cents, 0), 0);
    }
    if (!c) continue;
    causes.push({ key: "unmapped_fund", cents: c, label: u.label, sentence: `The report has a fund Steward doesn't: ${u.label}, ${money(c)}.${people ? " Those gifts are not in Steward under any fund." : ""}`,
      action: { kind: "map_fund", label: u.label } });
    explained += c;
  }
  // 3. Person by person: a gift dated just outside the period, a soft credit
  //    the report counts, a refund Steward subtracts.
  if (people) {
    const near = { out: [], soft: [], refund: [], none: [] };
    for (const p of people.differing) {
      const d = p.mappedCents - p.stewardCents;
      if (!d) continue;
      if (p.records.length > 1) continue;
      const rows = await query(
        `SELECT id, date, amount::text AS amount FROM gifts WHERE org_id=? AND donor_id=?
           AND ((date >= ? AND date < ?) OR (date > ? AND date <= ?))`,
        [orgId, p.donorId, addDays(P.from, -NEAR_DAYS), P.from, P.to, addDays(P.to, NEAR_DAYS)]);
      const outC = rows.reduce((s, g) => s + toCents(g.amount), 0);
      const one = rows.find(g => toCents(g.amount) === d);
      if (d > 0 && (outC === d || one)) {
        const g = one || rows[0];
        near.out.push({ name: p.name, donorId: p.donorId, cents: d, date: String(g.date).slice(0, 10) });
        continue;
      }
      if (d > 0 && p.stewardCents === 0) { near.none.push({ name: p.name, donorId: p.donorId, cents: d }); continue; }
      if (d > 0) {
        const [sc] = await query(`SELECT COALESCE(SUM(s.amount),0)::text AS s FROM gift_soft_credits s JOIN gifts g ON g.id = s.gift_id AND g.org_id = s.org_id
                                   WHERE s.org_id=? AND s.donor_id=? AND g.date >= ? AND g.date <= ?`, [orgId, p.donorId, P.from, P.to]);
        if (toCents(sc.s) === d) { near.soft.push({ name: p.name, donorId: p.donorId, cents: d }); continue; }
        const [rf] = await query(`SELECT COALESCE(SUM(amount),0)::text AS s FROM gifts WHERE org_id=? AND donor_id=? AND amount < 0 AND date >= ? AND date <= ?`, [orgId, p.donorId, P.from, P.to]);
        if (-toCents(rf.s) === d) { near.refund.push({ name: p.name, donorId: p.donorId, cents: d }); continue; }
      }
    }
    const sum = xs => xs.reduce((s, x) => s + x.cents, 0);
    if (near.out.length) { const c = sum(near.out); explained += c; causes.push({ key: "outside_period", cents: c, people: near.out,
      sentence: `${plural(near.out.length, "gift", "gifts")} in Steward ${near.out.length === 1 ? "is" : "are"} dated just outside ${pl}, within ${NEAR_DAYS} days of its edge: ${money(c)}.` }); }
    if (near.none.length) { const c = sum(near.none); explained += c; causes.push({ key: "no_gifts_in_steward", cents: c, people: near.none,
      sentence: `${plural(near.none.length, "person is", "people are")} in Steward with no gifts there for ${pl}: ${money(c)} the report counts from them never came over.` }); }
    if (near.soft.length) { const c = sum(near.soft); explained += c; causes.push({ key: "soft_credit", cents: c, people: near.soft,
      sentence: `The report counts ${money(c)} of soft credits as these people's giving. Steward counts a gift once, for the person who gave it.` }); }
    if (near.refund.length) { const c = sum(near.refund); explained += c; causes.push({ key: "refund", cents: c, people: near.refund,
      sentence: `Steward subtracts ${money(c)} of refunds the report does not.` }); }
  }
  // 4. Across the whole period: matching gifts and credit records Steward
  //    counts, refunds it subtracts, when one of them is exactly what is left.
  const left = D - explained;
  if (left) {
    const [m] = await query(`SELECT COALESCE(SUM(amount) FILTER (WHERE match_employer_id IS NOT NULL OR LOWER(COALESCE(type,'')) = ANY(?::text[])),0)::text AS credit,
                                    COALESCE(SUM(amount) FILTER (WHERE amount < 0),0)::text AS refunds
                               FROM gifts WHERE org_id=? AND date >= ? AND date <= ?`, [CREDIT_TYPES, orgId, P.from, P.to]);
    const credit = toCents(m.credit), refunds = toCents(m.refunds);
    if (credit && -left === credit) { explained += left; causes.push({ key: "matching", cents: credit, source: { key: "gifts", params: { ...P } },
      sentence: `Steward counts ${money(credit)} of matching gifts and credit records in ${pl}; the report leaves them out.` }); }
    else if (refunds && left === -refunds) { explained += left; causes.push({ key: "refund", cents: -refunds,
      sentence: `Steward subtracts ${money(-refunds)} of refunds in ${pl}; the report does not.` }); }
  }
  // 5. Gifts from a giving source that is not connected yet.
  if (D - explained > 0 && people) {
    const conn = new Set((await query(`SELECT LOWER(provider) AS p FROM giving_sources WHERE org_id=? AND status <> 'disconnected'`, [orgId])).map(r => r.p));
    const bySrc = new Map();
    for (const p of reportPeople(sheet) || []) {
      if (missingKeys.has(p.key)) continue;
      for (const r of p.rows) {
        const prov = PROVIDERS.find(x => r.source.includes(x));
        if (!prov || conn.has(prov) || unmapped.some(u => nameKey(u.label) === nameKey(r.label))) continue;
        bySrc.set(prov, (bySrc.get(prov) || 0) + r.cents);
      }
    }
    for (const [prov, c] of bySrc) {
      const [has] = await query(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=? AND date >= ? AND date <= ? AND LOWER(COALESCE(payment_method,'')) LIKE ?`, [orgId, P.from, P.to, `%${prov}%`]);
      if (has.n || !c || c > D - explained) continue;
      explained += c;
      const name = prov[0].toUpperCase() + prov.slice(1);
      causes.push({ key: "source_not_connected", cents: c, provider: prov, action: { kind: "connect_source", provider: prov },
        sentence: `The report has ${money(c)} paid through ${name}, which is not connected to Steward, and Steward has no ${name} gifts in ${pl}.` });
    }
  }
  const rest = D - explained;
  if (rest) causes.push({ key: "cannot_tell", cents: rest,
    sentence: causes.length
      ? `Steward can't tell why for the other ${money(Math.abs(rest))}; these are the rows on each side.`
      : "Steward can't tell why; these are the rows on each side.",
    report: { key: "historical-totals", params: { from: "1900-01-01", to: "2999-12-31", sheet: sheet.id } }, reportCents: reportTotal,
    steward: { key: "gifts", params: P }, stewardCents: stewardTotal });
  else if (causes.length > 1) causes.push({ key: "all_explained", cents: 0, sentence: `Together these account for all ${money(Math.abs(D))}.` });
  return causes;
}

// ── A LIST OF PEOPLE, AGAINST STEWARD'S OWN LIST ────────────────────────
async function checkList(orgId, sheet, kind, per, people) {
  const y = Number(per.to.slice(0, 4));
  const cur = { from: `${y}-01-01`, to: `${y}-12-31` }, prev = { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  const sybunt = /sybunt/i.test(`${sheet.title} ${sheet.file_name} ${sheet.headers.join(" ")}`);
  const src = kind === "retention"
    ? { key: "retention-window-kept", params: { from1: prev.from, to1: prev.to, from0: cur.from, to0: cur.to } }
    : { key: "bunt", params: { kind: sybunt ? "sybunt" : "lybunt", from: cur.from, to: cur.to, prevFrom: prev.from, prevTo: prev.to } };
  const listWord = kind === "retention" ? "retention list" : `${sybunt ? "SYBUNT" : "LYBUNT"} list`;
  const rows = await FS.allRows(orgId, src);
  const theirs = new Set(rows.map(r => r.donorId));
  const ours = new Set(people.flatMap(p => p.donorIds || []));
  const onTheirs = p => (p.donorIds || []).some(id => theirs.has(id));
  const both = people.filter(onTheirs);
  const onlyReport = people.filter(p => !onTheirs(p));
  const onlySteward = rows.filter(r => !ours.has(r.donorId));
  // For each one only on the report: what Steward shows about them.
  const reasons = [];
  for (const p of onlyReport) {
    if (!p.donorId) { reasons.push({ name: p.name, email: p.email, missing: true, why: "Not in Steward at all.", action: { kind: "add_person" } }); continue; }
    const [g] = await query(`SELECT COALESCE(SUM(amount) FILTER (WHERE date >= ? AND date <= ?),0)::text AS cur,
                                    COALESCE(SUM(amount) FILTER (WHERE date >= ? AND date <= ?),0)::text AS prev,
                                    COALESCE(SUM(amount) FILTER (WHERE date < ?),0)::text AS before
                               FROM gifts WHERE org_id=? AND donor_id=?`, [cur.from, cur.to, prev.from, prev.to, cur.from, orgId, p.donorId]);
    const why = toCents(g.cur) > 0 && kind !== "retention" ? `Steward has ${money(toCents(g.cur))} from them in ${y}, so they are not on Steward's list.`
      : kind === "retention" && !toCents(g.prev) ? `Steward has no gift from them in ${y - 1}.`
      : kind === "retention" && !toCents(g.cur) ? `Steward has no gift from them in ${y}.`
      : !sybunt && !toCents(g.prev) ? `Steward has no gift from them in ${y - 1}.`
      : sybunt && !toCents(g.before) ? `Steward has no gift from them before ${y}.` : "Steward can't tell why.";
    reasons.push({ name: p.stewardName || p.name, email: p.email, donorId: p.donorId, why, source: { key: "gifts", params: { from: prev.from, to: cur.to, donor: p.donorId } } });
  }
  const f = await FS.figureValue(orgId, src);
  const lines = [
    line({ key: "list", label: `People on the ${listWord}, ${y}`, kind: "count", reportCents: people.length, stewardCents: f.value, steward: f.value, source: src }),
    { key: "both", label: "On both lists", kind: "count", reportCents: both.length, stewardCents: both.length, steward: both.length, status: both.length === people.length && both.length === rows.length ? "matches" : "differs",
      note: `${plural(onlyReport.length, "person is", "people are")} only on the report; ${plural(onlySteward.length, "person is", "people are")} only on Steward's list.` },
  ];
  const matches = !onlyReport.length && !onlySteward.length;
  return {
    status: matches ? "matches" : "differs",
    sentence: matches ? `Matches Steward's own ${listWord} for ${y}, person for person.`
      : `Your ${y} ${listWord} names ${plural(people.length, "person", "people")}. Steward's own list for ${y} has ${f.value.toLocaleString("en-US")}, and ${both.length.toLocaleString("en-US")} ${both.length === 1 ? "is" : "are"} on both.`,
    lines, periods: [{ from: cur.from, to: cur.to, label: String(y) }],
    list: { onlyReport: reasons.slice(0, LIST_MAX), onlyReportCount: reasons.length,
      onlySteward: onlySteward.slice(0, LIST_MAX).map(r => ({ name: r.name, donorId: r.donorId, cents: toCents(r.amount) })), onlyStewardCount: onlySteward.length,
      missingCount: reasons.filter(r => r.missing).length },
    causes: reasons.some(r => r.missing) ? [{ key: "missing_people", cents: 0, sentence: `${plural(reasons.filter(r => r.missing).length, "person", "people")} on the report ${reasons.filter(r => r.missing).length === 1 ? "is" : "are"} not in Steward at all.`,
      people: reasons.filter(r => r.missing).slice(0, LIST_MAX), action: { kind: "add_person" } }] : [],
  };
}

// ── STORED, AND RE-RUN ─────────────────────────────────────────────────
async function checkAndStore(orgId, sheetId, who = ACTOR) {
  const result = await checkSheet(orgId, sheetId);
  if (!result) return null;
  const [row] = await query(
    `INSERT INTO old_report_checks (sheet_id, org_id, result, checked_at, created_by, created_by_name) VALUES (?,?,?::jsonb,NOW(),?,?)
     ON CONFLICT (sheet_id) DO UPDATE SET result = EXCLUDED.result, checked_at = NOW(), created_by = EXCLUDED.created_by, created_by_name = EXCLUDED.created_by_name
     RETURNING checked_at`, [sheetId, orgId, JSON.stringify(result), who.id, who.name]);
  return { ...result, checkedAt: row.checked_at };
}
async function stored(orgId, sheetId) {
  const [r] = await query(`SELECT result, checked_at FROM old_report_checks WHERE org_id=? AND sheet_id=?`, [orgId, sheetId]);
  if (!r) return null;
  const res = typeof r.result === "string" ? JSON.parse(r.result) : r.result;
  return { ...res, checkedAt: r.checked_at };
}
// Every checked report of the org, again. Called (through scheduleRecheck)
// by the after-change step whenever a door writes gifts.
async function recheckOrg(orgId) {
  const rows = await query(`SELECT c.sheet_id FROM old_report_checks c JOIN stored_sheets s ON s.id = c.sheet_id AND s.org_id = c.org_id
                             WHERE c.org_id=? AND s.removed_at IS NULL`, [orgId]);
  for (const r of rows) await checkAndStore(orgId, r.sheet_id).catch(e => console.error("[reconcile] recheck", r.sheet_id, e.message));
  return rows.length;
}
const RECHECK_MS = Number(process.env.RECONCILE_RECHECK_MS || 500);
const pendingOrgs = new Map();
function scheduleRecheck(orgId) {
  if (!orgId || pendingOrgs.has(orgId)) return;
  const t = setTimeout(() => { pendingOrgs.delete(orgId); recheckOrg(orgId).catch(e => console.error("[reconcile]", e.message)); }, RECHECK_MS);
  if (t.unref) t.unref();
  pendingOrgs.set(orgId, t);
}

module.exports = { ACTOR, CHECKABLE, NOT_CHECKABLE, checkSheet, checkAndStore, stored, recheckOrg, scheduleRecheck, reportPeople, peopleColumns, nameKey, money, periodLabel };

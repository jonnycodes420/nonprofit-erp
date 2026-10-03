// CONTENT-1 · the free tools, moved out of resources.jsx so each one can be
// a full landing page: what it answers, the tool above the fold, how it works
// and a short FAQ. Everything is computed in the browser; nothing on these
// pages sends anything anywhere.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import Papa from "papaparse";
import { Hero, Cards, Steps, FaqS, FinalCta, StatBand, Pill, A } from "../lib";
import { SRC, SRC_ALL } from "../data/research";
import PRICING from "../../../../pricing.json";
import { RETENTION_GAP } from "../../../../shared/sources.js";
import { SkeletonCards } from "../../components/Skeleton";

// FIX-13 · the page runs the audit. It used to promise "run the free audit"
// and "drop it in" with nothing to drop a file on: the working audit lived
// only at /lost-and-found. Now this page renders that same component, so the
// drop zone and the Run the free audit button sit in the hero, and every
// Lost & Found link on the site (menu, tools, feature finder) lands on a page
// that can run it. Book a demo and Start free stay below the result.
// Lazy, so the audit's code loads only for the people who come here.
const LostAndFoundAudit = React.lazy(() => import("../../pages/LostAndFound").then(m => ({ default: m.LostAndFoundAudit })));

// ── Shared pieces ──────────────────────────────────────────────────────────
// A line of glossary links under the FAQ: [slug, label] pairs.
function GlossLine({ list }) {
  return (
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <p className="gloss-line"><span>In the glossary:</span>{list.map(g => <A key={g[0]} href={"/glossary/" + g[0]}>{g[1]}</A>)}</p>
    </div></section>
  );
}

// ── FREE TOOLS ─────────────────────────────────────────────────────────────
// Ported as they work in the reference. Everything is computed in the
// browser; nothing on these pages sends anything anywhere.
export function Tools() {
  return <>
    <Hero eyebrow="Free tools" crumbs={[["Resources", "/resources"], ["Free tools"]]} h="Free tools, <b>no signup.</b>" lede="Run them on your own numbers. Nothing you type leaves your browser." noCta />
    <Cards list={[
      ["/tools/lost-and-found", "Lost & Found donor audit", "See who you are about to lose from your own giving export.", "drift"],
      ["/tools/lybunt-sybunt", "LYBUNT and SYBUNT finder", "Drop in a CSV of gifts and get both lists, ready to download.", "search"],
      ["/tools/thank-you-letter", "Thank-you letter builder", "A warm, short letter for the gift in front of you, ready to copy.", "heart"],
      ["/tools/retention", "Keep Rate calculator", "Your retention rate, and what a few points are worth.", "reports"],
      ["/tools/lapsed-cost", "Lapse Ledger", "What last year's lapsed donors used to give.", "finance"],
      ["/tools/thermometer", "Goal Gauge", "See how full your campaign goal bar is.", "events"],
    ]} />
    <FinalCta />
  </>;
}

export function ToolLostAndFound() {
  return <>
    <Hero eyebrow="Lost & Found · free tool" crumbs={[["Free tools", "/tools"], ["Lost & Found"]]} h="See who you're <b>about to lose.</b>"
      lede="Drop in a giving export and see your lapsing donors and what they used to give, free and with no signup."
      noCta>
      <React.Suspense fallback={<div className="lf-loading" style={{ minHeight: 220 }}><SkeletonCards count={3} label="Loading the audit" /></div>}>
        <div data-lf-audit><LostAndFoundAudit compact /></div>
      </React.Suspense>
      <div className="ctas" style={{ marginTop: 34 }} data-lf-ctas>
        <Pill href="/demo">Book a demo</Pill>
        <Pill kind="soft" href="/signup">Start free</Pill>
      </div>
    </Hero>
    <Steps eb="How it works" h="A minute, <b>start to finish.</b>" list={[["Export your gifts", "Any spreadsheet with donor, date and amount."], ["Drop it in", "The audit reads it in your browser. Nothing is uploaded."], ["See who is slipping", "Lapsing donors ranked by what they used to give."]]} />
    <FaqS items={[
      ["Is my donor file uploaded?", "No. The file is read in your browser and the audit runs there. Two things can reach us, and only if you choose them: the name, email and organization you type to download the PDF, and, if you tick the box, four anonymous totals for the benchmark."],
      ["What file does it take?", "A CSV or Excel export (.csv, .xlsx or .xls) with one gift per row: who gave, when, and how much. Most donor systems and giving platforms can make one."],
      ["What counts as slipping?", "Donors who gave in an earlier year and not this one, donors whose giving fell well below the year before, and monthly gifts that have missed three of their own months in a row."],
      ["Do I need an account?", "No. The results are free and complete without one. The email form is only for the PDF copy."],
    ]} />
    <StatBand n={4} />
    <GlossLine list={[["lapsed-donor", "Lapsed donor"], ["donor-lapse", "Donor lapse"], ["drift", "Drift"]]} />
    <FinalCta />
  </>;
}

const num = v => +v || 0;
const usd = x => "$" + Math.round(x).toLocaleString();
function useFields(init) {
  const [v, setV] = useState(init);
  return [v, k => e => setV({ ...v, [k]: e.target.value })];
}

export function retentionMath(a, b, c) {
  const r = a ? b / a * 100 : 0;
  return { rate: r.toFixed(1) + "%", lift: usd(a * 0.05 * c), more: Math.round(a * 0.05) };
}
export function lapsedMath(a, b, c) {
  return { lost: usd(a * b), back: usd(a * b * c / 100) };
}
export function thermometerMath(g, r) {
  const p = g ? Math.min(100, r / g * 100) : 0;
  return { pct: p, raised: usd(r), goal: usd(g) };
}

// PROOF-2 · the retention gap on her own numbers: donors kept at each rate,
// what the difference gives in a year, and a year of the Steward plan her
// donor count lands on, from pricing.json. It says "less" when it is less.
export function gapMath(donors, gift, hi, lo) {
  const keptHi = Math.round(donors * hi / 100), keptLo = Math.round(donors * lo / 100);
  const more = keptHi - keptLo, worth = more * gift;
  const tier = PRICING.tiers.find(t => donors <= t.maxDonors) || null;
  const plan = tier ? tier.monthlyUsd * 12 : null;
  return { keptHi, keptLo, more, worth: usd(worth), tier, plan: plan == null ? null : usd(plan), beats: plan == null ? null : worth > plan };
}

function GapPanel({ hi, lo }) {
  const [v, on] = useFields({ d: "500", g: "250" });
  const m = gapMath(num(v.d), num(v.g), hi, lo);
  const src = SRC_ALL[RETENTION_GAP.source];
  return <section style={{ paddingTop: 0 }} data-testid="gap-panel"><div className="wrap">
    <div className="eyebrow">The retention gap</div>
    <h2 className="mix h-m" style={{ marginTop: 16, marginBottom: 28 }}>{hi}% with a strategy, {lo}% without. <b>On your donors.</b></h2>
    <div className="tool">
      <div className="form">
        <label>Donors last year<input type="number" min="1" value={v.d} onChange={on("d")} autoFocus /></label>
        <label>Average yearly gift ($)<input type="number" min="0" value={v.g} onChange={on("g")} /></label>
      </div>
      <div className="out" aria-live="polite">
        <div className="big">{m.more.toLocaleString()}</div><p>more donors giving again: {m.keptHi.toLocaleString()} at {hi}% against {m.keptLo.toLocaleString()} at {lo}%</p>
        <div className="big sm">{m.worth}</div><p>a year from those donors at your average gift</p>
        <p style={{ marginTop: 22 }}>{m.tier
          ? <>A year of Steward on {m.tier.name}, month to month, is {m.plan}. The gap is worth {m.beats ? "more" : "less"} than that.</>
          : <>Above {PRICING.tiers[PRICING.tiers.length - 1].maxDonors.toLocaleString()} donors, Steward is priced with you.</>}</p>
      </div>
    </div>
    <p className="srcnote">The two rates: <A href={src[1]}>{src[0]}</A>. Organizations with a donor retention strategy reported {hi}% retention; those without one reported {lo}%. A survey shows what respondents reported, not what any one organization will see.</p>
  </div></section>;
}

export function ToolRetention() {
  const [v, on] = useFields({ a: "1000", b: "420", c: "250" });
  const m = retentionMath(num(v.a), num(v.b), num(v.c));
  const q = new URLSearchParams(useLocation().search);
  const pct = k => { const n = Number(q.get(k)); return Number.isFinite(n) && n > 0 && n <= 100 ? n : null; };
  const hi = pct("with"), lo = pct("without");
  return <>
    <Hero eyebrow="Keep Rate calculator" crumbs={[["Free tools", "/tools"], ["Keep Rate calculator"]]} h="What is your <b>retention worth?</b>" lede="Enter last year's donors and how many gave again, and see your rate beside the national figure and what a five-point lift would be worth." noCta>
      <div className="tool tool-hero">
        <div className="form">
          <label>Donors last year<input type="number" min="1" value={v.a} onChange={on("a")} /></label>
          <label>Of those, gave again this year<input type="number" min="0" value={v.b} onChange={on("b")} /></label>
          <label>Average yearly gift ($)<input type="number" min="0" value={v.c} onChange={on("c")} /></label>
        </div>
        <div className="out" aria-live="polite">
          <div className="big">{m.rate}</div><p>your retention, against 43.3% nationally in 2025</p>
          <div className="big sm">{m.lift}</div><p>more each year from a five-point lift ({m.more} more donors giving again)</p>
        </div>
      </div>
      <p className="srcnote">National figure: 43.3% overall retention in 2025, <A href={SRC.fep25[1]}>{SRC.fep25[0]}</A>.</p>
    </Hero>
    {/* Only the sourced pair opens the panel: any other rates in the link
        would print beside a source that never said them. */}
    {hi === RETENTION_GAP.withStrategy && lo === RETENTION_GAP.without && <GapPanel hi={hi} lo={lo} />}
    <Steps eb="How it works" h="Three numbers, <b>one answer.</b>" list={[
      ["Count last year's donors", "Everyone who gave at least once last year, counted once each."],
      ["Count who gave again", "Of those same people, how many have given this year."],
      ["Read your rate", "The second number over the first, beside the national figure and what five more points would give."],
    ]} />
    <FaqS items={[
      ["Is anything I type sent anywhere?", "No. The arithmetic runs in your browser and nothing is saved or sent."],
      ["Who counts as a retained donor?", "A person who gave last year and gave again this year. New donors this year do not count toward the rate, because they were not in last year's group."],
      ["What does the five-point lift mean?", "Five more of every hundred of last year's donors giving again, each at your average yearly gift. It is example arithmetic on your numbers, not a forecast."],
      ["Where does the national figure come from?", "The Fundraising Effectiveness Project's report for 2025. The source is linked under the calculator."],
    ]} />
    <GlossLine list={[["donor-retention-rate", "Donor retention rate"], ["first-year-retention", "First-year retention"], ["repeat-donor-retention", "Repeat donor retention"]]} />
    <FinalCta />
  </>;
}

export function ToolLapsed() {
  const [v, on] = useFields({ a: "580", b: "180", c: "15" });
  const m = lapsedMath(num(v.a), num(v.b), num(v.c));
  return <>
    <Hero eyebrow="Lapse Ledger" crumbs={[["Free tools", "/tools"], ["Lapse Ledger"]]} h="What did last year's lapsed donors <b>used to give?</b>" lede="A quick way to put a dollar figure on the people who quietly stopped." noCta>
      <div className="tool tool-hero">
        <div className="form">
          <label>Donors who did not give again<input type="number" min="0" value={v.a} onChange={on("a")} /></label>
          <label>Their average yearly gift ($)<input type="number" min="0" value={v.b} onChange={on("b")} /></label>
          <label>Share who might give again after a call (%)<input type="number" min="0" max="100" value={v.c} onChange={on("c")} /></label>
        </div>
        <div className="out" aria-live="polite">
          <div className="big">{m.lost}</div><p>a year, given by donors who stopped</p>
          <div className="big sm">{m.back}</div><p>more a year if {num(v.c)}% give again after a call</p>
        </div>
      </div>
    </Hero>
    <Steps eb="How it works" h="Put a number <b>on the quiet ones.</b>" list={[
      ["Count who stopped", "Donors who gave last year and have not given this year."],
      ["Add their average gift", "What one of them gave in a typical year."],
      ["Guess who might give again", "Your own guess at how many would give after a personal call."],
    ]} />
    <FaqS items={[
      ["Is anything I type sent anywhere?", "No. The arithmetic runs in your browser and nothing is saved or sent."],
      ["Is the starting share a benchmark?", "No. It is a placeholder so the page shows a number. Type your own guess; a cautious one is better."],
      ["Where do I get the count of donors who stopped?", "From your LYBUNT list: donors who gave last year and not yet this year. The LYBUNT and SYBUNT finder on this site makes that list from a CSV of gifts."],
    ]} />
    <GlossLine list={[["lapsed-donor", "Lapsed donor"], ["reactivation", "Reactivation"], ["lybunt", "LYBUNT"]]} />
    <FinalCta />
  </>;
}

export function ToolThermometer() {
  const [v, on] = useFields({ n: "Spring appeal", g: "50000", r: "31250" });
  const m = thermometerMath(num(v.g), num(v.r));
  return <>
    <Hero eyebrow="Goal Gauge" crumbs={[["Free tools", "/tools"], ["Goal Gauge"]]} h="A goal bar <b>people want to fill.</b>" lede="Type your goal and what you have raised so far, and see how full the bar is." noCta>
      <div className="tool tool-hero">
        <div className="form">
          <label>Campaign name<input value={v.n} onChange={on("n")} /></label>
          <label>Goal ($)<input type="number" value={v.g} onChange={on("g")} /></label>
          <label>Raised so far ($)<input type="number" value={v.r} onChange={on("r")} /></label>
        </div>
        <div className="out" aria-live="polite">
          <p style={{ fontWeight: 700, fontSize: 20 }}>{v.n}</p>
          <div className="therm"><span style={{ width: m.pct + "%" }}></span></div>
          <div className="big sm">{m.raised}</div><p>raised of {m.goal} · {m.pct.toFixed(0)}%</p>
        </div>
      </div>
    </Hero>
    <Steps eb="How it works" h="Goal, raised, <b>bar.</b>" list={[
      ["Name the campaign", "The appeal, giving day or drive the bar is for."],
      ["Set the goal", "The dollar figure you have told people you are aiming for."],
      ["Add what is in", "Raised so far. The bar fills as you type, and stops at full."],
    ]} />
    <FaqS items={[
      ["Is anything I type sent anywhere?", "No. The bar is drawn in your browser and nothing is saved or sent."],
      ["Can I share the bar?", "Take a screenshot for a social post, an email or a board update. The bar on this page is not an embed."],
      ["What if we pass the goal?", "The bar stops at full and the dollar figure keeps counting, so you can say exactly how far past it you went."],
    ]} />
    <GlossLine list={[["year-end-appeal", "Year-end appeal"], ["giving-day", "Giving day"], ["capital-campaign", "Capital campaign"]]} />
    <FinalCta />
  </>;
}

// ── LYBUNT AND SYBUNT FINDER ───────────────────────────────────────────────
// Pure. Rows in (objects from papaparse, header: true), the column map
// { donor, date, amount } and "this year"; two lists and a footing out.
// Money is integer cents. Every row lands in exactly one bucket, so the
// buckets foot to the file: rows and dollars.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = n => (n < 10 ? "0" : "") + n;

export function parseCents(v) {
  let s = String(v == null ? "" : v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/^(usd|us\$)\s*/i, "").replace(/[$\s,]/g, "");
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1).replace(/^\$/, ""); }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  let cents = Number(w || "0") * 100 + Number((f + "00").slice(0, 2));
  if (f.length > 2 && Number(f[2]) >= 5) cents += 1;
  return neg ? -cents : cents;
}

export function parseDay(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  const ok = (y, mo, d) => (y >= 1900 && y <= 2200 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? y + "-" + pad2(mo) + "-" + pad2(d) : null);
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/.exec(s);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:$|\s)/.exec(s);
  if (m) return ok(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  if (/[a-z]/i.test(s) && /\b(19|20)\d{2}\b/.test(s)) {
    const t = new Date(s);
    if (!isNaN(t.getTime())) return ok(t.getFullYear(), t.getMonth() + 1, t.getDate());
  }
  return null;
}

export function lybuntSybunt(rows, map, year) {
  const Y = Number(year);
  const people = new Map();
  const skipped = { rows: 0, cents: 0 };
  let totalRows = 0, totalCents = 0;
  for (const r of rows || []) {
    totalRows++;
    const raw = r && map && map.donor ? String(r[map.donor] == null ? "" : r[map.donor]) : "";
    const name = raw.replace(/\s+/g, " ").trim();
    const cents = r && map && map.amount ? parseCents(r[map.amount]) : null;
    const day = r && map && map.date ? parseDay(r[map.date]) : null;
    if (cents != null) totalCents += cents;
    if (!name || cents == null || !day) { skipped.rows++; if (cents != null) skipped.cents += cents; continue; }
    const key = name.toLowerCase();
    let p = people.get(key);
    if (!p) { p = { donor: name, gifts: 0, cents: 0, last: "", years: new Map() }; people.set(key, p); }
    const y = Number(day.slice(0, 4));
    p.gifts++; p.cents += cents;
    if (day > p.last) p.last = day;
    p.years.set(y, (p.years.get(y) || 0) + cents);
  }
  const buckets = {
    current: { rows: 0, cents: 0, donors: 0 },
    lybunt: { rows: 0, cents: 0, donors: 0 },
    sybunt: { rows: 0, cents: 0, donors: 0 },
    skipped,
  };
  const lybunt = [], sybunt = [];
  for (const p of people.values()) {
    const ys = [...p.years.keys()];
    const b = ys.some(y => y >= Y) ? "current" : p.years.has(Y - 1) ? "lybunt" : "sybunt";
    buckets[b].rows += p.gifts; buckets[b].cents += p.cents; buckets[b].donors++;
    const out = { donor: p.donor, last: p.last, gifts: p.gifts, lifetime: p.cents };
    if (b === "lybunt") lybunt.push({ ...out, cents: p.years.get(Y - 1) });
    if (b === "sybunt") sybunt.push({ ...out, cents: p.cents });
  }
  const byGiving = (a, b) => b.cents - a.cents || a.donor.localeCompare(b.donor);
  lybunt.sort(byGiving); sybunt.sort(byGiving);
  return { lybunt, sybunt, buckets, total: { rows: totalRows, cents: totalCents } };
}

const fmtC = c => (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDay = d => (d ? MONTHS[+d.slice(5, 7) - 1] + " " + +d.slice(8, 10) + ", " + d.slice(0, 4) : "");
const SHOW = 50;

function guessCol(fields, tests) {
  for (const t of tests) { const f = fields.find(x => t.test(x)); if (f) return f; }
  return "";
}
function guessMap(fields) {
  const date = guessCol(fields, [/^(gift|donation|payment|received)?[\s_-]*date$/i, /date/i, /received|when/i]);
  const amount = guessCol(fields.filter(f => f !== date), [/^(gift|donation|payment)?[\s_-]*amount$/i, /amount/i, /^(gift|total|value|sum)$/i, /gift|total|\$/i]);
  const donor = guessCol(fields.filter(f => f !== date && f !== amount), [/^(donor|full)?[\s_-]*name$/i, /donor|constituent|contact/i, /name/i]);
  return { donor, date, amount };
}

// A spreadsheet cell that starts with = + - @ can run as a formula; a name
// is never one, so it gets a leading apostrophe.
const csvCell = v => {
  let s = String(v == null ? "" : v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function downloadCsv(name, head, lines) {
  const text = [head, ...lines].map(r => r.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Twelve rows, dated against the year the button is pressed in, so the
// sample shows both lists in any year.
function sampleRows() {
  const Y = new Date().getFullYear();
  const csv = [
    "Donor,Gift date,Amount",
    `Maria Alvarez,${Y - 1}-03-14,$250.00`,
    `Maria Alvarez,${Y}-02-02,$300.00`,
    `James Okafor,11/20/${Y - 1},"$1,250.00"`,
    `Priya Shah,${Y - 2}-12-01,500`,
    `Priya Shah,${Y - 1}-12-05,75`,
    `Tom Becker,${Y - 3}-06-30,"$2,000.00"`,
    `Tom Becker,${Y - 2}-06-28,"$1,000.00"`,
    `Ruth Lindqvist,${Y - 2}-04-09,150`,
    `Dan Cho,${Y}-01-15,50`,
    `Ellen Park,${Y - 1}-09-22,$600.00`,
    `,${Y - 1}-05-05,40`,
    `Dan Cho,soon,25`,
  ].join("\n");
  return { csv, year: Y };
}

function ListTable({ title, href, rows, year, kind }) {
  const col = kind === "lybunt" ? "Given in " + (year - 1) : "Given in all";
  const save = () => downloadCsv(kind + "-" + year + ".csv", ["Donor", "Last gift date", col, "Number of gifts"],
    rows.map(r => [r.donor, r.last, (r.cents / 100).toFixed(2), r.gifts]));
  const sum = rows.reduce((s, r) => s + r.cents, 0);
  return (
    <div className="lyb-list" data-list={kind}>
      <div className="lyb-list-h">
        <h3><A href={href}>{title}</A>: {rows.length.toLocaleString()} {rows.length === 1 ? "donor" : "donors"}, {fmtC(sum)}</h3>
        {rows.length > 0 && <button type="button" className="pill pill-soft" onClick={save}><i></i>Download CSV</button>}
      </div>
      {rows.length === 0 ? <p className="lyb-empty">Nobody in this file is on this list for {year}.</p> : <>
        <div className="tbl-wrap"><table className="tt">
          <thead><tr><th>Donor</th><th>Last gift</th><th className="n">{col}</th><th className="n">Gifts</th></tr></thead>
          <tbody>{rows.slice(0, SHOW).map(r => (
            <tr key={r.donor}><td>{r.donor}</td><td>{fmtDay(r.last)}</td><td className="n">{fmtC(r.cents)}</td><td className="n">{r.gifts}</td></tr>
          ))}</tbody>
        </table></div>
        {rows.length > SHOW && <p className="lyb-more">Showing the top {SHOW}. {(rows.length - SHOW).toLocaleString()} more are in the download.</p>}
      </>}
    </div>
  );
}

function LybuntFinder() {
  const [file, setFile] = useState(null); // { name, rows, fields }
  const [map, setMap] = useState({ donor: "", date: "", amount: "" });
  const [year, setYear] = useState(0);
  const [err, setErr] = useState("");
  const [over, setOver] = useState(false);

  const load = (name, data, fields, y) => {
    setErr("");
    if (!fields.length || !data.length) { setFile(null); setErr("That file has no rows we could read. Check it has a header row and at least one gift."); return; }
    setFile({ name, rows: data, fields });
    setMap(guessMap(fields));
    setYear(y || new Date().getFullYear());
  };
  const readFile = f => {
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name) && !/csv|text\/plain/.test(f.type || "")) { setErr("Choose a CSV file. From Excel or Google Sheets, save or download as CSV first."); return; }
    Papa.parse(f, {
      header: true, skipEmptyLines: "greedy",
      complete: res => load(f.name, res.data, (res.meta.fields || []).filter(Boolean)),
      error: () => setErr("That file could not be read. Try saving it again as CSV."),
    });
  };
  const trySample = () => {
    const s = sampleRows();
    const res = Papa.parse(s.csv, { header: true, skipEmptyLines: "greedy" });
    load("sample.csv", res.data, res.meta.fields, s.year);
  };

  const ready = file && map.donor && map.date && map.amount;
  const out = useMemo(() => (ready ? lybuntSybunt(file.rows, map, year) : null), [ready, file, map, year]);
  const years = useMemo(() => {
    if (!file || !map.date) return [year].filter(Boolean);
    const set = new Set([year]);
    for (const r of file.rows) { const d = parseDay(r[map.date]); if (d) set.add(Number(d.slice(0, 4))); }
    return [...set].filter(Boolean).sort((a, b) => b - a);
  }, [file, map.date, year]);

  const B = out && out.buckets;
  const foot = out ? [
    ["Gave in " + year + " or later", B.current],
    [<><A href="/glossary/lybunt">LYBUNT</A> donors' gifts</>, B.lybunt],
    [<><A href="/glossary/sybunt">SYBUNT</A> donors' gifts</>, B.sybunt],
    ["Skipped: blank donor, or a date or amount we could not read", B.skipped],
  ] : [];

  return (
    <div className="lyb" data-testid="lybunt-finder">
      <div className="lyb-in">
        <div className={"lyb-drop" + (over ? " over" : "")}
          onDragOver={e => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); readFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}>
          <p className="lyb-drop-h">Drop a CSV of gifts here</p>
          <p>One row per gift, with who gave, the date and the amount. The file is read in your browser and never leaves it.</p>
          <div className="lyb-btns">
            <label className="pill pill-ink lyb-file"><i></i>Choose a file
              <input type="file" accept=".csv,text/csv,text/plain" onChange={e => { readFile(e.target.files && e.target.files[0]); e.target.value = ""; }} />
            </label>
            <button type="button" className="lyb-sample" onClick={trySample}>Try it with a sample file</button>
          </div>
          {err && <p className="form-err" role="alert">{err}</p>}
        </div>
        {file && (
          <div className="form lyb-map">
            <p className="lyb-fname">{file.name}: {file.rows.length.toLocaleString()} {file.rows.length === 1 ? "row" : "rows"}</p>
            <label>Donor column<select value={map.donor} onChange={e => setMap({ ...map, donor: e.target.value })}><option value="">Choose a column</option>{file.fields.map(f => <option key={f} value={f}>{f}</option>)}</select></label>
            <label>Date column<select value={map.date} onChange={e => setMap({ ...map, date: e.target.value })}><option value="">Choose a column</option>{file.fields.map(f => <option key={f} value={f}>{f}</option>)}</select></label>
            <label>Amount column<select value={map.amount} onChange={e => setMap({ ...map, amount: e.target.value })}><option value="">Choose a column</option>{file.fields.map(f => <option key={f} value={f}>{f}</option>)}</select></label>
            <label>This year<select value={year} onChange={e => setYear(Number(e.target.value))}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select></label>
          </div>
        )}
      </div>
      {file && !ready && <p className="lyb-note">Choose the donor, date and amount columns to see the lists.</p>}
      {out && (
        <div className="lyb-out" aria-live="polite">
          <p className="lyb-note"><A href="/glossary/lybunt">LYBUNT</A> means gave in {year - 1} and not in {year}. <A href="/glossary/sybunt">SYBUNT</A> means gave in some year before {year - 1}, and not in {year - 1} or {year}. The two lists never overlap: a donor who gave in {year - 1} is on the LYBUNT list, never both.</p>
          <ListTable title="LYBUNT" href="/glossary/lybunt" rows={out.lybunt} year={year} kind="lybunt" />
          <ListTable title="SYBUNT" href="/glossary/sybunt" rows={out.sybunt} year={year} kind="sybunt" />
          <div className="lyb-foot">
            <h3>How the file foots</h3>
            <p>Every row lands in exactly one line, so the rows and dollars add up to the whole file.</p>
            <div className="tbl-wrap"><table className="tt">
              <thead><tr><th>Where each row went</th><th className="n">Rows</th><th className="n">Dollars</th></tr></thead>
              <tbody>{foot.map((f, i) => <tr key={i}><td>{f[0]}</td><td className="n">{f[1].rows.toLocaleString()}</td><td className="n">{fmtC(f[1].cents)}</td></tr>)}</tbody>
              <tfoot><tr><td>The whole file</td><td className="n">{out.total.rows.toLocaleString()}</td><td className="n">{fmtC(out.total.cents)}</td></tr></tfoot>
            </table></div>
            <p className="lyb-small">Dollars count every amount that could be read, including on skipped rows. Donors are matched by name exactly as written, ignoring capitals and extra spaces.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function ToolLybuntFinder() {
  return <>
    <Hero eyebrow="LYBUNT and SYBUNT finder · free tool" crumbs={[["Free tools", "/tools"], ["LYBUNT and SYBUNT finder"]]} h="Find your <b>LYBUNT and SYBUNT donors.</b>"
      lede="Drop in a CSV of gifts and see who gave last year but not this year, and who gave before that but not since, without the file leaving your browser." noCta>
      <LybuntFinder />
    </Hero>
    <Steps eb="How it works" h="One file, <b>two lists.</b>" list={[
      ["Export your gifts", "A CSV with one row per gift: who gave, the date and the amount. Any donor system or spreadsheet can make one."],
      ["Check the columns", "We guess which column is which. Change any guess, and pick the year you are counting from."],
      ["Download the lists", "Both lists, largest giving first, as CSV files to call, write to or bring to your next meeting."],
    ]} />
    <FaqS items={[
      ["Is my file uploaded?", "No. It is read and counted in your browser. Nothing is sent, and nothing is saved: close the tab and it is gone."],
      ["What is the difference between LYBUNT and SYBUNT?", "LYBUNT is Last Year But Unfortunately Not This year. SYBUNT is Some Year But Unfortunately Not This year. Here a donor who gave last year is only on the LYBUNT list, so the two never overlap."],
      ["Why are some rows skipped?", "A row is skipped when the donor is blank or the date or amount cannot be read. The footing table counts them, so you can see the lists still add up to the whole file."],
      ["How are donors matched?", "By the name exactly as it is written, ignoring capitals and extra spaces. Two spellings of one person count as two donors, so clean duplicates first if you can."],
    ]} />
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <p className="lede">In Steward, LYBUNT and SYBUNT sit under Who stopped giving in Reports. Every figure comes with the sentence that defines it, and clicking a figure shows the rows behind it.</p>
    </div></section>
    <GlossLine list={[["lybunt", "LYBUNT"], ["sybunt", "SYBUNT"], ["lapsed-donor", "Lapsed donor"]]} />
    <FinalCta />
  </>;
}

// ── THANK-YOU LETTER BUILDER ───────────────────────────────────────────────
// The starting wording is Steward's own letter templates (shared/brandKit.js
// TEMPLATE_KINDS, COMMS-2), filled from the fields as she types.
const KINDS = [["first", "First gift"], ["monthly", "Monthly"], ["major", "Major gift"], ["memory", "In memory"], ["yearend", "Year-end"]];

export function thankYouLetter(kind, f, receipt) {
  const v = (x, ph) => (String(x || "").trim() || "[" + ph + "]");
  const sentence = s => { const t = String(s || "").trim(); return t ? (/[.!?]$/.test(t) ? t : t + ".") : ""; };
  const name = v(f.first, "first name"), org = v(f.org, "organization name");
  const amt = kind === "monthly" ? v(f.monthly, "monthly amount") : v(f.amount, "gift amount");
  const date = v(f.date, "gift date"), does = sentence(f.does);
  const join = (...xs) => xs.filter(Boolean).join(" ");
  let body, close;
  if (kind === "monthly") {
    body = [join(`Thank you for your monthly gift of ${amt} to ${org}, starting ${date}.`, "Gifts that arrive every month are the ones we can plan around, and yours does exactly that."),
      join(does, "Thank you for being part of it, month after month.")];
    close = "With thanks,";
  } else if (kind === "major") {
    body = [join(`Thank you for your gift of ${amt} to ${org}, which arrived on ${date}.`, "A gift of this size changes what we can do this year, and I wanted to thank you myself."),
      join(does, "I would like to show you what it makes possible. I will be in touch to find a time.")];
    close = "With gratitude,";
  } else if (kind === "memory") {
    body = [join(`Thank you for your gift of ${amt}, given on ${date} in memory of ${v(f.honoree, "name of the person remembered")}.`, `It is a generous way to remember someone, and we are honored you chose ${org}.`),
      does];
    close = "With sympathy and thanks,";
  } else if (kind === "yearend") {
    body = [join(`Thank you for your year-end gift of ${amt} to ${org}, which arrived on ${date}.`, "December asks a lot of everyone, and I am grateful you thought of us."),
      join(does, "Whatever the new year brings, I hope it is a kind one.")];
    close = "With thanks,";
  } else {
    body = [join(`Thank you for your first gift to ${org}, ${amt} on ${date}.`, does || "It goes straight into the work.", "We are glad you are part of it."),
      "We will write now and then to tell you what your gift made possible."];
    close = "With thanks,";
  }
  const sign = [v(f.signer, "your name"), [String(f.title || "").trim(), String(f.org || "").trim()].filter(Boolean).join(", ")].filter(Boolean).join("\n");
  const parts = ["Dear " + name + ",", ...body.filter(Boolean), close + "\n" + sign];
  if (receipt) parts.push(`${org} received your gift of ${amt} on ${date}. No goods or services were provided in exchange for this gift.`);
  return parts.join("\n\n");
}

function LetterBuilder() {
  const [kind, setKind] = useState("first");
  const [f, setF] = useState({ first: "Margaret", amount: "$250", monthly: "$25", date: "September 14, 2026", org: "", does: "", honoree: "", signer: "", title: "Executive Director" });
  const [receipt, setReceipt] = useState(false);
  const [copied, setCopied] = useState(""); // "", "ok", "fallback"
  const ta = useRef(null);
  const on = k => e => { setF({ ...f, [k]: e.target.value }); setCopied(""); };
  const text = thankYouLetter(kind, f, receipt);
  useEffect(() => { if (copied === "fallback" && ta.current) { ta.current.focus(); ta.current.select(); } }, [copied]);
  const copy = () => {
    const done = () => setCopied("ok"), fail = () => setCopied("fallback");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
      else fail();
    } catch { fail(); }
  };
  return (
    <div className="tool tool-hero letter-tool" data-testid="letter-builder">
      <div className="form">
        <div className="kind-btns" role="group" aria-label="Kind of gift">
          {KINDS.map(k => <button key={k[0]} type="button" aria-pressed={kind === k[0] ? "true" : "false"} onClick={() => { setKind(k[0]); setCopied(""); }}>{k[1]}</button>)}
        </div>
        <label>Donor's first name<input value={f.first} onChange={on("first")} /></label>
        {kind === "monthly"
          ? <label>Monthly amount<input value={f.monthly} onChange={on("monthly")} /></label>
          : <label>Gift amount<input value={f.amount} onChange={on("amount")} /></label>}
        <label>{kind === "monthly" ? "First monthly gift date" : "Gift date"}<input value={f.date} onChange={on("date")} /></label>
        {kind === "memory" && <label>In memory of<input value={f.honoree} onChange={on("honoree")} placeholder="Walter Chen" /></label>}
        <label>Organization name<input value={f.org} onChange={on("org")} placeholder="Harbor Youth Arts" /></label>
        <label>What the gift does, in one sentence<input value={f.does} onChange={on("does")} placeholder="It pays for a week of after-school tutoring." /></label>
        <label>Signer's name<input value={f.signer} onChange={on("signer")} placeholder="Dana Reyes" /></label>
        <label>Signer's title<input value={f.title} onChange={on("title")} /></label>
        <label className="check"><input type="checkbox" checked={receipt} onChange={e => { setReceipt(e.target.checked); setCopied(""); }} />Add the receipt sentence for gifts of $250 or more</label>
      </div>
      <div className="letter-col">
        <div className="letter" aria-live="polite">{text}</div>
        <div className="letter-btns">
          <button type="button" className="pill pill-ink" onClick={copy}><i></i>Copy letter</button>
          {copied === "ok" && <span className="letter-ok" role="status">Copied. Paste it into your letter or email.</span>}
        </div>
        {copied === "fallback" && <>
          <p className="lyb-small">Your browser would not copy it for us. The letter is selected below: press Ctrl+C, or Cmd+C on a Mac.</p>
          <textarea ref={ta} className="letter-ta" readOnly value={text} rows={12} />
        </>}
      </div>
    </div>
  );
}

export function ToolThankYouLetter() {
  return <>
    <Hero eyebrow="Thank-you letter builder · free tool" crumbs={[["Free tools", "/tools"], ["Thank-you letter builder"]]} h="A thank-you letter <b>in a minute.</b>"
      lede="Pick the kind of gift, fill in a few details, and copy a short, warm thank-you letter you can sign as your own." noCta>
      <LetterBuilder />
    </Hero>
    <Steps eb="How it works" h="Pick, fill, <b>copy.</b>" list={[
      ["Pick the kind of gift", "First gift, monthly, major, in memory or year-end. Each starts from different words."],
      ["Fill in the details", "Name, amount, date and one sentence on what the gift does. The letter changes as you type."],
      ["Copy and make it yours", "Paste it into your letter or email, add a line only you could write, sign it and send it yourself."],
    ]} />
    <FaqS items={[
      ["Is anything I type sent anywhere?", "No. The letter is written in your browser. Nothing is saved or sent, and nothing goes to the donor until you send it."],
      ["Does the receipt sentence make this a tax receipt?", "For a single gift of $250 or more, the IRS asks for a written acknowledgment that names your organization, the amount and date, and says whether anything was given in return. The box adds that. If the donor got something back, such as a dinner, leave it off and check with your accountant."],
      ["How soon should a thank-you go out?", "As soon as you can, while the gift is still fresh for the donor. A short letter that arrives this week does more than a long one next month."],
      ["Can Steward write these for me?", "When a gift comes in, Steward drafts a thank-you and puts it on Home under Thank-yous ready. It never sends it. You read it and send it from your own mail."],
    ]} />
    <GlossLine list={[["acknowledgment-letter", "Acknowledgment letter"], ["tax-receipt", "Tax receipt"], ["stewardship", "Stewardship"]]} />
    <FinalCta />
  </>;
}
